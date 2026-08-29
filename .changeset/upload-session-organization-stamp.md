---
"@objectstack/service-storage": patch
---

fix(service-storage): stamp `sys_upload_session.organization_id` from the acting session (#12928)

`StorageMetadataStore.createSession` inserted into `sys_upload_session` with no
execution context, so the SQL driver's `injectTenantOnInsert` had no `tenantId`
to stamp from and every chunked-upload session row landed with
`organization_id` NULL — on a tenancy-ENABLED object (the declaration carries no
`tenancy` key, so `applySystemFields` provisions the column unconditionally).
This is the `sys_upload_session` sibling of the `sys_file` gap fixed in #12745,
and the chunked-upload door already held the value: it threads the identical
`session?.organizationId` into the `createFile` immediately above.

`createSession` now takes the same optional `StorageWriteContext` as
`createFile` and hands the engine `{ context: { tenantId } }`, so the platform's
existing insert-side chokepoint decides the rest — whether the object has a
tenant column at all, and whether an explicit value on the row wins. A caller
with no organization passes no options and the row lands unstamped exactly as
before.

Maintainer ruling 2026-08-29, verbatim and untranslated: 「同意」 — forward stamp
only. There is deliberately **no backfill**: rows already NULL age out through
this object's own ADR-0057 TTL sweep. That premise is verified rather than
assumed — `sys-upload-session-ttl-sweep.test.ts` drives the shipped declaration
through the real `LifecycleService` against live SQL and pins that an expired
NULL-organization row is reaped, that a stamped row is reaped by the same
sweep, that a live session survives it, and that a run with no declaration reaps
nothing.

Why an unstamped row mattered even without a cross-tenant read: both walled
Layer 0 predicates are exclusive (`{ organization_id: <id> }` under `isolated`,
`{ $in: [...] }` under `group`), and neither matches NULL — so on a walled
deployment an unstamped session row was invisible to its own tenant, the same
silent-empty class `sys_api_key` was renamed to avoid.
