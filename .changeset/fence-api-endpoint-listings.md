---
"@objectstack/spec": patch
---

The `api/automation-api` and `api/package-api` reference pages publish their endpoint listing as a code block instead of a run-on line.

Both module docblocks captioned a listing with `@example Endpoints` and then wrote its rows as ordinary prose lines. Consecutive non-blank lines are one markdown paragraph, and the docs site loads no `remark-breaks`, so every soft line break became a space: the nine automation rows and the eight package rows each arrived as a single run-on sentence with the author's column alignment collapsed away. The listings are now fenced at the source, the way the neighbouring `api/odata` and `api/metadata` docblocks already fence theirs, and the two generated pages render a block.

The fix is in the two `.zod.ts` docblocks — which ship to consumers under this package's `src/**/*.zod.ts` — and in the pages regenerated from them. No schema, export, accept set or runtime behaviour changes.
