// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `PATCH /data/:object/:id` — a field the caller may not write keeps its
 * stored value, whatever its type, a `secret` field included.
 *
 * A `secret` locked by a TRUE `readonlyWhen`, or declared static `readonly`,
 * takes no caller write through the REST door: the answer is a 200 whose body
 * (`droppedFields`) and `X-ObjectStack-Dropped-Fields` header name the field,
 * and the stored reference is unchanged. The control: an unlocked `secret` sent
 * through the same door is sealed and stored as a reference.
 *
 * Harness: `RestServer` → `ObjectStackProtocolImplementation` → a real
 * `ObjectQL` over an in-memory driver, the registered PATCH route called with
 * a response double, as a non-system caller. The engine-level pins of the same
 * rule, both update paths, are in `@objectstack/objectql`'s
 * `engine-update-locked-secret.test.ts`.
 */

import { describe, it, expect, vi } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
import type { ICryptoProvider, CryptoHandle } from '@objectstack/spec/contracts';
import { RestServer } from './rest-server.js';

const DATA_ITEM = '/api/v1/data/:object/:id';
const HEADER = 'X-ObjectStack-Dropped-Fields';
const SECRET_REF_PREFIX = 'secret:';

const CRED = 'rp_locked_cred';
const CRED_OBJECT = {
    name: CRED, label: 'Credential',
    fields: {
        id: { name: 'id', type: 'text', primaryKey: true },
        name: { name: 'name', type: 'text' },
        status: { name: 'status', type: 'text' },
        state_key: { name: 'state_key', type: 'secret', readonlyWhen: "record.status == 'locked'" },
        fixed_key: { name: 'fixed_key', type: 'secret', readonly: true },
        open_key: { name: 'open_key', type: 'secret' },
    },
};
const SYS_SECRET = {
    name: 'sys_secret', label: 'Secret', systemFields: { tenant: false },
    fields: {
        id: { name: 'id', type: 'text' }, namespace: { name: 'namespace', type: 'text' }, key: { name: 'key', type: 'text' },
        kms_key_id: { name: 'kms_key_id', type: 'text' }, alg: { name: 'alg', type: 'text' },
        version: { name: 'version', type: 'number' }, ciphertext: { name: 'ciphertext', type: 'text' },
        created_at: { name: 'created_at', type: 'datetime' },
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

/** In-memory driver with copy-on-read, whose stores can be read back. */
function memoryDriver() {
    const tables = new Map<string, Map<string, Record<string, unknown>>>();
    const table = (o: string) => tables.get(o) ?? (tables.set(o, new Map()), tables.get(o)!);
    const matches = (row: Record<string, unknown>, where: unknown) =>
        !where || typeof where !== 'object' || Object.entries(where as Record<string, unknown>).every(([k, v]) =>
            k.startsWith('$') ? true : (row[k] ?? null) === (v ?? null));
    let seq = 0;
    const driver = {
        name: 'memory', version: '0.0.0', supports: {},
        async connect() {}, async disconnect() {}, async checkHealth() { return true; },
        async execute() { return null; },
        async find(object: string, ast: { where?: unknown; limit?: number }) {
            const rows = Array.from(table(object).values()).filter((r) => matches(r, ast?.where));
            const page = typeof ast?.limit === 'number' ? rows.slice(0, ast.limit) : rows;
            return page.map((r) => ({ ...r }));
        },
        async findOne(object: string, ast: { where?: unknown }) {
            for (const r of table(object).values()) if (matches(r, ast?.where)) return { ...r };
            return null;
        },
        async create(object: string, data: Record<string, unknown>) {
            seq += 1;
            const row = { ...data, id: (data.id as string) ?? `r_${seq}` };
            table(object).set(String(row.id), row);
            return { ...row };
        },
        async update(object: string, id: string, data: Record<string, unknown>) {
            const cur = table(object).get(id);
            if (!cur) return null;
            const next = { ...cur, ...data, id };
            table(object).set(id, next);
            return { ...next };
        },
        async delete(object: string, id: string) { return table(object).delete(id); },
        async count(object: string, ast: { where?: unknown }) { return (await this.find(object, ast)).length; },
        async bulkCreate() { return []; }, async bulkUpdate() { return []; }, async bulkDelete() {},
    };
    return { driver, rowOf: (o: string, id: string) => ({ ...table(o).get(id) }) };
}

function makeCrypto(): ICryptoProvider {
    let n = 0;
    return {
        async encrypt(plain: string): Promise<CryptoHandle> {
            n += 1;
            return { id: `sec_${n}`, kmsKeyId: 'local', alg: 'test-b64', version: 1, ciphertext: Buffer.from(plain).toString('base64') };
        },
        async decrypt(handle: CryptoHandle) { return Buffer.from(handle.ciphertext, 'base64').toString('utf8'); },
        async rotateKey(handle: CryptoHandle) { return handle; },
        digest(plain: string) { return `d:${plain.length}`; },
        async keyedDigest(plain: string) { return `k:${plain.length}`; },
    };
}

async function bootRest() {
    const engine = new ObjectQL();
    const { driver, rowOf } = memoryDriver();
    engine.registerDriver(driver as never, true);
    await engine.init();
    engine.registry.registerObject(SYS_SECRET as never, 'test');
    engine.registry.registerObject(CRED_OBJECT as never, 'test');
    engine.setCryptoProvider(makeCrypto());
    await engine.insert(CRED, {
        id: 'c1', name: 'one', status: 'locked', state_key: 'state-c1', fixed_key: 'fixed-c1', open_key: 'open-c1',
    }, { context: { isSystem: true } } as never);
    const protocol = new ObjectStackProtocolImplementation(engine as never);
    const rest = new RestServer(createMockServer() as never, protocol as never, { api: { requireAuth: false } } as never);
    // A NON-system caller: the one both read-only strips run for.
    (rest as unknown as { resolveExecCtx: () => Promise<unknown> }).resolveExecCtx = async () => ({ userId: 'u1' });
    rest.registerRoutes();
    const patch = async (id: string, body: Record<string, unknown>) => {
        const route = (rest.getRoutes() as Array<{ method: string; path: string; handler: (rq: unknown, rs: unknown) => Promise<void> }>)
            .find((r) => r.method === 'PATCH' && r.path === DATA_ITEM);
        if (!route) throw new Error(`PATCH ${DATA_ITEM} route not registered`);
        const res = makeRes();
        await route.handler({ method: 'PATCH', params: { object: CRED, id }, query: {}, body, headers: {} }, res);
        return res as unknown as { statusCode: number; body: Record<string, unknown>; headers: Record<string, string> };
    };
    return { patch, stored: (id: string) => rowOf(CRED, id), secret: (id: string) => rowOf('sys_secret', id) };
}

describe('PATCH /data/:object/:id — a secret field the caller may not write keeps its stored value', () => {
    it('a locked secret (readonlyWhen and static readonly) keeps its stored value, and the answer reports it', async () => {
        const { patch, stored } = await bootRest();
        const before = stored('c1');

        const answer = await patch('c1', { name: 'renamed', state_key: 'caller-a', fixed_key: 'caller-b' });

        expect(answer.statusCode).toBe(200);
        expect(stored('c1').name).toBe('renamed');
        expect(stored('c1').state_key).toBe(before.state_key);
        expect(stored('c1').fixed_key).toBe(before.fixed_key);
        expect(answer.body.droppedFields).toEqual(expect.arrayContaining([
            { object: CRED, fields: ['state_key'], reason: 'readonly_when' },
            { object: CRED, fields: ['fixed_key'], reason: 'readonly' },
        ]));
        expect(answer.headers[HEADER]).toContain('state_key;reason=readonly_when');
        expect(answer.headers[HEADER]).toContain('fixed_key;reason=readonly');
    }, 60_000);

    it('control: an unlocked secret sent through the same door is sealed and stored as a reference', async () => {
        const { patch, stored, secret } = await bootRest();
        const before = stored('c1').open_key;

        const answer = await patch('c1', { open_key: 'fresh-value' });

        expect(answer.statusCode).toBe(200);
        const after = String(stored('c1').open_key);
        expect(after.startsWith(SECRET_REF_PREFIX)).toBe(true);
        expect(after).not.toBe(before);
        const sealed = secret(after.slice(SECRET_REF_PREFIX.length));
        expect(Buffer.from(String(sealed.ciphertext), 'base64').toString('utf8')).toBe('fresh-value');
        expect(answer.body.droppedFields).toBeUndefined();
    }, 60_000);
});
