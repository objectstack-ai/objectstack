// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#21062] The public lookup picker searches and sorts by ONE key: the first of
 * its display fields the caller may QUERY ON, by the security service's
 * published answer (`getQueryableFields`, #20935) — not blindly the first
 * display field.
 *
 * A field whose masking rule applies to a caller is SERVED to it, its value
 * masked, so it is a display field the picker can still show. It is not a
 * field the caller may query on: a `contains` search on it rebuilds the masked
 * value probe by probe, and an order on it ranks rows by the value the mask
 * hides. The engine refuses both, `403 PERMISSION_DENIED`. A picker keyed on
 * its first display field therefore answered that 403 to every caller the
 * first field's rule applies to, on every request.
 *
 * What is pinned, by caller class (the picker's own context — the route builds
 * it, the session is not read):
 *
 * - masked class — the deployment registers a `guest_portal` set that does not
 *   hold the capability the rule names: rows are sorted, and searched, on the
 *   next queryable display field; the masked field is still served, masked;
 *   and no request the engine receives names the masked field;
 * - [#21079] the deployment registers no `guest_portal` set, so the context
 *   resolves no set: the ADR-0056 D2 deny baseline refuses every picker at
 *   object admission (`403 PERMISSION_DENIED`), while the key it composes is
 *   unchanged and still never names the masked field;
 * - a picker with no queryable display field answers the engine's own refusal
 *   for those fields, and the engine is never asked;
 * - controls — a picker with no masked display field, and a caller the rule is
 *   lifted for, keep the first display field as the key;
 * - a security service that cannot give the query answer: every display field
 *   whose declaration carries a masking rule is passed over, whoever the
 *   caller is — the fallback the service contract prescribes.
 *
 * The composition is real below the route: `SecurityPlugin` over a real
 * `ObjectQL` on a real `SqlDriver` (SQLite), and the REAL protocol `findData`,
 * so the request the route composes crosses the real ingress and the engine's
 * own field guards. The form and object reads are stubbed. Fixtures are
 * synthetic.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { PermissionSetSchema } from '@objectstack/spec/security';
import { FormFieldPublicPickerSchema } from '@objectstack/spec/ui';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { SecurityPlugin } from '@objectstack/plugin-security';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
import { RestServer } from './rest-server.js';

const CONTACT = 'rest_pk_contact';
const INQUIRY = 'rest_pk_inquiry';
const MASKED = 'pk_code';
const CAPABILITY = 'pk_unmask';
const SLUG = 'pk-intake';

const SYS_CTX = { isSystem: true, userId: 'usr_system' };

/** Three rows whose order by name, by the masked field and by city all differ. */
const ROWS = [
    { id: 'pk1', name: 'Bravo', [MASKED]: 'AAA111', pk_city: 'Lisbon' },
    { id: 'pk2', name: 'Alpha', [MASKED]: 'CCC333', pk_city: 'Berlin' },
    { id: 'pk3', name: 'Charlie', [MASKED]: 'BBB222', pk_city: 'Austin' },
];
const STORED_BY_ID: Record<string, string> = Object.fromEntries(ROWS.map((r) => [r.id, r[MASKED]]));
const BY_NAME = ['pk2', 'pk1', 'pk3'];
const BY_MASKED = ['pk1', 'pk3', 'pk2'];

/** The pickers, one per lookup field on the form. Each is parsed by the spec below. */
const PICKERS = {
    c_first: { displayFields: [MASKED, 'name'] },
    c_control: { displayFields: ['name', 'pk_city'] },
    c_only: { displayFields: [MASKED] },
} as const;

const MEMBER_SET = PermissionSetSchema.parse({
    name: 'member_default',
    label: 'Member',
    objects: { '*': { allowRead: true } },
});
/** A guest set that admits the object and does not hold the capability. */
const GUEST_SET = PermissionSetSchema.parse({
    name: 'guest_portal',
    label: 'Guest',
    objects: { [CONTACT]: { allowRead: true } },
});
/** The same guest set holding the capability the masking rule names: the rule is lifted. */
const GUEST_UNMASK_SET = PermissionSetSchema.parse({
    name: 'guest_portal',
    label: 'Guest',
    objects: { [CONTACT]: { allowRead: true } },
    systemPermissions: [CAPABILITY],
});

const quiet: any = { debug() {}, info() {}, warn() {}, error() {}, child() { return quiet; } };

function createMockServer() {
    const noop = () => {};
    return { get: noop, post: noop, put: noop, delete: noop, patch: noop, use: noop, listen: async () => {}, close: async () => {} };
}

function makeRes() {
    const res: any = {
        statusCode: 200,
        body: undefined as any,
        header: () => res,
        status: (code: number) => { res.statusCode = code; return res; },
        json: (body: unknown) => { res.body = body; return res; },
        end: () => res,
    };
    return res;
}

/** The stored form, in the flattened registered shape `getMetaItems` serves. */
const storedForm = {
    name: `${INQUIRY}.intake`,
    object: INQUIRY,
    viewKind: 'form',
    config: {
        type: 'simple',
        data: { provider: 'object', object: INQUIRY },
        sharing: { enabled: true, allowAnonymous: true, publicLink: `/forms/${SLUG}` },
        sections: [{
            label: 'Intake',
            fields: Object.entries(PICKERS).map(([field, picker]) => ({ field, publicPicker: picker })),
        }],
    },
};

type Security = Record<string, any>;
type Harness = {
    engine: ObjectQL;
    security: Security;
    /** Every `engine.find` call on the picked object since boot: its query. */
    finds: () => Array<Record<string, any>>;
    /** Drive the picker as the route is driven, with a given security service. */
    lookup: (field: keyof typeof PICKERS, q?: string, security?: Security) => Promise<{ status: number; body: any }>;
};

async function boot(sets: unknown[]): Promise<Harness> {
    const engine = new ObjectQL({ logger: quiet } as any);
    engine.registerDriver(
        new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true } as any),
        true,
    );
    await engine.init();
    engine.registerApp({
        id: 'com.objectstack.qa.picker-queryable-key-21062',
        name: 'Picker queryable key',
        version: '1.0.0',
        type: 'plugin',
        scope: 'system',
        objects: [
            {
                name: CONTACT,
                label: 'Contact',
                sharingModel: 'public_read_write',
                fields: {
                    name: { name: 'name', type: 'text' },
                    [MASKED]: {
                        name: MASKED, type: 'text', maskingRule: { keepHead: 1, keepTail: 1 }, requiredPermissions: [CAPABILITY],
                    },
                    pk_city: { name: 'pk_city', type: 'text' },
                },
            },
            {
                name: INQUIRY,
                label: 'Inquiry',
                sharingModel: 'public_read_write',
                fields: Object.fromEntries(Object.keys(PICKERS).map((f) => [f, { name: f, type: 'lookup', reference: CONTACT }])),
            },
        ],
    } as never);
    await engine.syncSchemas();

    const services: Record<string, unknown> = {
        manifest: { register: vi.fn() },
        objectql: engine,
        data: engine,
        metadata: {
            get: async (_type: string, name: string) => engine.getSchema(name) ?? null,
            list: async () => sets,
        },
    };
    const ctx: any = {
        logger: quiet,
        hook: () => {},
        registerService: (name: string, svc: unknown) => { services[name] = svc; },
        replaceService: (name: string, svc: unknown) => { services[name] = svc; },
        getService: (name: string) => {
            if (!(name in services)) throw new Error(`service not registered: ${name}`);
            return services[name];
        },
    };
    const plugin = new SecurityPlugin({ fallbackPermissionSet: 'member_default' });
    await plugin.init(ctx);
    await plugin.start(ctx);
    vi.spyOn((engine as unknown as { logger: { warn: () => void } }).logger, 'warn').mockImplementation(() => undefined);
    await engine.insert(CONTACT, ROWS.map((r) => ({ ...r })), { context: SYS_CTX } as never);

    const findSpy = vi.spyOn(engine, 'find');
    const finds = () => findSpy.mock.calls
        .filter((c) => c[0] === CONTACT)
        .map((c) => (c[1] ?? {}) as Record<string, any>);

    const real = new ObjectStackProtocolImplementation(engine as never) as any;
    const protocol: any = {
        getDiscovery: async () => ({ version: 'v0', routes: { data: '', metadata: '' } }),
        getMetaTypes: async () => [],
        getMetaItem: async ({ type, name }: { type: string; name: string }) =>
            (type === 'object' ? { type, name, item: engine.getSchema(name) } : undefined),
        getMetaItems: async ({ type }: { type: string }) => {
            if (type === 'view') return [storedForm];
            if (type === 'object') return [engine.getSchema(CONTACT), engine.getSchema(INQUIRY)];
            return [];
        },
        findData: (request: unknown) => real.findData(request),
    };

    const security = services.security as Security;
    let current: Security | undefined = security;
    const rest = new RestServer(
        createMockServer() as any, protocol, { api: { requireAuth: false } } as any,
        undefined, undefined, undefined, undefined, undefined, undefined, undefined,
        undefined, undefined, undefined, undefined, undefined, undefined, undefined,
        async () => current,
    );
    rest.registerRoutes();
    const route: any = rest.getRoutes().find((r: any) => r.method === 'GET' && r.path.endsWith('/forms/:slug/lookup/:field'));
    expect(route, 'the picker route is mounted').toBeDefined();

    const lookup = async (field: keyof typeof PICKERS, q?: string, as: Security = security) => {
        current = as;
        const res = makeRes();
        await route.handler({ method: 'GET', params: { slug: SLUG, field }, headers: {}, query: q === undefined ? {} : { q } } as any, res);
        current = security;
        return { status: res.statusCode, body: res.body };
    };
    return { engine, security, finds, lookup };
}

