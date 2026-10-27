---
'@object-ui/plugin-detail': patch
---

fix(plugin-detail): empty related lists fold into one line after the lists with records; `record:path` terminal stages share the rail's width

Clause-②: no
Metadata-protocol: none

- **Related tab.** Stacked `record:related_list` blocks whose lists have no records no longer take a full row each wherever they were declared. Once every list of the stack has answered, the empty ones fold into one line after the last list, naming each one and keeping its **New** action. A list that gains a record returns to its place. A stack whose lists are all empty, a list on its own, and an empty list that offers more than New (an `add` picker, child toolbar actions) draw exactly as before.
- **Path bar.** On the desktop rail every stage now takes an equal share of the width, terminal stages included, and a terminal stage's label wraps instead of being cut. Before, the separated lost group was only as wide as its words, so a short path drew its terminal stages in one narrow cell at the right edge. The mobile row is unchanged.
- **`RelatedList`** takes an optional `onEmptyChange(empty)` callback, told whether the list is empty once its read answers (`null` while a read is in flight). Nothing else about the component changes.
- No key is added to, removed from or reinterpreted on any block. Nothing to do.
