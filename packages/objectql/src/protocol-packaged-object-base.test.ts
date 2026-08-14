// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #8284 — `ObjectStackProtocolImplementation.getPackagedObjectBase`, against a
 * REAL `SchemaRegistry`.
 *
 * The localization boundary decides whether an object's `label` /
 * `pluralLabel` / `description` may be replaced by the i18n catalog by
 * comparing the served document against the PACKAGED declaration (maintainer
 * ruling, 2026-08-13: the catalog loses to an explicit override, decided by
 * comparison, with no provenance flag carried through the fold). Everything
 * about that rule is decided by which body this accessor returns, and that is
 * a registry question — hence a test here rather than against a double.
 *
 * ⛔ THE TRAP THIS FILE EXISTS FOR. The obvious accessor is the one the
 * protocol already uses for lock/provenance — `getArtifactItem`, whose object
 * branch answers `resolveOwnerLayer`, i.e. the owner **with its extenders
 * folded on**. That body already carries the extension's label, so a
 * comparison against it would report the extension's scalar as "unchanged" and
 * hand the catalog straight back the case #8037 was filed about. The two are
 * pinned side by side below so the difference cannot be re-discovered by
 * accident.
 */

import { describe, it, expect } from 'vitest';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
import { SchemaRegistry } from './registry.js';
import { assertEngineDeleteDispatch } from './engine-delete-dispatch.js';
import { assertEngineUpdateDispatch } from './engine-update-dispatch.js';

const PKG = 'app.showcase';
const OBJ = 'showcase_account';

/** What the package's own declaration says — the catalog's subject. */
const PACKAGED_LABEL = 'Account';
/** What the package's `objectExtensions` entry says. */
const EXTENSION_LABEL = 'Account (Success Overlay)';

const rowKey = (w: Record<string, unknown>) =>
    [w.type, w.name, w.organization_id ?? '', w.package_id ?? '', w.state ?? 'active'].join('|');

const matchesWhere = (row: Record<string, unknown>, where: Record<string, unknown>) =>
    Object.entries(where ?? {}).every(([k, v]) => {
        if (k.startsWith('$')) throw new Error(`fake driver: unsupported operator ${k}`);
        if (v === null) return row[k] === null || row[k] === undefined;
        return row[k] === v;
    });

/**
 * One kernel process: a real registry + the real protocol over an in-memory
 * `sys_metadata`. Same shape as `protocol-object-overlay-layer.test.ts`, which
 * is the sibling file for the layer model this accessor reads.
 */
function makeSession() {
    const registry = new SchemaRegistry({ multiTenant: false });
    registry.logLevel = 'silent';
    const rows = new Map<string, any>();
    const historyRows: any[] = [];
    let nextId = 0;

    const findRow = (w: Record<string, unknown>) => {
        for (const [k, r] of rows) if (matchesWhere(r, w)) return { key: k, row: r };
        return null;
    };

    const engine: any = {
        registry,
        async findOne(table: string, o: { where: Record<string, unknown> }) {
            if (table === 'sys_metadata_history') return historyRows.find((h) => matchesWhere(h, o.where)) ?? null;
            if (table !== 'sys_metadata') return null;
            return findRow(o.where)?.row ?? null;
        },
        async find(table: string, o: { where: Record<string, unknown> }) {
            if (table === 'sys_metadata_history') return historyRows.filter((h) => matchesWhere(h, o.where));
            if (table !== 'sys_metadata') return [];
            return Array.from(rows.values()).filter((r) => matchesWhere(r, o.where));
        },
        async insert(table: string, data: Record<string, unknown>) {
            if (table === 'sys_metadata_history') {
                const h = { id: `h_${++nextId}`, ...(data as any) };
                historyRows.push(h);
                return { id: h.id };
            }
            if (table !== 'sys_metadata') return { id: `rec_${++nextId}` };
            const row = { id: `r_${++nextId}`, ...(data as any) };
            rows.set(rowKey(data), row);
            return { id: row.id };
        },
        async update(table: string, data: Record<string, unknown>, o: { where: Record<string, unknown> }) {
            assertEngineUpdateDispatch(data, o);
            if (table !== 'sys_metadata') return { id: null };
            const found = findRow(o.where);
            if (!found) return { id: null };
            const merged = { ...found.row, ...(data as any) };
            rows.delete(found.key);
            rows.set(rowKey(merged), merged);
            return { id: merged.id };
        },
        async delete(table: string, o?: Record<string, unknown>) {
            assertEngineDeleteDispatch(o);
            if (table !== 'sys_metadata') return { deleted: 0 };
            const found = findRow(((o as any)?.where ?? {}) as Record<string, unknown>);
            if (!found) return { deleted: 0 };
            rows.delete(found.key);
            return { deleted: 1 };
        },
        async syncObjectSchema() { /* no physical storage in this double */ },
    };

    const protocol = new ObjectStackProtocolImplementation(engine, undefined, 'env_test');
    return { protocol, engine, registry, rows };
}

