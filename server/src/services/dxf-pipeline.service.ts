import { execFile } from 'child_process';
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'fs';
import path from 'path';
import { promisify } from 'util';
import { generateExtractionScript, selfCorrectScript } from './code-generator.service';

const execFileAsync = promisify(execFile);

const PYTHON_BIN = process.env.PYTHON_BIN || 'python3';
const EXPLORER_SCRIPT = path.resolve(__dirname, '../../python/dxf_explorer.py');
const FALLBACK_SHEET_RENDERER = path.resolve(__dirname, '../../python/dxf_sheet_renderer.py');
const FALLBACK_EXTRACTOR = path.resolve(__dirname, '../../python/dxf_viewport_extractor.py');

export type PipelineStep =
  | 'exploring'
  | 'generating'
  | 'extracting'
  | 'fallback'
  | 'done'
  | 'failed';

export interface PipelineResult {
  complianceData: unknown;
  exploration: unknown;
  explorationJsonPath: string;
  generatedScriptPath: string | null;
  svgDir: string;
  usedFallback: boolean;
}

export interface ProcessDxfOptions {
  onProgress?: (step: PipelineStep, detail: string) => void;
  /**
   * Fired once Phase 1 exploration JSON is on disk and parsed. Used by the
   * orchestrator to fan out an immediate preview render + DB partial-update.
   * Awaited; if it throws, the AI pipeline still continues.
   */
  onExplorationReady?: (exploration: unknown, explorationJsonPath: string) => Promise<void>;
  /**
   * Pre-computed semantic index. When provided, the codegen prompt instructs
   * Opus to consume these classifications instead of re-classifying text.
   * Wired by the orchestrator under USE_COMPOSED_CODEGEN=true.
   */
  semanticIndex?: import('./semantic-index').SemanticIndex;
}

/**
 * Three-phase DXF processing pipeline:
 *   1. Explore   — local Python, fingerprints the file structure
 *   2. Generate  — Claude writes a Python extractor tailored to that structure
 *   3. Extract   — run the generated script; on failure fall back to the static renderer
 *
 * Output layout under `outputDir`:
 *   <outputDir>/                 ← SVG files live here (served by /api/renders)
 *     sheet_NN_<slug>.svg
 *     _pipeline_meta/            ← non-served bookkeeping
 *       exploration.json
 *       compliance_data.json
 *       generated_script_path.txt
 *       extractor_stderr_*.log
 */
export async function processDxf(
  dxfFilePath: string,
  outputDir: string,
  optsOrProgress?: ProcessDxfOptions | ((step: PipelineStep, detail: string) => void),
): Promise<PipelineResult> {
  // Backwards-compat: callers can still pass a plain progress fn.
  const opts: ProcessDxfOptions =
    typeof optsOrProgress === 'function' ? { onProgress: optsOrProgress } : optsOrProgress ?? {};
  const { onProgress, onExplorationReady, semanticIndex } = opts;

  mkdirSync(outputDir, { recursive: true });
  const svgDir = outputDir;
  const metaDir = path.join(outputDir, '_pipeline_meta');
  mkdirSync(metaDir, { recursive: true });

  // ── Phase 1: Explore ──
  onProgress?.('exploring', 'Scanning DXF structure');
  const { stdout: explorationRaw } = await execFileAsync(
    PYTHON_BIN,
    [EXPLORER_SCRIPT, dxfFilePath],
    { maxBuffer: 50 * 1024 * 1024, env: { ...process.env, PYTHONIOENCODING: 'utf-8' } },
  );
  const exploration = JSON.parse(explorationRaw) as Record<string, unknown>;
  if (exploration.error) {
    throw new Error(`DXF exploration failed: ${exploration.error as string}`);
  }
  const explorationJsonPath = path.join(metaDir, 'exploration.json');
  writeFileSync(explorationJsonPath, JSON.stringify(exploration, null, 2), 'utf-8');

  // Fast-path hook: orchestrator renders deterministic previews + writes a
  // partial DB update so the user sees thumbnails immediately. AWAITED, because
  // Phase 2 (Claude codegen) needs the preview PNGs as visual context for
  // encoding-agnostic label decoding (numbered red dots in each PNG correlate
  // with raw text_samples in the exploration JSON).
  if (onExplorationReady) {
    try {
      await onExplorationReady(exploration, explorationJsonPath);
    } catch (e) {
      console.error('[pipeline] onExplorationReady callback failed (non-fatal):', e);
    }
  }

  // Collect any preview PNGs that just landed — pass them to Claude.
  let previewImagePaths: string[] = [];
  try {
    previewImagePaths = readdirSync(svgDir)
      .filter((f) => f.startsWith('preview_') && f.toLowerCase().endsWith('.png'))
      .sort()
      .map((f) => path.join(svgDir, f));
  } catch {
    /* svg dir missing — no previews to attach */
  }

  // ── Phase 2: Generate ──
  onProgress?.('generating', `AI is writing custom extraction code (${previewImagePaths.length} preview images attached)`);
  let scriptPath: string | null = null;
  try {
    scriptPath = await generateExtractionScript(exploration, { previewImagePaths, semanticIndex });
    writeFileSync(path.join(metaDir, 'generated_script_path.txt'), scriptPath, 'utf-8');
  } catch (e) {
    console.error('[pipeline] code generation failed:', e);
  }

  // ── Phase 3: Extract (with one self-correction retry on failure) ──
  if (scriptPath) {
    let activeScript = scriptPath;
    let firstError: { stderr: string } | null = null;
    for (let attempt = 1; attempt <= 2; attempt++) {
      onProgress?.('extracting', attempt === 1 ? 'Running AI-generated extractor' : 'Self-correcting after error');
      try {
        const { stdout: extractionRaw, stderr } = await execFileAsync(
          PYTHON_BIN,
          [activeScript, dxfFilePath, svgDir],
          {
            maxBuffer: 100 * 1024 * 1024,
            timeout: 120_000,
            env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
          },
        );
        if (stderr) console.warn('[pipeline] extractor stderr:', stderr.slice(-500));

        const compliance = parseExtractionOutput(extractionRaw);
        attachRenderingWarnings(compliance, svgDir);
        writeFileSync(path.join(metaDir, 'compliance_data.json'), JSON.stringify(compliance, null, 2), 'utf-8');
        onProgress?.('done', 'Extraction complete');
        return { complianceData: compliance, exploration, explorationJsonPath, generatedScriptPath: activeScript, svgDir, usedFallback: false };
      } catch (e) {
        const stderr = (e as { stderr?: Buffer | string }).stderr?.toString() ?? (e as Error).message;
        console.error(`[pipeline] extractor attempt ${attempt} failed:`, stderr.slice(-500));
        if (attempt === 1) {
          firstError = { stderr };
          writeFileSync(path.join(metaDir, 'extractor_stderr_first.log'), stderr, 'utf-8');
          try {
            const badCode = readFileSync(activeScript, 'utf-8');
            activeScript = await selfCorrectScript(activeScript, badCode, stderr.slice(-2000));
            writeFileSync(path.join(metaDir, 'generated_script_path_fixed.txt'), activeScript, 'utf-8');
          } catch (correctionError) {
            console.error('[pipeline] self-correction failed:', correctionError);
            break;
          }
        } else {
          writeFileSync(path.join(metaDir, 'extractor_stderr_retry.log'), stderr, 'utf-8');
          if (firstError) console.error('[pipeline] both attempts failed; first error:', firstError.stderr.slice(-200));
        }
      }
    }
    onProgress?.('fallback', 'AI extractor failed twice — falling back to static extractor');
  } else {
    onProgress?.('fallback', 'No generated script — falling back to static extractor');
  }

  // ── Fallback: existing static pipeline ──
  const compliance = await runFallback(dxfFilePath, svgDir);
  writeFileSync(path.join(metaDir, 'compliance_data.json'), JSON.stringify(compliance, null, 2), 'utf-8');
  onProgress?.('done', 'Fallback complete');
  return { complianceData: compliance, exploration, explorationJsonPath, generatedScriptPath: scriptPath, svgDir, usedFallback: true };
}

