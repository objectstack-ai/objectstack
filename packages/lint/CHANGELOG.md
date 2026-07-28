# @objectstack/lint

## 17.0.0-rc.0

### Minor Changes

- 14252d3: feat(approvals): cross-organization approver targeting — a plant document can
  require a group-side sign-off (ADR-0105 D9)

  One organization id used to decide three different things at once in
  `openNodeRequest`: where the request row lives, where its inbox index rows
  live, and **where its approvers are looked up**. The first two are the
  request's own organization by definition. The third is not — a group CFO holds
  her `cfo` position in the GROUP organization while the purchase order she signs
  off lives in the PLANT organization. `expandPositionUsers('cfo', <plant>)`
  matched nobody, the slot fell back to the dead `position:cfo` literal, and a
  group escalation could not be expressed at all.

  An approver may now declare which organization's directory resolves it:

  ```yaml
  approvers:
    - { type: position, value: plant_manager, group: plant }
    - { type: position, value: cfo, organization: $root, group: finance }
  behavior: per_group
  ```

  - **`$root` / `$parent`** walk D6's `parent_organization_id` tree, so the two
    common intents need **no deployment knowledge** — flow metadata is portable
    across environments while organization ids are minted per deployment. A slug
    covers what the symbols cannot, notably a **sibling** organization (a
    shared-services centre approving payables for every plant).
  - Declared **per approver**, so one node can require a plant manager and a
    group CFO in parallel. A node-level form cannot express that without
    splitting into serial nodes, which changes the semantics.
  - **Bounded, not free:** the target must share a `parent_organization_id` root
    with the request's organization. The rule reads only the organization tree —
    never the submitter — so one flow routes identically for everyone.

  Everything else fails loudly rather than quietly:

  - a non-`group` posture **refuses** the declaration (a `group` → `isolated`
    migration must not silently reroute approvals);
  - an approver type with no org-scoped directory (`user` / `field` / `manager` /
    `team`) refuses it too, and a new `approval-approver-cross-org-unsupported`
    lint catches that at author time;
  - a targeted approver holding no membership in the request's organization is
    dropped with a warning naming them — D2's union wall would otherwise hide the
    request from someone already routed to, so the node's existing
    `onEmptyApprovers` policy takes over instead of leaving an unopenable task.

  Nothing changes for an approver without `organization`: same resolution, same
  queries, no extra reads.

