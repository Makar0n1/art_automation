/**
 * API Keys Controller
 * Handles external service API keys management
 * @module controllers/apiKeysController
 */

import { Response } from 'express';
import { User, PinAttempt } from '../models/index.js';
import { AuthenticatedRequest, ApiResponse } from '../types/index.js';
import { AppError } from '../middleware/errorHandler.js';
import { ApiKeyValidator } from '../services/ApiKeyValidator.js';
import { encrypt, decrypt, maskSensitiveData } from '../services/CryptoService.js';
import { logger } from '../utils/logger.js';

const MAX_PIN_ATTEMPTS = 5;

/**
 * Get client IP address from request
 * For local Docker setup: use socket IP directly (X-Forwarded-For can be spoofed by VPN/extensions)
 * For production with nginx: would use X-Real-IP or trusted X-Forwarded-For
 */
const getClientIp = (req: AuthenticatedRequest): string => {
  // In Docker local setup, use socket address directly
  // X-Forwarded-For headers can be injected by VPN clients/browser extensions
  const socketIp = req.socket?.remoteAddress || req.ip || 'unknown';

  // Clean up IPv6-mapped IPv4 addresses (::ffff:172.18.0.1 -> 172.18.0.1)
  const cleanIp = socketIp.replace(/^::ffff:/, '');

  // Log for debugging
  logger.debug(`Client IP detection - socket: ${cleanIp}, x-forwarded-for: ${req.headers['x-forwarded-for']}`);

  return cleanIp;
};

/**
 * Check if IP is blocked for PIN attempts
 */
const isIpBlocked = async (ip: string, userId: string): Promise<boolean> => {
  const attempt = await PinAttempt.findOne({ ip, userId });
  return attempt?.isBlocked || false;
};

/**
 * Record failed PIN attempt and check if should block
 */
const recordFailedPinAttempt = async (ip: string, userId: string): Promise<{ blocked: boolean; attempts: number }> => {
  const attempt = await PinAttempt.findOneAndUpdate(
    { ip, userId },
    {
      $inc: { attempts: 1 },
      $set: { lastAttempt: new Date() },
    },
    { upsert: true, new: true }
  );

  if (attempt.attempts >= MAX_PIN_ATTEMPTS && !attempt.isBlocked) {
    await PinAttempt.findByIdAndUpdate(attempt._id, { isBlocked: true });
    logger.error(`🚨 BRUTE FORCE ALERT: IP ${ip} blocked after ${attempt.attempts} failed PIN attempts for user ${userId}`);
    return { blocked: true, attempts: attempt.attempts };
  }

  if (attempt.attempts >= 3) {
    logger.warn(`⚠️ Suspicious activity: IP ${ip} has ${attempt.attempts} failed PIN attempts for user ${userId}`);
  }

  return { blocked: false, attempts: attempt.attempts };
};

/**
 * Reset PIN attempts on successful verification
 */
const resetPinAttempts = async (ip: string, userId: string): Promise<void> => {
  await PinAttempt.findOneAndUpdate(
    { ip, userId },
    { attempts: 0 }
  );
};

/**
 * Verify PIN before allowing API key changes
 * POST /api/settings/api-keys/verify-pin
 */
export const verifyPin = async (
  req: AuthenticatedRequest,
  res: Response<ApiResponse>
) => {
  try {
    const userId = req.user?.userId;
    const { pin } = req.body;
    const clientIp = getClientIp(req);

    if (!userId) {
      throw new AppError('User not found', 404);
    }

    // Check if IP is blocked
    if (await isIpBlocked(clientIp, userId)) {
      logger.warn(`🚫 Blocked IP ${clientIp} attempted PIN verification for user ${userId}`);
      res.status(403).json({
        success: false,
        error: 'Access denied. Too many failed attempts from this IP address.',
        isBlocked: true,
      });
      return;
    }

    if (!pin) {
      throw new AppError('PIN is required', 400);
    }

    const user = await User.findById(userId).select('+pin');
    if (!user) {
      throw new AppError('User not found', 404);
    }

    if (!user.pin) {
      throw new AppError('PIN not configured. Please set up PIN in Account settings.', 400);
    }

    const isPinValid = await user.comparePin(pin);

    if (!isPinValid) {
      const { blocked, attempts } = await recordFailedPinAttempt(clientIp, userId);
      const remaining = MAX_PIN_ATTEMPTS - attempts;

      if (blocked) {
        res.status(403).json({
          success: false,
          error: 'Too many failed attempts. This IP is now blocked from changing API keys.',
          isBlocked: true,
        });
      } else {
        res.status(403).json({
          success: false,
          error: `Invalid PIN. ${remaining} attempt${remaining !== 1 ? 's' : ''} remaining.`,
          attemptsRemaining: remaining,
        });
      }
      return;
    }

    // Success - reset attempts
    await resetPinAttempts(clientIp, userId);

    res.json({
      success: true,
      message: 'PIN verified',
    });
  } catch (error) {
    if (error instanceof AppError) {
      res.status(error.statusCode).json({ success: false, error: error.message });
    } else {
      logger.error('Verify PIN error', { error });
      res.status(500).json({ success: false, error: 'Failed to verify PIN' });
    }
  }
};

