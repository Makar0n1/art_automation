/**
 * Prometheus Metrics Service
 * Collects and exposes application metrics
 */

import client from 'prom-client';

// Create a Registry
const register = new client.Registry();

// Add default metrics (memory, CPU, etc.)
client.collectDefaultMetrics({ register });

// Custom metrics

// Generation metrics
export const generationsTotal = new client.Counter({
  name: 'seo_articles_generations_total',
  help: 'Total number of article generations',
  labelNames: ['status', 'article_type'],
  registers: [register],
});

export const generationsInProgress = new client.Gauge({
  name: 'seo_articles_generations_in_progress',
  help: 'Number of generations currently in progress',
  registers: [register],
});

export const generationDuration = new client.Histogram({
  name: 'seo_articles_generation_duration_seconds',
  help: 'Duration of article generation in seconds',
  labelNames: ['status'],
  buckets: [30, 60, 120, 300, 600, 900, 1800], // 30s to 30min
  registers: [register],
});

// API metrics
export const httpRequestsTotal = new client.Counter({
  name: 'seo_articles_http_requests_total',
  help: 'Total number of HTTP requests',
  labelNames: ['method', 'path', 'status'],
  registers: [register],
});

export const httpRequestDuration = new client.Histogram({
  name: 'seo_articles_http_request_duration_seconds',
  help: 'Duration of HTTP requests in seconds',
  labelNames: ['method', 'path'],
  buckets: [0.01, 0.05, 0.1, 0.5, 1, 2, 5],
  registers: [register],
});

// Queue metrics
export const queueJobsTotal = new client.Counter({
  name: 'seo_articles_queue_jobs_total',
  help: 'Total number of queue jobs',
  labelNames: ['status'], // completed, failed
  registers: [register],
});

export const queueJobsWaiting = new client.Gauge({
  name: 'seo_articles_queue_jobs_waiting',
  help: 'Number of jobs waiting in queue',
  registers: [register],
});

export const queueJobsActive = new client.Gauge({
  name: 'seo_articles_queue_jobs_active',
  help: 'Number of active jobs being processed',
  registers: [register],
});

// WebSocket metrics
export const websocketConnections = new client.Gauge({
  name: 'seo_articles_websocket_connections',
  help: 'Number of active WebSocket connections',
  registers: [register],
});

// OpenRouter API metrics
export const openrouterRequestsTotal = new client.Counter({
  name: 'seo_articles_openrouter_requests_total',
  help: 'Total number of OpenRouter API requests',
  labelNames: ['method', 'status'],
  registers: [register],
});

export const openrouterTokensTotal = new client.Counter({
  name: 'seo_articles_openrouter_tokens_total',
  help: 'Total number of tokens used',
  labelNames: ['type'], // prompt, completion
  registers: [register],
});

// Firecrawl API metrics
export const firecrawlRequestsTotal = new client.Counter({
  name: 'seo_articles_firecrawl_requests_total',
  help: 'Total number of Firecrawl API requests',
  labelNames: ['type', 'status'], // search, scrape
  registers: [register],
});

// Export the register for the /metrics endpoint
export const getMetrics = async (): Promise<string> => {
  return register.metrics();
};

export const getContentType = (): string => {
  return register.contentType;
};

// Middleware to track HTTP requests
import type { Request, Response, NextFunction } from 'express';

export const metricsMiddleware = (
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  const start = Date.now();

  // Skip metrics endpoint itself
  if (req.path === '/api/metrics' || req.path === '/api/health') {
    next();
    return;
  }

  // Normalize path to avoid high cardinality
  const normalizedPath = normalizePath(req.path);

  res.on('finish', () => {
    const duration = (Date.now() - start) / 1000;
    httpRequestsTotal.inc({
      method: req.method,
      path: normalizedPath,
      status: res.statusCode.toString(),
    });
    httpRequestDuration.observe(
      { method: req.method, path: normalizedPath },
      duration
    );
  });

  next();
};

// Normalize paths to reduce cardinality
const normalizePath = (path: string): string => {
  // Replace IDs with placeholders
  return path
    .replace(/\/[0-9a-fA-F]{24}/g, '/:id') // MongoDB ObjectIDs
    .replace(/\/\d+/g, '/:id'); // Numeric IDs
};

export default {
  generationsTotal,
  generationsInProgress,
  generationDuration,
  httpRequestsTotal,
  httpRequestDuration,
  queueJobsTotal,
  queueJobsWaiting,
  queueJobsActive,
  websocketConnections,
  openrouterRequestsTotal,
  openrouterTokensTotal,
  firecrawlRequestsTotal,
  getMetrics,
  getContentType,
  metricsMiddleware,
};
