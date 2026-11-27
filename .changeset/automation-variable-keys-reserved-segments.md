---
'@objectstack/service-automation': minor
'@objectstack/spec': patch
'@objectstack/runtime': patch
---

fix(service-automation)!: automation variable keys cannot use reserved object segments, and one run's writes never change a flow's defaults

Clause-②: no (narrowing)
Metadata-protocol: narrowed

<!-- adr-0087: not-required (no-migration-prescription) No schema key, accepted value, export or stored row is added, removed, renamed or re-shaped, and the spec schemas accept exactly what they accepted. What moves is what the automation engine registers and resumes: a flow naming a variable key with a reserved segment is refused at registration, and such a key in a resume signal is refused; there is nothing for a migration to rewrite and no tombstone. -->

- **BREAKING: a flow variable key may not use `__proto__`, `constructor` or `prototype` as its name or as any dot-separated part of it.** Registration (and `os migrate meta --stored`, which previews it) judges every key a flow names: each declared variable's `name`, each `assignment` node's targets in every shape, each node's `outputVariable`, `iteratorVariable`, `indexVariable` and `errorVariable`, and each `screen` field's `name`.
  - FROM: a flow naming such a key registered.
  - TO: the flow is refused at registration, and the refusal names every such key and where it sits. A name that only contains one of the three words (`constructor_name`, `prototype_count`) is unaffected.
  - The fix: rename the key, for example `constructor` to `constructor_name`, and save the flow again.
- **BREAKING: a resume signal may not carry such a key.** Each key of a signal's `output` and of its `inputs` is judged.
  - FROM: such a key was accepted.
  - TO: the resume answers `INVALID_SIGNAL` before anything reads the submitted values; nothing is applied, and the run stays paused for a valid submission.
  - The fix: send the screen's declared field names, and `output` keys without those segments.
- **One run's writes never change a flow's defaults or another run's values.** Each run binds its own copy of a declared variable's object or list default. A dotted write whose head names a value the run holds (`cfg.mode` over a declared `cfg`, `record.x` over the trigger record) is read back by the run that wrote it, and leaves the held value as it was: the flow's default, the trigger's record object, and `$record`. With no durable suspended-run store, a resumed run works on its own copy of its variables, as a stored run does. Nothing to change.
