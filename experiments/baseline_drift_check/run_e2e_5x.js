/**
 * run_e2e_5x.js — run 5 full end-to-end analyses on the יתיר file
 * (with whatever code is currently in /app/dist).
 *
 * Output: /tmp/experiments/drift_e2e_<label>_<idx>.json per run.
 * `label` env var distinguishes runs done on old commit vs current main.
 */
const { promises: fs } = require('node:fs');
const path = require('node:path');

const { prisma } = require('/app/dist/lib/prisma');
const { runCoreAnalysis } = require('/app/dist/services/analysis-orchestrator');

const TARGET_DXF_FILE_ID = 'a414d098-cfd4-4b04-8a9f-dffba3e9f221';
const OUTPUT_DIR = '/tmp/experiments';
const LABEL = process.env.RUN_LABEL || 'unlabeled';
const RUN_COUNT = parseInt(process.env.RUN_COUNT || '5', 10);

async function pollUntilDone(analysisId) {
  while (true) {
    const a = await prisma.analysis.findUnique({
      where: { id: analysisId },
      select: { status: true, errorMessage: true,
                passCount: true, failCount: true, warningCount: true,
                cannotCheckCount: true, overallScore: true, coreResults: true },
    });
    if (a.status === 'COMPLETED' || a.status === 'FAILED') return a;
    await new Promise(r => setTimeout(r, 5000));
  }
}

async function runOne(idx) {
  const dxf = await prisma.dxfFile.findUniqueOrThrow({
    where: { id: TARGET_DXF_FILE_ID },
    include: { project: true },
  });
  const fresh = await prisma.analysis.create({
    data: { projectId: dxf.projectId, triggeredBy: dxf.project.createdById, status: 'PENDING' },
  });
  console.log(`[${LABEL}/${idx}] analysis ${fresh.id} starting`);
  const t0 = Date.now();
  // Don't await runCoreAnalysis — run in background, poll for completion
  runCoreAnalysis(fresh.id).catch(e => console.error(`[${LABEL}/${idx}] runCoreAnalysis threw:`, e.message));
  const finished = await pollUntilDone(fresh.id);
  const duration = Date.now() - t0;

  const result = {
    label: LABEL,
    run_index: idx,
    analysis_id: fresh.id,
    status: finished.status,
    error: finished.errorMessage,
    score: finished.overallScore,
    status_counts: {
      pass: finished.passCount,
      fail: finished.failCount,
      warning: finished.warningCount,
      cannot_check: finished.cannotCheckCount,
    },
    per_requirement: (finished.coreResults || []).map(r => ({
      requirement: r.requirement, status: r.status, source: r.source ?? null,
      measured_value: r.measuredValue ?? null, notes: r.details ?? null,
    })),
    duration_ms: duration,
    timestamp: new Date().toISOString(),
  };

  const fname = `drift_e2e_${LABEL}_${idx}.json`;
  await fs.writeFile(path.join(OUTPUT_DIR, fname), JSON.stringify(result, null, 2), 'utf-8');
  const sc = result.status_counts;
  console.log(`[${LABEL}/${idx}] DONE score=${result.score} P=${sc.pass} F=${sc.fail} W=${sc.warning} CC=${sc.cannot_check} (${(duration/1000).toFixed(0)}s)`);
}

async function main() {
  await fs.mkdir(OUTPUT_DIR, { recursive: true });
  for (let i = 1; i <= RUN_COUNT; i++) {
    try { await runOne(i); }
    catch (e) { console.error(`[${LABEL}/${i}] FAILED:`, e instanceof Error ? e.message : e); }
  }
  console.log(`\nAll ${RUN_COUNT} runs complete.`);
}

main().catch(e => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
