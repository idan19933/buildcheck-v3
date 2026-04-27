/**
 * run_regression_check.js
 * =======================
 *
 * 3×3 factorial experiment: decoder pipeline (pre|post) × prompt framing
 * (current|softened) × 3 repetitions = 12 runs on the יתיר file.
 *
 * Optimization vs the original spec: instead of full end-to-end (~5 min/run
 * with non-deterministic AI codegen Phase 2), we cache the upstream pipeline
 * outputs (viewportData, AI extraction, TAVA OCR) and only re-run the parts
 * that depend on the experimental variables — semantic_classify (decoder
 * toggle) and the compliance agent (prompt toggle). Result: ~90 s per run,
 * sharper isolation of the variable, no codegen-noise confounding.
 *
 * Designed to be copied into the server container and run with:
 *   node /app/run_regression_check.js
 *
 * Output: regression_check_*.json files in /tmp/experiments/.
 */
const { promises: fs } = require('node:fs');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');

const { prisma } = require('/app/dist/lib/prisma');
const { buildSemanticIndex } = require('/app/dist/services/semantic-index');
const { runCoreComplianceAgent } = require('/app/dist/services/core-compliance-agent');

const execFileAsync = promisify(execFile);

const TARGET_DXF_FILE_ID = 'a414d098-cfd4-4b04-8a9f-dffba3e9f221';
const PYTHON_BIN = 'python3';
const SEMANTIC_CLASSIFIER = '/app/python/semantic_classify.py';
const OUTPUT_DIR = '/tmp/experiments';

const CELLS = ['pre_current', 'post_current', 'pre_softened', 'post_softened'];

function envFor(cell) {
  return {
    USE_DECODER_PIPELINE: cell.startsWith('post') ? 'true' : 'false',
    COMPLIANCE_PROMPT_VARIANT: cell.endsWith('softened') ? 'softened' : 'current',
  };
}

async function classifySemantic(dxfPath, outPath, decoderEnv) {
  const { stdout } = await execFileAsync(
    PYTHON_BIN,
    [SEMANTIC_CLASSIFIER, dxfPath, outPath],
    {
      maxBuffer: 100 * 1024 * 1024,
      env: {
        ...process.env,
        PYTHONIOENCODING: 'utf-8',
        USE_DECODER_PIPELINE: decoderEnv,
      },
    },
  );
  return JSON.parse(stdout.trim());
}

async function runOne(cell, runIndex) {
  const env = envFor(cell);
  const tag = `[${cell}/${runIndex}]`;
  console.log(`\n${tag} decoder=${env.USE_DECODER_PIPELINE} prompt=${env.COMPLIANCE_PROMPT_VARIANT}`);

  const dxf = await prisma.dxfFile.findUniqueOrThrow({
    where: { id: TARGET_DXF_FILE_ID },
    include: { project: { include: { tavaFile: true } } },
  });
  if (!dxf.extractedData) throw new Error('extractedData empty');
  if (!dxf.project.tavaFile?.extractedText) throw new Error('TAVA text missing');
  if (!dxf.project.tavaFile.requirements) throw new Error('requirements missing');

  // Re-classify with the requested decoder env into a per-run output file
  const semanticOut = path.join(OUTPUT_DIR, `classified_${cell}_${runIndex}.json`);
  const semanticSummary = await classifySemantic(dxf.storedPath, semanticOut, env.USE_DECODER_PIPELINE);

  const classifiedRaw = JSON.parse(await fs.readFile(semanticOut, 'utf-8'));
  const records = Array.isArray(classifiedRaw) ? classifiedRaw : classifiedRaw.records;
  const idx = buildSemanticIndex(records);

  // Mutate process.env so the agent module reads the right variant for this call
  process.env.COMPLIANCE_PROMPT_VARIANT = env.COMPLIANCE_PROMPT_VARIANT;

  const t0 = Date.now();
  const result = await runCoreComplianceAgent(
    dxf.extractedData,
    dxf.project.tavaFile.requirements,
    dxf.project.tavaFile.extractedText,
    idx,
  );
  const duration = Date.now() - t0;

  return {
    timestamp: new Date().toISOString(),
    cell,
    run_index: runIndex,
    score: result.score,
    status_counts: {
      pass: result.passCount,
      fail: result.failCount,
      warning: result.warningCount,
      cannot_check: result.cannotCheckCount,
    },
    per_requirement: result.requirements.map(r => ({
      requirement: r.requirement,
      source: r.source ?? null,
      status: r.status,
      measured_value: r.measuredValue ?? null,
      notes: r.details ?? null,
    })),
    decoder_stage_hits: semanticSummary.decoder_stage_hits ?? null,
    semantic_index_summary: {
      boundaries_total: idx.boundaries.total,
      rooms_total: idx.rooms.total,
      elevations_abs_total: idx.elevations.absolute.total,
      elevations_rel_total: idx.elevations.relative.total,
      unclassified_count: semanticSummary.unclassified_count,
      noise_count: (semanticSummary.by_match_type || {}).noise || 0,
    },
    llm_call_metadata: { duration_ms: duration },
  };
}

async function main() {
  await fs.mkdir(OUTPUT_DIR, { recursive: true });
  const manifest = { started_at: new Date().toISOString(), runs: [] };

  for (const rep of [1, 2, 3]) {
    for (const cell of CELLS) {
      try {
        const res = await runOne(cell, rep);
        const fname = `regression_check_${cell}_${rep}.json`;
        await fs.writeFile(path.join(OUTPUT_DIR, fname), JSON.stringify(res, null, 2), 'utf-8');
        manifest.runs.push(fname);
        const sc = res.status_counts;
        console.log(`[${cell}/${rep}] score=${res.score} P=${sc.pass} F=${sc.fail} W=${sc.warning} CC=${sc.cannot_check} (${res.llm_call_metadata.duration_ms}ms)`);
      } catch (e) {
        console.error(`[${cell}/${rep}] FAILED:`, e instanceof Error ? e.message : e);
      }
    }
  }

  manifest.finished_at = new Date().toISOString();
  await fs.writeFile(path.join(OUTPUT_DIR, 'regression_check_manifest.json'),
    JSON.stringify(manifest, null, 2), 'utf-8');
  console.log(`\nDone. Wrote ${manifest.runs.length}/${3 * CELLS.length} result files + manifest to ${OUTPUT_DIR}.`);
}

main()
  .catch(e => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
