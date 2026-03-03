'use client';

import { useState, useEffect, useRef, useCallback } from 'react';

interface UseTypewriterOptions {
  text: string;
  enabled: boolean;
  mode?: 'word' | 'char';
  speed?: number;           // ms between frames
  chunksPerFrame?: number;  // tokens per frame (word mode: includes whitespace tokens)
  onComplete?: () => void;
}

interface UseTypewriterResult {
  displayText: string;
  isTyping: boolean;
  skip: () => void;
}

export function useTypewriter({
  text,
  enabled,
  mode = 'word',
  speed = 25,
  chunksPerFrame = 4,
  onComplete,
}: UseTypewriterOptions): UseTypewriterResult {
  const [displayText, setDisplayText] = useState(enabled ? '' : text);
  const [isTyping, setIsTyping] = useState(false);
  const rafRef = useRef<number | null>(null);
  const indexRef = useRef(0);
  const textRef = useRef(text);
  const onCompleteRef = useRef(onComplete);

  onCompleteRef.current = onComplete;
  textRef.current = text;

  // When text or enabled changes, reset animation
  useEffect(() => {
    if (!enabled) {
      setDisplayText(text);
      setIsTyping(false);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      return;
    }

    // Start animation
    indexRef.current = 0;
    setDisplayText('');
    setIsTyping(true);
  }, [text, enabled]);

  // Animation loop
  useEffect(() => {
    if (!isTyping) return;

    const tokens = mode === 'word'
      ? (textRef.current.match(/\S+|\s+/g) || [])
      : textRef.current.split('');

    if (tokens.length === 0) {
      setDisplayText(textRef.current);
      setIsTyping(false);
      onCompleteRef.current?.();
      return;
    }

    let lastTime = 0;

    const step = (timestamp: number) => {
      if (timestamp - lastTime >= speed) {
        lastTime = timestamp;
        indexRef.current = Math.min(indexRef.current + chunksPerFrame, tokens.length);
        setDisplayText(tokens.slice(0, indexRef.current).join(''));

        if (indexRef.current >= tokens.length) {
          setIsTyping(false);
          onCompleteRef.current?.();
          return;
        }
      }
      rafRef.current = requestAnimationFrame(step);
    };

    rafRef.current = requestAnimationFrame(step);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [isTyping, mode, speed, chunksPerFrame]);

  const skip = useCallback(() => {
    setDisplayText(textRef.current);
    setIsTyping(false);
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    onCompleteRef.current?.();
  }, []);

  return { displayText, isTyping, skip };
}
