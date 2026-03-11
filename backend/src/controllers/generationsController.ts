/**
 * Generations Controller
 * Handles article generation operations
 * @module controllers/generationsController
 */

import { Response } from 'express';
import { Generation, Project, User } from '../models/index.js';
import { AuthenticatedRequest, ApiResponse, GenerationStatus } from '../types/index.js';
import { AppError } from '../middleware/errorHandler.js';
import { queueGeneration, getQueueStats } from '../queues/generationQueue.js';
import { queueEntityGeneration } from '../queues/entityGenerationQueue.js';
import { logger } from '../utils/logger.js';
import { publishSocketEvent } from '../utils/redis.js';
import { assembleArticleFromBlocks } from '../utils/articleAssembly.js';
import { OpenRouterService } from '../services/OpenRouterService.js';
import { decrypt } from '../services/CryptoService.js';

/**
 * Create new generation
 * POST /api/projects/:projectId/generations
 */
export const createGeneration = async (
  req: AuthenticatedRequest,
  res: Response<ApiResponse>
) => {
  try {
    const userId = req.user?.userId;
    const { projectId } = req.params;
    const {
      mainKeyword,
      articleType,
      keywords,
      language,
      region,
      lsiKeywords,
      comment,
      internalLinks,
      linksAsList,
      linksListPosition,
      minWords,
      maxWords,
      model,
      mode,
      audience,
      mustCover,
      mustAvoid,
    } = req.body;

    if (!userId) {
      throw new AppError('User not found', 404);
    }

    // Verify project exists and belongs to user
    const project = await Project.findOne({ _id: projectId, userId });
    if (!project) {
      throw new AppError('Project not found', 404);
    }

    // Check if Firecrawl is configured
    const user = await User.findById(userId);
    if (!user?.apiKeys?.firecrawl?.apiKey) {
      throw new AppError('Firecrawl API key is not configured. Please set it in settings.', 400);
    }

    if (!mainKeyword) {
      throw new AppError('Main keyword is required', 400);
    }

    // Create generation document
    const generation = await Generation.create({
      projectId,
      userId,
      config: {
        mainKeyword,
        articleType: articleType || 'informational',
        keywords: keywords || [],
        language: language || 'en',
        region: region || 'us',
        lsiKeywords: lsiKeywords || [],
        comment,
        internalLinks: internalLinks || [],
        linksAsList: linksAsList || false,
        linksListPosition,
        minWords: Math.max(500, Math.min(5000, Number(minWords) || 1200)),
        maxWords: Math.max(700, Math.min(8000, Number(maxWords) || 1800)),
        model: model || 'openai/gpt-5.2',
        mode: mode === 'v2' ? 'v2' : 'v1',
        // v2-only directives (stored as-is, ignored by v1 pipeline)
        audience: audience || undefined,
        mustCover: Array.isArray(mustCover) ? mustCover.filter(Boolean) : [],
        mustAvoid: Array.isArray(mustAvoid) ? mustAvoid.filter(Boolean) : [],
      },
      status: GenerationStatus.QUEUED,
      progress: 0,
      logs: [{
        timestamp: new Date(),
        level: 'info',
        message: mode === 'v2' ? 'Generation 2.0 created and queued (entity pipeline)' : 'Generation created and queued',
      }],
    });

    // Route to appropriate queue based on mode
    if (mode === 'v2') {
      await queueEntityGeneration(generation._id.toString(), userId);
    } else {
      await queueGeneration(generation._id.toString(), userId);
    }

    logger.info(`Generation created: ${generation._id}`);

    res.status(201).json({
      success: true,
      data: {
        id: generation._id,
        projectId: generation.projectId,
        status: generation.status,
        config: generation.config,
        createdAt: generation.createdAt,
      },
      message: 'Generation started',
    });
  } catch (error) {
    if (error instanceof AppError) {
      res.status(error.statusCode).json({ success: false, error: error.message });
    } else {
      logger.error('Create generation error', { error });
      res.status(500).json({ success: false, error: 'Failed to create generation' });
    }
  }
};

/**
 * Get all generations for a project
 * GET /api/projects/:projectId/generations
 */
