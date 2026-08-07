---
"@objectstack/spec": patch
---

docs(spec): `session.positions` stops teaching a hook call that cannot run (#6001)

The `positions` key on the hook session carries a deliberate boundary note: it is
**descriptive, never an authorization input**. That conclusion is unchanged. What
changed is the example standing next to it, which was itself defective:

- FROM: "A hook may READ this … forwarding it as the sharing service's evaluation
  context (`services.sharing.canEdit(..., { positions })`, the shape both
  `content/docs/kernel/runtime-services/` pages teach)"
- TO: an example a hook can actually reach — tailoring a message, branching a
  *business* rule through the hook's own `ctx.api` channel, logging — plus an
  explicit note that a hook context carries **no `services` key**.

#5720 pinned this by measurement: hook contexts are assembled key by key, and
neither ObjectQL's `buildSession()` nor `buildSandboxContext()`
(`packages/runtime/src/sandbox/body-runner.ts` — `input` / `previous` / `user` /
`session` / `event` / `object` / `result` / `api` / `log` / `crypto`) ever sets
`services`. So `services.sharing.canEdit(…)` is `undefined()` inside a hook, and
the customary `if (!ok) throw` wrapped around it rejects **every** write. The
one shape the doc held up as correct practice was the exact shape that fails
closed on all traffic.

The two cross-referenced doc pages had already reversed under PR #5938 —
`sharing-service.mdx` now carries "Enforcement is automatic — do not re-check it
in a hook", and `examples.mdx` teaches `ctx.api` — leaving this JSDoc as the last
site still teaching the withdrawn shape. The reference now points at that
section instead of at the pages generically.

Both the JSDoc **and** the `.describe()` are updated; the `describe` is the copy
served through `/api/v1/meta/types/hook` and rendered in Studio's form, so
leaving it would have kept the defective example on the surface authors actually
read. Text only — no schema, validation, or runtime behaviour change.
