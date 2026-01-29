/**
 * User Model
 * Handles user authentication and API keys storage
 * @module models/User
 */

import mongoose, { Schema } from 'mongoose';
import bcrypt from 'bcryptjs';
import { IUser } from '../types/index.js';

/**
 * API Keys sub-schema
 * Stores external service credentials with validation status
 * Note: API keys are encrypted with AES-256-GCM before storage
 */
const ApiKeysSchema = new Schema({
  openRouter: {
    apiKey: { type: String, default: '' }, // Encrypted
    isValid: { type: Boolean, default: false },
    lastChecked: { type: Date },
  },
  supabase: {
    url: { type: String, default: '' }, // Not encrypted (visible in logs)
    secretKey: { type: String, default: '' }, // Encrypted
    isValid: { type: Boolean, default: false },
    lastChecked: { type: Date },
  },
  firecrawl: {
    apiKey: { type: String, default: '' }, // Encrypted
    isValid: { type: Boolean, default: false },
    lastChecked: { type: Date },
  },
}, { _id: false });

/**
 * User Schema
 * Single user system with JWT authentication
 */
const UserSchema = new Schema<IUser>(
  {
    email: {
      type: String,
      required: [true, 'Email is required'],
      unique: true,
      lowercase: true,
      trim: true,
      match: [/^\S+@\S+\.\S+$/, 'Please enter a valid email'],
    },
    password: {
      type: String,
      required: [true, 'Password is required'],
      minlength: [6, 'Password must be at least 6 characters'],
      select: false, // Don't include password by default in queries
    },
    pin: {
      type: String,
      select: false, // Don't include PIN by default in queries
      // PIN is hashed with bcrypt for API keys changes
    },
    apiKeys: {
      type: ApiKeysSchema,
      default: () => ({}),
    },
  },
  {
    timestamps: true,
    toJSON: {
      transform: (_doc, ret: Record<string, unknown>) => {
        ret.password = undefined;
        ret.pin = undefined;
        ret.__v = undefined;
        return ret;
      },
    },
  }
);

/**
 * Pre-save hook to hash password and PIN
 * Only hashes if password/PIN is modified
 */
UserSchema.pre('save', async function (next) {
  try {
    // Hash password if modified
    if (this.isModified('password')) {
      const salt = await bcrypt.genSalt(12);
      this.password = await bcrypt.hash(this.password, salt);
    }

    // Hash PIN if modified and present
    if (this.isModified('pin') && this.pin) {
      const salt = await bcrypt.genSalt(12);
      this.pin = await bcrypt.hash(this.pin, salt);
    }

    next();
  } catch (error) {
    next(error as Error);
  }
});

/**
 * Compare password method
 * Used for authentication
 */
UserSchema.methods.comparePassword = async function (
  candidatePassword: string
): Promise<boolean> {
  try {
    return await bcrypt.compare(candidatePassword, this.password);
  } catch {
    return false;
  }
};

/**
 * Compare PIN method
 * Used for API keys changes verification
 */
UserSchema.methods.comparePin = async function (
  candidatePin: string
): Promise<boolean> {
  try {
    if (!this.pin) return false;
    return await bcrypt.compare(candidatePin, this.pin);
  } catch {
    return false;
  }
};

/**
 * Index for faster email lookups during authentication
 */
UserSchema.index({ email: 1 });

export const User = mongoose.model<IUser>('User', UserSchema);
