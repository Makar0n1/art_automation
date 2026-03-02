/**
 * Authentication Controller
 * Handles user authentication endpoints
 * @module controllers/authController
 */

import { Request, Response } from 'express';
import { User } from '../models/index.js';
import { generateToken, verifyPinSessionToken } from '../middleware/auth.js';
import { ApiResponse, AuthenticatedRequest } from '../types/index.js';
import { AppError } from '../middleware/errorHandler.js';
import { logger } from '../utils/logger.js';

/**
 * Login user
 * POST /api/auth/login
 */
export const login = async (
  req: Request<object, ApiResponse, { email: string; password: string }>,
  res: Response<ApiResponse>
) => {
  try {
    const { email, password } = req.body;

    // Validate input
    if (!email || !password) {
      throw new AppError('Email and password are required', 400);
    }

    // Find user with password
    const user = await User.findOne({ email }).select('+password');

    if (!user) {
      throw new AppError('Invalid email or password', 401);
    }

    // Compare password
    const isMatch = await user.comparePassword(password);

    if (!isMatch) {
      throw new AppError('Invalid email or password', 401);
    }

    // Generate token
    const token = generateToken(user._id.toString(), user.email);

    logger.info(`User logged in: ${email}`);

    res.json({
      success: true,
      data: {
        token,
        user: {
          id: user._id,
          email: user.email,
          apiKeys: {
            openRouter: { isConfigured: !!user.apiKeys?.openRouter?.apiKey, isValid: user.apiKeys?.openRouter?.isValid },
            supabase: { isConfigured: !!user.apiKeys?.supabase?.url, isValid: user.apiKeys?.supabase?.isValid },
            firecrawl: { isConfigured: !!user.apiKeys?.firecrawl?.apiKey, isValid: user.apiKeys?.firecrawl?.isValid },
          },
        },
      },
      message: 'Login successful',
    });
  } catch (error) {
    if (error instanceof AppError) {
      res.status(error.statusCode).json({ success: false, error: error.message });
    } else {
      logger.error('Login error', { error });
      res.status(500).json({ success: false, error: 'Login failed' });
    }
  }
};

/**
 * Get current user profile
 * GET /api/auth/me
 */
export const getMe = async (
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

    res.json({
      success: true,
      data: {
        id: user._id,
        email: user.email,
        apiKeys: {
          openRouter: {
            isConfigured: !!user.apiKeys?.openRouter?.apiKey,
            isValid: user.apiKeys?.openRouter?.isValid,
            lastChecked: user.apiKeys?.openRouter?.lastChecked,
          },
          supabase: {
            isConfigured: !!user.apiKeys?.supabase?.url,
            isValid: user.apiKeys?.supabase?.isValid,
            lastChecked: user.apiKeys?.supabase?.lastChecked,
          },
          firecrawl: {
            isConfigured: !!user.apiKeys?.firecrawl?.apiKey,
            isValid: user.apiKeys?.firecrawl?.isValid,
            lastChecked: user.apiKeys?.firecrawl?.lastChecked,
          },
        },
        createdAt: user.createdAt,
      },
    });
  } catch (error) {
    if (error instanceof AppError) {
      res.status(error.statusCode).json({ success: false, error: error.message });
    } else {
      logger.error('GetMe error', { error });
      res.status(500).json({ success: false, error: 'Failed to get user info' });
    }
  }
};

/**
 * Refresh JWT token
 * POST /api/auth/refresh
 */
export const refreshToken = async (
  req: AuthenticatedRequest,
  res: Response<ApiResponse>
) => {
  try {
    const userId = req.user?.userId;
    const email = req.user?.email;

    if (!userId || !email) {
      throw new AppError('Invalid token', 401);
    }

    // Generate new token
    const token = generateToken(userId, email);

    res.json({
      success: true,
      data: { token },
      message: 'Token refreshed',
    });
  } catch (error) {
    if (error instanceof AppError) {
      res.status(error.statusCode).json({ success: false, error: error.message });
    } else {
      logger.error('Refresh token error', { error });
      res.status(500).json({ success: false, error: 'Failed to refresh token' });
    }
  }
};

/**
 * Change password
 * PUT /api/auth/password
 * Requires PIN verification if PIN is configured (server-side security gate)
 */
