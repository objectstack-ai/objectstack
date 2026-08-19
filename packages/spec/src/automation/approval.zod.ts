// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { z } from 'zod';
import { BUILTIN_MEMBERSHIP_ROLES } from '../identity/membership-role';
import { lazySchema } from '../shared/lazy-schema';
import { strictObject } from '../shared/strict-object';

// Why the members sit in THIS order (the generated reference renders the JSDoc
// below; this rationale stays in source):
//
// A designer that derives its approver-type picker from this enum — the Studio
// flow inspector does, via the published JSON schema minus `xEnumDeprecated` —
// offers the members in exactly this order. So the order is a recommendation
// the platform makes to every author, not an accident of when each member was
// added, and it belongs here rather than in any one renderer's options array
// (objectui#2834 put it there, where the inspector never read it).
//
// Indirect bindings therefore lead and the literal `user` binding comes last.
// Naming one specific person is the least portable choice an author can make:
// it breaks when the flow is deployed to another environment (that id does not
// exist there), and again when that person changes team or leaves — silently
// routing approvals to someone who should no longer see them. `manager` /
// `position` / `department` / `team` survive both.
/**
 * Approval Step Approver Type
 *
 * Declaration order is author-facing: designers derive their picker from this
 * enum, and it leads with the portable indirect bindings (`manager`,
 * `position`, `department`, `team`) — a literal `user` id comes last.
 */
export const ApproverType = z.enum([
  'manager',        // Submitter's manager (sys_user.manager_id)
  'position',       // Holders of a position (sys_user_position, ADR-0090 D3)
  'department',     // Members of a department + all descendant departments (sys_business_unit)
  'team',           // Members of a flat collaboration team (sys_team)
  'field',          // User ID defined in a record field
  /**
   * #3447 P2: a CEL expression resolved AT NODE ENTRY against three explicit
   * roots — `current.*` (the record's live state), `trigger.*` (the submit-time
   * snapshot) and `vars.*` (flow variables, incl. upstream node outputs). The
   * result (a user-id string, CSV, or string array — or intermediate ids
   * re-expanded per `resolveAs`) becomes the approver slate. `record` and bare
   * field names are deliberately NOT available: `record` means "the record at
   * event time" everywhere else on the platform (flow conditions, hooks), and
   * reusing it here would silently alias one of the two times.
   */
  'expression',
  // The ORG-MEMBERSHIP TIER (`sys_member.role` — the whole closed
  // `BUILTIN_MEMBERSHIP_ROLES` vocabulary, ObjectStack-owned; see
  // `ORG_MEMBERSHIP_LEVELS` below), spelled with the projection name ADR-0057 D7 mandates and
  // ADR-0090 D3 assumes ("relabelled `org_membership_level` … its UI label is
  // 'organization membership', never 'role'"). NOT an org position: a value
  // like 'sales_manager' matches nobody — author `position` for those.
  'org_membership_level',
  // @deprecated ADR-0090 D3 — the pre-relabel spelling of
  // `org_membership_level`. D3 makes "role" reserved-forbidden on platform
  // surfaces; its exception covers better-auth's own `sys_member.role` column,
  // NOT this enum (which is ours). Accepted for one deprecation window: the
  // runtime resolves it identically and warns, `os lint` prescribes the
  // rewrite. Removed in the next major. Kept adjacent to the spelling that
  // replaced it; `xEnumDeprecated` keeps it out of every picker regardless of
  // where it sits.
  'role',
  'user',           // A specific user id — least portable; see the note above
  // @deprecated #3508 — declared-but-unenforced: `resolveApproverSpec` in
  // `plugin-approvals` has no queue branch, so a queue approver resolves to
  // nobody (the dead `queue:<value>` fallback literal). The sharing engine
  // retired its `queue` recipient the same way (sys-sharing-rule). Still
  // parses so stored flows keep rendering, but designers must not offer it
  // (see NON_AUTHORABLE_APPROVER_TYPES). Re-admit only together with a real
  // ownership-queue implementation (queue entity + membership + claim).
  'queue',
]);
export type ApproverType = z.input<typeof ApproverType>;

/**
 * Deprecated approver-type spellings → their canonical replacement
 * (ADR-0090 D3). The runtime and `os lint` both read this map, so a future
 * removal is a one-line edit here plus the enum entry.
 */
export const DEPRECATED_APPROVER_TYPES = {
  role: 'org_membership_level',
} as const satisfies Record<string, z.infer<typeof ApproverType>>;

/** Resolve a possibly-deprecated approver type to its canonical spelling. */
export function canonicalApproverType(type: string): string {
  return (DEPRECATED_APPROVER_TYPES as Record<string, string>)[type] ?? type;
}

