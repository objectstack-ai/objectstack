---
"@objectstack/plugin-audit": patch
"@objectstack/plugin-security": patch
---

fix(plugin-audit,plugin-security): declare sourced bounds on the four keyed text columns that break MySQL schema-sync (#12059)

Four text columns that a declared index keys on carried no `maxLength`, so
`driver-sql` emitted them `TEXT`. MySQL refuses a TEXT/BLOB column in a key
without a key length (`ER_BLOB_KEY_WITHOUT_LENGTH`): `CREATE TABLE` succeeds,
`ALTER TABLE … ADD INDEX` fails, and the object lands registered-but-broken
with its declared index silently absent.

| Object | Column | Bound | Producer the bound is derived from |
|---|---|---|---|
| `sys_activity` | `record_id` | 255 | the physical `id` column — `driver-sql` creates every primary key as `table.string('id').primary()`, knex's `varchar(255)` |
| `sys_audit_log` | `record_id` | 255 | same |
| `sys_audience_binding_suggestion` | `package_id` | 255 | `sys_permission_set.package_id` (255), which the same boot pass writes the same value into |
| `sys_audience_binding_suggestion` | `permission_set_name` | 100 | `sys_permission_set.name` (100), the column this value resolves against at confirm time |

Each bound is derived from a **named producer** and stated in the declaration
so it is vetoable in review (#11374 route A; PR #12058 is the worked
precedent). None of them narrows anything storable:

- a record id cannot exceed the `varchar(255)` column the id itself lives in,
  and the `referenceVia` seed path refuses an unresolvable pointer rather than
  storing a natural key verbatim;
- a permission set name longer than 100 is already refused at the write seam
  today — measured on a real engine, `ValidationError: API Name must be ≤ 100
  characters (got 101)` — so no set with such a name can exist, and a
  suggestion naming one could never be confirmed.

Measured at the driver level, shipped declaration vs. the same declaration with
the bounds stripped: `record_id`, `package_id` and `permission_set_name` move
`TEXT` → `varchar(255)` / `varchar(100)`, while `id` reads `varchar(255)` in
both — the transitivity premise, read off a real table rather than assumed.

Existing deployments are not rewritten: a physical `TEXT` column is deliberately
not diffed against `maxLength` (#11431), so no `ALTER` is planned and no value
at rest is truncated. The repair takes effect where the decision is makeable at
all — at `CREATE TABLE` — because no dialect turns a TEXT column into a keyable
one afterwards.

Each plugin also gains a keyed-text-bounds pin driven through its **own
registration path** (`init()` → the manifest `register({ objects })` call),
rather than a hand-written object list: the platform-objects pin enumerates only
that package's exports, which is exactly why these four columns escaped route
A's sweep after ADR-0029 K2 moved the objects out.
