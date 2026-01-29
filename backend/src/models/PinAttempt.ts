/**
 * PIN Attempt Model
 * Tracks failed PIN attempts by IP address for rate limiting
 * @module models/PinAttempt
 */

import mongoose, { Schema, Document } from 'mongoose';

export interface IPinAttempt extends Document {
  ip: string;

  userId: mongoose.Types.ObjectId;
  attempts: number;
  isBlocked: boolean;
  lastAttempt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const PinAttemptSchema = new Schema<IPinAttempt>(
  {
    ip: {
      type: String,
      required: true,
    },
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    attempts: {
      type: Number,
      default: 0,
    },
    isBlocked: {
      type: Boolean,
      default: false,
    },
    lastAttempt: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: true,
  }
);

// Compound index for fast lookups
PinAttemptSchema.index({ ip: 1, userId: 1 }, { unique: true });

export const PinAttempt = mongoose.model<IPinAttempt>('PinAttempt', PinAttemptSchema);
