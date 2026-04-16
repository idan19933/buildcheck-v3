import 'express';

declare global {
  namespace Express {
    interface UserPayload {
      id: string;
      email: string;
      companyId: string;
      role: 'ADMIN' | 'MEMBER';
    }
    interface Request {
      user?: UserPayload;
    }
  }
}
