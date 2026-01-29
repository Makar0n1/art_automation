/**
 * Redis Utilities
 * Shared Redis connections for Bull queue and pub/sub communication
 * @module utils/redis
 */

import Redis from 'ioredis';
import { config } from './config.js';
import { logger } from './logger.js';

/**
 * Create a Redis connection with error handling
 */
const createRedisConnection = (name: string): Redis => {
  const redis = new Redis({
    host: config.redis.host,
    port: config.redis.port,
    password: config.redis.password || undefined,
    maxRetriesPerRequest: null, // Required for Bull
    enableReadyCheck: false,
    retryStrategy: (times) => {
      if (times > 10) {
        logger.error(`Redis ${name}: Max retry attempts reached`);
        return null;
      }
      const delay = Math.min(times * 100, 3000);
      logger.warn(`Redis ${name}: Retrying connection in ${delay}ms (attempt ${times})`);
      return delay;
    },
  });

  redis.on('connect', () => {
    logger.info(`Redis ${name}: Connected`);
  });

  redis.on('error', (err) => {
    logger.error(`Redis ${name} error:`, { error: err.message });
  });

  redis.on('close', () => {
    logger.warn(`Redis ${name}: Connection closed`);
  });

  return redis;
};

/**
 * Redis publisher for worker-to-API communication
 * Workers publish events here, API subscribes and broadcasts via Socket.IO
 */
let redisPublisher: Redis | null = null;

export const getRedisPublisher = (): Redis => {
  if (!redisPublisher) {
    redisPublisher = createRedisConnection('Publisher');
  }
  return redisPublisher;
};

/**
 * Redis subscriber for API to receive events from workers
 */
let redisSubscriber: Redis | null = null;

export const getRedisSubscriber = (): Redis => {
  if (!redisSubscriber) {
    redisSubscriber = createRedisConnection('Subscriber');
  }
  return redisSubscriber;
};

/**
 * Shared Redis connection for general purposes
 */
let redisClient: Redis | null = null;

export const getRedisClient = (): Redis => {
  if (!redisClient) {
    redisClient = createRedisConnection('Client');
  }
  return redisClient;
};

/**
 * Channel names for pub/sub
 */
export const REDIS_CHANNELS = {
  SOCKET_EVENTS: 'socket:events',
} as const;

/**
 * Socket event message structure
 */
export interface SocketEventMessage {
  room: string;
  event: string;
  data: unknown;
}

/**
 * Publish a socket event via Redis
 * Used by workers to send events to API for broadcasting
 */
export const publishSocketEvent = async (
  room: string,
  event: string,
  data: unknown
): Promise<void> => {
  const publisher = getRedisPublisher();
  const message: SocketEventMessage = { room, event, data };

  try {
    await publisher.publish(REDIS_CHANNELS.SOCKET_EVENTS, JSON.stringify(message));
  } catch (error) {
    logger.error('Failed to publish socket event:', { error, room, event });
  }
};

/**
 * Close all Redis connections
 */
export const closeRedisConnections = async (): Promise<void> => {
  const closePromises: Promise<void>[] = [];

  if (redisPublisher) {
    closePromises.push(
      redisPublisher.quit().then(() => {
        redisPublisher = null;
        logger.info('Redis Publisher: Disconnected');
      })
    );
  }

  if (redisSubscriber) {
    closePromises.push(
      redisSubscriber.quit().then(() => {
        redisSubscriber = null;
        logger.info('Redis Subscriber: Disconnected');
      })
    );
  }

  if (redisClient) {
    closePromises.push(
      redisClient.quit().then(() => {
        redisClient = null;
        logger.info('Redis Client: Disconnected');
      })
    );
  }

  await Promise.all(closePromises);
};
