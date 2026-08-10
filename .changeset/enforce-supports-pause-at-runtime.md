---
'@objectstack/service-automation': patch
---

Enforce `ActionDescriptor.supportsPause` at the engine boundary: an executor whose
`execute()` returns `suspend: true` while its descriptor declares `supportsPause: false`
is now refused instead of pausing the run (#6667, from #5703).

`supportsPause` used to be read only at authoring time — the designer palette, the
registration warning, and the `check:resume-authority-declared` CI gate, all of which key
on `supportsPause: true` and so were silent on exactly this mismatch. The pause it let
through was already broken, just later and elsewhere: a type that declares no pause
declares no `resumeAuthority` either, and since #5561 an unclaimed pause is fail-closed,
so the run parked on a durable continuation that the generic resume route then refused
with `PERMISSION_DENIED` — a message naming `resumeAuthority`, not the `supportsPause`
that actually caused it. The refusal fails the run where the mistake was made, writes no
continuation, and names the one-line fix.

Behaviour change for third-party executors in that state (no built-in is: all six pausing
built-ins declare `supportsPause: true`). The refusal is guard-class, so a `fault` edge
does not route it — a wrong declaration is not a condition a re-run can fix. Two shapes
are deliberately untouched: declaring `supportsPause: true` and never suspending is legal
(a capability, not an obligation), and an executor that publishes no descriptor at all
declares nothing to enforce — its pauses stay governed by the #5561 resume gate.
