// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * **Bulk intent on `update_record` / `delete_record` (#5393)** — the flow
 * language's declaration that a write may touch every row its filter matches,
 * and the executor wiring that turns the declaration into `options.multi` on
 * the data-engine call.
 *
 * ## What was actually broken
 *
 * `DeleteRecordConfigSchema` / `UpdateRecordConfigSchema` are `strictObject`s
 * and neither declared ANY spelling of bulk intent, while the CRUD executors
 * never passed `options.multi`. The engine's contract
 * (`resolveEngineDeleteDispatch`, and `engine.ts`'s twin for update) accepts a
 * write only when `where.id` is a scalar OR `options.multi` is truthy, and
 * throws otherwise. So a predicate `delete_record` was unreachable from any
 * flow in any app — while the node descriptor said `Delete Records` /
 * `Delete records matching a filter.` That is declared ≠ enforced (PD #10),
 * and #5225's showcase sweep flow was the site it surfaced at.
 *
 * ## Why this file's delete double is PINNED and the update one is not
 *
 * The reason the break survived a fully green suite is the #5197 detector
 * blind spot: `run-summary.test.ts`'s inline `async delete() { return false; }`
 * accepts a predicate delete the real engine refuses, and — taking zero
 * parameters — is not even discoverable by
 * `scripts/check-engine-double-contract.mjs`, whose `isEngineDeleteShape`
 * requires the engine's `(object, options)` arity. A test written the same way
 * would re-close the same eye, so this file's `delete` opens with
 * `assertEngineDeleteDispatch` — the producer's OWN predicate, imported from
 * `@objectstack/objectql` — and therefore cannot be looser than the engine on
 * any input, including the `id: { $in: [...] }` case a hand-mirrored `if`
 * always drops.
 *
 * `update` has no such shared predicate: objectql keeps its update dispatch
 * inline at `engine.ts` (`throw new Error('Update requires an ID or
 * options.multi=true')`), and `check-engine-double-contract.mjs` names "update's
 * twin dispatch" as deliberately out of its slice pending that extraction. So
 * the update cases below assert exactly what the EXECUTOR owes — the options
 * bag it hands the engine — and deliberately state no second opinion about
 * what the engine would then accept. Writing a mirrored update guard here
 * would be the second copy of the contract that gate exists to remove.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { assertEngineDeleteDispatch } from '@objectstack/objectql';
import { AutomationEngine } from '../engine.js';
import { registerCrudNodes } from './crud-nodes.js';

function createTestLogger(): any {
    return { info: () => {}, warn: () => {}, error: () => {}, debug: () => {}, child: () => createTestLogger() };
}

/** Rows the fake store holds; every case starts from this shape. */
function seedRows() {
    return [
        { id: 'd1', stage: 'stale', owner: 'usr_7' },
        { id: 'd2', stage: 'stale', owner: 'usr_8' },
        { id: 'd3', stage: 'open', owner: 'usr_7' },
    ];
}

/** Scalar-equality match — enough for these fixtures, no operator dialect. */
function matches(row: Record<string, unknown>, where: Record<string, unknown> | undefined): boolean {
    for (const [k, v] of Object.entries(where ?? {})) {
        if (k.startsWith('$')) throw new Error(`fake driver: unsupported operator ${k}`);
        if (row[k] !== v) return false;
    }
    return true;
}

/**
 * A data engine double whose `delete` is bound to the real engine's dispatch
 * decision, so a call this fixture accepts is a call `ObjectQL.delete` accepts.
 *
 * `update` records the options bag verbatim and returns the `driver.updateMany`
 * contract (`Promise<number>`) for a declared bulk write, the updated row for a
 * by-id write — the shape difference `writtenRowCount` reads.
 */
function pinnedFakeData() {
    let rows = seedRows();
    const calls: { update?: any; delete?: any } = {};
    const service = {
        find: async (_object: string, options: any) => rows.filter((r) => matches(r, options?.where)),
        findOne: async (_object: string, options: any) => rows.find((r) => matches(r, options?.where)) ?? null,
        insert: async (_object: string, data: any) => ({ id: 'new', ...data }),
        update: async (_object: string, data: any, options: any) => {
            calls.update = options;
            const matched = rows.filter((r) => matches(r, options?.where));
            for (const r of matched) Object.assign(r, data);
            // `driver.updateMany` resolves a COUNT; a by-id update resolves the row.
            return options?.multi ? matched.length : matched[0];
        },
        delete: async (_object: string, options: any) => {
            calls.delete = options;
            // The producer's own decision — this line is what makes the double
            // incapable of accepting a call the engine refuses (#4550/#5197).
            const dispatch = assertEngineDeleteDispatch(options);
            if (dispatch.kind === 'by-id') {
                const before = rows.length;
                rows = rows.filter((r) => r.id !== dispatch.id);
                return rows.length < before;
            }
            const matched = rows.filter((r) => matches(r, options?.where));
            rows = rows.filter((r) => !matched.includes(r));
            // `driver.deleteMany` resolves a COUNT.
            return matched.length;
        },
        getObject: () => ({ name: 'deal', fields: {} }),
    };
    return { service, calls, remaining: () => rows };
}

function ctxWith(data: any): any {
    return {
        logger: createTestLogger(),
        getService(name: string) {
            return name === 'data' ? data : undefined;
        },
    };
}

function crudFlow(nodeType: string, config: Record<string, unknown>) {
    return {
        name: 'bulk_flow',
        label: 'Bulk Flow',
        type: 'autolaunched' as const,
        // Explicit so the ADR-0049 runAs gate (#3760) does not refuse the data
        // op first — a refusal for the wrong reason passes the negative cases
        // vacuously.
        runAs: 'system' as const,
        nodes: [
            { id: 'start', type: 'start' as const, label: 'Start' },
            { id: 'op', type: nodeType as any, label: 'Op', config },
            { id: 'end', type: 'end' as const, label: 'End' },
        ],
        edges: [
            { id: 'e1', source: 'start', target: 'op' },
            { id: 'e2', source: 'op', target: 'end' },
        ],
    };
}

describe('delete_record — bulk intent reaches deleteMany, and only when declared (#5393)', () => {
    let engine: AutomationEngine;
    let data: ReturnType<typeof pinnedFakeData>;

    beforeEach(() => {
        data = pinnedFakeData();
        engine = new AutomationEngine(createTestLogger());
        registerCrudNodes(engine, ctxWith(data.service));
    });

    it('a predicate delete WITHOUT `multi` is refused by the engine — the contract, unchanged', async () => {
        engine.registerFlow('bulk_flow', crudFlow('delete_record', {
            objectName: 'deal',
            filter: { stage: 'stale' },
        }) as never);

        const result = await engine.execute('bulk_flow', { event: 'schedule' } as never);

        expect(result.success).toBe(false);
        // The producer's own message, reached through the producer's own predicate.
        expect(result.error).toContain('Delete requires an ID or options.multi=true');
        expect(data.calls.delete).toMatchObject({ multi: false });
        expect(data.remaining()).toHaveLength(3);
    });

    it('the same node WITH `multi: true` reaches deleteMany and reports the row count', async () => {
        engine.registerFlow('bulk_flow', crudFlow('delete_record', {
            objectName: 'deal',
            filter: { stage: 'stale' },
            multi: true,
        }) as never);

        const result = await engine.execute('bulk_flow', { event: 'schedule' } as never);

        expect(result.success).toBe(true);
        expect(data.calls.delete).toMatchObject({ where: { stage: 'stale' }, multi: true });
        expect(data.remaining().map((r) => r.id)).toEqual(['d3']);
        // #4354 — `acted` is the deleted-row count, which is what made a
        // sweep flow's "did it actually delete anything" answerable at all.
        expect(result.summary!.acted).toBe(2);
    });

    it('a scalar-id delete still needs no declaration — the by-id route is untouched', async () => {
        engine.registerFlow('bulk_flow', crudFlow('delete_record', {
            objectName: 'deal',
            filter: { id: '{record.id}' },
        }) as never);

        const result = await engine.execute('bulk_flow', { record: { id: 'd2' } } as never);

        expect(result.success).toBe(true);
        expect(data.calls.delete).toMatchObject({ where: { id: 'd2' }, multi: false });
        expect(data.remaining().map((r) => r.id)).toEqual(['d1', 'd3']);
    });

    it('an `$in` id set is a PREDICATE, not an id — the half a hand-mirrored guard drops', async () => {
        // `where: { id: { $in: [...] } }` looks like an id and is a multi-row
        // predicate. Pinning to the producer's predicate is what makes this
        // case answer correctly here without anyone having remembered it.
        const withoutMulti = crudFlow('delete_record', {
            objectName: 'deal',
            filter: { id: { $in: ['d1', 'd2'] } },
        });
        engine.registerFlow('bulk_flow', withoutMulti as never);

        const refused = await engine.execute('bulk_flow', { event: 'schedule' } as never);
        expect(refused.success).toBe(false);
        expect(refused.error).toContain('Delete requires an ID or options.multi=true');

        engine.registerFlow('bulk_flow', crudFlow('delete_record', {
            objectName: 'deal',
            filter: { id: { $in: ['d1', 'd2'] } },
            multi: true,
        }) as never);
        const accepted = await engine.execute('bulk_flow', { event: 'schedule' } as never);
        expect(accepted.success).toBe(true);
        expect(data.calls.delete).toMatchObject({ multi: true });
    });

    it('`multi: false` written out is the same refusal as leaving it off', async () => {
        engine.registerFlow('bulk_flow', crudFlow('delete_record', {
            objectName: 'deal',
            filter: { stage: 'stale' },
            multi: false,
        }) as never);

        const result = await engine.execute('bulk_flow', { event: 'schedule' } as never);

        expect(result.success).toBe(false);
        expect(result.error).toContain('Delete requires an ID or options.multi=true');
        // The options bag is asserted, not just the refusal: the refusal alone
        // holds whether the executor forwards `multi` or has never heard of it,
        // so a case that stopped at `result.error` would stay green through a
        // revert of the very wiring this file exists to pin.
        expect(data.calls.delete).toMatchObject({ where: { stage: 'stale' }, multi: false });
        expect(data.remaining()).toHaveLength(3);
    });

    it('declaring `multi` does NOT disarm the #3810 erased-condition guard', async () => {
        // The two guards are independent: bulk intent says "many rows are
        // fine", it never says "a condition the author wrote may vanish".
        engine.registerFlow('bulk_flow', crudFlow('delete_record', {
            objectName: 'deal',
            filter: { owner: '{record.ownr}' },
            multi: true,
        }) as never);

        const result = await engine.execute('bulk_flow', { record: { id: 'd1', owner: 'usr_7' } } as never);

        expect(result.success).toBe(false);
        expect(result.error).toContain('{record.ownr}');
        expect(data.calls.delete).toBeUndefined();
        expect(data.remaining()).toHaveLength(3);
    });
});

describe('update_record — the executor forwards the declared bulk intent (#5393)', () => {
    let engine: AutomationEngine;
    let data: ReturnType<typeof pinnedFakeData>;

    beforeEach(() => {
        data = pinnedFakeData();
        engine = new AutomationEngine(createTestLogger());
        registerCrudNodes(engine, ctxWith(data.service));
    });

    it('`multi: true` is handed to the engine as `options.multi`, and `acted` is the row count', async () => {
        engine.registerFlow('bulk_flow', crudFlow('update_record', {
            objectName: 'deal',
            filter: { stage: 'stale' },
            fields: { stage: 'archived' },
            multi: true,
        }) as never);

        const result = await engine.execute('bulk_flow', { event: 'schedule' } as never);

        expect(result.success).toBe(true);
        expect(data.calls.update).toMatchObject({ where: { stage: 'stale' }, multi: true });
        expect(result.summary!.acted).toBe(2);
        expect(data.remaining().filter((r) => r.stage === 'archived')).toHaveLength(2);
    });

    it('an undeclared predicate update forwards `multi: false` — which is what the engine refuses on', async () => {
        // The executor's whole obligation, stated positively: it reports the
        // author's declaration and never invents one. What the engine then does
        // with `multi: false` is the engine's contract (`engine.ts`: `Update
        // requires an ID or options.multi=true`), asserted where it lives.
        engine.registerFlow('bulk_flow', crudFlow('update_record', {
            objectName: 'deal',
            filter: { stage: 'stale' },
            fields: { stage: 'archived' },
        }) as never);

        await engine.execute('bulk_flow', { event: 'schedule' } as never);

        expect(data.calls.update).toMatchObject({ where: { stage: 'stale' }, multi: false });
    });

    it('a by-id update is unchanged — `multi: false`, one row, `acted: 1`', async () => {
        engine.registerFlow('bulk_flow', crudFlow('update_record', {
            objectName: 'deal',
            filter: { id: '{record.id}' },
            fields: { stage: 'won' },
        }) as never);

        const result = await engine.execute('bulk_flow', { record: { id: 'd3' } } as never);

        expect(result.success).toBe(true);
        expect(data.calls.update).toMatchObject({ where: { id: 'd3' }, multi: false });
        expect(result.summary!.acted).toBe(1);
    });
});

describe('both nodes declare bulk intent under ONE name (#5393, PD #12)', () => {
    it('the descriptor form offers `multi` on update_record and delete_record, and nowhere else in the quartet', () => {
        const engine = new AutomationEngine(createTestLogger());
        registerCrudNodes(engine, ctxWith(undefined));

        const propsOf = (t: string) =>
            Object.keys((engine.getActionDescriptor(t)?.configSchema as any)?.properties ?? {});

        expect(propsOf('update_record')).toContain('multi');
        expect(propsOf('delete_record')).toContain('multi');
        // `get_record` bounds rows with `limit`; `create_record` writes one row.
        // Neither dispatches on bulk intent, so offering the key there would be
        // the #3528 shape — a form field nothing reads.
        expect(propsOf('get_record')).not.toContain('multi');
        expect(propsOf('create_record')).not.toContain('multi');
    });
});
