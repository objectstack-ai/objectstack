// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ObjectStackProtocolImplementation, resetEnvWritableMetadataTypes } from '@objectstack/metadata-protocol';
import { SchemaRegistry } from './registry.js';

/**
 * Phase 3a-destructive: `currency_mode_to_record` (ADR-0144, ruling
 * 6492000994, letter B).
 *
 * An existing stored amount switched to `currencyMode: 'record'` leaves every
 * stored row with an amount and no code. The switch is allowed; the save is
 * answered with the existing 409 `DESTRUCTIVE_CHANGE`, whose finding names the
 * three consequences and the backfill command, and `force: true` lifts it. Like
 * its siblings the finding reads no row: the engine is never asked for the
 * object's data, only the metadata store for the row the save overwrites.
 */
describe('ObjectStackProtocolImplementation - currency_mode_to_record', () => {
    let protocol: ObjectStackProtocolImplementation;
    let mockEngine: any;
    let registry: SchemaRegistry;

    const CODE_FIELD = { name: 'currency_code', type: 'text', valueDomain: 'iso_4217_currency' };
    const RECORD_AMOUNT = {
        name: 'amount', type: 'currency', currencyConfig: { currencyMode: 'record', currencyField: 'currency_code' },
    };

    /** A tenant-authored object (ADR-0131 D6): the population this detector guards. */
    const register = (name: string, fields: Record<string, unknown>) => {
        registry.registerObject({ name, label: name, _provenance: 'org', fields } as any, 'pkg');
    };

    /** The save under test: `name`'s amount now in record mode, beside its code field. */
    const saveRecordMode = (name: string, extra: Record<string, unknown> = {}) => protocol.saveMetaItem({
        type: 'object',
        name,
        ...extra,
        item: {
            name,
            label: name,
            fields: {
                title: { name: 'title', type: 'text' },
                amount: RECORD_AMOUNT,
                currency_code: CODE_FIELD,
            },
        },
    } as any);

    beforeEach(() => {
        registry = new SchemaRegistry({ multiTenant: false });
        register('deal_dynamic', {
            title: { name: 'title', type: 'text' },
            amount: { name: 'amount', type: 'currency', currencyConfig: { currencyMode: 'dynamic' } },
        });
        register('deal_fixed', {
            title: { name: 'title', type: 'text' },
            amount: { name: 'amount', type: 'currency', currencyConfig: { currencyMode: 'fixed', defaultCurrency: 'EUR' } },
        });
        register('deal_unset', {
            title: { name: 'title', type: 'text' },
            amount: { name: 'amount', type: 'currency' },
        });
        register('deal_new_amount', {
            title: { name: 'title', type: 'text' },
        });
        register('deal_record', {
            title: { name: 'title', type: 'text' },
            amount: RECORD_AMOUNT,
            currency_code: CODE_FIELD,
        });

        mockEngine = {
            registry,
            find: vi.fn().mockResolvedValue([]),
            findOne: vi.fn().mockResolvedValue(null),
            insert: vi.fn().mockResolvedValue({ id: 'x' }),
            update: vi.fn().mockResolvedValue({ id: 'x' }),
            delete: vi.fn().mockResolvedValue({ deleted: 1 }),
            count: vi.fn().mockResolvedValue(0),
            aggregate: vi.fn().mockResolvedValue([]),
        };
        ObjectStackProtocolImplementation.resetEnvWritableCache();
        resetEnvWritableMetadataTypes();
        protocol = new ObjectStackProtocolImplementation(mockEngine);
    });

    afterEach(() => {
        ObjectStackProtocolImplementation.resetEnvWritableCache();
        resetEnvWritableMetadataTypes();
    });

    for (const [from, object] of [['dynamic', 'deal_dynamic'], ['fixed', 'deal_fixed'], ['the default (dynamic)', 'deal_unset']] as const) {
        it(`refuses ${from} → record over a stored field with 409 DESTRUCTIVE_CHANGE, reading no row`, async () => {
            const err: any = await saveRecordMode(object).then(() => null, (e: unknown) => e);
            expect(err).toMatchObject({
                code: 'DESTRUCTIVE_CHANGE',
                status: 409,
                issues: [expect.objectContaining({ code: 'currency_mode_to_record', field: 'amount' })],
            });
            const { message } = err.issues[0];
            // The three consequences, and the command that removes them.
            expect(message).toContain("blank 'currency_code'");
            expect(message).toContain('display as a plain number');
            expect(message).toContain('fall into the null group of a grouped aggregate');
            expect(message).toContain('sit outside every currency-paired filter');
            expect(message).toContain(`os migrate record-currency-codes --object ${object} --field amount --code <ISO 4217 code>`);
            // …and, for an organization admin with no shell, the REST door beside it.
            expect(message).toContain('`POST /api/v1/meta/_migrate-record-currency-codes`');
            expect(message).toContain(`{ "object": "${object}", "field": "amount", "code": "<ISO 4217 code>" }`);
            // It reads no row of the object: the only reads are the
            // metadata store's own (the row this save overwrites).
            for (const verb of ['find', 'findOne', 'count', 'aggregate'] as const) {
                const objectsRead = mockEngine[verb].mock.calls.map((c: unknown[]) => c[0]);
                expect(objectsRead, verb).not.toContain(object);
            }
        });
    }

    it('force: true lifts it', async () => {
        try {
            await saveRecordMode('deal_dynamic', { force: true });
        } catch (err: any) {
            expect(err?.code).not.toBe('DESTRUCTIVE_CHANGE');
        }
    });

    it('does not fire on a new amount field declared in record mode — its column holds no rows', async () => {
        try {
            await saveRecordMode('deal_new_amount');
        } catch (err: any) {
            expect(err?.code).not.toBe('DESTRUCTIVE_CHANGE');
        }
    });

    it('does not fire on a field already in record mode', async () => {
        try {
            await saveRecordMode('deal_record');
        } catch (err: any) {
            expect(err?.code).not.toBe('DESTRUCTIVE_CHANGE');
        }
    });

    it('does not fire when the field leaves record mode or stays dynamic', async () => {
        for (const currencyConfig of [{ currencyMode: 'dynamic' }, { currencyMode: 'fixed', defaultCurrency: 'USD' }]) {
            try {
                await protocol.saveMetaItem({
                    type: 'object',
                    name: 'deal_record',
                    item: {
                        name: 'deal_record',
                        label: 'deal_record',
                        fields: {
                            title: { name: 'title', type: 'text' },
                            amount: { name: 'amount', type: 'currency', currencyConfig },
                            currency_code: CODE_FIELD,
                        },
                    },
                } as any);
            } catch (err: any) {
                // The finding codes this save raised (a destructive-change issue's
                // own field-addressed vocabulary, not an `error.code`).
                const findings = ((err?.issues ?? []) as Array<{ code: string }>).map((i) => i.code);
                expect(findings).not.toContain('currency_mode_to_record');
            }
        }
    });
});

