// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #1873 — a `create_record` node's `outputVariable` must expose the created
 * record so a later node can reference `{var.id}` (and other fields). Before the
 * fix the output variable held only the bare id STRING, so `{var.id}` traversed
 * into a string and resolved to empty.
 */
import { describe, it, expect } from 'vitest';
import { AutomationEngine } from '../engine.js';
import { registerCrudNodes } from './crud-nodes.js';

function makeLogger(): any {
  const l: any = { info() {}, warn() {}, error() {}, debug() {} };
  l.child = () => l;
  return l;
}

function fakeData() {
  const updates: Array<{ obj: string; fields: any; opts: any }> = [];
  let n = 0;
  const data: any = {
    async insert(obj: string, fields: any) { n += 1; return { id: `${obj}_${n}`, ...fields }; },
    async update(obj: string, fields: any, opts: any) { updates.push({ obj, fields, opts }); return { ok: true }; },
    async find() { return []; },
    async findOne() { return null; },
  };
  return { data, updates };
}

const ctxWith = (data: any): any => ({ logger: makeLogger(), getService: (n: string) => (n === 'data' ? data : undefined) });

describe('create_record outputVariable (#1873)', () => {
  it('exposes the created record so {var.id} resolves in a later node', async () => {
    const engine = new AutomationEngine(makeLogger());
    const { data, updates } = fakeData();
    registerCrudNodes(engine, ctxWith(data));

    engine.registerFlow('promote', {
      name: 'promote', label: 'P', type: 'autolaunched',
      nodes: [
        { id: 'start', type: 'start', label: 'Start' },
        { id: 'mk', type: 'create_record', label: 'Create', config: { objectName: 'topic', outputVariable: 'topic', fields: { title: 'X' } } },
        { id: 'upd', type: 'update_record', label: 'Update', config: { objectName: 'signal', filter: { id: 'sig1' }, fields: { promoted_topic: '{topic.id}' } } },
        { id: 'end', type: 'end', label: 'End' },
      ],
      edges: [
        { id: 'e1', source: 'start', target: 'mk' },
        { id: 'e2', source: 'mk', target: 'upd' },
        { id: 'e3', source: 'upd', target: 'end' },
      ],
    } as any);

    const res = await engine.execute('promote');
    expect(res.success).toBe(true);
    expect(updates).toHaveLength(1);
    expect(updates[0].fields.promoted_topic).toBe('topic_1');
  });

  it('exposes non-id fields of the created record too ({var.title})', async () => {
    const engine = new AutomationEngine(makeLogger());
    const { data, updates } = fakeData();
    registerCrudNodes(engine, ctxWith(data));
    engine.registerFlow('promote2', {
      name: 'promote2', label: 'P', type: 'autolaunched',
      nodes: [
        { id: 'start', type: 'start', label: 'Start' },
        { id: 'mk', type: 'create_record', label: 'Create', config: { objectName: 'topic', outputVariable: 'topic', fields: { title: 'X' } } },
        { id: 'upd', type: 'update_record', label: 'Update', config: { objectName: 'signal', filter: { id: 'sig1' }, fields: { ref: '{topic.title}' } } },
        { id: 'end', type: 'end', label: 'End' },
      ],
      edges: [
        { id: 'e1', source: 'start', target: 'mk' },
        { id: 'e2', source: 'mk', target: 'upd' },
        { id: 'e3', source: 'upd', target: 'end' },
      ],
    } as any);
    const res = await engine.execute('promote2');
    expect(res.success).toBe(true);
    expect(updates[0].fields.ref).toBe('X');
  });
});
