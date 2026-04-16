import { BaseAddonAgent } from './base-addon-agent';

export class FireAddonAgent extends BaseAddonAgent {
  domain = 'FIRE';
  displayName = 'כיבוי אש';
  systemPromptSuffix = `התמקד בדרישות:
- מרחקי מילוט מחדרים ומדירות
- רוחב מסדרונות ודלתות יציאה
- גישה לרכב כיבוי
- מערכת גילוי וכיבוי אש (אם מסומנת)
- תאורת חירום (אם מסומנת)
- חומרי בנייה עמידי אש (אם ניתן לקבוע מה-DXF)`;
}
