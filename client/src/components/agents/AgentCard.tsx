import { Check } from 'lucide-react';
import { Badge } from '../ui/Badge';
import { cn } from '../../lib/utils';
import type { Agent } from './agentDefinitions';

interface Props {
  agent: Agent;
  selected?: boolean;
  onClick: (agent: Agent) => void;
  /** Stagger fade-in delay in milliseconds. */
  delayMs?: number;
}

/**
 * One agent card. Active cards behave as toggles (selection state).
 * In-development cards behave as buttons (open the ComingSoonModal).
 * RTL-correct throughout — the selection check sits in the top-start
 * corner, the status badge in the top-end.
 */
export function AgentCard({ agent, selected = false, onClick, delayMs = 0 }: Props) {
  const Icon = agent.icon;
  const isActive = agent.status === 'active';

  return (
    <button
      type="button"
      onClick={() => onClick(agent)}
      aria-pressed={isActive ? selected : undefined}
      aria-label={
        isActive
          ? `${agent.hebrewName} — ${selected ? 'נבחר' : 'בחירה'}`
          : `${agent.hebrewName} — בפיתוח, לחץ להירשם להתראה`
      }
      className={cn(
        'group relative w-full text-start rounded-xl border bg-surface p-6',
        'transition-all duration-base focus-visible:outline-none',
        'animate-card-in opacity-0',
        isActive
          ? cn(
              'cursor-pointer',
              selected
                ? 'border-brand shadow-md ring-2 ring-brand/20 -translate-y-0.5'
                : 'border-border hover:border-border-strong hover:shadow-md hover:-translate-y-0.5',
            )
          : 'border-border cursor-pointer hover:border-border-strong opacity-75 hover:opacity-90',
      )}
      style={{ animationDelay: `${delayMs}ms` }}
    >
      {/* Status badge — top-end (left in RTL) */}
      <div className="absolute top-4 start-4">
        <Badge
          tone={isActive ? 'success' : 'neutral'}
          size="sm"
          dot
          className={cn(!isActive && 'opacity-80')}
        >
          {isActive ? 'פעיל' : 'בפיתוח'}
        </Badge>
      </div>

      {/* Selection indicator — top-start (right in RTL), only on active cards */}
      {isActive && (
        <div
          className={cn(
            'absolute top-4 end-4 h-6 w-6 rounded-full border-2 flex items-center justify-center',
            'transition-all duration-fast',
            selected
              ? 'bg-brand border-brand text-white'
              : 'border-border-strong group-hover:border-brand/60',
          )}
          aria-hidden="true"
        >
          {selected && <Check className="h-3.5 w-3.5" strokeWidth={3} />}
        </div>
      )}

      {/* Icon */}
      <div
        className={cn(
          'mt-8 mb-5 inline-flex h-14 w-14 items-center justify-center rounded-xl',
          'transition-colors duration-base',
          isActive
            ? selected
              ? 'bg-brand text-white'
              : 'bg-brand-soft text-brand group-hover:bg-brand group-hover:text-white'
            : 'bg-surface-muted text-text-muted',
        )}
      >
        <Icon className="h-7 w-7" strokeWidth={1.75} />
      </div>

      {/* Name */}
      <h3 className="text-xl font-bold text-text mb-2 leading-tight">
        {agent.hebrewName}
      </h3>

      {/* Description */}
      <p className="text-sm text-text-soft leading-relaxed">
        {agent.hebrewDescription}
      </p>
    </button>
  );
}
