import { Router } from 'express';
import { z } from 'zod';
import bcrypt from 'bcryptjs';
import { prisma } from '../lib/prisma';
import { authMiddleware } from '../middleware/auth.middleware';
import { requireAdmin } from '../middleware/company-guard.middleware';

const router = Router();
router.use(authMiddleware, requireAdmin);

router.get('/users', async (req, res) => {
  const users = await prisma.user.findMany({
    where: { companyId: req.user!.companyId },
    select: {
      id: true, email: true, name: true, role: true, createdAt: true,
      _count: { select: { projects: true, analyses: true } },
    },
    orderBy: { createdAt: 'asc' },
  });
  res.json({ users });
});

const inviteSchema = z.object({
  email: z.string().email(),
  name: z.string().min(1),
  password: z.string().min(8),
  role: z.enum(['ADMIN', 'MEMBER']).default('MEMBER'),
});

router.post('/users', async (req, res) => {
  const parsed = inviteSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const { email, name, password, role } = parsed.data;

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) return res.status(409).json({ error: 'Email already registered' });

  const hash = await bcrypt.hash(password, 10);
  const user = await prisma.user.create({
    data: { email, name, password: hash, role, companyId: req.user!.companyId },
    select: { id: true, email: true, name: true, role: true },
  });
  res.json({ user });
});

router.delete('/users/:id', async (req, res) => {
  const user = await prisma.user.findFirst({
    where: { id: req.params.id, companyId: req.user!.companyId },
  });
  if (!user) return res.status(404).json({ error: 'User not found' });
  if (user.id === req.user!.id) return res.status(400).json({ error: 'Cannot delete self' });
  await prisma.user.delete({ where: { id: user.id } });
  res.json({ ok: true });
});

router.get('/stats', async (req, res) => {
  const [userCount, projectCount, analysisCount] = await Promise.all([
    prisma.user.count({ where: { companyId: req.user!.companyId } }),
    prisma.project.count({ where: { companyId: req.user!.companyId } }),
    prisma.analysis.count({ where: { project: { companyId: req.user!.companyId } } }),
  ]);
  res.json({ userCount, projectCount, analysisCount });
});

export default router;
