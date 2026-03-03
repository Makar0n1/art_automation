'use client';

import { memo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useTypewriter } from '@/hooks/useTypewriter';

interface TypewriterMarkdownProps {
  content: string;
  enabled: boolean;
  onComplete?: () => void;
  className?: string;
}

export const TypewriterMarkdown = memo(function TypewriterMarkdown({
  content,
  enabled,
  onComplete,
  className,
}: TypewriterMarkdownProps) {
  const { displayText, isTyping } = useTypewriter({
    text: content,
    enabled,
    mode: 'word',
    speed: 25,
    chunksPerFrame: 4,
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
