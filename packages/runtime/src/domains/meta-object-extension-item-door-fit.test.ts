// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#28834, ADR-0146 D10] An `object_extension` item's refusals fit the item
 * door #28574 opened.
 *
 * The business case: an administrator adds "Region" to the vendor's Account
 * through Setup, which saves an `object_extension` item into the base's
 * `.custom` pair.
 *
 *  1. Carrying `overrides`, the save is refused (`declared_type_not_overridable`)
 *     with a sentence that fits an extension: it takes no override and has no
 *     new name, so the remedy is to edit the extension itself. An `object`
 *     carrying `overrides` (`declared_object`) is told both doors an
 *     extension is written through: the item door and the manifest entry.
 *     Every other type's sentence is unchanged (the permission control).
 *  2. A short `extend` that `getObject` folds to a legacy `<ns>__<name>` key
 *     is refused: the registry files an extension under the name it is
 *     written with, so it would open a second, phantom object. The key the
 *     object is registered under is still admitted (the control).
 *
 * ## The rig
 *
 * The rig of `meta-object-extension-item.test.ts`: better-sqlite3 `:memory:`
 * behind the real `ObjectQL` engine and a real
 * `ObjectStackProtocolImplementation` over its `SchemaRegistry`. The base is a
 * code package registered through `registerApp`; the pair is installed
 * through the protocol's package door. Every refusal asserts its envelope, its
 * sentence and that no row was left.
 */

import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
import { SysMetadata, SysMetadataHistoryObject, SysMetadataAuditObject } from '@objectstack/platform-objects/metadata';

let home: string;
let priorHome: string | undefined;
beforeAll(() => {
    priorHome = process.env.OS_HOME;
    home = mkdtempSync(join(tmpdir(), 'os-object-extension-door-fit-'));
    process.env.OS_HOME = home;
});
afterAll(() => {
    if (priorHome === undefined) delete process.env.OS_HOME;
    else process.env.OS_HOME = priorHome;
    rmSync(home, { recursive: true, force: true });
});

const TEST_PACKAGE_ID = 'objectstack-test';
const BASE = 'com.acme.crm';
const PAIR = 'com.acme.crm.custom';
const TARGET = 'crm_account';
/** An object the base ships under a legacy `<ns>__<name>` key: `getObject('case')` folds to it. */
const LEGACY_KEY = 'crm__case';
const LEGACY_SHORT = 'case';
const DECLARATION = { package: BASE, basedOn: '3.4.1' };

const baseManifest = () => ({
    id: BASE,
    name: 'crm',
    version: '3.4.1',
    type: 'app',
    namespace: 'crm',
    objects: [
        { name: TARGET, label: 'Account', fields: { name: { name: 'name', label: 'Name', type: 'text' } } },
        { name: LEGACY_KEY, label: 'Case', fields: { subject: { name: 'subject', label: 'Subject', type: 'text' } } },
    ],
});

const region = (extend: string, extra: Record<string, unknown> = {}) => ({
    extend,
    fields: { region__c: { type: 'text', label: 'Region' } },
    ...extra,
});

const liveEngines: ObjectQL[] = [];
afterEach(async () => {
    while (liveEngines.length) {
        try { await liveEngines.pop()?.destroy(); } catch { /* noop */ }
    }
});

async function boot() {
    const engine = new ObjectQL();
    liveEngines.push(engine);
    engine.registerDriver(new SqlDriver({
        client: 'better-sqlite3',
        connection: { filename: ':memory:' },
        useNullAsDefault: true,
    }), true);
    await engine.init();
    engine.registry.registerObject(SysMetadata as any, TEST_PACKAGE_ID);
    engine.registry.registerObject(SysMetadataHistoryObject as any, TEST_PACKAGE_ID);
    engine.registry.registerObject(SysMetadataAuditObject as any, TEST_PACKAGE_ID);
    (engine.registry as unknown as { logLevel: string }).logLevel = 'silent';
    engine.registerApp(baseManifest());
    await engine.syncSchemas();

    const protocol = new ObjectStackProtocolImplementation(engine as any, () => new Map());
    const p = protocol as any;
    await p.installPackage({
        manifest: { id: PAIR, name: 'crm-custom', version: '0.1.0', type: 'app', namespace: 'crm_custom', dependencies: { [BASE]: '^3' } },
    });

    /** Every stored row, read back from the store. */
    const rows = async () => ((await engine.find('sys_metadata', { where: {}, context: { isSystem: true } })) ?? [])
        .filter((r: any) => r.package_id === PAIR)
        .map((r: any) => ({ type: r.type, name: r.name, state: r.state }));
    const thrown = (run: Promise<unknown>) => run.then(() => undefined, (e: any) => e);
    return { engine, p, rows, thrown };
}

