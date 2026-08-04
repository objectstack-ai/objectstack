---
"@objectstack/objectql": patch
---

fix(objectql): a bulk write blocked by a `previous` hook condition is told it is a VERSION limit, not an authoring mistake (#5037)

#4775 made an unevaluable hook `condition` abort the operation, and #4861 gave
the predicate-bulk-write case its own sentence instead of a raw
`Unknown variable: previous`. What that sentence still said was
*"rewrite the condition without `previous`, or target the write at one record"* —
written before the maintainer's 2026-08-04 ruling on #4800/#4862, and wrong in
its most important claim. The ruling settled the contract: **on a bulk write,
after-hooks and record-change flow triggers evaluate and fire per row** (recorded
as an ADR-0058 addendum, implemented by #5038). The author's transition condition
is legitimate; the engine is what is behind. Telling them to drop `previous` was
advising a silent semantic change — a transition ("just became done") becomes a
state test ("is done"), which fires on every row that was already done.

The rejection now says what is actually true:

- it names the batch and why there is no single prior record to bind, as before;
- it states this is a **current-version limitation**, cites the per-row contract
  (ADR-0058 addendum, #4800/#4862) and the issue that retires the rejection
  (#5038);
- it leads with the route that works today — target the write at one record, and
  the same condition evaluates as authored — and prices the rewrite instead of
  recommending it;
- it still refuses to point at a record-change flow trigger as a way out, which
  remains verified rather than assumed: that trigger binds the same lifecycle
  hooks and receives the same unbound `previous` on a bulk write (#4862).

**Machine-readable, so a caller never parses the prose.** `HookConditionError`
gains `limitation?: 'bulk_write_previous_unbound' |
'bulk_write_stored_state_unavailable'` (exported as `HookConditionLimitation`)
alongside the existing `predicateBulkWrite` flag. It is deliberately *not* named
`code`: ADR-0112 makes `error.code` a closed wire vocabulary
(`StandardErrorCode` ∪ `ERROR_CODE_LEDGER`) and `rest-server.ts` promotes a
thrown error's `.code` onto the response envelope, so a `.code` here would mint
an unregistered wire code as a side effect. A code that needs to travel goes
through the ledger as a decision.

**"Does this condition read `previous`" is now read off the parsed CEL AST**
(`collectCelRootIdentifiers`, the utility #4972's build gate already uses),
computed once at wrap time, with the old fault-text check kept as a fallback.
The diagnosis no longer depends on cel-js's wording, and it stays correct when
the evaluator faults on some other key the same condition reads.
`record.previous_status` is not a `previous` reference — the AST reports roots,
not member names — so it keeps the declared-field diagnosis, whose remedy is the
right one there.

Unchanged, and pinned by tests: single-record writes (bound `previous`, condition
evaluates, handler runs), bulk writes whose conditions do not name `previous`,
the plain undeclared-key typo report on a bulk write, and fail-loud itself — the
write still fails. Nothing here is an exemption; it is the same rejection with a
diagnosis attached.
