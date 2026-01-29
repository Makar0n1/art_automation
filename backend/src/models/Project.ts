/**
 * Project Model
 * Container for article generations
 * @module models/Project
 */

import mongoose, { Schema } from 'mongoose';
import { IProject } from '../types/index.js';

/**
 * Project Schema
 * Projects group related article generations together
 */
const ProjectSchema = new Schema<IProject>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'User ID is required'],
      index: true,
    },
    name: {
      type: String,
      required: [true, 'Project name is required'],
      trim: true,
      maxlength: [100, 'Project name cannot exceed 100 characters'],
    },
    description: {
      type: String,
      trim: true,
      maxlength: [500, 'Description cannot exceed 500 characters'],
    },
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
 * Compound index for user's projects
 * Enables efficient queries for projects by user
 */
ProjectSchema.index({ userId: 1, createdAt: -1 });

/**
 * Virtual for generations count
 * Populated when needed
 */
ProjectSchema.virtual('generationsCount', {
  ref: 'Generation',
  localField: '_id',
  foreignField: 'projectId',
  count: true,
});

export const Project = mongoose.model<IProject>('Project', ProjectSchema);
