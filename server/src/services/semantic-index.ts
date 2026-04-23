/**
 * semantic-index.ts
 * =================
 *
 * Aggregates the per-text records from `classified_texts.json` (output of
 * `python/semantic_classify.py`) into a structured index the compliance
 * agent can reason over.
 *
 * Why: the classifier produces high-confidence categorical evidence
 * ("16 building_line annotations across VIEWPORT19"), but a flat list of
 * 1,500+ records is too noisy for an LLM prompt. This module rolls them
 * up by category × key × viewport, plus elevation min/max/spread.
 */

/** Mirror of the per-text record shape written by `semantic_classify.py`. */
export interface ClassifiedTextRecord {
  block: string;
  raw: string;
  decoded: string;
  position: { x: number; y: number };
  height: number;
  layer: string;
  classification: {
    category: string | null;
    key: string | null;
    canonical_he: string | null;
    confidence: number;
    match_type: string;
  };
}

export interface SemanticSample {
  text: string;
  viewport: string;
  position: { x: number; y: number };
  confidence: number;
}

export interface CategoryIndex {
  total: number;
  byKey: Record<string, {
    total: number;
    byViewport: Record<string, number>;
    samples: SemanticSample[];
  }>;
  lowConfidenceCount: number;
}

export interface ElevationBucket {
  total: number;
  byViewport: Record<string, number>;
  min: number | null;
  max: number | null;
  spread: number | null;
  samples: Array<{ value: number; viewport: string }>;
}

export interface SemanticIndex {
  totalTexts: number;
  boundaries: CategoryIndex;
  rooms: CategoryIndex;
  constructionElements: CategoryIndex;
  changes: CategoryIndex;
  sheetLabels: CategoryIndex;
  codeReferences: CategoryIndex;
  dimensionModifiers: CategoryIndex;
  finishes: CategoryIndex;
  elevations: {
    absolute: ElevationBucket;
    relative: ElevationBucket;
    viewportsWithBoth: string[];
  };
  noiseCount: number;
  unclassifiedCount: number;
  lowConfidenceCount: number;
}

const HIGH_CONF = 0.7;
const MAX_SAMPLES = 5;
// Israeli site elevations (אבסולוטיים) are everywhere ≥ ~50m above sea level
// outside the Dead Sea basin; relative datum elevations on a permit are
// almost always < 30m. 50 is a conservative split that keeps Negev / Galilee
// sites in the absolute bucket without misclassifying tall renovations.
const ABSOLUTE_ELEVATION_MIN_ABS = 50;

function emptyCategory(): CategoryIndex {
  return { total: 0, byKey: {}, lowConfidenceCount: 0 };
}

function emptyElevationBucket(): ElevationBucket {
  return {
    total: 0, byViewport: {}, min: null, max: null, spread: null, samples: [],
  };
}

function pushElevation(
  bucket: ElevationBucket,
  r: ClassifiedTextRecord,
  val: number,
  viewportSet: Set<string>,
): void {
  bucket.total++;
  bucket.byViewport[r.block] = (bucket.byViewport[r.block] || 0) + 1;
  bucket.min = bucket.min === null ? val : Math.min(bucket.min, val);
  bucket.max = bucket.max === null ? val : Math.max(bucket.max, val);
  bucket.spread = bucket.max !== null && bucket.min !== null
    ? bucket.max - bucket.min : null;
  if (bucket.samples.length < 10) {
    bucket.samples.push({ value: val, viewport: r.block });
  }
  viewportSet.add(r.block);
}

