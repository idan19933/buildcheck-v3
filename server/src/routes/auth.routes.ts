import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { signToken } from '../middleware/auth.middleware';

const router = Router();

const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  name: z.string().min(1),
  companyName: z.string().min(1),
});

router.post('/register', async (req, res) => {
  const parsed = registerSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const { email, password, name, companyName } = parsed.data;

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) return res.status(409).json({ error: 'Email already registered' });

  const slug = companyName.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40) + '-' + Date.now().toString(36);
  const hash = await bcrypt.hash(password, 10);

  const company = await prisma.company.create({ data: { name: companyName, slug } });
  const user = await prisma.user.create({
    data: { email, password: hash, name, role: 'ADMIN', companyId: company.id },
  });

  const token = signToken({ id: user.id, email: user.email, companyId: user.companyId, role: user.role });
  res.json({ token, user: { id: user.id, email: user.email, name: user.name, role: user.role, companyId: user.companyId } });
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string(),
});

router.post('/login', async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const { email, password } = parsed.data;

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) return res.status(401).json({ error: 'Invalid credentials' });
  const ok = await bcrypt.compare(password, user.password);
  if (!ok) return res.status(401).json({ error: 'Invalid credentials' });

  const token = signToken({ id: user.id, email: user.email, companyId: user.companyId, role: user.role });
  res.json({ token, user: { id: user.id, email: user.email, name: user.name, role: user.role, companyId: user.companyId } });
});

export default router;
