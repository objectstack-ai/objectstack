---
"@objectstack/spec": minor
---

feat(spec): open `RecordActivityProps.types` to author-contributed activity kinds (#11658)

Accept-set **widening** on a published authorable prop, executing the
2026-08-24 maintainer ruling on #11507: `sys_activity.type` is an OPEN,
author-extensible vocabulary — the declared options are the platform built-in
set, ADR-0052 §5b.2 stays a sanctioned author write path, and (verbatim)
"every closed map over this vocabulary is now the bug".

`RecordActivityProps.types` (the `record:activity` filter, also embedded as
`RecordChatterProps.feed.types`) was that closed map on the authoring surface:
`z.array(FeedItemType)`, a closed enum of the 13 built-in UI kinds, so an
author who contributes an activity type (e.g. `scheduled`, which hotcrm writes
today through the sanctioned ADR-0052 §5b.2 channel) could not name it in the
filter. The element is now `z.union([FeedItemType, z.string().min(1)])`: the
enum branch keeps the built-in kinds visible as guidance (editor autocomplete,
and an `anyOf` member of the generated JSON Schema) while the open-string
branch accepts any author-contributed kind — the union accepts exactly what a
bare non-empty string accepts, so nothing is validated against the built-in
set. A typo'd built-in consequently no longer gets a named rejection; the
ruling accepted that cost rather than re-close the vocabulary.

Every previously-legal value still parses byte-identically; non-string and
empty entries are still rejected. The `feed.zod.ts` module docblock (and the
generated `feed.mdx` reference page) no longer claims these enums have "no
backend dependency": `FeedItemType` is the target of the map UI consumers
apply to the open `sys_activity.type` column — a backend coupling, not a
backend import.

<!-- adr-0087: not-required (no-migration-prescription) Pure accept-set widening on an existing key: no key is removed, renamed or re-shaped, and every previously-valid document remains valid unchanged, so there is no tombstone and nothing for `objectstack migrate meta` to rewrite. -->
