---
'@objectstack/spec': minor
---

A job can carry a sandboxed `body`, the same JavaScript body hooks and script actions carry, so its work travels with the metadata; `handler` is deprecated beside it (#21515).

Clause-②: yes (widening)

- **`JobSchema.body`** is `ScriptBodySchema` by reference: `{ language: 'js', source, capabilities, memoryMb }`, strict as on hooks. It runs in the QuickJS sandbox with no module scope, reaches data only through `ctx.api` under its declared `capabilities`, and logs through `ctx.log`. The in-process `JobHandlerContext` members (`ql`, `logger`, `bundle`) do not exist there.
- **`handler` is optional and DEPRECATED, "prefer `body`".** When both are present `body` wins, as for hooks. A job that declares neither is refused at parse, located at `body`, with a message naming both keys. The rule is published in the JSON Schema too (`anyOf` of one `required` per key), not only enforced by the parse.
- **Only the L2 body.** An expression (L1) body is refused on a job at `body.language`, and the message says why: an expression performs no I/O, so its only effect would be a returned value, and a job runs for its effects. The message lives on `ScriptBodySchema.language` and fires only where that shape is used on its own; hook and action bodies are unchanged.
- **One time limit.** A body job's limit is the job's own `timeoutMs`: one attempt is one sandbox run, bounded by that value. `body.timeoutMs` (capped at 30 s on hooks and actions) is refused on a job, with the prescription to move the value to `timeoutMs`. The job-level key has no cap, so long-running work states its limit there or splits into bounded runs. The `timeoutMs` describe is the one place this is stated.
- **Not yet run by the runtime.** Scheduling a job's `body` is a separate change. Until it lands a job runs through `handler`, and a body-only job is skipped at boot with a warning. The liveness ledger grades `job.body` `planned`, so `os validate`, `os lint` and `os build` warn wherever a job sets a `body`. `objectstack build` does not mint a job body from the function a `handler` names; write it as data.

Nothing that parsed before is refused now: every existing job declares `handler`, and none declares `body`.
