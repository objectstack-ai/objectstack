---
"@objectstack/lint": minor
"@objectstack/cli": minor
"@objectstack/metadata-protocol": minor
---

Lint an action nobody placed (ADR-0078 Phase 3, Tier-A `action-locations`).

New advisory rule `action-no-placement`: an action that declares no
`locations` and that no list view places by name renders on **no** surface —
it parses, publishes, and appears in Setup, while no user can ever click it.
ADR-0078 names this shape in its opening paragraph and Phase 3 asks for
exactly this rule; the shared completeness predicate it envisioned was never
built, so this lands standalone, one verified shape at a time.

What made it verifiable now: objectui#3142 collapsed four disagreeing
renderers onto one placement predicate. Before that, `action:bar` and the
record header rendered an *undeclared* action anyway, so the shape only looked
inert on paper. As of objectui 17.1 it is measurably inert.

Two things are deliberately **not** flagged:

- **`locations: []`** — the documented headless action (callable over REST /
  MCP / AI, no UI surface). ADR-0110 D3 refuses an undeclared handler, so a
  headless declaration is the only legal way to expose one. The rule therefore
  distinguishes "nowhere, deliberately" (`[]`) from an unstated placement (key
  absent) and only reports the latter.
- **Actions a view places by name** — `bulkActions`, `bulkActionDefs`
  (including `execution: 'aggregate'` defs, whose whole point is an action with
  no single-record home) and `rowActions`, across all three list-view tiers:
  `views[i].list`, `views[i].listViews.<key>` and the object-embedded
  `objects[i].listViews.<key>`.

Advisory, never fatal — a view in another installed package may be the one
placing the action, the same reason `validateSemanticRoles` and
`lintLivenessProperties` warn rather than gate.

Also: the action form schema in `@objectstack/metadata-protocol` no longer
declares `shortcut` / `bulkEnabled`. Both were retired as `retiredKey()`
tombstones in spec 17, and this schema is what the Studio designer renders its
fallback form from — so advertising them handed authors two inputs that could
only ever produce an unsaveable draft (objectui#3145 removed the matching
dedicated controls). And `content/docs/ui/actions.mdx` now says which surface
is the exception to location filtering, instead of a blanket claim its own
showcase contradicted.