export const getProjectGenerations = async (
  req: AuthenticatedRequest,
  res: Response<ApiResponse>
) => {
  try {
    const userId = req.user?.userId;
    const { projectId } = req.params;

    if (!userId) {
      throw new AppError('User not found', 404);
    }

    // Verify project exists and belongs to user
    const project = await Project.findOne({ _id: projectId, userId });
    if (!project) {
      throw new AppError('Project not found', 404);
    }

    const generations = await Generation.find({ projectId })
      .select('-logs -serpResults')
      .sort({ createdAt: -1 })
      .lean();

    res.json({
      success: true,
      data: generations,
    });
  } catch (error) {
    if (error instanceof AppError) {
      res.status(error.statusCode).json({ success: false, error: error.message });
    } else {
      logger.error('Get project generations error', { error });
      res.status(500).json({ success: false, error: 'Failed to get generations' });
    }
  }
};

/**
 * Get single generation with full details
 * GET /api/generations/:id
 */
export const getGeneration = async (
  req: AuthenticatedRequest,
  res: Response<ApiResponse>
) => {
  try {
    const userId = req.user?.userId;
    const { id } = req.params;

    if (!userId) {
      throw new AppError('User not found', 404);
    }

    const generation = await Generation.findOne({ _id: id, userId })
      .populate('projectId', 'name')
      .lean();

    if (!generation) {
      throw new AppError('Generation not found', 404);
    }

    res.json({
      success: true,
      data: generation,
    });
  } catch (error) {
    if (error instanceof AppError) {
      res.status(error.statusCode).json({ success: false, error: error.message });
    } else {
      logger.error('Get generation error', { error });
      res.status(500).json({ success: false, error: 'Failed to get generation' });
    }
  }
};

/**
 * Get generation logs only (for real-time updates)
 * GET /api/generations/:id/logs
 */
export const getGenerationLogs = async (
  req: AuthenticatedRequest,
  res: Response<ApiResponse>
) => {
  try {
    const userId = req.user?.userId;
    const { id } = req.params;
    const { since } = req.query;

    if (!userId) {
      throw new AppError('User not found', 404);
    }

    const generation = await Generation.findOne(
      { _id: id, userId },
      { logs: 1, status: 1, progress: 1 }
    ).lean();

    if (!generation) {
      throw new AppError('Generation not found', 404);
    }

    // Filter logs if 'since' timestamp provided
    let logs = generation.logs || [];
    if (since) {
      const sinceDate = new Date(since as string);
      logs = logs.filter(log => new Date(log.timestamp) > sinceDate);
    }

    res.json({
      success: true,
      data: {
        logs,
        status: generation.status,
        progress: generation.progress,
      },
    });
  } catch (error) {
    if (error instanceof AppError) {
      res.status(error.statusCode).json({ success: false, error: error.message });
    } else {
      logger.error('Get generation logs error', { error });
      res.status(500).json({ success: false, error: 'Failed to get generation logs' });
    }
  }
};

/**
 * Delete generation
 * DELETE /api/generations/:id
 */
export const deleteGeneration = async (
  req: AuthenticatedRequest,
  res: Response<ApiResponse>
) => {
  try {
    const userId = req.user?.userId;
    const { id } = req.params;

    if (!userId) {
      throw new AppError('User not found', 404);
    }

    const generation = await Generation.findOneAndDelete({ _id: id, userId });

    if (!generation) {
      throw new AppError('Generation not found', 404);
    }

    logger.info(`Generation deleted: ${id}`);

    res.json({
      success: true,
      message: 'Generation deleted successfully',
    });
  } catch (error) {
    if (error instanceof AppError) {
      res.status(error.statusCode).json({ success: false, error: error.message });
    } else {
      logger.error('Delete generation error', { error });
      res.status(500).json({ success: false, error: 'Failed to delete generation' });
    }
  }
};

/**
 * Get queue statistics
 * GET /api/generations/queue/stats
 */
export const getQueueStatistics = async (
  req: AuthenticatedRequest,
  res: Response<ApiResponse>
) => {
  try {
    const stats = await getQueueStats();

    res.json({
      success: true,
      data: stats,
    });
  } catch (error) {
    logger.error('Get queue stats error', { error });
    res.status(500).json({ success: false, error: 'Failed to get queue statistics' });
  }
};

/**
 * Get all user generations (across all projects)
 * GET /api/generations
 */
