---
'@objectstack/lint': major
'@objectstack/spec': major
---

A flow CEL expression that reads a root the flow does not bind is refused at `objectstack validate` and at the runtime publish gate. The run fails such an expression with `Unknown variable: X` (X being the root) on every evaluation, and the build door used to pass it. The reachable case is the run user: `user.id == "u1"`, `ctx.user.id == "u1"` and `os.user.id == "u1"` — the spellings formulas, row-level security and the client accept — are refused, naming `current_user`, the one spelling flow CEL binds.

Clause-②: no (narrowing)

<!-- adr-0087: registered flow-cel-unbound-root-refused -->

**BREAKING**: an accept-set narrowing on a published authoring surface (`objectstack validate`, and the runtime publish gate's `expression-invalid` rule for a flow write).

**Why.** Flow CEL evaluates in one scope per run: the flow's variables spread to top level, the trigger record's fields flattened beside them, and `record`, `previous`, `vars` and `current_user` bound by the engine. Formulas, row-level security and the client also bind the run's user as `user`, `ctx.user` and `os.user`; flow CEL does not, because a top-level `user` would collide with a variable or a lookup field of that name. So an author who wrote the alias by habit shipped a flow that faulted at its first evaluation, and nothing warned.

**What is refused.** At every flow CEL site the build door reads — a node's `config.condition` (the start node's trigger gate included), an edge `condition`, a `decision` branch `expression`, a screen field `visibleWhen`, and the CEL value envelopes of an `assignment` and of a `create_record` / `update_record` `fields` map — a root that is none of:

- the engine's roots: `record`, `previous`, `vars`, `current_user`;
- a name the flow binds: a declared variable, an `outputVariable`, an `iteratorVariable` (a `loop`'s default `item` included), an `indexVariable`, an `errorVariable`, an `assignment` target, a node id, a screen field's `name`;
- a field (or a registry-injected column) of any object the stack declares — the run flattens whichever record its entrance hands it.

The user spellings are told to write `current_user`, with the guard for a flow that can run without a user; any other root is named with what could have bound it, and the nearest in-scope name. The error is `expression-invalid`, `error`. Where the flattened-scope near-miss advisory ("`X` is not a field of … If `X` is a flow variable this is safe to ignore") named the same root, the refusal replaces it.

**Not judged — the door stands down where the run can bind a name it cannot see.** A flow carrying a `script` or `connector_action` node (each hands its code the live variable map), a `wait`, `subflow` or `map` node (a resume folds the caller's `variables` bag in under their plain names), a screen with no field list, a node type outside the builtin set, or a trigger object the stack does not declare. A `$` name has no CEL spelling (`$runId == "x"` does not parse), so the `$` roots stay the text-slot rule's.

## FROM → TO

| you wrote | write instead |
|:--|:--|
| `condition: 'user.id == "u1"'` | `condition: 'current_user.id == "u1"'` (`current_user != null && current_user.id == "u1"` where the flow can run without a user) |
| `condition: 'ctx.user.id == record.owner'` | `condition: 'current_user.id == record.owner'` |
| `assignments: { who: { dialect: 'cel', source: 'os.user.id' } }` | `assignments: { who: { dialect: 'cel', source: 'current_user.id' } }` |
| `condition: 'deals.size() > 0'` with nothing binding `deals` | declare it (`variables: [{ name: 'deals', type: 'list' }]`) or bind it with a node (`outputVariable: 'deals'`) |

**The one-line fix: write `current_user` for the run user, and bind or correct every other root the refusal names.**

**Who is affected, measured.** The last published spec line, 17.x, judged a flow expression's syntax only, so it accepts every refused source. Measured with the judge over every flow CEL site: the example apps (`app-crm`, `app-todo`, `app-multi-package`, `app-showcase`: 35 flows, 45 sites), `packages/platform-objects` (no flows) and `objectstack-ai/hotcrm` at `f0afcbda07` (32 flows, 65 sites) — 0 refusals; every root those flows read is an engine root, a binding of the flow's own or a field of its trigger object. Deployed metadata and other repositories were not measured.

### The kit

- **The judge.** `flow-cel-root-scope.ts` in `@objectstack/lint`, called by `validateStackExpressions` at each flow CEL site. One bound set per flow, read once like the shadowing pass's variable set.
- **The ledger.** The D3 semantic entry `flow-cel-unbound-root-refused` (protocol 18). There is no D2 conversion: none of these roots ever evaluated in a flow, so there is no behaviour to carry over.
