# LangGraph local orchestrator (skeleton)

Python CLI for the workflow described in `docs/plan.md`.

## Setup

```bash
cd agentic-workflow-options/langgraph-local-orchestrator
python3 -m venv .venv && source .venv/bin/activate
pip install -e .
orchestrator --help
```

## Status

Implementation phases are tracked in `PROGRESS.md`. This package provides Phase 1 scaffolding: config, SQLite-oriented store modules, LangGraph graph stubs, artifact helpers.
