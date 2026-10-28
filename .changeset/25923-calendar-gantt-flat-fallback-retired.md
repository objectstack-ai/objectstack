---
'@object-ui/plugin-calendar': patch
'@object-ui/plugin-gantt': patch
'@objectstack/spec': patch
'@object-ui/types': patch
'@object-ui/plugin-list': patch
'@object-ui/plugin-view': patch
---

refactor(plugin-calendar,plugin-gantt)!: the calendar and gantt renderers read their binding from the `calendar` / `gantt` block only; the flat fallback read is retired (#25923)

Clause-②: no (narrowing)
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) No `@objectstack/spec` key, accepted value, stored row or stored shape moves. The spec's `ComponentPropsMap['object-calendar']` and `['object-gantt']` rows already refuse every flat key this change stops reading, `@object-ui/types` stopped declaring them in the earlier slice of #25923, and both producers in the console (`ListView` and `ObjectView`) already write the block, so no metadata the spec accepts reaches the retired read. A stored-row census over every metadata source this repository reaches (examples, apps, the console's shipped metadata, seeds, fixtures, platform-objects) found no stored view or node that writes the binding flat, so `objectstack migrate meta` has nothing to rewrite. What narrows is the drawing outcome for a host that mounts `ObjectCalendar` or `ObjectGantt` directly with a flat node: it now reaches the refusal screen. The `@objectstack/spec` half is prose only: the two refusals no longer say the renderer still reads the flat spelling. The other categories are closed on facts: the packages publish (not unpublished); no ADR-0087 id covers this change (not registered or already-registered); the narrowed type members are package-local hand-off types that neither package's entry exports (not type-surface-only or runtime-export-retired). -->

`ObjectCalendar` and `ObjectGantt` kept a second, flat reading of their field binding for a host that mounts them directly with the keys written on the node. The spec refuses those keys on the node, `@object-ui/types` no longer declares them, and no producer writes them, so that read was a second dialect nothing should reach. It is retired.

- **`@object-ui/plugin-calendar`**: `getCalendarConfig` reads the `calendar` block only. A node that writes `startDateField`, `endDateField`, `titleField`, `colorField` or `allDayField` flat, with no block, shows the "Calendar configuration required" screen, whose hint names the `calendar` block. The package-local `ObjectCalendarFlatFields` and `ObjectCalendarHandoff` types are gone, and `ObjectCalendarProps['schema']` is the published `ObjectCalendarSchema`.
- **`@object-ui/plugin-gantt`**: `getGanttConfig` reads the `gantt` block only. A node that writes its `GanttConfig` keys flat, with no block, shows the "Gantt configuration required" screen, which now names the `gantt` block, and in development a warning names every flat key the chart did not read, with or without a block beside it. The legacy singular `dependencyField` is read nowhere (the spec spells it `dependenciesField`, inside the block). The package-local `ObjectGanttFlatFields` type is gone; `ObjectGanttProps['schema']` keeps the two search keys `ListView` writes at runtime, now on `ObjectGanttSearchFields`.
- **`@objectstack/spec`**: the `object-calendar` and `object-gantt` flat-key refusals no longer say the renderer still reads the flat spelling. The prescription is unchanged: write the keys in the `calendar` / `gantt` block.

**Supersedes, in the same release:** `25923-calendar-gantt-flat-keys-handoff.md` (the earlier slice of #25923) says the calendar and gantt renderers are unchanged and still read the flat spelling a host hands them, that `ObjectCalendarProps['schema']` and `ObjectGanttProps['schema']` carry the flat keys, and that the spec refusals call the flat spelling a fallback the renderer still reads. This change retires that read, so those sentences no longer hold: the renderers read the block only, the props types carry no flat binding key, and the refusals no longer say it.

**BREAKING** for code that mounts `<ObjectCalendar>` or `<ObjectGantt>` with a flat node.

- **Before.** `<ObjectGantt schema={{ type: 'object-gantt', objectName: 'task', startDateField: 's', endDateField: 'e' }} />` drew a chart, and the flat keys compiled against `ObjectGanttProps['schema']`.
- **Now.** The flat keys are a compile error on the props type, and the node shows the configuration-required screen.
- **Fix.** Write the binding in the block: `{ type: 'object-gantt', objectName: 'task', gantt: { startDateField: 's', endDateField: 'e', titleField: 'name' } }` (the `gantt` block requires `titleField`; the flat branch used to floor it at `'name'`), and `{ type: 'object-calendar', calendar: { startDateField: 'start' } }` for a calendar.
