/**
 * SEO Articles Generation Service - Backend Entry Point
 * High-load service for generating SEO optimized articles
 * @module index
 */

import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import mongoose from 'mongoose';

import { config } from './utils/config.js';
import { logger } from './utils/logger.js';
import { notFoundHandler, errorHandler } from './middleware/errorHandler.js';
import { verifyToken } from './middleware/auth.js';
import { setSocketServer } from './queues/generationQueue.js';
import { User } from './models/index.js';
import { getRedisSubscriber, getRedisClient, REDIS_CHANNELS, SocketEventMessage, closeRedisConnections } from './utils/redis.js';

import {
  authRoutes,
  apiKeysRoutes,
  projectsRoutes,
  generationsRoutes,
} from './routes/index.js';
import { getMetrics, getContentType, metricsMiddleware, websocketConnections } from './services/MetricsService.js';

/**
 * Initialize Express application
 */
const app = express();

// Trust proxy when running behind nginx/traefik in production
// Set TRUST_PROXY=true in environment to enable
if (process.env.TRUST_PROXY === 'true') {
  app.set('trust proxy', 1);
  logger.info('Trust proxy enabled');
}

const httpServer = createServer(app);

/**
 * Initialize Socket.IO server with CORS
 * In production behind reverse proxy, allow all origins
 */
const io = new Server(httpServer, {
  cors: {
    origin: true, // Allow all origins (reverse proxy handles domain routing)
    methods: ['GET', 'POST'],
    credentials: true,
  },
  pingTimeout: 60000,
  pingInterval: 25000,
});

/**
 * Setup Redis adapter for Socket.IO (enables multi-process scaling)
 */
const setupRedisAdapter = async () => {
  try {
    const pubClient = getRedisClient();
    const subClient = pubClient.duplicate();

    io.adapter(createAdapter(pubClient, subClient));
    logger.info('Socket.IO Redis adapter initialized');
  } catch (error) {
    logger.warn('Failed to setup Redis adapter, running in single-process mode', { error });
  }
};

/**
 * Subscribe to Redis pub/sub for worker events
 * Workers publish events to Redis, API server broadcasts to clients
 */
const setupWorkerEventSubscription = () => {
  const subscriber = getRedisSubscriber();

  subscriber.subscribe(REDIS_CHANNELS.SOCKET_EVENTS, (err) => {
    if (err) {
      logger.error('Failed to subscribe to socket events channel', { error: err });
      return;
    }
    logger.info('Subscribed to worker events channel');
  });

  subscriber.on('message', (channel, message) => {
    if (channel === REDIS_CHANNELS.SOCKET_EVENTS) {
      try {
        const { room, event, data } = JSON.parse(message) as SocketEventMessage;
        io.to(room).emit(event, data);
      } catch (error) {
        logger.error('Failed to parse worker event', { error, message });
      }
    }
  });
};

// Set Socket.IO reference for queue (API server mode - direct emit)
setSocketServer(io);

/**
 * Socket.IO authentication middleware
 */
io.use((socket, next) => {
  const token = socket.handshake.auth.token || socket.handshake.headers.authorization?.replace('Bearer ', '');

  if (!token) {
    return next(new Error('Authentication required'));
  }

  const decoded = verifyToken(token);
  if (!decoded) {
    return next(new Error('Invalid token'));
  }

  socket.data.userId = decoded.userId;
  socket.data.email = decoded.email;
  next();
});

/**
 * Socket.IO connection handler
 */
io.on('connection', (socket) => {
  logger.info(`Client connected: ${socket.id} (user: ${socket.data.email})`);
  websocketConnections.inc();

  // Subscribe to generation updates
  socket.on('generation:subscribe', (generationId: string) => {
    socket.join(`generation:${generationId}`);
    logger.debug(`Client ${socket.id} subscribed to generation ${generationId}`);
  });

  // Unsubscribe from generation updates
  socket.on('generation:unsubscribe', (generationId: string) => {
    socket.leave(`generation:${generationId}`);
    logger.debug(`Client ${socket.id} unsubscribed from generation ${generationId}`);
  });

  socket.on('disconnect', (reason) => {
    logger.info(`Client disconnected: ${socket.id} (reason: ${reason})`);
    websocketConnections.dec();
  });
});

/**
 * Express Middleware Configuration
 */

// Security headers
app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' },
}));

// CORS - allow all origins (reverse proxy handles domain routing)
app.use(cors({
  origin: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true,
}));

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
  message: { success: false, error: 'Too many requests, please try again later' },
  standardHeaders: true,
  legacyHeaders: false,
});
app.use('/api/', limiter);

// Body parsing
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Request logging
app.use((req, _res, next) => {
  logger.debug(`${req.method} ${req.path}`);
  next();
});

// Metrics tracking middleware
app.use(metricsMiddleware);

/**
 * API Routes
 */
app.use('/api/auth', authRoutes);
app.use('/api/settings/api-keys', apiKeysRoutes);
app.use('/api/projects', projectsRoutes);
app.use('/api/generations', generationsRoutes);

// Health check
app.get('/api/health', (_req, res) => {
  res.json({
    success: true,
    data: {
      status: 'healthy',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      mongodb: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected',
    },
  });
});

// Prometheus metrics endpoint
app.get('/api/metrics', async (_req, res) => {
  try {
    res.set('Content-Type', getContentType());
    res.end(await getMetrics());
  } catch (error) {
    res.status(500).end(String(error));
  }
});

/**
 * Error Handlers
 */
app.use(notFoundHandler);
app.use(errorHandler);

/**
 * Check if user exists - warn if no user configured
 */
async function checkUserExists(): Promise<void> {
  try {
    const existingUser = await User.findOne();

    if (!existingUser) {
      logger.warn('⚠️  No user found! Run "npm run setup:user" to create admin user');
      logger.warn('⚠️  Or in Docker: docker compose exec backend-api npm run setup:user');
    } else {
      logger.info(`User configured: ${existingUser.email}`);
    }
  } catch (error) {
    logger.error('Failed to check user existence', { error });
  }
}

/**
 * Database Connection and Server Start
 */
async function startServer(): Promise<void> {
  try {
    // Connect to MongoDB
    logger.info('Connecting to MongoDB...');
    await mongoose.connect(config.mongodb.uri);
    logger.info('Connected to MongoDB');

    // Setup Redis adapter for Socket.IO
    await setupRedisAdapter();

    // Subscribe to worker events via Redis pub/sub
    setupWorkerEventSubscription();

    // Check if user exists
    await checkUserExists();

    // Start HTTP server
    httpServer.listen(config.server.port, () => {
      logger.info(`🚀 API Server running on port ${config.server.port}`);
      logger.info(`📝 Environment: ${config.server.nodeEnv}`);
      logger.info(`🔌 Socket.IO ready for connections`);
      logger.info(`📡 Listening for worker events via Redis pub/sub`);
    });
  } catch (error) {
    logger.error('Failed to start server', { error });
    process.exit(1);
  }
}

/**
 * Graceful Shutdown
 */
const gracefulShutdown = async (signal: string) => {
  logger.info(`${signal} received, shutting down gracefully...`);

  io.close();
  httpServer.close();
  await closeRedisConnections();
  await mongoose.connection.close();

  logger.info('API Server shut down complete');
  process.exit(0);
};

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  logger.error('Uncaught Exception', { error });
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled Rejection', { reason, promise });
});

// Start the server
startServer();
