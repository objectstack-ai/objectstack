---
'@objectstack/connector-mcp': patch
'@objectstack/plugin-email': patch
'@objectstack/service-knowledge': patch
'@objectstack/service-queue': patch
'@objectstack/service-sms': patch
'@objectstack/service-storage': patch
'@objectstack/trigger-record-change': patch
---

MCP stdio, email, knowledge, queue, SMS, storage and record-trigger refusals, warnings and template descriptions no longer cite tracker numbers; each one states the decision behind it in words

Clause-②: no

Some strings these seven packages show to operators, administrators and flow authors pointed at an issue-tracker number for the reason behind them. The number goes; where the sentence did not already say what was decided, it now does.

- `@objectstack/connector-mcp`: the declarative stdio refusals say a stdio transport launches a local process, so stack metadata may only name a command the host's own code allows, and that an http transport is not gated by this policy.
- `@objectstack/plugin-email`: the built-in change-email notice template's description, in all four locales, says the notice goes to the previous address so a hijacked session cannot move the account identity unannounced; the internal-headers refusal says a missing header does not announce itself, so the send would succeed while silently deviating from what was authored; the over-limit attachments line says the storage capability holds large content outside the row while the row keeps a reference and the attachment's audit metadata.
- `@objectstack/service-knowledge`: the no-identity retrieval warning says a missing identity is not a grant of authority, so retrieval fails closed rather than searching the whole corpus unscoped; the predicate-write warning says the lifecycle reap guard de-indexes retention-swept rows before they are deleted.
- `@objectstack/service-queue`: the missing-retention refusal says the one platform reaper sweeps completed rows by that declaration, so the adapter does not sweep the table itself; the rejected-floor error says the floor is what makes the lifecycle service refuse an override below the idempotency window.
- `@objectstack/service-sms`: the unreadable-counter warning says a quota the platform cannot count must not refuse the one-time codes users sign in with; the counter store's lines name the daily SMS send quota without a number.
- `@objectstack/service-storage`: the reclamation-gate line says deleting bytes cannot be undone, so it waits for a verified migration with no deviation on record, while reversible work carries on.
- `@objectstack/trigger-record-change`: the array-trigger warning says multi-event arrays are deferred until two independent projects need a combination other than created-or-updated.

Text only: no status, error code, field, route or control flow moves. A client or log filter that matches the old text (for example a tracker-number suffix) needs the new spelling.
