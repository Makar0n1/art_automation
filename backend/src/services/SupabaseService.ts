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
