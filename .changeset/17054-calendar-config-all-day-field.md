---
"@objectstack/spec": minor
---

`CalendarConfigSchema` now declares **`allDayField`** — the fifth field binding on a calendar config, and the one key the rest of this package already published as a member while the schema refused it by name.

**The trap this closes.** The `object-calendar` door refuses a flat `allDayField` and prescribes, verbatim: *"Write this as a key of the `calendar` config object instead — `calendar: { startDateField, endDateField, titleField, colorField, allDayField }`."* That block's `calendar` prop `.describe()` publishes the same five-key shape, and it ships to `content/docs/references/ui/component.mdx`. An author who followed the prescription on a stored view was refused a **second** time, by a different schema with a different message — `Unrecognized key(s) on this calendar configuration: allDayField` — and neither message said the key was not a member at all, so the natural next move was to assume a typo and try more spellings.

**Why the schema was the wrong half, measured rather than assumed.** The key is honoured, not inert. At the objectui pin this repo builds against, `ListView`'s `collectViewFields` reads `calendar.allDayField` into the fetch projection and its calendar branch forwards the authored block onto the `object-calendar` node, where `getCalendarConfig` resolves it; objectui then made it load-bearing in the render itself. Trimming the prescription instead would have left a shipped capability with no protocol carrier — and the mirror that carries it today keeps `.passthrough()` explicitly so the key is not stripped, which means a later hardening there would silently drop it.

**What is authorable, and what still is not.**

```ts
// accepted
calendar: { startDateField: 'start_date', endDateField: 'end_date',
            titleField: 'subject', colorField: 'status', allDayField: 'is_all_day' }

// still refused — one key per concept, not a second authorable spelling
{ type: 'object-calendar', allDayField: 'is_all_day' }
```

`allDayField` **names a boolean field, not a value**: a record whose flag is true draws as an all-day band rather than at a clock time, and one whose flag is absent or false is not all-day. Omit it and the renderer's existing inference is untouched — an event with no end date draws as all-day — so every calendar that never authored the key renders exactly as before.

**The opening is one key wide.** `defaultView` stays refused on this config: it is the renderer's initial view mode, a UI preference rather than a field binding, and it already has its own declared home as an `object-calendar` component prop. Unknown keys are refused in the same shape as before, and `startDateField` is still required.

Purely additive: nothing that parsed before is refused now, and no key is renamed or removed.
