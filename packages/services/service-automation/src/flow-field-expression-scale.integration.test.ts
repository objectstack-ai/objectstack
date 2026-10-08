// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The end-to-end oracle for the issue behind commit 815585513 — the hotcrm quote-flow shape (hotcrm#1206),
 * reproduced in-tree because that repo is out of reach from here: a flow
 * computes a discounted money value (`180000 * (1 - 30/100)` =
 * `125999.99999999999`) and writes it into a `scale: 2` field.
 *
 * The field is a `number`, not the `currency` hotcrm#1206 declares: #19629
 * retired `scale` from the `currency` type (refused at parse, and no longer
 * enforced on currency writes), so a currency field can no longer be the gate
 * this oracle needs. The subject — a flow-computed value lands within the
 * declared `scale` of the field it is written to — is unchanged.
 *
 * Real stack end to end: ObjectKernel + ObjectQLPlugin + better-sqlite3
 * `:memory:` driver + AutomationServicePlugin — so the #7501 `scale`
 * enforcement in ObjectQL's record validator is the REAL gate the write must
 * pass, and every assertion below reads the PERSISTED row, never the
 * expression result.
 *
 * Since #19939 retired the `{…}` template dialect from the value slots (the C
 * half of #11182 ruling D), every value here is a CEL value envelope — the one
 * value dialect left:
 *
 *  - negative control: the raw product is refused (`max_scale`) — proves the
 *    oracle's gate is live in this harness, not assumed;
 *  - oracle: `round(x * 100.0) / 100.0` lands `126000` in the field. The
 *    decimal points are load-bearing: CEL's `round()` returns an int and
 *    `int / int` is INTEGER division, so `round(x * 100) / 100` would drop
 *    the cents of any value that has them;
 *  - the same pattern through the `assignment` surface
 *    (`config.assignments`) — the third value-producing surface the issue
 *    names — persists identically;
 *  - the LOUD half: an unknown function (`ROUND`) never reaches a run — the
 *    envelope is refused at registration with a did-you-mean, and so is the
 *    retired template spelling of the same value — so nothing is written as
 *    `undefined`.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { ObjectKernel } from '@objectstack/core';
import { ObjectQLPlugin, type ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { AutomationServicePlugin } from './plugin.js';
import type { AutomationEngine } from './engine.js';
import { VALUE_SLOT_TEMPLATE_REFUSAL } from '@objectstack/spec/automation';

function makeSqliteDriver() {
    return new SqlDriver({
        client: 'better-sqlite3',
        connection: { filename: ':memory:' },
        useNullAsDefault: true,
    });
}

/** The quote shape: a `scale: 2` total (a `number` — see the header on `currency`). */
const quote = {
    name: 'quote',
    label: 'Quote',
    fields: {
        title: { name: 'title', label: 'Title', type: 'text' },
        total: { name: 'total', label: 'Total', type: 'number', scale: 2 },
    },
};

/** start → create_record(quote) → end, computing `total` from flow inputs. */
const quoteFlow = (name: string, total: unknown, extraNodes: any[] = [], extraEdges: any[] = []) => ({
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
        { id: 'mk', type: 'create_record', label: 'Create', config: { objectName: 'quote', fields: { title: name, total } } },
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

/** A CEL value envelope — the value dialect of `fields.*` / `assignments.*` since #19939. */
const cel = (source: string) => ({ dialect: 'cel', source });

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
        automation.registerFlow('raw', quoteFlow('raw', cel('amount * (1.0 - discount / 100.0)')) as any);

        const res = await automation.execute('raw', { userId: 'u1', params: { ...INPUTS } });
        expect(res.success, `the unrounded 125999.99999999999 must be refused: ${JSON.stringify(res)}`).toBe(false);
        // #7501's max_scale refusal, in its user-facing wording — the raw
        // product carries 11 decimal places against the declared 2.
        expect(JSON.stringify(res)).toContain('must have at most 2 decimal places (got 11)');
        expect(await quoteByTitle('raw'), 'no row may persist from the refused write').toBeFalsy();
    });

    it('ORACLE: round(x * 100.0) / 100.0 writes 126000 into the scale-2 total field, end to end', async () => {
        await boot();
        automation.registerFlow(
            'rounded',
            quoteFlow('rounded', cel('round(amount * (1.0 - discount / 100.0) * 100.0) / 100.0')) as any,
        );

        const res = await automation.execute('rounded', { userId: 'u1', params: { ...INPUTS } });
        expect(res.success, `run failed: ${JSON.stringify(res)}`).toBe(true);

        const row = await quoteByTitle('rounded');
        expect(row, 'the quote row must persist').toBeTruthy();
        // The PERSISTED value — not the expression result.
        expect(row!.total).toBe(126000);
    });

    it('the assignment surface computes the same rounded value (config.assignments → the CEL envelope)', async () => {
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
                { id: 'calc', type: 'assignment', label: 'Calc', config: { assignments: { discounted: cel('round(amount * (1.0 - discount / 100.0) * 100.0) / 100.0') } } },
                { id: 'mk', type: 'create_record', label: 'Create', config: { objectName: 'quote', fields: { title: 'via_assignment', total: cel('discounted') } } },
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

    it('LOUD half: an unknown function never reaches a run — refused at registration, with the name it meant', async () => {
        await boot();
        // The CEL spelling: the envelope's own CEL check names the function.
        // (Before commit 815585513 the template spelling wrote the field as
        // `undefined`; then it failed the run by name; now nothing registers.)
        expect(() => automation.registerFlow(
            'shouty',
            quoteFlow('shouty', cel('ROUND(amount * (1.0 - discount / 100.0), 2)')) as any,
        )).toThrow(/ROUND/);
        // The retired template spelling of the same value is refused too, with
        // the CEL spelling to write instead.
        expect(() => automation.registerFlow(
            'shouty_template',
            quoteFlow('shouty_template', '{ROUND(amount * (1 - discount / 100), 2)}') as any,
        )).toThrow(VALUE_SLOT_TEMPLATE_REFUSAL);
        expect(await quoteByTitle('shouty')).toBeFalsy();
    });
});
