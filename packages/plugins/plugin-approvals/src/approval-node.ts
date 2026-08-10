// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Approval-as-flow-node provider (ADR-0019).
 *
 * Registers an `approval` node executor on the automation engine so an approval
 * rides the one flow engine as a durable-pause node:
 *
 *   1. On entry the node opens a `sys_approval_request` (reusing the mature
 *      approver-resolution / audit / lock / status-mirror machinery) and returns
 *      `{ suspend: true }` — the engine persists the run and stops traversal.
 *   2. A decision (`ApprovalService.decide`) finalizes the request and resumes
 *      the run down the matching `approve` / `reject` out-edge.
 *
 * The approval *state* (request/action rows) stays first-class and owned by this
 * plugin — a flow-run log can't drive an inbox / recall / audit. Only the
 * orchestration (when to pause, which branch to take) moves onto the engine.
 */

import {
  defineActionDescriptor,
  ApprovalNodeConfigSchema,
  getApprovalNodeConfigJsonSchema,
  APPROVAL_NODE_TYPE,
  type ApprovalNodeConfig,
} from '@objectstack/spec/automation';
// [#7135] The full `resolveAuthzContext` envelope — what
// `IApprovalService.openNodeRequest` declares for its context parameter since
// #6523 (the #6206 ruling: no per-site subset contracts).
import type { ExecutionContext } from '@objectstack/spec/kernel';
import type { ApprovalService } from './approval-service.js';
import { registerApprovalReviseNode } from './approval-revise-node.js';

/** Minimal surface of the automation engine this provider depends on. */
export interface ApprovalAutomationSurface {
  registerNodeExecutor(executor: {
    type: string;
    descriptor?: unknown;
    execute(node: any, variables: Map<string, unknown>, context: any): Promise<{
      success: boolean;
      output?: Record<string, unknown>;
      error?: string;
      suspend?: boolean;
      correlation?: string;
      /**
       * #3447 P2: walk this labelled out-edge on normal (non-suspend)
       * completion — how an `onEmptyApprovers: 'auto_approve'` node continues
       * down `approve` without a decision. Mirrors NodeExecutionResult.
       */
      branchLabel?: string;
    }>;
  }): void;
  resume?(runId: string, signal?: { output?: Record<string, unknown>; branchLabel?: string }): Promise<unknown>;
}

interface MinimalLogger {
  info?: (msg: any, ...rest: any[]) => void;
  warn?: (msg: any, ...rest: any[]) => void;
}

const SYSTEM_CTX: ExecutionContext = { isSystem: true, positions: [], permissions: [] };

/**
 * Rebuild the nested object the engine's CEL conditions see from the flow's
 * flat variable Map — dotted keys (`get_rec.record`) become nested paths, so an
 * `expression` approver's `vars.get_rec.record.owner_id` reads exactly like a
 * condition's. Mirrors the engine's own evaluateCondition rebuild; kept local
 * because this plugin deliberately does not depend on service-automation.
 */
function nestVariables(variables: Map<string, unknown>): Record<string, unknown> {
  const vars: Record<string, unknown> = {};
  for (const [key, value] of variables) {
    const segs = key.split('.');
    let cursor = vars;
    for (let i = 0; i < segs.length - 1; i++) {
      if (typeof cursor[segs[i]] !== 'object' || cursor[segs[i]] === null) {
        cursor[segs[i]] = {};
      }
      cursor = cursor[segs[i]] as Record<string, unknown>;
    }
    cursor[segs[segs.length - 1]] = value;
  }
  return vars;
}

/**
 * Register the `approval` node executor on the automation engine, plus the
 * `approval_revise` window the ADR-0044 send-back parks on. Idempotent at the
 * engine level (re-registering replaces). Safe to skip when no automation
 * service is present.
 *
 * The two register together deliberately (#3823): send-back resumes the run
 * down the `revise` edge onto the revise-window node, and `sendBack` refuses a
 * flow whose revise edge targets anything else — so an engine holding the
 * `approval` node without the revise window would accept approvals whose
 * send-back can never run.
 */
