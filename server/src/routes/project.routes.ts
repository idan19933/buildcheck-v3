import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { authMiddleware } from '../middleware/auth.middleware';
import { projectWhereClause } from '../middleware/company-guard.middleware';

const router = Router();
router.use(authMiddleware);

router.get('/', async (req, res) => {
  const where = projectWhereClause(req.user!);
  const projects = await prisma.project.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    include: {
      dxfFile: { select: { id: true, originalName: true } },
      tavaFile: { select: { id: true, originalName: true } },
      createdBy: { select: { id: true, name: true, email: true } },
      _count: { select: { analyses: true } },
    },
  });
  res.json({ projects });
});

const createSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  locality: z.string().optional(),
});

router.post('/', async (req, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const project = await prisma.project.create({
    data: {
      name: parsed.data.name,
      description: parsed.data.description,
      locality: parsed.data.locality,
      companyId: req.user!.companyId,
      createdById: req.user!.id,
    },
  });
  res.json({ project });
});

router.get('/:id', async (req, res) => {
  const project = await prisma.project.findFirst({
    where: { id: req.params.id, ...projectWhereClause(req.user!) },
    include: {
      dxfFile: true,
      tavaFile: true,
      addonDocuments: true,
      analyses: { orderBy: { createdAt: 'desc' }, take: 10 },
      createdBy: { select: { id: true, name: true, email: true } },
    },
  });
  if (!project) return res.status(404).json({ error: 'Project not found' });
  res.json({ project });
});

router.delete('/:id', async (req, res) => {
  const project = await prisma.project.findFirst({
    where: { id: req.params.id, ...projectWhereClause(req.user!) },
  });
  if (!project) return res.status(404).json({ error: 'Project not found' });
  await prisma.project.delete({ where: { id: project.id } });
  res.json({ ok: true });
});

export default router;
