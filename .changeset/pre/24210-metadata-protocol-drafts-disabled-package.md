---
'@objectstack/metadata-protocol': minor
---

fix(metadata-protocol)!: `listDrafts` omits a disabled package's drafts, as the list read omits its items

Clause-②: no (narrowing)

<!-- adr-0087: not-required (no-migration-prescription) the narrowing is the served set of the pending-drafts list for drafts whose owning package is disabled: no stored metadata changes shape, no spec key, export or error code is added or removed, and nothing must be rewritten; re-enabling the package restores the list -->

**BREAKING** (a served-set narrowing), shipped as `minor` under the launch-window convention for breaking changes.

`GET /meta/_drafts` (both transports) listed a disabled package's pending drafts, while the by-name draft read answers them `404 NO_DRAFT` and the list read omits the package's items.

- **Omitted now:** every draft whose `packageId` names a disabled package, with or without `?packageId=`. The predicate is the one the list and by-name reads ask. Drafts of the `package` type are never hidden.
- **Unchanged:** the package batch doors (`POST /packages/:id/publish-drafts`, `/discard-drafts`) still publish and discard a disabled package's drafts; they read the store directly. Other packages' drafts are listed as before.

What changes for you: re-enable the package to see its pending drafts in the list again.
