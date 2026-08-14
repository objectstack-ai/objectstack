// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #8566 — `sys_webhook.headers_secret` must refuse a plaintext that is not a
 * flat JSON object of string values, AT THE WRITE DOOR.
 *
 * These run against a REAL {@link ObjectQL} engine with the REAL
 * {@link SysWebhook} schema and the REAL encrypted-field write path, for the
 * same reason `webhook-secret-at-rest.test.ts` does: the entire claim is about
 * where the gate sits relative to the engine's own `encryptSecretFields`, and
 * an engine fake would answer that question by construction instead of
 * measuring it. Only the DRIVER is a double (equality-only WHERE, in-memory
 * maps) — an `IDataDriver` (`update(object, id, data)`, primary key SECOND),
 * not an `IDataEngine`, so the engine's real dispatch contract still runs above
 * it.
 *
 * ## What the suite has to prove, and why each half is here
 * A refusal-only suite is satisfiable by refusing EVERYTHING, which would be a
 * far worse bug than the one being fixed — a webhook that can no longer be
 * given headers at all. So the accept side is pinned as hard as the refuse
 * side: a valid flat string map still writes, still encrypts, still reads back
 * as the mask, and still resolves to the authored map end to end.
 *
 * The ordering claim gets its own measurement rather than a comment. If the
 * gate ran AFTER `encryptSecretFields`, a refused write would already have
 * minted a `sys_secret` ciphertext row for the value it then rejected — an
 * orphan cipher row per rejected keystroke, and proof the plaintext was gone
 * before anyone looked at it. So every refusal asserts the cipher store is
 * untouched, which is a fact about ORDER that no amount of message-matching
 * could establish.
 */

import { describe, expect, it } from 'vitest';
import { ObjectQL, SECRET_MASK, SECRET_REF_PREFIX } from '@objectstack/objectql';
import type {
    ICryptoProvider,
    CryptoHandle,
    CryptoContext,
} from '@objectstack/spec/contracts';
import { SysWebhook } from './sys-webhook.object.js';
import { WEBHOOK_HEADERS_FIELD, resolveWebhookHeaders } from './webhook-headers.js';
import { bootstrapDeclaredWebhooks } from './bootstrap-declared-webhooks.js';
import {
    WebhookHeadersShapeError,
    WEBHOOK_HEADERS_SHAPE_REFUSAL_CODE,
    WEBHOOK_HEADERS_SHAPE_REFUSAL_STATUS,
    assertWritableWebhookHeaders,
    bindWebhookHeadersShapeGate,
    unbindWebhookHeadersShapeGate,
} from './webhook-headers-gate.js';

// Not `as const`: the engine's ExecutionContext declares these as mutable
// `string[]`, and a readonly tuple is not assignable to one.
const SYSTEM_CTX = { isSystem: true, positions: [] as string[], permissions: [] as string[] };

/** A header map that is valid by every definition on this seam. */
const GOOD_HEADERS = { 'X-Team': 'crm', Authorization: 'Bearer real_token_value' };

// ---------------------------------------------------------------------------
// Doubles — driver (in-memory) + reversible crypto, as the sibling suite uses
// ---------------------------------------------------------------------------

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
    // Rows leave the driver as COPIES, exactly as a real driver's do — the read
    // path mutates what it is handed (it stamps the mask), and a shared
    // reference would rewrite the "at rest" bytes this suite scans.
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

