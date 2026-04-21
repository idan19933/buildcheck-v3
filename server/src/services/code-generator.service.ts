import crypto from 'crypto';
import { mkdirSync, readFileSync, writeFileSync, statSync } from 'fs';
import path from 'path';
import { callClaude, type ImageBlock } from './claude.service';

const GENERATED_DIR = path.resolve(__dirname, '../../python/generated');

/**
 * Ask Claude to write a Python extraction script tailored to a specific
 * DXF file's structural fingerprint. The generated script will later be
 * invoked with `python extract_<hash>.py <dxf_path> <svg_out_dir>`.
 *
 * Returns the absolute path of the saved script.
 */
export interface CodegenOptions {
  /**
   * Absolute paths of preview PNGs to send to Claude as visual context. Used
   * for encoding-agnostic label decoding — Claude correlates the numbered
   * red dots on each PNG with the raw text_samples in the exploration JSON.
   * Capped at MAX_PREVIEW_IMAGES below to keep token cost reasonable.
   */
  previewImagePaths?: string[];
}

const MAX_PREVIEW_IMAGES = 6;
const MAX_IMAGE_BYTES = 2 * 1024 * 1024;   // 2 MB ceiling per image — skip giants

export async function generateExtractionScript(
  explorationJson: unknown,
  opts: CodegenOptions = {},
): Promise<string> {
  const scriptHash = fingerprintExploration(explorationJson);
  const scriptPath = path.join(GENERATED_DIR, `extract_${scriptHash}.py`);

  const prompt = buildCodeGenPrompt(explorationJson, {
    imagesAttached: (opts.previewImagePaths ?? []).length,
  });
  const imageBlocks = buildImageBlocks(opts.previewImagePaths ?? []);
  const response = await callClaude(prompt, 'opus', imageBlocks, { maxTokens: 16000, temperature: 0 });

  const code = extractPythonCode(response);
  if (!code) {
    throw new Error('Code generator did not return a Python block.');
  }

  mkdirSync(GENERATED_DIR, { recursive: true });
  writeFileSync(scriptPath, code, 'utf-8');
  return scriptPath;
}

function buildImageBlocks(paths: string[]): ImageBlock[] {
  const blocks: ImageBlock[] = [];
  for (const p of paths.slice(0, MAX_PREVIEW_IMAGES)) {
    try {
      const size = statSync(p).size;
      if (size > MAX_IMAGE_BYTES) {
        console.warn(`[codegen] skipping oversized preview ${path.basename(p)} (${size} bytes)`);
        continue;
      }
      const data = readFileSync(p).toString('base64');
      blocks.push({
        type: 'image',
        source: { type: 'base64', media_type: 'image/png', data },
      });
    } catch (e) {
      console.warn(`[codegen] failed to attach ${p}:`, (e as Error).message);
    }
  }
  return blocks;
}

/**
 * Hash just the structural fingerprint (not raw text samples) so the same
 * file structure reuses its cached script across different projects.
 */
export function fingerprintExploration(exp: unknown): string {
  const e = exp as Record<string, unknown>;
  const fingerprint = {
    version: (e.file_info as { version?: string } | undefined)?.version,
    hints: e.analysis_hints,
    block_names: Object.keys((e.blocks as Record<string, unknown>) || {}).sort(),
    block_shapes: Object.fromEntries(
      Object.entries((e.blocks as Record<string, { entity_counts?: Record<string, number> }>) || {}).map(
        ([k, v]) => [k, v.entity_counts],
      ),
    ),
    layer_count: Array.isArray(e.layer_table) ? e.layer_table.length : 0,
  };
  return crypto.createHash('md5').update(JSON.stringify(fingerprint)).digest('hex').slice(0, 8);
}

