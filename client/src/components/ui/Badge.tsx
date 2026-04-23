import type { HTMLAttributes } from 'react';
import { cn } from '../../lib/utils';

type Tone = 'neutral' | 'brand' | 'success' | 'warning' | 'danger' | 'info';

interface Props extends HTMLAttributes<HTMLSpanElement> {
  tone?: Tone;
  dot?: boolean;
  size?: 'sm' | 'md';
}

const tones: Record<Tone, string> = {
  neutral: 'bg-surface-muted text-text-soft',
  brand:   'bg-brand-soft text-brand-dark',
  success: 'bg-success-soft text-success',
  warning: 'bg-warning-soft text-warning',
  danger:  'bg-danger-soft text-danger',
  info:    'bg-brand-soft text-info',
};

const dotColors: Record<Tone, string> = {
  neutral: 'bg-text-muted',
  brand:   'bg-brand',
  success: 'bg-success',
  warning: 'bg-warning',
  danger:  'bg-danger',
  info:    'bg-info',
};

export function Badge({ tone = 'neutral', dot, size = 'md', className, children, ...props }: Props) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full font-medium',
        size === 'sm' ? 'px-2 py-0.5 text-[11px]' : 'px-2.5 py-0.5 text-xs',
        tones[tone],
        className,
      )}
      {...props}
    >
      {dot && <span className={cn('h-1.5 w-1.5 rounded-full', dotColors[tone])} />}
      {children}
    </span>
  );
}
