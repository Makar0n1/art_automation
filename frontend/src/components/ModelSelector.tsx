/**
 * Model Selector Component
 * Dropdown with real-time search for OpenRouter models
 */

'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { ChevronDown, Search, Loader2, X } from 'lucide-react';
import { apiKeysApi } from '@/lib/api';
import { OpenRouterModel } from '@/types';
import { cn } from '@/lib/utils';

interface ModelSelectorProps {
  value: string;
  onChange: (modelId: string) => void;
  className?: string;
  label?: string;
  disabled?: boolean;
}

export function ModelSelector({ value, onChange, className, label, disabled }: ModelSelectorProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [models, setModels] = useState<OpenRouterModel[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  // Fetch models once on first open
  const fetchModels = useCallback(async () => {
    if (models.length > 0) return; // Already loaded
    setIsLoading(true);
    setError(null);
    try {
      const response = await apiKeysApi.getOpenRouterModels();
      if (response.success && response.data) {
        setModels(response.data as OpenRouterModel[]);
      }
    } catch {
      setError('Failed to load models');
    } finally {
      setIsLoading(false);
    }
  }, [models.length]);

  // Close dropdown on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Focus search on open
  useEffect(() => {
    if (isOpen) {
      fetchModels();
      setTimeout(() => searchRef.current?.focus(), 50);
    } else {
      setSearch('');
    }
  }, [isOpen, fetchModels]);

  // Fuzzy matching: split search into tokens, all must match somewhere in id or name
  const filteredModels = models.filter((m) => {
    if (!search.trim()) return true;
    const tokens = search.toLowerCase().split(/\s+/);
    const target = `${m.id} ${m.name}`.toLowerCase();
    return tokens.every((t) => target.includes(t));
  });

  // Format pricing for display
  const formatPrice = (priceStr: string): string => {
    const price = parseFloat(priceStr);
    if (price === 0) return 'Free';
    if (price < 0.001) return `$${(price * 1000000).toFixed(2)}/M`;
    return `$${(price * 1000000).toFixed(2)}/M`;
  };

  const selectedModel = models.find((m) => m.id === value);
  const displayName = selectedModel?.name || value || 'Select model...';

  return (
    <div className={cn('relative', className)} ref={dropdownRef}>
      {label && (
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
          {label}
        </label>
      )}
      {/* Trigger button */}
      <button
        type="button"
        disabled={disabled}
        onClick={() => setIsOpen(!isOpen)}
        className={cn(
          'w-full flex items-center justify-between gap-2 rounded-lg border px-3 py-2 text-sm text-left',
          'bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-600',
          'hover:border-gray-400 dark:hover:border-gray-500 transition-colors',
          'disabled:opacity-50 disabled:cursor-not-allowed',
          isOpen && 'border-blue-500 ring-1 ring-blue-500'
        )}
      >
        <span className="truncate text-gray-900 dark:text-white">
          {displayName}
        </span>
        <ChevronDown className={cn('h-4 w-4 shrink-0 text-gray-400 transition-transform', isOpen && 'rotate-180')} />
      </button>

      {/* Dropdown */}
      {isOpen && (
        <div className="absolute z-50 mt-1 w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-lg">
          {/* Search input */}
          <div className="p-2 border-b border-gray-100 dark:border-gray-700">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
              <input
                ref={searchRef}
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search models..."
                className="w-full pl-8 pr-8 py-1.5 text-sm rounded-md border border-gray-200 dark:border-gray-600 bg-gray-50 dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none focus:border-blue-500"
              />
              {search && (
                <button
                  type="button"
                  onClick={() => setSearch('')}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          </div>

          {/* Models list */}
          <div className="max-h-64 overflow-y-auto">
            {isLoading && (
              <div className="flex items-center justify-center py-6">
                <Loader2 className="h-5 w-5 animate-spin text-gray-400" />
                <span className="ml-2 text-sm text-gray-500">Loading models...</span>
              </div>
            )}

            {error && (
              <div className="px-3 py-4 text-sm text-red-500 text-center">{error}</div>
            )}

            {!isLoading && !error && filteredModels.length === 0 && (
              <div className="px-3 py-4 text-sm text-gray-500 text-center">No models found</div>
            )}

            {!isLoading && !error && filteredModels.map((model) => (
              <button
                key={model.id}
                type="button"
                onClick={() => {
                  onChange(model.id);
                  setIsOpen(false);
                }}
                className={cn(
                  'w-full text-left px-3 py-2 text-sm hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors',
                  model.id === value && 'bg-blue-50 dark:bg-blue-900/20'
                )}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium text-gray-900 dark:text-white truncate">
                    {model.name}
                  </span>
                  {model.pricing && (
                    <span className="shrink-0 text-xs text-gray-500 dark:text-gray-400">
                      {formatPrice(model.pricing.prompt)}
                    </span>
                  )}
                </div>
                <div className="text-xs text-gray-500 dark:text-gray-400 truncate">
                  {model.id}
                  {model.contextLength && ` · ${Math.round(model.contextLength / 1000)}k ctx`}
                </div>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