/**
 * Approver types that still PARSE but must not be offered for new authoring.
 * Published to designers as `xEnumDeprecated` on the approver `type` (see
 * {@link ApprovalNodeApproverSchema}): a stored value keeps rendering, the
 * dropdown just stops handing authors the entry. Two sources:
 *   - the deprecated spellings in {@link DEPRECATED_APPROVER_TYPES} (ADR-0090 D3);
 *   - `queue`, declared-but-unenforced in the runtime (#3508) — offering it
 *     would advertise a capability the engine doesn't deliver (Prime
 *     Directive #10: declared ≠ enforced).
 */
export const NON_AUTHORABLE_APPROVER_TYPES: readonly string[] = [
  ...Object.keys(DEPRECATED_APPROVER_TYPES),
  'queue',
];

/**
 * How a designer must source an approver row's `value`, per approver type —
 * the single declaration of the "metadata registry vs data records" split
 * (#3508). The engine (`plugin-approvals` `resolveApproverSpec` +
 * `expand*Users`) resolves these against DATA rows in the system directory
 * objects, so the matching picker is a RECORD lookup via the data API —
 * `GET /api/v1/meta/user` lists metadata types, never `sys_user` rows.
 */
export type ApproverValueBinding =
  /**
   * `value` identifies a row of `object`; the designer stores the row's
   * `valueField`. Note `position` routes by machine **name** (the engine
   * filters `sys_user_position.position` by name — deliberate, names are
   * portable across environments the way ids are not), and `department`
   * resolves against `sys_business_unit`, not a `sys_department`.
   */
  | { source: 'record'; object: string; valueField: 'id' | 'name' }
  /** Closed value set — render a strict select, never free text. */
  | { source: 'enum'; values: readonly string[] }
  /**
   * Resolved by the engine at runtime (submitter's manager via
   * `sys_user.manager_id`); `value` is optional (an advanced override naming
   * the record field that holds the subject user) and normally stays empty.
   */
  | { source: 'auto' }
  /** `value` names a field on the flow's trigger object. */
  | { source: 'trigger-field' }
  /**
   * `value` is a CEL expression evaluated at node entry (#3447 P2) over the
   * closed root set in `roots` — an expression editor, not a picker.
   */
  | { source: 'expression'; roots: readonly string[] }
  /** Declared-but-unenforced — do not offer for authoring (#3508). */
  | { source: 'unsupported' };

/**
 * Org-membership tiers (`sys_member.role`) — DERIVED from
 * {@link BUILTIN_MEMBERSHIP_ROLES}, never re-spelled.
 *
 * The vocabulary is ObjectStack's own closed membership-role list (ADR-0108),
 * not "better-auth's closed set" as this comment once claimed:
 * `delegated_admin` is ObjectStack's ADR-0105 D8 addition to the column. A
 * hand-spelled copy here carried the stale three-value list, so the one tier
 * the column enforces but the copy omitted could not be authored as an
 * approver. Deriving makes the drift unrepresentable: the approver picker
 * offers exactly what `sys_member.role` stores, and the next tier addition
 * reaches this surface automatically.
 */
export const ORG_MEMBERSHIP_LEVELS = BUILTIN_MEMBERSHIP_ROLES;

/**
 * The CLOSED root set an `expression` approver may reference (#3447 P2).
 * Mirrored by `APPROVER_EXPRESSION_ROOTS` in `plugin-approvals` and the
 * `approval-expression-invalid` lint, so what lints clean is what runs.
 */
export const APPROVER_EXPRESSION_ROOTS = ['current', 'trigger', 'vars'] as const;

/**
 * The per-type value bindings. `satisfies` keeps this exhaustive: adding an
 * {@link ApproverType} member without declaring how its value is sourced is a
 * compile error, so the designer contract can never silently lag the enum.
 */
export const APPROVER_VALUE_BINDINGS = {
  user: { source: 'record', object: 'sys_user', valueField: 'id' },
  org_membership_level: { source: 'enum', values: ORG_MEMBERSHIP_LEVELS },
  // Deprecated alias — same binding as its canonical spelling so a stored
  // legacy row still renders with the right control during its window.
  role: { source: 'enum', values: ORG_MEMBERSHIP_LEVELS },
  position: { source: 'record', object: 'sys_position', valueField: 'name' },
  team: { source: 'record', object: 'sys_team', valueField: 'id' },
  department: { source: 'record', object: 'sys_business_unit', valueField: 'id' },
  manager: { source: 'auto' },
  field: { source: 'trigger-field' },
  queue: { source: 'unsupported' },
  expression: { source: 'expression', roots: APPROVER_EXPRESSION_ROOTS },
} as const satisfies Record<z.infer<typeof ApproverType>, ApproverValueBinding>;