export const getAllGenerations = async (
  req: AuthenticatedRequest,
  res: Response<ApiResponse>
) => {
  try {
    const userId = req.user?.userId;
    const { status, limit = 20, offset = 0 } = req.query;

    if (!userId) {
      throw new AppError('User not found', 404);
    }

    const query: Record<string, unknown> = { userId };
    if (status) {
      query.status = status;
    }

    const generations = await Generation.find(query)
      .select('-logs -serpResults')
      .populate('projectId', 'name')
      .sort({ updatedAt: -1 })
      .skip(Number(offset))
      .limit(Number(limit))
      .lean();

    const total = await Generation.countDocuments(query);

    res.json({
      success: true,
      data: {
        generations,
        total,
        limit: Number(limit),
        offset: Number(offset),
      },
    });
  } catch (error) {
    if (error instanceof AppError) {
      res.status(error.statusCode).json({ success: false, error: error.message });
    } else {
      logger.error('Get all generations error', { error });
      res.status(500).json({ success: false, error: 'Failed to get generations' });
    }
  }
};

/**
 * Restart a failed or completed generation from scratch
 * Clears all intermediate data and starts fresh
 */
export const restartGenerationHandler = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { id } = req.params;
    const userId = req.user?.userId;

    if (!userId) {
      throw new AppError('User not found', 404);
    }

    // Verify generation exists and belongs to user
    const generation = await Generation.findOne({ _id: id, userId });
    if (!generation) {
      throw new AppError('Generation not found', 404);
    }

    // Check if generation is in a restartable state (failed or completed)
    const restartableStates = [
      GenerationStatus.FAILED,
      GenerationStatus.COMPLETED,
    ];

    if (!restartableStates.includes(generation.status as GenerationStatus)) {
      throw new AppError(
        `Cannot restart: generation is in "${generation.status}" state`,
        400
      );
    }

    const previousStatus = generation.status;
    const { model } = req.body || {};

    // Build update object
    const updateFields: Record<string, unknown> = {
      status: GenerationStatus.QUEUED,
      progress: 0,
      currentStep: 'queued',
      serpResults: [],
      structureAnalysis: null,
      articleBlocks: [],
      averageWordCount: null,
      generatedArticle: null,
      article: null,
      seoTitle: null,
      seoDescription: null,
      seoTitleHistory: [],
      seoDescriptionHistory: [],
      tokenUsage: null,
      modelPricing: null,
      firecrawlCredits: null,
      error: null,
      logs: [
        {
          timestamp: new Date(),
          level: 'info',
          message: `🔄 Restarting generation from scratch (previous status: ${previousStatus})${model ? `, model: ${model}` : ''}...`,
        },
      ],
    };

    // If a new model is provided, update it in config
    if (model) {
      updateFields['config.model'] = model;
    }

    await Generation.findByIdAndUpdate(id, { $set: updateFields });

    // Queue generation with original config
    await queueGeneration(id, userId);

    logger.info(`Generation restarted: ${id} (was: ${previousStatus})`);

    res.json({
      success: true,
      message: 'Generation restarted from beginning',
      data: {
        id: generation._id,
        previousStatus,
      },
    });
  } catch (error) {
    if (error instanceof AppError) {
      res.status(error.statusCode).json({ success: false, error: error.message });
    } else {
      logger.error('Restart generation error', { error });
      res.status(500).json({ success: false, error: 'Failed to restart generation' });
    }
  }
};

/**
 * Edit a single block with AI based on user's prompt
 * POST /api/generations/:id/edit-block
 */
