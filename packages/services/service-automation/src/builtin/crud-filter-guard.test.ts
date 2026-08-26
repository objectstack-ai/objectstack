// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, beforeEach } from 'vitest';
import { AutomationEngine } from '../engine.js';
import { registerCrudNodes } from './crud-nodes.js';
import { interpolateFilter } from './template.js';
import { assertEngineFindOnePredicate } from '@objectstack/metadata-core';

/**
 * framework#3810 — a flow filter must never silently widen.
 *
 * The flow interpolator expresses "this token did not resolve" as `undefined`.
 * Everywhere else that is harmless; in a FILTER it removes a condition, and a
 * removed condition matches MORE rows. When it was the only condition,
 * `{ owner: '{record.ownr}' }` became `{}` — and `{}` handed to `deleteMany` is
 * every row in the table. One mistyped field name emptied the object, silently.
 *
 * Two independent fixes are covered here:
 *   1. Filter placeholders (`{current_user_id}`, `{current_year_start}`) are
 *      passed through to the query engine, which owns that dialect.
 *   2. Anything else that fails to resolve — a typo, a missing input, a lookup
 *      hop — refuses the node instead of executing a widened query.
 */

function createTestLogger(): any {
    return { info: () => {}, warn: () => {}, error: () => {}, debug: () => {}, child: () => createTestLogger() };
}

/** A data engine stub that records the `where` each verb actually received. */
function fakeData() {
    const seen: { find?: any; update?: any; delete?: any } = {};
    const service = {
        find: async (_o: string, q: any) => { seen.find = q.where; return []; },
        findOne: async (_o: string, q: any) => {
                                                 assertEngineFindOnePredicate(_o, q); seen.find = q.where; return null; },
        update: async (_o: string, _d: any, o: any) => { seen.update = o?.where; return { modified: 1 }; },
        delete: async (_o: string, o: any) => { seen.delete = o?.where; return { deleted: 1 }; },
        getObject: () => ({ name: 'deal', fields: {} }),
    };
    return { service, seen };
}

function ctxWith(data: any): any {
    return {
        logger: createTestLogger(),
        getService(name: string) {
            if (name === 'data') return data;
            return undefined;
        },
    };
}