/**
 * {@link APPROVER_VALUE_BINDINGS}, projected onto the wire for the designer
 * (#3508 follow-up).
 *
 * `xRef.map` only ever said which PICKER KIND to render — a name like `'team'`
 * — and never where that picker's candidates come from. So the designer had to
 * carry its own copy of the data contract, and the first copy was wrong: every
 * directory kind was wired to `GET /api/v1/meta/:type`, the metadata registry,
 * which does not hold `sys_user` / `sys_team` / `sys_business_unit` /
 * `sys_position` ROWS. Candidates came back empty and the control degraded to a
 * free-text box (#3508).
 *
 * Publishing the binding closes that gap at the source: a renderer reads which
 * object to query and which column to commit off the schema instead of
 * re-deriving it, and a new {@link ApproverType} member cannot leave a stale
 * mirror behind — `satisfies` above already makes an undeclared member a
 * compile error, and this projection inherits that guarantee.
 *
 * Presentation stays with the renderer: which field to SHOW, whether to open a
 * people-picker, what subtitle to put under a row are objectui's calls. This
 * carries only the data contract — where the candidates live and what the
 * committed value is.
 */
export const APPROVER_VALUE_SOURCES = Object.fromEntries(
  Object.entries(APPROVER_VALUE_BINDINGS).map(([type, binding]) => [
    type,
    binding.source === 'record'
      // `data` names the DATA API, in contrast to the metadata registry the
      // designer used to query — the whole point of the annotation.
      ? { source: 'data', object: binding.object, valueField: binding.valueField }
      : binding.source === 'enum'
        ? { source: 'enum', values: [...binding.values] }
        : { source: binding.source },
  ]),
) as Record<
  z.infer<typeof ApproverType>,
  | { source: 'data'; object: string; valueField: string }
  | { source: 'enum'; values: string[] }
  | { source: 'auto' | 'trigger-field' | 'expression' | 'unsupported' }
>;

// ==========================================================================
// [ADR-0105 D9] Cross-organization approver targeting
// ==========================================================================

/**
 * Symbolic organization references usable as an approver's `organization`
 * (ADR-0105 D9).
 *
 * Flow metadata is PORTABLE — the same flow deploys to dev, staging and every
 * customer environment — while an organization id is DATA, minted per
 * deployment. A literal id in a flow is therefore unportable by construction,
 * and an AI author cannot know one at authoring time. These symbols express
 * the two common intents against the D6 grouping tree instead, so the usual
 * cases need no deployment knowledge at all:
 *
 *   - `$root`   — the group organization: walk `parent_organization_id` up from
 *                 the request's organization to the top. "Escalate to group."
 *   - `$parent` — exactly one level up. Division-level sign-off in a three-tier
 *                 group (group → division → plant).
 *
 * A slug (any other value) names a specific organization and covers the shapes
 * the symbols cannot: a SIBLING org, e.g. a shared-services centre that
 * approves payables for every plant. That is also why D9's legality rule is
 * "shares a root", not "is an ancestor".
 */
export const APPROVER_ORG_SYMBOLS = ['$root', '$parent'] as const;
export type ApproverOrgSymbol = (typeof APPROVER_ORG_SYMBOLS)[number];

/**
 * Whether an approver type resolves people through an ORGANIZATION-SCOPED
 * directory — i.e. whether `organization` (ADR-0105 D9) means anything for it.
 *
 * `user` / `field` / `manager` name a person directly or derive one from the
 * record, so they are org-agnostic: an `organization` on them is not a narrower
 * routing, it is a misunderstanding, and the lint says so rather than silently
 * ignoring it. `team` is org-agnostic too — `sys_team_member` carries no
 * organization column and the engine never scoped it (unlike position /
 * membership-tier / department, which all do).
 *
 * `satisfies` keeps this exhaustive for the same reason
 * {@link APPROVER_VALUE_BINDINGS} is: a new {@link ApproverType} must state
 * whether cross-org targeting applies to it, or this file fails to compile.
 */
export const APPROVER_ORG_SCOPED = {
  user: false,
  org_membership_level: true,
  role: true,
  position: true,
  team: false,
  department: true,
  manager: false,
  field: false,
  queue: false,
  expression: true,
} as const satisfies Record<z.infer<typeof ApproverType>, boolean>;

/** Does `organization` (ADR-0105 D9) apply to this approver type? */
export function approverTypeIsOrgScoped(type: string): boolean {
  return (APPROVER_ORG_SCOPED as Record<string, boolean>)[canonicalApproverType(type)] ?? false;
}

// ==========================================================================
// Approval as a Flow Node (ADR-0019, canonical)
// ==========================================================================
//
// ADR-0019 collapsed the standalone approval *authoring* type into Flow. An
// approval is now authored as a flow with one or more **Approval nodes**
// (`type: 'approval'`); the engine rides the node's durable pause. The former
// process-level concepts re-home as:
//   - `steps`                 → successive Approval nodes on the canvas
//   - `entryCriteria`         → the condition on the edge entering the node
//   - `onApprove`/`onReject`  → the nodes wired to the node's `approve`/`reject` edges
//   - `rejectionBehavior: back_to_previous` → a back-edge to an earlier node
//   - `lockRecord` / `approvalStatusField` / `escalation` / `behavior` / approvers
//                             → {@link ApprovalNodeConfigSchema} node config
// The process-driven schemas (ApprovalProcessSchema / ApprovalStepSchema /
// ApprovalActionSchema) were removed in ADR-0019 P4.

