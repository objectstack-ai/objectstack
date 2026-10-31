---
'@object-ui/core': patch
'@object-ui/data-objectstack': patch
'@object-ui/app-shell': patch
'@object-ui/plugin-view': patch
'@object-ui/i18n': patch
---

feat(console): a stored view filter's OR group filters the list, and the filter builder saves and reads it

Clause-②: yes (widening: `@object-ui/core` adds the export `builderRulesOfSpecFilter` and its result type `BuilderFilterRules`; no schema, accept set or error code changes)
Metadata-protocol: none
Skills-docs: follow-up #28476 — skills/objectstack-ui/rules/list-views.md, skills/objectstack-ui/evals/views-apps-actions-pages.json (the any-of group is not taught there yet); `content/docs/ui/views.mdx` gains a Base filter section that states it

A view filter list may hold an any-of group beside its rules, `{ or: [rule, ...] }` (`ViewFilterOrGroupSchema` in `@objectstack/spec/ui`): the list ANDs its elements and the group ORs its rules. Until now no console reader applied it. The list query passed the group through, the server refused the query as a malformed filter (400 `INVALID_FILTER`), and the view showed no rows.

- **Query.** `toFilterNode` (`@object-ui/core`) lowers a group to an `or` node of its rules, one child of the list's AND, so the list, the export, kanban, calendar, gallery, timeline, related lists, line items, the grid and the in-memory `ValueDataSource` all select the records the group names. Each member is lowered exactly like a top-level rule, so the same operator fold and refusals apply inside a group. A group the spec refuses (an empty `or`, a blank-field member, a group inside a group) is not repaired: the server still refuses it.
- **Adapter.** `@object-ui/data-objectstack` translates a group in an unlowered view filter list on both `find()` routes, whether it opens the list, follows a rule or is spread into an `and`. A group that does not translate is refused whole with `MalformedFilterError` (`INVALID_FILTER`, 400), never dropped.
- **Save.** The filter builder's OR group over two or more rules is saved as one group element, `[{ or: rules }]`, instead of being refused with "a saved view cannot store OR". The `console.objectView.filterOrNotSavable` message is retired in all ten packs.
- **Read back.** A stored list that is exactly one group opens in the Studio filter field, and in `toFilterGroup`, as an OR group of its rules. A list with a group beside other conditions cannot be shown by the one-level builder, so the Studio filter field shows it read-only with the reason (`console.objectView.filterOrGroupNotEditable`, in all ten packs) and never saves part of it.
- **Override recovery.** The pass that drops unfinished conditions from a stored view override keeps a group, drops only its unfinished members, and drops a group with none left. It used to drop every group as an entry with no `field`, which widened the view.
