// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#28861] A flow record (CRUD) node whose write the data engine STORED, but
 * whose parent roll-up summary it could not recompute after it, is the node's
 * success — never a flow refusal for a write that landed.
 *
 * ## The defect, measured on `origin/main` (`2af0ae2a`) before this file
 *
 * `create_record`, `update_record` and `delete_record` folded every throw of
 * `data.insert` / `update` / `delete` into `success: false`, objectql's
 * `SummaryRecomputeError` (`ERR_SUMMARY_RECOMPUTE`, "the triggering records
 * WERE written") among them. No transaction wraps a run, so the write stayed
 * committed while the run failed at that node, every later node unrun, and a
 * caller that re-ran the flow wrote it again.
 *
 * ## What is pinned (seat ruling 6570987196, seat 5's addendum 6567869052)
 *
 * - each node answers the success it answers when every roll-up recomputes:
 *   the same `output`, `outputVariable`, `droppedFields` and `acted` count,
 *   read from the result the refusal carries; the run goes on to its end;
 * - the stale column is logged once per field per process, at `error`, on the
 *   node's logger;
 * - a refusal raised before the write is stored is still the node's failure,
 *   exactly as before (NEGATIVE PIN).
 */

import { describe, it, expect } from 'vitest';
import { assertEngineDeleteDispatch, assertEngineFindOnePredicate, assertEngineUpdateDispatch } from '@objectstack/metadata-core';
import { SummaryRecomputeError } from '@objectstack/objectql';
import { AutomationEngine } from '../engine.js';
import { registerCrudNodes } from './crud-nodes.js';

const CHILD = 'stf_line';
const FAILURES = [{ childObject: CHILD, parentObject: 'stf_order', parentId: 'o1', field: 'line_total', error: new Error('sum over text') }];

function makeLogger(errors: string[]): any {
    const l: any = { info() {}, warn() {}, error(msg: unknown) { errors.push(String(msg)); }, debug() {}, trace() {}, fatal() {} };
    l.child = () => l;
    return l;
}

/** A data engine whose writes apply and then report the stale roll-up, or refuse first on a `refused` payload. */
function makeData() {
    const writes: string[] = [];
    const data: any = {
        async insert(_object: string, fields: any, opts?: any) {
            if (fields?.title === 'refused') {
                throw Object.assign(new Error('You do not have permission to create stf_line'), { code: 'PERMISSION_DENIED', status: 403 });
            }
            writes.push(`insert:${fields.id}`);
            opts?.onFieldsDropped?.({ object: CHILD, fields: ['locked'], reason: 'readonly' });
            throw new SummaryRecomputeError(FAILURES as any, { ...fields });
        },
        async update(_object: string, fields: any, opts?: any) {
            assertEngineUpdateDispatch(fields, opts);
            writes.push(`update:${opts?.where?.id}`);
            throw new SummaryRecomputeError(FAILURES as any, { id: opts?.where?.id, ...fields });
        },
        async delete(_object: string, opts?: any) {
            assertEngineDeleteDispatch(opts);
            writes.push(`delete:${opts?.where?.id}`);
            throw new SummaryRecomputeError(FAILURES as any, { id: opts?.where?.id });
        },
        async find() { return []; },
        async findOne(object: string, query?: any) { assertEngineFindOnePredicate(object, query); return null; },
    };
    return { data, writes };
}

function makeStack() {
    const errors: string[] = [];
    const { data, writes } = makeData();
    const engine = new AutomationEngine(makeLogger([]));
    registerCrudNodes(engine, { logger: makeLogger(errors), getService: (n: string) => (n === 'data' ? data : undefined) } as any);
    return { engine, writes, errors };
}

const node = (id: string, type: string, config: Record<string, unknown>) => ({ id, type, label: id, config });

function registerChain(engine: AutomationEngine, name: string, steps: ReturnType<typeof node>[]) {
    const nodes = [{ id: 'start', type: 'start', label: 'Start' }, ...steps, { id: 'end', type: 'end', label: 'End' }];
    engine.registerFlow(name, {
        name, label: name, type: 'autolaunched',
        nodes,
        edges: nodes.slice(1).map((n, i) => ({ id: `e${i}`, source: nodes[i].id, target: n.id })),
    } as any);
}

describe('[#28861] a record node\'s landed write under a failing roll-up is the node\'s success', () => {
    it('create_record → update_record → delete_record: each lands, the run reaches its end', async () => {
        const { engine, writes, errors } = makeStack();
        registerChain(engine, 'lines', [
            node('mk', 'create_record', { objectName: CHILD, outputVariable: 'line', fields: { id: 'l1', title: 'first' } }),
            node('upd', 'update_record', { objectName: CHILD, filter: { id: { dialect: 'cel', source: 'line.id' } }, fields: { title: 'second' } }),
            node('del', 'delete_record', { objectName: CHILD, filter: { id: 'l1' } }),
        ]);
        const res: any = await engine.execute('lines', { userId: 'u1' });
        expect(res.success, JSON.stringify(res)).toBe(true);
        expect(writes).toEqual(['insert:l1', 'update:l1', 'delete:l1']);
        // The stale column is said once per field per process, at `error`, on
        // the node's logger — three stale writes to one field, one line.
        const stale = errors.filter((l) => l.includes('could not be recomputed'));
        expect(stale).toHaveLength(1);
        expect(stale[0]).toContain('"stf_order.line_total"');
    });

    it('create_record answers the output it answers on a clean write: the record, droppedFields, acted 1', async () => {
        const { engine } = makeStack();
        const executor: any = (engine as any).nodeExecutors.get('create_record');
        const variables = new Map<string, unknown>();
        const out = await executor.execute(
            node('mk', 'create_record', { objectName: CHILD, outputVariable: 'line', fields: { id: 'l2', title: 'x' } }),
            variables,
            { userId: 'u1' },
        );
        expect(out.success).toBe(true);
        expect(out.output).toEqual({ id: 'l2', record: { id: 'l2', title: 'x' }, object: CHILD, droppedFields: ['locked'] });
        expect(out.metrics).toEqual({ acted: 1 });
        expect(variables.get('line')).toEqual({ id: 'l2', title: 'x' });
    });
});

describe('[#28861] a refusal raised before the write is stored is still the node\'s failure (NEGATIVE PIN)', () => {
    it('create_record refused: success false with the refusal carried, nothing written, the run fails', async () => {
        const { engine, writes } = makeStack();
        registerChain(engine, 'refused', [
            node('mk', 'create_record', { objectName: CHILD, fields: { id: 'l9', title: 'refused' } }),
            node('del', 'delete_record', { objectName: CHILD, filter: { id: 'l0' } }),
        ]);
        const res: any = await engine.execute('refused', { userId: 'u1' });
        expect(res.success).toBe(false);
        expect(String(res.error)).toContain('create_record(stf_line) failed');
        expect(writes).toEqual([]);
    });
});
