---
description: Security checklist and escalation for workflow reviews.
alwaysApply: true
---

# Security review behavior

- Treat authn/z, data exposure, injection, secrets, dependency risk, and unsafe shell/file use as in-scope for every candidate.
- Block or flag **blocking** issues before PR creation when config requires it; major findings need fix or documented human waiver.
- Use configured audit commands (e.g. `security.dependencyAuditCommand`) when present.
- Never commit secret-like values; call out suspected credentials for rotation.
