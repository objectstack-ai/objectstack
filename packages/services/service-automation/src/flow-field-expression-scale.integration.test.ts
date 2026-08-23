// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #11060 end-to-end oracle — the hotcrm quote-flow shape (hotcrm#1206),
 * reproduced in-tree because that repo is out of reach from here: a flow
 * computes a discounted money value (`180000 * (1 - 30/100)` =
 * `125999.99999999999`) and writes it into a `scale: 2` currency field.
 *
 * Real stack end to end: ObjectKernel + ObjectQLPlugin + better-sqlite3
 * `:memory:` driver + AutomationServicePlugin — so the #7501 `scale`
 * enforcement in ObjectQL's record validator is the REAL gate the write must
 * pass, and every assertion below reads the PERSISTED row, never the
 * expression result.
 *
 *  - negative control: the raw product is refused (`max_scale`) — proves the
 *    oracle's gate is live in this harness, not assumed;
 *  - oracle: `round(x * 100) / 100` (the CEL-identical authoring pattern)
 *    lands `126000` in the field;
 *  - the same pattern through the `assignment` surface
 *    (`config.assignments`) — the third value-producing surface the issue
 *    names — persists identically;
 *  - the LOUD half: an unknown function (`ROUND`) fails the run with a named
 *    error INSTEAD of writing `undefined`, and a `fault` edge cannot swallow
 *    it (#3863 guard refusal).
 */

import { describe, it, expect, afterEach } from 'vitest';
import { ObjectKernel } from '@objectstack/core';
import { ObjectQLPlugin, type ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { AutomationServicePlugin } from './plugin.js';
import type { AutomationEngine } from './engine.js';

function makeSqliteDriver() {
    return new SqlDriver({
        client: 'better-sqlite3',
        connection: { filename: ':memory:' },
        useNullAsDefault: true,
    });
}

/** The quote shape: a `scale: 2` currency field, as hotcrm#1206 declares it. */
const quote = {
    name: 'quote',
    label: 'Quote',
    fields: {
        title: { name: 'title', label: 'Title', type: 'text' },
        total: { name: 'total', label: 'Total', type: 'currency', scale: 2 },
    },
};

/** start → create_record(quote) → end, computing `total` from flow inputs. */
const quoteFlow = (name: string, totalExpr: string, extraNodes: any[] = [], extraEdges: any[] = []) => ({
    name,
    label: name,
    type: 'autolaunched',
    runAs: 'system',
    variables: [
        { name: 'amount', type: 'number', isInput: true },
        { name: 'discount', type: 'number', isInput: true },
    ],
    nodes: [
        { id: 'start', type: 'start', label: 'Start' },
        { id: 'mk', type: 'create_record', label: 'Create', config: { objectName: 'quote', fields: { title: name, total: totalExpr } } },
        { id: 'end', type: 'end', label: 'End' },
        ...extraNodes,
    ],
    edges: [
        { id: 'e1', source: 'start', target: 'mk' },
        { id: 'e2', source: 'mk', target: 'end' },
        ...extraEdges,
    ],
});

const INPUTS = { amount: 180000, discount: 30 };

describe('flow-computed money lands within its declared scale (#11060, oracle for hotcrm#1206)', () => {
    let kernel: ObjectKernel;
    let ql: ObjectQL;
    let automation: AutomationEngine;

    afterEach(async () => {
        try { await kernel?.shutdown(); } catch { /* noop */ }
    });

    async function boot() {
        kernel = new ObjectKernel({ logger: { level: 'fatal' } });
        await kernel.use(new ObjectQLPlugin());
        await kernel.use(new AutomationServicePlugin({ suspendedRunStore: 'memory' }));
        await kernel.bootstrap();

        ql = kernel.getService<ObjectQL>('objectql');
        automation = kernel.getService<AutomationEngine>('automation');

        const driver = makeSqliteDriver();
        await driver.connect();
        ql.registerDriver(driver, true);
        ql.registry.registerObject(quote as any, 'scale-test', 'scale-test');
        await ql.syncSchemas();
    }

    const quoteByTitle = (title: string) =>
        ql.findOne('quote', { where: { title }, context: { isSystem: true } });

    it('NEGATIVE CONTROL: the raw product is refused by scale enforcement — the gate is live in this harness', async () => {
        await boot();
        automation.registerFlow('raw', quoteFlow('raw', '{amount * (1 - discount / 100)}') as any);

        const res = await automation.execute('raw', { userId: 'u1', params: { ...INPUTS } });
        expect(res.success, `the unrounded 125999.99999999999 must be refused: ${JSON.stringify(res)}`).toBe(false);
        // #7501's max_scale refusal, in its user-facing wording — the raw
        // product carries 11 decimal places against the declared 2.
        expect(JSON.stringify(res)).toContain('must have at most 2 decimal places (got 11)');
        expect(await quoteByTitle('raw'), 'no row may persist from the refused write').toBeFalsy();
    });

    it('ORACLE: round(x * 100) / 100 writes 126000 into the scale-2 currency field, end to end', async () => {
        await boot();
        automation.registerFlow(
            'rounded',
            quoteFlow('rounded', '{round(amount * (1 - discount / 100) * 100) / 100}') as any,
        );

        const res = await automation.execute('rounded', { userId: 'u1', params: { ...INPUTS } });
        expect(res.success, `run failed: ${JSON.stringify(res)}`).toBe(true);

        const row = await quoteByTitle('rounded');
        expect(row, 'the quote row must persist').toBeTruthy();
        // The PERSISTED value — not the expression result.
        expect(row.total).toBe(126000);
    });

    it('the assignment surface computes the same rounded value (config.assignments → interpolate)', async () => {
        await boot();
        const flow = {
            name: 'via_assignment',
            label: 'via_assignment',
            type: 'autolaunched',
            runAs: 'system',
            variables: [
                { name: 'amount', type: 'number', isInput: true },
                { name: 'discount', type: 'number', isInput: true },
            ],
            nodes: [
                { id: 'start', type: 'start', label: 'Start' },
                { id: 'calc', type: 'assignment', label: 'Calc', config: { assignments: { discounted: '{round(amount * (1 - discount / 100) * 100) / 100}' } } },
                { id: 'mk', type: 'create_record', label: 'Create', config: { objectName: 'quote', fields: { title: 'via_assignment', total: '{discounted}' } } },
                { id: 'end', type: 'end', label: 'End' },
            ],
            edges: [
                { id: 'e1', source: 'start', target: 'calc' },
                { id: 'e2', source: 'calc', target: 'mk' },
                { id: 'e3', source: 'mk', target: 'end' },
            ],
        };
        automation.registerFlow('via_assignment', flow as any);

        const res = await automation.execute('via_assignment', { userId: 'u1', params: { ...INPUTS } });
        expect(res.success, `run failed: ${JSON.stringify(res)}`).toBe(true);
        expect((await quoteByTitle('via_assignment'))?.total).toBe(126000);
    });

    it('LOUD half: an unknown function fails the run with a NAMED error — and a fault edge cannot swallow it', async () => {
        await boot();
        // The fault edge routes ordinary runtime failures; #3863 guard
        // refusals — metadata defects like this one — must NOT route, or one
        // edge would turn the diagnostic back into the silence it replaces.
        automation.registerFlow(
            'shouty',
            quoteFlow(
                'shouty',
                '{ROUND(amount * (1 - discount / 100), 2)}',
                [{ id: 'recover', type: 'assignment', label: 'Recover', config: { assignments: { swallowed: 'yes' } } }],
                [{ id: 'f1', source: 'mk', target: 'recover', type: 'fault' }],
            ) as any,
        );

        const res = await automation.execute('shouty', { userId: 'u1', params: { ...INPUTS } });
        expect(res.success, `the run must FAIL loudly, not route or succeed: ${JSON.stringify(res)}`).toBe(false);
        const dump = JSON.stringify(res);
        expect(dump).toContain("unknown function 'ROUND'");
        expect(dump).toContain('round'); // the did-you-mean prescription travels with the failure
        // Nothing persisted — before #11060 this wrote the field as undefined.
        expect(await quoteByTitle('shouty')).toBeFalsy();
    });
});
