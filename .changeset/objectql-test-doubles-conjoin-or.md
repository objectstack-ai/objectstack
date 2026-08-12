---
"@objectstack/objectql": patch
---

test(objectql): six in-memory driver doubles conjoin `$or`/`$and` with their sibling filters instead of short-circuiting (part of #7620)

Six test files in `packages/objectql/src` build an in-memory driver whose `WHERE`
matcher **returned early** on `$and`/`$or`, discarding every sibling equality key
in the same object:

```ts
if (Array.isArray(where.$and)) return where.$and.every((w) => matchesWhere(row, w));
if (Array.isArray(where.$or))  return where.$or.some((w) => matchesWhere(row, w));
for (const [k, v] of Object.entries(where)) { /* siblings, never reached */ }
```

A real driver ANDs them. So a query shaped like `SysMetadataRepository.listDrafts`'s —
`{ state:'draft', package_id:'app.x', $or:[{organization_id:ORG},{organization_id:null}] }`
— would have been answered on the `$or` alone, handing back rows matching neither
`state` nor `package_id`. That is not a stricter or looser edge case; it is a
different query, and the suite stays **green** while testing it.

The corrected form is the one `protocol-revert-org-scope.test.ts` already carries
from #7619: fold `$and`/`$or` into the entries loop so they compose with their
siblings rather than replacing them.

Files corrected: `protocol-recorded-by-null.test.ts`,
`save-meta-response-conformance.test.ts`, `plugin.authoring-channel.test.ts`,
`publish-meta-response-conformance.test.ts`,
`protocol-save-meta-repo-path-real-engine.test.ts`,
`protocol-registry-shadow.test.ts`.

**All six are dormant today — measured, not assumed.** A probe installed in each
matcher, logging every `where` it was handed across the six suites, recorded
**132 matcher calls and not one `$or` or `$and`** (44 / 60 / 21 / 7 plain-equality
calls in four of the files; the matchers in `save-meta-response-conformance` and
`plugin.authoring-channel` were never invoked at all — those suites drive writes,
not reads). The control that makes that silence evidence rather than a dead probe
is the 132 plain calls it did record through the same instrumentation. So no
existing test outcome changes, and none should: `packages/objectql` is
**185 files / 3274 tests, all passing**, before and after.

Dormant is not harmless, which is the point of closing it: nothing distinguished
"this double is faithful here" from "this double quietly changed the fixture",
and the next test to add an `$or` would have inherited a matcher that lies.

No product code changed, and no test assertion changed. Each matcher keeps
exactly the operator surface it already had — `$eq` unwrapping, the
`undefined`→`null` comparison normalisation, and the skip for any other
`$`-prefixed key — and a non-array `$and`/`$or` still falls through to that skip,
as before. **Deliberately not extracted into a shared helper**: the six are
identical, but `publish-meta-response-conformance.test.ts` carries the repo's own
rationale for keeping these harnesses self-contained ("a gate that imports its own
substrate from another gate's file couples two tripwires that must be able to fail
independently"), #7619's reference correction is inline for the same reason, and an
objectql-local helper could not serve the ten remaining files in `plugin-sharing`,
`plugin-security` and `runtime` anyway — it would add a second convention rather
than consolidate to one.
