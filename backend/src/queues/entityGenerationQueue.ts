/**
 * Entity Generation Queue (Article Generation 2.0)
 * Bull queue implementing the Entity + Intent + Evidence pipeline.
 * @module queues/entityGenerationQueue
 */

import Bull from 'bull';
import { config } from '../utils/config.js';
import { logger } from '../utils/logger.js';
import { Generation, User } from '../models/index.js';
import {
  GenerationStatus,
  GenerationLog,
  ArticleBlock,
  AnsweredQuestion,
  EnrichedEntity,
  EntityCluster,
  EntityCoverage,
  GenerationQualityScores,
} from '../types/index.js';
import { FirecrawlService } from '../services/FirecrawlService.js';
import { OpenRouterService } from '../services/OpenRouterService.js';
import { SupabaseService } from '../services/SupabaseService.js';
import { KnowledgeGraphService } from '../services/KnowledgeGraphService.js';
import { EntityClusteringService } from '../services/EntityClusteringService.js';
import { publishSocketEvent } from '../utils/redis.js';
import { decrypt } from '../services/CryptoService.js';
import { stripLeadingHeading } from '../utils/articleAssembly.js';
import { buildV2InstructionText } from '../utils/v2Instructions.js';

// ─── Shared helpers (same as generationQueue) ────────────────────────────────

let executionMode: 'api' | 'worker' = 'worker';
let ioServer: { to: (room: string) => { emit: (event: string, data: unknown) => void } } | null = null;

export const setEntitySocketServer = (io: typeof ioServer) => {
  ioServer = io;
  executionMode = 'api';
};

export const setEntityWorkerMode = () => {
  executionMode = 'worker';
};

interface GenerationJobData {
  generationId: string;
  userId: string;
}

export const entityGenerationQueue = new Bull<GenerationJobData>('entity-article-generation', {
  redis: {
    host: config.redis.host,
    port: config.redis.port,
    password: config.redis.password,
  },
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 5000 },
    removeOnComplete: 100,
    removeOnFail: 50,
  },
});

const emitToClient = (room: string, event: string, data: unknown) => {
  if (executionMode === 'api' && ioServer) {
    ioServer.to(room).emit(event, data);
  } else {
    publishSocketEvent(room, event, data);
  }
};

const emitLog = (generationId: string, log: GenerationLog) => {
  emitToClient(`generation:${generationId}`, 'generation:log', { generationId, log });
};

const emitStatus = (generationId: string, status: GenerationStatus, progress: number) => {
  emitToClient(`generation:${generationId}`, 'generation:status', { generationId, status, progress });
};

const emitBlocks = (generationId: string, blocks: ArticleBlock[]) => {
  emitToClient(`generation:${generationId}`, 'generation:blocks', { generationId, blocks });
};

const TOTAL_STEPS = 7;
const STEP_SIZE = 100 / TOTAL_STEPS;
const calcProgress = (stepNumber: number, stepProgress: number = 0): number => {
  const base = (stepNumber - 1) * STEP_SIZE;
  return Math.min(Math.round(base + stepProgress * STEP_SIZE), 100);
};

const addLog = async (generationId: string, level: GenerationLog['level'], message: string, data?: Record<string, unknown>) => {
  const log: GenerationLog = { timestamp: new Date(), level, message, data };
  await Generation.findByIdAndUpdate(generationId, { $push: { logs: log } });
  emitLog(generationId, log);
  logger.log(level === 'thinking' ? 'debug' : level, `[v2:${generationId.slice(-6)}] ${message}`);
};

const updateProgress = async (generationId: string, status: GenerationStatus, progress: number) => {
  await Generation.findByIdAndUpdate(generationId, { status, progress });
  emitStatus(generationId, status, progress);
};

