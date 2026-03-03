'use client';

import { useState, useEffect, useRef, useCallback } from 'react';

interface UseTypewriterOptions {
  text: string;                  // new text to type in
  oldText?: string;              // old text to erase first (backspace effect)
  enabled: boolean;
  mode?: 'word' | 'char';       // for TYPE phase only (erase is always char-based)
  speed?: number;                // ms between type frames (default 12)
  chunksPerFrame?: number;       // tokens per type frame (default 8)
  eraseSpeed?: number;           // ms between erase frames (default 8)
  eraseChunksPerFrame?: number;  // chars removed per erase frame (default 15)
  onComplete?: () => void;
}

interface UseTypewriterResult {
  displayText: string;
  isTyping: boolean;   // true during either phase
  isErasing: boolean;  // true only during erase phase
  skip: () => void;
}

type Phase = 'idle' | 'erasing' | 'pause' | 'typing';

export function useTypewriter({
  text,
  oldText,
  enabled,
  mode = 'word',
  speed = 12,
  chunksPerFrame = 8,
  eraseSpeed = 8,
  eraseChunksPerFrame = 15,
  onComplete,
}: UseTypewriterOptions): UseTypewriterResult {
  const [displayText, setDisplayText] = useState(enabled ? '' : text);
  const [phase, setPhase] = useState<Phase>('idle');

  const rafRef = useRef<number | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const indexRef = useRef(0);
  const textRef = useRef(text);
  const oldTextRef = useRef(oldText);
  const onCompleteRef = useRef(onComplete);

  onCompleteRef.current = onComplete;
  textRef.current = text;
  oldTextRef.current = oldText;

  const cleanup = useCallback(() => {
    if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
    if (timeoutRef.current) { clearTimeout(timeoutRef.current); timeoutRef.current = null; }
  }, []);

  // Reset animation when text/oldText/enabled changes
  useEffect(() => {
    cleanup();

    if (!enabled) {
      setDisplayText(text);
      setPhase('idle');
      return;
    }

    const hasOldText = !!oldText && oldText.length > 0;

    if (hasOldText) {
      indexRef.current = oldText!.length;
      setDisplayText(oldText!);
      setPhase('erasing');
    } else {
      indexRef.current = 0;
      setDisplayText('');
      setPhase('typing');
    }
  }, [text, oldText, enabled, cleanup]);

  // Erase animation loop
  useEffect(() => {
    if (phase !== 'erasing') return;

    const old = oldTextRef.current || '';
    let lastTime = 0;

    const step = (timestamp: number) => {
      if (timestamp - lastTime >= eraseSpeed) {
        lastTime = timestamp;
        indexRef.current = Math.max(0, indexRef.current - eraseChunksPerFrame);
        setDisplayText(old.slice(0, indexRef.current));

        if (indexRef.current <= 0) {
          setPhase('pause');
          return;
        }
      }
      rafRef.current = requestAnimationFrame(step);
    };

    rafRef.current = requestAnimationFrame(step);
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
  }, [phase, eraseSpeed, eraseChunksPerFrame]);

  // Pause between erase and type
  useEffect(() => {
    if (phase !== 'pause') return;

    setDisplayText('');
    timeoutRef.current = setTimeout(() => {
      indexRef.current = 0;
      setPhase('typing');
    }, 80);

    return () => { if (timeoutRef.current) clearTimeout(timeoutRef.current); };
  }, [phase]);

  // Type animation loop
  useEffect(() => {
    if (phase !== 'typing') return;

    const tokens = mode === 'word'
      ? (textRef.current.match(/\S+|\s+/g) || [])
      : textRef.current.split('');

    if (tokens.length === 0) {
      setDisplayText(textRef.current);
      setPhase('idle');
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
          setPhase('idle');
          onCompleteRef.current?.();
          return;
        }
      }
      rafRef.current = requestAnimationFrame(step);
    };

    rafRef.current = requestAnimationFrame(step);
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
  }, [phase, mode, speed, chunksPerFrame]);

  const skip = useCallback(() => {
    cleanup();
    setDisplayText(textRef.current);
    setPhase('idle');
    onCompleteRef.current?.();
  }, [cleanup]);

  return {
    displayText,
    isTyping: phase !== 'idle',
    isErasing: phase === 'erasing',
    skip,
  };
}