/**
 * Registry node type for the Approval node. The `plugin-approvals` package
 * registers an executor under this type (ADR-0018), so an approval rides the
 * one flow engine as a durable-pause node rather than a second engine.
 */
export const APPROVAL_NODE_TYPE = 'approval' as const;

/**
 * Registry node type for the **revise window** — the durable pause an ADR-0044
 * send-back parks the run on while the submitter reworks the record.
 *
 * ADR-0044 D3 originally pointed the `revise` edge at an ordinary `wait` node
 * and reused the pause that had already shipped for timers and signals. The
 * 2026-07-28 amendment to that ADR (#3823) reversed it: once #3801 made
 * `resume` authorization-bearing (a node descriptor declares who may continue
 * a pause it produced), a generic `wait` — correctly `resumeAuthority: 'any'`,
 * because a signal-flavored wait is *meant* to be resumable by an external
 * producer — sat in a service-owned position. A raw
 * `POST /automation/:name/runs/:runId/resume` walked the resubmit back-edge
 * into the approval node with no submitter check, no `resubmit` audit row, and
 * (when a pending request collided on the record) destroyed the run outright by
 * consuming the suspension before the re-entry failed.
 *
 * So the revise pause is its own node type, registered by `plugin-approvals`
 * with `resumeAuthority: 'service'`: still a first-class box on the canvas and
 * in the run log, no longer raw-resumable. `ApprovalService.resubmit` is the
 * only door — which is what keeps the submitter-only check, the latest-request
 * check, the `resubmit` audit row and the `DUPLICATE_REQUEST` run-preservation
 * guard on the only path that can advance it.
 *
 * A `revise` edge that targets anything else is rejected at authoring time
 * (`flow-approval-revise-target-not-service-owned` in `@objectstack/lint`) and
 * refused by `sendBack` before any mutation.
 */
export const APPROVAL_REVISE_NODE_TYPE = 'approval_revise' as const;

/**
 * Canonical decisions an Approval node emits. The engine selects the
 * downstream branch by matching these against out-edge `label`s
 * (see {@link ApprovalNodeConfigSchema}).
 */
export const ApprovalDecision = z.enum(['approve', 'reject']);
export type ApprovalDecision = z.input<typeof ApprovalDecision>;

/**
 * Edge labels an Approval node's out-edges use to declare which branch a
 * decision follows. `resume(runId, { branchLabel })` passes the matching
 * label so the engine continues down the right edge.
 */
export const APPROVAL_BRANCH_LABELS = {
  approve: 'approve',
  reject: 'reject',
  /**
   * ADR-0044 send-back-for-revision: the request finalizes `returned` and the
   * flow walks this edge to the revise window — an
   * {@link APPROVAL_REVISE_NODE_TYPE} node — where the submitter reworks the
   * record; a later resubmit re-enters the approval node via a declared
   * back-edge (round N+1).
   *
   * The edge's target must be that node type (amended ADR-0044, #3823): a
   * generic `wait` there is a service-owned pause anyone could resume.
   */
  revise: 'revise',
  /**
   * ADR-0044: informational label a resubmit resume passes so the revise
   * window's out-edge selection is explicit when authors label the back-edge.
   */
  resubmit: 'resubmit',
} as const;

/*
 * ── Unknown-key strictness (#4001 step 3) ───────────────────────────────────
 *
 * The four AUTHORING schemas in this module are `.strict()`: a key they do not
 * declare is a loud, fixable parse error, not a silent strip. Approval is a
 * v17-new authoring surface — tightened while young, before any stored volume
 * exists. Note the blast radius is wider than a spec parse: the published
 * JSON schema (see {@link getApprovalNodeConfigJsonSchema}) carries
 * `additionalProperties: false` into the Studio property form AND
 * `registerFlow()`'s per-node config validation (#4027/#4040), so an unknown
 * key inside an approval node's `config` is rejected at registration too —
 * deliberately: an approval gate that quietly ignores half its config is the
 * worst instance of the ADR-0078 trap.
 */

