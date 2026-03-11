/**
 * Supabase Vector Search Service
 * Searches for answers to questions using vector embeddings
 * @module services/SupabaseService
 */

import axios from 'axios';
import { logger } from '../utils/logger.js';

/**
 * Answered question with source
 */
export interface AnsweredQuestion {
  question: string;
  answer: string;
  source?: string;
  similarity: number;
}

/**
 * Search result from Supabase
 */
interface SupabaseSearchResult {
  id: number;
  content: string;
  metadata: {
    URL?: string;
    [key: string]: unknown;
  };
  similarity: number;
}

/**
 * OpenAI embedding response
 */
interface OpenAIEmbeddingResponse {
  data: Array<{
    embedding: number[];
    index: number;
  }>;
  usage: {
    prompt_tokens: number;
    total_tokens: number;
  };
}

/**
 * Callback for emitting logs visible on frontend
 */
export type LogCallback = (level: 'info' | 'thinking' | 'warn', message: string) => void | Promise<void>;

/**
 * Supabase Vector Search Service
 * Handles question answering via semantic search in Supabase
 */
export class SupabaseService {
  private supabaseUrl: string;
  private supabaseKey: string;
  private openRouterKey: string;

  // Question words to remove for better search
  private static readonly QUESTION_WORDS = [
    // English
    'what', 'how', 'why', 'when', 'where', 'who', 'which', 'whose', 'whom',
    'is', 'are', 'was', 'were', 'do', 'does', 'did', 'can', 'could', 'would', 'should',
    'the', 'a', 'an', 'of', 'to', 'for', 'in', 'on', 'with', 'by', 'from', 'at',
    // Russian
    'что', 'как', 'почему', 'когда', 'где', 'кто', 'какой', 'какая', 'какие', 'каким',
    'является', 'являются', 'можно', 'нужно', 'следует', 'стоит',
    'это', 'эти', 'этот', 'эта', 'для', 'при', 'или', 'если',
    // German
    'was', 'wie', 'warum', 'wann', 'wo', 'wer', 'welche', 'welcher', 'welches',
    'ist', 'sind', 'kann', 'können', 'der', 'die', 'das', 'ein', 'eine',
  ];

  constructor(supabaseUrl: string, supabaseKey: string, openRouterKey: string) {
    // Normalize URL
    this.supabaseUrl = supabaseUrl.endsWith('/') ? supabaseUrl.slice(0, -1) : supabaseUrl;
    this.supabaseKey = supabaseKey;
    this.openRouterKey = openRouterKey;
  }

