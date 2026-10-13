---
"@objectstack/runtime": patch
---

`POST /packages/:id/revert` reverts a Studio-authored package instead of answering 404 "No metadata items found"

Clause-②: no

- The door asked only the metadata service, whose in-memory registry never holds a Studio package's stored rows. So a package with published items and a pending draft answered `404 RESOURCE_NOT_FOUND`, and the draft stayed.
- The door now asks the protocol's `revertStoredPackage` first, with the caller's active organization. A package with stored rows answers `200 { success: true }` with its drafts removed, or `409 RESOURCE_CONFLICT` when it has never been published.
- A package with no stored row is answered by the metadata service's `revertPackage`, exactly as before. That covers a code-shipped package and an unknown id (`404`). It is also what happens when the protocol does not provide `revertStoredPackage`.
- The request and the response shape are unchanged.