const envelope = (e: any) => (e ? { code: e.code, status: e.status } : null);
const REFUSED = { code: 'NOT_OVERRIDABLE', status: 403 };

describe('an object_extension item\'s override refusals fit the item door (#28834)', () => {
    it('`overrides` on an object_extension is refused with the edit-the-extension sentence', async () => {
        const { p, rows, thrown } = await boot();
        const e = await thrown(p.saveMetaItem({
            type: 'object_extension', name: TARGET, packageId: PAIR, item: region(TARGET, { overrides: DECLARATION }),
        }));
        expect(envelope(e)).toEqual(REFUSED);
        expect(e.message).toBe(
            `'object_extension/${TARGET}' carries \`overrides\`, but an object extension takes no override (ADR-0146 D10): `
            + 'it adds to the object it extends and is stored under that object\'s name. '
            + `Remove \`overrides\` and edit the object_extension '${TARGET}' itself.`,
        );
        expect(e.message).not.toMatch(/new name|new similar/);
        expect(await rows()).toEqual([]);
    });

    it('`overrides` on an object is refused naming the item door beside the manifest entry', async () => {
        const { p, rows, thrown } = await boot();
        const e = await thrown(p.saveMetaItem({
            type: 'object', name: TARGET, packageId: PAIR,
            item: { name: TARGET, label: 'Account', fields: {}, overrides: DECLARATION },
        }));
        expect(envelope(e)).toEqual(REFUSED);
        expect(e.message).toBe(
            `'object/${TARGET}' carries \`overrides\`, but an object is extended, never replaced (ADR-0146 D10). `
            + 'Remove `overrides` and add the change as an object extension in the base\'s paired .custom package: '
            + 'an `object_extension` item saved through `/api/v1/meta/object_extension`, or an `objectExtensions` entry of its manifest.',
        );
        expect(await rows()).toEqual([]);
    });

    it('control: another excluded type keeps its D6 sentence byte for byte', async () => {
        const { p, rows, thrown } = await boot();
        const e = await thrown(p.saveMetaItem({
            type: 'permission', name: 'crm_perm', packageId: PAIR,
            item: { name: 'crm_perm', label: 'CRM', overrides: DECLARATION },
        }));
        expect(envelope(e)).toEqual(REFUSED);
        expect(e.message).toBe(
            '\'permission/crm_perm\' carries `overrides`, but a permission takes no override (ADR-0146 D6). '
            + 'Remove `overrides` and create your own permission under a new name ("new similar").',
        );
        expect(await rows()).toEqual([]);
    });
});

