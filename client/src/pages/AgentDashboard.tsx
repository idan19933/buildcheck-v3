import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { AgentGrid } from '../components/agents/AgentGrid';
import { AgentSelectionBar } from '../components/agents/AgentSelectionBar';
import { ComingSoonModal } from '../components/agents/ComingSoonModal';
import { useAgentSelection } from '../hooks/useAgentSelection';
import type { Agent } from '../components/agents/agentDefinitions';

/**
 * The new default landing page after authentication: pick which
 * compliance agents to run on a project. Active agents are toggleable;
 * in-development agents open a "notify me" modal.
 */
export default function AgentDashboard() {
  const navigate = useNavigate();
  const { selectedCount, isSelected, toggle, clear, selected } = useAgentSelection();
  const [comingSoonAgent, setComingSoonAgent] = useState<Agent | null>(null);

  const handleCardClick = (agent: Agent) => {
    if (agent.status === 'active') {
      toggle(agent.id);
    } else {
      setComingSoonAgent(agent);
    }
  };

  const handleContinue = () => {
    // Currently only `building_permits` is fully implemented in the
    // backend. If the user picked only not-yet-implemented active
    // agents, surface that honestly rather than silently failing later.
    if (!selected.includes('building_permits')) {
      toast.warning('כרגע פעיל רק סוכן היתרי בנייה', {
        description: 'הוסף "היתרי בנייה" לבחירה כדי להתחיל ניתוח. שאר הסוכנים יראו "בקרוב" בדוח.',
      });
      return;
    }
    const params = new URLSearchParams();
    params.set('agents', selected.join(','));
    navigate(`/new?${params.toString()}`);
  };

  return (
    <div className="pb-24">
      {/* Header */}
      <div className="mb-8 lg:mb-12">
        <h1 className="text-3xl lg:text-4xl font-bold text-text leading-tight">
          סוכני בדיקת התאמה לבנייה
        </h1>
        <p className="mt-3 text-lg text-text-soft max-w-2xl">
          בחר אחד או יותר מהסוכנים המתמחים שלנו. כל סוכן בודק תחום אחר
          בהתאם לרגולציות והדרישות הרלוונטיות.
        </p>
      </div>

      {/* Section labels */}
      <div className="mb-4 flex items-baseline gap-3">
        <h2 className="text-base font-semibold text-text">סוכנים זמינים</h2>
        <span className="text-sm text-text-muted">
          לחץ על כרטיס סוכן כדי לבחור או לקבל עדכון
        </span>
      </div>

      {/* Grid */}
      <AgentGrid isSelected={isSelected} onCardClick={handleCardClick} />

      {/* Sticky selection bar */}
      <AgentSelectionBar
        count={selectedCount}
        onContinue={handleContinue}
        onClear={clear}
      />

      {/* Coming soon modal */}
      <ComingSoonModal agent={comingSoonAgent} onClose={() => setComingSoonAgent(null)} />
    </div>
  );
}
