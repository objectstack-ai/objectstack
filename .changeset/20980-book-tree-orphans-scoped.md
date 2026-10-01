---
'@objectstack/spec': patch
---

fix(spec): a book tree's synthetic *Uncategorized* group holds only the unplaced docs of the book's own packages, per ADR-0046 §6.4

Clause-②: no

- `resolveBookTree` used to put every unclaimed doc it was handed into the book's *Uncategorized* group. `GET /api/v1/meta/book/:name/tree` resolves over every doc in the environment, so a book's tree listed every other package's ungrouped docs there. The docs portal never showed those docs in the book.
- The group now holds a doc only when it belongs to one of the book's packages: the package that ships the book, or a package a group names with `package`. A doc with no stamped package still counts as the book's. A doc of another package stays reachable through its own package's book.
- The implicit per-package book that the tree route serves for a package id catches no other package's docs either.
- Unchanged: a doc whose `group` names one of the book's groups joins that group from any package. A book that declares no package keeps every unclaimed doc in *Uncategorized*. The docs a book claims, and so every doc's audience, do not change.