/** A single approver assignment on an Approval node. */
export const ApprovalNodeApproverSchema = lazySchema(() => strictObject(
  {
    surface: 'this approval approver',
    aliases: {
      approver: 'value',
      userid: 'value',
      org: 'organization',
      grouplabel: 'group',
      expandas: 'resolveAs',
    },
    history:
      'Until #4001 these were dropped silently — the approver still parsed, so the ' +
      'request could route to the wrong slate without a diagnostic.',
  },
  {
  // `xEnumDeprecated` lists enum members that still PARSE but must not be
  // offered for new authoring. Without it the Studio designer derives its
  // approver-type dropdown straight from this enum and keeps offering `role`
  // — the exact trap ADR-0090 D3 is retiring — one click away from `position`
  // — and `queue`, which the runtime never resolves (#3508). Renderers omit
  // these from pickers while still rendering a stored value.
  type: ApproverType.meta({
    xEnumDeprecated: [...NON_AUTHORABLE_APPROVER_TYPES],
  }),
  /**
   * The approver reference, interpreted per `type`: a user id (`user`), a
   * membership tier — owner/admin/member (`org_membership_level`), a position
   * machine name (`position`), team/department id (`team`/`department`), field
   * name holding a user id (`field`), or queue id (`queue`). Omitted for
   * `manager` (resolved from the submitter's `manager_id`).
   */
  // `xRef` marks this string as a *polymorphic* typed reference (ADR-0018
  // §configSchema): the concrete picker follows the sibling `type` column.
  // How each kind is BACKED (a data-record lookup on a directory object, a
  // closed enum, an auto-resolved value, a trigger-object field) is declared
  // once in {@link APPROVER_VALUE_BINDINGS} — designers must source the
  // record-backed kinds from the DATA API, not the metadata registry (#3508).
  // A single `.meta()` carries both description and annotation.
  //
  // The `role` → `org-membership-level` picker kind is the deprecated alias's
  // entry: it maps to the SAME picker as the canonical spelling, so a stored
  // legacy node still renders correctly for its deprecation window. `manager`
  // maps to a picker kind that renders as "auto-resolved" (no free text);
  // `queue` stays mapped so stored rows keep rendering even though the type
  // is no longer authorable (see NON_AUTHORABLE_APPROVER_TYPES).
  // `expression` is intentionally ABSENT from the map: an unmapped type keeps
  // the value as free text, so the designer renders a plain input for the CEL
  // source until a dedicated expression editor lands (objectui follow-up).
  value: z.string().optional().meta({
    description: 'User id / membership tier / position / team / department / field — per `type`; '
      + 'for `expression`, a CEL expression over `current.*` / `trigger.*` / `vars.*`',
    xRef: {
      kindFrom: 'type',
      objectSource: '$trigger',
      map: {
        user: 'user',
        org_membership_level: 'org-membership-level',
        role: 'org-membership-level',
        position: 'position',
        team: 'team',
        department: 'department',
        manager: 'manager',
        field: 'object-field',
        queue: 'queue',
      },
      // Where each kind's candidates actually live, and what the picker
      // commits — see {@link APPROVER_VALUE_SOURCES}. `map` alone named a
      // picker but never its data source, which is how the designer ended up
      // querying the metadata registry for data records (#3508).
      sources: APPROVER_VALUE_SOURCES,
    },
  }),
  /**
   * #3447 P2, `expression` approvers only: how the expression's resolved values
   * are turned into people. `user` (default) treats each value as a user id.
   * `department` / `position` / `team` treat each value as that kind of id and
   * expand it through the same graph lookups the static approver types use —
   * e.g. an expression yielding department ids + `resolveAs: 'department'`
   * fans out into every member of every returned department. With
   * `behavior: 'per_group'`, each intermediate value forms its own group (one
   * sign-off per returned department), keyed by that value.
   */
  resolveAs: z.enum(['user', 'department', 'position', 'team']).optional()
    .describe("How an `expression` result is expanded into approvers (default 'user')"),
  /**
   * Optional group label (#3266). With `behavior: 'per_group'`, approvers that
   * share a label form one group and the node advances only once EACH group has
   * `minApprovals` approvals — e.g. one legal AND one finance sign-off. Ignored
   * by other behaviors. Approvers without a label each form their own group
   * (keyed by position), so a plain per-approver list still behaves sensibly.
   */
  group: z.string().optional().describe('Group label for per_group sign-off (e.g. "legal", "finance")'),
  /**
   * [ADR-0105 D9] Which organization's directory this approver is resolved
   * AGAINST. Default (omitted): the request's own organization — today's
   * behaviour, unchanged.
   *
   * This separates two things one organization id used to do at once: WHERE
   * THE REQUEST LIVES and WHERE ITS APPROVERS ARE LOOKED UP. A group CFO holds
   * her `cfo` position in the GROUP organization while the purchase order
   * lives in the PLANT organization; without this field
   * `expandPositionUsers('cfo', <plant>)` finds nobody and the slot routes
   * into `onEmptyApprovers`.
   *
   * Declared per APPROVER, not per node, so one node can require a plant
   * manager AND a group CFO in parallel (`behavior: 'per_group'`). A node-level
   * default is a strict special case of this and can be added later as sugar;
   * the reverse is not true.
   *
   * Values: `$root` / `$parent` (see {@link APPROVER_ORG_SYMBOLS}) or an
   * organization SLUG. Slugs are used rather than ids because flow metadata is
   * portable across environments and ids are not.
   *
   * Bounded, not free: the target must share a `parent_organization_id` root
   * with the request's organization (ADR-0105 D6 grouping metadata), so this is
   * a route WITHIN one group — never a channel to an unrelated tenant. Applies
   * only to org-scoped approver types ({@link APPROVER_ORG_SCOPED}) and only
   * under the `group` tenancy posture; elsewhere the runtime refuses rather
   * than silently ignoring, so a posture migration cannot quietly reroute
   * approvals.
   */
  organization: z.string().optional().meta({
    description:
      'ADR-0105 D9 — organization whose directory resolves this approver: `$root` (group org), '
      + '`$parent` (one level up), or an organization slug. Omitted = the request\'s own organization.',
    xRef: { kind: 'organization', symbols: [...APPROVER_ORG_SYMBOLS] },
  }),
}));
export type ApprovalNodeApprover = z.input<typeof ApprovalNodeApproverSchema>;

