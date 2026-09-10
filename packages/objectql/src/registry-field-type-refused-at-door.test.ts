// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #16319 — a field whose `type` is absent or is not a `FieldType` member is
 * refused AT THE REGISTRATION DOOR, and the whole object declaration goes with
 * it.
 *
 * MAINTAINER RULING, 2026-09-10 (director seat batch #111 item 2), verbatim:
 * 「16319 一个没写 type(或拼错)的字段 应该禁止加载。这个才是合理的吧?其他同意」
 *
 * The card measured the harm on live PostgreSQL 16.13: one declaration produced
 * `character varying(100)` from `SqlDriver.createColumn`'s `field.type ||
 * 'string'` and `TEXT` from both `os generate migration` formats' `fieldDef.type
 * || 'text'`, so the platform refused a 101-character value that both generated
 * tables accepted. `FieldSchema` refuses both shapes at `[type]`, so only the
 * doors that skip Zod could deliver them: a stored `sys_metadata` row, a raw
 * package/plugin manifest, and a direct `registerObject` call.
 *
 * This file lives in `@objectstack/objectql` for the same reason
 * `protocol-derived-provenance-doors.test.ts` does: the subject is the REAL
 * `SchemaRegistry` reached through a REAL `ObjectQL` engine AND the metadata
 * protocol's boot seam, and objectql depends on metadata-protocol — only this
 * direction holds both halves without closing a cycle turbo rejects.
 *
 * ⭐ Section 4 is the ruling's own implementer PRECONDITION, run rather than
 * argued: 「若 Studio 的元数据列表只从注册表读,被拒的行会从界面消失而无法修 ——
 * 那时停手回报」. It is measured here, on the real read and delete paths.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
import { hashSpec } from '@objectstack/metadata-core';
import { ObjectQL } from './engine.js';
import { SchemaRegistry, objectFieldTypeRefusal, OBJECT_FIELD_TYPE_REFUSED_CODE } from './registry.js';

const ENV = 'env_test';

/** The two shapes the card measured, and the control that must still register. */
const NO_TYPE = { maxLength: 100 } as const;
const BAD_TYPE = { type: 'this_is_not_a_field_type', maxLength: 100 } as const;
const CONTROL = { type: 'email', maxLength: 100 } as const;

const objectWith = (probe: Record<string, unknown>) => ({
    name: 'refusal_probe',
    label: 'Refusal Probe',
    fields: {
        title: { type: 'text', label: 'Title' },
        probe: { label: 'Probe', ...probe },
    },
});

// ────────────────────────────────────────────────────────────────────────────
// 1. The door itself
// ────────────────────────────────────────────────────────────────────────────

describe('#16319 §1 — `registerObject` refuses the WHOLE declaration', () => {
    it('refuses a field with NO `type`, with the ADR-0112 envelope, naming object + field + reason', () => {
        const registry = new SchemaRegistry({ multiTenant: false });
        registry.logLevel = 'silent';

        let thrown: any;
        try { registry.registerObject(objectWith(NO_TYPE) as any, 'pkg.probe'); }
        catch (e) { thrown = e; }

        // ⛔ NOT a bare `toThrow()`: the ownership refusal a few lines away in the
        // same method is indistinguishable to one (#14367). Envelope, or nothing.
        expect(thrown).toBeDefined();
        expect(thrown.code).toBe(OBJECT_FIELD_TYPE_REFUSED_CODE);
        expect(thrown.code).toBe('INVALID_METADATA');
        expect(thrown.status).toBe(422);
        expect(thrown.httpStatus).toBe(422);
        expect(thrown.name).toBe('ObjectFieldTypeRefusedError');
        expect(thrown.objectName).toBe('refusal_probe');
        expect(thrown.fieldName).toBe('probe');
        expect(thrown.declaredType).toBeUndefined();
        // The three things the ruling requires the message to carry.
        expect(thrown.message).toContain('refusal_probe');
        expect(thrown.message).toContain('probe');
        expect(thrown.message).toContain('declares no `type`');
    });

    it('refuses a NON-MEMBER `type` the same way, and offers the spec\'s own "did you mean?"', () => {
        const registry = new SchemaRegistry({ multiTenant: false });
        registry.logLevel = 'silent';

        let thrown: any;
        try { registry.registerObject(objectWith(BAD_TYPE) as any, 'pkg.probe'); }
        catch (e) { thrown = e; }

        expect(thrown?.code).toBe('INVALID_METADATA');
        expect(thrown.status).toBe(422);
        expect(thrown.declaredType).toBe('this_is_not_a_field_type');
        expect(thrown.message).toContain('is not a member of `FieldType`');

        // The mis-spelling the card names as the canonical one gets the spec's
        // own suggestion, from the SAME resolver the parse-time error map uses.
        let mis: any;
        try { registry.registerObject(objectWith({ type: 'text_area' }) as any, 'pkg.probe'); }
        catch (e) { mis = e; }
        expect(mis.message).toContain("Did you mean 'textarea'?");
    });

    it('⛔ does NOT drop the field and register the rest — the object is ABSENT', () => {
        const registry = new SchemaRegistry({ multiTenant: false });
        registry.logLevel = 'silent';

        expect(() => registry.registerObject(objectWith(NO_TYPE) as any, 'pkg.probe')).toThrow();

        // Absent, not present-minus-one-field. `getObjectContributors` is asked as
        // well as `resolveObject`: a half-open contributor entry would answer
        // `undefined` from the resolver while still holding a layer.
        expect(registry.resolveObject('refusal_probe')).toBeUndefined();
        expect(registry.getObjectContributors('refusal_probe')).toEqual([]);
        expect(registry.listItems('object').map((o: any) => o.name)).not.toContain('refusal_probe');
    });

    it('POSITIVE CONTROL — the same object with a `FieldType` member registers, with BOTH fields', () => {
        const registry = new SchemaRegistry({ multiTenant: false });
        registry.logLevel = 'silent';
        registry.registerObject(objectWith(CONTROL) as any, 'pkg.probe');

        const resolved = registry.resolveObject('refusal_probe') as any;
        expect(resolved).toBeDefined();
        expect(Object.keys(resolved.fields)).toEqual(expect.arrayContaining(['title', 'probe']));
        expect(resolved.fields.probe.type).toBe('email');
    });

    it('judges EVERY contributor kind — `own`, `overlay` and `extend` all refuse', () => {
        const registry = new SchemaRegistry({ multiTenant: false });
        registry.logLevel = 'silent';
        // A healthy owner first, so the overlay/extend layers have a base to aim at
        // and the refusal cannot be mistaken for "no such object".
        registry.registerObject(objectWith(CONTROL) as any, 'pkg.probe', undefined, 'own');

        for (const kind of ['own', 'overlay', 'extend'] as const) {
            let thrown: any;
            try {
                registry.registerObject(
                    { name: 'refusal_probe', fields: { late: { label: 'Late' } } } as any,
                    'pkg.other', undefined, kind,
                );
            } catch (e) { thrown = e; }
            expect(thrown?.code, `${kind} must refuse`).toBe('INVALID_METADATA');
            expect(thrown.fieldName).toBe('late');
        }

        // …and the healthy owner is untouched by the three refusals.
        expect((registry.resolveObject('refusal_probe') as any).fields.probe.type).toBe('email');
    });

    it('`objectFieldTypeRefusal` answers the same question without throwing (the seam the boot log asks)', () => {
        expect(objectFieldTypeRefusal(objectWith(CONTROL))).toBeNull();
        expect(objectFieldTypeRefusal(objectWith(NO_TYPE))?.fieldName).toBe('probe');
        expect(objectFieldTypeRefusal(objectWith(BAD_TYPE))?.declaredType).toBe('this_is_not_a_field_type');
        // Not an object / no fields — nothing to judge, and ⛔ not an invented refusal.
        expect(objectFieldTypeRefusal({ name: 'x' })).toBeNull();
        expect(objectFieldTypeRefusal(null)).toBeNull();
    });
});

// ────────────────────────────────────────────────────────────────────────────
// The boot harness — a REAL engine + REAL SchemaRegistry over a stub DRIVER
// (storage bytes only; every dispatch rule is the shipped one). Same shape as
// `protocol-derived-provenance-doors.test.ts`.
// ────────────────────────────────────────────────────────────────────────────

const sysMetadataObject = {
    name: 'sys_metadata',
    label: 'System Metadata',
    fields: {
        id: { name: 'id', label: 'ID', type: 'text' as const, primaryKey: true },
        type: { name: 'type', label: 'Type', type: 'text' as const, required: true },
        name: { name: 'name', label: 'Name', type: 'text' as const, required: true },
        organization_id: { name: 'organization_id', label: 'Org', type: 'text' as const },
        package_id: { name: 'package_id', label: 'Package', type: 'text' as const },
        metadata: { name: 'metadata', label: 'Body', type: 'textarea' as const },
        checksum: { name: 'checksum', label: 'Checksum', type: 'text' as const, maxLength: 71 },
        state: { name: 'state', label: 'State', type: 'text' as const },
        version: { name: 'version', label: 'Version', type: 'number' as const },
        created_at: { name: 'created_at', label: 'Created', type: 'datetime' as const },
        updated_at: { name: 'updated_at', label: 'Updated', type: 'datetime' as const },
    },
};

function makeStubDriver() {
    const stores = new Map<string, Map<string, Record<string, unknown>>>();
    const storeFor = (obj: string) => {
        let s = stores.get(obj);
        if (!s) { s = new Map(); stores.set(obj, s); }
        return s;
    };
    let nextId = 0;
    const matchesWhere = (row: Record<string, unknown>, where: any): boolean => {
        if (!where || typeof where !== 'object') return true;
        for (const [k, v] of Object.entries(where)) {
            if (k === '$and' && Array.isArray(v)) { if (!v.every((w: any) => matchesWhere(row, w))) return false; continue; }
            if (k === '$or' && Array.isArray(v)) { if (!v.some((w: any) => matchesWhere(row, w))) return false; continue; }
            if (k.startsWith('$')) continue;
            const expected = (v && typeof v === 'object' && '$eq' in (v as any)) ? (v as any).$eq : v;
            const a = row[k] === undefined ? null : row[k];
            const b = expected === undefined ? null : expected;
            if (a !== b) return false;
        }
        return true;
    };
    const driver: any = {
        name: 'memory', version: '0.0.0', supports: {} as any,
        async connect() {}, async disconnect() {}, async checkHealth() { return true; },
        async execute() { return null; },
        async find(object: string, ast: any) {
            const rows = Array.from(storeFor(object).values()).filter((r) => matchesWhere(r, ast?.where));
            // The caller's bound, applied AFTER the filter and by PRESENCE
            // (`pnpm check:objectql-double-limit`).
            return typeof ast?.limit === 'number' ? rows.slice(0, ast.limit) : rows;
        },
        async findOne(object: string, ast: any) {
            for (const r of storeFor(object).values()) if (matchesWhere(r, ast?.where)) return r;
            return null;
        },
        async create(object: string, data: Record<string, unknown>) {
            nextId += 1;
            const id = (data.id as string) ?? `r_${nextId}`;
            const row = { ...data, id };
            storeFor(object).set(id, row);
            return row;
        },
        async update(object: string, id: string, data: Record<string, unknown>) {
            const s = storeFor(object);
            const cur = s.get(id);
            if (!cur) throw new Error(`not found: ${object}/${id}`);
            const updated = { ...cur, ...data, id };
            s.set(id, updated);
            return updated;
        },
        async upsert(object: string, data: Record<string, unknown>) {
            const id = data.id as string | undefined;
            if (id && storeFor(object).has(id)) return this.update(object, id, data);
            return this.create(object, data);
        },
        async delete(object: string, id: string) { return storeFor(object).delete(id); },
        async count(object: string, ast: any) { return (await this.find(object, ast)).length; },
        async bulkCreate(object: string, rows: Record<string, unknown>[]) {
            return Promise.all(rows.map((r) => this.create(object, r)));
        },
        async bulkUpdate() { return []; },
        async bulkDelete() {},
        async beginTransaction() { return { commit: async () => {}, rollback: async () => {} }; },
        async commit() {}, async rollback() {},
    };
    return { driver, stores };
}

async function boot(driver: unknown) {
    const engine = new ObjectQL();
    engine.registry.logLevel = 'silent';
    engine.registerDriver(driver as any, true);
    await engine.init();
    engine.registry.registerObject(sysMetadataObject as any);
    const protocol = new ObjectStackProtocolImplementation(engine as any, undefined, ENV);
    return { engine, protocol };
}

/** One `sys_metadata` OBJECT row exactly as a previous session would have left it. */
function seedObjectRow(
    stores: Map<string, Map<string, Record<string, unknown>>>,
    body: Record<string, unknown>,
) {
    stores.set('sys_metadata', new Map([['r_seeded', {
        id: 'r_seeded', type: 'object', name: String(body.name),
        organization_id: null, package_id: null, state: 'active', version: 1,
        metadata: JSON.stringify(body),
        checksum: hashSpec(body),
    }]]));
}

afterEach(() => { vi.restoreAllMocks(); });

// ────────────────────────────────────────────────────────────────────────────
// 2 + 3. The boot seam: the row does NOT register, and the log says so at `error`
// ────────────────────────────────────────────────────────────────────────────

describe('#16319 §2 — a seeded `sys_metadata` row with no field `type` does not load', () => {
    it('leaves the object OUT of the registry and names it in the startup log at `error`', async () => {
        const { driver, stores } = makeStubDriver();
        const { engine, protocol } = await boot(driver);
        seedObjectRow(stores, objectWith(NO_TYPE));

        const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
        const warns = vi.spyOn(console, 'warn').mockImplementation(() => {});

        const hydration = await protocol.loadMetaFromDb();

        // ① the row did not register — the ruling's 「不注册」
        expect(engine.registry.resolveObject('refusal_probe')).toBeUndefined();
        expect(hydration.errors).toBe(1);
        expect(hydration.loaded).toBe(0);

        // ② `error` level, naming the object, the field and the reason
        const line = errors.mock.calls.map((c) => String(c[0])).find((m) => m.includes('refusal_probe'));
        expect(line, 'a console.error naming the row').toBeDefined();
        expect(line).toContain('[metadata_field_type_refused]');
        expect(line).toContain('is NOT registered');
        expect(line).toContain('"probe"');
        expect(line).toContain('declares no `type`');
        // ③ the two things an `error` owes (AGENTS.md "Degradation log levels"):
        //    the CONSEQUENCE, and the FIX.
        expect(line).toContain('absent from the runtime');
        expect(line).toContain('DELETE /api/v1/metadata/object/refusal_probe');

        // ④ ⛔ and the retired policy sentence is NOT printed for this class —
        //    「Registered anyway」 would be a false receipt for a row that did not
        //    register. Asked over EVERY warn, not just the first.
        const warned = warns.mock.calls.map((c) => String(c[0])).join('\n');
        expect(warned).not.toContain('Registered anyway');
    });

    it('CONTROL — a spec-invalid row of a DIFFERENT class still registers, and still says 「Registered anyway」', async () => {
        const { driver, stores } = makeStubDriver();
        const { engine, protocol } = await boot(driver);
        // Every field types cleanly; what fails the schema is the object-level
        // `label`, which the startup policy deliberately still admits.
        seedObjectRow(stores, { ...objectWith(CONTROL), label: 42 });

        const warns = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const errors = vi.spyOn(console, 'error').mockImplementation(() => {});

        const hydration = await protocol.loadMetaFromDb();

        expect(hydration.invalid).toBe(1);
        expect(hydration.loaded).toBe(1);
        expect(engine.registry.resolveObject('refusal_probe')).toBeDefined();
        expect(warns.mock.calls.map((c) => String(c[0])).join('\n')).toContain('Registered anyway');
        expect(errors.mock.calls.map((c) => String(c[0])).join('\n')).not.toContain('[metadata_field_type_refused]');
    });

    it('CONTROL — the same row with a `FieldType` member loads clean, so the refusal is the declaration\'s', async () => {
        const { driver, stores } = makeStubDriver();
        const { engine, protocol } = await boot(driver);
        seedObjectRow(stores, objectWith(CONTROL));

        const hydration = await protocol.loadMetaFromDb();
        expect(hydration).toMatchObject({ loaded: 1, errors: 0, invalid: 0 });
        expect(engine.registry.resolveObject('refusal_probe')).toBeDefined();
    });
});

// ────────────────────────────────────────────────────────────────────────────
// 4. The ruling's implementer PRECONDITION, measured
// ────────────────────────────────────────────────────────────────────────────

describe('#16319 §4 — a refused row stays REACHABLE through the metadata API', () => {
    it('the raw-row read path still lists and still serves it (Studio can see what to fix)', async () => {
        const { driver, stores } = makeStubDriver();
        const { protocol } = await boot(driver);
        seedObjectRow(stores, objectWith(NO_TYPE));
        vi.spyOn(console, 'error').mockImplementation(() => {});
        await protocol.loadMetaFromDb();

        // `getMetaItems` ALWAYS consults `sys_metadata` and merges the rows in —
        // it does not serve the registry alone. That is the whole answer to the
        // ruling's precondition: a row the registry refused is still in the list.
        const listed = await protocol.getMetaItems({ type: 'object' }) as any;
        const items: any[] = Array.isArray(listed) ? listed : (listed?.items ?? []);
        expect(items.map((i) => i?.name)).toContain('refusal_probe');

        const one = await protocol.getMetaItem({ type: 'object', name: 'refusal_probe' }) as any;
        expect(one).toBeTruthy();
        // …and it is served WITH the offending field, so the operator can see the
        // thing they have to correct.
        const body = (one?.data ?? one?.item ?? one) as any;
        expect(body?.fields?.probe).toBeDefined();
        expect(body?.fields?.probe?.type).toBeUndefined();
    });

    it('⭐ the row is still DELETABLE — the acceptance criterion the ruling planted', async () => {
        const { driver, stores } = makeStubDriver();
        const { engine, protocol } = await boot(driver);
        seedObjectRow(stores, objectWith(NO_TYPE));
        vi.spyOn(console, 'error').mockImplementation(() => {});
        await protocol.loadMetaFromDb();
        expect(engine.registry.resolveObject('refusal_probe')).toBeUndefined();

        const receipt = await protocol.deleteMetaItem({ type: 'object', name: 'refusal_probe' });
        expect(receipt.success).toBe(true);

        const left = await engine.find('sys_metadata', { where: { type: 'object', name: 'refusal_probe' } });
        expect(left).toEqual([]);
    });

    it('…and still WRITABLE — correcting the field through `saveMetaItem` makes it load on the next boot', async () => {
        const { driver, stores } = makeStubDriver();
        const s1 = await boot(driver);
        seedObjectRow(stores, objectWith(NO_TYPE));
        vi.spyOn(console, 'error').mockImplementation(() => {});
        await s1.protocol.loadMetaFromDb();

        // `sharingModel` is the runtime authoring gate's own requirement
        // (`security-owd-unset`), unrelated to this card — stated so the write
        // under test is the field correction and nothing else.
        await s1.protocol.saveMetaItem({
            type: 'object', name: 'refusal_probe',
            item: { ...objectWith(CONTROL), sharingModel: 'private' },
        });

        const s2 = await boot(driver);
        const hydration = await s2.protocol.loadMetaFromDb();
        expect(hydration).toMatchObject({ loaded: 1, errors: 0 });
        expect(s2.engine.registry.resolveObject('refusal_probe')).toBeDefined();
    });
});
