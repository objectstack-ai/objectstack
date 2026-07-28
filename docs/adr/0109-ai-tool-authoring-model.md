# ADR-0109: The AI tool authoring model — the default third-party path needs no tool records

**Status**: **Accepted — implemented (Phase 1)** (2026-07-28; revised same day before acceptance — see Revision note).
Evidence: `packages/spec/src/system/constants/platform-tool-names.ts` (registry + `platform-tool-names.test.ts`); `packages/lint/src/validate-ai-tool-references.ts` (+ `.test.ts`, wired into `REFERENCE_INTEGRITY_RULES`); conformance in `../cloud` `service-ai`/`service-ai-studio` (`platform-tool-names-conformance.test.ts`, cloud#908). First app on the model: `../hotcrm` skills — 22 tool references, 0 findings, down from 16 references with 10 dead (hotcrm#512). Phase 2 (the optional refinement layer) remains open and is gated on a real refinement need.
**Deciders**: ObjectStack Protocol Architects
**Builds on**: [ADR-0063](./0063-two-kernel-agents-skills-are-the-extension-primitive.md) (skills + tools are the third-party extension primitive), [ADR-0064](./0064-tool-scoping-to-agent.md) (an agent's tools are its skills' tools), [ADR-0078](./0078-no-silently-inert-metadata.md) (no silently inert metadata), [ADR-0049](./0049-no-unenforced-security-properties.md) (enforce-or-remove)
**Consumers**: `@objectstack/spec` (`system/constants/platform-tool-names.ts`, `ai/tool.zod.ts`, `stack.zod.ts`), `@objectstack/lint` (`validate-ai-tool-references`), `../cloud/service-ai` + `service-ai-studio` (registry conformance)

> **Revision note.** The first draft framed third-party tools as *bindings to
> actions/flows that authors declare as tool records*. Review surfaced the
> stronger conclusion: the runtime **already materialises** a tool per
> declarative action (`action_<name>`, the family `actions_executor`
> subscribes to with `action_*`), so in the default path a third party needs
> **no tool record at all** — the binding the draft proposed already exists
> implicitly for every action. The tool record is thereby demoted from "the
> authoring artifact" to an *optional refinement layer*, and Phase 1 shrinks
> to what today's mechanisms already support.

---

## TL;DR

**Third parties extend AI by authoring skills — and only skills.** A skill's
`tools[]` names either a platform-registered tool (curated in
`PLATFORM_PROVIDED_TOOL_NAMES`) or a tool the runtime materialises from the
app's own declarative actions (`action_<name>`). The executable, its authz,
and its audit trail are the action/flow the app already ships for its UI —
the AI can do exactly what the application can already do, under the same
permissions, and nothing else.

`stack.tools` records are an **optional AI-presentation refinement layer**
(Phase 2): needed only when the AI-facing surface must differ from the raw
executable. They are never required, and never a place business logic lives.

## Context

`stack.tools` before this ADR was the ADR-0078 prohibited state: a
declaration with no executable half and no reader. `ToolSchema` carries no
handler binding; the metadata `tool` type is written once at boot (Studio
visibility mirror) and read by nothing; `'tools'` was missing from
`composeStacks`' concat list; the executable tool set lives exclusively in
the runtime-registered in-process `ToolRegistry`. Meanwhile ADR-0063 §2
promised "skills **and tools**" as the third-party primitive — only the
skills half was real. On the HotCRM corpus, 16/16 `skill.tools` references
missed `stack.tools` while 6 of them resolved against the runtime registry
lint could not see: no reference rule could be correct in either direction
(#3820 D0/D2).

## Decision

1. **The default path is skills-only.** A third party gives the AI a new
   capability by (a) declaring the executable as a normal action/flow — which
   the app needs for its UI anyway — and (b) authoring a skill whose
   `tools[]` names the materialised `action_<name>` tool or a platform tool.
   Zero tool records; permissions and audit are inherited from the executable
   by construction. This is also one less namespace an AI author can
   hallucinate into.

2. **Platform tool names are facts, not guesses.**
   `PLATFORM_PROVIDED_TOOL_NAMES` in `@objectstack/spec`
   (`system/constants/platform-tool-names.ts`, the
   `PLATFORM_PROVIDED_OBJECT_NAMES` precedent) curates every statically-named
   tool the cloud AI runtime registers, grouped by owning package;
   `PLATFORM_TOOL_FAMILY_PREFIXES` names the dynamically-materialised
   families (today exactly `action_`). The owning cloud packages carry
   conformance tests — the same split as `CLOUD_PROVIDED_OBJECT_NAMES`,
   whose conformance half also lives outside this repo.

3. **`skill.tools[]` reference integrity is decidable and linted** —
   `validate-ai-tool-references` in `@objectstack/lint`, a member of
   `REFERENCE_INTEGRITY_RULES`. Resolution universe: `stack.tools` names ∪
   the platform registry ∪ the materialised `action_<name>` family (from
   `stack.actions` and every object's `actions`), wildcard-aware. Severity
   **warning** first (ADR-0078 ratchet): a runtime plugin outside the
   registry remains statically invisible, and the runtime deliberately
   tolerates unresolved names. On the HotCRM corpus the rule yields exactly
   the 10 fictional references and 0 false positives.

4. **Tool records become the optional refinement layer (Phase 2).** A tool
   record earns its place only when the AI-facing surface must differ from
   the raw executable: LLM-directed description, parameter narrowing (expose
   3 of 20 params, tighten enums), exposing a *flow* (no materialised family
   yet), a stable AI-facing name decoupled from the action's, or execution
   policy (a confirm-before-run flag — note `requiresConfirmation` was
   *removed* in #3715/#3876 as unenforced per ADR-0049; it returns only
   together with its enforcement, as part of this layer). When Phase 2
   lands, a third-party tool record MUST carry a `binding`
   (`{ type: 'action' | 'flow', name }`) to the executable it refines —
   handlers never live on the tool. Until Phase 2 lands, third-party tool
   records remain inert-and-documented (the `stack.tools` doc says so), and
   the refinement needs above are the acceptance trigger.

5. **The inert-surface holes close.** `'tools'` joins `composeStacks`'
   concat list (this revision — a declared record must at least survive
   composition). Phase 2 adds provenance to the boot-time metadata mirror so
   a stack-declared record cannot shadow a platform tool's entry (today
   `if (exists) skip` lets it), and revisits the `tool` metadata-type flags
   (`allowRuntimeCreate`/`allowOrgOverride`) which currently advertise an
   authoring surface with no reader.

## Rejected alternatives

- **Tools as first-class executables** (a `handler` on ToolSchema):
  re-invents actions/flows inside the AI layer, splits authz/audit across two
  systems, and turns every tool into a second place to define business logic.
  The platform's ontology is already executable; the AI layer needs a *view*
  of it, not a rival.
- **A required tool record per exposed action** (the first draft's implicit
  shape): the materialised `action_<name>` family already provides the
  binding implicitly, so a mandatory record would add a second authoring
  step, a second namespace to keep consistent, and a second surface for AI
  authors to hallucinate into — for zero added capability.

## Consequences

- "Third-party AI extension = write a skill" becomes the whole story — one
  concept to document, teach, and generate. ADR-0063 §2's "skills and tools"
  reads as: skills are the primitive, tools are its optional refinement.
- AI capability ≡ application capability: same executables, same
  permissions, same audit. There is no second security system to review and
  no way for the AI to do what the app cannot.
- A hallucinated tool name fails lint at draft time (advisory now, gating
  after the ratchet) instead of shipping as a copilot that claims abilities
  it does not have — the HotCRM failure, 10 fictional tools across 6 skills.
- Cost honestly stated: the registry is a curated list that can go stale;
  the conformance tests in the owning packages are the mechanism that keeps
  it true, and they live in a different repository than the list.

## Follow-up

- [x] `PLATFORM_PROVIDED_TOOL_NAMES` + `PLATFORM_TOOL_FAMILY_PREFIXES` + invariant tests (spec — this change).
- [x] `validate-ai-tool-references`, advisory, in `REFERENCE_INTEGRITY_RULES` (lint — this change).
- [x] `'tools'` into `composeStacks`' concat list (spec — this change).
- [x] Registry conformance tests in `../cloud` `service-ai` / `service-ai-studio` (cloud#908; feature-detected, activates when the `.objectstack-sha` pin advances past Phase 1).
- [x] The lint rule resolves `action_<name>` only for actions that ACTUALLY materialise — `ai.exposed` + `ai.description` + a headless type (ADR-0011). Resolving against every declared action blessed references the agent could never call; caught while porting HotCRM, where 3 of 5 referenced actions are `type:'modal'` (UI-only).
- [x] First app ported: `../hotcrm` (hotcrm#512) — 10 fictional tools removed, the two withdrawn agents deleted, state changes routed through `action_<name>`.
- [ ] **Phase 2 (on acceptance + a real refinement need):** `binding` on `ToolSchema`; flow exposure; boot-mirror provenance guard; revisit `tool` metadata-type flags; ratchet the lint rule to error per ADR-0078 once the registry has soaked a release.
