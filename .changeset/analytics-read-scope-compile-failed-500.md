---
"@objectstack/service-analytics": patch
"@objectstack/rest": patch
"@objectstack/spec": patch
---

fix(analytics,rest)!: an RLS read-scope lowering failure is a `500`, not the caller's `400` — and its policy detail no longer reaches the response (#5367)

**Observable behaviour change — read this if you alert, retry, or assert on status.**
A request whose dataset carries an RLS read scope that `read-scope-sql.ts` cannot
lower used to answer `400 DATASET_INVALID` with the refusal message echoed
verbatim. It now answers `500 ANALYTICS_QUERY_FAILED` with the message withheld
(`"Internal server error"`); the full text goes to the server log. Monitoring that
counted these as client errors will see a 4xx disappear and a 5xx appear, and a
client retrying on 5xx will now retry a request that cannot succeed until an
administrator fixes the policy. Both follow from the correction below and are
stated rather than buried.

## What was wrong

These ten fail-closed refusals were the last family `/analytics/dataset/query`
classified by **prose** — the final entry of the hardcoded message-substring list
#5352 introduced, which #5367's first PR had already shrunk from six entries to
one. Two defects in one verdict:

- **Misattribution.** `compileScopedFilterToSql(filter, alias)` receives an RLS
  `FilterCondition` the security service compiled from an **administrator's**
  sharing rule / permission set, and a join alias the **dataset compiler**
  generated. Neither is caller input — the caller's own predicate goes through
  `filter-normalizer.ts` and has answered `INVALID_FILTER` / 400 since #5352. So
  what can arrive here is a broken policy, or drift between two of our own
  components (#5557's `$regex` was literally the second case). For this request's
  caller both are a **server** fault; `400` told them to fix a request that was
  never wrong and kept the real fault out of 5xx alerting.
- **Disclosure.** A 400 echoed the message, so
  `unsafe field identifier "secret_policy_field"` and
  `unsupported operator "$regex" on "owner_email"` handed a tenant the field names
  and comparands of the RLS policy governing them.

The maintainer ruled on 2026-08-06 (option B on #5367's decision card; option A
was `READ_SCOPE_INVALID` / 422, rejected because no consumer reads a code on this
path, a 4xx misreports a condition the client cannot fix, and 422 would have left
the disclosure question to be re-decided message by message).

## What changed

- `read-scope-sql.ts` gains a module-local `readScopeCompileError` — the twin of
  `filter-normalizer.ts`'s `invalidFilterError`, and likewise **the only way the
  module refuses**. All ten sites carry `READ_SCOPE_COMPILE_FAILED` / **500**.
  `:104`'s alias-vs-field split (option C on the card) collapses under B: both
  branches answer the same verdict, pinned so the collapse is a recorded decision.
- `rest-server.ts` loses branch ② entirely. **The message-sniffing mechanism is
  fully retired** — nothing in this catch reads prose any more, and #5367's
  Prime-Directive-#12 retirement schedule ("declared, loud, tested AND removable
  on a schedule") is paid off.
- The route's 5xx branch now withholds the message of any producer that
  **declares** a server fault (`status >= 500` with a `code`). This was needed
  rather than inherited: `looksLikeInternalErrorLeak` (#3867/#5520) is a heuristic
  over SQL/driver *phrasing*, and measured, every read-scope message returns
  `false` from it — so retiring the list alone would have moved the policy content
  from a 400 body into a 500 body instead of out of the response. Teaching that
  heuristic to recognise `[read-scope-sql]` would have been *more* message
  sniffing, so the rule keys on the ADR-0112 envelope instead. **Undeclared** 5xx
  errors keep #5667's tiering, so a self-authored fault ("no strategy can handle
  query …") stays readable.
- `READ_SCOPE_COMPILE_FAILED` is registered in `ERROR_CODE_LEDGER` under
  `@objectstack/service-analytics` (ADR-0112 D3) and typed as
  `RegisteredErrorCode` at the constructor, so an unregistered code is a compile
  error. It is legible on the wire through the sibling `/analytics/query` exit,
  which puts a thrown `err.code` in `error.details.code` (#3842).

**Which inputs are refused did not change.** No refusal condition moved: nothing
that used to lower now throws, and nothing that used to throw now lowers. That is
pinned input-by-input — refusals *and* accepted read scopes with their compiled
SQL and bind params — in `read-scope-refusal-envelope.test.ts`, which is green both
before and after; only the envelope assertions move.

Coverage: `read-scope-refusal-envelope.test.ts` (service-analytics) drives all ten
sites through the real compiler; `analytics-read-scope-refusal-envelope.test.ts`
(rest) drives five policy shapes end-to-end through a real `AnalyticsService`,
asserting the 500, that the body contains no policy detail, and that the withheld
text is present in the log — plus a positive control and both sides of the
declared-vs-undeclared withhold.
