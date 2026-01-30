/**
 * Generation Queue
 * Bull queue for processing article generations
 * @module queues/generationQueue
 */

import Bull from 'bull';
import { config } from '../utils/config.js';
import { logger } from '../utils/logger.js';
import { Generation, User } from '../models/index.js';
import { GenerationStatus, GenerationLog, SerpResult, ArticleBlock, StructureAnalysis, AnsweredQuestion } from '../types/index.js';
import { FirecrawlService } from '../services/FirecrawlService.js';
import { OpenRouterService } from '../services/OpenRouterService.js';
import { SupabaseService } from '../services/SupabaseService.js';
import { publishSocketEvent } from '../utils/redis.js';
import { decrypt } from '../services/CryptoService.js';

/**
 * Helper to get decrypted API keys from user
 */
interface DecryptedApiKeys {
  openRouter?: string;
  firecrawl?: string;
  supabase?: {
    url: string;
    secretKey: string;
  };
}

const getDecryptedApiKeys = (user: { apiKeys?: {
  openRouter?: { apiKey?: string };
  firecrawl?: { apiKey?: string };
  supabase?: { url?: string; secretKey?: string };
}}): DecryptedApiKeys => {
  return {
    openRouter: user.apiKeys?.openRouter?.apiKey
      ? decrypt(user.apiKeys.openRouter.apiKey)
      : undefined,
    firecrawl: user.apiKeys?.firecrawl?.apiKey
      ? decrypt(user.apiKeys.firecrawl.apiKey)
      : undefined,
    supabase: user.apiKeys?.supabase?.url && user.apiKeys?.supabase?.secretKey
      ? {
          url: user.apiKeys.supabase.url,
          secretKey: decrypt(user.apiKeys.supabase.secretKey),
        }
      : undefined,
  };
};

/**
 * Execution mode - determines how events are emitted
 * - 'api': Direct Socket.IO emit (API server mode)
 * - 'worker': Redis pub/sub emit (Worker mode)
 */
let executionMode: 'api' | 'worker' = 'worker';

/**
 * Socket.IO server reference for real-time updates (API mode only)
 */
let ioServer: { to: (room: string) => { emit: (event: string, data: unknown) => void } } | null = null;

/**
 * Set Socket.IO server reference (API mode)
 */
export const setSocketServer = (io: typeof ioServer) => {
  ioServer = io;
  executionMode = 'api';
  logger.info('Queue running in API mode (direct Socket.IO)');
};

/**
 * Set worker mode (no Socket.IO, use Redis pub/sub)
 */
export const setWorkerMode = () => {
  executionMode = 'worker';
  logger.info('Queue running in Worker mode (Redis pub/sub)');
};

/**
 * Job data interface
 */
interface GenerationJobData {
  generationId: string;
  userId: string;
  continueFrom?: GenerationStatus; // For continue feature
}

/**
 * Create Bull queue with Redis connection
 */
export const generationQueue = new Bull<GenerationJobData>('article-generation', {
  redis: {
    host: config.redis.host,
    port: config.redis.port,
    password: config.redis.password,
  },
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 5000,
    },
    removeOnComplete: 100,
    removeOnFail: 50,
  },
});

/**
 * Emit event to client (via Socket.IO directly or Redis pub/sub)
 */
const emitToClient = (room: string, event: string, data: unknown) => {
  if (executionMode === 'api' && ioServer) {
    // Direct Socket.IO emit (API server mode)
    ioServer.to(room).emit(event, data);
  } else {
    // Redis pub/sub (Worker mode)
    publishSocketEvent(room, event, data);
  }
};

/**
 * Emit log to client
 */
const emitLog = (generationId: string, log: GenerationLog) => {
  emitToClient(`generation:${generationId}`, 'generation:log', {
    generationId,
    log,
  });
};

/**
 * Emit status update to client
 */
const emitStatus = (generationId: string, status: GenerationStatus, progress: number) => {
  emitToClient(`generation:${generationId}`, 'generation:status', {
    generationId,
    status,
    progress,
  });
};

/**
 * Emit article blocks update to client
 */
const emitBlocks = (generationId: string, blocks: ArticleBlock[]) => {
  emitToClient(`generation:${generationId}`, 'generation:blocks', {
    generationId,
    blocks,
  });
};

/**
 * Strip any markdown heading from the beginning of content
 * Fixes issue where AI sometimes includes heading despite instructions not to
 */
