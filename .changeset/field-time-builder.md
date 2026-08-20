---
"@objectstack/spec": patch
---

feat(spec): add `Field.time` builder to close the temporal-field authoring gap (#8656)

The `Field` convenience object exposed `Field.date` and `Field.datetime` but no
`Field.time`, even though `'time'` is a fully declared `FieldType` and is live
end-to-end (validated by `field-value.zod.ts` as `HH:mm[:ss]`, stored, and
rendered by the inline grid's time control). The gap split the three temporal
types two-and-one, forcing authors reaching for `time` to fall back to the
literal `{ type: 'time', ... }` form — the shape `examples/app-showcase`'s
`field-zoo.object.ts` already carried, flagged `// no Field.time`.

`Field.time` mirrors the adjacent `Field.datetime` builder exactly and produces
the identical literal shape an author could already write — `{ type: 'time',
...config }` — so nothing about what `FieldSchema` accepts changes; this is
sugar over an already-declared field type, not a schema change.
