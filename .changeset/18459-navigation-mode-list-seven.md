---
'@objectstack/spec': patch
---

fix(spec): the four `z.unknown()` navigation doors in `ComponentPropsMap` list all seven `NavigationModeSchema` modes (#18459)

Clause-②: no

`object-grid`, `object-map`, `object-gantt` and `object-tree` declare `navigation`
as `z.unknown()`, so the `.describe()` on each is the WHOLE published account of
what a mode may be — nothing else in the protocol narrows those four doors, and
the generated reference renders their type as `any` beside that sentence. Three
of them listed six of the seven `NavigationModeSchema` values (no `new_window`)
and `object-grid`, the precedent the other three copied, listed five (no
`popover` either). An author reading the shipped reference was told a value the
platform honours does not exist.

**Re-measured at the current `.objectui-sha` pin `87af769e9a3e`, not at the pin
the finding was taken at.** All four blocks hand `schema.navigation` straight
into the shared `useNavigationOverlay` hook; that hook types its own mode union
AS this package's `NavigationModeSchema` (its own docblock: *"the seven modes
this hook switches on are exactly the seven the exported union publishes"*,
held by a parity test on the objectui side); its click router carries a
`new_window` branch that delegates to `onNavigate` and otherwise falls through
to a `window.open`, and `object-gantt` additionally implements that action
itself. `popover` is an overlay mode in the same router and every one of the
four passes it an anchor. So all seven modes reach all four doors.

**Why `object-grid` is in the same change.** It is the row the other three were
copied from and it understates by two rather than one; correcting three while
leaving the source of the pattern intact would leave the family in the state
that produced the defect. All four now name the schema as well as the values,
so the next member added to `NavigationModeSchema` has a named edge into these
rows instead of four independently drifting lists.

**Why `Clause-②: no`.** The doors stay `z.unknown()` — a `navigation` value is
accepted before and after this change, whatever its `mode` reads. Nothing is
added to, removed from or narrowed on any authorable surface: the diff is four
description strings and the reference page regenerated from them, and
`check:authorable-surface`, `check:api-surface` and `check:export-origins` all
pass with no artifact to regenerate. What moves is what an author is TOLD, which
is why this ships as a `patch` rather than as no changeset at all: the sentence
is published bytes — `src/ui/component.zod.ts` ships verbatim under this
package's `files[]` entry `src/**/*.zod.ts`, and the compiled string ships in
`dist/ui/index.js` and `dist/ui/index.mjs`.
