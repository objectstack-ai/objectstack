---
"@objectstack/spec": patch
---

Liveness ledger: a permission set's row-level security policy `label` and `description` (`rowLevelSecurity[].label` / `.description`) are now `live`, not `dead`. Studio's permission editor shows both on every policy. Ledger data and its generated count shard only.

Clause-②: no

- **What shows them.** These are display keys, so under the ledger's "Designer previews count as consumers" ruling, being shown to a human is the whole of their claimed effect. The Row-Level Security section of the permission editor (`PermissionAdvancedFacets` in objectui) now heads each policy card with the policy's `label` and, beneath it, its `description`, exactly as written. Both rows cite that reader at the `.objectui-sha` pin `89cad75d557`. The registered permission preview also draws both, but no route mounts it for `permission`, so it is not cited.
- **Where the values come from.** Each row names its producer: the `permission` edit page registration and the Studio edit route that mounts it, the editor's `GET /api/v1/meta/permission/:name/layers` read, and this repo's shared layered answer (`createMetaLayeredAnswer`), which serves a permission set whole. The showcase's contributor permission set authors both keys on all three of its policies.
- **Author-facing effect.** `os lint` / `os validate` no longer warn `liveness-dead-property` on a policy that sets `label` or `description`. A warning is not a refusal, so the accept set is unchanged.
- **Still kept.** The re-grade reverses no ADR-0033 decision. Both rows stay docs-shaped annotation, deliberately kept and not `authorWarn`'d.
- The regenerated liveness count is the `liveness/state-counts/permission.md` shard: `permission` has 38 live and 4 dead (was 36 and 6). The `view` container's own `label` stays `dead`.
- ⛔ No schema, parse, `.describe()`, export or accept-set change.
