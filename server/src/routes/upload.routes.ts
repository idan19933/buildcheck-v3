import { Router } from 'express';
import { prisma } from '../lib/prisma';
import { authMiddleware } from '../middleware/auth.middleware';
import { projectWhereClause } from '../middleware/company-guard.middleware';
import { uploadDxf, uploadTava, decodeOriginalName } from '../middleware/upload.middleware';

const router = Router();
router.use(authMiddleware);

async function assertProject(projectId: string, user: Express.UserPayload) {
  return prisma.project.findFirst({
    where: { id: projectId, ...projectWhereClause(user) },
  });
}

router.post('/:projectId/dxf', uploadDxf.single('file'), async (req, res) => {
  const project = await assertProject(req.params.projectId, req.user!);
  if (!project) return res.status(404).json({ error: 'Project not found' });
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

  const originalName = decodeOriginalName(req.file);
  const existing = await prisma.dxfFile.findUnique({ where: { projectId: project.id } });
  const dxfFile = existing
    ? await prisma.dxfFile.update({
        where: { id: existing.id },
        data: {
          originalName,
          storedPath: req.file.path,
          fileSize: req.file.size,
          viewportMap: undefined,
          extractedData: undefined,
        },
      })
    : await prisma.dxfFile.create({
        data: {
          projectId: project.id,
          originalName,
          storedPath: req.file.path,
          fileSize: req.file.size,
        },
      });

  const tava = await prisma.tavaFile.findUnique({ where: { projectId: project.id } });
  await prisma.project.update({
    where: { id: project.id },
    data: { status: tava ? 'READY' : 'DRAFT' },
  });

  res.json({ dxfFile });
});

router.post('/:projectId/tava', uploadTava.single('file'), async (req, res) => {
  const project = await assertProject(req.params.projectId, req.user!);
  if (!project) return res.status(404).json({ error: 'Project not found' });
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

  const originalName = decodeOriginalName(req.file);
  const existing = await prisma.tavaFile.findUnique({ where: { projectId: project.id } });
  const tavaFile = existing
    ? await prisma.tavaFile.update({
        where: { id: existing.id },
        data: {
          originalName,
          storedPath: req.file.path,
          fileSize: req.file.size,
          extractedText: null,
          extractionMethod: null,
          requirements: undefined,
        },
      })
    : await prisma.tavaFile.create({
        data: {
          projectId: project.id,
          originalName,
          storedPath: req.file.path,
          fileSize: req.file.size,
        },
      });

  const dxf = await prisma.dxfFile.findUnique({ where: { projectId: project.id } });
  await prisma.project.update({
    where: { id: project.id },
    data: { status: dxf ? 'READY' : 'DRAFT' },
  });

  res.json({ tavaFile });
});

export default router;
