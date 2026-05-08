# Cursor SDK local orchestrator

TypeScript CLI scaffold for `docs/plan.md`. **Local runtime only** — `createLocalAgent` rejects `cloud` options.

## Setup

```bash
cd agentic-workflow-options/cursor-sdk-local-orchestrator
npm install
npm run build
```

## Commands

- `node dist/cli.js init [cwd]` — create `.orchestrator/runs/<id>/` with `state.json`
- `npm run dev -- sdk-smoke` — optional `Agent.prompt` test when `CURSOR_API_KEY` is set
- `npm run dev -- guard-demo` — assert cloud options are rejected

Phases: see `PROGRESS.md`.
