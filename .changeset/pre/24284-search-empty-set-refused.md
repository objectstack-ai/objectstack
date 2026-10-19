---
'@objectstack/objectql': minor
---

feat(objectql)!: a `search` over an object with no searchable field is refused with `400 INVALID_FIELD` instead of answering every row

Clause-②: no (narrowing)

<!-- adr-0087: not-required (no-migration-prescription) No spec key, stored shape or authorable spelling is added, removed or renamed. The narrowing is in what a read answers: a non-blank `search` term over an object whose resolved search set is empty used to be dropped (200, every row) and is now a 400 that names the object and the remedy. The remedy is a metadata edit the author makes by hand (declare `searchableFields`, or add a stored text field), so there is nothing stored for `objectstack migrate meta` to rewrite. -->

A search term is matched against the object's resolved search fields: its `searchableFields` declaration (entries that name a stored field), or else the default set (the name/title field and the text, email, phone, url, autonumber, textarea, markdown and select fields). On an object where that set is empty, such as a junction object made of two lookups and a formula title, the term used to add no filter, so `?search=zzzz-nothing` and `?search=Dune` returned the same rows, and a user read every row as a match.

- **What changes.** `find`, `findOne`, `count` and `aggregate` answer a non-blank `search` over an empty resolved set with `400 INVALID_FIELD` (`param: 'search'`). That covers every door that reaches the engine: the REST list and query routes (and the list's `total`), the grouped read, the dispatcher, the SDK and a hook's `ctx.api`. The message names the object, says why the set is empty, and gives the two remedies.
- **Unchanged.** A blank or whitespace term is not a search and still answers every row. An object with a searchable field filters as before. An explicit `searchFields` naming a field outside the set keeps its own `400 INVALID_FIELD` at the data door. Global search (`GET /api/v1/search`) still passes over an object with nothing to scan and answers `200`.

What to do. If a read now answers `400 INVALID_FIELD` with "has no searchable field", declare `searchableFields` on that object naming a stored field, or mirror the composed title onto a stored text field and search that. A client that offers a search box on such an object should hide it, or show the refusal.
