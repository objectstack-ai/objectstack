---
"@objectstack/driver-sql": patch
"@objectstack/objectql": patch
"@objectstack/spec": patch
---

Fix JSON-field writes on Postgres deployments that manage DDL out-of-band
(`skipSchemaSync` / `OS_SKIP_SCHEMA_SYNC=1`): a non-empty array and a bare
string were rejected with a 500, and an empty array was **silently stored as an
empty object** (#10995).

The SQL driver does `JSON.stringify` a JSON field's value on every non-SQLite
dialect — but only for fields listed in its per-object `jsonFields` registry,
and that registry (like the boolean / numeric / date / datetime / time /
auto_number registries and the tenant-isolation column) was filled **only** as
the first step of a DDL call. A deployment that skips boot schema sync therefore
served every write knowing nothing about its objects, and values reached
node-postgres to be encoded by its per-type defaults:

- an **object** became JSON text — accidentally correct;
- an **array** became a Postgres ARRAY LITERAL (`{…}`) — `22P02 invalid input
  syntax for type json`, a 500 on every write;
- **except `[]`**, whose array literal `{}` is valid JSON, so an empty array was
  accepted and stored as an empty **object** — corruption, not an error;
- a **bare string** was passed raw (`x` is not JSON text, `"x"` is) — a 500,
  while a number survived because `42` already is valid JSON.

SQLite never showed any of it: `formatInput` ends with a bind-safety net gated
on that dialect, so the same empty registry is invisible there — which is why
tenant environments on Turso/SQLite and the suites that run on them were blind
to a defect live on every Postgres deployment.

The registration is now separable from the DDL, on the ruling #7737/#10629
already made for federated objects — that flag is about DDL, and a binding that
is DDL-free must not ride on it:

- `SqlDriver.registerObjectMetadata(objects)` installs a managed object's
  coercion metadata with no `CREATE TABLE`, no `ALTER TABLE`, no existence probe
  and no round-trip — the managed sibling of `registerExternalObject`, declared
  optional on `IDataDriver` so drivers that don't need it omit it;
- a `skipSchemaSync` boot (and metadata reload) now takes that route instead of
  doing nothing, keeping the cold-start budget the flag exists to protect;
- `initObjects` registers before the ADR-0015 DDL gate refuses, so objects on a
  datasource ObjectStack is only a guest in are encoded from their declared
  field types too. The refusal itself is unchanged.
