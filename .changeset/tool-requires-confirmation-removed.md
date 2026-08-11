---
"@objectstack/spec": minor
"@objectstack/platform-objects": patch
---

feat(spec)!: remove `tool.requiresConfirmation` — a safety flag nothing enforced (#3715, ADR-0033 §2)

`ToolSchema.requiresConfirmation` accepted `true` and no execution path ever read
it. Not the LLM tool set (a tool reaches the model as name/description/parameters
only), not `ToolRegistry.execute`, not `POST /ai/tools/:name/execute`, and not the
MCP bridge — which derives `destructiveHint` from a hardcoded name list. Setting
it on a destructive tool produced **no pause**.

For an ordinary dead property that is untidy. For a **safety** property it is
false compliance, which is the case ADR-0049 exists for: an author gates a
destructive tool, sees the flag accepted, and ships believing a human is in the
loop. It is made worse by the near-miss — `action.ai.requiresConfirmation` has
the same name and **does** work, so the mistake reads as correct in review.
ADR-0033 §2 already resolved to delete this one.

## Migration

- **FROM:** `requiresConfirmation: true` on a tool definition
- **TO:** put the operation behind an action and set `ai.requiresConfirmation:
  true` there — that is the flag the HITL approval queue reads
  (`packages/runtime/src/action-execution.ts`) and the only path that actually
  stops execution.
- For AI *metadata* mutations there is nothing to migrate: the ADR-0033
  draft/publish workspace is the gate — nothing is live until a human publishes.

**`ToolSchema` is now `.strict()`.** This is load-bearing, not tidying. Removing a
key from a non-strict schema swaps one silent no-op for another: zod strips the
key wordlessly, the author keeps writing it, and the safety flag goes on meaning
nothing — the "silent strip" ADR-0032 / #1535 closed for objects. The retired key
now **rejects**, and the error carries the FROM → TO above, because a parse error
is the one channel every consumer bumping `@objectstack/spec` is guaranteed to
hit.

Strictness applies to *all* unknown keys on a tool definition, so a typo
(`buildIn`, `catagory`) is now a located parse error instead of a silently
dropped field.

Also removed: the Studio form row, its four generated locale bundles (the
`en`/`zh-CN`/`ja-JP`/`es-ES` strings still promised *"Ask user to approve before
executing (for destructive actions)"* — a translated false promise), the
liveness-ledger entry, and the generated reference-doc row.

objectui's `ToolPreview.tsx` reads the field via `!!d.requiresConfirmation`, so it
degrades to "not shown" with no error; removing that badge is a follow-up in that
repo.

<!-- adr-0087: registered tool-requires-confirmation-retired -->
