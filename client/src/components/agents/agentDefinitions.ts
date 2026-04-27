import {
  Flame,
  FileCheck,
  Zap,
  Droplets,
  Accessibility,
  Route,
  TrafficCone,
  Train,
  type LucideIcon,
} from 'lucide-react';

export type AgentId =
  | 'fire_safety'
  | 'building_permits'
  | 'electricity'
  | 'plumbing'
  | 'accessibility'
  | 'roads'
  | 'traffic_lights'
  | 'railway_cars';

export type AgentStatus = 'active' | 'in_development';

export interface Agent {
  id: AgentId;
  hebrewName: string;
  englishName: string;
  hebrewDescription: string;
  englishDescription: string;
  status: AgentStatus;
  icon: LucideIcon;
  /** Optional ETA copy ("Q3 2026") — when omitted the modal stays open-ended. */
  comingSoonDate?: string;
  /** Routes the user lands on when selected — only meaningful for active agents. */
  flow?: 'compliance';
}

/**
 * The 8 agents shown on the landing page. Order = display order.
 * Active agents come first (4), in-development agents follow (4).
 * Match the customer-facing slide; only `building_permits` has a real
 * compliance backend today — the other "active" agents route to the
 * same flow and surface a coming-soon section per agent in the report.
 */
export const AGENTS: Agent[] = [
  {
    id: 'fire_safety',
    hebrewName: 'בטיחות אש',
    englishName: 'Fire Safety',
    hebrewDescription:
      'בדיקות רגולטוריות: יציאות חירום, ספרינקלרים, גלאי עשן, דלתות אש, מסלולי פינוי',
    englishDescription:
      'Regulatory checks: emergency exits, sprinklers, smoke detectors, fire doors, evacuation routes',
    status: 'active',
    icon: Flame,
    flow: 'compliance',
  },
  {
    id: 'building_permits',
    hebrewName: 'היתרי בנייה',
    englishName: 'Building Permits',
    hebrewDescription:
      'גליון דרישות עירוני: נסיגות, גבהים, חניה, גישות, שטחי מרחבים מוגנים',
    englishDescription:
      'Municipal info sheet: setbacks, heights, parking, access, safe-room areas',
    status: 'active',
    icon: FileCheck,
    flow: 'compliance',
  },
  {
    id: 'electricity',
    hebrewName: 'חשמל',
    englishName: 'Electricity',
    hebrewDescription:
      'תקנון בנייה ארצי ומקומי: מיזוג חדרים, אוורור, תאורה, ביצוע, חיפוי, ניקוז',
    englishDescription:
      'National and local code: room HVAC, ventilation, lighting, execution, finishes, drainage',
    status: 'active',
    icon: Zap,
    flow: 'compliance',
  },
  {
    id: 'plumbing',
    hebrewName: 'אינסטלציה',
    englishName: 'Plumbing',
    hebrewDescription: 'צנרת, ברזים, שיפועים, חיבור לרשת המים והביוב',
    englishDescription: 'Pipes, valves, slopes, connection to water and sewage networks',
    status: 'active',
    icon: Droplets,
    flow: 'compliance',
  },

  // ── In development ──────────────────────────────────────────────
  {
    id: 'accessibility',
    hebrewName: 'נגישות',
    englishName: 'Accessibility',
    hebrewDescription:
      'נגישות, תכנון ירוק, קונסטרוקציה, מערכות מכניות — כל מסמך דרישות שתעלה',
    englishDescription:
      'Accessibility, green design, structural and mechanical systems — any requirements doc you upload',
    status: 'in_development',
    icon: Accessibility,
  },
  {
    id: 'roads',
    hebrewName: 'כבישים',
    englishName: 'Roads',
    hebrewDescription:
      'נגישות, תכנון ירוק, קונסטרוקציה, מערכות מכניות — כל מסמך דרישות שתעלה',
    englishDescription:
      'Accessibility, green design, structural and mechanical systems — any requirements doc you upload',
    status: 'in_development',
    icon: Route,
  },
  {
    id: 'traffic_lights',
    hebrewName: 'רמזורים',
    englishName: 'Traffic Lights',
    hebrewDescription:
      'נגישות, תכנון ירוק, קונסטרוקציה, מערכות מכניות — כל מסמך דרישות שתעלה',
    englishDescription:
      'Accessibility, green design, structural and mechanical systems — any requirements doc you upload',
    status: 'in_development',
    icon: TrafficCone,
  },
  {
    id: 'railway_cars',
    hebrewName: 'קרונות',
    englishName: 'Railway Cars',
    hebrewDescription:
      'נגישות, תכנון ירוק, קונסטרוקציה, מערכות מכניות — כל מסמך דרישות שתעלה',
    englishDescription:
      'Accessibility, green design, structural and mechanical systems — any requirements doc you upload',
    status: 'in_development',
    icon: Train,
  },
];

export function getAgent(id: AgentId): Agent | undefined {
  return AGENTS.find(a => a.id === id);
}

export const ACTIVE_AGENTS = AGENTS.filter(a => a.status === 'active');
export const IN_DEVELOPMENT_AGENTS = AGENTS.filter(a => a.status === 'in_development');