export const editBlock = async (req: AuthenticatedRequest, res: Response<ApiResponse>) => {
  try {
    const { id } = req.params;
    const userId = req.user?.userId;
    const { blockId, prompt } = req.body;

    if (!userId) throw new AppError('User not found', 404);
    if (blockId === undefined || !prompt) {
      throw new AppError('blockId and prompt are required', 400);
    }

    // Find generation (must be completed)
    const generation = await Generation.findOne({ _id: id, userId });
    if (!generation) throw new AppError('Generation not found', 404);
    if (generation.status !== GenerationStatus.COMPLETED) {
      throw new AppError('Can only edit blocks on completed generations', 400);
    }

    // Convert Mongoose subdocs to plain objects (spread breaks nested arrays)
    const blocks = (generation.toObject().articleBlocks || []) as Array<{
      id: number; type: string; heading: string; instruction: string;
      lsi: string[]; questions: string[]; answeredQuestions: unknown[];
      content?: string;
    }>;
    const targetBlock = blocks.find(b => b.id === blockId);
    if (!targetBlock || !targetBlock.content) {
      throw new AppError(`Block ${blockId} not found or has no content`, 404);
    }

    // Get user's OpenRouter key
    const user = await User.findById(userId);
    if (!user?.apiKeys?.openRouter?.apiKey) {
      throw new AppError('OpenRouter API key not configured', 400);
    }
    const openRouterKey = decrypt(user.apiKeys.openRouter.apiKey);
    const model = generation.config.model || 'openai/gpt-4o';

    const room = `generation:${id}`;
    const wordsBefore = targetBlock.content.split(/\s+/).filter(w => w.length > 0).length;

    // Emit start log
    const startLog = {
      timestamp: new Date(),
      level: 'info',
      message: `✏️ Editing block #${blockId} "${targetBlock.heading}" with AI...`,
    };
    await publishSocketEvent(room, 'generation:log', { generationId: id, log: startLog });

    // Call AI
    const openRouter = new OpenRouterService(openRouterKey, model);
    const editedContent = await openRouter.editBlockContent(
      { id: targetBlock.id, type: targetBlock.type, heading: targetBlock.heading, content: targetBlock.content },
      blocks.map(b => ({ id: b.id, type: b.type, heading: b.heading, content: b.content })),
      prompt,
      generation.config.language,
      generation.config.articleType || 'informational',
      generation.config.comment
    );

    const usage = openRouter.getTokenUsage();
    const wordsAfter = editedContent.split(/\s+/).filter(w => w.length > 0).length;

    // Version history: push current content before replacing
    const currentHistory = (targetBlock as Record<string, unknown>).contentHistory as string[] || [];
    let newHistory: string[];
    if (currentHistory.length === 0) {
      newHistory = [targetBlock.content!];                    // first edit → save original
    } else if (currentHistory.length < 2) {
      newHistory = [...currentHistory, targetBlock.content!]; // second edit → [original, prev]
    } else {
      newHistory = [currentHistory[0], targetBlock.content!]; // 3rd+ → keep original, replace prev
    }

    // Update block content (already plain objects from toObject())
    const updatedBlocks = blocks.map(b =>
      b.id === blockId ? { ...b, content: editedContent, contentHistory: newHistory } : b
    );

    // Reassemble article
    const updatedArticle = assembleArticleFromBlocks(updatedBlocks);

    // Save to DB
    const completedLog = {
      timestamp: new Date(),
      level: 'info',
      message: `✅ Block #${blockId} "${targetBlock.heading}" edited: ${wordsBefore}→${wordsAfter} words | ${usage.totalTokens.toLocaleString()} tokens (${usage.promptTokens.toLocaleString()}+${usage.completionTokens.toLocaleString()})`,
    };

    await Generation.findByIdAndUpdate(id, {
      $set: {
        articleBlocks: updatedBlocks,
        article: updatedArticle,
        generatedArticle: updatedArticle,
      },
      $inc: {
        'tokenUsage.promptTokens': usage.promptTokens,
        'tokenUsage.completionTokens': usage.completionTokens,
        'tokenUsage.totalTokens': usage.totalTokens,
      },
      $push: { logs: { $each: [startLog, completedLog] } },
    });

    // Emit updates via Socket.IO
    await publishSocketEvent(room, 'generation:blocks', { generationId: id, blocks: updatedBlocks });
    await publishSocketEvent(room, 'generation:log', { generationId: id, log: completedLog });

    res.json({
      success: true,
      data: {
        blockId,
        block: updatedBlocks.find(b => b.id === blockId),
        article: updatedArticle,
      },
    });
  } catch (error) {
    if (error instanceof AppError) {
      res.status(error.statusCode).json({ success: false, error: error.message });
    } else {
      logger.error('Edit block error', { error });
      res.status(500).json({ success: false, error: 'Failed to edit block' });
    }
  }
};

/**
 * Edit SEO metadata with AI based on user's prompt
 * POST /api/generations/:id/edit-seo
 */