/**
 * Get masked API keys for display
 * GET /api/settings/api-keys/masked
 */
export const getMaskedApiKeys = async (
  req: AuthenticatedRequest,
  res: Response<ApiResponse>
) => {
  try {
    const userId = req.user?.userId;

    if (!userId) {
      throw new AppError('User not found', 404);
    }

    const user = await User.findById(userId);
    if (!user) {
      throw new AppError('User not found', 404);
    }

    // Decrypt and mask API keys for display
    const openRouterKey = user.apiKeys?.openRouter?.apiKey
      ? decrypt(user.apiKeys.openRouter.apiKey)
      : '';
    const supabaseUrl = user.apiKeys?.supabase?.url || '';
    const supabaseKey = user.apiKeys?.supabase?.secretKey
      ? decrypt(user.apiKeys.supabase.secretKey)
      : '';
    const firecrawlKey = user.apiKeys?.firecrawl?.apiKey
      ? decrypt(user.apiKeys.firecrawl.apiKey)
      : '';

    res.json({
      success: true,
      data: {
        openRouter: {
          maskedKey: openRouterKey ? maskSensitiveData(openRouterKey) : '',
          isConfigured: !!openRouterKey,
          isValid: user.apiKeys?.openRouter?.isValid || false,
          lastChecked: user.apiKeys?.openRouter?.lastChecked,
        },
        supabase: {
          url: supabaseUrl, // URL is not masked
          maskedKey: supabaseKey ? maskSensitiveData(supabaseKey) : '',
          isConfigured: !!(supabaseUrl && supabaseKey),
          isValid: user.apiKeys?.supabase?.isValid || false,
          lastChecked: user.apiKeys?.supabase?.lastChecked,
        },
        firecrawl: {
          maskedKey: firecrawlKey ? maskSensitiveData(firecrawlKey) : '',
          isConfigured: !!firecrawlKey,
          isValid: user.apiKeys?.firecrawl?.isValid || false,
          lastChecked: user.apiKeys?.firecrawl?.lastChecked,
        },
        hasPinConfigured: !!(await User.findById(userId).select('+pin').then(u => u?.pin)),
      },
    });
  } catch (error) {
    if (error instanceof AppError) {
      res.status(error.statusCode).json({ success: false, error: error.message });
    } else {
      logger.error('Get masked API keys error', { error });
      res.status(500).json({ success: false, error: 'Failed to get API keys' });
    }
  }
};

/**
 * Update OpenRouter API key
 * PUT /api/settings/api-keys/openrouter
 */
