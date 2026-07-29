---
"@objectstack/metadata-protocol": patch
---

fix(metadata-protocol): findData must not take its execution context from the request (#3960)

Came out of the #3946 sweep's leftover question — whether `expand`'s "advanced
usage" (a caller-supplied `Record<string, QueryAST>` whose sub-ASTs each carry an
`object`) is a cross-object read channel. **It is not**, and that needs saying
because the answer is load-bearing: `expandRelatedRecords` takes its target from
the parent schema (the expand KEY must be a real `reference` field; the sub-AST's
`object` is never read), re-enters `engine.find` so the referenced object's RLS +
FLS both run, `$and`-merges a nested `where` instead of spreading it over the id
filter, and caps depth. No change needed there.

What the investigation did turn up is one layer down. `findData` built its engine
options as `{ ...request.query }` and then assigned `context` from
`request.context` **conditionally**:

- `request.query` is the caller's raw bag on every ingress — the REST
  `POST /data/:object/query` route passes `req.body` straight in as `query`;
- `context` sits in the known-params set, so it was not swept into the
  implicit-filter bucket either — it survived the spread untouched;
- so when no server context resolved, the caller's `context` *became* the
  operation's execution context.

Everything hangs off that value. plugin-security's middleware opens with
`if (opCtx.context?.isSystem) return next()` — the entire RLS / FLS / CRUD chain
skipped — and `__expandRead: true` collects the #2850 waiver on the object-level
CRUD gate. Neither is ever schema-stripped on the read path:
`ExecutionContextSchema.parse` runs only in `engine.createContext`, which reads
do not use.

Route-level `enforceAuth` is what kept this unreachable: anonymous data requests
are refused unless a deployment sets `requireAuth: false`. That makes it a
fail-OPEN default rather than a live exploit — and not something the protocol
should delegate upward. `findData` now drops any inbound `context`
unconditionally before the assignment, so the execution context can only come
from `request.context`.

Verified end-to-end at the protocol layer (a forged
`{ isSystem, userId, __expandRead }` reached `engine.find` verbatim before, is
dropped after). The anonymous HTTP reachability half is NOT verified — see #3960
for exactly what was and was not reproduced. No caller regresses: the only
in-repo builder of these args (`rest/src/import-runner.ts` `findArgsBase`) passes
`context` at the top level, never inside `query`.
