---
"@objectstack/spec": major
"@objectstack/lint": minor
---

feat(spec,lint)!: remove `agent.tools[]`, lint agent authoring, and resolve `action_<name>` only when it actually materialises (#3820, ADR-0109 accepted)

**Breaking — `agent.tools[]` is removed.** ADR-0064's central invariant is
"an agent's tool set is the union of its surface-compatible skills' tools;
nothing falls through to the global registry", and this legacy inline slot
was the one seam that broke it: the runtime resolved `agent.tools[].name`
against the **full** tool registry with no surface check, so an `ask`-surface
agent could name an authoring tool and get it. Removing the field makes the
invariant structural — there is no second slot to disagree with the skills —
rather than a rule every reader has to remember (ADR-0049 "design+enforce or
remove"). `AIToolSchema` / the `AITool` type go with it.

*Migration:* attach capability through `skills`. An agent authoring `tools` is
not a parse error — Zod strips the unknown key — so existing stacks keep
parsing, but the slot no longer does anything.

**`validate-ai-tool-references` now models AI exposure.** The rule previously
resolved `action_<name>` against every declared action. The runtime is far
stricter (ADR-0011): it materialises a tool only when the action opts in with
`ai.exposed: true` + `ai.description` **and** has a headless path (type
`script`/`api`/`flow` with a target or body — `url`/`modal`/`form` are
UI-only). Resolving against all actions therefore blessed references the agent
could never call — the exact failure the rule exists to catch. Unresolved
`action_*` references now get their own message and fix, since "the action
isn't exposed" and "the name is fictional" need different answers.

**New rule `validate-ai-agent-authoring`** (`agent-authoring-withdrawn`,
warning): flags a stack that declares `stack.agents`. Tenant/app-package
agents were withdrawn in ADR-0063 §2 — the runtime filters them from the
catalog and refuses to load them — but `defineStack` still accepted the array,
so an app could ship agents that parse, validate, and never run. This is the
authoring-time signal that was missing (ADR-0078: loud at the producer,
tolerant at the consumer). Joins `REFERENCE_INTEGRITY_RULES`.

ADR-0109 is now **Accepted — implemented (Phase 1)**, and the AI docs teach
the zero-tool-record default path, including the three conditions that decide
whether `action_<name>` exists and why a `modal` action staying human-driven
is a design answer rather than a gap.
