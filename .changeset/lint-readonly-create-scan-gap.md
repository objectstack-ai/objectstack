---
"@objectstack/lint": minor
---

`flow-update-readonly-field` and `hook-api-update-readonly-field` now report a non-system **create** of a static-`readonly` field — a new **error**-severity finding that fails `os lint` / `os validate` / `os build` on a shape they used to accept.

Both rules scanned only the update verb (`update_record`; `ctx.api…update()` / `.updateById()`) and justified the omission with the same sentence: INSERT is engine-exempt from the author-declared `readonly` strip, so a create that seeds a `readonly` column is not a no-op. The maintainer ruling of 2026-09-03 (option C, #14147) made that false — `engine.insert` now runs the same `isSystem`-gated `stripReadonlyFields` the update path runs — so a flow `create_record` without `runAs: 'system'`, or a hook body's `ctx.api.object('…').insert()` under a non-system trigger, that writes a `readonly` field became a **silent no-op**: the row lands without the column (which falls back to its `defaultValue`), the step reports `success`, and only a run-time warning names the dropped field (measured end to end in `@objectstack/service-automation`'s `create-record-readonly-drop.test.ts`). Nothing reported it at build time. This closes that scan gap (#15394).

**What now fails that passed before.** Exactly one new shape per rule, at `error`:

- a flow `create_record` node whose literal `fields` map writes a field the target object declares `readonly: true`, on a flow that does not declare `runAs: 'system'`;
- an L2 hook body's literal `ctx.api.object('<name>').insert({ … })` writing such a field, on a hook that does not declare `runAs: 'system'`.

The rule ids and severities are the update ones — one id per shape, not per verb — and each finding's message names the verb it was judged on and what actually happens to a create. Everything the rules already skipped is still skipped: a templated object name, a non-literal payload, an object outside the stack or declaring no fields, an unknown field (the unknown-field rules' question), and any `runAs: 'system'` flow or hook, because seeding a `readonly` column at create time is a system act and that write lands.

**Deliberately not reported.**

- No `readonlyWhen` (conditional) finding on a create, on either surface: a conditional lock is evaluated against the record being written over, which a create does not have, and the engine runs no conditional strip on INSERT ("INSERT stays exempt"). A warning there would state something false about a write that lands.
- The hook rule judges `.insert()` only, not `.create()`. The host `ObjectRepository` aliases `create()` to `insert()`, but L2 bodies run in QuickJS and the VM-side `ctx.api.object()` installs no `create` leaf — a body calling `.create()` throws `TypeError: not a function` on its first run, a loud failure rather than the silent drop this rule reports. The silence is recorded as a reasoned method exclusion (`READONLY_HOOK_METHOD_EXCLUSIONS`) and pinned.
- `validate-readonly-action-writes` is unchanged: an action body runs system-elevated by design, so its create genuinely lands.

**Migration.** If your build reds on the new finding, the fix is one of: declare `runAs: 'system'` on the flow or hook when seeding the `readonly` column is the intent (the intended channel — `readonly` governs the end-user/API surface, not trusted system writers); remove the key from the `create_record` `fields` / `insert()` payload when it is not; or stamp it in a `beforeInsert` hook on the target object (`ctx.input.<field> = …`), which is a server value the strip does not touch. Measured over this repository's shipped examples (`app-crm`, `app-showcase`, `app-todo`): zero in-repo flows or hooks go red — the two `create_record` nodes that target an object carrying a `readonly` field write none of its `readonly` fields, and the one flow that creates unauthenticated already declares `runAs: 'system'`; no shipped hook body inserts through `ctx.api`.