const ids = (body: any): string[] => (body?.data ?? []).map((r: any) => r.id);

/** Every field a query names as a predicate or an order key. */
function queriedFields(query: Record<string, any>): string[] {
    const out = new Set<string>();
    const walk = (node: unknown): void => {
        if (Array.isArray(node)) { node.forEach(walk); return; }
        if (!node || typeof node !== 'object') return;
        for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
            if (!k.startsWith('$')) out.add(k);
            walk(v);
        }
    };
    walk(query.where);
    for (const s of query.orderBy ?? []) if (typeof s?.field === 'string') out.add(s.field);
    return [...out];
}

function expectServedMasked(body: any): void {
    for (const row of body?.data ?? []) {
        const value = row[MASKED];
        expect(typeof value, `${row.id}: the masked field is served`).toBe('string');
        expect(value, `${row.id}: served masked, not stored`).not.toBe(STORED_BY_ID[row.id]);
        expect(String(value)).toContain('*');
    }
}

/** The engine's own refusal for a query ordered by `fields`, as the picker's context. */
async function engineRefusal(engine: ObjectQL, fields: readonly string[]) {
    const context = { permissions: ['guest_portal'], anonymous: true };
    return engine
        .find(CONTACT, { orderBy: fields.map((field) => ({ field, order: 'asc' })), context } as never)
        .then(() => null, (e: any) => ({ status: e?.status ?? e?.statusCode, code: e?.code, message: String(e?.message) }));
}

