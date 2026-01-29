/**
 * Authentication Routes
 * @module routes/auth
 */

import { Router } from 'express';
import {
  login,
  getMe,
  refreshToken,
  changePassword,
  changePin,
  getPinStatus,
} from '../controllers/authController.js';
import { authenticate } from '../middleware/auth.js';

const router = Router();

/**
 * POST /api/auth/login
 * User login
 */
router.post('/login', login);

/**
 * GET /api/auth/me
 * Get current user profile
 */
router.get('/me', authenticate, getMe);

/**
 * POST /api/auth/refresh
 * Refresh JWT token
 */
router.post('/refresh', authenticate, refreshToken);

/**
 * PUT /api/auth/password
 * Change user password
 * Requires current password verification
 */
router.put('/password', authenticate, changePassword);

/**
 * PUT /api/auth/pin
 * Change or set user PIN
 * Requires current PIN (if exists) or password verification
 */
router.put('/pin', authenticate, changePin);

/**
 * GET /api/auth/pin-status
 * Check if user has PIN configured
 */
router.get('/pin-status', authenticate, getPinStatus);

export default router;