describe('an object_extension item names its target by the key it is registered under (#28834)', () => {
    it('a short name getObject folds to a legacy key is refused, naming both spellings, and opens no phantom object', async () => {
        const { engine, p, rows, thrown } = await boot();
        // The fold this refuses: the short name reaches the legacy entry.
        expect((engine.registry.getObject(LEGACY_SHORT) as any)?.name).toBe(LEGACY_KEY);

        for (const mode of ['draft', undefined] as const) {
            const e = await thrown(p.saveMetaItem({
                type: 'object_extension', name: LEGACY_SHORT, packageId: PAIR, item: region(LEGACY_SHORT),
                ...(mode ? { mode } : {}),
            }));
            expect(envelope(e)).toEqual({ code: 'VALIDATION_ERROR', status: 400 });
            expect(e.message).toBe(
                `Object extension '${LEGACY_SHORT}' extends '${LEGACY_SHORT}', but that object is registered as '${LEGACY_KEY}': `
                + `an extension is filed under the name it is written with, so '${LEGACY_SHORT}' would open a second object `
                + `beside '${LEGACY_KEY}'. Save it as '${LEGACY_KEY}', with \`extend\` set to '${LEGACY_KEY}'.`,
            );
            expect(e.issues?.map((i: any) => i.path)).toEqual(['extend']);
        }
        expect(await rows()).toEqual([]);
        expect(engine.registry.getObjectContributors(LEGACY_SHORT)).toEqual([]);
        expect(engine.registry.getObjectContributors(LEGACY_KEY).map((c: any) => c.packageId)).toEqual([BASE]);
    });

    it('control: the key the object is registered under is admitted and extends that object', async () => {
        const { engine, p, rows } = await boot();
        await p.saveMetaItem({ type: 'object_extension', name: LEGACY_KEY, packageId: PAIR, item: region(LEGACY_KEY), mode: 'draft' });
        await p.publishMetaItem({ type: 'object_extension', name: LEGACY_KEY, packageId: PAIR });
        expect(await rows()).toEqual([{ type: 'object_extension', name: LEGACY_KEY, state: 'active' }]);
        expect(engine.registry.getObjectContributors(LEGACY_KEY).map((c: any) => [c.packageId, c.ownership]))
            .toEqual([[BASE, 'own'], [PAIR, 'extend']]);
        expect(Object.keys((engine.registry.getObject(LEGACY_KEY) as any)?.fields ?? {})).toEqual(expect.arrayContaining(['region__c', 'subject']));
        expect(engine.registry.getObjectContributors(LEGACY_SHORT)).toEqual([]);
    });
});

describe('a stored object_extension row whose extend folds to a legacy key lands on that object at the boot hydration (#28858)', () => {
    it('the field is on the legacy-keyed object, no second entry opens, and the spelling is named once', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        try {
            const { engine, p } = await boot();
            // A row stored under the short spelling: the item door refuses
            // that spelling now (#28834), so it is a row written before it.
            // Stored as the registered key, then respelled at rest.
            await p.saveMetaItem({ type: 'object_extension', name: LEGACY_KEY, packageId: PAIR, item: region(LEGACY_KEY), mode: 'draft' });
            await p.publishMetaItem({ type: 'object_extension', name: LEGACY_KEY, packageId: PAIR });
            const stored: any[] = ((await engine.find('sys_metadata', { where: { type: 'object_extension' }, context: { isSystem: true } })) ?? [])
                .filter((r: any) => r.package_id === PAIR);
            expect(stored).toHaveLength(1);
            const body = typeof stored[0].metadata === 'string' ? JSON.parse(stored[0].metadata) : stored[0].metadata;
            await engine.update('sys_metadata', {
                id: stored[0].id,
                name: LEGACY_SHORT,
                metadata: JSON.stringify({ ...body, name: LEGACY_SHORT, extend: LEGACY_SHORT }),
            }, { context: { isSystem: true } });
            // A fresh process: the registry holds no contribution of the pair.
            engine.registry.withdrawObjectExtension(LEGACY_KEY, PAIR);
            expect(engine.registry.getObjectContributors(LEGACY_KEY).map((c: any) => c.packageId)).toEqual([BASE]);

            const result = await p.loadMetaFromDb();
            expect(result.errors).toBe(0);
            expect(engine.registry.getObjectContributors(LEGACY_SHORT)).toEqual([]);
            expect(engine.registry.getObjectContributors(LEGACY_KEY).map((c: any) => [c.packageId, c.ownership]))
                .toEqual([[BASE, 'own'], [PAIR, 'extend']]);
            expect(Object.keys((engine.registry.getObject(LEGACY_KEY) as any)?.fields ?? {})).toEqual(expect.arrayContaining(['region__c', 'subject']));
            const lines = warn.mock.calls.map((c) => String(c[0]))
                .filter((l) => l.includes(`'${LEGACY_SHORT}'`) && l.includes(`'${LEGACY_KEY}'`) && l.includes(PAIR));
            expect(lines).toHaveLength(1);
        } finally {
            warn.mockRestore();
        }
    });
});
