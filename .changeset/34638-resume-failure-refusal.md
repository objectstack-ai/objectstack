---
'@objectstack/spec': patch
'@objectstack/service-automation': patch
'@objectstack/plugin-approvals': patch
---

fix(approvals): a recall or subflow-parent strand reports the hook refusal that stranded the run

Clause-②: yes
Metadata-protocol: none

When an approval decision strands its flow run because the next step was refused (a record hook's declared refusal, a validation rule, a permission), the thrown `RESUME_FAILED` already carries `innerRefusal` and the refusal's marked `userMessage`. Two doors report a stranded run on a success answer instead, through `resumeFailure`: the recall door, whose own resume stranded, and a subflow parent that stranded after the run this door resumed advanced (through `decide` and through `recall`). Those reports carried `code`, `runId`, `status` and `repairable` only, so the approver saw a stranded run with no reason.

- `ResumeFailureReport` (`@objectstack/spec/contracts`) gains two optional members, `innerRefusal` (`{ code, message }`, the engine's `AutomationResult.innerRefusal`) and `userMessage` (the declared sentence in the caller's locale). The names and shapes are the ones the thrown `RESUME_FAILED` uses. Both are absent when the strand met no refusal (a fault), and neither changes how `code` and `repairable` are read. `ResumeFailureDetailsSchema` is unchanged. On the resume door these members already ride the error envelope.
- `AutomationEngine.takeSubflowParentStrand` now returns the stranded parent's `innerRefusal` / `userMessage` beside `runId`, `repairable` and `error`, read from the parent's own result.
- The approvals recall door and the subflow-parent strand fill both members whenever the strand met a refusal.

No migration: the change only adds optional members, and a caller that ignores them reads exactly what it read before.
