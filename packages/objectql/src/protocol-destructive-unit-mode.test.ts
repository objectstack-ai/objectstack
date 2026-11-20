// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ObjectStackProtocolImplementation, resetEnvWritableMetadataTypes } from '@objectstack/metadata-protocol';
import { SchemaRegistry } from './registry.js';

/**
 * Phase 3a-destructive: `unit_mode_to_record` and `unit_mode_to_code`
 * (ADR-0158 Open item 9 point 7), the siblings of `currency_mode_to_record`.
 *
 * A stored field declared a unit code field leaves the text its rows already
 * hold under U5's write check: a quantity switched to `unitMode: 'record'`
 * reads its unit from a `unitField` of free text, and a `text` field marked
 * `unitMode: 'code'` (Open item 8) holds that text itself. The save is
 * answered with the 409 `DESTRUCTIVE_CHANGE`, whose finding names the
 * conversion run, CLI and REST; `force: true` lifts it. It reads no row.
 */
describe('ObjectStackProtocolImplementation - unit_mode_to_record and unit_mode_to_code', () => {
    let protocol: ObjectStackProtocolImplementation;
    let mockEngine: any;
    let registry: SchemaRegistry;

    const RECORD_WEIGHT = { name: 'weight', type: 'number', unitConfig: { unitMode: 'record', unitField: 'uom' } };
    const CODE_UOM = { name: 'base_uom', type: 'text', unitConfig: { unitMode: 'code' } };

    /** A tenant-authored object (ADR-0131 D6): the population this detector guards. */
    const register = (name: string, fields: Record<string, unknown>) => {
        registry.registerObject({ name, label: name, _provenance: 'org', fields } as any, 'pkg');
    };
    const save = (name: string, fields: Record<string, unknown>, extra: Record<string, unknown> = {}) =>
        protocol.saveMetaItem({ type: 'object', name, ...extra, item: { name, label: name, fields } } as any);
    /** The finding codes a save raised: `[]` when it was admitted. */
    const findingsOf = async (p: Promise<unknown>): Promise<string[]> => p.then(
        () => [],
        (err: any) => {
            if (err?.code !== 'DESTRUCTIVE_CHANGE') throw err;
            return (err.issues as Array<{ code: string }>).map((i) => i.code);
        },
    );

    beforeEach(() => {
        registry = new SchemaRegistry({ multiTenant: false });
        register('mat_plain', {
            weight: { name: 'weight', type: 'number' },
            uom: { name: 'uom', type: 'text' },
            base_uom: { name: 'base_uom', type: 'text' },
        });
        register('mat_fixed', {
            weight: { name: 'weight', type: 'number', unitConfig: { unitMode: 'fixed', unit: 'KGM' } },
            uom: { name: 'uom', type: 'text' },
        });
        register('mat_declared', { weight: RECORD_WEIGHT, uom: { name: 'uom', type: 'text' }, base_uom: CODE_UOM });
        register('mat_bare', { title: { name: 'title', type: 'text' } });
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

    for (const object of ['mat_plain', 'mat_fixed']) {
        it(`refuses ${object}'s stored quantity switched to unitMode 'record' with 409 DESTRUCTIVE_CHANGE, naming the conversion run and reading no row`, async () => {
            const err: any = await save(object, { weight: RECORD_WEIGHT, uom: { name: 'uom', type: 'text' } }).then(() => null, (e: unknown) => e);
            expect(err).toMatchObject({
                code: 'DESTRUCTIVE_CHANGE',
                status: 409,
                issues: [expect.objectContaining({ code: 'unit_mode_to_record', field: 'weight' })],
            });
            const { message } = err.issues[0];
            expect(message).toContain("reads its unit from 'uom'");
            expect(message).toContain('is refused until the row holds a unit code');
            expect(message).toContain(`\`os migrate unit-codes --object ${object} --field uom --map-file <mapping file>\``);
            expect(message).toContain('`POST /api/v1/meta/_migrate-unit-codes`');
            expect(message).toContain(`{ "object": "${object}", "field": "uom", "mapping": { "<stored text>": "<unit code>" } }`);
            for (const verb of ['find', 'findOne', 'count', 'aggregate'] as const) {
                expect(mockEngine[verb].mock.calls.map((c: unknown[]) => c[0]), verb).not.toContain(object);
            }
        });
    }

    it("[Open item 8] refuses a stored text field marked unitMode 'code', naming the run over that field itself", async () => {
        const err: any = await save('mat_plain', { weight: { name: 'weight', type: 'number' }, uom: { name: 'uom', type: 'text' }, base_uom: CODE_UOM })
            .then(() => null, (e: unknown) => e);
        expect(err).toMatchObject({ code: 'DESTRUCTIVE_CHANGE', status: 409, issues: [expect.objectContaining({ code: 'unit_mode_to_code', field: 'base_uom' })] });
        expect(err.issues[0].message).toContain('rows already stored keep the text they were written with');
        expect(err.issues[0].message).toContain('`os migrate unit-codes --object mat_plain --field base_uom --map-file <mapping file>`');
    });

    it('force: true lifts both', async () => {
        const fields = { weight: RECORD_WEIGHT, uom: { name: 'uom', type: 'text' }, base_uom: CODE_UOM };
        expect(await findingsOf(save('mat_plain', fields))).toEqual(['unit_mode_to_record', 'unit_mode_to_code']);
        expect(await findingsOf(save('mat_plain', fields, { force: true }))).toEqual([]);
    });

    it('raises nothing for a declaration already made, a new field, a fixed unit, or a declaration removed', async () => {
        expect(await findingsOf(save('mat_declared', { weight: RECORD_WEIGHT, uom: { name: 'uom', type: 'text' }, base_uom: CODE_UOM }))).toEqual([]);
        expect(await findingsOf(save('mat_bare', { title: { name: 'title', type: 'text' }, weight: RECORD_WEIGHT, uom: { name: 'uom', type: 'text' }, base_uom: CODE_UOM }))).toEqual([]);
        expect(await findingsOf(save('mat_plain', {
            weight: { name: 'weight', type: 'number', unitConfig: { unitMode: 'fixed', unit: 'KGM' } },
            uom: { name: 'uom', type: 'text' }, base_uom: { name: 'base_uom', type: 'text' },
        }))).toEqual([]);
        expect(await findingsOf(save('mat_declared', {
            weight: { name: 'weight', type: 'number' }, uom: { name: 'uom', type: 'text' }, base_uom: { name: 'base_uom', type: 'text' },
        }))).toEqual([]);
    });
});