function crudFlow(nodeType: string, config: Record<string, unknown>) {
    return {
        name: 'crud_flow',
        label: 'CRUD Flow',
        type: 'autolaunched' as const,
        // Explicit so the ADR-0049 runAs gate (#3760) does not reject the data
        // op first — these tests are about the filter guard, and a refusal for
        // the wrong reason would make the negative cases pass vacuously.
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

describe('interpolateFilter — filter placeholders are handed to the engine (#3810)', () => {
    const vars = new Map<string, unknown>([['record', { id: 'r1', owner: 'usr_7' }]]);
    const ctx = { userId: 'usr_1' } as any;

    it('passes a date macro through verbatim', () => {
        expect(interpolateFilter({ close_date: { $gte: '{current_year_start}' } }, vars, ctx))
            .toEqual({ close_date: { $gte: '{current_year_start}' } });
    });

    it('passes a parameterised macro and a context token through verbatim', () => {
        expect(interpolateFilter({ a: '{30_days_ago}', b: '{current_user_id}' }, vars, ctx))
            .toEqual({ a: '{30_days_ago}', b: '{current_user_id}' });
    });

    it('still resolves flow variables', () => {
        expect(interpolateFilter({ owner: '{record.owner}' }, vars, ctx)).toEqual({ owner: 'usr_7' });
    });

    it('mixes both dialects in one filter', () => {
        expect(
            interpolateFilter({ owner: '{record.owner}', close_date: { $gte: '{current_year_start}' } }, vars, ctx),
        ).toEqual({ owner: 'usr_7', close_date: { $gte: '{current_year_start}' } });
    });

    it('a flow variable still shadows a same-named placeholder', () => {
        // Precedence guard: a template that resolves today must not start
        // meaning something else.
        const shadowed = new Map<string, unknown>([['current_user_id', 'from_flow_var']]);
        expect(interpolateFilter({ owner: '{current_user_id}' }, shadowed, ctx))
            .toEqual({ owner: 'from_flow_var' });
    });

    it('leaves a non-placeholder unresolved token as undefined for the guard to catch', () => {
        expect(interpolateFilter({ owner: '{record.ownr}' }, vars, ctx)).toEqual({ owner: undefined });
    });
});

describe('crud nodes — refuse a filter that lost a condition (#3810)', () => {
    let engine: AutomationEngine;
    let data: ReturnType<typeof fakeData>;

    beforeEach(() => {
        data = fakeData();
        engine = new AutomationEngine(createTestLogger());
        registerCrudNodes(engine, ctxWith(data.service));
    });

    it('delete_record: a typo\'d field name refuses instead of emptying the object', async () => {
        engine.registerFlow('crud_flow', crudFlow('delete_record', {
            objectName: 'deal',
            filter: { owner: '{record.ownr}' },
        }));

        const result = await engine.execute('crud_flow', { record: { id: 'r1', owner: 'usr_7' } } as any);

        expect(result.success).toBe(false);
        expect(result.error).toContain('{record.ownr}');
        expect(result.error).toMatch(/deleted it|every remaining row/);
        expect(data.seen.delete).toBeUndefined();
    });

    it('update_record: a missing input variable refuses instead of overwriting everything', async () => {
        engine.registerFlow('crud_flow', crudFlow('update_record', {
            objectName: 'deal',
            filter: { owner: '{someInputNeverSet}' },
            fields: { title: 'x' },
        }));

        const result = await engine.execute('crud_flow');

        expect(result.success).toBe(false);
        expect(result.error).toContain('{someInputNeverSet}');
        expect(data.seen.update).toBeUndefined();
    });

    it('refuses when only SOME conditions are lost — a partial filter still widens', async () => {
        engine.registerFlow('crud_flow', crudFlow('delete_record', {
            objectName: 'deal',
            filter: { status: 'open', owner: '{record.ownr}' },
        }));

        const result = await engine.execute('crud_flow', { record: { id: 'r1', owner: 'usr_7' } } as any);

        expect(result.success).toBe(false);
        expect(data.seen.delete).toBeUndefined();
    });

    it('names the lookup hop and points at config.expand', async () => {
        engine.registerFlow('crud_flow', crudFlow('delete_record', {
            objectName: 'deal',
            filter: { owner: '{record.account.name}' },
        }));

        const result = await engine.execute('crud_flow', { record: { id: 'r1', account: 'acc_1' } } as any);

        expect(result.success).toBe(false);
        expect(result.error).toContain('expand');
    });

    it('a filter placeholder is NOT treated as erased — it reaches the engine', async () => {
        engine.registerFlow('crud_flow', crudFlow('delete_record', {
            objectName: 'deal',
            filter: { close_date: { $lt: '{current_year_start}' } },
        }));

        const result = await engine.execute('crud_flow', { record: { id: 'r1' } } as any);

        expect(result.success).toBe(true);
        // Handed on verbatim; the query engine owns the expansion.
        expect(data.seen.delete).toEqual({ close_date: { $lt: '{current_year_start}' } });
    });

    it('a fully-resolvable filter still runs untouched', async () => {
        engine.registerFlow('crud_flow', crudFlow('delete_record', {
            objectName: 'deal',
            filter: { owner: '{record.owner}' },
        }));

        const result = await engine.execute('crud_flow', { record: { id: 'r1', owner: 'usr_7' } } as any);

        expect(result.success).toBe(true);
        expect(data.seen.delete).toEqual({ owner: 'usr_7' });
    });

    it('an intentionally empty filter is still allowed (nothing was erased)', async () => {
        // "Delete everything" must stay expressible — the guard fires on LOSS,
        // not on emptiness, so an author who wrote no filter is unaffected.
        engine.registerFlow('crud_flow', crudFlow('delete_record', { objectName: 'deal', filter: {} }));

        const result = await engine.execute('crud_flow');

        expect(result.success).toBe(true);
        expect(data.seen.delete).toEqual({});
    });
});
