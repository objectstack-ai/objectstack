---
'@objectstack/spec': minor
---

feat(spec)!: `navigation` on an `object-map`, `object-gantt` or `object-tree` page block takes the list view's navigation block instead of any value, and every remaining `z.unknown()` member of `ComponentPropsMap` is enumerated with its recorded reason (#21464)

Clause-②: yes (narrowing)

<!-- adr-0087: registered ui-object-map-gantt-tree-navigation-typed -->

**BREAKING** — an accept-set narrowing on a published authoring surface, shipped as `minor` under the repo's launch-window convention for accept-set narrowings. What reads the row: the component-props gate on `objectstack validate`, `objectstack build` and `objectstack lint`, which reports a refused value as an advisory `component-props-invalid` / `component-props-unknown-key` finding. A stored page still saves and loads, because a page component's `properties` is not parsed on the metadata save or load path.

**`@objectstack/spec`**

- **`navigation` is typed on three rows.** `ComponentPropsMap['object-map']`, `['object-gantt']` and `['object-tree']` declared `navigation` as `z.unknown()`, although each renderer hands it to the console's shared navigation hook, which reads `navigation.mode` and falls back to `page` when it finds none. Any value passed, and an off-shape one was answered with a silent default: `navigation: 42` and a bare mode string such as `'drawer'` both opened the record page, whatever they named. Each row now takes the list view's `NavigationConfigSchema` by reference, the same block `object-grid`, `object-kanban`, `object-calendar` and `object-timeline` already take: `{ mode?, size?, openNewTab?, preventNavigation? }`, with `mode` one of `page`, `drawer`, `modal`, `split`, `popover`, `new_window` or `none`.
- **`ObjectMapProps`, `ObjectGanttProps` and `ObjectTreeProps`** (and their `…Parsed` twins) carry `NavigationConfig` on `navigation` instead of `unknown`.
- **No other member changes.** Every other `z.unknown()` member across `ComponentPropsMap` (107 of them) is now listed, with its recorded reason, by a test that fails on a new one until it carries one. The reasons are composition slots, the action blocks' runner-forwarded members, record rows and field values, members of schemas another file owns, a value shown as-is, a deliberately open bag, and a row no renderer draws. The list also holds 28 members a renderer reads with a fixed shape. 27 of them are typed in later changes, and one, `object-kanban`'s `conditionalFormatting`, waits for a ruling, because the console's own kanban fixtures author two rule dialects the list view's schema refuses.

## FROM → TO

| you wrote on an `object-map` / `object-gantt` / `object-tree` | write instead |
|:--|:--|
| `navigation: 'drawer'` | `navigation: { mode: 'drawer' }` |
| `navigation: { mode: 'tab' }` | a mode the hook knows: `page`, `drawer`, `modal`, `split`, `popover`, `new_window` or `none` |
| `navigation: { mode: 'drawer', target: '_blank' }` | `navigation: { mode: 'new_window' }`, or `openNewTab: true` beside a `page` mode |

The one-line fix: write `navigation` as the block a list view declares, `{ mode, size?, openNewTab?, preventNavigation? }`. No conversion is registered, because an off-shape value has no rewrite that both keeps what the block shows today (the record page) and honours what the author wrote; the D3 entry `ui-object-map-gantt-tree-navigation-typed` carries that judgment.

## Who is affected, measured

- **objectstack.** Measured on this branch after merging `origin/main` `100c394f6f`, over the 5 files per row that name `object-map` / `object-gantt` / `object-tree` in the examples, `packages/apps`, `@objectstack/platform-objects`, the plugins and services, the spec sources, the documentation and the published skills: no block of the three authors `navigation`. The one file that co-mentions a row and a `navigation:` key writes app navigation arrays, not this member. The control: the same census finds `objectName` in 4 of the 5 files per row.
- **objectui.** Measured at the `.objectui-sha` pin, over the 88 / 98 / 59 files that name `object-map` / `object-gantt` / `object-tree` (the control: `objectName` in 55 / 70 / 40 of them): every authored `navigation` is `{ mode }` with one of the seven modes, some with `size: 'lg'` or `openNewTab`, and each of those parses on all three rows. The non-object values are probes that expect a refusal: `navigation: 'anything'` in objectui's mirror tests, which assert that both faces answer alike, and a `navigation: 'drawer'` under a `@ts-expect-error`. Neither authors anything.
- **Deployed metadata** was not measured.
