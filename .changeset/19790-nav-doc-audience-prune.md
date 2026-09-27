---
'@objectstack/rest': patch
---

fix(rest): `GET /meta/app` leaves out a `type: 'doc'` navigation entry the caller may not read (#19790)

`DocNavItemSchema` declares that a `doc` entry the member may not read is not
rendered, and that a `book` entry is not rendered for a member with no readable
page in it. Until now only a renderer could honour that. The server's app-nav
filter pruned on `requiredPermissions`, `requiresService` and object servability,
so every member of the app got the entry. That included its label and the gated
book or doc name, however the book was gated.

The filter now applies the docs audience (ADR-0046 §6.7) on both the list route
(`GET /meta/app`) and the by-name route (`GET /meta/app/:name`), in the top-level
navigation, inside `children` and inside `areas[].navigation`:

- **`doc`**: the entry is dropped when the doc's effective audience does not
  admit the caller. This is the answer `GET /meta/doc/:name` gives.
- **`book`**: the entry is dropped when the book's own audience does not admit
  the caller, or when none of its pages is readable. A book's pages are the docs
  its groups claim. The *Uncategorized* group that the book tree adds does not
  count.
- **`book` + `doc`**: the entry is dropped when either of those checks fails.
- An app emptied by the prune is still served, as it is today when
  `requiredPermissions` empties one. An emptied `group` or area collapses, as
  with every other gate.

The verdicts come from the same resolution that `/meta/doc`, `/meta/doc/:name`,
`/meta/book` and `/meta/book/:name/tree` now share. What those reads return is
unchanged.

**Fails closed.** If the book or doc list read throws while `/meta/app` is being
answered, every `doc` entry is left out of that one response and a warning is
logged. The rest of the navigation is still served. If the caller's
permission-set holdings cannot be resolved, set-gated entries are dropped, as
set-gated content already is.

**Cost.** An app list with no `doc` entry performs no extra read. Otherwise each
request adds one `book` list read, one permission-set resolution when some book
is set-gated, and one `doc` list read when a set-gated book exists or an entry
names only a book. Each of these happens once per request, however many apps are
listed. Nothing is cached across requests.
