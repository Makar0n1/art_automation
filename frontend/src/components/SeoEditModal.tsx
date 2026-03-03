'use client';

import { useState } from 'react';
import { Sparkles } from 'lucide-react';
import { Modal, ModalFooter, Button } from '@/components/ui';

interface SeoEditModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentTitle?: string;
  currentDescription?: string;
  onSubmit: (prompt: string) => void;
}

export const SeoEditModal: React.FC<SeoEditModalProps> = ({
  isOpen,
  onClose,
  currentTitle,
  currentDescription,
  onSubmit,
}) => {
  const [prompt, setPrompt] = useState('');

  const handleSubmit = () => {
    if (!prompt.trim()) return;
    onSubmit(prompt.trim());
    setPrompt('');
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && prompt.trim()) {
      handleSubmit();
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Edit SEO Metadata with AI" size="md">
      <div className="space-y-4">
        {/* Current values */}
        <div className="space-y-2 rounded-lg border border-emerald-200/60 bg-emerald-50/40 px-3 py-2.5 dark:border-emerald-800/40 dark:bg-emerald-900/10">
          {currentTitle && (
            <div>
              <span className="text-[11px] font-semibold text-emerald-700 dark:text-emerald-400">
                Current Title
                <span className="ml-1 font-normal text-emerald-500">({currentTitle.length}/60)</span>
              </span>
              <p className="mt-0.5 text-sm text-gray-900 dark:text-white">{currentTitle}</p>
            </div>
          )}
          {currentDescription && (
            <div>
              <span className="text-[11px] font-semibold text-emerald-700 dark:text-emerald-400">
                Current Description
                <span className="ml-1 font-normal text-emerald-500">({currentDescription.length}/160)</span>
              </span>
              <p className="mt-0.5 text-sm text-gray-700 dark:text-gray-300">{currentDescription}</p>
            </div>
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
            placeholder="e.g. Make title shorter, add a call-to-action to description, focus on price comparison..."
            className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-800 dark:text-white dark:placeholder-gray-500"
            rows={3}
            autoFocus
          />
          <p className="mt-1 text-[11px] text-gray-400">Ctrl+Enter to submit.</p>
        </div>
      </div>

      <ModalFooter>
        <Button variant="secondary" size="sm" onClick={onClose}>
          Cancel
        </Button>
        <Button
          size="sm"
          onClick={handleSubmit}
          disabled={!prompt.trim()}
          leftIcon={<Sparkles className="h-4 w-4" />}
        >
          Edit with AI
        </Button>
      </ModalFooter>
    </Modal>
  );
};
