# ADR-0011: Actions as AI Tools (Operational Parity)

**Status**: Accepted — implemented (2026-06-04)
**Authors**: HotCRM (objectstack-ai/hotcrm) — surfaced the requirement; design finalised in framework
**Consumers**: `@objectstack/service-ai` (the bridge), `@objectstack/spec` (ui.action, contracts.ai-service), every app that ships actions

---

## TL;DR

AI agents call **Tools**. Apps register business operations as **Actions**
(`*.action.ts`) for UI buttons and HTTP endpoints. Without a bridge, giving the
Copilot a capability means writing the logic twice — once as an Action (for
humans), once as a Tool (for the LLM) — and keeping them in sync forever.

Every Action opts in to being an AI Tool by adding a single **`ai:` block** to
its metadata. The runtime exposes opted-in Actions to agents through the
existing tool registry — no Tool duplicates. Result: **operational parity** —
anything an admin can do, the Copilot can do, by calling the *same* Action with
the same permissions, validation, audit, and transaction guarantees.

Exposure is **opt-in, default off**. `ai.exposed: true` is required, and it
forces an explicit, LLM-facing `ai.description`. There is **no heuristic
auto-exposure** and **no description derived from the UI label**.

---

## Context

### What HotCRM tried

HotCRM v1 shipped 6 hand-authored "skills" under `src/skills/`. Each skill is a
`defineSkill({ tools: [...] })` bundle of inline tools. While planning v1.1 the
team asked: *"We're a metadata-driven platform — do we really need bespoke skill
code for each business operation?"*

The breakthrough: **Actions are already the metadata vocabulary for "what the
system can do".** They have a name, a label, a typed parameter schema,
permissions, audit logging, transactions, and an implementation. They're the
same shape a Tool needs, minus a description aimed at an LLM.

### Design evolution (why this ADR was revised)

The first implementation (commit `93c05899d`, the same day as the original
draft) took a shortcut that **inverted** this ADR's intent: a flat `aiExposed`
boolean with **heuristic auto-exposure** (expose anything that "looks safe") and
a tool **description derived from the UI label**. That contradicted two explicit
points of this ADR — opt-in-default-off is a *Goal*, and label-derived
descriptions are a *Non-Goal*.

This revision realigns the code with the original opt-in `ai:` block design and
sharpens the rationale for the **AI-authoring era** (below). Because the platform
had **not yet shipped**, there were no live apps depending on auto-exposure — so
the realignment is a **clean break**: the `aiExposed` field is removed outright,
with no deprecation alias and no compatibility flag.

### Why opt-in matters *more* when the authors are AI

The platform's direction is that **actions are increasingly authored by AI**
(NL → Action; draft-then-review per ADR-0033). That reframes the trade-offs:

* **"Writing a description is a burden" — gone.** An AI author writes a good
  LLM-facing description for free. The friction that once argued for
  auto-derivation evaporates; auto-derivation becomes *pointless*, not merely
  low-quality. So we require an explicit `ai.description` and delete the
  label-derivation default.
* **Opt-in is the governance gate, not a friction tax.** When AI both authors
  *and* invokes actions, the platform's value to an enterprise is that a human
  can govern *which* capabilities the agent fleet may invoke. `ai.exposed`
  default-off is the physical boundary between "an AI drafted an action" and
  "the agent fleet may now run it". A half-finished or unreviewed draft must
  never be silently armed.
* **Schema minimalism is itself governance.** Every extra knob is one more way an
  AI author misconfigures and one more thing a human reviewer must audit. So the
  `ai:` block carries only fields with a real, end-to-end effect.

### What separates a Tool from an Action-Tool

| Source | Lives where | Used for | Example |
| --- | --- | --- | --- |
| **ToolRegistry** (pure tools) | platform / app code | Generic, schema-discoverable operations that aren't business actions | `describe_object`, `query_data` |
| **Action `ai:` block (this ADR)** | app metadata (`*.action.ts`) | App-specific business operations humans also invoke from the UI | `crm_case_triage`, `complete_task` |
| **SkillRegistry** | platform / app code | Bundles of *instructions* + a curated tool subset | `lead_qualification` |

