// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #7799 — the subscriber's signing secret must not be recoverable from
 * `sys_webhook`, and signing must keep producing the byte-identical signature
 * existing receivers already verify.
 *
 * These run against a REAL {@link ObjectQL} engine with the REAL
 * {@link SysWebhook} schema registered, not an engine fake, because the whole
 * claim is about what the engine's own write and read paths do with a
 * `type: 'secret'` field: a fake that echoes back whatever it was handed would
 * pass every assertion here while the product stayed broken. Only the DRIVER is
 * a double (equality-only WHERE, in-memory maps), which also gives the at-rest
 * scan something to look at — `stores` holds exactly the bytes a real table
 * would.
 *
 * Sibling coverage: `webhook-signing-secret.test.ts` (#7722) pins the same wire
 * signature for the delivery-row half.
 */

import { createHmac, randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { ObjectQL, SECRET_MASK, SECRET_REF_PREFIX } from '@objectstack/objectql';
import { DataEventSchema } from '@objectstack/spec/api';
import type {
    IRealtimeService,
    RealtimeEventHandler,
    RealtimeEventPayload,
    ICryptoProvider,
    CryptoHandle,
    CryptoContext,
} from '@objectstack/spec/contracts';
import { MemoryHttpOutbox, HttpDispatcher, type FetchImpl } from '@objectstack/service-messaging';
import { AutoEnqueuer } from './auto-enqueuer.js';
import { bootstrapDeclaredWebhooks } from './bootstrap-declared-webhooks.js';
import { migrateLegacyWebhookSecrets } from './migrate-webhook-secrets.js';
import { SysWebhook } from './sys-webhook.object.js';
import { WEBHOOK_SECRET_FIELD, __objectqlSecretWireForms } from './webhook-secret.js';
import { WEBHOOK_HEADERS_FIELD } from './webhook-headers.js';

const SECRET = 'whsec_7799_subscriber_key';
const SYSTEM_CTX = { isSystem: true, positions: [], permissions: [] } as const;

// ---------------------------------------------------------------------------
// Doubles: driver (in-memory), crypto provider (reversible base64), realtime
// ---------------------------------------------------------------------------

/**
 * Driver-shaped double — `update(object, id, data)`, primary key SECOND. This
 * is an `IDataDriver`, not an `IDataEngine`, so the engine's own dispatch
 * contract still runs above it (see `check:engine-double-contract`).
 */
function makeStubDriver() {
    const stores = new Map<string, Map<string, Record<string, unknown>>>();
    const storeFor = (obj: string) => {
        let s = stores.get(obj);
        if (!s) { s = new Map(); stores.set(obj, s); }
        return s;
    };
    let nextId = 0;
    const matches = (row: any, where: any): boolean => {
        if (!where || typeof where !== 'object') return true;
        for (const [k, v] of Object.entries(where)) {
            if (k.startsWith('$')) continue;
            const expected = (v && typeof v === 'object' && '$eq' in (v as any)) ? (v as any).$eq : v;
            if ((row[k] ?? null) !== (expected ?? null)) return false;
        }
        return true;
    };
    // Rows leave the driver as COPIES, exactly as a real driver's do. Handing
    // out the live stored object would make this file lie in the one direction
    // it must not: `maskSecretFields` mutates the rows it is given, so a shared
    // reference would stamp the mask onto the "at rest" bytes the byte-scan
    // reads, and the very same read would destroy the ref the signing path
    // needs. Both would look like product bugs.
    const copy = <T>(r: T): T => (r == null ? r : ({ ...r } as T));
    const driver: any = {
        name: 'memory', version: '0.0.0', supports: {},
        async connect() {}, async disconnect() {}, async checkHealth() { return true; },
        async execute() { return null; },
        async find(object: string, ast: any) {
            return Array.from(storeFor(object).values()).filter((r) => matches(r, ast?.where)).map(copy);
        },
        async findOne(object: string, ast: any) {
            for (const r of storeFor(object).values()) if (matches(r, ast?.where)) return copy(r);
            return null;
        },
        async create(object: string, data: Record<string, unknown>) {
            nextId += 1;
            const id = (data.id as string) ?? `r_${nextId}`;
            const row = { ...data, id };
            storeFor(object).set(id, row);
            return copy(row);
        },
        async update(object: string, id: string, data: Record<string, unknown>) {
            const s = storeFor(object);
            const cur = s.get(id);
            if (!cur) throw new Error(`not found: ${object}/${id}`);
            const updated = { ...cur, ...data, id };
            s.set(id, updated);
            return copy(updated);
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

/**
 * Reversible test crypto. Base64 is NOT encryption — the point is only that the
 * stored form is a TRANSFORM of the plaintext, so a byte-scan for the raw key
 * cannot pass by accident on a value that merely looks scrambled.
 */
function makeFakeCrypto() {
    let n = 0;
    const provider: ICryptoProvider = {
        async encrypt(plain: string, _ctx: CryptoContext): Promise<CryptoHandle> {
            n += 1;
            return {
                id: `sec_${n}`, kmsKeyId: 'local', alg: 'test-b64', version: 1,
                ciphertext: Buffer.from(plain, 'utf8').toString('base64'),
            };
        },
        async decrypt(handle: CryptoHandle, _ctx: CryptoContext): Promise<string> {
            return Buffer.from(handle.ciphertext, 'base64').toString('utf8');
        },
        async rotateKey(handle: CryptoHandle): Promise<CryptoHandle> {
            return { ...handle, version: handle.version + 1 };
        },
        digest(plain: string): string { return `d:${plain.length}`; },
    };
    return provider;
}

class FakeRealtime implements IRealtimeService {
    private subs = new Map<string, { handler: RealtimeEventHandler; opts?: any }>();
    private n = 0;
    async publish(event: RealtimeEventPayload): Promise<void> {
        for (const sub of this.subs.values()) {
            const o = sub.opts ?? {};
            if (o.object && event.object !== o.object) continue;
            await sub.handler(event);
        }
    }
    async subscribe(_channel: string, handler: any, opts?: any): Promise<string> {
        const id = `s-${++this.n}`;
        this.subs.set(id, { handler, opts });
        return id;
    }
    async unsubscribe(id: string): Promise<void> { this.subs.delete(id); }
}

/** Minimal `sys_secret` — the cipher store the `secret` channel writes into. */
const sysSecretObject = {
    name: 'sys_secret', label: 'Secret',
    fields: {
        id: { name: 'id', label: 'ID', type: 'text' as const },
        namespace: { name: 'namespace', label: 'Namespace', type: 'text' as const },
        key: { name: 'key', label: 'Key', type: 'text' as const },
        kms_key_id: { name: 'kms_key_id', label: 'KMS', type: 'text' as const },
        alg: { name: 'alg', label: 'Alg', type: 'text' as const },
        version: { name: 'version', label: 'Version', type: 'number' as const },
        ciphertext: { name: 'ciphertext', label: 'Ciphertext', type: 'text' as const },
        created_at: { name: 'created_at', label: 'Created', type: 'datetime' as const },
    },
};

/**
 * A booted engine over a store.
 *
 * `reuse` hands back the SAME driver (and therefore the same rows) under a
 * fresh engine — a process restart against an existing database, which is the
 * only way to reach a state where the ciphertext predates the engine reading
 * it (#8022).
 */
async function buildEngine(
    opts: { withCrypto?: boolean; reuse?: { driver: any; stores: Map<string, Map<string, Record<string, unknown>>> } } = {},
) {
    const engine = new ObjectQL();
    const { driver, stores } = opts.reuse ?? makeStubDriver();
    engine.registerDriver(driver, true);
    await engine.init();
    engine.registry.registerObject(sysSecretObject as any, 'test');
    engine.registry.registerObject(SysWebhook as any, 'test');
    if (opts.withCrypto !== false) engine.setCryptoProvider(makeFakeCrypto());
    return { engine, stores, driver };
}

/** A declared webhook, as `defineStack({ webhooks })` would author it. */
function declaredWebhook(overrides: Record<string, unknown> = {}) {
    return {
        name: 'crm_hook',
        object: 'contact',
        triggers: ['create'],
        url: 'https://receiver.example/hook',
        method: 'POST',
        headers: { 'X-Team': 'crm' },
        secret: SECRET,
        ...overrides,
    };
}

/** Metadata service that hands the seeder its declared items. */
function metadataWith(items: unknown[]) {
    return { list: (type: string) => (type === 'webhook' ? items : []) };
}

function recordEvent(object: string, record: any): RealtimeEventPayload {
    const payload = DataEventSchema.parse({
        id: randomUUID(),
        type: 'data.record.created',
        object,
        recordId: String(record.id),
        after: record,
        timestamp: '2026-08-12T00:00:00.000Z',
    });
    return { type: payload.type, object, payload: { ...payload }, timestamp: payload.timestamp };
}

function makeFetch() {
    const calls: Array<{ headers: Record<string, string>; body: string }> = [];
    const impl: FetchImpl = async (_url, init) => {
        calls.push({ headers: init.headers, body: init.body });
        return { ok: true, status: 200, async text() { return 'ok'; } };
    };
    return { impl, calls };
}

/** Drive one create event all the way to the wire; return what the receiver saw. */
async function deliverOnce(engine: any) {
    const realtime = new FakeRealtime();
    const outbox = new MemoryHttpOutbox();
    const enqueuer = new AutoEnqueuer(engine, realtime, (input) => outbox.enqueue(input));
    await enqueuer.start();
    await realtime.publish(recordEvent('contact', { id: 'c1', name: 'Ada' }));
    // The enqueue is deliberately fire-and-forget on the hot path.
    await new Promise((r) => setTimeout(r, 0));
    const { impl, calls } = makeFetch();
    await new HttpDispatcher({ nodeId: 'n1', outbox, fetchImpl: impl, partitionCount: 1 }).tick();
    await enqueuer.stop();
    return { calls, outbox };
}

// ---------------------------------------------------------------------------

describe('webhook signing secret at rest (#7799)', () => {
    // `webhook-secret.ts` restates objectql's two opaque wire forms because this
    // package takes no dependency on objectql. Pin them: if either is renamed
    // there, the plugin would stop recognising an unrecoverable value and could
    // hand the MASK to the HMAC — every delivery silently rejected downstream.
    it('the locally-restated objectql secret wire forms still match objectql', () => {
        expect(__objectqlSecretWireForms.mask).toBe(SECRET_MASK);
        expect(__objectqlSecretWireForms.refPrefix).toBe(SECRET_REF_PREFIX);
    });

    it('the secret\'s bytes appear nowhere in the persisted sys_webhook row', async () => {
        const { engine, stores } = await buildEngine();

        await bootstrapDeclaredWebhooks(engine, metadataWith([declaredWebhook()]));

        // ── The read path an ordinary GET /api/v1/data/sys_webhook takes ──
        // Substring, not a field check: the defect was the key NESTED inside a
        // serialized blob, which any per-field assertion walks straight past.
        const viaApi = await engine.find('sys_webhook', { where: { name: 'crm_hook' } });
        expect(viaApi).toHaveLength(1);
        expect(JSON.stringify(viaApi)).not.toContain(SECRET);
        expect(String(viaApi[0].definition_json)).not.toContain(SECRET);

        // ── And at rest, in the bytes the table itself holds ──
        const stored = Array.from(stores.get('sys_webhook')!.values())[0] as any;
        expect(JSON.stringify(stored)).not.toContain(SECRET);
        expect(String(stored.definition_json)).not.toContain(SECRET);
        // The row keeps an opaque handle, and the cipher store holds a transform.
        expect(String(stored[WEBHOOK_SECRET_FIELD])).toMatch(/^secret:/);
        // Two cipher rows since #7986, not one: this fixture authors a header
        // map as well, and it rides the same encrypted channel. Asserted by
        // NAMESPACE/KEY rather than by position so the pin still says which row
        // is the signing secret's, and so a future third passenger reddens here
        // instead of silently shifting an index.
        const ciphered = Array.from(stores.get('sys_secret')!.values()) as any[];
        expect(ciphered).toHaveLength(2);
        const secretCipher = ciphered.filter((c) => c.key === WEBHOOK_SECRET_FIELD);
        expect(secretCipher).toHaveLength(1);
        expect(secretCipher[0].namespace).toBe('sys_webhook');
        expect(secretCipher[0].ciphertext).not.toContain(SECRET);

        // The rest of the envelope survives — this is a strip, not a truncation.
        // `headers` used to be asserted here as one of the survivors; #7986
        // moved it onto the same encrypted channel as the key (it is the
        // ordinary place an `Authorization: Bearer …` goes), so `timeoutMs`
        // carries that half of the assertion now. The headers' own at-rest and
        // on-the-wire pins are in the `#7986` blocks below.
        expect(JSON.parse(String(stored.definition_json))).toMatchObject({
            name: 'crm_hook',
            url: 'https://receiver.example/hook',
            timeoutMs: 30000,
        });
    });

    it('signs with the byte-identical signature existing receivers already verify', async () => {
        const { engine } = await buildEngine();
        await bootstrapDeclaredWebhooks(engine, metadataWith([declaredWebhook()]));

        const { calls, outbox } = await deliverOnce(engine);

        // The receiver's own check: recompute HMAC-SHA256 over the RAW body with
        // the key it was given out-of-band. Unchanged wire format means this
        // computation — which no receiver had to update — still matches.
        expect(calls).toHaveLength(1);
        const expected = createHmac('sha256', SECRET).update(calls[0].body).digest('hex');
        expect(calls[0].headers['X-Objectstack-Signature']).toBe(`sha256=${expected}`);
        // A blank body would satisfy the HMAC too — pin what was actually signed.
        expect(JSON.parse(calls[0].body)).toMatchObject({ object: 'contact', recordId: 'c1', action: 'created' });
        expect(calls[0].headers['X-Team']).toBe('crm');
        // …and #7722's invariant still holds on the delivery row.
        expect(JSON.stringify(await outbox.list())).not.toContain(SECRET);
    });

    it('re-seeding an unchanged webhook does not mint a second sys_secret row', async () => {
        const { engine, stores } = await buildEngine();
        const declared = metadataWith([declaredWebhook()]);

        await bootstrapDeclaredWebhooks(engine, declared);
        await bootstrapDeclaredWebhooks(engine, declared);
        await bootstrapDeclaredWebhooks(engine, declared);

        // Every boot re-seeds package rows; a blind restatement of the key would
        // leave one orphan ciphertext row per restart. Two rows, not one, since
        // #7986 — one per credential — and the property under test is that the
        // count does not GROW across the three boots.
        expect(stores.get('sys_secret')!.size).toBe(2);
    });

    it('rotating the declared secret in code re-encrypts and signs with the new key', async () => {
        const { engine } = await buildEngine();
        await bootstrapDeclaredWebhooks(engine, metadataWith([declaredWebhook()]));

        const ROTATED = 'whsec_7799_rotated';
        await bootstrapDeclaredWebhooks(engine, metadataWith([declaredWebhook({ secret: ROTATED })]));

        const { calls } = await deliverOnce(engine);
        const expected = createHmac('sha256', ROTATED).update(calls[0].body).digest('hex');
        expect(calls[0].headers['X-Objectstack-Signature']).toBe(`sha256=${expected}`);
    });

    it('a webhook authored without a secret still materializes and delivers unsigned', async () => {
        const { engine, stores } = await buildEngine();
        // `headers` dropped alongside `secret` so this pin keeps asserting what
        // it always asserted — that a webhook with NO credentials does no crypto
        // at all and therefore needs no CryptoProvider. (Since #7986 a header
        // map is a credential too; the headers-only case is pinned separately in
        // the #7986 block below.)
        await bootstrapDeclaredWebhooks(
            engine,
            metadataWith([declaredWebhook({ secret: undefined, headers: undefined })]),
        );

        // No crypto work at all for a credential-free webhook.
        expect(stores.get('sys_secret')?.size ?? 0).toBe(0);
        const { calls } = await deliverOnce(engine);
        expect(calls).toHaveLength(1);
        expect(calls[0].headers['X-Objectstack-Signature']).toBeUndefined();
    });
});

describe('legacy cleartext migration (#7799)', () => {
    /** A pre-#7799 row: the whole envelope, key included, in `definition_json`. */
    async function seedLegacyRow(engine: any) {
        await engine.insert('sys_webhook', {
            id: 'whk_legacy',
            name: 'legacy_hook',
            label: 'Legacy',
            object_name: 'contact',
            triggers: ['create'],
            url: 'https://receiver.example/hook',
            method: 'post',
            active: true,
            // The shape the seeder used to write, verbatim.
            definition_json: JSON.stringify({
                name: 'legacy_hook', url: 'https://receiver.example/hook',
                headers: { 'X-Team': 'crm' }, secret: SECRET, timeoutMs: 30000,
            }),
            managed_by: 'admin',
            customized: true,
            created_at: '2026-01-01T00:00:00.000Z',
        }, { context: SYSTEM_CTX } as any);
    }

    it('sweeps an admin-authored row the seeder never touches, and keeps it signing', async () => {
        const { engine, stores } = await buildEngine();
        await seedLegacyRow(engine);

        // Precondition: this is genuinely the exposed shape.
        expect(JSON.stringify(await engine.find('sys_webhook', {}))).toContain(SECRET);

        const result = await migrateLegacyWebhookSecrets(engine);
        expect(result).toEqual({ found: 1, migrated: 1, failed: 0 });

        // Gone from the API read AND from the bytes at rest.
        expect(JSON.stringify(await engine.find('sys_webhook', {}))).not.toContain(SECRET);
        expect(JSON.stringify(Array.from(stores.get('sys_webhook')!.values()))).not.toContain(SECRET);

        // …and the same key still produces the same signature.
        const { calls } = await deliverOnce(engine);
        const expected = createHmac('sha256', SECRET).update(calls[0].body).digest('hex');
        expect(calls[0].headers['X-Objectstack-Signature']).toBe(`sha256=${expected}`);

        // The sweep does not re-freeze provenance, and is free on the next boot.
        const row = Array.from(stores.get('sys_webhook')!.values())[0] as any;
        expect(row.managed_by).toBe('admin');
        expect(await migrateLegacyWebhookSecrets(engine)).toEqual({ found: 0, migrated: 0, failed: 0 });
    });

    it('an un-swept row keeps signing — the enqueuer reads the legacy blob and says so', async () => {
        const { engine } = await buildEngine();
        await seedLegacyRow(engine);

        const warnings: string[] = [];
        const realtime = new FakeRealtime();
        const outbox = new MemoryHttpOutbox();
        const enqueuer = new AutoEnqueuer(engine, realtime, (i) => outbox.enqueue(i), {
            logger: { warn: (m: string) => { warnings.push(m); } },
        });
        await enqueuer.start();
        await realtime.publish(recordEvent('contact', { id: 'c1', name: 'Ada' }));
        await new Promise((r) => setTimeout(r, 0));
        const { impl, calls } = makeFetch();
        await new HttpDispatcher({ nodeId: 'n1', outbox, fetchImpl: impl, partitionCount: 1 }).tick();
        await enqueuer.stop();

        const expected = createHmac('sha256', SECRET).update(calls[0].body).digest('hex');
        expect(calls[0].headers['X-Objectstack-Signature']).toBe(`sha256=${expected}`);
        expect(warnings.join('\n')).toMatch(/CLEARTEXT in definition_json/);
    });
});

describe('fail-closed: no CryptoProvider (#7799)', () => {
    it('refuses to seed a secret-bearing webhook, reporting an ADR-0112 code + status', async () => {
        const { engine, stores } = await buildEngine({ withCrypto: false });
        const warns: Array<{ msg: string; meta: any }> = [];

        const result = await bootstrapDeclaredWebhooks(engine, metadataWith([declaredWebhook()]), {
            warn: (msg: string, meta?: unknown) => { warns.push({ msg, meta }); },
        });

        expect(result).toEqual({ seeded: 0, skipped: 1 });
        // Nothing was written — not the row, not a cleartext fallback column.
        expect(stores.get('sys_webhook')?.size ?? 0).toBe(0);
        expect(stores.get('sys_secret')?.size ?? 0).toBe(0);

        // ADR-0112: a consumer branches on the pair, not on the message text.
        const refusal = warns.find((w) => w.meta?.code);
        expect(refusal?.meta).toMatchObject({ code: 'INTERNAL_ERROR', status: 500 });
        expect(refusal?.msg).toMatch(/cannot be stored encrypted/);
    });

    it('leaves a legacy row exactly as it was, and reports it as still cleartext', async () => {
        const { engine, stores } = await buildEngine({ withCrypto: false });
        await engine.insert('sys_webhook', {
            id: 'whk_legacy', name: 'legacy_hook', label: 'Legacy', object_name: 'contact',
            triggers: ['create'], url: 'https://receiver.example/hook', method: 'post', active: true,
            definition_json: JSON.stringify({ name: 'legacy_hook', secret: SECRET }),
            managed_by: 'admin', created_at: '2026-01-01T00:00:00.000Z',
        }, { context: SYSTEM_CTX } as any);

        const warns: Array<{ msg: string; meta: any }> = [];
        const result = await migrateLegacyWebhookSecrets(engine, {
            warn: (msg: string, meta?: unknown) => { warns.push({ msg, meta }); },
        });

        expect(result).toEqual({ found: 1, migrated: 0, failed: 1 });
        expect(warns[0].meta).toMatchObject({ code: 'INTERNAL_ERROR', status: 500 });
        // Partial application would be the dangerous outcome: the blob stripped
        // while nothing encrypted holds the key, silently unsigning the webhook.
        const row = Array.from(stores.get('sys_webhook')!.values())[0] as any;
        expect(String(row.definition_json)).toContain(SECRET);
        expect(row[WEBHOOK_SECRET_FIELD] ?? null).toBeNull();
    });
});

/**
 * #8022 — the boot window #7799 opened.
 *
 * Every host wires its CryptoProvider from the composition root AFTER
 * `runtime.start()` returns, and `runtime.start()` is what runs `kernel:ready`
 * — the hook under which `AutoEnqueuer.start()` builds its first subscription
 * cache. So the first build does not merely *race* crypto registration, it
 * reliably precedes it: on `packages/cli/src/commands/serve.ts` the
 * `setCryptoProvider` call sits below `await runtime.start()` unconditionally.
 * A secret-bearing webhook was therefore dropped on every boot — correctly, on
 * what the enqueuer could see — and nothing re-armed it until the periodic
 * refresh up to 60s later. In that window a record change produced no delivery
 * AND no `sys_http_delivery` row: not a dead letter, not a retry, nothing.
 *
 * The fail-closed drop is NOT what these tests relax. #7799's refusal to
 * deliver unsigned is asserted below to still hold, before and after. What is
 * fixed is the ORDERING: the drop must not outlive the reason for it.
 */
describe('boot ordering: the cache is built before the CryptoProvider (#8022)', () => {
    /** Reboot onto the same rows in the host's real order: kernel first, crypto after. */
    async function bootWithoutCrypto() {
        const first = await buildEngine();
        await bootstrapDeclaredWebhooks(first.engine, metadataWith([declaredWebhook()]));
        // Precondition: the credentials are at rest as ciphertext only — the
        // exact population #7799 created, and the only one this defect can
        // reach. Two rows since #7986 (signing secret + header map).
        expect(first.stores.get('sys_secret')!.size).toBe(2);

        return buildEngine({
            withCrypto: false,
            reuse: { driver: first.driver, stores: first.stores },
        });
    }

    /** Let the engine-driven re-arm settle. Two macrotasks — no polling, no 60s. */
    const settle = async () => {
        await new Promise((r) => setTimeout(r, 0));
        await new Promise((r) => setTimeout(r, 0));
    };

    it('re-arms the dropped subscription when the CryptoProvider registers, without the 60s refresh', async () => {
        const { engine } = await bootWithoutCrypto();
        const realtime = new FakeRealtime();
        const outbox = new MemoryHttpOutbox();
        const enqueuer = new AutoEnqueuer(engine, realtime, (i) => outbox.enqueue(i), {
            // The escape hatch this defect self-heals through, held shut. With a
            // periodic refresh armed, a passing test proves only that waiting
            // works — which it already did, 60s late. Zero means the ONLY thing
            // that can re-arm the cache is the registration itself.
            refreshIntervalMs: 0,
            logger: { error: () => {}, warn: () => {} },
        });
        await enqueuer.start();

        // ── The window, as the filer measured it ──────────────────────────
        // Asserted on the durable record, not on a cache internal: a mutation
        // here reaches neither the receiver nor `sys_http_delivery`. This is
        // the state BOTH revisions are in at this point — it is the next half
        // that separates them.
        await realtime.publish(recordEvent('contact', { id: 'c_window', name: 'Ada' }));
        await settle();
        expect(await outbox.list()).toHaveLength(0);

        // ── The composition root wires crypto, exactly as `serve` does ─────
        engine.setCryptoProvider(makeFakeCrypto());
        await settle();

        // ── A mutation in what used to be the hole ────────────────────────
        await realtime.publish(recordEvent('contact', { id: 'c_rearmed', name: 'Grace' }));
        await settle();
        const { impl, calls } = makeFetch();
        await new HttpDispatcher({ nodeId: 'n1', outbox, fetchImpl: impl, partitionCount: 1 }).tick();
        await enqueuer.stop();

        // The durable record exists…
        const rows = await outbox.list();
        expect(rows).toHaveLength(1);
        expect(rows[0].refId).toBe(Array.from((await engine.find('sys_webhook', {})).map((r: any) => r.id))[0]);
        // …the receiver was actually hit, and #7799's whole point still holds:
        // the delivery is SIGNED, with the key recovered from ciphertext alone.
        expect(calls).toHaveLength(1);
        const expected = createHmac('sha256', SECRET).update(calls[0].body).digest('hex');
        expect(calls[0].headers['X-Objectstack-Signature']).toBe(`sha256=${expected}`);
        expect(JSON.parse(calls[0].body)).toMatchObject({ object: 'contact', recordId: 'c_rearmed' });
        // …and #7722's: the row carries the signature, never the key.
        expect(rows[0].signature).toBe(`sha256=${expected}`);
        expect(JSON.stringify(rows)).not.toContain(SECRET);
    });

    // NOT pinned here, deliberately: that the re-arm does not COALESCE onto the
    // in-flight pre-registration build (see `rearmAfterCryptoRegistered`). Every
    // harness that can inject the registration at that instant also moves the
    // secret resolution to after it, so the naive `() => this.refresh()` passes
    // too — a test that cannot separate the two revisions is a false green, and
    // this repo has paid for those. The guard stays because the reasoning is
    // sound, not because a test proves it.

    it('still refuses to deliver unsigned while the key stays unresolvable, and says so once, loudly', async () => {
        const { engine } = await bootWithoutCrypto();
        const realtime = new FakeRealtime();
        const outbox = new MemoryHttpOutbox();
        const errors: Array<{ msg: string; meta: any }> = [];
        const debugs: string[] = [];
        const enqueuer = new AutoEnqueuer(engine, realtime, (i) => outbox.enqueue(i), {
            refreshIntervalMs: 0,
            logger: {
                error: (msg: string, _err?: unknown, meta?: unknown) => { errors.push({ msg, meta: meta as any }); },
                debug: (msg: string) => { debugs.push(msg); },
                warn: () => {},
            },
        });
        await enqueuer.start();
        // No provider ever arrives. Rebuild anyway — the periodic refresh would.
        await enqueuer.refresh();
        await realtime.publish(recordEvent('contact', { id: 'c1', name: 'Ada' }));
        await settle();
        const { impl, calls } = makeFetch();
        await new HttpDispatcher({ nodeId: 'n1', outbox, fetchImpl: impl, partitionCount: 1 }).tick();
        await enqueuer.stop();

        // The #7799 boundary: nothing is delivered, and nothing is delivered
        // UNSIGNED, which is the outcome this whole card must not buy.
        expect(calls).toHaveLength(0);
        expect(await outbox.list()).toHaveLength(0);

        // ADR-0112 — a consumer branches on the pair, not on message text.
        expect(errors).toHaveLength(1);
        expect(errors[0].meta).toMatchObject({ code: 'INTERNAL_ERROR', status: 500 });
        // An `error` owes the consequence and the fix (AGENTS.md), and owes
        // them ONCE: the second refresh repeats at debug, not at error, or an
        // unfixed deployment prints this every 60s until nobody reads `error`.
        expect(errors[0].msg).toMatch(/NO delivery and NO sys_http_delivery row/);
        expect(errors[0].msg).toMatch(/setCryptoProvider/);
        expect(debugs.join('\n')).toMatch(/still dropped for an unresolvable signing secret/);
    });
});

// ---------------------------------------------------------------------------
// #7986 — the SIBLING passenger on the same blob.
//
// #7799 moved the signing secret out of `definition_json`. It did not move the
// custom `headers` map, and `headers` is the ordinary place an
// `Authorization: Bearer …` goes. Same column, same absent `enable` block, same
// unbounded retention — the only thing that differed was which key of the blob
// the card happened to name.
//
// The pins below are deliberately written against a CREDENTIAL-shaped header
// alongside an ordinary one, because the shape decision this issue forced is
// exactly "the platform cannot tell which is which" (see the PR body): both
// move, and the pin has to show the ordinary one still arrives on the wire.
// ---------------------------------------------------------------------------

/** A credential a real deployment would put in `headers`. Never persisted. */
const BEARER = 'Bearer prod_tok_7986_do_not_leak';


/** Declared webhook whose header map carries one credential and one ordinary key. */
function headerBearingWebhook(overrides: Record<string, unknown> = {}) {
    return declaredWebhook({
        headers: { Authorization: BEARER, 'X-Team': 'crm' },
        ...overrides,
    });
}

describe('webhook custom headers at rest (#7986)', () => {
    it('the credential header appears nowhere in the persisted sys_webhook row', async () => {
        const { engine, stores } = await buildEngine();

        await bootstrapDeclaredWebhooks(engine, metadataWith([headerBearingWebhook()]));

        // ── The read path an ordinary GET /api/v1/data/sys_webhook takes ──
        // `sys_webhook` declares no `enable` block at all, so this is the FULL
        // default data API — the same condition #7799 called out for the key.
        // Substring, not a field check: the defect is the credential NESTED in
        // a serialized blob, which any per-field assertion walks straight past.
        const viaApi = await engine.find('sys_webhook', { where: { name: 'crm_hook' } });
        expect(viaApi).toHaveLength(1);
        expect(JSON.stringify(viaApi)).not.toContain(BEARER);
        expect(String(viaApi[0].definition_json)).not.toContain(BEARER);

        // ── And at rest, in the bytes the table itself holds ──
        const stored = Array.from(stores.get('sys_webhook')!.values())[0] as any;
        expect(JSON.stringify(stored)).not.toContain(BEARER);
        expect(String(stored.definition_json)).not.toContain(BEARER);
        // The whole map moves, so the ordinary header leaves the blob too — the
        // platform cannot tell which entry is the credential, and guessing is
        // fail-OPEN on exactly the custom names (`X-Acme-Token`) most likely to
        // be one. It is still DELIVERED; the pin below is what proves that.
        expect(String(stored.definition_json)).not.toContain('X-Team');
        expect(String(stored[WEBHOOK_HEADERS_FIELD])).toMatch(/^secret:/);

        // The rest of the envelope survives — this is a strip, not a truncation.
        expect(JSON.parse(String(stored.definition_json))).toMatchObject({
            name: 'crm_hook',
            url: 'https://receiver.example/hook',
            timeoutMs: 30000,
        });
    });

    it('still delivers every authored header on the wire, credential included', async () => {
        const { engine } = await buildEngine();
        await bootstrapDeclaredWebhooks(engine, metadataWith([headerBearingWebhook()]));

        const { calls, outbox } = await deliverOnce(engine);

        // The point of the whole feature: the receiver still gets what the
        // author declared. A fix that merely DELETED the headers from the blob
        // would pass the at-rest pin above and break every authenticated
        // webhook in production — this is the pin that separates the two.
        expect(calls).toHaveLength(1);
        expect(calls[0].headers.Authorization).toBe(BEARER);
        expect(calls[0].headers['X-Team']).toBe('crm');
        // …and the signing half is untouched (#7799 / #7722).
        const expected = createHmac('sha256', SECRET).update(calls[0].body).digest('hex');
        expect(calls[0].headers['X-Objectstack-Signature']).toBe(`sha256=${expected}`);
        expect(JSON.stringify(await outbox.list())).not.toContain(SECRET);
    });

    it('re-seeding an unchanged webhook mints no extra cipher rows for the headers', async () => {
        const { engine, stores } = await buildEngine();
        const declared = metadataWith([headerBearingWebhook()]);

        await bootstrapDeclaredWebhooks(engine, declared);
        await bootstrapDeclaredWebhooks(engine, declared);
        await bootstrapDeclaredWebhooks(engine, declared);

        // A `secret`-typed write ALWAYS mints a fresh `sys_secret` row and the
        // engine never deletes the old one, so a blind restatement leaks one
        // orphan cipher row per webhook per restart — the reason
        // `secretPatch` compares before writing. The headers channel owes the
        // same discipline. Exactly two: one signing secret, one header map.
        expect(stores.get('sys_secret')!.size).toBe(2);
    });

    it('rotating the declared headers in code re-encrypts and delivers the new value', async () => {
        const { engine, stores } = await buildEngine();
        await bootstrapDeclaredWebhooks(engine, metadataWith([headerBearingWebhook()]));
        await bootstrapDeclaredWebhooks(
            engine,
            metadataWith([headerBearingWebhook({ headers: { Authorization: 'Bearer rotated_7986' } })]),
        );

        const { calls } = await deliverOnce(engine);
        expect(calls[0].headers.Authorization).toBe('Bearer rotated_7986');
        expect(calls[0].headers['X-Team']).toBeUndefined();
        // Code remains the authority for package rows: the superseded map is
        // not readable from the row any more either.
        const stored = Array.from(stores.get('sys_webhook')!.values())[0] as any;
        expect(JSON.stringify(stored)).not.toContain(BEARER);
    });

    it('a webhook authored without headers still materializes and delivers', async () => {
        const { engine, stores } = await buildEngine();
        await bootstrapDeclaredWebhooks(engine, metadataWith([declaredWebhook({ headers: undefined })]));

        const { calls } = await deliverOnce(engine);
        expect(calls).toHaveLength(1);
        // No headers authored ⇒ no header cipher row: only the signing secret's.
        expect(stores.get('sys_secret')!.size).toBe(1);
        const stored = Array.from(stores.get('sys_webhook')!.values())[0] as any;
        expect(stored[WEBHOOK_HEADERS_FIELD] ?? null).toBeNull();
    });
});

describe('legacy cleartext headers migration (#7986)', () => {
    /** A pre-#7986 row: headers still in the blob, key already swept by #7799. */
    async function seedLegacyHeaderRow(engine: any) {
        await engine.insert('sys_webhook', {
            id: 'whk_legacy_hdr',
            name: 'legacy_hdr_hook',
            label: 'Legacy headers',
            object_name: 'contact',
            triggers: ['create'],
            url: 'https://receiver.example/hook',
            method: 'post',
            active: true,
            definition_json: JSON.stringify({
                name: 'legacy_hdr_hook', url: 'https://receiver.example/hook',
                headers: { Authorization: BEARER, 'X-Team': 'crm' }, timeoutMs: 30000,
            }),
            managed_by: 'admin',
            customized: true,
            created_at: '2026-01-01T00:00:00.000Z',
        }, { context: SYSTEM_CTX } as any);
    }

    it('sweeps an admin-authored row the seeder never touches, and keeps it delivering', async () => {
        const { engine, stores } = await buildEngine();
        await seedLegacyHeaderRow(engine);

        // Precondition: this is genuinely the exposed shape.
        expect(JSON.stringify(await engine.find('sys_webhook', {}))).toContain(BEARER);

        const result = await migrateLegacyWebhookSecrets(engine);
        expect(result).toMatchObject({ found: 1, migrated: 1, failed: 0 });

        // Gone from the API read AND from the bytes at rest.
        expect(JSON.stringify(await engine.find('sys_webhook', {}))).not.toContain(BEARER);
        expect(JSON.stringify(Array.from(stores.get('sys_webhook')!.values()))).not.toContain(BEARER);

        // …and the same headers still reach the receiver.
        const { calls } = await deliverOnce(engine);
        expect(calls[0].headers.Authorization).toBe(BEARER);
        expect(calls[0].headers['X-Team']).toBe('crm');

        // The sweep does not re-freeze provenance, and is free on the next boot.
        const row = Array.from(stores.get('sys_webhook')!.values())[0] as any;
        expect(row.managed_by).toBe('admin');
        expect(await migrateLegacyWebhookSecrets(engine)).toMatchObject({ found: 0, migrated: 0, failed: 0 });
        // Idempotent in the strong sense: the re-run minted no second cipher row.
        expect(stores.get('sys_secret')!.size).toBe(1);
    });

    it('an un-swept row keeps delivering — the enqueuer reads the legacy blob and says so', async () => {
        const { engine } = await buildEngine();
        await seedLegacyHeaderRow(engine);

        const warnings: string[] = [];
        const realtime = new FakeRealtime();
        const outbox = new MemoryHttpOutbox();
        const enqueuer = new AutoEnqueuer(engine, realtime, (i) => outbox.enqueue(i), {
            logger: { warn: (m: string) => { warnings.push(m); } },
        });
        await enqueuer.start();
        await realtime.publish(recordEvent('contact', { id: 'c1', name: 'Ada' }));
        await new Promise((r) => setTimeout(r, 0));
        const { impl, calls } = makeFetch();
        await new HttpDispatcher({ nodeId: 'n1', outbox, fetchImpl: impl, partitionCount: 1 }).tick();
        await enqueuer.stop();

        expect(calls[0].headers.Authorization).toBe(BEARER);
        expect(warnings.join('\n')).toMatch(/CLEARTEXT in definition_json/);
    });
});

describe('fail-closed and re-arm, extended to headers (#7986 × #7799/#8022)', () => {
    async function bootWithoutCrypto() {
        const first = await buildEngine();
        await bootstrapDeclaredWebhooks(first.engine, metadataWith([headerBearingWebhook()]));
        // Precondition: BOTH credentials are at rest as ciphertext only.
        expect(first.stores.get('sys_secret')!.size).toBe(2);
        return buildEngine({
            withCrypto: false,
            reuse: { driver: first.driver, stores: first.stores },
        });
    }

    const settle = async () => {
        await new Promise((r) => setTimeout(r, 0));
        await new Promise((r) => setTimeout(r, 0));
    };

    it('drops the subscription rather than delivering it with its headers missing', async () => {
        const { engine } = await bootWithoutCrypto();
        const realtime = new FakeRealtime();
        const outbox = new MemoryHttpOutbox();
        const errors: Array<{ msg: string; meta: any }> = [];
        const enqueuer = new AutoEnqueuer(engine, realtime, (i) => outbox.enqueue(i), {
            refreshIntervalMs: 0,
            logger: {
                error: (msg: string, _e?: unknown, meta?: unknown) => { errors.push({ msg, meta: meta as any }); },
                debug: () => {}, warn: () => {},
            },
        });
        await enqueuer.start();
        await realtime.publish(recordEvent('contact', { id: 'c1', name: 'Ada' }));
        await settle();
        const { impl, calls } = makeFetch();
        await new HttpDispatcher({ nodeId: 'n1', outbox, fetchImpl: impl, partitionCount: 1 }).tick();
        await enqueuer.stop();

        // Same boundary #7799 drew for the signature, for the same reason: a
        // delivery that ARRIVES having silently dropped the `Authorization` the
        // author declared is an invisible deviation from the authored config —
        // and against an endpoint that does not require auth it even succeeds.
        // A subscription that stops is visible and gets investigated.
        expect(calls).toHaveLength(0);
        expect(await outbox.list()).toHaveLength(0);
        // ADR-0112 — one report, carrying the pair a consumer branches on.
        expect(errors).toHaveLength(1);
        expect(errors[0].meta).toMatchObject({ code: 'INTERNAL_ERROR', status: 500 });
    });

    it('re-arms with its headers when the CryptoProvider registers (#8022 timing, unchanged)', async () => {
        const { engine } = await bootWithoutCrypto();
        const realtime = new FakeRealtime();
        const outbox = new MemoryHttpOutbox();
        const enqueuer = new AutoEnqueuer(engine, realtime, (i) => outbox.enqueue(i), {
            // The 60s escape hatch held shut: only the registration can re-arm.
            refreshIntervalMs: 0,
            logger: { error: () => {}, warn: () => {}, debug: () => {} },
        });
        await enqueuer.start();
        await realtime.publish(recordEvent('contact', { id: 'c_window', name: 'Ada' }));
        await settle();
        expect(await outbox.list()).toHaveLength(0);

        engine.setCryptoProvider(makeFakeCrypto());
        await settle();

        await realtime.publish(recordEvent('contact', { id: 'c_rearmed', name: 'Grace' }));
        await settle();
        const { impl, calls } = makeFetch();
        await new HttpDispatcher({ nodeId: 'n1', outbox, fetchImpl: impl, partitionCount: 1 }).tick();
        await enqueuer.stop();

        // Headers must be recovered on the SAME re-armed build as the secret —
        // an implementation that resolved them on a different schedule would
        // re-arm into a delivery with no `Authorization` on it.
        expect(calls).toHaveLength(1);
        expect(calls[0].headers.Authorization).toBe(BEARER);
        const expected = createHmac('sha256', SECRET).update(calls[0].body).digest('hex');
        expect(calls[0].headers['X-Objectstack-Signature']).toBe(`sha256=${expected}`);
    });
});
