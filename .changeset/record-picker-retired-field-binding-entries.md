---
"@objectstack/lint": patch
---

fix(lint): the `element:record_picker` field-binding entry drops #5775's retired `displayField` / `searchFields` (#6629)

`COMPONENT_FIELD_SPECS` — the one hand-written table naming which component
props carry FIELD NAMES — still listed `displayField` and `searchFields` for
`element:record_picker`, with a comment ("The schema says `displayField`; real
pages author `labelField`. Accept both.") describing a spec that no longer
exists. #5775 retired both: `displayField` was renamed to `labelField`
(ADR-0087 D2) and `searchFields` was deleted (ADR-0049), and both are
`retiredKey()` tombstones on `ElementRecordPickerPropsSchema`. The entry now
names `labelField` alone.

What changes for an author: a page that writes one of the retired keys no
longer collects a second `page-field-unknown` finding on top of the #5068 props
gate's rename/delete prescription. That finding was the misleading half — it
reported that the field named by a key which no longer exists does not exist
either, while the prescription is what actually moves the page forward. No
spec-conformant page is affected; nothing else in the table moves.

The harder half of the residue is that nothing reconciled this hand-written
table against the spec, which is how a retirement that disposed of the schema,
the tombstone, the ADR-0087 conversion and the generated artifacts still left
dead spelling standing in a live rule — the ADR-0078 reader face, where the
next author infers the spelling is current. `component-field-specs-liveness.test.ts`
closes that class table-wide: every prop the table names must exist on the
corresponding `ComponentPropsMap` schema and must not be a tombstone, so the
next retirement that forgets this table goes red naming the entry instead of
surviving as residue.