/** A security service that predates the query answer: the real one, less that method. */
function withoutQueryAnswer(security: Security): Security {
    const { getQueryableFields: _omitted, ...rest } = security;
    return rest;
}

describe('[#21062] the fixture is authorable', () => {
    it('every picker on the form is accepted by the spec', () => {
        for (const [field, picker] of Object.entries(PICKERS)) {
            expect(FormFieldPublicPickerSchema.safeParse(picker).success, field).toBe(true);
        }
    });
});

/**
 * [#21079] The deployment registers no guest set, so the picker's context
 * resolves NO permission set — and an empty set list is the ADR-0056 D2 deny
 * baseline: the engine refuses that caller at object admission, before any
 * field guard, whatever the query names. The field answers are unchanged (the
 * masked field is readable and not queryable, and the key the picker composes
 * is still the next queryable display field), but nothing is served: every
 * picker on this deployment answers `403 PERMISSION_DENIED`. The picker itself
 * is retired on its own card; until then this is what it answers here.
 */
describe('[#21062] a picker whose first display field is masked for its caller — the deployment registers no guest set (the context resolves none): [#21079] refused at object admission', () => {
    let h: Harness;
    beforeAll(async () => { h = await boot([MEMBER_SET]); }, 60_000);
    afterAll(async () => { try { await h?.engine.destroy(); } catch { /* noop */ } });

    /** The deny baseline's answer at the door: refused at object admission, nothing served. */
    function expectRefusedAtAdmission(res: { status: number; body: any }): void {
        expect({ status: res.status, code: res.body?.code }, JSON.stringify(res.body)).toEqual({ status: 403, code: 'PERMISSION_DENIED' });
        expect(res.body?.data, 'no row is served').toBeUndefined();
        for (const stored of Object.values(STORED_BY_ID)) expect(JSON.stringify(res.body)).not.toContain(stored);
    }

    it('the premise: the security service answers the masked field readable and not queryable', async () => {
        const context = { permissions: ['guest_portal'], anonymous: true };
        expect(await h.security.getReadableFields(CONTACT, context)).toContain(MASKED);
        expect(await h.security.getQueryableFields(CONTACT, context)).not.toContain(MASKED);
        expect(await engineRefusal(h.engine, [MASKED])).toMatchObject({ status: 403, code: 'PERMISSION_DENIED' });
    });

    it('[#21079] the picker whose first display field is masked is refused at object admission', async () => {
        expectRefusedAtAdmission(await h.lookup('c_first'));
    });

    it('[#21079] its search is refused at object admission too', async () => {
        expectRefusedAtAdmission(await h.lookup('c_first', 'Brav'));
    });

    it('never uses the masked field as a key', async () => {
        const before = h.finds().length;
        await h.lookup('c_first');
        await h.lookup('c_first', 'Brav');
        const asked = h.finds().slice(before);
        expect(asked).toHaveLength(2);
        for (const query of asked) {
            expect(queriedFields(query)).not.toContain(MASKED);
            expect(query.orderBy).toEqual([{ field: 'name', order: 'asc' }]);
        }
    });

    it('[#21079] a picker with no queryable display field answers 403 PERMISSION_DENIED, as the engine does, and the engine is never asked', async () => {
        const reference = await engineRefusal(h.engine, PICKERS.c_only.displayFields);
        expect(reference).toMatchObject({ status: 403, code: 'PERMISSION_DENIED' });
        // The engine's refusal for this caller is object admission, not the
        // field guard: a query keyed on a field it MAY query on is refused the
        // same. (Under the field guard alone that query was served.)
        expect(await engineRefusal(h.engine, PICKERS.c_control.displayFields.slice(0, 1)))
            .toMatchObject({ status: 403, code: 'PERMISSION_DENIED' });
        const before = h.finds().length;
        for (const q of [undefined, 'A']) {
            const res = await h.lookup('c_only', q);
            expectRefusedAtAdmission(res);
            expect({ status: res.status, code: res.body?.code }).toEqual({ status: reference!.status, code: reference!.code });
        }
        expect(h.finds().length - before, 'the engine was asked').toBe(0);
    });

    it('[#21079] control: a picker with no masked display field still keys on its first display field, and is refused at object admission too', async () => {
        const before = h.finds().length;
        expectRefusedAtAdmission(await h.lookup('c_control'));
        expectRefusedAtAdmission(await h.lookup('c_control', 'Charl'));
        const asked = h.finds().slice(before);
        expect(asked).toHaveLength(2);
        for (const query of asked) expect(query.orderBy).toEqual([{ field: 'name', order: 'asc' }]);
    });
});

