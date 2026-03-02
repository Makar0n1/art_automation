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
 * Progress calculation: 7 steps, each gets 1/7 of the bar
 * stepNumber: 1-7, stepProgress: 0.0-1.0 (fraction completed within step)
 */
const TOTAL_STEPS = 7;
const STEP_SIZE = 100 / TOTAL_STEPS; // ~14.28

const calcProgress = (stepNumber: number, stepProgress: number = 0): number => {
  const base = (stepNumber - 1) * STEP_SIZE;
  const within = stepProgress * STEP_SIZE;
  return Math.min(Math.round(base + within), 100);
};

/**
 * Strip any heading from the beginning of content
 * Fixes issue where AI sometimes includes heading despite instructions not to
 * Handles both markdown headings (## Title) and plain text headings (Title\n\n)
 */
const stripLeadingHeading = (content: string, blockHeading?: string): string => {
  // Remove any leading markdown heading (# ## ### etc.) from the start
  let cleaned = content.replace(/^#{1,6}\s+[^\n]+\n+/, '').trim();

  // Also remove plain text heading that matches the block heading (AI duplicate bug)
  if (blockHeading && blockHeading.trim()) {
    const headingText = blockHeading.trim();
    // Check if content starts with the heading text (exact match on first line)
    const firstLine = cleaned.split('\n')[0].trim();
    if (firstLine === headingText) {
      cleaned = cleaned.substring(cleaned.indexOf('\n') + 1).trim();
    }
  }

  return cleaned;
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
    const { generationId, userId } = job.data;

  logger.info(`Processing generation ${generationId}`);

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

    // Model from config (or default)
    const aiModel = generation.config.model || 'openai/gpt-5.2';

    // Get user for API keys
    const user = await User.findById(userId);
    if (!user) {
      throw new Error('User not found');
    }

    // DEBUG: Log user API keys structure
    logger.debug(`User API keys structure:`, {
      hasApiKeys: !!user.apiKeys,
      hasFirecrawl: !!user.apiKeys?.firecrawl,
      hasFirecrawlKey: !!user.apiKeys?.firecrawl?.apiKey,
      firecrawlKeyPreview: user.apiKeys?.firecrawl?.apiKey?.substring(0, 30),
    });

    // ========================================
    // STEP 1: SERP Parsing
    // ========================================
    {
      stepStartTime = Date.now();

      // Get decrypted API keys
      const apiKeys = getDecryptedApiKeys(user);

      // Check Firecrawl API key
      if (!apiKeys.firecrawl) {
        throw new Error('Firecrawl API key not configured');
      }

      // Update status to processing
      await updateProgress(generationId, GenerationStatus.PROCESSING, calcProgress(1, 0));
      await addLog(generationId, 'info', '🚀 Starting article generation...');

      // Initialize Firecrawl service
      const firecrawl = new FirecrawlService(apiKeys.firecrawl);

      // Start SERP parsing
      await updateProgress(generationId, GenerationStatus.PARSING_SERP, calcProgress(1, 0.05));
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

            // Calculate progress within Step 1 (0-14%)
            await updateProgress(generationId, GenerationStatus.PARSING_SERP, calcProgress(1, (index + 1) / 10));

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

      await addLog(generationId, 'info', '✅ SERP parsing completed. Continuing to structure analysis...');
    }

    // ========================================
    // STEP 2: Structure Analysis
    // ========================================
    {
      stepStartTime = Date.now();

      // Get decrypted API keys
      const apiKeys = getDecryptedApiKeys(user);

      // Check OpenRouter API key
      if (!apiKeys.openRouter) {
        throw new Error('OpenRouter API key not configured');
      }

      await updateProgress(generationId, GenerationStatus.ANALYZING_STRUCTURE, calcProgress(2, 0));
      await addLog(generationId, 'info', '🧠 Starting AI structure analysis...');
      await addLog(generationId, 'thinking', 'Analyzing competitor structures with AI to create optimal article outline...');

      // Reload generation to get latest SERP results
      const freshGeneration = await Generation.findById(generationId);
      if (!freshGeneration) throw new Error('Generation not found');

      const openRouter = new OpenRouterService(apiKeys.openRouter, aiModel);

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
          freshGeneration.config.comment,
          freshGeneration.config.minWords || 1200,
          freshGeneration.config.maxWords || 1800
        );

        await updateProgress(generationId, GenerationStatus.ANALYZING_STRUCTURE, calcProgress(2, 1));

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

      await addLog(generationId, 'info', '✅ Structure analysis completed. Continuing to block enrichment...');
    }

    // ========================================
    // STEP 3: Block Enrichment
    // ========================================
    {
      stepStartTime = Date.now();

      // Get decrypted API keys
      const apiKeys = getDecryptedApiKeys(user);

      // Check OpenRouter API key
      if (!apiKeys.openRouter) {
        throw new Error('OpenRouter API key not configured');
      }

      await updateProgress(generationId, GenerationStatus.ENRICHING_BLOCKS, calcProgress(3, 0));
      await addLog(generationId, 'info', '✨ Enriching block instructions...');
      await addLog(generationId, 'thinking', 'Adding detailed writing instructions and research questions to each block...');

      // Reload generation to get latest blocks
      const freshGeneration = await Generation.findById(generationId);
      if (!freshGeneration) throw new Error('Generation not found');
      if (!freshGeneration.articleBlocks || freshGeneration.articleBlocks.length === 0) {
        throw new Error('No article blocks found for enrichment');
      }

      const openRouter = new OpenRouterService(apiKeys.openRouter, aiModel);

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

        await updateProgress(generationId, GenerationStatus.ENRICHING_BLOCKS, calcProgress(3, 1));

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

      await addLog(generationId, 'info', '✅ Block enrichment completed. Continuing to question answering...');
    }

    // ========================================
    // STEP 4: Question Answering from Supabase (with web fallback)
    // ===========================================================
    {
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

      await updateProgress(generationId, GenerationStatus.ANSWERING_QUESTIONS, calcProgress(4, 0));
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

      let perplexitySearchCount = 0;

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

        let processedQuestions = 0;

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
              // Phase 1: Try Supabase directly
              let answer = await supabase.findAnswer(question);

              if (answer) {
                answeredQuestions.push(answer);
                answeredCount++;
                await addLog(generationId, 'info', `✅ Found answer for: "${question.substring(0, 50)}..."`, {
                  similarity: Math.round(answer.similarity * 100) + '%',
                });
              } else {
                // Phase 2: Perplexity fallback via OpenRouter
                perplexitySearchCount++;
                await addLog(generationId, 'thinking', `🤖 Perplexity search #${perplexitySearchCount}: "${question.substring(0, 50)}..."`);

                answer = await supabase.findAnswerWithPerplexity(
                  question,
                  freshGeneration.config.language,
                  (level, message) => addLog(generationId, level, message)
                );

                if (answer) {
                  answeredQuestions.push(answer);
                  answeredCount++;
                  await addLog(generationId, 'info', `✅ Found answer via Perplexity for: "${question.substring(0, 50)}..."`, {
                    similarity: Math.round(answer.similarity * 100) + '%',
                  });
                } else {
                  await addLog(generationId, 'thinking', `❌ No answer found for: "${question.substring(0, 50)}..."`);
                }
              }

              // Update progress within Step 4 (43-57%)
              processedQuestions++;
              await updateProgress(generationId, GenerationStatus.ANSWERING_QUESTIONS, calcProgress(4, processedQuestions / totalQuestions));

            } catch (error) {
              await addLog(generationId, 'warn', `⚠️ Error searching for answer: ${error instanceof Error ? error.message : 'Unknown error'}`);
              processedQuestions++;
            }

            // Small delay to avoid rate limiting
            await new Promise(resolve => setTimeout(resolve, 200));
          }

          // Update block with answered questions (remove unanswered ones)
          // Do NOT include source — AI should rephrase naturally without attribution
          const updatedBlock: ArticleBlock = {
            id: blockData.id,
            type: blockData.type,
            heading: blockData.heading,
            instruction: blockData.instruction,
            lsi: [...(blockData.lsi || [])],
            questions: answeredQuestions.length > 0
              ? answeredQuestions.map(aq => aq.question)
              : undefined,
            answeredQuestions: answeredQuestions.length > 0
              ? answeredQuestions.map(aq => ({
                  question: aq.question,
                  answer: aq.answer,
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

        await addLog(generationId, 'info', `🎯 Question answering complete! Found ${answeredCount}/${totalQuestions} answers (${perplexitySearchCount} via Perplexity)`);

      } catch (error) {
        await addLog(generationId, 'error', `❌ Question answering failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
        throw error;
      }

      // Log step duration
      const answersDuration = Date.now() - stepStartTime;
      await addLog(generationId, 'info', `⏱️ Question answering took ${formatDuration(answersDuration)}`);

      await addLog(generationId, 'info', '✅ Question answering completed. Continuing to article writing...');
    }

    // ========================================
    // STEP 5: Article Writing (Block by Block)
    // ========================================
    {
    stepStartTime = Date.now();

    // Get decrypted API keys
    const apiKeys = getDecryptedApiKeys(user);

    // Check OpenRouter API key
    if (!apiKeys.openRouter) {
      throw new Error('OpenRouter API key not configured');
    }

    await updateProgress(generationId, GenerationStatus.WRITING_ARTICLE, calcProgress(5, 0));
    await addLog(generationId, 'info', '📝 Starting article writing...');
    await addLog(generationId, 'thinking', 'Generating content block by block with accumulated context for style consistency...');

    // Reload generation to get latest blocks with answered questions
    const freshGeneration = await Generation.findById(generationId);
    if (!freshGeneration) throw new Error('Generation not found');
    if (!freshGeneration.articleBlocks || freshGeneration.articleBlocks.length === 0) {
      throw new Error('No article blocks found for writing');
    }

    const openRouter = new OpenRouterService(apiKeys.openRouter, aiModel);
    const totalBlocks = freshGeneration.articleBlocks.length;
    const configMinWords = freshGeneration.config.minWords || 1200;
    const configMaxWords = freshGeneration.config.maxWords || 1800;
    const targetWordCount = Math.round((configMinWords + configMaxWords) / 2);

    await addLog(generationId, 'info', `📊 Writing ${totalBlocks} blocks. Target: ${configMinWords}-${configMaxWords} words (~${targetWordCount} avg)`);

    try {
      // Accumulated article content for context
      let accumulatedContent = '';
      const updatedBlocks: ArticleBlock[] = [];

      // Process each block sequentially
      for (let i = 0; i < totalBlocks; i++) {
        const block = freshGeneration.articleBlocks[i] as ArticleBlock;

        // Calculate progress within Step 5 (57-71%)
        await updateProgress(generationId, GenerationStatus.WRITING_ARTICLE, calcProgress(5, i / totalBlocks));

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
        const cleanContent = stripLeadingHeading(block.content || '', block.heading);
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

      await addLog(generationId, 'info', '✅ Article writing completed. Continuing to link insertion...');

    } catch (error) {
      await addLog(generationId, 'error', `❌ Article writing failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
      throw error;
    }
    }

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
      await updateProgress(generationId, GenerationStatus.INSERTING_LINKS, calcProgress(6, 0));
      await addLog(generationId, 'info', `🔗 Starting internal link insertion (${internalLinks.length} links, 1 link = 1 AI call)...`);

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
        openRouterForLinks = new OpenRouterService(apiKeysForLinks.openRouter, aiModel);
        const blocksForLinks = genForLinks.articleBlocks as ArticleBlock[];

        // Step 6.1: Select which blocks should get which links (deterministic)
        await addLog(generationId, 'thinking', 'Selecting best block placement for each link...');

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

        await addLog(generationId, 'info', `📍 Block assignments: ${blockSelections.map(s => `Link ${s.linkIndex + 1} → Block #${s.blockId}`).join(', ')}`);

        // Step 6.2: Process links ONE AT A TIME
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

        let insertedCount = 0;

        for (const selection of blockSelections) {
          const originalLink = internalLinks[selection.linkIndex];
          const blockIndex = updatedBlocksWithLinks.findIndex(b => b.id === selection.blockId);

          if (blockIndex === -1) {
            await addLog(generationId, 'warn', `Block #${selection.blockId} not found for link ${selection.linkIndex + 1}`);
            continue;
          }

          const block = updatedBlocksWithLinks[blockIndex];
          if (!block.content) {
            await addLog(generationId, 'warn', `Block #${selection.blockId} has no content for link ${selection.linkIndex + 1}`);
            continue;
          }

          const linkInfo = {
            url: originalLink.url,
            anchor: selection.finalAnchor,
            isAnchorless: originalLink.isAnchorless,
            displayType: originalLink.displayType as 'inline' | 'list_end' | 'list_start' | 'sidebar',
          };

          // Update progress within Step 6 (71-86%)
          await updateProgress(generationId, GenerationStatus.INSERTING_LINKS, calcProgress(6, selection.linkIndex / internalLinks.length));

          await addLog(generationId, 'thinking', `Inserting link ${selection.linkIndex + 1}/${internalLinks.length}: [${linkInfo.anchor}](${linkInfo.url}) → Block #${block.id} "${block.heading}" (${linkInfo.displayType})...`);

          // Insert SINGLE link via AI
          const updatedContent = await openRouterForLinks.insertSingleLink(
            block.content,
            block.heading,
            linkInfo,
            generation.config.language
          );

          // Verify URL is present in updated content
          const urlVariants = [
            linkInfo.url,
            linkInfo.url.endsWith('/') ? linkInfo.url.slice(0, -1) : linkInfo.url + '/',
          ];
          const urlPresent = urlVariants.some(url => updatedContent.includes(url));

          if (urlPresent) {
            updatedBlocksWithLinks[blockIndex] = { ...block, content: updatedContent };
            insertedCount++;
            await addLog(generationId, 'info', `✅ Link ${selection.linkIndex + 1} inserted into Block #${block.id}`);
          } else {
            // This shouldn't happen since insertSingleLink force-appends, but just in case
            await addLog(generationId, 'warn', `⚠️ Link ${selection.linkIndex + 1} URL missing after insertion, using fallback`);
            const linkMd = `[${linkInfo.anchor}](${linkInfo.url})`;
            updatedBlocksWithLinks[blockIndex] = {
              ...block,
              content: block.content + `\n\n${linkMd}`,
            };
            insertedCount++;
          }

          // Small delay between AI calls
          await new Promise(resolve => setTimeout(resolve, 300));
        }

        // Rebuild final article with links
        let finalArticleWithLinks = '';
        for (const block of updatedBlocksWithLinks) {
          const cleanContent = stripLeadingHeading(block.content || '', block.heading);
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

        // Final verification: count all configured link URLs in the article
        const allLinkUrls = internalLinks.map(l => l.url);
        const presentInFinal = allLinkUrls.filter(url => {
          const urlWithoutSlash = url.endsWith('/') ? url.slice(0, -1) : url;
          const urlWithSlash = url.endsWith('/') ? url : url + '/';
          return finalArticleWithLinks.includes(urlWithoutSlash) || finalArticleWithLinks.includes(urlWithSlash);
        });

        if (presentInFinal.length === allLinkUrls.length) {
          await addLog(generationId, 'info', `✓ Final check: all ${allLinkUrls.length}/${allLinkUrls.length} links present in article`);
        } else {
          const missingUrls = allLinkUrls.filter(url => !presentInFinal.includes(url));
          await addLog(generationId, 'warn', `⚠️ Final check: ${presentInFinal.length}/${allLinkUrls.length} links present. Missing: ${missingUrls.join(', ')}`);
        }

        // Save updated article and blocks
        await Generation.findByIdAndUpdate(generationId, {
          article: finalArticleWithLinks,
          articleBlocks: updatedBlocksWithLinks,
        });

        // Emit updated blocks to frontend
        emitBlocks(generationId, updatedBlocksWithLinks);

        await addLog(generationId, 'info', `🎉 Link insertion complete! ${insertedCount}/${internalLinks.length} links inserted.`);

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
    {
      stepStartTime = Date.now();

      await updateProgress(generationId, GenerationStatus.REVIEWING_ARTICLE, calcProgress(7, 0));
      await addLog(generationId, 'info', '🔍 Starting article review and polish...');

      // Get decrypted API keys
      const apiKeysForReview = getDecryptedApiKeys(user);

      // Check OpenRouter API key
      if (!apiKeysForReview.openRouter) {
        throw new Error('OpenRouter API key not configured');
      }

      const openRouterForReview = new OpenRouterService(apiKeysForReview.openRouter, aiModel);

      // Reload generation to get latest blocks
      const genForReview = await Generation.findById(generationId);
      const blocksForReview = (genForReview?.articleBlocks || []) as ArticleBlock[];

      try {
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

        const configMinWords = generation.config.minWords || 1200;
        const configMaxWords = generation.config.maxWords || 1800;
        const configuredLinks = (generation.config.internalLinks || []).map(l => ({
          url: l.url,
          anchor: l.anchor,
        }));

        // Iterative review loop — continues until ALL checks pass (safety cap: 7)
        const MAX_ITERATIONS = 7;
        let reviewPassed = false;

        for (let iteration = 1; iteration <= MAX_ITERATIONS; iteration++) {
          // Update progress within Step 7 (86-100%)
          await updateProgress(generationId, GenerationStatus.REVIEWING_ARTICLE, calcProgress(7, (iteration - 1) / MAX_ITERATIONS));
          await addLog(generationId, 'info', `🔍 Review iteration ${iteration}/${MAX_ITERATIONS}...`);

          const review = await openRouterForReview.comprehensiveReview(
            reviewedBlocks.map(b => ({
              id: b.id,
              type: b.type as 'h1' | 'intro' | 'h2' | 'h3' | 'conclusion' | 'faq',
              heading: b.heading,
              content: b.content,
            })),
            configuredLinks,
            configMinWords,
            configMaxWords,
            generation.config.mainKeyword,
            generation.config.language,
            generation.config.articleType || 'informational',
            generation.config.comment
          );

          // Log check results
          await addLog(generationId, 'info', `  Word count: ${review.wordCountCheck.actual} words (${review.wordCountCheck.min}-${review.wordCountCheck.max}) ${review.wordCountCheck.passed ? '✅' : '❌'}`);
          if (configuredLinks.length > 0) {
            await addLog(generationId, 'info', `  Links: ${review.linkCountCheck.actual}/${review.linkCountCheck.expected} ${review.linkCountCheck.passed ? '✅' : '❌'}`);
          }
          await addLog(generationId, 'info', `  Link quality: ${review.linkQualityCheck.passed ? '✅' : `❌ (${review.linkQualityCheck.issues.length} issues)`}`);
          await addLog(generationId, 'info', `  Main keyword: ${review.keywordDensityCheck.count}/5 occurrences ${review.keywordDensityCheck.passed ? '✅' : '❌'}`);
          await addLog(generationId, 'info', `  Rhythm/quality: ${review.rhythmCheck.passed ? '✅' : `❌ (${review.rhythmCheck.blocksToFix.length} blocks)`}`);

          if (review.passed) {
            await addLog(generationId, 'info', `✅ All quality checks passed on iteration ${iteration}!`);
            reviewPassed = true;
            break;
          }

          await addLog(generationId, 'info', `📝 Fixing issues (iteration ${iteration})...`);

          // Helper: extract URLs from block content, fix, restore missing
          const fixBlockWithUrlProtection = async (
            block: { id: number; type: string; heading: string; content: string },
            issues: string[],
            suggestion: string,
            maxWords?: number
          ): Promise<string> => {
            const urlRegex = /\[([^\]]*)\]\(([^)]+)\)/g;
            const originalUrls: string[] = [];
            let match;
            while ((match = urlRegex.exec(block.content)) !== null) {
              originalUrls.push(match[2]);
            }

            const fixedContent = await openRouterForReview.fixBlockContent(
              { id: block.id, type: block.type, heading: block.heading, content: block.content },
              issues,
              suggestion,
              generation.config.language,
              generation.config.articleType || 'informational',
              generation.config.comment,
              maxWords
            );

            let finalContent = fixedContent;
            const missingUrls = originalUrls.filter(url => !fixedContent.includes(url));
            if (missingUrls.length > 0) {
              for (const url of missingUrls) {
                const linkMatch = block.content.match(new RegExp(`\\[([^\\]]*)\\]\\(${url.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\)`));
                if (linkMatch) {
                  // Insert link into a paragraph instead of appending standalone
                  const linkMarkdown = linkMatch[0];
                  const paragraphs = finalContent.split(/\n\n+/);
                  // Find the longest prose paragraph (not a heading, list, table)
                  let bestIdx = -1;
                  let bestLen = 0;
                  for (let i = 0; i < paragraphs.length; i++) {
                    const p = paragraphs[i].trim();
                    if (/^[#|>*\-\d]/.test(p)) continue; // skip headings, lists, tables
                    if (p.length > bestLen) { bestLen = p.length; bestIdx = i; }
                  }
                  if (bestIdx >= 0 && bestLen > 40) {
                    // Insert before the last punctuation in the paragraph
                    const p = paragraphs[bestIdx];
                    const punctMatch = p.match(/([.!?])\s*$/);
                    if (punctMatch) {
                      const lastIdx = p.lastIndexOf(punctMatch[1]);
                      paragraphs[bestIdx] = p.slice(0, lastIdx) + ` — ${linkMarkdown}` + punctMatch[1];
                    } else {
                      paragraphs[bestIdx] = p + ` — ${linkMarkdown}.`;
                    }
                    finalContent = paragraphs.join('\n\n');
                  } else {
                    // No suitable paragraph found — append as last resort
                    finalContent += `\n\n${linkMarkdown}`;
                  }
                }
              }
            }
            return finalContent;
          };

          // Calculate per-block word budget for the article
          const contentBlockCount = reviewedBlocks.filter(b => b.type === 'h2' || b.type === 'h3').length;
          const maxWordsPerBlock = contentBlockCount > 0
            ? Math.ceil(configMaxWords * 0.85 / contentBlockCount)
            : 300;

          // ========== 1. FIX RHYTHM FIRST (with word ceiling) ==========
          // Rhythm fixes go first because they rewrite blocks.
          // Each fix has a maxWords ceiling so it can't inflate the article.
          if (!review.rhythmCheck.passed) {
            for (const issue of review.rhythmCheck.blocksToFix) {
              const blockIndex = reviewedBlocks.findIndex(b => b.id === issue.blockId);
              if (blockIndex === -1 || !reviewedBlocks[blockIndex].content) continue;
              const block = reviewedBlocks[blockIndex];
              const currentWordCount = block.content.split(/\s+/).length;
              // Ceiling: current words or max per block, whichever is SMALLER (never grow)
              const ceiling = Math.min(currentWordCount, maxWordsPerBlock);

              await addLog(generationId, 'thinking', `Fixing rhythm in Block #${block.id} (max ${ceiling} words): ${issue.issues.join(', ')}`);
              reviewedBlocks[blockIndex].content = await fixBlockWithUrlProtection(
                { id: block.id, type: block.type, heading: block.heading, content: block.content },
                issue.issues,
                issue.suggestion,
                ceiling
              );
            }
          }

          // ========== 2. FIX LINKS ==========
          if (!review.linkCountCheck.passed && review.linkCountCheck.missingUrls.length > 0) {
            await addLog(generationId, 'thinking', `Re-inserting ${review.linkCountCheck.missingUrls.length} missing link(s)...`);
            for (const missingUrl of review.linkCountCheck.missingUrls) {
              const linkConfig = (generation.config.internalLinks || []).find(l => l.url === missingUrl);
              if (!linkConfig) continue;
              const suitableBlocks = reviewedBlocks.filter(b =>
                b.type === 'h2' || b.type === 'h3' || b.type === 'intro' || b.type === 'conclusion'
              ).filter(b => b.content && !b.content.includes(missingUrl));
              if (suitableBlocks.length > 0) {
                const targetBlock = suitableBlocks[0];
                const blockIndex = reviewedBlocks.findIndex(b => b.id === targetBlock.id);
                const anchor = linkConfig.isAnchorless ? linkConfig.url : (linkConfig.anchor || linkConfig.url);
                reviewedBlocks[blockIndex].content = await openRouterForReview.insertSingleLink(
                  targetBlock.content, targetBlock.heading,
                  { url: linkConfig.url, anchor, isAnchorless: linkConfig.isAnchorless, displayType: linkConfig.displayType as 'inline' | 'list_end' | 'list_start' | 'sidebar' },
                  generation.config.language
                );
                await addLog(generationId, 'info', `  Re-inserted: ${linkConfig.url} → Block #${targetBlock.id}`);
              }
            }
          }

          // ========== 3. FIX LINK QUALITY ==========
          if (!review.linkQualityCheck.passed) {
            for (const issue of review.linkQualityCheck.issues) {
              const blockIndex = reviewedBlocks.findIndex(b => b.id === issue.blockId);
              if (blockIndex === -1 || !reviewedBlocks[blockIndex].content) continue;
              const block = reviewedBlocks[blockIndex];
              const currentWordCount = block.content.split(/\s+/).length;
              await addLog(generationId, 'thinking', `Fixing link quality in Block #${block.id}: ${issue.issue}`);
              reviewedBlocks[blockIndex].content = await fixBlockWithUrlProtection(
                { id: block.id, type: block.type, heading: block.heading, content: block.content },
                [issue.issue],
                'Remove quotes around links. Make link anchors flow naturally in the sentence.',
                currentWordCount // Don't grow
              );
            }
          }

          // ========== 4. FIX KEYWORD DENSITY ==========
          if (!review.keywordDensityCheck.passed) {
            const keyword = generation.config.mainKeyword.toLowerCase();
            const blocksWithDensity = reviewedBlocks
              .filter(b => b.content && b.type !== 'h1')
              .map(b => {
                const text = b.content!.toLowerCase();
                let count = 0; let idx = 0;
                while ((idx = text.indexOf(keyword, idx)) !== -1) { count++; idx += keyword.length; }
                return { ...b, keywordCount: count };
              })
              .filter(b => b.keywordCount > 1)
              .sort((a, b) => b.keywordCount - a.keywordCount);

            for (const block of blocksWithDensity.slice(0, 2)) {
              const blockIndex = reviewedBlocks.findIndex(b => b.id === block.id);
              if (blockIndex === -1) continue;
              const currentWordCount = block.content!.split(/\s+/).length;
              await addLog(generationId, 'thinking', `Reducing main keyword in Block #${block.id} (${block.keywordCount} occurrences)...`);
              reviewedBlocks[blockIndex].content = await fixBlockWithUrlProtection(
                { id: block.id, type: block.type, heading: block.heading, content: block.content! },
                [`Main keyword "${generation.config.mainKeyword}" appears ${block.keywordCount} times — too many. Replace with synonyms/pronouns.`],
                `Max 1 occurrence per block. Use synonyms. Never raw keywords or quotes.`,
                currentWordCount
              );
            }
          }

          // ========== 5. FIX WORD COUNT LAST (after all other fixes) ==========
          if (!review.wordCountCheck.passed) {
            // Determine which blocks contain internal links — these are PROTECTED from trimming/expanding
            const allLinkUrls = (generation.config.internalLinks || []).map(l => l.url);
            const blockIdsWithLinks = new Set<number>();
            for (const block of reviewedBlocks) {
              if (block.content && allLinkUrls.some(url => block.content!.includes(url))) {
                blockIdsWithLinks.add(block.id);
              }
            }
            if (blockIdsWithLinks.size > 0) {
              await addLog(generationId, 'info', `  🔒 Blocks with links (protected from trim/expand): ${[...blockIdsWithLinks].map(id => `#${id}`).join(', ')}`);
            }

            // Recount words after all fixes above
            const currentTotal = reviewedBlocks
              .filter(b => b.content && b.type !== 'h1')
              .reduce((sum, b) => sum + (b.content?.split(/\s+/).length || 0), 0);

            if (currentTotal < configMinWords) {
              const contentBlocks = reviewedBlocks
                .filter(b => (b.type === 'h2' || b.type === 'h3') && !blockIdsWithLinks.has(b.id))
                .sort((a, b) => (a.content?.length || 0) - (b.content?.length || 0));
              const wordsNeeded = configMinWords - currentTotal;
              const blocksToExpand = contentBlocks.slice(0, Math.min(3, contentBlocks.length));
              const extraPerBlock = Math.ceil(wordsNeeded / blocksToExpand.length);

              for (const block of blocksToExpand) {
                const blockIndex = reviewedBlocks.findIndex(b => b.id === block.id);
                if (blockIndex === -1 || !block.content) continue;
                await addLog(generationId, 'thinking', `Expanding Block #${block.id} by ~${extraPerBlock} words...`);
                reviewedBlocks[blockIndex].content = await openRouterForReview.fixBlockContent(
                  { id: block.id, type: block.type, heading: block.heading, content: block.content },
                  [`Too short. Add ~${extraPerBlock} words of substantive content.`],
                  `Expand with details or examples.`,
                  generation.config.language,
                  generation.config.articleType || 'informational',
                  generation.config.comment
                );
              }
            } else if (currentTotal > configMaxWords) {
              // Smart AI-driven trimming: AI decides which blocks to shorten (blocks with links are protected)
              await addLog(generationId, 'thinking', `Article is ${currentTotal} words (max ${configMaxWords}). AI choosing which blocks to trim (${blockIdsWithLinks.size} blocks protected)...`);
              const trimPlan = await openRouterForReview.smartTrimArticle(
                reviewedBlocks.map(b => ({ id: b.id, type: b.type, heading: b.heading, content: b.content })),
                currentTotal,
                configMaxWords,
                generation.config.language,
                blockIdsWithLinks
              );

              if (trimPlan.length > 0) {
                for (const plan of trimPlan) {
                  const blockIndex = reviewedBlocks.findIndex(b => b.id === plan.blockId);
                  if (blockIndex === -1 || !reviewedBlocks[blockIndex].content) continue;
                  const block = reviewedBlocks[blockIndex];
                  const blockWords = block.content!.split(/\s+/).length;
                  await addLog(generationId, 'thinking', `Trimming Block #${block.id}: ${blockWords} → ${plan.targetWords} words (${plan.reason})`);
                  reviewedBlocks[blockIndex].content = await fixBlockWithUrlProtection(
                    { id: block.id, type: block.type, heading: block.heading, content: block.content! },
                    [`Reduce to ${plan.targetWords} words. ${plan.reason}`],
                    `Be concise. Keep expert data and specific facts. Remove filler and redundancy.`,
                    plan.targetWords
                  );
                }
              } else {
                // Fallback: trim the 2 longest blocks WITHOUT links
                await addLog(generationId, 'thinking', `Smart trim returned empty, falling back to longest blocks (excluding link blocks)...`);
                const longestBlocks = reviewedBlocks
                  .filter(b => (b.type === 'h2' || b.type === 'h3') && !blockIdsWithLinks.has(b.id))
                  .sort((a, b) => (b.content?.length || 0) - (a.content?.length || 0))
                  .slice(0, 2);
                for (const block of longestBlocks) {
                  const blockIndex = reviewedBlocks.findIndex(b => b.id === block.id);
                  if (blockIndex === -1 || !block.content) continue;
                  const blockWords = block.content.split(/\s+/).length;
                  const targetBlockWords = Math.round(blockWords * 0.8);
                  reviewedBlocks[blockIndex].content = await fixBlockWithUrlProtection(
                    { id: block.id, type: block.type, heading: block.heading, content: block.content },
                    [`Reduce from ${blockWords} to ~${targetBlockWords} words. Remove filler, keep facts.`],
                    `Be concise. Preserve all links and expert data.`,
                    targetBlockWords
                  );
                }
              }
            }
          }

          // Save progress after each iteration
          await Generation.findByIdAndUpdate(generationId, {
            articleBlocks: reviewedBlocks,
          });
          emitBlocks(generationId, reviewedBlocks);

          await addLog(generationId, 'info', `✅ Iteration ${iteration} fixes applied.`);
        }

        if (!reviewPassed) {
          await addLog(generationId, 'warn', `⚠️ Article did not pass all checks after ${MAX_ITERATIONS} iterations. Delivering best result achieved.`);
        } else {
          await addLog(generationId, 'info', `✅ All quality checks passed! Article is ready.`);
        }

        // Assemble final article
        let finalReviewedArticle = '';
        for (const block of reviewedBlocks) {
          const cleanContent = stripLeadingHeading(block.content || '', block.heading);
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

        // Generate SEO metadata
        await updateProgress(generationId, GenerationStatus.REVIEWING_ARTICLE, calcProgress(7, 0.9));
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

        // Save final results
        await Generation.findByIdAndUpdate(generationId, {
          article: finalReviewedArticle,
          articleBlocks: reviewedBlocks,
          seoTitle: seoMetadata.title,
          seoDescription: seoMetadata.description,
        });

        // Emit updated blocks
        emitBlocks(generationId, reviewedBlocks);

        // Log step duration and token usage
        const reviewDuration = Date.now() - stepStartTime;
        const reviewTokens = openRouterForReview.getTokenUsage(true);
        totalPromptTokens += reviewTokens.promptTokens;
        totalCompletionTokens += reviewTokens.completionTokens;
        totalTokens += reviewTokens.totalTokens;
        await addLog(generationId, 'info', `⏱️ Article review took ${formatDuration(reviewDuration)} | 🎯 ${reviewTokens.totalTokens.toLocaleString()} tokens`);

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
  // Remove any existing job with this ID (from previous run / restart)
  // Bull rejects duplicate jobIds silently, so we must clean up first
  const existingJob = await generationQueue.getJob(generationId);
  if (existingJob) {
    try {
      await existingJob.remove();
      logger.info(`Removed existing job for generation ${generationId}`);
    } catch (err) {
      // Job might be active — can't remove, but that's fine for new queue attempt
      logger.warn(`Could not remove existing job ${generationId}: ${(err as Error).message}`);
    }
  }

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

