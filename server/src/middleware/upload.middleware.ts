import multer from 'multer';
import path from 'path';
import fs from 'fs';

const UPLOAD_ROOT = path.resolve(__dirname, '../../uploads');

function ensureDir(dir: string) {
  fs.mkdirSync(dir, { recursive: true });
}

function makeStorage(subdir: string) {
  const dir = path.join(UPLOAD_ROOT, subdir);
  ensureDir(dir);
  return multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, dir),
    filename: (_req, file, cb) => {
      const unique = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
      const safeExt = path.extname(file.originalname).toLowerCase().replace(/[^.a-z0-9]/g, '');
      cb(null, `${unique}${safeExt}`);
    },
  });
}

export const uploadDxf = multer({
  storage: makeStorage('dxf'),
  limits: { fileSize: 100 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (!file.originalname.toLowerCase().endsWith('.dxf')) {
      return cb(new Error('Only .dxf files accepted'));
    }
    cb(null, true);
  },
});

export const uploadTava = multer({
  storage: makeStorage('tava'),
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (!file.originalname.toLowerCase().endsWith('.pdf')) {
      return cb(new Error('Only .pdf files accepted'));
    }
    cb(null, true);
  },
});

export const uploadAddonDoc = multer({
  storage: makeStorage('addon-docs'),
  limits: { fileSize: 30 * 1024 * 1024 },
});

// Multer decodes multipart filenames as latin1 by default, which mangles
// UTF-8 filenames (Hebrew, emoji, etc). Call after `upload.single(...)`.
export function decodeOriginalName(file: Express.Multer.File): string {
  return Buffer.from(file.originalname, 'latin1').toString('utf8');
}
