// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { z } from 'zod';
import { lazySchema } from '../shared/lazy-schema';

/**
 * [ADR-0090 D6] Access-explanation contract — `explain(principal, object,
 * operation)` as a first-class API.
 *
 * The explain engine (`@objectstack/plugin-security`) walks the SAME code
 * paths as the enforcement middleware — the same permission-set resolution,
 * the same evaluator, the same RLS compiler — and reports what each layer of
 * the evaluation pipeline contributed to the final decision. "Explained by
 * construction": the report can never drift from enforcement because it IS
 * enforcement, minus the throw.
 *
 * Layer order mirrors the runtime pipeline:
 * tenant_isolation → principal → required_permissions → object_crud → fls →
 * owd_baseline → depth → sharing → vama_bypass → rls.
 *
 * [C2 / ADR-0095] Record-grained explanation. The contract carries an optional
 * `recordId` on the request and, when present, a per-layer `record` attribution
 * plus a top-level `record` verdict on the response — so the sharing / rls / owd
 * layers can report the ROW-LEVEL story for one concrete record (which share
 * admitted it, which filter excluded it, whether the effective row filter
 * matches). Object-level requests (no `recordId`) stay byte-compatible.
 *
 * [ADR-0095 D1/D2] The contract also reserves the kernel-chain vocabulary the
 * β engine + UI will fill: the always-first tenant wall as `tenant_isolation`
 * (Layer 0), a per-layer `kernelTier` marking Layer 0 vs. business RLS
 * (Layer 1), and the monotonic posture ladder
 * (PLATFORM_ADMIN > TENANT_ADMIN > MEMBER > EXTERNAL) on the resolved principal.
 */

/** Operations the explain API accepts (the CRUD + lifecycle classes the evaluator maps). */
export const ExplainOperationSchema = z.enum([
  'read', 'create', 'update', 'delete', 'transfer', 'restore', 'purge',
]);
export type ExplainOperation = z.infer<typeof ExplainOperationSchema>;

/**
 * [ADR-0095 D2] The monotonic posture ladder resolved once in
 * `resolveAuthzContext`. Each rung maps to exactly one row-visibility injection
 * rule, and visibility is strictly nested down the ladder
 * (PLATFORM_ADMIN ⊇ TENANT_ADMIN ⊇ MEMBER ⊇ EXTERNAL). Explain reports which
 * rung the principal evaluated at so a consumer can answer "was this decided by
 * the tenant-admin tier or ordinary business RLS?". `EXTERNAL` is defined and
 * reservable now; its enforcement path ships when an external principal type
 * exists (ADR-0095 D2).
 */
export const AuthzPostureSchema = z.enum([
  'PLATFORM_ADMIN',
  'TENANT_ADMIN',
  'MEMBER',
  'EXTERNAL',
]).describe(
  'ADR-0095 D2 posture rung — PLATFORM_ADMIN crosses the tenant wall where object posture permits; ' +
  'TENANT_ADMIN sees all rows in the org; MEMBER gets business RLS; EXTERNAL sees only explicitly shared rows.',
);
export type AuthzPosture = z.infer<typeof AuthzPostureSchema>;

/**
 * [C2 / ADR-0090 D6] A single concrete rule that governed a SPECIFIC record at
 * one pipeline layer — the row-level analogue of {@link ExplainLayer}'s
 * `contributors`. Populated only for record-grained requests; lets the sharing /
 * rls / owd / tenant layers name the real share, sharing rule, ownership fact,
 * team/territory grant, RLS policy, or Layer 0 tenant filter that admitted or
 * excluded THAT row. The β engine fills these from the same sharing-service /
 * RLS-compiler outputs enforcement uses.
 */
