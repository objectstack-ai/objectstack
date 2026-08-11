// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #7722 — the signing secret must not be recoverable from `sys_http_delivery`,
 * and signing must still be correct.
 *
 * The defect: `SqlHttpOutbox.enqueue` copied the caller's `signingSecret`
 * verbatim onto every attempt row (`signing_secret`), a table `GET
 * /api/v1/data/sys_http_delivery` reads. Anyone who could read deliveries
 * recovered the shared key that authenticates ObjectStack to the receiver — the
 * receiver's ONLY proof of origin — for every subscriber at once. The blast
 * radius is outside the deployment: rotating a leaked key means re-coordinating
 * with every receiver operator.
 *
 * These tests run the REAL storage path — `ObjectQL` + `@objectstack/driver-sql`
 * on better-sqlite3 `:memory:`, the production `SqlHttpOutbox`, the production
 * `HttpDispatcher` — because both halves of the claim live in that hand-off: the
 * bytes a driver actually wrote into a real table, and the header a real
 * dispatcher put on the wire after reloading that row.
 *
 * Two assertions, deliberately not one:
 *
 *  1. **The bytes are absent.** A `SELECT *` byte-scan over every column of
 *     every delivery row — not a projection of the fields the schema declares,
 *     which would pass on a stale physical column the object no longer names.
 *     Same shape as the scan the sibling datasource credential path passes.
 *  2. **The signature still verifies.** The captured `X-Objectstack-Signature`
 *     is checked by recomputing `HMAC-SHA256(raw body, secret)` the way a
 *     receiver does. "It didn't throw" would pass on a delivery signed with the
 *     wrong bytes, or not signed at all.
 *
 * Assertion 2 also pins the enqueue-time signing this fix introduced: the
 * signature is computed BEFORE the row is written and the body is rebuilt AFTER
 * a full DB round-trip (`JSON.stringify` → text column → `JSON.parse` →
 * `JSON.stringify`), so a round-trip that changed one byte would break the
 * verification rather than silently ship an unverifiable delivery.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { createHmac } from 'node:crypto';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { SqlHttpOutbox } from './sql-http-outbox.js';
import { HttpDispatcher } from './http-dispatcher.js';
import { HttpDelivery, SYS_HTTP_DELIVERY } from './objects/http-delivery.object.js';
import type { FetchImpl } from './http-sender.js';

/** The secret under test — distinctive enough that a byte-scan cannot miss it. */
const SECRET = 'whsec_7722_do_not_persist_me';

/**
 * A payload with nesting, unicode and an empty-ish leaf: the `JSON.stringify` →
 * store → `JSON.parse` → `JSON.stringify` round-trip has to reproduce it byte
 * for byte or the signature computed at enqueue stops matching the body sent.
 */
const PAYLOAD = {
    object: 'crm_account',
    recordId: 'acc_1',
    action: 'created',
    timestamp: 1_760_000_000_000,
    after: { name: '客户 A', amount: 1234.5, tags: ['a', 'b'], note: '', nested: { deep: true } },
};

function makeSqliteDriver() {
    return new SqlDriver({
        client: 'better-sqlite3',
        connection: { filename: ':memory:' },
        useNullAsDefault: true,
    });
}

/** Records what actually went on the wire. */
function makeFetch(): {
    impl: FetchImpl;
    calls: Array<{ url: string; headers: Record<string, string>; body: string }>;
} {
    const calls: Array<{ url: string; headers: Record<string, string>; body: string }> = [];
    const impl: FetchImpl = async (url, init) => {
        calls.push({ url, headers: init.headers, body: init.body });
        return { ok: true, status: 204, async text() { return ''; } };
    };
    return { impl, calls };
}

