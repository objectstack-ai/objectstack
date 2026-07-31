---
"@objectstack/runtime": minor
"@objectstack/lint": minor
"@objectstack/spec": patch
---

feat(runtime,lint,spec): an action body's `ctx.record` writes are reported, not silently discarded (#4345)

An L2 action body that assigns to `ctx.record` had every write dropped, with no
diagnostic anywhere:

```ts
body: { language: 'js', source: "ctx.record.stage = 'won'; return { ok: true };" }
```

The action returned `{ ok: true }` and the record was unchanged. `ctx.record` is
a pre-fetched snapshot (`buildActionSandboxContext` hands the body a plain copy)
and `boundActionHandler` returns only the script's value — the hook path's
`applyMutationsToInput` write-back has no action counterpart.

**`ctx.record` stays read-only.** An action's output is its return value and its
write channel is `ctx.api`; that model is coherent, and making the snapshot
writable would raise questions this bug does not answer (write back to what,
under whose permissions, and what `requiresRecord: false` means). What was wrong
was the SILENCE — and unlike #4271's unknown-column drop, this one swallowed
**correctly spelled, fully declared** fields too, so a rule that fired only on
unknown fields would have implied the declared ones persisted.

Three layers now say so:

- **Runtime (new).** The sandbox installs a `set`/`deleteProperty`/
  `defineProperty` proxy over the snapshot — behind an accessor, so a wholesale
  `ctx.record = {…}` is caught too instead of swapping the recorder out — and
  surfaces the keys a body touched as `ScriptResult.droppedRecordWrites`;
  `actionBodyRunnerFactory` logs a warning naming the discarded fields and the
  `ctx.api.object(...).update(...)` remedy. The write still works *inside* the
  VM, so a body using the snapshot as scratch keeps its reads coherent — only
  the silence is removed. Being a runtime trap rather than a static check, it
  sees computed keys, `Object.assign` and aliases
  (`const r = ctx.record; r.x = 1`), and it covers metadata authored through
  Studio or the API, which no lint ever inspects. Hooks carry no `record`, so
  they install no proxy and pay nothing.
- **Authoring (new rule, advisory).** `action-body-record-write-discarded`
  (`validateActionRecordWrites`, in `REFERENCE_INTEGRITY_RULES`) warns on the
  literal patterns in the exported `ACTION_RECORD_WRITE_PATTERNS` ledger, so
  `os validate` / `os lint` / `os compile` all report it. It never consults the
  object's declared fields and offers no did-you-mean: the field name is not the
  bug. It stays advisory because a body may legitimately use the snapshot as
  local scratch, which no analysis short of data-flow can tell from an intended
  persist — gating would block correct builds.
- **Docs.** `ScriptContext.record`, `ActionSchema.body`, `ScriptBodySchema`,
  `content/docs/ui/actions.mdx` and `content/docs/automation/hook-bodies.mdx`
  now state the read-only semantics and the `ctx.api` remedy, and name the
  `ctx.input` analogy as the trap it is.

No behavioral change to any body that was already correct: verified against the
showcase app, which reports zero findings before and exactly one — naming both
declared fields and proposing the exact call it replaced — after planting the
issue's repro.

New exports from `@objectstack/lint`: `validateActionRecordWrites`,
`extractActionRecordWrites`, `ACTION_RECORD_WRITE_PATTERNS`,
`ACTION_BODY_RECORD_WRITE_DISCARDED`, plus the `ActionRecordWriteFinding`,
`ActionRecordWriteSeverity`, `ActionRecordWritePattern` and
`ExtractedActionRecordWrite` types.
