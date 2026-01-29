#!/usr/bin/env node
/**
 * User Setup Script
 * Creates admin user with email, password, and PIN
 *
 * Usage:
 *   npx tsx src/scripts/setup-user.ts
 *
 * Or via npm script:
 *   npm run setup:user
 *
 * In Docker:
 *   docker compose exec backend-api npx tsx src/scripts/setup-user.ts
 */

import mongoose from 'mongoose';
import readline from 'readline';
import { User } from '../models/User.js';
import { config } from '../utils/config.js';

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

const question = (prompt: string): Promise<string> => {
  return new Promise((resolve) => {
    rl.question(prompt, (answer) => {
      resolve(answer.trim());
    });
  });
};

const questionHidden = (prompt: string): Promise<string> => {
  return new Promise((resolve) => {
    process.stdout.write(prompt);

    const stdin = process.stdin;
    const wasRaw = stdin.isRaw;

    stdin.setRawMode?.(true);
    stdin.resume();

    let password = '';

    const onData = (char: Buffer) => {
      const c = char.toString();

      if (c === '\n' || c === '\r') {
        stdin.removeListener('data', onData);
        stdin.setRawMode?.(wasRaw ?? false);
        stdin.pause();
        process.stdout.write('\n');
        resolve(password);
      } else if (c === '\x7f' || c === '\x08') {
        // Backspace
        if (password.length > 0) {
          password = password.slice(0, -1);
          process.stdout.write('\b \b');
        }
      } else if (c === '\x03') {
        // Ctrl+C
        process.exit(1);
      } else {
        password += c;
        process.stdout.write('*');
      }
    };

    stdin.on('data', onData);
  });
};

async function main() {
  console.log('\n========================================');
  console.log('   SEO Articles - User Setup Script');
  console.log('========================================\n');

  try {
    // Connect to MongoDB
    console.log('Connecting to MongoDB...');
    await mongoose.connect(config.mongodb.uri);
    console.log('Connected to MongoDB\n');

    // Check existing user
    const existingUser = await User.findOne();
    if (existingUser) {
      console.log(`Existing user found: ${existingUser.email}`);
      const overwrite = await question('Do you want to update this user? (yes/no): ');

      if (overwrite.toLowerCase() !== 'yes' && overwrite.toLowerCase() !== 'y') {
        console.log('\nAborted. No changes made.');
        process.exit(0);
      }

      // Update existing user
      console.log('\n--- Update User Credentials ---\n');

      const newEmail = await question(`New email (press Enter to keep "${existingUser.email}"): `);
      const email = newEmail || existingUser.email;

      const newPassword = await questionHidden('New password (press Enter to keep existing): ');
      const confirmPassword = newPassword ? await questionHidden('Confirm new password: ') : '';

      if (newPassword && newPassword !== confirmPassword) {
        console.log('\nPasswords do not match. Aborted.');
        process.exit(1);
      }

      const newPin = await questionHidden('New PIN for API keys (min 4 chars, any symbols, press Enter to keep existing): ');
      const confirmPin = newPin ? await questionHidden('Confirm new PIN: ') : '';

      if (newPin && newPin !== confirmPin) {
        console.log('\nPINs do not match. Aborted.');
        process.exit(1);
      }

      if (newPin && newPin.length < 4) {
        console.log('\nPIN must be at least 4 characters. Aborted.');
        process.exit(1);
      }

      // Get user with password/pin for update
      const userToUpdate = await User.findById(existingUser._id).select('+password +pin');
      if (!userToUpdate) {
        console.log('\nUser not found. Aborted.');
        process.exit(1);
      }

      userToUpdate.email = email;
      if (newPassword) userToUpdate.password = newPassword;
      if (newPin) userToUpdate.pin = newPin;

      await userToUpdate.save();

      console.log('\n========================================');
      console.log('   User updated successfully!');
      console.log('========================================');
      console.log(`Email: ${email}`);
      console.log(`Password: ${newPassword ? '(updated)' : '(unchanged)'}`);
      console.log(`PIN: ${newPin ? '(updated)' : '(unchanged)'}`);
      console.log('========================================\n');

    } else {
      // Create new user
      console.log('No existing user found. Creating new user...\n');
      console.log('--- Create New User ---\n');

      const email = await question('Email: ');
      if (!email || !/^\S+@\S+\.\S+$/.test(email)) {
        console.log('\nInvalid email. Aborted.');
        process.exit(1);
      }

      const password = await questionHidden('Password (min 6 characters): ');
      if (!password || password.length < 6) {
        console.log('\nPassword must be at least 6 characters. Aborted.');
        process.exit(1);
      }

      const confirmPassword = await questionHidden('Confirm password: ');
      if (password !== confirmPassword) {
        console.log('\nPasswords do not match. Aborted.');
        process.exit(1);
      }

      const pin = await questionHidden('PIN for API keys (min 4 characters, any symbols): ');
      if (!pin || pin.length < 4) {
        console.log('\nPIN must be at least 4 characters. Aborted.');
        process.exit(1);
      }

      const confirmPin = await questionHidden('Confirm PIN: ');
      if (pin !== confirmPin) {
        console.log('\nPINs do not match. Aborted.');
        process.exit(1);
      }

      const user = await User.create({
        email,
        password,
        pin,
      });

      console.log('\n========================================');
      console.log('   User created successfully!');
      console.log('========================================');
      console.log(`Email: ${user.email}`);
      console.log('Password: (hashed with bcrypt)');
      console.log('PIN: (hashed with bcrypt)');
      console.log('========================================\n');
    }

  } catch (error) {
    console.error('\nError:', error instanceof Error ? error.message : error);
    process.exit(1);
  } finally {
    rl.close();
    await mongoose.disconnect();
    process.exit(0);
  }
}

main();