describe('sys_http_delivery — signing secret at rest (#7722)', () => {
    let engine: ObjectQL | undefined;

    afterEach(async () => {
        try { await engine?.destroy(); } catch { /* noop */ }
        engine = undefined;
    });

    async function boot() {
        const driver = makeSqliteDriver();
        engine = new ObjectQL();
        engine.registerDriver(driver, true);
        await engine.init();
        engine.registry.registerObject(HttpDelivery as any, '@objectstack/service-messaging');
        // Real DDL through the real path: the table below is created by the
        // driver from the object definition, so its physical columns are
        // exactly the ones production would have.
        await engine.syncSchemas();
        return { driver, engine: engine! };
    }

    /**
     * Every value in every column of every delivery row, as one string.
     * `SELECT *` on purpose — a scan of the declared fields would miss a
     * physical column the schema stopped naming.
     */
    async function scanDeliveryTable(driver: SqlDriver): Promise<string> {
        const rows: Array<Record<string, unknown>> = await driver.getKnex()(SYS_HTTP_DELIVERY).select('*');
        expect(rows.length).toBeGreaterThan(0); // a scan of nothing proves nothing
        return rows.map((r) => Object.values(r).map((v) => String(v ?? '')).join(' ')).join(' ');
    }

    it('a real webhook delivery signs correctly and leaves no secret in the table', async () => {
        const { driver, engine: eng } = await boot();
        const outbox = new SqlHttpOutbox(eng as any, { partitionCount: 1 });

        await outbox.enqueue({
            source: 'webhook',
            refId: 'wh_1',
            dedupKey: 'crm_account:acc_1:created:1760000000000',
            label: 'data.record.created',
            url: 'https://receiver.example/hook',
            headers: { 'X-Custom': 'keep-me' },
            signingSecret: SECRET,
            payload: PAYLOAD,
        });

        const { impl, calls } = makeFetch();
        const dispatcher = new HttpDispatcher({ nodeId: 'n1', outbox, fetchImpl: impl, partitionCount: 1 });
        await dispatcher.tick();

        // ── The delivery happened, and it verifies as a receiver verifies ──
        expect(calls).toHaveLength(1);
        const sent = calls[0];
        const expected = createHmac('sha256', SECRET).update(sent.body).digest('hex');
        expect(sent.headers['X-Objectstack-Signature']).toBe(`sha256=${expected}`);
        // …over the real payload, not an empty body the HMAC would still "match".
        expect(JSON.parse(sent.body)).toEqual(PAYLOAD);
        expect(sent.headers['X-Custom']).toBe('keep-me');

        // ── …and the key that produced it is nowhere in the table ──
        const dump = await scanDeliveryTable(driver);
        expect(dump).not.toContain(SECRET);
        // Guard the guard: the scan does see the row's other content, so a
        // silently-empty dump can never be what made the assertion above pass.
        expect(dump).toContain('https://receiver.example/hook');
        expect(dump).toContain(sent.headers['X-Objectstack-Signature']);

        // The data API's own read is likewise secret-free (and, being a
        // projection of the declared fields, no longer even names a secret).
        const apiRows = await eng.find(SYS_HTTP_DELIVERY, {});
        expect(JSON.stringify(apiRows)).not.toContain(SECRET);
    });

    it('holds for the flow producer too — the fix is at the outbox, not in one caller', async () => {
        const { driver, engine: eng } = await boot();
        const outbox = new SqlHttpOutbox(eng as any, { partitionCount: 1 });

        await outbox.enqueue({
            source: 'flow',
            refId: 'node_http_1',
            dedupKey: 'run_1:node_http_1',
            label: 'flow:node_http_1',
            url: 'https://receiver.example/flow',
            signingSecret: SECRET,
            payload: { hello: 'world' },
        });

        const { impl, calls } = makeFetch();
        await new HttpDispatcher({ nodeId: 'n1', outbox, fetchImpl: impl, partitionCount: 1 }).tick();

        const expected = createHmac('sha256', SECRET).update(calls[0].body).digest('hex');
        expect(calls[0].headers['X-Objectstack-Signature']).toBe(`sha256=${expected}`);
        expect(await scanDeliveryTable(driver)).not.toContain(SECRET);
    });

    it('a redelivered row still signs — the signature survives without the secret', async () => {
        const { driver, engine: eng } = await boot();
        const outbox = new SqlHttpOutbox(eng as any, { partitionCount: 1 });

        const id = await outbox.enqueue({
            source: 'webhook',
            refId: 'wh_1',
            dedupKey: 'once',
            url: 'https://receiver.example/hook',
            signingSecret: SECRET,
            payload: PAYLOAD,
        });

        const first = makeFetch();
        await new HttpDispatcher({ nodeId: 'n1', outbox, fetchImpl: first.impl, partitionCount: 1 }).tick();
        expect((await outbox.list())[0].status).toBe('success');

        // Redeliver: a terminal row reset to pending and sent again, which is
        // where a resolve-at-send-time design would need the secret back.
        await outbox.redeliver(id);
        const second = makeFetch();
        await new HttpDispatcher({ nodeId: 'n2', outbox, fetchImpl: second.impl, partitionCount: 1 }).tick();

        expect(second.calls).toHaveLength(1);
        // Byte-for-byte replay: same body, same signature, still verifiable.
        expect(second.calls[0].body).toBe(first.calls[0].body);
        expect(second.calls[0].headers['X-Objectstack-Signature']).toBe(
            first.calls[0].headers['X-Objectstack-Signature'],
        );
        const expected = createHmac('sha256', SECRET).update(second.calls[0].body).digest('hex');
        expect(second.calls[0].headers['X-Objectstack-Signature']).toBe(`sha256=${expected}`);

        expect(await scanDeliveryTable(driver)).not.toContain(SECRET);
    });

    it('an unsigned delivery sends no signature header at all', async () => {
        const { engine: eng } = await boot();
        const outbox = new SqlHttpOutbox(eng as any, { partitionCount: 1 });
        await outbox.enqueue({
            source: 'flow',
            refId: 'n1',
            dedupKey: 'unsigned',
            url: 'https://receiver.example/plain',
            payload: { a: 1 },
        });

        const { impl, calls } = makeFetch();
        await new HttpDispatcher({ nodeId: 'n1', outbox, fetchImpl: impl, partitionCount: 1 }).tick();

        expect(calls[0].headers['X-Objectstack-Signature']).toBeUndefined();
    });
});
