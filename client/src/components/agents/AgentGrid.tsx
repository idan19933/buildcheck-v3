import { AgentCard } from './AgentCard';
import { AGENTS, type Agent } from './agentDefinitions';

interface Props {
  isSelected: (id: Agent['id']) => boolean;
  onCardClick: (agent: Agent) => void;
}

/**
 * 4-column grid on desktop, 2-column on tablet, 1-column on mobile.
 * Tailwind handles RTL out of the box for grid; cards stagger in via
 * delayMs.
 */
export function AgentGrid({ isSelected, onCardClick }: Props) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
      {AGENTS.map((agent, i) => (
        <AgentCard
          key={agent.id}
          agent={agent}
          selected={isSelected(agent.id)}
          onClick={onCardClick}
          delayMs={i * 60}
        />
      ))}
    </div>
  );
}
