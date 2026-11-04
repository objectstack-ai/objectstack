---
'@object-ui/app-shell': patch
---

fix(app-shell): a personal view opened by its address no longer carries the default view's filter and sort in the address bar

Clause-②: no
Metadata-protocol: none

- While the list waits for the reader's own views to resolve a requested or pinned view it does not hold yet, the list's URL state is neither seeded nor written. The default view the page falls back to meanwhile is not the view the address names, so its stored filter, sort and search no longer reach the address bar. Before, when the list preferences landed first, that default seed was written to the URL, and a personal views read landing before the write committed left it there: a reload or a shared link then opened the personal view with conditions nobody chose for it and marked it personalized.
- When the view resolves, the seed is taken for it alone: from its own stored state, or from the `uf_*` params a link carried, as before.
