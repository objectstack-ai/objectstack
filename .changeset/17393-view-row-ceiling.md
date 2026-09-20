---
'@objectstack/spec': minor
---

Gallery, kanban and timeline view configs declare an author-settable row ceiling.

`GalleryConfigSchema`, `KanbanConfigSchema` and `TimelineConfigSchema` each gain a
`limit` member — a positive integer, default **100** — saying how many records the
view fetches. The default is APPLIED by the schema rather than only described, and
the key's own text states the other half of the contract: when the ceiling applies,
the renderer must show a visible truncation signal, because a bounded view that
looks complete is worse than an unbounded one. `DEFAULT_VIEW_ROW_LIMIT` is exported
so a consumer reads that number instead of re-declaring it.

The knob belongs in the protocol because two renderers already cap by author choice
off keys the protocol never declared: objectui's kanban board fetches
`$top: schema.limit ?? DEFAULT_KANBAN_LIMIT` with `limit` declared in
`@object-ui/types` alone, its timeline does the same off a component props
interface, and its gallery caps not at all. `limit` is the name those consumers
already read, so this declaration absorbs the consumer-local keys instead of
introducing a second spelling of one concept.

Nothing is removed, renamed or narrowed, and no document that parsed before is
refused now. Two things to know when upgrading:

- a parsed gallery / kanban / timeline config carries `limit: 100` where the author
  wrote no ceiling, so code that compares a parsed config against a literal object
  sees the new member;
- `KanbanConfigParsed` is now declared (ADR-0122) because that schema has two shapes
  for the first time; `KanbanConfig` is unchanged and remains the author state.

The non-grid four — gantt, calendar, map and tree — are deliberately untouched:
their rows stay bounded by a platform ceiling the renderer owns, because a gantt's
range, a map's camera fit and a tree's parent chain are computed over the whole set.

Clause-②: yes (widening)
