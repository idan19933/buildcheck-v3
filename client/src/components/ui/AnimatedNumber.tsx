import { useEffect, useRef, useState } from 'react';

interface Props {
  value: number;
  duration?: number;     // ms
  className?: string;
  format?: (n: number) => string;
}

/**
 * Counts up from 0 → value over `duration` ms with an ease-out curve.
 * Respects prefers-reduced-motion and shows the final value immediately.
 */
export function AnimatedNumber({ value, duration = 900, className, format }: Props) {
  const [displayed, setDisplayed] = useState(0);
  const startRef = useRef<number | null>(null);
  const fromRef = useRef(0);

  useEffect(() => {
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduced) {
      setDisplayed(value);
      return;
    }
    fromRef.current = displayed;
    startRef.current = null;
    let raf = 0;
    const step = (ts: number) => {
      if (startRef.current === null) startRef.current = ts;
      const elapsed = ts - startRef.current;
      const t = Math.min(1, elapsed / duration);
      const eased = 1 - Math.pow(1 - t, 3);   // easeOutCubic
      const next = fromRef.current + (value - fromRef.current) * eased;
      setDisplayed(next);
      if (t < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, duration]);

  const out = format ? format(displayed) : String(Math.round(displayed));
  return <span className={className} dir="ltr">{out}</span>;
}
