---
"@objectstack/plugin-security": minor
---

`SecurityPlugin`'s own report sink is now **console-backed by default** — loud until a host
injects one — instead of being initialised to an empty object. Its fail-closed refusals
(`getReadFilter … denying (fail-closed, #2852)` and `#4467`, `checkAuthoredRowWrite …
abstaining`, the ADR-0123 tenant-wall refusal) previously went nowhere at all on any instance
whose lifecycle had not yet reached the sink binding; they now reach `console.warn` /
`console.error`. A host that injects a logger is unaffected: `start()` assigns `ctx.logger`
over the default, above both of its early bail-outs (#10706), so a degraded boot still reports
through the host.

**Operator-visible:** a deployment that never injects a sink will begin seeing these refusals
on the console. That is the intended change — the refusal itself is not moving, only whether
anyone can see it.

Why `minor` and not `patch`: the observable output of a running deployment changes. The
declared shape changes with it — the field's `warn` channel is now non-optional, which is what
#9754 requires of a sink declaring an optional `error`, and what a default of `{}` made
impossible to state honestly. `error` deliberately stays optional (#9754 option C, falsified:
hosts do inject reduced sinks). The maintainer ruled on 2026-08-24 (#10556) that the default
becomes console-backed and that silent-by-declaration is rejected.
