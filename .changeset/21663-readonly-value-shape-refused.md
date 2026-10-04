---
'@objectstack/objectql': minor
---

fix(objectql)!: a system write's readonly value is judged for its shape — a seed's `'yesterday'` on a readonly datetime is refused with the sentence any other field gets, never stored (#21663)

**BREAKING** — a write that keeps a readonly value now has that value's SHAPE
checked. The static readonly strip still exempts a system write (seed replay,
migration, `isSystem` plugin code, a `before*` hook's stamp) and still drops a
non-system caller's readonly value; what changed is that the value the
exemption keeps is no longer stored unjudged. Before, the record validator
skipped every readonly field, so under `isSystem` a malformed readonly value
reached the driver verbatim — a seed's `run_at: 'yesterday'` on a readonly
`datetime`, an unresolved `cel` envelope from a seeder that skips its
resolution, an authored `created_at` the seed now keeps — while the same value
on a non-readonly field was refused.

Now it is refused the same way: `VALIDATION_FAILED` (400 at an HTTP boundary),
the same field code and the same sentence a non-readonly field gets
(`Run At must be a valid datetime (ISO-8601)`), and a seed counts the row as a
seed error. This holds on insert, on the dry run (`ObjectQL.validate`), and on
both update paths, where the readonly values left after the strip are judged.

Which checks a readonly value reaches — its type's shape, never a constraint:

- refused: a `date` / `datetime` / `time` the platform does not read, a
  non-number on a number-typed field, a non-boolean on a boolean, a non-array on
  a multi-value field, a filter-operator object, and an ADR-0104 reference /
  media / structured-JSON shape under the object's own posture (warn-first, as
  on any other field, until the deployment's evidence enforces it);
- NOT checked, exactly as before: option membership, `maxLength` /
  `minLength`, `valueDomain`, `min` / `max` / `scale` / `precision`, the email /
  url / phone formats, and `required`. Option membership stays out on purpose:
  `sys_activity.type` is a readonly `select` whose options are the built-in set
  of an open vocabulary, and an author-contributed value there is stored.

A numeric string on a readonly number field is now written as its number, and a
lone scalar on a readonly multi-value field as a one-member list, as on any
other field — the door reads the value the same way it judges it.

**What moves for consumers.** A seed, migration or `isSystem` write that puts a
malformed value in a readonly field — or a hook that stamps one — is refused
where it was stored. Fix the value at its producer: write an ISO-8601 instant
(or a `Date`) into a readonly `datetime`, resolve a `cel` value before the
write, and stamp numbers and booleans as such. Rows already stored are never
re-read or rewritten. `validateRecord`, as exported, is unchanged: the readonly
scope is the engine write path's own.

Clause-②: no (narrowing)

<!-- adr-0087: not-required (no-migration-prescription) a write-time refusal of a malformed value in a readonly field, judged by the same per-type shape checks a non-readonly field already gets. No authorable key, spelling, export or stored shape moves: the field schema is unchanged, the published validateRecord signature is unchanged, no stored row is read or rewritten, and which value a producer meant to write is not something a ledger entry can rewrite. The other categories are closed on facts: the package publishes (not unpublished); no ADR-0087 id covers this behaviour (not already-registered); and the change is a write-path verdict, not a declaration (not runtime-interface-only or type-surface-only). -->
