---
"@objectstack/spec": minor
---

feat(spec)!: `FlowEdgeSchema.condition` is an evaluated slot — it composes the new `EvaluatedExpressionInputSchema`, and `structuralConditionRefusal` no longer admits an `ast`-only envelope (#15807)

<!-- adr-0087: registered flow-edge-condition-evaluated-slot-source-required -->

**BREAKING** in the accept-set sense, landing in the launch window as `minor`
(the lockstep convention: `major` is refused by `check-changeset-no-major`, and
breaking-ness is carried by this banner plus the ADR-0087 disposition): the
edge condition of a flow — `FlowEdgeSchema.condition`, the branch predicate
`AutomationEngine.evaluateCondition` runs at every traversal — now refuses at
authoring an envelope the engine cannot evaluate, where it used to parse,
register, pass `objectstack validate`, and then answer a **silent `false`**: a
branch that quietly never fired.

Two spellings of one seam, refused by ONE rule with one sentence
(`EVALUATED_EXPRESSION_SOURCE_REQUIRED`, the rule #15430 introduced for the
`assignment` value envelope):

```yaml
edges:
  - { id: e1, source: check, target: approve, condition: { dialect: cel, ast: { kind: const, value: true } } }  # `ast` only — the engine never reads it
  - { id: e2, source: check, target: reject,  condition: { dialect: cel, source: '   ' } }                    # blank after trimming
  - { id: e3, source: check, target: escalate, condition: '   ' }                                             # the shorthand for the same blank source
```

> An expression in an evaluated slot needs a non-blank `source`: the expression
> engine evaluates `source` (the canonical persisted form of phase M9.1) and
> cannot evaluate `ast` alone, so an envelope carrying only `ast`, or a `source`
> that is blank after trimming, would validate and register and then fault at
> run time. Write `{ dialect: 'cel', source: '…' }`.

- **New export `EvaluatedExpressionInputSchema`** (type `EvaluatedExpressionInput`),
  the sibling of `ExpressionInputSchema` for an evaluated slot: the bare-string
  shorthand still normalizes to `{ dialect: 'cel', source }`, but the string
  must be non-blank after trimming, and the envelope arm composes
  `EvaluatedExpressionSchema` (`source` required and non-blank) instead of
  `ExpressionSchema`. `FlowEdgeSchema.condition` is the first slot to compose
  it. An `ast`-only envelope and a blank bare string surface as one
  `invalid_union` issue at the slot carrying the sentence above; a blank
  `source` inside an envelope surfaces as one `custom` issue at `source`.
- **`ExpressionSchema` / `ExpressionInputSchema` are NOT narrowed.** They remain
  the persistence contract (`source` OR `ast`), whose docblock declares that
  `ast` becomes required in build output at phase M9.2. When AST-only
  evaluation lands, `EvaluatedExpressionSchema` is the one place to relax, and
  every evaluated slot follows.
- **`structuralConditionRefusal` no longer admits an `ast`-only envelope** on
  either structural condition slot (`config.condition` on a node,
  `edge.condition`). #15662's refusal admitted it on purpose through a
  `rec.ast !== undefined` clause, because the spec still admitted the shape at
  `edge.condition` and refusing it from the consumer side would have decided
  #15430's question there; with the edge schema closed, that admission kept the
  refusal deliberately holed for a shape the engine cannot run on either slot.
  `STRUCTURAL_CONDITION_SHAPE_REFUSAL` now reads "an expression envelope
  carrying a string `source`" and says why. Consequence on `config.condition`
  (a start node's trigger gate, a decision node's predicate — an open record
  with no schema in front of it): an `ast`-only envelope there is refused at
  `registerFlow`, reported as a located `error` by `objectstack validate`, and
  refused by `evaluateCondition` with the same sentence, instead of answering a
  silent `false`. An `ast` BESIDE a string `source` is still admitted
  everywhere. The whitespace-only STRING ruling on `config.condition` (#15662:
  consistent `false` on both sides) is untouched.
- **Three doors agree, through the spec.** `registerFlow` refuses the flow at
  `FlowSchema.parse` (edge) or at its structural pass (`config.condition`);
  `objectstack validate` refuses it at its `ObjectStackDefinitionSchema` parse
  (edge) or reports the structural refusal (`config.condition`);
  `evaluateCondition` refuses the shape a stored flow or a direct caller hands
  it. None of them grew a rule of its own.

**What an author does with a refused edge condition.** An edge condition that
carried only `ast` has no evaluable form under M9.1: author its `source`. A
whitespace-only condition — envelope or bare string — was never a predicate
(the engine answered `false`, so that edge never fired): remove the
`condition` key if the edge was meant to be unconditional, or write the
expression if it was meant to branch. Every edge condition with a
non-blank `source` is unchanged, and nothing is renamed, retired or rewritten —
the refusal itself carries the prescription.

**A flow ALREADY STORED in `sys_metadata` stops running entirely — the whole
flow, not just the edge.** The paragraph above is the author's remedy, at
`objectstack validate` / `POST /flows`; a stored row has no author in front of
it. Stored flows are deliberately NOT canonicalized by
`applyConversionsToStoredItem` (`spec/src/conversions/stored.ts`, and the same
skip in `metadata/src/loaders/database-loader.ts`'s `rowToData`) — flow-node
conversions need the automation engine's live executor registry, so flows
canonicalize at `registerFlow` instead, which parses through
`canonicalizeStoredFlow` → `FlowSchema.parse`. Each of the three boot paths in
`service-automation/src/plugin.ts` wraps that call in `try`/`catch`, logs one
`warn` naming the flow, and continues. So an edge that used to answer a silent
`false` while the rest of the flow ran now takes the flow down with it: it is
never registered, its trigger is never armed, and the only announcement is that
one warn line — `[Automation] failed to register flow` at boot,
`[Automation] cold-boot flow bind: failed to register flow` at the kernel:ready
bind, `[Automation] flow re-sync: failed to register flow` on a re-sync. That
warn line is also the locator: its `issues[].path` names the offending edge —
`edges[N].condition` — beside the sentence above, so nothing has to be exported
to find it. Author the `source` — or remove the key, if the edge was meant to
be unconditional — and republish. A stack authored in config files has a second
door, `objectstack validate`, which locates the same edge at
`flows.N.edges.N.condition`. Registered as the ADR-0087 D3 semantic entry
`flow-edge-condition-evaluated-slot-source-required`, which carries the same
judgment for a consumer replaying the chain.

Not touched here: `start.config.condition` has no Zod schema to narrow (the
start node's `config` is an open record); its producer-side gate is the
structural refusal above, which this change tightens but does not type.
