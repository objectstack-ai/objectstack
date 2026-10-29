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
                expect(err?.issues ?? []).not.toEqual(
                    expect.arrayContaining([expect.objectContaining({ code: 'currency_mode_to_record' })]),
                );
            }
        }
    });
});
