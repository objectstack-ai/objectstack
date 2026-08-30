---
"@objectstack/driver-memory": minor
---

fix(driver-memory): enforce object-level declared `indexes[]` uniqueness, so a colliding composite write is refused instead of landing silently (#13239)

`driver-sql` materializes uniqueness from **two** declaration surfaces —
field-level `unique` (`uniqueIndexesFromFields`) and object-level `indexes[]`
entries carrying `unique` (`normalizeDeclaredIndex`). #13197 closed the first
one here. The second was still **declared and not enforced**: an object
declaring

```json
{ "indexes": [{ "fields": ["account_id", "code"], "unique": "organization" }] }
```

got a real composite UNIQUE on the SQL family and **nothing at all** in memory —
the colliding write landed and a read returned both rows. That is the same
ADR-0078 / Prime-Directive-#10 shape, one surface over.

**⚠️ Bare `true` means the OPPOSITE on the two surfaces, and this reproduces the
disagreement rather than smoothing it.** At field level `unique: true` is the
positional spelling of `'organization'`; on a declared index it is the
positional spelling of `'global'` — the listed columns VERBATIM, no organization
key part. That is the #4986 trap, it is deliberate (the #8323 maintainer ruling
of 2026-08-13 rejected routing the declared-index branch through the field-level
predicate, because it would silently reinterpret every deployed declared
`unique: true` as organization-scoped), and it is staged for retirement at
protocol 18 by #5082. So the scope test on this surface is the strict
`unique === 'organization'`, exactly as `normalizeDeclaredIndex` does it, and
`memory-declared-index-unique.test.ts` holds both readings side by side on one
object so a future edit cannot move one without moving the other.

`normalizeDeclaredIndex`'s arms are reproduced — not imported: `driver-memory`
must not depend on `driver-sql`, the same reason `computeTenantField` was
reproduced for #13197.

- `unique: true` / `'global'` → the listed columns verbatim.
- `unique: 'organization'` with a tenant column → the organization key part is
  prepended (and is NOT prepended twice when the author already listed it — its
  own key part goes NULL-safe instead, order preserved).
- `unique: 'organization'` with no tenant column → degrades to the listed
  columns alone.
- `unique` absent / `false`, or an entry with no usable `fields` → not a
  constraint.

**NULL handling was measured against SQLite, not assumed.** A NULL in any listed
key column exempts the row (SQL `UNIQUE` is NULL-distinct), while a NULL
ORGANIZATION folds onto one bucket, because ADR-0120 D3 materializes that key
part as `COALESCE(organization_id, '__global__')` — an expression that is never
NULL. Both halves hold here through one key model shared with the field surface,
so there is exactly one NULL rule in the package.

**The refusal** is the field surface's envelope — `code: 'UNIQUE_VIOLATION'`,
`status: 409`, no `[driver-memory]` prefix — stamped in one place for both
surfaces. It names the key COLUMNS and carries no index name, so
`uniqueViolationColumn` answers `undefined`: the same answer `driver-sql` gives
for a composite, and the safe one under the #6544 ruling that an identifier
mistaken for a column is worse than no answer.

**Why `minor` rather than `patch`:** this refuses writes that previously
succeeded, and the blast radius was measured rather than assumed. 57 in-repo
production/metadata declaration sites carry a `unique` `indexes[]` entry —
`sys_user`, `sys_session`, `sys_setting`, `sys_metadata`, `sys_member`,
`sys_team_member` and most of the identity surface among them — so any stack
served by `InMemoryDriver` newly enforces constraints the SQL family already
enforced. Every one of those refusals is a write SQL would have refused too, and
existing rows are never retroactively refused (a declaration arriving over
`initialData` is recorded, not applied backwards), but a dev or demo stack that
relied on the store accepting a duplicate will now see a 409.
