// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * A flow node whose `type` no executor runs.
 *
 * `FlowNodeSchema.type` is an open string (ADR-0018: the node vocabulary is
 * plugin-extensible), so the schema refuses only the reserved callout names.
 * A node typed after anything else — most often an AI author's own tool name,
 * `query_records` for a read — parses, publishes, and then fails EVERY run
 * with `NO_EXECUTOR`. The engine notices only in a warning once its
 * vocabulary is sealed, after the flow already shipped.
 *
 * ## Judged against the SEALED vocabulary, never a registry still filling
 *
 * A plugin contributes its node types from its own `init()` / `start()`, so
 * "no executor for `approval`" read during boot is "not registered YET"
 * (AGENTS.md "Startup registry reads"). The rule therefore judges only with
 * the vocabulary its caller hands in, and a caller hands one in only after the
 * host declared it closed: the runtime publish gate reads
 * `AutomationEngine.getSealedNodeTypeVocabulary()`, which answers nothing until
 * `sealNodeTypeVocabulary()` ran at `kernel:bootstrapped`. With no vocabulary —
 * every CLI command, whose stack does not say which plugins the deployment
 * will load, and a gate on an unsealed engine — the rule judges nothing.
 *
 * Every node is visited, region bodies included: a node in a `loop` body runs
 * as surely as one beside it.
 */

import { recordsOf } from './object-graph.js';
import { walkFlowNodes } from './flow-walk.js';

export const FLOW_NODE_TYPE_NO_EXECUTOR = 'flow-node-type-no-executor';

export interface FlowNodeExecutorFinding {
  severity: 'error';
  rule: string;
  where: string;
  path: string;
  message: string;
  hint: string;
}

/**
 * Flag every flow node whose `type` is outside `vocabulary`, the node types the
 * deployment's sealed automation engine runs. Returns nothing when no
 * vocabulary is given.
 */
export function validateFlowNodeExecutors(
  stack: Record<string, unknown>,
  vocabulary: ReadonlySet<string> | undefined,
): FlowNodeExecutorFinding[] {
  const findings: FlowNodeExecutorFinding[] = [];
  if (!vocabulary || vocabulary.size === 0 || !stack || typeof stack !== 'object') return findings;
  const flowList: readonly unknown[] = Array.isArray(stack.flows) ? stack.flows : [];
  for (const flow of recordsOf(stack.flows)) {
    const flowName = typeof flow.name === 'string' ? flow.name : '(unnamed flow)';
    const flowPath = `flows[${Math.max(flowList.indexOf(flow), 0)}]`;
    for (const { node, path } of walkFlowNodes(flow, flowPath)) {
      const type = typeof node.type === 'string' ? node.type : undefined;
      if (!type || vocabulary.has(type)) continue;
      const nodeId = typeof node.id === 'string' ? node.id : path;
      findings.push({
        severity: 'error',
        rule: FLOW_NODE_TYPE_NO_EXECUTOR,
        where: `flow '${flowName}' · node '${nodeId}'`,
        path: `${path}.type`,
        message:
          `Node '${nodeId}' has type '${type}', which no executor in this deployment runs — the flow publishes, ` +
          'and every run that reaches the node fails with NO_EXECUTOR.',
        hint:
          `Use a node type this deployment runs (${[...vocabulary].sort().join(', ')}), or install the plugin ` +
          `that contributes '${type}'.`,
      });
    }
  }
  return findings;
}
