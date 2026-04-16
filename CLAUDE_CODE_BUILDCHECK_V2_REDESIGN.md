# BuildCheck AI v2 — Redesign Instructions (applied fixes)

> This is the canonical build doc for the `buildcheck-v3/` directory. "v3" is only the folder name (chosen to coexist with the older `buildcheck-v2/`). The architecture described here is the v2 redesign.

## Fixes applied from the original spec

- **Step 0 removed.** No v1 backup step — v1 lives on EC2, untouched.
- **All paths Windows-compatible / relative.** Local dev is on Windows; EC2 deploy is the last step.
- **No blocking workflow gates.** Straightforward build.

---

## What changed from v1

| Aspect | v1 (old) | v2 (this build) |
|--------|----------|------------------|
| Core input | DXF + any docs | DXF (בקשת היתר) + תב"ע PDF (mandatory pair) |
| Agent model | 7 parallel agents, all auto | 1 core agent auto + 4 on-demand add-ons |
| Regulation source | Arbitrary uploads | תב"ע is THE regulation for the core check |
| DXF parsing | Modelspace fingerprint | Viewport-block-aware extraction |
| Results UX | Single report | Core first, then "Run check" buttons per add-on |

## Key principles

1. Two mandatory uploads: DXF + תב"ע PDF.
2. Viewport-aware DXF parsing — data lives in named `VIEWPORT*` blocks.
3. Core agent checks ONLY what the תב"ע specifies.
4. `CANNOT_CHECK` is a first-class result.
5. Multi-tenant isolation scoped by `companyId`; `ADMIN` vs `MEMBER` roles.

---

## Directory layout

```
buildcheck-v3/
├── client/                   # React + Vite + TS + Tailwind RTL
│   └── src/
│       ├── components/   (Layout, FileUpload, ComplianceReport,
│       │                 AddonAgentCard, ComplianceStatusBadge,
│       │                 DxfPreview, ViewportSelector, ProtectedRoute)
│       ├── pages/        (Login, Register, Dashboard, NewProject,
│       │                 Project, Analysis, Admin)
│       ├── hooks/        (useAuth, useApi, useAnalysis)
│       ├── services/     (api.ts — axios + JWT interceptor)
│       └── types/
├── server/                   # Node + Express + TS
│   ├── src/
│   │   ├── routes/       (auth, project, upload, analysis,
│   │   │                 addon-agent, chat, admin)
│   │   ├── services/
│   │   │   ├── dxf.service.ts
│   │   │   ├── claude.service.ts
│   │   │   ├── pdf-extract.service.ts
│   │   │   ├── viewport-classifier.ts
│   │   │   ├── core-compliance-agent.ts
│   │   │   ├── analysis-orchestrator.ts
│   │   │   └── addon-agents/ (base, fire, water, electricity,
│   │   │                     accessibility)
│   │   ├── middleware/   (auth, company-guard, upload)
│   │   └── utils/
│   ├── python/
│   │   ├── dxf_viewport_extractor.py   ← NEW, primary
│   │   ├── dxf_fingerprint.py          ← fallback only
│   │   └── requirements.txt            (ezdxf, numpy, shapely)
│   ├── prisma/schema.prisma
│   └── uploads/
├── docker-compose.yml          (local Postgres)
├── .env.example
└── README.md
```

---

## Build order

1. ~~Backup old app~~ — **removed**.
2. Project structure (mkdir).
3. Prisma schema + migrate: `cd server && npx prisma migrate dev --name v2_init && npx prisma generate`.
4. Python deps: `pip install -r server/python/requirements.txt`.
5. **Python viewport extractor** (`dxf_viewport_extractor.py`). Smoke test:
   `python server/python/dxf_viewport_extractor.py path\to\sample.dxf | head -100`
6. PDF extraction service (`pdf-extract.service.ts`). Requires `poppler` for `pdftotext` / `pdftoppm` on Windows (install via `choco install poppler` or bundled binaries).
7. Claude service wrapper (port from v1 if convenient).
8. Core compliance agent (`core-compliance-agent.ts`).
9. Four add-on agents + base class.
10. Analysis orchestrator.
11. API routes + middleware (auth, company-guard).
12. Frontend: Vite scaffold → Tailwind RTL → pages/components → polling on AnalysisPage.
13. End-to-end test with real DXF + real תב"ע.
14. EC2 deploy (manual — existing instance already configured).

---

## Checkpoint after Step 5

Before continuing to Step 6, run the viewport extractor against a real DXF and verify:
- `viewport_classifications` assigns plausible `type` labels (floor_plan, cross_section, elevation, survey, parking_section, index_page).
- Hebrew labels decoded correctly (no `\U+XXXX` artifacts).
- `parsed_data` arrays (heights, dimensions, percentages, labels) are non-empty for the main viewports.
- If the DXF has no `VIEWPORT*` blocks, the extractor returns `total_viewports: 0` — that's the signal to fall back to `dxf_fingerprint.py`.

---

## Hard rules

- **Never** write to Clarity-style tables. N/A here — unrelated project.
- **Never** fabricate a schema field or a תב"ע requirement. If data is missing → `CANNOT_CHECK`.
- **Always** scope queries by `companyId`.
- **Always** use `<sql:param>` / Prisma parameterization — no string concat.
- Hebrew: default text. Code comments English. `CMN_LOOKUPS_V` rule is irrelevant here (Clarity carryover).

---

## Env

```env
DATABASE_URL=postgresql://buildcheck:buildcheck@localhost:5432/buildcheck_v2
ANTHROPIC_API_KEY=sk-ant-...
JWT_SECRET=...
PORT=3001
NODE_ENV=development
```

## Deploy

Last step only. EC2 box already runs Ubuntu + Docker + pm2 + Postgres + Nginx from v1. Manual deploy — no AWS provisioning in this doc.
