import { toast } from 'sonner';
import type { AgentId } from '../components/agents/agentDefinitions';

interface NotifyMeRequest {
  agent: AgentId;
  email: string;
  timestamp: string;
}

const STORAGE_KEY = 'notify_me_signups_v1';

/**
 * No backend endpoint yet — capture client-side and surface to the user.
 * Persisted to localStorage so signups survive a page reload, and logged
 * to the console so a curious developer can extract them later.
 *
 * Replace with a real POST to /api/notify-me when the backend lands.
 */
export async function submitNotifyMe(req: NotifyMeRequest): Promise<void> {
  // Validate email shape — fail-fast before persisting garbage.
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(req.email)) {
    toast.error('כתובת מייל לא חוקית');
    throw new Error('invalid email');
  }

  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const list: NotifyMeRequest[] = raw ? JSON.parse(raw) : [];
    list.push(req);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
  } catch {
    // localStorage may be disabled (private mode etc.) — fall through to log+toast.
  }

  console.log('[notify-me]', req);
  toast.success('תודה! נעדכן אותך כשהסוכן יהיה זמין', {
    description: req.email,
  });
}
