'use client';

import { Modal } from '@/components/ui';
import { Generation } from '@/types';

interface CostModalProps {
  isOpen: boolean;
  onClose: () => void;
  generation: Generation;
}

const FIRECRAWL_COST_PER_CREDIT = 99 / 100_000; // $99 / 100,000 credits
const EUR_RATE = 0.92;

const formatUsd = (amount: number): string =>
  amount < 0.01 ? `$${amount.toFixed(4)}` : `$${amount.toFixed(2)}`;

const formatEur = (amount: number): string =>
  amount < 0.01 ? `€${(amount * EUR_RATE).toFixed(4)}` : `€${(amount * EUR_RATE).toFixed(2)}`;

export const CostModal: React.FC<CostModalProps> = ({ isOpen, onClose, generation }) => {
  const { tokenUsage, modelPricing, firecrawlCredits } = generation;

  if (!tokenUsage) {
    return (
      <Modal isOpen={isOpen} onClose={onClose} title="Generation Cost" size="sm">
        <div className="py-6 text-center text-sm text-gray-400">
          No cost data available for this generation.
          <p className="mt-1 text-xs">Cost tracking was added after this article was generated.</p>
        </div>
      </Modal>
    );
  }

  // OpenRouter cost calculation
  const promptPrice = modelPricing ? parseFloat(modelPricing.prompt) : 0;
  const completionPrice = modelPricing ? parseFloat(modelPricing.completion) : 0;
  const openRouterCost = (tokenUsage.promptTokens * promptPrice) + (tokenUsage.completionTokens * completionPrice);

  // Firecrawl cost
  const fcCredits = firecrawlCredits || 0;
  const firecrawlCost = fcCredits * FIRECRAWL_COST_PER_CREDIT;

  // Total
  const totalCost = openRouterCost + firecrawlCost;

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Generation Cost" size="sm">
      <div className="space-y-4">
        {/* OpenRouter section */}
        <div className="rounded-lg border border-blue-200/60 bg-blue-50/30 px-3 py-2.5 dark:border-blue-800/40 dark:bg-blue-900/10">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold text-blue-700 dark:text-blue-400">OpenRouter</span>
            <span className="text-sm font-bold text-blue-700 dark:text-blue-300">{formatUsd(openRouterCost)}</span>
          </div>
          <div className="mt-1.5 text-xs text-gray-600 dark:text-gray-400">
            <span className="font-medium text-gray-700 dark:text-gray-300">{generation.config.model || 'unknown'}</span>
          </div>
          {modelPricing && (
            <div className="mt-0.5 text-[11px] text-gray-400">
              ${(promptPrice * 1_000_000).toFixed(2)}/M prompt · ${(completionPrice * 1_000_000).toFixed(2)}/M completion
            </div>
          )}
          <div className="mt-2 grid grid-cols-3 gap-2 text-center">
            <div>
              <div className="text-[10px] text-gray-400">Prompt</div>
              <div className="text-xs font-medium text-gray-700 dark:text-gray-300">
                {tokenUsage.promptTokens.toLocaleString()}
              </div>
            </div>
            <div>
              <div className="text-[10px] text-gray-400">Completion</div>
              <div className="text-xs font-medium text-gray-700 dark:text-gray-300">
                {tokenUsage.completionTokens.toLocaleString()}
              </div>
            </div>
            <div>
              <div className="text-[10px] text-gray-400">Total</div>
              <div className="text-xs font-bold text-gray-900 dark:text-white">
                {tokenUsage.totalTokens.toLocaleString()}
              </div>
            </div>
          </div>
        </div>

        {/* Firecrawl section */}
        <div className="rounded-lg border border-orange-200/60 bg-orange-50/30 px-3 py-2.5 dark:border-orange-800/40 dark:bg-orange-900/10">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold text-orange-700 dark:text-orange-400">Firecrawl</span>
            <span className="text-sm font-bold text-orange-700 dark:text-orange-300">{formatUsd(firecrawlCost)}</span>
          </div>
          <div className="mt-1 text-xs text-gray-600 dark:text-gray-400">
            {fcCredits} credits × {formatUsd(FIRECRAWL_COST_PER_CREDIT)}/credit
          </div>
          <div className="mt-0.5 text-[11px] text-gray-400">
            Plan: $99 / 100,000 credits
          </div>
        </div>

        {/* Total */}
        <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2.5 dark:border-gray-700 dark:bg-gray-800/50">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-gray-700 dark:text-gray-300">Total Cost</span>
            <div className="text-right">
              <div className="text-base font-bold text-gray-900 dark:text-white">{formatUsd(totalCost)}</div>
              <div className="text-[11px] text-gray-400">{formatEur(totalCost)}</div>
            </div>
          </div>
        </div>
      </div>
    </Modal>
  );
};