export const editSeo = async (req: AuthenticatedRequest, res: Response<ApiResponse>) => {
  try {
    const { id } = req.params;
    const userId = req.user?.userId;
    const { prompt } = req.body;

    if (!userId) throw new AppError('User not found', 404);
    if (!prompt) throw new AppError('prompt is required', 400);

    const generation = await Generation.findOne({ _id: id, userId });
    if (!generation) throw new AppError('Generation not found', 404);
    if (generation.status !== GenerationStatus.COMPLETED) {
      throw new AppError('Can only edit SEO on completed generations', 400);
    }

    const user = await User.findById(userId);
    if (!user?.apiKeys?.openRouter?.apiKey) {
      throw new AppError('OpenRouter API key not configured', 400);
    }
    const openRouterKey = decrypt(user.apiKeys.openRouter.apiKey);
    const model = generation.config.model || 'openai/gpt-4o';

    const room = `generation:${id}`;

    const startLog = {
      timestamp: new Date(),
      level: 'info',
      message: '✏️ Regenerating SEO metadata with AI...',
    };
    await publishSocketEvent(room, 'generation:log', { generationId: id, log: startLog });

    const openRouter = new OpenRouterService(openRouterKey, model);
    const article = generation.article || generation.generatedArticle || '';
    const { title, description } = await openRouter.editSeoMetadata(
      article,
      generation.seoTitle || '',
      generation.seoDescription || '',
      generation.config.mainKeyword,
      prompt,
      generation.config.language,
      generation.config.articleType || 'informational',
      generation.config.comment
    );

    const usage = openRouter.getTokenUsage();

    // SEO version history
    const genObj = generation.toObject();
    const oldTitle = generation.seoTitle || '';
    const oldDesc = generation.seoDescription || '';

    const titleHist = (genObj.seoTitleHistory || []) as string[];
    const newTitleHist = titleHist.length === 0 ? [oldTitle]
      : titleHist.length < 2 ? [...titleHist, oldTitle]
      : [titleHist[0], oldTitle];

    const descHist = (genObj.seoDescriptionHistory || []) as string[];
    const newDescHist = descHist.length === 0 ? [oldDesc]
      : descHist.length < 2 ? [...descHist, oldDesc]
      : [descHist[0], oldDesc];

    const completedLog = {
      timestamp: new Date(),
      level: 'info',
      message: `✅ SEO metadata updated: "${title}" (${title.length}/60) | ${usage.totalTokens.toLocaleString()} tokens (${usage.promptTokens.toLocaleString()}+${usage.completionTokens.toLocaleString()})`,
    };

    await Generation.findByIdAndUpdate(id, {
      $set: {
        seoTitle: title,
        seoDescription: description,
        seoTitleHistory: newTitleHist,
        seoDescriptionHistory: newDescHist,
      },
      $inc: {
        'tokenUsage.promptTokens': usage.promptTokens,
        'tokenUsage.completionTokens': usage.completionTokens,
        'tokenUsage.totalTokens': usage.totalTokens,
      },
      $push: { logs: { $each: [startLog, completedLog] } },
    });

    await publishSocketEvent(room, 'generation:log', { generationId: id, log: completedLog });
    await publishSocketEvent(room, 'generation:seo', {
      generationId: id, seoTitle: title, seoDescription: description,
      seoTitleHistory: newTitleHist, seoDescriptionHistory: newDescHist,
    });

    res.json({
      success: true,
      data: { seoTitle: title, seoDescription: description },
    });
  } catch (error) {
    if (error instanceof AppError) {
      res.status(error.statusCode).json({ success: false, error: error.message });
    } else {
      logger.error('Edit SEO error', { error });
      res.status(500).json({ success: false, error: 'Failed to edit SEO metadata' });
    }
  }
};

/**
 * Revert a block to a previous version
 * POST /api/generations/:id/revert-block
 */
