import { callClaude, parseJsonResponse } from './claude.service';
import type { ViewportExtraction } from './dxf.service';
import type { TavaRequirement } from './pdf-extract.service';

export interface ComplianceResult {
  requirement: string;
  source: string;
  status: 'PASS' | 'FAIL' | 'WARNING' | 'CANNOT_CHECK';
  details: string;
  dxfEvidence: string;
  measuredValue: string | number | null;
  requiredValue: string | number | null;
  category: string;
}

export interface CoreAnalysisResult {
  requirements: ComplianceResult[];
  summary: string;
  score: number;
  passCount: number;
  failCount: number;
  warningCount: number;
  cannotCheckCount: number;
}

interface DxfSummary {
  floorPlans: string;
  crossSections: string;
  elevations: string;
  survey: string;
  parking: string;
  areaCalculation: string;
}

function buildDxfSummary(viewportData: ViewportExtraction): DxfSummary {
  const summary: DxfSummary = {
    floorPlans: '',
    crossSections: '',
    elevations: '',
    survey: '',
    parking: '',
    areaCalculation: '',
  };

  for (const [vpName, vp] of Object.entries(viewportData.viewports || {})) {
    const c = vp.classification;
    const parsed = vp.parsed_data as Record<string, Array<Record<string, unknown>>>;
    const geom = vp.geometry as Record<string, unknown>;

    const labels = (parsed.labels || []).map((l) => l.text).join(', ') || 'none';
    const heights = (parsed.heights || []).map((h) => `${h.value} (${h.type})`).join(', ') || 'none';
    const dims = (parsed.dimensions || []).map((d) => d.value).join(', ') || 'none';
    const pcts = (parsed.percentages || []).map((p) => p.value).join(', ') || 'none';

    const section = `\n--- ${c.label} (${vpName}, scale: ${c.scale ?? 'N/A'}) ---
Labels: ${labels}
Heights: ${heights}
Dimensions: ${dims}
Percentages: ${pcts}
Geometry: ${geom.total_entities ?? 0} entities, bbox: ${JSON.stringify(geom.bounding_box ?? 'N/A')}
`;

    switch (c.type) {
      case 'floor_plan':
      case 'roof_plan':
      case 'site_plan':
        summary.floorPlans += section;
        break;
      case 'cross_section':
        summary.crossSections += section;
        break;
      case 'elevation':
        summary.elevations += section;
        break;
      case 'survey':
        summary.survey += section;
        break;
      case 'parking_section':
        summary.parking += section;
        break;
      case 'area_calculation':
        summary.areaCalculation += section;
        break;
      default:
        summary.floorPlans += section;
    }
  }

  for (const key of Object.keys(summary) as Array<keyof DxfSummary>) {
    if (!summary[key].trim()) summary[key] = 'לא נמצא ב-DXF';
  }
  return summary;
}

export async function runCoreComplianceAgent(
  viewportData: ViewportExtraction,
  tavaRequirements: TavaRequirement[],
  tavaFullText: string,
): Promise<CoreAnalysisResult> {
  const dxf = buildDxfSummary(viewportData);

  const prompt = `אתה מהנדס בודק תוכניות בנייה ישראלי. בדוק האם בקשת ההיתר (DXF) עומדת בדרישות התב"ע.

## דרישות התב"ע:
${JSON.stringify(tavaRequirements, null, 2)}

## טקסט התב"ע (לקונטקסט):
${tavaFullText.slice(0, 8000)}

## נתוני DXF:

### תוכניות:
${dxf.floorPlans}

### חתכים:
${dxf.crossSections}

### חזיתות:
${dxf.elevations}

### מדידה / פיתוח:
${dxf.survey}

### חנייה:
${dxf.parking}

### חישוב שטחים:
${dxf.areaCalculation}

## הוראות:
1. עבור כל דרישה, החזר סטטוס:
   - PASS: הדרישה רלוונטית לפרויקט זה ומתקיימת.
   - FAIL: הדרישה רלוונטית ולא מתקיימת.
   - WARNING: הדרישה רלוונטית אך קרובה לגבול (עד 10%) או שיש ספק.
   - CANNOT_CHECK: אין מספיק נתונים ב-DXF, או שהדרישה לא רלוונטית לסוג הבניין (למשל, דרישות למוסד/תעשייה כשמדובר במגורים).
2. חשוב מאוד: אם דרישה מתייחסת לשימוש שאינו קיים בפרויקט (למשל, "שטח מסחר" בבניין מגורים בלבד), סמן CANNOT_CHECK עם הסבר "לא רלוונטי לסוג השימוש בפרויקט", ולא PASS.
3. ציין בדיוק אילו נתונים מה-DXF שימשו לכל בדיקה.
4. חשב score = (PASS / (PASS + FAIL + WARNING)) * 100. אל תכלול CANNOT_CHECK בנוסחה.

## פורמט — JSON בלבד, ללא markdown:
{
  "requirements": [
    {
      "requirement": "...",
      "source": "סעיף X",
      "status": "PASS",
      "details": "...",
      "dxfEvidence": "...",
      "measuredValue": null,
      "requiredValue": null,
      "category": "area"
    }
  ],
  "summary": "פסקת סיכום בעברית",
  "score": 75
}`;

  const raw = await callClaude(prompt, 'opus', [], { maxTokens: 16000 });
  const parsed = parseJsonResponse<{
    requirements: ComplianceResult[];
    summary: string;
    score: number;
  }>(raw);

  const reqs = parsed.requirements || [];
  return {
    requirements: reqs,
    summary: parsed.summary || '',
    score: parsed.score || 0,
    passCount: reqs.filter((r) => r.status === 'PASS').length,
    failCount: reqs.filter((r) => r.status === 'FAIL').length,
    warningCount: reqs.filter((r) => r.status === 'WARNING').length,
    cannotCheckCount: reqs.filter((r) => r.status === 'CANNOT_CHECK').length,
  };
}
