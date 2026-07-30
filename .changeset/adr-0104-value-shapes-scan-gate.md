---
"@objectstack/spec": minor
"@objectstack/objectql": minor
"@objectstack/cli": minor
---

feat(migrate): `os migrate value-shapes` — the per-deployment gate for reference and structured-JSON value shapes (#3438)

The second of ADR-0104 D1's two evidence gates. Media value shapes already
enforce once a deployment has verified its file migration (#3681); the
reference (`lookup` / `master_detail` / `user` / `tree`) and structured-JSON
(`location` / `address` / `composite` / `repeater` / `record` / `vector`)
classes now get a gate of their own.

```bash
os migrate value-shapes           # scan: reports, writes nothing
os migrate value-shapes --apply   # scan + record the deployment flag when clean
```

The run walks every stored value of those classes against
`valueSchemaFor(field, 'stored')` — the same predicate the write path enforces,
imported rather than re-derived — and, at zero violations, records
`sys_migration { id: 'adr-0104-value-shapes', verified_at, blocking: 0 }`.
Strict enforcement of these classes reads **that row**, never the platform
version, so upgrading changes nothing until a deployment produces its own
evidence.

**There is no backfill, deliberately.** The file migration converts legacy
values because the platform narrowed that storage form and owes the conversion.
A malformed `location` is application data whose correct value only its author
knows, so this run reports and prescribes — naming the object, field, type,
count, offending record ids and the parse issue — and the operator fixes and
re-runs. With nothing to convert, `--apply`'s only write is the flag row, which
keeps the #3617 invariant trivially: a dry run changes nothing, and whether a
run changed this deployment's posture never depends on what it found.

**A separate flag from the file migration**, because it attests a separate
fact. That flag says file values were migrated and their ownership reconciled;
it says nothing about whether a `lookup` id or a `location` payload is well
formed. Gating these classes on it would be borrowing evidence for a fact it
does not cover.

- New escape hatch **`OS_ALLOW_LAX_VALUE_SHAPES=1`** returns a verified
  deployment to warnings, with the same precedence as its media sibling: the
  opt-out beats `OS_DATA_VALUE_SHAPE_STRICT_ENABLED`, which beats the flag.
  Wrongly staying lenient costs a warning; wrongly enforcing stops a working
  app from writing.
- `@objectstack/spec/system` exports `VALUE_SHAPES_MIGRATION_ID`.
- `@objectstack/objectql` exports `scanValueShapes`, `valueShapeScanPassed`
  and `formatValueShapeScanReport`. The scanner is read-only and does **not**
  record the flag: readers of a migration flag use the spec contract, only
  writers depend on `@objectstack/platform-objects`, so the composition lives
  with the CLI command rather than inverting the engine's dependencies.
- `validateRecord` gains `valueShapeStrict`, the sibling of
  `mediaValueShapeStrict`. Both default to `false`: a caller that cannot say
  stays lenient, so nothing starts rejecting merely because the evidence was
  unavailable.

**Nothing changes for an existing deployment until it runs the command.** A
scan that is truncated, or that cannot read an object, fails the gate even with
zero violations found — "none in the part we read" is not the claim the flag
makes.
