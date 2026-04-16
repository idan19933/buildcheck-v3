import { Router } from 'express';
import path from 'path';
import fs from 'fs';
import { prisma } from '../lib/prisma';

const router = Router();

const RENDER_ROOT = path.resolve(__dirname, '../../uploads/renders');

// Intentionally unauthenticated: dxfFileId is a UUID, acting as the capability token.
// Serves PNG previews inline. Prevents path traversal.
router.get('/:dxfFileId/:filename', async (req, res) => {
  const { dxfFileId, filename } = req.params;

  if (!/^[0-9a-f-]{36}$/i.test(dxfFileId)) return res.status(400).end();
  if (filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
    return res.status(400).end();
  }
  if (!/\.(png|jpg|jpeg|webp)$/i.test(filename)) return res.status(400).end();

  // Confirm the dxf file actually exists (cheap check; avoids probing disk).
  const exists = await prisma.dxfFile.findUnique({
    where: { id: dxfFileId },
    select: { id: true },
  });
  if (!exists) return res.status(404).end();

  const filePath = path.join(RENDER_ROOT, dxfFileId, filename);
  if (!fs.existsSync(filePath)) return res.status(404).end();

  res.setHeader('Cache-Control', 'public, max-age=86400');
  res.sendFile(filePath);
});

export default router;
