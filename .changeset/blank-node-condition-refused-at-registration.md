---
"@objectstack/service-automation": minor
---

fix(service-automation)!: a whitespace-only `config.condition` is refused at `registerFlow`, the rule the edge door has carried since #15807 (#17322)

<!-- adr-0087: not-required (already-registered flow-edge-condition-evaluated-slot-source-required) this is a second face of the decision that entry already carries — an evaluated slot requires a non-blank `source`, refused with EVALUATED_EXPRESSION_SOURCE_REQUIRED — applied to the other structural condition slot by importing the same schema rather than by deriving a second rule; no key is renamed, retired or given a new meaning here. ⚠️ That entry's `surface` and `acceptanceCriteria` name only `edges[].condition`, so they need widening to `config.condition` for a consumer replaying the chain; that file is in packages/spec, outside this card's package, and is filed as a follow-up rather than edited here. -->

**BREAKING** in the accept-set sense, landing in the launch window as `minor`
(the lockstep convention: `major` is refused by `check-changeset-no-major`, and
breaking-ness is carried by this banner plus the ADR-0087 disposition): a flow
node's `config.condition` — a `decision` node's predicate, and on a `start` node
the **trigger gate** — is now refused at `registerFlow` when its source is blank
after trimming, where it used to register clean and answer a **silent `false`**
at every evaluation.

Two doors, the same authored value, two fates until now. `FlowEdgeSchema.condition`
composes `EvaluatedExpressionInputSchema` (#15807), so `'   '` on an edge is
refused at `FlowSchema.parse`, by name. A node's `config` is an open
`z.record(z.string(), z.unknown())`, so the same value passed through verbatim,
reached `AutomationEngine.evaluateCondition`'s empty-source arm — `exprStr.trim()
=== ''` — and returned `false`, under a comment that names that arm as being for
an **unauthored** condition. `'   '` was authored. The branch never ran, forever,
with nothing said at any layer.

```yaml
nodes:
  - { id: gate,   type: start,    config: { objectName: lead, triggerType: record-after-update, condition: '   ' } }  # the flow was gated shut
  - { id: branch, type: decision, config: { condition: { dialect: cel, source: '   ' } } }                            # the same blank, through the envelope key
```

> An expression in an evaluated slot needs a non-blank `source`: the expression
> engine evaluates `source` (the canonical persisted form) and
> cannot evaluate `ast` alone, so an envelope carrying only `ast`, or a `source`
> that is blank after trimming, would validate and register and then fault at
> run time. Write `{ dialect: 'cel', source: '…' }`.

- **The rule is imported, not re-derived.** `registerFlow`'s structural pass runs
  the condition's source through `EvaluatedExpressionInputSchema` itself, so the
  node door and the edge door cannot drift into two notions of "blank" or two
  sentences for it — the property the #15662 campaign built the shared refusal
  for. Nothing is exported from this package to carry it, and no new export was
  added.
- **Applied to the SOURCE, not to the whole value**, deliberately: the union
  would also refuse an envelope with no `dialect` or with a dialect outside its
  enum, and this slot admits both (`structuralConditionRefusal`'s docblock,
  #4336). The narrowing is exactly the blank population and nothing else — a
  `cron` envelope with a real source still earns its own pre-existing verdict,
  and a bare string with a `{…}` brace trap still earns #1491's.
- **`evaluateCondition` is unchanged and still answers `false`.** It is the
  shared evaluator and a public method on an exported class, so its throw
  behaviour is itself a contract; and a stored flow reaches it whatever the
  producer refuses. This change is at the producer only.
- **`structuralConditionRefusal` is unchanged.** A string is still a well-shaped
  condition; the new refusal sits behind the shape one and in front of the CEL
  one, and answers the evaluated-slot sentence rather than
  `STRUCTURAL_CONDITION_SHAPE_REFUSAL`.

**What an author does with a refused condition.** A whitespace-only condition was
never a predicate — the engine answered `false`, so the branch never fired, and on
a `start` node the flow never triggered. **Remove the `condition` key** if the node
was meant to be unconditional, or **write the expression** if it was meant to
branch. ⚠️ Those two are not interchangeable: a refused condition never fired,
while an absent `condition` on a decision node is an unconditional branch that
always fires and an absent one on a start node is a gate that always opens.
Deleting the key to clear the refusal inverts the node rather than preserving it.
Every condition with a non-blank source is unchanged, and nothing is renamed or
retired.

**A flow ALREADY STORED in `sys_metadata` stops running entirely — the whole flow,
not just the branch.** Stored flows are deliberately not canonicalized by
`applyConversionsToStoredItem` (`spec/src/conversions/stored.ts`, and the same
skip in `metadata/src/loaders/database-loader.ts`'s `rowToData`); they canonicalize
at `registerFlow`, and each of the three boot paths in
`service-automation/src/plugin.ts` wraps that call in `try`/`catch`, logs one
`warn` naming the flow, and continues. So a node condition that used to answer a
silent `false` while the rest of the flow ran now takes the flow down with it: it
is never registered, its trigger is never armed, and the announcement is that one
warn line — `[Automation] failed to register flow` at boot, `[Automation]
cold-boot flow bind: failed to register flow` at the kernel:ready bind,
`[Automation] flow re-sync: failed to register flow` on a re-sync. The warn line
is also the locator: the refusal names the node and the slot, e.g. `node 'gate'
(start) condition`. A stack authored in config files has a second door,
`objectstack validate` — see the note below for what that door does **not** yet
say.

**A repo-wide census on this branch found zero authored `config.condition` values
of this shape**, against a lit control: a textual probe over all 8,123 tracked
source files found **461** non-blank `condition:` string literals and **zero**
blank-after-trim ones in any authored flow (the four blank hits are two prose
examples inside #15807's own changeset and two `packages/lint` test fixtures).
There is nothing in this repository to rewrite.

⚠️ **Two follow-ups this change does not carry, both outside this card's package.**
(1) The ADR-0087 D3 entry named above,
`flow-edge-condition-evaluated-slot-source-required`, registers the decision this
change is a second face of — an evaluated slot requires a non-blank `source` — but
its `surface` and `acceptanceCriteria` name only `edges[].condition`. They need
widening to `config.condition` so a consumer replaying the chain is told to sweep
the node key too; that file is in `packages/spec`.
(2) `@objectstack/lint`'s `validate-expressions` applies only
`structuralConditionRefusal` to a structural condition, so `objectstack validate`
still reports nothing for a blank `config.condition` that `registerFlow` now
refuses — the two doors disagree until that rule is rebound as well.
