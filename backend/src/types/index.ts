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
  ANSWERING_QUESTIONS = 'answering_questions',
  WRITING_ARTICLE = 'writing_article',
  INSERTING_LINKS = 'inserting_links',
  REVIEWING_ARTICLE = 'reviewing_article',
  COMPLETED = 'completed',
  FAILED = 'failed',
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
  google?: {
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
  minWords?: number;  // default 1200
  maxWords?: number;  // default 1800
  model?: string;     // OpenRouter model ID, default 'openai/gpt-5.2'
  audience?: string;       // e.g. "Studierende in Deutschland", max 120 chars
  mustCover?: string[];    // Topics/aspects that must be addressed, max 8 items
  mustAvoid?: string[];    // Claims/phrases to never include, max 8 items
}

// ─── Article Generation 2.0 Types ────────────────────────────────────────────

/**
 * Enriched entity from KG or SERP-derived terms
 * serp_derived = regex candidates from titles/snippets (lower confidence, NOT named entities)
 */
export interface EnrichedEntity {
  name: string;
  types: string[];
  description?: string;
  score: number;
  source: 'google_kg' | 'serp_derived'; // 'internal' deferred to v2.1
  sourceConfidence: number;             // 0-1: google_kg≈0.9, serp_derived≈0.4-0.6
  confirmedBy: Array<'google_kg' | 'serp_derived'>; // both = cross-confirmed
  aliases?: string[];
  canonicalId?: string;   // KG result['@id'] e.g. /m/xxx
  salience?: number;      // score / maxScore in result set, 0-1
  priority?: 'critical' | 'supporting' | 'optional'; // assigned during clustering
}

/**
 * Semantic cluster of related entities
 */
export interface EntityCluster {
  id: number;
  label: string;             // Name of centroid entity
  entities: EnrichedEntity[];
  coherenceScore: number;    // Avg pairwise cosine similarity within cluster
  centroidEntityName: string;
  dominantTypes: string[];   // Most frequent schema.org types in cluster
}

/**
 * Intent map — heuristic baseline refined by AI
 */
export interface IntentMap {
  pageType: string;
  primaryIntent: string;
  hiddenIntents: string[];        // Cost, legality, risks, comparisons, etc.
  mustAnswerQuestions: string[];  // Questions that MUST be answered in the article
  plannedCoverage: string[];      // Block headings assigned to mustAnswerQuestions
  funnelStage: 'awareness' | 'consideration' | 'decision';
  heuristicConfidence: 'high' | 'medium' | 'low';
}

/**
 * Entity coverage check result — computed pre and post review/trim
 */
export interface EntityCoverage {
  entityName: string;
  mentioned: boolean;
  coverageLevel: 'exact' | 'alias' | 'not_found';
  priority: 'critical' | 'supporting' | 'optional';
  stage: 'pre_review' | 'post_review';
}

/**
 * Quality scores computed after generation (v2 only)
 * entityCoveragePercent is a QA metric — NOT the north star goal
 */
export interface GenerationQualityScores {
  entityCoveragePercent: number;    // % of all entities mentioned
  criticalEntitiesMissed: number;   // count of critical-priority entities not found
  intentPlannedPercent: number;     // % of mustAnswerQuestions with assigned block
  intentRealizedPercent: number;    // % of mustAnswerQuestions answered in final text (heuristic)
  unsupportedHardClaims: number;    // numbers/legal/tools without retrieval backing
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
  contentHistory?: string[]; // Version history: max 2 entries [original, previous]
  // v2 fields
  primaryClusterIndex?: number | null;   // Index into generation.entityClusters
  secondaryClusterIndex?: number | null; // Optional secondary cluster
  targetOutcome?: string;                // What the reader learns/understands after this block
  evidenceDefault?: string;             // Rule-based evidence type hint for writing
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
  // Knowledge Graph LSI entities fetched at step 1.5
  kgEntities?: string[];
  // Structure analysis results
  structureAnalysis?: StructureAnalysis;
  articleBlocks?: ArticleBlock[];
  averageWordCount?: number;
  // v2: Article Generation 2.0 fields
  entityClusters?: EntityCluster[];
  intentMap?: IntentMap;
  preReviewEntityCoverage?: EntityCoverage[];  // Coverage snapshot before review/trim
  entityCoverage?: EntityCoverage[];           // Final coverage after review/trim
  qualityScores?: GenerationQualityScores;
  // Final output
  generatedArticle?: string;
  article?: string; // Full article in markdown format
  seoTitle?: string; // SEO optimized title (max 60 chars)
  seoDescription?: string; // SEO meta description (max 160 chars)
  seoTitleHistory?: string[];
  seoDescriptionHistory?: string[];
  // Cost analytics
  tokenUsage?: { promptTokens: number; completionTokens: number; totalTokens: number };
  modelPricing?: { prompt: string; completion: string };
  firecrawlCredits?: number;
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
