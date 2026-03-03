'use client';

import { memo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useTypewriter } from '@/hooks/useTypewriter';

interface TypewriterMarkdownProps {
  content: string;
  oldContent?: string;
  enabled: boolean;
  onComplete?: () => void;
  className?: string;
}

export const TypewriterMarkdown = memo(function TypewriterMarkdown({
  content,
  oldContent,
  enabled,
  onComplete,
  className,
}: TypewriterMarkdownProps) {
  const { displayText, isTyping } = useTypewriter({
    text: content,
    oldText: oldContent,
    enabled,
    mode: 'word',
    speed: 12,
    chunksPerFrame: 8,
    eraseSpeed: 8,
    eraseChunksPerFrame: 15,
    onComplete,
  });

  return (
    <div className={className}>
      <ReactMarkdown remarkPlugins={[remarkGfm]}>
        {displayText}
      </ReactMarkdown>
      {isTyping && <span className="typewriter-cursor" />}
    </div>
  );
});
