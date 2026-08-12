// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#8093] `PATCH /data/:object/:id` must not report the row's OWN primary key
// as a field the caller supplied and the engine refused.
//
// ## The reported symptom
//
// Every org switch popped a user-facing amber toast — 「已保存，但部分字段未生效
// / 以下字段为只读，未生效: 偏好设置 ID」 — behind the console's internal
// `ui.recent` preference write:
//
//     PATCH /api/v1/data/sys_user_preference/4mekbFDEhx0QgC85 → 200
//     { …, "droppedFields": [ { "fields": ["id"], "reason": "readonly" } ] }
//
// `id` is the record's primary key, carried in the URL PATH. The client's body
// is `{ value: items }` and carries no `id` at all.
//
// ## Why this file drives the whole ingress instead of unit-testing the engine
//
// The card named a FORK it could not settle from the client source alone: the
// request body was never captured on the wire, so "the server folds the path id
// into the candidate write set" was an INFERENCE, and the alternative — the
// running build's client actually sending `id` — would have made this a client
// card in another repo. A fake engine cannot answer that; only executing the
// real ingress can. So: a REAL `ObjectQL`, a REAL
// `ObjectStackProtocolImplementation`, the REAL registered PATCH route, and a
// body that provably contains no `id` because this file writes it.
//
// Measured on unfixed `main` (recorded in the PR body): the body below carries
// no `id`, and the response still comes back with
// `droppedFields:[{fields:['id'],reason:'readonly'}]`. The server manufactures
// it — `updateData` folds `request.id` into the write payload (#6479, so a body
// `id` cannot bind another row), the engine snapshots that payload as
// "caller-supplied", and the static-`readonly` strip then reports the row's own
// address as a refused write. The client half of the fork is disproved: the
// defect reproduces with a body that never had an `id` in it.
//
// ## Both directions are pinned
//
// The fix NARROWS what gets reported, so the counter-case is not optional: a
// read-only field the caller really did supply must still be reported. Without
// it this file cannot tell the fix apart from "stop reporting dropped fields".

import { describe, it, expect, vi } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
import { RestServer } from './rest-server.js';

const DATA_COLLECTION = '/api/v1/data/:object';
const DATA_ITEM = '/api/v1/data/:object/:id';

/**
 * `sys_user_preference`'s real shape, field-for-field on the parts that matter
 * (`packages/platform-objects/src/identity/sys-user-preference.object.ts`):
 * `id` is `readonly: true` with label "Preference ID" — the label the toast
 * rendered as 「偏好设置 ID」 — and `created_at` / `updated_at` are read-only
 * too. `value` is the JSON column the recents trace actually writes.
 */
const PREFERENCE = {
    name: 'rp_user_preference',
    label: 'User Preference',
    fields: {
        id: { name: 'id', label: 'Preference ID', type: 'text', primaryKey: true, required: true, readonly: true },
        created_at: { name: 'created_at', label: 'Created At', type: 'datetime', readonly: true },
        user_id: { name: 'user_id', label: 'User', type: 'text', required: true },
        key: { name: 'key', label: 'Key', type: 'text', required: true },
        value: { name: 'value', label: 'Value', type: 'json' },
    },
};

function createMockServer() {
    return {
        get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn(), patch: vi.fn(), use: vi.fn(),
        listen: vi.fn().mockResolvedValue(undefined), close: vi.fn().mockResolvedValue(undefined),
    };
}

function makeRes() {
    const res: Record<string, unknown> = { statusCode: 200, body: undefined, headers: {} as Record<string, string> };
    res.status = vi.fn((c: number) => { res.statusCode = c; return res; });
    res.json = vi.fn((b: unknown) => { res.body = b; return res; });
    res.header = vi.fn((k: string, v: string) => { (res.headers as Record<string, string>)[k] = v; return res; });
    res.setHeader = vi.fn(); res.write = vi.fn(); res.end = vi.fn(); res.send = vi.fn();
    return res;
}

