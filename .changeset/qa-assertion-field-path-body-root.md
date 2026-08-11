---
"@objectstack/spec": patch
---

docs(spec): fix the QA `field`/`capture` path convention — no `body.` prefix (#7365)

`TestAssertionSchema.field`'s `.describe()` text read `'Field path in the
result to check (e.g. "body.data.0.status")'`, and `TestStepSchema.capture`'s
sibling `.describe()` repeated the same `body.*` example. Neither convention
ever matched the runtime: `TestRunner.assert`/`runStep` resolve both paths
against `result` directly — the value `HttpTestAdapter.handleResponse`
returns, which is the parsed response body itself with no `body` wrapper (nor
does the platform's own response envelope, `data`/`meta`, ever nest under a
`body` key). A suite written to the documented convention resolved every path
to `undefined`.

Filed as #7365 (observation-class finding from #7256's blast radius): with
`equals`-class operators a `body.*` path already failed loudly, so an author
worked the real convention out by trial; with `contains`, `undefined` fell out
of the switch and the assertion silently passed, so a `body.*` `contains`
reported green forever. #7256 (PR #7348) turned that silent pass into a loud
failure, which is correct, but it meant an author following the schema's own
example now hits a error that never says the *documentation* is wrong.

Maintainer ruling, 2026-08-11 (issue comment 5248467805): "docs follow the
adapter" — fix the `describe()` text (and the regenerated reference) to the
real convention, root-relative, no `body.` wrapper. `body.*` never worked, so
there is no stored-suite compatibility to preserve. The acceptance face is
unchanged — `field` and `capture` both stay their original Zod types; only the
description text moves.

Both faces now read, in the file's existing one-sentence-plus-example style:

- `field`: `'Field path in the result to check, resolved against the parsed
  response body root — no "body." prefix (e.g. "data.0.status")'`
- `capture`: `'Map result fields to context variables, paths resolved against
  the response body root (e.g. { "newId": "data.id" })'`

`content/docs/references/qa/testing.mdx` is regenerated to match
(`pnpm --filter @objectstack/spec gen:docs`); `check:docs` reports all 231
generated files in sync.
