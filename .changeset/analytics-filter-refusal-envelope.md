---
"@objectstack/service-analytics": patch
"@objectstack/rest": patch
---

fix(analytics,rest): an analytics filter refusal reaches the caller as `400 INVALID_FILTER`, not `500 ANALYTICS_QUERY_FAILED` (#5352)

Misspell an operator in a dashboard widget's filter and analytics refuses it —
correctly, and loudly, which is the posture #3948 / #5240 / #5325 / #5334 each
argued for one refusal at a time: dropping a predicate the compiler cannot
express does not narrow the query, it **widens** it to rows the author excluded,
and a chart drawn over the whole dataset looks like a working chart.

The refusal never reached the author. It landed as `500 ANALYTICS_QUERY_FAILED`
— read as "the platform is broken" rather than "your filter has a typo", and
counted by ops alerting as a 5xx. The identical mistake on `find()` has answered
`400 INVALID_FILTER` since #3948, so one authoring error had two wire shapes,
chosen by which face happened to catch it.

**One defect, two halves — either alone leaves it unfixed.**

- **Producer** (`filter-normalizer.ts`): seven of its nine refusals were bare
  `throw new Error(…)` carrying no `code`/`status`. All nine now go through the
  `invalidFilterError` helper #5334 introduced (`INVALID_FILTER` / 400), which
  becomes the module's only way to refuse.
- **Consumer** (`rest-server.ts`, `POST /analytics/dataset/query`): the catch
  discarded `error.code` / `error.status` and re-derived the classification from
  a hardcoded list of message substrings — so a producer that took ADR-0112
  seriously was punished for it. It now reads the envelope **first**; the
  substring list is demoted to a fallback for the families that still carry no
  envelope.

**Observable behaviour change — read this if you alert or retry on status.**
The same request that returned `500 ANALYTICS_QUERY_FAILED` now returns
`400 INVALID_FILTER` (and, for two neighbouring conditions whose producers
already declared an envelope this route was discarding, `400 INVALID_FIELD` for
a measure over a field the object does not have, `404 CUBE_NOT_FOUND` for an
unregistered cube). Monitoring that counted these as server faults will see the
5xx rate drop and a 4xx rate appear; a client that retries on 5xx will stop
retrying a request that could only ever fail the same way. Both are the intended
correction — the condition was always the caller's mistake — but they are
visible, so they are stated rather than buried.

**Which inputs are refused did not change.** This changes the SHAPE of the
error and nothing about the judgement that produced it: no refusal condition
was touched, no input that used to compile now refuses, and no input that used
to refuse now compiles. That claim is pinned input-by-input (refusals *and*
accepted inputs with their compiled trees) in
`filter-refusal-envelope.test.ts`, which is green both before and after the
change — only the envelope assertions move.

The message-substring list survives on purpose. All six of its entries were
re-verified as bare `Error`s (`dataset-compiler.ts`, `native-sql-strategy.ts`,
`dataset-executor.ts`, `read-scope-sql.ts`), so deleting it would regress those
families from `400 DATASET_INVALID` to 500. It is a placeholder for their
enveloping, not a second classification mechanism, and it is now documented as
such: a new refusal should carry a `code`/`status` and be served by the
envelope branch for free. The passthrough is deliberately **4xx-only** and
requires **both** `code` and `status`, so an internal fault can never be
re-labelled as the caller's fault, and this route never invents a code a
producer failed to supply.
