---
"@objectstack/service-analytics": patch
---

fix(service-analytics): thirteen caller-shaped analytics refusals answer 4xx from their own envelope instead of `500` (#5716)

**Observable behaviour change — read this if you alert, retry, or assert on status.**
Thirteen refusal conditions in `service-analytics` (twelve `throw` sites — the
cross-object measure and filter share one) used to reach the caller as
`500 {"code":"ANALYTICS_QUERY_FAILED"}` on `POST /analytics/dataset/query`, and as
`500 {"code":"INTERNAL_ERROR"}` on `POST /analytics/query`. They now answer **400** —
`DATASET_INVALID` for the seven that are a verdict about the dataset or the whole
selection, `INVALID_FIELD` for the six that name one member of the request:

| refusal | now |
|---|---|
| dataset JOIN crosses datasources (#5115) | `DATASET_INVALID` / 400 |
| `include` names a relationship the object does not have | `DATASET_INVALID` / 400 |
| `include` path past the 3-hop limit | `DATASET_INVALID` / 400 |
| a `dateRange` bound that is not a date | `DATASET_INVALID` / 400 |
| `compareTo` names a timeDimension with no `dateRange` | `DATASET_INVALID` / 400 |
| `compareTo` with no dated window to shift | `DATASET_INVALID` / 400 |
| `compareTo` ambiguous between two dated windows | `DATASET_INVALID` / 400 |
| cube declares no such measure (#4157) | `INVALID_FIELD` / 400 |
| ObjectQL: cross-object time-dimension bucket | `INVALID_FIELD` / 400 |
| ObjectQL: cross-object measure | `INVALID_FIELD` / 400 |
| ObjectQL: cross-object filter | `INVALID_FIELD` / 400 |
| ObjectQL: multi-hop cross-object dimension | `INVALID_FIELD` / 400 |
| ObjectQL: non-recombinable measure over a cross-object dimension | `INVALID_FIELD` / 400 |

Monitoring that counted these as server errors will see a 5xx disappear and a 4xx
appear, and a client retrying on 5xx will stop retrying a request that cannot
succeed until the request or the dataset changes. **No refusal condition moved and
no message was reworded** — the same inputs are refused, in the same words; only
the envelope is new. (The messages are load-bearing beyond readability: #5923's
tests assert the `planCrossObject` wording, and #5717 tracks one compiler message
for colliding with a downstream sniffer.)

## What was wrong

#5352 gave the dataset route a list of message SUBSTRINGS so six refusal families
could answer 400, and #5367 retired five of those entries by giving their
producers an ADR-0112 envelope. Both rounds worked from that list — and the list
was only ever the refusals someone had already hit. Reading every `throw` in the
package afterwards found thirteen more of exactly the same kind, which had never
been on it: a typo in `compareTo`, a `dateRange` the dashboard sent, a dataset
whose `include` names a relationship that does not exist. Each answered "the
platform is broken" for a mistake the caller or the author could fix, on both
analytics faces.

**Both faces move, measured.** `/analytics/dataset/query` reads the envelope in
its catch (#5352); `/analytics/query` exits through
`dispatcher-plugin.errorResponseBase`, which already adopts a thrown `status` and
carries the `code` (#3867/#3842) — so the cross-object refusals go from
`500 INTERNAL_ERROR` to `400 INVALID_FIELD` there as well, without touching that
route. The open question #5811 tracks on that face is about *withholding the
message of a declared 5xx*, which none of these are.

## Why two codes

`dataset-refusal.ts` gains a second constructor, `invalidMemberError`
(`INVALID_FIELD` / 400 + `member`/`param`/`cube`), beside `datasetInvalidError`.
The split is by what the refusal is a verdict ABOUT: the dataset/selection as a
whole, or one member the request named. The member family is `INVALID_FIELD`
because the three shipped analytics gates already answer exactly that for the
NEIGHBOURING member-level mistakes on the same request keys — `measures` (#4437),
`dimensions`/`timeDimensions` (#5520), `where` (#5669) — so one class of mistake
keeps one wire shape; and because these six fire on `/analytics/query` too, where
there is no dataset for `DATASET_INVALID` to be about. No new code is registered:
both are already in the ADR-0112 vocabulary.

## What deliberately did NOT change

`native-sql-strategy`'s "measure … has unrecognised type" stays a bare `Error`
(an undeclared 500) although #5716 listed it as author-shaped. Measured:
`Metric.type` is the closed `AggregationMetricType` enum, `metric-type-coverage.test.ts`
pins that the strategy handles every member of it, the dataset compiler writes
only `SUPPORTED_AGGREGATES` into a cube, and `inferMeasure` mints six known types
— so no spec-valid cube can reach it. An arrival is our own drift or a host
registering an unparsed cube, and blaming the caller would hide a platform fault
from 5xx alerting. The two "Cube not found" guards and the two operator-drift
throws stay bare for the same reason.

Coverage: `unlisted-refusal-envelope.test.ts` (service-analytics) drives all
thirteen refusals through the real producers — one block pinning that the refusal
SET and its wording are unchanged, one pinning the envelope, one pinning the
verdicts that stay 500; `analytics-dataset-unlisted-refusal-envelope.test.ts`
(rest) drives eleven of them end-to-end through the route with a real
`AnalyticsService`, plus three positive controls and the two sites that route
cannot reach (with the measurement that explains why).
