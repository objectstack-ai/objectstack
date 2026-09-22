---
"@objectstack/spec": patch
---

`view/layout-without-binding` — the `calendar` warning no longer tells an author the renderer falls back to `start_date` / `end_date`, because objectui deleted those floors; it names the refusal screen the renderer shows instead, and the key that clears it (#17445).

Two carriers asserted the same deleted behaviour: `VIEW_BINDING_BLOCKS`' calendar row in `src/kernel/functional-completeness.ts` (stated as *measured*, against "the built console 17.2.0") and the body of the warning `checkViewCompleteness` emits on that route. Re-measured on objectui `main` at `0cf2d6644` (2026-09-21), both halves of the path a `type: 'calendar'` list view takes:

- `packages/plugin-list/src/ListView.tsx`, `case 'calendar'` — the two literal floors are gone (objectui#7029); the branch restates only bindings the view declared.
- `packages/plugin-calendar/src/ObjectCalendar.tsx` — `getCalendarConfig` resolves `null` with neither a `calendar` block nor a flat `startDateField`, and the component renders its "Calendar configuration required" refusal screen, which names `startDateField` (objectui#8170 corrected that screen: `titleField` is not required).

So the old body was wrong twice — there is no fallback to literal field names, and the failure is not silent. What it was right about is the remedy, and that is the half the new body keeps: it names `calendar.startDateField`, `CalendarConfigSchema`'s one required key, and records that the event title resolves through the ADR-0079 display-name chain when `titleField` is omitted. The `fix` hint is unchanged.

- **The message is now per type.** `VIEW_BINDING_MESSAGE` carries an entry for a type whose measured outcome is not the generic literal-fallback sentence; the other five types receive the generic body unchanged. A type that stops flooring gets an entry, never a reworded universal — the two carriers drifted apart once, and the map is what makes correcting both one edit.
- **No severity moves — the severity is already ruled.** #16577 ruled **B** on 2026-09-11 (comment `5634033966`, card closed `completed`): the `type: 'calendar'` route stays warning-class under ADR-0078 §1, and it stays there *because* both doors are loud — loud at `os validate` (this warning) and loud at render (objectui#7029 deleted the `start_date` / `end_date` floors; `getCalendarConfig` returns `null` and the named refusal screen is reachable). That is exactly the premise re-measured here, so the corrected row is the evidence the standing ruling rests on, not a change whose severity consequence is pending.
- ⚠️ **The same reading found three sibling rows stale, and they are recorded rather than corrected** — out of this card's scope, and each changes what its row's severity rests on: `gantt`'s four floors are gone (objectui#7070, objectui#7499) and `ObjectGantt` refuses; `timeline`'s `created_at` floor is gone (objectui#7070) while its `titleField || 'name'` stands; `map`'s `locationField || 'location'` is gone on both faces (objectui#8169). The table now carries that re-measurement note so the three are not reused as current fact, and `kanban` / `tree` were re-read at the same ref and still say what they say.

No schema moved, no export moved and no accept set moved: this corrects prose and one warning string. `Clause-②: no`
