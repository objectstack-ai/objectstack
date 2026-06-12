// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { z } from 'zod';
import { lazySchema } from '../shared/lazy-schema';

/**
 * Approval Step Approver Type
 */
export const ApproverType = z.enum([
  'user',           // Specific user(s)
  'role',           // Users with specific role (sys_member.role)
  'team',           // Members of a flat collaboration team (sys_team)
  'department',     // Members of a department + all descendant departments (sys_department)
  'manager',        // Submitter's manager (sys_user.manager_id)
  'field',          // User ID defined in a record field
  'queue'           // Data ownership queue
]);

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
 * Canonical decisions an Approval node emits. The engine selects the
 * downstream branch by matching these against out-edge `label`s
 * (see {@link ApprovalNodeConfigSchema}).
 */
export const ApprovalDecision = z.enum(['approve', 'reject']);
export type ApprovalDecision = z.infer<typeof ApprovalDecision>;

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
   * flow walks this edge to a wait point where the submitter reworks the
   * record; a later resubmit re-enters the approval node via a declared
   * back-edge (round N+1).
   */
  revise: 'revise',
  /**
   * ADR-0044: informational label a resubmit resume passes so the wait node's
   * out-edge selection is explicit when authors label the back-edge.
   */
  resubmit: 'resubmit',
} as const;

/** A single approver assignment on an Approval node. */
export const ApprovalNodeApproverSchema = lazySchema(() => z.object({
  type: ApproverType,
  /**
   * The approver reference, interpreted per `type`: a user id (`user`), role
   * name (`role`), team/department id (`team`/`department`), field name
   * holding a user id (`field`), or queue id (`queue`). Omitted for `manager`
   * (resolved from the submitter's `manager_id`).
   */
  // `xRef` marks this string as a *polymorphic* typed reference (ADR-0018
  // §configSchema): the concrete picker follows the sibling `type` column, so
  // the Studio designer shows a user/role/team/department/queue picker — or an
  // object-field picker (resolved from the flow's `$trigger` object) when
  // `type` is `field`. `manager` and any unmapped value carry no `value` and
  // stay free text. A single `.meta()` carries both description and annotation.
  value: z.string().optional().meta({
    description: 'User id / role / team / department / field / queue — per `type`',
    xRef: {
      kindFrom: 'type',
      objectSource: '$trigger',
      map: {
        user: 'user',
        role: 'role',
        team: 'team',
        department: 'department',
        field: 'object-field',
        queue: 'queue',
      },
    },
  }),
}));
export type ApprovalNodeApprover = z.infer<typeof ApprovalNodeApproverSchema>;

/**
 * Per-node SLA escalation — carried on the Approval node itself, so each
 * Approval step on the canvas defines its own SLA.
 */
export const ApprovalEscalationSchema = lazySchema(() => z.object({
  enabled: z.boolean().default(false).describe('Enable SLA-based escalation for this node'),
  timeoutHours: z.number().min(1).describe('Hours before escalation triggers'),
  action: z.enum(['reassign', 'auto_approve', 'auto_reject', 'notify']).default('notify')
    .describe('Action on escalation timeout'),
  // Escalation hands the request to a role (the common case — e.g. a manager
  // role or an approvals queue owner); the Studio designer renders a role
  // picker, but free text is still accepted for a specific user id.
  escalateTo: z.string().optional().meta({
    description: 'User id, role, or manager level to escalate to',
    xRef: { kind: 'role' },
  }),
  notifySubmitter: z.boolean().default(true).describe('Notify the original submitter on escalation'),
}));
export type ApprovalEscalation = z.infer<typeof ApprovalEscalationSchema>;

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
export const ApprovalNodeConfigSchema = lazySchema(() => z.object({
  /** Who may act on this step. */
  approvers: z.array(ApprovalNodeApproverSchema).min(1).describe('Allowed approvers for this node'),

  /** How multiple approvers combine. (Enterprise adds quorum/weighted — ADR-0019 tiering.) */
  behavior: z.enum(['first_response', 'unanimous']).default('first_response')
    .describe('How to combine multiple approvers'),

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
export type ApprovalNodeConfig = z.infer<typeof ApprovalNodeConfigSchema>;

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