export const updateOpenRouter = async (
  req: AuthenticatedRequest,
  res: Response<ApiResponse>
) => {
  try {
    const userId = req.user?.userId;
    const { apiKey, pin } = req.body;

    if (!userId) {
      throw new AppError('User not found', 404);
    }

    if (!apiKey) {
      throw new AppError('API key is required', 400);
    }

    // Verify PIN if user has PIN configured
    const userWithPin = await User.findById(userId).select('+pin');
    if (userWithPin?.pin) {
      if (!pin) {
        throw new AppError('PIN is required to change API keys', 403);
      }
      const isPinValid = await userWithPin.comparePin(pin);
      if (!isPinValid) {
        throw new AppError('Invalid PIN', 403);
      }
    }

    // Encrypt API key before saving
    const encryptedKey = encrypt(apiKey);

    await User.findByIdAndUpdate(userId, {
      'apiKeys.openRouter.apiKey': encryptedKey,
      'apiKeys.openRouter.isValid': false,
      'apiKeys.openRouter.lastChecked': null,
    });

    logger.info(`OpenRouter API key updated for user ${userId}`);

    res.json({
      success: true,
      message: 'OpenRouter API key saved. Test the key to validate.',
      data: {
        maskedKey: maskSensitiveData(apiKey),
      },
    });
  } catch (error) {
    if (error instanceof AppError) {
      res.status(error.statusCode).json({ success: false, error: error.message });
    } else {
      logger.error('Update OpenRouter error', { error });
      res.status(500).json({ success: false, error: 'Failed to update API key' });
    }
  }
};

/**
 * Test OpenRouter API key
 * POST /api/settings/api-keys/openrouter/test
 */
export const testOpenRouter = async (
  req: AuthenticatedRequest,
  res: Response<ApiResponse>
) => {
  try {
    const userId = req.user?.userId;

    if (!userId) {
      throw new AppError('User not found', 404);
    }

    const user = await User.findById(userId);
    if (!user?.apiKeys?.openRouter?.apiKey) {
      throw new AppError('OpenRouter API key not configured', 400);
    }

    // Decrypt API key for validation
    const decryptedKey = decrypt(user.apiKeys.openRouter.apiKey);
    const result = await ApiKeyValidator.validateOpenRouter(decryptedKey);

    // Update validation status
    await User.findByIdAndUpdate(userId, {
      'apiKeys.openRouter.isValid': result.isValid,
      'apiKeys.openRouter.lastChecked': new Date(),
    });

    res.json({
      success: result.isValid,
      data: { isValid: result.isValid },
      message: result.message,
      error: result.error,
    });
  } catch (error) {
    if (error instanceof AppError) {
      res.status(error.statusCode).json({ success: false, error: error.message });
    } else {
      logger.error('Test OpenRouter error', { error });
      res.status(500).json({ success: false, error: 'Failed to test API key' });
    }
  }
};

/**
 * Update Supabase credentials
 * PUT /api/settings/api-keys/supabase
 */
export const updateSupabase = async (
  req: AuthenticatedRequest,
  res: Response<ApiResponse>
) => {
  try {
    const userId = req.user?.userId;
    const { url, secretKey, pin } = req.body;

    if (!userId) {
      throw new AppError('User not found', 404);
    }

    if (!url || !secretKey) {
      throw new AppError('URL and secret key are required', 400);
    }

    // Verify PIN if user has PIN configured
    const userWithPin = await User.findById(userId).select('+pin');
    if (userWithPin?.pin) {
      if (!pin) {
        throw new AppError('PIN is required to change API keys', 403);
      }
      const isPinValid = await userWithPin.comparePin(pin);
      if (!isPinValid) {
        throw new AppError('Invalid PIN', 403);
      }
    }

    // Encrypt secret key before saving (URL is not encrypted)
    const encryptedKey = encrypt(secretKey);

    await User.findByIdAndUpdate(userId, {
      'apiKeys.supabase.url': url,
      'apiKeys.supabase.secretKey': encryptedKey,
      'apiKeys.supabase.isValid': false,
      'apiKeys.supabase.lastChecked': null,
    });

    logger.info(`Supabase credentials updated for user ${userId}`);

    res.json({
      success: true,
      message: 'Supabase credentials saved. Test to validate.',
      data: {
        url,
        maskedKey: maskSensitiveData(secretKey),
      },
    });
  } catch (error) {
    if (error instanceof AppError) {
      res.status(error.statusCode).json({ success: false, error: error.message });
    } else {
      logger.error('Update Supabase error', { error });
      res.status(500).json({ success: false, error: 'Failed to update credentials' });
    }
  }
};

/**
 * Test Supabase credentials
 * POST /api/settings/api-keys/supabase/test
 */