  /**
   * Extract meaningful keywords from a question
   * Removes question words and creates a search-friendly query
   */
  private extractSearchQuery(question: string): string {
    // Remove punctuation and normalize
    let query = question
      .toLowerCase()
      .replace(/[?!.,;:'"()[\]{}]/g, '')
      .trim();

    // Split into words
    const words = query.split(/\s+/);

    // Filter out question words and short words
    const keywords = words.filter(word =>
      word.length > 2 &&
      !SupabaseService.QUESTION_WORDS.includes(word)
    );

    // Return cleaned query or original if too short
    const cleanedQuery = keywords.join(' ');
    return cleanedQuery.length > 5 ? cleanedQuery : question;
  }

  /**
   * Public wrapper for generating embeddings — used by EntityClusteringService
   */
  async getEmbedding(text: string): Promise<number[]> {
    return this.generateEmbedding(text);
  }

  /**
   * Generate embedding for text using OpenAI via OpenRouter
   */
  private async generateEmbedding(text: string): Promise<number[]> {
    try {
      const response = await axios.post<OpenAIEmbeddingResponse>(
        'https://openrouter.ai/api/v1/embeddings',
        {
          model: 'openai/text-embedding-3-small',
          input: text,
        },
        {
          headers: {
            'Authorization': `Bearer ${this.openRouterKey}`,
            'Content-Type': 'application/json',
          },
          timeout: 30000,
        }
      );

      if (response.data?.data?.[0]?.embedding) {
        return response.data.data[0].embedding;
      }

      throw new Error('Invalid embedding response');
    } catch (error) {
      if (axios.isAxiosError(error)) {
        logger.error('Embedding generation failed', {
          status: error.response?.status,
          message: error.message,
        });
        throw new Error(`Embedding failed: ${error.message}`);
      }
      throw error;
    }
  }

  /**
   * Search for similar documents in Supabase using vector similarity
   */
  private async searchSimilarDocuments(
    embedding: number[],
    matchCount: number = 3,
    minSimilarity: number = 0.7
  ): Promise<SupabaseSearchResult[]> {
    try {
      // Call the match_documents RPC function
      const response = await axios.post(
        `${this.supabaseUrl}/rest/v1/rpc/match_documents`,
        {
          query_embedding: embedding,
          match_count: matchCount,
          filter: {},
        },
        {
          headers: {
            'apikey': this.supabaseKey,
            'Authorization': `Bearer ${this.supabaseKey}`,
            'Content-Type': 'application/json',
          },
          timeout: 30000,
        }
      );

      if (response.data && Array.isArray(response.data)) {
        // Filter by minimum similarity
        return response.data.filter(
          (result: SupabaseSearchResult) => result.similarity >= minSimilarity
        );
      }

      return [];
    } catch (error) {
      if (axios.isAxiosError(error)) {
        logger.error('Supabase search failed', {
          status: error.response?.status,
          message: error.message,
          data: error.response?.data,
        });
        throw new Error(`Supabase search failed: ${error.message}`);
      }
      throw error;
    }
  }

  /**
   * Find answer to a single question
   * Returns the most relevant content from Supabase as the answer
   */
  async findAnswer(question: string): Promise<AnsweredQuestion | null> {
    try {
      // Extract meaningful keywords from question for better search
      const searchQuery = this.extractSearchQuery(question);

      logger.debug(`Searching for: "${searchQuery}" (original: "${question.substring(0, 50)}...")`);

      // Generate embedding for the extracted keywords
      const embedding = await this.generateEmbedding(searchQuery);

      // Search for similar documents with lower threshold for better recall
      const results = await this.searchSimilarDocuments(embedding, 5, 0.55);

      if (results.length === 0) {
        logger.debug(`No answer found for: "${searchQuery}" (similarity < 0.55)`);
        return null;
      }

      // Take the best match
      const bestMatch = results[0];
      logger.debug(`Found answer with similarity ${bestMatch.similarity.toFixed(3)} for: "${searchQuery}"`);

      // Clean and truncate the answer
      let answer = bestMatch.content.trim();

      // If answer is too long, take first meaningful portion
      if (answer.length > 1000) {
        answer = answer.substring(0, 1000) + '...';
      }

      return {
        question,
        answer,
        source: bestMatch.metadata?.URL || undefined,
        similarity: bestMatch.similarity,
      };
    } catch (error) {
      logger.error(`Failed to find answer for question: ${question.substring(0, 50)}...`, { error });
      return null;
    }
  }

  /**
   * Find answers for multiple questions
   * Returns only questions that have answers
   */
  async findAnswersForQuestions(
    questions: string[],
    onProgress?: (answered: number, total: number, current: AnsweredQuestion | null) => void
  ): Promise<AnsweredQuestion[]> {
    const answeredQuestions: AnsweredQuestion[] = [];

    for (let i = 0; i < questions.length; i++) {
      const question = questions[i];

      try {
        const answer = await this.findAnswer(question);

        if (answer) {
          answeredQuestions.push(answer);
          onProgress?.(answeredQuestions.length, questions.length, answer);
        } else {
          onProgress?.(answeredQuestions.length, questions.length, null);
        }
      } catch (error) {
        logger.error(`Error processing question ${i + 1}/${questions.length}`, { error });
        onProgress?.(answeredQuestions.length, questions.length, null);
      }

      // Small delay to avoid rate limiting
      if (i < questions.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 200));
      }
    }

    return answeredQuestions;
  }

