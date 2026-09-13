---
"@objectstack/spec": patch
---

docs(spec): record which axis the list-view calendar guard gates — and which it does not (#16577)

`checkListViewCalendarVisualization` gates ONE way of asking for a calendar: `appearance.allowedVisualizations` includes `'calendar'`. A view can also ask for one by BEING one — `type: 'calendar'` — and that axis parses CLEAN at all three doors (`ListViewSchema`, `ObjectListViewSchema`, `VIEW_METADATA_MEMBERS.listOverlay`). The disposition was correct but undocumented, so it read as an oversight rather than a decision.

**No behaviour changes.** Every parse verdict at every door is byte-identical before and after; the diff is a TSDoc block on the exported check (which ships in `dist/*.d.ts` and in `src/**/*.zod.ts`) plus pins in `view.test.ts`.

What the docblock now records, all of it measured rather than inferred:

- The `type:` axis is **not unwatched**. It is carried by `checkViewCompleteness`'s `VIEW_BINDING_BLOCKS` (`kernel/functional-completeness.ts`) at **warning** severity, under the same ADR-0078 §1 rubric this file's `page` note already cites — refuse what renders NOTHING, warn what degrades. The two doors have complementary coverage: the completeness check reads `type` only and is blind to `allowedVisualizations`; this check reads `allowedVisualizations` only and is blind to `type`.
- `viewType` is **not** a second spelling of `type`. The two authoring doors refuse it as an unknown key; the `.strip()`ed overlay write door (`PUT /api/v1/meta/view`) DROPS it, so the view parses as the defaulted `type: 'grid'` — an author who spells it reaches a grid, never a calendar.

⛔ Escalating the `type:` axis to a parse refusal is deliberately NOT done here: it would refuse a shape 17.3.0 accepts, which is a published-surface narrowing and belongs to a ruling — the same disposition the `timeline` scope pin has stated since #13817.
