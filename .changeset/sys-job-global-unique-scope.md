---
"@objectstack/platform-objects": patch
---

State `sys_job`'s uniqueness boundary explicitly: `unique: 'global'` on the declared `(name)` index, and correct the `name` field's description (#8578)

The declared index carried the bare `unique: true` spelling, which ADR-0120 D1 defines as the deprecated positional spelling of `'global'` — the listed columns verbatim. Because `sys_job` also carries a kernel-injected `organization_id`, the tenancy sweep could not tell that shape apart from the #8323 cross-tenant-oracle class, and the field's description published a boundary-free "Unique job identifier" claim that left the question open in the generated reference.

The reading settles it in the `'global'` direction: nothing writes `sys_job` per organization. `DbJobAdapter` is the sole writer and upserts under a SYSTEM context, locating rows by `where: { name }` with no organization dimension; the `job` metadata type is closed to tenants on all three flags (`allowOrgOverride: false` — "no per-org job fork" — plus `allowRuntimeCreate: false` and `supportsOverlay: false`); `enable.apiMethods` advertises no write verb at all (ADR-0103 engine-owned); and every `schedule()` call site is registration-time and installation-scoped. ADR-0120's own S5 inventory already names `sys_job.name` as one of the nine engine idempotency keys that are platform-wide by construction.

No migration and no drift: `'global'` **is** the semantics bare `true` already materialized, so the physical index is byte-identical (ADR-0120 D2). What changes is that the boundary is stated rather than inferred from position, and that the published description names it. The reading itself is pinned — the new test asserts the write paths that would have to open for the opposite verdict to become true, so a future per-organization job path fails loudly instead of silently invalidating the constraint.
