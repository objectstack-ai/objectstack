# ADR-0063: Two kernel agents (`ask` / `build`); skills are the only third-party extension primitive

**Status**: Proposed (2026-06-22)
**Deciders**: ObjectStack Protocol Architects
**Supersedes**: [ADR-0040 §3 and §4](./0040-unified-assistant-and-agent-binding.md) — "custom agents are a builder/admin feature" is withdrawn; the follow-up tool-scoping contract is reframed.
**Builds on**: [ADR-0040](./0040-unified-assistant-and-agent-binding.md) (unified assistant — the end user never picks an agent), [ADR-0033](./0033-ai-assisted-metadata-authoring.md) (draft → verify → publish), [ADR-0038](./0038-build-verification-loop.md) (verify-fix-reverify discipline carried by skills)
**Consumers**: `@objectstack/spec` (agent/skill types), `@objectstack/service-ai` (the open-source `ask` shell), `../cloud/service-ai-studio` (the cloud-only `build` shell), `../objectui` (chat surfaces)

**Premise**: pre-launch, no back-compat debt beyond the alias table — specify the target end-state directly.

---

## TL;DR

The kernel keeps **exactly two agents**, and they are **platform-owned shells**, not a roster:

- **`ask`** — the data shell. Reads/queries/explores records and executes business actions. **Open-source, free** (`@objectstack/service-ai`).
- **`build`** — the authoring shell. Mutates *metadata* (objects, fields, views, flows). **Cloud-only, paid** (`../cloud/service-ai-studio`).

Everything else — domain depth, playbooks, persona, judgment, reach to external systems — is delivered as **skills** (+ tools / MCP), loaded by relevance into whichever shell applies. **Third parties extend the platform by authoring `*.skill.ts` and tools, never `*.agent.ts`.** ADR-0040's "custom agents are a builder feature" is withdrawn.

This is the analogue of Claude: **`build` ≈ Code, `ask` ≈ Chat.** Claude Code is enormously capable and ships **zero** user-authored agents — its power is skills + tools/MCP + platform-owned subagents. ObjectStack adopts the same shape.

---

## Context — why "custom agents" was old thinking

ADR-0040 already removed the agent *picker* from end users, but it preserved `*.agent.ts` as a **builder/admin extension surface** (§3) and named tool-scoping as a follow-up (§4). The design conversation that produced this ADR found that surface to be a category error:

1. **The platform is metadata-driven, so domain knowledge is already shared.** The `ask` shell reads the full metadata registry — objects, fields, actions, flows. It is *structurally domain-aware for free* on any app that is loaded. "A custom agent is needed to teach the assistant the industry" is false: the ontology is in the metadata, not in the agent.

2. **What is left over is exactly the definition of a skill.** Persona, judgment, playbooks, instructions, bundled tools, reach to external systems — that is `SKILL.md` (instructions + resources, relevance-routed by frontmatter `description`, progressively disclosed). Describing that as a "custom agent" is just using the wrong word for a skill.

3. **Skills compose; agents don't.** A real request is cross-domain (CRM + accounting + an ISV connector in one breath). You can only be *in* one agent — so agent-first fragments the workflow and re-introduces a routing/selection problem. Skill-first loads every relevant skill into the **same** turn. Agents partition work; skills unify it.

4. **Skills scale; agents don't.** Progressive disclosure makes 1,000 skills cost ~nothing until relevant. 1,000 agents is a selection nightmare. A metadata platform's surface (objects/actions/flows) grows without bound — only skill-first scales.

**Conclusion:** the extension *primitive* is the skill. Agents are *orchestration shells* the platform owns — like Claude Code's `Explore` / `Plan` subagents, spawned by the platform, never authored by tenants.

---

## Decision

### 1. Two kernel shells, split by what they mutate

| | `ask` shell | `build` shell |
|---|---|---|
| Claude analogue | Chat | Code |
| **Mutates** | records (business data) | metadata (the app definition) |
| Governance | row-level security; end-user permission | draft → verify → publish; builder/admin permission |
| Persona | Business Application Assistant | Schema architect |
| **Packaging / commerce** | **open-source · free** (`@objectstack/service-ai`) | **cloud-only · paid** (`../cloud/service-ai-studio`) |

The seam is **"what you change," not "what domain you are in."** Both shells share the same metadata ontology; they differ only in mutation target, risk surface, permission model, and verification discipline. That single seam carries the architectural boundary, the governance boundary, **and** the commercial boundary at once — three lines, one cut.

This is why the count is exactly two: merging them blurs a real governance boundary (record edits vs. app-definition edits have different blast radius and audiences); splitting further re-creates the roster ADR-0040 killed.

