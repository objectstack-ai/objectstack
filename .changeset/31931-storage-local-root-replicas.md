---
'@objectstack/service-storage': patch
---

feat(service-storage)!: a declared multi-replica boot on a local storage root refuses unless the root is declared shared

Clause-②: yes (narrowing) — a new operator variable, `OS_STORAGE_LOCAL_ROOT_SHARED`, is read; and a deployment that declares several replicas over the redis cluster driver and keeps the local storage adapter, which booted before, is now refused unless it sets that variable.
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) No key of any schema is added, removed, renamed or re-shaped, and no export or type of the package root changes: the new variable is deployment environment only, never a settings row or a spec key, and the refusal is a boot failure with a message, not a wire error code. Nothing at rest records the answer, so there is nothing for a migration to rewrite and no tombstone. -->

**BREAKING**, for one deployment shape only: several replicas declared (`OS_EXPECT_MULTI_NODE=true` or `OS_CLUSTER_REPLICAS` greater than 1) over the redis cluster driver, with file storage on the local adapter. Each replica wrote uploads to its own disk there, so a file uploaded through one replica was missing on the others while every replica looked healthy. That boot is now refused, and a storage settings change that would switch such a deployment onto the local adapter is not applied (it logs an error and the current adapter keeps serving).

What to do, one of:

- Use S3: `OS_STORAGE_ADAPTER=s3` with `OS_STORAGE_S3_BUCKET` and `OS_STORAGE_S3_REGION` (plus `OS_STORAGE_S3_ENDPOINT` / `OS_STORAGE_S3_ACCESS_KEY_ID` / `OS_STORAGE_S3_SECRET_ACCESS_KEY` as your store needs), or configure it in Setup → Settings → File Storage. A `ReadWriteOnce` volume, as on Kubernetes, cannot be shared, so S3 is the answer there.
- When every replica mounts the same volume at the local root (several Compose replicas on one host sharing a named volume), set `OS_STORAGE_LOCAL_ROOT_SHARED=true` on every replica. It is a declaration, not a check.

What does not change: a single node, a declaration over any other cluster driver, and the S3 adapter boot exactly as before.
