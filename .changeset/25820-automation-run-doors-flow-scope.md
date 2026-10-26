---
'@objectstack/runtime': patch
'@objectstack/spec': patch
---

fix(runtime): the automation run doors answer another flow's run as an unknown one

Clause-②: no
Metadata-protocol: none

- **Before.** Every `/automation/:name/runs/:runId/*` door read the run by `runId` alone, so the `:name` segment was accepted and ignored. `POST /automation/OTHER_FLOW/runs/RUNID/resume` completed another flow's paused run, `GET /automation/OTHER_FLOW/runs/RUNID` and `…/screen` served it, and `…/cancel` and `…/restore-suspension` acted on it.
- **Now.** A flow name that does not own the run, whether it exists or not, is answered exactly as the door answers a run nobody holds:
  - `POST …/resume`: `404 RUN_NOT_FOUND`, `No suspended run 'RUNID'`, the engine's own unknown-run answer.
  - `GET …/runs/:runId`: `404 RUN_NOT_FOUND`, `Execution not found`. An unknown run now carries the same code (it was the status-derived `RESOURCE_NOT_FOUND`), so the two doors onto one run agree it is not there.
  - `GET …/screen`: `404 No pending screen for run`, unchanged.
  - `POST …/cancel`: `200 { cancelled: false }` with the not-found notice.
  - `POST …/restore-suspension`: `404`, `refusal: 'RUN_NOT_FOUND'`, `No run 'RUNID' is known`.
- **Nothing is consumed.** The check runs after the doors' existing gates and before the verb, so a mismatched resume, cancel or restore leaves the run as it was. Who may act is unchanged.
- **Owner.** The run's `flowName` from `getRun`, else the suspended-run list. A service that can name neither keeps the previous answer.
- **Ledger.** `RUN_NOT_FOUND` is now registered under `@objectstack/runtime` too, since the door stamps it before the engine is asked.