export function registerApprovalNode(
  automation: ApprovalAutomationSurface,
  service: ApprovalService,
  logger?: MinimalLogger,
): void {
  registerApprovalReviseNode(automation, logger);
  automation.registerNodeExecutor({
    type: APPROVAL_NODE_TYPE,
    descriptor: defineActionDescriptor({
      type: APPROVAL_NODE_TYPE,
      version: '1.0.0',
      name: 'Approval',
      description: 'Route a record for human approval; suspends the flow until a decision, '
        + 'then continues down the approve / reject branch.',
      icon: 'check-circle',
      category: 'human',
      paradigms: ['flow'],
      source: 'plugin',
      // Human decision: the run suspends here awaiting an external reply.
      supportsPause: true,  // (`isAsync` stood here — retired in #6748, ADR-0049: nothing read it)
      // #3801: this pause is NOT resumable through the generic run-resume
      // route. Continuing an approval is a side effect of a DECISION, and the
      // decision is the thing that must be authorized (the approver slate),
      // recorded (`sys_approval_action`) and mirrored (the status field) —
      // all of which lives in `ApprovalService.decide`. The engine now refuses
      // any resume of an approval suspension that does not carry the service's
      // in-process marker, so "decide via the approvals API, never a raw engine
      // resume" is enforced rather than merely documented.
      resumeAuthority: 'service',
      // Publish the node's config contract (ADR-0018 §configSchema) so the
      // Studio flow designer renders the Approval property form from the engine
      // rather than a hardcoded client form — the engine owns the shape.
      configSchema: getApprovalNodeConfigJsonSchema(),
    }),
    async execute(node, variables, context) {
      const parsed = ApprovalNodeConfigSchema.safeParse(node.config ?? {});
      if (!parsed.success) {
        const msg = parsed.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ');
        return { success: false, error: `Approval node '${node.id}' has invalid config: ${msg}` };
      }
      const config = parsed.data as ApprovalNodeConfig;

      const runId = variables.get('$runId');
      const record = (variables.get('$record') ?? context?.record ?? {}) as Record<string, unknown>;
      const object = (context?.object ?? (record as any)?.object_name) as string | undefined;
      const recordId = (record as any)?.id as string | undefined;

      if (!runId) return { success: false, error: `Approval node '${node.id}': missing $runId` };
      if (!object) return { success: false, error: `Approval node '${node.id}': no target object in context` };
      if (!recordId) return { success: false, error: `Approval node '${node.id}': no record id in $record` };

      // Flow identity comes from engine-seeded variables (`$flowName` /
      // `$flowLabel`) so the request row can carry a human-readable origin;
      // `context.flowName` is a legacy fallback for direct callers.
      const flowName = (variables.get('$flowName') as string | undefined) ?? context?.flowName;
      const flowLabel = variables.get('$flowLabel') as string | undefined;

      try {
        const request = await service.openNodeRequest({
          object,
          recordId: String(recordId),
          runId: String(runId),
          nodeId: node.id,
          config,
          flowName,
          flowLabel,
          nodeLabel: typeof node.label === 'string' ? node.label : undefined,
          submitterId: context?.userId ?? null,
          record,
          organizationId: context?.organizationId ?? context?.tenantId ?? null,
          // #3447 P2: flow variables (nested, as CEL conditions see them) — the
          // `vars.*` root for `expression` approvers; `record` above doubles as
          // their `trigger.*` snapshot root.
          variables: nestVariables(variables),
        }, {
          ...SYSTEM_CTX,
          userId: context?.userId,
          // [#7135] ⚠️ This assertion SURVIVES the annotation widening, and it
          // is `as ExecutionContext` rather than the `as unknown as
          // SharingExecutionContext` double cast it replaces. The sole reason
          // a cast is still needed is `organizationId`, which is not a field
          // of the envelope at ALL — that spelling has its own history (#5858
          // / `check:org-identifier`) and was explicitly held out of this
          // change (#7070), so removing the key here would be a RUNTIME change
          // belonging to that card. Dropping the second hop matters: `as
          // unknown as` erases the value entirely, while a single assertion
          // still requires the literal to be comparable to the envelope, so a
          // `userId: 42` here is once again a compile error.
          organizationId: context?.organizationId,
          tenantId: context?.tenantId,
        } as ExecutionContext);

        // #3447 P2: empty slate + onEmptyApprovers: 'auto_approve' — nobody to
        // ask, no request row. Complete (don't suspend) straight down the
        // `approve` edge; `autoApproved` on the output keeps the waved-through
        // hop distinguishable from a human decision in the run trace.
        if ('autoApproved' in request) {
          logger?.info?.('[approvals] approval node auto-approved (empty approver slate)', {
            node: node.id, run: String(runId),
          });
          return {
            success: true,
            branchLabel: 'approve',
            output: { decision: 'approve', autoApproved: true },
          };
        }

        logger?.info?.('[approvals] approval node suspended run', {
          node: node.id, request: request.id, run: String(runId),
        });
        // Suspend the run; the request id is the correlation key surfaced on
        // the suspended-run record for lookup.
        return { success: true, suspend: true, correlation: request.id };
      } catch (err: any) {
        return { success: false, error: `Approval node '${node.id}': ${err?.message ?? String(err)}` };
      }
    },
  });

  logger?.info?.('[approvals] approval node executor registered');
}