function extractPythonCode(response: string): string | null {
  const fenced = response.match(/```(?:python)?\s*\n([\s\S]*?)```/);
  if (fenced) return fenced[1];
  // If Claude returned raw code with no fence, use it whole when it starts with a shebang/import.
  if (/^\s*(#!\s*\/usr|from |import )/.test(response)) return response;
  return null;
}

/**
 * Send the failing script + traceback back to Claude and ask for a corrected
 * full script. Saves the new version next to the original and returns its path.
 */
export async function selfCorrectScript(
  originalScriptPath: string,
  badCode: string,
  errorTail: string,
): Promise<string> {
  const prompt =
    'Your previous Python script crashed when executed against the real DXF.\n' +
    'Read the traceback below, identify the bug, and return a CORRECTED FULL SCRIPT.\n\n' +
    '## TRACEBACK (stderr tail):\n```\n' + errorTail + '\n```\n\n' +
    '## YOUR PREVIOUS SCRIPT:\n```python\n' + badCode + '\n```\n\n' +
    'Output ONLY a single fenced ```python block containing the full corrected script. ' +
    'Keep all the working logic; only change what is broken. Re-emit the whole file.';

  const response = await callClaude(prompt, 'opus', [], { maxTokens: 16000, temperature: 0 });
  const code = extractPythonCode(response);
  if (!code) throw new Error('Self-correction did not return a Python block.');

  const fixedPath = originalScriptPath.replace(/\.py$/, '_fixed.py');
  writeFileSync(fixedPath, code, 'utf-8');
  return fixedPath;
}

function buildCodeGenPrompt(
  exploration: unknown,
  opts: { imagesAttached?: number } = {},
): string {
  const exp = exploration as Record<string, unknown>;
  const hints = (exp.analysis_hints as Record<string, unknown>) || {};
  const dual = hints.dual_viewport_pattern === true;
  const encoding = hints.text_encoding as Record<string, unknown> | undefined;
  const imgCount = opts.imagesAttached ?? 0;

  return `You are a Python code generator for DXF file extraction. You will receive a structural
exploration of a specific DXF file and must write a Python 3 script that extracts
compliance-relevant data from it.

## EXPLORATION:
${JSON.stringify(exploration, null, 2)}

## YOUR TASK
Write a complete Python 3 script. It MUST:

1. Take \`sys.argv[1]\` = dxf file path, \`sys.argv[2]\` = output directory for SVG files.
2. Read the DXF with \`ezdxf\`. Be resilient to \`cp1255\` / \`cp862\` Hebrew encoding if the default
   read produces no Hebrew text.
3. Decode TEXT/MTEXT properly: strip surrogate pairs, decode \`\\\\U+XXXX\` escapes to real chars.
4. Produce ONE SVG per logical sheet into \`sys.argv[2]\`. Named like \`sheet_<NN>_<slug>.svg\`.
   - Flip Y axis (DXF Y goes up → SVG Y goes down) by negating y.
   - Compute a tight bbox per sheet with a small padding margin.
   - Use stroke-width ≈ \`max(width, height) * 0.001\`.
   - White background. For Hebrew text, set \`text-anchor="end"\` + \`direction="rtl"\`.
5. Produce a single JSON document to stdout with this EXACT shape:

\`\`\`json
{
  "file_info": { "version": "...", "encoding": "..." },
  "sheets": [
    {
      "sheet_number": 1,
      "name": "קרקע",
      "name_en": "Ground floor",
      "type": "floor_plan",
      "scale": "1:100",
      "svg_file": "sheet_01_ground_floor.svg",
      "geometry_source": "VIEWPORT2",
      "annotation_source": "VIEWPORT19"
    }
  ],
  "compliance_data": {
    "setbacks": [
      { "side": "left", "distance_m": 3.0, "source_viewport": "VIEWPORT23" }
    ],
    "height_analysis": {
      "all_relative": [0.0, 3.0, 6.0],
      "all_absolute": [620.50],
      "roof_height": 6.0,
      "parapet_height": 1.0,
      "source_viewport": "VIEWPORT23"
    },
    "dimension_chains": [
      { "source_viewport": "VIEWPORT19", "values_cm": [300, 250], "total_m": 5.5 }
    ],
    "parking": { "is_covered": true, "bay_dimensions": { "width_m": 2.5, "depth_m": 5.0 } },
    "survey": { "elevation_range": { "min": 620.0, "max": 622.5, "diff": 2.5 } },
    "label_correlations": [
      { "label": "מעקה בנוי", "nearby_values": [{"value": "1.0", "type": "height"}] }
    ]
  }
}
\`\`\`

Every top-level key in \`compliance_data\` is REQUIRED — use empty arrays / null if unavailable.
Hebrew strings MUST be written natively (NOT escaped as \`\\\\u05D0\\\\u05E8...\`).

## FILE-SPECIFIC CONTEXT
${dual ? `
### Dual-viewport architecture
- Geometry viewports: ${JSON.stringify(hints.geometry_viewports)}
- Annotation viewports: ${JSON.stringify(hints.annotation_viewports)}
- Pre-paired by bbox IoU: ${JSON.stringify(hints.viewport_pairs)}
- Each sheet = one geometry VP + one annotation VP overlaid at the SAME coordinate space.
  Draw lines/polylines from the geometry VP, then overlay TEXT from the annotation VP.
  Extract setback/height data from the ANNOTATION VP only (fewer false positives).
` : `
### Non-dual layout
- Content location: ${hints.content_location || 'unknown'}
- Modelspace entities: ${hints.modelspace_entity_count || 0}
- Named-block entities: ${hints.named_block_entity_count || 0}
- If content is in modelspace, render the modelspace as a single sheet and skip pairing.
`}

### TEXT ENCODING — LET THE IMAGES GUIDE YOU

This DXF file may use ANY text encoding for Hebrew content:
- Unicode escapes (\`\\\\U+05D7\\\\U+05EA\\\\U+05DA\`) — decode with regex
- Native Hebrew (raw UTF-8) — match directly
- SHX font substitution (Latin chars like \`eu cbhhi\` that AutoCAD displays as \`קו בניין\`
  via font glyph mapping — there is NO programmatic decode without the SHX file)
- CP862 / Windows-1255 (high bytes 0x80-0xFF)

Encoding signals reported by the explorer for THIS file:
- has_unicode_escapes: ${encoding?.has_unicode_escapes ? 'YES — \\U+XXXX present, decode then match Hebrew' : 'no'}
- has_native_hebrew:   ${encoding?.has_native_hebrew  ? 'YES — match Hebrew strings directly' : 'no'}
- has_possible_shx:    ${encoding?.has_possible_shx   ? 'YES — Latin chars carry Hebrew meaning, match RAW strings' : 'no'}
- has_high_bytes:      ${encoding?.has_high_bytes    ? 'YES — try cp862 / cp1255 decode' : 'no'}
- font_names: ${JSON.stringify(encoding?.font_names ?? []).slice(0, 300)}

### THE VISUAL APPROACH (works regardless of encoding)

${imgCount > 0
  ? `**${imgCount} preview PNG image(s) are attached to this message.** Each PNG shows
the actual rendered drawing with **small numbered red dots overlaid at every text
position**. Each dot's number corresponds 1-based to the index inside that block's
\`text_samples[]\` array in the exploration JSON.`
  : '*(No preview images attached — fall back to keyword/decoded matching.)*'}

YOUR JOB: look at each image, identify what each numbered dot is sitting on
(kitchen counter, doorway, plot boundary line, dimension chain, height marker…),
and figure out what the corresponding RAW text string actually MEANS — without
needing to decode it.

Examples:
- If dot **#5** sits in a room that visually looks like a kitchen (counters,
  sink) and \`text_samples[4].raw == 'nycj'\`, then \`'nycj'\` is the kitchen label
  in this file.
- If dot **#12** sits next to a building edge with a setback dimension below it
  and \`text_samples[11].raw == 'eu cbhhi'\`, then \`'eu cbhhi'\` is the building line.
- If dot **#3** sits on top of \`+3.05\` text, the text is already a number — no
  encoding decode needed.

CRITICAL: in your generated Python extraction code, search for the **RAW strings
exactly as they appear** in the file, NOT the Hebrew translations. Build a
\`LABELS\` dict at the top of your script:

\`\`\`python
# Encoding map for THIS file — derived from visual context above.
# Keys are semantic role names; values are the raw strings as they exist
# in the DXF (whatever encoding the file uses).
LABELS = {
    'building_line':   'eu cbhhi',     # קו בניין — visible at top of elevations
    'plot_boundary':   'dcuk ndra',    # גבול מגרש — visible at top of elevations
    'kitchen':         'nycj',         # מטבח — kitchen room labels
    'bedroom':         'j/ ahbv',      # ח. שינה — bedroom labels
    'bathroom':        'j/ rjmv',      # ח. רחצה
    'safe_room':       'nn"s',         # ממ"ד
    'covered_parking': 'jbhhv neurv',  # חנייה מקורה
    # … add as many as you visually identify; missing labels just mean those
    # spatial correlations (e.g. setbacks) won't fire — but heights/dimensions
    # still work because numbers are encoding-agnostic.
}

# Then use these throughout — match by RAW string:
kav  = [t for t in texts if t['raw'].strip() == LABELS.get('building_line')]
gvul = [t for t in texts if t['raw'].strip() == LABELS.get('plot_boundary')]
\`\`\`

### Encoding-specific shortcuts (fall back to these when visual ID is uncertain)

- **\`has_unicode_escapes\` and \`has_native_hebrew\` files**: just decode \`\\\\U+XXXX\`
  and match the Hebrew terms (\`'קו בניין'\`, \`'מטבח'\`, …) directly. The label map
  is essentially identity for these.
- **\`has_possible_shx\` files**: there is NO automatic decode. You MUST build
  the LABELS dict from the images. The Latin-looking strings ARE the labels.
- **\`has_high_bytes\` files**: try \`raw.encode('cp1252', errors='ignore').decode('cp862')\`
  or \`.decode('cp1255')\` and match Hebrew on the result. If neither produces
  Hebrew, fall back to visual ID.

### What stays encoding-agnostic regardless

Numbers are ALWAYS readable: heights (\`+3.00\`, \`-0.50\`), dimensions (\`250\`,
\`1381\`), elevations (\`613.64\`), percentages (\`1.5%\`), curve radii (\`R=12.5\`).
You do NOT need a label map to extract these — extract them directly with regex.

### Dimension unit
Detected: **${hints.dimension_unit || 'unknown'}**
- cm (10-2000 range integers): treat ints near floor plans as cm; divide by 100 for m.
- mm (100-20000): divide by 1000 for m.
- m (small decimals): use directly.

### About sheet classification (CRITICAL — do not leave sheets as "unknown")

Each block in the exploration includes \`classification_keywords\` with pre-digested keyword
matches. The exploration \`analysis_hints\` may also include:
  - \`definitive_survey_blocks\`: blocks that are the SURVEY, full stop. Always classify as \`survey\`.
  - \`definitive_index_blocks\`: blocks that are the INDEX page. Always classify as \`index_page\`.
  - \`definitive_floor_plan_blocks\`: blocks with 3+ distinct room labels. ALWAYS classify the
    sheet they belong to as \`floor_plan\` — ignore parking/section keywords on these blocks
    (a carport labeled "חנייה מקורה" inside a ground-floor plan must NOT make it parking_section).
These overrides win over keyword rules. Honor them.

Otherwise apply these rules in order; the FIRST that matches wins (most specific first):

1. **index_page** — \`index_keywords\` has 3+ scale notations OR contains "תיק מידע".
   Usually has many ARC entities forming a decorative border, very few LINE entities.

2. **area_calculation** — \`area_keywords\` is non-empty (חישוב שטחים, טבלת שטחים, שטח עיקרי, etc.).

3. **survey** — \`survey_keywords\` includes "מדידה" OR has 3+ R= values OR
   the geometry block has >10000 LINEs and the text block has decimal values >600
   (terrain spot heights like 613.64, 617.78).

4. **parking_section** — \`parking_keywords\` includes "חתך חנייה" OR
   ("חנייה" + percentage slopes + parking-scale dims like 250/300/500).

5. **cross_section** — \`section_keywords\` includes a section reference like "1-1"/"2-2"
   AND the annotation has 5+ signed height markers (+0.00, +3.05, +5.85…) AND
   1-2 room labels at most. Section reference markers ALONE on a floor plan don't
   make it a section — floor plans always print "חתך 1-1" indicators showing where the
   section is taken; only classify as cross_section when heights dominate and rooms don't.

6. **elevation** — \`elevation_keywords\` has 2+ matches (קו בניין + גבול מגרש),
   OR contains "חזית" with a direction (צפונית/דרומית/מזרחית/מערבית).
   Sub-label: "חזית צפונית" / "חזית דרומית" / "חזית מזרחית" / "חזית מערבית" if direction known.

7. **roof_plan** — \`roof_keywords\` has "תוכנית גג" OR
   ("גג" + at least one percentage value + no room labels + no setback hints).

8. **site_plan / development_plan** — contains "תוכנית פיתוח" OR "תוכנית העמדה" OR "כניסה למגרש".

9. **floor_plan** — \`floor_plan_keywords\` has 2+ matches (room/space labels).
   Sub-label by floor:
     - "קומה א" → first_floor (label: "קומה א'")
     - "קומה ב" → second_floor (label: "קומה ב'")
     - "מרתף" → basement (label: "מרתף")
     - default → ground_floor (label: "קרקע")

10. **other_<descriptor>** — if no rule matches, do NOT use "unknown".
    Pick a descriptor based on what dominates: "other_construction_notes",
    "other_details", "other_legend", "other_section_marker", etc.

If a sheet matches multiple types, prefer the MORE SPECIFIC one. For example, if a
sheet has both room labels AND elevation heights, decide by geometry: rooms side-by-side
(plan view) → floor_plan; rooms stacked vertically with floors visible (section view) →
cross_section.

### About viewport pairing validation

After pairing geometry VPs with annotation VPs, validate each pair:
- The geometry VP should have > 500 LINE entities (walls, hatching).
- The annotation VP should have > 10 TEXT entities (labels, dimensions).
- Their bounding boxes should overlap by at least 50% in both X and Y.
- If a geometry VP has no matching annotation VP, render it standalone (geometry-only).
- If an annotation VP has no matching geometry VP (e.g., the index page), still render it
  but emit text positions as small dots/markers with labels rather than empty geometry,
  and tag the sheet type as "index_page" or "other_annotation_only".

When generating SVG renders:
- Skip any composite where the combined geometry has fewer than 50 line segments AND no text.
- Name SVGs with the classified sheet type — NEVER use "unknown" in filenames.
  Examples: \`sheet_01_ground_floor.svg\`, \`sheet_02_first_floor.svg\`,
  \`sheet_03_roof_plan.svg\`, \`sheet_04_elevation_north.svg\`, \`sheet_05_section_1-1.svg\`,
  \`sheet_06_survey.svg\`, \`sheet_07_parking_section.svg\`, \`sheet_08_index_page.svg\`,
  \`sheet_09_other_construction_notes.svg\`.

## REFERENCE EXTRACTION PATTERNS — TESTED WORKING CODE

These patterns are extracted from real Israeli permit DXF files and confirmed to work.
Adapt them to this file's specific block names and structure, but keep the core logic.

### Pattern 1 — Read text the encoding-agnostic way

\`\`\`python
import re

_UNICODE_ESCAPE_RE = re.compile(r'\\\\U\\+([0-9A-Fa-f]{4})')

def decode_unicode_escapes(text):
    """Convert \\\\U+XXXX → real Hebrew chars. Safe to call on any string."""
    return _UNICODE_ESCAPE_RE.sub(lambda m: chr(int(m.group(1), 16)), text)

# Alias kept for the patterns below — they still call the old name.
# For SHX-encoded files this is a no-op (Latin chars stay Latin), and you
# match against the LABELS dict's raw values instead.
decode_hebrew = decode_unicode_escapes

def read_text(entity):
    """Return BOTH the raw string and a best-effort decoded variant.
    Comparisons MUST use whichever form matches the LABELS dict you built
    from visual context (Pattern 0 above)."""
    raw = entity.dxf.text if entity.dxftype() == 'TEXT' else getattr(entity, 'text', entity.dxf.text)
    raw = (raw or '').strip()
    decoded = decode_unicode_escapes(raw) if '\\\\U+' in raw else raw
    return raw, decoded

# Usage:
for entity in block:
    if entity.dxftype() == 'TEXT':
        raw, decoded = read_text(entity)
        x, y = entity.dxf.insert[0], entity.dxf.insert[1]
        # If file has Hebrew/Unicode escapes, match \`decoded\` against Hebrew.
        # If file is SHX-Latin, match \`raw\` against the LABELS dict you built.
\`\`\`

If your LABELS dict was built from visual context (the typical SHX case),
match against the **raw** string, not \`decoded\`. If the encoding is plain
Unicode-escape or native Hebrew, the LABELS dict can hold actual Hebrew terms
and you match against \`decoded\`. Either way, never assume one encoding fits all.

### Pattern 2 — Setback distances from elevation/section viewports

A setback appears as an integer positioned BETWEEN a \`קו בניין\` label and a
\`גבול מגרש\` label. Both labels sit at the top of the viewport (high Y); the
number is slightly below them.

\`\`\`python
def extract_setbacks(block, doc):
    texts = []
    for entity in block:
        if entity.dxftype() == 'TEXT':
            decoded = decode_hebrew(entity.dxf.text).strip()
            texts.append({
                'text': decoded,
                'x': entity.dxf.insert[0],
                'y': entity.dxf.insert[1],
            })

    # Use LABELS dict you built from visual context (encoding-agnostic).
    kav  = [t for t in texts if t['text'] == LABELS.get('building_line')]
    gvul = [t for t in texts if t['text'] == LABELS.get('plot_boundary')]
    integers = [t for t in texts if re.match(r'^\\d+$', t['text'])
                and 100 <= int(t['text']) <= 1000]

    setbacks = []
    used = set()
    for kb in kav:
        best, best_dy = None, 999
        for i, gm in enumerate(gvul):
            if i in used:
                continue
            dy = abs(kb['y'] - gm['y'])
            if dy < 15 and dy < best_dy:
                best, best_dy = (i, gm), dy
        if not best:
            continue
        used.add(best[0])
        gm = best[1]

        min_x = min(kb['x'], gm['x']) - 30
        max_x = max(kb['x'], gm['x']) + 30
        label_y = max(kb['y'], gm['y'])
        for num in integers:
            y_below = label_y - num['y']
            if 0 < y_below < 40 and min_x <= num['x'] <= max_x:
                side = 'left' if gm['x'] < kb['x'] else 'right'
                setbacks.append({
                    'distance_cm': int(num['text']),
                    'distance_m':  int(num['text']) / 100,
                    'side': side,
                })
                break  # one number per pair

    return setbacks
\`\`\`

Expected output on a real file:
\`\`\`json
[
  {"distance_cm": 500, "distance_m": 5.0, "side": "left"},
  {"distance_cm": 400, "distance_m": 4.0, "side": "right"}
]
\`\`\`

Run on EVERY viewport classified as elevation or cross_section. Aggregate the
results into a single setbacks array, tagging each with \`source_viewport\`.

### Pattern 3 — Dimension chains from floor plan viewports

In floor plans, integer texts represent wall/room dimensions in centimeters,
arranged vertically at the same X coordinate, summing to the building width/depth.

\`\`\`python
from collections import defaultdict

def extract_dimension_chains(block, doc):
    integers = []
    for entity in block:
        if entity.dxftype() == 'TEXT':
            decoded = decode_hebrew(entity.dxf.text).strip()
            if re.match(r'^\\d+$', decoded) and 10 <= int(decoded) <= 2000:
                integers.append({
                    'x': round(entity.dxf.insert[0]),
                    'y': entity.dxf.insert[1],
                    'val': int(decoded),
                })
    x_groups = defaultdict(list)
    for item in integers:
        x_groups[item['x']].append(item)

    chains = []
    for x, items in x_groups.items():
        if len(items) < 2:
            continue
        items.sort(key=lambda i: -i['y'])
        values = [i['val'] for i in items]
        total = sum(values)
        chains.append({
            'x_position': x,
            'values_cm':  values,
            'total_cm':   total,
            'total_m':    round(total / 100, 2),
        })
    chains.sort(key=lambda c: -c['total_cm'])
    return chains
\`\`\`

The largest chain total is typically the building width (e.g. 1381 cm = 13.81 m).

### Pattern 4 — Survey: separate elevations vs edge lengths

Survey viewports mix terrain elevation readings (613.64, 617.78) with boundary
edge lengths (25.77, 13.95, 4.00). Separate by value range.

\`\`\`python
def extract_survey_data(block, doc):
    elevations, edge_lengths, curve_radii = [], [], []
    for entity in block:
        if entity.dxftype() != 'TEXT':
            continue
        decoded = decode_hebrew(entity.dxf.text).strip()
        x, y = entity.dxf.insert[0], entity.dxf.insert[1]

        m = re.match(r'^R\\s*=\\s*(\\d+\\.?\\d*)$', decoded)
        if m:
            curve_radii.append({'value': float(m.group(1)), 'x': x, 'y': y})
            continue

        if re.match(r'^\\d+\\.\\d+$', decoded):
            v = float(decoded)
            if v > 600:
                elevations.append({'value': v, 'x': x, 'y': y})
            elif 0.5 < v < 50:
                edge_lengths.append({'value': v, 'x': x, 'y': y})

    return {
        'terrain_elevations': elevations,
        'boundary_edge_lengths': edge_lengths,
        'curve_radii': curve_radii,
        'estimated_perimeter_m': round(sum(e['value'] for e in edge_lengths), 2),
        'elevation_range': ({
            'min': round(min(e['value'] for e in elevations), 2),
            'max': round(max(e['value'] for e in elevations), 2),
        } if elevations else None),
    }
\`\`\`

### Pattern 5 — Parking data

\`\`\`python
def extract_parking(block, doc):
    texts = []
    for e in block:
        if e.dxftype() == 'TEXT':
            raw, decoded = read_text(e)
            texts.append((raw, decoded))
    covered_label = LABELS.get('covered_parking')
    is_covered = any(
        (covered_label and (covered_label == raw or covered_label in raw))
        or 'מקורה' in decoded
        for raw, decoded in texts
    )
    flat_texts = [decoded for _raw, decoded in texts]
    slopes = [t for t in flat_texts if re.match(r'^\\d+\\.?\\d*%$', t)]
    dims   = [int(t) for t in flat_texts if re.match(r'^\\d+$', t) and 20 <= int(t) <= 2000]
    widths = [d for d in dims if 200 <= d <= 350]
    depths = [d for d in dims if 450 <= d <= 700]
    bay = ({'width_m': widths[0] / 100, 'depth_m': depths[0] / 100}
           if widths and depths else None)
    return {
        'is_covered': is_covered,
        'slopes': slopes,
        'dimensions_cm': dims,
        'bay_dimensions': bay,
    }
\`\`\`

### Pattern 6 — Height analysis from sections/elevations

\`\`\`python
def analyze_heights(block, doc):
    relative, absolute = [], []
    for entity in block:
        if entity.dxftype() != 'TEXT':
            continue
        decoded = decode_hebrew(entity.dxf.text).strip()
        m = re.match(r'^([+\\-])(\\d+\\.?\\d*)$', decoded)
        if not m:
            continue
        v = float(m.group(2))
        if m.group(1) == '-':
            v = -v
        x, y = entity.dxf.insert[0], entity.dxf.insert[1]
        if abs(v) < 100:
            relative.append({'value': v, 'x': x, 'y': y})
        elif v > 600:
            absolute.append({'value': v, 'x': x, 'y': y})

    rel_values = sorted(set(r['value'] for r in relative))
    out = {
        'all_relative': rel_values,
        'all_absolute': sorted(set(a['value'] for a in absolute)),
    }
    if rel_values:
        out['max_height'] = max(rel_values)

    roof = [v for v in rel_values if 5.5 <= v <= 6.5]
    if roof:
        out['roof_height'] = roof[0]
        if 'max_height' in out:
            diff = round(out['max_height'] - out['roof_height'], 2)
            if 0.3 <= diff <= 1.5:
                out['parapet_height'] = diff

    plinth = [v for v in rel_values if 1.0 <= v <= 2.0]
    if plinth:
        out['plinth_height'] = plinth[0]

    floors = [v for v in rel_values if v > 0]
    floor_slabs = [v for v in floors if any(2.5 <= v - other <= 3.5 for other in floors if other < v)]
    out['estimated_floors'] = len(floor_slabs) + 1 if floor_slabs else None

    # Ground level — closest absolute to the +0.00 relative
    zero_rel = [r for r in relative if r['value'] == 0.0]
    if zero_rel and absolute:
        z = zero_rel[0]
        closest = min(absolute, key=lambda a: ((a['x']-z['x'])**2 + (a['y']-z['y'])**2) ** 0.5)
        out['absolute_ground'] = closest['value']

    return out
\`\`\`

### Pattern 7 — Iterate viewport blocks (NOT modelspace)

In most Israeli permit DXFs, content lives in VIEWPORT blocks, NOT modelspace.

\`\`\`python
# WRONG — usually empty:
for entity in doc.modelspace():
    ...

# RIGHT — iterate the named blocks the explorer flagged:
for block_def in doc.blocks:
    if block_def.name.startswith('VIEWPORT') or block_def.name in detected_blocks:
        for entity in block_def:
            if entity.dxftype() == 'TEXT':
                ...
\`\`\`

When the exploration JSON shows \`modelspace_summary.total_entities: 0\` but
blocks have thousands of entities, ALL extraction must happen from blocks.

### Pattern 8 — Dual-viewport architecture

Some DXFs split each sheet into two overlapping blocks — geometry (LINEs) and
annotation (TEXTs). The exploration JSON flags this as
\`analysis_hints.dual_viewport_pattern: true\` with \`viewport_pairs\` listing pairs.

For DATA EXTRACTION: read from annotation VPs (the ones with TEXT entities).
For SVG RENDERING: composite both VPs (geometry lines + annotation texts).

\`\`\`python
if exploration['analysis_hints'].get('dual_viewport_pattern'):
    for pair in exploration['analysis_hints']['viewport_pairs']:
        ann_vp = pair.get('annotations')
        if not ann_vp:
            continue
        block = doc.blocks.get(ann_vp)
        if block is None:
            continue
        setbacks.extend(extract_setbacks(block, doc))
        chains.extend(extract_dimension_chains(block, doc))
        # … etc
else:
    for block_name in significant_blocks:
        block = doc.blocks.get(block_name)
        if block is not None:
            setbacks.extend(extract_setbacks(block, doc))
            # … etc
\`\`\`

### Pattern 9 — SVG boundaries with Y-flip and tight bbox (DO NOT SKIP)

DXF Y axis points UP, SVG Y axis points DOWN. Every Y coordinate written to
the SVG must be NEGATED. The viewBox must be computed from the **flipped**
coordinates, NEVER from raw DXF coords. The viewBox must be TIGHT — never
include the (0, 0) DXF origin unless an actual entity sits there.

WRONG (every viewBox starts at "0 0 …" and the drawing renders as a tiny
postage stamp in one corner):
\`\`\`python
# ❌ raw DXF coords, bbox grown from origin
all_x = [e.dxf.start[0] for e in lines] + [e.dxf.end[0] for e in lines]
all_y = [e.dxf.start[1] for e in lines] + [e.dxf.end[1] for e in lines]
viewbox = f"0 0 {max(all_x)} {max(all_y)}"   # disastrous
\`\`\`

RIGHT — flip Y first, then compute bbox from flipped values:
\`\`\`python
def render_block_to_svg(block, out_path):
    segments = []   # list of (x1, y1_flipped, x2, y2_flipped)
    texts = []      # list of (x, y_flipped, text, height_or_None)

    for entity in block:
        et = entity.dxftype()
        if et == 'LINE':
            x1, y1 = entity.dxf.start[0], entity.dxf.start[1]
            x2, y2 = entity.dxf.end[0],   entity.dxf.end[1]
            segments.append((x1, -y1, x2, -y2))                  # Y FLIPPED
        elif et == 'LWPOLYLINE':
            pts = list(entity.get_points(format='xy'))
            for i in range(len(pts) - 1):
                segments.append((pts[i][0], -pts[i][1], pts[i+1][0], -pts[i+1][1]))
            if entity.closed and len(pts) > 2:
                segments.append((pts[-1][0], -pts[-1][1], pts[0][0], -pts[0][1]))
        elif et == 'POLYLINE':
            verts = [(v.dxf.location[0], v.dxf.location[1]) for v in entity.vertices]
            for i in range(len(verts) - 1):
                segments.append((verts[i][0], -verts[i][1], verts[i+1][0], -verts[i+1][1]))
        elif et in ('TEXT', 'MTEXT'):
            raw = entity.dxf.text if et == 'TEXT' else getattr(entity, 'text', entity.dxf.text)
            decoded = decode_hebrew(raw).strip()
            if not decoded:
                continue
            texts.append((entity.dxf.insert[0], -entity.dxf.insert[1],
                          decoded, getattr(entity.dxf, 'height', None)))

    if not segments and not texts:
        return False

    # Bbox from FLIPPED coords ONLY — do not include (0,0) anchor.
    xs = ([s[0] for s in segments] + [s[2] for s in segments]
          + [t[0] for t in texts])
    ys = ([s[1] for s in segments] + [s[3] for s in segments]
          + [t[1] for t in texts])
    min_x, max_x = min(xs), max(xs)
    min_y, max_y = min(ys), max(ys)
    w, h = max(1.0, max_x - min_x), max(1.0, max_y - min_y)
    pad = max(w, h) * 0.04
    vb_x, vb_y = min_x - pad, min_y - pad
    vb_w, vb_h = w + 2 * pad, h + 2 * pad
    stroke = max(0.4, max(w, h) * 0.001)

    out = [
        f'<svg xmlns="http://www.w3.org/2000/svg" '
        f'viewBox="{vb_x:.2f} {vb_y:.2f} {vb_w:.2f} {vb_h:.2f}" '
        f'preserveAspectRatio="xMidYMid meet">',
        f'<rect x="{vb_x:.2f}" y="{vb_y:.2f}" width="{vb_w:.2f}" height="{vb_h:.2f}" fill="white"/>',
        f'<g stroke="black" stroke-width="{stroke:.3f}" fill="none" stroke-linecap="round">',
    ]
    for x1, y1, x2, y2 in segments:
        out.append(f'<line x1="{x1:.2f}" y1="{y1:.2f}" x2="{x2:.2f}" y2="{y2:.2f}"/>')
    out.append('</g>')
    for x, y, t, h in texts:
        from xml.sax.saxutils import escape as xml_escape
        font_size = max(stroke * 8, (h or 2.0) * 0.85)
        is_rtl = any('\\u0590' <= c <= '\\u05FF' for c in t)
        anchor = 'end' if is_rtl else 'start'
        direction = ' direction="rtl"' if is_rtl else ''
        out.append(
            f'<text x="{x:.2f}" y="{y:.2f}" font-size="{font_size:.2f}" '
            f'font-family="Arial" text-anchor="{anchor}"{direction}>{xml_escape(t)}</text>'
        )
    out.append('</svg>')

    # IMPORTANT: write with utf-8 + errors="replace" so a stray surrogate from
    # a corrupt MTEXT does NOT crash the whole render with UnicodeEncodeError.
    with open(out_path, 'w', encoding='utf-8', errors='replace') as f:
        f.write('\\n'.join(out))
    return True
\`\`\`

VERIFICATION RULE: after writing each SVG, the viewBox MUST satisfy:
  - aspect ratio (w/h) between 0.4 and 4.0 for floor plans / sections / elevations,
    or up to 8.0 for index/banner sheets
  - viewBox **y is negative** (because content was Y-flipped)
  - viewBox does NOT start at \`0 0\` unless the original DXF block actually
    contains entities at coordinate (0, 0)

If you produce a \`viewBox="0 0 4500 525"\` for a floor plan, you forgot to
negate Y — the bbox is being grown from the (0, 0) origin to wherever the
unflipped content sits.

### COMMON BUGS IN GENERATED EXTRACTORS — avoid these

1. **Forgetting to decode Unicode escapes** — comparing raw \`\\\\U+05D7\\\\U+05EA\\\\U+05DA\`
   against \`'חתך'\` will never match. ALWAYS decode first.
2. **Searching modelspace instead of blocks** — modelspace is usually empty in
   Israeli permit DXFs. Check \`exploration.analysis_hints.content_location\`.
3. **POLYLINE vertices as tuples** — vertices are DXFVertex objects, not tuples.
   Use \`v.dxf.location[0]\`, NOT \`v[0]\`.
4. **Missing attributes** — some TEXT entities lack \`height\`. Use
   \`getattr(entity.dxf, 'height', 2.0)\` or try/except.
5. **Treating all integers as dimensions** — small ints (1-9) are often survey
   point numbers or sheet refs. Filter to \`10 <= n <= 2000\` for dimensions.
6. **Empty setbacks array** — most common cause is undecoded Hebrew, or you
   searched the wrong viewport type. Setbacks live in ELEVATION and CROSS_SECTION
   viewports, not floor plans.

## SELF-VALIDATION BEFORE OUTPUT

Before printing the final JSON, your script MUST validate and print to stderr:

1. If \`compliance_data.setbacks\` is empty AND any sheet was classified as
   \`elevation\` or \`cross_section\` → print
   \`WARN: 0 setbacks despite N elevation/section sheets — likely undecoded Hebrew or wrong block\`.
2. If \`compliance_data.dimension_chains\` is empty AND any sheet was classified
   as \`floor_plan\` → print
   \`WARN: 0 dimension chains despite N floor_plan sheets — likely searched modelspace or filter too aggressive\`.
3. If \`height_analysis.all_relative\` is empty AND any annotation viewport
   contains \`+\` or \`-\` prefixed numbers → print
   \`WARN: 0 relative heights — height regex didn't match, check encoding\`.
4. ALWAYS print one summary line to stderr:
   \`EXTRACTION SUMMARY: {N} setbacks, {N} chains, {N} heights, {N} survey pts, parking={yes/no}\`

## CRITICAL
- Use ONLY stdlib + \`ezdxf\` (already installed).
- Print ONLY the JSON document to stdout. All progress/debug messages go to stderr.
- \`ensure_ascii=False\` in \`json.dumps\` so Hebrew stays readable.
- Do not require network access.
- Start with \`#!/usr/bin/env python3\` and a brief docstring.
- Return ONLY a single fenced \`\`\`python code block. No prose around it.
`;
}
