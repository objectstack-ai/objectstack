---
'@objectstack/spec': major
'@objectstack/service-automation': minor
'@objectstack/lint': patch
---

feat(spec,automation)!: converge `script` to a function call — retire the `actionType` branches — and parse `script` / `subflow` config at execute time (#4343)

A `script` node had four ways to name what it ran and only one of them ran anything.
Protocol 17 keeps that one and retires the rest.

- **`config.actionType: 'email' | 'slack'`** were **logger-backed stubs**. They wrote a
  line, reported success, and delivered nothing — under any configuration, installed
  messaging service or not. Every bundled example used one; none of them ever sent
  anything.
- **`config.template` / `.recipients` / `.variables`** fed those stubs, so they addressed
  a message no channel sent. (The examples did not even reach them: they passed the
  payload in `inputs`, which the built-in branch never read.)
- **inline `config.script`** was recognized and **never executed** — the built-in runtime
  has no server-side JS sandbox, so the node warned and completed as a no-op.
- **any other `actionType`** was shorthand for a registered-function name — a second
  spelling of `config.function` — and `'invoke_function'` was a marker that named nothing
  on its own.

What remains is what worked: `config.function` (now **required**) names a registered
function, `config.inputs` feeds it, `config.outputVariable` binds its return value.

**The replacements are three different mechanisms, not one rename.**

| Retired | Use instead |
| --- | --- |
| `actionType: 'email'` (+ `template` / `recipients` / `variables`) | a `notify` node — it delivers through the messaging service: the in-app inbox by default, real email once `@objectstack/plugin-email` is installed |
| `actionType: 'slack'` | a `connector_action` node with the Slack connector, or an `http` node posting to an incoming webhook — `notify` has no Slack channel |
| `actionType: 'my_fn'` (shorthand) | `function: 'my_fn'` — the conversion moves it for you |
| `script: '…'` (inline JS) | move the logic into a registered function and call it via `config.function` |

**Execute-time parse.** `script` and `subflow` now run their config through the contract
before executing, the seam #4277 gave the flat builtins — a violation refuses the node as
a **guard** (wrong metadata; no `fault` edge may route it, #3863). `script` could not join
that seam while its legal key set depended on `actionType`: a flat parse would either
reject valid shapes or wave everything through. Converging the node is what made the
contract fit. `subflow`'s hand-written `flowName` check became the same parse, so its
message is now `subflow 'n1': config does not satisfy the subflow contract —
config.flowName: …`. `decision` deliberately stays export-only: its one key is optional,
so a parse would check nothing.

**Migration.** `os migrate meta --from 16` rewrites stored sources; authoring one of these
keys in TypeScript is a compile error carrying the same prescription. A shorthand
`actionType` **converts into `function`** — that is what it named — unless `function` is
already set, in which case it was dead metadata the executor never reached. The other four
keys are dropped outright: nothing read them, so there is no value to preserve, and
rebuilding the intent is an authoring decision (the table above) rather than something a
mechanical rewrite can guess.

The keys leave the **load path** (`retiredFromLoadPath`) with the rest of the keys retired
for *misdescribing themselves* rather than for being renamed: absorbing
`actionType: 'email'` silently would let an author keep believing the flow sends mail. The
one seam that still replays it is `registerFlow`, which rehydrates data at rest (#3903) —
a row in `sys_metadata` has no author for a tombstone to teach. So a stored email-stub node
arrives stripped of the keys nothing read and then **refuses for naming no callable**,
where it used to log a line and report success. That flip is the behavior change to expect.

**A build gap this surfaced, fixed here.** `FlowFunctionEntrySchema` now also accepts a
**lowered handler ref** (a non-empty string), the form `objectstack build` produces: the
CLI lowers every inline callable to a serialisable ref *before* the stack is parsed (it
must — `z.function()` wraps callables and would break the ref mapping), so a built
manifest holds `{ myFn: 'myFn' }`, which neither previous member accepted. The result was
that `defineStack({ functions })` — a documented, first-class mechanism — could not
survive a build at all. Nothing had noticed because no bundled example used it; #4343
turns that from latent into blocking, since `config.function` becomes the only thing a
`script` node can run. `Hook.handler` already declared exactly this pair (`z.union([
z.string(), <function> ])`, "string, post-build / inline function, pre-build"), so this
brings `functions` onto the platform's established shape rather than inventing one. A
string carries no callable and `normalizeFlowFunctionEntry` still drops it by design — the
real functions ride in the sibling ESM module the build emits, merged by name — so
hand-authoring one registers nothing and fails loudly at execute ("no function named '…'
is registered"), never silently.

Also in this change: the retired constants `SCRIPT_BUILTIN_ACTION_TYPES`,
`SCRIPT_INVOKE_FUNCTION_ACTION_TYPE` and the `ScriptBuiltinActionType` type are removed
(they described the dispatch set that no longer exists); `os validate` names a retired key
and its replacement instead of reporting a generic missing callable; and the `#3796`
alias fixture, which carried `actionType: 'invoke_function'` through both sides, no longer
describes an end state protocol 17 can reach — the rename itself is untouched. No liveness
ledger row moves: the gate walks `FlowSchema`, whose `nodes[].config` is
`z.record(z.unknown())`, so these keys were never governed by one.
