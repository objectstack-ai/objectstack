---
"@objectstack/plugin-audit": patch
---

A lost auth-event row is reported once per failure CAUSE, not once per process, and the first line names the cause instead of a fixed remedy.

`auth-event-audit.ts` — the writer behind the `login` / `logout` rows in `sys_audit_log` — carried its own, independent copy of both defects the record-level audit writer was fixed for. `reportAuthEventWriteFailure` deduped on a single process-wide boolean, so after the first failure of any cause, every later failure of every *other* cause degraded to `debug` for the life of the process: a long-running server could keep losing sign-in and sign-out rows for hours to a second, unrelated fault, with one `error` line at the top of the log describing the first. `persistAuthEventAuditRow` is registered in the durability-degradation vocabulary precisely because a lost audit row must be reported at `error`.

The dedupe key is now the failure's identity — the error `code` (or its absence) together with the object the rows are about. A repeat of an already-reported cause still degrades to `debug`, exactly as before; a new cause reports at `error`, once. The key is built from the `code` and **never** the message: a driver names the offending row in its message, so a message-keyed dedupe would grow one `error` line per lost row. Keyed on the code, the reported-cause set is bounded by the driver's code vocabulary and does not grow with traffic — measured at one `error` line for 200 failed sign-ins carrying 200 distinct messages under one code, and the same one line for 200 carrying no code at all.

The first `error` line now leads with the underlying code and message, which were already computed at the call site and passed only into the `debug` payload. The ADR-0057 §3.6 telemetry-datasource guidance is kept — it is the correct remedy for the "no such table" cause it was written for — but is now printed only for that cause, decided by the shared `isMissingTableError` predicate for the one table this writer writes. Previously it was printed unconditionally, so an organization refusal was answered with "check the datasource", sending the operator to inspect something that was working.

The cause-key helpers are imported from the record-level writer in this same package rather than re-spelled here: a second copy of that key is how these defects reached this file, so a third spelling would repeat the mistake. No published export is added or changed.
