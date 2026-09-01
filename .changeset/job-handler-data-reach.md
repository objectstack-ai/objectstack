---
"@objectstack/runtime": minor
---

feat(runtime): give a declarative job's handler data reach (#14094)

`defineJob` is the platform's only metadata shape for scheduled work. Its
handler resolves out of `defineStack({ functions })`, and until now `AppPlugin`
invoked it with `{ jobId, data, bundle }` — no engine, no logger, nothing to
write with. The job registered, appeared in the admin UI, was scheduled, ran on
time, and did nothing. `objectstack validate` passed and no author-time gate
said otherwise.

The context `AppPlugin` builds now also carries:

- **`ql`** — the live ObjectQL engine, the same handle `defineStack({ onEnable })`
  receives as `ctx.ql`;
- **`logger`** — the plugin `Logger`, so a job's diagnostics land in the
  platform's log stream instead of `console`.

`JobHandlerContext` is exported from `@objectstack/runtime` for handlers that
want to annotate their argument.

**Why a job and a flow `script` node differ here.** `FlowFunctionContext` also
carries no engine, and that is coherent for a flow function: the flow graph does
the I/O around it (`get_record` before, `create_record` after), which is what
the per-run write metrics count. A job has no graph — no node before it, none
after — so the same emptiness leaves it unable to do the one thing scheduled
work exists for. Nothing about a `script` node's contract changes.

**Why the module-scope escape was not documented instead.** Closing over a
client bound by `onEnable` does not survive the shipped deployment path:
`objectstack build` emits `functions` into a sibling runtime module exporting
only `{ functions, meta }`, the artifact JSON carries no `onEnable`, and
`mergeRuntimeModule` merges only `functions` — so on an artifact-served boot the
binding is never made and the handler runs against an empty slot, silently. The
regression suite therefore proves the write on **both** boot paths: the
TS-config path and a real artifact loaded through `loadArtifactBundle`.

**Additive.** This widens the object passed to the handler, the same shape
`JobRunOutcome` took. `IJobService`'s
`JobHandler = (context: { jobId: string; data?: unknown }) => …` is untouched —
the function `AppPlugin` hands to `IJobService.schedule` is a wrapper that
satisfies it exactly, and the new members are added inside that wrapper. An
existing handler that destructures `{ jobId }` or `{ jobId, data }` is unchanged
byte for byte, and no `IJobService` implementation grows a member.

The kernel's `getService` was considered and deliberately not added: it would
put the whole service registry on a job's context permanently, and the measured
population of shipped `defineJob` handlers needs the engine and nothing else.
Adding it later is additive by exactly this argument, so nothing is foreclosed.
