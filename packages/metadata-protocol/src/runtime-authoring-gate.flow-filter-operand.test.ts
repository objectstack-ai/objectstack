// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The SAVE door's half of the CRUD filter operands (#19939, stage S6).
 *
 * Each operand of a `get_record` / `update_record` / `delete_record` node's
 * `filter` is a value slot: a CEL value envelope evaluated before the query, a
 * query placeholder the query engine resolves, or a literal. A flow `{…}`
 * token at an operand is refused — and this file asks the host's question:
 * does the shipped gate a Studio / REST `/meta` / MCP author's flow publish
 * passes through refuse it, with the door's own envelope (`code`, `status`,
 * a located issue), and let the envelope and the placeholder through?
 *
 * Harness: none. {@link evaluateRuntimeAuthoringGate} is pure by construction
 * (its impure reads arrive as arguments), so nothing about the door is stubbed.
 */
import { describe, expect, it } from 'vitest';
import { VALUE_SLOT_TEMPLATE_REFUSAL } from '@objectstack/spec/automation';

import { evaluateRuntimeAuthoringGate } from './runtime-authoring-gate.js';

const CEL = (source: string) => ({ dialect: 'cel', source });

/** start → one CRUD node with `filter` → end, binding the variable the operands read. */
const crudFlow = (name: string, type: string, filter: Record<string, unknown>) => ({
  name,
  label: 'Door filter probe',
  type: 'autolaunched',
  variables: [{ name: 'owner_id', type: 'text', isInput: true }],
  nodes: [
    { id: 'start', type: 'start', label: 'Start' },
    {
      id: 'op',
      type,
      label: 'Op',
      config: { objectName: 'deal', filter, ...(type === 'update_record' ? { fields: { stage: 'closed' } } : {}) },
    },
    { id: 'end', type: 'end', label: 'End' },
  ],
  edges: [
    { id: 'e1', source: 'start', target: 'op' },
    { id: 'e2', source: 'op', target: 'end' },
  ],
});

const save = (body: { name: string }) =>
  evaluateRuntimeAuthoringGate({
    type: 'flow',
    name: body.name,
    state: 'active',
    body,
    objects: [],
    permissions: [],
    books: [],
    datasets: [],
  });

const TYPES = ['get_record', 'update_record', 'delete_record'] as const;

describe('the save door refuses a flow token at a CRUD filter operand (#19939)', () => {
  it.each(TYPES.flatMap((type) => [
    [type, 'a field\'s value', { owner: '{owner_id}' }, 'config.filter.owner'],
    [type, 'an `$in` element', { id: { $in: ['d1', '{owner_id}'] } }, 'config.filter.id.$in[1]'],
  ] as const))('%s — %s: INVALID_METADATA / 422, the issue located at the operand with its envelope', (type, _what, filter, at) => {
    const verdict = save(crudFlow(`door_filter_${type}`, type, filter));

    expect(verdict.error).not.toBeNull();
    const err = verdict.error as Error & { code?: string; status?: number; issues?: Array<{ rule: string; path?: string; message: string }> };
    expect(err.code).toBe('INVALID_METADATA');
    expect(err.status).toBe(422);
    const issues = (err.issues ?? []).filter((i) => i.message.startsWith(VALUE_SLOT_TEMPLATE_REFUSAL));
    expect(issues).toHaveLength(1);
    expect(issues[0]!.rule).toBe('expression-invalid');
    expect(JSON.stringify(issues[0])).toContain(at);
    expect(issues[0]!.message).toContain("{ dialect: 'cel', source: 'owner_id' }: an operand envelope is evaluated before the query.");
  });

  it.each(TYPES)('%s: an envelope operand, a literal and a query placeholder pass the door', (type) => {
    const verdict = save(crudFlow(`door_filter_ok_${type}`, type, {
      owner: CEL('owner_id'),
      id: { $in: [CEL('owner_id'), 'd2'] },
      creator: '{current_user_id}',
      due: { $lt: '{today}' },
      status: 'open',
    }));
    expect(verdict.error).toBeNull();
  });
});
