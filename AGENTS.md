# Repository Guidelines

## Project Structure & Module Organization
This repository is currently documentation-first.
- `docs/PROJECT_DESIGN_FINAL.md`: source of truth for product scope, architecture, milestones, and security baseline.
- `LICENSE`: project license.

When implementation starts, follow the planned monorepo layout in the design doc (`apps/desktop`, `packages/agent-core`, `packages/toolkit`, etc.). Keep design and planning material under `docs/` with explicit names such as `phase-1-execution-plan.md`.

## Build, Test, and Development Commands
No build/test pipeline is committed yet. Use lightweight checks while contributing docs:
- `ls docs` to inspect available documentation.
- `sed -n '1,120p' docs/PROJECT_DESIGN_FINAL.md` to review key sections quickly.
- `rg "TODO|FIXME" docs` to find unresolved items.

If you add runnable code, include root-level scripts in the same PR and update this guide with exact commands (for example, local run, lint, test).

## Coding Style & Naming Conventions
For current Markdown contributions:
- Use clear ATX headings (`##`, `###`) and short, actionable sections.
- Prefer consistent terminology already defined in `PROJECT_DESIGN_FINAL.md` (for example, Runtime Adapter, Policy Engine, approval flow).
- Keep edits focused; avoid mixing roadmap changes with unrelated wording cleanups.

Naming:
- Docs: descriptive kebab-case or established uppercase naming (for example, `phase-2-risk-log.md`, `PROJECT_DESIGN_FINAL.md`).
- Future TypeScript code: `PascalCase` for types/classes, `camelCase` for functions/variables.

## Testing Guidelines
Automated tests are not configured in this repository yet.
- Validate Markdown rendering and heading structure before opening a PR.
- Re-check consistency against `docs/PROJECT_DESIGN_FINAL.md` for architecture or scope edits.

Once test tooling exists, require tests for behavior changes and document coverage expectations here.

## Commit & Pull Request Guidelines
Use concise, typed commit messages consistent with history:
- `docs: add ...`
- `feat: ...`
- `fix: ...`

PRs should include:
- A short summary of what changed and why.
- Linked issue/task when available.
- Screenshots only when UI changes are introduced.
- Clear follow-up items for deferred work.
