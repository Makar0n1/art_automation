'use client';

import { useEffect, useRef } from 'react';
import { Sparkles, RotateCcw } from 'lucide-react';

interface BlockContextMenuProps {
  x: number;
  y: number;
  blockId: number;
  hasHistory: boolean;
  onEditWithAI: (blockId: number) => void;
  onRevert: (blockId: number, mode: 'previous' | 'original') => void;
  onClose: () => void;
}

export const BlockContextMenu: React.FC<BlockContextMenuProps> = ({
  x,
  y,
  blockId,
  hasHistory,
  onEditWithAI,
  onRevert,
  onClose,
}) => {
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    const handleScroll = () => onClose();

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEscape);
    window.addEventListener('scroll', handleScroll, true);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
      window.removeEventListener('scroll', handleScroll, true);
    };
  }, [onClose]);

  // Adjust position if near screen edges
  const adjustedX = Math.min(x, window.innerWidth - 200);
  const adjustedY = Math.min(y, window.innerHeight - 60);

  return (
    <div
      ref={menuRef}
      className="fixed z-50 min-w-[180px] rounded-lg border border-gray-200 bg-white py-1 shadow-lg dark:border-gray-700 dark:bg-gray-800"
      style={{ left: adjustedX, top: adjustedY }}
    >
      <button
        onClick={() => onEditWithAI(blockId)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-gray-700 transition-colors hover:bg-blue-50 dark:text-gray-200 dark:hover:bg-gray-700"
      >
        <Sparkles className="h-4 w-4 text-blue-500" />
        Edit with AI
      </button>
      {hasHistory && (
        <>
          <div className="mx-2 my-1 border-t border-gray-100 dark:border-gray-700" />
          <button
            onClick={() => onRevert(blockId, 'previous')}
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-gray-700 transition-colors hover:bg-amber-50 dark:text-gray-200 dark:hover:bg-gray-700"
          >
            <RotateCcw className="h-4 w-4 text-amber-500" />
            Revert to Previous
          </button>
          <button
            onClick={() => onRevert(blockId, 'original')}
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-gray-700 transition-colors hover:bg-orange-50 dark:text-gray-200 dark:hover:bg-gray-700"
          >
            <RotateCcw className="h-4 w-4 text-orange-500" />
            Revert to Original
          </button>
        </>
      )}
    </div>
  );
};
