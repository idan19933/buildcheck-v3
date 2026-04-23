import { execFile } from 'child_process';
import { promisify } from 'util';
import path from 'path';

const execFileAsync = promisify(execFile);

const PYTHON_BIN = process.env.PYTHON_BIN || 'python3';
const EXTRACTOR = path.resolve(__dirname, '../../python/dxf_viewport_extractor.py');
const RENDERER = path.resolve(__dirname, '../../python/dxf_render.py');
const SHEET_RENDERER = path.resolve(__dirname, '../../python/dxf_sheet_renderer.py');
const PREVIEW_RENDERER = path.resolve(__dirname, '../../python/dxf_preview_renderer.py');
const SEMANTIC_CLASSIFIER = path.resolve(__dirname, '../../python/semantic_classify.py');

export interface ViewportClassification {
  type: string;
  confidence: number;
  label: string;
  scale: string | null;
}

export interface ViewportExtraction {
  file_info: { version: string; encoding: string; layout_count: number };
  viewports: Record<string, {
    texts: Array<{ text: string; x: number; y: number; height: number }>;
    geometry: Record<string, unknown>;
    parsed_data: Record<string, unknown>;
    classification: ViewportClassification;
  }>;
  viewport_classifications: Record<string, ViewportClassification>;
  summary: {
    total_viewports: number;
    classified: number;
    unclassified: number;
    types_found: string[];
  };
}

export async function extractDxfViewports(dxfPath: string): Promise<ViewportExtraction> {
  const { stdout } = await execFileAsync(PYTHON_BIN, [EXTRACTOR, dxfPath], {
    maxBuffer: 100 * 1024 * 1024,
    env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
  });
  const parsed = JSON.parse(stdout);
  if (parsed.error) throw new Error(`DXF extraction failed: ${parsed.error}`);
  return parsed as ViewportExtraction;
}

export async function renderDxf(dxfPath: string, outputDir: string): Promise<string[]> {
  const { stdout } = await execFileAsync(PYTHON_BIN, [RENDERER, dxfPath, outputDir], {
    maxBuffer: 20 * 1024 * 1024,
    env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
  });
  try {
    const parsed = JSON.parse(stdout.trim());
    if (parsed.error) {
      console.error('[dxf-render] python reported error:', parsed.error);
      return [];
    }
    return Array.isArray(parsed) ? (parsed as string[]) : [];
  } catch (e) {
    console.error('[dxf-render] could not parse renderer output:', e);
    return [];
  }
}

export interface SheetRender {
  sheet_num: number;
  filename: string;
  label_he: string;
  label_en: string;
  type: string;
  icon: string;
  scale: string | null;
  geo_viewport: string | null;
  ann_viewport: string | null;
  pair_score: number;
  entity_count: number;
  bbox: [number, number, number, number];
}

export interface SheetRenderResult {
  sheets: SheetRender[];
  files: string[];
  viewport_count: number;
  sheet_count: number;
}

export interface PreviewSheet {
  index: number;
  filename: string;
  geometry_vp?: string | null;
  annotation_vp?: string | null;
  block?: string;
  source?: string;
  line_count: number;
}

export interface PreviewResult {
  preview_count: number;
  previews: PreviewSheet[];
  output_dir: string;
}

// ────────────────────────────────────────────── semantic classifier ──

export interface SemanticClassification {
  match_type: 'canonical_exact' | 'alias' | 'numeric_pattern' | 'noise' | 'fuzzy' | 'unclassified';
  category: string | null;
  key: string | null;
  canonical_he: string | null;
  confidence: number;
  matched_alias?: string | null;
  edit_distance?: number | null;
}

export interface ClassifiedTextRecord {
  block: string;
  raw: string;
  decoded: string;
  position: { x: number; y: number };
  height: number;
  layer: string;
  classification: SemanticClassification;
}

export interface SemanticSummary {
  total: number;
  vocabulary_version: string;
  by_match_type: Record<string, number>;
  by_category: Record<string, number>;
  unclassified_count: number;
  high_confidence_semantic_count: number;
}

/**
 * Three-layer semantic classification of every TEXT/MTEXT in the DXF.
 * Writes per-entity records to `outJsonPath`; resolves with the summary
 * the Python script prints to stdout.
 */
export async function classifyDxfTexts(
  dxfPath: string,
  outJsonPath: string,
): Promise<SemanticSummary> {
  const { stdout } = await execFileAsync(
    PYTHON_BIN,
    [SEMANTIC_CLASSIFIER, dxfPath, outJsonPath],
    { maxBuffer: 100 * 1024 * 1024, env: { ...process.env, PYTHONIOENCODING: 'utf-8' } },
  );
  const parsed = JSON.parse(stdout.trim());
  if (parsed.error) throw new Error(`semantic classify failed: ${parsed.error}`);
  return parsed as SemanticSummary;
}

/**
 * Deterministic, fast PNG preview renderer. Reads exploration JSON from disk
 * and emits one PNG per logical sheet. Used as a fast-path so the user sees
 * thumbnails ~10 s after upload while the AI codegen pipeline keeps cooking.
 */
export async function renderDxfPreviews(
  dxfPath: string,
  explorationJsonPath: string,
  outputDir: string,
): Promise<PreviewResult> {
  const { stdout } = await execFileAsync(
    PYTHON_BIN,
    [PREVIEW_RENDERER, dxfPath, explorationJsonPath, outputDir],
    {
      maxBuffer: 50 * 1024 * 1024,
      timeout: 60_000,
      env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
    },
  );
  const parsed = JSON.parse(stdout.trim());
  if (parsed.error) throw new Error(`Preview render failed: ${parsed.error}`);
  return parsed as PreviewResult;
}

/**
 * Render a DXF as one composite SVG per logical sheet by pairing geometry +
 * annotation viewports. Returns rich metadata for the frontend sheet browser.
 */
export async function renderDxfSheets(dxfPath: string, outputDir: string): Promise<SheetRenderResult> {
  const { stdout } = await execFileAsync(PYTHON_BIN, [SHEET_RENDERER, dxfPath, outputDir], {
    maxBuffer: 50 * 1024 * 1024,
    env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
  });
  const parsed = JSON.parse(stdout.trim());
  if (parsed.error) throw new Error(`Sheet render failed: ${parsed.error}`);
  return parsed as SheetRenderResult;
}
