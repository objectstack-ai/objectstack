---
'@objectstack/service-automation': minor
'@objectstack/trigger-schedule': minor
'@objectstack/spec': patch
---

Time-relative sweeps are now idempotent per matched window (#10220). Previously the sweep
held no cross-tick memory, so every re-scan of the same window re-dispatched the same
records — a 5s-interval flow minted 15 duplicate reminders in ~70s, and even under a daily
cron a kernel rebuild re-dispatched the day's window.

- `@objectstack/service-automation` — new platform object `sys_flow_dispatch`: a persisted
  dispatch-claim ledger (ADR-0057 telemetry retention, 30 days), registered alongside
  `sys_automation_run` and exposed as `AutomationEngine.claim(key): Promise<boolean>` on
  the automation service surface (check-and-record; a concurrent duplicate insert re-reads
  and reports the key as already claimed). When no ObjectQL engine / registration is
  available the engine degrades to in-process dedup and logs the weakened guarantee once;
  when the ledger errors, the claim falls back to the in-process check for that key so a
  store outage never blocks a dispatch (availability over strict-once).
- `@objectstack/trigger-schedule` — the time-relative sweep computes a dispatch key from
  the MATCHED WINDOW's identity and claims it before launching: offset mode keys on
  `(flowName, recordId, windowDay, offset)` — so a dateField edit that moves the window
  legitimately re-fires — and range mode keys on `(flowName, recordId, sweepDay,
  rangeSpec)`, preserving the documented `withinDays` semantic ("fires every day the
  record stays in range") while never firing twice in one day. The trigger resolves the
  claim surface structurally from the automation service; without one it dedups
  in-process and warns once.
- `@objectstack/spec` — `sys_flow_dispatch` added to `PLATFORM_OBJECTS_BY_PACKAGE` under
  `service-automation` (registry conformance).
