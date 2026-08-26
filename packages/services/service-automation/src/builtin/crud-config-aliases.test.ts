// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Deprecation window for non-canonical `config` keys on the CRUD nodes.
 *
 * Both aliases are now handled at ONE layer — the ADR-0087 D2 conversion layer:
 *  - `filters` → `filter` (`flow-node-crud-filter-alias`), and
 *  - `object` → `objectName` (`flow-node-crud-object-alias`, #3796) — the last
 *    tenant of the `readAliasedConfig` executor shim, deleted with its
 *    graduation.
 *
 * Stored flows are canonicalized on rehydration (`AutomationEngine.registerFlow`
 * runs the conversion before parse), so the executors read the canonical keys
 * directly and a raw alias reaching an executor that skipped the load seam is
 * no longer honored. This test documents that endpoint of the PD #12
 * retirement path.
 *
 * Each run below passes a `userId`: a data-touching flow left at the spec
 * default `runAs:'user'` is refused without a trigger user (#3760). Incidental
 * to what these tests assert — supplied so the run reaches the CRUD node.
 */
import { describe, it, expect } from 'vitest';
import { normalizeStackInput } from '@objectstack/spec';
import { AutomationEngine } from '../engine.js';
import { registerCrudNodes } from './crud-nodes.js';
import { assertEngineFindOnePredicate } from '@objectstack/metadata-core';

function silentLogger(): any {
  const l: any = { info() {}, warn() {}, error() {}, debug() {} };
  l.child = () => l;
  return l;
}

function fakeData() {
  const calls: Array<{ op: string; obj: string; opts?: any }> = [];
  const data: any = {
    async find(obj: string, opts: any) { calls.push({ op: 'find', obj, opts }); return [{ id: 'r1' }]; },
    async findOne(obj: string, opts: any) {
                                            assertEngineFindOnePredicate(obj, opts); calls.push({ op: 'findOne', obj, opts }); return { id: 'r1' }; },
    async insert(obj: string, fields: any) { calls.push({ op: 'insert', obj, opts: { fields } }); return { id: `${obj}_1`, ...fields }; },
    async update(obj: string, fields: any, opts: any) { calls.push({ op: 'update', obj, opts: { ...opts, fields } }); return { ok: true }; },
    async delete(obj: string, opts: any) { calls.push({ op: 'delete', obj, opts }); return { ok: true }; },
  };
  return { data, calls };
}

const ctxWith = (data: any, logger: any): any => ({
  logger,
  getService: (n: string) => (n === 'data' ? data : undefined),
});

function getRecordFlow(config: Record<string, unknown>) {
  return {
    name: 'gr', label: 'G', type: 'autolaunched',
    nodes: [
      { id: 'start', type: 'start', label: 'Start' },
      { id: 'g', type: 'get_record', label: 'Get', config },
      { id: 'end', type: 'end', label: 'End' },
    ],
    edges: [
      { id: 'e1', source: 'start', target: 'g' },
      { id: 'e2', source: 'g', target: 'end' },
    ],
  } as any;
}

describe('CRUD config-key aliases: object→objectName + filters→filter (load-time conversions)', () => {
  it('a stored `object` flow is canonicalized at registerFlow, so the executor resolves the target', async () => {
    // The `object` alias graduation (#3796): what the executor shim used to
    // tolerate at run time is now rewritten on rehydration, before parse.
    const engine = new AutomationEngine(silentLogger());
    const { data, calls } = fakeData();
    registerCrudNodes(engine, ctxWith(data, silentLogger()));

    engine.registerFlow('gr', getRecordFlow({ object: 'crm_lead', filter: { id: 'L1' }, outputVariable: 'lead' }));
    const res = await engine.execute('gr', { userId: 'u1' });

    expect(res.success).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0].obj).toBe('crm_lead');
    expect(calls[0].opts.where).toEqual({ id: 'L1' });
  });

  it('a stored `filters` flow is canonicalized at registerFlow, so the filter is NOT dropped', async () => {
    // Risk-1 regression guard (ADR-0087 D2 runtime load seam). Before the seam
    // was wired, retiring the executor's `filters` fallback meant a stored
    // `delete_record`/`get_record` flow carrying `filters` reached the executor
    // with an empty `filter` — silently widening the query to the whole table.
    // Now `registerFlow` runs the D2 conversion, so `filters`→`filter` happens
    // on rehydration and the stored filter survives.
    const engine = new AutomationEngine(silentLogger());
    const { data, calls } = fakeData();
    registerCrudNodes(engine, ctxWith(data, silentLogger()));

    engine.registerFlow('gr', getRecordFlow({ objectName: 'crm_lead', filters: { id: 'L1' } }));
    await engine.execute('gr', { userId: 'u1' });

    expect(calls[0].opts.where).toEqual({ id: 'L1' }); // filter preserved, not dropped
  });

  it('the same conversions run on the build/validate seam too (normalizeStackInput)', async () => {
    const engine = new AutomationEngine(silentLogger());
    const { data, calls } = fakeData();
    registerCrudNodes(engine, ctxWith(data, silentLogger()));

    const raw = getRecordFlow({ object: 'crm_lead', filters: { id: 'L1' }, outputVariable: 'lead' });
    const converted = (normalizeStackInput({ flows: [raw] }).flows as any[])[0];
    engine.registerFlow('gr', converted);
    await engine.execute('gr', { userId: 'u1' });

    expect(calls[0].obj).toBe('crm_lead');
    expect(calls[0].opts.where).toEqual({ id: 'L1' });
  });

  it('canonical keys pass through the load seam unchanged', async () => {
    const engine = new AutomationEngine(silentLogger());
    const { data, calls } = fakeData();
    registerCrudNodes(engine, ctxWith(data, silentLogger()));

    engine.registerFlow('gr', getRecordFlow({ objectName: 'crm_lead', filter: { id: 'L1' }, outputVariable: 'lead' }));
    const res = await engine.execute('gr', { userId: 'u1' });

    expect(res.success).toBe(true);
    expect(calls[0].obj).toBe('crm_lead');
    expect(calls[0].opts.where).toEqual({ id: 'L1' });
  });
});
