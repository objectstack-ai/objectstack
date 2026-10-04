---
'@objectstack/spec': patch
---

Two provenance comments that tests read literally were re-anchored

Clause-②: no

The removal note on `DATA_ACTION_TO_API_OPERATION` in `src/data/api-derivation.ts` and the
explanatory block about `ApiKeySchema` in `src/identity/identity.zod.ts` cited tracker numbers
that no longer resolve on GitHub. Each now opens with the commit in this repository's history
that decided the matter: 6968885ef removed the producer-less `batch: 'bulk'` alias row, and
2c86fe3ea deleted `ApiKeySchema` on the maintainer's ruling. The unit tests that read those two
comments moved with them, and the same re-anchoring was applied to the comments in the
package's test files, which do not ship. Comments only: no type, schema, export or runtime
behaviour changes.
