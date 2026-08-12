---
'@objectstack/spec': major
---

**BREAKING** — `automation/control-flow` and `automation/state-machine` reject unknown keys (#4001 批 10, ADR-0078)

Eleven authoring shapes that silently discarded undeclared keys now refuse them with a
named surface, the offending key echoed back, and a rename or prescription. Metadata that
used to parse "successfully" while losing the key you wrote now returns 422.

**`automation/control-flow.zod.ts`** — `FlowRegionSchema`, `LoopConfigSchema`,
`ParallelBranchSchema`, `ParallelConfigSchema`, `TryCatchConfigSchema`.

**`automation/state-machine.zod.ts`** — `ActionRefSchema` (object branch),
`GuardRefSchema` (object branch), `TransitionSchema`, `StateNodeSchema`, its `meta` block,
and `StateMachineSchema`.

## What was actually being lost

A `state_machine` on an agent's `lifecycle` with `onn` where `on` was meant parsed clean
and came back with **no transitions at all** — the declaration whose entire purpose is to
deny undeclared transitions, silently emptied and reported valid. A `loop` config with
`maxIteration` (singular) came back uncapped. A `parallel` branch with `label` instead of
`name` came back unnamed.

## Migration — FROM → TO

Renames the rejection now suggests for you:

| you wrote | write instead | on |
|---|---|---|
| `guard` | `cond` | a state transition (XState v5 renamed it the other way; this protocol kept `cond`) |
| `action` | `actions` | a state transition |
| `itemVariable` | `iteratorVariable` | a `loop` config |
| `maxIteration` | `maxIterations` | a `loop` config |
| `label` | `name` | a `parallel` branch |
| `onn` / `entery` / typos | `on` / `entry` | a state node |

Keys with no replacement, and what to do instead:

- **`finally` on `try_catch`** — there is no `finally` region. The node's ordinary
  out-edges run whichever way the protected region went; put the always-run steps in the
  nodes **after** the container.
- **`join` / `joinGateway` on `parallel`** — the join is implicit; the block continues once
  when every branch completes. `join_gateway` is a BPMN interop node type, never a
  `parallel` config key.
- **`flowName` on `loop`** — that key belongs to the `map` node, which runs a subflow per
  item. A `loop` runs an inline region: move the steps into `config.body`, or change the
  node `type` to `map`.
- **`name` / `label` on a region** — a `loop` body, a `try` region and a `catch` region are
  not named; only a `parallel` branch carries a `name`.
- **`transitions` on a state node** — a state node declares transitions as `on`, keyed by
  event type. `transitions` is the key on the object-level `state_machine` **validation
  rule** (`validations[].transitions`), a different declaration.
- **`context` on a state machine** — this protocol declares only the context SHAPE, as
  `contextSchema`. There is no key for seeding initial values, so the two are not a rename
  of each other.

## Two notes for upgraders

`ActionRef` / `GuardRef` are unions, so a rejected key on their object branch surfaces as
zod's `invalid_union` (`"Invalid input"`) with the real prescription nested one level down
in `issue.errors[]` rather than in the top-level message. The prescription is present in
`ZodError.message` and in REST error bodies; single-line formatters drop it.

`StateNodeSchema.meta` is **closed**, not a passthrough bag. XState treats `meta` as open,
but the hand-written `StateNodeConfig` type here declares exactly `label` / `description` /
`color` / `aiInstructions`, nothing in the platform reads any other key, and the previous
behaviour was not openness but strip — an authored `meta` arrived as `{}`.

All three example apps (`app-showcase`, `app-crm`, `app-todo`) validate unchanged, so no
ADR-0087 conversion accompanies this change.

<!-- adr-0087: registered authoring-schemas-strict-unknown-keys -->