const formatDuration = (ms: number): string => {
  if (ms < 1000) return `${ms}ms`;
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m ${s % 60}s`;
};

const getDecryptedApiKeys = (user: { apiKeys?: {
  openRouter?: { apiKey?: string };
  firecrawl?: { apiKey?: string };
  google?: { apiKey?: string };
  supabase?: { url?: string; secretKey?: string };
} }) => ({
  openRouter: user.apiKeys?.openRouter?.apiKey ? decrypt(user.apiKeys.openRouter.apiKey) : undefined,
  firecrawl: user.apiKeys?.firecrawl?.apiKey ? decrypt(user.apiKeys.firecrawl.apiKey) : undefined,
  google: user.apiKeys?.google?.apiKey ? decrypt(user.apiKeys.google.apiKey) : undefined,
  supabase: user.apiKeys?.supabase?.url && user.apiKeys?.supabase?.secretKey
    ? { url: user.apiKeys.supabase.url, secretKey: decrypt(user.apiKeys.supabase.secretKey) }
    : undefined,
});

// ─── Evidence defaults (deterministic, rule-based) ───────────────────────────

function getEvidenceDefault(targetOutcome: string): string {
  const t = targetOutcome.toLowerCase();
  if (/cost|price|preis|kosten|стоим|цен/.test(t)) return 'Include a price range or cost comparison frame';
  if (/risk|legal|illegal|risiko|законн|правов/.test(t)) return 'Include a risk warning or legal qualification';
  if (/how|process|schritt|wie|как|шаг|step/.test(t)) return 'Structure as numbered steps with concrete actions';
  if (/compar|unterschied|vs\.|сравн|choice|выбор/.test(t)) return 'Include a comparison or differentiation between options';
  return 'Provide a concrete example, case study, or specific actionable recommendation';
}

// ─── SERP-derived term extractor ─────────────────────────────────────────────

function extractSerpDerivedTerms(serpResults: Array<{ title: string; content?: string }>): EnrichedEntity[] {
  const text = serpResults.slice(0, 7)
    .map(r => `${r.title} ${r.content?.slice(0, 300) ?? ''}`)
    .join(' ');

  // Extract capitalized multi-word phrases (potential named terms) — 2-4 words
  const matches = text.match(/\b[A-ZÄÖÜ][a-zäöüßА-Яа-яёЁ][a-zA-ZäöüßÄÖÜА-Яа-яёЁ]+(?:\s+[A-ZÄÖÜa-zäöüß][a-zA-ZäöüßÄÖÜА-Яа-яёЁ]+){0,3}\b/g) ?? [];

  const seen = new Set<string>();
  const terms: EnrichedEntity[] = [];

  for (const m of matches) {
    const normalized = m.trim();
    if (normalized.length < 4 || normalized.length > 60) continue;
    const key = normalized.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);

    terms.push({
      name: normalized,
      types: [],
      score: 1,
      source: 'serp_derived',
      sourceConfidence: 0.4,
      confirmedBy: ['serp_derived'],
    });
  }

  return terms.slice(0, 30); // Cap to avoid noise
}

// ─── Queue processor ─────────────────────────────────────────────────────────

export const startEntityQueueProcessor = () => {
  logger.info('🔧 Registering Entity Generation Queue processor (v2)...');

  entityGenerationQueue.process(config.queue.maxConcurrentGenerations, async (job) => {
    const { generationId, userId } = job.data;
    logger.info(`[v2] Processing generation ${generationId}`);

    const pipelineStartTime = Date.now();
    let stepStartTime = Date.now();
    let totalPromptTokens = 0;
    let totalCompletionTokens = 0;
    let totalTokens = 0;

    try {
      const generation = await Generation.findById(generationId);
      if (!generation) throw new Error('Generation not found');

      const aiModel = generation.config.model || 'openai/gpt-5.2';

      const user = await User.findById(userId);
      if (!user) throw new Error('User not found');

      const apiKeys = getDecryptedApiKeys(user);
      if (!apiKeys.openRouter) throw new Error('OpenRouter API key not configured');
      if (!apiKeys.firecrawl) throw new Error('Firecrawl API key not configured');

      // Build unified instruction text from v2 directives (audience + comment + mustCover + mustAvoid)
      const instructionText = buildV2InstructionText({
        audience: generation.config.audience,
        comment: generation.config.comment,
        mustCover: generation.config.mustCover,
        mustAvoid: generation.config.mustAvoid,
      });

      // =====================================================================
      // STEP 1: SERP + Entity Collection + Intent Map
      // =====================================================================
      stepStartTime = Date.now();
      await updateProgress(generationId, GenerationStatus.PROCESSING, calcProgress(1, 0));
      await addLog(generationId, 'info', '🚀 Starting Article Generation 2.0 pipeline...');
      await addLog(generationId, 'info', `🔍 Searching SERP for: "${generation.config.mainKeyword}"`);

      // 1a: SERP parsing
      const firecrawl = new FirecrawlService(apiKeys.firecrawl);
      await updateProgress(generationId, GenerationStatus.PARSING_SERP, calcProgress(1, 0.05));

      const serpResults: Array<{ url: string; title: string; position: number; content?: string; headings?: string[]; wordCount?: number; parsedAt?: Date; error?: string }> = [];

      try {
        const results = await firecrawl.fetchSerpResults(
          generation.config.mainKeyword,
          generation.config.region,
          generation.config.language,
          async (result, index) => {
            serpResults.push(result);
            await updateProgress(generationId, GenerationStatus.PARSING_SERP, calcProgress(1, 0.05 + (index + 1) / 10 * 0.35));
            if (result.error) {
              await addLog(generationId, 'warn', `⚠️ [${index + 1}/10] Failed: ${result.url}`);
            } else {
              await addLog(generationId, 'info', `✅ [${index + 1}/10] ${result.title}`, { wordCount: result.wordCount });
            }
            await Generation.findByIdAndUpdate(generationId, { serpResults });
          }
        );

        const wordCounts = results.filter(r => r.wordCount && r.wordCount > 0).map(r => r.wordCount!);
        const averageWordCount = wordCounts.length > 0
          ? Math.round(wordCounts.reduce((a, b) => a + b, 0) / wordCounts.length)
          : 2000;
        await Generation.findByIdAndUpdate(generationId, { serpResults: results, averageWordCount });
        await addLog(generationId, 'info', `📊 SERP: ${results.filter(r => !r.error).length} pages parsed, avg ${averageWordCount} words`);
      } catch (err) {
        await addLog(generationId, 'error', `❌ SERP failed: ${err instanceof Error ? err.message : 'Unknown'}`);
        throw err;
      }

      // 1b: KG entity collection
      await updateProgress(generationId, GenerationStatus.PARSING_SERP, calcProgress(1, 0.45));
      await addLog(generationId, 'info', '🔗 Fetching Knowledge Graph entities...');

      let kgEntities: EnrichedEntity[] = [];
      if (apiKeys.google) {
        try {
          const kgService = new KnowledgeGraphService(apiKeys.google);
          const allKeywords = [generation.config.mainKeyword, ...(generation.config.keywords || [])];
          kgEntities = await kgService.getEnrichedEntities(allKeywords);
          await addLog(generationId, 'info', `✅ KG: ${kgEntities.length} entities found`, {
            topEntities: kgEntities.slice(0, 5).map(e => e.name),
          });
          if (kgEntities.length < 5) {
            await addLog(generationId, 'warn', '⚠️ KG_SPARSE: fewer than 5 entities — elevating SERP-derived weight');
          }
          // Save kgEntities names for v1-compatible display
          await Generation.findByIdAndUpdate(generationId, { $set: { kgEntities: kgEntities.map(e => e.name) } });
        } catch (err) {
          await addLog(generationId, 'warn', `⚠️ KG fetch failed (non-critical): ${err instanceof Error ? err.message : 'Unknown'}`);
        }
      } else {
        await addLog(generationId, 'thinking', 'Google API key not configured — using SERP-derived terms only');
      }

      // 1c: SERP-derived terms
      const serpTerms = extractSerpDerivedTerms(serpResults);
      await addLog(generationId, 'thinking', `Extracted ${serpTerms.length} SERP-derived term candidates`);

      // 1d: Merge + dedup (cross-confirm entities found in both sources)
      const mergedEntities: EnrichedEntity[] = [...kgEntities];
      const kgNames = new Set(kgEntities.map(e => e.name.toLowerCase()));

      for (const term of serpTerms) {
        const key = term.name.toLowerCase();
        if (kgNames.has(key)) {
          // Cross-confirmed — upgrade confirmedBy
          const kgEntity = mergedEntities.find(e => e.name.toLowerCase() === key);
          if (kgEntity && !kgEntity.confirmedBy.includes('serp_derived')) {
            kgEntity.confirmedBy.push('serp_derived');
            kgEntity.sourceConfidence = Math.min(kgEntity.sourceConfidence + 0.05, 0.98);
          }
        } else {
          mergedEntities.push(term);
        }
      }

      await addLog(generationId, 'info', `📦 Total entities: ${mergedEntities.length} (${kgEntities.length} KG + ${serpTerms.length} SERP-derived)`);

      // 1e: Intent map
      await updateProgress(generationId, GenerationStatus.PARSING_SERP, calcProgress(1, 0.75));
      await addLog(generationId, 'info', '🎯 Resolving intent map...');

      const openRouterForSetup = new OpenRouterService(apiKeys.openRouter, aiModel);
      const intentMap = await openRouterForSetup.resolveIntentMap(
        generation.config.mainKeyword,
        generation.config.language,
        serpResults,
        generation.config.articleType || 'informational'
      );

      await Generation.findByIdAndUpdate(generationId, { $set: { intentMap } });
      await addLog(generationId, 'info', `✅ Intent: "${intentMap.primaryIntent}"`, {
        funnelStage: intentMap.funnelStage,
        hiddenIntents: intentMap.hiddenIntents.slice(0, 4),
        mustAnswerQuestions: intentMap.mustAnswerQuestions.length,
        confidence: intentMap.heuristicConfidence,
      });

      const step1Tokens = openRouterForSetup.getTokenUsage(true);
      totalPromptTokens += step1Tokens.promptTokens;
      totalCompletionTokens += step1Tokens.completionTokens;
      totalTokens += step1Tokens.totalTokens;
      await addLog(generationId, 'info', `⏱️ Step 1 took ${formatDuration(Date.now() - stepStartTime)}`);

      // =====================================================================
      // STEP 2: Entity Clustering
      // =====================================================================
      stepStartTime = Date.now();
      await updateProgress(generationId, GenerationStatus.ANALYZING_STRUCTURE, calcProgress(2, 0));
      await addLog(generationId, 'info', '🧠 Clustering entities semantically...');

      let entityClusters: EntityCluster[] = [];

      if (apiKeys.supabase && mergedEntities.length > 0) {
        try {
          const supabaseForClustering = new SupabaseService(
            apiKeys.supabase.url,
            apiKeys.supabase.secretKey,
            apiKeys.openRouter
          );
          const clusteringService = new EntityClusteringService(supabaseForClustering);
          entityClusters = await clusteringService.clusterEntities(
            mergedEntities,
            generation.config.maxWords || 1800
          );

          await Generation.findByIdAndUpdate(generationId, { $set: { entityClusters } });
          const avgCoherence = entityClusters.length > 0
            ? (entityClusters.reduce((s, c) => s + c.coherenceScore, 0) / entityClusters.length).toFixed(2)
            : '0';
          await addLog(generationId, 'info', `✅ ${mergedEntities.length} entities → ${entityClusters.length} clusters (avg coherence: ${avgCoherence})`, {
            clusters: entityClusters.map(c => ({ label: c.label, count: c.entities.length, coh: c.coherenceScore.toFixed(2) })),
          });
        } catch (err) {
          await addLog(generationId, 'warn', `⚠️ Clustering failed (non-critical): ${err instanceof Error ? err.message : 'Unknown'}`);
        }
      } else {
        await addLog(generationId, 'thinking', 'Supabase not configured or no entities — skipping clustering');
      }

      await addLog(generationId, 'info', `⏱️ Step 2 took ${formatDuration(Date.now() - stepStartTime)}`);

      // =====================================================================
      // STEP 3: Structure Mapping
      // =====================================================================
      stepStartTime = Date.now();
      await updateProgress(generationId, GenerationStatus.GENERATING_BLOCKS, calcProgress(3, 0));
      await addLog(generationId, 'info', '🗺️ Mapping entity clusters to article structure...');

      const openRouterForStructure = new OpenRouterService(apiKeys.openRouter, aiModel);

      const { blocks: rawBlocks, plannedCoverage } = await openRouterForStructure.mapToStructureV2(
        generation.config.mainKeyword,
        intentMap,
        entityClusters,
        generation.config.language,
        generation.config.articleType || 'informational',
        generation.config.minWords || 1200,
        generation.config.maxWords || 1800,
        instructionText
      );

      // Assign evidence defaults and entity lists to each block
      const articleBlocks: ArticleBlock[] = rawBlocks.map(block => {
        const evidenceDefault = getEvidenceDefault(block.targetOutcome ?? '');
        let lsi: string[] = [];

        // Attach entities from primary cluster to lsi field (for v1-compat display)
        if (block.primaryClusterIndex !== null && block.primaryClusterIndex !== undefined) {
          const cluster = entityClusters[block.primaryClusterIndex];
          if (cluster) {
            lsi = cluster.entities.map(e => e.name);
          }
        }

        return {
          ...block,
          lsi,
          instruction: block.targetOutcome ?? '',
          evidenceDefault,
        };
      });

      // Update intentMap with plannedCoverage
      const updatedIntentMap = { ...intentMap, plannedCoverage: Object.values(plannedCoverage) };
      const intentPlannedPercent = intentMap.mustAnswerQuestions.length > 0
        ? Math.round((Object.keys(plannedCoverage).length / intentMap.mustAnswerQuestions.length) * 100)
        : 100;

      await Generation.findByIdAndUpdate(generationId, {
        $set: {
          articleBlocks,
          intentMap: updatedIntentMap,
        },
      });
      emitBlocks(generationId, articleBlocks);

      const step3Tokens = openRouterForStructure.getTokenUsage(true);
      totalPromptTokens += step3Tokens.promptTokens;
      totalCompletionTokens += step3Tokens.completionTokens;
      totalTokens += step3Tokens.totalTokens;

      await addLog(generationId, 'info', `✅ Structure: ${articleBlocks.length} blocks mapped`, {
        blocks: articleBlocks.map(b => ({ id: b.id, type: b.type, heading: b.heading.slice(0, 40), clusterIdx: b.primaryClusterIndex })),
        intentCoveragePercent: intentPlannedPercent,
      });
      await addLog(generationId, 'info', `⏱️ Step 3 took ${formatDuration(Date.now() - stepStartTime)}`);

      // =====================================================================
      // STEP 4: Question Answering (Supabase + Perplexity)
      // =====================================================================
      stepStartTime = Date.now();
      await updateProgress(generationId, GenerationStatus.ANSWERING_QUESTIONS, calcProgress(4, 0));
      await addLog(generationId, 'info', '🔎 Answering questions from research (Supabase + Perplexity)...');

      const freshForQA = await Generation.findById(generationId);
      let blocksWithAnswers = ((freshForQA?.articleBlocks || []) as ArticleBlock[]).filter(b => b && b.type);

      if (apiKeys.supabase) {
        try {
          const supabaseForQA = new SupabaseService(
            apiKeys.supabase.url,
            apiKeys.supabase.secretKey,
            apiKeys.openRouter
          );

          for (let i = 0; i < blocksWithAnswers.length; i++) {
            const block = blocksWithAnswers[i];
            await updateProgress(generationId, GenerationStatus.ANSWERING_QUESTIONS, calcProgress(4, i / blocksWithAnswers.length));

            let questions: string[] = block.questions ?? [];

            // FAQ block: mustAnswerQuestions first, then entity-derived
            if (block.type === 'faq') {
              const entityQuestions = entityClusters
                .flatMap(c => c.entities.filter(e => e.description).slice(0, 2))
                .map(e => `What is ${e.name}?`)
                .slice(0, 5);
              questions = [...new Set([...intentMap.mustAnswerQuestions, ...entityQuestions])].slice(0, 8);
              blocksWithAnswers[i] = { ...block, questions };
            }

            if (!questions.length) continue;

            const answeredQuestions: AnsweredQuestion[] = [];
            let unsupportedCount = 0;

            for (const question of questions) {
              try {
                // Try Supabase first
                const answer = await supabaseForQA.findAnswer(question);
                if (answer) {
                  answeredQuestions.push(answer);
                  await addLog(generationId, 'thinking', `  ✅ [Block ${block.id}] "${question.slice(0, 60)}" → Supabase (sim: ${answer.similarity.toFixed(2)})`);
                } else {
                  // Perplexity fallback
                  await addLog(generationId, 'thinking', `  🔍 [Block ${block.id}] Asking Perplexity: "${question.slice(0, 60)}"`);
                  const perplexityAnswer = await supabaseForQA.findAnswerWithPerplexity(
                    question,
                    generation.config.language,
                    async (msg) => { await addLog(generationId, 'thinking', `    ${msg}`); }
                  );
                  if (perplexityAnswer) {
                    answeredQuestions.push(perplexityAnswer);
                  } else {
                    unsupportedCount++;
                  }
                }
              } catch (err) {
                await addLog(generationId, 'thinking', `  ⚠️ QA failed for "${question.slice(0, 40)}": ${err instanceof Error ? err.message : 'Unknown'}`);
                unsupportedCount++;
              }
              await new Promise(resolve => setTimeout(resolve, 150));
            }

            blocksWithAnswers[i] = { ...blocksWithAnswers[i], answeredQuestions };
            if (answeredQuestions.length > 0) {
              await addLog(generationId, 'info', `📌 Block ${block.id} [${block.type}]: ${answeredQuestions.length}/${questions.length} questions answered`);
            }
            // Track unsupported claims for quality scores (primitive)
            if (unsupportedCount > 0) {
              await addLog(generationId, 'thinking', `  ⚠️ Block ${block.id}: ${unsupportedCount} unanswered questions may lack evidence`);
            }
          }

          await Generation.findByIdAndUpdate(generationId, { $set: { articleBlocks: blocksWithAnswers } });
        } catch (err) {
          await addLog(generationId, 'warn', `⚠️ QA step failed (non-critical): ${err instanceof Error ? err.message : 'Unknown'}`);
        }
      } else {
        await addLog(generationId, 'thinking', 'Supabase not configured — skipping question answering');
      }

      await addLog(generationId, 'info', `⏱️ Step 4 took ${formatDuration(Date.now() - stepStartTime)}`);

      // =====================================================================
      // STEP 5: Entity-Rich Writing
      // =====================================================================
      stepStartTime = Date.now();
      await updateProgress(generationId, GenerationStatus.WRITING_ARTICLE, calcProgress(5, 0));

      const freshForWriting = await Generation.findById(generationId);
      const blocksToWrite = ((freshForWriting?.articleBlocks || []) as ArticleBlock[]).filter(b => b && b.type);
      const configMinWords = generation.config.minWords || 1200;
      const configMaxWords = generation.config.maxWords || 1800;
      const targetWordCount = Math.round((configMinWords + configMaxWords) / 2);

      await addLog(generationId, 'info', `✍️ Writing ${blocksToWrite.length} blocks. Target: ${configMinWords}-${configMaxWords} words`);

      const openRouterForWriting = new OpenRouterService(apiKeys.openRouter, aiModel);
      let accumulatedContent = '';
      const writtenBlocks: ArticleBlock[] = [];

      for (let i = 0; i < blocksToWrite.length; i++) {
        const block = blocksToWrite[i];
        await updateProgress(generationId, GenerationStatus.WRITING_ARTICLE, calcProgress(5, i / blocksToWrite.length));
        await addLog(generationId, 'thinking', `Writing Block #${block.id} [${block.type.toUpperCase()}]: "${block.heading}"`);

        let generatedContent = '';

        // Entity-aware writing for blocks with assigned clusters
        const hasPrimaryCluster = block.primaryClusterIndex !== null && block.primaryClusterIndex !== undefined;
        if (hasPrimaryCluster && block.type !== 'intro' && block.type !== 'conclusion' && block.type !== 'faq') {
          const cluster = entityClusters[block.primaryClusterIndex!];
          const secondaryCluster = (block.secondaryClusterIndex !== null && block.secondaryClusterIndex !== undefined)
            ? entityClusters[block.secondaryClusterIndex]
            : null;

          const allClusterEntities = [
            ...(cluster?.entities ?? []),
            ...(secondaryCluster?.entities.filter(e => !cluster?.entities.some(ce => ce.name === e.name)) ?? []),
          ];

          const requiredEntities = allClusterEntities.filter(e => e.priority === 'critical').slice(0, 3);
          const preferredEntities = allClusterEntities.filter(e => e.priority === 'supporting').slice(0, 4);

          if (requiredEntities.length > 0) {
            await addLog(generationId, 'info', `🎯 Block ${block.id}: required=[${requiredEntities.map(e => e.name).join(', ')}], evidence=${block.evidenceDefault?.slice(0, 40)}`);
          }

          generatedContent = await openRouterForWriting.generateEntityAwareBlock(
            {
              ...block,
              requiredEntities,
              preferredEntities,
              evidenceDefault: block.evidenceDefault ?? getEvidenceDefault(block.targetOutcome ?? ''),
            },
            accumulatedContent,
            generation.config.mainKeyword,
            generation.config.language,
            Math.round(targetWordCount / Math.max(blocksToWrite.filter(b => b.type === 'h2' || b.type === 'h3').length, 1)),
            generation.config.articleType || 'informational',
            instructionText
          );
        } else {
          // Standard generation for intro/conclusion/faq/h1
          const blockForGeneration = {
            id: block.id, type: block.type, heading: block.heading,
            instruction: block.instruction, lsi: block.lsi || [],
            answeredQuestions: block.answeredQuestions?.map(aq => ({ question: aq.question, answer: aq.answer, source: aq.source })),
          };
          const openRouterForStd = new OpenRouterService(apiKeys.openRouter, aiModel);
          generatedContent = await openRouterForStd.generateBlockContent(
            blockForGeneration, accumulatedContent,
            generation.config.mainKeyword, generation.config.language,
            targetWordCount, generation.config.articleType || 'informational',
            instructionText
          );
          const stdTokens = openRouterForStd.getTokenUsage(true);
          totalPromptTokens += stdTokens.promptTokens;
          totalCompletionTokens += stdTokens.completionTokens;
          totalTokens += stdTokens.totalTokens;
        }

        const wordCount = generatedContent.split(/\s+/).length;
        await addLog(generationId, 'info', `✅ Block #${block.id} written: ${wordCount} words`);

        const writtenBlock: ArticleBlock = {
          id: block.id, type: block.type, heading: block.heading,
          instruction: block.instruction, lsi: [...(block.lsi || [])],
          questions: block.questions ? [...block.questions] : undefined,
          answeredQuestions: block.answeredQuestions?.map(aq => ({
            question: aq.question, answer: aq.answer, source: aq.source, similarity: aq.similarity,
          })),
          content: generatedContent,
          primaryClusterIndex: block.primaryClusterIndex,
          secondaryClusterIndex: block.secondaryClusterIndex,
          targetOutcome: block.targetOutcome,
          evidenceDefault: block.evidenceDefault,
        };
        writtenBlocks.push(writtenBlock);

        // Build accumulated context
        if (block.type === 'h1') accumulatedContent = `# ${generatedContent}\n\n`;
        else if (block.type === 'intro') accumulatedContent += `${generatedContent}\n\n`;
        else if (block.type === 'h2' || block.type === 'conclusion') accumulatedContent += `## ${block.heading}\n\n${generatedContent}\n\n`;
        else if (block.type === 'h3') accumulatedContent += `### ${block.heading}\n\n${generatedContent}\n\n`;
        else if (block.type === 'faq') accumulatedContent += `## ${block.heading}\n\n${generatedContent}\n\n`;

        await Generation.findByIdAndUpdate(generationId, { $set: { articleBlocks: writtenBlocks } });
        emitBlocks(generationId, writtenBlocks);
        if (i < blocksToWrite.length - 1) await new Promise(resolve => setTimeout(resolve, 500));
      }

      const writingTokens = openRouterForWriting.getTokenUsage(true);
      totalPromptTokens += writingTokens.promptTokens;
      totalCompletionTokens += writingTokens.completionTokens;
      totalTokens += writingTokens.totalTokens;

      // Build article markdown
      let finalArticle = '';
      for (const block of writtenBlocks) {
        const cleanContent = stripLeadingHeading(block.content || '', block.heading);
        if (block.type === 'h1') finalArticle += `# ${cleanContent}\n\n`;
        else if (block.type === 'intro') finalArticle += `${cleanContent}\n\n`;
        else if (block.type === 'h2' || block.type === 'conclusion') finalArticle += `## ${block.heading}\n\n${cleanContent}\n\n`;
        else if (block.type === 'h3') finalArticle += `### ${block.heading}\n\n${cleanContent}\n\n`;
        else if (block.type === 'faq') finalArticle += `## ${block.heading}\n\n${cleanContent}\n\n`;
      }

      const totalWordCount = writtenBlocks.reduce((s, b) => s + (b.content?.split(/\s+/).length || 0), 0);
      await addLog(generationId, 'info', `🎉 Writing complete! ${totalWordCount} words across ${writtenBlocks.length} blocks`);
      await Generation.findByIdAndUpdate(generationId, { article: finalArticle, articleBlocks: writtenBlocks });
      await addLog(generationId, 'info', `⏱️ Step 5 took ${formatDuration(Date.now() - stepStartTime)}`);

      // =====================================================================
      // STEP 6: Link Insertion
      // =====================================================================
      stepStartTime = Date.now();

      const genWithLinks = await Generation.findById(generationId);
      const internalLinks = genWithLinks?.config?.internalLinks || [];

      if (internalLinks.length > 0) {
        await updateProgress(generationId, GenerationStatus.INSERTING_LINKS, calcProgress(6, 0));
        await addLog(generationId, 'info', `🔗 Inserting ${internalLinks.length} internal links...`);

        // Re-use logic from v1 via OpenRouter methods
        const openRouterForLinks = new OpenRouterService(apiKeys.openRouter, aiModel);
        const blocksForLinks = (((await Generation.findById(generationId))?.articleBlocks as ArticleBlock[]) || writtenBlocks).filter(b => b && b.type);

        try {
          // Select blocks for links
          const linkableBlocks = blocksForLinks.filter(b => b.type !== 'h1');
          const linkAssignments = await openRouterForLinks.selectBlocksForLinks(
            linkableBlocks.map(b => ({ id: b.id, type: b.type, heading: b.heading, content: b.content ?? '' })),
            internalLinks.map(l => ({ url: l.url, anchor: l.anchor ?? '', position: l.position, displayType: l.displayType, isAnchorless: l.isAnchorless })),
            generation.config.language
          );

          // Apply each link assignment
          const blocksAfterLinks = blocksForLinks.map(b => ({ ...b }));
          for (const assignment of linkAssignments) {
            const blockIdx = blocksAfterLinks.findIndex(b => b.id === assignment.blockId);
            if (blockIdx === -1) continue;
            const block = blocksAfterLinks[blockIdx];
            const link = internalLinks[assignment.linkIndex];
            if (!link || !block.content) continue;

            await addLog(generationId, 'thinking', `  Inserting link ${link.url} into Block #${block.id}`);
            const updatedContent = await openRouterForLinks.insertSingleLink(
              block.content,
              block.heading,
              { url: link.url, anchor: assignment.finalAnchor, isAnchorless: link.isAnchorless, displayType: link.displayType as 'inline' | 'list_end' | 'list_start' | 'sidebar' },
              generation.config.language
            );
            blocksAfterLinks[blockIdx] = { ...block, content: updatedContent };
            await new Promise(resolve => setTimeout(resolve, 300));
          }

          const linkArticle = blocksAfterLinks.map(b => {
            const clean = stripLeadingHeading(b.content || '', b.heading);
            if (b.type === 'h1') return `# ${clean}\n\n`;
            if (b.type === 'intro') return `${clean}\n\n`;
            if (b.type === 'h2' || b.type === 'conclusion') return `## ${b.heading}\n\n${clean}\n\n`;
            if (b.type === 'h3') return `### ${b.heading}\n\n${clean}\n\n`;
            if (b.type === 'faq') return `## ${b.heading}\n\n${clean}\n\n`;
            return '';
          }).join('');

          await Generation.findByIdAndUpdate(generationId, { article: linkArticle, $set: { articleBlocks: blocksAfterLinks } });
          emitBlocks(generationId, blocksAfterLinks);

          const linksTokens = openRouterForLinks.getTokenUsage(true);
          totalPromptTokens += linksTokens.promptTokens;
          totalCompletionTokens += linksTokens.completionTokens;
          totalTokens += linksTokens.totalTokens;
          await addLog(generationId, 'info', `✅ Link insertion done | ⏱️ ${formatDuration(Date.now() - stepStartTime)}`);
        } catch (err) {
          await addLog(generationId, 'warn', `⚠️ Link insertion failed: ${err instanceof Error ? err.message : 'Unknown'}`);
        }
      }

      // =====================================================================
      // STEP 7: Entity Coverage + Review + SEO
      // =====================================================================
      stepStartTime = Date.now();
      await updateProgress(generationId, GenerationStatus.REVIEWING_ARTICLE, calcProgress(7, 0));
      await addLog(generationId, 'info', '🔍 Starting review, coverage check, and SEO...');

      const openRouterForReview = new OpenRouterService(apiKeys.openRouter, aiModel);
      const genForReview = await Generation.findById(generationId);
      let reviewedBlocks = ((genForReview?.articleBlocks || []) as ArticleBlock[]).filter(b => b && b.type);
      const currentArticle = genForReview?.article ?? '';

      // 7a: Pre-review entity coverage
      const preReviewCoverage = openRouterForReview.checkEntityCoverage(currentArticle, mergedEntities, 'pre_review');
      const preCoveredCount = preReviewCoverage.filter(c => c.mentioned).length;
      const preCriticalMissed = preReviewCoverage.filter(c => !c.mentioned && c.priority === 'critical').length;
      await addLog(generationId, 'info', `📊 Pre-review coverage: ${preCoveredCount}/${mergedEntities.length} entities (${Math.round(preCoveredCount / Math.max(mergedEntities.length, 1) * 100)}%), critical missed: ${preCriticalMissed}`);
      await Generation.findByIdAndUpdate(generationId, { $set: { preReviewEntityCoverage: preReviewCoverage } });

      // 7b: Comprehensive review (same as v1)
      try {
        const configuredLinks = (generation.config.internalLinks || []).map(l => ({ url: l.url, anchor: l.anchor }));
        const MAX_ITERATIONS = 7;

        // fixBlockWithUrlProtection helper (reused from v1 pattern)
        const fixBlockWithUrlProtection = async (
          block: { id: number; type: string; heading: string; content: string },
          issues: string[],
          suggestion: string,
          maxWords?: number,
          verifiedFacts?: Array<{ question: string; answer: string }>
        ): Promise<string> => {
          const urlRegex = /\[([^\]]*)\]\(([^)]+)\)/g;
          const originalUrls: string[] = [];
          let match;
          while ((match = urlRegex.exec(block.content)) !== null) originalUrls.push(match[2]);

          const fixedContent = await openRouterForReview.fixBlockContent(
            { id: block.id, type: block.type, heading: block.heading, content: block.content },
            issues, suggestion, generation.config.language,
            generation.config.articleType || 'informational',
            instructionText, maxWords, verifiedFacts
          );

          if (originalUrls.length > 0) {
            const fixedUrls = Array.from(fixedContent.matchAll(/\[([^\]]*)\]\(([^)]+)\)/g)).map(m => m[2]);
            const missingUrls = originalUrls.filter(u => !fixedUrls.includes(u));
            if (missingUrls.length > 0) {
              return fixedContent + '\n' + missingUrls.map(u => `[${u}](${u})`).join('\n');
            }
          }
          return fixedContent;
        };

        for (let iteration = 1; iteration <= MAX_ITERATIONS; iteration++) {
          await updateProgress(generationId, GenerationStatus.REVIEWING_ARTICLE, calcProgress(7, (iteration - 1) / MAX_ITERATIONS));
          await addLog(generationId, 'info', `🔍 Review iteration ${iteration}/${MAX_ITERATIONS}...`);

          const review = await openRouterForReview.comprehensiveReview(
            reviewedBlocks.map(b => ({
              id: b.id, type: b.type as 'h1' | 'intro' | 'h2' | 'h3' | 'conclusion' | 'faq',
              heading: b.heading, content: b.content,
              verifiedFacts: b.answeredQuestions?.map(aq => ({ question: aq.question, answer: aq.answer })),
            })),
            configuredLinks, configMinWords, configMaxWords,
            generation.config.mainKeyword, generation.config.language,
            generation.config.articleType || 'informational',
            instructionText
          );

          await addLog(generationId, 'info', `  Words: ${review.wordCountCheck.actual} (${configMinWords}-${configMaxWords}) ${review.wordCountCheck.passed ? '✅' : '❌'}`);
          await addLog(generationId, 'info', `  Rhythm: ${review.rhythmCheck.passed ? '✅' : `❌ (${review.rhythmCheck.blocksToFix.length} blocks)`}`);

          if (review.passed) {
            await addLog(generationId, 'info', `✅ All checks passed on iteration ${iteration}!`);
            break;
          }

          // Fix failing blocks
          const blockIdsWithLinks = new Set<number>();
          for (const b of reviewedBlocks) {
            if (b.content && /\]\(https?:\/\//.test(b.content)) blockIdsWithLinks.add(b.id);
          }
          const protectedBlockIds = new Set<number>([
            ...blockIdsWithLinks,
            ...reviewedBlocks.filter(b => ['intro', 'conclusion', 'faq'].includes(b.type)).map(b => b.id),
          ]);

          // Word count fix via trim
          if (!review.wordCountCheck.passed && review.wordCountCheck.actual > review.wordCountCheck.max) {
            const trimBlocks = reviewedBlocks.map(b => ({ id: b.id, type: b.type, heading: b.heading, content: b.content ?? '' }));
            const trimPlan = await openRouterForReview.smartTrimArticle(
              trimBlocks, review.wordCountCheck.actual, configMaxWords, generation.config.language,
              protectedBlockIds, instructionText,
              reviewedBlocks.filter(b => b.answeredQuestions?.length).map(b => ({
                blockId: b.id,
                facts: b.answeredQuestions!.map(aq => `${aq.question}: ${aq.answer}`),
              }))
            );
            for (const plan of trimPlan) {
              const blockIdx = reviewedBlocks.findIndex(b => b.id === plan.blockId);
              if (blockIdx === -1) continue;
              const block = reviewedBlocks[blockIdx];
              if (!block.content || plan.targetWords <= 0) continue;
              const trimmedContent = await fixBlockWithUrlProtection(
                { id: block.id, type: block.type, heading: block.heading, content: block.content },
                [`Reduce to approximately ${plan.targetWords} words`],
                `Trim to ~${plan.targetWords} words while keeping key information`,
                plan.targetWords
              );
              reviewedBlocks[blockIdx] = { ...block, content: trimmedContent };
            }
          }

          // Rhythm fixes
          for (const fix of review.rhythmCheck.blocksToFix) {
            const blockIdx = reviewedBlocks.findIndex(b => b.id === fix.blockId);
            if (blockIdx === -1) continue;
            const block = reviewedBlocks[blockIdx];
            if (!block.content) continue;
            const fixedContent = await fixBlockWithUrlProtection(
              { id: block.id, type: block.type, heading: block.heading, content: block.content },
              fix.issues, fix.suggestion, undefined,
              block.answeredQuestions?.map(aq => ({ question: aq.question, answer: aq.answer }))
            );
            reviewedBlocks[blockIdx] = { ...block, content: fixedContent };
          }

          await Generation.findByIdAndUpdate(generationId, { $set: { articleBlocks: reviewedBlocks } });
          emitBlocks(generationId, reviewedBlocks);
        }

        // Build final reviewed article
        let finalReviewedArticle = '';
        for (const block of reviewedBlocks) {
          const clean = stripLeadingHeading(block.content || '', block.heading);
          if (block.type === 'h1') finalReviewedArticle += `# ${clean}\n\n`;
          else if (block.type === 'intro') finalReviewedArticle += `${clean}\n\n`;
          else if (block.type === 'h2' || block.type === 'conclusion') finalReviewedArticle += `## ${block.heading}\n\n${clean}\n\n`;
          else if (block.type === 'h3') finalReviewedArticle += `### ${block.heading}\n\n${clean}\n\n`;
          else if (block.type === 'faq') finalReviewedArticle += `## ${block.heading}\n\n${clean}\n\n`;
        }

        // 7c: Post-review entity coverage
        const postReviewCoverage = openRouterForReview.checkEntityCoverage(finalReviewedArticle, mergedEntities, 'post_review');
        const postCoveredCount = postReviewCoverage.filter(c => c.mentioned).length;
        const postCriticalMissed = postReviewCoverage.filter(c => !c.mentioned && c.priority === 'critical').length;
        const entityCoveragePercent = Math.round(postCoveredCount / Math.max(mergedEntities.length, 1) * 100);

        // 7d: Intent realized coverage (heuristic: keyword overlap)
        const articleLower = finalReviewedArticle.toLowerCase();
        const realizedCount = (updatedIntentMap?.mustAnswerQuestions ?? intentMap.mustAnswerQuestions).filter(q => {
          const keyWords = q.toLowerCase().split(/\s+/).filter(w => w.length > 4);
          return keyWords.length > 0 && keyWords.some(w => articleLower.includes(w));
        }).length;
        const intentRealizedPercent = intentMap.mustAnswerQuestions.length > 0
          ? Math.round(realizedCount / intentMap.mustAnswerQuestions.length * 100)
          : 100;

        // 7e: Quality scores
        const qualityScores: GenerationQualityScores = {
          entityCoveragePercent,
          criticalEntitiesMissed: postCriticalMissed,
          intentPlannedPercent,
          intentRealizedPercent,
          unsupportedHardClaims: 0, // Primitive — count in future version
        };

        await addLog(generationId, 'info', `📊 Post-review coverage: ${postCoveredCount}/${mergedEntities.length} (${entityCoveragePercent}%) | Critical missed: ${postCriticalMissed}`);
        await addLog(generationId, 'info', `📊 Intent: planned=${intentPlannedPercent}%, realized=${intentRealizedPercent}%`);

        // 7f: SEO metadata
        const seoMetadata = await openRouterForReview.generateSeoMetadata(
          finalReviewedArticle,
          generation.config.mainKeyword,
          generation.config.language,
          generation.config.articleType || 'informational',
          instructionText
        );

        await Generation.findByIdAndUpdate(generationId, {
          article: finalReviewedArticle,
          articleBlocks: reviewedBlocks,
          seoTitle: seoMetadata.title,
          seoDescription: seoMetadata.description,
          $set: {
            entityCoverage: postReviewCoverage,
            qualityScores,
          },
        });

        emitBlocks(generationId, reviewedBlocks);
        emitToClient(`generation:${generationId}`, 'generation:seo', {
          generationId,
          seoTitle: seoMetadata.title,
          seoDescription: seoMetadata.description,
        });

        const reviewTokens = openRouterForReview.getTokenUsage(true);
        totalPromptTokens += reviewTokens.promptTokens;
        totalCompletionTokens += reviewTokens.completionTokens;
        totalTokens += reviewTokens.totalTokens;
        await addLog(generationId, 'info', `✅ Review + SEO done | ⏱️ ${formatDuration(Date.now() - stepStartTime)}`);

      } catch (reviewErr) {
        await addLog(generationId, 'warn', `⚠️ Review failed: ${reviewErr instanceof Error ? reviewErr.message : 'Unknown'}`);
      }

      // =====================================================================
      // COMPLETION
      // =====================================================================
      await updateProgress(generationId, GenerationStatus.COMPLETED, 100);

      const pricingKeys = getDecryptedApiKeys(user);
      let modelPricing = null;
      if (pricingKeys.openRouter) {
        try {
          const res = await fetch('https://openrouter.ai/api/v1/models', {
            headers: { 'Authorization': `Bearer ${pricingKeys.openRouter}` },
          });
          if (res.ok) {
            const data = await res.json() as { data: Array<{ id: string; pricing?: { prompt: string; completion: string } }> };
            modelPricing = data.data.find(m => m.id === aiModel)?.pricing ?? null;
          }
        } catch { /* non-critical */ }
      }

      await Generation.findByIdAndUpdate(generationId, {
        currentStep: 'completed',
        completedAt: new Date(),
        tokenUsage: { promptTokens: totalPromptTokens, completionTokens: totalCompletionTokens, totalTokens },
        modelPricing: modelPricing || undefined,
        firecrawlCredits: 11,
      });

      const totalDuration = Date.now() - pipelineStartTime;
      await addLog(generationId, 'info', `🏁 Generation 2.0 complete! Total: ${formatDuration(totalDuration)}`);
      await addLog(generationId, 'info', `💰 Tokens: ${totalTokens.toLocaleString()} (prompt: ${totalPromptTokens.toLocaleString()}, completion: ${totalCompletionTokens.toLocaleString()})`);

      const finalGen = await Generation.findById(generationId);
      emitToClient(`generation:${generationId}`, 'generation:completed', {
        generationId,
        article: finalGen?.article || '',
      });

      return { success: true, generationId };

    } catch (error) {
      logger.error(`[v2] Generation ${generationId} failed`, { error });
      await Generation.findByIdAndUpdate(generationId, {
        status: GenerationStatus.FAILED,
        error: error instanceof Error ? error.message : 'Unknown error',
        completedAt: new Date(),
      });
      await addLog(generationId, 'error', `❌ Generation 2.0 failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
      emitToClient(`generation:${generationId}`, 'generation:error', {
        generationId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw error;
    }
  });

  entityGenerationQueue.on('completed', (job) => {
    logger.info(`[v2] Job ${job.id} completed for generation ${job.data.generationId}`);
  });
  entityGenerationQueue.on('failed', (job, err) => {
    logger.error(`[v2] Job ${job?.id} failed`, { error: err.message, generationId: job?.data?.generationId });
  });
  entityGenerationQueue.on('stalled', (job) => {
    logger.warn(`[v2] Job ${job?.id} stalled`, { generationId: job?.data?.generationId });
  });

  logger.info('✅ Entity Generation Queue processor registered');
};

/**
 * Add v2 generation to entity queue
 */
export const queueEntityGeneration = async (generationId: string, userId: string) => {
  const existingJob = await entityGenerationQueue.getJob(generationId);
  if (existingJob) {
    try {
      await existingJob.remove();
      logger.info(`[v2] Removed existing job for generation ${generationId}`);
    } catch (err) {
      logger.warn(`[v2] Could not remove existing job ${generationId}: ${(err as Error).message}`);
    }
  }

  const job = await entityGenerationQueue.add(
    { generationId, userId },
    { jobId: generationId }
  );

  logger.info(`[v2] Queued entity generation ${generationId}`);
  return job;
};
