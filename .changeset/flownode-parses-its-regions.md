---
'@objectstack/spec': minor
'@objectstack/service-automation': patch
---

feat(spec)!: `FlowNodeSchema` parses its own ADR-0031 regions — the post-parse pass retires (#4415)

`FlowSchema.parse` normalized a flow's own `nodes[]` / `edges[]` but could not reach a
**region**, because a region lives inside `FlowNodeSchema.config` — a deliberately open
`z.record` (ADR-0018). #4381 closed the resulting gap with a **post-parse pass**,
`normalizeControlFlowRegions`, that every caller had to remember to run:

```ts
const flowShell = FlowSchema.parse(converted);
validateControlFlow(flowShell);
const parsed = normalizeControlFlowRegions(flowShell);   // ← had to remember
```

That is an unwritten rule on top of a parse, and it is exactly the condition the #4347
family of defects grows in: a new consumer — a Studio publish path, an MCP tool, a bulk
validation script — takes a `FlowParsed` and uses it, holding a **half-parsed flow that
looks finished**. Nested edge predicates were still bare strings, nested nodes had not been
through `.strict()`, and nothing said so.

Now the schema does it. `FlowNodeSchema` carries a `.transform()` that parses each declared
region slot — `loop.config.body`, `parallel.config.branches[]`, `try_catch.config.try` /
`.catch` — through the schema that slot's value *is*. Nesting needs no manual recursion: a
region's `nodes` are `z.array(FlowNodeSchema)`, so Zod re-enters the transform on the way
down. **"Parsed" now means parsed at every depth** (Prime Directive #1), from any entry
point — including `FlowNodeSchema.parse(node)` on a single node, which the old whole-flow
pass could not serve at all.

## Migration

**`normalizeControlFlowRegions` is removed from `@objectstack/spec/automation`.** Delete the
call; the parse above it already did the work:

```diff
  const parsed = FlowSchema.parse(converted);
  validateControlFlow(parsed);
- const normalized = normalizeControlFlowRegions(parsed);
```

Its replacement, `parseFlowNodeRegions(node)`, is exported for the same purpose one node at
a time, but you should not normally need it — it is the transform's own body.

**`FlowNodeSchema` is now a `ZodPipe`, not a `ZodObject`,** so it no longer has `.shape` /
`.extend()` / `.pick()`. `z.infer` / `z.input` / `.parse` / `.safeParse` and
`z.toJSONSchema` are unaffected, and the authorable key set is byte-identical (verified by
`check:authorable-surface`). If you were reaching for the object half, read it from the
pipe's input side — `FlowNodeSchema.def.in` — which is also what the repo's own generators
do (`pipeAuthorableSide` in `scripts/lib/zod-graph.ts`).

One visible consequence in the generated reference: `content/docs/references/automation/flow.mdx`
now renders FlowNode's **input** shape, so keys carrying a `.default()` (`boundaryConfig.interrupting`,
`inputSchema[].required`) show as optional. That is what an author actually writes, which is
what an authoring reference should say.
