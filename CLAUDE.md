# Claude Fast Start

Use `AGENTS.md` as the shared startup contract for this project. It is intentionally short so Claude and Codex both avoid reading the long PRD/doctrine/council files unless the task needs them.

Default flow:

1. Read `AGENTS.md`.
2. Read only the relevant section of `IMPLEMENTATION_PLAN.md`.
3. Inspect the specific files needed for the task.
4. Run `npx tsc --noEmit` after code edits.
