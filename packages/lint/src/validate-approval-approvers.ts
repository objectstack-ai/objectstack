// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Approval-node approver authoring lint (ADR-0090 D3 fallout).
 *
 * The `role` approver type resolves against better-auth's org-membership tier
 * (`sys_member.role`: owner / admin / member) — it is NOT a position. After
 * ADR-0090 D3 renamed `sys_role` → `sys_position`, downstream apps that
 * authored `{ type: 'role', value: 'sales_manager' }` silently route the
 * approval to nobody: the expansion finds no member row, falls back to the
 * `role:sales_manager` literal, and the request waits on an approver that can
 * never act. This rule moves that failure from a stuck request at runtime to
 * a located fix-it at author time.
 *
 * Rules:
 *
 * | Rule                                | Severity | Origin                     |
 * |-------------------------------------|----------|----------------------------|
 * | approval-role-not-membership-tier   | warning  | ADR-0090 D3 (hotcrm class) |
 * | approval-approver-type-unknown      | warning  | contract-first (PD #12)    |
 *
 * Warnings (not errors): a custom better-auth membership tier is legal, and
 * the runtime keeps its literal fallback — but both shapes are near-certainly
 * authoring mistakes, so say it out loud.
 *
 * Pure `(stack) => Finding[]`; accepts the NORMALIZED stack input.
 */

import { ApproverType, APPROVAL_NODE_TYPE } from '@objectstack/spec/automation';

export const APPROVAL_ROLE_NOT_MEMBERSHIP_TIER = 'approval-role-not-membership-tier';
export const APPROVAL_APPROVER_TYPE_UNKNOWN = 'approval-approver-type-unknown';

export type ApprovalApproverSeverity = 'error' | 'warning' | 'info';

export interface ApprovalApproverFinding {
  severity: ApprovalApproverSeverity;
  /** Diagnostic rule id (`approval-*`). */
  rule: string;
  /** Human-readable location, e.g. `flow "expense_approval" · node "step1"`. */
  where: string;
  /** Config path, e.g. `flows[0].nodes[2].config.approvers[0]`. */
  path: string;
  /** What is wrong. */
  message: string;
  /** How to fix it. */
  hint: string;
}

type AnyRec = Record<string, unknown>;

/**
 * The better-auth org-membership tiers `sys_member.role` actually stores
 * (see `identity/organization.zod.ts` + `mapMembershipRole`). Anything else
 * authored as `{ type: 'role' }` is almost certainly a position name.
 */
const MEMBERSHIP_TIERS = new Set(['owner', 'admin', 'member', 'guest']);

/** Off-spec dialect spellings we can name a canonical fix for. */
const TYPE_FIX: Record<string, string> = {
  business_unit: 'department',
  bu: 'department',
};

/** Coerce a collection (array or name-keyed map) to an array of records. */
function asArray(v: unknown): AnyRec[] {
  if (Array.isArray(v)) return v as AnyRec[];
  if (v && typeof v === 'object') {
    return Object.entries(v as AnyRec).map(([name, def]) => ({ name, ...(def as AnyRec) }));
  }
  return [];
}

/**
 * Validate the approvers of every Approval node in the stack's flows.
 * Returns findings (empty = clean).
 */
export function validateApprovalApprovers(stack: AnyRec): ApprovalApproverFinding[] {
  const findings: ApprovalApproverFinding[] = [];
  if (!stack || typeof stack !== 'object') return findings;

  const flows = asArray(stack.flows);
  const validTypes = new Set<string>(ApproverType.options);

  for (let fi = 0; fi < flows.length; fi++) {
    const flow = flows[fi];
    if (!flow || typeof flow !== 'object') continue;
    const flowName = typeof flow.name === 'string' ? flow.name : `(flow ${fi})`;
    const nodes = Array.isArray(flow.nodes) ? (flow.nodes as AnyRec[]) : [];

    for (let ni = 0; ni < nodes.length; ni++) {
      const node = nodes[ni];
      if (!node || node.type !== APPROVAL_NODE_TYPE) continue;
      const nodeId = typeof node.id === 'string' ? node.id : `(node ${ni})`;
      const cfg = (node.config ?? {}) as AnyRec;
      const approvers = Array.isArray(cfg.approvers) ? (cfg.approvers as AnyRec[]) : [];
      const where = `flow "${flowName}" · node "${nodeId}"`;

      for (let ai = 0; ai < approvers.length; ai++) {
        const a = approvers[ai];
        if (!a || typeof a !== 'object') continue;
        const type = typeof a.type === 'string' ? a.type : '';
        const value = typeof a.value === 'string' ? a.value : '';
        const path = `flows[${fi}].nodes[${ni}].config.approvers[${ai}]`;

        if (type && !validTypes.has(type)) {
          const fix = TYPE_FIX[type];
          findings.push({
            severity: 'warning',
            rule: APPROVAL_APPROVER_TYPE_UNKNOWN,
            where,
            path: `${path}.type`,
            message:
              `approver type '${type}' is not an ApproverType (${ApproverType.options.join(' | ')}).`,
            hint: fix
              ? `Use the spec value: { type: '${fix}', value: '${value}' }.`
              : `Pick one of the spec values; unmapped types degrade to an inert '${type}:${value}' literal at runtime.`,
          });
          continue;
        }

        if (type === 'role' && value && !MEMBERSHIP_TIERS.has(value.toLowerCase())) {
          findings.push({
            severity: 'warning',
            rule: APPROVAL_ROLE_NOT_MEMBERSHIP_TIER,
            where,
            path: `${path}.value`,
            message:
              `approver { type: 'role', value: '${value}' } resolves against the better-auth ` +
              `org-membership tier (sys_member.role: owner/admin/member) — '${value}' is not a ` +
              `membership tier, so this approver matches nobody and the request stalls.`,
            hint:
              `If '${value}' is an org position, author { type: 'position', value: '${value}' } ` +
              `(resolved via sys_user_position, ADR-0090 D3). Keep type 'role' only for ` +
              `membership tiers (owner/admin/member).`,
          });
        }
      }
    }
  }

  return findings;
}
