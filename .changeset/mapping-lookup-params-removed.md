---
"@objectstack/spec": minor
---

feat(spec): retire the import mapping `lookup` transform's steering params (#10329, ADR-0049)

<!-- adr-0087: registered mapping-lookup-params-removed -->

**BREAKING** accept-set narrowing, landing after the v17.0.0 cut (the lockstep
launch-window convention ships it as `minor`; the migration prescription is
registered under protocol major 18, where `os migrate meta` users will look).

`ImportFieldMappingSchema.params` declared four keys whose only stated purpose
was to steer the `lookup` transform — `object` ("Lookup Object"), `fromField`
("Match on"), `toField` ("Value to take"), `autoCreate` ("Create if missing") —
and the import path read none of them: `applyMappingToRows` handles `lookup` in
the same branch as `none` (the cell is copied through unchanged), and reference
resolution runs afterwards in `import-coerce.ts`, driven by the target field's
own metadata. Implementing them would be a second reference-resolution dialect
on the import path, which the code declines to build and the #10329 triage
ruling declined again. `autoCreate` was the one with teeth: it read as
"create the referenced record when nothing matches", and nothing was ever
created — with or without the key, an unresolved cell fails its row with
`import_reference_not_found`.

FROM → TO, per key (all four are pure deletions — none ever had an effect to
lose, so removing them changes no import behaviour):

- `fieldMapping[].params.object` → *(removed)*. The referenced object is the
  target field's own declared `reference`.
- `fieldMapping[].params.fromField` → *(removed)*. The pipeline matches the
  cell's display value against the referenced object itself.
- `fieldMapping[].params.toField` → *(removed)*. Resolution always writes the
  referenced record's id.
- `fieldMapping[].params.autoCreate` → *(removed)*. Create or import the
  referenced records first, then import the rows that point at them.

One-line fix: delete the four keys (and any of their old alias spellings) from
`fieldMapping[].params`; `os migrate meta --from 17` lists the mechanical edits
for existing sources.

The retirement kit:

- `params` is a `strictObject`, so the keys are strict-deleted with a
  `guidance` prescription per spelling — the four canonical keys and the
  eleven ex-alias spellings (`lookupObject`/`targetObject`,
  `match`/`matchOn`/`matchField`/`keyField`, `returnField`/`valueField`,
  `create`/`createIfMissing`/`upsert`) all land on the full prescription
  rather than a "did you mean" pointing at a key that is also gone (the
  17.0.0 #4509 treatment, one level down)
- ADR-0087 registration: the D2 conversion `mapping-lookup-params-removed`
  (protocol 18), wired into the step-18 chain — `os migrate meta --from 17`
  strips the four keys from stored `mappings[].fieldMapping[].params`. No
  retired-key table entries: these keys sit one sub-walk level below the
  authorable-surface drill (`data/ImportFieldMapping:params` is the walked
  row, and it stays live), so there is no `defKey:name` row to register or
  age out
- pin tests (`mapping.test.ts`): refusal pins per key asserting the
  prescription (the `autoCreate` pin asserts the row-fails truth), alias
  routing pins, and a surviving-surface pin (`value`/`valueMap`/`separator`
  untouched)
- liveness ledger: `liveness/mapping.json`'s `fieldMapping` sub-walk boundary
  note now records the retirement instead of parking the finding
- docs: the `import-mappings.mdx` warning about the inert params is deleted
  along with the keys; the generated mapping reference no longer lists them
