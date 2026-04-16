import { BaseAddonAgent } from './base-addon-agent';

export class WaterAddonAgent extends BaseAddonAgent {
  domain = 'WATER';
  displayName = 'מים וביוב';
  systemPromptSuffix = `התמקד בדרישות:
- חיבור למערכת מים עירונית
- קוטר צנרת ראשית
- מיקום שוחות ביוב
- ניקוז מי גשמים
- מיקום מד מים
- מרחק מקו ביוב עירוני`;
}
