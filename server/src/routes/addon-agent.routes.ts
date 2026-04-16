import { Router } from 'express';
import { prisma } from '../lib/prisma';
import { authMiddleware } from '../middleware/auth.middleware';
import { projectWhereClause } from '../middleware/company-guard.middleware';
import { uploadAddonDoc, decodeOriginalName } from '../middleware/upload.middleware';
import { runAddonAgent } from '../services/analysis-orchestrator';
import { extractPdfText } from '../services/pdf-extract.service';
import type { AddonDomain } from '@prisma/client';

const router = Router();
router.use(authMiddleware);

const VALID_DOMAINS: AddonDomain[] = ['FIRE', 'WATER', 'ELECTRICITY', 'ACCESSIBILITY'];
const DOMAIN_LABELS: Record<AddonDomain, string> = {
  FIRE: 'כיבוי אש',
  WATER: 'מים וביוב',
  ELECTRICITY: 'חשמל',
  ACCESSIBILITY: 'נגישות',
};

router.get('/analyses/:analysisId/addons', async (req, res) => {
  const analysis = await prisma.analysis.findFirst({
    where: {
      id: req.params.analysisId,
      project: { companyId: req.user!.companyId },
    },
    include: { addonRuns: true, project: { include: { addonDocuments: true } } },
  });
  if (!analysis) return res.status(404).json({ error: 'Analysis not found' });

  const addons = VALID_DOMAINS.map((domain) => {
    const run = analysis.addonRuns.find((r) => r.domain === domain);
    const doc = analysis.project.addonDocuments.find((d) => d.domain === domain);
    return {
      domain,
      displayName: DOMAIN_LABELS[domain],
      hasDocument: !!doc,
      documentName: doc?.originalName ?? null,
      documentId: doc?.id ?? null,
      run: run
        ? {
            status: run.status,
            score: run.score,
            passCount: run.passCount,
            failCount: run.failCount,
            warningCount: run.warningCount,
            cannotCheckCount: run.cannotCheckCount,
            summary: run.summary,
            results: run.results,
            errorMessage: run.errorMessage,
            completedAt: run.completedAt,
          }
        : null,
    };
  });
  res.json({ addons });
});

router.post(
  '/projects/:projectId/addon-docs',
  uploadAddonDoc.single('file'),
  async (req, res) => {
    const project = await prisma.project.findFirst({
      where: { id: req.params.projectId, ...projectWhereClause(req.user!) },
    });
    if (!project) return res.status(404).json({ error: 'Project not found' });
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

    const domain = req.body.domain as AddonDomain;
    if (!VALID_DOMAINS.includes(domain)) {
      return res.status(400).json({ error: 'Invalid domain' });
    }

    let extractedText = '';
    try {
      const extraction = await extractPdfText(req.file.path);
      extractedText = extraction.text;
    } catch {
      // Best-effort — addon doc may be non-PDF or extraction may fail
    }

    const originalName = decodeOriginalName(req.file);
    const existing = await prisma.addonDocument.findFirst({
      where: { projectId: project.id, domain },
    });
    const doc = existing
      ? await prisma.addonDocument.update({
          where: { id: existing.id },
          data: {
            originalName,
            storedPath: req.file.path,
            fileSize: req.file.size,
            extractedText,
          },
        })
      : await prisma.addonDocument.create({
          data: {
            projectId: project.id,
            domain,
            originalName,
            storedPath: req.file.path,
            fileSize: req.file.size,
            extractedText,
          },
        });

    res.json({ document: doc });
  },
);

router.post('/analyses/:analysisId/addons/:domain/run', async (req, res) => {
  const domain = req.params.domain as AddonDomain;
  if (!VALID_DOMAINS.includes(domain)) {
    return res.status(400).json({ error: 'Invalid domain' });
  }

  const analysis = await prisma.analysis.findFirst({
    where: {
      id: req.params.analysisId,
      project: { companyId: req.user!.companyId },
      status: 'COMPLETED',
    },
    include: {
      project: { include: { addonDocuments: { where: { domain } } } },
    },
  });
  if (!analysis) {
    return res.status(404).json({ error: 'Analysis not found or core analysis not completed' });
  }

  const doc = analysis.project.addonDocuments[0];
  if (!doc) {
    return res.status(400).json({
      error: `No ${DOMAIN_LABELS[domain]} regulation document uploaded.`,
    });
  }

  runAddonAgent(analysis.id, domain, doc.id).catch((e) =>
    console.error('runAddonAgent error', e),
  );
  res.json({ status: 'RUNNING', domain });
});

export default router;
