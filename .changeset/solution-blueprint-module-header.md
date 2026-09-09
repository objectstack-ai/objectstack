---
"@objectstack/spec": patch
---

`ai/solution-blueprint.zod.ts` publishes its own sentence again, instead of a list of the symbols it happens to export.

The file always carried a real module header — ADR-0033 §4 plan-first authoring, and how the `apply_blueprint` tool expands each entry into a proper metadata body. But only a blank line separated that header from `const SNAKE_CASE`, and TSDoc's own attachment rule says a block belongs to the declaration it immediately precedes. The header-zone selector reads that rule back, so the header counted as the regex constant's documentation and was disqualified as the module's. Both generators then fell through to their export-list fallback, and the row published into the `objectstack-ai` skill index read:

```
- `…/ai/solution-blueprint.zod.ts` — Exports: BlueprintConditionSchema, BlueprintSummaryOperationsSchema, …
```

A true statement about the file that says nothing about its subject — on the one row whose job is to send an agent to this source for exact field shapes.

`SNAKE_CASE` now carries the one-line doc it always deserved. A comment is not a declaration, so the preamble ends there and the header becomes the module's own block. The published row and the public reference page both open on it:

```
- `…/ai/solution-blueprint.zod.ts` — Solution Blueprint Schema (ADR-0033 §4 — plan-first authoring)
```

The selector is untouched. Under its own rule it was deciding correctly, and a census of every source under `packages/spec/src` found this file to be the only one of its kind: 19 shipped `*.zod.ts` sources have a header-zone block sitting against a declaration, and in the other 18 that block genuinely documents the symbol it sits against (`Transport Protocol Enum` against `TransportProtocol`, `Shared history for this file` against `AGENT_HISTORY`). Only here did a module header sit against a constant it says nothing about.

Neither generator can see this class — each compares its artifact against itself, and each reproduced the selector faithfully, so a generator-only check passes on the defect. A pin now asserts the content of the published row directly.
