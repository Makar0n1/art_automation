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

        // 300ms delay to avoid rate limits on embedding API
        await new Promise(resolve => setTimeout(resolve, 300));
      } catch (error) {
        logger.warn(`Failed to store chunk (${chunk.content.substring(0, 50)}...):`, { error: error instanceof Error ? error.message : 'Unknown' });
      }
    }

    return storedCount;
  }

  /**
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
        searchResults = await firecrawlService.searchKeyword(question, region, language, 6);
      } catch (searchError) {
        logger.warn(`Firecrawl search failed for question: ${question.substring(0, 50)}`, { error: searchError instanceof Error ? searchError.message : 'Unknown' });
        await onLog?.('warn', `⚠️ Google search failed: ${searchError instanceof Error ? searchError.message : 'Unknown'}`);
        return null;
      }

      if (searchResults.length === 0) {
        await onLog?.('thinking', `No search results found`);
        return null;
      }

      await onLog?.('thinking', `📋 Found ${searchResults.length} pages to analyze`);

      // Batch 1: results 1-3
      const batch1 = searchResults.slice(0, 3);
      for (let i = 0; i < batch1.length; i++) {
        const result = batch1[i];
        try {
          await onLog?.('thinking', `📄 Scraping page ${i + 1}/${batch1.length}: ${getDomain(result.url)}...`);
          const scrapeResult = await firecrawlService.scrapeUrl(result.url);
          if (scrapeResult.success && scrapeResult.data?.markdown) {
            const chunks = this.chunkText(scrapeResult.data.markdown, 2000);
            if (chunks.length > 0) {
              const stored = await this.storeChunks(
                chunks.map(c => ({ content: c, metadata: { URL: result.url } }))
              );
              logger.debug(`Stored ${stored} chunks from ${result.url}`);
              await onLog?.('thinking', `💾 Stored ${stored} knowledge chunks from ${getDomain(result.url)}`);
            }
          } else {
            await onLog?.('thinking', `⏭️ No useful content from ${getDomain(result.url)}`);
          }

          // 1s delay between scrape calls
          await new Promise(resolve => setTimeout(resolve, 1000));
        } catch (scrapeError) {
          logger.warn(`Failed to scrape ${result.url}:`, { error: scrapeError instanceof Error ? scrapeError.message : 'Unknown' });
          await onLog?.('warn', `⚠️ Failed to scrape ${getDomain(result.url)}`);
        }
      }

      // Retry search after batch 1
      await onLog?.('thinking', `🔄 Retrying knowledge base search (batch 1)...`);
      const retryAnswer1 = await this.findAnswer(question);
      if (retryAnswer1) {
        await onLog?.('info', `✅ Found answer after batch 1 (similarity: ${Math.round(retryAnswer1.similarity * 100)}%)`);
        return retryAnswer1;
      }

      // Batch 2: results 4-6
      const batch2 = searchResults.slice(3, 6);
      if (batch2.length === 0) return null;

      await onLog?.('thinking', `📄 Trying batch 2 (${batch2.length} more pages)...`);
      for (let i = 0; i < batch2.length; i++) {
        const result = batch2[i];
        try {
          await onLog?.('thinking', `📄 Scraping page ${i + 4}/${searchResults.length}: ${getDomain(result.url)}...`);
          const scrapeResult = await firecrawlService.scrapeUrl(result.url);
          if (scrapeResult.success && scrapeResult.data?.markdown) {
            const chunks = this.chunkText(scrapeResult.data.markdown, 2000);
            if (chunks.length > 0) {
              const stored = await this.storeChunks(
                chunks.map(c => ({ content: c, metadata: { URL: result.url } }))
              );
              logger.debug(`Stored ${stored} chunks from ${result.url}`);
              await onLog?.('thinking', `💾 Stored ${stored} knowledge chunks from ${getDomain(result.url)}`);
            }
          }

          await new Promise(resolve => setTimeout(resolve, 1000));
        } catch (scrapeError) {
          logger.warn(`Failed to scrape ${result.url}:`, { error: scrapeError instanceof Error ? scrapeError.message : 'Unknown' });
          await onLog?.('warn', `⚠️ Failed to scrape ${getDomain(result.url)}`);
        }
      }

      // Retry search after batch 2
      await onLog?.('thinking', `🔄 Retrying knowledge base search (batch 2)...`);
      const retryAnswer2 = await this.findAnswer(question);
      if (retryAnswer2) {
        await onLog?.('info', `✅ Found answer after batch 2 (similarity: ${Math.round(retryAnswer2.similarity * 100)}%)`);
        return retryAnswer2;
      }

      // Phase 3: No answer found
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
