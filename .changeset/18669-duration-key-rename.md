---
"@objectstack/spec": minor
---

feat(spec)!: `FileValue.duration` and `CompatibilityMatrixEntry.estimatedMigrationTime` carry their unit in the key name (#18669, ruling A)

<!-- adr-0087: registered data-file-value-duration-unit-in-key, kernel-compatibility-matrix-estimated-migration-time-unit-in-key -->

**BREAKING** — two duration-shaped `z.number()` keys are renamed. No value type moves, no key is
removed from the contract, and nothing already stored is narrowed.

| def | before | after |
|:--|:--|:--|
| `data/FileValue` | `duration: 12` | `durationSeconds: 12` |
| `kernel/CompatibilityMatrixEntry` | `estimatedMigrationTime: 8` | `estimatedMigrationTimeHours: 8` |

Maintainer ruling A on #18669 (2026-09-17, decision batch #151 item 4): rename each key, with an
ADR-0087 conversion-layer entry each — ⛔ no new closed type, ⛔ no narrowing of stored data.

## Why each bare name was worth a rename

`FileValue.duration` declared its unit in **no channel at all** — no `.describe()`, no JSDoc, no
unit token in the key — so the published reference page printed a bare number and the authoring
site printed nothing. The company it kept is what makes it a trap rather than an omission: the
only other number on `FileValue` is `size`, a **byte** count, so the one member that measured
time was indistinguishable from a count at the site an author (very often a model, ADR-0033)
writes it.

`CompatibilityMatrixEntry.estimatedMigrationTime` said *"Estimated migration time in hours"* in a
source **JSDoc** and carried no `.describe()` — the #15939 shape, one def over. The JSDoc stops at
the source file; `.describe()` is what `content/docs/references/**` renders, so the published page
printed a bare number directly beside `migrationComplexity`, whose scale *is* named
(`trivial`/`simple`/`moderate`/`complex`/`major`). A reader comparing `major` with `40` could not
tell minutes from hours from days.

## What an author must change

Rename the key. **Nothing else** — both values keep the type they had.

```diff
  // an expanded file/image/avatar/video/audio value
  {
    url: 'https://cdn.example.com/files/clip.mp4',
-   duration: 12.34,
+   durationSeconds: 12.34,
  }

  // a plugin compatibility-matrix entry
  {
    from: '1.9.0', to: '2.0.0', compatibility: 'breaking-changes',
-   estimatedMigrationTime: 8,
+   estimatedMigrationTimeHours: 8,
  }
```

## Deliberately NOT narrowed

Both keys stay `z.number().optional()`. `durationSeconds: 12.34` still parses — a fractional
second is the ordinary shape of a media length — so the closed `DurationSeconds` type
(`z.number().int().nonnegative()`, #18122) was **refused** by the ruling, and so was a bare
`.int()`. `FileValue` is one of the six rows #18122 derived its unit set from; it is the one that
takes a **name** instead of a type. `estimatedMigrationTimeHours` keeps `hours` rather than
converting to seconds, for the same reason: the value does not move.

The hours key also gains `.describe('Estimated migration time in hours')`, and that half is not
cosmetic — renaming alone would leave the key name and a source comment agreeing about a unit the
published page does not print, which `check:duration-unit-keys` refuses as
`unit-in-jsdoc-not-in-describe` (ruled an offence 2026-09-18, decision batch #158 item 5, letter
A). `FileValue.durationSeconds` gains `.describe('Media duration in seconds')` for the same
reader.

## The kit

- a `retiredKey()` tombstone on each old spelling, so `tsc` types it `never` and a value reaching
  the parse raises the **rename prescription** instead of vanishing. Neither enclosing shape is
  `.strict()`: `CompatibilityMatrixEntrySchema` is a plain `z.object` and would have stripped the
  old spelling in silence, and `FileValueSchema` is the one deliberate `z.looseObject` in
  `field-value.zod.ts` and would have waved it through as an unrecognised extra
- two ADR-0087 D3 semantic entries and two `RETIRED_KEYS_BY_MAJOR[18]` rows. **No D2 conversion**
  for either: `FileValueSchema` is the ADR-0104 D3 wave-2 *expanded read* form, derived at read
  time from a `sys_file` id (the stored form is `FileReferenceIdValueSchema`, an opaque string),
  and a plugin compatibility matrix is a published version manifest that `stack.zod.ts` declares
  no collection of — neither is ever a stored `sys_metadata` row, so the chain has no seam that
  would see one
- both authorable-surface rows move: each becomes `<key> [RETIRED]` beside its renamed row, since
  both are **top-level** properties of their def

Clause-②: yes
