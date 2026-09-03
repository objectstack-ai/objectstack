---
"@objectstack/spec": minor
"@objectstack/objectql": minor
"@objectstack/lint": patch
---

feat(hooks): `runAs` on a hook — `'system' | 'user' | 'inherit'`, default `'inherit'`

A hook's `ctx.api` runs with the context of the write that fired it, so a column
an app wants **computed and never hand-written** could not be expressed: author
`editable: false` for the persona and the direct `PATCH` is refused — and so is
the hook that maintains the column, by the same field-level check. The guard and
the legitimate writer were the same door. The only elevation a hook had was the
in-process `ctx.api.sudo()`, which is not marshalled into the sandbox (a
`TypeError` once a build lowers the handler into a body) and which rides the L3
bundle path that is being retired.

`HookSchema` now accepts `runAs`:

| value | the hook's `ctx.api` data operations run as |
| --- | --- |
| `'inherit'` (default) | the context of the triggering write — exactly the behaviour every hook has today |
| `'system'` | elevated: a full-access, RLS-bypassing system principal |
| `'user'` | the triggering user; a hook whose trigger resolved no user has its data operations **refused** (`HOOK_UNSCOPED_DATA_ACCESS`) rather than run unscoped |

`'system'` and `'user'` mean here exactly what they mean on `flow.runAs` — same
word, same semantics. `'inherit'` is the hook-only third value, because only a
hook has a context to inherit; a flow establishes its identity from nothing,
which is why its default is `'user'` and this one's is `'inherit'`. Nothing on
`FlowSchema` changes.

**Purely additive: no migration, no behaviour change for any existing hook.**
The default reproduces today's behaviour by handing the engine-built `ctx.api`
through unchanged, and an absent key parses to it.

Scope, deliberately narrow: `ctx.api` data operations only. `condition`
evaluation, the `readonly` strip applied to the hook's own `ctx.input` payload,
`ctx.session` and `async` semantics all keep reading the triggering operation's
context, and declaring `runAs: 'system'` does not elevate the write that fired
the hook.

Elevation is authorization, not anonymity: a `runAs: 'system'` write still
carries the triggering user, so `created_by` / `updated_by` and the audit row
still name the operator.

Honoured on both execution surfaces — the in-process `handler` and the
sandboxed `body`.

Authoring notes:

- `sudo`, `elevate`, `elevated` and `isSystem` are refused with a prescription
  naming `runAs`, and `run_as` is answered as a rename.
- `@objectstack/lint`'s gating `hook-api-update-readonly-field` rule now skips a
  hook that declares `runAs: 'system'` — the static `readonly` strip skips a
  system context, so the write it exists to catch does not happen — and its
  hints name the knob. The `readonlyWhen` warning is unchanged: a system context
  does not waive a conditional lock.
