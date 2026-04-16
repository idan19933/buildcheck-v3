import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';

export function authMiddleware(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing or invalid Authorization header' });
  }
  const token = header.slice('Bearer '.length);
  try {
    const payload = jwt.verify(token, JWT_SECRET) as Express.UserPayload;
    req.user = payload;
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

export function signToken(user: Express.UserPayload): string {
  return jwt.sign(user, JWT_SECRET, { expiresIn: '7d' });
}
