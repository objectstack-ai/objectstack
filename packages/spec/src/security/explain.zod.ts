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
 * principal → required_permissions → object_crud → fls → owd_baseline →
 * depth → sharing → vama_bypass → rls.
 */

/** Operations the explain API accepts (the CRUD + lifecycle classes the evaluator maps). */
export const ExplainOperationSchema = z.enum([
  'read', 'create', 'update', 'delete', 'transfer', 'restore', 'purge',
]);
export type ExplainOperation = z.infer<typeof ExplainOperationSchema>;

/** One evaluation-pipeline layer's contribution to the decision. */
export const ExplainLayerSchema = lazySchema(() => z.object({
  /** Pipeline layer id, in evaluation order. */
  layer: z.enum([
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
  })).default([]),
}));
export type ExplainLayer = z.infer<typeof ExplainLayerSchema>;

/** Request shape for the explain API. */
export const ExplainRequestSchema = lazySchema(() => z.object({
  /** Object (entity) name the access question is about. */
  object: z.string(),
  operation: ExplainOperationSchema,
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
  }),
  /** Per-layer breakdown, in pipeline order. */
  layers: z.array(ExplainLayerSchema),
  /**
   * For `read`: the composed row filter the caller would be served with —
   * the machine artifact behind the prose (`null` = unrestricted,
   * `{ id: '__deny_all__' }` = zero rows).
   */
  readFilter: z.unknown().optional(),
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
