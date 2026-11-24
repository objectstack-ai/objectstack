---
'@objectstack/client': patch
---

fix(client): `client.approvals.reject` requires the decision and its `comment`

Clause-②: no (narrowing)
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) No spec key or authored value changes. What moves is the parameter type of one SDK method: the decision argument and its comment member become required, matching the approvals route, which now refuses a reject without a reason. No stored row changes, so there is nothing for a migration to rewrite. -->

**BREAKING** for TypeScript callers of `client.approvals.reject(requestId)` or `client.approvals.reject(requestId, { actorId })`: the decision argument and its `comment` are now required, so those calls no longer compile. At runtime the approvals route refuses a reject without a non-blank reason with `400 VALIDATION_ERROR`. It ships `patch` because it is a non-protocol breaking change (AGENTS.md Post-Task Checklist step 3). `client.approvals.approve` is unchanged; its comment stays optional.

Fix for a caller: pass the reason, `client.approvals.reject(requestId, { comment: 'Over budget.' })`.
