---
"@objectstack/plugin-security": patch
---

**Message change (no behaviour change):** a data-plane read against an object that exists only as an **unpublished draft** now says so, instead of reporting an internal security step (#10401).

The refusal itself is unchanged and stays fail-closed (#3545): same `PermissionDeniedError`, same `PERMISSION_DENIED` code, same HTTP 403, same `[Security] Access denied` prefix — which is a **matcher** the transports read as "this is a 403", not house style. Nothing here widens access, and no access decision branches on the new information.

What changed is what the refusal *says*. One sentence — "the security posture of object 'X' could not be resolved for operation 'find'" — covered two conditions with two different remedies, and described neither: because it named a *security* step, every reader took it for a permissions problem and went looking for a sharing rule to change. Measured downstream (objectstack-ai/cloud#1481): an end-user AI turn asked "how many customers do I have?" against a draft-only object, spent seven tool calls oscillating between a metadata plane that said the object existed and this refusal, then told the user the object was "missing its sharing/visibility setting" — confident, professional, and wrong. On a free plan that one turn also exhausted the daily allowance.

The two conditions are now separated:

- **The object has a `sys_metadata` draft and no published row** → *"object 'X' is not published — a draft declaration exists but no published one … Publish the object to make it queryable. This is NOT a permissions problem …"*.
- **The declaration genuinely cannot be read** (never declared, or a metadata-store outage) → the pre-existing clause **verbatim**, so any surface matching `the security posture of object 'X' could not be resolved for operation 'Y'` keeps matching, followed by the remedy and the same explicit statement that permissions are not the lever.

Both sentences, and the operator log line beside them, are derived from one module (`unresolved-posture.ts`) shared with the explain engine's `object_crud` layer detail. Enforcement and explanation stating one refusal in two drifting wordings is the defect shape this closes, so the wording is a single source rather than two literals.

The discriminator comes from a **best-effort** `sys_metadata` probe that runs only on the path already refusing, reads under a system context (so it cannot re-enter the middleware), and fails safe in one direction only: any failure — no `sys_metadata` in the deployment, an unprovisioned store, a driver error — reports the both-conditions wording rather than a claim. A posture that resolves never probes at all.