export const DecisionOutputDefSchema = lazySchema(() => strictObject(
  /**
   * A TYPED decision-output declaration (#3447 P2 follow-up). The bare-string
   * form of a `decisionOutputs` entry renders as free text; this form tells the
   * decision UI which picker to render and whether to collect one id or many.
   * The runtime treats `key` as the whitelist entry either way — `type` and
   * `multiple` only shape the INPUT WIDGET, never the accepted value.
   */
  {
    surface: 'this decision-output declaration',
    aliases: { name: 'key', widget: 'type', many: 'multiple' },
    history:
      'Until #4001 these were dropped silently — the declaration still parsed, so the ' +
      'decision dialog rendered a different input than the author specified.',
  },
  {
  /** The output key — what the flow receives as `<nodeId>.<key>`. */
  key: z.string().min(1).describe('Output key (the flow variable name under the node id)'),
  /** Display label for the decision-dialog field; defaults to a title-cased key. */
  label: z.string().optional().describe('Field label in the decision dialog'),
  /**
   * Input widget: `text` (default — free text), or a record picker —
   * `user` (sys_user), `department` (sys_business_unit), `position`
   * (sys_position), `team` (sys_team). Picker values are record ids.
   */
  type: z.enum(['text', 'user', 'department', 'position', 'team']).optional()
    .describe("Decision-dialog input widget (default 'text')"),
  /** Collect an id array instead of a single value (multi-select picker). */
  multiple: z.boolean().optional().describe('Collect multiple values (id array)'),
  /**
   * The approver must supply this output to APPROVE (objectui#2955).
   *
   * Unlike `type`/`multiple` — which only shape the input widget — this one
   * IS enforced by the runtime: an approve carrying no value for a required
   * key is rejected before any write, so a downstream `expression` approver
   * reading `vars.<nodeId>.<key>` can never face a missing key. Without it an
   * author's only backstop was `onEmptyApprovers` — the run reaches the next
   * node, finds nobody, and stalls for an admin rescue.
   *
   * NOT enforced on reject: the run leaves down the reject edge, where the
   * outputs are not read, and demanding routing data to say "no" would block
   * the rejection. Outputs are still accepted on a reject if the approver
   * filled them in.
   */
  required: z.boolean().optional().describe('Approver must supply this output to approve'),
}));
export type DecisionOutputDef = z.input<typeof DecisionOutputDefSchema>;

/**
 * Normalize a `decisionOutputs` array (bare keys and typed declarations mixed)
 * into the typed form. The ONE place both sides read the union: the runtime
 * whitelists `normalizeDecisionOutputs(...).map(d => d.key)`, the request read
 * surfaces the normalized defs for the decision UI — so a bare key and
 * `{ key }` can never behave differently.
 */
export function normalizeDecisionOutputs(
  declared: unknown,
): DecisionOutputDef[] {
  if (!Array.isArray(declared)) return [];
  const out: DecisionOutputDef[] = [];
  for (const entry of declared) {
    if (typeof entry === 'string') {
      if (entry) out.push({ key: entry });
    } else if (entry && typeof entry === 'object' && typeof (entry as any).key === 'string' && (entry as any).key) {
      const e = entry as Record<string, unknown>;
      out.push({
        key: String(e.key),
        ...(typeof e.label === 'string' && e.label ? { label: e.label } : {}),
        ...(typeof e.type === 'string' && e.type !== 'text' ? { type: e.type as DecisionOutputDef['type'] } : {}),
        ...(e.multiple === true ? { multiple: true } : {}),
        ...(e.required === true ? { required: true } : {}),
      });
    }
  }
  return out;
}

export const ApprovalEscalationSchema = lazySchema(() => strictObject(
  /**
   * Per-node SLA escalation — carried on the Approval node itself, so each
   * Approval step on the canvas defines its own SLA.
   */
  {
    surface: 'this approval escalation',
    aliases: {
      timeout: 'timeoutHours',
      hours: 'timeoutHours',
      sla: 'timeoutHours',
      to: 'escalateTo',
      target: 'escalateTo',
    },
    history:
      'Until #4001 these were dropped silently — the escalation still parsed, so an SLA ' +
      'the author declared never fired the way they intended.',
  },
  {
  enabled: z.boolean().default(false).describe('Enable SLA-based escalation for this node'),
  timeoutHours: z.number().min(1).describe('Hours before escalation triggers'),
  action: z.enum(['reassign', 'auto_approve', 'auto_reject', 'notify']).default('notify')
    .describe('Action on escalation timeout'),
  // Escalation hands the request to a position (the common case — e.g. an
  // approvals supervisor); the Studio designer renders a position picker, but
  // free text is still accepted for a specific user id. The engine expands a
  // position machine name to its holders via `sys_user_position` (ADR-0090
  // D3) and falls back to treating the value as a user id when nobody holds
  // it. NOT a better-auth membership tier — same contract as ApproverType.
  escalateTo: z.string().optional().meta({
    description: 'User id or position machine name to escalate to',
    xRef: { kind: 'position' },
  }),
  notifySubmitter: z.boolean().default(true).describe('Notify the original submitter on escalation'),
}));
export type ApprovalEscalation = z.input<typeof ApprovalEscalationSchema>;
/** Post-parse shape of {@link ApprovalEscalation} — defaults applied, transforms run (ADR-0122). */
export type ApprovalEscalationParsed = z.infer<typeof ApprovalEscalationSchema>;

