---
'@objectstack/metadata-protocol': patch
'@objectstack/rest': patch
'@objectstack/runtime': patch
---

fix(rest)!: `GET /meta/_drafts` refuses a `type` that names no metadata type and a `packageId` that names no package, the way the list and diagnostics doors refuse them, instead of answering an empty draft list (#29180)

Clause-②: no (narrowing) — `GET /api/v1/meta/_drafts?type=TYPO` and `?packageId=UNKNOWN`, answered `200 {"drafts":[]}` before, are refused `400 INVALID_REQUEST` on both transports (`RestServer` and the runtime dispatcher). Nothing is widened.
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) No key of any schema is added, removed, renamed or re-shaped, and no export or type changes: a read filter that matched nothing is now refused with the list door's and the diagnostics sweep's existing INVALID_REQUEST refusals. A caller has nothing to rewrite except the misspelled filter value the refusal names. -->

**BREAKING** accept-set narrowing at the pending-drafts read (`@objectstack/rest`, `@objectstack/runtime`, `@objectstack/metadata-protocol`).

- **Before.** `?type=dashbord`, `?type=viewes` or `?packageId=com.qa.nosuch` narrowed the list to nothing and answered `200 {"drafts":[]}`, a confident "nothing pending" that a caller about to publish, revert or discard could not tell from a real empty list.
- **Now.** A `type` is judged by the list door's own verdict (`GET /meta/dashbord` answers the same `400` and sentence): the static spelling contract, then the live type set. A `packageId` is judged by the diagnostics sweep's rule: a draft bound to the package is proof enough, otherwise the installed-package listing must carry it. Both fail open when the authority cannot be read.
- **Unchanged.** A known type in either spelling (`dashboard`, `dashboards`) and an installed package with nothing pending still answer `200 {"drafts":[]}`, with or without the other filter.

**The remedy.** Correct the misspelled type or package id; `GET /api/v1/meta/types` lists the types and `GET /api/v1/packages` the installed packages.
