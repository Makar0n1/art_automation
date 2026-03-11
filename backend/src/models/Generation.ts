/**
 * Generation Model
 * Stores article generation tasks with configuration and results
 * @module models/Generation
 */

import mongoose, { Schema } from 'mongoose';
import {
  IGeneration,
  GenerationStatus,
  ArticleType,
  LinkDisplayType,
  LinkPosition,
} from '../types/index.js';

// ─── v2 Sub-schemas ───────────────────────────────────────────────────────────

const EnrichedEntitySchema = new Schema({
  name: { type: String, required: true },
  types: [{ type: String }],
  description: { type: String },
  score: { type: Number, default: 0 },
  source: { type: String, enum: ['google_kg', 'serp_derived'], default: 'google_kg' },
  sourceConfidence: { type: Number, default: 0.9 },
  confirmedBy: [{ type: String }],
  aliases: [{ type: String }],
  canonicalId: { type: String },
  salience: { type: Number },
  priority: { type: String, enum: ['critical', 'supporting', 'optional'] },
}, { _id: false });

const EntityClusterSchema = new Schema({
  id: { type: Number, required: true },
  label: { type: String, required: true },
  entities: [EnrichedEntitySchema],
  coherenceScore: { type: Number, default: 0 },
  centroidEntityName: { type: String, default: '' },
  dominantTypes: [{ type: String }],
}, { _id: false });

const IntentMapSchema = new Schema({
  pageType: { type: String, default: '' },
  primaryIntent: { type: String, default: '' },
  hiddenIntents: [{ type: String }],
  mustAnswerQuestions: [{ type: String }],
  plannedCoverage: [{ type: String }],
  funnelStage: { type: String, enum: ['awareness', 'consideration', 'decision'], default: 'consideration' },
  heuristicConfidence: { type: String, enum: ['high', 'medium', 'low'], default: 'medium' },
}, { _id: false });

const EntityCoverageSchema = new Schema({
  entityName: { type: String, required: true },
  mentioned: { type: Boolean, default: false },
  coverageLevel: { type: String, enum: ['exact', 'alias', 'not_found'], default: 'not_found' },
  priority: { type: String, enum: ['critical', 'supporting', 'optional'], default: 'optional' },
  stage: { type: String, enum: ['pre_review', 'post_review'], required: true },
}, { _id: false });

/**
 * Internal Link sub-schema
 * Configuration for each link to be inserted into the article
 */
const InternalLinkSchema = new Schema({
  anchor: { type: String, default: '' },
  url: { type: String, required: true },
  isAnchorless: { type: Boolean, default: false },
  displayType: {
    type: String,
    enum: Object.values(LinkDisplayType),
    default: LinkDisplayType.INLINE,
  },
  position: {
    type: String,
    enum: Object.values(LinkPosition),
    default: LinkPosition.BODY,
  },
}, { _id: false });

/**
 * Generation Configuration sub-schema
 * All settings provided by user for article generation
 */
const GenerationConfigSchema = new Schema({
  mainKeyword: {
    type: String,
    required: [true, 'Main keyword is required'],
    trim: true,
  },
  articleType: {
    type: String,
    enum: Object.values(ArticleType),
    default: ArticleType.INFORMATIONAL,
  },
  keywords: [{ type: String, trim: true }],
  language: {
    type: String,
    default: 'en',
    trim: true,
  },
  region: {
    type: String,
    default: 'us',
    trim: true,
  },
  lsiKeywords: [{ type: String, trim: true }],
  comment: { type: String, trim: true },
  internalLinks: [InternalLinkSchema],
  linksAsList: { type: Boolean, default: false },
  linksListPosition: {
    type: String,
    enum: Object.values(LinkPosition),
  },
  minWords: { type: Number, default: 1200 },
  maxWords: { type: Number, default: 1800 },
  model: { type: String, default: 'openai/gpt-5.2', trim: true },
  mode: { type: String, enum: ['v1', 'v2'], default: 'v1' },
  // v2-only content directives
  audience: { type: String, trim: true },
  mustCover: [{ type: String, trim: true }],
  mustAvoid: [{ type: String, trim: true }],
}, { _id: false });

/**
 * SERP Result sub-schema
 * Parsed content from search engine results
 */
const SerpResultSchema = new Schema({
  url: { type: String, required: true },
  title: { type: String, default: '' },
  position: { type: Number, required: true },
  content: { type: String, default: '' },
  headings: [{ type: String }],
  wordCount: { type: Number, default: 0 },
  parsedAt: { type: Date },
  error: { type: String },
}, { _id: false });

/**
 * Generation Log sub-schema
 * Real-time logs for tracking generation progress
 */
const GenerationLogSchema = new Schema({
  timestamp: { type: Date, default: Date.now },
  level: {
    type: String,
    enum: ['info', 'warn', 'error', 'debug', 'thinking'],
    default: 'info',
  },
  message: { type: String, required: true },
  data: { type: Schema.Types.Mixed },
}, { _id: false });

/**
 * Answered Question sub-schema
 * Questions with answers found in Supabase vector database
 */
const AnsweredQuestionSchema = new Schema({
  question: { type: String, required: true },
  answer: { type: String, required: true },
  source: { type: String },
  similarity: { type: Number, default: 0 },
}, { _id: false });