/**
 * Inspect each generated SVG and flag suspicious-small ones (typically a sign
 * the geometry VP wasn't paired with its annotation VP, or vice versa). Mutates
 * the compliance object by attaching a `rendering_warnings: string[]` array.
 */
function attachRenderingWarnings(compliance: unknown, svgDir: string): void {
  let svgFiles: string[] = [];
  try {
    svgFiles = readdirSync(svgDir).filter((f) => f.toLowerCase().endsWith('.svg'));
  } catch {
    return;
  }

  const warnings: string[] = [];
  const SIZE_FLOOR_BYTES = 20_000;
  for (const f of svgFiles) {
    const size = statSync(path.join(svgDir, f)).size;
    if (size < SIZE_FLOOR_BYTES) {
      warnings.push(
        `${f} is only ${(size / 1024).toFixed(1)}KB — likely missing geometry VP. ` +
        `Check viewport pairing for this sheet.`,
      );
    }
  }

  if (warnings.length > 0) {
    console.warn('[pipeline] SVG validation warnings:', warnings);
    if (compliance && typeof compliance === 'object') {
      (compliance as Record<string, unknown>).rendering_warnings = warnings;
    }
  }
}

function parseExtractionOutput(raw: string): unknown {
  const trimmed = raw.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    // Sometimes a generated script prints stray prefix text — locate the last balanced JSON object.
    const start = trimmed.search(/[\[{]/);
    if (start >= 0) {
      const candidate = trimmed.slice(start);
      try {
        return JSON.parse(candidate);
      } catch {
        // fallthrough
      }
    }
    throw new Error(`Generated extractor did not output valid JSON. First 400 chars: ${trimmed.slice(0, 400)}`);
  }
}

async function runFallback(dxfFilePath: string, svgDir: string): Promise<unknown> {
  // Try the existing static sheet renderer for SVGs and the viewport extractor for compliance.
  const compliance: Record<string, unknown> = { sheets: [], compliance_data: {} };
  try {
    const { stdout } = await execFileAsync(PYTHON_BIN, [FALLBACK_SHEET_RENDERER, dxfFilePath, svgDir], {
      maxBuffer: 100 * 1024 * 1024,
      env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
    });
    const renderResult = JSON.parse(stdout) as { sheets?: unknown };
    if (renderResult.sheets) compliance.sheets = renderResult.sheets;
  } catch (e) {
    console.error('[pipeline] fallback sheet renderer failed:', e);
  }
  try {
    const { stdout } = await execFileAsync(PYTHON_BIN, [FALLBACK_EXTRACTOR, dxfFilePath], {
      maxBuffer: 100 * 1024 * 1024,
      env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
    });
    const extracted = JSON.parse(stdout) as { compliance_data?: unknown };
    if (extracted.compliance_data) compliance.compliance_data = extracted.compliance_data;
  } catch (e) {
    console.error('[pipeline] fallback static extractor failed:', e);
  }
  return compliance;
}
