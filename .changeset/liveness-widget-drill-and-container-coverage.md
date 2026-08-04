---
"@objectstack/spec": patch
"@objectstack/lint": patch
---

fix(spec): classify the 22 dashboard widget keys and refuse undeclared container inheritance (#4956)

The spec liveness ledger's `dashboard.widgets` entry carried one blanket `live`
verdict plus a `note` asserting that the per-widget props were *"classified in
the DashboardWidgetSchema subtree"*. **No such subtree ever existed.** The gate's
walk drills one level and only through an explicit `children`, and `widgets`
declared none — so all 22 authorable keys of the strict `DashboardWidgetSchema`
were never classified, never counted as unclassified, and every run printed
"all governed-type properties are classified" anyway.

That gap — not evidence — is what carried `widgets[].responsive` through the
#3896 inert-key sweep that removed both its sibling `widgets[].performance` and
its literal namesake `view.responsive`. `view` is drilled through `children`, so
`list.responsive` got asked and went out; `widgets` was never asked. It was
finally retired in #4876 / PR #4995, by hand, four days late.

**What changed for authors**

The `objectstack build` / `objectstack lint` advisory now covers dashboards, so
five widget keys warn at build time (they never did before — `dashboard` was not
in the lint's type collections, because until now its ledger warned on nothing):

| Widget key | Why it warns | What to do instead |
| :--- | :--- | :--- |
| `widgets[].colorVariant` | no render path reads the top-level key — only the authoring panels do | move it under `options` (the inline metric card reads it there); the dataset-bound path has no colour affordance |
| `widgets[].actionUrl` | no renderer draws a per-widget action button; every `actionUrl` the dashboard renderer reads belongs to `header.actions[]` | use `dashboard.header.actions[]` |
| `widgets[].actionType` | pairs with the above | as above |
| `widgets[].actionIcon` | zero readers in either repo | as above |
| `widgets[].aria` | declared ARIA attributes never reach the DOM — the same false-compliance shape as the dashboard-level `aria` removed in 17.0.0 | delete it; the renderer emits its own `aria-*` |

Advisory only — the build never fails on these. **Nothing is removed and no
runtime behaviour changes**: this records verdicts, it does not act on them.
Enforce-or-remove (ADR-0049) for the five is tracked separately.

Two verdicts worth knowing because they cut the other way: `requiresService` is
**live** — it reads as inert in the renderer repo but the REST layer strips
widgets whose service is unregistered (ADR-0057 D10) — and `compareTo` is live
on the inline chart path only; on the ADR-0021 dataset path the string arms are
dropped and `{ offset }` fails in the analytics executor.

**What changed for the gate**

`pnpm --filter @objectstack/spec check:liveness` gains a third direction. A
ledger entry sitting on a container property must now declare one of exactly
three dispositions, all of them data: **drilled** (`children`), **deferred** (a
`{ container, to }` row naming the coordinate that does classify the subtree),
or **recorded** (a row in the shrink-only
`scripts/liveness/undrilled-containers.baseline.json`). A container in none of
the three fails, and so does a baseline row whose container has since been
drilled.

A deferral is **resolved, not believed** — the target must exist (a governed
type root, or a drilled `type/prop` coordinate) and classify exactly the
container's child keys; a dangling or drifted target fails. That is the #4956
claim itself, made checkable: pointing a deferral at `DashboardWidgetSchema`
now produces a build failure naming it, where the same words in a `note` were
believed for a release.

Every run reports both populations (today: 58 containers / 292 child keys
classified nowhere, plus 6 resolved deferrals covering 248), `--undrilled`
prints the worklist, and the success line no longer claims a completeness it
does not have.