const stripLeadingHeading = (content: string): string => {
  // Remove any leading markdown heading (# ## ### etc.) from the start
  return content.replace(/^#{1,6}\s+[^\n]+\n+/, '').trim();
};

/**
 * Add log to generation and emit to client
 */
const addLog = async (
  generationId: string,
  level: GenerationLog['level'],
  message: string,
  data?: Record<string, unknown>
) => {
  const log: GenerationLog = {
    timestamp: new Date(),
    level,
    message,
    data,
  };

  await Generation.findByIdAndUpdate(generationId, {
    $push: { logs: log },
  });

  emitLog(generationId, log);
  logger.log(level === 'thinking' ? 'debug' : level, `[Gen:${generationId.slice(-6)}] ${message}`);
};

/**
 * Update generation status and progress
 */
const updateProgress = async (
  generationId: string,
  status: GenerationStatus,
  progress: number
) => {
  await Generation.findByIdAndUpdate(generationId, {
    status,
    progress,
  });

  emitStatus(generationId, status, progress);
};

/**
 * Start queue processor (CALL THIS ONLY IN WORKER.TS!)
 * Main worker function that handles article generation pipeline
 */
export const startQueueProcessor = () => {
  logger.info('🔧 Registering Bull queue processor...');

  generationQueue.process(config.queue.maxConcurrentGenerations, async (job) => {
    const { generationId, userId, continueFrom } = job.data;

  logger.info(`Processing generation ${generationId}`, { continueFrom });

  // Timer helper - formats milliseconds to human readable string
  const formatDuration = (ms: number): string => {
    if (ms < 1000) return `${ms}ms`;
    const seconds = Math.floor(ms / 1000);
    if (seconds < 60) return `${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return `${minutes}m ${remainingSeconds}s`;
  };

  // Pipeline start time
  const pipelineStartTime = Date.now();
  let stepStartTime = Date.now();

  // Token usage tracking
  let totalPromptTokens = 0;
  let totalCompletionTokens = 0;
  let totalTokens = 0;

  try {
    // Get generation document
    const generation = await Generation.findById(generationId);
    if (!generation) {
      throw new Error('Generation not found');
    }

    // Get user for API keys
    const user = await User.findById(userId);
    if (!user) {
      throw new Error('User not found');
    }

    // Check if continuous mode is enabled (skip all pauses)
    const continuousMode = generation.config.continuousMode === true;
    if (continuousMode && !continueFrom) {
      logger.info(`Continuous mode enabled for generation ${generationId}`);
    }

    // Determine which step to start from
    const skipSerp = continueFrom && [
      GenerationStatus.PAUSED_AFTER_SERP,
      GenerationStatus.PAUSED_AFTER_STRUCTURE,
      GenerationStatus.PAUSED_AFTER_BLOCKS,
      GenerationStatus.PAUSED_AFTER_ANSWERS,
      GenerationStatus.PAUSED_AFTER_WRITING,
      GenerationStatus.PAUSED_AFTER_REVIEW,
    ].includes(continueFrom);

    const skipStructure = continueFrom && [
      GenerationStatus.PAUSED_AFTER_STRUCTURE,
      GenerationStatus.PAUSED_AFTER_BLOCKS,
      GenerationStatus.PAUSED_AFTER_ANSWERS,
      GenerationStatus.PAUSED_AFTER_WRITING,
      GenerationStatus.PAUSED_AFTER_REVIEW,
    ].includes(continueFrom);

    const skipBlocks = continueFrom && [
      GenerationStatus.PAUSED_AFTER_BLOCKS,
      GenerationStatus.PAUSED_AFTER_ANSWERS,
      GenerationStatus.PAUSED_AFTER_WRITING,
      GenerationStatus.PAUSED_AFTER_REVIEW,
    ].includes(continueFrom);

    const skipAnswers = continueFrom && [
      GenerationStatus.PAUSED_AFTER_ANSWERS,
      GenerationStatus.PAUSED_AFTER_WRITING,
      GenerationStatus.PAUSED_AFTER_REVIEW,
    ].includes(continueFrom);

    const skipWriting = continueFrom && [
      GenerationStatus.PAUSED_AFTER_WRITING,
      GenerationStatus.PAUSED_AFTER_REVIEW,
    ].includes(continueFrom);

    const skipReview = continueFrom === GenerationStatus.PAUSED_AFTER_REVIEW;

    // ========================================
    // STEP 1: SERP Parsing
    // ========================================
    if (!skipSerp) {
      stepStartTime = Date.now();

      // Get decrypted API keys
      const apiKeys = getDecryptedApiKeys(user);

      // Check Firecrawl API key
      if (!apiKeys.firecrawl) {
        throw new Error('Firecrawl API key not configured');
      }

      // Update status to processing
      await updateProgress(generationId, GenerationStatus.PROCESSING, 5);
      await addLog(generationId, 'info', '🚀 Starting article generation...');

      // Initialize Firecrawl service
      const firecrawl = new FirecrawlService(apiKeys.firecrawl);

      // Start SERP parsing
      await updateProgress(generationId, GenerationStatus.PARSING_SERP, 10);
      await addLog(generationId, 'info', `🔍 Searching for: "${generation.config.mainKeyword}"`);
      await addLog(generationId, 'thinking', 'Connecting to Firecrawl API and fetching search results...');

      // Fetch SERP results with progress updates
      const serpResults: SerpResult[] = [];

      try {
        const results = await firecrawl.fetchSerpResults(
          generation.config.mainKeyword,
          generation.config.region,
          generation.config.language,
          async (result, index) => {
            serpResults.push(result);

            // Calculate progress (10-50% for SERP parsing)
            const progress = Math.round(10 + (index + 1) * 4);
            await updateProgress(generationId, GenerationStatus.PARSING_SERP, progress);

            // Log each result
            if (result.error) {
              await addLog(generationId, 'warn', `⚠️ [${index + 1}/10] Failed to parse: ${result.url}`, {
                error: result.error,
              });
            } else {
              await addLog(generationId, 'info', `✅ [${index + 1}/10] Parsed: ${result.title}`, {
                url: result.url,
                wordCount: result.wordCount,
                headingsCount: result.headings?.length || 0,
              });

              // Show some details in thinking mode
              if (result.headings && result.headings.length > 0) {
                await addLog(generationId, 'thinking', `Found headings: ${result.headings.slice(0, 5).join(', ')}${result.headings.length > 5 ? '...' : ''}`);
              }
            }

            // Update serpResults in database periodically
            await Generation.findByIdAndUpdate(generationId, {
              serpResults: serpResults,
            });
          }
        );

        // Calculate average word count
        const wordCounts = results.filter(r => r.wordCount && r.wordCount > 0).map(r => r.wordCount!);
        const averageWordCount = wordCounts.length > 0
          ? Math.round(wordCounts.reduce((a, b) => a + b, 0) / wordCounts.length)
          : 2000;

        // Final SERP results update with average word count
        await Generation.findByIdAndUpdate(generationId, {
          serpResults: results,
          averageWordCount,
        });

        // Summary log
        const successCount = results.filter(r => !r.error).length;
        const totalWords = results.reduce((sum, r) => sum + (r.wordCount || 0), 0);

        await addLog(generationId, 'info', `📊 SERP Analysis complete!`, {
          totalParsed: results.length,
          successfullyParsed: successCount,
          totalWords,
          averageWordCount,
        });

        await addLog(generationId, 'thinking', `Collected ${totalWords.toLocaleString()} words from ${successCount} pages. Average: ${averageWordCount} words.`);

      } catch (error) {
        await addLog(generationId, 'error', `❌ SERP parsing failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
        throw error;
      }

      // Log step duration
      const serpDuration = Date.now() - stepStartTime;
      await addLog(generationId, 'info', `⏱️ SERP parsing took ${formatDuration(serpDuration)}`);

      // Pause point after SERP (skip if continuous mode)
      if (!continuousMode) {
        await updateProgress(generationId, GenerationStatus.PAUSED_AFTER_SERP, 50);
        await Generation.findByIdAndUpdate(generationId, {
          currentStep: 'serp_completed',
        });
        await addLog(generationId, 'info', '⏸️ SERP parsing completed. Ready for structure analysis.');
        return { success: true, generationId, pausedAt: 'serp' };
      }
      await addLog(generationId, 'info', '✅ SERP parsing completed. Continuing to structure analysis...');
    }

    // ========================================
    // STEP 2: Structure Analysis
    // ========================================
    if (!skipStructure) {
      stepStartTime = Date.now();

      // Get decrypted API keys
      const apiKeys = getDecryptedApiKeys(user);

      // Check OpenRouter API key
      if (!apiKeys.openRouter) {
        throw new Error('OpenRouter API key not configured');
      }

      await updateProgress(generationId, GenerationStatus.ANALYZING_STRUCTURE, 55);
      await addLog(generationId, 'info', '🧠 Starting AI structure analysis...');
      await addLog(generationId, 'thinking', 'Analyzing competitor structures with AI to create optimal article outline...');

      // Reload generation to get latest SERP results
      const freshGeneration = await Generation.findById(generationId);
      if (!freshGeneration) throw new Error('Generation not found');

      const openRouter = new OpenRouterService(apiKeys.openRouter);

      try {
        // Analyze structures
        await addLog(generationId, 'thinking', `Sending ${freshGeneration.serpResults.length} competitor structures to AI for analysis...`);

        const structureAnalysis = await openRouter.analyzeStructures(
          freshGeneration.config.mainKeyword,
          freshGeneration.config.language,
          freshGeneration.serpResults,
          freshGeneration.config.keywords || [],
          freshGeneration.config.lsiKeywords || [],
          freshGeneration.config.articleType || 'informational',
          freshGeneration.config.comment
        );

        await updateProgress(generationId, GenerationStatus.ANALYZING_STRUCTURE, 65);

        // Log analysis results
        await addLog(generationId, 'info', '📋 Structure analysis completed!', {
          patternsFound: structureAnalysis.commonPatterns.length,
          blocksGenerated: structureAnalysis.recommendedStructure.length,
        });

        await addLog(generationId, 'thinking', `Found patterns: ${structureAnalysis.commonPatterns.slice(0, 3).join(', ')}`);
        await addLog(generationId, 'thinking', `Generated ${structureAnalysis.recommendedStructure.length} content blocks for the article.`);

        // Save structure analysis
        await Generation.findByIdAndUpdate(generationId, {
          structureAnalysis: {
            averageWordCount: structureAnalysis.averageWordCount,
            commonPatterns: structureAnalysis.commonPatterns,
            strengths: structureAnalysis.strengths,
            weaknesses: structureAnalysis.weaknesses,
            recommendedStructure: structureAnalysis.recommendedStructure,
          },
          articleBlocks: structureAnalysis.recommendedStructure,
        });

        // Emit blocks to client for real-time display
        emitBlocks(generationId, structureAnalysis.recommendedStructure);

        // Log block structure
        for (const block of structureAnalysis.recommendedStructure) {
          await addLog(generationId, 'thinking', `Block #${block.id} [${block.type}]: ${block.heading}`);
        }

      } catch (error) {
        await addLog(generationId, 'error', `❌ Structure analysis failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
        throw error;
      }

      // Log step duration and token usage
      const structureDuration = Date.now() - stepStartTime;
      const structureTokens = openRouter.getTokenUsage(true);
      totalPromptTokens += structureTokens.promptTokens;
      totalCompletionTokens += structureTokens.completionTokens;
      totalTokens += structureTokens.totalTokens;
      await addLog(generationId, 'info', `⏱️ Structure analysis took ${formatDuration(structureDuration)} | 🎯 ${structureTokens.totalTokens.toLocaleString()} tokens`);

      // Pause point after structure analysis (skip if continuous mode)
      if (!continuousMode) {
        await updateProgress(generationId, GenerationStatus.PAUSED_AFTER_STRUCTURE, 70);
        await Generation.findByIdAndUpdate(generationId, {
          currentStep: 'structure_completed',
        });
        await addLog(generationId, 'info', '⏸️ Structure analysis completed. Ready for block enrichment.');
        return { success: true, generationId, pausedAt: 'structure' };
      }
      await addLog(generationId, 'info', '✅ Structure analysis completed. Continuing to block enrichment...');
    }

    // ========================================
    // STEP 3: Block Enrichment
    // ========================================
    if (!skipBlocks) {
      stepStartTime = Date.now();

      // Get decrypted API keys
      const apiKeys = getDecryptedApiKeys(user);

      // Check OpenRouter API key
      if (!apiKeys.openRouter) {
        throw new Error('OpenRouter API key not configured');
      }

      await updateProgress(generationId, GenerationStatus.ENRICHING_BLOCKS, 75);
      await addLog(generationId, 'info', '✨ Enriching block instructions...');
      await addLog(generationId, 'thinking', 'Adding detailed writing instructions and research questions to each block...');

      // Reload generation to get latest blocks
      const freshGeneration = await Generation.findById(generationId);
      if (!freshGeneration) throw new Error('Generation not found');
      if (!freshGeneration.articleBlocks || freshGeneration.articleBlocks.length === 0) {
        throw new Error('No article blocks found for enrichment');
      }

      const openRouter = new OpenRouterService(apiKeys.openRouter);

      try {
        const enrichedBlocks = await openRouter.enrichBlockInstructions(
          freshGeneration.articleBlocks as ArticleBlock[],
          freshGeneration.config.mainKeyword,
          freshGeneration.config.language,
          freshGeneration.config.keywords || [],
          freshGeneration.config.lsiKeywords || [],
          freshGeneration.config.articleType || 'informational',
          freshGeneration.config.comment
        );

        await updateProgress(generationId, GenerationStatus.ENRICHING_BLOCKS, 85);

        // Save enriched blocks
        await Generation.findByIdAndUpdate(generationId, {
          articleBlocks: enrichedBlocks,
        });

        // Emit updated blocks to client
        emitBlocks(generationId, enrichedBlocks);

        await addLog(generationId, 'info', '📝 Blocks enriched with detailed instructions!', {
          totalBlocks: enrichedBlocks.length,
          blocksWithQuestions: enrichedBlocks.filter(b => b.questions && b.questions.length > 0).length,
        });

        // Log enriched blocks summary
        for (const block of enrichedBlocks) {
          if (block.questions && block.questions.length > 0) {
            await addLog(generationId, 'thinking', `Block #${block.id}: ${block.questions.length} research questions added`);
          }
        }

      } catch (error) {
        await addLog(generationId, 'error', `❌ Block enrichment failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
        throw error;
      }

      // Log step duration and token usage
      const blocksDuration = Date.now() - stepStartTime;
      const blocksTokens = openRouter.getTokenUsage(true);
      totalPromptTokens += blocksTokens.promptTokens;
      totalCompletionTokens += blocksTokens.completionTokens;
      totalTokens += blocksTokens.totalTokens;
      await addLog(generationId, 'info', `⏱️ Block enrichment took ${formatDuration(blocksDuration)} | 🎯 ${blocksTokens.totalTokens.toLocaleString()} tokens`);

      // Pause point after blocks enrichment (skip if continuous mode)
      if (!continuousMode) {
        await updateProgress(generationId, GenerationStatus.PAUSED_AFTER_BLOCKS, 88);
        await Generation.findByIdAndUpdate(generationId, {
          currentStep: 'blocks_completed',
        });
        await addLog(generationId, 'info', '⏸️ Block enrichment completed. Ready for question answering.');
        return { success: true, generationId, pausedAt: 'blocks' };
      }
      await addLog(generationId, 'info', '✅ Block enrichment completed. Continuing to question answering...');
    }

    // ========================================
    // STEP 4: Question Answering from Supabase
    // ========================================
    if (!skipAnswers) {
      stepStartTime = Date.now();

      // Get decrypted API keys
      const apiKeys = getDecryptedApiKeys(user);

      // Check required API keys
      if (!apiKeys.supabase) {
        throw new Error('Supabase credentials not configured');
      }
      if (!apiKeys.openRouter) {
        throw new Error('OpenRouter API key not configured (required for embeddings)');
      }

      await updateProgress(generationId, GenerationStatus.ANSWERING_QUESTIONS, 90);
      await addLog(generationId, 'info', '🔍 Searching for answers to research questions...');
      await addLog(generationId, 'thinking', 'Connecting to Supabase vector database to find relevant information...');

      // Reload generation to get latest blocks
      const freshGeneration = await Generation.findById(generationId);
      if (!freshGeneration) throw new Error('Generation not found');
      if (!freshGeneration.articleBlocks || freshGeneration.articleBlocks.length === 0) {
        throw new Error('No article blocks found for question answering');
      }

      const supabase = new SupabaseService(
        apiKeys.supabase.url,
        apiKeys.supabase.secretKey,
        apiKeys.openRouter
      );

      try {
        // Test connection first
        const isConnected = await supabase.testConnection();
        if (!isConnected) {
          throw new Error('Failed to connect to Supabase');
        }
        await addLog(generationId, 'info', '✅ Connected to Supabase vector database');

        // Process blocks with questions
        const updatedBlocks: ArticleBlock[] = [];
        let totalQuestions = 0;
        let answeredCount = 0;

        // Count total questions first
        for (const block of freshGeneration.articleBlocks) {
          if (block.questions && block.questions.length > 0) {
            totalQuestions += block.questions.length;
          }
        }

        await addLog(generationId, 'info', `📋 Found ${totalQuestions} research questions across all blocks`);

        // Process each block
        for (const block of freshGeneration.articleBlocks) {
          const blockData = block as ArticleBlock;

          if (!blockData.questions || blockData.questions.length === 0) {
            // Block has no questions, keep as is
            updatedBlocks.push(blockData);
            continue;
          }

          await addLog(generationId, 'thinking', `Processing Block #${blockData.id}: ${blockData.questions.length} questions...`);

          // Find answers for this block's questions
          const answeredQuestions: AnsweredQuestion[] = [];

          for (const question of blockData.questions) {
            try {
              const answer = await supabase.findAnswer(question);

              if (answer) {
                answeredQuestions.push(answer);
                answeredCount++;
                await addLog(generationId, 'info', `✅ Found answer for: "${question.substring(0, 50)}..."`, {
                  similarity: Math.round(answer.similarity * 100) + '%',
                  source: answer.source,
                });
              } else {
                await addLog(generationId, 'thinking', `❌ No answer found for: "${question.substring(0, 50)}..."`);
              }

              // Update progress
              const progressPercent = Math.round(90 + (answeredCount / totalQuestions) * 5);
              await updateProgress(generationId, GenerationStatus.ANSWERING_QUESTIONS, Math.min(progressPercent, 95));

            } catch (error) {
              await addLog(generationId, 'warn', `⚠️ Error searching for answer: ${error instanceof Error ? error.message : 'Unknown error'}`);
            }

            // Small delay to avoid rate limiting
            await new Promise(resolve => setTimeout(resolve, 300));
          }

          // Update block with answered questions (remove unanswered ones)
          // Explicitly construct plain object to avoid Mongoose serialization issues
          const updatedBlock: ArticleBlock = {
            id: blockData.id,
            type: blockData.type,
            heading: blockData.heading,
            instruction: blockData.instruction,
            lsi: [...(blockData.lsi || [])],
            // Only keep questions that have answers
            questions: answeredQuestions.length > 0
              ? answeredQuestions.map(aq => aq.question)
              : undefined,
            // Store answered Q&A pairs
            answeredQuestions: answeredQuestions.length > 0
              ? answeredQuestions.map(aq => ({
                  question: aq.question,
                  answer: aq.answer,
                  source: aq.source,
                  similarity: aq.similarity,
                }))
              : undefined,
          };

          updatedBlocks.push(updatedBlock);

          // Emit updated blocks after each block is processed
          emitBlocks(generationId, updatedBlocks);
        }

        // Save all updated blocks - use $set to ensure full replacement
        await Generation.findByIdAndUpdate(
          generationId,
          { $set: { articleBlocks: updatedBlocks } },
          { new: true }
        );

        // Final emission of blocks
        emitBlocks(generationId, updatedBlocks);

        await addLog(generationId, 'info', `🎯 Question answering complete!`, {
          totalQuestions,
          answeredQuestions: answeredCount,
          unansweredRemoved: totalQuestions - answeredCount,
        });

        await addLog(generationId, 'thinking', `Found answers for ${answeredCount} out of ${totalQuestions} questions. Unanswered questions were removed from blocks.`);

      } catch (error) {
        await addLog(generationId, 'error', `❌ Question answering failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
        throw error;
      }

      // Log step duration
      const answersDuration = Date.now() - stepStartTime;
      await addLog(generationId, 'info', `⏱️ Question answering took ${formatDuration(answersDuration)}`);

      // Pause point after question answering (skip if continuous mode)
      if (!continuousMode) {
        await updateProgress(generationId, GenerationStatus.PAUSED_AFTER_ANSWERS, 96);
        await Generation.findByIdAndUpdate(generationId, {
          currentStep: 'answers_completed',
        });
        await addLog(generationId, 'info', '⏸️ Question answering completed. Ready for article writing.');
        return { success: true, generationId, pausedAt: 'answers' };
      }
      await addLog(generationId, 'info', '✅ Question answering completed. Continuing to article writing...');
    }

    // ========================================
    // STEP 5: Article Writing (Block by Block)
    // ========================================
    if (!skipWriting) {
    stepStartTime = Date.now();

    // Get decrypted API keys
    const apiKeys = getDecryptedApiKeys(user);

    // Check OpenRouter API key
    if (!apiKeys.openRouter) {
      throw new Error('OpenRouter API key not configured');
    }

    await updateProgress(generationId, GenerationStatus.WRITING_ARTICLE, 97);
    await addLog(generationId, 'info', '📝 Starting article writing...');
    await addLog(generationId, 'thinking', 'Generating content block by block with accumulated context for style consistency...');

    // Reload generation to get latest blocks with answered questions
    const freshGeneration = await Generation.findById(generationId);
    if (!freshGeneration) throw new Error('Generation not found');
    if (!freshGeneration.articleBlocks || freshGeneration.articleBlocks.length === 0) {
      throw new Error('No article blocks found for writing');
    }

    const openRouter = new OpenRouterService(apiKeys.openRouter);
    const totalBlocks = freshGeneration.articleBlocks.length;
    const targetWordCount = freshGeneration.averageWordCount || 2000;

    await addLog(generationId, 'info', `📊 Writing ${totalBlocks} blocks. Target: ~${targetWordCount} words`);

    try {
      // Accumulated article content for context
      let accumulatedContent = '';
      const updatedBlocks: ArticleBlock[] = [];

      // Process each block sequentially
      for (let i = 0; i < totalBlocks; i++) {
        const block = freshGeneration.articleBlocks[i] as ArticleBlock;

        // Calculate progress (97-99%)
        const progressPercent = Math.round(97 + (i / totalBlocks) * 2);
        await updateProgress(generationId, GenerationStatus.WRITING_ARTICLE, progressPercent);

        await addLog(generationId, 'thinking', `Writing Block #${block.id} [${block.type.toUpperCase()}]: "${block.heading}"`);

        // Prepare block data for generation
        const blockForGeneration = {
          id: block.id,
          type: block.type,
          heading: block.heading,
          instruction: block.instruction,
          lsi: block.lsi || [],
          answeredQuestions: block.answeredQuestions?.map(aq => ({
            question: aq.question,
            answer: aq.answer,
            source: aq.source,
          })),
        };

        // Log if block has verified facts
        if (block.answeredQuestions && block.answeredQuestions.length > 0) {
          await addLog(generationId, 'info', `📌 Block #${block.id}: Using ${block.answeredQuestions.length} verified facts from research`);
        } else if (block.type !== 'h1' && block.type !== 'faq') {
          await addLog(generationId, 'thinking', `Block #${block.id}: No verified facts - writing informatively without specific claims`);
        }

        // Generate content for this block
        const generatedContent = await openRouter.generateBlockContent(
          blockForGeneration,
          accumulatedContent,
          freshGeneration.config.mainKeyword,
          freshGeneration.config.language,
          targetWordCount,
          freshGeneration.config.articleType || 'informational',
          freshGeneration.config.comment
        );

        // Count words in generated content
        const wordCount = generatedContent.split(/\s+/).length;
        await addLog(generationId, 'info', `✅ Block #${block.id} written: ${wordCount} words`);

        // Build updated block with content
        const updatedBlock: ArticleBlock = {
          id: block.id,
          type: block.type,
          heading: block.heading,
          instruction: block.instruction,
          lsi: [...(block.lsi || [])],
          questions: block.questions ? [...block.questions] : undefined,
          answeredQuestions: block.answeredQuestions?.map(aq => ({
            question: aq.question,
            answer: aq.answer,
            source: aq.source,
            similarity: aq.similarity,
          })),
          content: generatedContent,
        };

        updatedBlocks.push(updatedBlock);

        // Accumulate content for context (heading + content)
        if (block.type === 'h1') {
          // H1 is just the title
          accumulatedContent = `# ${generatedContent}\n\n`;
        } else if (block.type === 'intro') {
          accumulatedContent += `${generatedContent}\n\n`;
        } else if (block.type === 'h2') {
          accumulatedContent += `## ${block.heading}\n\n${generatedContent}\n\n`;
        } else if (block.type === 'h3') {
          accumulatedContent += `### ${block.heading}\n\n${generatedContent}\n\n`;
        } else if (block.type === 'conclusion') {
          accumulatedContent += `## ${block.heading}\n\n${generatedContent}\n\n`;
        } else if (block.type === 'faq') {
          accumulatedContent += `## ${block.heading}\n\n${generatedContent}\n\n`;
        }

        // Save progress after each block
        await Generation.findByIdAndUpdate(
          generationId,
          { $set: { articleBlocks: updatedBlocks } },
          { new: true }
        );

        // Emit updated blocks to frontend
        emitBlocks(generationId, updatedBlocks);

        // Small delay to avoid rate limiting
        if (i < totalBlocks - 1) {
          await new Promise(resolve => setTimeout(resolve, 500));
        }
      }

      // Calculate total word count
      const totalWordCount = updatedBlocks.reduce((sum, b) => {
        return sum + (b.content?.split(/\s+/).length || 0);
      }, 0);

      await addLog(generationId, 'info', `🎉 Article writing complete!`, {
        totalBlocks,
        totalWordCount,
        targetWordCount,
      });

      // Build final article text (strip any duplicate headings AI might have included)
      let finalArticle = '';
      for (const block of updatedBlocks) {
        const cleanContent = stripLeadingHeading(block.content || '');
        if (block.type === 'h1') {
          finalArticle += `# ${cleanContent}\n\n`;
        } else if (block.type === 'intro') {
          finalArticle += `${cleanContent}\n\n`;
        } else if (block.type === 'h2' || block.type === 'conclusion') {
          finalArticle += `## ${block.heading}\n\n${cleanContent}\n\n`;
        } else if (block.type === 'h3') {
          finalArticle += `### ${block.heading}\n\n${cleanContent}\n\n`;
        } else if (block.type === 'faq') {
          finalArticle += `## ${block.heading}\n\n${cleanContent}\n\n`;
        }
      }

      // Save final article (before link insertion)
      await Generation.findByIdAndUpdate(generationId, {
        article: finalArticle,
        articleBlocks: updatedBlocks,
      });

      // Log step duration and token usage
      const writingDuration = Date.now() - stepStartTime;
      const writingTokens = openRouter.getTokenUsage(true);
      totalPromptTokens += writingTokens.promptTokens;
      totalCompletionTokens += writingTokens.completionTokens;
      totalTokens += writingTokens.totalTokens;
      await addLog(generationId, 'info', `⏱️ Article writing took ${formatDuration(writingDuration)} | 🎯 ${writingTokens.totalTokens.toLocaleString()} tokens`);

      // Pause point after writing (skip if continuous mode)
      if (!continuousMode) {
        await updateProgress(generationId, GenerationStatus.PAUSED_AFTER_WRITING, 97);
        await Generation.findByIdAndUpdate(generationId, {
          currentStep: 'writing_completed',
        });
        await addLog(generationId, 'info', '⏸️ Article writing completed. Ready for link insertion and review.');
        return { success: true, generationId, pausedAt: 'writing' };
      }
      await addLog(generationId, 'info', '✅ Article writing completed. Continuing to link insertion...');

    } catch (error) {
      await addLog(generationId, 'error', `❌ Article writing failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
      throw error;
    }
    } // End of if (!skipWriting)

    // ========================================
    // STEP 6: Internal Link Insertion
    // ========================================
    stepStartTime = Date.now();

    // Reload generation to get fresh config with internalLinks
    const genWithConfig = await Generation.findById(generationId);
    const internalLinks = genWithConfig?.config?.internalLinks || [];

    await addLog(generationId, 'debug', `🔗 Checking for internal links: found ${internalLinks.length}`, {
      hasConfig: !!genWithConfig?.config,
      linksCount: internalLinks.length,
      links: internalLinks.map(l => ({ url: l.url, position: l.position })),
    });

    let openRouterForLinks: OpenRouterService | null = null;

    if (internalLinks.length > 0) {
      await updateProgress(generationId, GenerationStatus.INSERTING_LINKS, 99);
      await addLog(generationId, 'info', `🔗 Starting internal link insertion (${internalLinks.length} links)...`);

      try {
        // Reload generation to get latest blocks
        const genForLinks = await Generation.findById(generationId);
        if (!genForLinks || !genForLinks.articleBlocks) {
          throw new Error('Generation or blocks not found for link insertion');
        }

        const apiKeysForLinks = getDecryptedApiKeys(user);
        if (!apiKeysForLinks.openRouter) {
          throw new Error('OpenRouter API key not configured');
        }
        openRouterForLinks = new OpenRouterService(apiKeysForLinks.openRouter);
        const blocksForLinks = genForLinks.articleBlocks as ArticleBlock[];

        // Step 6.1: Ask AI to select which blocks should get which links
        await addLog(generationId, 'thinking', 'Analyzing article structure to find best placement for each link...');

        const blockSelections = await openRouterForLinks.selectBlocksForLinks(
          blocksForLinks.map(b => ({
            id: b.id,
            type: b.type,
            heading: b.heading,
            content: b.content,
          })),
          internalLinks.map(link => ({
            url: link.url,
            anchor: link.anchor,
            isAnchorless: link.isAnchorless,
            displayType: link.displayType as 'inline' | 'list_end' | 'list_start' | 'sidebar',
            position: link.position as 'intro' | 'body' | 'conclusion' | 'any',
          })),
          generation.config.language
        );

        await addLog(generationId, 'info', `📍 Selected blocks for links: ${blockSelections.map(s => `Link ${s.linkIndex + 1} → Block #${s.blockId}`).join(', ')}`);

        // Step 6.2: Group links by block and insert
        // Group selections by blockId
        const linksByBlock = new Map<number, Array<{
          url: string;
          anchor: string;
          displayType: 'inline' | 'list_end' | 'list_start' | 'sidebar';
        }>>();

        for (const selection of blockSelections) {
          const link = internalLinks[selection.linkIndex];
          const blockId = selection.blockId;

          if (!linksByBlock.has(blockId)) {
            linksByBlock.set(blockId, []);
          }

          linksByBlock.get(blockId)!.push({
            url: link.url,
            anchor: selection.finalAnchor, // Already computed: URL for anchorless, provided anchor otherwise
            displayType: link.displayType as 'inline' | 'list_end' | 'list_start' | 'sidebar',
          });
        }

        // Process each block with its links
        // Convert to plain objects to avoid Mongoose sub-document issues
        const updatedBlocksWithLinks = blocksForLinks.map(b => ({
          id: b.id,
          type: b.type,
          heading: b.heading,
          instruction: b.instruction,
          lsi: b.lsi || [],
          questions: b.questions || [],
          answeredQuestions: b.answeredQuestions || [],
          content: b.content || '',
        }));

        for (const [blockId, linksForBlock] of linksByBlock) {
          const blockIndex = updatedBlocksWithLinks.findIndex(b => b.id === blockId);

          if (blockIndex === -1) {
            await addLog(generationId, 'warn', `Block #${blockId} not found`);
            continue;
          }

          const block = updatedBlocksWithLinks[blockIndex];
          if (!block.content) {
            await addLog(generationId, 'warn', `Block #${blockId} has no content`);
            continue;
          }

          await addLog(generationId, 'thinking', `Inserting ${linksForBlock.length} link(s) into Block #${block.id} "${block.heading}"...`);

          // Log each link being inserted
          for (const link of linksForBlock) {
            await addLog(generationId, 'debug', `  → [${link.anchor}](${link.url}) (${link.displayType})`);
          }

          // Insert all links for this block at once
          const updatedContent = await openRouterForLinks.insertLinksIntoBlock(
            block.content,
            block.heading,
            linksForBlock,
            generation.config.language
          );

          // Update block with new content (plain object, not Mongoose)
          updatedBlocksWithLinks[blockIndex] = {
            ...block,
            content: updatedContent,
          };

          // Verify the link was actually inserted
          const urlsToCheck = linksForBlock.map(l => l.url);
          const missingUrls = urlsToCheck.filter(url => {
            const urlWithoutSlash = url.endsWith('/') ? url.slice(0, -1) : url;
            const urlWithSlash = url.endsWith('/') ? url : url + '/';
            return !updatedContent.includes(urlWithoutSlash) && !updatedContent.includes(urlWithSlash);
          });

          if (missingUrls.length > 0) {
            await addLog(generationId, 'warn', `⚠️ ${missingUrls.length} URL(s) missing after AI insertion, force-appending...`);
            // Force append missing links
            let contentWithForced = updatedContent;
            for (const link of linksForBlock) {
              const urlWithoutSlash = link.url.endsWith('/') ? link.url.slice(0, -1) : link.url;
              const urlWithSlash = link.url.endsWith('/') ? link.url : link.url + '/';
              if (!contentWithForced.includes(urlWithoutSlash) && !contentWithForced.includes(urlWithSlash)) {
                const linkMd = `[${link.anchor}](${link.url})`;
                contentWithForced += `\n\n${linkMd}`;
                await addLog(generationId, 'debug', `  Force-appended: ${linkMd}`);
              }
            }
            updatedBlocksWithLinks[blockIndex].content = contentWithForced;
          }

          await addLog(generationId, 'info', `✅ ${linksForBlock.length} link(s) inserted into Block #${block.id}`);

          // Small delay between blocks
          await new Promise(resolve => setTimeout(resolve, 300));
        }

        // Rebuild final article with links (strip any duplicate headings)
        let finalArticleWithLinks = '';
        for (const block of updatedBlocksWithLinks) {
          const cleanContent = stripLeadingHeading(block.content || '');
          if (block.type === 'h1') {
            finalArticleWithLinks += `# ${cleanContent}\n\n`;
          } else if (block.type === 'intro') {
            finalArticleWithLinks += `${cleanContent}\n\n`;
          } else if (block.type === 'h2' || block.type === 'conclusion') {
            finalArticleWithLinks += `## ${block.heading}\n\n${cleanContent}\n\n`;
          } else if (block.type === 'h3') {
            finalArticleWithLinks += `### ${block.heading}\n\n${cleanContent}\n\n`;
          } else if (block.type === 'faq') {
            finalArticleWithLinks += `## ${block.heading}\n\n${cleanContent}\n\n`;
          }
        }

        // Final verification: check all link URLs are in final article
        const allLinkUrls = internalLinks.map(l => l.url);
        const missingInFinal = allLinkUrls.filter(url => {
          const urlWithoutSlash = url.endsWith('/') ? url.slice(0, -1) : url;
          const urlWithSlash = url.endsWith('/') ? url : url + '/';
          return !finalArticleWithLinks.includes(urlWithoutSlash) && !finalArticleWithLinks.includes(urlWithSlash);
        });

        if (missingInFinal.length > 0) {
          await addLog(generationId, 'warn', `⚠️ FINAL CHECK: ${missingInFinal.length} URL(s) still missing from article!`);
          for (const url of missingInFinal) {
            await addLog(generationId, 'debug', `  Missing URL: ${url}`);
          }
        } else {
          await addLog(generationId, 'debug', `✓ Final check passed: all ${allLinkUrls.length} URLs present in article`);
        }

        // Save updated article and blocks
        await Generation.findByIdAndUpdate(generationId, {
          article: finalArticleWithLinks,
          articleBlocks: updatedBlocksWithLinks,
        });

        // Emit updated blocks to frontend
        emitBlocks(generationId, updatedBlocksWithLinks);

        await addLog(generationId, 'info', `🎉 Link insertion complete! ${internalLinks.length} links inserted.`);

      } catch (linkError) {
        // Log error but don't fail the entire generation
        await addLog(generationId, 'error', `⚠️ Link insertion failed: ${linkError instanceof Error ? linkError.message : 'Unknown error'}`);
        await addLog(generationId, 'warn', 'Article generated successfully but some links may not have been inserted.');
      }

      // Log step duration and token usage
      const linksDuration = Date.now() - stepStartTime;
      if (openRouterForLinks) {
        const linksTokens = openRouterForLinks.getTokenUsage(true);
        totalPromptTokens += linksTokens.promptTokens;
        totalCompletionTokens += linksTokens.completionTokens;
        totalTokens += linksTokens.totalTokens;
        await addLog(generationId, 'info', `⏱️ Link insertion took ${formatDuration(linksDuration)} | 🎯 ${linksTokens.totalTokens.toLocaleString()} tokens`);
      } else {
        await addLog(generationId, 'info', `⏱️ Link insertion took ${formatDuration(linksDuration)}`);
      }
    }

    // ========================================
    // STEP 7: Article Review & SEO Metadata
    // ========================================
    if (!skipReview) {
      stepStartTime = Date.now();

      await updateProgress(generationId, GenerationStatus.REVIEWING_ARTICLE, 99);
      await addLog(generationId, 'info', '🔍 Starting article review and polish...');

      // Get decrypted API keys
      const apiKeysForReview = getDecryptedApiKeys(user);

      // Check OpenRouter API key
      if (!apiKeysForReview.openRouter) {
        throw new Error('OpenRouter API key not configured');
      }

      const openRouterForReview = new OpenRouterService(apiKeysForReview.openRouter);

      // Reload generation to get latest blocks
      const genForReview = await Generation.findById(generationId);
      const blocksForReview = (genForReview?.articleBlocks || []) as ArticleBlock[];

      try {
        // Step 7.1: Review article quality
        await addLog(generationId, 'thinking', 'Analyzing article for rhythm, repetitions, filler content, anomalies...');

        const reviewIssues = await openRouterForReview.reviewArticleQuality(
          blocksForReview.map(b => ({
            id: b.id,
            type: b.type as 'h1' | 'intro' | 'h2' | 'h3' | 'conclusion' | 'faq',
            heading: b.heading,
            content: b.content,
          })),
          generation.config.language,
          generation.config.articleType || 'informational',
          generation.config.comment
        );

        // Step 7.2: Determine blocks to fix (always improve at least 2-3 blocks)
        let blocksToFix = reviewIssues;
        if (blocksToFix.length < 2) {
          await addLog(generationId, 'info', 'Article looks good! Adding general improvements...');
          const additionalImprovements = openRouterForReview.generateImprovementTasks(
            blocksForReview.map(b => ({
              id: b.id,
              type: b.type,
              heading: b.heading,
              content: b.content,
            })),
            3 - blocksToFix.length
          );
          blocksToFix = [...blocksToFix, ...additionalImprovements];
        }

        await addLog(generationId, 'info', `📝 Improving ${blocksToFix.length} blocks...`);

        // Convert to plain objects for modification
        const reviewedBlocks = blocksForReview.map(b => ({
          id: b.id,
          type: b.type,
          heading: b.heading,
          instruction: b.instruction,
          lsi: b.lsi || [],
          questions: b.questions || [],
          answeredQuestions: b.answeredQuestions || [],
          content: b.content || '',
        }));

        // Step 7.3: Fix each problematic block
        for (const issue of blocksToFix) {
          const blockIndex = reviewedBlocks.findIndex(b => b.id === issue.blockId);
          if (blockIndex === -1) continue;

          const block = reviewedBlocks[blockIndex];
          if (!block.content) continue;

          await addLog(generationId, 'thinking', `Improving Block #${block.id} "${block.heading}"...`);
          await addLog(generationId, 'debug', `  Issues: ${issue.issues.join(', ')}`);

          // Extract URLs from original content to verify later
          const urlRegex = /\[([^\]]*)\]\(([^)]+)\)/g;
          const originalUrls: string[] = [];
          let match;
          while ((match = urlRegex.exec(block.content)) !== null) {
            originalUrls.push(match[2]);
          }

          // Fix the block
          const fixedContent = await openRouterForReview.fixBlockContent(
            { id: block.id, type: block.type, heading: block.heading, content: block.content },
            issue.issues,
            issue.suggestion,
            generation.config.language,
            generation.config.articleType || 'informational',
            generation.config.comment
          );

          // Verify links preserved
          const missingUrls = originalUrls.filter(url => !fixedContent.includes(url));
          let finalContent = fixedContent;

          if (missingUrls.length > 0) {
            await addLog(generationId, 'warn', `⚠️ ${missingUrls.length} link(s) lost during fix, restoring...`);
            // Find the original link markdown and append
            for (const url of missingUrls) {
              const linkMatch = block.content.match(new RegExp(`\\[([^\\]]*)\\]\\(${url.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\)`));
              if (linkMatch) {
                finalContent += `\n\n${linkMatch[0]}`;
                await addLog(generationId, 'debug', `  Restored: ${linkMatch[0]}`);
              }
            }
          }

          reviewedBlocks[blockIndex].content = finalContent;
          await addLog(generationId, 'info', `✅ Block #${block.id} improved`);
        }

        // Step 7.4: Assemble final article (strip any duplicate headings)
        let finalReviewedArticle = '';
        for (const block of reviewedBlocks) {
          const cleanContent = stripLeadingHeading(block.content || '');
          if (block.type === 'h1') {
            finalReviewedArticle += `# ${cleanContent}\n\n`;
          } else if (block.type === 'intro') {
            finalReviewedArticle += `${cleanContent}\n\n`;
          } else if (block.type === 'h2' || block.type === 'conclusion') {
            finalReviewedArticle += `## ${block.heading}\n\n${cleanContent}\n\n`;
          } else if (block.type === 'h3') {
            finalReviewedArticle += `### ${block.heading}\n\n${cleanContent}\n\n`;
          } else if (block.type === 'faq') {
            finalReviewedArticle += `## ${block.heading}\n\n${cleanContent}\n\n`;
          }
        }

        // Step 7.5: Generate SEO metadata
        await addLog(generationId, 'thinking', 'Generating SEO title and description...');
        const seoMetadata = await openRouterForReview.generateSeoMetadata(
          finalReviewedArticle,
          generation.config.mainKeyword,
          generation.config.language,
          generation.config.articleType || 'informational',
          generation.config.comment
        );

        await addLog(generationId, 'info', `📊 SEO Title: "${seoMetadata.title}"`);
        await addLog(generationId, 'info', `📊 SEO Description: "${seoMetadata.description.substring(0, 50)}..."`);

        // Save results
        await Generation.findByIdAndUpdate(generationId, {
          article: finalReviewedArticle,
          articleBlocks: reviewedBlocks,
          seoTitle: seoMetadata.title,
          seoDescription: seoMetadata.description,
        });

        // Emit updated blocks and SEO to frontend
        emitBlocks(generationId, reviewedBlocks);

        // Log step duration and token usage
        const reviewDuration = Date.now() - stepStartTime;
        const reviewTokens = openRouterForReview.getTokenUsage(true);
        totalPromptTokens += reviewTokens.promptTokens;
        totalCompletionTokens += reviewTokens.completionTokens;
        totalTokens += reviewTokens.totalTokens;
        await addLog(generationId, 'info', `⏱️ Article review took ${formatDuration(reviewDuration)} | 🎯 ${reviewTokens.totalTokens.toLocaleString()} tokens`);

        // Pause point after review (skip if continuous mode)
        if (!continuousMode) {
          await Generation.findByIdAndUpdate(generationId, {
            status: GenerationStatus.PAUSED_AFTER_REVIEW,
          });
          await addLog(generationId, 'info', '⏸️ Article review completed. Check SEO metadata and final article.');
          return { success: true, generationId, pausedAt: 'review' };
        }
        await addLog(generationId, 'info', '✅ Article review completed. Finalizing...');

      } catch (reviewError) {
        await addLog(generationId, 'error', `⚠️ Article review failed: ${reviewError instanceof Error ? reviewError.message : 'Unknown error'}`);
        await addLog(generationId, 'warn', 'Proceeding to completion without review.');
      }
    }

    // Mark as completed
    await updateProgress(generationId, GenerationStatus.COMPLETED, 100);
    await Generation.findByIdAndUpdate(generationId, {
      currentStep: 'completed',
      completedAt: new Date(),
    });

    // Log total pipeline duration and token usage
    const totalDuration = Date.now() - pipelineStartTime;
    await addLog(generationId, 'info', `🏁 Generation pipeline completed! Total time: ${formatDuration(totalDuration)}`);
    await addLog(generationId, 'info', `💰 Total tokens used: ${totalTokens.toLocaleString()} (prompt: ${totalPromptTokens.toLocaleString()}, completion: ${totalCompletionTokens.toLocaleString()})`);

    // Emit completion event
    const finalGen = await Generation.findById(generationId);
    emitToClient(`generation:${generationId}`, 'generation:completed', {
      generationId,
      article: finalGen?.article || '',
    });

    return { success: true, generationId };

  } catch (error) {
    logger.error(`Generation ${generationId} failed`, { error });

    // Update status to failed
    await Generation.findByIdAndUpdate(generationId, {
      status: GenerationStatus.FAILED,
      error: error instanceof Error ? error.message : 'Unknown error',
      completedAt: new Date(),
    });

    await addLog(
      generationId,
      'error',
      `❌ Generation failed: ${error instanceof Error ? error.message : 'Unknown error'}`
    );

    // Emit error event
    emitToClient(`generation:${generationId}`, 'generation:error', {
      generationId,
      error: error instanceof Error ? error.message : 'Unknown error',
    });

    throw error;
  }
  });

  /**
   * Queue event handlers
   */
  generationQueue.on('completed', (job) => {
    logger.info(`Job ${job.id} completed for generation ${job.data.generationId}`);
  });

  generationQueue.on('failed', (job, err) => {
    logger.error(`Job ${job?.id} failed`, { error: err.message, generationId: job?.data?.generationId });
  });

  generationQueue.on('stalled', (job) => {
    logger.warn(`Job ${job.id} stalled`);
  });

  logger.info('✅ Bull queue processor registered successfully');
};

