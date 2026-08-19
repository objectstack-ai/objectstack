---
"@objectstack/platform-objects": patch
---

Fix `sys_job_run`'s object `description` to say "history", not "audit trail" (#9735)

`sys_job_run` is job run **history**; `sys_audit_log` is the separate audit surface,
with its own opt-in, writer and retention (binding ruling on #9633). The object's own
header comment already said "Background Job Execution History", but the `description`
field two lines below — the user-facing copy Studio/Setup surface, and the string that
propagates into the generated translation bundle — still called it "Background job
execution audit trail". Both now say "Background job execution history"; the generated
`en.objects.generated.ts` bundle was regenerated to match (never hand-edited).
