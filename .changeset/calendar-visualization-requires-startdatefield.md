---
"@objectstack/spec": minor
---

feat(spec): calendar in `appearance.allowedVisualizations` now requires `calendar.startDateField` on list views (#13817)

**BREAKING** accept-set narrowing on `ListViewSchema` (and its two derived
doors, `ObjectListViewSchema` and the flattened `ViewMetadataSchema` list
overlay), shipped as `minor` under the repo's launch-window convention for
breaking changes. Ruled on #13748 (2026-08-31, option A — fix both halves);
this is the spec half, objectui#7029 is the runtime half.

A view declaring `appearance.allowedVisualizations: [... 'calendar']` with no
`calendar:` block used to parse clean. Downstream (measured on #13748): the
calendar toggle rendered and was clickable, objectui invented
`startDateField: 'due_date'`, and the renderer landed every record without
that field on "today" — a plausible-looking, fully wrong screen, with the
renderer's own refusal screen unreachable because the synthesized config
always looked complete. The parse now **rejects loudly**, naming
`calendar.startDateField`, why the date has no truthful fallback, and both
remedies (declare the block, or drop `'calendar'` from the whitelist).

In the same stroke `CalendarConfigSchema.titleField` moves required →
**optional**: only `startDateField` is load-bearing — the renderer resolves a
missing title through the ADR-0079 record display-name chain (measured in
objectui `ObjectCalendar.tsx`: an explicit `titleField` wins only "when
present"). Keeping it required would have made the new cross-field gate
demand more than the renderer reads, which the ruling forbids. Every
previously-valid calendar block stays valid.

Scope: `calendar` only — the measured defect. Whether `timeline` or another
visualization has the same shape is a separate finding to measure first (the
ruling says so in those words); a scope pin test asserts the requirement does
not leak to `timeline`.

<!-- adr-0087: not-required (no-migration-prescription) A validity narrowing over existing keys plus an optionality widening: no key is removed, renamed or re-shaped, so there is no tombstone and nothing mechanical for `objectstack migrate meta` to rewrite. The refusal is the channel that reaches an affected author, at the parse site, naming the one missing key and both remedies; whether a calendar switcher entry meant "bind a date field" or "drop the visualization" is authoring intent no migration entry can decide. The measured in-repo population of affected sources is zero (examples, lint fixtures, spec fixtures, skills, docs snippets all either bind `calendar.startDateField` already or do not whitelist calendar). -->
