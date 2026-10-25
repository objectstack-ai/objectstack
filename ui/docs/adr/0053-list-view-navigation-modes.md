# ADR-0053: List-view navigation — two mutually-exclusive modes

**Status**: Accepted (2026-06-18; revised after implementation spike)
**Author**: ObjectUI plugin-view / plugin-list / app-shell team
**Consumers**: `@object-ui/types`, `@object-ui/plugin-view`, `@object-ui/plugin-list`, `@object-ui/app-shell` (Studio), `@object-ui/cli` (`check`), every app with an object list page or a list-in-a-page interface
**Supersedes**: the list-tab placement of **ADR-0047** (per-view `tabs` on the object data-mode list)
**Amended by**: **ADR-0055** (adds a third context — the `/:objectName/data` parameterized bare surface, filters mode anchored to the URL itself)

---

> **Amendment (2026-07-07, objectui #2338 / framework #2679).** The phase-4
> blanket ban on `userFilters` in views mode was an over-correction. An object
> list view MAY now carry a **`dropdown`** (per-field value-chip) `userFilters`
> — the Airtable "quick filter" pills — because dropdown chips do not compete
> with the `ViewTabBar`; they sit alongside it. Only **`element: 'tabs'`** stays
> page-only: a named-preset tab bar would render a *second* tab row and collide
> with the saved-view switcher. So the two-context rule below now reads:
> object views allow `listViews` **+ dropdown `userFilters`**; page lists keep the
> full `dropdown | tabs` range. `ObjectView.renderListView` passes a non-`tabs`
> `userFilters` through; the framework spec narrows the object schema
> (`ObjectUserFiltersSchema`, dropdown/toggle only) and the `validate`
> list-view-mode lint flags `quickFilters` always but `userFilters` only when it
> carries `tabs`. Want status-style named presets on an object? Still use
> `listViews`.

---

## TL;DR

Architecture decision for a metadata-driven, **AI-authored** app platform. A list
surface today exposes **five** overlapping "change what rows you see" mechanisms
with no rule preventing them from stacking (an object list renders two tab rows).

**Decision:** a list has exactly **one** navigation mode, decided by **context**,
and the model is made *correct-by-construction* by **removing the redundant
fields** so the conflicting state is literally untypable — rather than adding a
`mode` discriminator that merely duplicates context.

| Context | Mode | Single control | Config field | Owner |
| --- | --- | --- | --- | --- |
| Object default list (`ObjectView`) | **views** | `ViewTabBar` switcher (+ `dropdown` `userFilters` chips, see Amendment) | `listViews` + `userFilters` (`dropdown` only) | per-user (seeded + user-created) |
| List in a page (`InterfaceListPage`) | **filters** | `userFilters` (`dropdown`\|`tabs`) | `userFilters` | page author (fixed) |

Sample fixtures are disposable, so we **clean-build** (no runtime back-compat
adapters); external apps on the old shape get a codemod / `check` error.

---

## The five mechanisms today (spike findings)

| # | Mechanism | Field | Renderer | Verdict |
| --- | --- | --- | --- | --- |
| 1 | View switcher | `objectDef.listViews` / saved views | app-shell `ViewTabBar` | **KEEP — canonical** |
| 2 | Named-view tabs | `schema.listViews` | plugin-view `renderNamedViewTabs` | **REMOVE — duplicates #1** |
| 3 | In-list tabs | `viewDef.tabs` (ADR-0047) | plugin-list `TabBar` | **REMOVE — fold into `userFilters.tabs`** |
| 4 | Quick filters | `quickFilters` | plugin-list chips | **REMOVE — fold into `userFilters.tabs`** |
| 5 | User filters | `userFilters{element: dropdown\|tabs\|toggle}` | plugin-list `UserFilters` | **KEEP `dropdown`+`tabs`; drop `toggle`** |

Real control point: `app-shell/views/ObjectView.tsx` `renderListView` rebuilds the
list schema (`viewDef.* ?? listSchema.*`). Render paths are already split —
`ObjectView` (views) vs `InterfaceListPage` (filters, drives `ListView` directly).

## Decision detail

1. **Two orthogonal fields, no `mode` discriminator.** Context is the source of
   truth for the mode (object list → views; page list → filters). The only
   config fields are `listViews` (views) and `userFilters` (filters). We do NOT
   add a `ListNav{mode}` union field — it would duplicate context and invite
   "wrong mode for the context" errors.

2. **Correct-by-construction via field removal.** Delete the fields that let an
   author express a conflict, so it is untypable:
   - remove `quickFilters` (NamedListView + ListViewSchema)
   - remove the top-level view `tabs` (ADR-0047) — in-list tabs live only under
     `userFilters.tabs`
   - remove `userFilters.element: 'toggle'` → `'dropdown' | 'tabs'`
   - remove plugin-view `renderNamedViewTabs` (duplicate of `ViewTabBar`)

3. **Views mode** = `ViewTabBar` only (object `listViews`; per-user: seeded
   defaults + user-created/saved, single-select). Status-style presets become
   **named views** (Salesforce model), so one-click status access remains in the
   switcher.

4. **Filters mode** = `userFilters` only:
   - `dropdown` = per-field value filter (each field → its own value dropdown).
   - `tabs` = named filter presets (single-select).

5. **Shared `ListNavBar`** renders both the views switcher and the filters
   tabs/dropdown — concepts stay separate (ownership/persistence differ),
   presentation is unified.

6. **AI-authoring guardrails** (what field-removal can't cover — "wrong context"):
   - `objectql.zod.ts` `refine`: error on any removed field. **(Amended #2338:
     a `dropdown` `userFilters` is now allowed on an object data-mode view; only a
     `tabs` `userFilters` remains page-only — see the Amendment banner above.)**
   - wired into `check` / `doctor`; the AI authoring loop self-corrects on the error.
   - the two-mode rule lives in field `.describe()` / JSDoc the AI reads.

7. **Studio**: each authoring surface exposes only its context's mode — object
   views author named views; page config authors `userFilters`.

## Clean-build, not migrate

No runtime back-compat adapters. Removed fields are deleted from types and all
consumers; showcase / example fixtures are rewritten. External apps on the old
shape get a one-time codemod / a `check` error with a fix hint.

## Consequences

- One unambiguous control per list; invalid states are largely untypable, the
  rest caught by `check`.
- Blast radius: types + plugin-view + plugin-list + app-shell + Studio + CLI +
  example fixtures. Sequenced as several verified PRs.

## Phasing (each an independent, browser-verified PR)

1. Object list renders one switcher (suppress in-list rows). *(landed — PR #1801)*
2. Remove duplicate `renderNamedViewTabs`; remove `userFilters.toggle`.
3. Fold `tabs` + `quickFilters` → `userFilters.tabs`; remove those fields; shared `ListNavBar`.
4. Zod `refine` + `check` rule + field `.describe()`.
5. Rewrite showcase / fixtures; delete dead code paths.

## Alternatives considered

- **Literal `ListNav{mode}` discriminated union** — `mode` duplicates context and
  still needs validation for context-mismatch; rejected in favour of field-removal
  + context + `refine` (simpler, stronger, less rewiring).
- **Keep all five + guards** — perpetual author confusion; rejected.
- **Back-compat adapters** — unnecessary (disposable fixtures, architecture-first); rejected.
- **Merge views & page-tabs into one concept** — collapses the
  user-configurable vs author-fixed ownership distinction; rejected (separate
  concepts, shared `ListNavBar` presentation).
