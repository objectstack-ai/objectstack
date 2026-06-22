# Assessment: `ask` / `build` agent development surface (2026-06-22)

**Type**: development assessment / landscape (NOT an ADR — this routes work, it does not decide).
**Scope**: every code touchpoint for the two kernel agents across `@objectstack/service-ai` (OSS `ask`), `@objectstack/service-ai-studio` (cloud `build`), `@objectstack/spec` (agent/skill/tool schemas), and `../objectui` (chat surface).
**Frames**: [ADR-0040](../adr/0040-unified-assistant-and-agent-binding.md), [ADR-0063](../adr/0063-two-kernel-agents-skills-are-the-extension-primitive.md), [ADR-0064](../adr/0064-tool-scoping-to-agent.md).
**Method**: four parallel read-only inventories. File:line references below are accurate as of this worktree.

> **Outcome (see §5):** D2 resolved to **two distinct agents bound by surface**; ADR-0040's unified-assistant core is reversed.

---

## 1. Touchpoint inventory

Status legend — **D** decided (cite ADR) · **O** open decision (needs an ADR) · **I** implementation (issue/PR).

### `ask` agent — OSS `packages/services/service-ai/`
| Touchpoint | File | Status | Landing |
|---|---|---|---|
| `ask` agent record (id `ask`, role "Business Application Assistant", **4 skills listed**, guardrails, react planning) | `src/agents/data-chat-agent.ts:42` | D | ADR-0063 |
| Boot UPSERT of agent + `data_explorer`/`actions_executor` skills | `src/plugin.ts:823` | D | — |
| Alias resolution `data_chat`→`ask` (per-plugin `registerAgentAlias`) | `src/agents/agent-aliases.ts:24` | D | — |
| File still named `data-chat-agent.ts`; `DEFAULT_DATA_AGENT_NAME` const | `src/agents/data-chat-agent.ts` | I | issue |
| `data_explorer` / `actions_executor` skills (no `surface` field) | `src/skills/*.ts` | I | ADR-0063 + issue |
| **Global** ToolRegistry — no per-agent/shell scoping | `src/tools/tool-registry.ts:49` | D→I | **ADR-0064** |
| Intent routing is LLM-side (prompt directive) — to be removed | `src/agents/data-chat-agent.ts:52` | I | ADR-0063 (reversed) |
| `buildRegisterActive` degradation shim — to be deleted | `src/agent-runtime.ts:179` | I | ADR-0063 |
| Agent access gate + daily message quota | `src/routes/agent-routes.ts:147`, `src/quota/agent-chat-quota.ts` | D | — |

### `build` agent — cloud `packages/service-ai-studio/`
| Touchpoint | File | Status | Landing |
|---|---|---|---|
| Build agent record — **canonical id still `metadata_assistant`** (role "Schema Architect", 2 skills, no tools) | `src/agents/metadata-assistant-agent.ts:26` | I | issue (rename → `build`) |
| `metadata_authoring` skill (12 authoring tools, draft-gated, ADR-0038 discipline) | `src/skills/metadata-authoring-skill.ts:18` | D | — |
| `solution_design` skill (blueprint propose/apply, plan-first) | `src/skills/solution-design-skill.ts:15` | D | — |
| All authoring tools registered **globally**; `describe_object`/`list_objects` explicitly shared with `ask` | `src/plugin.ts`, `src/tools/*.tool.ts` | D→I | **ADR-0064** |
| Plugin attaches on `ai:ready`; absent on OSS → authoring dark, manual draft still works | `src/plugin.ts:56` | D | ADR-0063 §5 |
| Blueprint object quota (`AI_STUDIO_MAX_BLUEPRINT_OBJECTS`, default 20) | `src/tools/blueprint-tools.ts:84` | D | — |
| Comment: tenants customize via **custom agent bound through `app.defaultAgent`** | `src/plugin.ts:274` | D | ADR-0063 §2 (withdraw) |

### `@objectstack/spec`
| Touchpoint | File | Status | Landing |
|---|---|---|---|
| AgentSchema (no `surface`; guardrails agent-level only) | `src/ai/agent.zod.ts:130` | D | — |
| SkillSchema — **no `surface` field** | `src/ai/skill.zod.ts:57` | I | ADR-0063 + issue |
| ToolSchema — no shell/agent scoping field (and none needed) | `src/ai/tool.zod.ts:63` | D | ADR-0064 §4 |
| Registry: `agent` type `allowRuntimeCreate:true, allowOrgOverride:true` | `src/kernel/metadata-plugin.zod.ts:684` | D→I | ADR-0063 §2 (flip false) |
| No deployment guardrail-floor schema | (absent) | O | defer (D4) |

