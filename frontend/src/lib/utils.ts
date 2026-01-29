/**
 * Utility functions for frontend
 */

import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * Merge Tailwind CSS classes with clsx
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Format date to human-readable string
 */
export function formatDate(date: string | Date): string {
  return new Intl.DateTimeFormat('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(date));
}

/**
 * Format relative time
 */
export function formatRelativeTime(date: string | Date): string {
  const now = new Date();
  const then = new Date(date);
  const seconds = Math.floor((now.getTime() - then.getTime()) / 1000);

  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)} minutes ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} hours ago`;
  if (seconds < 604800) return `${Math.floor(seconds / 86400)} days ago`;
  return formatDate(date);
}

/**
 * Truncate text with ellipsis
 */
export function truncate(text: string, length: number): string {
  if (text.length <= length) return text;
  return text.slice(0, length) + '...';
}

/**
 * Get status color class
 */
export function getStatusColor(status: string): string {
  const colors: Record<string, string> = {
    queued: 'bg-gray-500',
    processing: 'bg-blue-500',
    parsing_serp: 'bg-yellow-500',
    analyzing_structure: 'bg-orange-500',
    generating_blocks: 'bg-purple-500',
    enriching_blocks: 'bg-indigo-500',
    answering_questions: 'bg-teal-500',
    writing_article: 'bg-cyan-500',
    inserting_links: 'bg-pink-500',
    reviewing_article: 'bg-violet-500',
    completed: 'bg-green-500',
    failed: 'bg-red-500',
    // Paused states
    paused_after_serp: 'bg-amber-500',
    paused_after_structure: 'bg-amber-500',
    paused_after_blocks: 'bg-amber-500',
    paused_after_answers: 'bg-amber-500',
    paused_after_writing: 'bg-amber-500',
    paused_after_review: 'bg-amber-500',
  };
  return colors[status] || 'bg-gray-500';
}

/**
 * Get status label
 */
export function getStatusLabel(status: string): string {
  const labels: Record<string, string> = {
    queued: 'Queued',
    processing: 'Processing',
    parsing_serp: 'Parsing SERP',
    analyzing_structure: 'Analyzing Structure',
    generating_blocks: 'Generating Blocks',
    enriching_blocks: 'Enriching Blocks',
    answering_questions: 'Finding Answers',
    writing_article: 'Writing Article',
    inserting_links: 'Inserting Links',
    reviewing_article: 'Reviewing Article',
    completed: 'Completed',
    failed: 'Failed',
    // Paused states
    paused_after_serp: 'Paused (SERP Done)',
    paused_after_structure: 'Paused (Structure Done)',
    paused_after_blocks: 'Paused (Blocks Done)',
    paused_after_answers: 'Paused (Answers Done)',
    paused_after_writing: 'Paused (Writing Done)',
    paused_after_review: 'Paused (Review Done)',
  };
  return labels[status] || status;
}

/**
 * Check if generation is in a paused state
 */
export function isPausedStatus(status: string): boolean {
  return [
    'paused_after_serp',
    'paused_after_structure',
    'paused_after_blocks',
    'paused_after_answers',
    'paused_after_writing',
    'paused_after_review',
  ].includes(status);
}
