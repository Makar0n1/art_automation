/**
 * Google Knowledge Graph Search API Service
 * Fetches entity data to auto-generate LSI keywords for article generation
 * @module services/KnowledgeGraphService
 */

import axios from 'axios';
import { logger } from '../utils/logger.js';
import { EnrichedEntity } from '../types/index.js';

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

    // Types that indicate entertainment/geography noise — not useful as LSI for articles
    const BLOCKED_TYPES = new Set([
      'Film', 'Movie', 'TVSeries', 'TVEpisode', 'TVSeason', 'TVClip',
      'MusicRecording', 'MusicAlbum', 'MusicGroup', 'MusicEvent',
      'VideoGame', 'VideoGameSeries',
      'SportsTeam', 'SportsOrganization', 'SportsEvent',
      'City', 'Country', 'State', 'AdministrativeArea', 'Place', 'LandmarksOrHistoricalBuildings',
      'Person',
    ]);

    const items = response.data?.itemListElement || [];
    return items
      .filter((item: Record<string, unknown>) => {
        if (!item.result || !(item.result as Record<string, unknown>).name) return false;
        const result = item.result as Record<string, unknown>;
        const types = (result['@type'] as string[] | undefined) || [];
        // Block if ALL non-Thing types are in the blocked list
        const meaningfulTypes = types.filter((t: string) => t !== 'Thing');
        if (meaningfulTypes.length > 0 && meaningfulTypes.every((t: string) => BLOCKED_TYPES.has(t))) return false;
        return true;
      })
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
   * Get enriched entity objects for v2 pipeline.
   * Returns full objects with types, descriptions, sourceConfidence, etc.
   * On any error, logs and returns empty array (non-blocking).
   * Emits KG_SPARSE warning if fewer than 5 entities found.
   */
  async getEnrichedEntities(keywords: string[]): Promise<EnrichedEntity[]> {
    if (!keywords.length) return [];

    const seen = new Set<string>();
    const allRaw: Array<{ name: string; types: string[]; description?: string; score: number; canonicalId?: string }> = [];

    for (let i = 0; i < keywords.length; i++) {
      const query = keywords[i].trim();
      if (!query) continue;
      const limit = i === 0 ? 30 : 15;
      try {
        const response = await axios.get(KG_API_URL, {
          params: { query, key: this.apiKey, limit },
          timeout: 8000,
        });

        const BLOCKED_TYPES = new Set([
          'Film', 'Movie', 'TVSeries', 'TVEpisode', 'TVSeason', 'TVClip',
          'MusicRecording', 'MusicAlbum', 'MusicGroup', 'MusicEvent',
          'VideoGame', 'VideoGameSeries',
          'SportsTeam', 'SportsOrganization', 'SportsEvent',
          'City', 'Country', 'State', 'AdministrativeArea', 'Place', 'LandmarksOrHistoricalBuildings',
          'Person',
        ]);

        const items = response.data?.itemListElement || [];
        for (const item of items as Record<string, unknown>[]) {
          if (!item.result) continue;
          const result = item.result as Record<string, unknown>;
          if (!result.name) continue;
          const types = (result['@type'] as string[] | undefined) || [];
          const meaningfulTypes = types.filter((t: string) => t !== 'Thing');
          if (meaningfulTypes.length > 0 && meaningfulTypes.every((t: string) => BLOCKED_TYPES.has(t))) continue;

          const name = result.name as string;
          const key = name.toLowerCase();
          if (seen.has(key)) continue;
          seen.add(key);

          allRaw.push({
            name,
            types: meaningfulTypes,
            description: (result.description as string | undefined) || undefined,
            score: (item.resultScore as number) || 0,
            canonicalId: (result['@id'] as string | undefined) || undefined,
          });
        }
      } catch (error) {
        logger.warn(`KG enriched entity fetch failed for keyword '${query}'`, {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    // Compute salience = score / maxScore
    const maxScore = allRaw.reduce((m, e) => Math.max(m, e.score), 0) || 1;

    const entities: EnrichedEntity[] = allRaw
      .sort((a, b) => b.score - a.score)
      .map(e => ({
        name: e.name,
        types: e.types,
        description: e.description,
        score: e.score,
        source: 'google_kg' as const,
        sourceConfidence: 0.9,
        confirmedBy: ['google_kg' as const],
        canonicalId: e.canonicalId,
        salience: e.score / maxScore,
      }));

    if (entities.length < 5) {
      logger.warn('KG_SPARSE: fewer than 5 entities found — SERP-derived weight should be elevated', {
        found: entities.length,
        keywords,
      });
    }

    return entities;
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

    // Query each keyword as-is (no word splitting — compound phrases are more precise)
    // First keyword = main keyword (more results), rest = additional keywords
    for (let i = 0; i < keywords.length; i++) {
      const query = keywords[i].trim();
      if (!query) continue;
      const limit = i === 0 ? 15 : 8;
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
