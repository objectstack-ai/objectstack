---
"@objectstack/spec": major
---

refactor(spec)!: remove the four inert tool authoring keys — two of them promised safety they never delivered (#3896 close-out)

`tool.category`, `tool.permissions`, `tool.active` and `tool.builtIn` were
authorable and inert: none is part of `AIToolDefinition`, and no execution path
read them. The liveness ledger had already corrected all four to dead+authorWarn
(#3686); this finishes the enforce-or-remove disposition inside the v17 window,
following the `requiresConfirmation` precedent (#3715) — because two of the four
were misleading in the dangerous direction:

- **`permissions`** promised a capability gate on tool invocation. Nothing
  enforced it — a tool "requiring" capabilities ran for everyone. The real gates
  are `action.requiredPermissions` (ADR-0066) and permission sets on the objects
  the tool touches.
- **`active: false`** read as "withdrawn". It withdrew nothing: `ToolRegistry.getAll()`
  returns everything, the tool kept reaching the LLM tool set, and
  `POST /ai/tools/:name/execute` kept running it — unlike `agent.active` /
  `skill.active`, which are enforced. To withdraw a tool, remove it from the
  skills/agents that reference it.

The retirement kit:

- The `.strict()` ToolSchema rejects each retired key with its own prescription
  (`TOOL_RETIRED_KEY_GUIDANCE`, the #3715 pattern) — no silent strip.
- **ADR-0087 D2 conversion + D3 chain step** (`tool-inert-authoring-keys-removed`):
  `os migrate meta` deletes the keys mechanically; a pure lossless delete, since
  they never had any effect to lose.
- `ToolCategorySchema` / `ToolCategory` are removed with the key they typed
  (zero consumers; `action.zod.ts` deliberately keeps its own inline vocabulary).
- The Studio tool form drops its inputs for the retired keys — a form input for
  an unenforced gate is the UI half of false compliance, the same
  "advertising the failure mode" shape objectui#2962 removed from the
  sharing-criteria builder.
- Ledger entries deleted per the #3715 precedent; baselines
  (`authorable-surface.json`, `json-schema.manifest.json`) updated deliberately;
  reference docs and the v17 release notes regenerated/extended.

No runtime behaviour changes — that impossibility is the reason for the removal.