/**
 * Add generation to queue
 */
export const queueGeneration = async (generationId: string, userId: string): Promise<Bull.Job<GenerationJobData>> => {
  const job = await generationQueue.add(
    { generationId, userId },
    { jobId: generationId }
  );

  logger.info(`Queued generation ${generationId}`);
  return job;
};

/**
 * Get queue statistics
 */
export const getQueueStats = async () => {
  const [waiting, active, completed, failed] = await Promise.all([
    generationQueue.getWaitingCount(),
    generationQueue.getActiveCount(),
    generationQueue.getCompletedCount(),
    generationQueue.getFailedCount(),
  ]);

  return { waiting, active, completed, failed };
};

/**
 * Continue generation from paused state
 */
export const continueGeneration = async (
  generationId: string,
  userId: string
): Promise<Bull.Job<GenerationJobData> | null> => {
  // Get current generation state
  const generation = await Generation.findById(generationId);
  if (!generation) {
    throw new Error('Generation not found');
  }

  // Check if generation is in a paused state
  const pausedStates = [
    GenerationStatus.PAUSED_AFTER_SERP,
    GenerationStatus.PAUSED_AFTER_STRUCTURE,
    GenerationStatus.PAUSED_AFTER_BLOCKS,
    GenerationStatus.PAUSED_AFTER_ANSWERS,
    GenerationStatus.PAUSED_AFTER_WRITING,
    GenerationStatus.PAUSED_AFTER_REVIEW,
  ];

  if (!pausedStates.includes(generation.status as GenerationStatus)) {
    throw new Error(`Cannot continue: generation is in ${generation.status} state`);
  }

  // Add to queue with continue flag
  const job = await generationQueue.add(
    {
      generationId,
      userId,
      continueFrom: generation.status as GenerationStatus,
    },
    { jobId: `${generationId}-continue-${Date.now()}` }
  );

  logger.info(`Continuing generation ${generationId} from ${generation.status}`);

  // Add log about continuation
  await Generation.findByIdAndUpdate(generationId, {
    $push: {
      logs: {
        timestamp: new Date(),
        level: 'info',
        message: `▶️ Continuing generation from ${generation.status.replace('paused_after_', '')} step...`,
      },
    },
  });

  return job;
};
