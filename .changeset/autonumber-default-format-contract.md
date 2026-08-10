---
"@objectstack/spec": minor
---

feat(spec): declare `{0000}` as the contract default for a format-less autonumber field (#6555)

`FieldSchema.autonumberFormat` is optional, and the two sides that mint record
numbers each answered "no format declared" on their own — differently.
`driver-sql` substituted `'{0000}'` and issued `0001`, `0002`, …; the ObjectQL
engine's in-memory fallback path (taken whenever a driver does not advertise
`supports.autonumber`) parsed the empty string and fell through
`renderAutonumber`'s no-slot branch to a bare `1`, `2`, …. One metadata
document, two number shapes: a suite asserting `'1'` against the memory driver
did not hold in production on SQL, and an object's historical numbers changed
shape at a driver switch. Both sides always agreed on the counter VALUE — #6468
pinned that — the fork was purely in rendering width.

Per the maintainer's 2026-08-08 ruling on #6555 the default now lives in the
contract instead of in either fallback:

- **`DEFAULT_AUTONUMBER_FORMAT`** (`'{0000}'`) — a new export from
  `@objectstack/spec/data`, beside `renderAutonumber`. The one place the value
  is written down.
- **`resolveAutonumberFormat(field)`** — a new export: the canonical
  `autonumberFormat`, then the `format` shorthand (#1603), then the declared
  default. A key holding anything but a non-empty string counts as undeclared,
  which is the SQL driver's long-standing truthiness rule — the engine used
  `??` and the two also disagreed on `format: ''`.
- **`FieldSchema.autonumberFormat`** now declares the default to schema
  consumers as a JSON-Schema `default` annotation. Deliberately an annotation
  and not a Zod `.default()`: the key is flat on `FieldSchema` and shared by all
  field types, so a parse-time default would materialize
  `autonumberFormat: '{0000}'` on every `text`, `number` and `lookup` field
  parsed anywhere. Parse output is unchanged for every field type.

Compatibility: choosing {0000} keeps stored driver-sql data undisturbed;
engine-fallback deployments flip from bare 1 to 0001 for newly issued numbers.
Counter continuity itself is unaffected (#6468 pinned it).

This is the contract half only. The two generators still carry their own
fallbacks and are unchanged by this release; removing them — engine
`applyAutonumbers` and `driver-sql`'s two `|| '{0000}'` sites, both reading the
declared default through `resolveAutonumberFormat` instead — follows in separate
changes, so nothing about today's rendering moves yet.
