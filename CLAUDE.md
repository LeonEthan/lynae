# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a documentation-first repository for a desktop AI coding workbench (桌面版 AI Coding 应用). The project is currently in Phase 0 (planning/architecture) with implementation planned across a 12-week milestone schedule.

**Key Documents:**
- `docs/PROJECT_DESIGN_FINAL.md`: Source of truth for product scope, architecture, and milestones
- `docs/pr-implementation-plan.md`: PR-sliced implementation plan with 18 sequenced PRs
- `AGENTS.md`: General contributor guidelines

## Planned Architecture

**Monorepo Structure (to be implemented):**
- `apps/desktop`: Electron + React + TypeScript + Vite
- `packages/agent-core`: Task state machine, session orchestration
- `packages/runtime-adapters/claude`: Claude Code SDK adapter
- `packages/toolkit`: Tool execution layer (file, terminal, git)
- `packages/policy-engine`: Permission rules and approval workflows
- `packages/storage`: SQLite + Drizzle ORM for persistence

**Key Technical Decisions:**
- Single Runtime Provider: Claude Code SDK only (no Codex/other providers in MVP)
- Local-first: SQLite storage, OS Keychain for secrets
- Security-first: Default deny for commands, approval workflows for高危操作

## Development Commands

**Current State (Documentation Only):**
No build/test pipeline is configured yet. For documentation contributions:

```bash
# Review documentation
ls docs/
sed -n '1,120p' docs/PROJECT_DESIGN_FINAL.md

# Find TODOs/FIXMEs
rg "TODO|FIXME" docs
```

**Future Commands (when code is added):**
Root-level scripts will be added for:
- `dev`: Start desktop app in development mode
- `build`: Build all packages
- `test`: Run unit and integration tests
- `lint`: Run ESLint and Prettier

Update this section when PR-01 (Monorepo baseline) is merged.

## Implementation Roadmap

The project follows an 18-PR sequence across 4 phases:

**Phase 0 (Weeks 1-2): Foundation**
- PR-01: Monorepo initialization
- PR-02: Electron shell + basic UI
- PR-03: IPC contracts
- PR-04: SQLite storage baseline

**Phase 1 (Weeks 3-5): MVP Core Loop**
- PR-05 through PR-12: Agent Core, Claude Adapter, tools (file/terminal/git), approval center, checkpoint/rollback, audit

**Phase 2 (Weeks 6-8): Stability**
- PR-13 through PR-15: Task recovery, policy engine, E2E tests

**Phase 3 (Weeks 9-12): Beta Release**
- PR-16 through PR-18: PR assistance, packaging, documentation

## Conventions

**Commit Messages:**
- `docs: ...` for documentation changes
- `feat: ...` for new features
- `fix: ...` for bug fixes

**Naming:**
- Docs: kebab-case (e.g., `phase-1-execution-plan.md`)
- TypeScript: PascalCase for types/classes, camelCase for functions/variables

**Documentation Style:**
- Use clear ATX headings (`##`, `###`)
- Prefer consistent terminology from PROJECT_DESIGN_FINAL.md
- Keep edits focused; avoid mixing roadmap changes with wording cleanups

## Security & Safety Constraints

When implementing code (especially PR-07 through PR-10):
- File writes must be restricted to workspace root directory
- Command execution defaults to deny; requires allowlist + approval
- Network access defaults to closed; whitelist-only
- High-risk operations require explicit confirmation: `rm -rf`, `git push --force`, external script execution
- API keys must use OS Keychain (macOS Keychain / Windows Credential Manager)
- All tool calls and approvals must be auditable
