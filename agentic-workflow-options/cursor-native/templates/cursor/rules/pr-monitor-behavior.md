---
description: Post-PR monitoring—poll, classify, auto-fix only when safe.
alwaysApply: true
---

# PR monitor behavior

- Classify PR feedback and CI failures: clear fix vs product/architecture ambiguity vs security sensitivity.
- When `prMonitor` allows, apply **clear** fixes locally (lint, obvious test failures); avoid behavioral changes without approval if configured.
- Re-run relevant verification after fixes; push follow-up commits and keep PR description/threads accurate.
- Stop or hand off when limits, merge, close, or human override applies.
