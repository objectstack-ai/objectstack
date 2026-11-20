// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ObjectStackProtocolImplementation, resetEnvWritableMetadataTypes } from '@objectstack/metadata-protocol';
import { SchemaRegistry } from './registry.js';
import { unitCodeSources } from './validation/unit-code-membership.js';

/**
 * Phase 3a-destructive: `unit_code_field_declared` and `unit_mode_to_record`
 * (ADR-0158 Open item 9 point 7), the siblings of `currency_mode_to_record`.
 *
 * The finding is keyed on the stored CODE field, as the write check (U5) is:
 * a stored field that is a unit code field after the save (`unitCodeSources`)
 * and was not one before holds text written before the declaration, whichever
 * declaration made it one — a quantity, new or stored, whose `unitField` names
 * it, a `unitField` re-pointed at it, or its own `unitMode: 'code'` (Open item
 * 8). A field that already was one raises nothing. A stored quantity switched
 * to `unitMode: 'record'` over a field that already was one raises
 * `unit_mode_to_record` on the quantity, for the blank beside it. The save is
 * answered with the 409 `DESTRUCTIVE_CHANGE`, whose finding names the
 * conversion run, CLI and REST; `force: true` lifts it. It reads no row.
 */
describe('ObjectStackProtocolImplementation - unit_code_field_declared and unit_mode_to_record', () => {
    let protocol: ObjectStackProtocolImplementation;
    let mockEngine: any;
    let registry: SchemaRegistry;

    const TEXT = (name: string) => ({ name, type: 'text' });
    const NUMBER = (name: string) => ({ name, type: 'number' });
    const RECORD = (name: string, unitField: string) => ({ name, type: 'number', unitConfig: { unitMode: 'record', unitField } });
    const CODE = (name: string) => ({ name, type: 'text', unitConfig: { unitMode: 'code' } });

    /** The field maps each object is stored with, before any save under test. */
    const STORED: Record<string, Record<string, unknown>> = {
        mat_plain: { weight: NUMBER('weight'), uom: TEXT('uom'), base_uom: TEXT('base_uom') },
        mat_fixed: { weight: { name: 'weight', type: 'number', unitConfig: { unitMode: 'fixed', unit: 'KGM' } }, uom: TEXT('uom') },
        mat_declared: { weight: RECORD('weight', 'uom'), uom: TEXT('uom'), base_uom: CODE('base_uom') },
        // `uom` is already a unit code field (through `gross`); `weight` and `pack_uom` are plain stored columns.
        mat_gross: { gross: RECORD('gross', 'uom'), weight: NUMBER('weight'), uom: TEXT('uom'), pack_uom: TEXT('pack_uom') },
        // Two unit code fields already, each named by its own quantity.
        mat_pair: { gross: RECORD('gross', 'uom'), net: RECORD('net', 'net_uom'), uom: TEXT('uom'), net_uom: TEXT('net_uom') },
        mat_bare: { title: TEXT('title') },
    };

    /** A tenant-authored object (ADR-0131 D6): the population this detector guards. */
    const register = (name: string, fields: Record<string, unknown>) => {
        registry.registerObject({ name, label: name, _provenance: 'org', fields } as any, 'pkg');
    };
    /** The save under test. `sharingModel` set, so a save the detector admits is admitted for real. */
    const save = (name: string, fields: Record<string, unknown>, extra: Record<string, unknown> = {}) =>
        protocol.saveMetaItem({ type: 'object', name, ...extra, item: { name, label: name, sharingModel: 'private', fields } } as any);
    /** The refusal a save raised, or null when it was admitted. */
    const refusalOf = (p: Promise<unknown>): Promise<any> => p.then(() => null, (e: unknown) => e);
    /** The finding codes a save raised: `[]` when it was admitted. */
    const findingsOf = async (p: Promise<unknown>): Promise<string[]> => p.then(
        () => [],
        (err: any) => {
            if (err?.code !== 'DESTRUCTIVE_CHANGE') throw err;
            return (err.issues as Array<{ code: string }>).map((i) => i.code);
        },
    );
    /** No row of `object` was read: the detector judges the declaration alone. */
    const readNoRow = (object: string) => {
        for (const verb of ['find', 'findOne', 'count', 'aggregate'] as const) {
            expect(mockEngine[verb].mock.calls.map((c: unknown[]) => c[0]), verb).not.toContain(object);
        }
    };
    const remedyOf = (object: string, field: string) => [
        `\`os migrate unit-codes --object ${object} --field ${field} --map-file <mapping file>\``,
        '`POST /api/v1/meta/_migrate-unit-codes`',
        `{ "object": "${object}", "field": "${field}", "mapping": { "<stored text>": "<unit code>" } }`,
    ];

    beforeEach(() => {
        registry = new SchemaRegistry({ multiTenant: false });
        for (const [name, fields] of Object.entries(STORED)) register(name, fields);
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
        it(`refuses ${object}'s stored quantity switched to unitMode 'record' over stored text with 409 DESTRUCTIVE_CHANGE, on the text field it makes a unit code field, reading no row`, async () => {
            // Every stored field kept, so the one finding is the declaration's.
            const err = await refusalOf(save(object, { ...STORED[object], weight: RECORD('weight', 'uom') }));
            expect(err).toMatchObject({
                code: 'DESTRUCTIVE_CHANGE',
                status: 409,
                issues: [expect.objectContaining({ code: 'unit_code_field_declared', field: 'uom' })],
            });
            expect(err.issues).toHaveLength(1);
            const { message } = err.issues[0];
            expect(message).toContain("Field 'uom' is now a unit code field (the unitField of 'weight')");
            expect(message).toContain('a quantity edited beside a value there that is free text or blank is refused until the row holds one');
            for (const part of remedyOf(object, 'uom')) expect(message).toContain(part);
            readNoRow(object);
        });
    }

    it('[S1] a NEW quantity naming a stored text field makes that field a unit code field: the finding is raised on it', async () => {
        const err = await refusalOf(save('mat_plain', { ...STORED.mat_plain, net_weight: RECORD('net_weight', 'uom') }));
        expect(err).toMatchObject({ code: 'DESTRUCTIVE_CHANGE', status: 409, issues: [expect.objectContaining({ code: 'unit_code_field_declared', field: 'uom' })] });
        expect(err.issues).toHaveLength(1);
        expect(err.issues[0].message).toContain("Field 'uom' is now a unit code field (the unitField of 'net_weight')");
        for (const part of remedyOf('mat_plain', 'uom')) expect(err.issues[0].message).toContain(part);
        readNoRow('mat_plain');
    });

    it('[S1] a unitField re-pointed at a stored text field raises the finding on the field it now names', async () => {
        const err = await refusalOf(save('mat_gross', { ...STORED.mat_gross, gross: RECORD('gross', 'pack_uom') }));
        expect(err).toMatchObject({ code: 'DESTRUCTIVE_CHANGE', status: 409, issues: [expect.objectContaining({ code: 'unit_code_field_declared', field: 'pack_uom' })] });
        expect(err.issues).toHaveLength(1);
        expect(err.issues[0].message).toContain("Field 'pack_uom' is now a unit code field (the unitField of 'gross')");
        for (const part of remedyOf('mat_gross', 'pack_uom')) expect(err.issues[0].message).toContain(part);
    });

    it("[Open item 8] refuses a stored text field marked unitMode 'code', naming the run over that field itself", async () => {
        const err = await refusalOf(save('mat_plain', { ...STORED.mat_plain, base_uom: CODE('base_uom') }));
        expect(err).toMatchObject({ code: 'DESTRUCTIVE_CHANGE', status: 409, issues: [expect.objectContaining({ code: 'unit_code_field_declared', field: 'base_uom' })] });
        expect(err.issues).toHaveLength(1);
        const { message } = err.issues[0];
        expect(message).toContain("Field 'base_uom' is now a unit code field (its own unitMode 'code')");
        expect(message).toContain('rows already stored keep the text they were written with');
        // No quantity beside it, so no blank is owed.
        expect(message).not.toContain('a quantity edited beside');
        for (const part of remedyOf('mat_plain', 'base_uom')) expect(message).toContain(part);
    });

    it("[S1] a stored quantity switched to unitMode 'record' over a field that already was a unit code field raises unit_mode_to_record on the quantity", async () => {
        const err = await refusalOf(save('mat_gross', { ...STORED.mat_gross, weight: RECORD('weight', 'uom') }));
        expect(err).toMatchObject({ code: 'DESTRUCTIVE_CHANGE', status: 409, issues: [expect.objectContaining({ code: 'unit_mode_to_record', field: 'weight' })] });
        expect(err.issues).toHaveLength(1);
        const { message } = err.issues[0];
        expect(message).toContain("every row already stored is read in the unit 'uom' holds, a unit code field already");
        expect(message).toContain("a quantity edited beside a blank 'uom' is refused until the row holds a unit code");
        expect(message).toContain('write those blanks from a "" entry in the mapping of');
        for (const part of remedyOf('mat_gross', 'uom')) expect(message).toContain(part);
        readNoRow('mat_gross');
    });

    it('[S1] raises nothing for a field that already was a unit code field, however it is declared now', async () => {
        // A new quantity naming a field another quantity already names.
        expect(await findingsOf(save('mat_gross', { ...STORED.mat_gross, net: RECORD('net', 'uom') }))).toEqual([]);
        // A unitField re-pointed from one unit code field onto another (out of R1: the sibling of currency_field_repointed).
        expect(await findingsOf(save('mat_pair', { ...STORED.mat_pair, gross: RECORD('gross', 'net_uom') }))).toEqual([]);
    });

    it('the other over-fire shape, a field a quantity names marked unitMode \'code\' as well, is refused by the spec before the detector runs', async () => {
        // A quantity's `unitField` may not name a field that declares `unitConfig` itself, so no save reaches the
        // detector with that shape: it is answered 422 INVALID_METADATA, never 409 DESTRUCTIVE_CHANGE.
        for (const [object, fields] of [
            ['mat_declared', { ...STORED.mat_declared, uom: CODE('uom') }],
            ['mat_declared', { ...STORED.mat_declared, count: RECORD('count', 'base_uom') }],
        ] as Array<[string, Record<string, unknown>]>) {
            const err = await refusalOf(save(object, fields));
            expect({ code: err?.code, status: err?.status }).toEqual({ code: 'INVALID_METADATA', status: 422 });
        }
    });

    it('force: true lifts both', async () => {
        const fields = { ...STORED.mat_gross, weight: RECORD('weight', 'uom'), pack_uom: CODE('pack_uom') };
        expect(await findingsOf(save('mat_gross', fields))).toEqual(['unit_mode_to_record', 'unit_code_field_declared']);
        expect(await findingsOf(save('mat_gross', fields, { force: true }))).toEqual([]);
    });

    it('raises nothing for a declaration already made, a new field, a fixed unit, or a declaration removed', async () => {
        expect(await findingsOf(save('mat_declared', STORED.mat_declared))).toEqual([]);
        expect(await findingsOf(save('mat_bare', { ...STORED.mat_bare, weight: RECORD('weight', 'uom'), uom: TEXT('uom'), base_uom: CODE('base_uom') }))).toEqual([]);
        expect(await findingsOf(save('mat_plain', {
            ...STORED.mat_plain, weight: { name: 'weight', type: 'number', unitConfig: { unitMode: 'fixed', unit: 'KGM' } },
        }))).toEqual([]);
        expect(await findingsOf(save('mat_declared', { weight: NUMBER('weight'), uom: TEXT('uom'), base_uom: TEXT('base_uom') }))).toEqual([]);
    });

    // The detector's own reader agrees with the write check's: the fields a save
    // is refused over are exactly the stored fields `unitCodeSources` names
    // after the save and not before.
    it.each([
        ['mat_plain', { ...STORED.mat_plain, weight: RECORD('weight', 'uom'), base_uom: CODE('base_uom') }],
        ['mat_plain', { ...STORED.mat_plain, net_weight: RECORD('net_weight', 'base_uom') }],
        ['mat_gross', { ...STORED.mat_gross, gross: RECORD('gross', 'pack_uom'), weight: RECORD('weight', 'uom') }],
        ['mat_gross', { ...STORED.mat_gross, net: RECORD('net', 'pack_uom') }],
        ['mat_pair', { ...STORED.mat_pair, gross: RECORD('gross', 'net_uom'), net: RECORD('net', 'uom') }],
        ['mat_pair', { ...STORED.mat_pair, net: NUMBER('net'), gross: RECORD('gross', 'net_uom') }],
        ['mat_bare', { ...STORED.mat_bare, title: CODE('title'), weight: RECORD('weight', 'uom'), uom: TEXT('uom') }],
    ] as Array<[string, Record<string, unknown>]>)('on %s, the fields raised are those unitCodeSources newly names over a stored field (%#)', async (object, next) => {
        const before = new Set(unitCodeSources(STORED[object]).map((s) => s.codeField));
        const expected = unitCodeSources(next)
            .map((s) => s.codeField)
            .filter((field) => !before.has(field) && field in STORED[object] && field in next)
            .sort();
        const err = await refusalOf(save(object, next));
        // Admitted, or refused by this detector alone: never a refusal of another kind passing for "nothing raised".
        if (err !== null) expect({ code: err.code, status: err.status }).toEqual({ code: 'DESTRUCTIVE_CHANGE', status: 409 });
        const raised = ((err?.issues ?? []) as Array<{ code: string; field: string }>)
            .filter((i) => i.code === 'unit_code_field_declared')
            .map((i) => i.field)
            .sort();
        expect(raised).toEqual(expected);
    });
});
