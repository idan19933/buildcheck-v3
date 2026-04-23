import { callClaude, parseJsonResponse } from './claude.service';
import type { ViewportExtraction } from './dxf.service';
import type { TavaRequirement } from './pdf-extract.service';
import { buildSemanticPromptSection, type SemanticIndex } from './semantic-index';

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
  complianceData: string;
}

function buildDxfSummary(viewportData: ViewportExtraction): DxfSummary {
  const summary: DxfSummary = {
    floorPlans: '',
    crossSections: '',
    elevations: '',
    survey: '',
    parking: '',
    areaCalculation: '',
    complianceData: '',
  };

  for (const [vpName, vp] of Object.entries(viewportData.viewports || {})) {
    const c = vp.classification;
    const parsed = vp.parsed_data as Record<string, Array<Record<string, unknown>>>;
    const geom = vp.geometry as Record<string, unknown>;

    const labels = (parsed.labels || []).map((l) => l.text).join(', ') || 'none';
    const heights = (parsed.heights || []).map((h) => `${h.value} (${h.type})`).join(', ') || 'none';
    const dims = (parsed.dimensions || []).map((d) => d.value).join(', ') || 'none';
    const pcts = (parsed.percentages || []).map((p) => p.value).join(', ') || 'none';

    const closedAreas = (parsed.closed_areas || []) as Array<Record<string, unknown>>;
    const areasStr = closedAreas.length > 0
      ? closedAreas.slice(0, 10).map((a) => `${a.area_m2_approx ?? a.area_raw}m² (layer:${a.layer}, vertices:${a.vertex_count})`).join(', ')
      : 'none';

    const section = `\n--- ${c.label} (${vpName}, scale: ${c.scale ?? 'N/A'}) ---
Labels: ${labels}
Heights: ${heights}
Dimensions: ${dims}
Percentages: ${pcts}
Closed polygon areas: ${areasStr}
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
    if (key !== 'complianceData' && !summary[key].trim()) summary[key] = 'לא נמצא ב-DXF';
  }

  const cd = (viewportData as unknown as Record<string, unknown>).compliance_data as Record<string, unknown> | undefined;
  if (cd) {
    summary.complianceData = `
--- נתונים מעובדים לבדיקה (Spatial Correlation Engine) ---

קווי בניין (setbacks):
${JSON.stringify(cd.setbacks || [], null, 2)}

מעטפת בניין (dimension chains):
${JSON.stringify(cd.building_envelope || {}, null, 2)}

נתוני מדידה (survey):
${JSON.stringify(cd.survey || null, null, 2)}

חנייה (parking):
${JSON.stringify(cd.parking || null, null, 2)}

ניתוח גבהים (height analysis):
${JSON.stringify(cd.height_analysis || null, null, 2)}
`;
  }

  return summary;
}

export async function runCoreComplianceAgent(
  viewportData: ViewportExtraction,
  tavaRequirements: TavaRequirement[],
  tavaFullText: string,
  semanticIndex: SemanticIndex | null,
): Promise<CoreAnalysisResult> {
  const dxf = buildDxfSummary(viewportData);
  const semanticSection = semanticIndex
    ? buildSemanticPromptSection(semanticIndex)
    : '## סיווג סמנטי של טקסטים\n\n_ניתוח סמנטי לא זמין לקובץ זה. ' +
      'התבסס על השדות הלא-מסווגים בלבד._';

  const prompt = `אתה מהנדס בודק תוכניות בנייה ישראלי מומחה. בדוק האם בקשת ההיתר (DXF) עומדת בדרישות התב"ע.

## שלב ראשון — סיווג סוג הפרויקט:
לפני שתבדוק דרישות, קבע את סוג הפרויקט (מגורים / מוסד / ציבור / תעשייה / מסחר / אחר).
הסתמך על תוויות בתוכניות (מטבח, חדר שינה, סלון = מגורים) ועל הטקסט בתב"ע.
ציין את סוג הפרויקט בשדה "projectType" בתשובה.
אחרי שקבעת את סוג הפרויקט, סנן דרישות שלא רלוונטיות (למשל דרישות למוסד/תעשייה/שצ"פ כשמדובר במגורים).

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

${dxf.complianceData}

${semanticSection}

## הוראות:
1. עבור כל דרישה, החזר סטטוס:
   - PASS: הדרישה רלוונטית לפרויקט זה ומתקיימת — יש ראיה מספרית ממשית מה-DXF.
   - FAIL: הדרישה רלוונטית ולא מתקיימת.
   - WARNING: הדרישה רלוונטית אך קרובה לגבול (עד 10%) או שיש ספק בנתונים.
   - CANNOT_CHECK: אם הדרישה לא רלוונטית לסוג הפרויקט — כתוב "לא רלוונטי — הפרויקט הוא [סוג]" בשדה details. אם הדרישה רלוונטית אבל אין מספיק נתונים ב-DXF — כתוב בדיוק מה חסר.
2. חשוב מאוד:
   - אל תסמן PASS אם אין לך ערך מספרי ממשי (measuredValue) שנלקח מה-DXF. אם רק ראית שהמילה "קו בניין" קיימת אבל לא מדדת מרחק — זה CANNOT_CHECK, לא PASS.
   - אם יש נתון "closed polygon areas" עם שטחים מחושבים — השתמש בהם לבדיקת שטחי בנייה ותכסית.
3. ציין בדיוק אילו נתונים מה-DXF שימשו לכל בדיקה — viewport, ערך, שכבה.
4. חשב score = PASS / (PASS + FAIL + WARNING) * 100 (ללא CANNOT_CHECK בנוסחה, אבל ציין כמה מתוך הכלל נבדקו).

## פורמט — JSON בלבד, ללא markdown:
{
  "projectType": "מגורים",
  "relevantCount": 20,
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
  "summary": "פסקת סיכום בעברית — ציין כמה דרישות רלוונטיות נבדקו בהצלחה מתוך כמה, וכמה לא ניתן היה לבדוק",
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
