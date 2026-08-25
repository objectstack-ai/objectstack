---
"@objectstack/spec": minor
---

**`MetadataProtocol` declares the optional `auditMetaItem` member, and the audit door's request/response schemas join the spec** (#11678 — the #11006 maintainer-ruled pattern, 2026-08-22 option B, carried one door over).

`GET /api/v1/meta/:type/:name/audit` — the ADR-0010 §3.6 compliance trail behind Studio's 审计日志 / Audit log tab — was a step behind the half-declared publish door #11006 adjudicated: **neither** side was declared (`auditMetaItem` appeared nowhere in `packages/spec`), so the REST door reached the verb through `(p as any)` twice (feature-detection guard + call) and its request literal was compiled against nothing.

Additive, not breaking:

- `AuditMetaItemRequestSchema` / `AuditMetaItemRequest` — `{ type, name, organizationId?: string | null, limit? }`, mirroring the implementation's parameter type in `@objectstack/metadata-protocol` member for member. `organizationId` is nullable because the REST door always sends it, possibly `null` (#8747's fail-closed tenant scoping: `null`/absent = env-wide rows only, never every tenant's). `limit` declares no bounds because the implementation clamps to [1, 500] rather than refusing. `environmentId` stays out by the #9741 ruling (transport-level routing key) — and on this door it is not even on the wire any more (#8747 removed it; the implementation never read it).
- `AuditMetaItemResponseSchema` / `AuditMetaItemResponse` — the `{ events: [...] }` body, newest first, with the closed `operation` (save/publish/rollback/delete/reset) and `outcome` (allowed/denied/forced) vocabularies and the ADR-0010 §3.3 `lockState`. The #9426 miss-vs-fault honesty is recorded in the declared types: `{ events: [] }` is the honest answer for a clean trail, a find-less host engine, or an unprovisioned audit table — never for a missing capability (501 before the call) and never for a failed read (propagated, not invented into an empty trail).
- `MetadataProtocol.auditMetaItem?(request: AuditMetaItemRequest): Promise<AuditMetaItemResponse>` — optional like its `deleteMetaItem` / `getMetaItemLayered` siblings: additive to a shipped contract, implementation predating declaration. An undeclared key in a request literal at the member's call shape is now a compile error.
