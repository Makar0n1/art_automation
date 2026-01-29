/**
 * Generations Controller
 * Handles article generation operations
 * @module controllers/generationsController
 */

import { Response } from 'express';
import { Generation, Project, User } from '../models/index.js';
import { AuthenticatedRequest, ApiResponse, GenerationStatus } from '../types/index.js';
import { AppError } from '../middleware/errorHandler.js';
import { queueGeneration, getQueueStats, continueGeneration } from '../queues/generationQueue.js';
import { logger } from '../utils/logger.js';

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
      continuousMode,
      internalLinks,
      linksAsList,
      linksListPosition,
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
        continuousMode: continuousMode || false,
        internalLinks: internalLinks || [],
        linksAsList: linksAsList || false,
        linksListPosition,
      },
      status: GenerationStatus.QUEUED,
      progress: 0,
      logs: [{
        timestamp: new Date(),
        level: 'info',
        message: 'Generation created and queued',
      }],
    });

    // Add to processing queue
    await queueGeneration(generation._id.toString(), userId);

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
      .sort({ createdAt: -1 })
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
 * Continue generation from paused state
 * POST /api/generations/:id/continue
 */
export const continueGenerationHandler = async (
  req: AuthenticatedRequest,
  res: Response<ApiResponse>
) => {
  try {
    const userId = req.user?.userId;
    const { id } = req.params;

    if (!userId) {
      throw new AppError('User not found', 404);
    }

    // Verify generation exists and belongs to user
    const generation = await Generation.findOne({ _id: id, userId });
    if (!generation) {
      throw new AppError('Generation not found', 404);
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
      throw new AppError(
        `Cannot continue: generation is in "${generation.status}" state. Only paused generations can be continued.`,
        400
      );
    }

    // Continue generation
    await continueGeneration(id, userId);

    logger.info(`Generation continued: ${id} from ${generation.status}`);

    res.json({
      success: true,
      message: `Generation continued from ${generation.status.replace('paused_after_', '')} step`,
      data: {
        id: generation._id,
        previousStatus: generation.status,
      },
    });
  } catch (error) {
    if (error instanceof AppError) {
      res.status(error.statusCode).json({ success: false, error: error.message });
    } else {
      logger.error('Continue generation error', { error });
      res.status(500).json({ success: false, error: 'Failed to continue generation' });
    }
  }
};