  /**
   * Clean scraped markdown: remove navigation, author bios, related posts,
   * cookie banners, image-only lines, and other non-article content.
   */
  cleanMarkdown(md: string): string {
    const lines = md.split('\n');
    const cleaned: string[] = [];
    let skipBlock = false;

    for (const line of lines) {
      const trimmed = line.trim();

      // Skip empty lines (preserve them for paragraph splitting later)
      if (!trimmed) {
        if (cleaned.length > 0) cleaned.push('');
        continue;
      }

      // Skip image-only lines: [![...](...)  or ![...](...)
      if (/^!?\[.*?\]\(.*?\)$/.test(trimmed) && !trimmed.startsWith('#')) continue;

      // Skip gravatar/avatar lines
      if (trimmed.includes('gravatar.com') || trimmed.includes('avatar')) continue;

      // Skip lines that are ONLY markdown links with no surrounding text
      // e.g. "[Category](https://...)" or "[Category](url) [Category2](url2)"
      if (/^\[.+?\]\(.+?\)(\s+\[.+?\]\(.+?\))*$/.test(trimmed) && trimmed.length < 300) continue;

      // Skip "Springe zum Inhalt" / "Skip to content" links
      if (/springe zum inhalt|skip to content|jump to content/i.test(trimmed)) continue;

      // Skip author bio blocks: "Von [Author]" + date patterns
      if (/^Von\s+\[.+?\]\(.+?\)$/i.test(trimmed)) continue;
      if (/^(Januar|Februar|März|April|Mai|Juni|Juli|August|September|Oktober|November|Dezember|January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},\s+\d{4}$/i.test(trimmed)) continue;

      // Skip "More Posts" / "Website" author links
      if (/^\[More Posts\]|^\[Website\]/i.test(trimmed)) continue;

      // Skip author heading lines: "#### Von [Author](url)"
      if (/^#{1,4}\s+Von\s+\[/i.test(trimmed)) continue;

      // Skip cookie consent blocks
      if (/cookie|AKZEPTIEREN|SPEICHERN|This website uses cookies|necessary cookies|non-necessary/i.test(trimmed)) {
        skipBlock = true;
        continue;
      }

      // Skip comment form hints
      if (/E-Mail-Adresse wird nicht veröffentlicht|Erforderliche Felder|email.*will not be published/i.test(trimmed)) continue;

      // Skip "Related posts" / "Ähnliche Beiträge" sections — detect by repeated #### + link patterns
      if (/^#{3,4}\s+\[.+?\]\(.+?\)$/.test(trimmed)) continue;

      // Skip short author bio lines
      if (/^Geboren .{10,80}$/.test(trimmed) && trimmed.length < 120) continue;

      // Resume after cookie block on next real content
      if (skipBlock) {
        // If we hit a heading or substantial paragraph, stop skipping
        if (trimmed.startsWith('#') || trimmed.length > 100) {
          skipBlock = false;
        } else {
          continue;
        }
      }

      cleaned.push(line);
    }

    return cleaned.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  }

  /**
   * Split text into chunks at paragraph/sentence boundaries
   */
  chunkText(text: string, maxChars: number = 2000): string[] {
    // Split on double newlines (paragraphs)
    const paragraphs = text.split(/\n\n+/).filter(p => p.trim().length > 0);
    const chunks: string[] = [];

    for (const paragraph of paragraphs) {
      const trimmed = paragraph.trim();
      if (trimmed.length <= maxChars) {
        if (trimmed.length >= 50) {
          chunks.push(trimmed);
        }
        continue;
      }

      // Paragraph too long — split at sentence boundaries
      const sentences = trimmed.split(/(?<=[.!?])\s+/);
      let currentChunk = '';
      for (const sentence of sentences) {
        if ((currentChunk + ' ' + sentence).length > maxChars && currentChunk.length > 0) {
          if (currentChunk.trim().length >= 50) {
            chunks.push(currentChunk.trim());
          }
          currentChunk = sentence;
        } else {
          currentChunk = currentChunk ? currentChunk + ' ' + sentence : sentence;
        }
      }
      if (currentChunk.trim().length >= 50) {
        chunks.push(currentChunk.trim());
      }
    }

    return chunks;
  }

  /**
   * Store text chunks with embeddings in Supabase DataBaseChunks table
   */
  async storeChunks(chunks: Array<{ content: string; metadata: { URL: string } }>, onLog?: LogCallback): Promise<number> {
    let storedCount = 0;

    for (const chunk of chunks) {
      try {
        const embedding = await this.generateEmbedding(chunk.content);

        await axios.post(
          `${this.supabaseUrl}/rest/v1/DataBaseChunks`,
          {
            content: chunk.content,
            metadata: chunk.metadata,
            embedding: embedding,
          },
          {
            headers: {
              'apikey': this.supabaseKey,
              'Authorization': `Bearer ${this.supabaseKey}`,
              'Content-Type': 'application/json',
              'Prefer': 'return=minimal',
            },
            timeout: 30000,
          }
        );

        storedCount++;

        // 100ms delay between embedding calls
        await new Promise(resolve => setTimeout(resolve, 100));
      } catch (error) {
        logger.warn(`Failed to store chunk (${chunk.content.substring(0, 50)}...):`, { error: error instanceof Error ? error.message : 'Unknown' });
      }
    }

    return storedCount;
  }

  /**
   * Perplexity model for research queries via OpenRouter
   */
  private static readonly PERPLEXITY_MODEL = 'perplexity/sonar-pro';

  /**
   * Ask Perplexity a research question via OpenRouter.
   * Returns a concise factual answer or null if unable to answer.
   */
  private async askPerplexity(
    question: string,
    language: string,
    onLog?: LogCallback
  ): Promise<string | null> {
    try {
      await onLog?.('thinking', `🤖 Asking Perplexity: "${question.substring(0, 60)}..."`);

      const response = await axios.post<{
        choices: Array<{ message: { content: string } }>;
        usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
      }>(
        'https://openrouter.ai/api/v1/chat/completions',
        {
          model: SupabaseService.PERPLEXITY_MODEL,
          messages: [
            {
              role: 'system',
              content: `You are a research assistant. Answer the question with FACTS ONLY.
Rules:
- Respond in ${language} language
- Be concise: 2-4 sentences, 50-150 words
- Include specific data: numbers, names, dates, prices where available
- If you cannot find a factual answer, respond with exactly: NO_ANSWER
- Do NOT include citations, URLs, or source references in the text
- Do NOT say "according to..." or "sources say..."
- Just state the facts directly`,
            },
            {
              role: 'user',
              content: question,
            },
          ],
          temperature: 0.1,
          max_tokens: 500,
        },
        {
          headers: {
            'Authorization': `Bearer ${this.openRouterKey}`,
            'Content-Type': 'application/json',
            'HTTP-Referer': 'https://seo-articles-generator.local',
            'X-Title': 'SEO Articles Generator',
          },
          timeout: 30000,
        }
      );

      const content = response.data?.choices?.[0]?.message?.content?.trim();

      if (!content || content === 'NO_ANSWER' || content.includes('NO_ANSWER')) {
        await onLog?.('thinking', `❌ Perplexity could not answer: "${question.substring(0, 50)}..."`);
        return null;
      }

      await onLog?.('info', `✅ Perplexity answered (${content.split(/\s+/).length} words)`);
      return content;
    } catch (error) {
      logger.error('Perplexity query failed', {
        error: error instanceof Error ? error.message : 'Unknown',
        question: question.substring(0, 80),
      });
      await onLog?.('warn', `⚠️ Perplexity query failed: ${error instanceof Error ? error.message : 'Unknown'}`);
      return null;
    }
  }

  /**
   * Find answer using Perplexity AI via OpenRouter as fallback.
   * If Perplexity provides an answer, store it in Supabase for future reuse (self-learning).
   */
  async findAnswerWithPerplexity(
    question: string,
    language: string,
    onLog?: LogCallback
  ): Promise<AnsweredQuestion | null> {
    try {
      const perplexityAnswer = await this.askPerplexity(question, language, onLog);

      if (!perplexityAnswer) {
        return null;
      }

      // Self-learning: store the answer in Supabase for future direct lookups
      try {
        await onLog?.('thinking', `💾 Storing answer in knowledge base for future reuse...`);
        const stored = await this.storeChunks([
          {
            content: `Q: ${question}\nA: ${perplexityAnswer}`,
            metadata: { URL: 'perplexity-ai-research' },
          },
        ]);
        if (stored > 0) {
          await onLog?.('thinking', `💾 Answer stored in Supabase for self-learning`);
        }
      } catch (storeError) {
        // Non-fatal: answer was found but couldn't be stored
        logger.warn('Failed to store Perplexity answer in Supabase', {
          error: storeError instanceof Error ? storeError.message : 'Unknown',
        });
      }

      return {
        question,
        answer: perplexityAnswer,
        source: 'perplexity-ai-research',
        similarity: 0.95,
      };
    } catch (error) {
      logger.error('findAnswerWithPerplexity failed', {
        error: error instanceof Error ? error.message : 'Unknown',
        question: question.substring(0, 80),
      });
      return null;
    }
  }

  /**
   * @deprecated Use findAnswerWithPerplexity() instead. Kept for rollback purposes.
   * Find answer with web fallback: if Supabase has no answer, search web,
   * scrape pages, chunk & store in Supabase, then retry search.
   */
  async findAnswerWithWebFallback(
    question: string,
    firecrawlService: { searchKeyword: (q: string, region: string, language: string, limit: number) => Promise<Array<{ url: string; title: string }>>; scrapeUrl: (url: string) => Promise<{ success: boolean; data?: { markdown?: string } }> },
    language: string,
    region: string,
    onLog?: LogCallback
  ): Promise<AnsweredQuestion | null> {
    // Helper to extract domain from URL for readable logs
    const getDomain = (url: string): string => {
      try { return new URL(url).hostname; } catch { return url.substring(0, 40); }
    };

    try {
      // Phase 1: Try Supabase directly
      const directAnswer = await this.findAnswer(question);
      if (directAnswer) return directAnswer;

      // Phase 2: Web fallback — search for the question
      logger.info(`Web fallback for: "${question.substring(0, 60)}..."`);
      await onLog?.('thinking', `🔎 Searching Google for related pages...`);

      let searchResults: Array<{ url: string; title: string }>;
      try {
        searchResults = await firecrawlService.searchKeyword(question, region, language, 3);
      } catch (searchError) {
        logger.warn(`Firecrawl search failed for question: ${question.substring(0, 50)}`, { error: searchError instanceof Error ? searchError.message : 'Unknown' });
        await onLog?.('warn', `⚠️ Google search failed: ${searchError instanceof Error ? searchError.message : 'Unknown'}`);
        return null;
      }

      if (searchResults.length === 0) {
        await onLog?.('thinking', `No search results found`);
        return null;
      }

      // Incremental: scrape 1 page → store → check → found? stop : next page
      for (let i = 0; i < searchResults.length; i++) {
        const result = searchResults[i];
        try {
          await onLog?.('thinking', `📄 Scraping ${i + 1}/${searchResults.length}: ${getDomain(result.url)}...`);
          const scrapeResult = await firecrawlService.scrapeUrl(result.url);
          if (scrapeResult.success && scrapeResult.data?.markdown) {
            // Clean markdown: remove nav, author bios, related posts, cookie banners
            const cleanedMarkdown = this.cleanMarkdown(scrapeResult.data.markdown);
            const chunks = this.chunkText(cleanedMarkdown, 2000);
            if (chunks.length > 0) {
              // Dynamic limit: up to 30 chunks per page after cleaning
              const limitedChunks = chunks.slice(0, 30);
              const stored = await this.storeChunks(
                limitedChunks.map(c => ({ content: c, metadata: { URL: result.url } }))
              );
              await onLog?.('thinking', `💾 Stored ${stored} chunks from ${getDomain(result.url)}`);
            }
          }
        } catch (scrapeError) {
          logger.warn(`Failed to scrape ${result.url}:`, { error: scrapeError instanceof Error ? scrapeError.message : 'Unknown' });
          continue;
        }

        // Check after EACH page — stop as soon as answer found
        const retryAnswer = await this.findAnswer(question);
        if (retryAnswer) {
          await onLog?.('info', `✅ Found answer after page ${i + 1} (similarity: ${Math.round(retryAnswer.similarity * 100)}%)`);
          return retryAnswer;
        }
      }

      // No answer after all 3 pages
      return null;
    } catch (error) {
      logger.error(`findAnswerWithWebFallback failed for: "${question.substring(0, 50)}"`, { error: error instanceof Error ? error.message : 'Unknown' });
      return null;
    }
  }

  /**
   * Test connection to Supabase
   */
  async testConnection(): Promise<boolean> {
    try {
      const response = await axios.get(`${this.supabaseUrl}/rest/v1/`, {
        headers: {
          'apikey': this.supabaseKey,
          'Authorization': `Bearer ${this.supabaseKey}`,
        },
        timeout: 10000,
      });

      return response.status === 200;
    } catch (error) {
      if (axios.isAxiosError(error) && (error.response?.status === 200 || error.response?.status === 404)) {
        return true;
      }
      return false;
    }
  }
}
