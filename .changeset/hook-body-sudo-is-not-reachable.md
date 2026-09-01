---
"@objectstack/cli": patch
"@objectstack/lint": patch
---

fix(cli,lint): stop lowering hook handlers that call `ctx.api.sudo()` into bodies that cannot run it (#14010)

`ScopedContext.sudo()` is real in-process and is **not** marshalled into the
QuickJS sandbox: the VM's `ctx.api` carries `object()` and the transaction
surface, and nothing else. Every consumer of that fact had it backwards.

The failure this closes is the expensive shape, not a cosmetic one. An author
writes an inline `handler`, tests it the way the docs teach — calling
`hook.handler(ctx)` natively, against the in-process `ScopedContext`, where
`sudo()` exists — and the suite is green. `objectstack build` then lowers that
same source into an L2 `body`, and in production the call is
`TypeError: ctx.api.sudo is not a function`. Under a hook's default
`onError: 'abort'` the TypeError aborts the **triggering write**, so the
symptom surfaces as an unrelated save being refused. Green tests, dead feature.

- **`@objectstack/cli`** — `.sudo(` joins `FORBIDDEN_PATTERNS` in
  `extractHookBody`, so the build declines to emit such a handler as
  `body.source`. This is a repair, not just a refusal: `lowerCallables` already
  registers the callable and ships it through the `.mjs` bundle when extraction
  throws, so the handler keeps running **in-process, where `sudo()` is real**.
  The build prints the reason; `--strict-body`, which demands a body for every
  callable, turns it into a hard failure — correctly, since a body needing
  elevation genuinely cannot be one. Same family as the `crypto.hash`
  retirement (#4391): a member advertised ahead of its implementation, where
  build-time inference was the amplifier rather than the safety net.
- **`@objectstack/lint`** — `hook-api-update-readonly-field` (severity
  `error`, gating) and its `readonlyWhen` sibling both *prescribed*
  `ctx.api.sudo()` as the remedy. That rule reads L2 body sources and nothing
  else, so the prescribed shape was a TypeError for **100%** of its population:
  a gating rule pointing at a dead feature. Both hints now name the own-hook
  stamp and say plainly that `sudo()` is not reachable from a body. The rule's
  findings, severities and exclusions are unchanged — only the advice.

Docs: the `readonly` table in `automation/hook-bodies.mdx` claimed the
`sudo()` row **Lands**; it now records what actually happens.

Not addressed here, and the reason this is only half the card: a hook still has
**no declared elevation knob** — there is no hook-side `runAs` the way
`FlowSchema` has one — so "this column is computed by automation and never
hand-written" remains inexpressible whenever the maintaining write is
cross-object. That is a contract-surface decision (see #14010), left to the
review chain rather than guessed at here.
