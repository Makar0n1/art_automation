/**
 * Projects Controller
 * Handles project CRUD operations
 * @module controllers/projectsController
 */

import { Response } from 'express';
import { Project, Generation } from '../models/index.js';
import { AuthenticatedRequest, ApiResponse } from '../types/index.js';
import { AppError } from '../middleware/errorHandler.js';
import { logger } from '../utils/logger.js';

/**
 * Create new project
 * POST /api/projects
 */
export const createProject = async (
  req: AuthenticatedRequest,
  res: Response<ApiResponse>
) => {
  try {
    const userId = req.user?.userId;
    const { name, description } = req.body;

    if (!userId) {
      throw new AppError('User not found', 404);
    }

    if (!name) {
      throw new AppError('Project name is required', 400);
    }

    const project = await Project.create({
      userId,
      name,
      description,
    });

    logger.info(`Project created: ${project._id}`);

    res.status(201).json({
      success: true,
      data: project,
      message: 'Project created successfully',
    });
  } catch (error) {
    if (error instanceof AppError) {
      res.status(error.statusCode).json({ success: false, error: error.message });
    } else {
      logger.error('Create project error', { error });
      res.status(500).json({ success: false, error: 'Failed to create project' });
    }
  }
};

/**
 * Get all projects for user
 * GET /api/projects
 */
export const getProjects = async (
  req: AuthenticatedRequest,
  res: Response<ApiResponse>
) => {
  try {
    const userId = req.user?.userId;

    if (!userId) {
      throw new AppError('User not found', 404);
    }

    const projects = await Project.find({ userId })
      .sort({ createdAt: -1 })
      .lean();

    // Get generation counts for each project
    const projectsWithCounts = await Promise.all(
      projects.map(async (project) => {
        const generationsCount = await Generation.countDocuments({
          projectId: project._id,
        });
        return {
          ...project,
          generationsCount,
        };
      })
    );

    res.json({
      success: true,
      data: projectsWithCounts,
    });
  } catch (error) {
    if (error instanceof AppError) {
      res.status(error.statusCode).json({ success: false, error: error.message });
    } else {
      logger.error('Get projects error', { error });
      res.status(500).json({ success: false, error: 'Failed to get projects' });
    }
  }
};

/**
 * Get single project by ID
 * GET /api/projects/:id
 */
export const getProject = async (
  req: AuthenticatedRequest,
  res: Response<ApiResponse>
) => {
  try {
    const userId = req.user?.userId;
    const { id } = req.params;

    if (!userId) {
      throw new AppError('User not found', 404);
    }

    const project = await Project.findOne({ _id: id, userId });

    if (!project) {
      throw new AppError('Project not found', 404);
    }

    // Get generations for this project
    const generations = await Generation.find({ projectId: id })
      .select('-logs -serpResults')
      .sort({ createdAt: -1 })
      .lean();

    res.json({
      success: true,
      data: {
        ...project.toObject(),
        generations,
      },
    });
  } catch (error) {
    if (error instanceof AppError) {
      res.status(error.statusCode).json({ success: false, error: error.message });
    } else {
      logger.error('Get project error', { error });
      res.status(500).json({ success: false, error: 'Failed to get project' });
    }
  }
};

/**
 * Update project
 * PUT /api/projects/:id
 */
export const updateProject = async (
  req: AuthenticatedRequest,
  res: Response<ApiResponse>
) => {
  try {
    const userId = req.user?.userId;
    const { id } = req.params;
    const { name, description } = req.body;

    if (!userId) {
      throw new AppError('User not found', 404);
    }

    const project = await Project.findOneAndUpdate(
      { _id: id, userId },
      { name, description },
      { new: true, runValidators: true }
    );

    if (!project) {
      throw new AppError('Project not found', 404);
    }

    logger.info(`Project updated: ${id}`);

    res.json({
      success: true,
      data: project,
      message: 'Project updated successfully',
    });
  } catch (error) {
    if (error instanceof AppError) {
      res.status(error.statusCode).json({ success: false, error: error.message });
    } else {
      logger.error('Update project error', { error });
      res.status(500).json({ success: false, error: 'Failed to update project' });
    }
  }
};

/**
 * Delete project
 * DELETE /api/projects/:id
 */
export const deleteProject = async (
  req: AuthenticatedRequest,
  res: Response<ApiResponse>
) => {
  try {
    const userId = req.user?.userId;
    const { id } = req.params;

    if (!userId) {
      throw new AppError('User not found', 404);
    }

    const project = await Project.findOneAndDelete({ _id: id, userId });

    if (!project) {
      throw new AppError('Project not found', 404);
    }

    // Delete all generations for this project
    await Generation.deleteMany({ projectId: id });

    logger.info(`Project deleted: ${id}`);

    res.json({
      success: true,
      message: 'Project and all generations deleted successfully',
    });
  } catch (error) {
    if (error instanceof AppError) {
      res.status(error.statusCode).json({ success: false, error: error.message });
    } else {
      logger.error('Delete project error', { error });
      res.status(500).json({ success: false, error: 'Failed to delete project' });
    }
  }
};