for (const [label, sets] of [
    ['the guest set does not hold the capability the rule names', [MEMBER_SET, GUEST_SET]],
] as const) {
    describe(`[#21062] a picker whose first display field is masked for its caller — ${label}`, () => {
        let h: Harness;
        beforeAll(async () => { h = await boot([...sets]); }, 60_000);
        afterAll(async () => { try { await h?.engine.destroy(); } catch { /* noop */ } });

        it('the premise: the security service answers the masked field readable and not queryable', async () => {
            const context = { permissions: ['guest_portal'], anonymous: true };
            expect(await h.security.getReadableFields(CONTACT, context)).toContain(MASKED);
            expect(await h.security.getQueryableFields(CONTACT, context)).not.toContain(MASKED);
            expect(await engineRefusal(h.engine, [MASKED])).toMatchObject({ status: 403, code: 'PERMISSION_DENIED' });
        });

        it('serves rows sorted on the next queryable display field, the masked field served masked', async () => {
            const { status, body } = await h.lookup('c_first');
            expect(status, JSON.stringify(body)).toBe(200);
            expect(ids(body)).toEqual(BY_NAME);
            expectServedMasked(body);
        });

        it('searches the next queryable display field', async () => {
            const { status, body } = await h.lookup('c_first', 'Brav');
            expect(status, JSON.stringify(body)).toBe(200);
            expect(ids(body)).toEqual(['pk1']);
            expectServedMasked(body);
        });

        it('never uses the masked field as a key', async () => {
            const before = h.finds().length;
            await h.lookup('c_first');
            await h.lookup('c_first', 'Brav');
            const asked = h.finds().slice(before);
            expect(asked).toHaveLength(2);
            for (const query of asked) {
                expect(queriedFields(query)).not.toContain(MASKED);
                expect(query.orderBy).toEqual([{ field: 'name', order: 'asc' }]);
            }
        });

        it('a picker with no queryable display field answers the engine\'s refusal, and the engine is never asked', async () => {
            const reference = await engineRefusal(h.engine, PICKERS.c_only.displayFields);
            expect(reference).toMatchObject({ status: 403, code: 'PERMISSION_DENIED' });
            const before = h.finds().length;
            for (const q of [undefined, 'A']) {
                const { status, body } = await h.lookup('c_only', q);
                expect({ status, code: body?.code, message: body?.error }).toEqual({
                    status: reference!.status, code: reference!.code, message: reference!.message,
                });
            }
            expect(h.finds().length - before, 'the engine was asked').toBe(0);
        });

        it('control: a picker with no masked display field keeps its first display field as the key', async () => {
            const sorted = await h.lookup('c_control');
            expect(sorted.status, JSON.stringify(sorted.body)).toBe(200);
            expect(ids(sorted.body)).toEqual(BY_NAME);
            const searched = await h.lookup('c_control', 'Charl');
            expect(ids(searched.body)).toEqual(['pk3']);
        });
    });
}

