# BuildCheck AI v2 — Product Requirements Document

> **Audience:** An AI coding agent (Claude, Cursor, Copilot Workspace, etc.) tasked with rebuilding this repository from scratch. Treat this document as canonical. If implementation reality contradicts it, update the document, don't silently diverge.
>
> **Status:** Derived from the working v3 deployment at `ec2-13-61-215-177.eu-north-1.compute.amazonaws.com`. Every pipeline, heuristic, and error-handling decision described here is battle-tested against a real scanned Israeli permit application.

---

## 1. Executive Summary

**Product.** BuildCheck AI is a multi-tenant SaaS that checks whether an Israeli building permit application (בקשת היתר, a DXF file of architectural plans) complies with its governing zoning plan (תב"ע / החלטה מרחבית, a PDF of Hebrew zoning regulations). The output is a requirement-by-requirement report with four possible statuses per item (`PASS` / `FAIL` / `WARNING` / `CANNOT_CHECK`), an aggregate score, and a Hebrew summary paragraph.

**Users.** Israeli architects, engineering-office technicians, municipal plan reviewers, and building-permit consultants. All UI copy is Hebrew with right-to-left layout.

**Primary value.** Turn 40+ minutes of manual cross-referencing (architect highlights DXF values, cross-checks against PDF setbacks/heights/areas) into 2 minutes of automated analysis + readable report.

**What this is NOT.** Not a CAD tool. Not a 3D model validator. Not a design assistant. Not a generator of permit applications. Not an approval authority — it's an advisory / pre-check.

---

## 2. Goals & Non-Goals

### Goals (in priority order)

1. **Reliable core pipeline.** DXF + תב"ע PDF in → compliance report out, end-to-end, within 3 minutes for typical inputs.
2. **"CANNOT_CHECK" is first-class.** Never guess a requirement when the DXF doesn't contain the data; honestly report what was measurable vs. what wasn't.
3. **Multi-tenant isolation.** A company's projects are never visible to another company. Enforced at the ORM query level.
4. **On-demand domain add-ons.** Fire safety (כיבוי אש), plumbing (מים וביוב), electrical (חשמל), and accessibility (נגישות) checks run only when the user uploads the relevant regulation document and clicks "Run check."
5. **Observable failures.** A failed analysis must leave an actionable error message in `Analysis.errorMessage`. Crashed/interrupted analyses must self-heal on server boot.

### Non-goals

- Real-time collaboration, multi-user editing, presence, etc.
- Automated permit submission to municipal systems.
- Guaranteeing legal compliance (this is a pre-check, not an approval).
- Supporting DXF formats older than AC1009 / newer than AC1032 with exotic entity types (3DSOLID, MESH, etc.).
- Supporting non-Hebrew תב"ע documents.
- Mobile-first UI (desktop is the priority; responsive is acceptable, not required).

---

## 3. Users & Personas

### 3.1. Noa — Junior architect at a 15-person office

- Submits 2–4 permit applications per month.
- Workflow: draws in AutoCAD → exports DXF → uploads to BuildCheck → reviews gaps → tweaks DXF → re-uploads → re-runs.
- Pain: spends hours manually verifying that every setback, area, and height in her DXF matches the תב"ע she was handed.
- Needs: fast feedback loop, clear "what's missing" list, Hebrew UI.

### 3.2. Yossi — Office principal (ADMIN role)

- Oversees Noa and other junior architects.
- Wants visibility into every project the office has in flight.
- Wants to add/remove team members without waiting on IT.
- Occasionally runs analyses himself for urgent pre-checks before submitting to municipality.

### 3.3. Dana — Municipal plan reviewer (future persona, not in v1)

- Receives dozens of permit submissions per week.
- Wants a reverse view: she loads the DXF + the תב"ע her municipality publishes, and sees the pre-check report.
- Out of scope for v1, but data model / multi-tenancy must not preclude this.

---

## 4. User Stories

### Authentication & workspace

- **US-1** (MUST) As a new user, I can register with email + password + my company's name; my account is created with role=`ADMIN` and a new `Company` is created for me. The first user of a company is always the admin.
- **US-2** (MUST) As an ADMIN, I can invite `MEMBER` users to my company from the admin page (email + name + initial password + role).
- **US-3** (MUST) As an ADMIN, I can delete users from my company (except myself).
- **US-4** (MUST) As any user, I can log in with email + password and receive a JWT valid for 7 days.
- **US-5** (MUST) As any user, I can log out (token cleared client-side; server issues no opaque revocation — acceptable because JWT TTL is short).

### Project & file management

- **US-6** (MUST) As any user, I can create a new project with a name, optional description, and optional locality.
- **US-7** (MUST) As an ADMIN, I see all projects in my company on the dashboard. As a MEMBER, I see only projects I created.
- **US-8** (MUST) As a project owner, I can upload a `.dxf` file (up to 100 MB) as the בקשת היתר.
- **US-9** (MUST) As a project owner, I can upload a `.pdf` file (up to 50 MB) as the תב"ע / החלטה מרחבית.
- **US-10** (MUST) Re-uploading either core file replaces the previous one and invalidates cached extraction artifacts (`extractedData`, `extractedText`, `requirements`, `renderedImages`).
- **US-11** (MUST) I can delete a project (cascades to files, analyses, add-on runs, chat).

### Core analysis flow

- **US-12** (MUST) I can click "Run compliance check" on a project that has both DXF + PDF; this creates an `Analysis` row with `status=PENDING` and returns its ID immediately (non-blocking).
- **US-13** (MUST) While the analysis is in progress, the status transitions through `EXTRACTING_DXF` → `EXTRACTING_TAVA` → `ANALYZING` → `COMPLETED` (or `FAILED` at any point).
- **US-14** (MUST) The UI polls analysis status every ~2.5 s and auto-refreshes when the state changes.
- **US-15** (MUST) When the analysis completes I see: an aggregate score (0–100), counts of PASS/FAIL/WARNING/CANNOT_CHECK, a Hebrew summary paragraph, a per-requirement table with status badges, and a gallery of DXF preview thumbnails.
- **US-16** (MUST) If the analysis fails, I see a plain-Hebrew or plain-English error message (whichever the underlying tool emitted), not a stack trace.

### Add-on agents (optional per-domain checks)

- **US-17** (MUST) On the analysis results page, I see four add-on cards: `FIRE` (כיבוי אש), `WATER` (מים וביוב), `ELECTRICITY` (חשמל), `ACCESSIBILITY` (נגישות).
- **US-18** (MUST) For each add-on, I can upload a regulation document (PDF, up to 30 MB).
- **US-19** (MUST) After uploading, the "Run check" button becomes enabled; clicking it runs the corresponding agent against the cached DXF viewport data + the add-on document's extracted text.
- **US-20** (MUST) Add-on results appear in the card (score + counts) with a "See details" button opening a full report overlay.
- **US-21** (MUST) Re-uploading a different regulation document replaces the previous one for that domain and lets me re-run.

### Chat Q&A

- **US-22** (SHOULD) On a completed analysis, I can ask follow-up questions in Hebrew about the report. Claude answers using the analysis results + תב"ע text as context. Messages persist per-analysis.

### Admin

- **US-23** (MUST) As an ADMIN I see three counters on my admin page: total users, total projects, total analyses (all scoped to my company).
- **US-24** (MUST) As an ADMIN I see a table of users with their project count.

---

## 5. System Architecture

```
                                 ┌─────────────────────────────────────────┐
                                 │          EC2 / Docker Compose           │
                                 │                                         │
                                 │   ┌────────────┐                        │
                                 │   │  Postgres  │                        │
                                 │   │   16       │◄──── prisma db push    │
                                 │   └─────▲──────┘      (on boot)         │
                                 │         │                               │
     ┌───────────┐    HTTPS      │   ┌─────┴──────┐       ┌──────────┐     │
     │ Browser   │◄─────────────►│   │   server   │───────┤  python  │     │
     │ (React    │               │   │  (Node +   │ exec  │ extractor│     │
     │  SPA, RTL)│               │   │   Express) │       │ renderer │     │
     └─────┬─────┘               │   └─────▲──────┘       └──────────┘     │
           │                     │         │ HTTP 3001                     │
           │  /*   /api/*        │         │                               │
           │                     │   ┌─────┴──────┐                        │
     ┌─────▼──────┐              │   │   client   │ (serves built SPA +    │
     │ Host nginx │              │   │  (nginx)   │  proxies /api/ → server│
     │ (TLS :443) │──HTTP :8081──┼──►│ container  │   via docker network)  │
     └────────────┘              │   └────────────┘                        │
                                 │                                         │
                                 │   Named volumes:                        │
                                 │     buildcheck-v3-pgdata                │
                                 │     buildcheck-v3-uploads               │
                                 └─────────────────────────────────────────┘
                                           │
                                           ▼
                                      Anthropic API
                                      (Opus / Sonnet)
```

### Request paths

- Public-facing: `https://<hostname>/` (SPA), `https://<hostname>/api/*` (JSON), `https://<hostname>/api/renders/:dxfFileId/:filename` (PNG).
- Host nginx terminates TLS, proxies everything to `127.0.0.1:8081`.
- Docker's `docker-proxy` on 8081 forwards to the client container's internal nginx on port 80.
- Client container's nginx:
  - `location ^~ /api/` → `proxy_pass http://server:3001/api/` (the `^~` modifier is load-bearing — without it, the regex static-asset rule catches `/api/renders/*.png` first and 404s).
  - `location ~* \.(js|css|png|…)$` → static assets.
  - `location /` → SPA fallback (`try_files $uri /index.html`).
- Server container's Express app listens on 3001, routes mounted under `/api/*`.

### Long-running work

The analysis orchestrator is NOT a queue — it runs in the Node process that received the POST. This is acceptable because:
- Per-request work is bounded (typical analysis: 2–3 min).
- Server container restarts are handled via boot-time recovery (see §8.9).
- Traffic is low — a single 2-core instance can handle the expected load for the foreseeable future.

If concurrency becomes a bottleneck, migrate to BullMQ + Redis without changing the public API — the orchestrator's signature (`runCoreAnalysis(analysisId)`) is already idempotent-friendly.

---

## 6. Tech Stack

| Layer | Choice | Why |
|---|---|---|
| Frontend framework | React 18 + Vite + TypeScript | Fast HMR, standard tooling. |
| Styling | Tailwind CSS v3 (RTL by default via `dir="rtl"` on `<html>`) | Utility-first, low friction for Hebrew layouts. Heebo font from Google Fonts. |
| Icons | lucide-react | Clean line icons, small tree-shaken bundle. |
| Routing | react-router-dom v6 | `Navigate`, nested layouts. |
| HTTP client | axios | Interceptor pattern for JWT + 401 → `/login` redirect. |
| Backend | Node 20 LTS + Express 4 + TypeScript | Low ceremony, stable. |
| ORM | Prisma 5 | Type safety + migrations + JSON columns for loose shapes. |
| Database | Postgres 16 | pgvector-ready (future RAG); JSONB for `extractedData`, `coreResults`, etc. |
| AI | `@anthropic-ai/sdk` (v0.30+) | Opus for deep reasoning, Sonnet for vision/classification. |
| DXF parsing | Python 3 + `ezdxf` ≥ 1.3 | Mature, handles AC1009 through AC1032. |
| DXF rendering | `matplotlib` ≥ 3.9 | Deterministic, dark-theme plots, multi-format export. |
| PDF text | `pdftotext` / `pdftoppm` (poppler-utils) | Fast for digital PDFs, renders to PNG for OCR fallback. |
| OCR | Tesseract 5 + `heb` + `eng` + `osd` language packs | Free, local, good Hebrew accuracy at 300 DPI. |
| Auth | JWT (HS256, 7-day TTL) + bcryptjs (10 rounds) | Simple, stateless. |
| File upload | multer (disk storage) | Straightforward multipart handling. |
| Validation | zod | Schema + TS types in one. |
| Process mgmt | Docker Compose with `restart: unless-stopped` | No PM2 layer needed. |
| Reverse proxy (host) | nginx 1.24+ (Ubuntu) with self-signed cert | Existing on EC2; reuses TLS from v1. |
| Reverse proxy (client container) | nginx 1.27+ Alpine | Bundles built React app + `/api/` proxy. |
| Deploy target | Single EC2 instance (Ubuntu 24, 8 vCPU, 15 GB RAM) | Sufficient for v1 traffic. |

### Version pins that matter

- `prisma` and `@prisma/client` **must** match (both 5.22+). Binary targets in schema: `["native", "debian-openssl-3.0.x", "linux-musl-openssl-3.0.x"]`. This is critical — without `debian-openssl-3.0.x`, the runtime image (based on `node:20-bookworm-slim`) fails to load the query engine.
- `matplotlib` ≥ 3.9 (bundled with freetype, DejaVu fonts).
- `@anthropic-ai/sdk` 0.30+: do **not** rely on `Anthropic.Messages.ContentBlockParam` — that type isn't exported. Use a locally-typed union: `{ type: 'text'; text: string } | { type: 'image'; source: ... }` and cast `content as never` at the call site.

---

## 7. Data Model

Full Prisma schema lives at `server/prisma/schema.prisma`. Key notes for an implementer:

### 7.1. Entities and their purposes

| Model | Purpose | Keys |
|---|---|---|
| `Company` | Tenant boundary. Every other row is scoped by `companyId`. | `slug` is unique, URL-safe. |
| `User` | Account. One company per user (no cross-company membership in v1). | `email` unique. `role` is `ADMIN` or `MEMBER`. |
| `Project` | A single building permit application. Owns exactly one `DxfFile` and one `TavaFile`. | `status` drives UI (DRAFT / READY / ANALYZING / COMPLETED). |
| `DxfFile` | Uploaded בקשת היתר. | Stores `viewportMap`, `extractedData`, `renderedImages` as JSON. |
| `TavaFile` | Uploaded תב"ע PDF. | Stores `extractedText`, `extractionMethod`, parsed `requirements` array. |
| `AddonDocument` | Regulation doc for one add-on domain. | `@@index([projectId, domain])`; one per (project, domain) pair. |
| `Analysis` | One run of the core compliance agent. Has many `AddonRun`s and many `ChatMessage`s. | `status` drives polling UI. |
| `AddonRun` | One run of one add-on agent. | `@@unique([analysisId, domain])` — re-running replaces. |
| `ChatMessage` | Q&A history on an analysis. | `role: 'user' | 'assistant'`. |

### 7.2. Enums

- `UserRole`: `ADMIN`, `MEMBER`
- `ProjectStatus`: `DRAFT`, `READY`, `ANALYZING`, `COMPLETED`
- `AnalysisStatus`: `PENDING`, `EXTRACTING_DXF`, `EXTRACTING_TAVA`, `ANALYZING`, `COMPLETED`, `FAILED`
- `AddonDomain`: `FIRE`, `WATER`, `ELECTRICITY`, `ACCESSIBILITY`
- `AddonRunStatus`: `PENDING`, `RUNNING`, `COMPLETED`, `FAILED`

### 7.3. JSON columns — contract

These are loosely-typed in Postgres but must conform to TypeScript shapes:

**`DxfFile.extractedData`** — output of `dxf_viewport_extractor.py`. See §9.1 for full schema.

**`DxfFile.viewportMap`** — a subset of the above: `Record<string, { type, confidence, label, scale }>`. Used by the UI to let users verify classifications.

**`DxfFile.renderedImages`** — `string[]`, filenames (NOT paths) of PNGs inside `uploads/renders/<dxfFileId>/`.

**`TavaFile.requirements`** — array of:
```ts
{ section: string; requirement: string; value: string|number|null; unit: string|null;
  category: 'area'|'height'|'setback'|'parking'|'coverage'|'use'|'units'|'other' }
```

**`Analysis.coreResults`** / **`AddonRun.results`** — arrays of `ComplianceResult`:
```ts
{ requirement: string; source: string; status: 'PASS'|'FAIL'|'WARNING'|'CANNOT_CHECK';
  details: string; dxfEvidence: string;
  measuredValue: string|number|null; requiredValue: string|number|null; category: string }
```

### 7.4. Cascade rules

Deleting a `Project` cascades to `DxfFile`, `TavaFile`, `AddonDocument`, `Analysis`, and transitively `AddonRun`, `ChatMessage`. Uploaded files on disk are NOT deleted automatically — a future cleanup job should prune orphaned files under `uploads/`.

### 7.5. Schema evolution

For v1 we use `prisma db push` on boot (no migration history). Reason: we don't need point-in-time rollback and the schema is still churning. Future: switch to `prisma migrate deploy` once schema stabilizes — change the Dockerfile `CMD` accordingly.

---

## 8. Data Pipelines

This is the heart of the system. Each pipeline is described as: **trigger → steps → outputs → failure modes → recovery**.

### 8.1. Registration pipeline

**Trigger.** `POST /api/auth/register { email, password, name, companyName }`

**Steps.**
1. zod-validate payload.
2. Reject if `email` exists (409).
3. Derive company slug: `toLowerCase(companyName).replace(/[^a-z0-9]+/g, '-').slice(0, 40) + '-' + Date.now().toString(36)`.
4. `bcrypt.hash(password, 10)`.
5. Create `Company` and `User (role=ADMIN)` in sequence (not a transaction — if user creation fails, the orphan company is acceptable; extremely rare failure mode).
6. Sign JWT: `{ id, email, companyId, role }`, 7-day expiry.
7. Return `{ token, user }`.

**Failure modes.** Email already in use (409), validation errors (400). Nothing fatal.

### 8.2. Login pipeline

**Trigger.** `POST /api/auth/login { email, password }`.

**Steps.**
1. Lookup by email. If missing, return 401 with generic "Invalid credentials" (don't leak existence).
2. `bcrypt.compare`. If mismatch, same 401.
3. Sign + return JWT.

### 8.3. File upload pipelines

**Triggers.**
- `POST /api/uploads/:projectId/dxf` (multipart, field `file`)
- `POST /api/uploads/:projectId/tava` (multipart, field `file`)
- `POST /api/projects/:projectId/addon-docs` (multipart, `file` + form field `domain`)

**Multer config.** Disk storage. Filename: `${Date.now()}-${random}${originalExt}`. Destination: `server/uploads/<dxf|tava|addon-docs>/`. Limits: 100 MB for DXF, 50 MB for תב"ע, 30 MB for add-on docs.

**Critical detail — filename encoding.** Multer decodes `Content-Disposition` filename as Latin-1 by default, which mangles Hebrew. Every route that stores `originalName` must do:
```ts
originalName: Buffer.from(req.file.originalname, 'latin1').toString('utf8')
```
A helper `decodeOriginalName` lives in `upload.middleware.ts`. Never store `req.file.originalname` directly.

**Upload invalidates cache.** When a new DXF or תב"ע is uploaded, nullify `extractedData`, `viewportMap`, `renderedImages` (for DXF) or `extractedText`, `extractionMethod`, `requirements` (for תב"ע). Next analysis will re-extract.

**Project.status.** After upload, recompute: `DRAFT` if either core file missing, `READY` if both present, `ANALYZING` during a run, `COMPLETED` after success.

### 8.4. DXF processing pipeline

This is the crown jewel. Detailed full treatment in §9; summary here.

**Step 1 — Viewport extraction.** `dxf.service.ts::extractDxfViewports()` spawns:
```
python3 /app/python/dxf_viewport_extractor.py <storedPath>
```
with `PYTHONIOENCODING=utf-8`. Stdout is JSON; we `JSON.parse` it. Max buffer 100 MB.

**Step 2 — Rendering.** Best-effort. Spawns `dxf_render.py <storedPath> <outputDir>`; stdout is JSON array of filenames. Failures are swallowed (no render is preferable to no analysis).

**Step 3 — Persistence.** Update `DxfFile.extractedData`, `.viewportMap`, `.renderedImages`.

**Failure modes.**
- `ezdxf.readfile` raises → JSON `{"error": "..."}` printed and exit 1 → Node rejects the execFile promise → orchestrator marks `Analysis.status=FAILED` with the error text.
- Lone UTF-16 surrogates in DXF text entities (see §9.4) → previously crashed the Python JSON encoder → fixed by `_combine_and_scrub_surrogates` + ASCII-escape fallback.

### 8.5. PDF processing pipeline

**Step 1 — Fast path.** Run `pdftotext -layout <path> -`. If stdout has >100 non-whitespace chars, treat as success, store with `extractionMethod='pdf_text'`.

**Why 100?** Scanned PDFs sometimes return a handful of form-feed or OCR-by-accident characters. 100 is empirical — below that we've always been looking at a scanned document.

**Step 2 — OCR fallback.** When pdftotext returns too little:
1. `pdftoppm -tiff -r 300 <pdf> <tmpdir>/page` — render all pages to 300 DPI TIFFs (larger than PNG, better for Tesseract).
2. For each TIFF, run `tesseract <tif> - -l heb+eng --psm 1` in parallel (concurrency = 4 by default — tunable via env `TESSERACT_LANGS` and hardcoded `OCR_CONCURRENCY` constant).
3. Prefix each page's output with `--- עמוד N ---` and concatenate.
4. Mark `extractionMethod='tesseract_ocr'`.

**psm=1 (Auto OSD).** Automatic page segmentation with orientation detection. This handles the mix of columns, tables, and footnotes typical of תב"ע documents.

**Why `heb+eng`?** Hebrew docs often contain English/Latin-script numbers, units (m², cm), and section markers. Loading both languages costs <5% per page and dramatically improves number recognition.

**Why concurrency=4?** Tesseract is CPU-bound and internally multi-threaded. On an 8-core box, 4 external jobs × ~2 internal threads each = good utilization without thrashing. Adjust per-deployment.

**Step 3 — Requirements parsing.** Once text is available, call `parseTavaRequirements(text)` which sends a Hebrew prompt to Claude Opus (`max_tokens=16000`) asking for a JSON array of `{ section, requirement, value, unit, category }`. Full prompt is in `pdf-extract.service.ts`.

**Critical detail — max_tokens for Hebrew.** Hebrew tokenizes at ~2–3 characters per token in Claude's BPE. A dense JSON list of 40+ requirements easily exceeds 4000 tokens. **Never set `max_tokens < 16000` for Hebrew content agents.** A truncated response causes `Unterminated fractional number in JSON` during parse.

**Critical detail — JSON repair.** `parseJsonResponse` (in `claude.service.ts`) handles:
1. Strip leading ` ```json ` fence.
2. Strip from last ` ``` ` backward (drops trailing commentary).
3. Find first `[` or `{`.
4. Try `JSON.parse`.
5. On failure, if the string starts with `[`, slice back to the last `}` and append `]`. This salvages arrays truncated mid-object.

**Cache.** `TavaFile.extractedText` and `.requirements` are populated on first analysis and reused on subsequent ones. Re-running analysis is cheap; re-OCR-ing a 20-page scan is not.

### 8.6. Core compliance pipeline

`core-compliance-agent.ts::runCoreComplianceAgent(viewportData, tavaRequirements, tavaText)`.

**Pre-processing.** `buildDxfSummary(viewportData)` groups viewports by classification into six buckets:

```
floorPlans       ← floor_plan, roof_plan, site_plan
crossSections    ← cross_section
elevations       ← elevation
survey           ← survey
parking          ← parking_section
areaCalculation  ← area_calculation
(all else)       ← floorPlans as fallback
```

Each bucket is a plain-text block with: `Labels:`, `Heights:`, `Dimensions:`, `Percentages:`, `Geometry:` — the minimum needed for the model to reason without blowing context.

**Prompt.** Hebrew system+user. Contains:
- Full `tavaRequirements` JSON.
- First 8000 chars of `tavaFullText` as fallback context.
- Six DXF summary blocks.
- Explicit instructions: return `PASS` / `FAIL` / `WARNING` / `CANNOT_CHECK`. `CANNOT_CHECK` must state exactly what's missing and where in the DXF we would expect to find it. Cite `dxfEvidence` for every result.

**Call.** `callClaude(prompt, 'opus', [], { maxTokens: 16000 })`.

**Post-processing.** `parseJsonResponse` → derive `passCount` / `failCount` / `warningCount` / `cannotCheckCount` / `score = round(100 * pass / (pass + fail + warning))`.

**Persistence.** Update the `Analysis` row with status, counts, `coreResults`, `summary`, `completedAt`. Update `Project.status = COMPLETED`.

### 8.7. Add-on agent pipeline

`analysis-orchestrator.ts::runAddonAgent(analysisId, domain, documentId)`.

**Gating.** Requires:
- Parent `Analysis.status === 'COMPLETED'`.
- An `AddonDocument` exists for `(projectId, domain)`.
- The analysis's `DxfFile.extractedData` is populated (always true if core succeeded).

**Flow.** Upsert `AddonRun { analysisId, domain, documentId, status='RUNNING' }`. Instantiate the domain-specific agent (`FireAddonAgent`, etc. — each extends `BaseAddonAgent` and overrides `domain`, `displayName`, `systemPromptSuffix`). Call `agent.analyze(viewportData, regulationText, tavaText)`. The base class:
1. Builds a single Hebrew prompt combining the domain's `systemPromptSuffix` + truncated regulation text (8000 chars) + truncated תב"ע text (3000 chars) + summarized viewport data.
2. `callClaude(prompt, 'opus', [], { maxTokens: 12000 })`.
3. Parses and returns the same `AddonAgentResult` shape as core.

**Persistence.** Same pattern as core — counts, results, summary, `status='COMPLETED'` or `'FAILED'` with error message.

### 8.8. DXF rendering pipeline

`dxf.service.ts::renderDxf(dxfPath, outputDir)` spawns `dxf_render.py`.

**Python strategy.**
1. `ezdxf.readfile` the DXF.
2. Iterate `doc.modelspace()`. If `> 20` entities, render two PNGs (`plan_overview.png` at 150 DPI, `plan_detail.png` at 300 DPI — dark `#1e1e2e` background, ACI colors).
3. If modelspace is sparse (common for Israeli permit DXFs where content is inside VIEWPORT blocks), fall back: iterate blocks with name starting `VIEWPORT` (but not `VIEWPORT_`), render up to 8 with ≥20 entities each as `VIEWPORT<N>.png`.

**Supported entity types.** `LINE`, `LWPOLYLINE` (closed polygons get semi-transparent fill), `ARC` (polyline-approximated, 2° steps), `CIRCLE`, `INSERT` (rendered as `+` marker), `TEXT` / `MTEXT` (only ASCII — Hebrew is too complex to position correctly in matplotlib), `HATCH`, `SOLID`, `ELLIPSE`, `SPLINE` (control-point polyline fallback).

**ACI color table.** 22-entry dict of common AutoCAD ACI → hex. Layer inheritance: if entity color is null or 256 (BYLAYER), read the layer's color instead. Color 0 (BYBLOCK) treated as white (index 7).

**Output.** JSON array of filenames to stdout.

**Serving.** `GET /api/renders/:dxfFileId/:filename` (see §10). Intentionally unauthenticated — the UUID is the capability. Reasonable for internal use; revisit if exposure model changes.

### 8.9. Boot-time recovery

On server startup (`index.ts`), before accepting traffic:
- Any `Analysis` in `PENDING` / `EXTRACTING_DXF` / `EXTRACTING_TAVA` / `ANALYZING` older than 30 min (or with null `startedAt`) → set `status='FAILED'`, `errorMessage='Analysis interrupted by server restart — please retry.'`, `completedAt=now`.
- Same for `AddonRun` in `PENDING` / `RUNNING`.

This is a crude but effective safety net — without it, a redeploy during an in-flight analysis leaves rows stuck forever.

---

## 9. DXF Deep Knowledge

This section is the accumulated institutional knowledge about the DXF files our users actually upload. If the v2 codebase is rebuilt, this is the part most likely to be lost if not documented.

### 9.1. What Israeli permit application DXFs actually look like

An Israeli בקשת היתר DXF is produced by AutoCAD (or a clone — Autodesk DWG TrueView, Bricscad, ZWCAD). The architect sets it up as a layout sheet set:

- Each "sheet" in the permit set (index page, ground floor, first floor, roof plan, cross-sections, elevations, parking section, site survey) is a **separate viewport** inside the DXF, usually backed by a named BLOCK of the form `VIEWPORTn` or `VIEWPORT_something`. The real drawing content lives inside these blocks, not in modelspace.
- Modelspace is often mostly empty except for the title block / sheet borders.
- Text is mixed Hebrew + Latin (dimensions, scale notations, section titles).
- Hebrew text in TEXT/MTEXT entities is stored using AutoCAD's `\U+XXXX` escape sequence (UCS-2 code points).
- The DXF format version we've actually seen in the wild: **AC1009 (R12)** through **AC1027 (R2013)**. ezdxf handles both.

**The central insight.** v1 of BuildCheck scanned `doc.modelspace()` and classified the DXF by global fingerprint. It missed almost all the real information. **v2 iterates `doc.blocks`** filtered to `VIEWPORT*` names and classifies each block individually. This is ~10x more informative.

### 9.2. Extraction output schema

`dxf_viewport_extractor.py` emits:

```jsonc
{
  "file_info": { "version": "AC1027", "encoding": "utf-8", "layout_count": 2 },
  "viewports": {
    "VIEWPORT19": {
      "texts": [{ "text": "מטבח", "x": 125.4, "y": 89.2, "height": 2.5 }, ...],
      "geometry": {
        "entity_counts": { "LINE": 481, "LWPOLYLINE": 34, ... },
        "total_entities": 612,
        "line_count": 481,
        "polyline_count": 34,
        "insert_count": 20,
        "circle_count": 4,
        "arc_count": 12,
        "bounding_box": { "x_min": ..., "x_max": ..., "width": ..., "height": ... },
        "insert_names": ["DOOR", "WINDOW", ...],
        "layers_used": ["0", "WALLS", "DIM", ...]
      },
      "parsed_data": {
        "heights":     [{ "value": 2.8,  "type": "relative_height",    "x": ..., "y": ... }, ...],
        "dimensions":  [{ "value": 350, "x": ..., "y": ... }, ...],
        "percentages": [{ "value": "8%", "x": ..., "y": ... }, ...],
        "scales":      ["1:100"],
        "labels":      [{ "text": "קומת קרקע", "x": ..., "y": ... }, ...]
      },
      "classification": { "type": "floor_plan", "confidence": 0.85,
                          "label": "קרקע", "scale": "1:100" }
    },
    ...
  },
  "viewport_classifications": {  // flat copy for quick lookup
    "VIEWPORT19": { "type": "floor_plan", "confidence": 0.85, ... },
    ...
  },
  "summary": {
    "total_viewports": 32,
    "classified": 17,
    "unclassified": 15,
    "types_found": ["cross_section", "elevation", "floor_plan", "parking_section", "survey"]
  }
}
```

### 9.3. Classification heuristics (current state)

All in `classify_viewport()` inside `dxf_viewport_extractor.py`. Rules fire in order; first match wins.

1. **`index_page`** — at least 4 of these keywords present in *any* text entity: `קרקע`, `קומה`, `חתך`, `מדידה`, `פיתוח`, `העמדה`, `גג`, `חנייה`, `חזית` — AND at least one scale notation (e.g. `1:100`). Label: `תיק מידע`. Confidence 0.95.

2. **`floor_plan`** — at least 2 of the room keywords (`מטבח`, `דיור`, `הורים`, `שינה`, `אמבטיה`, `ממד`, `סלון`, `מרפסת`, `שירותים`, `מבואה`, `מסדרון`) appear as *labels* (Hebrew-heavy texts) AND `has_dimensions`. Sub-label derived from floor indicator (`קרקע` / `קומה א` / `קומה ב` / `תוכנית גג`). Confidence 0.85.

3. **`cross_section`** — text `חתך` anywhere, has heights, >15 total texts. Section ID extracted from patterns like `1-1`, `2-2`. Confidence 0.80.

4. **`elevation`** — at least 2 of `חזית`, `קו בניין`, `גבול מגרש` in labels. Direction extracted from `צפונית` / `דרומית` / `מזרחית` / `מערבית` if present. Confidence 0.80.

5. **`parking_section`** — any of `חנייה`, `חניייה`, `חנייה מקורה`, `חתך חנייה`. Confidence 0.80.

6. **`survey`** — high entity count (>2000 lines) + low text count (<50) + dimensions present. Also triggered by presence of `R=...` strings. Confidence 0.75.

7. **`site_plan`** — `פיתוח`, `העמדה`, `תוכנית פיתוח`, or `תוכנית העמדה` in labels. Confidence 0.70.

8. **`roof_plan`** — `גג` in labels + has_dimensions + >500 lines. Confidence 0.70.

9. **`area_calculation`** — `שטח` appears and >20 texts. Confidence 0.65.

10. **`unclassified`** — fallback.

**Tuning discipline.** Keep these heuristics *explicit and editable*. No ML classifier until we have hundreds of labeled DXFs. Every keyword should map to a PRD line; if you add one, add it to this document too.

### 9.4. Hebrew + Unicode edge cases

**`\U+XXXX` escapes.** ezdxf returns TEXT entity content with AutoCAD-style escapes for non-ASCII code points. The extractor runs:
```python
_UNICODE_ESCAPE_RE = re.compile(r"\\U\+([0-9A-Fa-f]{4})")
decoded = _UNICODE_ESCAPE_RE.sub(lambda m: chr(int(m.group(1), 16)), text)
```
This gives you real Hebrew characters.

**Surrogate-pair hell (the bug that bit us).** AutoCAD can encode characters outside the BMP (emoji, rare CJK) as two adjacent `\U+XXXX` escapes corresponding to a UTF-16 surrogate pair. Each escape decodes to a *lone* surrogate character in Python. Python's UTF-8 encoder refuses to serialize lone surrogates (`UnicodeEncodeError: 'utf-8' codec can't encode character '\udc81'`), which crashed our `json.dumps(ensure_ascii=False)` output.

**Fix.** `_combine_and_scrub_surrogates(s)`:
1. Walk the string; if you see a high surrogate followed by a low surrogate, combine them into the actual code point via `((hi - 0xD800) * 0x400) + (lo - 0xDC00) + 0x10000`.
2. Drop any remaining lone surrogate (can't be encoded as valid UTF-8 or JSON).

**Belt-and-suspenders.** Wrap the final `json.dumps` in try/except. If `ensure_ascii=False` still fails, fall back to `ensure_ascii=True` (escapes everything as `\uXXXX`). Node still parses it fine; the pipeline never crashes.

### 9.5. ACI color table

AutoCAD Color Index is a 256-entry palette. We don't need all 256 — the dict in `dxf_render.py` covers the ~40 colors seen in practice. Defaults:
- `color == 0` (BYBLOCK) → index 7 (white).
- `color == 256` (BYLAYER) → use layer's color.
- `color == None` or missing → gray `#AAAAAA`.

### 9.6. Rendering performance / limits

- Entity budget per figure: we cap line bounding-box computation at 5000 lines for performance, and layer listing at 1000 lines. Beyond that, we trust the user to be OK with partial bbox info.
- Matplotlib default backend is `Agg` (no display needed — critical for headless containers).
- Preview image file sizes in practice: 20–50 KB per viewport at 150 DPI. For a typical project with 8 previews: ~250 KB total.
- Text rendering filter: only ASCII-looking strings (regex `^[\d\.\-\+\s\*/=\(\)a-zA-Z°'\"]+$`) and only if length ≤ 12 (detail) or ≤ 6 (overview). Hebrew labels are skipped — matplotlib with RTL + complex shaping produces visual garbage.

### 9.7. What modelspace-heavy DXFs look like

Some DXFs (from simpler CAD tools, or exports of a single floor plan without a sheet set) put everything in modelspace. The extractor still works — `viewport_blocks` will just be empty and `total_viewports=0`. In that case, we should eventually add a fallback `classify_modelspace()` — currently out of scope.

### 9.8. Known DXF formats we DON'T handle well

- 3D entities (`3DSOLID`, `MESH`, `REGION`) — extractor ignores them, renderer ignores them. Any 3D-heavy DXF will look empty.
- Proxies / custom entities from non-Autodesk CAD tools — ezdxf may skip them silently.
- DWG files (the binary format) — we only accept `.dxf`. User must export to DXF first.

---

## 10. API Surface

All routes prefixed with `/api`. JSON in, JSON out (except `/api/renders/*` which returns PNG). Authentication via `Authorization: Bearer <jwt>` except where noted.

### 10.1. Auth (`/api/auth/*`, unauthenticated)

| Method | Path | Purpose |
|---|---|---|
| POST | `/auth/register` | `{email,password,name,companyName}` → `{token,user}` |
| POST | `/auth/login` | `{email,password}` → `{token,user}` |

### 10.2. Projects (`/api/projects/*`, authenticated)

| Method | Path | Purpose |
|---|---|---|
| GET | `/projects` | List (ADMIN: all in company, MEMBER: own). |
| POST | `/projects` | Create. |
| GET | `/projects/:id` | Detail with files + recent analyses. |
| DELETE | `/projects/:id` | Delete (cascades). |

### 10.3. Uploads (`/api/uploads/*`, authenticated, multipart)

| Method | Path | Purpose |
|---|---|---|
| POST | `/uploads/:projectId/dxf` | Upload .dxf (replaces existing). |
| POST | `/uploads/:projectId/tava` | Upload .pdf as תב"ע (replaces existing). |

### 10.4. Analysis (`/api`, authenticated)

| Method | Path | Purpose |
|---|---|---|
| POST | `/projects/:projectId/analyze` | Kick off analysis. Returns `{analysisId, status:'PENDING'}`. |
| GET | `/analyses/:analysisId` | Full analysis including project, files, addon runs. |
| GET | `/analyses/:analysisId/status` | Lightweight polling endpoint. |

### 10.5. Add-on agents (`/api`, authenticated, multipart for uploads)

| Method | Path | Purpose |
|---|---|---|
| GET | `/analyses/:analysisId/addons` | List 4 domain cards with status. |
| POST | `/projects/:projectId/addon-docs` | Upload regulation doc for a domain. |
| POST | `/analyses/:analysisId/addons/:domain/run` | Trigger a domain agent. |

### 10.6. Chat (`/api`, authenticated)

| Method | Path | Purpose |
|---|---|---|
| GET | `/analyses/:analysisId/chat` | Message history. |
| POST | `/analyses/:analysisId/chat` | Append user message, get AI reply. |

### 10.7. Admin (`/api/admin/*`, authenticated, ADMIN only)

| Method | Path | Purpose |
|---|---|---|
| GET | `/admin/users` | List. |
| POST | `/admin/users` | Invite. |
| DELETE | `/admin/users/:id` | Remove (except self). |
| GET | `/admin/stats` | Counts for dashboard. |

### 10.8. Renders (`/api/renders/:dxfFileId/:filename`, UNAUTHENTICATED)

Serves PNG thumbnails. Security = the dxfFileId UUID (unguessable). Validates regex on UUID, checks filename is a plain PNG (no `..`, `/`, `\`), checks DxfFile exists.

**Must be mounted BEFORE `app.use('/api', analysisRoutes)`** in `index.ts`. Otherwise `analysisRoutes`' router-level auth middleware intercepts and returns 401.

### 10.9. Health

`GET /health` → `{ok: true, ts}`. Unauthenticated. Outside `/api/*`. Useful for load balancer probes.

---

## 11. Frontend Structure

```
client/src/
├── App.tsx                 ← routes
├── main.tsx                ← BrowserRouter + StrictMode
├── index.css               ← Tailwind base + Heebo font
├── hooks/useAuth.ts        ← localStorage + cross-tab sync
├── services/api.ts         ← axios instance with JWT interceptor + 401 redirect
├── types/index.ts          ← User, Project, Analysis, AddonInfo, ...
├── components/
│   ├── Layout.tsx                 ← sidebar + logout
│   ├── ProtectedRoute.tsx
│   ├── FileUpload.tsx             ← drag-drop
│   ├── ComplianceStatusBadge.tsx  ← 4 states in Hebrew
│   ├── ComplianceReport.tsx       ← per-requirement list
│   ├── AddonAgentCard.tsx         ← one of four cards on AnalysisPage
│   └── DxfPreview.tsx             ← thumbnail grid + lightbox
└── pages/
    ├── LoginPage.tsx
    ├── RegisterPage.tsx
    ├── DashboardPage.tsx          ← projects grid
    ├── NewProjectPage.tsx         ← 4-step wizard (details → DXF → תב"ע → review)
    ├── ProjectPage.tsx            ← files + run button + history
    ├── AnalysisPage.tsx           ← core results + add-on cards + renders
    └── AdminPage.tsx              ← user table + stats
```

### RTL mechanics

`<html dir="rtl" lang="he">` in `index.html`. Tailwind is otherwise LTR-neutral; we use logical properties where needed (`ms-*`, `me-*` over `ml-*`, `mr-*` for anything user-facing).

### Polling

`AnalysisPage` polls `/api/analyses/:id` every 2.5 s until `status` is terminal (`COMPLETED` or `FAILED`). On terminal state, stops polling and fetches `/api/analyses/:id/addons` to populate the add-on grid.

---

## 12. Security Model

**Tenant isolation.** Every query touching `Project`, `DxfFile`, `TavaFile`, `AddonDocument`, `Analysis`, `AddonRun`, `ChatMessage` must filter by either `companyId` (direct) or through the `Project`'s `companyId` (transitively). Helper: `projectWhereClause(user)` in `middleware/company-guard.ts`. ADMIN gets all rows in their company; MEMBER gets only rows they created.

**JWT.** HS256, secret in `JWT_SECRET` env. 7-day expiry. No refresh token in v1 (acceptable — users re-login weekly).

**Passwords.** bcrypt, 10 rounds.

**File serving.**
- DXF and PDF files are NEVER served to the browser. They live at `uploads/dxf/*` and `uploads/tava/*` and are only read by the orchestrator.
- Only render PNGs are served, via `/api/renders/:uuid/:file` with UUID-as-capability.

**Upload validation.** Extension check + size limit via multer `fileFilter` and `limits`. No content-type sniffing in v1 — acceptable because files are never executed.

**What's intentionally permissive (with mitigations).**
- Self-signed TLS cert (browser warning). Mitigation: document the "click Advanced → proceed" step; users of BuildCheck are internal professionals.
- Render URLs unauthenticated. Mitigation: UUIDs are the capability. Not suitable if these were public plans, but acceptable for per-company internal use.

---

## 13. Deployment

### 13.1. Local dev (Windows/Mac/Linux)

```bash
docker compose up -d                          # start Postgres on 5432
cd server && npm install
cp ../.env.example ../.env                    # then fill ANTHROPIC_API_KEY, JWT_SECRET
npx prisma db push && npx prisma generate
npm run dev                                   # http://localhost:3001
cd ../client && npm install && npm run dev    # http://localhost:5173
```

### 13.2. Production (EC2 Ubuntu)

1. Get code on the box (`rsync` or `git pull`).
2. `cp .env.production.example .env` and fill.
3. `./scripts/deploy.sh` — builds both images, runs `docker compose up -d`, waits for health.
4. Host-level nginx proxies `https://<host>/` → `127.0.0.1:8081`. Client container's nginx proxies `/api/` → `server:3001`.

### 13.3. Docker images

- `server/Dockerfile` — multi-stage Node 20. Runtime stage installs: `openssl libssl3`, `python3 python3-pip python3-venv`, `poppler-utils`, `tesseract-ocr tesseract-ocr-heb tesseract-ocr-eng`. Python deps in a venv at `/opt/venv`; `PYTHON_BIN=/opt/venv/bin/python3` env points the Node service at it.
- `client/Dockerfile` — Vite build → `nginx:1.27-alpine` serving `/dist`.

### 13.4. Persistence

Named Docker volumes:
- `buildcheck-v3-pgdata` → Postgres data.
- `buildcheck-v3-uploads` → all uploads + renders.

Backup strategy (manual for v1):
```bash
docker run --rm -v buildcheck-v3-pgdata:/data -v $PWD:/b busybox \
  tar czf /b/pg-$(date +%F).tgz /data
```

### 13.5. Redeploy procedure

```
git pull
./scripts/deploy.sh     # rebuilds changed images, restarts; prisma db push on boot
```

Downtime per deploy: ~15 s (container restart).

---

## 14. Testing & Acceptance Criteria

### 14.1. Smoke tests (manual for v1)

1. Register a new user with a new company → auto-login → land on empty dashboard.
2. Create a project → upload a known-good DXF → upload its paired PDF → click "Run" → watch status transitions → see completed report with score + requirements.
3. Re-run the analysis on the same project → total time < 30 s (cached OCR text + requirements).
4. Upload an accessibility regulation PDF → click "Run check" on the accessibility card → see a second report populate.
5. Log in as a second user in a different company → verify the first user's projects are invisible.
6. Restart the server container mid-analysis → on next boot, the stuck row is marked FAILED and the UI shows "Analysis interrupted by server restart — please retry."

### 14.2. DXF extractor acceptance (Python unit)

Run `python3 dxf_viewport_extractor.py sample.dxf` and verify:
- `summary.total_viewports > 0`.
- Classifier hit rate (`classified / total_viewports`) ≥ 50% on representative files.
- `parsed_data.labels[0].text` renders as real Hebrew (no `\U+XXXX` escapes).
- Files containing emoji or unicode-rare characters don't crash.

### 14.3. OCR acceptance (Python + tesseract)

Run `pdftoppm -tiff -r 300 scanned.pdf /tmp/page` then `tesseract /tmp/page-01.tif - -l heb+eng --psm 1`:
- Output is >200 chars of recognizable Hebrew.
- Runtime per page < 15 s on an 8-core box.

### 14.4. End-to-end latency budget

- DXF extraction + render: ≤ 30 s for a 20-viewport file.
- PDF: digital → ≤ 5 s; scanned (20 pages) → ≤ 3 min first run, ≤ 2 s subsequent (cached).
- Core compliance agent: ≤ 90 s.
- Total fresh analysis: ≤ 4 min. Re-run with cached extraction: ≤ 2 min.

### 14.5. Claude response resilience

- `parseJsonResponse` must not throw on Claude responses with trailing markdown or trailing commentary.
- `parseJsonResponse` must salvage truncated array responses by trimming to the last complete `}` and closing `]`.
- `callClaude` must log a warning when `stop_reason === 'max_tokens'`.

---

## 15. Known Issues & Limitations (as of 2026-04-16)

1. **Classifier hit rate is middling** (~55% on real DXFs). Unclassified viewports become "unknown" in reports. Low-effort improvements: add more room keywords; detect title blocks by entity pattern.
2. **Hebrew text in renders is skipped.** Only ASCII labels are drawn. Fine for preview; not for "print-ready" output. Future: switch to a PIL/Cairo rendering path that handles RTL shaping.
3. **No migration history.** Schema changes require `db push` on each deploy. Fine for pre-launch; sign-off before shipping to real customers.
4. **Self-signed TLS.** Browser warnings on first visit. Next step: attach a real domain and get a Let's Encrypt cert.
5. **In-process analysis runner.** Server restart mid-analysis fails that run. We recover on boot, but a real job queue (BullMQ) would let runs resume. Deferred until traffic warrants.
6. **No rate limiting.** A user could spam `/analyze` and burn Claude credits. Acceptable at current scale; add per-company daily cap once multi-customer.
7. **Multer filename encoding fix is applied at route level**, not as a middleware. Two route files do the `latin1 → utf8` dance. If you add a new upload route, don't forget to call `decodeOriginalName`.
8. **`/api` catch-all order is fragile.** If someone adds `app.use('/api', someRouter)` that does `router.use(authMiddleware)`, and places it before `/api/renders`, render URLs will 401. Comment in `index.ts` warns about this; preserve it.
9. **Nginx regex location beats prefix location.** `location ^~ /api/` is required (not just `location /api/`). Same comment in `client/nginx.conf`.

---

## 16. Future Work

### Near-term (v1.1)

- **Migration history.** `prisma migrate dev` locally, `migrate deploy` in Dockerfile CMD.
- **Better classifier.** Collect labeled DXFs from real users, train a small keyword-weight model per viewport block, serialize and ship with the Python script.
- **Viewport-level preview with Hebrew.** Switch renderer to Cairo + Pango for RTL shaping.
- **Per-viewport lightbox with entity-click.** Click a line in the preview → see its layer/color/dxftype.
- **Analysis re-run should not re-render DXF** if DXF file hasn't changed. Store a hash in `DxfFile` and skip render if hash matches cached `renderedImages`.

### Mid-term (v2.0)

- **Knowledge layer / RAG.** pgvector + FTS on historical תב"ע docs. When a requirement section is ambiguous, retrieve similar clauses from past analyses.
- **BullMQ job queue.** Move orchestrator behind a queue; add retry with exponential backoff.
- **Job queue UI.** Show a "pending analyses" indicator for ADMIN.
- **Public share links.** Generate signed, expiring URLs for analysis reports (for sharing with clients / municipalities).
- **Mobile-friendly results viewer.** Read-only summary page that works on phones.

### Long-term

- **Municipal review mode.** Dana persona (see §3.3).
- **Auto-generate corrections.** Given a FAIL result, suggest minimal DXF edits (dimension changes, added annotations).
- **Integration with Autodesk Revit / BIM.** Direct plugin that submits the IFC/DWG without export.

---

## 17. Glossary (Hebrew terms)

| Hebrew | English | Role in system |
|---|---|---|
| בקשת היתר | Permit application | The DXF the architect uploads. |
| תב"ע | Detailed outline plan | One form of zoning plan PDF. |
| החלטה מרחבית | Spatial decision | Another form of zoning plan PDF (newer regulatory term). |
| קו בניין | Building line / setback | Distance from plot boundary. |
| גבול מגרש | Plot boundary | Physical boundary of the lot. |
| תכסית | Coverage | Percentage of plot covered by buildings. |
| אחוזי בנייה | Building percentages | Ratio of total built area to plot area. |
| שטח עיקרי | Main area | Primary livable floor area. |
| שטח שירות | Service area | Non-livable area (storage, utility). |
| קומה | Floor / story | Level. |
| קומת קרקע | Ground floor | Floor at street level. |
| קומה א | Floor 1 (first above ground) | Typical Israeli numbering. |
| מרפסת | Balcony | Included/excluded from area calcs per תב"ע. |
| ממד | Safe room | Mandatory in Israeli construction; often labeled `ממ"ד`. |
| חתך | Cross-section | Orthogonal slice view of the building. |
| חזית | Elevation | Front/side/back face view. |
| תיק מידע | Information file | The index page of the permit set. |
| מדידה | Survey | Site measurement plan. |
| חנייה | Parking | Parking count, dimensions, slopes. |
| פיתוח | Development | Site development / landscaping plan. |
| חישוב שטחים | Area calculation | Tabular summary of main/service areas by floor. |

---

## 18. Rebuild Checklist

For an AI agent tasked with rebuilding this project from zero, here's the phased order. Each phase ends with a verification step — don't proceed until it passes.

### Phase 0 — Scaffolding

- [ ] Create directory tree matching §11 and §13.3 layout.
- [ ] Write `server/package.json`, `server/tsconfig.json`, `client/package.json`, `client/tsconfig.json`, `client/vite.config.ts`, `client/tailwind.config.js`, `client/postcss.config.js`, `client/index.html`, `client/src/main.tsx`, `client/src/index.css`.
- [ ] `docker-compose.yml` (local Postgres) and `docker-compose.prod.yml` (full stack).
- [ ] `.env.example`, `.env.production.example`, `.gitignore` (see §12 — MUST exclude `.env`, `*.pem`, `uploads/`).
- [ ] **Verify.** `docker compose up -d` brings Postgres up; `nc -z localhost 5432` succeeds.

### Phase 1 — Schema + DB

- [ ] Write `server/prisma/schema.prisma` matching §7. Include `binaryTargets` in the generator block.
- [ ] `cd server && npm install && npx prisma db push && npx prisma generate`.
- [ ] **Verify.** `psql ... -c "\dt"` shows all 9 tables.

### Phase 2 — Python DXF pipeline

- [ ] Write `server/python/dxf_viewport_extractor.py` implementing §9 (viewport filtering, `_combine_and_scrub_surrogates`, classifier rules, ASCII-escape fallback).
- [ ] Write `server/python/dxf_render.py` (modelspace + viewport-block fallback, ACI colors).
- [ ] Write `server/python/requirements.txt` with `ezdxf`, `numpy`, `shapely`, `matplotlib`.
- [ ] **Verify.** Run extractor against a real Israeli permit DXF; confirm `total_viewports > 0` and at least one `floor_plan` classification. Run renderer; confirm PNGs are produced.

### Phase 3 — Backend skeleton

- [ ] Write auth middleware, company-guard middleware, upload middleware (with `decodeOriginalName`), Prisma lib.
- [ ] Write `claude.service.ts` (with `parseJsonResponse` + JSON repair + stop_reason warning).
- [ ] Write `pdf-extract.service.ts` (pdftotext fast path + tesseract fallback with `--psm 1 -l heb+eng`, parallelized at concurrency=4).
- [ ] Write `dxf.service.ts` (wrappers around extractor + renderer).
- [ ] Write auth, project, upload routes.
- [ ] Write `index.ts` with the critical mount ordering: renders FIRST, then specific paths, then catch-all `/api`. Boot-time recovery at startup.
- [ ] **Verify.** Register → login → create project → upload DXF + PDF; confirm DB rows appear.

### Phase 4 — Agents + orchestrator

- [ ] Write `core-compliance-agent.ts` with `buildDxfSummary` + Hebrew prompt + `max_tokens=16000`.
- [ ] Write `addon-agents/base-addon-agent.ts` + 4 concrete agents (fire, water, electricity, accessibility) with `max_tokens=12000`.
- [ ] Write `analysis-orchestrator.ts` — `runCoreAnalysis` and `runAddonAgent`.
- [ ] Write analysis, addon-agent, chat, admin, render routes.
- [ ] **Verify.** End-to-end: upload → analyze → COMPLETED with realistic Hebrew summary and a non-empty requirements array.

### Phase 5 — Frontend

- [ ] All pages and components per §11. Pay attention to:
  - `<html dir="rtl" lang="he">`.
  - Polling loop in `AnalysisPage`.
  - `DxfPreview` component using `/api/renders/:fileId/:filename`.
  - `AddonAgentCard` with the FIRE/WATER/ELECTRICITY/ACCESSIBILITY icons.
- [ ] **Verify.** Full click-through from login to viewing a completed analysis. All icons render. Images visible. Hebrew displays correctly.

### Phase 6 — Production images

- [ ] Write `server/Dockerfile` with multi-stage build. Runtime stage apt-installs: `openssl libssl3`, `python3` + venv, `poppler-utils`, `tesseract-ocr tesseract-ocr-heb tesseract-ocr-eng`.
- [ ] Write `client/Dockerfile` (Vite build → nginx). `client/nginx.conf` with `location ^~ /api/` (the `^~` is critical).
- [ ] Write `scripts/deploy.sh`.
- [ ] **Verify.** `docker compose -f docker-compose.prod.yml --env-file .env up -d --build` brings the stack up. `curl http://localhost:${HTTP_PORT:-8080}/health` returns 200.

### Phase 7 — EC2 deploy

- [ ] Copy repo to EC2 (rsync or git clone).
- [ ] Install Docker via `curl -fsSL https://get.docker.com | sh`. Ubuntu apt's `docker-compose-plugin` is not in default repos.
- [ ] Create `.env` from `.env.production.example`; fill keys.
- [ ] Edit host nginx `sites-enabled/default` to proxy 443 → `127.0.0.1:${HTTP_PORT}`.
- [ ] `./scripts/deploy.sh`.
- [ ] **Verify.** `curl -k https://<host>/` returns the SPA shell.

---

## 19. Contact / Ownership

Primary developer: Idan (`hshany@gmail.com`, GitHub `idan19933`). Production URL: `https://ec2-13-61-215-177.eu-north-1.compute.amazonaws.com`. Code: `https://github.com/idan19933/buildcheck-v3`. EC2 SSH key: `Compliance_Key.pem` (user's local `~/Downloads`, NOT in repo).

v1 (predecessor, still running in parallel) lives on the same EC2 at `/home/ubuntu/buildcheck-v2` — untouched by v3 and scheduled for decommission once v3 data has accumulated.
