/**
 * Progress Bar Component — premium styling with gradient, dot endpoint, lighter track
 */

import React from 'react';
import { cn } from '@/lib/utils';

interface ProgressBarProps {
  value: number;
  max?: number;
  size?: 'sm' | 'md' | 'lg';
  variant?: 'default' | 'success' | 'warning' | 'error';
  showLabel?: boolean;
  className?: string;
}

export const ProgressBar: React.FC<ProgressBarProps> = ({
  value,
  max = 100,
  size = 'md',
  variant = 'default',
  showLabel = false,
  className,
}) => {
  const percentage = Math.min(Math.max((value / max) * 100, 0), 100);

  const sizes = {
    sm: 'h-1.5',
    md: 'h-2',
    lg: 'h-3',
  };

  const dotSizes = {
    sm: 'h-2.5 w-2.5 -right-[3px]',
    md: 'h-3 w-3 -right-[4px]',
    lg: 'h-4 w-4 -right-[5px]',
  };

  const gradients = {
    default: 'from-blue-400 via-blue-500 to-blue-600',
    success: 'from-emerald-400 via-emerald-500 to-emerald-600',
    warning: 'from-amber-400 via-amber-500 to-yellow-500',
    error: 'from-red-400 via-red-500 to-red-600',
  };

  const dotColors = {
    default: 'bg-blue-500 shadow-blue-400/50',
    success: 'bg-emerald-500 shadow-emerald-400/50',
    warning: 'bg-amber-500 shadow-amber-400/50',
    error: 'bg-red-500 shadow-red-400/50',
  };

  return (
    <div className={cn('w-full', className)}>
      {showLabel && (
        <div className="mb-1 flex justify-between text-sm">
          <span className="text-gray-600 dark:text-gray-400">Progress</span>
          <span className="font-medium text-gray-900 dark:text-white">
            {Math.round(percentage)}%
          </span>
        </div>
      )}
      <div
        className={cn(
          'relative w-full overflow-visible rounded-full bg-gray-100 dark:bg-gray-700/50',
          sizes[size]
        )}
      >
        <div
          className={cn(
            'relative h-full rounded-full bg-gradient-to-r transition-all duration-500 ease-out',
            gradients[variant]
          )}
          style={{ width: `${percentage}%` }}
        >
          {/* Dot endpoint */}
          {percentage > 2 && (
            <div
              className={cn(
                'absolute top-1/2 -translate-y-1/2 rounded-full shadow-sm',
                dotSizes[size],
                dotColors[variant]
              )}
            />
          )}
        </div>
      </div>
    </div>
  );
};
