---
"@objectstack/runtime": patch
---

fix(runtime): a hook/action body's `ctx.log` output reaches the host log stream (#7448)

A body that declared the `['log']` capability and called `ctx.log.info(…)` ran to
completion, returned normally, and produced **nothing** — an author could not tell
"my hook did not run" apart from "my hook ran and logged into the void". QA run
#7439 measured it on the showcase at `--log-level debug`: `[BodyRunner] hook fired`
appeared, while the `task completed: …` line the body itself emitted did not.

**Cause.** `body-runner.ts` wired the capability to `engineCtx?.logger` (hooks) and
`actionCtx?.logger` (actions) — a key **no producer writes**. `HookContextSchema`
declares no `logger`, ObjectQL's engine builds all four of its HookContexts without
one, and neither action-context assembly site (`domains/actions.ts`,
`action-execution.ts`) writes one either. So `ctx.log` was `undefined` on every
path, and the VM bridge forwards through `ctx.log?.[level]?.(…)` — an optional call
on an absent seam. The BodyRunner's own diagnostics were visible throughout because
they use a different logger (`opts.logger`), which every construction site does
supply.

**Fix.** The capability is now served from `opts.logger` — the engine's own
`Logger`, handed to the factory by all four `app-plugin.ts` sites, and the same one
whose `[BodyRunner] hook fired` was already observable. The dead `engineCtx.logger` /
`actionCtx.logger` limbs are removed rather than kept as a second de-facto contract,
matching the `doc`/`previousDoc` (#5906) and `session.user` (#6316) removals in this
file. Lines are prefixed with their origin (`[hook 'showcase_audit_task_completion']
task completed: …`) so an author running many hooks can tell which one spoke, and
`error` is dispatched through the `Logger` contract's real `(message, error, meta)`
signature so a body's structured data no longer lands in the `Error` slot and lose
every field.

**Second defect, same capability.** The VM bridge read the optional `data` argument
with `vm.getString`, which coerces inside the VM — so `ctx.log.info('msg', { code:
'E1' })` arrived at the host as the literal string `"[object Object]"` and every
structured field was lost. It now uses `vm.dump`, the marshalling every other
host-call bridge in that file already uses.

When a BodyRunner is constructed with no logger at all — no production path, but
reachable for embedders — the capability no longer degrades silently: it warns once
per invocation, naming the body and the remedy. It deliberately does not fall back
to `console`, which would override the level threshold, formatting and sinks the
host chose and start a second, unfiltered log stream it never configured.
