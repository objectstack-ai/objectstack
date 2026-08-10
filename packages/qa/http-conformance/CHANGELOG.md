# @objectstack/http-conformance

## 0.1.0-rc.5

### Minor Changes

- 12298c7: test(http-conformance): the `setFallbackHandler` seam's four guarantees are asserted cross-adapter — and the reference adapter implements them

  `IHttpServer.setFallbackHandler` (`packages/spec/src/contracts/http-server.ts`,
  #5040 §1-C) declares four testable guarantees, and `@objectstack/http-conformance`
  — the cross-adapter guard those semantics name by hand — asserted **none** of
  them. Since the #5111 flip this seam is the ONLY entry path for declarative
  `apis:` endpoints, so a second adapter diverging here does not mean cosmetic
  drift, it means "declarative endpoints behave unpredictably on that adapter".

  Two changes, in the only order that works:

  1. **`NodeHttpServer` gains the member.** `node:http` ships no not-found hook to
     map onto, so this adapter builds the equivalent out of its own router: the
     handler is a FIELD consulted in the route-miss branch, never a
     `${prefix}/*` catch-all route (which would be decided by first-match-wins
     registration order — the ADR-0076 D11 hazard). 405 + `Allow` keeps
     precedence over the fallback, and a fallback that writes nothing falls
     through to the adapter's own unmatched answer unchanged.
  2. **`fallback-seam.conformance.test.ts` transcribes the four guarantees** and
     runs them against BOTH adapters over a real socket — `NodeHttpServer` and
     `HonoHttpServer`, same cases, no adapter-conditional branches. Nine cases
     per adapter.

  **Why `minor`, and why only this package.** The bump is a new capability on a
  published-nothing QA harness: `NodeHttpServer` grew a contract member it did not
  have, which is additive API surface on this package, so `minor` rather than the
  `patch` the test file alone would earn. No other package is named because none
  changed — `packages/spec`'s contract is untouched (the four guarantees were
  already declared; this asserts them), and `HonoHttpServer` needed no change to
  pass all nine, which is itself the finding: Hono violates none of the four.

  **Observation-class, not a live defect.** Only `HonoHttpServer` implements the
  member today, and the reference adapter's previous non-implementation was
  _compliant_ — the member is optional on the contract. This closes a latent gap
  before a second implementor exists to fall through it, which is the only moment
  the coverage is cheap.

### Patch Changes

- 7cdbcbb: fix(plugin-hono-server): surface a repeated query parameter as an array, matching the platform convention (#6878)

  **Behaviour change, not a refactor.** On the Hono server, a repeated query
  parameter — `?version=1.0.0&version=2.0.0` — used to reach your handler as the
  single string `'1.0.0'`. It now reaches it as `['1.0.0', '2.0.0']`. A
  single-valued key is unchanged: still a plain string.

  This is the ruled intent of #6878 (route 2, cli-lane seat ruling of
  2026-08-10), not an incidental cleanup.

  **Why the old behaviour was a problem.** The platform ships two `IHttpServer`
  implementations, and they answered the same request differently. The reference
  `NodeHttpServer` reads `url.searchParams.getAll(key)` and keeps the array; the
  Hono adapter read `c.req.query()`, which returns only the first value per key.
  Both satisfied the declared contract — `IHttpRequest.query` is
  `Record< string, string | string[] >` — so neither had a bug, yet the
  platform's answer to "what is a repeated parameter?" depended on which server
  had booted.

  The consequence was not cosmetic. A handler cannot refuse an ambiguity it
  cannot see: #6307 found `DELETE /api/v1/packages/:id` silently narrowing a
  destructive operation's scope from a repeated `version`, and its fix (refuse
  repetition with a `400`) was unreachable on the Hono server because the
  transport had already collapsed the duplicate. Duplicates now reach the
  handler on both servers, where the rest-side gates landed in #6877 (PR #7324 —
  63 single-valued parameter slots) and #7321 (PR #7386) refuse them explicitly.

  **Both construction sites moved.** The adapter builds `IHttpRequest.query` at
  the route-handler seam _and_ inside the `use()` middleware seam; both now go
  through one `readQuery(c)` helper, so middleware and handlers agree.

  ⚠️ **If you read query parameters off the Hono server, check your assumptions.**
  A read point that assumed a string will now receive an array when — and only
  when — a client repeats that parameter. `String(req.query.x)` yields `"a,b"`
  and `Number(req.query.x)` yields `NaN` in that case. Handle the array, or
  refuse the repetition explicitly; do not reach back for the first value, which
  is the silent-wrong-answer shape #6878 set out to remove. The repo's own read
  points were swept and gated before this landed.

  Nothing in `packages/spec` changed: the declared union already permitted
  arrays. What changed is the platform's answer, from "depends on the server" to
  one answer.

  `@objectstack/http-conformance` gets the matching test tightening. Its
  cross-adapter case, added under #6878 route 1 (PR #6941) to _record_ the
  divergence, is collapsed into the single expected shape exactly as that file's
  own header instructed — plus a new middleware-seam case, so a half-applied
  change to only one of the adapter's two construction sites cannot pass. The
  single-value control case that catches an un-normalised `c.req.queries()`
  (which returns an array for every key, single-valued ones included) stays.