export const ExplainMatchedRuleSchema = lazySchema(() => z.object({
  /** What kind of row-visibility source this is at the layer. */
  kind: z.enum([
    'tenant_filter',   // [ADR-0095 D1] the Layer 0 org wall
    'owd_baseline',    // the object's OWD default admitted/excluded the row
    'ownership',       // the principal owns (or does not own) the record
    'record_share',    // a concrete share row targeting this record
    'sharing_rule',    // an owner/criteria sharing rule (SharingRuleType)
    'team',            // team / account-team membership grant
    'territory',       // territory assignment grant
    'rls_policy',      // a business RLS policy predicate
  ]).describe('The row-visibility source kind evaluated for this record at this layer.'),
  /** Identifier of the concrete rule/share/policy (sharing-rule name, policy id, share row id). */
  name: z.string().describe('Stable identifier of the concrete rule, share, or policy that was evaluated.'),
  /**
   * For sharing sources: the access level this rule grants on the record
   * (mirrors `SharingLevel` — read/edit/full).
   */
  grants: z.enum(['read', 'edit', 'full']).optional()
    .describe('Access level a sharing source grants on the record (mirrors SharingLevel).'),
  /** How the rule reached the principal (e.g. `group:sales_team`, `position:approver`, `owner`, `criteria: status == open`). */
  via: z.string().optional()
    .describe('How the rule reached the principal — recipient group/position, ownership, or the matching criteria.'),
  /** The concrete row predicate this rule contributed, when filter-shaped (`null` = unrestricted). */
  predicate: z.unknown().optional()
    .describe('The row predicate this rule contributed, when it is filter-shaped (null = unrestricted).'),
  /**
   * What this rule did to THIS record: `admits` (would make it
   * visible/writable), `excludes` (filters it out), `neutral` (evaluated,
   * no effect on the record).
   */
  effect: z.enum(['admits', 'excludes', 'neutral'])
    .describe('The rule\'s effect on THIS record: admits, excludes, or neutral.'),
}));
export type ExplainMatchedRule = z.infer<typeof ExplainMatchedRuleSchema>;

/**
 * [C2 / ADR-0090 D6] A pipeline layer's determination for ONE specific record.
 * Present on {@link ExplainLayer} only when the request carried a `recordId`.
 * Carries the row-level story the object-level `verdict`/`detail` cannot: the
 * effective row filter this layer composed, whether THIS record satisfies it,
 * and the concrete rules that admitted or excluded it — the substrate for the
 * β-phase "layer-by-layer expansion" UI (permission set → position → share →
 * row rule → effective row filter) rendered per record.
 */
export const ExplainRecordAttributionSchema = lazySchema(() => z.object({
  /** Whether this layer admitted the record, excluded it, or did not evaluate it. */
  outcome: z.enum(['admitted', 'excluded', 'not_evaluated'])
    .describe('This layer\'s row-level outcome for the record: admitted, excluded, or not_evaluated (skipped/not row-scoped).'),
  /** The effective row predicate this layer contributed (`null` = unrestricted, `{ id: "__deny_all__" }` = zero rows). */
  rowFilter: z.unknown().optional()
    .describe('The effective row predicate this layer contributed for the record set (null = unrestricted, __deny_all__ = zero rows).'),
  /** Whether THIS record satisfies `rowFilter` — the row-level judgement behind `outcome`. */
  matchesRecord: z.boolean().optional()
    .describe('Whether the specific record satisfies rowFilter — the judgement behind outcome.'),
  /** Concrete rules/shares/policies this layer evaluated against the record, in evaluation order. */
  rules: z.array(ExplainMatchedRuleSchema).default([])
    .describe('Concrete rules, shares, or policies this layer evaluated against the record, in evaluation order.'),
  /** Human-readable, record-specific explanation of the outcome. */
  detail: z.string().optional()
    .describe('Human-readable, record-specific explanation of this layer\'s outcome.'),
}));
export type ExplainRecordAttribution = z.infer<typeof ExplainRecordAttributionSchema>;