### `../objectui` chat surface
| Touchpoint | File | Status | Landing |
|---|---|---|---|
| Agent resolution: `app.defaultAgent` → `ask` → first active; alias-aware | `packages/plugin-chatbot/src/useAgents.ts:71` | D | — |
| Alias groups `['ask','data_chat']`, `['build','metadata_assistant']` | `packages/plugin-chatbot/src/agentAliases.ts:22` | D | — |
| Agent picker — **hidden by default**, gated by `VITE_AI_SHOW_AGENT_PICKER` | `packages/app-shell/src/layout/ConsoleFloatingChatbot.tsx:486` | D | ADR-0040 (kept) |
| No "create agent" UI; AgentPreview read-only; catalog routes to custom agents by name | `.../metadata-admin/previews/AgentPreview.tsx` | D/I | issue |
| Two surfaces `/ai/ask` and `/ai/build` with distinct empty-states | `.../console/ai/AiChatPage.tsx:176` | D | ADR-0063 §1 (surface binding) |
| `aiStudio` flag off → build agent suppressed, FAB falls back to `ask` | `.../layout/ConsoleLayout.tsx:79` | I | — |

---

## 2. Findings

**F1 — Two coexisting agent models, partly contradictory (the headline).** ADR-0040 ships a *unified* assistant: the `ask` record lists **all four** skills and degrades to data-only when build skills aren't registered (`agent-runtime.ts:179`). But the cloud package *also* ships a **separate** `metadata_assistant` agent with only the two build skills, pinned by Studio. So "build vs data" exists simultaneously as (a) two registers inside one `ask` agent and (b) two distinct agent records. **This forced the D2 decision** (§5).

**F2 — Tool scoping is genuinely absent everywhere.** Every repo confirms a single **global** `ToolRegistry`; any agent can see any registered tool; `actions_executor` deliberately falls through to the global list. ADR-0040 §4 / "scope tools to the agents" is **unbuilt** → ADR-0064.

**F3 — Naming drift is two-sided.** `ask` is canonical but the file is still `data-chat-agent.ts`. **`build` is NOT canonical in code** — the cloud id is still `metadata_assistant`; `build` exists only as a UI/alias. The rename must cover the *build* side too.

**F4 — Tenant custom agents are fully wired today.** `agent` type is `allowRuntimeCreate:true, allowOrgOverride:true`; the cloud plugin documents `app.defaultAgent` custom binding; objectui routes to catalog custom agents (no create UI). Withdrawing them is a real change.

**F5 — Tier degradation already partially exists.** The `buildRegisterActive` gate self-constrains `ask` on OSS — but it is the unified-model shim and is removed under D2 (surfaces are separated instead).

**F6 — The "guardrail floor" is asserted but unimplemented.** Only per-agent guardrails exist; no deployment/tier floor. Lower priority once tenant agents are withdrawn (no tenant agent to floor).

---

## 3. Open decisions → where they landed

| # | Decision | Verdict | Container |
|---|---|---|---|
| **D2** | unified assistant (0040) vs two distinct agents | **RESOLVED → two distinct agents, surface-bound** | ADR-0063 (revised) |
| **D1** | tool scoping mechanism | resolved as "tools = skills' tools" | **ADR-0064** |
| D3 | OSS↔cloud composition | folds into D2 (separate agents, package-gated) | ADR-0063 §5 |
| D4 | deployment guardrail-floor schema | defer (low pri post-F4) | later |
| D5 | `surface: 'ask'\|'build'\|'both'` skill field | adopted | ADR-0063 §3 + issue |
| I1 | rename drift (both sides), prose sweep | impl | issue |
| I2 | withdraw tenant agents (flip flags, filter catalog) | impl | issue |
| I3 | split personas; surface-binding in objectui | impl | issue |

---

## 4. Recommendation (historical — superseded by §5)

Originally floated "one assistant, two tiers." **Not taken** — see §5.

---

## 5. Decision taken (2026-06-22)

D2 resolved **against** the "one assistant, two tiers" option §4 floated. Rationale (architect): Claude Chat and Claude Code are deliberately **separate products for different needs**, and ADR-0040's unified assistant + per-turn intent classifier was the design error — its own staging incident is evidence the *surfaces leaked*, not that the personas should merge.

**Resolution: two distinct agents (`ask` / `build`), bound by surface.** ADR-0040's unified-assistant core is reversed; "user never picks a roster" is kept but re-grounded as *surface binding*. See:

- **[ADR-0063](../adr/0063-two-kernel-agents-skills-are-the-extension-primitive.md)** (revised) — two agents bound by surface; skills-only third-party extension; `surface` affinity; naming; supersedes ADR-0040 core + §3.
- **[ADR-0064](../adr/0064-tool-scoping-to-agent.md)** — tool scoping: an agent's tools = its skills' tools (resolves ADR-0040 §4).

Implementation (split personas, make `build` canonical, finish `ask` rename, withdraw tenant agents, `surface` field, surface-binding in objectui) is consolidated in the follow-up issue. D4 (guardrail floor) remains deferred.
