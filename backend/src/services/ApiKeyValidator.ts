/**
 * API Key Validator Service
 * Validates external service API keys
 * @module services/ApiKeyValidator
 */

import axios from 'axios';
import { FirecrawlService } from './FirecrawlService.js';
import { logger } from '../utils/logger.js';

/**
 * Validation result interface
 */
interface ValidationResult {
  isValid: boolean;
  error?: string;
  message?: string;
}

/**
 * API Key Validator Class
 * Handles validation of all external service credentials
 */
export class ApiKeyValidator {
  /**
   * Validate OpenRouter API key
   * Tests by fetching available models
   */
  static async validateOpenRouter(apiKey: string): Promise<ValidationResult> {
    try {
      const response = await axios.get('https://openrouter.ai/api/v1/models', {
        headers: {
          'Authorization': `Bearer ${apiKey}`,
        },
        timeout: 10000,
      });

      if (response.status === 200 && response.data?.data) {
        return {
          isValid: true,
          message: `Connected! ${response.data.data.length} models available.`,
        };
      }

      return { isValid: false, error: 'Invalid response from OpenRouter' };
    } catch (error) {
      if (axios.isAxiosError(error)) {
        if (error.response?.status === 401) {
          return { isValid: false, error: 'Invalid API key' };
        }
        if (error.response?.status === 403) {
          return { isValid: false, error: 'Access forbidden. Check your API key permissions.' };
        }
        return { isValid: false, error: `Connection error: ${error.message}` };
      }
      logger.error('OpenRouter validation error', { error });
      return { isValid: false, error: 'Validation failed' };
    }
  }

  /**
   * Validate Supabase credentials
   * Tests by fetching project info
   */
  static async validateSupabase(url: string, secretKey: string): Promise<ValidationResult> {
    try {
      // Normalize URL
      const baseUrl = url.endsWith('/') ? url.slice(0, -1) : url;

      // Try to access the health check or a simple API endpoint
      const response = await axios.get(`${baseUrl}/rest/v1/`, {
        headers: {
          'apikey': secretKey,
          'Authorization': `Bearer ${secretKey}`,
        },
        timeout: 10000,
      });

      if (response.status === 200) {
        return {
          isValid: true,
          message: 'Connected to Supabase successfully!',
        };
      }

      return { isValid: false, error: 'Invalid response from Supabase' };
    } catch (error) {
      if (axios.isAxiosError(error)) {
        // 404 is actually OK for Supabase - means connection works but no tables
        if (error.response?.status === 200 || error.response?.status === 404) {
          return {
            isValid: true,
            message: 'Connected to Supabase successfully!',
          };
        }
        if (error.response?.status === 401) {
          return { isValid: false, error: 'Invalid secret key' };
        }
        if (error.response?.status === 403) {
          return { isValid: false, error: 'Access forbidden. Check your secret key.' };
        }
        if (error.code === 'ENOTFOUND') {
          return { isValid: false, error: 'Invalid Supabase URL' };
        }
        return { isValid: false, error: `Connection error: ${error.message}` };
      }
      logger.error('Supabase validation error', { error });
      return { isValid: false, error: 'Validation failed' };
    }
  }

  /**
   * Validate Firecrawl API key
   * Uses FirecrawlService for validation
   */
  static async validateFirecrawl(apiKey: string): Promise<ValidationResult> {
    try {
      const firecrawl = new FirecrawlService(apiKey);
      const result = await firecrawl.validateApiKey();

      if (result.isValid) {
        return {
          isValid: true,
          message: 'Firecrawl API key is valid!',
        };
      }

      return { isValid: false, error: result.error || 'Invalid API key' };
    } catch (error) {
      logger.error('Firecrawl validation error', { error });
      return { isValid: false, error: 'Validation failed' };
    }
  }
}
