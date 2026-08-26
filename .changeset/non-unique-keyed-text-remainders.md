---
'@objectstack/platform-objects': minor
---

Make the last two non-unique keyed text indexes expressible on MySQL — remove one,
narrow one

`driver-sql` emits a keyed text-family column as `varchar(maxLength)` only when the
declared bound is one MySQL can key (768 characters on utf8mb4, the 3072-byte key-part
ceiling); otherwise the column stays `TEXT`, MySQL refuses it as an index key
(`ER_BLOB_KEY_WITHOUT_LENGTH`), and the object's whole `syncSchema` fails — it lands
registered with its declared index absent. #11374 declared sourced bounds for thirteen
such columns and #11627 carried the over-long UNIQUE ones on a SHA-256 hash-shadow
column, taking live MySQL 8.0.46 from 12/44 → 8/44 → 2/44 failing objects.

The two that remained are **non-unique**, and a hash shadow structurally cannot serve
them: a UNIQUE constraint is an equality-only predicate that survives hashing exactly,
but a non-unique index exists for an access path, and an index over a digest
accelerates no `WHERE col = ?` the planner can reach without rewriting the read side.
They are ruled separately (maintainer, 2026-08-25) because they are different problems:

- **`sys_verification.value` — the declared index is removed.** The column is
  genuinely unboundable (better-auth's oauth-provider writes OIDC authorization-code
  payloads there as a JSON blob), and the index was measured dead: better-auth 1.7.1
  keys every verification lookup on `identifier`, `id` or `expiresAt`
  (`internal-adapter.mjs`), upstream declares the field unindexed and unbounded, and no
  in-repo query filters `sys_verification` by `value`. An index that silently does not
  exist on one dialect is the worst of both worlds; removing it makes the metadata match
  reality.
- **`sys_oauth_client_resource.resource_id` — the declared bound narrows 1024 → 768.**
  This one is a live access path (the FK side of `sys_oauth_resource.identifier`, read
  as a predicate by upstream's client-registration collision path), so it keeps its
  index and becomes keyable instead. 768 is the widest utf8mb4 value a MySQL key part
  holds, and the smallest narrowing that works.

This is an enforcement change on published objects — hence the minor grade. On MySQL and
SQL Server a `resource_id` longer than 768 characters is now refused rather than stored,
and on PostgreSQL and SQLite the `sys_verification` `[value]` index is dropped on the
next schema sync (on MySQL it never existed). Neither narrows what the producing
contract can emit: the value is an RFC 8707 resource-indicator URI, and upstream
better-auth 1.7.1 stores that same identifier as `varchar(255)` on MySQL
(`get-migration.mjs`) and this referring column as `varchar(36)`, so a resource whose
identifier exceeded 768 characters could never have been registered upstream at all.

The pin that enumerated the package for unbounded keyed text columns now also rejects a
non-unique index over any text column MySQL cannot key, so a third member of the class
fails at test time rather than on a live server. Its `UNBOUNDABLE` allowlist — which
existed to excuse `sys_verification.value` — is empty as a result, and a synthetic
control keeps the excusing branch exercised rather than letting it rot.
