import type { ReactNode } from 'react';
import { TrendingUp, TrendingDown, Minus } from 'lucide-react';
import { cn } from '../../lib/utils';

type Tone = 'neutral' | 'success' | 'warning' | 'danger';

interface Props {
  label: string;
  value: string | number;
  unit?: string;
  icon?: ReactNode;
  trend?: { value: number; direction: 'up' | 'down' | 'flat' };
  tone?: Tone;
  loading?: boolean;
}

const tones: Record<Tone, string> = {
  neutral: 'bg-surface border-border',
  success: 'bg-success-soft border-success/20',
  warning: 'bg-warning-soft border-warning/20',
  danger:  'bg-danger-soft border-danger/20',
};

export function StatCard({ label, value, unit, icon, trend, tone = 'neutral', loading }: Props) {
  if (loading) return <div className="h-28 rounded-lg bg-surface-muted animate-pulse" />;

  const TrendIcon = trend?.direction === 'up' ? TrendingUp
    : trend?.direction === 'down' ? TrendingDown
    : Minus;
  const trendColor = trend?.direction === 'up' ? 'text-success'
    : trend?.direction === 'down' ? 'text-danger'
    : 'text-text-muted';

  return (
    <div className={cn('p-5 rounded-lg border shadow-xs', tones[tone])}>
      <div className="flex items-center justify-between mb-3">
        <span className="text-sm text-text-soft font-medium">{label}</span>
        {icon && <span className="text-text-muted">{icon}</span>}
      </div>
      <div className="flex items-baseline gap-2">
        <span className="text-2xl font-semibold text-text font-latin tabular-nums" dir="ltr">{value}</span>
        {unit && <span className="text-sm text-text-soft">{unit}</span>}
      </div>
      {trend && (
        <div className={cn('flex items-center gap-1 mt-2 text-sm', trendColor)}>
          <TrendIcon className="h-3.5 w-3.5" />
          <span dir="ltr" className="font-latin">{trend.value > 0 ? '+' : ''}{trend.value}%</span>
        </div>
      )}
    </div>
  );
}
