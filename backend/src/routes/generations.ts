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
  continueGenerationHandler,
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
 * POST /api/generations/:id/continue
 * Continue generation from paused state
 */
router.post('/:id/continue', continueGenerationHandler);

/**
 * DELETE /api/generations/:id
 * Delete generation
 */
router.delete('/:id', deleteGeneration);

export default router;
