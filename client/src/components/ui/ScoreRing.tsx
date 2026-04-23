import { useEffect, useState } from 'react';
import { AnimatedNumber } from './AnimatedNumber';

interface Props {
  score: number | null;
  size?: number;          // px
  thickness?: number;     // ring stroke width (px)
  label?: string;
}

function bandColor(score: number | null): string {
  if (score == null) return 'var(--color-text-muted)';
  if (score >= 85) return 'var(--color-success)';
  if (score >= 65) return 'var(--color-warning)';
  return 'var(--color-danger)';
}

/**
 * Animated donut ring. Score 0-100 → arc length. Stroke color follows the
 * three-band rule (green ≥ 85, amber 65-84, rose < 65).
 */
export function ScoreRing({ score, size = 160, thickness = 14, label = 'ציון כולל' }: Props) {
  const radius = (size - thickness) / 2;
  const circumference = 2 * Math.PI * radius;
  const safe = Math.max(0, Math.min(100, score ?? 0));

  const [progress, setProgress] = useState(0);
  useEffect(() => {
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduced) {
      setProgress(safe);
      return;
    }
    // Trigger animation on mount + when score changes.
    const raf = requestAnimationFrame(() => setProgress(safe));
    return () => cancelAnimationFrame(raf);
  }, [safe]);

  const offset = circumference - (progress / 100) * circumference;
  const stroke = bandColor(score);

  return (
    <div className="flex flex-col items-center" style={{ width: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={`${label}: ${score ?? '—'}`}>
        {/* Track */}
        <circle
          cx={size / 2} cy={size / 2} r={radius}
          fill="none"
          stroke="var(--color-border)"
          strokeWidth={thickness}
        />
        {/* Progress — rotated -90deg so it starts at 12 o'clock */}
        <circle
          cx={size / 2} cy={size / 2} r={radius}
          fill="none"
          stroke={stroke}
          strokeWidth={thickness}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
          style={{ transition: 'stroke-dashoffset 900ms cubic-bezier(0.4, 0, 0.2, 1)' }}
        />
      </svg>
      {/* Centered label inside the ring (positioned absolute via flex stack) */}
      <div className="-mt-[60%] mb-[20%] flex flex-col items-center pointer-events-none" style={{ width: size, height: size * 0.4 }}>
        <div className="font-semibold tabular-nums leading-none" style={{ fontSize: size * 0.32, color: stroke }}>
          {score == null ? <span dir="ltr">—</span> : <AnimatedNumber value={score} />}
        </div>
        <div className="text-[11px] text-text-muted uppercase tracking-[0.18em] mt-2 font-latin" dir="ltr">
          / 100
        </div>
      </div>
      <div className="text-xs text-text-soft uppercase tracking-wider mt-1">{label}</div>
    </div>
  );
}

interface SegmentProps {
  segments: { value: number; color: string; label: string }[];
}

/**
 * 5-segment proportional stacked bar. Pass a list of { value, color, label }
 * and it renders a 100%-width bar with each segment in its share of the total.
 * Tooltips on hover for accessibility.
 */
export function StackedBar({ segments }: SegmentProps) {
  const total = segments.reduce((s, x) => s + x.value, 0);
  if (total === 0) {
    return <div className="h-2 w-full rounded-full bg-surface-muted" />;
  }
  return (
    <div className="flex h-2 w-full rounded-full overflow-hidden bg-surface-muted">
      {segments.map((s, i) => {
        const w = (s.value / total) * 100;
        if (w === 0) return null;
        return (
          <div
            key={i}
            title={`${s.label}: ${s.value}`}
            style={{ width: `${w}%`, background: s.color }}
            className="h-full transition-all duration-base"
          />
        );
      })}
    </div>
  );
}
