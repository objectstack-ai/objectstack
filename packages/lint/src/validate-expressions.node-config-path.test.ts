// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #27828 — a flow node's config-value finding carries the slot's key path.
 *
 * `expression-invalid` is what publish refuses a node's config value with
 * (measured on a blank expression in an Update Records value), and its finding
 * was located by its `where` prose alone (`flow 'f' · node 'set' (update_record)
 * update_record field value at config.fields.status`). A draft's
 * `_diagnostics` path was therefore that prose, so Studio's Problems row listed
 * the refusal but could not select the node. The finding now carries the key
 * path in the spelling the edge findings use since #26858
 * (`flows[0].nodes[1].config.fields.status`) beside the unchanged `where` and
 * message.
 */

import { describe, expect, it } from 'vitest';

import { runRuntimeAuthoringRules } from './runtime-gate.js';
import { validateStackExpressions } from './validate-expressions.js';
import type { ExprIssue } from './validate-expressions.js';

type AnyRec = Record<string, unknown>;

const BLANK = { dialect: 'cel', source: '   ' };

const START = { id: 'start', type: 'start', label: 'Start' };
const END = { id: 'end', type: 'end', label: 'End' };

/** An Update Records node whose `status` value is a blank CEL envelope. */
const SET = {
  id: 'set',
  type: 'update_record',
  label: 'Set',
  config: { objectName: 'task', filter: { id: 'x' }, fields: { title: 'kept', status: BLANK } },
};

function flow(nodes: unknown[], extra: AnyRec = {}): AnyRec {
  return {
    name: 'node_cfg',
    label: 'Node config',
    type: 'autolaunched',
    nodes,
    edges: [
      { id: 'e1', source: 'start', target: 'set' },
      { id: 'e2', source: 'set', target: 'end' },
    ],
    ...extra,
  };
}

const onNode = (issues: ExprIssue[], id: string) => issues.filter((i) => i.where.includes(`node '${id}'`));

describe('a flow node config-value finding carries a key path (#27828)', () => {
  it('names the node by its index in the authored list, where and message unchanged', () => {
    const issues = onNode(validateStackExpressions({ flows: [flow([START, SET, END])] }), 'set');
    expect(issues.length).toBeGreaterThan(0);
    for (const i of issues) {
      expect(i.path).toBe('flows[0].nodes[1].config.fields.status');
      expect(i.where).toBe("flow 'node_cfg' · node 'set' (update_record) update_record field value at config.fields.status");
    }
  });

  it('indexes the raw list: a null member before the node does not renumber it', () => {
    const issues = onNode(validateStackExpressions({ flows: [flow([START, null, SET, END])] }), 'set');
    expect(issues.length).toBeGreaterThan(0);
    for (const i of issues) expect(i.path).toBe('flows[0].nodes[2].config.fields.status');
  });

  it('indexes the flow in the stack', () => {
    const clean = { ...flow([START, END]), name: 'clean', edges: [{ id: 'e1', source: 'start', target: 'end' }] };
    const issues = onNode(validateStackExpressions({ flows: [clean, flow([START, SET, END])] }), 'set');
    expect(issues.length).toBeGreaterThan(0);
    for (const i of issues) expect(i.path).toBe('flows[1].nodes[1].config.fields.status');
  });

  it('every node-config arm locates its finding at the slot it judged', () => {
    const nodes = [
      { ...START, config: { condition: 'record.name ==' } },
      // A value slot's retired single-brace token (the template-refusal arm).
      { id: 'tok', type: 'update_record', label: 'Tok', config: { objectName: 'task', filter: { id: 'x' }, fields: { title: '{record.name}' } } },
      // A text slot's single-brace token (the text-slot arm).
      { id: 'say', type: 'notify', label: 'Say', config: { channel: 'email', recipients: ['a@b.c'], title: 'Hi {record.name}', message: 'ok' } },
      // A key the node's contract does not declare (the config-refusal arm).
      { id: 'odd', type: 'end', label: 'Odd', config: { bogusKey: 1 } },
      // A script with no callable (the script arm).
      { id: 'run', type: 'script', label: 'Run', config: {} },
    ];
    const issues = validateStackExpressions({ flows: [flow(nodes, { edges: [] })] });
    const pathsOf = (id: string) => [...new Set(onNode(issues, id).map((i) => i.path))];
    expect(pathsOf('start')).toEqual(['flows[0].nodes[0].config.condition']);
    expect(pathsOf('tok')).toEqual(['flows[0].nodes[1].config.fields.title']);
    expect(pathsOf('say')).toEqual(['flows[0].nodes[2].config.title']);
    expect(pathsOf('odd')).toEqual(['flows[0].nodes[3].config.bogusKey']);
    expect(pathsOf('run')).toEqual(['flows[0].nodes[4].config.function']);
  });

  it('a map-form flows collection has no index to spell, so the finding keeps where alone', () => {
    const { name: _name, ...body } = flow([START, SET, END]);
    const issues = onNode(validateStackExpressions({ flows: { node_cfg: body } }), 'set');
    expect(issues.length).toBeGreaterThan(0);
    for (const i of issues) expect(i.path).toBeUndefined();
  });

  it('a node inside a nested region keeps where alone, as a nested edge does', () => {
    const loop = {
      id: 'each',
      type: 'loop',
      label: 'Each',
      config: {
        collection: { dialect: 'cel', source: '[1, 2]' },
        itemVariable: 'item',
        body: { nodes: [{ ...SET, id: 'inner' }], edges: [] },
      },
    };
    const issues = onNode(
      validateStackExpressions({ flows: [flow([START, loop, END], { edges: [{ id: 'e1', source: 'start', target: 'each' }, { id: 'e2', source: 'each', target: 'end' }] })] }),
      'inner',
    );
    expect(issues.length).toBeGreaterThan(0);
    for (const i of issues) expect(i.path).toBeUndefined();
  });

  it('reaches the publish gate: the refusal is located at the node config value, message unchanged', () => {
    const result = runRuntimeAuthoringRules({ type: 'flow', item: flow([START, SET, END]) });
    const refusals = result.errors.filter((f) => f.rule === 'expression-invalid');
    expect(refusals.length).toBeGreaterThan(0);
    for (const f of refusals) {
      expect(f.path).toMatch(/^flows(\[0\]|\.node_cfg)\.nodes\[1\]\.config\.fields\.status$/);
      expect(f.where).toBe("flow 'node_cfg' · node 'set' (update_record) update_record field value at config.fields.status");
    }
  });
});
