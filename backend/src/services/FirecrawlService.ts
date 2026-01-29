/**
 * Firecrawl Service
 * Handles SERP fetching and content parsing using Firecrawl API
 * @module services/FirecrawlService
 */

import axios, { AxiosInstance } from 'axios';
import * as cheerio from 'cheerio';
import { SerpResult } from '../types/index.js';
import { logger } from '../utils/logger.js';

/**
 * Firecrawl API response types
 */
interface FirecrawlSearchResult {
  url: string;
  title: string;
  description?: string;
}

interface FirecrawlScrapeResult {
  success: boolean;
  data?: {
    markdown?: string;
    html?: string;
    metadata?: {
      title?: string;
      description?: string;
    };
  };
  error?: string;
}

/**
 * Firecrawl Service Class
 * Encapsulates all Firecrawl API interactions
 */
export class FirecrawlService {
  private client: AxiosInstance;
  private apiKey: string;
  private baseUrl = 'https://api.firecrawl.dev/v1';

  constructor(apiKey: string) {
    this.apiKey = apiKey;
    this.client = axios.create({
      baseURL: this.baseUrl,
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      timeout: 60000, // 60 second timeout
    });
  }

  /**
   * Validate API key by making a test request
   */
  async validateApiKey(): Promise<{ isValid: boolean; error?: string }> {
    try {
      // Try to scrape a simple page to verify API key
      const response = await this.client.post('/scrape', {
        url: 'https://example.com',
        formats: ['markdown'],
      });

      return { isValid: response.status === 200 };
    } catch (error) {
      if (axios.isAxiosError(error)) {
        if (error.response?.status === 401) {
          return { isValid: false, error: 'Invalid API key' };
        }
        if (error.response?.status === 402) {
          return { isValid: false, error: 'Insufficient credits' };
        }
        return { isValid: false, error: error.message };
      }
      return { isValid: false, error: 'Connection error' };
    }
  }

  /**
   * Search Google and get top results for a keyword
   * Uses Firecrawl's search endpoint
   */
  async searchKeyword(
    keyword: string,
    region: string = 'us',
    language: string = 'en',
    limit: number = 10
  ): Promise<FirecrawlSearchResult[]> {
    try {
      logger.info(`Searching for keyword: "${keyword}" in ${region}/${language}`);

      const response = await this.client.post('/search', {
        query: keyword,
        limit,
        lang: language,
        country: region,
        scrapeOptions: {
          formats: ['markdown'],
        },
      });

      if (!response.data?.data) {
        logger.warn('No search results returned');
        return [];
      }

      // Transform results
      const results: FirecrawlSearchResult[] = response.data.data.map(
        (item: { url: string; title?: string; description?: string }, index: number) => ({
          url: item.url,
          title: item.title || `Result ${index + 1}`,
          description: item.description || '',
        })
      );

      logger.info(`Found ${results.length} search results`);
      return results;
    } catch (error) {
      logger.error('Search failed', { error, keyword });
      throw new Error(`Search failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Scrape content from a URL
   * Returns cleaned HTML and extracted content
   */
  async scrapeUrl(url: string): Promise<FirecrawlScrapeResult> {
    try {
      logger.debug(`Scraping URL: ${url}`);

      const response = await this.client.post('/scrape', {
        url,
        formats: ['markdown', 'html'],
        onlyMainContent: true,
        waitFor: 2000,
      });

      return {
        success: true,
        data: response.data.data,
      };
    } catch (error) {
      logger.error('Scrape failed', { error, url });
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Scrape failed',
      };
    }
  }

  /**
   * Parse HTML content to extract article structure
   * Filters out non-article content
   */
  parseArticleContent(html: string): {
    headings: string[];
    content: string;
    wordCount: number;
  } {
    const $ = cheerio.load(html);

    // Remove unwanted elements
    $('script, style, nav, header, footer, aside, .sidebar, .comments, .advertisement, .ad, .ads, .social-share, .related-posts, form').remove();

    // Extract headings
    const headings: string[] = [];
    $('h1, h2, h3, h4, h5, h6').each((_, el) => {
      const text = $(el).text().trim();
      if (text) {
        const tag = el.tagName.toLowerCase();
        headings.push(`${tag}: ${text}`);
      }
    });

    // Find main content area
    const mainSelectors = [
      'article',
      'main',
      '.content',
      '.post-content',
      '.article-content',
      '.entry-content',
      '#content',
      '.main-content',
    ];

    let content = '';
    for (const selector of mainSelectors) {
      const element = $(selector);
      if (element.length > 0) {
        content = element.text();
        break;
      }
    }

    // Fallback to body if no main content found
    if (!content) {
      content = $('body').text();
    }

    // Clean content
    content = this.cleanContent(content);

    // Count words
    const wordCount = content.split(/\s+/).filter(word => word.length > 0).length;

    return { headings, content, wordCount };
  }

  /**
   * Clean extracted content from encoding artifacts and extra whitespace
   */
  private cleanContent(text: string): string {
    return text
      // Remove multiple whitespaces
      .replace(/\s+/g, ' ')
      // Remove common encoding artifacts
      .replace(/[^\x20-\x7E\xA0-\xFF\u0400-\u04FF\u0100-\u017F]/g, ' ')
      // Remove extra spaces around punctuation
      .replace(/\s+([.,!?;:])/g, '$1')
      // Normalize quotes
      .replace(/[""]/g, '"')
      .replace(/['']/g, "'")
      // Trim
      .trim();
  }

  /**
   * Fetch and parse top-10 SERP results for a keyword
   * Main method for article generation pipeline
   */
  async fetchSerpResults(
    keyword: string,
    region: string = 'us',
    language: string = 'en',
    onProgress?: (result: SerpResult, index: number) => void
  ): Promise<SerpResult[]> {
    const results: SerpResult[] = [];

    // Step 1: Search for keyword
    const searchResults = await this.searchKeyword(keyword, region, language, 10);

    if (searchResults.length === 0) {
      throw new Error('No search results found');
    }

    // Step 2: Scrape and parse each result
    for (let i = 0; i < searchResults.length; i++) {
      const searchResult = searchResults[i];
      const serpResult: SerpResult = {
        url: searchResult.url,
        title: searchResult.title,
        position: i + 1,
        parsedAt: new Date(),
      };

      try {
        const scrapeResult = await this.scrapeUrl(searchResult.url);

        if (scrapeResult.success && scrapeResult.data) {
          // Use HTML for parsing if available, otherwise use markdown
          if (scrapeResult.data.html) {
            const parsed = this.parseArticleContent(scrapeResult.data.html);
            serpResult.headings = parsed.headings;
            serpResult.content = parsed.content;
            serpResult.wordCount = parsed.wordCount;
          } else if (scrapeResult.data.markdown) {
            serpResult.content = this.cleanContent(scrapeResult.data.markdown);
            serpResult.wordCount = serpResult.content.split(/\s+/).length;
          }

          // Update title from metadata if available
          if (scrapeResult.data.metadata?.title) {
            serpResult.title = scrapeResult.data.metadata.title;
          }
        } else {
          serpResult.error = scrapeResult.error;
        }
      } catch (error) {
        serpResult.error = error instanceof Error ? error.message : 'Parse failed';
        logger.warn(`Failed to parse ${searchResult.url}`, { error });
      }

      results.push(serpResult);

      // Emit progress
      if (onProgress) {
        onProgress(serpResult, i);
      }

      // Small delay to avoid rate limiting
      if (i < searchResults.length - 1) {
        await this.delay(500);
      }
    }

    return results;
  }

  /**
   * Utility delay function
   */
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