describe('[#21062] control: a caller the masking rule is lifted for keeps the first display field as the key', () => {
    let h: Harness;
    beforeAll(async () => { h = await boot([MEMBER_SET, GUEST_UNMASK_SET]); }, 60_000);
    afterAll(async () => { try { await h?.engine.destroy(); } catch { /* noop */ } });

    it('rows are sorted, and searched, on the first display field, served as stored', async () => {
        const sorted = await h.lookup('c_first');
        expect(sorted.status, JSON.stringify(sorted.body)).toBe(200);
        expect(ids(sorted.body)).toEqual(BY_MASKED);
        for (const row of sorted.body.data) expect(row[MASKED]).toBe(STORED_BY_ID[row.id]);
        const searched = await h.lookup('c_first', 'BBB');
        expect(ids(searched.body)).toEqual(['pk3']);
    });
});

describe('[#21062] a security service that cannot give the query answer passes over every display field declaring a masking rule', () => {
    for (const [label, sets] of [
        ['a caller the rule applies to', [MEMBER_SET, GUEST_SET]],
        ['a caller the rule is lifted for (whoever the caller is)', [MEMBER_SET, GUEST_UNMASK_SET]],
    ] as const) {
        describe(label, () => {
            let h: Harness;
            beforeAll(async () => { h = await boot([...sets]); }, 60_000);
            afterAll(async () => { try { await h?.engine.destroy(); } catch { /* noop */ } });

            it('the method absent: rows sorted and searched on the next display field', async () => {
                const older = withoutQueryAnswer(h.security);
                const sorted = await h.lookup('c_first', undefined, older);
                expect(sorted.status, JSON.stringify(sorted.body)).toBe(200);
                expect(ids(sorted.body)).toEqual(BY_NAME);
                const searched = await h.lookup('c_first', 'Brav', older);
                expect(ids(searched.body)).toEqual(['pk1']);
            });

            it('the method answering no answer: the same', async () => {
                const silent = { ...h.security, getQueryableFields: async () => undefined };
                const sorted = await h.lookup('c_first', undefined, silent);
                expect(sorted.status, JSON.stringify(sorted.body)).toBe(200);
                expect(ids(sorted.body)).toEqual(BY_NAME);
            });
        });
    }
});

/**
 * The narrowing the changeset declares (`Clause-②: yes (narrowing)`). With a
 * security service that cannot give the query answer, the fallback passes over
 * every display field declaring a masking rule WHOEVER the caller is, so for a
 * caller the rule is lifted for, a picker whose display fields all declare one
 * goes from served to refused. Its control is the same caller and picker with
 * the service that answers: served.
 */
describe('[#21062] the declared narrowing: a security service without the query answer refuses a picker whose display fields all declare a masking rule', () => {
    let h: Harness;
    beforeAll(async () => { h = await boot([MEMBER_SET, GUEST_UNMASK_SET]); }, 60_000);
    afterAll(async () => { try { await h?.engine.destroy(); } catch { /* noop */ } });

    it('a caller the rule is lifted for is refused 403 PERMISSION_DENIED, and the engine is never asked', async () => {
        const served = await h.lookup('c_only');
        expect(served.status, `control, the service that answers: ${JSON.stringify(served.body)}`).toBe(200);

        for (const older of [withoutQueryAnswer(h.security), { ...h.security, getQueryableFields: async () => undefined }]) {
            const before = h.finds().length;
            const refused = await h.lookup('c_only', undefined, older);
            expect({ status: refused.status, code: refused.body?.code }).toEqual({ status: 403, code: 'PERMISSION_DENIED' });
            expect(h.finds().length - before, 'the engine was asked').toBe(0);
        }
    });
});