### 2. Skills (+ tools / MCP) are the only third-party extension primitive

- Third parties author `*.skill.ts` and contribute tools / MCP connectors. They do **not** author agents.
- `*.agent.ts` is **closed to third parties.** It remains an internal definition surface for platform-owned shells and subagents only.
- ADR-0040 §3 ("custom agents are a builder/admin feature", `app.defaultAgent` binding of tenant agents) is **withdrawn**. There is no commercial path for a tenant to define a new agent species that would have to live inside a paid platform component anyway.

### 3. Skill ↔ shell affinity (the one new contract)

For relevance-routing to work, a skill must declare which shell(s) it applies to:

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

This is the analogue of a Claude Code skill being scoped to the Code surface. Without affinity, the `build` shell drowns in data-analysis skills and vice versa.

### 4. Naming — one canonical word per shell, by user intent

The canonical ids are the **verb of user intent**, one word per shell, used everywhere:

| | data shell | authoring shell |
|---|---|---|
| **Canonical id / spoken name** | **`ask`** | **`build`** |
| Legacy alias (permanent, silent — back-compat only) | `data_chat` | `metadata_assistant` |
| User-facing label (may stay friendly) | "Assistant" | "Builder" |

Rules:

- Name by **user intent (a verb)**, not by domain noun. `ask` + `build` share one axis ("ask my app" / "build my app"); `data` + `build` would mix a noun with a verb and the ambiguity grows back.
- `ask` is preferred over `data` because the shell also executes actions — "ask → answer → act" describes it; "data" implies read-only.
- The commercial line reads naturally off the names: **Ask your app (free) / Build your app (paid).**
- **"data agent" / "metadata assistant" are aliases, never vocabulary.** Documentation and code use `ask` / `build` exclusively. ADRs describe the seam ("`ask` mutates records, `build` mutates metadata") using the ids — they do not introduce a parallel "data agent" label.
- Do **not** re-rename ids (no `ask` → `data` churn). The fix for today's ambiguity is eliminating the residual "data-chat"口径 drift in code/files, not another rename.

### 5. Tier-aware routing

ADR-0040's per-turn intent routing must not assume both shells exist:

- On the **open-source / free** deployment only the `ask` shell is present. A `build`-intent turn must degrade gracefully ("authoring needs the cloud Build assistant"), not dead-end on a missing shell.
- **`build`-affinity skills only light up where the `build` shell exists** (cloud). Skill authors must know a `surface:'build'` skill is inert on OSS. This is intentional tiering, not a bug — but it must be documented at the authoring contract.
- Therefore the **free `ask` shell + open `ask`-skill ecosystem must stand on its own.** The free-tier value story rests entirely on it; if `ask` alone is weak, the tiering is hollow.

---

## Consequences

**Positive**
- One mental model end-to-end: two shells, everything else is a skill. The "agent zoo" / choice-confusion failure mode is designed out, not managed.
- The capability-boundary gap ADR-0040 §4 worried about (registry-global tools, no per-agent constraint) **largely dissolves**: there is no tenant agent to constrain. Tools are scoped by *shell* (platform-owned) + *skill affinity*, not by a tenant-authored agent. §4's tool-scoping is reframed from "make custom agents safe" to "scope tools to the two shells."
- Architecture, governance, and pricing align on a single seam.

**Negative / costs**
- Withdraws a feature ADR-0040 proposed; any tenant-agent assumptions in `../objectui` / Studio must be removed.
- Adds the `surface` affinity field to the skill schema and a routing change so each shell only loads its skills.
- Requires the residual-naming cleanup below to actually remove the ambiguity.

---

## Follow-up: residual-naming cleanup (separate small PR)

The `ask` id is already canonical, but code/files still speak "data-chat", which is the physical source of the id≠name ambiguity. Clean it up:

- [ ] `packages/services/service-ai/src/agents/data-chat-agent.ts` → `ask-agent.ts` (keep the export surface; update `index.ts`).
- [ ] `DEFAULT_DATA_AGENT_NAME` → `ASK_AGENT_NAME` (retain `LEGACY_DATA_AGENT_NAME = 'data_chat'` as the alias constant).
- [ ] Sweep docs/prose for "data agent" / "Data Assistant" → "ask agent" / the `ask` id; keep `data_chat` only in the alias table.
- [ ] Add `surface: 'ask' | 'build' | 'both'` to the skill schema; backfill the four built-in skills.
- [ ] Make per-turn routing tier-aware (graceful `build`-intent degradation when the `build` shell is absent).

These are mechanical and independently shippable; none changes a public id.
