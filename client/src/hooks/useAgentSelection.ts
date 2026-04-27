import { useCallback, useState } from 'react';
import type { AgentId } from '../components/agents/agentDefinitions';
import { ACTIVE_AGENTS } from '../components/agents/agentDefinitions';

const ACTIVE_IDS = new Set(ACTIVE_AGENTS.map(a => a.id));

/**
 * Selection state for the agent dashboard.
 *
 * Only `active` agents can be selected (the toggle handler ignores
 * `in_development` ids on purpose — those open the ComingSoonModal
 * instead). Selection persists in component state only; if a future
 * iteration wants to survive page reloads, swap to localStorage here.
 */
export function useAgentSelection() {
  const [selected, setSelected] = useState<Set<AgentId>>(new Set());

  const toggle = useCallback((id: AgentId) => {
    if (!ACTIVE_IDS.has(id)) return;
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const clear = useCallback(() => setSelected(new Set()), []);

  const isSelected = useCallback((id: AgentId) => selected.has(id), [selected]);

  return {
    selected: Array.from(selected),
    selectedCount: selected.size,
    isSelected,
    toggle,
    clear,
  };
}
