---
'@objectstack/service-automation': patch
---

feat(service-automation): a suspended run resumes on the flow body it started on, not on the definition registered under its name (#28405)

Clause-②: yes (widening: a nullable `flow_checksum` column on `sys_automation_run`, the optional `SuspendedRun.flowChecksum`, and `AutomationEngine.setFlowHistorySource` with its exported `FlowHistorySource` type)
Metadata-protocol: none

An approval or screen step can wait for days. A flow republished meanwhile used to move the waiting run onto the new definition, or end it `RUN_NOT_FOUND` when its parked node was renamed. A customer can now change a flow without breaking the runs already in flight.

- **What a run records.** At its pause, the content checksum of the body it is executing: `hashSpec(body, 'flow')`, the checksum `sys_metadata_history` keys a stored flow's versions by. It is kept in the new `sys_automation_run.flow_checksum` column. `flow_version` stays the author's display number, which two bodies can share.
- **What a resume runs.** The body with that checksum: the armed definition when it matches, else the stored version read back from the metadata history (`getByHash`), else a body this process registered under the name (a code-loaded one). The pre-flight `unresumableSuspensionCause` classifies through the same read. New runs keep starting on the armed definition.
- **Unchanged.** A row written before this column (no checksum) resumes on the armed definition, its node checked, as before. A flow no longer registered at all is still `RUN_NOT_FOUND`.
- **A pinned body that cannot be recovered anywhere** (a code package upgraded under the run) resumes on the armed definition, node checked, and logs a `warn` naming the flow version and checksum it could not recover.
- **A metadata history that cannot be read** answers the retryable `STORE_UNAVAILABLE` and leaves the run parked, as an unreadable suspended-run store already does.
