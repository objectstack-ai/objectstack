---
'@objectstack/spec': patch
---

fix(spec): `os migrate meta` guidance for the `field-*`, `export-*`, `api-*`, `dataset-*`, `hook-*` and `metadata-*` migration entries states each lesson in words instead of citing tracker numbers

Clause-②: no

The ADR-0087 semantic entries of the `field-*` family (the runtime `field` write door, the
`maxLength` / `minLength` / `scale` / `precision` refusals, `scale` on a currency field,
`multiple` on a type that holds one value, and predicates that read through a reference),
the `export-*` family (the export permission axis, the eight constraint keys retired from
`ExportFieldMeta` and the retired export-job API family), the `api-*` family (the runtime `api` write door,
the split API entry and two duration keys renamed with their unit), the `dataset-*` family
(the aggregate × field-type refusals and the nested-relation list refused at save), the
`hook-*` family (the retired hook-session `roles` and the two `registerHook` refusals) and
the `metadata-*` family (the retired customization protocol, the re-partitioned endpoint
switches, the metadata-manager cache keys and the retired `additionalTypes`) are printed by
`os migrate meta` as the header, `why:` and `verify:` lines of a manual change. Their text
sent the reader to issue-tracker, decision-batch and ruling-record numbers — some of which
no longer resolve, and some in another repository — for what a ruling, measurement or fix
had decided; it now says what was decided, in the sentence being read. ADR ids are kept.

Text only: no entry id, `from` / `to`, conversion or matching logic changes, and the chain
rewrites exactly what it rewrote before. One entry's `surface` (the header line of
`dataset-measure-aggregate-field-type-refused`) drops the two tracker numbers it carried and
names nothing else differently. The generated migration registry, `spec-changes.json` and
the protocol upgrade guide carry the same text.
