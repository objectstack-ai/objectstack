---
'@objectstack/scenarios': patch
---

fix(scenarios): a write the card gives a persona that the build denies it is charged to the build, not the operation

Clause-②: yes (widening) — new exports `buildDeniesWrite` and `isWriteDenial` (`./score`, `./score/full`), `probesBuildDenial` (`.`), `buildDenialFindings` (`./runner`); new optional fields `OperationGrade.notMeasured` (`./score`, `./score/full`) and `OperationResult.buildDenial` (`./runner`)
Metadata-protocol: none

An operation declared `applied` whose agent write was refused 403 `PERMISSION_DENIED` counted as the operation's failure, even when the built app's permission set denied the persona a write the card gives it: the loss landed on the asking side for a build error.

The runner now sends the declared write itself as the persona when the agent's own write on an `applied` create or update was denied 403 and nothing was written. When the door denies the probe too, and the build declares no lock that routes the write through an action, the operation is not measured ("the build denies the persona this write"): out of passed and total, and the scorecard lists a Build finding naming the persona, the object and the verb. The `write_validation` probe that meets the same 403 is reported the same way. A 403 the card declares (`refused PERMISSION_DENIED`) and a `pending_confirmation` operation grade as before, and the probe that meets the build's routed lock keeps its own not-measured reason.
