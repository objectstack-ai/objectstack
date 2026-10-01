---
'@objectstack/spec': minor
---

feat(spec): writing a retired key now fails `tsc` with an error that says the key was retired and where its migration is printed (#20621)

Clause-②: yes

<!-- adr-0087: not-required (no-migration-prescription) this changes only the declared TypeScript type of every `retiredKey()` tombstone, from `undefined` to an uninhabited mark carrying the retirement sentence, on both the input and the parsed side. No authorable key, spelling, export or stored shape moves: the parse, its prescription, the JSON schemas and the authorable surface are unchanged. Every tombstoned key's own retirement is already ledgered under its own ADR-0087 id, and this diff retires nothing new, so `objectstack migrate meta` has nothing to rewrite. The body carries no migration prescription. The only party affected is a TypeScript consumer that reads a tombstoned key into a typed slot, and the compiler shows that consumer the dead read at its own call site. The other categories are closed on facts: the package publishes (not `unpublished`); no ADR-0087 id covers this type mark and this diff adds none (not `registered` / `already-registered`); `retiredKey` is referenced in code at 287 sites (not `runtime-interface-only`); and the diff touches `packages/spec` (not `type-surface-only`). -->

**What an author sees.** Every key a `retiredKey()` tombstone declares used to be typed `undefined`, so writing one failed `tsc` with an error that named no retirement:

```
error TS2322: Type 'string[]' is not assignable to type 'undefined'.
```

Upgrading authors read those errors as typing bugs. The same line now fails like this, for arrays, objects and primitive values alike:

```
error TS2741: Property ''[REMOVED] Key retired: run `os validate` for its migration.'' is missing in type 'string[]' but required in type '{ '[REMOVED] Key retired: run `os validate` for its migration.': never; }'.
error TS2322: Type 'string' is not assignable to type '{ '[REMOVED] Key retired: run `os validate` for its migration.': never; }'.
```

A hover on the key shows the same text. `os validate` and the parse print the key's own prescription, which says what replaced the key and gives the one-line fix.

**What changed.** The declared type of each tombstoned key, on both the input side (`z.input`, the bare `X` aliases) and the parsed side (`z.infer`, the `XParsed` aliases), is now `` { '[REMOVED] Key retired: run `os validate` for its migration.': never } | undefined `` instead of `undefined`. No value can have that object type, because its one property is typed `never`. So `tsc` still accepts only absence, as before. Both sides carry the same type, which keeps the ADR-0122 isomorphism pins true.

**What did not change.** Runtime behaviour is the same. Each tombstone is still `z.never().optional()`. The parse error and its prescription, the text `os validate` prints, the ADR-0087 conversions, the JSON schemas and the authorable-surface artifacts are all unchanged. No export was added or removed.

**BREAKING**: a read of a tombstoned key into a slot typed `undefined`, or typed with the key's old type, no longer compiles, because the key's declared type is now its tombstone mark. The key never holds a value, so delete the dead read. It ships as `minor` under the launch-window convention.

**Who might notice.** Code that assigns a tombstoned key's value to a slot typed exactly `undefined` (for example `const x: undefined = page.assignedProfiles`) no longer compiles. The key never holds a value, so delete the read. The published declaration files are about 7.5% larger, because the declaration emitter writes the type out at every site of the 287 `retiredKey()` calls.