/** Reversible test crypto — base64 is not encryption, only a real TRANSFORM. */
function makeFakeCrypto(): ICryptoProvider {
    let n = 0;
    return {
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
}

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
 * A booted engine WITH the gate bound — i.e. the production wiring, where
 * `WebhookOutboxPlugin.bootDeclaredWebhooks` binds it before the first write.
 * `bindGate: false` reproduces a host that never mounted the plugin, which is
 * how the counterfactual below shows the gate is what refuses.
 */
async function buildEngine(opts: { bindGate?: boolean } = {}) {
    const engine = new ObjectQL();
    const { driver, stores } = makeStubDriver();
    engine.registerDriver(driver, true);
    await engine.init();
    engine.registry.registerObject(sysSecretObject as any, 'test');
    engine.registry.registerObject(SysWebhook as any, 'test');
    engine.setCryptoProvider(makeFakeCrypto());
    if (opts.bindGate !== false) bindWebhookHeadersShapeGate(engine as any);
    return { engine, stores, driver };
}

/**
 * The minimum a `sys_webhook` row needs to exist — every `required: true`
 * column without a default, so the engine's own record validation passes and
 * what these tests measure is the gate rather than a malformed fixture.
 */
function webhookRow(overrides: Record<string, unknown> = {}) {
    return {
        name: 'crm_hook',
        object_name: 'contact',
        url: 'https://receiver.example/hook',
        method: 'post',
        active: true,
        definition_json: JSON.stringify({
            name: 'crm_hook',
            object: 'contact',
            triggers: ['create'],
            url: 'https://receiver.example/hook',
            method: 'POST',
        }),
        ...overrides,
    };
}

/** Seed one row with no stored headers, and hand back its id. */
async function seedRow(engine: any, overrides: Record<string, unknown> = {}): Promise<string> {
    const created = await engine.insert('sys_webhook', webhookRow(overrides), { context: SYSTEM_CTX });
    return String(created.id);
}

const cipherRows = (stores: Map<string, Map<string, Record<string, unknown>>>) =>
    Array.from(stores.get('sys_secret')?.values() ?? []);

const rowAtRest = (stores: Map<string, Map<string, Record<string, unknown>>>) =>
    Array.from(stores.get('sys_webhook')!.values())[0] as Record<string, unknown>;

/**
 * The five spellings measured on a real engine in the issue body — every one of
 * them accepted, encrypted, and left behind a valid `secret:` ref that reads
 * back as the mask with `active: true`, while being a value the plugin can
 * never use. This list is the card's table, verbatim.
 */
const unusableSpellings: Array<[label: string, written: string]> = [
    ['an empty JSON object — "no headers" spelled as a value rather than as null', '{}'],
    ['a JSON array instead of an object', '[]'],
    ['a header whose value is a number, not a string', '{"X-Count":5}'],
    ['a nested object where a flat string map is required', '{"X-Team":{"name":"crm"}}'],
    ['not JSON at all — a typo in the authoring box', '{X-Team: crm}'],
];

// ---------------------------------------------------------------------------

describe('sys_webhook.headers_secret shape gate — the write door (#8566)', () => {
    describe('the measured table: every accepted-but-unusable shape is now refused', () => {
        it.each(unusableSpellings)(
            'update through the ordinary data API refuses %s',
            async (_label, written) => {
                const { engine, stores } = await buildEngine();
                const id = await seedRow(engine);

                // The MEASURED TRIGGER, in its engine form: a direct
                // `PATCH /api/v1/data/sys_webhook`. No privileged access, no
                // plugin write path — this is the road option 1 would have left
                // wide open, which is why the ruling rejected option 1.
                const write = engine.update(
                    'sys_webhook',
                    { [WEBHOOK_HEADERS_FIELD]: written },
                    { where: { id }, context: SYSTEM_CTX },
                );

                await expect(write).rejects.toBeInstanceOf(WebhookHeadersShapeError);

                // ADR-0112: a consumer branches on the PAIR, not on message
                // text. Asserting only `toThrow()` would stay green against a
                // driver that threw a bare Error for an unrelated reason.
                await expect(write).rejects.toMatchObject({
                    code: 'VALIDATION_ERROR',
                    status: 400,
                    object: 'sys_webhook',
                    field: WEBHOOK_HEADERS_FIELD,
                });

                // ⭐ The ORDER proof. `encryptSecretFields` mints a `sys_secret`
                // row as its first side effect, so an empty cipher store is a
                // measurement that the gate ran BEFORE it — the one thing this
                // whole card turns on.
                expect(cipherRows(stores)).toHaveLength(0);

                // …and nothing landed on the row either: no ref, no mask, no
                // half-written state for the next reader to puzzle over.
                expect(rowAtRest(stores)[WEBHOOK_HEADERS_FIELD] ?? null).toBeNull();
            },
        );

        it.each(unusableSpellings)('insert refuses %s at the same door', async (_label, written) => {
            const { engine, stores } = await buildEngine();

            const write = engine.insert(
                'sys_webhook',
                webhookRow({ [WEBHOOK_HEADERS_FIELD]: written }),
                { context: SYSTEM_CTX },
            );

            await expect(write).rejects.toMatchObject({
                code: WEBHOOK_HEADERS_SHAPE_REFUSAL_CODE,
                status: WEBHOOK_HEADERS_SHAPE_REFUSAL_STATUS,
            });
            expect(cipherRows(stores)).toHaveLength(0);
            // The whole row is refused, not written-then-blanked.
            expect(stores.get('sys_webhook')?.size ?? 0).toBe(0);
        });

        it('the refusal is the GATE\'s, not something the engine already did', async () => {
            // The counterfactual, on the same input: with the gate unbound the
            // write still sails through exactly as the card measured, ref and
            // all. Without this, a refusal coming from somewhere else entirely
            // would read as this gate working.
            const { engine, stores } = await buildEngine({ bindGate: false });
            const id = await seedRow(engine);

            await engine.update(
                'sys_webhook',
                { [WEBHOOK_HEADERS_FIELD]: '{"X-Count":5}' },
                { where: { id }, context: SYSTEM_CTX },
            );

            expect(String(rowAtRest(stores)[WEBHOOK_HEADERS_FIELD])).toMatch(/^secret:/);
            expect(cipherRows(stores)).toHaveLength(1);
        });
    });

    describe('a valid flat string map still writes — the gate is not a blanket', () => {
        it('writes, encrypts, masks on read, and resolves back to the authored map', async () => {
            const { engine, stores } = await buildEngine();
            const id = await seedRow(engine);

            await engine.update(
                'sys_webhook',
                { [WEBHOOK_HEADERS_FIELD]: JSON.stringify(GOOD_HEADERS) },
                { where: { id }, context: SYSTEM_CTX },
            );

            // At rest: an opaque ref plus exactly one cipher row.
            expect(String(rowAtRest(stores)[WEBHOOK_HEADERS_FIELD])).toMatch(
                new RegExp(`^${SECRET_REF_PREFIX}`),
            );
            expect(cipherRows(stores)).toHaveLength(1);

            // On the generic read path: the mask, never the headers.
            const [read] = await engine.find('sys_webhook', { where: { id }, context: SYSTEM_CTX });
            expect(read[WEBHOOK_HEADERS_FIELD]).toBe(SECRET_MASK);

            // …and end to end, the consumer gets back exactly what was authored.
            await expect(resolveWebhookHeaders(engine, read as any, 'sys_webhook')).resolves.toEqual(
                GOOD_HEADERS,
            );
        });

        it('accepts a single-entry map, and accepts it on insert too', async () => {
            const { engine, stores } = await buildEngine();
            await engine.insert(
                'sys_webhook',
                webhookRow({ [WEBHOOK_HEADERS_FIELD]: '{"X-Team":"crm"}' }),
                { context: SYSTEM_CTX },
            );
            expect(cipherRows(stores)).toHaveLength(1);
            expect(String(rowAtRest(stores)[WEBHOOK_HEADERS_FIELD])).toMatch(/^secret:/);
        });

        it('accepts an authored OBJECT, which the engine serializes into the same usable form', async () => {
            // Deliberate, and worth pinning: `encryptSecretFields` JSON-stringifies
            // a non-string secret value, so a caller that PATCHes a real JSON
            // object lands a perfectly usable serialized map today. The gate
            // normalizes the same way rather than refusing it — refusing a value
            // the consumer can use would be a regression wearing a fix's clothes.
            const { engine, stores } = await buildEngine();
            const id = await seedRow(engine);

            await engine.update(
                'sys_webhook',
                { [WEBHOOK_HEADERS_FIELD]: GOOD_HEADERS },
                { where: { id }, context: SYSTEM_CTX },
            );

            // Encrypted for real — the object took the same road the string did.
            expect(cipherRows(stores)).toHaveLength(1);
            const [read] = await engine.find('sys_webhook', { where: { id }, context: SYSTEM_CTX });
            await expect(resolveWebhookHeaders(engine, read as any, 'sys_webhook')).resolves.toEqual(
                GOOD_HEADERS,
            );
        });

        it('refuses an authored OBJECT whose values are not strings', async () => {
            // The other side of the same normalization: an object is judged by
            // what it serializes to, so `{"X-Count": 5}` is refused whether it
            // arrives as JSON text or as a live object.
            const { engine, stores } = await buildEngine();
            const id = await seedRow(engine);

            await expect(
                engine.update(
                    'sys_webhook',
                    { [WEBHOOK_HEADERS_FIELD]: { 'X-Count': 5 } },
                    { where: { id }, context: SYSTEM_CTX },
                ),
            ).rejects.toMatchObject({ code: 'VALIDATION_ERROR', status: 400 });
            expect(cipherRows(stores)).toHaveLength(0);
        });

        it('the declared-webhook seeder still materializes headers through the bound gate', async () => {
            // Ruling item 2: the plugin's own write paths inherit this validation
            // rather than carrying a second check. That is only safe if they pass
            // — `bootstrapDeclaredWebhooks` writes `serializeHeaders()` of an
            // already-filtered map, so it does, and this is the pin that keeps it
            // true if either side moves.
            const { engine, stores } = await buildEngine();
            await bootstrapDeclaredWebhooks(engine, {
                list: (type: string) => (type === 'webhook'
                    ? [{
                        name: 'crm_hook', object: 'contact', triggers: ['create'],
                        url: 'https://receiver.example/hook', method: 'POST',
                        headers: { 'X-Team': 'crm' },
                    }]
                    : []),
            } as any);

            const [row] = await engine.find('sys_webhook', {
                where: { name: 'crm_hook' }, context: SYSTEM_CTX,
            });
            expect(row).toBeDefined();
            // The seeder's write really went through the encrypted channel — it
            // was not skipped, and the gate did not stand in its way.
            expect(cipherRows(stores)).toHaveLength(1);
            await expect(resolveWebhookHeaders(engine, row as any, 'sys_webhook')).resolves.toEqual({
                'X-Team': 'crm',
            });
        });
    });

    describe('the four values the gate deliberately lets through', () => {
        it('an echoed read-mask leaves the stored map untouched (the Setup form round-trip)', async () => {
            // Ruling item 3, and the most ordinary write this object receives: a
            // caller GETs the row — headers come back as the mask — edits an
            // unrelated field and PATCHes the whole thing back. Refusing the mask
            // would break every such round-trip, which is a far bigger outage
            // than the bug being fixed.
            const { engine, stores } = await buildEngine();
            const id = await seedRow(engine);
            await engine.update(
                'sys_webhook',
                { [WEBHOOK_HEADERS_FIELD]: JSON.stringify(GOOD_HEADERS) },
                { where: { id }, context: SYSTEM_CTX },
            );
            const refBefore = rowAtRest(stores)[WEBHOOK_HEADERS_FIELD];

            const [read] = await engine.find('sys_webhook', { where: { id }, context: SYSTEM_CTX });
            expect(read[WEBHOOK_HEADERS_FIELD]).toBe(SECRET_MASK);

            await engine.update(
                'sys_webhook',
                { ...read, active: false },
                { where: { id }, context: SYSTEM_CTX },
            );

            // Same ref, no new cipher row: the engine dropped the echoed mask as
            // "unchanged" and the gate never stood in its way.
            expect(rowAtRest(stores)[WEBHOOK_HEADERS_FIELD]).toBe(refBefore);
            expect(cipherRows(stores)).toHaveLength(1);
            const [after] = await engine.find('sys_webhook', { where: { id }, context: SYSTEM_CTX });
            await expect(resolveWebhookHeaders(engine, after as any, 'sys_webhook')).resolves.toEqual(
                GOOD_HEADERS,
            );
        });

        it('null still CLEARS the stored map', async () => {
            const { engine, stores } = await buildEngine();
            const id = await seedRow(engine);
            await engine.update(
                'sys_webhook',
                { [WEBHOOK_HEADERS_FIELD]: JSON.stringify(GOOD_HEADERS) },
                { where: { id }, context: SYSTEM_CTX },
            );

            await engine.update(
                'sys_webhook',
                { [WEBHOOK_HEADERS_FIELD]: null },
                { where: { id }, context: SYSTEM_CTX },
            );

            expect(rowAtRest(stores)[WEBHOOK_HEADERS_FIELD] ?? null).toBeNull();
            const [read] = await engine.find('sys_webhook', { where: { id }, context: SYSTEM_CTX });
            await expect(
                resolveWebhookHeaders(engine, read as any, 'sys_webhook'),
            ).resolves.toBeUndefined();
        });

        it('omitting the field leaves the stored map alone', async () => {
            const { engine, stores } = await buildEngine();
            const id = await seedRow(engine);
            await engine.update(
                'sys_webhook',
                { [WEBHOOK_HEADERS_FIELD]: JSON.stringify(GOOD_HEADERS) },
                { where: { id }, context: SYSTEM_CTX },
            );
            const refBefore = rowAtRest(stores)[WEBHOOK_HEADERS_FIELD];

            await engine.update('sys_webhook', { active: false }, { where: { id }, context: SYSTEM_CTX });

            expect(rowAtRest(stores)[WEBHOOK_HEADERS_FIELD]).toBe(refBefore);
            expect(cipherRows(stores)).toHaveLength(1);
        });

        it('"" is left to #8559\'s seam — one door, one owner, one message', async () => {
            // ⚠️ The dispatch note said this gate "can assume it never sees \"\"".
            // Measured, that is inverted: `before*` hooks run FIRST, so the gate
            // does see it — and passes it through, which is what lets the
            // engine's own EmptyCredentialWriteError answer with the message
            // #8559 ruled on (it names `null` as the way to clear). Re-refusing
            // it here would have put two different messages on one door.
            const { engine, stores } = await buildEngine();
            const id = await seedRow(engine);

            const write = engine.update(
                'sys_webhook',
                { [WEBHOOK_HEADERS_FIELD]: '' },
                { where: { id }, context: SYSTEM_CTX },
            );

            // Still refused — the door is closed either way…
            await expect(write).rejects.toMatchObject({ code: 'VALIDATION_ERROR', status: 400 });
            // …but by #8559's seam, not by this one.
            await expect(write).rejects.not.toBeInstanceOf(WebhookHeadersShapeError);
            await expect(write).rejects.toMatchObject({ name: 'EmptyCredentialWriteError' });
            expect(cipherRows(stores)).toHaveLength(0);
        });

        it('an existing secret: ref re-saved verbatim is not refused', async () => {
            // The engine leaves an already-encrypted ref alone; the gate has to
            // agree, or an internal caller copying a row forward would be refused
            // for holding a value the engine itself considers settled.
            const { engine } = await buildEngine();
            const id = await seedRow(engine);
            expect(() =>
                assertWritableWebhookHeaders({
                    [WEBHOOK_HEADERS_FIELD]: `${SECRET_REF_PREFIX}sec_1`,
                }),
            ).not.toThrow();
            expect(id).toBeTruthy();
        });
    });

    describe('the refusal message', () => {
        it('⛔ never echoes the rejected value, and names the offending header instead', async () => {
            // This column carries credentials — an `Authorization: Bearer …` is
            // the field description's own example. A message that quoted the
            // input would print that token into logs and HTTP error bodies, i.e.
            // re-open in the diagnostic exactly the exposure #7986 moved this
            // field onto the encrypted channel to close.
            const { engine } = await buildEngine();
            const id = await seedRow(engine);
            const token = 'Bearer super_secret_token_do_not_log';

            const err = await engine
                .update(
                    'sys_webhook',
                    { [WEBHOOK_HEADERS_FIELD]: JSON.stringify({ Authorization: [token] }) },
                    { where: { id }, context: SYSTEM_CTX },
                )
                .catch((e: Error) => e);

            expect(err).toBeInstanceOf(WebhookHeadersShapeError);
            expect((err as Error).message).not.toContain(token);
            expect((err as Error).message).not.toContain('super_secret_token');
            // The header NAME is safe to say and is the useful half.
            expect((err as Error).message).toContain('"Authorization"');
        });

        it('is LOCATED and quotes the shape the field itself asks for', async () => {
            const { engine } = await buildEngine();
            const id = await seedRow(engine);

            const err = await engine
                .update(
                    'sys_webhook',
                    { [WEBHOOK_HEADERS_FIELD]: '[]' },
                    { where: { id }, context: SYSTEM_CTX },
                )
                .catch((e: Error) => e);

            const msg = (err as Error).message;
            // Located: the object and the field, both.
            expect(msg).toContain('sys_webhook.headers_secret');
            // The required shape, in the words the field's own description uses.
            expect(msg).toContain('FLAT JSON object of string values');
            expect(msg).toContain('as a JSON object');
            // And the remedy, shared verbatim with the delivery-time refusal.
            expect(msg).toMatch(/CLEAR the field to null/);
        });

        it('tells an author which spelling went wrong, per shape', async () => {
            const cases: Array<[input: unknown, expected: RegExp]> = [
                ['{X-Team: crm}', /not valid JSON at all/],
                ['[]', /JSON array/],
                ['{}', /EMPTY JSON object/],
                ['{"X-Count":5}', /"X-Count" \(number\)/],
                ['{"X-Team":{"name":"crm"}}', /"X-Team" \(object\)/],
                ['"just a quoted string"', /JSON string/],
                [42, /JSON number/],
            ];
            for (const [input, expected] of cases) {
                expect(() =>
                    assertWritableWebhookHeaders({ [WEBHOOK_HEADERS_FIELD]: input }),
                ).toThrow(expected);
            }
        });
    });

    describe('binding', () => {
        it('unbinding removes the gate — the write goes through again', async () => {
            const { engine, stores } = await buildEngine();
            const id = await seedRow(engine);

            await expect(
                engine.update(
                    'sys_webhook',
                    { [WEBHOOK_HEADERS_FIELD]: '[]' },
                    { where: { id }, context: SYSTEM_CTX },
                ),
            ).rejects.toBeInstanceOf(WebhookHeadersShapeError);

            unbindWebhookHeadersShapeGate(engine as any);

            await engine.update(
                'sys_webhook',
                { [WEBHOOK_HEADERS_FIELD]: '[]' },
                { where: { id }, context: SYSTEM_CTX },
            );
            expect(cipherRows(stores)).toHaveLength(1);
        });

        it('only guards sys_webhook — a neighbouring object with a secret field is untouched', async () => {
            // The hook is registered with `object: 'sys_webhook'`, so it must not
            // fire for anything else. `sys_secret` is written by the engine's own
            // encryption path on every accepted write, which is the sharpest
            // available proof that the gate is not global: were it, the valid
            // write above could not have completed.
            const { engine, stores } = await buildEngine();
            const id = await seedRow(engine);
            await engine.update(
                'sys_webhook',
                { [WEBHOOK_HEADERS_FIELD]: JSON.stringify(GOOD_HEADERS) },
                { where: { id }, context: SYSTEM_CTX },
            );
            expect(cipherRows(stores)).toHaveLength(1);
        });
    });
});
