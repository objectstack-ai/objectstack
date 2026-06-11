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
import type { SharingExecutionContext } from '@objectstack/spec/contracts';
import type { ApprovalService } from './approval-service.js';

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
    }>;
  }): void;
  resume?(runId: string, signal?: { output?: Record<string, unknown>; branchLabel?: string }): Promise<unknown>;
}

interface MinimalLogger {
  info?: (msg: any, ...rest: any[]) => void;
  warn?: (msg: any, ...rest: any[]) => void;
}

const SYSTEM_CTX = { isSystem: true, roles: [], permissions: [] } as const;

/**
 * Register the `approval` node executor on the automation engine. Idempotent at
 * the engine level (re-registering replaces). Safe to skip when no automation
 * service is present.
 */
export function registerApprovalNode(
  automation: ApprovalAutomationSurface,
  service: ApprovalService,
  logger?: MinimalLogger,
): void {
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
      supportsPause: true,
      isAsync: true,
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
        }, {
          ...SYSTEM_CTX,
          userId: context?.userId,
          organizationId: context?.organizationId,
          tenantId: context?.tenantId,
        } as unknown as SharingExecutionContext);

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
