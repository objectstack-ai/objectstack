---
"@objectstack/plugin-audit": patch
---

A lost audit row is reported once per failure CAUSE, not once per process, and the first line names the cause instead of a fixed remedy.

`reportAuditWriteFailure` — the best-effort catch around `persistAuditTrailRow` — deduped on a single process-wide boolean. After the first failure of any cause, every later failure of every *other* cause degraded to `debug` for the life of the process, so a long-running server could keep losing compliance rows for hours to a second, unrelated fault with one `error` line at the top of the log describing the first. `persistAuditTrailRow` is registered in the durability-degradation vocabulary precisely because a lost audit row must be reported at `error`.

The dedupe key is now the failure's identity — the error `code` (or its absence) together with the object being audited. A repeat of an already-reported cause still degrades to `debug`, exactly as before; a new cause reports at `error`, once. The key is built from the `code` and **never** the message: a driver names the offending row in its message, so a message-keyed dedupe would grow one `error` line per failed write. Keyed on the code, the reported-cause set is bounded by the boot-declared object registry and the driver's code vocabulary and does not grow with traffic — measured at 65 lines for 6,500 failed writes and the same 65 for 26,000.

The first `error` line now leads with the underlying code and message, which were already computed at the call site and passed only into the `debug` payload. The ADR-0057 §3.6 telemetry-datasource guidance is kept — it is the correct remedy for the "no such table" cause it was written for — but is now printed only for that cause, decided by the shared `isMissingTableError` predicate for both tables this writer writes. Previously it was printed unconditionally, so an organization refusal was answered with "check the datasource", sending the operator to inspect something that was working.

`@objectstack/types` is added as a dependency for that predicate, rather than hand-rolling a second driver-error vocabulary.
