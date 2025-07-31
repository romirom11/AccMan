import { useState, useEffect, useRef } from 'react';

export function useIdle(timeout: number): boolean {
  const [isIdle, setIsIdle] = useState(false);
  const timeoutId = useRef<number>();

  const resetTimer = () => {
    if (timeoutId.current) {
      window.clearTimeout(timeoutId.current);
    }
    setIsIdle(false);
    timeoutId.current = window.setTimeout(() => setIsIdle(true), timeout);
  };

  useEffect(() => {
    const events = ['mousemove', 'mousedown', 'keypress', 'scroll', 'touchstart'];
    
    events.forEach(event => window.addEventListener(event, resetTimer));
    resetTimer();

    return () => {
      if (timeoutId.current) {
        clearTimeout(timeoutId.current);
      }
      events.forEach(event => window.removeEventListener(event, resetTimer));
    };
  }, [timeout]);

  return isIdle;
}