The `label` vs `ai.description` split survives the AI-authoring shift because the
*consumption* audience is still mixed: humans click UI buttons (`label`), agents
call tools (`ai.description`). Only the authoring side became AI.

---

## Goals

* **Zero duplication** — one definition (the Action) drives both the UI button
  and the AI tool.
* **Opt-in exposure, default off** — `ai.exposed: true` is required; this is the
  governance gate.
* **Explicit LLM description** — `ai.description` is required when exposed,
  authored for a model, never derived from `label`.
* **Auto-derived JSON Schema** — tool `parameters` come from the Action's
  `params[]` + referenced field types, refined by `ai.paramHints`.
* **Permission parity** — AI invocation goes through the same permission/RLS/audit
  machinery as human invocation.
* **Confirmation parity** — destructive actions route through the HITL approval
  queue; `ai.requiresConfirmation` lets the author override the default.

## Non-Goals

* Replacing `ToolRegistry`. Pure tools stay first-class.
* Auto-generating an LLM `description` from the label. (Authors — human or AI —
  write it.)
* Inferring "safe / unsafe" automatically. The author opts in and sets the
  confirmation policy.
* Touching `SkillRegistry`.
* Hot-reload of newly-added actions into running sessions (tool definitions are
  resolved per turn — see Open Questions).

---

## Proposed Design

### 1. Action spec extension — `ai:` block

`packages/spec/src/ui/action.zod.ts` gains an optional `ai` field
(`ActionAiSchema`):

```ts
export const ActionAiSchema = z.object({
  /** Expose to AI agents. Default false. Requires `description` when true. */
  exposed: z.boolean().default(false),

  /** LLM-facing description (≥40 chars). Required when exposed. Distinct from `label`. */
  description: z.string().min(40).optional(),

  /** Tool category override. Defaults to 'action' (side-effect). */
  category: ActionAiCategorySchema.optional(),  // mirrors ToolCategorySchema

  /** Per-parameter AI hints (tighter enum / description / examples), keyed by param name. */
  paramHints: z.record(z.string(), z.object({
    description: z.string().optional(),
    enum: z.array(z.union([z.string(), z.number()])).optional(),
    examples: z.array(z.unknown()).optional(),
  })).optional(),

  /** Output JSON Schema — enables downstream chaining; summarised into the description. */
  outputSchema: z.record(z.string(), z.unknown()).optional(),

  /** Override HITL confirmation. Defaults to true for destructive-looking actions. */
  requiresConfirmation: z.boolean().optional(),
});
```

The category enum is **inlined** (not imported from `ai/tool.zod`) to avoid a
`ui → ai` import cycle (`ai/*.form.ts` already imports from `ui/view.zod`).

**Validation rules** (`ActionSchema.refine`):

* `ai.exposed === true` ⇒ `ai.description` required.
* `ai.paramHints` keys must match a declared `params[].name` (or the injected
  `recordId`) — a typo can't silently no-op.

The old flat `aiExposed` boolean is **removed**.

### 2. The bridge — `@objectstack/service-ai/src/tools/action-tools.ts`

The bridge (not a `runtime.ActionRegistry` method, as the first draft sketched)
walks every object's `actions[]` via the metadata service and registers the
opted-in ones into the existing `ToolRegistry`:

* **`actionSkipReason(action, ctx)`** — opt-in gate. Skips unless
  `ai.exposed === true` (and `ai.description` present). Then the structural and
  wiring checks (UI-only types, missing target/body, no apiClient/automation),
  then the destructive-action gate.
* **`actionToToolDefinition(...)`** — builds the `AIToolDefinition`:
  `description` from `ai.description` (+ a compact `Returns: …` line summarising
  `ai.outputSchema`), `parameters` from `params[]` refined by `ai.paramHints`,
  and carries `category` / `outputSchema` / `objectName` / `requiresConfirmation`.
* **`actionRequiresApproval(action)`** — `ai.requiresConfirmation` wins; else the
  heuristic (`confirmText`, `mode:'delete'`, `variant:'danger'`).
