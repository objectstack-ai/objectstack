---
'@objectstack/lint': minor
---

Add the startup open-vocabulary verdict rule — "not registered YET" and "no provider at all" are the same value, and a verdict recorded from it is never retracted (#4776).

A boot fills its registries incrementally, so asking one "is X there?" while it is still filling is fine — the answer is simply not final yet. Turning that not-yet into a **verdict and recording the verdict** is the defect: the provider registers a moment later and nothing goes back to undo the record. One showcase cold start produced three instances of the shape in three unrelated subsystems (#4769, #4771, #4772).

`findStartupRegistryVerdicts(source, { file })` is a pure decision procedure over plugin source (parsed, never executed, never type-checked). It reports two rule ids:

- `startup-open-vocabulary-verdict` — inside `constructor` / `init` / `start`, a read of a capability vocabulary ADR-0018 keeps runtime-extensible whose conclusion is **recorded** (announced in a `warn`/`error` log, cached in an instance field or module binding, or persisted). All three parts, or it is not a finding — a read-only probe is legal and is not flagged.
- `startup-verdict-assertive-wording` — emitted only at a site the first rule already flagged, when the diagnostic asserts a terminal outcome about a world that has not finished forming ("will fail at execution time", "you need Redis").

Every finding's hint prescribes the three shapes the fixes took: resolve where the value is used (a `kernel:ready` hook or a lazy accessor — `createLazyCacheRateLimitStorage()`, #4772), seal the vocabulary then judge (`AutomationEngine.sealNodeTypeVocabulary()`, #4771), or order the verdict after the mutation it describes (#4769). All three cures are recognised by shape and pass.

Severity is always `warning` — the rule reasons about a boot sequence it cannot execute, so it advises and never gates. The kernel SERVICE-registry half of the same family stays with `pnpm check:startup-registry-verdict`; the rule module states the measured division of labour between the two.
