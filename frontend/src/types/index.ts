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
  google: {
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
  mode?: 'v1' | 'v2';
  comment?: string;
  internalLinks: InternalLink[];
  linksAsList: boolean;
  linksListPosition?: LinkPosition;
  minWords?: number;
  maxWords?: number;
  model?: string;
  // v2-only content directives
  audience?: string;
  mustCover?: string[];
  mustAvoid?: string[];
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
  contentHistory?: string[];
  // v2 fields
  primaryClusterIndex?: number | null;
  secondaryClusterIndex?: number | null;
  targetOutcome?: string;
  evidenceDefault?: string;
}

// ─── Article Generation 2.0 Types ────────────────────────────────────────────

export interface EnrichedEntity {
  name: string;
  types: string[];
  description?: string;
  score: number;
  source: 'google_kg' | 'serp_derived';
  sourceConfidence: number;
  confirmedBy: Array<'google_kg' | 'serp_derived'>;
  aliases?: string[];
  canonicalId?: string;
  salience?: number;
  priority?: 'critical' | 'supporting' | 'optional';
}

export interface EntityCluster {
  id: number;
  label: string;
  entities: EnrichedEntity[];
  coherenceScore: number;
  centroidEntityName: string;
  dominantTypes: string[];
}

export interface IntentMap {
  pageType: string;
  primaryIntent: string;
  hiddenIntents: string[];
  mustAnswerQuestions: string[];
  plannedCoverage: string[];
  funnelStage: 'awareness' | 'consideration' | 'decision';
  heuristicConfidence: 'high' | 'medium' | 'low';
}

export interface EntityCoverage {
  entityName: string;
  mentioned: boolean;
  coverageLevel: 'exact' | 'alias' | 'not_found';
  priority: 'critical' | 'supporting' | 'optional';
  stage: 'pre_review' | 'post_review';
}

export interface GenerationQualityScores {
  entityCoveragePercent: number;
  criticalEntitiesMissed: number;
  intentPlannedPercent: number;
  intentRealizedPercent: number;
  unsupportedHardClaims: number;
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
  // Knowledge Graph LSI entities (step 1.5)
  kgEntities?: string[];
  // v2: Article Generation 2.0 fields
  entityClusters?: EntityCluster[];
  intentMap?: IntentMap;
  preReviewEntityCoverage?: EntityCoverage[];
  entityCoverage?: EntityCoverage[];
  qualityScores?: GenerationQualityScores;
  // Structure analysis
  structureAnalysis?: StructureAnalysis;
  articleBlocks?: ArticleBlock[];
  averageWordCount?: number;
  // Final output
  generatedArticle?: string;
  article?: string; // Full article in markdown format
  seoTitle?: string; // SEO optimized title (max 60 chars)
  seoDescription?: string; // SEO meta description (max 160 chars)
  seoTitleHistory?: string[];
  seoDescriptionHistory?: string[];
  // Cost analytics
  tokenUsage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  modelPricing?: {
    prompt: string;
    completion: string;
  };
  firecrawlCredits?: number;
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

export interface OpenRouterModel {
  id: string;
  name: string;
  description: string;
  pricing?: {
    prompt: string;
    completion: string;
  };
  contextLength?: number;
  maxCompletionTokens?: number;
}
