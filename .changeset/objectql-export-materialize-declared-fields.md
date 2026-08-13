---
"@objectstack/objectql": patch
---

feat(objectql): publish `materializeDeclaredFields` from `@objectstack/objectql/core` (#4953)

Was an internal-only module (`declared-fields.ts`) shared by `rule-validator.ts` and
`hook-wrappers.ts` via relative import. Published from the `./core` entry so a package
that structurally mirrors the algorithm for its own reasons (`@objectstack/trigger-record-change`,
which keeps zero build-time dependency on `objectql`) has a test-time way to verify its
copy still agrees with the canonical one, instead of the two silently drifting behind a
doc comment's word. No behavior change to the function itself.
