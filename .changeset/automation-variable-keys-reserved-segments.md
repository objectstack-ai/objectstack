---
'@objectstack/service-automation': minor
'@objectstack/spec': patch
'@objectstack/runtime': patch
---

fix(service-automation)!: automation variable keys cannot use reserved object segments, and one run's writes never change a flow's defaults

Clause-②: no (narrowing)
Metadata-protocol: narrowed

<!-- adr-0087: registered flow-variable-key-reserved-segment-refused -->

- **BREAKING: a flow variable key may not use `__proto__`, `constructor` or `prototype` as its name or as any dot-separated part of it.** Registration (and `os migrate meta --stored`, which previews it) judges every key a flow names, in every graph it holds: each node's `id` (it heads every key the node's output is stored under), each declared variable's `name`, each `assignment` node's targets in every shape, each node's `outputVariable`, `iteratorVariable`, `indexVariable`, `errorVariable` and `idVariable`, and each `screen` field's `name`. A name is judged with surrounding whitespace trimmed.
  - FROM: a flow naming such a key registered.
  - TO: the flow is refused at registration, and the refusal names every such key and where it sits. A name that only contains one of the three words (`constructor_name`, `prototype_count`) is unaffected.
  - The fix: rename the key, for example `constructor` to `constructor_name`, and save the flow again.
- **BREAKING: a resume signal may not carry such a key.** Each key of a caller's `output` and `inputs` is judged, a signal handed on to a paused subflow child included; the engine's own continuations (a `map` item handing back, a subflow child finishing) are not, so a run paused before this release still completes.
  - FROM: such a key in `output` was accepted; in `inputs` on a screen with declared fields it answered 400 under `INVALID_SCREEN_INPUT`.
  - TO: the resume answers `INVALID_SIGNAL` before anything reads the submitted values; nothing is applied, and the run stays paused for a valid submission.
  - The fix: send the screen's declared field names, and `output` keys without those segments.
- **BREAKING: one run's writes never change a flow's defaults, another run's values, or the record the run was handed.** Each run binds its own copy of a declared variable's object or list default, and of the trigger record (`record` and `$record`). A dotted write whose head names a value the run holds (`cfg.mode` over a declared `cfg`, `record.x` over the trigger record) is read back by the run's expressions (conditions and CEL values); the value itself keeps what it was, and a text hole (`{{ cfg.mode }}`) and `$record` read the value. With no durable suspended-run store, a resumed run works on its own copy of its variables, as a stored run does.
  - FROM: such a write also changed the value it named: a text hole and `$record` read the write, the next run of the flow started from the changed default, and a node that changed the record in place changed the trigger's object.
  - TO: only the run's expressions read the write; text holes, `$record`, the flow's default, the next run and the trigger's object do not.
  - The fix: to show or keep a value a run computed, assign it to a variable of its own (`assignments: { mode_now: { dialect: 'cel', source: 'cfg.mode' } }`) and read that variable in the text hole or the later step.
