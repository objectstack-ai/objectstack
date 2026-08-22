---
"@objectstack/plugin-security": patch
---

`SecurityPlugin.start()` binds its report sink **above** the two bail-outs, so a
degraded boot no longer leaves the plugin permanently unable to report (#10706).

`private logger … = {}` is an empty object from construction, and
`this.logger = ctx.logger` was its only assignment — sitting in the "capture
handles" block, **below** the two `return`s that fire when `objectql`/`metadata`
cannot be resolved, or when the engine carries no `registerMiddleware`. On
either path the field stayed `{}` for the **lifetime of the instance**. Every
report site is written `this.logger.warn?.(…)`, so an unbound sink is not a
state any caller can notice: the reports simply do not happen. The assignment
now runs immediately after the `Starting Security Plugin...` line, before either
bail-out can be taken.

Boot behaviour is otherwise unchanged, and that is pinned rather than asserted:
both bail-outs still `return`, the middleware and the `security` service are
still **not** registered on those paths, and both bail-outs still report through
`ctx.logger` — which was always a real sink, so the bail-out itself was already
loud. What was silent was the plugin's own field afterwards.

Scope note: this is independent of the open design call on #10556 about what the
default sink should be. Only the **placement** of the binding changes; the `= {}`
default itself is untouched, and the fix is correct under every option there.

Reachability, measured rather than assumed: every in-repo caller of the two
public methods that report through the field (`checkAuthoredRowWrite`,
`getReadFilter`) reaches them through the registered `security` service, and
that service is registered *below* the bail-outs too — so on a bailed-out boot
there is no live consumer. The defect was latent, not live. It is still a defect
on its own terms: a sink that can never be bound after an early return is
unrepresentable as a state the code can notice.

New pin: `start-logger-binding.test.ts`.