- 68feaad: test(http-conformance): a repeated query parameter is now a pinned cross-adapter fact, instead of an unrecorded disagreement

  The two `IHttpServer` implementations hand a handler two different `req.query`
  shapes for one and the same request, and until now nothing in the repo said so.
  Re-measured for this change on hono@4.12.34, over a real socket, through the
  same public entry points production uses:

  ```
  GET /probe?version=1.0.0&version=2.0.0&single=9

  [NodeHttpServer]  { version: ['1.0.0', '2.0.0'], single: '9' }   // array
  [HonoHttpServer]  { version: '1.0.0',            single: '9' }   // first value
  ```

  `NodeHttpServer` reads `url.searchParams.getAll(key)` and keeps the array when
  `length > 1`; `HonoHttpServer` reads `c.req.query()`, which yields the first
  value per key.

  **Neither adapter is wrong.** `IHttpRequest.query` is declared
  `Record<string, string | string[]>` and both shapes satisfy it, so this is a
  divergence the contract currently permits — not a bug on either side. What was
  missing was any gate recording it: the platform's answer to a repeated query
  parameter depends on which server booted, and this package exists precisely to
  assert that everything registered through `IHttpServer` behaves the same on a
  non-Hono server.

  The node half was already pinned, but only adapter-locally (`adapter.test.ts`,
  `?a=1&b=x&b=y`). Neither `describe.each(ADAPTERS)` suite repeated a parameter at
  all, so the one place the adapters visibly disagree was the one place the
  cross-adapter suite was not looking. Consumer-side tests do not cover it either:
  `packages/rest`'s `package-routes-query-multiplicity.test.ts` (#6307)
  hand-constructs `query: { version: [...] }` and drives the handler directly, so
  it asserts a shape no adapter is obliged to produce.

  `query-multiplicity.conformance.test.ts` therefore **records the divergence as
  it is** rather than asserting a unified answer — there is no unified answer yet,
  and inventing one in a test file would settle #6878's open contract question
  through the back door. Each adapter row carries its measured shape, one describe
  states the disagreement out loud, and a single-valued control key separates
  "arrays repeats" from "arrays everything".

  This is route 1 of #6878 only. Both adapters' behaviour is unchanged and
  `packages/spec/src/contracts/http-server.ts` is untouched; the choice between
  "always array" and "always single" stays open on that card. When it is decided,
  this file goes red on purpose — that red is the reminder to collapse the
  per-adapter rows into one shared expectation.

- Updated dependencies [82da264]
- Updated dependencies [f586f1a]
- Updated dependencies [b127c8b]
- Updated dependencies [d6d1a50]
- Updated dependencies [d0d5205]
- Updated dependencies [28d1eb7]
  - @objectstack/core@17.0.0-rc.6

## 0.0.6-rc.4

### Patch Changes

- Updated dependencies [1363084]
  - @objectstack/core@17.0.0-rc.5

## 0.0.6-rc.3

### Patch Changes

- Updated dependencies [29c6c9d]
- Updated dependencies [b746aa0]
- Updated dependencies [eb3e650]
- Updated dependencies [0f2fdcd]
- Updated dependencies [8ffa8b9]
- Updated dependencies [674ac99]
- Updated dependencies [46365ab]
- Updated dependencies [c5adfe1]
  - @objectstack/core@17.0.0-rc.4

## 0.0.6-rc.2

### Patch Changes

- Updated dependencies [98877c9]
- Updated dependencies [833b512]
- Updated dependencies [071d0dc]
  - @objectstack/core@17.0.0-rc.2

## 0.0.6-rc.1

### Patch Changes

- Updated dependencies [32ccb23]
- Updated dependencies [2af1988]
- Updated dependencies [0af50a3]
- Updated dependencies [2e836de]
- Updated dependencies [3c628ce]
- Updated dependencies [45dc446]
- Updated dependencies [f985b3f]
- Updated dependencies [7777e8f]
- Updated dependencies [7ce02eb]
- Updated dependencies [d13004a]
- Updated dependencies [be7360c]
- Updated dependencies [857a6cf]
- Updated dependencies [d92c72d]
- Updated dependencies [e4c2dc8]
  - @objectstack/core@17.0.0-rc.1

## 0.0.6-rc.0

### Patch Changes

- Updated dependencies [879ea13]
- Updated dependencies [a227ed7]
- Updated dependencies [763931e]
- Updated dependencies [4cca74c]
  - @objectstack/core@17.0.0-rc.0

## 0.0.5

### Patch Changes

- Updated dependencies [b20201f]
  - @objectstack/core@16.1.0

## 0.0.4

### Patch Changes

- Updated dependencies [e057f42]
- Updated dependencies [dd9f223]
- Updated dependencies [5f05de2]
- Updated dependencies [021ba4c]
- Updated dependencies [290e2f0]
  - @objectstack/core@16.0.0

## 0.0.4-rc.1

### Patch Changes

- @objectstack/core@16.0.0-rc.1

## 0.0.4-rc.0

### Patch Changes

- Updated dependencies [e057f42]
- Updated dependencies [dd9f223]
- Updated dependencies [5f05de2]
- Updated dependencies [021ba4c]
- Updated dependencies [290e2f0]
  - @objectstack/core@16.0.0-rc.0

## 0.0.3

### Patch Changes

- @objectstack/core@15.1.1

## 0.0.2

### Patch Changes

- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
  - @objectstack/core@15.1.0