/** In-memory driver with `RETURNING *` write semantics and copy-on-read. */
function memoryDriver() {
    const rows = new Map<string, Map<string, Record<string, unknown>>>();
    const table = (o: string) => {
        let t = rows.get(o);
        if (!t) { t = new Map(); rows.set(o, t); }
        return t;
    };
    /** Every payload the driver was handed, so the SET clause is inspectable. */
    const writes: Array<{ id: string; data: Record<string, unknown> }> = [];
    let seq = 0;
    const matches = (row: Record<string, unknown>, where: unknown) => {
        if (!where || typeof where !== 'object') return true;
        for (const [k, v] of Object.entries(where as Record<string, unknown>)) {
            if (k.startsWith('$')) continue;
            const want = (v && typeof v === 'object' && '$eq' in (v as Record<string, unknown>))
                ? (v as Record<string, unknown>).$eq
                : v;
            if ((row[k] ?? null) !== (want ?? null)) return false;
        }
        return true;
    };
    const driver = {
        name: 'memory', version: '0.0.0', supports: {},
        async connect() {}, async disconnect() {}, async checkHealth() { return true; },
        async execute() { return null; },
        async find(object: string, ast: { where?: unknown }) {
            return Array.from(table(object).values()).filter((r) => matches(r, ast?.where)).map((r) => ({ ...r }));
        },
        async findOne(object: string, ast: { where?: unknown }) {
            for (const r of table(object).values()) if (matches(r, ast?.where)) return { ...r };
            return null;
        },
        async create(object: string, data: Record<string, unknown>) {
            seq += 1;
            const id = (data.id as string) ?? `r_${seq}`;
            const row = { ...data, id };
            table(object).set(id, row);
            return { ...row };
        },
        async update(object: string, id: string, data: Record<string, unknown>) {
            writes.push({ id, data: { ...data } });
            const t = table(object);
            const cur = t.get(id);
            if (!cur) return null;
            const next = { ...cur, ...data, id };
            t.set(id, next);
            return { ...next };
        },
        async delete(object: string, id: string) { return table(object).delete(id); },
        async upsert(object: string, data: Record<string, unknown>) { return this.create(object, data); },
        async count(object: string, ast: { where?: unknown }) { return (await this.find(object, ast)).length; },
        async bulkCreate(object: string, list: Record<string, unknown>[]) {
            const out = [];
            for (const r of list) out.push(await this.create(object, r));
            return out;
        },
        async bulkUpdate() { return []; }, async bulkDelete() {},
        async beginTransaction() { return { commit: async () => {}, rollback: async () => {} }; },
        async commit() {}, async rollback() {},
    };
    return { driver, writes };
}

async function bootRest() {
    const engine = new ObjectQL();
    const { driver, writes } = memoryDriver();
    engine.registerDriver(driver as never, true);
    await engine.init();
    engine.registry.registerObject(PREFERENCE as never, 'test');
    const protocol = new ObjectStackProtocolImplementation(engine as never);
    const rest = new RestServer(
        createMockServer() as never,
        protocol as never,
        { api: { requireAuth: false } } as never,
    );
    // A NON-system caller: the console's browser session, i.e. the one the
    // static-`readonly` strip actually runs for.
    (rest as unknown as { resolveExecCtx: () => Promise<unknown> }).resolveExecCtx =
        async () => ({ userId: 'u1' });
    rest.registerRoutes();
    return { rest, writes };
}

async function call(
    rest: Awaited<ReturnType<typeof bootRest>>['rest'],
    method: string,
    path: string,
    req: Record<string, unknown>,
) {
    const route = (rest.getRoutes() as Array<{ method: string; path: string; handler: (rq: unknown, rs: unknown) => Promise<void> }>)
        .find((r) => r.method === method && r.path === path);
    if (!route) throw new Error(`${method} ${path} route not registered`);
    const res = makeRes();
    await route.handler({ method, params: {}, query: {}, body: {}, headers: {}, ...req }, res);
    return res as unknown as { statusCode: number; body: Record<string, unknown>; headers: Record<string, string> };
}

