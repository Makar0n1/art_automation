/**
 * Frontend Type Definitions
 * Mirrors backend types for type safety
 */

export enum GenerationStatus {
  QUEUED = 'queued',
  PROCESSING = 'processing',
  PARSING_SERP = 'parsing_serp',
  ANALYZING_STRUCTURE = 'analyzing_structure',
  GENERATING_BLOCKS = 'generating_blocks',
  ENRICHING_BLOCKS = 'enriching_blocks',
  ANSWERING_QUESTIONS = 'answering_questions',
  WRITING_ARTICLE = 'writing_article',
  INSERTING_LINKS = 'inserting_links',
  REVIEWING_ARTICLE = 'reviewing_article',
  COMPLETED = 'completed',
  FAILED = 'failed',
  // Paused states for continuation
  PAUSED_AFTER_SERP = 'paused_after_serp',
  PAUSED_AFTER_STRUCTURE = 'paused_after_structure',
  PAUSED_AFTER_BLOCKS = 'paused_after_blocks',
  PAUSED_AFTER_ANSWERS = 'paused_after_answers',
  PAUSED_AFTER_WRITING = 'paused_after_writing',
  PAUSED_AFTER_REVIEW = 'paused_after_review',
}

export enum ArticleType {
  INFORMATIONAL = 'informational',
  COMMERCIAL = 'commercial',
  TRANSACTIONAL = 'transactional',
  NAVIGATIONAL = 'navigational',
  REVIEW = 'review',
  COMPARISON = 'comparison',
  HOWTO = 'howto',
  LISTICLE = 'listicle',
}

export enum LinkDisplayType {
  INLINE = 'inline',
  LIST_END = 'list_end',
  LIST_START = 'list_start',
  SIDEBAR = 'sidebar',
}

export enum LinkPosition {
  INTRO = 'intro',
  BODY = 'body',
  CONCLUSION = 'conclusion',
  ANY = 'any',
}

export interface InternalLink {
  anchor?: string;
  url: string;
  isAnchorless: boolean;
  displayType: LinkDisplayType;
  position: LinkPosition;
}

export interface ApiKeyStatus {
  isConfigured: boolean;
  isValid: boolean;
  lastChecked?: string;
  maskedKey?: string; // e.g., "sk-1234****5678"
}

export interface MaskedApiKeys {
  openRouter: {
    isConfigured: boolean;
    isValid: boolean;
    lastChecked?: string;
    maskedKey?: string;
  };
  supabase: {
    isConfigured: boolean;
    isValid: boolean;
    lastChecked?: string;
    url?: string; // URL is not masked
    maskedKey?: string; // Service Role Key masked
  };
  firecrawl: {
    isConfigured: boolean;
    isValid: boolean;
    lastChecked?: string;
    maskedKey?: string;
  };
}

export interface User {
  id: string;
  email: string;
  apiKeys: {
    openRouter: ApiKeyStatus;
    supabase: ApiKeyStatus;
    firecrawl: ApiKeyStatus;
  };
  createdAt: string;
}

export interface Project {
  _id: string;
  userId: string;
  name: string;
  description?: string;
  generationsCount?: number;
  createdAt: string;
  updatedAt: string;
}

export interface GenerationConfig {
  mainKeyword: string;
  articleType: ArticleType;
  keywords: string[];
  language: string;
  region: string;
  lsiKeywords: string[];
  comment?: string;
  internalLinks: InternalLink[];
  linksAsList: boolean;
  linksListPosition?: LinkPosition;
  continuousMode?: boolean; // If true, skip all pauses and run full pipeline
}

export interface GenerationLog {
  timestamp: string;
  level: 'info' | 'warn' | 'error' | 'debug' | 'thinking';
  message: string;
  data?: Record<string, unknown>;
}

export interface SerpResult {
  url: string;
  title: string;
  position: number;
  content?: string;
  headings?: string[];
  wordCount?: number;
  parsedAt?: string;
  error?: string;
}

export type ArticleBlockType = 'h1' | 'intro' | 'h2' | 'h3' | 'conclusion' | 'faq';

export interface AnsweredQuestion {
  question: string;
  answer: string;
  source?: string;
  similarity: number;
}

export interface ArticleBlock {
  id: number;
  type: ArticleBlockType;
  heading: string;
  instruction: string;
  lsi: string[];
  questions?: string[];
  answeredQuestions?: AnsweredQuestion[];
  content?: string;
}

export interface StructureAnalysis {
  averageWordCount: number;
  commonPatterns: string[];
  strengths: string[];
  weaknesses: string[];
  recommendedStructure: ArticleBlock[];
}

export interface Generation {
  _id: string;
  projectId: string | { _id: string; name: string };
  userId: string;
  config: GenerationConfig;
  status: GenerationStatus;
  progress: number;
  currentStep?: string;
  logs: GenerationLog[];
  serpResults: SerpResult[];
  // Structure analysis
  structureAnalysis?: StructureAnalysis;
  articleBlocks?: ArticleBlock[];
  averageWordCount?: number;
  // Final output
  generatedArticle?: string;
  article?: string; // Full article in markdown format
  seoTitle?: string; // SEO optimized title (max 60 chars)
  seoDescription?: string; // SEO meta description (max 160 chars)
  error?: string;
  queuePosition?: number;
  startedAt?: string;
  completedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}

export interface QueueStats {
  waiting: number;
  active: number;
  completed: number;
  failed: number;
}
