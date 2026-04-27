import { useEffect, useRef, useState, type FormEvent } from 'react';
import { X } from 'lucide-react';
import { Button } from '../ui/Button';
import { submitNotifyMe } from '../../lib/notifyMe';
import type { Agent } from './agentDefinitions';

interface Props {
  agent: Agent | null;
  onClose: () => void;
}

/**
 * Modal shown when an in-development agent card is clicked.
 * Centered scrim + a card with the agent's icon, name, description,
 * and an email signup form.
 */
export function ComingSoonModal({ agent, onClose }: Props) {
  const [email, setEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const closeBtnRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!agent) return;
    setEmail('');
    // Focus the email input when the modal opens.
    setTimeout(() => inputRef.current?.focus(), 50);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [agent, onClose]);

  if (!agent) return null;

  const Icon = agent.icon;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (submitting || !agent) return;
    setSubmitting(true);
    try {
      await submitNotifyMe({
        agent: agent.id,
        email: email.trim(),
        timestamp: new Date().toISOString(),
      });
      onClose();
    } catch {
      // notifyMe already toasted the error; keep modal open so user can retry.
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="coming-soon-title"
      className="fixed inset-0 z-40 flex items-center justify-center p-4"
    >
      <div
        className="absolute inset-0 bg-[var(--color-modal-scrim)] backdrop-blur-sm"
        onClick={onClose}
        aria-hidden="true"
      />

      <div
        className="relative w-full max-w-md rounded-2xl bg-surface shadow-xl border border-border
                   p-7 animate-modal-in"
      >
        <button
          ref={closeBtnRef}
          type="button"
          onClick={onClose}
          aria-label="סגור"
          className="absolute top-3 start-3 h-9 w-9 inline-flex items-center justify-center rounded-md
                     text-text-soft hover:bg-surface-muted transition-colors duration-fast"
        >
          <X className="h-5 w-5" />
        </button>

        <div className="flex items-start gap-4 mb-5">
          <div
            className="h-14 w-14 inline-flex items-center justify-center rounded-xl
                       bg-surface-muted text-text-soft shrink-0"
          >
            <Icon className="h-7 w-7" strokeWidth={1.75} />
          </div>
          <div className="pt-1">
            <h2 id="coming-soon-title" className="text-2xl font-bold text-text">
              {agent.hebrewName}
            </h2>
            <p className="text-sm text-text-soft mt-0.5">
              סוכן זה נמצא בפיתוח
              {agent.comingSoonDate && ` · ${agent.comingSoonDate}`}
            </p>
          </div>
        </div>

        <p className="text-sm text-text leading-relaxed mb-6">
          {agent.hebrewDescription}
        </p>

        <form onSubmit={handleSubmit} className="space-y-3">
          <label className="block">
            <span className="text-sm font-medium text-text">
              השאר את כתובת המייל שלך ואנחנו נעדכן אותך כשהסוכן יהיה זמין
            </span>
            <input
              ref={inputRef}
              type="email"
              required
              dir="ltr"
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="you@company.com"
              className="mt-2 block w-full rounded-md border border-border bg-surface px-3 py-2
                         text-base text-text placeholder:text-text-muted
                         focus:border-brand focus:outline-none focus-visible:outline-none"
            />
          </label>
          <div className="flex items-center justify-end gap-2 pt-2">
            <Button type="button" variant="ghost" onClick={onClose}>
              ביטול
            </Button>
            <Button type="submit" loading={submitting}>
              עדכנו אותי
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
