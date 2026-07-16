# ADR-0063: Two agents (`ask` / `build`), bound by surface; skills are the only third-party extension primitive

> **🔶 Cloud-owned — superseded in part by cloud ADR-0025 (2026-06-25).** The in-UI AI runtime and the `ask` / `build` agents described here moved to the **cloud / Enterprise** distribution (`@objectstack/service-ai` → `cloud/packages/service-ai`, closed); the open framework exposes AI only via `@objectstack/mcp` (BYO-AI) and ships no in-product `ask` / `build` chat. Retained as historical design context, now **cloud-owned** — see [`cloud/docs/adr/0025-service-ai-to-cloud-open-mcp-only`](https://github.com/objectstack-ai/cloud/blob/main/docs/adr/0025-service-ai-to-cloud-open-mcp-only.md).

**Status**: Proposed (2026-06-22) — cloud-owned (2026-07-16 audit): the framework spec dependencies shipped (`skill.surface` + `agent.surface` enums, `spec/ai/{skill,agent}.zod.ts`); the runtime two-agent split, shim removal, ask-rename and tenant-agent withdrawal live in cloud `service-ai` / objectui and are not verifiable in this repo.
**Deciders**: ObjectStack Protocol Architects
**Supersedes**: [ADR-0040](./0040-unified-assistant-and-agent-binding.md) — its core decision (a *single* unified assistant selected by *per-turn intent classification*) is **reversed**. ADR-0040's UX win ("the end user never picks from a roster") is **kept** but re-grounded: the *surface* binds the agent, not a classifier and not a dropdown. §3 (custom tenant agents) is withdrawn; §4 (tool-scoping) is handed to [ADR-0064](./0064-tool-scoping-to-agent.md).
**Builds on**: [ADR-0033](./0033-ai-assisted-metadata-authoring.md) (draft → verify → publish), [ADR-0038](./0038-build-verification-loop.md) (verify-fix-reverify discipline carried by skills)
**Consumers**: `@objectstack/spec` (agent/skill types), `@objectstack/service-ai` (the open-source `ask` agent), `../cloud/service-ai-studio` (the cloud-only `build` agent), `../objectui` (chat surfaces)

**Premise**: pre-launch, no back-compat debt beyond the alias table — specify the target end-state directly.

> **Revises** the first cut of ADR-0063 (merged in #2164), which framed the two as "shells split by what they mutate" while leaving ADR-0040's unified assistant in place. On reflection the unified assistant was itself the error; this revision separates the two agents by *surface*.

---

## TL;DR

The kernel ships **exactly two agents**, and they are **two products for two different needs**, not two intents of one assistant:

- **`ask`** — the data product (≈ **Claude Chat**). Conversational read/query/explore over records, and execution of business actions. End-user audience, RLS-bounded, fast turns. **Open-source, free** (`@objectstack/service-ai`).
- **`build`** — the authoring product (≈ **Claude Code**). Agentic mutation of *metadata* (objects, fields, views, flows) through a plan → draft → verify → publish loop. Builder/admin audience, governance-gated, long-running pinned sessions. **Cloud-only, paid** (`../cloud/service-ai-studio`).

**The user never picks an agent from a roster — the surface they are in binds it.** You are in the data console → `ask`; you are in the builder/Studio → `build`. Exactly as you open *claude.ai* or you open *Claude Code* — you choose a product, not an agent.

Everything else — domain depth, playbooks, persona, judgment, reach to external systems — is delivered as **skills** (+ tools / MCP), each bound to one agent by affinity. **Third parties extend the platform by authoring `*.skill.ts` and tools, never `*.agent.ts`.** Claude Code is enormously capable and ships **zero** user-authored agents — its power is skills + tools/MCP + platform-owned subagents. ObjectStack adopts the same shape.

---

## Context — why ADR-0040's unified assistant was the wrong call

ADR-0040 collapsed data Q&A and metadata authoring into **one** assistant carrying *all* skills, switched by a **per-turn intent classifier**. On reflection that was a design error, for the same reason Anthropic ships Claude Chat and Claude Code as **separate products**: they serve genuinely different needs, with different interaction models, audiences, risk profiles, and pricing.

| | `ask` (≈ Chat) | `build` (≈ Code) |
|---|---|---|
| Need | conversational data Q&A + act | agentic authoring of the app itself |
| Audience / permission | end user · row-level security | builder/admin · governance gate |
| Mutates | records (business data) | metadata (the app definition) |
| Interaction rhythm | quick question → answer | plan → draft → verify → publish, self-correcting, long-running |
| Blast radius | one user's data, RLS-scoped | the app for everyone |
| Commerce | open-source · free | cloud-only · paid |

These are not two *intents* of one assistant — they are two *products*. The seam (**"what you change": records vs. the app definition**) carries the architectural boundary, the governance boundary, **and** the commercial boundary at once: three lines, one cut.

**ADR-0040's own incident argues for separation, not unification.** Its motivating failure (staging, 2026-06-11) was a user in the *Data* assistant asking it to "build a library app"; it flailed because it lacked the authoring disciplines. ADR-0040 read this as "the data persona was missing build skills" and bolted all skills onto one assistant. The correct reading: **that request should never have reached the data surface.** In a Chat/Code-separated world, app-building happens in the builder surface. The incident is evidence the *surfaces were leaking*, not evidence for merging the personas. The per-turn classifier ADR-0040 introduced is a fragile router that re-implements — worse, and at the wrong layer — the boundary a clean product split gives for free (misclassification, wrong-discipline leakage, mid-conversation handoff).

**What ADR-0040 got right, and we keep:** the end user must not face a roster/dropdown of agents. We preserve that — but the resolution is **surface binding**, not a classifier and not a menu.

---

## Decision

### 1. Two agents, two products, bound by surface

The two agents above are platform-owned. The agent is resolved deterministically from **where the user is**, never chosen per-turn or from a roster:

- Data console / embedded app chat → **`ask`**.
- Builder / Studio authoring surface → **`build`**.
- Resolution chain stays `app.defaultAgent` → surface default → platform default; the surface sets the default, so the user makes **no** selection.
- No per-turn intent classifier. A `build`-shaped request arriving at an `ask` surface is **declined and redirected to the builder**, not silently re-routed into authoring.

Why exactly two: merging them blurs the records-vs-app-definition governance boundary (different blast radius, audience, verification discipline, price); splitting further re-creates the roster this ADR refuses.

### 2. Skills (+ tools / MCP) are the only third-party extension primitive

- The platform is metadata-driven, so domain *structure* is already shared: both agents read the full metadata registry (objects, fields, actions, flows) and are structurally domain-aware for free. "A custom agent is needed to teach the assistant the industry" is false — the ontology is in the metadata.
- What is left over — persona, judgment, playbooks, instructions, bundled tools, external reach — is **exactly the definition of a skill**. Calling that a "custom agent" is using the wrong word for a skill.
- **Skills compose; agents don't.** A real request can span domains (CRM + accounting + an ISV connector); skill-first loads every relevant skill into the same turn, agent-first forces one. **Skills scale; agents don't** — progressive disclosure makes 1,000 skills cost ~nothing until relevant; 1,000 agents is a selection nightmare.
- Therefore: third parties author `*.skill.ts` and tools / MCP connectors. `*.agent.ts` is **closed to third parties** — internal only, for the two platform agents and platform-owned subagents (the `Explore`/`Plan` analogues). **ADR-0040 §3 (tenant custom agents bound via `app.defaultAgent`) is withdrawn.**

### 3. Skill ↔ agent affinity (the one new contract)

Because the two agents are distinct, each skill declares which one it belongs to:

```ts
defineSkill({
  name: 'churn_analysis',
  surface: 'ask',        // 'ask' | 'build' | 'both'
  // …instructions, tools
})
```

- `data_explorer`, `actions_executor` → `ask`
- `metadata_authoring`, `solution_design` → `build`
- A cross-cutting ISV domain skill → usually `ask`, occasionally `both`

This is the analogue of a Claude Code skill being scoped to the Code surface. Affinity is also what makes tool scoping clean (ADR-0064): an agent's tool set is the union of its skills' tools, and a skill cannot attach to an agent whose surface it does not match.

### 4. Naming — one canonical word per agent, by user intent

| | data agent | authoring agent |
|---|---|---|
| **Canonical id / spoken name** | **`ask`** | **`build`** |
| Legacy alias (permanent, silent — back-compat only) | `data_chat` | `metadata_assistant` |
| User-facing label (may stay friendly) | "Assistant" | "Builder" |

Rules:

- Name by **user intent (a verb)**: `ask` + `build` share one axis ("ask my app" / "build my app"). `data` + `build` would mix a noun with a verb and the ambiguity grows back.
- `ask` over `data` because the agent also executes actions — "ask → answer → act"; "data" implies read-only.
- The commercial line reads off the names: **Ask your app (free) / Build your app (paid).**
- `data_chat` / `metadata_assistant` are **aliases, never vocabulary**; docs and code use `ask` / `build` exclusively.
- **`build` is not yet canonical in code** — the cloud agent id is still `metadata_assistant`. Make `build` canonical there, mirroring the `ask` rename. No further id churn after that.

### 5. Surface binding, not per-turn routing; tier degradation

- The **surface** picks the agent (§1). There is no per-turn intent classifier to maintain, mis-tune, or mis-fire.
- On the **open-source / free** deployment only `ask` (and its `surface:'ask'` skills) exists. The builder surface and `build` agent simply aren't present; an `ask`-surface user who asks to build the app is told app-building lives in the (cloud) Builder, with no half-built attempt.
- **`build`-affinity skills only light up where the `build` agent exists** (cloud). A `surface:'build'` skill is inert on OSS by design — documented at the authoring contract, not a bug.
- Therefore the **free `ask` agent + open `ask`-skill ecosystem must stand on its own.** The free-tier value story rests entirely on it.

---

## Consequences

**Positive**
- One mental model: two products, bound by surface; everything else is a skill. The "agent zoo" / choice-confusion failure mode is designed out, and so is the fragile per-turn classifier.
- The capability-boundary gap ADR-0040 §4 worried about narrows sharply: there is no tenant agent to constrain, and an agent's tools are exactly its skills' tools. Residual cross-agent sharing (read-only `describe_object` / `list_objects`) is handled by ADR-0064.
- Architecture, governance, and pricing align on a single seam.

**Negative / costs**
- Reverses ADR-0040's core: the unified all-skills `ask`, the per-turn intent classifier, and the `buildRegisterActive` degradation shim are removed (see cleanup).
- Withdraws tenant custom agents: flip the `agent` metadata-type flags and filter the runtime catalog.
- Adds the `surface` affinity field to the skill schema and the scoping work in ADR-0064.

---

## Follow-up work (tracked in the consolidated issue)

Implementation, none of which changes a *public* id:

- [ ] **Split the personas.** Remove the unified `ask`-carries-all-skills definition and the per-turn intent preamble; `ask` carries only `surface:'ask'` skills, `build` only `surface:'build'`. Delete the `buildRegisterActive` degradation shim in `agent-runtime.ts` (no longer needed once surfaces are separate).
- [ ] **Make `build` canonical** in `../cloud/service-ai-studio` (`metadata_assistant` → `build`), registering `metadata_assistant` as the permanent alias — mirroring `data_chat`→`ask`.
- [ ] **Finish the `ask` rename drift**: `service-ai/src/agents/data-chat-agent.ts` → `ask-agent.ts`; `DEFAULT_DATA_AGENT_NAME` → `ASK_AGENT_NAME` (keep `LEGACY_DATA_AGENT_NAME`). Prose sweep "Data/Metadata Assistant" → `ask`/`build`.
- [ ] **Withdraw tenant agents**: set `agent` metadata-type `allowRuntimeCreate:false, allowOrgOverride:false` in `metadata-plugin.zod.ts`; filter custom agents from the runtime catalog; drop the `app.defaultAgent` custom-agent guidance in the cloud plugin.
- [ ] **Add `surface: 'ask' | 'build' | 'both'`** to `SkillSchema`; backfill the four built-in skills.
- [ ] **Bind agent → surface** in `../objectui` (data console → `ask`, Studio → `build`); keep the picker hidden/builder-only.