export const changePassword = async (
  req: AuthenticatedRequest,
  res: Response<ApiResponse>
) => {
  try {
    const userId = req.user?.userId;
    const { currentPassword, newPassword, pinSessionToken } = req.body;

    if (!userId) {
      throw new AppError('User not found', 404);
    }

    if (!currentPassword || !newPassword) {
      throw new AppError('Current password and new password are required', 400);
    }

    if (newPassword.length < 6) {
      throw new AppError('New password must be at least 6 characters', 400);
    }

    // Get user with password and PIN
    const user = await User.findById(userId).select('+password +pin');
    if (!user) {
      throw new AppError('User not found', 404);
    }

    // SERVER-SIDE PIN GATE: if PIN is configured, verify session token
    if (user.pin) {
      if (!pinSessionToken) {
        throw new AppError('PIN session required. Please verify your PIN first.', 403);
      }
      if (!verifyPinSessionToken(pinSessionToken, userId)) {
        throw new AppError('PIN session expired or invalid. Please verify your PIN again.', 403);
      }
    }

    // Verify current password
    const isMatch = await user.comparePassword(currentPassword);
    if (!isMatch) {
      throw new AppError('Current password is incorrect', 401);
    }

    // Update password
    user.password = newPassword;
    await user.save();

    logger.info(`Password changed for user ${userId}`);

    res.json({
      success: true,
      message: 'Password changed successfully',
    });
  } catch (error) {
    if (error instanceof AppError) {
      res.status(error.statusCode).json({ success: false, error: error.message });
    } else {
      logger.error('Change password error', { error });
      res.status(500).json({ success: false, error: 'Failed to change password' });
    }
  }
};

/**
 * Change PIN for API keys
 * PUT /api/auth/pin
 * Requires PIN verification if PIN is already configured (server-side security gate)
 */
export const changePin = async (
  req: AuthenticatedRequest,
  res: Response<ApiResponse>
) => {
  try {
    const userId = req.user?.userId;
    const { currentPin, newPin, password, pinSessionToken } = req.body;

    if (!userId) {
      throw new AppError('User not found', 404);
    }

    if (!newPin) {
      throw new AppError('New PIN is required', 400);
    }

    if (newPin.length < 4) {
      throw new AppError('PIN must be at least 4 characters', 400);
    }

    // Get user with password and PIN
    const user = await User.findById(userId).select('+password +pin');
    if (!user) {
      throw new AppError('User not found', 404);
    }

    // If PIN already exists, verify session token + current PIN for change
    if (user.pin) {
      // SERVER-SIDE PIN GATE: verify session token
      if (!pinSessionToken) {
        throw new AppError('PIN session required. Please verify your PIN first.', 403);
      }
      if (!verifyPinSessionToken(pinSessionToken, userId)) {
        throw new AppError('PIN session expired or invalid. Please verify your PIN again.', 403);
      }

      // Also verify currentPin specifically for the change operation
      if (!currentPin) {
        throw new AppError('Current PIN is required', 400);
      }
      const isCurrentPinValid = await user.comparePin(currentPin);
      if (!isCurrentPinValid) {
        throw new AppError('Current PIN is incorrect', 403);
      }
    } else {
      // If no PIN exists, require password verification for first-time PIN setup
      if (!password) {
        throw new AppError('Password is required to set up PIN', 400);
      }
      const isPasswordValid = await user.comparePassword(password);
      if (!isPasswordValid) {
        throw new AppError('Password is incorrect', 401);
      }
    }

    // Update PIN
    user.pin = newPin;
    await user.save();

    logger.info(`PIN changed for user ${userId}`);

    res.json({
      success: true,
      message: 'PIN changed successfully',
    });
  } catch (error) {
    if (error instanceof AppError) {
      res.status(error.statusCode).json({ success: false, error: error.message });
    } else {
      logger.error('Change PIN error', { error });
      res.status(500).json({ success: false, error: 'Failed to change PIN' });
    }
  }
};

/**
 * Check if PIN is configured
 * GET /api/auth/pin-status
 */
export const getPinStatus = async (
  req: AuthenticatedRequest,
  res: Response<ApiResponse>
) => {
  try {
    const userId = req.user?.userId;

    if (!userId) {
      throw new AppError('User not found', 404);
    }

    const user = await User.findById(userId).select('+pin');
    if (!user) {
      throw new AppError('User not found', 404);
    }

    res.json({
      success: true,
      data: {
        hasPinConfigured: !!user.pin,
      },
    });
  } catch (error) {
    if (error instanceof AppError) {
      res.status(error.statusCode).json({ success: false, error: error.message });
    } else {
      logger.error('Get PIN status error', { error });
      res.status(500).json({ success: false, error: 'Failed to get PIN status' });
    }
  }
};
