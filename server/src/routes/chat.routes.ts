import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { authMiddleware } from '../middleware/auth.middleware';
import { callClaude } from '../services/claude.service';

const router = Router();
router.use(authMiddleware);

router.get('/analyses/:analysisId/chat', async (req, res) => {
  const analysis = await prisma.analysis.findFirst({
    where: { id: req.params.analysisId, project: { companyId: req.user!.companyId } },
    select: { id: true },
  });
  if (!analysis) return res.status(404).json({ error: 'Analysis not found' });

  const messages = await prisma.chatMessage.findMany({
    where: { analysisId: analysis.id },
    orderBy: { createdAt: 'asc' },
  });
  res.json({ messages });
});

const postSchema = z.object({ content: z.string().min(1).max(2000) });

router.post('/analyses/:analysisId/chat', async (req, res) => {
  const parsed = postSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const analysis = await prisma.analysis.findFirst({
    where: { id: req.params.analysisId, project: { companyId: req.user!.companyId } },
    include: { project: { include: { tavaFile: { select: { extractedText: true } } } } },
  });
  if (!analysis) return res.status(404).json({ error: 'Analysis not found' });

  await prisma.chatMessage.create({
    data: { analysisId: analysis.id, role: 'user', content: parsed.data.content },
  });

  const history = await prisma.chatMessage.findMany({
    where: { analysisId: analysis.id },
    orderBy: { createdAt: 'asc' },
    take: 20,
  });

  const context = `
## תוצאות הבדיקה:
${JSON.stringify(analysis.coreResults, null, 2).slice(0, 4000)}

## סיכום:
${analysis.summary || ''}

## תב"ע (קטע):
${(analysis.project.tavaFile?.extractedText || '').slice(0, 3000)}

## שיחה עד כה:
${history.map((m) => `${m.role}: ${m.content}`).join('\n')}

ענה למשתמש בעברית, בקצרה וברורות, על סמך תוצאות הבדיקה והתב"ע.`;

  const answer = await callClaude(context, 'sonnet', [], { maxTokens: 1500 });

  const reply = await prisma.chatMessage.create({
    data: { analysisId: analysis.id, role: 'assistant', content: answer },
  });
  res.json({ message: reply });
});

export default router;
