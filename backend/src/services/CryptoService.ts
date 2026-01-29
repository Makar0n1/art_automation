/**
 * Crypto Service
 * AES-256-GCM encryption for sensitive data (API keys)
 * @module services/CryptoService
 */

import crypto from 'crypto';
import { config } from '../utils/config.js';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;
const SALT_LENGTH = 32;

/**
 * Get encryption key from environment or derive from JWT secret
 * In production, set ENCRYPTION_KEY as a separate 32-byte hex string
 */
const getEncryptionKey = (): Buffer => {
  const envKey = process.env.ENCRYPTION_KEY;

  if (envKey && envKey.length === 64) {
    // Use provided 32-byte hex key
    return Buffer.from(envKey, 'hex');
  }

  // Derive key from JWT secret using PBKDF2 (fallback for backward compatibility)
  // This ensures consistent key derivation across restarts
  const salt = 'seo-articles-api-keys-salt'; // Static salt for deterministic key
  return crypto.pbkdf2Sync(config.jwt.secret, salt, 100000, 32, 'sha256');
};

/**
 * Encrypt sensitive data using AES-256-GCM
 * @param plaintext - Data to encrypt
 * @returns Encrypted data as base64 string (iv:authTag:ciphertext)
 */
export const encrypt = (plaintext: string): string => {
  if (!plaintext) return '';

  const key = getEncryptionKey();
  const iv = crypto.randomBytes(IV_LENGTH);

  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

  let encrypted = cipher.update(plaintext, 'utf8', 'base64');
  encrypted += cipher.final('base64');

  const authTag = cipher.getAuthTag();

  // Format: iv:authTag:ciphertext (all base64)
  return `${iv.toString('base64')}:${authTag.toString('base64')}:${encrypted}`;
};

/**
 * Decrypt data encrypted with encrypt()
 * @param encryptedData - Encrypted data string
 * @returns Decrypted plaintext
 */
export const decrypt = (encryptedData: string): string => {
  if (!encryptedData) return '';

  const parts = encryptedData.split(':');
  if (parts.length !== 3) {
    // Not encrypted (legacy data) - return as-is
    return encryptedData;
  }

  try {
    const key = getEncryptionKey();
    const iv = Buffer.from(parts[0], 'base64');
    const authTag = Buffer.from(parts[1], 'base64');
    const ciphertext = parts[2];

    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);

    let decrypted = decipher.update(ciphertext, 'base64', 'utf8');
    decrypted += decipher.final('utf8');

    return decrypted;
  } catch (error) {
    // If decryption fails, might be legacy unencrypted data
    console.error('Decryption failed, returning original data');
    return encryptedData;
  }
};

/**
 * Check if data appears to be encrypted
 * @param data - Data to check
 * @returns true if data looks encrypted
 */
export const isEncrypted = (data: string): boolean => {
  if (!data) return false;
  const parts = data.split(':');
  return parts.length === 3;
};

/**
 * Mask a sensitive string for display
 * Shows first 4 and last 4 characters, rest is masked
 * @param value - String to mask
 * @param visibleStart - Number of visible chars at start (default 4)
 * @param visibleEnd - Number of visible chars at end (default 4)
 * @returns Masked string
 */
export const maskSensitiveData = (
  value: string,
  visibleStart: number = 4,
  visibleEnd: number = 4
): string => {
  if (!value) return '';

  // For very short strings, mask everything
  if (value.length <= visibleStart + visibleEnd) {
    return '*'.repeat(value.length);
  }

  const start = value.substring(0, visibleStart);
  const end = value.substring(value.length - visibleEnd);
  const masked = '*'.repeat(Math.min(20, value.length - visibleStart - visibleEnd));

  return `${start}${masked}${end}`;
};

/**
 * Hash a PIN using bcrypt-style hashing
 * Using crypto.scrypt for consistency with Node.js stdlib
 */
export const hashPin = async (pin: string): Promise<string> => {
  return new Promise((resolve, reject) => {
    const salt = crypto.randomBytes(SALT_LENGTH);
    crypto.scrypt(pin, salt, 64, (err, derivedKey) => {
      if (err) reject(err);
      resolve(`${salt.toString('hex')}:${derivedKey.toString('hex')}`);
    });
  });
};

/**
 * Verify a PIN against stored hash
 */
export const verifyPin = async (pin: string, storedHash: string): Promise<boolean> => {
  return new Promise((resolve, reject) => {
    const [salt, hash] = storedHash.split(':');
    if (!salt || !hash) {
      resolve(false);
      return;
    }

    crypto.scrypt(pin, Buffer.from(salt, 'hex'), 64, (err, derivedKey) => {
      if (err) reject(err);
      resolve(crypto.timingSafeEqual(Buffer.from(hash, 'hex'), derivedKey));
    });
  });
};

export default {
  encrypt,
  decrypt,
  isEncrypted,
  maskSensitiveData,
  hashPin,
  verifyPin,
};