/**
 * Article Block sub-schema
 * Individual content blocks for chunked article generation
 */
const ArticleBlockSchema = new Schema({
  id: { type: Number, required: true },
  type: {
    type: String,
    enum: ['h1', 'intro', 'h2', 'h3', 'conclusion', 'faq'],
    required: true,
  },
  heading: { type: String, required: true },
  instruction: { type: String, default: '' },
  lsi: [{ type: String }],
  questions: [{ type: String }],
  answeredQuestions: [AnsweredQuestionSchema], // Questions with answers from Supabase
  content: { type: String }, // Generated content for this block
  contentHistory: [{ type: String }], // Version history: max 2 entries [original, previous]
  // v2 fields
  primaryClusterIndex: { type: Number, default: null },
  secondaryClusterIndex: { type: Number, default: null },
  targetOutcome: { type: String },
  evidenceDefault: { type: String },
}, { _id: false });

/**
 * Structure Analysis sub-schema
 * AI analysis of competitor structures
 */
const StructureAnalysisSchema = new Schema({
  averageWordCount: { type: Number, default: 0 },
  commonPatterns: [{ type: String }],
  strengths: [{ type: String }],
  weaknesses: [{ type: String }],
  recommendedStructure: [ArticleBlockSchema],
}, { _id: false });

/**
 * Generation Schema
 * Main schema for article generation tasks
 */
const GenerationSchema = new Schema<IGeneration>(
  {
    projectId: {
      type: Schema.Types.ObjectId,
      ref: 'Project',
      required: [true, 'Project ID is required'],
      index: true,
    },
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'User ID is required'],
      index: true,
    },
    config: {
      type: GenerationConfigSchema,
      required: [true, 'Generation config is required'],
    },
    status: {
      type: String,
      enum: Object.values(GenerationStatus),
      default: GenerationStatus.QUEUED,
      index: true,
    },
    progress: {
      type: Number,
      default: 0,
      min: 0,
      max: 100,
    },
    currentStep: {
      type: String,
      default: 'queued',
    },
    logs: {
      type: [GenerationLogSchema],
      default: [],
    },
    serpResults: {
      type: [SerpResultSchema],
      default: [],
    },
    // Structure analysis from AI
    structureAnalysis: {
      type: StructureAnalysisSchema,
    },
    // Knowledge Graph LSI entities (step 1.5)
    kgEntities: {
      type: [String],
      default: [],
    },
    // v2: Article Generation 2.0 fields
    entityClusters: {
      type: [EntityClusterSchema],
      default: [],
    },
    intentMap: {
      type: IntentMapSchema,
    },
    preReviewEntityCoverage: {
      type: [EntityCoverageSchema],
      default: [],
    },
    entityCoverage: {
      type: [EntityCoverageSchema],
      default: [],
    },
    qualityScores: {
      type: new Schema({
        entityCoveragePercent: { type: Number, default: 0 },
        criticalEntitiesMissed: { type: Number, default: 0 },
        intentPlannedPercent: { type: Number, default: 0 },
        intentRealizedPercent: { type: Number, default: 0 },
        unsupportedHardClaims: { type: Number, default: 0 },
      }, { _id: false }),
    },
    // Article blocks for chunked generation
    articleBlocks: {
      type: [ArticleBlockSchema],
      default: [],
    },
    averageWordCount: {
      type: Number,
      default: 0,
    },
    generatedArticle: { type: String },
    article: { type: String }, // Full article in markdown format
    seoTitle: { type: String }, // SEO optimized title (max 60 chars)
    seoDescription: { type: String }, // SEO meta description (max 160 chars)
    seoTitleHistory: [{ type: String }],
    seoDescriptionHistory: [{ type: String }],
    // Cost analytics
    tokenUsage: {
      type: new Schema({
        promptTokens: { type: Number, default: 0 },
        completionTokens: { type: Number, default: 0 },
        totalTokens: { type: Number, default: 0 },
      }, { _id: false }),
    },
    modelPricing: {
      type: new Schema({
        prompt: { type: String },
        completion: { type: String },
      }, { _id: false }),
    },
    firecrawlCredits: { type: Number },
    error: { type: String },
    queuePosition: { type: Number },
    startedAt: { type: Date },
    completedAt: { type: Date },
  },
  {
    timestamps: true,
    toJSON: {
      transform: (_doc, ret: Record<string, unknown>) => {
        ret.__v = undefined;
        return ret;
      },
    },
  }
);

/**
 * Indexes for efficient querying
 */
GenerationSchema.index({ projectId: 1, createdAt: -1 });
GenerationSchema.index({ userId: 1, status: 1 });
GenerationSchema.index({ status: 1, createdAt: 1 }); // For queue processing

/**
 * Pre-save hook to update timestamps
 */
GenerationSchema.pre('save', function (next) {
  if (this.isModified('status')) {
    if (this.status === GenerationStatus.PROCESSING) {
      this.startedAt = new Date();
    } else if (
      this.status === GenerationStatus.COMPLETED ||
      this.status === GenerationStatus.FAILED
    ) {
      this.completedAt = new Date();
    }
  }
  next();
});

export const Generation = mongoose.model<IGeneration>('Generation', GenerationSchema);