/** The packaged object, as a code package registers it. */
function registerPackaged(registry: SchemaRegistry) {
    registry.installPackage({ id: PKG, name: 'Showcase', version: '1.0.0' } as any);
    registry.registerObject(
        {
            name: OBJ,
            label: PACKAGED_LABEL,
            pluralLabel: 'Accounts',
            description: 'A company the org delivers projects for.',
            fields: { name: { name: 'name', type: 'text', label: 'Name' } },
        } as any,
        PKG,
    );
}

/** The package's own `objectExtensions` entry — an `extend` contributor. */
function registerExtension(registry: SchemaRegistry) {
    registry.registerObject(
        {
            name: OBJ,
            label: EXTENSION_LABEL,
            fields: { loyalty_tier: { name: 'loyalty_tier', type: 'text', label: 'Loyalty Tier' } },
        } as any,
        PKG,
        undefined,
        'extend',
        210,
    );
}

const baseOf = (protocol: any, name = OBJ): any => protocol.getPackagedObjectBase(name);

describe('#8284 getPackagedObjectBase — the packaged declaration, pre-fold', () => {
    it('answers the OWNER declaration, not the extender-folded artifact body', () => {
        const s = makeSession();
        registerPackaged(s.registry);
        registerExtension(s.registry);

        expect(baseOf(s.protocol)?.label).toBe(PACKAGED_LABEL);

        // The trap, pinned from the other side: the accessor the protocol uses
        // for lock/provenance answers the FOLDED body for the same name.
        expect((s.registry.getArtifactItem('object', OBJ) as any)?.label).toBe(EXTENSION_LABEL);
        // …which is also what the resolved schema — what a read serves — says.
        expect((s.registry.getObject(OBJ) as any)?.label).toBe(EXTENSION_LABEL);
    });

    it('carries all three scalars the ruling covers', () => {
        const s = makeSession();
        registerPackaged(s.registry);
        const base = baseOf(s.protocol);
        expect(base?.label).toBe(PACKAGED_LABEL);
        expect(base?.pluralLabel).toBe('Accounts');
        expect(base?.description).toBe('A company the org delivers projects for.');
    });

    it('survives a tenant overlay — the packaged layer is still underneath', async () => {
        // ADR-0029 D9.7/D9.8: an overlay is its own layer, so the comparison
        // baseline does not move when a tenant customises the object. If it
        // did, a renamed object would compare equal to its own rename and the
        // catalog would win again the moment the row landed.
        const s = makeSession();
        registerPackaged(s.registry);
        registerExtension(s.registry);
        s.registry.registerObject(
            { name: OBJ, label: 'Customer', _packageId: 'sys_metadata', _provenance: 'org' } as any,
            'sys_metadata',
            undefined,
            'overlay',
        );

        expect(baseOf(s.protocol)?.label).toBe(PACKAGED_LABEL);
    });

    it('is undefined for an unknown name', () => {
        const s = makeSession();
        registerPackaged(s.registry);
        expect(baseOf(s.protocol, 'no_such_object')).toBeUndefined();
        expect(baseOf(s.protocol, '')).toBeUndefined();
    });

    it('is undefined for a runtime/tenant-authored object with no code owner', () => {
        // "No packaged baseline" is a real answer, and the localization
        // boundary reads it as "infer nothing" — such an object keeps the
        // pre-#8284 `catalog ?? document` behaviour rather than losing its
        // translations to a guess.
        const s = makeSession();
        s.registry.registerObject(
            { name: 'tenant_thing', label: 'Tenant Thing', _packageId: 'sys_metadata', _provenance: 'org' } as any,
            'sys_metadata',
        );
        expect(baseOf(s.protocol, 'tenant_thing')).toBeUndefined();
    });

    it('is undefined when the host registry cannot answer', () => {
        // Partial registry doubles predate this method; a host that cannot
        // answer must degrade, never throw — the same rule the fold seam next
        // to it follows.
        const protocol: any = new ObjectStackProtocolImplementation({ registry: {} } as any, undefined, 'env_test');
        expect(protocol.getPackagedObjectBase(OBJ)).toBeUndefined();
        const noRegistry: any = new ObjectStackProtocolImplementation({} as any, undefined, 'env_test');
        expect(noRegistry.getPackagedObjectBase(OBJ)).toBeUndefined();
    });
});