/**
 * Config for an **Approval node** (`type: 'approval'`) on a flow — the ADR-0019
 * replacement for an {@link ApprovalStepSchema}. The node opens an approval
 * request on entry, suspends the run, and resumes down its `approve` / `reject`
 * out-edge once a decision is recorded.
 *
 * What does NOT live here (re-homed to the flow graph, by design):
 *  - **entry criteria** → the condition on the edge entering this node
 *  - **on-approve / on-reject actions** → the nodes wired to the
 *    `approve` / `reject` out-edges
 *  - **back-to-previous rejection** → a back-edge to an earlier node
 *
 * Approval *state* (request/action rows, record lock, status mirror) remains
 * first-class engine-adjacent state owned by `plugin-approvals`; this config
 * only describes how the node behaves.
 */
export const ApprovalNodeConfigSchema = lazySchema(() => strictObject(
  {
    surface: "this approval node's config",
    aliases: {
      approver: 'approvers',
      approvalmode: 'behavior',
      mode: 'behavior',
      statusfield: 'approvalStatusField',
      quorum: 'minApprovals',
    },
    guidance: {
      // The ADR-0019 re-home map: the process-level approval concepts an author
      // (or AI) trained on Salesforce-style approval processes reaches for, each
      // pointed at where the concept lives on the flow graph now.
      steps:
        '`steps` is not an approval-node config key — ADR-0019 collapsed the standalone ' +
        'approval process into Flow: successive approval STEPS are successive `approval` ' +
        'NODES on the canvas, each with its own config.',
      entryCriteria:
        '`entryCriteria` is not an approval-node config key — entry criteria are the ' +
        '`condition` on the EDGE entering this node (ADR-0019).',
      onApprove:
        '`onApprove` is not an approval-node config key — on-approve actions are the ' +
        "nodes wired to this node's `approve` out-edge (ADR-0019).",
      onReject:
        '`onReject` is not an approval-node config key — on-reject actions are the ' +
        "nodes wired to this node's `reject` out-edge (ADR-0019).",
      rejectionBehavior:
        '`rejectionBehavior` is not an approval-node config key — back-to-previous is a ' +
        'declared BACK-EDGE to an earlier node (`type: \'back\'`, ADR-0044), and the ' +
        'revise loop is the `revise` out-edge with `maxRevisions` bounding it.',
    },
    history:
      'Until #4001 these were dropped silently — the node still parsed, so an approval ' +
      'gate shipped that quietly ignored part of its declared behavior.',
  },
  {
  /** Who may act on this step. */
  approvers: z.array(ApprovalNodeApproverSchema).min(1).describe('Allowed approvers for this node'),

  /**
   * How multiple approvers combine (#3266):
   *  - `first_response` — any one approval (or rejection) finalizes the node.
   *  - `unanimous` — every resolved approver must approve.
   *  - `quorum` — `minApprovals` of N approvals finalize (M-of-N collective sign-off).
   *  - `per_group` — each `group` (see approver `group`) must reach `minApprovals`
   *    approvals (default 1), i.e. one-from-each-group sign-off (会签).
   * In every mode a single rejection finalizes the node as `rejected` (one veto).
   * Weighted voting and approval-matrix governance are enterprise
   * (objectstack-ai/cloud#861), not here.
   */
  behavior: z.enum(['first_response', 'unanimous', 'quorum', 'per_group']).default('first_response')
    .describe('How to combine multiple approvers'),

  /**
   * Threshold for `quorum` (total approvals required, M of N) and `per_group`
   * (approvals required from EACH group). Defaults to 1. Clamped at runtime so
   * it can never exceed the resolvable approver count (no deadlock).
   */
  minApprovals: z.number().int().min(1).optional()
    .describe('Approvals required — total (quorum) or per group (per_group). Default 1'),

  /** Lock the triggering record from edits while this node is pending. */
  lockRecord: z.boolean().default(true).describe('Lock the record from editing while pending'),

  /**
   * Field on the business object to mirror the request status onto
   * (`pending`/`approved`/`rejected`/`recalled`). Should be readonly on the
   * object. Omitted ⇒ status is exposed only via `sys_approval_request`.
   */
  approvalStatusField: z.string().optional()
    // `xRef` marks this string as a typed reference (ADR-0018 §configSchema):
    // the Studio designer renders an object-field picker instead of free text.
    // `objectSource: '$trigger'` resolves the field catalog from the flow's
    // trigger object (the record this approval acts on). A single `.meta()`
    // carries both description and the annotation so neither is dropped.
    .meta({
      description: 'Business-object field to mirror request status onto',
      xRef: { kind: 'object-field', objectSource: '$trigger' },
    }),

  /**
   * #3447 P2: what happens when approver resolution yields NO concrete person
   * at node entry (an empty expression result, an unstaffed position, an empty
   * multi-select field, …):
   *  - `admin_rescue` (default) — open the request anyway and warn loudly; a
   *    privileged admin can take it over via Reassign (#3424). The only option
   *    that neither waves the record through nor kills the run — approval's job
   *    is to gatekeep, so an empty slate must never silently pass.
   *  - `fail` — the node fails (fault edge / run failure). Choose when an empty
   *    slate can only mean a configuration bug.
   *  - `auto_approve` — skip the request and continue down the `approve` edge
   *    with `output.autoApproved = true`. The DingTalk/Feishu default; opt-in
   *    here because it silently waves the record through.
   */
  onEmptyApprovers: z.enum(['admin_rescue', 'fail', 'auto_approve']).default('admin_rescue')
    .describe('Behavior when no concrete approver resolves at node entry'),

  /**
   * #3447 P2: keys a decision may carry as structured outputs
   * (`decide(..., { outputs })`). The AUTHOR declares the keys; approvers only
   * fill values — the same trust model as a `screen` node's author-defined
   * fields. Accepted outputs resume the run as `<nodeId>.<key>` flow variables
   * (never bare names, so an approver can't shadow author variables), where a
   * later node's `expression` approver can read them
   * (`vars.<nodeId>.picked_departments`) — "the previous approver picks the
   * next step's approvers" without a record-field detour. A decision carrying
   * undeclared keys is rejected; `decision` / `requestId` are reserved.
   *
   * An entry is either a bare key (a plain text input in the decision UI) or a
   * TYPED declaration — `{ key, type, multiple }` — that tells the decision UI
   * to render a record picker instead of free text: `user` → a sys_user
   * picker, `department`/`position`/`team` → the matching system-object
   * picker. `multiple: true` collects an id ARRAY (the natural fan-out shape
   * for an `expression` approver downstream). The type describes the INPUT
   * WIDGET only — the runtime accepts whatever value shape arrives (single id,
   * id[], CSV) and hands it to the flow verbatim.
   */
  decisionOutputs: z.array(z.union([
    z.string(),
    DecisionOutputDefSchema,
  ])).optional()
    .describe('Author-declared decision outputs — bare keys or typed { key, type, multiple } declarations'),

  /** Optional per-node SLA escalation. */
  escalation: ApprovalEscalationSchema.optional().describe('Per-node SLA escalation'),

  /**
   * ADR-0044: maximum send-backs-for-revision per (run, node). A send-back
   * that would exceed the budget auto-rejects instead (the run resumes down
   * the `reject` edge with `output.autoRejected = true`), so instances cannot
   * orbit the revise loop forever. `0` disables send-back (always
   * auto-rejects). Only meaningful when the node has a `revise` out-edge.
   */
  maxRevisions: z.number().int().min(0).default(3)
    .describe('Max send-backs for revision before auto-reject (0 = send-back disabled)'),
}));
export type ApprovalNodeConfig = z.input<typeof ApprovalNodeConfigSchema>;
/** Post-parse shape of {@link ApprovalNodeConfig} — defaults applied, transforms run (ADR-0122). */
export type ApprovalNodeConfigParsed = z.infer<typeof ApprovalNodeConfigSchema>;

/**
 * JSON Schema for {@link ApprovalNodeConfigSchema}, memoized.
 *
 * Published on the Approval action descriptor's `configSchema`
 * (ADR-0018/0019) so the **engine** is the single source of truth for the
 * node's config contract: the Studio flow designer renders the Approval node's
 * property form from this schema (rather than a hardcoded client form), and the
 * same schema backs `registerFlow()` config validation. Derived with Zod v4's
 * `z.toJSONSchema` in `input` mode (the author-facing shape — default-bearing
 * fields are optional). Lazily computed so the wrapped schema is only resolved
 * when a descriptor is actually built.
 */
let cachedApprovalNodeConfigJsonSchema: unknown;
export function getApprovalNodeConfigJsonSchema(): unknown {
  if (cachedApprovalNodeConfigJsonSchema === undefined) {
    cachedApprovalNodeConfigJsonSchema = z.toJSONSchema(ApprovalNodeConfigSchema, {
      target: 'draft-2020-12',
      io: 'input',
      // Approval config has no unrepresentable constructs today; keep the
      // designer resilient if one is ever added rather than throwing at boot.
      unrepresentable: 'any',
    });
  }
  return cachedApprovalNodeConfigJsonSchema;
}
