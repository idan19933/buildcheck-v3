# BuildCheck AI v2 (buildcheck-v3/)

See `CLAUDE.md` and `CLAUDE_CODE_BUILDCHECK_V2_REDESIGN.md`.

## Quick start — local dev

```bash
# 1. Start Postgres
docker compose up -d

# 2. Python deps
cd server
pip install -r python/requirements.txt

# 3. Smoke-test the viewport extractor against a real DXF
python python/dxf_viewport_extractor.py path\to\sample.dxf > out.json

# 4. (later) Prisma migrate — needs DATABASE_URL set
cp ../.env.example ../.env   # fill in values
npx prisma migrate dev --name v2_init
npx prisma generate
```

## Why a new directory

The existing `../buildcheck-v2/` is an older in-progress build. This `buildcheck-v3/` is the clean redesign per the v2 spec.
