/**
 * API Keys Routes
 * @module routes/apiKeys
 */

import { Router } from 'express';
import {
  getApiKeysStatus,
  getMaskedApiKeys,
  verifyPin,
  updateOpenRouter,
  testOpenRouter,
  updateSupabase,
  testSupabase,
  updateFirecrawl,
  testFirecrawl,
} from '../controllers/apiKeysController.js';
import { authenticate } from '../middleware/auth.js';

const router = Router();

// All routes require authentication
router.use(authenticate);

/**
 * GET /api/settings/api-keys
 * Get all API keys status (with masked keys)
 */
router.get('/', getApiKeysStatus);

/**
 * GET /api/settings/api-keys/masked
 * Get masked API keys for display
 */
router.get('/masked', getMaskedApiKeys);

/**
 * POST /api/settings/api-keys/verify-pin
 * Verify PIN before allowing API key changes
 */
router.post('/verify-pin', verifyPin);

/**
 * PUT /api/settings/api-keys/openrouter
 * Update OpenRouter API key
 */
router.put('/openrouter', updateOpenRouter);

/**
 * POST /api/settings/api-keys/openrouter/test
 * Test OpenRouter API key
 */
router.post('/openrouter/test', testOpenRouter);

/**
 * PUT /api/settings/api-keys/supabase
 * Update Supabase credentials
 */
router.put('/supabase', updateSupabase);

/**
 * POST /api/settings/api-keys/supabase/test
 * Test Supabase credentials
 */
router.post('/supabase/test', testSupabase);

/**
 * PUT /api/settings/api-keys/firecrawl
 * Update Firecrawl API key
 */
router.put('/firecrawl', updateFirecrawl);

/**
 * POST /api/settings/api-keys/firecrawl/test
 * Test Firecrawl API key
 */
router.post('/firecrawl/test', testFirecrawl);

export default router;
