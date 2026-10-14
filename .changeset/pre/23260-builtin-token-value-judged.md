---
'@objectstack/spec': minor
---

A builtin flow node's `config` value that carries a `{token}` is judged for its type at the build doors like any other value: `get_record` with `limit: '{x}'` is refused at `nodes.N.config.limit` ("expected number, received string") by `FlowSchema.parse`, `defineStack`, `objectstack validate`, `objectstack compile`, the metadata save door and `AutomationEngine.registerFlow`, where it used to register and then fail every run that reached the node.

Clause-②: no (narrowing)

<!-- adr-0087: not-required (already-registered flow-builtin-node-config-values-refused) The step-18 D3 entry registered on this line records the build doors refusing a builtin config value its executor contract refuses; this change removes the one class that entry held back, a value carrying a token, and the entry's text now says so. No key is removed and no shape is rewritten, so there is no tombstone and no D2 conversion: the platform cannot know the literal the author meant. -->

**BREAKING**: an accept-set narrowing on a published authoring surface, shipped as `minor` under the launch-window convention for accept-set narrowings (`.changeset/pre.json` is open on `main` in `next` pre mode, so the release is `18.0.0-next.*`).

**Why.** The build doors' value arm (`flowNodeConfigRefusals`) never refused a value carrying a `{token}` for its type, because the flow interpolator decided what the run would parse there. The interpolator and every call site it had are deleted on this line, and every builtin executor parses its config as authored (an `http` node after its credential channel's `signingSecret`), so the run's contract sees the token the build's sees and refuses it at every run. The value arm passed exactly those values.

**What is refused now.** A token-carrying value at a builtin key its executor contract refuses it at: a number or boolean key (`get_record` `limit`, `loop` `maxIterations`, `update_record` and `delete_record` `multi`, a screen field's `min`, `max` or `required`, a `try_catch` `retry.maxRetries`), a key with a declared set (`notify` `severity`, `screen` `mode`), a record key written as one token (a CRUD `filter: '{f}'`), and a rule finding the token used to hide (a `notify` `templateData` with no `template`). Each is `node-config-refused-by-contract`, `params: { nodeType, key }`, anchored at the key, in the contract's own words — `defineStack` throws `STACK_SCHEMA_INVALID` (422) at `flows.N.nodes.M.config.<key>`.

**What does not change.**

- A token at a plain string key (`outputVariable`, `flowName`, `objectName`) parses and registers as before: the contract takes a string there.
- A token at a value slot (a CRUD `fields` value, a callee `input`, a screen's `defaults`, `defaultValue` or `recordId`, a `loop` or `map` `collection`, a `notify` `recipients`, `templateData` or `sourceId`, an `http` `body`, a filter operand) or at a text slot (a `notify` `title`, `message` or `actionUrl`, a screen `title` or `description`, an `http` `url` or header value) is refused, as before, by that slot's own judge at `registerFlow` and `objectstack validate`, once, with the slot's label and remedy: the value arm exempts each finding that judge owns, so no token is reported twice.
- At a key its executor reads as written (a `notify` `sourceObject`, `actorId` or `payload`; an `http` `method`, `durable`, `timeoutMs` or whole `headers` map) the key is refused once, in the literal's own words, as before.
- An `http` `signingSecret` is still never judged at the build doors: the credential channel may supply what the run signs with.

## FROM → TO

| you wrote | write instead | what changes |
|:--|:--|:--|
| `get_record` `limit: '{page.size}'` | `limit: 25` | refused at `config.limit` at every build door, where it registered and failed every run |
| `loop` `maxIterations: '{cap}'` | `maxIterations: 50` | the same, at `config.maxIterations` |
| `update_record` `multi: '{bulk}'` | `multi: true` | the same, at `config.multi` |
| a screen field `min: '{m}'` | `min: 1` | the same, at `config.fields.N.min` |
| `try_catch` `retry: { maxRetries: '{n}' }` | `retry: { maxRetries: 3 }` | the same, at `config.retry.maxRetries` |
| `notify` `severity: '{level}'` | `severity: 'warning'` | the same, at `config.severity` |

**The one-line fix: write the literal the key declares.** None of these keys is evaluated per run, so no envelope replaces the token there.

**Who is affected, measured.** A census of every builtin node literal whose `config` evaluates statically — 1010 nodes, 244 of them carrying a `{…}` token, across `examples/`, `packages/` and `apps/` in this repository at the base and hotcrm at `0f84c9c` — finds no verdict this change moves (a control node with `limit: '{x}'` moves, so the census can see one). No published docs page and no `@objectstack/lint` rule says a token at a typed key passes the build.

### The kit

- **The judge.** `flowNodeConfigRefusals`'s builtin value arm (`flow-node-config-refusals.ts`): the token carve-out (`carriesInterpolationToken`) is deleted. In its place the arm asks the value-slot judge (`flowNodeValueTemplateRefusals`) and the text-slot judge (`textSlotTemplateRefusal`) which paths they refuse and exempts those, and reports a key whose contract marks its refusal `READ_AS_WRITTEN_PARAM` in that refusal's words alone.
- **ADR-0087.** No new entry: the step-18 D3 entry `flow-builtin-node-config-values-refused` and its rationale fragment now state the class this change judges.
