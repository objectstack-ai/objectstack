---
"@objectstack/service-storage": minor
---

fix(service-storage): stamp `sys_file` with the acting organization, and backfill the rows that were never stamped (#12745)

`sys_file` is a tenancy-ENABLED object — it declares no `tenancy` key, so
`isTenancyDisabled()` reads `false` and `applySystemFields` provisions
`organization_id` on it. Nothing ever wrote that column:
`StorageMetadataStore.createFile` inserted with **no execution context at all**
(the string `context` appeared 0 times in `metadata-store.ts`), so the SQL
driver's `injectTenantOnInsert` had no `tenantId` to stamp from and every row
landed NULL. Both callers already held the session — `storage-routes.ts` reads
`owner_id: session?.userId` ten lines below each `createFile` — so the
organization was in hand and simply had nowhere in the signature to go.

Maintainer ruling 2026-08-28 on #12745: **A with backfill** — stamp forward AND
repair the existing rows. Both halves ship here.

**Forward stamping.** `createFile(rec, context?)` takes a new optional
`StorageWriteContext` (`{ organizationId }`) and passes it to the engine as
`{ context: { tenantId } }`. The column is deliberately NOT written onto the
payload: whether the object has a tenant column, and whether an explicit value
on the row wins, are the driver's answers (`injectTenantOnInsert` →
`resolveTenantField`), and a metadata store re-deciding them one package away
from the schema is how a stamp starts failing on installs that opted the object
out. Both upload doors thread the session's active organization, and the
plugin's session bridge now reports it (`session.session.activeOrganizationId`,
the platform's existing spelling). ⛔ No membership fallback: here the value
becomes a *wall*, and a file stamped from a guessed membership is a file its
uploader can no longer see from the organization they were acting in. A session
with no active organization stamps nothing, exactly as before.

**Why the backfill is not optional.** The SQL driver's tenant predicate is
NULL-tolerant (`organization_id = :tenant OR organization_id IS NULL`), but
Layer 0 AND-composes a strict `organization_id = <active org>` above it and
"the conjunction is the strict equality alone". Forward-only stamping would
therefore split the table: new files org-walled, every existing NULL-org file
invisible to **every** principal. (`single` posture is inert —
`computeTenantLayer0Filter` returns `null` — so single-tenant installs are
unaffected either way.)

**The backfill.** A one-off, idempotent, dry-run-first sweep
(`backfill-sys-file-organizations.ts`), following the tree's own precedent in
`plugin-approvals`. It derives each row's organization from the file's HOLDERS —
the exclusive field reference (`ref_object`/`ref_id`) and every `sys_attachment`
join row — and stamps **only where they all answered and all answered the same
organization**. ⛔ Rows that cannot be derived unambiguously stay NULL and are
REPORTED, never guessed, with the residual-NULL count and its per-reason
breakdown on the report and in the rendered text — for the dry run as well as
the applied run. It is a one-off operational module: not exported from the
package index and not shipped in `dist`.

⛔ Scope: `sys_file` only. The precedent requires a maintainer order per table
and the ruling is that order for this one table — `sys_upload_session` sits in
the same package with the same NULL column and is deliberately not swept.

**Compatibility.** `createFile`'s new parameter is optional and
`StorageRoutesOptions.resolveSession` only WIDENS its return type
(`{ userId? }` → `{ userId?, organizationId? }`), so existing resolvers and
callers keep compiling and keep their current behaviour.
