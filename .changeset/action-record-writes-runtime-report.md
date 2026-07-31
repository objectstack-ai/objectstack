---
"@objectstack/runtime": minor
---

feat(runtime): the sandbox reports an action body's discarded `ctx.record` writes at invocation time (#4345)

#4362 closed the author-time half of #4345: `action-record-write-discarded`
warns when a body assigns to `ctx.record` and the snapshot is provably dead.
This is the run-time half, and it exists because a parse cannot reach three
things a running action can:

- **computed keys and aliases** — `ctx.record[k] = v`, `const r = ctx.record;
  r.x = 1`, which the lint deliberately skips rather than guess at;
- **a wholesale replacement** — `ctx.record = {…}`;
- **bodies no lint ever sees** — metadata authored through Studio or the API
  never passes through `os validate` / `os lint` / `os compile`.

The sandbox installs a `set`/`deleteProperty`/`defineProperty` proxy over the
snapshot, behind an accessor so a wholesale replacement cannot swap the recorder
out, and surfaces the touched keys as `ScriptResult.droppedRecordWrites`.
`actionBodyRunnerFactory` logs a warning naming the discarded fields and the
`ctx.api.object(...).update(...)` remedy. Writes still work *inside* the VM, so
a body using the snapshot as scratch keeps its reads coherent — only the silence
is removed.

**Only dead writes are reported**, on the same reading #4362 uses: a snapshot
that leaves the body as a value may have carried the write with it, so

```js
ctx.record.stage = 'won';
await ctx.api.object('crm_deal').update(ctx.record);   // lands — stays quiet
```

is not reported, while a plain property read does not rescue a write (the
`ctx.recordId || (ctx.record && ctx.record.id)` guard idiom real action bodies
are written with still reports). An `ownKeys` after a write marks the escape.
A wrong "discarded" asserts something false about the stored record, which is
worse than a miss.

Hooks carry no `record`, so they install no proxy and pay nothing. `ctx.record`
remains read-only; whether the runtime should instead refuse or honour the write
is still open — reporting a discard prejudges neither answer.
