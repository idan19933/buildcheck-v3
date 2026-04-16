import { execFile } from 'child_process';
import { promisify } from 'util';
import path from 'path';

const execFileAsync = promisify(execFile);

const PYTHON_BIN = process.env.PYTHON_BIN || 'python3';
const EXTRACTOR = path.resolve(__dirname, '../../python/dxf_viewport_extractor.py');
const RENDERER = path.resolve(__dirname, '../../python/dxf_render.py');

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
