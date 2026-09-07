# ADR-0010: Natural-Language → Flow Authoring (Platform Capability)

**Status**: Draft (2026-05-24)
**Authors**: HotCRM (objectstack-ai/hotcrm) — surfacing requirements from the v1 launch story
**Consumers**: `@objectstack/service-ai`, `@objectstack/spec` (automation), `objectui` (plugin-designer, plugin-chatbot), every app that ships flows

---

## Context

HotCRM v1 launches on three "wow moments":

1. **Live Schema** — agents pick up newly added fields on the next turn. *Already shipped* via the built-in `describe_object` tool re-reading metadata on every call.
2. **NL → Flow** — admins describe an automation in English and get a runnable `Flow`. **This ADR.**
3. **Chat-first record pages** — context-aware Copilot is the dominant surface on every record. *Shipped at the app layer (objectui floating chatbot + AI Briefing slots).*

Wow #2 is not CRM-specific. Every app (HR, Finance, Support, Marketing) needs the same capability: "when X happens to record Y, do Z" → runnable Flow definition. Building it in HotCRM would mean every app re-implements the prompt, the schema-grounding tool calls, the validation loop, and the persistence step.

Today an app can already wire the moving parts manually (skill instructions + `describe_object` + a custom action), but the result is brittle: every app authors its own "is this a valid Flow?" check, hallucinated field names slip through, and there's no shared way to take a validated Flow JSON and **register it** as a real, runnable workflow.

We propose moving the capability into the platform.

## Goals

* **One built-in skill** any agent can declare (`flow_author` or similar) that turns NL into a `FlowSchema`-shaped JSON, grounded in real metadata.
* **One built-in tool** (`propose_flow`) that validates the candidate Flow against `FlowSchema` and returns structured errors the agent can self-correct from.
* **One built-in tool** (`register_flow`) that persists a validated Flow into the metadata service, scoped to the active package (re-using ADR-0003 / ADR-0008 / ADR-0009 machinery).
* **Idempotent + replayable** — running the same conversation twice doesn't create duplicate flows; updates target the same `name`.
* **Source-of-truth choice** — apps can opt in to "AI-authored flows write through to the database package" (live) or "AI-authored flows emit a snippet for human PR" (GitOps).

## Non-Goals

* Visual flow editor / no-code designer (already covered by `objectui/plugin-designer`).
* Inferring the *intent* of the trigger from telemetry — the user still has to say it in words.
* Generating UI screens for `type: 'screen'` flows beyond the field list (deferred to a later RFC).
* Replacing the existing `defineFlow()` TypeScript authoring path.

## Proposed Components

### 1. `propose_flow` — Built-in AI Tool

Lives in `@objectstack/service-ai/src/tools/propose-flow.tool.ts`.

```ts
defineTool({
  name: 'propose_flow',
  label: 'Propose Flow',
  description:
    'Validate a candidate Flow definition. Returns { ok: true, name, preview } ' +
    'on success or { ok: false, errors[] } on failure so the calling agent can ' +
    'self-correct before showing the user.',
  category: 'automation',
  builtIn: true,
  parameters: {
    type: 'object',
    properties: {
      flow: {
        type: 'object',
        description: 'Candidate Flow JSON matching FlowSchema',
      },
    },
    required: ['flow'],
  },
});
```

The handler runs `FlowSchema.safeParse(flow)` (from `@objectstack/spec/automation`) and surfaces every Zod issue as a flat `errors: string[]`. No I/O, no side effects.

### 2. `register_flow` — Built-in AI Tool

```ts
defineTool({
  name: 'register_flow',
  description: 'Persist a validated Flow into the active package. Idempotent on flow.name.',
  category: 'automation',
  builtIn: true,
  parameters: {
    type: 'object',
    properties: {
      flow: { type: 'object', description: 'Flow JSON, must pass propose_flow first.' },
      packageId: { type: 'string', description: 'Optional. Defaults to conversation.activePackage.' },
    },
    required: ['flow'],
  },
});
```

Handler:

1. Re-validate with `FlowSchema.parse()`.
2. Resolve target package via the same `resolvePackageId(ctx, explicitPackageId)` helper used by `create_object` / `add_field` (read-only filesystem packages rejected).
3. `ctx.metadataService.register('flow', flow.name, flow)` — same path manual code uses.
4. Return `{ ok: true, name, packageId }`.

Side effects: writes through to the metadata repo (ADR-0008) → change is captured in the audit log, the runtime hot-reloads the flow, and any record-triggered flows become live on the next save.

