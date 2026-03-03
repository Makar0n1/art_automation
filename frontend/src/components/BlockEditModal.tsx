'use client';

import { useState } from 'react';
import { Sparkles, Loader2 } from 'lucide-react';
import { Modal, ModalFooter, Button } from '@/components/ui';
import { generationsApi } from '@/lib/api';
import { ArticleBlock } from '@/types';

interface BlockEditModalProps {
  isOpen: boolean;
  onClose: () => void;
  block: ArticleBlock;
  generationId: string;
  onSuccess: () => void;
}

export const BlockEditModal: React.FC<BlockEditModalProps> = ({
  isOpen,
  onClose,
  block,
  generationId,
  onSuccess,
}) => {
  const [prompt, setPrompt] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async () => {
    if (!prompt.trim()) return;
    setIsLoading(true);
    setError(null);

    try {
      const res = await generationsApi.editBlock(generationId, block.id, prompt.trim());
      if (res.success) {
        setPrompt('');
        onSuccess();
      } else {
        setError(res.error || 'Failed to edit block');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to edit block');
    } finally {
      setIsLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && prompt.trim() && !isLoading) {
      handleSubmit();
    }
  };

  const wordCount = block.content?.split(/\s+/).filter(w => w.length > 0).length || 0;
  const blockTypeLabel = block.type.toUpperCase();

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Edit Block with AI" size="lg">
      <div className="space-y-4">
        {/* Block info */}
        <div className="rounded-lg border border-gray-100 bg-gray-50/50 px-3 py-2 dark:border-gray-700 dark:bg-gray-800/50">
          <div className="flex items-center gap-2">
            <span className="rounded bg-blue-100 px-1.5 py-0.5 text-[10px] font-bold text-blue-700 dark:bg-blue-900/40 dark:text-blue-400">
              {blockTypeLabel}
            </span>
            <span className="text-sm font-medium text-gray-900 dark:text-white">{block.heading}</span>
            <span className="text-xs text-gray-400">{wordCount} words</span>
          </div>
          {block.content && (
            <p className="mt-1.5 line-clamp-3 text-xs leading-relaxed text-gray-500 dark:text-gray-400">
              {block.content.substring(0, 300)}...
            </p>
          )}
        </div>

        {/* Prompt input */}
        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
            What should be changed?
          </label>
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="e.g. Fix the link grammar, replace inaccurate stats with..., make the tone more formal..."
            className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-800 dark:text-white dark:placeholder-gray-500"
            rows={4}
            disabled={isLoading}
            autoFocus
          />
          <p className="mt-1 text-[11px] text-gray-400">
            Ctrl+Enter to submit. AI will preserve links and match article style.
          </p>
        </div>

        {error && (
          <p className="text-sm text-red-500">{error}</p>
        )}
      </div>

      <ModalFooter>
        <Button variant="secondary" size="sm" onClick={onClose} disabled={isLoading}>
          Cancel
        </Button>
        <Button
          size="sm"
          onClick={handleSubmit}
          disabled={!prompt.trim() || isLoading}
          leftIcon={isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
        >
          {isLoading ? 'Editing...' : 'Edit with AI'}
        </Button>
      </ModalFooter>
    </Modal>
  );
};