* **Lint guardrail** — when an exposed action *looks* destructive yet the author
  set `ai.requiresConfirmation:false`, it registers (the author's call) but the
  bridge emits a `warning` the plugin logs.

`AIToolDefinition` (`packages/spec/src/contracts/ai-service.ts`) was extended with
optional `category`, `outputSchema`, `objectName`, `requiresConfirmation` so this
richer info is carried rather than dropped.

### 3. Agent-runtime integration

No change needed beyond registration: action-tools register into the same
`ToolRegistry` the plugin already feeds into `availableTools`. The agent's tool
resolution sees them as candidates automatically. Pure tools win name
collisions (an app action can never silently override a platform tool — the
registry refuses a duplicate name).

### 4. Invocation flow

```
LLM emits tool_call { name: 'action_complete_task', args: { recordId: '00123' } }
  │
  ▼  if requiresConfirmation && HITL wired:
       handler enqueues a pending action → returns { status: 'pending_approval' }
       operator approves in Studio → the pre-registered bypass dispatcher runs it
     else:
       handler dispatches by type — script → dataEngine.executeAction;
       api → apiClient.request; flow → automation.execute
  │
  ▼  executes inside the same RLS / permission / audit machinery as a human click.
     Result returned to the LLM (shape documented by ai.outputSchema if set).
```

**Invariant**: AI-invoked actions never bypass permissions, validation, hooks, or
audit. The only differences vs a human click are the args came from an LLM and
the invocation is attributed to the chat actor (falling back to a synthetic
`ai_agent` principal).

---

## Permission & Confirmation Model

### Permissions

The bridge runs each action under the chat session's user (or a synthetic
`ai_agent` principal). RLS / FLS / sharing rules apply to every read and write
inside the handler exactly as for a human click. The LLM cannot escalate by
asking; an action the user can't invoke simply isn't offered.

### Confirmation (HITL approval queue)