export const revertBlock = async (req: AuthenticatedRequest, res: Response<ApiResponse>) => {
  try {
    const { id } = req.params;
    const userId = req.user?.userId;
    const { blockId, mode } = req.body;

    if (!userId) throw new AppError('User not found', 404);
    if (blockId === undefined || !mode) throw new AppError('blockId and mode required', 400);
    if (!['previous', 'original'].includes(mode)) throw new AppError('mode must be previous or original', 400);

    const generation = await Generation.findOne({ _id: id, userId });
    if (!generation) throw new AppError('Generation not found', 404);
    if (generation.status !== GenerationStatus.COMPLETED) {
      throw new AppError('Can only revert blocks on completed generations', 400);
    }

    const blocks = (generation.toObject().articleBlocks || []) as Array<{
      id: number; type: string; heading: string; instruction: string;
      lsi: string[]; questions: string[]; answeredQuestions: unknown[];
      content?: string; contentHistory?: string[];
    }>;
    const targetBlock = blocks.find(b => b.id === blockId);
    if (!targetBlock) throw new AppError(`Block ${blockId} not found`, 404);

    const history = targetBlock.contentHistory || [];
    if (history.length === 0) throw new AppError('No version history for this block', 400);

    let revertedContent: string;
    let newHistory: string[];

    if (mode === 'original') {
      revertedContent = history[0];
      newHistory = [];
    } else {
      revertedContent = history[history.length - 1];
      newHistory = history.slice(0, -1);
    }

    const updatedBlocks = blocks.map(b =>
      b.id === blockId ? { ...b, content: revertedContent, contentHistory: newHistory } : b
    );
    const updatedArticle = assembleArticleFromBlocks(updatedBlocks);

    const log = {
      timestamp: new Date(),
      level: 'info' as const,
      message: `↩️ Block #${blockId} "${targetBlock.heading}" reverted to ${mode} version`,
    };

    await Generation.findByIdAndUpdate(id, {
      $set: { articleBlocks: updatedBlocks, article: updatedArticle, generatedArticle: updatedArticle },
      $push: { logs: log },
    });

    const room = `generation:${id}`;
    await publishSocketEvent(room, 'generation:blocks', { generationId: id, blocks: updatedBlocks });
    await publishSocketEvent(room, 'generation:log', { generationId: id, log });

    res.json({ success: true, data: { blockId, block: updatedBlocks.find(b => b.id === blockId), article: updatedArticle } });
  } catch (error) {
    if (error instanceof AppError) {
      res.status(error.statusCode).json({ success: false, error: error.message });
    } else {
      logger.error('Revert block error', { error });
      res.status(500).json({ success: false, error: 'Failed to revert block' });
    }
  }
};

/**
 * Revert SEO metadata to a previous version
 * POST /api/generations/:id/revert-seo
 */
export const revertSeo = async (req: AuthenticatedRequest, res: Response<ApiResponse>) => {
  try {
    const { id } = req.params;
    const userId = req.user?.userId;
    const { mode } = req.body;

    if (!userId) throw new AppError('User not found', 404);
    if (!mode) throw new AppError('mode required', 400);
    if (!['previous', 'original'].includes(mode)) throw new AppError('mode must be previous or original', 400);

    const generation = await Generation.findOne({ _id: id, userId });
    if (!generation) throw new AppError('Generation not found', 404);
    if (generation.status !== GenerationStatus.COMPLETED) {
      throw new AppError('Can only revert SEO on completed generations', 400);
    }

    const genObj = generation.toObject();
    const updates: Record<string, unknown> = {};

    const titleHist = (genObj.seoTitleHistory || []) as string[];
    if (titleHist.length > 0) {
      if (mode === 'original') {
        updates.seoTitle = titleHist[0];
        updates.seoTitleHistory = [];
      } else {
        updates.seoTitle = titleHist[titleHist.length - 1];
        updates.seoTitleHistory = titleHist.slice(0, -1);
      }
    }

    const descHist = (genObj.seoDescriptionHistory || []) as string[];
    if (descHist.length > 0) {
      if (mode === 'original') {
        updates.seoDescription = descHist[0];
        updates.seoDescriptionHistory = [];
      } else {
        updates.seoDescription = descHist[descHist.length - 1];
        updates.seoDescriptionHistory = descHist.slice(0, -1);
      }
    }

    if (Object.keys(updates).length === 0) {
      throw new AppError('No SEO version history available', 400);
    }

    const log = {
      timestamp: new Date(),
      level: 'info' as const,
      message: `↩️ SEO metadata reverted to ${mode} version`,
    };

    await Generation.findByIdAndUpdate(id, { $set: updates, $push: { logs: log } });

    const room = `generation:${id}`;
    await publishSocketEvent(room, 'generation:seo', {
      generationId: id,
      seoTitle: (updates.seoTitle as string) ?? generation.seoTitle,
      seoDescription: (updates.seoDescription as string) ?? generation.seoDescription,
      seoTitleHistory: (updates.seoTitleHistory as string[]) ?? genObj.seoTitleHistory,
      seoDescriptionHistory: (updates.seoDescriptionHistory as string[]) ?? genObj.seoDescriptionHistory,
    });
    await publishSocketEvent(room, 'generation:log', { generationId: id, log });

    res.json({ success: true, data: updates });
  } catch (error) {
    if (error instanceof AppError) {
      res.status(error.statusCode).json({ success: false, error: error.message });
    } else {
      logger.error('Revert SEO error', { error });
      res.status(500).json({ success: false, error: 'Failed to revert SEO metadata' });
    }
  }
};