/** Seed one preference row and return its server-issued id. */
async function seed(rest: Awaited<ReturnType<typeof bootRest>>['rest']) {
    const created = await call(rest, 'POST', DATA_COLLECTION, {
        params: { object: 'rp_user_preference' },
        body: { user_id: 'u1', key: 'ui.recent', value: [{ object: 'account', id: 'a1' }] },
    });
    expect(created.statusCode).toBe(201);
    return String(created.body.id);
}

type Dropped = Array<{ object: string; fields: string[]; reason: string }>;

describe('[#8093] the path id is addressing, not a dropped field', () => {
    it('a body that carries no `id` reports NO droppedFields at all', async () => {
        const { rest, writes } = await bootRest();
        const id = await seed(rest);
        writes.length = 0;

        // The console's recents trace, verbatim: `{ value: items }`. There is
        // no `id` key in this object — that is the whole point of the case.
        const body = { value: [{ object: 'account', id: 'a2' }] };
        expect(Object.prototype.hasOwnProperty.call(body, 'id')).toBe(false);

        const patched = await call(rest, 'PATCH', DATA_ITEM, {
            params: { object: 'rp_user_preference', id },
            body,
        });

        expect(patched.statusCode).toBe(200);
        // The card's invariant: `droppedFields` reports fields the CALLER
        // SUPPLIED and the engine refused. Nothing here was supplied and
        // refused, so the key must be absent entirely (the omit-when-empty
        // shape every client reads).
        expect(patched.body.droppedFields).toBeUndefined();
        // ...and the header the toast's sibling channel reads stays unset.
        expect(patched.headers['X-ObjectStack-Dropped-Fields']).toBeUndefined();

        // The write itself is unchanged in every other respect: it committed,
        // and the primary key never reached the driver's SET clause (a strip
        // this fix deliberately does NOT undo — see the PR body).
        expect((patched.body.record as Record<string, unknown>).value)
            .toEqual([{ object: 'account', id: 'a2' }]);
        expect(writes).toHaveLength(1);
        expect(Object.prototype.hasOwnProperty.call(writes[0].data, 'id')).toBe(false);
        expect(writes[0].id).toBe(id);
    }, 60_000);

    it('a read-only field the caller DID supply is still reported, unchanged', async () => {
        // The counter-direction. Without this case the fix above is
        // indistinguishable from "stop reporting dropped fields".
        const { rest } = await bootRest();
        const id = await seed(rest);

        const patched = await call(rest, 'PATCH', DATA_ITEM, {
            params: { object: 'rp_user_preference', id },
            body: { value: ['x'], created_at: '2020-01-01T00:00:00.000Z' },
        });

        expect(patched.statusCode).toBe(200);
        expect(patched.body.droppedFields).toEqual([
            { object: 'rp_user_preference', fields: ['created_at'], reason: 'readonly' },
        ]);
        // The header channel still carries it too.
        expect(patched.headers['X-ObjectStack-Dropped-Fields']).toBe('created_at;reason=readonly');
    }, 60_000);

    it('a supplied read-only field is reported WITHOUT the path id riding along', async () => {
        // The mixed case is where a whole-set report would leak the address
        // back in: one real refusal must not drag `id` into the list.
        const { rest } = await bootRest();
        const id = await seed(rest);

        const patched = await call(rest, 'PATCH', DATA_ITEM, {
            params: { object: 'rp_user_preference', id },
            body: { value: ['y'], created_at: '2020-01-01T00:00:00.000Z' },
        });

        const dropped = patched.body.droppedFields as Dropped;
        expect(dropped.flatMap((d) => d.fields)).not.toContain('id');
        expect(dropped.flatMap((d) => d.fields)).toEqual(['created_at']);
    }, 60_000);
});