export function buildSemanticIndex(records: ClassifiedTextRecord[]): SemanticIndex {
  const categoryMap: Record<string, CategoryIndex> = {
    boundaries: emptyCategory(),
    rooms: emptyCategory(),
    construction_elements: emptyCategory(),
    changes: emptyCategory(),
    sheet_labels: emptyCategory(),
    code_references: emptyCategory(),
    dimension_modifiers: emptyCategory(),
    finishes: emptyCategory(),
  };

  const elevations = {
    absolute: emptyElevationBucket(),
    relative: emptyElevationBucket(),
    viewportsWithBoth: [] as string[],
  };
  const absVps = new Set<string>();
  const relVps = new Set<string>();

  let noiseCount = 0;
  let unclassifiedCount = 0;
  let lowConfidenceCount = 0;

  for (const r of records) {
    const c = r.classification;

    // Elevations come through Layer 1c as match_type='numeric_pattern',
    // key='elevation'. The classifier doesn't distinguish absolute (סא"ב)
    // from relative (מנקודת ייחוס) — we split here by magnitude.
    if (c.match_type === 'numeric_pattern' && c.key === 'elevation') {
      const cleaned = r.decoded.trim().replace(/^[+\u00B1]/, '').replace(',', '.');
      const val = parseFloat(cleaned);
      if (!Number.isFinite(val)) continue;
      if (Math.abs(val) >= ABSOLUTE_ELEVATION_MIN_ABS) {
        pushElevation(elevations.absolute, r, val, absVps);
      } else {
        pushElevation(elevations.relative, r, val, relVps);
      }
      continue;
    }

    if (c.match_type === 'noise') { noiseCount++; continue; }
    if (c.match_type === 'unclassified') { unclassifiedCount++; continue; }

    const cat = c.category;
    if (!cat || !(cat in categoryMap)) continue;
    const idx = categoryMap[cat];

    if (c.confidence < HIGH_CONF) {
      idx.lowConfidenceCount++;
      lowConfidenceCount++;
      continue;
    }

    idx.total++;
    const key = c.key || 'unknown';
    if (!idx.byKey[key]) {
      idx.byKey[key] = { total: 0, byViewport: {}, samples: [] };
    }
    const bucket = idx.byKey[key];
    bucket.total++;
    bucket.byViewport[r.block] = (bucket.byViewport[r.block] || 0) + 1;
    if (bucket.samples.length < MAX_SAMPLES) {
      bucket.samples.push({
        text: r.decoded,
        viewport: r.block,
        position: r.position,
        confidence: c.confidence,
      });
    }
  }

  // Viewports that carry BOTH absolute and relative elevations are
  // sections / elevations — building height = absolute.spread on those.
  elevations.viewportsWithBoth = [...absVps].filter(v => relVps.has(v));

  return {
    totalTexts: records.length,
    boundaries: categoryMap.boundaries,
    rooms: categoryMap.rooms,
    constructionElements: categoryMap.construction_elements,
    changes: categoryMap.changes,
    sheetLabels: categoryMap.sheet_labels,
    codeReferences: categoryMap.code_references,
    dimensionModifiers: categoryMap.dimension_modifiers,
    finishes: categoryMap.finishes,
    elevations,
    noiseCount,
    unclassifiedCount,
    lowConfidenceCount,
  };
}

// ─────────────────────────────────────────────── prompt rendering

function summarizeCategoryTotals(idx: SemanticIndex): string {
  const parts: string[] = [];
  if (idx.boundaries.total) parts.push(`${idx.boundaries.total} גבולות`);
  if (idx.rooms.total) parts.push(`${idx.rooms.total} חדרים`);
  if (idx.constructionElements.total)
    parts.push(`${idx.constructionElements.total} אלמנטי בנייה`);
  if (idx.changes.total) parts.push(`${idx.changes.total} שינויים`);
  if (idx.sheetLabels.total)
    parts.push(`${idx.sheetLabels.total} תוויות גיליון`);
  if (idx.elevations.absolute.total)
    parts.push(`${idx.elevations.absolute.total} רומים מוחלטים`);
  if (idx.elevations.relative.total)
    parts.push(`${idx.elevations.relative.total} רומים יחסיים`);
  return parts.length ? parts.join(', ') : 'אין';
}

/**
 * Render the index into a Hebrew-headed prompt section. Designed to be
 * spliced into the compliance agent prompt right after the legacy
 * viewport summary and before the requirements list.
 */
