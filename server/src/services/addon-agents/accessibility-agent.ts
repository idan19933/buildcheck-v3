import { BaseAddonAgent } from './base-addon-agent';

export class AccessibilityAddonAgent extends BaseAddonAgent {
  domain = 'ACCESSIBILITY';
  displayName = 'נגישות';
  systemPromptSuffix = `התמקד בדרישות:
- רוחב דלתות (מינימום 80 ס"מ נטו)
- רוחב מסדרונות (מינימום 110 ס"מ)
- שיפוע רמפות (מקסימום 8%)
- חנייה נגישה
- גישה נגישה מהרחוב לכניסה
- מקלחת/שירותים נגישים (אם נדרש)
- מעלית (מעל 3 קומות)
- מאחזי יד`;
}
