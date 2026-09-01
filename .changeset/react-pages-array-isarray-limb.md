---
"@objectstack/docs": patch
---

docs(react-pages): delete the unreachable `Array.isArray(result)` limb from the live-data sample

`ObjectStackAdapter.find()` cannot resolve to an array, so the `Array.isArray(result)`
arm the live-data sample carried could never be taken. Re-derived against objectui at
the sha this repo pins (`9602dc82`) and again at objectui `origin/main`, which agree
line for line:

- `find()` returns from five points — `{ data: [], total: 0 }` for a resource already
  memoized as missing, `{ data: [], total: 0 }` for a fresh 404 that is not an
  `enable`-block denial, two `normalizeQueryResult(...)` calls (the `$expand`/`$search`
  raw-GET path and the client-SDK path), and `return existing`, which hands back a
  promise produced by that same set.
- Both branches of `normalizeQueryResult()` return an object literal with exactly
  `data`, `total`, `page`, `pageSize`, `hasMore`. The first branch is the one that
  makes the limb dead: it tests `Array.isArray(result)` on the *transport* response and
  **wraps** a bare array into that envelope. The array case is folded before any caller
  sees it.

The sample now reads `result.data` directly, and a new paragraph under it states the
envelope contract so the reason survives the next edit. The two `kind:'react'` pages in
`examples/app-showcase` carrying the same dead limb — `crm-workbench` and
`renewals-pipeline` — were repaired in the same edit, with the derivation recorded in the
comment that already explains the neighbouring `.records` trap.

Behaviour-preserving: `.data` was read first and always won. What goes is a shape the
producer cannot emit, sitting in the page a customer — and a coding agent — copies from.
