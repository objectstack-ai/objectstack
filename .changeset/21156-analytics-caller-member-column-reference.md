---
"@objectstack/service-analytics": patch
---

Clause-②: no

Security: refuse a caller-named analytics member that is neither a declared cube member nor a column reference at the query door, in every tier — including a deployment with no security service and an object the field-level read gate does not judge — so caller-supplied member text can no longer reach a native statement unjudged. The refusal reuses the existing field-read gate's envelope (`PERMISSION_DENIED` / 403); no new error code, and the declared-cube paths are unchanged.
