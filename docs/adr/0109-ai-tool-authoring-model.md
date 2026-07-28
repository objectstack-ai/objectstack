# ADR-0109: The AI tool authoring model — third-party tools are bindings to executable primitives

**Status**: Proposed (2026-07-28) — the "D0" decision of issue #3820; blocks the `skill.tools` branch of the R7 reference-integrity rule.
**Deciders**: ObjectStack Protocol Architects
**Builds on**: [ADR-0063](./0063-two-kernel-agents-skills-are-the-extension-primitive.md) (skills + tools are the third-party extension primitive), [ADR-0064](./0064-tool-scoping-to-agent.md) (an agent's tools are its skills' tools), [ADR-0078](./0078-no-silently-inert-metadata.md) (no silently inert metadata)
**Consumers**: `@objectstack/spec` (`ai/tool.zod.ts`, `stack.zod.ts`), `@objectstack/lint` (the R7 rule), `../cloud/service-ai` (ToolRegistry), `../cloud/service-ai-studio`

---

## TL;DR

`stack.tools` today is a **declaration with no executable half and no reader**: `ToolSchema` carries no handler binding, the metadata `tool` type is written once at boot (Studio visibility mirror, `service-ai-studio/plugin.ts`) and read by **nothing**, `'tools'` is missing from `composeStacks`' `CONCAT_ARRAY_FIELDS`, and the executable tool set lives exclusively in the runtime-registered in-process `ToolRegistry`. ADR-0063 §2 says third parties extend via "skills **and tools**" — but only the skills half is real. That is the ADR-0078 prohibited state, and it makes any reference-integrity rule over `skill.tools[]` unbuildable: there is no registry of facts to resolve against (16/16 of HotCRM's skill→tool references miss `stack.tools`; 6 of those 16 nonetheless resolve — against the runtime registry lint cannot see).

Decision: **a third-party tool is a *binding* to an executable primitive the platform already has — an action or a flow — never a free-floating executable of its own.** Kernel/plugin tools stay runtime-registered, and their names become facts via a curated, conformance-tested registry in spec.

## Decision

1. **Third-party tools bind, they don't implement.** `ToolSchema` gains a required-for-app-packages `binding` (`{ type: 'action' | 'flow', name: string }`). The runtime materialises a callable from the bound primitive (the same mechanism that already materialises `action_<name>` tools from object action lists); `parameters` may narrow, but never widen, what the bound primitive accepts. Handlers, authz, and audit stay where they already are — on the action/flow. A tool record without a `binding` is legal only for runtime-registered (kernel/plugin) tools, whose record is a visibility mirror, not a definition.
2. **Platform tool names become facts, not guesses.** Spec exports a curated `PLATFORM_PROVIDED_TOOL_NAMES: ReadonlySet<string>` (the `PLATFORM_PROVIDED_OBJECT_NAMES` / #3657 precedent), kept honest by conformance tests in the *owning* packages (service-ai / service-ai-studio assert "every tool I register is listed; every listed name with my prefix is registered"). The lint → spec dependency direction is preserved.
3. **Reference integrity becomes decidable, and R7's tool branch unblocks.** `skill.tools[]` (wildcard-aware) resolves against: bound tools declared in-stack (→ checkable through to the action/flow, which existing rules already resolve) ∪ `PLATFORM_PROVIDED_TOOL_NAMES` ∪ wildcard families. Resolution ladder per ADR-0072: unknown name → **warning** at first (ADR-0078 ratchet), **error** once the registry has soaked one release.
4. **The inert surface is closed.** `'tools'` joins `CONCAT_ARRAY_FIELDS`; the boot-time mirror writes gain provenance so a stack-declared record cannot shadow a platform tool's mirror (today `if (exists) skip` lets it); the runtime's "silently dropped" posture for unresolved references stays (graceful degradation) but logs, because the *authoring-time* signal now comes from lint — loud at the producer, tolerant at the consumer (Prime Directive #12).

## Rejected alternative

**Tools as first-class executables** (a `handler` on ToolSchema): re-invents actions/flows inside the AI layer, splits authz/audit across two systems, and turns every tool into a second place to define business logic. The platform's ontology is already executable; the AI layer needs a *view* of it, not a rival.

## Consequences

- "Skills + tools" (ADR-0063 §2) becomes a shipped contract: a third party can author a skill whose tools are real, checkable, and governed by the same authz as the UI button that runs the same action.
- AI-authored metadata gets a closed vocabulary: a hallucinated tool name fails lint at draft time instead of shipping as a dead capability the copilot claims to have (the HotCRM failure, 10 fictional tools across 6 skills).
- Costs: a spec change (`binding`), the registry + conformance tests, a materialisation path in the runtime; the R7 tool-branch rule stays blocked until 1–2 land.

## Follow-up

- [ ] `binding` on `ToolSchema` + `'tools'` into `CONCAT_ARRAY_FIELDS` (spec).
- [ ] `PLATFORM_PROVIDED_TOOL_NAMES` + owning-package conformance tests (spec, cloud).
- [ ] Materialise bound tools in the ToolRegistry; provenance-guard the boot mirror (cloud).
- [ ] R7 tool branch: `validate-ai-references` skill→tool resolution, warning-first (lint; #3820).
