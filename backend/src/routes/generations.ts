/**
 * Generations Routes
 * @module routes/generations
 */

import { Router } from 'express';
import {
  getGeneration,
  getGenerationLogs,
  deleteGeneration,
  getQueueStatistics,
  getAllGenerations,
  restartGenerationHandler,
  editBlock,
  editSeo,
  revertBlock,
  revertSeo,
} from '../controllers/generationsController.js';
import { authenticate } from '../middleware/auth.js';

const router = Router();

// All routes require authentication
router.use(authenticate);

/**
 * GET /api/generations
 * Get all user generations (across all projects)
 */
router.get('/', getAllGenerations);

/**
 * GET /api/generations/queue/stats
 * Get queue statistics
 */
router.get('/queue/stats', getQueueStatistics);

/**
 * GET /api/generations/:id
 * Get single generation with full details
 */
router.get('/:id', getGeneration);

/**
 * GET /api/generations/:id/logs
 * Get generation logs
 */
router.get('/:id/logs', getGenerationLogs);

/**
 * POST /api/generations/:id/restart
 * Restart generation from scratch (clears all intermediate data)
 */
router.post('/:id/restart', restartGenerationHandler);

/**
 * POST /api/generations/:id/edit-block
 * Edit a single block with AI
 */
router.post('/:id/edit-block', editBlock);

/**
 * POST /api/generations/:id/edit-seo
 * Edit SEO metadata with AI
 */
router.post('/:id/edit-seo', editSeo);

/**
 * POST /api/generations/:id/revert-block
 * Revert a block to previous or original version
 */
router.post('/:id/revert-block', revertBlock);

/**
 * POST /api/generations/:id/revert-seo
 * Revert SEO metadata to previous or original version
 */
router.post('/:id/revert-seo', revertSeo);

/**
 * DELETE /api/generations/:id
 * Delete generation
 */
router.delete('/:id', deleteGeneration);

export default router;
