/**
 * Projects Routes
 * @module routes/projects
 */

import { Router } from 'express';
import {
  createProject,
  getProjects,
  getProject,
  updateProject,
  deleteProject,
} from '../controllers/projectsController.js';
import {
  createGeneration,
  getProjectGenerations,
} from '../controllers/generationsController.js';
import { authenticate } from '../middleware/auth.js';

const router = Router();

// All routes require authentication
router.use(authenticate);

/**
 * POST /api/projects
 * Create new project
 */
router.post('/', createProject);

/**
 * GET /api/projects
 * Get all user projects
 */
router.get('/', getProjects);

/**
 * GET /api/projects/:id
 * Get single project with generations
 */
router.get('/:id', getProject);

/**
 * PUT /api/projects/:id
 * Update project
 */
router.put('/:id', updateProject);

/**
 * DELETE /api/projects/:id
 * Delete project and all its generations
 */
router.delete('/:id', deleteProject);

/**
 * POST /api/projects/:projectId/generations
 * Create new generation in project
 */
router.post('/:projectId/generations', createGeneration);

/**
 * GET /api/projects/:projectId/generations
 * Get all generations for a project
 */
router.get('/:projectId/generations', getProjectGenerations);

export default router;
