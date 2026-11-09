---
'@object-ui/app-shell': patch
---

feat(console): the marketplace catalog is filtered and paged by the server

Clause-②: no
Metadata-protocol: none

The Console's marketplace page read the first 100 listings once and filtered them in the browser, so a catalog of more than 100 listings could never show the rest. It now reads one page at a time from `GET /api/v1/marketplace/packages`, and the search text, the facet selection and the page window travel with the read:

- `businessFunctions`, `industries` and `solutionTypes`, each one comma-joined parameter (`?businessFunctions=sales,marketing`), OR inside a facet and AND across facets, as the list door applies them. A facet with nothing selected is left out, never sent empty, and the retired `category` is never sent.
- The search box sends its text as `q` once typing pauses, and the list door does the matching.
- `limit` / `offset`: a pager under the cards walks the door's `total`, 24 listings a page. A new search or selection starts again from the first page.

`listMarketplacePackages` takes the four filters, `maturity` included, which the page itself does not select.

A drawn facet now lists every value the marketplace declares, in the spec's order, and no longer prints a count beside each value: one page of the filtered catalog cannot count the catalog, and the list door answers no counts. A facet appears once some listing the door answered carries it, and stays while a selection narrows the page, so a catalog that serves no taxonomy still draws no filter.
