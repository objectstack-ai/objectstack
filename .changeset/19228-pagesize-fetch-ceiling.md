---
'@objectstack/spec': patch
---

`pagination.pageSize` states what the renderer owes on a view with no pager

On a kanban, gallery or timeline view there is no pager, so `pagination.pageSize` is the fetch
ceiling. Its description now says so, and names the renderer's two obligations there: bound the
fetch at that number, and, when the filtered set is larger than it, show a visible truncation
signal saying what is on screen is not the whole set.

The key's accept set and its default (`25`) are unchanged, and no export or authorable key moves
relative to the last published release.

Clause-②: no
