---
"@objectstack/types": minor
"@objectstack/runtime": minor
"@objectstack/rest": patch
---

fix(runtime,types)!: `/analytics/query` no longer echoes RLS policy field names — the declared-server-fault withhold is shared by both HTTP boundaries (#5811)

**Observable behaviour change — read this if you read, log, or assert on
`error.message` from a dispatcher-plugin route.** An error that **declares a
server fault** in the ADR-0112 envelope (`status >= 500` *and* a non-empty
`code`) now leaves `dispatcher-plugin.errorResponseBase` with its message
replaced by `"Internal server error"`. It previously reached the caller verbatim
unless it happened to *sound* like a SQL/driver dump. This applies to every route
that plugin mounts — `/analytics`, `/packages`, `/i18n`, `/automation`, `/auth`,
`/notifications`, `/mcp`, … — not only the one that motivated it. Nothing a
machine reads changed: the producer's `code` still arrives in the response
(`error.code`, promoted there from `details` by the shared envelope builder,
#3842), the status is untouched, and the full original text still goes to the
server log and `errorReporter` via `__obsRecordedError`.

## What was wrong

#5367 (maintainer ruling 2026-08-06) made `read-scope-sql.ts`'s ten fail-closed
RLS lowering refusals `READ_SCOPE_COMPILE_FAILED` / 500 and taught
`POST /analytics/dataset/query` to withhold their message, because those messages
name the field names and comparands of an **administrator's** sharing rule:

```
[read-scope-sql] unsafe field identifier "secret_policy_field" — refusing to
build read scope (fail-closed).
```

The caller never wrote that field name and must not be able to read it out of an
error body. But the **sibling** analytics face was never closed.
`compileScopedFilterToSql` runs on both `NativeSQLStrategy.applyReadScope` and
`ObjectQLStrategy`'s echoed SQL, both of which serve `POST /analytics/query`,
which exits through `dispatcher-plugin.errorResponseBase`. That exit's only
message guard was `looksLikeInternalErrorLeak` — a heuristic over SQL/driver
*phrasing* — and all eleven read-scope message shapes return `false` from it.
Measured at that boundary: **11 of 11 echoed verbatim**, at 500, with the policy
content in `error.message`. A real reachable disclosure, not a theoretical one.

## What changed

- **`@objectstack/types` gains `declaresServerFault(err)`**, exported from
  `error-leak.ts` beside `looksLikeInternalErrorLeak`. The heuristic asks whether
  a message *sounds* internal; the declaration asks whether the producer *said
  so*. `error-leak.ts`'s own file header already states the principle — "do not
  ship driver internals to clients" is a property of the HTTP boundary, not of
  one router — and this is the second predicate that principle asks for.
- **Both boundaries read it.** `dispatcher-plugin.errorResponseBase` gains the
  withhold (the fix); `rest-server.ts`'s `/analytics/dataset/query` catch drops
  its in-line copy of the same test in favour of the shared one. #5808 wrote that
  rule in-line on purpose — promoting a rule with one consumer is a speculative
  surface — and this is the second consumer, so it was promoted rather than
  duplicated (`#3843`/`#3867` paid for the two-implementations shape twice).
  The REST face's verdict is unchanged in every case: same `status >= 500` plus
  non-empty `code` test, over the same two fields.

## What deliberately did NOT change

- ⛔ **This is not "withhold every 5xx".** #5667 kept **undeclared** 5xx errors
  legible on purpose: a bare `Error` from our own code ("no strategy can handle
  query …") is the operator's own bug report, names nothing tenant-sensitive, and
  still falls to `looksLikeInternalErrorLeak` alone. A 5xx carrying only half an
  envelope (a status with no code) is likewise still readable — inventing the
  withhold for it would be the consumer-side leniency Prime Directive #12 removes.
- **4xx is untouched.** `declaresServerFault` requires `status >= 500`, so a
  deliberate business/validation answer can never be swallowed by it.
- **`statusCode` is not accepted as a substitute for `status`.** `status` is the
  channel ADR-0112 declares; making a disclosure rule depend on which spelling a
  producer reached for would be the same leniency in a different place.
- **The heuristic was not taught to recognise `[read-scope-sql]`.** That would be
  more prose sniffing — the mechanism #5352/#5367 exist to remove — and would only
  ever cover the family someone remembered to add.

Coverage: `analytics-query-read-scope-withhold.test.ts` (runtime) drives six RLS
policy shapes end-to-end through a **real** `AnalyticsService` on the real
native-SQL path and the real mounted route, asserting the 500, that the whole
serialized body contains no policy detail, that `error.code` still carries
`READ_SCOPE_COMPILE_FAILED`, and that the full text is still on the
`__obsRecordedError` side-channel — plus a positive control and both sides of the
declared-vs-undeclared tiering. `error-leak.test.ts` (types) pins the predicate
directly, including that all eleven read-scope shapes stay invisible to the
heuristic. The REST face's existing `analytics-read-scope-refusal-envelope.test.ts`
is green before and after, unchanged, which is the pin on the refactor.
