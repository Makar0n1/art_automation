/**
 * Core type definitions for SEO Articles Generation Service
 * @module types
 */

import { Document, Types } from 'mongoose';

/**
 * Generation status enum
 * Tracks the lifecycle of an article generation
 */
export enum GenerationStatus {
  QUEUED = 'queued',
  PROCESSING = 'processing',
  PARSING_SERP = 'parsing_serp',
  ANALYZING_STRUCTURE = 'analyzing_structure',
  GENERATING_BLOCKS = 'generating_blocks',
  ENRICHING_BLOCKS = 'enriching_blocks',
  ANSWERING_QUESTIONS = 'answering_questions', // Finding answers in Supabase
  WRITING_ARTICLE = 'writing_article',
  INSERTING_LINKS = 'inserting_links', // Inserting internal links
  REVIEWING_ARTICLE = 'reviewing_article', // Final article review and polish
  COMPLETED = 'completed',
  FAILED = 'failed',
  // Paused states for continuation
  PAUSED_AFTER_SERP = 'paused_after_serp',
  PAUSED_AFTER_STRUCTURE = 'paused_after_structure',
  PAUSED_AFTER_BLOCKS = 'paused_after_blocks',
  PAUSED_AFTER_ANSWERS = 'paused_after_answers', // New pause state
  PAUSED_AFTER_WRITING = 'paused_after_writing', // After article writing, before links
  PAUSED_AFTER_REVIEW = 'paused_after_review', // After article review, before completion
}

/**
 * Article type enum
 * Different types of SEO articles that can be generated
 */
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

/**
 * Link display type enum
 * How internal links should be displayed in the article
 */
export enum LinkDisplayType {
  INLINE = 'inline',
  LIST_END = 'list_end',
  LIST_START = 'list_start',
  SIDEBAR = 'sidebar',
}

/**
 * Link position in article
 */
export enum LinkPosition {
  INTRO = 'intro',
  BODY = 'body',
  CONCLUSION = 'conclusion',
  ANY = 'any',
}

/**
 * Internal link configuration
 */
export interface InternalLink {
  anchor?: string;
  url: string;
  isAnchorless: boolean;
  displayType: LinkDisplayType;
  position: LinkPosition;
}

/**
 * API Keys configuration stored per user
 */
export interface ApiKeysConfig {
  openRouter?: {
    apiKey: string;
    isValid: boolean;
    lastChecked?: Date;
  };
  supabase?: {
    url: string;
    secretKey: string;
    isValid: boolean;
    lastChecked?: Date;
  };
  firecrawl?: {
    apiKey: string;
    isValid: boolean;
    lastChecked?: Date;
  };
}

/**
 * User document interface
 */
export interface IUser extends Document {
  _id: Types.ObjectId;
  email: string;
  password: string;
  pin?: string; // Hashed PIN for API keys changes
  apiKeys: ApiKeysConfig;
  createdAt: Date;
  updatedAt: Date;
  comparePassword(candidatePassword: string): Promise<boolean>;
  comparePin(candidatePin: string): Promise<boolean>;
}

/**
 * Project document interface
 */
export interface IProject extends Document {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  name: string;
  description?: string;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Generation configuration from form
 */
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

/**
 * Article block type
 */
export type ArticleBlockType = 'h1' | 'intro' | 'h2' | 'h3' | 'conclusion' | 'faq';

/**
 * Answered question with source from Supabase
 */
export interface AnsweredQuestion {
  question: string;
  answer: string;
  source?: string;
  similarity: number;
}

/**
 * Article block structure for generation
 */
export interface ArticleBlock {
  id: number;
  type: ArticleBlockType;
  heading: string;
  instruction: string;
  lsi: string[];
  questions?: string[];
  answeredQuestions?: AnsweredQuestion[]; // Questions with answers from Supabase
  content?: string; // Generated content for this block
}

/**
 * Structure analysis result from AI
 */
export interface StructureAnalysis {
  averageWordCount: number;
  commonPatterns: string[];
  strengths: string[];
  weaknesses: string[];
  recommendedStructure: ArticleBlock[];
}

/**
 * Parsed SERP result
 */
export interface SerpResult {
  url: string;
  title: string;
  position: number;
  content?: string;
  headings?: string[];
  wordCount?: number;
  parsedAt?: Date;
  error?: string;
}

/**
 * Generation document interface
 */
export interface IGeneration extends Document {
  _id: Types.ObjectId;
  projectId: Types.ObjectId;
  userId: Types.ObjectId;
  config: GenerationConfig;
  status: GenerationStatus;
  progress: number;
  currentStep: string;
  logs: GenerationLog[];
  serpResults: SerpResult[];
  // Structure analysis results
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
  startedAt?: Date;
  completedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Generation log entry
 */
export interface GenerationLog {
  timestamp: Date;
  level: 'info' | 'warn' | 'error' | 'debug' | 'thinking';
  message: string;
  data?: Record<string, unknown>;
}

/**
 * JWT Payload
 */
export interface JwtPayload {
  userId: string;
  email: string;
  iat?: number;
  exp?: number;
}

/**
 * Express Request with user
 */
import { Request } from 'express';

export interface AuthenticatedRequest extends Request {
  user?: JwtPayload;
}

/**
 * Socket.IO event types
 */
export interface ServerToClientEvents {
  'generation:log': (data: { generationId: string; log: GenerationLog }) => void;
  'generation:status': (data: { generationId: string; status: GenerationStatus; progress: number }) => void;
  'generation:completed': (data: { generationId: string; article: string }) => void;
  'generation:error': (data: { generationId: string; error: string }) => void;
}

export interface ClientToServerEvents {
  'generation:subscribe': (generationId: string) => void;
  'generation:unsubscribe': (generationId: string) => void;
}

/**
 * API Response wrapper
 */
export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
  // PIN rate limiting fields
  isBlocked?: boolean;
  attemptsRemaining?: number;
}