export const testSupabase = async (
  req: AuthenticatedRequest,
  res: Response<ApiResponse>
) => {
  try {
    const userId = req.user?.userId;

    if (!userId) {
      throw new AppError('User not found', 404);
    }

    const user = await User.findById(userId);
    if (!user?.apiKeys?.supabase?.url || !user?.apiKeys?.supabase?.secretKey) {
      throw new AppError('Supabase credentials not configured', 400);
    }

    // Decrypt secret key for validation
    const decryptedKey = decrypt(user.apiKeys.supabase.secretKey);
    const result = await ApiKeyValidator.validateSupabase(
      user.apiKeys.supabase.url,
      decryptedKey
    );

    // Update validation status
    await User.findByIdAndUpdate(userId, {
      'apiKeys.supabase.isValid': result.isValid,
      'apiKeys.supabase.lastChecked': new Date(),
    });

    res.json({
      success: result.isValid,
      data: { isValid: result.isValid },
      message: result.message,
      error: result.error,
    });
  } catch (error) {
    if (error instanceof AppError) {
      res.status(error.statusCode).json({ success: false, error: error.message });
    } else {
      logger.error('Test Supabase error', { error });
      res.status(500).json({ success: false, error: 'Failed to test credentials' });
    }
  }
};

/**
 * Update Firecrawl API key
 * PUT /api/settings/api-keys/firecrawl
 */
export const updateFirecrawl = async (
  req: AuthenticatedRequest,
  res: Response<ApiResponse>
) => {
  try {
    const userId = req.user?.userId;
    const { apiKey, pin } = req.body;

    if (!userId) {
      throw new AppError('User not found', 404);
    }

    if (!apiKey) {
      throw new AppError('API key is required', 400);
    }

    // Verify PIN if user has PIN configured
    const userWithPin = await User.findById(userId).select('+pin');
    if (userWithPin?.pin) {
      if (!pin) {
        throw new AppError('PIN is required to change API keys', 403);
      }
      const isPinValid = await userWithPin.comparePin(pin);
      if (!isPinValid) {
        throw new AppError('Invalid PIN', 403);
      }
    }

    // Encrypt API key before saving
    const encryptedKey = encrypt(apiKey);

    await User.findByIdAndUpdate(userId, {
      'apiKeys.firecrawl.apiKey': encryptedKey,
      'apiKeys.firecrawl.isValid': false,
      'apiKeys.firecrawl.lastChecked': null,
    });

    logger.info(`Firecrawl API key updated for user ${userId}`);

    res.json({
      success: true,
      message: 'Firecrawl API key saved. Test the key to validate.',
      data: {
        maskedKey: maskSensitiveData(apiKey),
      },
    });
  } catch (error) {
    if (error instanceof AppError) {
      res.status(error.statusCode).json({ success: false, error: error.message });
    } else {
      logger.error('Update Firecrawl error', { error });
      res.status(500).json({ success: false, error: 'Failed to update API key' });
    }
  }
};

/**
 * Test Firecrawl API key
 * POST /api/settings/api-keys/firecrawl/test
 */
export const testFirecrawl = async (
  req: AuthenticatedRequest,
  res: Response<ApiResponse>
) => {
  try {
    const userId = req.user?.userId;

    if (!userId) {
      throw new AppError('User not found', 404);
    }

    const user = await User.findById(userId);
    if (!user?.apiKeys?.firecrawl?.apiKey) {
      throw new AppError('Firecrawl API key not configured', 400);
    }

    // Decrypt API key for validation
    const decryptedKey = decrypt(user.apiKeys.firecrawl.apiKey);
    const result = await ApiKeyValidator.validateFirecrawl(decryptedKey);

    // Update validation status
    await User.findByIdAndUpdate(userId, {
      'apiKeys.firecrawl.isValid': result.isValid,
      'apiKeys.firecrawl.lastChecked': new Date(),
    });

    res.json({
      success: result.isValid,
      data: { isValid: result.isValid },
      message: result.message,
      error: result.error,
    });
  } catch (error) {
    if (error instanceof AppError) {
      res.status(error.statusCode).json({ success: false, error: error.message });
    } else {
      logger.error('Test Firecrawl error', { error });
      res.status(500).json({ success: false, error: 'Failed to test API key' });
    }
  }
};

/**
 * Get all API keys status (legacy, redirects to getMaskedApiKeys)
 * GET /api/settings/api-keys
 */
export const getApiKeysStatus = getMaskedApiKeys;
