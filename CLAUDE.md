# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a desktop AI coding workbench (桌面版 AI Coding 应用). The project is currently in Phase 0 (foundation) with implementation planned across a 12-week milestone schedule.

**Current Status:** PR-01 (Monorepo baseline) implemented - see branch `feat/pr-01-monorepo-baseline`

**Key Documents:**
- `docs/PROJECT_DESIGN_FINAL.md`: Source of truth for product scope, architecture, and milestones
- `docs/pr-implementation-plan.md`: PR-sliced implementation plan with 18 sequenced PRs
- `AGENTS.md`: General contributor guidelines

## Monorepo Structure

```
.
├── apps/
│   └── desktop/          # Electron + React + TypeScript + Vite
├── packages/
│   ├── agent-core/       # Task state machine, session orchestration
│   ├── toolkit/          # Tool execution layer (file, terminal, git)
│   ├── policy-engine/    # Permission rules and approval workflows
│   ├── storage/          # SQLite + Drizzle ORM for persistence
│   └── runtime-adapters/
│       └── claude/       # Claude SDK adapter
└── docs/                 # Project documentation
```

**Key Technical Decisions:**
- Single Runtime Provider: Claude Code SDK only (no Codex/other providers in MVP)
- Local-first: SQLite storage, OS Keychain for secrets
- Security-first: Default deny for commands, approval workflows for高危操作

## Development Commands

**Prerequisites:**
- Node.js >= 22.0.0
- pnpm 10.5.0+ (matching `packageManager` field)

**Setup:**
```bash
# Install dependencies
pnpm install
```

**Development:**
```bash
# Start desktop app in development mode
pnpm dev

# Build all packages
pnpm build

# Run tests
pnpm test

# Type check
pnpm typecheck

# Clean build outputs
pnpm clean
```

**Package-specific commands:**
```bash
# Build specific package
pnpm --filter @lynae/desktop build
pnpm --filter @lynae/agent-core build

# Dev mode for specific package
pnpm --filter @lynae/agent-core dev
```

**Workspace verification:**
```bash
# List all workspace packages
pnpm recursive list --depth=0

# Check workspace graph
pnpm ls -r --depth=0
```

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
