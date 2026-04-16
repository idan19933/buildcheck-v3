# CLAUDE.md — BuildCheck AI v2

Multi-tenant Israeli building permit compliance checker. Compares a בקשת היתר (permit application DXF) against its corresponding תב"ע / החלטה מרחבית (zoning plan PDF).

## Stack

- Frontend: React 18 + Vite + TypeScript + Tailwind (RTL)
- Backend: Node.js + Express + TypeScript
- Database: PostgreSQL 16 + Prisma ORM (pgvector + FTS for future RAG)
- DXF parsing: Python 3 + ezdxf (viewport-aware extraction)
- AI: Claude API (Sonnet for classification, Opus for analysis)
- Auth: JWT (email/password)
- Local dev DB: docker-compose

## Architecture in one line

One mandatory core compliance agent (DXF ↔ תב"ע) + four on-demand add-on agents (fire, water, electricity, accessibility), each gated on uploading a domain-specific regulation document.

## Build instructions

See `CLAUDE_CODE_BUILDCHECK_V2_REDESIGN.md` in this directory.

## Conventions

- All user-facing text is Hebrew; code/comments are English.
- DXF extraction is **viewport-block-aware** — data lives in named `VIEWPORT*` blocks, not modelspace.
- `CANNOT_CHECK` is a first-class compliance status. Never guess when data is missing.
- Multi-tenant isolation: every query must scope by `companyId`.
