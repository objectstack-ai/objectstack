---
"@objectstack/rest": patch
---

fix(rest): expected 4xx no longer logged as "[REST] Unhandled error" with a stack (#4886)

Opening Studio flooded the server log with stack traces. The designer probes
`GET /meta/:type/:name?state=draft` on every panel to decide whether to show
"unsaved draft" state, and "no draft exists" is the overwhelmingly common
answer — true of every artifact nobody is currently editing. `getMetaItem`
throws a structured `{ code: 'NO_DRAFT', status: 404 }`, the client got a clean
404 and handled it fine, but the route logged it anyway:

```
[REST] Unhandled error: Error: [no_draft] No pending draft exists for app/showcase_app.
    at _ObjectStackProtocolImplementation.getMetaItem (…)  { code: 'NO_DRAFT', status: 404 }
```

**45 of these in one browsing session** — by far the dominant entry in the log,
which is how a genuine 500 goes unnoticed, and it misreports severity: nothing
was broken.

The metadata routes had 29 catch blocks logging unconditionally. The data
routes already consulted `isExpectedDataStatus` / `isExpectedQueryRejection` —
but in four different open-coded spellings across 12 sites, and
`isExpectedQueryRejection`'s docblock records an earlier lap of exactly this
drift (the filter and sort codes shipped without joining the list, so every
rejection they produced was logged as unhandled too).

Both families now decide through one predicate behind one door,
`handleRouteError(res, error, object?)`: it resolves the response once — the
same structured-status passthrough or `mapDataError` envelope `sendError`
already produced — logs only when that resolved response is a genuine fault,
then sends it. `isExpectedDataStatus` and `isExpectedQueryRejection` have no
other callers left, so the two families cannot drift apart again.

Expected now means an explicitly recognised client or lifecycle outcome:
403/404/409/502/503, the client-caused 400 query-rejection vocabulary, and
`VALIDATION_FAILED`. It deliberately does **not** mean "any 4xx" —
`mapDataError` degrades an error it recognised nothing about to an un-coded
400, and that bucket is where a real handler bug lands, so it stays loud.

**No wire responses change** — every status and body is byte-for-byte what it
was; this only decides whether the log line is printed. Two operator-visible
log deltas beyond the metadata fix:

- the cross-object transactional batch route judged on `status >= 500` alone,
  which also swallowed that un-coded 400 — a handler `TypeError` inside a batch
  transaction used to vanish, and now prints;
- `updateMany` / `deleteMany` / clone / global search / the public-form routes
  stop logging normal 404s, 403s and query rejections.
