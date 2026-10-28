---
'@objectstack/spec': patch
'@objectstack/rest': patch
---

Clause-②: no
Metadata-protocol: none

fix(spec): a book's *Uncategorized* group no longer lists the pages a sibling book places (#27091)

When two books split one package's docs, for example a user manual and an admin manual gated by `audience: { permissionSet }`, each book's tree used to list the other book's pages under a trailing *Uncategorized* group. `resolveBookTree` judged "claimed" against the book's own groups only. ADR-0046 §6.4 rolls up only the docs "left unplaced", and a doc a sibling book places is placed.

- **`resolveBookTree(book, docs, bookPackage?, books?)`** takes an optional fourth argument, every registered book. With it, the *Uncategorized* group holds only the docs of the book's packages that no book claims. The claim judge is `resolveBookClaimedDocs` over each book, the same claim set `resolveDocAudiences` unions audiences over. Without it, the tree is the same as before.
- **`GET /meta/book/:name/tree`** passes the books it already reads, so an administrator opening the user manual no longer sees the admin pages under *Uncategorized*. A doc that no book claims still rolls up there.

The change only removes entries from the catch-all: a sibling book's docs appear nowhere new, and a doc's effective audience (§6.7) does not change.
