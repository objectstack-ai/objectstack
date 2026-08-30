---
'@objectstack/service-storage': minor
---

Scope the `sys_file` / `sys_upload_session` update and delete doors to the acting organization (#13178)

`StorageMetadataStore` issues eight engine calls. #12745 gave `createFile` an
execution context and #12928 gave `createSession` one, so both INSERTS carried
the acting organization — while their `update` and `delete` siblings, same two
tables and twenty lines apart, still passed none. The tenant-audit census
counted 175 service write call sites against a tenancy-enabled object, 24 of
them carrying no tenant context at all; these four were the un-repaired halves
of the two inserts already fixed, and the maintainer's ruling narrowed this
change to exactly them.

`updateFile`, `deleteFile`, `updateSession` and `deleteSession` now take the
same optional `StorageWriteContext` the two create doors take, and the upload
routes pass it — two of them had already resolved the session and were throwing
the value away.

What the context does here is NOT what it does on the insert, and the
difference is the point. Write-side tenancy in the SQL driver is two mechanisms
wearing one option: on insert `injectTenantOnInsert` STAMPS the tenant column
from `options.tenantId`, while on update and delete `applyTenantScope` SCOPES
the statement with it. So on these four doors the value buys reach rather than
a value:

- a row belonging to ANOTHER organization is no longer reachable through them
  on a walled deployment, and
- the `[tenant-audit]` warning these two verbs raise from the same
  `auditMissingTenant` call the create verb uses is silenced for the right
  reason — the write now carries its tenant — rather than suppressed.

Rows whose `organization_id` is NULL keep updating and deleting exactly as
before. That is deliberate and load-bearing rather than incidental: the driver's
tenant term is `(organization_id = :tenantId OR organization_id IS NULL)`, so
the entire pre-#12928 session population — which the ruling on that change
deliberately did not backfill, leaving it to the object's own TTL sweep — stays
in reach and no in-flight upload is stranded.

Graded `minor` rather than `patch` on two counts: the four exported store
methods gain a parameter callers can pass, and on a walled install the reach of
an existing call NARROWS. A behavioural narrowing on a tenant-isolation surface
is not a silent patch, even when the narrowing is the repair.

No class-level control is added here. Whether `isSystem` writes belong inside
this control scope at all is an open design question and is not answered by this
change; the guard order inside `auditMissingTenant` is untouched.
