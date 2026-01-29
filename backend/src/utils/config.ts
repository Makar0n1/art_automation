/**
 * Application Configuration
 * Centralized configuration management with validation
 * @module utils/config
 */

import dotenv from 'dotenv';
import { z } from 'zod';

// Load environment variables
dotenv.config();

/**
 * Environment schema with Zod validation
 */
const envSchema = z.object({
  PORT: z.string().default('3001'),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  MONGODB_URI: z.string().default('mongodb://localhost:27017/seo_articles'),
  REDIS_HOST: z.string().default('localhost'),
  REDIS_PORT: z.string().default('6379'),
  REDIS_PASSWORD: z.string().optional(),
  JWT_SECRET: z.string().min(32).default('your-super-secret-jwt-key-change-in-production-32chars'),
  JWT_EXPIRES_IN: z.string().default('14d'),
  ENCRYPTION_KEY: z.string().length(64).optional(), // 32-byte hex key for AES-256 (optional, derived from JWT_SECRET if not set)
  MAX_CONCURRENT_GENERATIONS: z.string().default('5'),
  WORKER_CONCURRENCY: z.string().default('2'),
});

/**
 * Parse and validate environment variables
 */
const parseEnv = () => {
  const parsed = envSchema.safeParse(process.env);

  if (!parsed.success) {
    console.error('❌ Invalid environment variables:');
    console.error(parsed.error.format());
    throw new Error('Invalid environment configuration');
  }

  return parsed.data;
};

const env = parseEnv();

/**
 * Typed configuration object
 */
export const config = {
  server: {
    port: parseInt(env.PORT, 10),
    nodeEnv: env.NODE_ENV,
    isDev: env.NODE_ENV === 'development',
    isProd: env.NODE_ENV === 'production',
  },
  mongodb: {
    uri: env.MONGODB_URI,
  },
  redis: {
    host: env.REDIS_HOST,
    port: parseInt(env.REDIS_PORT, 10),
    password: env.REDIS_PASSWORD || undefined,
  },
  jwt: {
    secret: env.JWT_SECRET,
    expiresIn: env.JWT_EXPIRES_IN,
  },
  queue: {
    maxConcurrentGenerations: parseInt(env.MAX_CONCURRENT_GENERATIONS, 10),
  },
  worker: {
    concurrency: parseInt(env.WORKER_CONCURRENCY, 10),
  },
} as const;

export type Config = typeof config;
