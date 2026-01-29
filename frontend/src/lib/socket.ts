/**
 * Socket.IO Client for Real-time Updates
 */

import { io, Socket } from 'socket.io-client';
import { ArticleBlock, GenerationLog, GenerationStatus } from '@/types';

const SOCKET_URL = process.env.NEXT_PUBLIC_SOCKET_URL || 'http://localhost:3001';

let socket: Socket | null = null;

/**
 * Initialize Socket.IO connection
 */
export const initSocket = (token: string): Socket => {
  if (socket?.connected) {
    return socket;
  }

  socket = io(SOCKET_URL, {
    auth: { token },
    transports: ['polling', 'websocket'], // Polling first for reliable initial connection, then upgrade to websocket
    upgrade: true,
    reconnection: true,
    reconnectionAttempts: 5,
    reconnectionDelay: 1000,
    timeout: 20000,
  });

  socket.on('connect', () => {
    if (process.env.NODE_ENV === 'development') {
      console.log('Socket connected:', socket?.id);
    }
  });

  socket.on('disconnect', (reason) => {
    if (process.env.NODE_ENV === 'development') {
      console.log('Socket disconnected:', reason);
    }
  });

  socket.on('connect_error', (error) => {
    // Only log in development, and only once per error type
    if (process.env.NODE_ENV === 'development') {
      console.warn('Socket connection error:', error.message);
    }
  });

  return socket;
};

/**
 * Get current socket instance
 */
export const getSocket = (): Socket | null => socket;

/**
 * Disconnect socket
 */
export const disconnectSocket = (): void => {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
};

/**
 * Subscribe to generation updates
 */
export const subscribeToGeneration = (
  generationId: string,
  callbacks: {
    onLog?: (log: GenerationLog) => void;
    onStatus?: (status: GenerationStatus, progress: number) => void;
    onBlocks?: (blocks: ArticleBlock[]) => void;
    onCompleted?: (article: string) => void;
    onError?: (error: string) => void;
  }
): (() => void) => {
  if (!socket) {
    console.error('Socket not initialized');
    return () => {};
  }

  // Subscribe to generation room
  socket.emit('generation:subscribe', generationId);

  // Set up listeners
  const handleLog = (data: { generationId: string; log: GenerationLog }) => {
    if (data.generationId === generationId && callbacks.onLog) {
      callbacks.onLog(data.log);
    }
  };

  const handleStatus = (data: { generationId: string; status: GenerationStatus; progress: number }) => {
    if (data.generationId === generationId && callbacks.onStatus) {
      callbacks.onStatus(data.status, data.progress);
    }
  };

  const handleBlocks = (data: { generationId: string; blocks: ArticleBlock[] }) => {
    if (data.generationId === generationId && callbacks.onBlocks) {
      callbacks.onBlocks(data.blocks);
    }
  };

  const handleCompleted = (data: { generationId: string; article: string }) => {
    if (data.generationId === generationId && callbacks.onCompleted) {
      callbacks.onCompleted(data.article);
    }
  };

  const handleError = (data: { generationId: string; error: string }) => {
    if (data.generationId === generationId && callbacks.onError) {
      callbacks.onError(data.error);
    }
  };

  socket.on('generation:log', handleLog);
  socket.on('generation:status', handleStatus);
  socket.on('generation:blocks', handleBlocks);
  socket.on('generation:completed', handleCompleted);
  socket.on('generation:error', handleError);

  // Return cleanup function
  return () => {
    if (socket) {
      socket.emit('generation:unsubscribe', generationId);
      socket.off('generation:log', handleLog);
      socket.off('generation:status', handleStatus);
      socket.off('generation:blocks', handleBlocks);
      socket.off('generation:completed', handleCompleted);
      socket.off('generation:error', handleError);
    }
  };
};
