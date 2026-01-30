/**
 * SEO Articles Generation Service - Worker Entry Point
 * Processes Bull queue jobs for article generation
 * Communicates with API server via Redis pub/sub
 * @module worker
 */

import mongoose from 'mongoose';

import { config } from './utils/config.js';
import { logger } from './utils/logger.js';
import { closeRedisConnections } from './utils/redis.js';
import { generationQueue, setWorkerMode, startQueueProcessor } from './queues/generationQueue.js';

// Worker identification
const workerId = `worker-${process.pid}-${Date.now().toString(36)}`;

/**
 * Initialize worker process
 */
async function startWorker(): Promise<void> {
  logger.info(`🔧 Starting worker ${workerId}...`);
  logger.info(`📝 Environment: ${config.server.nodeEnv}`);
  logger.info(`⚙️ Concurrency: ${config.worker.concurrency} jobs per worker`);

  try {
    // Connect to MongoDB (workers need data access)
    logger.info('Connecting to MongoDB...');
    await mongoose.connect(config.mongodb.uri);
    logger.info('Connected to MongoDB');

    // Set worker mode for queue (uses Redis pub/sub instead of direct Socket.IO)
    setWorkerMode();

    // Start queue processor (IMPORTANT: only workers should process jobs!)
    startQueueProcessor();

    // Log queue status
    const stats = await generationQueue.getJobCounts();
    logger.info(`📊 Queue status: ${stats.waiting} waiting, ${stats.active} active`);

    logger.info(`🚀 Worker ${workerId} is ready and processing jobs`);

  } catch (error) {
    logger.error('Failed to start worker', { error });
    process.exit(1);
  }
}

/**
 * Graceful shutdown handler
 */
async function gracefulShutdown(signal: string): Promise<void> {
  logger.info(`${signal} received, shutting down worker ${workerId}...`);

  try {
    // Stop accepting new jobs
    await generationQueue.pause(true); // Local pause only this worker
    logger.info('Paused queue processing');

    // Wait for active jobs to complete (max 30 seconds)
    const activeJobs = await generationQueue.getActive();
    if (activeJobs.length > 0) {
      logger.info(`Waiting for ${activeJobs.length} active job(s) to complete...`);
      await new Promise(resolve => setTimeout(resolve, 30000));
    }

    // Close queue
    await generationQueue.close();
    logger.info('Queue closed');

    // Close Redis connections
    await closeRedisConnections();
    logger.info('Redis connections closed');

    // Close MongoDB connection
    await mongoose.connection.close();
    logger.info('MongoDB connection closed');

    logger.info(`Worker ${workerId} shut down complete`);
    process.exit(0);

  } catch (error) {
    logger.error('Error during shutdown', { error });
    process.exit(1);
  }
}

// Signal handlers
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// Error handlers
process.on('uncaughtException', (error) => {
  logger.error('Uncaught Exception in worker', { error, workerId });
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled Rejection in worker', { reason, promise, workerId });
});

// Start the worker
startWorker();