export function buildSemanticPromptSection(idx: SemanticIndex): string {
  const lines: string[] = [
    '## סיווג סמנטי של טקסטים (Semantic Classification Index)',
    '',
    '_The following data comes from a deterministic 3-layer classifier ' +
    'with confidence ≥ 0.7 on all items. Trust these counts and use them ' +
    'when answering compliance requirements._',
    '',
    `סך הכול ${idx.totalTexts} טקסטים בקובץ. ` +
    `סווגו בוודאות גבוהה: ${summarizeCategoryTotals(idx)}. ` +
    `לא זוהו: ${idx.unclassifiedCount}. רעש: ${idx.noiseCount}.`,
    '',
  ];

  if (idx.boundaries.total > 0) {
    lines.push('### גבולות (Boundaries)');
    for (const [key, data] of Object.entries(idx.boundaries.byKey)) {
      lines.push(`- **${key}**: ${data.total} annotations across viewports ` +
                 `[${Object.keys(data.byViewport).join(', ')}]`);
      for (const s of data.samples.slice(0, 3)) {
        lines.push(`  - e.g. "${s.text}" on ${s.viewport} ` +
                   `at (${s.position.x.toFixed(1)}, ${s.position.y.toFixed(1)})`);
      }
    }
    lines.push('');
  }

  if (idx.rooms.total > 0) {
    lines.push('### חדרים (Rooms)');
    for (const [key, data] of Object.entries(idx.rooms.byKey)) {
      lines.push(`- **${key}**: ${data.total} labels in viewports ` +
                 `[${Object.keys(data.byViewport).join(', ')}]`);
    }
    lines.push('');
  }

  const abs = idx.elevations.absolute;
  const rel = idx.elevations.relative;
  if (abs.total > 0 || rel.total > 0) {
    lines.push('### רומים (Elevations)');
    if (abs.total > 0) {
      lines.push(
        `- **Absolute elevations** (מעל פני הים): ${abs.total} callouts, ` +
        `range ${abs.min?.toFixed(2)} to ${abs.max?.toFixed(2)} ` +
        `(spread ${abs.spread?.toFixed(2)} m)`,
      );
    }
    if (rel.total > 0) {
      lines.push(
        `- **Relative elevations** (מנקודת ייחוס): ${rel.total} callouts, ` +
        `range ${rel.min?.toFixed(2)} to ${rel.max?.toFixed(2)} ` +
        `(spread ${rel.spread?.toFixed(2)} m)`,
      );
    }
    if (idx.elevations.viewportsWithBoth.length > 0) {
      lines.push(
        `- **Sections/elevations** (ויופורטים עם רומים מוחלטים ויחסיים): ` +
        `[${idx.elevations.viewportsWithBoth.join(', ')}]. ` +
        `גובה בניין ניתן לחישוב מהפרש רומים מוחלטים בכל אחד מאלה.`,
      );
    }
    lines.push('');
  }

  if (idx.changes.total > 0) {
    lines.push('### שינויים (Change Annotations)');
    lines.push(
      `Total: ${idx.changes.total}. Presence of change annotations indicates ` +
      `a renovation (שיפוץ/תוספת) rather than new construction. ` +
      `Apply renovation rules.`,
    );
    for (const [key, data] of Object.entries(idx.changes.byKey)) {
      lines.push(`- ${key}: ${data.total}`);
    }
    lines.push('');
  }

  if (idx.sheetLabels.total > 0) {
    lines.push('### תוויות גיליון (Sheet Labels from Drawing Index)');
    for (const [key, data] of Object.entries(idx.sheetLabels.byKey)) {
      lines.push(`- ${key}: on [${Object.keys(data.byViewport).join(', ')}]`);
    }
    lines.push('');
  }

  if (idx.constructionElements.total > 0) {
    lines.push('### אלמנטי בנייה (Construction Elements)');
    for (const [key, data] of Object.entries(idx.constructionElements.byKey)) {
      lines.push(`- ${key}: ${data.total}`);
    }
    lines.push('');
  }

  lines.push('### הנחיות שימוש');
  lines.push(
    '- Use the semantic index as primary evidence. The raw `Labels` field ' +
    'in the viewport summary contains the same texts without classification — ' +
    'prefer the structured counts above.\n' +
    '- For setback checks: pair building_line annotations with plot_boundary ' +
    'annotations on the **same viewport** (same drawing = same coordinate system).\n' +
    '- For building-height checks: use viewports listed under ' +
    '`viewportsWithBoth` — those are the sections with absolute elevations.\n' +
    '- If the semantic index shows evidence for a requirement but the ' +
    'numeric value cannot be computed without geometric analysis, return ' +
    'CANNOT_CHECK with a note explaining what extraction is missing — ' +
    'NOT "no data".',
  );

  return lines.join('\n');
}