### 3. `flow_author` — Built-in Skill

Lives in `@objectstack/service-ai/src/skills/flow-author.skill.ts`. App agents opt in by name: `skills: ['flow_author', ...]`.

Skill bundle:
* tools: `list_objects`, `describe_object`, `propose_flow`, `register_flow`
* instructions: enforce the *describe → compose → propose → fix → register* loop, including the rule "**never invent a field name; always describe_object first**".
* triggerPhrases: `"when a"`, `"whenever"`, `"automate"`, `"every time"`, `"set up a flow"`.
* permissions: `automation:flow:write`.

The skill is **platform-owned** so every app inherits the same hardened prompt as we tighten it. Apps still pick whether their agents enable it.

### 4. Spec changes — minimal

Existing `FlowSchema` already validates the candidate. We need:
* Confirm `FlowSchema.safeParse` returns issue paths usable verbatim by an LLM (`issues[].path.join('.')`).
* Add a `defineFlow.toJSON()` convenience or document that `JSON.stringify(defineFlow(x))` is round-trippable.

No new spec surface area.

## Source-of-Truth Modes

Two deployment modes apps choose between via package configuration:

| Mode | Where Flows Land | Suitable For |
|------|------------------|--------------|
| `live` (default) | `register_flow` writes to the active database package. Hot-reloaded. | Hosted SaaS tenants — admins iterate in-product, AI-authored flows go live immediately. |
| `gitops` | `register_flow` is gated; instead the agent surfaces the validated JSON in a fenced code block + a path `src/flows/<name>.flow.ts` for human PR. | Self-hosted enterprise — every metadata change must land in source control. |

Mode toggled per package via `pkg.aiAuthoring: 'live' | 'gitops'` in the package manifest (ADR-0003). Skill instructions branch on this flag.

## Open Questions

1. **Trigger ambiguity.** "When an opportunity is won" — should the trigger be `update` with condition `stage == 'closed_won'`, or a stage-transition event if we add one? Skill instructions should default to `update + condition` and ask one clarifying question if the user used a verb that maps to multiple options.
2. **Screen flows.** Agents can produce the `type: 'screen'` shape, but `register_flow` for screen flows means the flow appears in nav menus instantly. Do we require an extra `assignedProfiles` parameter, or default to `system_administrator` only?
3. **Roll-back.** ADR-0008's metadata change log already captures every write. Do we need a sibling `unregister_flow` tool, or rely on the standard "revert to checkpoint" path?
4. **Cross-object references.** When the user says "when a deal is won, create a case", `describe_object('crm_case')` reveals required fields (e.g. `priority`). Should the skill auto-fill required fields with sensible defaults from option lists, or stop and ask?
5. **Test/dry-run.** Should `register_flow` accept a `dryRun: true` parameter that returns the projected effect (which records would trigger, what they'd write) without committing? Strongly recommended for production safety.

## HotCRM Migration Path

HotCRM has a placeholder `live_data` skill that grounds Copilot answers in the live schema. Once `flow_author` ships:
1. Add `'flow_author'` to `sales_copilot.skills[]`.
2. Drop the explicit cut we made when removing the in-CRM `flow_designer` draft (commit retained in branch `feat/wow-2-flow-designer-draft`).
3. Update `content/docs/ai-copilot/live-schema.mdx` with a Wow #2 sibling page.
   *(Path note, 2026-09: this is a HotCRM path, not a path in this repository — no file has ever
   existed at `content/docs/ai-copilot/` here. It is kept as the record of the planned edit.)*

No CRM data model changes.

## Decision

Pending platform review. HotCRM v1 launch (W9) will ship without Wow #2 unless this ADR lands and the tools/skill are released; the launch deck currently leans on Wow #1 + Wow #3 alone.

## References

* `@objectstack/spec/automation/flow.zod.ts` — `FlowSchema`, `defineFlow`.
* `@objectstack/service-ai/src/tools/metadata-tools.ts` — pattern to mirror for `propose_flow` / `register_flow`.
* `@objectstack/service-ai/src/tools/describe-object.tool.ts` — single-source-of-truth tool file pattern.
* ADR-0003 — package-as-first-class-citizen (target for `register_flow`).
* ADR-0008 — metadata repository + change log (provides idempotency + audit).
* HotCRM `content/docs/ai-copilot/live-schema.mdx` — Wow #1 marketing copy that sets up Wow #2.
  *(Path note, 2026-09: a HotCRM path, not a path in this repository — no file has ever existed at
  `content/docs/ai-copilot/` here.)*
