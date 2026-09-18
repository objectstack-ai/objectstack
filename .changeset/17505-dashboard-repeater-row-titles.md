---
"@objectstack/spec": minor
---

`dashboard.widgets[]` (17) and `dashboard.globalFilters[]` (10) — every authorable row property of these two repeaters now carries a JSON Schema `title`, so Studio's property-panel table prints an authoring label instead of the raw machine key (#17505).

`Clause-②: yes` — no authorable key moves, but each row property gains a `title` node in the emitted JSON Schema, which is a published artifact.

Studio renders a `type: 'repeater'` field as a table whose column headers read `items.properties[k].title ?? k` off the schema derived by `z.toJSONSchema(...)`. With no `title` the fallback arm runs in **every** locale, English included, so the maker saw `requiresService`, `filterBindings` and `optionsFrom` inside an otherwise translated panel. That is a missing authoring label in the contract, not a translation gap — the English default has to live on the schema, because `resolveMetadataFormSchemaTitles` only ever REPLACES a `title` that is already there.

- **Mechanism unchanged** — this applies the one ruled in #16458 and already landed on `dashboard.header.actions` and on the `ai/skill`, `ui/report` and `ui/page` carriers: `.meta({ title })` on the zod item schema, beside the existing `.describe()` rather than in place of it.
- **The debt record is deleted, not suppressed.** `repeater-item-titles.test.ts` keeps an exact, shrink-only ledger: a carrier in it must still be untitled, so paying a debt and leaving the entry behind is as red as never paying it. Both `dashboard:*` entries are gone from that set; five remain (`field:options`, `object:fields.options`, `view:columns`, `view:sort`, `view:tabs`).
- ⛔ **No tombstone was titled.** The five `retiredKey()` keys on this row (`actionUrl`, `actionType`, `actionIcon`, `responsive`, `aria`) declare their keys unwritable; an authoring label would advertise them as writable. All five still emit `title: undefined` in both `io: 'input'` and `io: 'output'`, and the sibling control in `dashboard.test.ts` was re-pointed onto one of them so the rule is now pinned rather than assumed.

Measured through the platform's own predicate (`z.toJSONSchema` over `getMetadataTypeSchema`, `io: 'input'`), not by regexing source: `dashboard:widgets` untitled 17 → 0 and `dashboard:globalFilters` untitled 10 → 0, with all twenty other repeater carriers unchanged in the same run.
