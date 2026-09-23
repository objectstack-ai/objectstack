---
"@objectstack/spec": patch
---

`view/layout-without-binding` — the `gantt`, `timeline` and `map` warnings no longer tell an author the renderer falls back to literal default field names, because objectui deleted those floors; each now names the refusal screen the renderer shows instead, and the keys that clear it (#19630).

Re-derived at the objectui pin this repo builds against (`87af769e9`), not at objectui's head, both halves of each path a list view takes:

- **`gantt`** — `ListView.tsx`'s `case 'gantt'` restates only declared bindings (objectui#7070 deleted the `start_date` / `end_date` floors, objectui#7499 the `progress` / `dependencies` ones); `ObjectGantt`'s `getGanttConfig` returns `null` without both dates and the component renders "Gantt configuration required". The body now names `gantt.startDateField`, `gantt.endDateField` and `gantt.titleField`, the three keys `GanttConfigSchema` requires.
- **`timeline`** — the `startDateField || 'created_at'` floor is gone (objectui#7070 step three) and `ObjectTimeline` renders "Timeline date axis required"; the `titleField || 'name'` default still stands, and the body says so. It names `timeline.startDateField` and `timeline.titleField`, the two keys `TimelineConfigSchema` requires.
- **`map`** — `locationField || 'location'` is gone on both faces (objectui#8169): `ObjectMap` no longer guesses coordinate field names and its `hasCoordinateBinding` gate renders "Map configuration required", for an absent `map` block and for a declared block that names neither coordinate form alike. Both `map` messages — the absent-block body and the block-present one, which had quoted `locationField || 'location'` as the renderer's read — now describe that refusal and name `map.locationField` or the `map.latitudeField` + `map.longitudeField` pair.

`kanban` and `tree` were re-read at the same pin and still floor (or infer) a binding, so they keep the generic body. The `VIEW_BINDING_BLOCKS` docblock rows carry asserting pin citations, so the next `.objectui-sha` bump reds on them instead of leaving them to go stale.

No severity moves and no finding appears or disappears: every route stays `warning`, consistent with #16577's ruling B for the `calendar` route (both doors loud — `os validate` and a named refusal at render), which these rows now measure too without extending or reopening it. No schema, export or accept set moved: this corrects prose and three warning strings. `Clause-②: no`
