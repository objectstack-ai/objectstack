---
'@objectstack/plugin-audit': patch
---

**The read-audit failure report now speaks once per CAUSE instead of once per PROCESS, and prints the telemetry-datasource remedy only for the cause it is the remedy for.**

`installReadAuditWriter`'s `reportReadAuditWriteFailure` (`read-audit.ts`) carried its own process-level `failureReported` boolean and its own fixed message literal — the third independent copy of the pair #15166 fixed in `audit-writers.ts` and #17452 fixed in `auth-event-audit.ts`. Both defects were live on a seam the repo has already declared durability-critical (`persistReadAuditRows` is registered in `DURABILITY_CRITICAL_CALLEES`):

- **The first failure of any cause silenced every later failure of every other cause for the life of the process.** A server could keep losing record-view batches for hours to a second, unrelated fault with one `error` line at the top of the log describing the first — and record-view rows are written from a buffer off the request path, so no in-flight request is left to notice. The dedupe key is now the failure's identity, `auditFailureCauseKey`, imported from `audit-writers.ts` rather than re-spelled. A repeat of an already-reported cause still degrades to `debug`; a NEW cause gets its own `error` line, once.
- **The ADR-0057 §3.6 / `OS_TELEMETRY_DB` datasource guidance printed unconditionally**, so a fault with nothing to do with datasource routing (an `ERR_SYSTEM_WRITE_ORGANIZATION_REQUIRED` refusal, say) sent the operator to check something that was working. The guidance is not deleted and not weakened — it is asked for through the shared `isMissingTableError` predicate and printed for exactly the missing-table cause it was written for; every other cause now gets the driver's own verdict quoted at the head of the line plus the fix that matches it.

**Behaviour that deliberately does not change:** the once-per-degradation anti-noise rule itself (a repeat of the same cause is still one line), the `error`-then-`warn` sink fallback (#9657), and the rule that an audit failure never reaches the read.

No API, option or type moves; nothing an author writes changes.

Clause-②: no
