import { Router } from 'express';
import { prisma } from '../lib/prisma';
import { authMiddleware } from '../middleware/auth.middleware';
import { projectWhereClause } from '../middleware/company-guard.middleware';
import { runCoreAnalysis } from '../services/analysis-orchestrator';

const router = Router();
router.use(authMiddleware);

router.post('/projects/:projectId/analyze', async (req, res) => {
  const project = await prisma.project.findFirst({
    where: { id: req.params.projectId, ...projectWhereClause(req.user!) },
    include: { dxfFile: true, tavaFile: true },
  });
  if (!project) return res.status(404).json({ error: 'Project not found' });
  if (!project.dxfFile) return res.status(400).json({ error: 'Missing DXF file' });
  if (!project.tavaFile) return res.status(400).json({ error: 'Missing תב"ע file' });

  const analysis = await prisma.analysis.create({
    data: { projectId: project.id, triggeredBy: req.user!.id, status: 'PENDING' },
  });
  await prisma.project.update({ where: { id: project.id }, data: { status: 'ANALYZING' } });

  runCoreAnalysis(analysis.id).catch((e) => console.error('runCoreAnalysis error', e));

  res.json({ analysisId: analysis.id, status: 'PENDING' });
});

router.get('/analyses/:analysisId', async (req, res) => {
  const analysis = await prisma.analysis.findFirst({
    where: {
      id: req.params.analysisId,
      project: { companyId: req.user!.companyId },
    },
    include: {
      addonRuns: true,
      project: {
        include: {
          dxfFile: { select: { id: true, originalName: true, viewportMap: true, renderedImages: true } },
          tavaFile: { select: { id: true, originalName: true } },
          addonDocuments: true,
        },
      },
    },
  });
  if (!analysis) return res.status(404).json({ error: 'Analysis not found' });
  res.json({ analysis });
});

router.get('/analyses/:analysisId/status', async (req, res) => {
  const analysis = await prisma.analysis.findFirst({
    where: {
      id: req.params.analysisId,
      project: { companyId: req.user!.companyId },
    },
    select: {
      status: true, overallScore: true,
      passCount: true, failCount: true,
      warningCount: true, cannotCheckCount: true,
      errorMessage: true,
    },
  });
  if (!analysis) return res.status(404).json({ error: 'Analysis not found' });
  res.json(analysis);
});

export default router;
