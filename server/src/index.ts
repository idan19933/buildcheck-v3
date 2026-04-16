import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { prisma } from './lib/prisma';
import authRoutes from './routes/auth.routes';
import projectRoutes from './routes/project.routes';
import uploadRoutes from './routes/upload.routes';
import analysisRoutes from './routes/analysis.routes';
import addonAgentRoutes from './routes/addon-agent.routes';
import chatRoutes from './routes/chat.routes';
import adminRoutes from './routes/admin.routes';
import renderRoutes from './routes/render.routes';

async function recoverStuckAnalyses() {
  const cutoff = new Date(Date.now() - 30 * 60 * 1000);
  const stuck = await prisma.analysis.updateMany({
    where: {
      status: { in: ['PENDING', 'EXTRACTING_DXF', 'EXTRACTING_TAVA', 'ANALYZING'] },
      OR: [{ startedAt: { lt: cutoff } }, { startedAt: null }],
    },
    data: {
      status: 'FAILED',
      errorMessage: 'Analysis interrupted by server restart — please retry.',
      completedAt: new Date(),
    },
  });
  if (stuck.count > 0) console.log(`[boot] marked ${stuck.count} stuck analyses as FAILED`);
  const stuckRuns = await prisma.addonRun.updateMany({
    where: {
      status: { in: ['PENDING', 'RUNNING'] },
      OR: [{ startedAt: { lt: cutoff } }, { startedAt: null }],
    },
    data: {
      status: 'FAILED',
      errorMessage: 'Addon run interrupted by server restart — please retry.',
      completedAt: new Date(),
    },
  });
  if (stuckRuns.count > 0) console.log(`[boot] marked ${stuckRuns.count} stuck addon runs as FAILED`);
}

const app = express();
const PORT = parseInt(process.env.PORT || '3001', 10);

app.use(cors({ origin: process.env.CORS_ORIGIN || true, credentials: true }));
app.use(express.json({ limit: '10mb' }));

app.get('/health', (_req, res) => res.json({ ok: true, ts: Date.now() }));

// /api/renders must be registered BEFORE the catch-all /api mounts — otherwise
// analysisRoutes' router-level auth middleware intercepts and returns 401.
app.use('/api/renders', renderRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/projects', projectRoutes);
app.use('/api/uploads', uploadRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api', analysisRoutes);
app.use('/api', addonAgentRoutes);
app.use('/api', chatRoutes);

app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: err.message || 'Internal server error' });
});

app.listen(PORT, () => {
  console.log(`buildcheck-v3 server listening on :${PORT}`);
  recoverStuckAnalyses().catch((e) => console.error('[boot] recoverStuckAnalyses failed:', e));
});
