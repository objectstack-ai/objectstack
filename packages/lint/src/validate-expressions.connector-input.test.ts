// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * **`objectstack validate` judges a `connector_action` node's
 * `connectorConfig.input`** (#27968) — the build door's half of the slot
 * `registerFlow` now judges too.
 *
 * The expression pass reads value slots only through the spec's expression
 * ledger, whose paths were rooted in `node.config`; `connectorConfig` is a
 * sibling block, so a malformed CEL envelope, a template-dialect envelope and a
 * `{…}` token string there passed `validateStackExpressions` clean while the
 * same three under a `subflow`'s `config.input` were refused. The ledger now
 * roots the slot in the block, and this pass judges it like every other value
 * slot, located at `connectorConfig.input.<key>`, at `error`. The runtime
 * authoring gate runs the same pass, so a flow write is refused there as well.
 */

import { describe, expect, it } from 'vitest';
import { VALUE_ENVELOPE_REFUSAL, VALUE_SLOT_TEMPLATE_REFUSAL } from '@objectstack/spec/automation';

import { runRuntimeAuthoringRules } from './runtime-gate.js';
import { validateStackExpressions, type ExprIssue } from './validate-expressions.js';

type AnyRec = Record<string, unknown>;

/** start → `node` → end, the record an input variable. */
function flowWith(node: AnyRec): AnyRec {
  return {
    name: 'f',
    label: 'F',
    type: 'autolaunched',
    variables: [{ name: 'rec', type: 'object', isInput: true }],
    nodes: [
      { id: 'start', type: 'start', config: {} },
      { id: 'call', label: 'Call', ...node },
      { id: 'done', type: 'end', config: {} },
    ],
    edges: [{ id: 'e1', source: 'start', target: 'call' }, { id: 'e2', source: 'call', target: 'done' }],
  };
}

const connectorNode = (input: AnyRec): AnyRec => ({
  type: 'connector_action',
  connectorConfig: { connectorId: 'vendor', actionId: 'lookup', input },
});
const subflowNode = (input: AnyRec): AnyRec => ({ type: 'subflow', config: { flowName: 'child', input } });

const errorsOf = (flow: AnyRec): ExprIssue[] =>
  validateStackExpressions({ flows: [flow] }).filter((i) => (i.severity ?? 'error') === 'error');

/** The three shapes the #27327 thread measured passing the build door under `connectorConfig.input`. */
const SHAPES = [
  ['a malformed CEL envelope', { dialect: 'cel', source: 'rec.' }, VALUE_ENVELOPE_REFUSAL],
  ['a template-dialect envelope', { dialect: 'template', source: '{rec.id}' }, VALUE_ENVELOPE_REFUSAL],
  ['a bare `{…}` token string', '{rec.id}', VALUE_SLOT_TEMPLATE_REFUSAL],
] as const;

describe('objectstack validate refuses the three shapes at `connectorConfig.input.<key>`', () => {
  it.each(SHAPES)('%s', (_shape, value, lead) => {
    const found = errorsOf(flowWith(connectorNode({ customerId: value, region: 'eu' })));
    expect(found.map((i) => i.where)).toEqual([
      "flow 'f' · node 'call' (connector_action) connector_action input value at connectorConfig.input.customerId",
    ]);
    expect(found[0]!.message.startsWith(lead)).toBe(true);
    // The same shape under a `subflow`'s input map: the same refusal, at its own position.
    const control = errorsOf(flowWith(subflowNode({ customerId: value })));
    expect(control.map((i) => i.where)).toEqual([
      "flow 'f' · node 'call' (subflow) subflow input value at config.input.customerId",
    ]);
    // The connector's refusal is the subflow's, minus the callee sentence a
    // child flow's input value adds: the action was handed the text, not nothing.
    expect(control[0]!.message.startsWith(found[0]!.message)).toBe(true);
  });

  it('a valid envelope and literals pass', () => {
    expect(errorsOf(flowWith(connectorNode({
      customerId: { dialect: 'cel', source: 'rec.id' },
      region: 'eu',
      body: { filter: { dialect: 'cel', source: 'rec.id' } },
    })))).toEqual([]);
    expect(errorsOf(flowWith({ type: 'connector_action', connectorConfig: { connectorId: 'vendor', actionId: 'lookup' } }))).toEqual([]);
  });

  it('the runtime authoring gate refuses a flow write carrying one, through the same pass', () => {
    const result = runRuntimeAuthoringRules({ type: 'flow', item: flowWith(connectorNode({ customerId: '{rec.id}' })) });
    const refused = result.errors.filter((f) => f.where.includes('connectorConfig.input.customerId'));
    expect(refused.map((f) => f.rule)).toEqual(['expression-invalid']);
    expect(refused[0]!.message.startsWith(VALUE_SLOT_TEMPLATE_REFUSAL)).toBe(true);
  });
});
