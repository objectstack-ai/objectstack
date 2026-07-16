# ADR-0064: Tool scoping — an agent's tools are exactly its skills' tools

> **🔶 Cloud-owned — superseded in part by cloud ADR-0025 (2026-06-25).** The in-UI AI runtime and the `ask` / `build` agents described here moved to the **cloud / Enterprise** distribution (`@objectstack/service-ai` → `cloud/packages/service-ai`, closed); the open framework exposes AI only via `@objectstack/mcp` (BYO-AI) and ships no in-product `ask` / `build` chat. Retained as historical design context, now **cloud-owned** — see [`cloud/docs/adr/0025-service-ai-to-cloud-open-mcp-only`](https://github.com/objectstack-ai/cloud/blob/main/docs/adr/0025-service-ai-to-cloud-open-mcp-only.md).

**Status**: Proposed (2026-06-22) — cloud-owned (2026-07-16 audit): the only framework dependency (`skill.surface`) exists; the tool-resolution scoping, global fall-through removal, and bind-time affinity error live in cloud `service-ai` and are not verifiable in this repo.
**Deciders**: ObjectStack Protocol Architects
**Builds on**: [ADR-0063](./0063-two-kernel-agents-skills-are-the-extension-primitive.md) (two agents bound by surface; skill ↔ agent affinity), [ADR-0033](./0033-ai-assisted-metadata-authoring.md) (draft-gated authoring tools)
**Resolves**: [ADR-0040 §4](./0040-unified-assistant-and-agent-binding.md) ("tools are registry-global; a custom agent can change persona but not constrain capability") — the named follow-up contract.
**Consumers**: `@objectstack/service-ai` (ToolRegistry, AgentRuntime), `../cloud/service-ai-studio` (authoring tools), `@objectstack/spec` (no schema change required)

---

## TL;DR

Today every agent can see every registered tool: the `ToolRegistry` is **global**, and the `actions_executor` skill deliberately **falls through** to the global list. That is the ADR-0040 §4 gap — the reason a data assistant *could* author metadata.

With [ADR-0063](./0063-two-kernel-agents-skills-are-the-extension-primitive.md) settling **two distinct agents bound by surface**, the fix is structural, not a new permission system:

> **An agent's available tools = the union of the tools declared by the skills bound to that agent. Nothing falls through to the global registry.**

The registry stays global for *registration*; *resolution* is scoped by the agent's skill bundle, which is itself scoped by `surface` affinity. `ask` literally has no authoring tools in its tool set, so it cannot author — by construction, not by a runtime check.

---

## Context

Findings from the 2026-06 ask/build assessment, confirmed across three packages:

- **One global `ToolRegistry` per AI service** (`service-ai/src/tools/tool-registry.ts`); `register()` takes no agent/skill/surface argument.
- **`AgentRuntime.buildRequestOptions()`** composes an agent's tools from `agent.tools[]` + each active skill's `tools[]`, deduped — *but*:
- **`actions_executor` intentionally declares an empty `tools: []` and relies on a fall-through** so the resolver hands it the whole `action_*` set from the global registry (`service-ai/src/skills/actions-executor-skill.ts`). This fall-through is the hole: any agent loading that skill — or any resolver bug — exposes the global list.
- **Cloud authoring tools register globally** (`service-ai-studio/src/plugin.ts`); `describe_object` / `list_objects` are explicitly commented as shared by both agents.

So scoping exists only by convention (which skills an agent happens to carry), with a deliberate bypass. ADR-0040 §4 flagged this; ADR-0063 makes it fixable cleanly because there is now no tenant agent and each skill has a single-surface home.

## Decision

### 1. Resolution is closed over the skill bundle

`AgentRuntime` computes an agent's tool set strictly as:

```
tools(agent) = ⋃ { skill.tools  |  skill ∈ agent.skills  ∧  skill.surface ∈ {agent.surface, 'both'} }
```

No tool reaches the model unless a bound, surface-compatible skill names it. **Remove the global fall-through.** Wildcards stay, but resolve against the registry *filtered to the names a skill claims*, not the whole registry:

- `actions_executor` declares `tools: ['action_*']` and the resolver expands `action_*` against registered tools — but only because the skill *claims* the pattern, not via fall-through. The empty-array + fall-through hack is deleted.

### 2. Registry stays global; a tool may be claimed by many skills

Tools are still registered once on the shared registry (no per-agent registration, no duplication). Scoping is a *read-time filter*, not a partitioned store. A tool can be claimed by skills on different surfaces — that is how genuinely shared read tools work:

- `describe_object`, `list_objects`, `query_data` are claimed by a `surface:'both'` **`schema_reader`** skill (or listed in both `data_explorer` and a build skill). They are read-only and safe to share.
- Authoring/mutation tools (`create_metadata`, `apply_blueprint`, `add_field`, …) are claimed **only** by `surface:'build'` skills. They are therefore absent from `ask`'s tool set on every deployment, and absent entirely on OSS where no `build` skill is registered.

### 3. Affinity is enforced at bind time

A skill whose `surface` is incompatible with an agent is a **load error**, not a silent drop: binding a `surface:'build'` skill to `ask` fails fast in `resolveActiveSkills`. This makes "ask can't author" a checked invariant, not an emergent property.

### 4. No new schema

This needs no field beyond ADR-0063's `skill.surface`. `ToolSchema` gains **no** `scopedToSurface` field — scoping is derived (tool ← skill ← agent), not declared on the tool. Declaring it on the tool too would create a second source of truth that can disagree with the skill bundle. (Tool-level `permissions` for RLS/role checks is orthogonal and stays.)

## Consequences

**Positive**
- Closes the ADR-0040 §4 hole structurally: `ask` cannot author because authoring tools are not in its set — no runtime guard to forget.
- Single source of truth for "who can call what": the skill bundle. No tool-side scoping to drift.
- Shared read tools remain shared, explicitly, via a `surface:'both'` reader skill.

**Negative / costs**
- Deletes the `actions_executor` fall-through and the global-list reliance; any resolver path depending on fall-through must be migrated to explicit claims.
- Requires auditing currently-global tools into surface-correct skills (esp. the shared read tools → a `both` reader skill).
- A misfiled skill `surface` now silently narrows or widens an agent's reach — so `surface` correctness is load-bearing and must be covered by tests.

## Follow-up work (consolidated issue)

- [ ] Remove the global fall-through in tool resolution; resolve wildcards against skill-claimed names only.
- [ ] Introduce a `surface:'both'` `schema_reader` skill owning `describe_object`/`list_objects`/`query_data`; stop dual-listing by comment.
- [ ] Make incompatible skill↔agent binding a fast load error in `resolveActiveSkills`.
- [ ] Tests: assert `tools(ask)` contains no `create_*`/`*_metadata`/blueprint tools on cloud and OSS; assert authoring tools present only under `build`.
