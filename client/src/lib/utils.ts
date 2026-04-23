import clsx, { type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/** Compose Tailwind classes — clsx for conditional logic, twMerge to dedupe conflicts. */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

/** Format an ISO date string as a Hebrew relative time ("לפני שעתיים"). */
export function timeAgoHe(iso: string | Date | null | undefined): string {
  if (!iso) return '';
  const t = typeof iso === 'string' ? new Date(iso).getTime() : iso.getTime();
  const diff = Math.max(0, Date.now() - t);
  const m = Math.floor(diff / 60_000);
  if (m < 1) return 'לפני רגע';
  if (m < 60) return `לפני ${m} דקות`;
  const h = Math.floor(m / 60);
  if (h < 24) return h === 1 ? 'לפני שעה' : h === 2 ? 'לפני שעתיים' : `לפני ${h} שעות`;
  const d = Math.floor(h / 24);
  if (d < 7) return d === 1 ? 'אתמול' : `לפני ${d} ימים`;
  const w = Math.floor(d / 7);
  if (w < 4) return w === 1 ? 'לפני שבוע' : `לפני ${w} שבועות`;
  const mo = Math.floor(d / 30);
  return mo === 1 ? 'לפני חודש' : `לפני ${mo} חודשים`;
}

/** Score → semantic tone bucket. */
export function scoreTone(score: number | null | undefined): 'success' | 'warning' | 'danger' | 'neutral' {
  if (score == null) return 'neutral';
  if (score >= 80) return 'success';
  if (score >= 60) return 'warning';
  return 'danger';
}
