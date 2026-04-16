import { BaseAddonAgent } from './base-addon-agent';

export class ElectricityAddonAgent extends BaseAddonAgent {
  domain = 'ELECTRICITY';
  displayName = 'חשמל';
  systemPromptSuffix = `התמקד בדרישות:
- חדר חשמל / נישת חשמל
- חיבור חח"י
- מיקום ארון חשמל ראשי
- חתך כבלים (אם מפורט)
- הארקה
- מתקני תאורה חיצונית`;
}