/**
 * Phase 3a-destructive: `currency_field_repointed` (ADR-0144 D2, D5), the
 * sibling of `currency_mode_to_record` above.
 *
 * A stored `record`-mode amount is a bare number whose currency is whatever its
 * `currencyField` names. Re-pointing that pointer at another field converts no
 * stored amount: every row is read in the currency the new field (or, for a
 * `MASTER_DETAIL.CODE` path, the parent) holds. The save answers the existing
 * 409 `DESTRUCTIVE_CHANGE`, the finding names the remedies that exist, and
 * `force: true` lifts it. Like its sibling it reads no row of the object.
 */
describe('ObjectStackProtocolImplementation - currency_field_repointed', () => {
    let protocol: ObjectStackProtocolImplementation;
    let mockEngine: any;
    let registry: SchemaRegistry;

    const CODE = { type: 'text', valueDomain: 'iso_4217_currency' };
    /** The child's own fields beside the amount: two sibling codes and its master. */
    const CHILD_FIELDS = {
        title: { name: 'title', type: 'text' },
        currency_code: { name: 'currency_code', ...CODE },
        billing_currency: { name: 'billing_currency', ...CODE },
        order: { name: 'order', type: 'master_detail', reference: 'line_order' },
    };
    const HOME_FIELDS = {
        doc_date: { name: 'doc_date', type: 'date' },
        amount_home: { name: 'amount_home', type: 'currency', readonly: true },
        amount_rate: { name: 'amount_rate', type: 'number', readonly: true },
    };
    const HOME = { field: 'amount_home', rateDate: 'doc_date', rateField: 'amount_rate' };
    const recordAmount = (currencyField: string, extra: Record<string, unknown> = {}) => ({
        name: 'amount', type: 'currency', currencyConfig: { currencyMode: 'record', currencyField, ...extra },
    });

    /** A tenant-authored object (ADR-0131 D6) whose amount points at `pointer`. */
    const register = (name: string, pointer: string, extra: Record<string, unknown> = {}) => {
        registry.registerObject({
            name, label: name, _provenance: 'org',
            fields: { ...CHILD_FIELDS, ...HOME_FIELDS, amount: recordAmount(pointer, extra) },
        } as any, 'pkg');
    };

    /** The save under test: `name`'s amount now points at `pointer`. */
    const savePointer = (name: string, pointer: string, extra: Record<string, unknown> = {}, request: Record<string, unknown> = {}) =>
        protocol.saveMetaItem({
            type: 'object',
            name,
            ...request,
            item: { name, label: name, fields: { ...CHILD_FIELDS, ...HOME_FIELDS, amount: recordAmount(pointer, extra) } },
        } as any);

    const refusal = (save: Promise<unknown>) => save.then(() => null, (e: unknown) => e as any);
    /** The finding codes a save raised: empty when it was not refused as destructive. */
    const findingsOf = (err: any): string[] => (err?.code === 'DESTRUCTIVE_CHANGE' ? err.issues.map((i: any) => i.code) : []);

    const expectNoRowRead = (object: string) => {
        for (const verb of ['find', 'findOne', 'count', 'aggregate'] as const) {
            const objectsRead = mockEngine[verb].mock.calls.map((c: unknown[]) => c[0]);
            expect(objectsRead, verb).not.toContain(object);
        }
    };

    beforeEach(() => {
        registry = new SchemaRegistry({ multiTenant: false });
        registry.registerObject({
            name: 'line_order', label: 'line_order', _provenance: 'org',
            fields: {
                title: { name: 'title', type: 'text' },
                currency_code: { name: 'currency_code', ...CODE },
                billing_currency: { name: 'billing_currency', ...CODE },
            },
        } as any, 'pkg');
        register('line_sibling', 'currency_code');
        register('line_path', 'order.currency_code');
        register('line_home', 'currency_code', { homeAmount: HOME });
        mockEngine = {
            registry,
            find: vi.fn().mockResolvedValue([]),
            findOne: vi.fn().mockResolvedValue(null),
            insert: vi.fn().mockResolvedValue({ id: 'x' }),
            update: vi.fn().mockResolvedValue({ id: 'x' }),
            delete: vi.fn().mockResolvedValue({ deleted: 1 }),
            count: vi.fn().mockResolvedValue(0),
            aggregate: vi.fn().mockResolvedValue([]),
        };
        ObjectStackProtocolImplementation.resetEnvWritableCache();
        resetEnvWritableMetadataTypes();
        protocol = new ObjectStackProtocolImplementation(mockEngine);
    });

    afterEach(() => {
        ObjectStackProtocolImplementation.resetEnvWritableCache();
        resetEnvWritableMetadataTypes();
    });

    const BACKFILL = 'os migrate record-currency-codes --object';

    for (const [direction, object, pointer, backfill] of [
        ['a sibling to another sibling', 'line_sibling', 'billing_currency', true],
        ['a sibling to a MASTER_DETAIL.CODE path', 'line_sibling', 'order.currency_code', false],
        ['a path to a sibling', 'line_path', 'billing_currency', true],
        ['a path to another path', 'line_path', 'order.billing_currency', false],
    ] as const) {
        it(`refuses ${direction} with 409 DESTRUCTIVE_CHANGE, reading no row`, async () => {
            const err = await refusal(savePointer(object, pointer));
            expect(err).toMatchObject({
                code: 'DESTRUCTIVE_CHANGE',
                status: 409,
                issues: [expect.objectContaining({ code: 'currency_field_repointed', field: 'amount' })],
            });
            const { message } = err.issues[0];
            expect(message).toContain(`to '${pointer}'`);
            expect(message).toContain('No stored amount is converted');
            if (backfill) {
                // A sibling column the backfill can write, and its REST door beside it.
                expect(message).toContain(`${BACKFILL} ${object} --field amount --code <ISO 4217 code>`);
                expect(message).toContain('`POST /api/v1/meta/_migrate-record-currency-codes`');
            } else {
                // A path's code lives on the parent: there is nothing here to backfill.
                expect(message).not.toContain(BACKFILL);
                expect(message).toContain("its parent's code");
            }
            // No home amount is declared, so none is spoken of.
            expect(message).not.toContain('recompute-home-amounts');
            expectNoRowRead(object);
        });
    }

    it('names the home-amount recompute when the amount declares homeAmount', async () => {
        const err = await refusal(savePointer('line_home', 'billing_currency', { homeAmount: HOME }));
        expect(findingsOf(err)).toEqual(['currency_field_repointed']);
        const { message } = err.issues[0];
        expect(message).toContain("stored home amounts in 'amount_home' and rates in 'amount_rate'");
        expect(message).toContain('`os migrate recompute-home-amounts --object line_home --field amount`');
        expectNoRowRead('line_home');
    });

    it('[ADR-0144 D2, amended] names the home-amount recompute for a path pointer too: the run reads each row\'s parent code', async () => {
        register('line_path_home', 'order.currency_code', { homeAmount: HOME });
        const err = await refusal(savePointer('line_path_home', 'order.billing_currency', { homeAmount: HOME }));
        expect(findingsOf(err)).toEqual(['currency_field_repointed']);
        const { message } = err.issues[0];
        expect(message).toContain("its parent's code");
        expect(message).toContain('`os migrate recompute-home-amounts --object line_path_home --field amount`');
        expect(message).not.toContain(BACKFILL);
        expectNoRowRead('line_path_home');
    });

    it('says nothing re-rates the stored home amounts when the save also drops homeAmount', async () => {
        const err = await refusal(savePointer('line_home', 'billing_currency'));
        const { message } = err.issues[0];
        expect(message).toContain("stored home amounts in 'amount_home'");
        expect(message).toContain('nothing re-rates them');
        expect(message).not.toContain('`os migrate recompute-home-amounts --object');
    });

    it('force: true lifts it', async () => {
        const err = await refusal(savePointer('line_sibling', 'billing_currency', {}, { force: true }));
        expect(err?.code).not.toBe('DESTRUCTIVE_CHANGE');
    });

    it('does not fire on an identical pointer, sibling or path', async () => {
        for (const [object, pointer] of [['line_sibling', 'currency_code'], ['line_path', 'order.currency_code']] as const) {
            expect(findingsOf(await refusal(savePointer(object, pointer))), object).toEqual([]);
        }
    });

    it('does not fire where no previous version exists — a new object declared with a pointer', async () => {
        expect(findingsOf(await refusal(savePointer('line_brand_new', 'billing_currency')))).toEqual([]);
    });

    it('does not fire when the previous field was a formula — it stored no amount', async () => {
        registry.registerObject({
            name: 'line_formula', label: 'line_formula', _provenance: 'org',
            fields: { ...CHILD_FIELDS, ...HOME_FIELDS, amount: { name: 'amount', type: 'formula', expression: '1' } },
        } as any, 'pkg');
        expect(findingsOf(await refusal(savePointer('line_formula', 'billing_currency')))).not.toContain('currency_field_repointed');
    });

    it('a switch INTO record mode raises only currency_mode_to_record, not a re-point', async () => {
        registry.registerObject({
            name: 'line_dynamic', label: 'line_dynamic', _provenance: 'org',
            fields: { ...CHILD_FIELDS, ...HOME_FIELDS, amount: { name: 'amount', type: 'currency', currencyConfig: { currencyMode: 'dynamic' } } },
        } as any, 'pkg');
        expect(findingsOf(await refusal(savePointer('line_dynamic', 'billing_currency')))).toEqual(['currency_mode_to_record']);
    });
});
