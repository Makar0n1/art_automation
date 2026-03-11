/**
 * Google Knowledge Graph Search API Service
 * Fetches entity data to auto-generate LSI keywords for article generation
 * @module services/KnowledgeGraphService
 */

import axios from 'axios';
import { logger } from '../utils/logger.js';

const KG_API_URL = 'https://kgsearch.googleapis.com/v1/entities:search';

export interface KnowledgeGraphEntity {
  name: string;
  types: string[];
  description?: string;
  score: number;
}

export class KnowledgeGraphService {
  private apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  /**
   * Fetch Knowledge Graph entities for a single keyword
   */
  private async fetchEntitiesForKeyword(
    keyword: string,
    limit = 10
  ): Promise<KnowledgeGraphEntity[]> {
    const response = await axios.get(KG_API_URL, {
      params: {
        query: keyword,
        key: this.apiKey,
        limit,
      },
      timeout: 8000,
    });

    const items = response.data?.itemListElement || [];
    return items
      .filter((item: Record<string, unknown>) => item.result && (item.result as Record<string, unknown>).name)
      .map((item: Record<string, unknown>) => {
        const result = item.result as Record<string, unknown>;
        const types = (result['@type'] as string[] | undefined) || [];
        return {
          name: result.name as string,
          types: types.filter((t: string) => t !== 'Thing'),
          description: (result.description as string | undefined) || undefined,
          score: (item.resultScore as number) || 0,
        };
      });
  }

  /**
   * Get LSI entity names for given keywords.
   * Queries KG for each keyword, deduplicates by name, sorts by score descending.
   * Returns entity names suitable for use as LSI keywords.
   * On any error, returns empty array (non-blocking).
   */
  async getLsiEntities(keywords: string[]): Promise<string[]> {
    if (!keywords.length) return [];

    const seen = new Set<string>();
    const allEntities: KnowledgeGraphEntity[] = [];

    // Expand compound keywords into individual words for better KG coverage
    // e.g. 'ghostwriter bachelorarbeit' → ['ghostwriter bachelorarbeit', 'ghostwriter', 'bachelorarbeit']
    const expandedKeywords: Array<{ query: string; isMain: boolean }> = [];
    for (let i = 0; i < keywords.length; i++) {
      const kw = keywords[i];
      expandedKeywords.push({ query: kw, isMain: i === 0 });
      const words = kw.trim().split(/\s+/);
      if (words.length > 1) {
        for (const word of words) {
          if (word.length > 3) {
            expandedKeywords.push({ query: word, isMain: false });
          }
        }
      }
    }

    // Deduplicate queries
    const seenQueries = new Set<string>();
    const uniqueQueries = expandedKeywords.filter(({ query }) => {
      const key = query.toLowerCase();
      if (seenQueries.has(key)) return false;
      seenQueries.add(key);
      return true;
    });

    for (const { query, isMain } of uniqueQueries) {
      const limit = isMain ? 15 : 8;
      try {
        const entities = await this.fetchEntitiesForKeyword(query, limit);
        for (const entity of entities) {
          const key = entity.name.toLowerCase();
          if (!seen.has(key)) {
            seen.add(key);
            allEntities.push(entity);
          }
        }
      } catch (error) {
        logger.warn(`KG entity fetch failed for keyword '${query}'`, {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return allEntities
      .sort((a, b) => b.score - a.score)
      .map(e => e.name);
  }

  /**
   * Validate the API key by making a minimal test request.
   */
  static async validateApiKey(apiKey: string): Promise<{ isValid: boolean; error?: string; message?: string }> {
    try {
      const response = await axios.get(KG_API_URL, {
        params: {
          query: 'test',
          key: apiKey,
          limit: 1,
        },
        timeout: 8000,
      });

      if (response.status === 200) {
        const count = response.data?.itemListElement?.length ?? 0;
        return {
          isValid: true,
          message: `Google Knowledge Graph API connected! Test query returned ${count} result${count !== 1 ? 's' : ''}.`,
        };
      }

      return { isValid: false, error: 'Unexpected response from Google Knowledge Graph API' };
    } catch (error) {
      if (axios.isAxiosError(error)) {
        if (error.response?.status === 400) {
          return { isValid: false, error: 'Invalid API key or request' };
        }
        if (error.response?.status === 403) {
          const reason = (error.response.data as Record<string, unknown>)?.error;
          const msg = reason && typeof reason === 'object'
            ? ((reason as Record<string, unknown>).message as string) || 'Access denied'
            : 'Access denied. Ensure Knowledge Graph Search API is enabled in Google Cloud Console.';
          return { isValid: false, error: msg };
        }
        return { isValid: false, error: `Connection error: ${error.message}` };
      }
      logger.error('Google KG validation error', { error });
      return { isValid: false, error: 'Validation failed' };
    }
  }
}
