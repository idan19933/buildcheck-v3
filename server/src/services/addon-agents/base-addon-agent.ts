import { callClaude, parseJsonResponse } from '../claude.service';
import type { ViewportExtraction } from '../dxf.service';

export interface AddonRequirement {
  requirement: string;
  source: string;
  status: 'PASS' | 'FAIL' | 'WARNING' | 'CANNOT_CHECK';
  details: string;
  dxfEvidence: string;
  measuredValue: string | number | null;
  requiredValue: string | number | null;
}

export interface AddonAgentResult {
  domain: string;
  displayName: string;
  requirements: AddonRequirement[];
  summary: string;
  score: number;
  passCount: number;
  failCount: number;
  warningCount: number;
  cannotCheckCount: number;
}

export abstract class BaseAddonAgent {
  abstract domain: string;
  abstract displayName: string;
  abstract systemPromptSuffix: string;

  async analyze(
    viewportData: ViewportExtraction,
    regulationText: string,
    tavaText: string,
  ): Promise<AddonAgentResult> {
    const prompt = `אתה מומחה ב${this.displayName} לבנייה בישראל. בדוק האם בקשת ההיתר עומדת בדרישות.

${this.systemPromptSuffix}

## מסמך דרישות ${this.displayName}:
${regulationText.slice(0, 8000)}

## דרישות תב"ע (לקונטקסט):
${tavaText.slice(0, 3000)}

## נתוני DXF (מקוצרים):
${JSON.stringify(summarizeViewports(viewportData)).slice(0, 8000)}

## פורמט — JSON בלבד:
{
  "requirements": [
    {
      "requirement": "...",
      "source": "...",
      "status": "PASS|FAIL|WARNING|CANNOT_CHECK",
      "details": "...",
      "dxfEvidence": "...",
      "measuredValue": null,
      "requiredValue": null
    }
  ],
  "summary": "...",
  "score": 0
}`;

    const raw = await callClaude(prompt, 'opus', [], { maxTokens: 12000 });
    const parsed = parseJsonResponse<{
      requirements: AddonRequirement[];
      summary: string;
      score: number;
    }>(raw);

    const reqs = parsed.requirements || [];
    return {
      domain: this.domain,
      displayName: this.displayName,
      requirements: reqs,
      summary: parsed.summary || '',
      score: parsed.score || 0,
      passCount: reqs.filter((r) => r.status === 'PASS').length,
      failCount: reqs.filter((r) => r.status === 'FAIL').length,
      warningCount: reqs.filter((r) => r.status === 'WARNING').length,
      cannotCheckCount: reqs.filter((r) => r.status === 'CANNOT_CHECK').length,
    };
  }
}

function summarizeViewports(vp: ViewportExtraction) {
  const out: Record<string, unknown> = { types_found: vp.summary.types_found };
  for (const [name, data] of Object.entries(vp.viewports)) {
    out[name] = {
      classification: data.classification,
      parsed: data.parsed_data,
      layers: (data.geometry as { layers_used?: string[] }).layers_used ?? [],
    };
  }
  return out;
}
