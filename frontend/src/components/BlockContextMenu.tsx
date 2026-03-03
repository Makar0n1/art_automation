'use client';

import { useEffect, useRef } from 'react';
import { Sparkles } from 'lucide-react';

interface BlockContextMenuProps {
  x: number;
  y: number;
  blockId: number;
  onEditWithAI: (blockId: number) => void;
  onClose: () => void;
}

export const BlockContextMenu: React.FC<BlockContextMenuProps> = ({
  x,
  y,
  blockId,
  onEditWithAI,
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
    </div>
  );
};
