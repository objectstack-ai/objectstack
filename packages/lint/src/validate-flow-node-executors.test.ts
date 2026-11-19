// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, expect, it } from 'vitest';
import { runAuthoringRules } from './authoring-rules.js';
import { runRuntimeAuthoringRules } from './runtime-gate.js';
import { FLOW_NODE_TYPE_NO_EXECUTOR, validateFlowNodeExecutors } from './validate-flow-node-executors.js';

const SEALED = ['start', 'end', 'get_record', 'update_record', 'loop', 'http'];

const flow = (nodes: Array<Record<string, unknown>>) => ({
  name: 'nightly_digest',
  label: 'Nightly digest',
  type: 'schedule',
  nodes: [{ id: 'start', type: 'start', label: 'Start' }, ...nodes, { id: 'end', type: 'end', label: 'End' }],
  edges: [],
});

/** A tool name used as a node type: the shape the rule exists for. */
const TOOL_NAMED = flow([{ id: 'find_open', type: 'query_records', label: 'Find open' }]);

describe('flow-node-type-no-executor', () => {
  it('refuses a node type outside the sealed vocabulary, located on the node, naming the vocabulary', () => {
    const findings = validateFlowNodeExecutors({ flows: [TOOL_NAMED] }, new Set(SEALED));
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      severity: 'error',
      rule: FLOW_NODE_TYPE_NO_EXECUTOR,
      path: 'flows[0].nodes[1].type',
    });
    expect(findings[0].message).toContain("'query_records'");
    expect(findings[0].hint).toContain('get_record');
  });

  it('judges a node in a region body as one beside it', () => {
    const looped = flow([
      { id: 'each', type: 'loop', label: 'Each', config: { collection: 'rows', body: { nodes: [{ id: 'inner', type: 'query_records', label: 'Inner' }] } } },
    ]);
    const findings = validateFlowNodeExecutors({ flows: [looped] }, new Set(SEALED));
    expect(findings.map((f) => f.path)).toEqual(['flows[0].nodes[1].config.body.nodes[0].type']);
  });

  it('is silent on a flow whose every type the vocabulary runs', () => {
    const clean = flow([{ id: 'find_open', type: 'get_record', label: 'Find open' }]);
    expect(validateFlowNodeExecutors({ flows: [clean] }, new Set(SEALED))).toEqual([]);
  });

  it('judges nothing without a sealed vocabulary: the CLI commands hand none in', () => {
    expect(validateFlowNodeExecutors({ flows: [TOOL_NAMED] }, undefined)).toEqual([]);
    for (const command of ['validate', 'build', 'lint'] as const) {
      const rules = runAuthoringRules(command, { normalized: { flows: [TOOL_NAMED] } } as never);
      expect(rules.filter((f) => f.rule === FLOW_NODE_TYPE_NO_EXECUTOR)).toEqual([]);
    }
  });

  it('the runtime publish gate refuses the flow when the host states a sealed vocabulary, and only then', () => {
    const sealed = runRuntimeAuthoringRules({ type: 'flow', item: TOOL_NAMED, flowNodeTypeVocabulary: SEALED });
    expect(sealed.errors.map((f) => f.rule)).toContain(FLOW_NODE_TYPE_NO_EXECUTOR);
    const unsealed = runRuntimeAuthoringRules({ type: 'flow', item: TOOL_NAMED });
    expect([...unsealed.errors, ...unsealed.advisories].map((f) => f.rule)).not.toContain(FLOW_NODE_TYPE_NO_EXECUTOR);
  });
});
