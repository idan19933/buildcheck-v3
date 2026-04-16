import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { callClaude, parseJsonResponse } from './claude.service';

const execAsync = promisify(exec);

export type ExtractionMethod = 'pdf_text' | 'tesseract_ocr';

export interface PdfExtractionResult {
  text: string;
  method: ExtractionMethod;
  pageCount: number;
}

export async function extractPdfText(pdfPath: string): Promise<PdfExtractionResult> {
  // Try pdftotext first — fast, works for text-based PDFs.
  try {
    const { stdout } = await execAsync(`pdftotext -layout "${pdfPath}" -`, {
      maxBuffer: 20 * 1024 * 1024,
    });
    if (stdout.replace(/\s/g, '').length > 100) {
      const pageCount = await getPageCount(pdfPath);
      return { text: stdout.trim(), method: 'pdf_text', pageCount };
    }
  } catch {
    // pdftotext missing or empty output — fall through
  }

  // Fallback for scanned PDFs: render pages and OCR with Tesseract (Hebrew).
  return extractWithTesseract(pdfPath);
}

async function getPageCount(pdfPath: string): Promise<number> {
  try {
    const { stdout } = await execAsync(`pdfinfo "${pdfPath}"`);
    const m = stdout.match(/^Pages:\s*(\d+)/m);
    return m ? parseInt(m[1], 10) : 1;
  } catch {
    return 1;
  }
}

const OCR_CONCURRENCY = 4;
const OCR_LANGS = process.env.TESSERACT_LANGS || 'heb+eng';

async function extractWithTesseract(pdfPath: string): Promise<PdfExtractionResult> {
  // Verify tesseract + Hebrew language pack are present.
  try {
    const { stdout: langs } = await execAsync('tesseract --list-langs 2>&1');
    if (!/\bheb\b/.test(langs)) {
      throw new Error('Tesseract is installed but the Hebrew language pack (heb) is missing. Install tesseract-ocr-heb.');
    }
  } catch (e) {
    if (e instanceof Error && e.message.includes('Hebrew language pack')) throw e;
    throw new Error('Tesseract is not installed (apt: tesseract-ocr tesseract-ocr-heb).');
  }

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tava-'));
  try {
    // Render to TIFF (denser, better for OCR) at 300 dpi.
    await execAsync(`pdftoppm -tiff -r 300 "${pdfPath}" "${path.join(tempDir, 'page')}"`);
    const pageFiles = fs
      .readdirSync(tempDir)
      .filter((f) => f.endsWith('.tif') || f.endsWith('.tiff'))
      .sort();

    if (pageFiles.length === 0) {
      throw new Error('Failed to render PDF pages (is poppler installed?)');
    }

    console.log(`[tava] rendered ${pageFiles.length} pages, OCR via tesseract (langs=${OCR_LANGS}, concurrency=${OCR_CONCURRENCY})`);

    const results: string[] = new Array(pageFiles.length);

    for (let start = 0; start < pageFiles.length; start += OCR_CONCURRENCY) {
      const batch = pageFiles.slice(start, start + OCR_CONCURRENCY);
      const batchStarted = Date.now();
      await Promise.all(
        batch.map(async (file, idx) => {
          const pageIdx = start + idx;
          const pageNum = pageIdx + 1;
          const inputPath = path.join(tempDir, file);
          try {
            // tesseract <input> - -l heb+eng --psm 1
            const { stdout } = await execAsync(
              `tesseract "${inputPath}" - -l ${OCR_LANGS} --psm 1 2>/dev/null`,
              { maxBuffer: 10 * 1024 * 1024 },
            );
            results[pageIdx] = stdout.trim();
            console.log(`[tava] page ${pageNum}/${pageFiles.length} ok (${results[pageIdx].length} chars)`);
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            console.error(`[tava] page ${pageNum} OCR failed: ${msg}`);
            results[pageIdx] = `[[page ${pageNum} OCR failed]]`;
          }
        }),
      );
      console.log(`[tava] batch ${start + 1}-${start + batch.length} in ${Math.round((Date.now() - batchStarted) / 1000)}s`);
    }

    const chunks = results.map((t, i) => `--- עמוד ${i + 1} ---\n${t}`);
    return {
      text: chunks.join('\n\n'),
      method: 'tesseract_ocr',
      pageCount: pageFiles.length,
    };
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

export interface TavaRequirement {
  section: string;
  requirement: string;
  value: string | number | null;
  unit: string | null;
  category: 'area' | 'height' | 'setback' | 'parking' | 'coverage' | 'use' | 'units' | 'other';
}

export async function parseTavaRequirements(extractedText: string): Promise<TavaRequirement[]> {
  const prompt = `אתה מנתח מסמכי תב"ע ישראליים. מהטקסט הבא, חלץ את כל הדרישות הכמותיות/המדידות.

## הטקסט:
${extractedText.slice(0, 15000)}

## המשימה:
זהה כל דרישה שאפשר לבדוק מול תוכנית בנייה (DXF):
- שטחי בנייה (עיקרי, שירות, מרתף, מרפסות, אחוזי בנייה)
- גובה בניין, מספר קומות
- קווי בניין (נסיגות — קדמי, אחורי, צדדי)
- תכסית
- חנייה
- שימושים מותרים
- מספר יחידות דיור

## פורמט — JSON array בלבד, ללא markdown:
[
  {
    "section": "סעיף 5.2",
    "requirement": "שטח בנייה עיקרי מקסימלי",
    "value": 160,
    "unit": "מ\\"ר",
    "category": "area"
  }
]`;

  const raw = await callClaude(prompt, 'opus', [], { maxTokens: 16000 });
  return parseJsonResponse<TavaRequirement[]>(raw);
}
