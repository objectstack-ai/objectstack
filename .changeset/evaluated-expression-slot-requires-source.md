---
"@objectstack/spec": minor
---

feat(spec)!: an evaluated expression slot requires a non-blank `source` — `EvaluatedExpressionSchema`, composed by the `assignment` value envelope (#15430)

<!-- adr-0087: not-required (no-migration-prescription) No authorable key is renamed, retired or re-typed: `source` keeps its name and meaning, and every envelope that carried a non-blank `source` parses byte-identically. The two newly refused spellings — an envelope carrying only `ast`, and a `source` that is blank after trimming — never evaluated on any release (the `ast`-only one faulted at run time with the engine's own "persist `source`" prescription, the blank one with a parse error), and a repo-wide census found no in-repo instance of either, so `objectstack migrate meta` has nothing to rewrite and the remedy is authoring a `source`, which the refusal itself prescribes. -->

**BREAKING** in the accept-set sense, landing in the launch window as `minor`
(the lockstep convention): on the schemas that type an EVALUATED expression
slot — today the `assignment` node's value envelope,
`AssignmentExpressionValueSchema` — an envelope with no `source` the engine can
evaluate is now **refused at authoring**, where it used to parse, register,
pass `objectstack validate`, and then fault at run time.

Two spellings of one seam, refused by ONE rule with one message at `source`
(`EVALUATED_EXPRESSION_SOURCE_REQUIRED`):

```yaml
assignments:
  digest: { dialect: cel, ast: { kind: const } }   # `ast` only — no engine evaluates it
  greeting: { dialect: cel, source: '   ' }         # blank after trimming — parses to EOF
```

> An expression in an evaluated slot needs a non-blank `source`: the expression
> engine evaluates `source` (the canonical persisted form of phase M9.1) and
> cannot evaluate `ast` alone, so an envelope carrying only `ast`, or a `source`
> that is blank after trimming, would validate and register and then fault at
> run time. Write `{ dialect: 'cel', source: '…' }`.

- **`ExpressionSchema` is NOT narrowed.** It is the persistence contract —
  `source` OR `ast` — and its docblock declares that `ast` becomes required in
  build output at phase M9.2. The new export `EvaluatedExpressionSchema` (and
  its type `EvaluatedExpression`) is a sibling: the same envelope with `source`
  required and non-blank, spelled once and composed by every evaluated slot, so
  when AST-only evaluation lands the flip is one edit there rather than a
  per-slot unwinding. The rule is worded as "an evaluated slot requires whatever
  the engine can actually evaluate"; what that is today is `source`.
- **The notion of blank is the engine's own** — `.trim()`, which
  `cel-engine.ts`'s helpers already apply — not a third one beside the shape
  rule's `min(1)` and `validateExpression`'s trim.
- **Three doors agree.** `registerFlow` refuses the flow, `objectstack validate`
  and the runtime publish gate report a located `error` at the author's own
  variable (`config.assignments.<name>.source`), and the executor's own shape
  pass refuses the same set — all through the spec schema, so none of them
  grew a rule of its own.

**What an author does with a refused envelope.** An assignment value that
carried only `ast` has no evaluable form under M9.1: author its `source`. A
whitespace-only `source` was never an expression: delete the entry, or write
the expression. Every envelope with a non-blank `source` is unchanged, and
nothing is renamed, retired or rewritten — the refusal itself carries the
prescription.

Not touched here: the `predicate` half of the same seam — `evaluateCondition`'s
silent `false` on an envelope without a `source` — is a behaviour change on a
live path with its own card, and the edge-condition schema that carries that
envelope is narrowed in a follow-up once the in-flight change to
`automation/flow.zod.ts` lands.