/** One evaluation-pipeline layer's contribution to the decision. */
export const ExplainLayerSchema = lazySchema(() => z.object({
  /** Pipeline layer id, in evaluation order. */
  layer: z.enum([
    // [ADR-0095 D1] Layer 0 — the always-first tenant wall, its own code path,
    // AND-composed before any business RLS. Reserved for the β engine.
    'tenant_isolation',
    'principal',
    'required_permissions',
    'object_crud',
    'fls',
    'owd_baseline',
    'depth',
    'sharing',
    'vama_bypass',
    'rls',
  ]),
  /**
   * [ADR-0095 D1] Which kernel layer this pipeline step belongs to: the
   * always-first tenant wall (`layer_0_tenant`) vs. business row-level security
   * (`layer_1_business`). Lets a consumer answer "was this the tenant wall or a
   * business RLS rule?" without hard-coding layer ids. Omitted on reports from
   * engines that predate the kernel-chain split; the β engine sets it.
   */
  kernelTier: z.enum(['layer_0_tenant', 'layer_1_business']).optional()
    .describe('ADR-0095 kernel layer: layer_0_tenant = the always-first org wall; layer_1_business = business RLS/sharing/ownership.'),
  /**
   * What the layer did to the request:
   * `grants` (supplied the permission), `denies` (blocked it), `narrows`
   * (restricted the row/field set), `widens` (expanded it), `neutral`
   * (evaluated, changed nothing), `not_applicable` (skipped by posture).
   */
  verdict: z.enum(['grants', 'denies', 'narrows', 'widens', 'neutral', 'not_applicable']),
  /** Human-readable explanation of the layer's outcome. */
  detail: z.string(),
  /** Which grants contributed (permission sets, positions, system posture). */
  contributors: z.array(z.object({
    kind: z.enum(['permission_set', 'position', 'system']),
    name: z.string(),
    /** How the contributor reached the principal (e.g. `position:sales_rep`, `baseline`, `everyone`). */
    via: z.string().optional(),
    /**
     * [ADR-0091 D2] Grant-lifecycle state. Omitted/`active` = contributing
     * normally; `expired` = the grant row exists but is OUTSIDE its
     * `[valid_from, valid_until)` window, so it contributed NOTHING — reported
     * so "why did access disappear" is self-answering ("held until … — expired").
     */
    state: z.enum(['active', 'expired']).optional(),
  })).default([]),
  /**
   * [C2] Per-record attribution — present only when the request carried a
   * `recordId`. The row-level analogue of `contributors`: what this layer did to
   * the one concrete record (effective row filter, whether it matched, which
   * shares/rules/policies admitted or excluded it). Absent on object-level
   * requests, so the existing shape is unchanged.
   */
  record: ExplainRecordAttributionSchema.optional()
    .describe('Row-level determination for the specific record under explanation; set only for record-grained requests.'),
}));
export type ExplainLayer = z.infer<typeof ExplainLayerSchema>;

/** Request shape for the explain API. */
export const ExplainRequestSchema = lazySchema(() => z.object({
  /** Object (entity) name the access question is about. */
  object: z.string(),
  operation: ExplainOperationSchema,
  /**
   * [C2 / ADR-0090 D6] Optional id of ONE concrete record to explain at row
   * granularity ("why can user X do OP on record Y?"). When supplied, the
   * sharing / rls / owd / tenant_isolation layers add per-record `record`
   * attribution and the decision carries a top-level `record` verdict. Omitted =
   * an object-level question (the pre-C2 contract), answered identically.
   */
  recordId: z.string().optional()
    .describe('Optional id of one concrete record to explain at row granularity; omitted = object-level (pre-C2) request.'),
  /**
   * User to explain FOR. Omitted = the calling principal. Explaining another
   * user requires the `manage_users` capability (or system context) — the
   * engine reconstructs that user's positions/direct grants from
   * `sys_user_position` / `sys_user_permission_set` with the same semantics
   * as the runtime resolver (everyone anchor, additive baseline).
   */
  userId: z.string().optional(),
}));
export type ExplainRequest = z.infer<typeof ExplainRequestSchema>;
/** Authoring input for {@link ExplainRequest}. */
export type ExplainRequestInput = z.input<typeof ExplainRequestSchema>;