| Action config | Behavior |
| --- | --- |
| destructive (`confirmText` / `mode:'delete'` / `variant:'danger'`) **and** HITL wired (`enableActionApproval` + `aiService`) | registered; invocation enqueues a pending action and returns `pending_approval` |
| destructive **and** HITL **not** wired | skipped (can't run unattended) |
| `ai.requiresConfirmation: true` on a safe action | treated as destructive (gated) |
| `ai.requiresConfirmation: false` on a destructive action | exposed & direct-run — **author asserts safe** (bridge logs a warning) |
| not destructive | direct-run |

---

## Migration Path

### Phase 1 — framework (this ADR) — **done**

1. `ai` block on `ActionSchema`; `aiExposed` removed (clean break).
2. `AIToolDefinition` extended (`category` / `outputSchema` / `objectName` /
   `requiresConfirmation`).
3. Bridge rewritten to opt-in: `actionSkipReason`, `actionToToolDefinition`,
   `actionRequiresApproval`, paramHints merge, outputSchema summary, lint
   warnings.
4. Studio `action.form` updated (`aiExposed` field → `ai` block).
5. Internal `ai_pending_actions` approve/reject actions: dropped the now-redundant
   `aiExposed:false` (opt-in means human-only by default).
6. Tests: spec `ai` block validation; bridge opt-in gating, paramHints,
   outputSchema, category, requiresConfirmation override, lint warning.

### Phase 2 — first consumer — **done (app-todo testbed)**

The `examples/app-todo` script actions (`complete_task`, `start_task`,
`clone_task`, `mass_complete`, `export_csv`) opt in with `ai.exposed` +
`ai.description`; `delete_completed` opts in but stays destructive (registers
only when HITL approval is wired); the modal actions stay UI-only. The
`test:action` / `test:hitl` demos exercise the path end-to-end.

HotCRM v1.1 follows: convert the 6 hand-authored skills to AI-exposed actions,
keeping a thin sales/service persona instruction bundle.

### Phase 3 — ecosystem

1. Guide: "write an AI-callable action" (5-minute tutorial).
2. Stack Lint: `type:'delete'` actions must make a deliberate `ai.exposed`
   choice.
3. Optional `defineAiAction(...)` sugar (defaults `exposed:true`) — low priority
   since AI authors write the block in full.

---

## Open Questions

1. **Bulk vs single.** Tentative: one tool with an array-accepting `parameters`.
2. **Streaming results.** Out of scope; needs a streaming-tool-return ADR.
3. **Tool name namespacing.** Implemented as a prefix: `action_<name>`.
4. **MCP exposure.** Action-tools live in the same `ToolRegistry`, so the MCP
   server plugin surfaces them transparently. Confirm in MCP work.
5. **Discoverability with 50+ actions.** Mitigations: scope `toolsForAi` by the
   current object, skills as curators, lazy tool resolution. Add as needed.
6. **Versioning.** Tool definitions resolve per turn, so the next turn sees the
   current shape; mid-turn drift is a non-issue.
7. **Audit attribution (tri-state).** Today invocations are attributed to the
   actor (or synthetic `ai_agent`). A richer `source: 'ai-authored' | 'ai-invoked'
   | 'human'` distinction — separating "an AI *wrote* this action" from "an AI
   *called* it" — pairs with the ADR-0033 / NL→Action authoring work.

---

## Decision

Adopt the opt-in `ai:` block. Implementation:

* `@objectstack/spec` — `ActionAiSchema` on `ActionSchema`; `AIToolDefinition`
  extension; `action.form` update.
* `@objectstack/service-ai` — `action-tools.ts` bridge + HITL approval queue
  (already shipped) reading the `ai:` block.

`examples/app-todo` is the first consumer and validation testbed. HotCRM v1.1
ships next.

---

## Addendum (2026-10-30): the platform identity actions an agent may reach

> Status of this addendum: **ruled** (ruling of record `6523087116` on #27900, letter A+), executing
> parameter 2 of ruling `6513869839` on #27681. The maintainer, verbatim:
> 「所以我说评估标准对象的意思，就是允许放开的动作，是不是就应该把申明加上」.
> It changes no rule of this ADR: it records how the platform's own `sys_*` identity actions apply the
> opt-in, and the declarations that follow from it.

The opt-in binds the platform's `sys_*` actions exactly as it binds an app's: an action reaches an
agent only when it declares `ai: { exposed: true, description }`. The named actions on the twelve
identity objects in `packages/platform-objects/src/identity/` were assessed once, as one set, into
three buckets, and the declarations were written in the same change as this addendum.

| Bucket | Test | What the action declares |
|:--|:--|:--|
| **H** human-only | it mints a credential or a session, changes who owns or who can sign in, or destroys an account or an organization | no `ai` block. ⛔ No `ai.exposed` on one of these without a maintainer ruling that names the action. |
| **C** exposed, confirmed | a destructive or privilege-changing lifecycle act that is reversible or bounded | `ai: { exposed: true, description, requiresConfirmation: true }`. ⛔ The confirmation is never relaxed. |
| **E** exposed | an additive or self-scoped act with no credential and no privilege escalation | `ai: { exposed: true, description }`; confirmation is the author's choice (none is declared today). |

**H — human-only (20):** `sys_user.impersonate_user` · `sys_user.set_user_password` ·
`sys_user.create_user` · `sys_user.delete_my_account` · `sys_user.change_my_password` ·
`sys_user.change_my_email` · `sys_user.disable_two_factor` · `sys_user.generate_backup_codes` ·
`sys_two_factor.disable_two_factor` · `sys_two_factor.regenerate_backup_codes` ·
`sys_api_key.create_api_key` · `sys_api_key.restore_api_key` ·
`sys_oauth_application.create_oauth_application` · `sys_oauth_application.rotate_client_secret` ·
`sys_sso_provider.register_sso_provider` · `sys_sso_provider.register_saml_provider` ·
`sys_sso_provider.verify_domain` · `sys_member.transfer_ownership` · `sys_member.update_member_role` ·
`sys_organization.delete_organization`.

**C — exposed, confirmed (17):** `sys_user.ban_user` · `sys_user.unban_user` · `sys_user.unlock_user` ·
`sys_user.set_user_manager` · `sys_api_key.revoke_api_key` · `sys_session.revoke_session` ·
`sys_session.revoke_my_other_sessions` · `sys_invitation.cancel_invitation` ·
`sys_invitation.reject_invitation` · `sys_member.remove_member` · `sys_team_member.remove_team_member` ·
`sys_team.remove_team` · `sys_oauth_application.disable_oauth_application` ·
`sys_oauth_application.delete_oauth_application` · `sys_sso_provider.delete_sso_provider` ·
`sys_organization.leave_organization` · `sys_account.unlink_account`.

**E — exposed (21):** `sys_user.invite_user` · `sys_invitation.invite_user` ·
`sys_organization.invite_user` · `sys_member.invite_user` · `sys_invitation.resend_invitation` ·
`sys_invitation.accept_invitation` · `sys_member.add_member` · `sys_team_member.add_team_member` ·
`sys_team.add_team_member` · `sys_team.create_team` · `sys_team.update_team` ·
`sys_organization.create_organization` · `sys_organization.update_organization` ·
`sys_organization.rename_organization` · `sys_organization.set_active_organization` ·
`sys_oauth_application.enable_oauth_application` · `sys_user.enable_two_factor` ·
`sys_two_factor.enable_two_factor` · `sys_user.update_my_profile` ·
`sys_user.resend_verification_email` · `sys_sso_provider.request_domain_verification`.

That is 58 actions and 38 `ai` blocks. The card's bucket headers read H 19 and E 22; its name lists,
which the ruling adopted, hold 20 and 21, and the names are the record.

**Not assessed.** `sys_invitation.copy_invitation_link` was added after the assessment (the link-only
invitation delivery). It declares no `ai` block, which is this ADR's default, and it is not assessed
until a maintainer ruling names it.

**No automatic check.** The maintainer struck the pin test the assessment proposed:
「自动检查 有必要吗？每一个元数据应用都有类似的问题，后续都要检查吗」. This table lives only here; a reviewer
of `packages/platform-objects/src/identity/**` reads it. A customer app governs its own actions with
the same key and the platform's defaults: the opt-in, the confirmation default, and the ADR-0126
activation switch.

**How the declarations reach an agent.** Over MCP, a `sys_*` action is listed and run only when the
action itself declares `ai.exposed: true` — ADR-0066 D4's 2026-10-30 note records that mechanism
(`packages/runtime/src/action-execution.ts#systemObjectActionExposureError`). As of this addendum the
38 E and C actions above are the platform `sys_*` actions that declare it. Every gate after admission
still runs: ADR-0066 D4's capability gate, the ADR-0126 §8 activation switch, the
`ai.requiresConfirmation` gate (a C action is refused `428 ACTION_CONFIRMATION_REQUIRED`, nothing run,
until the call carries `confirm: true`; `packages/runtime/src/action-execution.ts#actionConfirmationRefusal`),
and the target's own authorization.

**Declared is not yet runnable for an OAuth-connected agent.** All 38 are `type: 'api'` actions that
forward to an identity route: 37 to the better-auth routes under `/api/v1/auth/`, and
`sys_api_key.revoke_api_key` to the REST data route. Those targets accept a signed-in session, and the
forward of an OAuth-connected agent's call is answered `401` there. Which credentials a forward
target accepts is not decided here; it is the open decision on #28178. Until that lands, an
OAuth-connected agent lists these actions, a C action is still refused `428` until the call is
confirmed, and a call that reaches the identity route is answered `401` there, with nothing changed.
A signed-in session's same call is served.

---

## References

* ADR-0003 — Package as first-class citizen (where actions live)
* ADR-0008 / ADR-0009 — Metadata change log & execution-pinned metadata
* ADR-0010 — Natural-language → Flow authoring (the AI-authoring counterpart)
* ADR-0033 — Draft-gating for AI-written metadata (review-before-publish)
* `packages/spec/src/ui/action.zod.ts` — `ActionSchema` + `ActionAiSchema`
* `packages/spec/src/contracts/ai-service.ts` — `AIToolDefinition`
* `packages/services/service-ai/src/tools/action-tools.ts` — the bridge
  *(Path note, 2026-09: historical and deliberately unlinked — `service-ai` was removed whole under
  ADR-0025 S2, `21d4f8901`, 2026-06-25; the open edition is MCP-only.)*