- 879ea13: ADR-0105 Phase 0 + Phase 1: group tenancy posture; organization scope as a
  first-class authorization dimension.

  > This release carries BREAKING spec removals (see "Enforce-or-remove" below)
  > but is recorded as `minor`: every publishable package is in the Changesets
  > lockstep group, so one `major` would promote the whole monorepo. Breaking
  > changes ship as `minor` during the launch window — the migration notes below
  > are what reach consumers in `CHANGELOG.md`.

  ## Tenancy is now a spectrum (D1)

  `single | group | isolated`, resolved by the `tenancy` service and selected with
  the new `OS_TENANCY_POSTURE` env var. Existing deployments are unchanged:
  `OS_TENANCY_POSTURE` unset derives the posture from `OS_MULTI_ORG_ENABLED`
  (`true` ⇒ `isolated`, else `single`). An unrecognized value throws at boot
  rather than silently landing in a posture with no organization wall.

  - `single` — no wall (unchanged).
  - `group` — **new.** Organizations are membership boundaries over one shared
    dataset; Layer 0 becomes `organization_id IN accessible_org_ids` (union / MOAC
    semantics). Enforced by the OPEN engine.
  - `isolated` — today's `multi`, renamed. Behavior, enterprise `org-scoping`
    probe and degraded-boot handling all unchanged.

  ## Organization scope is a first-class context field (D2)

  `ExecutionContext.accessible_org_ids` — every organization the caller holds a
  currently-valid membership in (ADR-0091 validity windows) — is resolved once by
  `resolveAuthzContext` and carried by every transport. The `group` wall reads it
  directly; RLS policies may reference it as
  `organization_id IN (current_user.accessible_org_ids)`. An empty or absent set
  fails the wall closed.

  Only the Layer 0 PREDICATE widens. Composition is untouched: the wall is still
  computed independently of the RLS compiler, AND-composed outermost, and
  crossable only by a true `PLATFORM_ADMIN` on a posture-permitting object — so
  ADR-0095's W1/W2 invariants hold in every posture.

  ## Two P0 correctness fixes (D3, D4) — behavior changes

  **D3 — app-authored org-scoped RLS policies are no longer silently dropped**
  (finding F1, framework#3539). `collectRLSPolicies` used to strip any policy whose
  `using` contained the substring `current_user.organization_id` when isolation was
  inactive, which swallowed app-authored policies as well as the platform's own.
  Stripping is now decided by PROVENANCE (identity against the shipped
  declaration). **Upgrade impact:** in a deployment with no organization wall, an
  app-authored policy referencing the active organization is now RETAINED and
  fails closed (zero rows) with a one-time warning, where it previously vanished
  and the object read unscoped. `getReadFilter` shared the defect, so analytics and
  raw-SQL consumers were affected too. If a policy was only ever meant for
  multi-org, delete it or install `@objectstack/organizations`.

  **D4 — `viewAllRecords`/`modifyAllRecords` never cross an organization
  boundary** (finding F2, framework#3540). Under a wall-less posture nothing
  bounded the wildcard superuser bits `organization_admin` carries, so a
  deployment that accumulated organizations (personal orgs on signup) made every
  owner/admin an environment-wide superuser. `auto-org-admin-grant` now grants a
  de-VAMA'd `organization_admin_no_bypass` variant when no wall is enforced, and
  revokes the superseded variant whenever the posture changes. **Upgrade impact:**
  in `single` posture an org owner/admin keeps full CRUD but loses the blanket
  ownership/sharing/RLS bypass. Deliberate deployment-wide visibility remains
  available through `admin_full_access` or an explicitly authored permission set —
  it just stops being a side effect of a better-auth membership role.

  ## Engine-owned organization stamping (D5)

  Under any wall-enforcing posture the engine stamps `organization_id` from the
  caller's active organization on an insert that omits it, and validates every
  supplied value against the wall. Idempotent with the enterprise auto-stamp
  (neither overwrites a supplied value). This also closes a real hole: the
  pre-existing post-image check required a non-array payload, so a BULK insert
  could carry a forged `organization_id` per row. One forged row now denies the
  whole write.

  ## Group structure, extension fields and red-line lints (D6, D7)

  - `sys_organization` gains `parent_organization_id` and `sort_order` — a
    **reporting dimension only**.
  - New lint `validateOrgAxisRedLines` (`org-axis-permission-inheritance`,
    `org-axis-cross-org-bu-grant`), wired into `os lint` / `os compile` /
    `os validate`: an RLS policy or sharing rule that walks the org tree is an
    error, as is a business-unit grant on a platform-global object.
  - Extension fields on better-auth-managed objects ride the existing ADR-0092
    whitelist. A new guard derives better-auth's real field surface from
    `getAuthTables()` at the pinned version and fails the build on any name
    collision, so a library upgrade cannot silently take ownership of a column.

  ## Enforce-or-remove (D11) — BREAKING

  Both removals are of surface that had **zero runtime consumers**, so no
  behavior changes; authoring them is now a no-op instead of a lint warning.

  - **`PermissionSet.contextVariables` — REMOVED.** The RLS compiler never read
    it. FROM → TO: a set a policy needs as `field IN (current_user.<key>)` is now
    supplied by a registered membership resolver (below); a constant belongs in
    the policy itself as a literal (`status = 'published'`).
  - **`Territory` / `TerritoryModel` / `TerritoryType` (`security/territory.zod.ts`)
    — REMOVED.** No runtime object, stack field or resolver existed. FROM → TO:
    matrix requirements are served by multi-position × business-unit anchoring; a
    generalized dimension-security module will arrive with its own ADR.
  - **`ExecutionContext.rlsMembership` — PRODUCTIZED.** The bag the compiler has
    merged since ADR-0056 finally has a producer: register an
    `IRlsMembershipResolver` (`@objectstack/spec/contracts`) under the
    `rls-membership-resolver` service, declaring the keys it owns. Fail-closed by
    construction — an unresolved key makes its policies drop out. Kernel-owned
    keys (`accessible_org_ids`, `org_user_ids`, …) are reserved and cannot be
    overwritten from this seam.

  ## Edition boundary (D12)

  The `group` posture's enforcement primitives ship OPEN — the union wall,
  `accessible_org_ids` resolution, D5 stamping/validation, the D3/D4 correctness
  fixes and the D6 lints — because the correctness of a wall is never a paid
  feature (cloud ADR-0016 铁律「强制免费、治理收费」). `isolated` keeps its existing
  enterprise `org-scoping` probe, so the current commercial boundary for
  legal-entity isolation is unchanged by this release.

- e2616e0: feat(spec,lint)!: remove `agent.tools[]`, lint agent authoring, and resolve `action_<name>` only when it actually materialises (#3820, ADR-0109 accepted)

  **Breaking — `agent.tools[]` is removed.** ADR-0064's central invariant is
  "an agent's tool set is the union of its surface-compatible skills' tools;
  nothing falls through to the global registry", and this legacy inline slot
  was the one seam that broke it: the runtime resolved `agent.tools[].name`
  against the **full** tool registry with no surface check, so an `ask`-surface
  agent could name an authoring tool and get it. Removing the field makes the
  invariant structural — there is no second slot to disagree with the skills —
  rather than a rule every reader has to remember (ADR-0049 "design+enforce or
  remove"). `AIToolSchema` / the `AITool` type go with it.

  _Migration:_ attach capability through `skills`. An agent authoring `tools` is
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

- 33f5e23: feat(lint): `validate-ai-surface-affinity` — skill ↔ agent surface affinity is now linted (#3820)

  An agent binds a product surface (`'ask'` | `'build'`, ADR-0063 §1) and a skill
  declares which surface it belongs to (`'ask'` | `'build'` | `'both'`, §3). The
  runtime refuses an incompatible binding with a **load error at chat time** —
  after parse, validate, and deploy all passed cleanly. The new rule reports that
  contradiction statically, and joins `REFERENCE_INTEGRITY_RULES`, so
  `objectstack validate`, `lint`, and `compile` all pick it up with no CLI
  changes.

  Scope is deliberately narrow (zero false positives by construction): only
  bindings where **both** the agent and the skill are declared in the same stack
  are checked. `agent.skills[]` names that don't resolve in-stack (kernel skills
  are runtime-registered and statically invisible) are skipped — resolving those
  namespaces is #3820 D0/D2, decided by ADR-0109 (Proposed).

  The spec side is doc-truth only, no schema shape changes:

  - `stack.agents` is documented as **platform-internal** (ADR-0063 §2 — the
    kernel ships exactly two agents; third parties extend via skills), replacing
    prose that still described the withdrawn ADR-0040 per-app-copilot model.
  - `stack.tools` is documented as declaration-only pending the ADR-0109 tool
    authoring model.
  - `app.defaultAgent` is re-documented as a surface-binding knob (`'ask'`
    implicit / `'build'` for authoring surfaces), not a custom-agent slot.
  - `SkillSchema` now states that a per-skill `permissions` field deliberately
    does not exist (ADR-0049) — authoring one is silently stripped; access is
    gated by `agent.access` / `agent.permissions` and per-tool authz.

- 259af21: feat(spec,lint): ADR-0109 Phase 1 — platform tool-name registry + advisory `skill.tools[]` reference lint (#3820 R7)

  ADR-0109 (revised) settles the AI tool authoring model: **the default
  third-party path needs no tool records at all.** A skill's `tools[]` names
  either a platform-registered tool or a tool the runtime materialises from the
  app's own declarative actions (`action_<name>`) — the executable, its authz,
  and its audit trail stay on the action/flow the app already ships. Tool
  records are demoted to an optional AI-presentation refinement layer (Phase 2,
  gated on acceptance).

  Phase 1, shipped here:

  - **`PLATFORM_PROVIDED_TOOL_NAMES`** (`@objectstack/spec/system`) — curated
    registry of every statically-named tool the cloud AI runtime registers,
    grouped by owning package, plus `PLATFORM_TOOL_FAMILY_PREFIXES` for the
    materialised `action_` family and `isPlatformProvidedToolName()`. The
    `PLATFORM_PROVIDED_OBJECT_NAMES` precedent, applied to tools; conformance
    tests live in the owning cloud packages.
  - **`validate-ai-tool-references`** (`@objectstack/lint`) — the #3820 R7
    `skill.tools` branch, wildcard-aware, resolving against declared
    `stack.tools` ∪ the registry ∪ the materialised action family. Severity
    **warning** (ADR-0078 advisory-first ratchet): the registry cannot see
    third-party runtime plugins. Joins `REFERENCE_INTEGRITY_RULES`, so
    `validate`, `lint`, and `compile` all pick it up. On the HotCRM corpus it
    reports exactly the 10 fictional tool references (0 false positives on the
    6 that resolve).
  - **`composeStacks` no longer drops `tools`** — the slot joins the
    concatenated array fields, so a declared record survives composition.
  - `stack.tools` / AI-slot docs updated to the ADR-0109 model.

- 474fe39: feat(approvals): declare approver value bindings; retire `queue` approver authoring (#3508)

  - `@objectstack/spec` exports `APPROVER_VALUE_BINDINGS` — the single declaration of how a
    designer must source each approver row's `value`: `user`/`team`/`department`/`position`
    are DATA-record lookups on the system directory objects (`sys_user` / `sys_team` /
    `sys_business_unit` / `sys_position`; `position` commits the machine **name**, the
    others the row id), `org_membership_level` is a closed enum (`ORG_MEMBERSHIP_LEVELS`),
    `manager` is auto-resolved, `field` names a trigger-object field, and `queue` is
    unsupported. Also exports `NON_AUTHORABLE_APPROVER_TYPES`.
  - `queue` approver type is deprecated-for-authoring: it still parses (stored flows keep
    loading and rendering) but is published in `xEnumDeprecated`, so designers stop
    offering it — the runtime has no queue resolution and the slot routes to nobody. The
    approver `value` xRef now also maps `manager`, so designers can render its
    auto-resolved state. No authored key is removed; nothing to migrate. If a flow carries
    `{ type: 'queue' }`, replace it with `team` / `department` / `position` (or a concrete
    `user`) until a real ownership-queue implementation lands.
  - `@objectstack/plugin-approvals` now warns at resolution time when a stored `queue`
    approver is skipped.
  - `@objectstack/lint` adds `approval-approver-type-unsupported` (warning) for approver
    types that are declared but not implemented by the runtime.

- 2fa4ca1: Dynamic approver routing for approval nodes (#3447 P2) — three new declarative capabilities:

  **`expression` approvers.** A new approver type whose CEL expression resolves WHO approves at node entry, over exactly three roots: `current.*` (the record's live state), `trigger.*` (the submit-time snapshot) and `vars.*` (flow variables, incl. upstream node outputs). `record` and bare field names are rejected before evaluation — on this platform `record` always means "the record at event time", which is ambiguous at an approval node — with error messages that prescribe the correct spelling. The optional `resolveAs: 'user' | 'department' | 'position' | 'team'` re-expands each resolved id through the same graph lookups the static types use; with `behavior: 'per_group'` each intermediate value (e.g. each returned department) forms its own sign-off group. A missing key fails the node loudly; only a present-but-empty result counts as an empty slate.

  **`onEmptyApprovers` policy.** What an empty resolved slate does, node-level, for all approver types: `admin_rescue` (default — request opens for privileged takeover, the #3424 behaviour), `fail` (node fails), or `auto_approve` (skip the request, continue down the `approve` edge with `output.autoApproved = true`). To support auto-approve, the automation engine now honours `NodeExecutionResult.branchLabel` on the synchronous completion path — the field existed but was only ever consumed via resume signals.

  **Decision outputs.** `decide(..., { outputs })` hands structured data from the approver to the flow: the author declares allowed keys on the node (`decisionOutputs`), approvers fill values only, and accepted outputs resume the run as `<nodeId>.<key>` variables — a later approval node's expression can read `vars.<nodeId>.picked_departments`, closing "the previous approver picks the next step's approvers" without a record-field detour. Undeclared keys reject the decision; `decision`/`requestId` are reserved. Multi-approver tallies now always pin to the open-time approver snapshot (previously unanimous re-resolved at each decision against the payload snapshot).

  Also: `collectCelRootIdentifiers` is exported from `@objectstack/formula` (shared by the new `os lint` rules and the runtime pre-check, so they can never drift), resolution inputs are audited on the request snapshot as `__resolvedFrom`, and three new lint rules gate expressions, empty-slate policies and reserved output keys at author time.

- b0e5a37: fix(lint,cli): a filter reference that cannot resolve fails the build, not the run (#3426, #3810)

  `validateFlowTemplatePaths` reported every `{record.<path>}` miss as **advisory**,
  on the reasoning that an unresolved token renders a blank and the run still
  completes. Since #3810 that reasoning no longer holds in one position: inside a
  CRUD node's `filter`, an unresolved token does not blank a value, it **deletes
  the condition** — and a removed condition matches MORE rows, not fewer. Those
  nodes now refuse to execute rather than run a widened query.

  So the rule was warning about metadata whose runtime is already decided: `os
validate` printed a yellow line, exited 0, and shipped a flow that cannot run.
  Severity now follows the runtime consequence, by position:

  - **`filter` of `get_record` / `update_record` / `delete_record` → `error`.**
    These are the three nodes whose filter `resolveNodeFilter` guards. The finding
    says what the runtime will do ("the node refuses to run at execution time")
    and why the build gates rather than warns (an absent condition _widens_ the
    query). `os validate` exits 1.
  - **Every other position → `warning`, unchanged.** A message body, an `http`
    url, an `update_record` write payload: the token still renders a blank, the
    run still completes, and the head object may legitimately come from another
    installed package. `create_record` is deliberately excluded from the gating
    set — it writes a payload and has no filter to widen.

  Both rules split this way (`flow-template-unknown-field` and
  `flow-template-lookup-traversal`), so a typo and a lookup hop are gated wherever
  the runtime refuses them. A reference used in both positions on one node is
  reported **once, at error severity**.

  **`os validate` now enforces it.** The command filtered this rule's findings for
  `severity === 'warning'` and dropped everything else on the floor, so an error
  from it would have been invisible. It now gates on errors first — printing rule
  id and config path, and emitting them under `errors` in `--json` — mirroring the
  `validateReadonlyFlowWrites` step directly below, which makes the same
  shift-left split (a certain runtime failure gates; a state-dependent one
  advises).

  Verified against the shipped examples: 33 flows across app-todo, app-crm and
  app-showcase produce **no new errors**; the four pre-existing lookup-traversal
  warnings sit in `script` / `notify` / `subflow` / `parallel` positions and keep
  their advisory severity.

  No authoring change is required for a correct filter. A filter that this rule
  now fails is one the runtime would have refused anyway — the difference is that
  you find out at `os validate` instead of at 3am.

- fd7cfde: fix(lint,cli): the flow-template-path rule reaches `os lint` and `os compile`, not just `os validate` (#3583, #3810)

  `validateFlowTemplatePaths` was wired by hand into `os validate` and nowhere
  else. That is precisely the drift `REFERENCE_INTEGRITY_RULES` exists to end
  (#3583 §5 D5): the same stack, checked by a different rule subset depending on
  which command the author happened to run.

  It mattered more after #3861 gave the rule a gating severity. A `{record.<path>}`
  token in a CRUD node's `filter` that names an unknown field — or hops through an
  un-expanded relation — makes the runtime **refuse the node** (#3810). `os
validate` failed on it; `os lint` and `os compile` did not look, so a CI job
  running either one would build and ship a flow that cannot execute.

  **The rule is now a suite member.** It belongs by the suite's own admission
  criterion: a `{record.<field>}` token is a name written in metadata, resolved
  against the bound object's declared fields. One line in
  `REFERENCE_INTEGRITY_RULES` reaches all three commands, and the hand-wiring in
  `validate.ts` is deleted rather than duplicated.

  Before landing this, the rule was run against all three stack shapes the suite
  is handed — raw `config` (`os lint`), `normalizeStackInput` output, and
  schema-parsed `result.data` (`os validate` / `os compile`) — across `app-todo`,
  `app-crm` and `app-showcase`. All three agree finding-for-finding, so moving the
  call site does not change what is reported.

  Verified end-to-end on `app-showcase`: all three commands pass unchanged on the
  real stack (the four pre-existing lookup-traversal warnings still print, still
  advisory), and with one filter token corrupted to `{record.idd}` **all three now
  exit 1** — where previously only `validate` did.

  **Also fixed, in the same file.** On a clean run, `os validate --json` never
  reported the reference-integrity suite's warnings: `refWarnings` was assembled,
  printed to the console, and included in the _failure_ payload, but omitted from
  the success-path `warnings` array. Adding the rule to the suite would have
  silently dropped its warnings from `--json` for JSON consumers, so `refWarnings`
  now appears there — which also surfaces the other five rules' warnings that were
  being discarded. Same shape of bug as the dropped errors #3861 fixed: computed,
  then thrown away.

- 9bf4588: feat(lint): flag never-firing record trigger tokens at authoring time (#3427)

  New `flow-trigger-unknown-event` rule in `validateFlowTriggerReadiness`: a flow
  start node whose `triggerType` is record-lifecycle-shaped
  (`record-before|after-<op>`) but names an op the record-change trigger cannot map
  — e.g. a typo like `record-after-updated` — binds to the record-change trigger
  yet maps to no ObjectQL hook and never fires, with only a runtime warning. The
  rule surfaces that never-fire defect at `os validate` time. Warning severity;
  bare `record-<noun>` shapes (e.g. `record-change`) are out of scope.

- f022c4d: refactor(lint): one entry point for the reference-integrity suite (#3583 D5)

  Six rules that answer the same question — "does this name resolve to anything?"
  — were wired by hand into three CLI commands, so landing a rule meant editing
  `validate`, `lint` and `compile`, and forgetting one meant the same stack got a
  different verdict depending on which command the author ran.

  New public API on `@objectstack/lint`:

  - `validateReferenceIntegrity(stack)` — runs every reference-integrity rule and
    returns the concatenated findings.
  - `REFERENCE_INTEGRITY_RULES` — the ordered list behind it (`validateObjectReferences`,
    `validateActionNameRefs`, `validatePageFieldBindings`, `validateChartBindings`,
    `validateNavAccess`, `validateTranslationReferences`).
  - `ReferenceIntegrityFinding` / `ReferenceIntegrityRule` / `ReferenceIntegritySeverity`
    — one finding type instead of a six-way union.

  Adding a rule to that list reaches `validate`, `lint` and `compile` with no
  further wiring. The individual rule exports are unchanged, so nothing that
  imports them directly needs to move.

  Behaviour-preserving: identical findings on the three example apps (zero) and
  on the HotCRM corpus (24, unchanged per rule). `os doctor` is deliberately not
  converted — it runs only `validateWidgetBindings` and is an environment health
  check rather than an authoring gate.

- 2343099: feat(lint): translation-bundle reference integrity + option-key validation (#3583)

  The i18n gate only ever ran forward: `os i18n check` asks which keys the
  metadata expects that no bundle carries. Nothing asked the reverse — which keys
  a bundle carries that no metadata claims — even though the spec already names
  the answer (`TranslationDiffStatus 'redundant'`, `TranslationCoverageResult.redundantKeys`,
  both declared with no producer).

  That direction ships two failure modes, both found in the HotCRM audit: bundles
  keyed to fields an object no longer declares (a rename that left the translation
  behind), and select-option translations keyed by the option's **display label**
  or a variant spelling of its value (`direct-mail` for `direct_mail`, `planned`
  for `planning`). Neither breaks anything — which is the problem. The resolver
  finds nothing and renders the source string, so the screen looks translated and
  one field or one picklist value quietly does not.

  New rule `validateTranslationReferences` walks every bundle in
  `stack.translations` against the stack it ships with, wired into `os validate`,
  `os lint`, and `os compile`:

  | Key                                                                           | Must name                                                                          |
  | ----------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
  | `objects.{object}`                                                            | an object this stack defines, or a platform object                                 |
  | `objects.{object}.fields.{field}`                                             | a field that object declares                                                       |
  | `objects.{object}.fields.{field}.options.{key}`                               | an option's stored `value`                                                         |
  | `objects.{object}._views` / `._actions` / `._sections` / `._actions.*.params` | a view `name` / bound action / `fieldGroups[].key` or named section / param `name` |
  | `apps.{app}` / `.navigation.{id}`                                             | an app `name` / navigation item `id`                                               |
  | `dashboards.{dash}` / `.widgets.{id}` / `.actions.{actionUrl}`                | dashboard `name` / widget `id` / header `actionUrl`                                |
  | `globalActions.{action}`                                                      | an action with no `objectName`                                                     |

  Every finding is a **warning** (`translation-target-unknown`,
  `translation-option-key-unknown`): an orphan key is inert, not broken, and the
  severity should say so. Diagnostics carry the declared names to choose from,
  name the stored value when a key turns out to be the display label, and suggest
  a namespace-segment match (`task` → `todo_task`) that edit distance alone misses.

  Cross-package objects follow the existing ladder: a registered platform object
  is skipped wholly (its fields are not visible from a stack lint), a
  platform-prefixed name no package registers is reported once on the object key,
  and the subtree is never half-checked. `messages`, `validationMessages`,
  `settings`, `settingsCommon` and `metadataForms` are deliberately not judged —
  their keys are owned by application code, plugins, and the platform's own
  metadata-type registry, so no enumerable universe exists to resolve against.

- f2b8ac9: Navigation reachability vs. granted access (issue #3583, assessment R5)

  `validate-nav-access` joins what an app's navigation exposes against
  `buildAccessMatrix` — the first lint consumer of the ADR-0090 D6 matrix, which
  previously only backed `os compile`'s snapshot gate. An object in the menu that
  no permission set grants read on renders as an entry and then fails
  permission-denied when opened: it works while you browse as an administrator
  (the platform's built-in `admin_full_access` carries a wildcard grant) and
  breaks for exactly the users the app ships permission sets for.

  Advisory severity — a grant can legitimately come from a permission set another
  installed package ships. Quiet by construction in three cases: platform-provided
  objects (their own packages grant them), stacks that declare no permission sets
  at all (permissions managed elsewhere, so flagging every entry says nothing),
  and any stack where a set carries a wildcard `objects: { '*': … }` grant — the
  shape `admin_full_access` itself uses, which the access matrix records under the
  literal key `*`.

  Wired into `os validate`, `os lint`, and `os compile`.

- 2a5f04a: `<ObjectChart>` aggregate result-column naming is now a contract, and its axis bindings are validated (issue #3701)

  Split out of #3583 Phase 2 (#3684), which extended ADR-0021 axis checking to
  report charts, list-view charts, and dataset-bound page chart components but had
  to leave the react `<ObjectChart>` block out: it is OBJECT-bound (`objectName` +
  an inline `aggregate`), `aggregate` existed in the contract only as the
  description string `'{ field, function, groupBy }'`, and nothing in the repo said
  what the aggregated result columns were called. Without that, `xAxis`/`yAxis` had
  nothing to resolve against, and guessing a convention would have manufactured
  false positives (ADR-0072 D1).

  **The convention, recorded rather than invented.** Every path that can serve an
  object-bound chart already agreed — the engine's structured-`groupBy` aggregate
  (whose alias objectui sets to `field || function`), the legacy analytics query
  (which remaps its measure key back to `field`), the client-side fallback, and the
  console's own chart-view wiring (`xAxisKey: groupBy`, `series[].dataKey: field`).
  `packages/spec/src/ui/chart-aggregate.ts` writes it down and exports it:

  - an object-bound aggregate returns rows keyed by the **raw field names** —
    `groupBy` for the category column, `field` for the value column, the literal
    `count` for a fieldless count, plus `<field>__comparison` under a comparison
    overlay;
  - `chartAggregateCategoryKey` / `chartAggregateValueKey` / `chartAggregateResultKeys`
    derive those columns so producers and checkers cannot re-derive them apart;
  - `ChartAggregateSchema` replaces the description string with a real Zod schema
    and rejects a non-`count` function with no `field` (which used to reach the
    renderer as `sum(undefined)` and render blank).

  This is the deliberate opposite of the dataset path, whose rows are keyed by the
  declared measure `name` (`sum_amount`) — the trap `chart-measure-unknown` catches.
  Only the dataset path has an author-chosen name to key by.

  **`<ObjectChart>`'s contract now names the props it actually reads.** The block
  consumes `xAxisKey` and `series[].dataKey`; `ChartConfig`'s `xAxis`/`yAxis`/`series`
  shapes reached it and were silently dropped, which ADR-0078 forbids. They are
  removed from the block's `dataProps`; `chartType`, `xAxisKey`, and `series` are
  declared in the React overlay where the other bindings live.

  **`validate-react-page-props` now reads attribute VALUES**, not just names, for
  `<ObjectChart>`:

  - `react-chart-field-unknown` (error) — `aggregate.field` / `aggregate.groupBy`
    naming a field the bound object does not declare;
  - `react-chart-aggregate-invalid` (error) — an unimplemented aggregation
    function, or a non-`count` function with nothing to aggregate;
  - `react-chart-axis-unknown` (error) — `xAxisKey` / `series[].dataKey` naming a
    column the aggregate does not return (including a dataset-style `sum_total`),
    or a category axis bound to the value column;
  - `react-chart-axis-inert` (warning) — the `xAxis` / `yAxis` shapes this block
    never reads.

  Value reading is opt-in per block and evaluates only static literals: a prop
  driven by React state or a variable, a usage carrying a `{...spread}`, a chart
  given inline `data`, and objects another package defines are all skipped
  silently — an unresolvable binding is not a wrong one.

- 4f740b0: `<ObjectChart>`'s author contract is the spec `ChartConfig` shape again (issue #3729)

  #3701 trimmed `xAxis`/`yAxis`/`series` out of the `<ObjectChart>` contract
  because the renderer read `xAxisKey`/`series[].dataKey` and silently dropped the
  ChartConfig shapes — an honest record of the runtime gap, not the target state.
  objectui#2880 closed the gap the other way round (the renderer now honors
  `ChartConfig` through one normalization boundary), so the contract follows the
  protocol again (ADR-0082 D1: the spec schema IS the protocol).

  **Contract.** `type`, `xAxis`, `yAxis`, `series`, `subtitle`, `showDataLabels`,
  `annotations` and `interaction` are published from `ChartConfigSchema`; the
  internal `chartType`/`xAxisKey`/`series[].dataKey` spellings leave the author
  contract. `annotations` and `interaction` gained the `.describe()` they never
  had, so the generated contract stops publishing bare `object[]` with no meaning.

  **The `type` exception.** `ChartConfig.type` is the chart family, but on any
  surface that flattens chart config into a props bag `type` is already the SDUI
  envelope's component discriminator — an author writing `type="bar"` used to
  replace `object-chart` and the block stopped resolving. The collision is created
  by the flattening and is resolved there (objectui's react-page wrapper), so the
  contract can publish `type` as the spec spells it. The contract generator's
  blanket `type` skip is now overridable by an explicit `dataProps` allow-list,
  since for this one block `type` is a real author prop.

  **Lint.** `validate-react-page-props` reads the axes in the spec spelling —
  `xAxis.field`, `yAxis[].field`, `series[].name` — and keeps accepting the
  internal spellings silently, because dashboards and the console's own chart-view
  wiring emit them. `react-chart-axis-inert` is retired: the props it warned about
  are honored now, so the warning would be false. The three binding-integrity
  rules from #3701 are unchanged.

  **Spec.** `chart-aggregate.ts` records the constraint the whole result-column
  convention rests on: an inline `aggregate` is SINGLE-MEASURE. Keying rows by the
  raw field name only works because there is exactly one measure to key; two
  measures over one field would collide, and resolving that needs an author-chosen
  name per measure — which is what a dataset is. Widening `ChartAggregateSchema`
  into a measures array would silently invalidate every axis binding these rules
  validate, so the boundary is now written down rather than left to be rediscovered.

  The chart taxonomy note is corrected too: grouped/stacked bar and stacked area
  are absent from `ChartTypeSchema` not because they render as their base chart,
  but because stacking is a property of the SERIES (`ChartSeries.stack`), not a
  chart family — one `bar` family plus a series stack group expresses all three.
  `ChartInteraction.zoom` is now marked declared-not-delivered in its own
  description rather than reading as shipped.

- 17749fc: Page-component field bindings and non-dashboard chart bindings (issue #3583, Phase 2)

  Two more reference-integrity rules from the #3583 assessment, both wired into
  `os validate`, `os lint`, and `os compile`.

  **`validate-page-field-bindings`** — `PageComponent.properties` is an untyped
  bag, so a highlights strip, KPI card, or details section can name a field the
  bound object does not have; the component silently skips it. Which object a
  component binds follows `dataSource.object` → `properties.object` → the page's
  `object`, so multi-object pages are checked per element. `record:related_list`
  resolves its columns/sort/filter against the **related** object and its
  add-picker against that picker's own object. Advisory (matching
  `FORM_FIELD_UNKNOWN`). Relationship paths, system fields, cross-package objects,
  and unregistered component types are skipped.

  **`validate-chart-bindings`** — extends ADR-0021 axis checking past dashboards to
  report charts (`report.chart` and `report.blocks[].chart`), list-view charts
  (`views[].list`, `views[].listViews.*`, `objects[].listViews.*`), and
  dataset-bound page chart components. An axis naming a raw field instead of a
  declared measure is an **error** (the series comes back empty); an axis naming a
  declared-but-unselected measure is a **warning**. The report shape needed its own
  handling: `ReportChartSchema` narrows `xAxis`/`yAxis` to bare strings, which the
  dashboard rule's array guard skips silently. The react `<ObjectChart>` block is
  object-bound, not dataset-bound, and is deliberately left out — nothing defines
  what its aggregate names the result column.

  **Fixes:** the page walk used by `validate-action-name-refs` read a top-level
  `page.components` array, which `PageSchema` does not have — components live under
  `regions[].components[]` and `slots`, and sub-trees nest inside the untyped
  `properties` bag (`children`, `items[].children`, `body`, `footer`) rather than a
  `children` key on the component. The rule was therefore visiting nothing on a
  schema-parsed stack. Traversal now lives in one shared, tested module; on the
  showcase app it reaches 194 components where the previous shape found 46.
  Source-authored pages (`kind: 'html' | 'react' | 'jsx'`) are skipped — their
  `regions` hold a derived cache the `source` wins over.

- 4340f13: feat(lint,cli): flag flow `update_record` writes to readonly fields at design time (#3425)

  A flow `update_record` node that writes a field the target object declares
  `readonly: true`, under the default `runAs: 'user'` identity, is a **silent
  no-op**: the objectql engine strips static-`readonly` fields from a non-system
  UPDATE payload (#2948), so the intended write never lands — yet the step still
  reports `success`. #3407/#3413 surfaced the strip as a run-time step warning;
  this moves the discovery **left** to `os validate` / `os build` so an author
  finds the mismatch at design time instead of by reading server WARN logs days
  later.

  - New `@objectstack/lint` rule `validateReadonlyFlowWrites(stack)` — a pure
    `(stack) => Finding[]` check (ADR-0019). A static `readonly:true` field
    written by a literal `update_record` under `runAs !== 'system'` is a
    100%-certain no-op → **error** (gates the build). A `readonlyWhen` field is
    per-record-state → **warning** (advisory). Deliberately narrow to stay
    false-positive-free: `create_record` (INSERT is engine-exempt from the strip),
    `runAs: 'system'` flows (the intended "automation maintains it" channel),
    templated object names, and non-literal `fields` maps are all skipped.
  - Wired into `os validate` and `os compile`/`os build`, mirroring the existing
    security-posture gate (errors fail; advisories print dimmed).

  The formal contract, unchanged in behavior: `readonly` governs the end-user /
  API surface (REST/UI and `runAs:'user'` flows strip it); trusted system writers
  (`runAs:'system'`, system hooks, seeds) maintain it. To let a flow maintain a
  readonly field, declare `runAs: 'system'`.

- f163028: Reference-integrity validation for object and action names (issue #3583)

  A HotCRM audit found ~20 shipped instances of one bug class — metadata naming
  something that does not exist — all passing `objectstack validate` / `lint`
  cleanly and failing silently at runtime. This closes the object-name and
  action-name half of that class.

  **New — `@objectstack/spec`:** `PLATFORM_PROVIDED_OBJECT_NAMES`, a curated
  registry of every object name contributed by a platform package, official
  plugin, or the cloud runtime, plus `isPlatformProvidedObjectName()` and
  `hasPlatformObjectPrefix()`. This replaces the `startsWith('sys_')` prefix guess
  that could not tell `sys_user` (real) from `sys_approval_process` (fictional —
  removed by ADR-0019, registered by nothing), which is why every fictional
  platform-prefixed reference shipped. A conformance test scans each package's
  `*.object.ts` declarations and fails if the registry drifts.

  **New lint rules** (wired into both `os validate` and `os lint`):

  - `validate-object-references` — action-param `reference` / `objectOverride`,
    dashboard `globalFilters[].optionsFrom.object`, and navigation
    `requiresObject` gates. Severity follows resolvability: an unresolved
    _unprefixed_ name is a typo (**error** — `object: 'user'` where the platform
    object is `sys_user`); an unresolved _platform-prefixed_ name is **advisory**,
    since a third-party package may still provide it.
  - `validate-action-name-refs` — the surfaces that bind an action BY NAME:
    list-view `bulkActions` / `rowActions`, page `record:quick_actions`
    `actionNames`, and nav action items. A name matching no defined action is an
    **error** (the button renders and does nothing), matching the existing
    dashboard-action-target rule.

  **Fixes:**

  - `defineStack` cross-reference validation now walks `app.areas[].navigation` —
    an areas-based app previously got no navigation checking at all — and recurses
    into `children` on `object` nav items, not only `group` ones.
  - `os lint` i18n coverage now reads field `options` in the canonical
    `{value,label}[]` array shape; it only handled the record map, so option-label
    coverage silently never fired for canonically-shaped select fields.
  - Hook `condition` expressions are now field-checked when `object` is an ARRAY
    of targets (previously only a single string target was checked, so a
    multi-target hook filtering on a nonexistent field passed clean). Per-target
    diagnostics are de-duplicated.
  - A dashboard widget binding no `dataset` at all is now reported instead of
    silently bypassing every binding and chart check on the raw-config
    (`lint`/`doctor`) paths. `dataset` is schema-required, so this matches what
    the parsed paths already enforce.

### Patch Changes

- 1bd5652: feat(auth): give ADR-0105 D8's scope-bounded issuance a caller — the
  `delegated_admin` org role, capped so it cannot mint authority (#3697)

  D8 authorizes invitation _placement_ against the issuer's `adminScope`
  (ADR-0090 D12), so a delegated plant admin may invite only into their own
  subtree. That gate is implemented, unit-proven and reachable — but no principal
  could reach it in a state where it did anything:

  - better-auth grants `invitation: ["create"]` to `owner` and `admin` only
    (`memberAc` holds `invitation: []`, which every other registered role
    inherits);
  - under a wall-enforcing posture, owners and admins are auto-elevated to
    `organization_admin` (`auto-org-admin-grant.ts`), which carries the wildcard
    `modifyAllRecords` that makes `isTenantAdmin()` true — and the gate
    short-circuits on tenant admins.

  The two sets were disjoint. Issuance placement was bounded by the Layer 0 org
  wall (real, and correct) but never by `adminScope`, so D8's motivating story —
  "a plant admin invites into their own subtree without a platform admin
  finishing the job" — could not happen.

  **Two pieces, and they only ship together.**

  **1. The role.** `delegated_admin` is now registered with the organization
  plugin as `memberAc.statements` plus `invitation: ["create"]` — the one
  membership grade that may reach `/organization/invite-member` without being an
  org admin. Deliberately _not_ `invitation: ["cancel"]`: better-auth's cancel
  route checks the permission with no inviterId attribution, so it would mean
  "cancel anyone's pending invitation in the org".

  The role carries no ObjectStack authority by construction — `mapMembershipRole`
  passes it through as a position name, and with no `sys_position_permission_set`
  binding that name resolves to nothing. Role = _can reach the endpoint_;
  `adminScope` = _what the endpoint permits_.

  `sys_member.role` and `sys_invitation.role` each gain `delegated_admin` as a
  fourth option. Those selects are **enforced on write** — better-auth's own
  invitation and membership inserts are validated like any other row — so
  registering the role with the org plugin without listing it in both would have
  produced a role nobody could hold and nobody could hand out
  (`ValidationError: role must be one of: owner, admin, member`). That is exactly
  how the end-to-end regression caught it, twice; neither unit test could. The
  three non-English translation bundles carry the English label for the new option
  until localized.

  **2. The role cap**, in the framework's own `beforeCreateInvitation` hook,
  beside the D8 placement gate. Registering the role alone would have been a
  four-step privilege escalation: better-auth's only role-level cap on _what role
  you may invite someone as_ is its `creatorRole` check (default `owner`), which
  blocks inviting an **owner** but not an **admin** — and an accepted `admin`
  membership is auto-elevated to `organization_admin` → `isTenantAdmin()`. A
  subtree-scoped delegate could have manufactured a tenant admin, with every
  existing defense off the path (`sys_member` is not a `GOVERNED_OBJECT`, and the
  acceptance-time membership write runs under better-auth's context, not the
  issuer's).

  The cap refuses an invitation whose role outranks the issuer's own, and
  restricts a below-admin issuer to plain `member` — not merely "not admin/owner",
  because an app-registered role projects into `current_user.positions` and may be
  bound to permission sets, making it a capability channel too. A delegate's
  channel for capability is the invitation's _placement_ intent, which the D12
  gate allowlists position-by-position. The cap applies to every invitation,
  placement-carrying or not (the escalation is independent of placement), and
  fails closed: an issuer role that cannot be resolved confers nothing above a
  plain member.

  **What changes for deployments.** One new class of principal exists: members
  holding the `delegated_admin` org role, who can invite into the org — as
  `member` only, into the subtree their `adminScope` allows. It is opt-in twice
  over (someone must set the membership role _and_ grant an adminScope set), so a
  default deployment changes not at all. Org owners and admins are unaffected.

  Also exported: `MEMBERSHIP_ROLE_DELEGATED_ADMIN` from `@objectstack/spec`, so
  console and control-plane surfaces name the role from one place.

- 9dcc0ae: fix(automation): array-form flow `triggerType` fails loudly instead of silently never firing (#3481)

  An array `triggerType` on a flow start node — the shape an author (or an AI
  authoring pass) naturally reaches for to fire on more than one event, e.g.

  ```ts
  config: { objectName: 'app_task', triggerType: ['record-after-create', 'record-after-delete'] }
  ```

  was accepted everywhere and armed nowhere. Multi-event unions are deliberately
  unsupported (only the single tokens plus the `record-after-write` create-OR-update
  union exist — see #3457), but nothing said so: `defineFlow` passed the array
  (start-node `config` is an open record), the engine's `typeof === 'string'` check
  folded it to no trigger and misclassified the flow as **manual**, so it never
  entered the trigger-binding audit, and the flow-trigger-readiness lint used the
  same `typeof` narrowing and produced no finding. The flow bound to nothing and
  never fired, with zero output at any layer — the same silent-never-fire class as
  #3427 / #3472, and the last authoring shape still slipping past every guard.

  This is a **defensive** fix — arrays remain unsupported; they now fail loudly:

  - **lint** (`validate-flow-trigger-readiness`): an array `triggerType` containing
    any `record-*` element now yields a `flow-trigger-unknown-event` warning at
    `os validate` time, steering to `record-after-write` (for created-or-updated) or
    one flow per event.
  - **engine** (`resolveTriggerBinding`): such an array is routed to the
    `record_change` trigger — exactly as an unmappable single token is — instead of
    being folded to a manual flow, so it reaches the trigger's bind-time rejection.
  - **trigger** (`record-change`): the bind-time rejection detects the array shape
    and emits a targeted warning (naming the flow, pointing at `record-after-write`
    and #3457) rather than the generic unknown-token line.

- 5b89711: feat(spec,lint): freeze the `{current_user_id}` filter vocabulary and fail the build on unresolvable placeholders (#3574)

  A dashboard widget filtered on `{current_user}` rendered `0`. Not an error — a
  zero, indistinguishable from a metric that is legitimately empty, with nothing
  in the console or the server log. `service_dashboard.my_open_cases_by_priority`
  in the HotCRM template had shipped broken this way since the day it was
  written.

  The token had never been part of the contract. Date macros were frozen in
  `date-macros.zod.ts` with a spec vocabulary, a lint-usable predicate, and a
  single client resolver; `{current_user_id}` had only prose in an `app.zod.ts`
  JSDoc and three ad-hoc client implementations that each handled one surface's
  filter shape. Nothing could tell an author their token was wrong.

  - **`@objectstack/spec`** — new `data/context-tokens.zod.ts` freezing
    `CONTEXT_TOKENS` (`current_user_id`, `current_org_id`) as the sibling of
    `DATE_MACRO_TOKENS`, with `isContextToken` / `isKnownFilterToken` /
    `classifyFilterToken` and a `CONTEXT_TOKEN_SUGGESTIONS` near-miss table. The
    module documents what the tokens are _not_: presentation scope, never an
    access boundary — that is RLS, which uses the unrelated `current_user.id`
    expression root.
  - **`@objectstack/lint`** — new `validateFilterTokens` (rule
    `filter-token-unknown`, severity `error`). It walks `filter` / `filters` /
    `runtimeFilter` subtrees across dashboards, objects, views, reports,
    datasets, pages and apps, and reports any placeholder that resolves in
    neither vocabulary. It scans for filter _keys_ rather than enumerating known
    surfaces, so a new surface following the convention is covered the day it
    ships — enumerating surfaces is how the dashboard was missed in the first
    place. Navigation `recordId` / `params` are deliberately out of scope: they
    resolve `AppContextSelector` ids, which are meaningless in a filter.
  - **`@objectstack/cli`** — the gate runs in `os validate` and `os compile`.

  It is an error rather than a warning because of who authors this metadata. An
  AI reads a query returning `0` as a correct answer and builds on it; its
  correction loop is author → validate → fix, so a diagnostic only reaches it if
  it can fail the build. The three spellings the suggestion table covers —
  `{current_user}`, `{user_id}`, `{organization_id}` — are each correct
  _somewhere else_ in the platform, which is exactly why authors reach for them.

  Also fixes a `ViewSchema` JSDoc example that documented `{user_id}`, a token
  that resolves nowhere.

- de9af8a: fix(automation,objectql): a filter that loses a condition must not run (#3810)

  Three related holes, all of which end in "the query matched rows the author
  excluded".

  **1. A flow filter could silently widen to match everything.**

  The flow template interpolator expresses "this token did not resolve" as
  `undefined`. In a message that renders as empty text — harmless. In a FILTER it
  removes the condition, and a removed condition matches MORE rows. When it was
  the only condition, `{ owner: '{record.ownr}' }` became `{}`, and `{}` handed to
  `deleteMany` is every row in the table.

  So one mistyped field name in a `delete_record` node silently emptied the
  object. Reproduced with all four causes: a typo (`{record.ownr}`), an input the
  run never received, a lookup hop (`{record.account.name}` — the trigger record
  carries a scalar id), and a filter placeholder.

  `get_record` / `update_record` / `delete_record` now refuse to execute when
  interpolation erased any authored condition, naming the offending template. The
  guard keys on LOSS, not emptiness: an author who deliberately wrote no filter is
  unaffected, and losing one of two conditions still fails, because widening from
  "my open records" to "all open records" is the same class of bug.

  **2. Filter placeholders never reached the engine that resolves them.**

  `config.filter` is where two `{…}` dialects meet — the flow template dialect
  (`{record.owner}`) and the filter placeholder dialect (`{current_year_start}`,
  `{current_user_id}`, resolved by `resolveFilterTokens()`). Evaluation order
  picked the winner by accident: the flow interpolator ran first, found no flow
  variable by that name, and erased it.

  `interpolateFilter()` hands that position back to the dialect that owns it — a
  whole-string token that no flow variable resolves and that IS a recognised
  placeholder passes through verbatim for the engine to expand. Flow variables
  keep precedence, so a template that works today cannot change meaning.

  **3. The engine resolved placeholders on reads but not on writes.**

  `resolveFilterTokens()` reached `find`/`findOne`/`count`/`aggregate` only. So
  the SAME filter selected different rows depending on the verb: `find({ owner:
'{current_user_id}' })` matched the signed-in user's rows, while
  `update`/`delete` compared the literal token text and matched none — a flow that
  previewed with one and acted with the other operated on two different row sets.
  This is the #3106 shape one layer down: the evaluator existed, only some call
  sites reached it.

  `update` and `delete` now resolve too, BEFORE the by-id fast path claims a
  scalar `where.id` (otherwise an unresolved `{current_user_id}` would be bound as
  the primary key itself). Caller options are never mutated.

- 5524f84: feat(automation): opt-in single-hop lookup expansion for record-change flow templates (#3475)

  A record-change flow can now declare `expand: ['<lookup_field>', …]` on its start
  node config so node templates resolve `{record.<lookup>.<field>}` (e.g.
  `{record.account.name}` in a notify title, closing the #3426 gap for lookups).

  The engine re-reads the declared relations AFTER identity resolution, as the
  run's OWN principal — `resolveRunDataContext` honors `runAs`, so a `runAs:'user'`
  run reads the referenced object as the **triggering user** (its RLS/FLS enforced)
  rather than system-elevated. This is what made expansion unsafe to do in the
  trigger's re-read (which has no resolved grants) and is why it lives in the
  engine (new `AutomationEngine.setRecordExpander`, bridged by the plugin to the
  same data engine the CRUD nodes use).

  Only the declared relation keys are grafted onto the run record, so bare lookup
  ids and `multiple` lookup arrays (#1872) on other relations — and the formula
  fields the trigger already hydrated — are untouched. Opt-in ⇒ zero cost when
  unused; best-effort ⇒ a re-read failure leaves the record unexpanded and never
  breaks the flow.

  The `os validate` lint rule `flow-template-lookup-traversal` (#3426/#3472) is now
  suppressed for a relation once the flow declares it in `config.expand`.

- 169b58a: fix(#3426): build-time warning for unresolvable flow template paths + guard the formula re-read

  Two follow-ups to #3426 (the formula/lookup `{record.<path>}` template gap that #3445 began closing).

  **Build-time signal (the issue's fallback ask).** `os validate` now flags a
  record-change flow node whose `{record.<path>}` template cannot resolve —
  turning the previous SILENT blank into an advisory warning. Two cases, via the
  new `@objectstack/lint` rule `validateFlowTemplatePaths`:

  - `flow-template-unknown-field` — `{record.<x>}` where `<x>` is neither a
    declared field nor a system column (a typo like `{record.full_naem}`).
  - `flow-template-lookup-traversal` — `{record.<lookup>.<field>}`, a cross-object
    hop the seeded record carries only as a scalar id (still unsupported; tracked
    on #3426).

  Deliberately quiet: formula fields, bare lookup ids, numeric indexes into
  `multiple` lookups (#1872), `json` sub-paths, and system columns are NOT flagged,
  and flows bound to an object this stack does not define are skipped (no schema to
  compare against).

  **Hydration re-read guards.** The `trigger-record-change` computed-field re-read
  (#3445) is now (a) skipped when the object declares no `formula` field — the only
  thing it adds — via the engine's optional `getObjectConfig`, and (b) memoized per
  write on the shared HookContext, so N flows on one written record share ONE
  re-read instead of N. Any uncertainty falls back to the prior unconditional
  re-read (correctness over the optimization).

- 7f4a8a1: fix(lint): flag every never-firing `record-`-prefixed trigger token, incl. `record-change` (#3427)

  Generalizes the `flow-trigger-unknown-event` rule: it now flags ANY `record-`-prefixed
  `triggerType` that is not a valid firing token
  (`record-{before,after}-{create,insert,update,delete,write}`) — not just
  `record-(before|after)-<bad-op>` typos. This closes the `record-change` trap: the
  engine routes `record-change` ("Record changed (any)") to the record-change trigger,
  which maps it to no hook so it never fires — now caught at `os validate` time instead
  of only a runtime warn. Also covers bad-phase tokens like `record-during-update`.
  Warning severity, unchanged.

- 0045682: feat(auth)!: membership grade is not a capability channel — the `sys_member.role`
  vocabulary is closed (ADR-0108, #3723)

  `sys_member.role` answers "what is your standing in this organization". It does
  not answer "what may you do" — that is what positions are for. One column was
  answering both.

  `resolve-authz-context` projects EVERY value stored in `sys_member.role` into
  `current_user.positions`, alongside the rows read from `sys_user_position`. So a
  business role handed out through the membership role _was_ capability — granted
  with none of the position system's controls: no `granted_by`, no ADR-0091
  validity window, no BU-subtree check, no `assignablePermissionSets` allowlist.
  That is what ADR-0057 D4 ruled out ("feed the names to better-auth **only** so
  invitations are accepted — **never as the authority for RBAC**"), what
  ADR-0090 D3's word ban restates (distribution = `position`), and what
  ADR-0095 D3 keeps out of the enforcement path.

  The vocabulary is therefore closed to the four framework-owned names:
  `owner` / `admin` / `delegated_admin` / `member`.

  **BREAKING — `additionalOrgRoles` is removed** from `AuthManagerOptions` and
  `AuthPluginOptions`, together with `plugin-auth/src/org-roles.ts` in full
  (`collectStackOrgRoles`, `collectRegisteredOrgRoles`,
  `normalizeAdditionalOrgRoles`, `membershipRoleOptions`,
  `withMembershipRoleOptions`, `membershipRoleLabel`, `orgRoleNames`,
  `MEMBERSHIP_ROLE_OBJECTS`, `OrgRoleDescriptor`, `OrgRoleInput`,
  `OrgRoleLogger`) and the `kernel:ready` derivation hook that fed them. From
  `@objectstack/spec`, `MEMBERSHIP_ROLE_NAME_PATTERN` and
  `MEMBERSHIP_ROLE_NAME_MIN_LENGTH` are removed — they existed only to validate
  app-supplied names. A TypeScript error is the intended failure: an option that
  is silently ignored is `declared ≠ enforced` one more time.

  FROM → TO:

  ```diff
  - new AuthPlugin({ additionalOrgRoles: ['sales_rep'] })
  + new AuthPlugin({ /* nothing — declare `sales_rep` as a position */ })

  - POST /organization/invite-member { email, role: 'sales_rep' }
  + POST /organization/invite-member { email, role: 'member',
  +                                    businessUnitId, positions: ['sales_rep'] }
  ```

  For an existing member, assign the position through `sys_user_position` (the
  governed write path). Invitation placement (ADR-0105 D8) is the one-step
  admission flow: issuance is authorized against the issuer's `adminScope` by
  dry-running `DelegatedAdminGate`, and acceptance writes real
  `sys_user_position` rows with a `granted_by` stamp. It reaches **further** than
  what it replaces — a delegated admin may use it within their subtree, where the
  membership-role route was open to org admins only (the invitation role cap holds
  anyone below admin grade to plain `member`).

  An invitation naming an app role now fails at better-auth's door with
  `ROLE_NOT_FOUND`, before any row is written.

  This reverses two changesets that were never consumed into a release
  (`app-org-roles-storable`, `auth-org-roles-self-derived`), so no published
  version ever offered the behaviour; both are removed rather than shipped and
  retracted in the same changelog. A pre-existing deployment could only have
  stored a custom value by direct DB write.

  Also derived rather than transcribed: `@objectstack/lint`'s `MEMBERSHIP_TIERS`
  now reads `BUILTIN_MEMBERSHIP_ROLES` from `@objectstack/spec`. The hand-kept
  copy carried `guest`, which the `sys_member.role` select has never offered — an
  approver authored as `{ type: 'org_membership_level', value: 'guest' }`
  resolved to nobody and the lint whose whole job is to catch that stayed silent.

- 29ff3c2: feat(lint): warn on replay-unsafe `mode: 'insert'` seed datasets (#3434 follow-up)

  Seeds are replayed — they re-load on every dev-server boot and every package
  re-publish, not applied once — so `mode: 'insert'` (the loader's one mode with
  no existing-row check) duplicates its table on every restart. That footgun
  shipped undetected until #3434 (showcase memberships grew 3 → 6 → 9).

  Adds `validateSeedReplaySafety` to `@objectstack/lint` (a pure `(stack) => Finding[]`
  rule, ADR-0019) and wires it into `os validate` / `os lint`. Every `data[]` seed
  declared with `mode: 'insert'` now gets an advisory warning that points at the
  idempotent modes (`ignore` / `upsert`) and the `externalId` to match on — a
  single natural-key field, or a COMPOSITE list of fields for a join / junction
  table with no single key (`['team', 'project']`, the support #3434 added). It
  catches the mistake at authoring time instead of on the second boot.

- 95829a0: feat(lint): warn on seed values outside an object's declared state machine (#3433 follow-up)

  #3433 exempts seed writes from the `state_machine` validation rule, so a seeded
  status the FSM does not declare is no longer rejected at write time. A field-level
  `select` still catches a value outside its `options`, but a `state_machine` on a
  free-text field — or a value that is a valid option yet not a declared FSM state —
  now sails through silently: the exemption is a deliberate but blind back door.

  `validateSeedStateMachine` (a pure `(stack) => Finding[]` rule, run from
  `os validate` / `os lint`, symmetric with the replay-safety rule from #3434)
  re-adds that safety net at author time. It flags any seed record whose
  `state_machine`-governed field carries a value outside the machine's declared
  states — the union of `initialStates`, the transition-map keys, and the transition
  targets. Advisory (`warning`): the exemption itself is legitimate, so the fix-it
  points at either adding the state to the machine or correcting the typo, not a hard
  build failure. New rule id: `seed-value-outside-state-machine`.

- 57bab76: Typed `decisionOutputs` declarations (#3447 follow-up). A `decisionOutputs` entry may now be `{ key, label?, type: 'text' | 'user' | 'department' | 'position' | 'team', multiple? }` alongside the bare-string form — a typed entry tells the decision UI to render the matching record picker (id values; `multiple` collects an id array) instead of free text, turning "paste user ids" into "pick people". The type shapes only the input widget: the runtime whitelist works by `key` either way, via the new `normalizeDecisionOutputs` helper exported from `@objectstack/spec/automation` — the single reader of the union shape shared by the service, the request read, and `os lint`. The request read now carries `decision_output_defs` (normalized declarations) alongside the version-skew-safe `decision_outputs` key list.
- Updated dependencies [50616d9]
- Updated dependencies [08b5a3d]
- Updated dependencies [d99aeb3]
- Updated dependencies [4727eb8]
- Updated dependencies [f63cd09]
- Updated dependencies [fa3d0cf]
- Updated dependencies [af5a224]
- Updated dependencies [71f76e1]
- Updated dependencies [37b1346]
- Updated dependencies [99736a0]
- Updated dependencies [fe67e34]
- Updated dependencies [fdb4f50]
- Updated dependencies [1bd5652]
- Updated dependencies [14252d3]
- Updated dependencies [7fb436c]
- Updated dependencies [879ea13]
- Updated dependencies [201b31f]
- Updated dependencies [e2616e0]
- Updated dependencies [6fdc5c6]
- Updated dependencies [8b9d71e]
- Updated dependencies [33f5e23]
- Updated dependencies [259af21]
- Updated dependencies [587fc91]
- Updated dependencies [1986594]
- Updated dependencies [ad4af62]
- Updated dependencies [d44dbfa]
- Updated dependencies [474fe39]
- Updated dependencies [0bc685a]
- Updated dependencies [b949059]
- Updated dependencies [be1c52c]
- Updated dependencies [c5ff96d]
- Updated dependencies [84e7be9]
- Updated dependencies [a6c3f38]
- Updated dependencies [debc23a]
- Updated dependencies [0f8ad09]
- Updated dependencies [8f9689f]
- Updated dependencies [57a3bb3]
- Updated dependencies [5f9a987]
- Updated dependencies [db02d47]
- Updated dependencies [0bfdf46]
- Updated dependencies [376a061]
- Updated dependencies [7c7e246]
- Updated dependencies [f35cdc5]
- Updated dependencies [9ea2bc5]
- Updated dependencies [c2d9098]
- Updated dependencies [a227ed7]
- Updated dependencies [9613396]
- Updated dependencies [e47b342]
- Updated dependencies [4ed7ed4]
- Updated dependencies [2fa4ca1]
- Updated dependencies [f5a2320]
- Updated dependencies [deb538f]
- Updated dependencies [5b89711]
- Updated dependencies [0c8a22f]
- Updated dependencies [763931e]
- Updated dependencies [de9af8a]
- Updated dependencies [c4df271]
- Updated dependencies [a41ba5c]
- Updated dependencies [189854c]
- Updated dependencies [0e3a226]
- Updated dependencies [1d4756e]
- Updated dependencies [720c5ad]
- Updated dependencies [a8d1e24]
- Updated dependencies [41642b0]
- Updated dependencies [4cca74c]
- Updated dependencies [88ef03e]
- Updated dependencies [9e2caf3]
- Updated dependencies [81ce41a]
- Updated dependencies [85e1e4e]
- Updated dependencies [dac6a08]
- Updated dependencies [394b7a1]
- Updated dependencies [677b591]
- Updated dependencies [d77d1b7]
- Updated dependencies [5b79a34]
- Updated dependencies [c757854]
- Updated dependencies [0045682]
- Updated dependencies [2a5f04a]
- Updated dependencies [4f740b0]
- Updated dependencies [67452d1]
- Updated dependencies [0fc6219]
- Updated dependencies [605e190]
- Updated dependencies [c6c59f1]
- Updated dependencies [b0e78a8]
- Updated dependencies [f31cc8d]
- Updated dependencies [f343dc4]
- Updated dependencies [8269e32]
- Updated dependencies [74f7339]
- Updated dependencies [a6c35a2]
- Updated dependencies [c2f1002]
- Updated dependencies [f163028]
- Updated dependencies [f07808c]
- Updated dependencies [7ffc3d3]
- Updated dependencies [88346ba]
- Updated dependencies [4631592]
- Updated dependencies [32ff033]
- Updated dependencies [5ac93d4]
- Updated dependencies [93f267f]
- Updated dependencies [0024abf]
- Updated dependencies [acbf364]
- Updated dependencies [7687f7b]
- Updated dependencies [1659072]
- Updated dependencies [abceb0d]
- Updated dependencies [0c302a7]
- Updated dependencies [6633337]
- Updated dependencies [f00d8d4]
- Updated dependencies [503be86]
- Updated dependencies [cde1975]
- Updated dependencies [0bc685a]
- Updated dependencies [11949fc]
- Updated dependencies [b098b0e]
- Updated dependencies [4d00b13]
- Updated dependencies [57bab76]
- Updated dependencies [b90086a]
- Updated dependencies [b95577a]
- Updated dependencies [83c161f]
- Updated dependencies [d8c4957]
- Updated dependencies [f24cb83]
- Updated dependencies [5dbbb92]
- Updated dependencies [69f1dfd]
  - @objectstack/spec@17.0.0-rc.0
  - @objectstack/formula@17.0.0-rc.0
  - @objectstack/sdui-parser@17.0.0-rc.0

## 16.1.0

### Minor Changes

- fa006fb: Validate dashboard filter field-existence at build time (extend ADR-0021, #3365).

  `validateWidgetBindings` now checks that every dashboard-level filter (`dateRange`

  - each `globalFilters[]`) resolves to a real field on each bound widget's dataset
    object. Since #2501 wired these filters into every widget's analytics query, a
    filter field absent on a widget's object — e.g. a `dateRange` bound to
    `close_date` inherited by an account/contact widget over a different object —
    emitted invalid SQL (`no such column: close_date`) and crashed the widget at
    render time. That build-decidable invariant previously escaped `os validate` /
    `os build` and failed only when a user opened the dashboard.

  It now fails the build (new rule `dashboard-filter-field-unknown`) with a message
  naming the dashboard, widget, filter, field, and object, unless the widget opts
  out via `filterBindings: { <name>: false }` or re-targets to an existing field —
  mirroring the field-existence invariant ADR-0032 enforces for CEL references.
  Effective-field resolution matches the runtime (`filterBindings` re-target /
  opt-out, legacy `targetWidgets` allow-list, filter default). Registry-injected
  system fields (e.g. `created_at`, the `dateRange` default) and objects outside
  the validated stack never false-positive.

- db160dd: Flag dead action/route references in dashboard header & widget actions (ADR-0049 for references, #3367).

  `os validate` / `os build` now run a new `validateDashboardActionRefs` gate over every dashboard `header.actions[]` and widget `actionUrl`:

  - `actionType: 'script' | 'modal'` — **error** unless `actionUrl` resolves to a defined action (`stack.actions` or an object's `actions`). `modal` also resolves via the runtime `<verb>_<object>` convention (`create_/new_/add_/edit_/update_` + a real object) and bare object names. A dangling target ships a button that renders and silently does nothing on click — a false affordance, exactly the "declared ≠ enforced" gap ADR-0049 closes, applied to references.
  - `actionType: 'url'` — **warning** when a relative in-app path names a `objects/reports/dashboards/pages/views` route whose target does not exist in the stack. External URLs, interpolated (`${…}`) targets, and opaque routes are skipped to keep false positives near zero.

### Patch Changes

- Updated dependencies [9e45b63]
  - @objectstack/spec@16.1.0
  - @objectstack/formula@16.1.0
  - @objectstack/sdui-parser@16.1.0

## 16.0.0

### Minor Changes

- 3a18b60: feat(approvals): rename the `role` approver type to `org_membership_level` (#3133)

  `ApproverType.role` was the last platform surface projecting the reserved word
  "role" (ADR-0090 D3). It is not covered by D3's better-auth exception: that
  exception protects better-auth's own `sys_member.role` **column**, which we do
  not own — `ApproverType` is our own enum, an authoring surface, and D3 mandates
  that the projection of that concept is spelled `org_membership_level` and
  labelled "organization membership", **never "role"**.

  The sentence licensing the leak was also false: ADR-0090 D3 claims
  `sys_member.role` is "already relabelled `org_membership_level` in the platform
  projection", but `org_membership_level` existed nowhere in the codebase and
  ADR-0057 D7 lists that relabel under "Deferred (evidence-gated, P4)". The
  projection never landed, so the word reached authors.

  The name manufactured a real, silent failure — "hotcrm class": every other
  surface renamed to `position` (`sys_role`, `ShareRecipientType.role`,
  `ctx.roles[]`), so `{ type: 'role', value: 'sales_manager' }` reads as the
  legacy spelling of a position. It resolves against the membership tier, finds
  no member row, falls back to an inert `role:sales_manager` literal, and the
  request waits forever on an approver that cannot exist.

  - **spec**: `ApproverType` gains `org_membership_level`; `role` stays as a
    deprecated alias for one window (a published 15.x flow keeps loading) with
    `DEPRECATED_APPROVER_TYPES` + `canonicalApproverType()` as the single source
    for the mapping. Removed in the next major.
  - **plugin-approvals**: resolves on the canonical type and warns on the
    deprecated spelling. The `type:value` fallback literal keeps the **authored**
    spelling — stored `sys_approval_approver` rows and `pending_approvers` slots
    from 15.x carry `role:<v>`, and rewriting it would orphan them.
  - **lint**: `approval-role-not-membership-tier` → `approval-approver-not-membership-tier`
    (the rule id carried the reserved word too), plus a new
    `approval-approver-type-deprecated`. The two are mutually exclusive: a bad
    _value_ wins, because prescribing `org_membership_level` for a position name
    would be wrong advice — the fix there is `position`.

  Authoring `type: 'role'` keeps working and now says so out loud. Rewrite it as
  `org_membership_level`; if the value is an org position, the fix is `position`.

- 2ea08ee: Flow trigger observability — kill the four-layer silence around record-change flows that never fire (2026-07-17 third-party eval).

  A misauthored auto-launched flow (wrong `objectName`, missing `requires: ['automation','triggers']`, failing start condition) produced ZERO output at every layer: the engine's own registration/binding logs land inside the CLI's boot-quiet stdout window (which swallows debug/info/warn — only error/fatal reach stderr), and each "didn't happen" path was itself silent. Fixes:

  - **Startup banner `Flows:` section** (`os serve`/`os dev`/`os start`): flow count, bound-to-trigger count, registered trigger types, draft count — plus loud `⚠` lines for flows declared with no automation engine enabled (`requires` missing), flows whose trigger type has no registered trigger, and bound record-change flows targeting an unknown object (dead binding). Printed after stdout is restored, so it is immune to the boot-quiet window.
  - **Trigger-fired run failures now log at ERROR** (stderr — always visible): the automation engine no longer drops the AutomationResult of a trigger-fired execution; condition-evaluation faults and node failures surface with the flow name. Condition-not-met skips stay at debug (high-frequency, intentional).
  - **`RecordChangeTrigger` probes object existence at bind time** and warns when a flow's `objectName` matches no registered object (exact-name matching), instead of silently arming a hook that can never fire.
  - **`kernel:bootstrapped` binding audit** in the automation plugin: warns per enabled-but-unbound triggered flow with the reason, and reports registered/bound/draft counts (`AutomationEngine.getTriggerBindingAudit()`, extended `getFlowRuntimeStates()` with `status`/`triggerType`/`object`).
  - **`os validate` flow-wiring advisories** (`@objectstack/lint` `validateFlowTriggerReadiness`): warns when a record-triggered flow targets an object the stack does not define, and when an auto-triggered flow's status is `draft` (authored or defaulted — draft flows still fire; declare `active` or `obsolete`).
  - Removed leftover boot-debug writes (`registerApp`/`AppPlugin`/`StandaloneStack`/`AuditPlugin` stderr noise) that previous debugging of this same silence had left behind.

- ea32ec7: feat(formula,lint): advisory type-soundness warnings for formula/predicate expressions (#1928 tier 4)

  Closes the last open guardrail from #1928. A `Field.formula` or record-scoped
  predicate that uses a **text or boolean field with an arithmetic (`+ - * / %`)
  or ordering (`< > <= >=`) operator against a number** faults the runtime
  overload and silently evaluates to `null` (e.g. `record.title * 2`,
  `record.is_active + 1`). The build now surfaces this as a **non-blocking
  warning** with the offending field and a corrective message.

  Honours the ADR-0032 design law — the checker only flags what the runtime
  would also fail:

  - Number / currency / percent / date / datetime fields are declared `dyn`, so
    the cases the runtime rescues never warn — `record.amount / 100` (the #1930
    `registerOperator` fix), `record.due == today()` and numeric-string / ISO-date
    values (the string-hydration retry), and numeric-coded `select` option values.
  - Equality (`==` / `!=`) is excluded: a heterogeneous equality is runtime-safe
    (evaluates to `false`), never a fault.

  New `firstTypeMismatch(source, fieldCelTypes, scope)` export in
  `@objectstack/formula` (and an optional `fieldTypes` hint on
  `validateExpression`); `@objectstack/lint`'s `validateStackExpressions` threads
  each object's field types into every checked site:

  - **record-scoped** sites (`record.<field>`) — formula fields, validation rules,
    action / hook / sharing predicates;
  - **flattened** flow / automation conditions (bare `field`) — where flow
    variables stay `dyn` and are never flagged, and equality stays runtime-safe.

  Warnings are advisory in `objectstack build` / `validate` (fatal only under
  `--strict`), matching the tier-3 channel.

- a2795f6: feat(triggers): declarative time-relative trigger — daily sweep instead of fragile date-equality (#1874)

  Time-relative business rules ("alert 60 days before a contract's `end_date`")
  could only be expressed as a `record_change` flow gated on a date-equality
  condition like `end_date == daysFromNow(60)`. That predicate is only evaluated
  when the record _happens to change_, so it fires only if a record is edited on
  exactly the threshold day — i.e. almost never, unattended. The robust
  alternative was a hand-written cron + range query that every author
  re-implemented (contracts `renewal_alert`, hr `document_expiring_soon`,
  procurement `po_overdue`, …).

  A flow's start node can now declare a `timeRelative` descriptor instead:

  ```ts
  config: {
    timeRelative: {
      object: 'contracts',
      dateField: 'end_date',
      offsetDays: [60, 30, 7],      // T-minus reminders — fires on each threshold day
      // — or — withinDays: 30      // "expiring soon" range; negative = overdue lookback
      filter: { status: 'active' }, // optional, ANDed with the date window
    },
    schedule: { type: 'cron', expression: '0 8 * * *' }, // optional; defaults to daily 08:00 UTC
  }
  ```

  The new `time_relative` trigger (shipped in `@objectstack/trigger-schedule` as
  `TimeRelativeTriggerPlugin`) sweeps the object on that schedule and launches the
  flow **once per matching record**, with the record on the automation context —
  so the start-node `condition` gate and `{record.<field>}` interpolation work
  exactly as for a record-change flow. Because the window is evaluated every day,
  a threshold is never missed regardless of when the record last changed. The
  discovery query runs as a system operation (RLS-bypassing) and is capped
  (`maxRecords`, default 1000) so a mis-scoped window can't fan out unboundedly;
  per-record failures are isolated so one bad row never aborts the sweep.

  The automation engine routes a start node carrying `config.timeRelative` to the
  `time_relative` trigger (ahead of the plain `schedule` trigger, whose behavior is
  unchanged), and `os validate` gains readiness checks for the new descriptor
  (unknown swept object, ambiguous draft status). New authorable spec key:
  `TimeRelativeTriggerSchema` (`@objectstack/spec/automation`).

### Patch Changes

- 524696a: feat(spec)!: `DashboardWidgetSchema.strict()` — reject undeclared widget keys (framework#3251)

  The ADR-0021 analytics endpoint. `DashboardWidgetSchema` now rejects any
  undeclared top-level key instead of silently stripping it, moving a whole class
  of author error (a hallucinated or legacy key that renders as a silent no-op)
  from fallible human review to deterministic CI. `options: z.unknown()` remains
  the escape hatch for renderer-specific extras.

  A custom error map names the offending key(s) and, when a key is a removed
  pre-ADR-0021 inline-analytics key (`object` / `categoryField` / `valueField` /
  `aggregate`, pivot `rowField` / `columnField`) or an objectui-internal prop
  (`component`, inline `data`), points the author at the dataset shape
  (`dataset` + `dimensions` + `values`).

  Recorded as protocol-16 migration `step16`
  (`dashboard-widget-strict-unknown-keys`), mirroring protocol-15's `step15`
  strict flip on the form/page schemas (ADR-0089 D3a). The inline-analytics shape
  itself was already removed at protocol 9 (single-form cutover), so there is no
  mechanical rewrite — the residue is the strictness, delegated to the author.

  **Breaking:** shipped as `minor` per the launch-window policy (a breaking change
  does not burn a major while the stack is in lockstep), riding the already-pending
  16.0.0 train. The release train's Version-Packages PR must set
  `PROTOCOL_VERSION = '16.0.0'`; until then `step16` is inert
  (`composeMigrationChain` caps at `PROTOCOL_MAJOR`).

  `@objectstack/lint` — the `widget-legacy-analytics-shape` /
  `widget-legacy-analytics-unrenderable` rules are retained as the friendly,
  suppressible bridge on the raw-config lint/doctor paths (strict preempts them on
  the schema-parsed compile/validate paths); doc comment updated to explain the
  interplay.

- 8923843: Reject view containers that define no views. A flat list-view object (`{ name, label, type, columns, ... }`) parses to an empty `ViewSchema` container because Zod strips unknown keys — zero views register and the Console silently renders nothing. `defineView()` now throws on a zero-view container, and `os validate` gains a `view-container-shape` check (`validateViewContainers` in `@objectstack/lint`) that reports flat or empty `views: []` entries pre-parse with a wrap-it fix hint.
- Updated dependencies [f972574]
- Updated dependencies [6289ec3]
- Updated dependencies [22013aa]
- Updated dependencies [3ad3dd5]
- Updated dependencies [8efa395]
- Updated dependencies [3a18b60]
- Updated dependencies [a8aa34c]
- Updated dependencies [a3823b2]
- Updated dependencies [43a3efb]
- Updated dependencies [524696a]
- Updated dependencies [6b51346]
- Updated dependencies [80273c8]
- Updated dependencies [bfa3c3f]
- Updated dependencies [5e3301d]
- Updated dependencies [46e876c]
- Updated dependencies [7125007]
- Updated dependencies [158aa14]
- Updated dependencies [62a2117]
- Updated dependencies [d2723e2]
- Updated dependencies [fefcd54]
- Updated dependencies [beaf2de]
- Updated dependencies [369eb6e]
- Updated dependencies [06ff734]
- Updated dependencies [b659111]
- Updated dependencies [5754a23]
- Updated dependencies [6c270a6]
- Updated dependencies [668dd17]
- Updated dependencies [8abf133]
- Updated dependencies [e0859b1]
- Updated dependencies [04ecd4e]
- Updated dependencies [4d5a892]
- Updated dependencies [16cebeb]
- Updated dependencies [86d30af]
- Updated dependencies [8923843]
- Updated dependencies [ea32ec7]
- Updated dependencies [a2795f6]
- Updated dependencies [f16b492]
- Updated dependencies [4b6fde8]
- Updated dependencies [2018df9]
- Updated dependencies [fc5a3a2]
- Updated dependencies [8ff9210]
  - @objectstack/spec@16.0.0
  - @objectstack/formula@16.0.0
  - @objectstack/sdui-parser@16.0.0

## 16.0.0-rc.1

### Patch Changes

- Updated dependencies [6289ec3]
- Updated dependencies [8efa395]
- Updated dependencies [bfa3c3f]
- Updated dependencies [7125007]
- Updated dependencies [62a2117]
- Updated dependencies [06ff734]
  - @objectstack/spec@16.0.0-rc.1
  - @objectstack/formula@16.0.0-rc.1
  - @objectstack/sdui-parser@16.0.0-rc.1

## 16.0.0-rc.0

### Minor Changes

- 3a18b60: feat(approvals): rename the `role` approver type to `org_membership_level` (#3133)

  `ApproverType.role` was the last platform surface projecting the reserved word
  "role" (ADR-0090 D3). It is not covered by D3's better-auth exception: that
  exception protects better-auth's own `sys_member.role` **column**, which we do
  not own — `ApproverType` is our own enum, an authoring surface, and D3 mandates
  that the projection of that concept is spelled `org_membership_level` and
  labelled "organization membership", **never "role"**.

  The sentence licensing the leak was also false: ADR-0090 D3 claims
  `sys_member.role` is "already relabelled `org_membership_level` in the platform
  projection", but `org_membership_level` existed nowhere in the codebase and
  ADR-0057 D7 lists that relabel under "Deferred (evidence-gated, P4)". The
  projection never landed, so the word reached authors.

  The name manufactured a real, silent failure — "hotcrm class": every other
  surface renamed to `position` (`sys_role`, `ShareRecipientType.role`,
  `ctx.roles[]`), so `{ type: 'role', value: 'sales_manager' }` reads as the
  legacy spelling of a position. It resolves against the membership tier, finds
  no member row, falls back to an inert `role:sales_manager` literal, and the
  request waits forever on an approver that cannot exist.

  - **spec**: `ApproverType` gains `org_membership_level`; `role` stays as a
    deprecated alias for one window (a published 15.x flow keeps loading) with
    `DEPRECATED_APPROVER_TYPES` + `canonicalApproverType()` as the single source
    for the mapping. Removed in the next major.
  - **plugin-approvals**: resolves on the canonical type and warns on the
    deprecated spelling. The `type:value` fallback literal keeps the **authored**
    spelling — stored `sys_approval_approver` rows and `pending_approvers` slots
    from 15.x carry `role:<v>`, and rewriting it would orphan them.
  - **lint**: `approval-role-not-membership-tier` → `approval-approver-not-membership-tier`
    (the rule id carried the reserved word too), plus a new
    `approval-approver-type-deprecated`. The two are mutually exclusive: a bad
    _value_ wins, because prescribing `org_membership_level` for a position name
    would be wrong advice — the fix there is `position`.

  Authoring `type: 'role'` keeps working and now says so out loud. Rewrite it as
  `org_membership_level`; if the value is an org position, the fix is `position`.

- 2ea08ee: Flow trigger observability — kill the four-layer silence around record-change flows that never fire (2026-07-17 third-party eval).

  A misauthored auto-launched flow (wrong `objectName`, missing `requires: ['automation','triggers']`, failing start condition) produced ZERO output at every layer: the engine's own registration/binding logs land inside the CLI's boot-quiet stdout window (which swallows debug/info/warn — only error/fatal reach stderr), and each "didn't happen" path was itself silent. Fixes:

  - **Startup banner `Flows:` section** (`os serve`/`os dev`/`os start`): flow count, bound-to-trigger count, registered trigger types, draft count — plus loud `⚠` lines for flows declared with no automation engine enabled (`requires` missing), flows whose trigger type has no registered trigger, and bound record-change flows targeting an unknown object (dead binding). Printed after stdout is restored, so it is immune to the boot-quiet window.
  - **Trigger-fired run failures now log at ERROR** (stderr — always visible): the automation engine no longer drops the AutomationResult of a trigger-fired execution; condition-evaluation faults and node failures surface with the flow name. Condition-not-met skips stay at debug (high-frequency, intentional).
  - **`RecordChangeTrigger` probes object existence at bind time** and warns when a flow's `objectName` matches no registered object (exact-name matching), instead of silently arming a hook that can never fire.
  - **`kernel:bootstrapped` binding audit** in the automation plugin: warns per enabled-but-unbound triggered flow with the reason, and reports registered/bound/draft counts (`AutomationEngine.getTriggerBindingAudit()`, extended `getFlowRuntimeStates()` with `status`/`triggerType`/`object`).
  - **`os validate` flow-wiring advisories** (`@objectstack/lint` `validateFlowTriggerReadiness`): warns when a record-triggered flow targets an object the stack does not define, and when an auto-triggered flow's status is `draft` (authored or defaulted — draft flows still fire; declare `active` or `obsolete`).
  - Removed leftover boot-debug writes (`registerApp`/`AppPlugin`/`StandaloneStack`/`AuditPlugin` stderr noise) that previous debugging of this same silence had left behind.

- ea32ec7: feat(formula,lint): advisory type-soundness warnings for formula/predicate expressions (#1928 tier 4)

  Closes the last open guardrail from #1928. A `Field.formula` or record-scoped
  predicate that uses a **text or boolean field with an arithmetic (`+ - * / %`)
  or ordering (`< > <= >=`) operator against a number** faults the runtime
  overload and silently evaluates to `null` (e.g. `record.title * 2`,
  `record.is_active + 1`). The build now surfaces this as a **non-blocking
  warning** with the offending field and a corrective message.

  Honours the ADR-0032 design law — the checker only flags what the runtime
  would also fail:

  - Number / currency / percent / date / datetime fields are declared `dyn`, so
    the cases the runtime rescues never warn — `record.amount / 100` (the #1930
    `registerOperator` fix), `record.due == today()` and numeric-string / ISO-date
    values (the string-hydration retry), and numeric-coded `select` option values.
  - Equality (`==` / `!=`) is excluded: a heterogeneous equality is runtime-safe
    (evaluates to `false`), never a fault.

  New `firstTypeMismatch(source, fieldCelTypes, scope)` export in
  `@objectstack/formula` (and an optional `fieldTypes` hint on
  `validateExpression`); `@objectstack/lint`'s `validateStackExpressions` threads
  each object's field types into every checked site:

  - **record-scoped** sites (`record.<field>`) — formula fields, validation rules,
    action / hook / sharing predicates;
  - **flattened** flow / automation conditions (bare `field`) — where flow
    variables stay `dyn` and are never flagged, and equality stays runtime-safe.

  Warnings are advisory in `objectstack build` / `validate` (fatal only under
  `--strict`), matching the tier-3 channel.

- a2795f6: feat(triggers): declarative time-relative trigger — daily sweep instead of fragile date-equality (#1874)

  Time-relative business rules ("alert 60 days before a contract's `end_date`")
  could only be expressed as a `record_change` flow gated on a date-equality
  condition like `end_date == daysFromNow(60)`. That predicate is only evaluated
  when the record _happens to change_, so it fires only if a record is edited on
  exactly the threshold day — i.e. almost never, unattended. The robust
  alternative was a hand-written cron + range query that every author
  re-implemented (contracts `renewal_alert`, hr `document_expiring_soon`,
  procurement `po_overdue`, …).

  A flow's start node can now declare a `timeRelative` descriptor instead:

  ```ts
  config: {
    timeRelative: {
      object: 'contracts',
      dateField: 'end_date',
      offsetDays: [60, 30, 7],      // T-minus reminders — fires on each threshold day
      // — or — withinDays: 30      // "expiring soon" range; negative = overdue lookback
      filter: { status: 'active' }, // optional, ANDed with the date window
    },
    schedule: { type: 'cron', expression: '0 8 * * *' }, // optional; defaults to daily 08:00 UTC
  }
  ```

  The new `time_relative` trigger (shipped in `@objectstack/trigger-schedule` as
  `TimeRelativeTriggerPlugin`) sweeps the object on that schedule and launches the
  flow **once per matching record**, with the record on the automation context —
  so the start-node `condition` gate and `{record.<field>}` interpolation work
  exactly as for a record-change flow. Because the window is evaluated every day,
  a threshold is never missed regardless of when the record last changed. The
  discovery query runs as a system operation (RLS-bypassing) and is capped
  (`maxRecords`, default 1000) so a mis-scoped window can't fan out unboundedly;
  per-record failures are isolated so one bad row never aborts the sweep.

  The automation engine routes a start node carrying `config.timeRelative` to the
  `time_relative` trigger (ahead of the plain `schedule` trigger, whose behavior is
  unchanged), and `os validate` gains readiness checks for the new descriptor
  (unknown swept object, ambiguous draft status). New authorable spec key:
  `TimeRelativeTriggerSchema` (`@objectstack/spec/automation`).

### Patch Changes

- 524696a: feat(spec)!: `DashboardWidgetSchema.strict()` — reject undeclared widget keys (framework#3251)

  The ADR-0021 analytics endpoint. `DashboardWidgetSchema` now rejects any
  undeclared top-level key instead of silently stripping it, moving a whole class
  of author error (a hallucinated or legacy key that renders as a silent no-op)
  from fallible human review to deterministic CI. `options: z.unknown()` remains
  the escape hatch for renderer-specific extras.

  A custom error map names the offending key(s) and, when a key is a removed
  pre-ADR-0021 inline-analytics key (`object` / `categoryField` / `valueField` /
  `aggregate`, pivot `rowField` / `columnField`) or an objectui-internal prop
  (`component`, inline `data`), points the author at the dataset shape
  (`dataset` + `dimensions` + `values`).

  Recorded as protocol-16 migration `step16`
  (`dashboard-widget-strict-unknown-keys`), mirroring protocol-15's `step15`
  strict flip on the form/page schemas (ADR-0089 D3a). The inline-analytics shape
  itself was already removed at protocol 9 (single-form cutover), so there is no
  mechanical rewrite — the residue is the strictness, delegated to the author.

  **Breaking:** shipped as `minor` per the launch-window policy (a breaking change
  does not burn a major while the stack is in lockstep), riding the already-pending
  16.0.0 train. The release train's Version-Packages PR must set
  `PROTOCOL_VERSION = '16.0.0'`; until then `step16` is inert
  (`composeMigrationChain` caps at `PROTOCOL_MAJOR`).

  `@objectstack/lint` — the `widget-legacy-analytics-shape` /
  `widget-legacy-analytics-unrenderable` rules are retained as the friendly,
  suppressible bridge on the raw-config lint/doctor paths (strict preempts them on
  the schema-parsed compile/validate paths); doc comment updated to explain the
  interplay.

- 8923843: Reject view containers that define no views. A flat list-view object (`{ name, label, type, columns, ... }`) parses to an empty `ViewSchema` container because Zod strips unknown keys — zero views register and the Console silently renders nothing. `defineView()` now throws on a zero-view container, and `os validate` gains a `view-container-shape` check (`validateViewContainers` in `@objectstack/lint`) that reports flat or empty `views: []` entries pre-parse with a wrap-it fix hint.
- Updated dependencies [f972574]
- Updated dependencies [22013aa]
- Updated dependencies [3ad3dd5]
- Updated dependencies [3a18b60]
- Updated dependencies [a8aa34c]
- Updated dependencies [a3823b2]
- Updated dependencies [43a3efb]
- Updated dependencies [524696a]
- Updated dependencies [6b51346]
- Updated dependencies [80273c8]
- Updated dependencies [5e3301d]
- Updated dependencies [46e876c]
- Updated dependencies [158aa14]
- Updated dependencies [d2723e2]
- Updated dependencies [fefcd54]
- Updated dependencies [beaf2de]
- Updated dependencies [369eb6e]
- Updated dependencies [b659111]
- Updated dependencies [5754a23]
- Updated dependencies [6c270a6]
- Updated dependencies [668dd17]
- Updated dependencies [8abf133]
- Updated dependencies [e0859b1]
- Updated dependencies [04ecd4e]
- Updated dependencies [4d5a892]
- Updated dependencies [16cebeb]
- Updated dependencies [86d30af]
- Updated dependencies [8923843]
- Updated dependencies [ea32ec7]
- Updated dependencies [a2795f6]
- Updated dependencies [f16b492]
- Updated dependencies [4b6fde8]
- Updated dependencies [2018df9]
- Updated dependencies [fc5a3a2]
  - @objectstack/spec@16.0.0-rc.0
  - @objectstack/formula@16.0.0-rc.0
  - @objectstack/sdui-parser@16.0.0-rc.0

## 15.1.1

### Patch Changes

- @objectstack/spec@15.1.1
- @objectstack/formula@15.1.1
- @objectstack/sdui-parser@15.1.1

## 15.1.0

### Patch Changes

- f531a26: ADR-0085 #2548 follow-ups surfaced by the real-backend browser pass:

  - **lint**: new `field-group-shadowed` warning in `validate-semantic-roles` — a
    declared fieldGroup whose every visible member is hoisted into the detail
    highlight strip (or is the record title) renders on forms but silently never
    on detail pages (detail bodies hide the first 4 highlightFields). Warning
    tier, same as the other semantic-role rules.
  - **plugin-audit**: feed/audit summaries ("Created … / Deleted … / Updated …")
    now name the object by its display label ("Semantic Zoo") instead of its API
    name ("showcase_semantic_zoo") — these strings render verbatim in the record
    Discussion feed and Setup dashboards. Falls back to the API name when the
    object definition isn't resolvable. Existing stored rows are unchanged.

- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [3fe9df1]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [4109153]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [627f225]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
  - @objectstack/spec@15.1.0
  - @objectstack/formula@15.1.0
  - @objectstack/sdui-parser@15.1.0

## 15.0.0

### Minor Changes

- 891ea81: ADR-0089 D3b: make the `visibility-root-mislayered` lint check bidirectional. `validateVisibilityPredicates` now accepts an optional `{ layer }` option — `'runtime'` (default, unchanged) flags a `data.`-rooted predicate on a `*.view.ts` / `*.page.ts` surface, and `'metadata'` flags a `record.`-rooted predicate on a `*.form.ts` metadata-editing form. Both directions of the ADR's binding-root rule are now covered. Adds the `VisibilityLayer` / `VisibilityOptions` exported types. Fully back-compat: existing single-argument callers keep the runtime behavior.
- e62c233: feat(spec,plugin-security): package-level capability declaration API (ADR-0066 D1)

  Packages can now DEFINE their own authorization capabilities explicitly via the
  new `defineCapability` factory and a stack's `capabilities` array, instead of
  relying on the implicit "derive an untitled capability from whatever a permission
  set references in `systemPermissions[]`" back-door.

  - `@objectstack/spec`: new `defineCapability` / `CapabilityDeclarationSchema`
    (`{ name, label?, description?, scope, packageId? }`) and a `capabilities`
    field on the stack definition.
  - `@objectstack/plugin-security`: new `bootstrapDeclaredCapabilities` seeds
    declared capabilities into `sys_capability` with `managed_by:'package'` +
    `package_id` provenance (new `package_id` field on the object). Idempotent,
    upgrade-aware; refuses to hijack curated platform capabilities or another
    package's rows, never clobbers admin-authored rows, and CLAIMS a pre-existing
    derived placeholder (upgrading it to package provenance). The implicit
    derive-from-`systemPermissions` path still runs for back-compat but now skips
    any explicitly-declared name so it can't clobber authored metadata.
  - `@objectstack/runtime`: stack-declared `capabilities` are registered into the
    metadata registry (type `capability`) so the boot seeder can read them.
  - `@objectstack/lint`: `validateCapabilityReferences` treats
    `stack.capabilities` names as a known capability source.

  A capability is not a contract: DEFINE it (`defineCapability`), GRANT it
  (`systemPermissions`), REQUIRE it (`requiredPermissions`) — no `inputs`.
  Aligns with ADR-0094 D5 (retire implicit `managed_by`-guessing back-doors).

### Patch Changes

- Updated dependencies [28b7c28]
- Updated dependencies [13749ec]
- Updated dependencies [e62c233]
- Updated dependencies [ed61c9b]
- Updated dependencies [31d04d4]
  - @objectstack/spec@15.0.0
  - @objectstack/formula@15.0.0
  - @objectstack/sdui-parser@15.0.0

## 14.8.0

### Minor Changes

- 10e8983: ADR-0089 D3b: add the `validateVisibilityPredicates` lint rule for conditional-visibility keys, wired into `os validate` and `os compile` as advisory warnings.

  Two rules, both `warning` (never fail the build):

  - `visibility-alias-deprecated` — a `visibleOn` (view form section/field) or `visibility` (page component) key in authored source. It still works — the schema normalizes it to `visibleWhen` at parse — but the canonical key is `visibleWhen`. Fix: rename the key (same CEL value).
  - `visibility-root-mislayered` — a runtime view/page visibility predicate rooted at `data.` (the metadata-editing-form root). Runtime record surfaces bind `record` + `current_user` (pages also expose `page.<var>`), so a `data.`-rooted predicate here never matches and the element renders unconditionally. Fix: use `record.`/`page.`.

  The rule runs on the **pre-parse** stack (like `validate-list-view-mode`) so it can see the deprecated alias the author actually wrote before the schema folds it into `visibleWhen`.

### Patch Changes

- Updated dependencies [16b4bf6]
- Updated dependencies [16b4bf6]
- Updated dependencies [10e8983]
- Updated dependencies [607aaf4]
- Updated dependencies [bb71321]
  - @objectstack/spec@14.8.0
  - @objectstack/formula@14.8.0
  - @objectstack/sdui-parser@14.8.0

## 14.7.0

### Patch Changes

- Updated dependencies [d6a72eb]
  - @objectstack/spec@14.7.0
  - @objectstack/formula@14.7.0
  - @objectstack/sdui-parser@14.7.0

## 14.6.0

### Patch Changes

- Updated dependencies [609cb13]
- Updated dependencies [ce6d151]
  - @objectstack/spec@14.6.0
  - @objectstack/formula@14.6.0
  - @objectstack/sdui-parser@14.6.0

## 14.5.0

### Patch Changes

- Updated dependencies [526805e]
- Updated dependencies [d79ca07]
- Updated dependencies [33ebd34]
- Updated dependencies [c044f08]
- Updated dependencies [01274eb]
  - @objectstack/spec@14.5.0
  - @objectstack/formula@14.5.0
  - @objectstack/sdui-parser@14.5.0

## 14.4.0

### Minor Changes

- 82e745e: ADR-0091 L1 — grant validity windows: effective-dated assignments, resolution-time filtering, explain expired state, authoring lint.

  - **plugin-security (objects)**: `sys_user_position` and `sys_user_permission_set` gain the D1 lifecycle columns — `valid_from`, `valid_until` (half-open `[from, until)`, UTC; null = unbounded, existing rows unchanged), `reason`, `delegated_from`, `last_certified_at`, `certified_by`.
  - **core**: new shared predicate `isGrantActive` / `isGrantExpired` (`@objectstack/core`), and `resolveAuthzContext` now filters BOTH grant tables through it (D2, fail-closed — an expired unscoped `admin_full_access` grant no longer derives `platform_admin`). Present-but-unparseable bounds fail closed.
  - **plugin-security (explain)**: `buildContextForUser` applies the same filter and returns `expiredGrants`; the principal layer reports the dedicated "held until … — expired" contributor state so "why did access disappear" is self-answering. Spec `ExplainLayerSchema` contributors gain an optional `state: 'active' | 'expired'`.
  - **plugin-sharing**: `PositionGraphService.expandPositionUsers` filters expired holders — sharing-rule recipients stop including them at resolution time.
  - **lint (D7)**: two new error rules over seed data — `security-grant-expired-at-authoring` (a `valid_until` in the past, or unparseable, is a grant that can never resolve) and `security-delegation-missing-reason` (a `delegated_from` row without `reason` breaks the D3 dual audit). Also re-exported the missing `SECURITY_MASTER_DETAIL_UNGRANTED` constant.

  No background job is involved anywhere — per ADR-0049, an expired grant simply stops resolving, in every edition.

- 7449476: Permission-zoo audit follow-ups:

  **FLS keys must be object-qualified (`security-fls-unqualified-key`, error).**
  The runtime evaluator matches field-permission keys by `<object>.<field>`
  prefix — a bare `budget` key matches NOTHING and the declared masking
  silently never enforces. The showcase itself shipped exactly that bug: its
  contributor FLS block (bare `budget`/`spent`/`budget_remaining`) was a
  runtime no-op, and the "FLS proof" in earlier verification was actually a
  validation-rule rejection. Fixed: keys qualified
  (`showcase_project.budget` …), a new D7 lint rule rejects bare keys at
  compile time with a fix-it, and the permission-zoo dogfood now proves the
  served pipeline denies a contributor's budget write while allowing ordinary
  field edits.

  **Release pipeline: PROTOCOL_VERSION auto-sync.** `changeset version` now
  runs `scripts/sync-protocol-version.mjs`, regenerating the handshake
  constant from the spec package major. Release PRs opened by
  changesets/action with the default GITHUB_TOKEN never trigger CI (GitHub's
  anti-recursion rule), so the lockstep guard could only fire AFTER a release
  merged — the drift class that broke main at 14.0.0 (#2769) is now fixed at
  version time, the one spot that cannot be skipped.

  **D11 `externalSharingModel` honestly marked.** The dial has no runtime
  consumer yet (authoring lint + Studio badges only); its liveness entry
  moves from a bespoke `authorable` status to the documented `planned` +
  `authorWarn`, and the sharing docs / design doc / showcase comments now say
  explicitly that evaluation of external principals lands with the
  principal-taxonomy phase (#2696).

### Patch Changes

- Updated dependencies [7953832]
- Updated dependencies [82e745e]
- Updated dependencies [f3035bd]
- Updated dependencies [82c0d94]
- Updated dependencies [7449476]
  - @objectstack/spec@14.4.0
  - @objectstack/formula@14.4.0
  - @objectstack/sdui-parser@14.4.0

## 14.3.0

### Minor Changes

- 02f6af4: ADR-0090 follow-through wave: enforce book audience at the read layer; finish the D2/D3 cleanup the P1 rename missed.

  - **rest**: `/meta/book`, `/meta/doc`, and `/meta/book/:name/tree` now ENFORCE
    the ADR-0046 §6.7 audience model (ADR-0049 — no unenforced security
    properties): anonymous callers see only `public` books/docs;
    `{ permissionSet }`-gated books require the caller to hold the named set;
    a doc's effective audience is the union over the books that CLAIM it
    (unclaimed docs default to `org`; orphan rendering never inherits `public`).
    Gated evaluation fails CLOSED when holdings cannot be resolved. `doc`/`book`
    single-item reads bypass the shared meta cache (per-caller gate vs shared ETag).
  - **spec**: new pure helpers powering that gate — `audienceAllows`,
    `resolveDocAudiences`, `docAudienceAllows`, `resolveBookClaimedDocs`
    (+ `AudienceCaller`/`AudienceBook` types). BREAKING but ships as a `minor`
    per the launch-window convention (pre-1.0 semantics — breaking changes do
    not burn a major version number while the whole stack is in lockstep):
    `METADATA_FORM_REGISTRY` keys `role`/`profile` are gone — `position` is the
    registered form (the `position` type had LOST its form layout in the P1
    rename); `EnvironmentArtifactMetadataSchema` declares `positions` instead of
    retired `roles`/`profiles`.
  - **plugin-security**: the `security` service exposes
    `resolvePermissionSetNames(ctx)` — the same resolution as data-plane
    enforcement, for the docs gate.
  - **metadata**: artifact ingestion maps `positions → 'position'` (the stale
    `roles → 'role'` mapping matched nothing since the P1 rename, silently
    dropping compiled positions from metadata registration).
  - **lint**: books join the D3 role-word scan (their `audience` is a
    permission-model reference now), and a new advisory rule
    `security-book-audience-unknown-set` flags a `{ permissionSet }` audience
    naming a set the stack does not declare (runtime fails closed — the typo
    cost is "nobody can read the book", so say it at author time).
  - **platform-objects**: metadata-form translations regain `position` (all four
    locales) and drop the retired `role`/`profile` groups, with a vocabulary
    regression test.

### Patch Changes

- Updated dependencies [2a71f48]
- Updated dependencies [02f6af4]
- Updated dependencies [c1064f1]
  - @objectstack/spec@14.3.0
  - @objectstack/formula@14.3.0
  - @objectstack/sdui-parser@14.3.0

## 14.2.0

### Patch Changes

- Updated dependencies [ac8f029]
- Updated dependencies [4ab9958]
  - @objectstack/spec@14.2.0
  - @objectstack/formula@14.2.0
  - @objectstack/sdui-parser@14.2.0

## 14.1.0

### Minor Changes

- 5a8465f: SLA escalation `escalateTo` is position-first (ADR-0090 D3 follow-up to the `position` approver type).

  - **spec**: `ApprovalEscalationSchema.escalateTo` is documented as a position machine name or a
    specific user id (was "User id, role, or manager level" — the same pre-D3 'role' trap the
    `position` approver type fixed); the Studio xRef picker kind moves `role` → `position`.
  - **plugin-approvals**: on escalation, `escalateTo` now expands position holders via
    `sys_user_position` ∪ the `sys_member.role` transition source (ADR-0057 D4) for both the
    `reassign` approver hand-off and the `notify` audience. An empty expansion falls back to
    treating the value as a literal user id, so configs naming a specific user keep working
    unchanged. The audit trail keeps the authored target.
  - **lint**: new `approval-escalation-reassign-no-target` warning — `escalation.action: 'reassign'`
    with no `escalateTo` silently degrades to a notify at runtime; the fix-it prescribes a position
    or user id target (or `action: 'notify'`).

### Patch Changes

- Updated dependencies [5a8465f]
- Updated dependencies [7f8620b]
- Updated dependencies [82ba3a6]
  - @objectstack/spec@14.1.0
  - @objectstack/formula@14.1.0
  - @objectstack/sdui-parser@14.1.0

## 14.0.0

### Minor Changes

- 216fa9a: Add a `position` approver type so approvals can route to org positions (ADR-0090 D3 fallout).

  Post ADR-0090 D3 the `role` approver type resolves against the better-auth org-membership
  tier (`sys_member.role`: `owner`/`admin`/`member`) — it was never a position. Downstream
  apps that authored `{ type: 'role', value: 'sales_manager' }` silently routed approvals to
  nobody. Now:

  - **spec**: `ApproverType` gains `'position'` — `value` is the position machine name; the
    approver expands to its holders via `sys_user_position`. Authoring guidance: keep
    `type: 'role'` ONLY for membership tiers; for org positions use
    `{ type: 'position', value: '<position_name>' }` (one-line fix for the mismatch above).
  - **plugin-approvals**: the engine resolves `position` approvers via `sys_user_position` ∪
    the `sys_member.role` transition source (same semantics as `PositionGraphService` in
    plugin-sharing). The `department` approver type is now honored by its spec spelling
    (previously only the off-spec `business_unit`/`bu` dialect matched).
  - **lint**: new `validateApprovalApprovers` rule — `approval-role-not-membership-tier`
    warns when a `role` approver's value is not a membership tier and prescribes the
    `position` rewrite; `approval-approver-type-unknown` flags off-spec approver types
    (with a `business_unit` → `department` fix-it). Wired into `os lint`.

### Patch Changes

- 2f3581f: feat(lint): warn when a master-detail child has no object-level CRUD grant (ADR-0090 D7)

  New security-posture rule `security-master-detail-ungranted` (advisory
  `warning`; it does not gate the build). A master-detail DETAIL object derives
  its RECORD-level access from the master (ADR-0055 `controlled_by_parent`,
  gate ②), but object-level CRUD is a SEPARATE gate ① (`checkObjectPermission`)
  that is never derived — a permission set that grants the parent but forgets the
  child denies role-bound non-admin users a 403 before the parent-derived access
  is ever consulted, surfacing as the silent "can't fill in / can't submit the
  subtable" trap (framework#2700, downstream os-tianshun-mtc#43).

  The rule flags a non-system detail (has a `master_detail` field) that NO
  authored permission set grants (explicit entry or `'*'` wildcard). It stays
  silent when the package authors no permission sets, when a package-declared
  `'*'` wildcard grant covers every object, or for `sys_*` / `isSystem` objects —
  keeping the false-positive rate near zero. The residual per-set gap (one role
  grants it, another forgets it) is intentionally out of scope, and CRUD
  auto-inheritance is deliberately NOT adopted (secure-by-default, Salesforce
  parity).

- Updated dependencies [0a8e685]
- Updated dependencies [afa8115]
- Updated dependencies [80f12ca]
- Updated dependencies [e2fa074]
- Updated dependencies [23c8668]
- Updated dependencies [29f017d]
- Updated dependencies [216fa9a]
- Updated dependencies [6c22b12]
  - @objectstack/spec@14.0.0
  - @objectstack/formula@14.0.0
  - @objectstack/sdui-parser@14.0.0

## 13.0.0

### Minor Changes

- b271691: ADR-0090 P3 — security-domain publish linter (D7) and delegated administration (D12).

  **D7 — `validateSecurityPosture` (@objectstack/lint), wired into `os compile` (errors gate the build) and `os lint`.** Rules, each with a failing fixture: `security-owd-unset` (custom object with no `sharingModel` — the objectui#2348 leave_request shape), `security-owd-alias` (retired D4 alias values, with fix-it), `security-external-wider-than-internal` (D11 `external ≤ internal`), `security-wildcard-vama` (`'*'` + View/Modify All outside the platform admin set, ADR-0066), `security-anchor-high-privilege` (an `isDefault`/everyone-suggested set carrying anchor-forbidden bits), `security-role-word` (D3 vocabulary freeze in security identifiers/labels; ARIA/page roles exempt), and advisory `security-private-no-readscope`.

  **D12 — delegated administration (@objectstack/plugin-security `DelegatedAdminGate`).** `PermissionSetSchema.adminScope` (new in spec, persisted as `sys_permission_set.admin_scope`) declares WHERE (a `sys_business_unit` subtree), WHAT (`manageAssignments` / `manageBindings` / `authorEnvironmentSets`), and WHICH sets a delegate may hand out (`assignablePermissionSets` allowlist). Writes to `sys_user_position`, `sys_position_permission_set`, `sys_user_permission_set`, and `sys_permission_set` are now governed: tenant-level admins (ADR-0066 superuser wildcard) pass through; delegates need a covering scope — inside their subtree, allowlisted sets only (to others AND themselves), single-row writes, `granted_by` audit-stamped; everyone else (including holders of plain CRUD on RBAC tables) is denied. Granting or authoring a set that itself carries an `adminScope` requires a held scope that STRICTLY contains it. The `everyone`/`guest` anchors stay tenant-level only, and direct position assignments to an anchor are rejected for every caller.

  **ADR-0090 Addendum — assignment-level BU anchor.** `sys_user_position.business_unit_id` lands with its three consumers scoped: D12 delegation boundary (enforced here), audit fact, and the depth-anchor contract for enterprise `hierarchy-scope-resolver` implementations (documented on `IHierarchyScopeResolver`).

  **D9 tier tightening.** `describeHighPrivilegeBits` moved to `@objectstack/spec/security` (re-exported from plugin-security) alongside new `describeAnchorForbiddenBits`: `guest` bindings now additionally reject edit bits (read-only by default; create stays the case-by-case exception).

  **BREAKING (@objectstack/plugin-security):** exports renamed to the ADR-0090 D3 vocabulary — `SysRole`→`SysPosition`, `SysUserRole`→`SysUserPosition`, `SysRolePermissionSet`→`SysPositionPermissionSet` (no aliases, pre-launch one-step rename). `sys_position` row actions/list views renamed (`activate_position`, …), labels relabeled Role→Position. Non-tenant-admin writes to the RBAC link tables without an `adminScope` are now denied (previously any CRUD grant on those tables sufficed).

  **BREAKING (@objectstack/platform-objects):** `sys_business_unit_member.role_in_business_unit` → `function_in_business_unit` (D3 reserved-word sweep; values member/lead/deputy unchanged).

- a5a1e41: ADR-0090 P4 — explain engine (D6), access-matrix snapshot gate, recalibrated benchmark.

  **Explain contract (@objectstack/spec).** `ExplainRequestSchema` / `ExplainDecisionSchema` / `ExplainLayerSchema`: `explain(principal, object, operation)` reports the verdict of every evaluation-pipeline layer in order (principal → required_permissions → object_crud → fls → owd_baseline → depth → sharing → vama_bypass → rls), with per-layer contributor attribution (which permission set, reached via which position/baseline) and — for reads — the composed row filter as the machine artifact. Carries the D10 dual attribution (`principalKind`, `onBehalfOf`).

  **Explain engine (@objectstack/plugin-security).** `explainAccess` is "explained by construction": it calls the SAME permission-set resolution, evaluator, FLS mask, and RLS composition the enforcement middleware calls (injected from `SecurityPlugin`), so the report cannot drift from enforcement. Exposed on the `security` kernel service as `explain(request, callerContext)`; explaining another user requires `manage_users` (the target's context is reconstructed from `sys_user_position` / `sys_user_permission_set` with everyone-anchor semantics via `buildContextForUser`).

  **Access-matrix snapshot gate (@objectstack/lint + os compile).** `buildAccessMatrix(stack)` derives the (permission set × object) capability matrix purely from metadata; `diffAccessMatrix` renders semantic review lines ("'crm_admin' gains delete on 'crm_lead'", depth changes, OWD swings, entry add/remove). `os compile` gains an opt-in gate: with `access-matrix.json` committed next to the config, any drift fails the build with those lines until re-snapshotted via `--update-access-matrix` — every capability change becomes a reviewable diff. Seeded for `examples/app-crm`.

  **Benchmark (ADR-0090 Addendum).** `scripts/bench/permission-bench.mts` — single-org 10k users × 1M rows per the recalibrated topology; asserts the O()-shape property (per-request cost independent of user population; unit-depth IN-set cost tracks unit size). Passing at 0.1µs/eval and 59ms/1M-row IN-set scan.

- 466adf6: Author-time capability-reference lint (ADR-0066 ⑨) — `os validate` / `os lint`
  now warn when a `requiredPermissions` names a capability that is registered
  nowhere.

  `requiredPermissions` (on objects, fields, apps, actions) is a free string, so a
  typo like `mange_users` is schema-valid and fails closed at runtime (the caller
  is denied) — safe, but silent. The new `validateCapabilityReferences` rule
  (`@objectstack/lint`) resolves every reference against the author-time known set
  and warns on the unresolved ones:

  - built-in platform capabilities — now sourced from a single canonical list in
    `@objectstack/spec` (`security/capabilities.ts`: `PLATFORM_CAPABILITIES` /
    `PLATFORM_CAPABILITY_NAMES`), which `@objectstack/plugin-security`'s
    `bootstrapSystemCapabilities` also seeds from (one source of truth, no drift),
  - any capability a permission set in the stack grants via `systemPermissions`
    (granting is what declares it — mirrors the runtime derived-defaults rule), and
  - any `sys_capability` row shipped as seed data.

  It is a **warning**, not an error: a single package can't see capabilities
  declared by other installed packages, and the reference fails closed anyway.
  `systemPermissions` itself is never flagged — it is the declaration side, and a
  package legitimately introduces new capabilities there. The object case also
  understands the per-operation `requiredPermissions` map form (ADR-0066 ⑤) and
  points a finding at the exact operation slice.

### Patch Changes

- Updated dependencies [6d83431]
- Updated dependencies [01917c2]
- Updated dependencies [b271691]
- Updated dependencies [a5a1e41]
- Updated dependencies [466adf6]
- Updated dependencies [5be00c3]
- Updated dependencies [466adf6]
- Updated dependencies [2bee609]
- Updated dependencies [fc7e7f7]
  - @objectstack/spec@13.0.0
  - @objectstack/formula@13.0.0
  - @objectstack/sdui-parser@13.0.0

## 12.6.0

### Patch Changes

- Updated dependencies [6cebf22]
  - @objectstack/spec@12.6.0
  - @objectstack/formula@12.6.0
  - @objectstack/sdui-parser@12.6.0

## 12.5.0

### Patch Changes

- Updated dependencies [8b3d363]
  - @objectstack/spec@12.5.0
  - @objectstack/formula@12.5.0
  - @objectstack/sdui-parser@12.5.0

## 12.4.0

### Patch Changes

- Updated dependencies [60dc3ba]
  - @objectstack/spec@12.4.0
  - @objectstack/formula@12.4.0
  - @objectstack/sdui-parser@12.4.0

## 12.3.0

### Patch Changes

- Updated dependencies [e7eceec]
  - @objectstack/spec@12.3.0
  - @objectstack/formula@12.3.0
  - @objectstack/sdui-parser@12.3.0

## 12.2.0

### Patch Changes

- Updated dependencies [fce8ff4]
- Updated dependencies [3962023]
- Updated dependencies [2bb193d]
- Updated dependencies [0426d27]
- Updated dependencies [da807f7]
  - @objectstack/spec@12.2.0
  - @objectstack/formula@12.2.0
  - @objectstack/sdui-parser@12.2.0

## 12.1.0

### Patch Changes

- Updated dependencies [93e6d02]
  - @objectstack/spec@12.1.0
  - @objectstack/formula@12.1.0
  - @objectstack/sdui-parser@12.1.0

## 12.0.0

### Minor Changes

- a8df396: feat(spec,lint): adaptive record surface + semantic field `span` for field-heavy objects (#2578)

  Field-heavy objects need two things the protocol did not express well: multi-column
  forms, and opening create/edit/detail as a full page rather than a cramped popup —
  for _some_ objects, automatically. Because all metadata is AI-authored, the design
  goal is to make AI unable to get it wrong, which reshaped both features away from
  new authored keys.

  **`deriveRecordSurface` (new spec derivation, ADR-0085 §5).** A record's default
  surface — full `page` vs `drawer`/`modal` overlay — is _derived_ from how heavy the
  record is (visible, non-system field count; mobile always pages), not authored. Per
  ADR-0085 §2's admission test a `recordSurface` object key would fail: field count is
  exactly the kind of fact a machine can infer, and modal-vs-page is pure
  re-arrangement, not a business fact. So there is **no new object key** and **no new
  ADR** — just a single shared derivation renderers consume as a default (an explicit
  form/navigation config still wins), plus a one-line clarification to ADR-0085 §2's
  rejected-keys list so `recordSurface` is not re-proposed. Explicit per-object control
  remains the sanctioned assigned-page path.

  **`FormField.span: 'auto' | 'full'` (new, replaces absolute `colSpan` as the
  primary primitive).** Under a per-surface derived column count (mobile 1 / modal 2 /
  page 3-4) an absolute `colSpan: 3` only lines up at the one width the author
  imagined — fragile by construction. The relative `span` is decoupled from the column
  count: `auto` (default; omit it) sizes by widget type × current columns, `full` takes
  the whole row at any count. `colSpan` is retained for back-compat and clamped by the
  renderer; `half` was considered and deferred (weakest AI-safety). The rationale lives
  here rather than in a new ADR, per the fewer-ADRs convention.

  **`validateFormLayout` (new lint, ADR-0078/0019).** Two advisory rules over authored
  form views: `form-field-unknown` (a section references a field not on the bound
  object — silently never renders) and `absolute-colspan-discouraged` (steers authors
  to `span: 'full'`). Both warnings, with fix hints, held to the same bar for AI and
  hand authors.

  **`NavigationConfig.size` (new) replaces pixel `width`.** A T-shirt bucket
  (`auto`/sm/md/lg/xl/full, default `auto`, aligned with `FormView.modalSize`) for a
  drawer/modal detail overlay. `width`/`drawerWidth` (pixel) are deprecated: a pixel
  width cannot be authored blind — the author (often an AI) does not know the client
  viewport. `auto` means the renderer derives the size from field count and clamps to
  the viewport, so AI writes nothing.

  All additive: no exports removed, no behavior change for existing metadata.

- e695fe0: feat(spec,lint): reject userFilters on object list views (ADR-0053 phase 4)

  ADR-0053 reserves `userFilters`/`quickFilters` for page lists ("filters" mode);
  on an object list view ("views" mode — where the `ViewTabBar` is the only nav
  control) they are silently dropped. This lands the phase-4 guardrail as a
  layered defence, so the wrong-context authoring mistake is caught without
  breaking existing metadata:

  - **Type-level (author time):** new `ObjectListViewSchema` = `ListViewSchema`
    minus `userFilters`. Object built-in `listViews` and `defineView`
    `list`/`listViews` now use it, so `userFilters` on an object list view is a
    `tsc` error. The full `ListViewSchema` (page "filters" mode) is untouched.
  - **Runtime (back-compat):** the field is STRIPPED at parse (default strip, no
    throw), so existing metadata keeps loading — `ObjectSchema.parse` never fails
    on a stray `userFilters`.
  - **Author/CI (actionable):** new `@objectstack/lint` rule
    `validateListViewMode`, wired into `os validate`, reports the wrong-context
    field PRE-parse (before the schema strips it) with a fix hint.

  Closes the schema half of objectui #2219; supersedes the interim runtime warn in
  objectui #2220.

### Patch Changes

- Updated dependencies [a8df396]
- Updated dependencies [e695fe0]
- Updated dependencies [7c09621]
- Updated dependencies [7709db4]
- Updated dependencies [2082109]
- Updated dependencies [7c09621]
- Updated dependencies [9860de4]
- Updated dependencies [069c205]
  - @objectstack/spec@12.0.0
  - @objectstack/formula@12.0.0
  - @objectstack/sdui-parser@12.0.0

## 11.10.0

### Patch Changes

- 996c548: Load Sucrase lazily in `validateReactPages` instead of at module top level — the same kernel boot-path contract applied to the TypeScript compiler in `validateReactPageProps` (framework#2544).

  `@objectstack/lint` sits on the kernel boot path, so the eager `import { transform } from 'sucrase'` made every boot parse ~1.5 MB of transpiler (~16 ms cold require) for a syntax gate that only runs when a `kind:'react'` page is actually validated — a rare, trusted-tier case. Sucrase now loads on the first validated react-source page via the same deferred-createRequire pattern; the public API stays synchronous and unchanged, `sucrase` stays a regular dependency, and if the package is missing at call time validation fails with an actionable error instead of killing boot.

  The boot-path guard test is generalized from `lazy-typescript.test.ts` to `lazy-deps.test.ts` and now covers both deps at all three levels (structural no-eager-import scan over src, child-process probes of both built dist formats, in-process lazy-load behavior) — verified to go red for each dep when its eager import is reintroduced.

- e82a495: Load the TypeScript compiler lazily in `validateReactPageProps` instead of at module top level (ADR-0081 Phase 2 follow-up).

  `@objectstack/lint` sits on the kernel boot path, so the eager `import ts from 'typescript'` (framework#2482) made every boot parse the ~9 MB compiler (~70 ms+ on a warm laptop, worse on container cold starts) for a gate that only runs when a `kind:'react'` page is actually validated — a rare, trusted-tier case. It also hard-crashed boot in deployments that prune the package from the image (cloud's Docker pruner did exactly that; worked around in cloud#728).

  - The compiler now loads on the first validated react-source page, via a deferred `createRequire` (same bundling-safe pattern as driver-sqlite-wasm's knex-wasm-dialect); the public API stays synchronous and unchanged.
  - Importing the package, and validating stacks with no react pages, no longer touches `typescript` at all — so images that prune it boot fine and only fail (with an actionable error naming the package and the fix) if a react-source page is actually validated.
  - `typescript` remains a regular dependency of `@objectstack/lint`.
  - Guarded by a three-level regression test (structural no-eager-import scan, child-process probes of both dist formats, in-process lazy-load behavior), verified to go red if the eager import is reintroduced.

- Updated dependencies [6a9397e]
- Updated dependencies [c0efe5d]
  - @objectstack/spec@11.10.0
  - @objectstack/formula@11.10.0
  - @objectstack/sdui-parser@11.10.0

## 11.9.0

### Patch Changes

- Updated dependencies [d3595d9]
  - @objectstack/spec@11.9.0
  - @objectstack/formula@11.9.0
  - @objectstack/sdui-parser@11.9.0

## 11.8.0

### Patch Changes

- @objectstack/spec@11.8.0
- @objectstack/formula@11.8.0
- @objectstack/sdui-parser@11.8.0

## 11.7.0

### Minor Changes

- 5178906: ADR-0085: object presentation intent is declared as cross-surface semantic
  roles, never as per-surface hint blocks.

  **@objectstack/spec**

  - New top-level `stageField: string | false` — names the object's linear
    lifecycle field (`false` declares the status-like field non-linear and
    suppresses every consumer's stage heuristics). Legitimizes the key the UI
    runtime already read but the schema rejected.
  - `compactLayout` → **`highlightFields`** (the value is an ordered field
    list, not a layout; "highlight" is already the renderer-side term of art).
    `compactLayout` stays accepted as a parse-time alias and is preserved on
    output — the ADR-0079 `displayNameField → nameField` pattern.
  - `fieldGroups[].collapse: 'none' | 'expanded' | 'collapsed'` replaces
    `defaultExpanded` AND the UI-dialect `collapsible`/`collapsed` boolean pair
    (which had drifted two ways: spec declared a key no renderer read, renderers
    read keys the spec rejected). Old keys map onto the enum at parse and remain
    accepted for one minor.
  - `fieldGroups[].visibleOn` removed (no consumer anywhere — ADR-0049
    enforce-or-remove; re-add together with its enforcement when a surface
    evaluates it).
  - The `detail: { … }.passthrough()` UI-hints block is **removed**. Every key
    in it was either unauthorable, a proven no-op for spec authors
    (`hideReferenceRail` — the rail is default-off and its enabling key was
    never typed), or a per-page toggle that belongs to an assigned Page. Zero
    authors existed across framework and objectui (evidence in ADR-0085); the
    removal ships as a minor under the documented dead-surface exception
    (PR #2272 precedent).
  - New `deriveFieldGroupLayout(def)` in `@objectstack/spec/data` — the single
    source of the fieldGroups rendering semantics (declared order, empty groups
    dropped, ungrouped trailing bucket minus audit/system fields, collapse
    passthrough incl. deprecated aliases). UI renderers consume this instead of
    their two pre-existing near-identical local copies.

  **@objectstack/lint / @objectstack/cli**

  - New `validateSemanticRoles` (wired into `os lint`): warns on
    `Field.group` → undeclared group, declared-but-unreferenced groups, and
    `stageField`/`highlightFields` entries naming non-existent fields — the
    dangling-pointer shapes that are Zod-valid but silently inert at render
    time (ADR-0078 completeness gate).

  **@objectstack/platform-objects**

  - All 35 system objects renamed `compactLayout:` → `highlightFields:`
    (behaviour unchanged via the alias).

### Patch Changes

- Updated dependencies [5178906]
  - @objectstack/spec@11.7.0
  - @objectstack/formula@11.7.0
  - @objectstack/sdui-parser@11.7.0

## 11.6.0

### Patch Changes

- @objectstack/spec@11.6.0
- @objectstack/formula@11.6.0
- @objectstack/sdui-parser@11.6.0

## 11.5.0

### Minor Changes

- 5a5bf61: ADR-0081 Phase 2: a build-time prop check for `kind:'react'` pages. After the
  syntax gate, `validateReactPageProps` parses the real JSX (TypeScript compiler)
  and checks each usage of an injected block (`<ObjectForm>`, `<ListView>`, …)
  against the react-tier contract (`REACT_BLOCKS` from `@objectstack/spec/ui`):
  missing a required binding (e.g. `<ObjectForm>` with no `objectName`) is an
  error; a near-miss prop (`onSucces` → `onSuccess`) is a warning. Wired into
  `os validate`. Curated data props are not flagged (low false-positive); a spread
  `{...props}` escapes the required check. (`typescript` moves to `@objectstack/lint`
  dependencies so it externalizes instead of bundling into the CLI.)
- ec7175d: Add the source-page styling guardrail (ADR-0065): `os validate`/`os build` now flags Tailwind `className` in `kind:'html'`/`kind:'react'` page source, which silently produces no CSS because the build never scans authored metadata. New `validatePageSourceStyling` rule with an actionable inline-style/`hsl(var(--token))` fix; also corrects the react-blocks contract, the objectstack-ui skill, the layout-dsl docs, and ADR-0080/0081 away from the "HTML + Tailwind" framing.

### Patch Changes

- Updated dependencies [6ee4f04]
- Updated dependencies [c1e3a65]
  - @objectstack/spec@11.5.0
  - @objectstack/formula@11.5.0
  - @objectstack/sdui-parser@11.5.0

## 11.4.0

### Minor Changes

- 5821c51: ADR-0081: split the AI page-authoring surface into honest tiers.

  - `PageSchema.kind` gains `'html'` and `'react'`. `'html'` is the constrained
    parse-never-execute tier (the renamed `'jsx'`, kept as a deprecated alias);
    `'react'` is the real-React tier (executed at render by
    `@object-ui/react-runtime`). It runs author JS, so it is gated by a host
    capability that **defaults ON** (the platform trusts reviewed, draft-gated
    authors) and is disabled **server-side** via the `OS_PAGE_REACT=off`
    env toggle. The completeness gate now requires `source` for all three kinds.
  - `@objectstack/cli` console serving injects the disable global into the served
    HTML when `OS_PAGE_REACT=off` (read per request, no rebuild).
  - `validate-jsx-pages` lints `html`/`jsx` (constrained parse). A new
    `validate-react-pages` transpiles `react` source with Sucrase (transpile-only,
    never executed) so syntax errors fail at `os build` instead of at render.

### Patch Changes

- Updated dependencies [5821c51]
- Updated dependencies [a0fce3f]
  - @objectstack/spec@11.4.0
  - @objectstack/formula@11.4.0
  - @objectstack/sdui-parser@11.4.0

## 11.3.0

### Minor Changes

- 58e8e31: feat(lint): ADR-0079 record-title gate — deprecate titleFormat + record-title validator

  A record's human title is a structural invariant (ADR-0079): every object
  resolves a primary title from a real STORED field via `nameField` (the
  canonical pointer; `displayNameField` is the deprecated alias) or a
  deterministic derivation. This adds build-time diagnostics so `os build` /
  `os lint`, the MCP authoring surface, and hand-authoring all get the coverage
  cloud graph-lint already has (the ADR-0078 "not cloud-only" principle):

  - `title-format-retired` — flags an object that declares a `titleFormat`. That
    key is a render-only template the server can neither return nor query;
    ADR-0079 retires it in favour of `nameField`. The schema still parses it
    (existing metadata keeps loading), so this is advisory, not an error.
  - `title-unresolvable` — flags an object whose title cannot be resolved from any
    stored field (`objectTitleCompleteness` reports `status: 'none'`).

  `@objectstack/spec` carries the `titleFormat` `.describe()` deprecation note;
  the `@objectstack/cli` `lint` command wires the new validator into its run.

### Patch Changes

- Updated dependencies [58e8e31]
- Updated dependencies [b4a5df0]
  - @objectstack/spec@11.3.0
  - @objectstack/formula@11.3.0
  - @objectstack/sdui-parser@11.3.0

## 11.2.0

### Minor Changes

- 8ea1f4f: ADR-0080 M3b②: `os validate` / `os build` now parse `kind:'jsx'` page `source` via `@objectstack/sdui-parser` (new `validateJsxPages` lint rule) — malformed JSX fails loudly at author time (ADR-0078) instead of being stored and breaking only at render. Parse-level for now (syntax, tag matching, forbidden constructs like event handlers / dangerouslySetInnerHTML); full component/prop whitelist validation arrives once the registry manifest is threaded through `compile()`.
- 21c37d8: ADR-0080 M3b① (consumption seam): the `os build` / `os validate` JSX gate now does **full component/prop validation** (unknown component, missing/wrong prop, bad enum, bindings) when a `sdui.manifest.json` is present at the project root — falling back to parse-level otherwise. `validateJsxPages` accepts an optional manifest; the validate command loads the file when present. Generating + shipping that manifest from the registry's public tier remains a build/CI step.

### Patch Changes

- Updated dependencies [d0f4b13]
- Updated dependencies [302bdab]
- Updated dependencies [012c046]
  - @objectstack/spec@11.2.0
  - @objectstack/sdui-parser@11.2.0
  - @objectstack/formula@11.2.0

## 11.1.0

### Patch Changes

- Updated dependencies [ecf193f]
- Updated dependencies [51bec81]
- Updated dependencies [3e593a7]
- Updated dependencies [63d5403]
  - @objectstack/spec@11.1.0
  - @objectstack/formula@11.1.0

## 11.0.0

### Patch Changes

- Updated dependencies [ab5718a]
- Updated dependencies [4845c12]
- Updated dependencies [c1a754a]
- Updated dependencies [6fbe91f]
- Updated dependencies [715d667]
- Updated dependencies [5eef4cf]
- Updated dependencies [72759e1]
- Updated dependencies [6c4fbd9]
- Updated dependencies [ef3ed67]
- Updated dependencies [cd51229]
- Updated dependencies [7697a0e]
- Updated dependencies [e7e04f1]
- Updated dependencies [cfd5ac4]
- Updated dependencies [2be5c1f]
- Updated dependencies [ad143ce]
- Updated dependencies [5c4a8c8]
- Updated dependencies [3afaeed]
- Updated dependencies [8801c02]
- Updated dependencies [3d04e06]
- Updated dependencies [4a84c98]
- Updated dependencies [d980f0d]
- Updated dependencies [a658523]
- Updated dependencies [82ff91c]
- Updated dependencies [638f472]
  - @objectstack/spec@11.0.0
  - @objectstack/formula@11.0.0

## 10.3.0

### Minor Changes

- f75943a: feat(lint): SDUI styling validator (ADR-0065)

  `validateResponsiveStyles` — a pure `(stack) => Finding[]` rule wired into
  `os validate` and `os compile`, so hand-authored and AI-generated pages are
  held to the same bar (ADR-0019). Catches the deterministic ways a
  `responsiveStyles` block silently fails: a styled node with no `id` (CSS can't
  be scoped → dropped) is an **error**; warnings cover Tailwind-in-`className`
  (silently dead in metadata), a smaller breakpoint with no `large` base, unknown
  CSS properties, and unknown/typo'd design tokens. Quality/visual judgement
  (is it ugly) is out of scope — that needs render + a VLM gate.

### Patch Changes

- @objectstack/spec@10.3.0
- @objectstack/formula@10.3.0

## 10.2.0

### Minor Changes

- 63f3219: feat(lint): extract static metadata validators into @objectstack/lint (ADR-0019 P3)

  New public package `@objectstack/lint` holds the pure, build-time metadata
  validators as `(stack) => Finding[]` functions, so the same rules run wherever a
  stack can be assembled — the CLI's `os validate`/`compile` and any other
  consumer (notably AI-driven authoring), instead of being trapped in CLI
  internals where only the CLI could reach them.

  First release moves the two validators the AI build needs:

  - `validateWidgetBindings` — dashboard widget → dataset → measure/dimension
    reference integrity + measure-aggregation coherence (ADR-0021).
  - `validateStackExpressions` — CEL/predicate validity for field conditionals,
    sharing rules, action visible/disabled, lifecycle hooks (ADR-0032).

  `@objectstack/cli` now imports both from `@objectstack/lint` (was `./utils/*`);
  pure move, no behavior change. Dependency direction is one-way `lint → spec`;
  the package never depends on a runtime and is never bundled into a frontend
  (that is why the validators do NOT live in the frontend-facing `@objectstack/spec`).

  Filesystem-coupled checks (`lint-liveness-properties`) and CLI-command-coupled
  ones (`score` → `lintConfig`) deliberately stay in the CLI for now; they can
  move in a later increment.

### Patch Changes

- Updated dependencies [b496498]
  - @objectstack/spec@10.2.0
  - @objectstack/formula@10.2.0
