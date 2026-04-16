import { Request, Response, NextFunction } from 'express';

export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  if (!req.user) return res.status(401).json({ error: 'Not authenticated' });
  if (req.user.role !== 'ADMIN') return res.status(403).json({ error: 'Admin access required' });
  next();
}

export function projectWhereClause(user: { id: string; companyId: string; role: string }) {
  const where: { companyId: string; createdById?: string } = { companyId: user.companyId };
  if (user.role !== 'ADMIN') where.createdById = user.id;
  return where;
}