/** The full decision report. */
export const ExplainDecisionSchema = lazySchema(() => z.object({
  /** The bottom line — would the middleware allow this operation? */
  allowed: z.boolean(),
  object: z.string(),
  operation: ExplainOperationSchema,
  /** Who was evaluated (post-resolution). */
  principal: z.object({
    userId: z.string().nullable(),
    positions: z.array(z.string()).default([]),
    /** Resolved permission-set names, in resolution order. */
    permissionSets: z.array(z.string()).default([]),
    /** [ADR-0090 D10] Principal taxonomy, when the context carries it. */
    principalKind: z.enum(['human', 'agent', 'service', 'guest', 'system']).optional(),
    /** [ADR-0090 D10] Dual attribution: who the principal acts for. */
    onBehalfOf: z.object({ userId: z.string() }).optional(),
    /**
     * [ADR-0095 D2] The posture rung the principal evaluated at, when the
     * context carries it. Resolved once; each rung maps to one row-visibility
     * rule, strictly nested down the ladder. Optional until the β engine
     * resolves posture; absent = pre-ladder report.
     */
    posture: AuthzPostureSchema.optional(),
  }),
  /** Per-layer breakdown, in pipeline order. */
  layers: z.array(ExplainLayerSchema),
  /**
   * For `read`: the composed row filter the caller would be served with —
   * the machine artifact behind the prose (`null` = unrestricted,
   * `{ id: '__deny_all__' }` = zero rows).
   */
  readFilter: z.unknown().optional(),
  /**
   * [C2 / ADR-0090 D6] Record-grained verdict — present only when the request
   * carried a `recordId`. The row-level bottom line for the one concrete record:
   * whether it is visible/actionable, and which pipeline layer was decisive
   * (the layer whose `record.outcome` excluded it, or the last one to admit it).
   * The per-layer `record` attributions above carry the full trace; this is the
   * summary a UI pins next to the record.
   */
  record: lazySchema(() => z.object({
    /** The record this verdict is about (echoes the request `recordId`). */
    recordId: z.string().describe('The concrete record id this verdict is about (echoes the request recordId).'),
    /** Whether the operation is permitted on THIS specific record. */
    visible: z.boolean().describe('Whether the operation is permitted on this specific record after all layers.'),
    /** The pipeline layer that decided the outcome (excluded the record, or last admitted it). */
    decidedBy: z.enum([
      'tenant_isolation',
      'principal',
      'required_permissions',
      'object_crud',
      'fls',
      'owd_baseline',
      'depth',
      'sharing',
      'vama_bypass',
      'rls',
    ]).optional().describe('The pipeline layer that decided the record-level outcome (excluded it, or last admitted it).'),
  })).optional().describe('Row-level verdict for the specific record; set only for record-grained requests.'),
}));
export type ExplainDecision = z.infer<typeof ExplainDecisionSchema>;

/**
 * [ADR-0090 D6] Access-matrix snapshot — the authoring-time companion to the
 * runtime explain API. One row per (permission set × object) declared in a
 * stack; built PURELY from metadata by `@objectstack/lint`'s
 * `buildAccessMatrix`, snapshotted to `access-matrix.json`, and diffed on
 * every compile: an unchanged matrix auto-passes, a changed one fails the
 * build until the snapshot is updated — making every capability change a
 * REVIEWABLE, semantic diff ("`crm_admin` gains delete on `crm_lead`").
 */
export const AccessMatrixEntrySchema = lazySchema(() => z.object({
  permissionSet: z.string(),
  object: z.string(),
  create: z.boolean(),
  read: z.boolean(),
  edit: z.boolean(),
  delete: z.boolean(),
  viewAllRecords: z.boolean(),
  modifyAllRecords: z.boolean(),
  readScope: z.string().optional(),
  writeScope: z.string().optional(),
  /** The object's declared OWD (record baseline) for context. */
  sharingModel: z.string().optional(),
}));
export type AccessMatrixEntry = z.infer<typeof AccessMatrixEntrySchema>;

export const AccessMatrixSchema = lazySchema(() => z.object({
  /** Snapshot format version. */
  version: z.literal(1).default(1),
  /** Sorted (permissionSet, object) entries — stable for diffing. */
  entries: z.array(AccessMatrixEntrySchema).default([]),
}));
export type AccessMatrix = z.infer<typeof AccessMatrixSchema>;
