---
'@objectstack/metadata-protocol': patch
---

fix(metadata-protocol): when a seed in a package publish fails, the `seedApplied` receipt counts the rows the earlier seeds wrote and names the seed that stopped the load

Clause-②: no
Metadata-protocol: none

`POST /api/v1/packages/:id/publish-drafts` applies every published seed body in one load. The load writes seed by seed and stops at the first one that throws (for example, a seed naming an object that does not exist); the rows the seeds ahead of it wrote stay written. The receipt used to answer `inserted: 0, updated: 0` all the same, so an author or Studio reading it was told nothing had been written while the table held those rows.

Now the receipt keeps its shape and its counters describe what was written:

- `inserted` / `updated` are the rows the load wrote before it stopped, including any rows the failing seed itself wrote before it threw.
- `success` is `false`, as before.
- `error` names the seed that stopped the load by the object its dataset populates: `seed apply stopped at the seed for object 'OBJECT': ...`, followed by the same sentence as before (a refusal the error declared is quoted, anything else is withheld as `seed apply failed`).

Unchanged: which seeds are published, that the seeds after the failing one are not applied, and that nothing is rolled back. A throw before the loader writes anything (a malformed seed body, for example) still answers `inserted: 0, updated: 0` and the same `error` as before.
