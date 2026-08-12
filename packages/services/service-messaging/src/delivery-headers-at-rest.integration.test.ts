// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #8118 — `sys_http_delivery.headers_json` must not be readable over the
 * generic data API, and every authored header must still reach the wire
 * VERBATIM.
 *
 * The defect: #8114 moved the authored `headers` map onto the encrypted
 * channel of the CONFIGURATION row (`sys_webhook.headers_secret`), but the
 * enqueuer decrypts that map and `SqlHttpOutbox.enqueue()` writes it verbatim
 * into the DELIVERY row — a table the ordinary data API reads
 * (`enable.apiMethods: ['get', 'list']`). "Webhook headers are no longer in a
 * blob" read as true after #8114 and was not: the same exposure, one layer
 * down.
 *
 * The fix under test (route 3, ruled on #8118): `headers_json` is declared
 * `internal: true`, so the ENGINE omits it from every generic read with no
 * system carve-out (#7728), and the dispatcher's claim path — the one reader
 * that must see the map — recovers it through ObjectQL's purpose-built
 * privileged accessor (`resolveInternalField`, the remedy #7728 itself names).
 *
 * These tests run the REAL storage path — `ObjectQL` + `@objectstack/driver-sql`
 * on better-sqlite3 `:memory:`, the production `SqlHttpOutbox`, the production
 * `HttpDispatcher` — the same harness as the #7722 signing-secret pins, because
 * both halves of every claim live in that hand-off: what the data API serves,
 * and what a real dispatcher put on the wire after reloading the row.
 *
 * Population coverage is deliberate and explicit:
 *
 *  - **`source: 'webhook'`** — headers authored through `WebhookSchema`,
 *    decrypted by the enqueuer, handed to `enqueueHttp`.
 *  - **`source: 'flow'`** — a flow `http` node's headers are interpolated PER
 *    RUN from run-scoped variables and never pass through `WebhookSchema` at
 *    all; this is the half every author-declared shape forgets (#8118 rejected
 *    route 2 for exactly that). The redaction sits at the ROW layer, so it
 *    catches this population by construction — and the flow case below drives
 *    it end-to-end through the production enqueue → claim → send path, with
 *    the exact input shape `http-nodes.ts` produces.
 *
 * Every redaction pin is paired with its wire pin: a fix that merely DELETED
 * the headers would pass the read-path assertions and break every
 * authenticated callout in production. The fail-closed rule is pinned on its
 * own: a delivery that cannot recover its headers must not go out without
 * them — missing headers are not self-announcing (the receiver that does not
 * require one answers 200 to an incomplete request).
 */

import { describe, it, expect, afterEach } from 'vitest';
import { createHmac } from 'node:crypto';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import type { IDataEngine } from '@objectstack/spec/contracts';
import { SqlHttpOutbox } from './sql-http-outbox.js';
import { HttpDispatcher } from './http-dispatcher.js';
import { HttpDelivery, SYS_HTTP_DELIVERY } from './objects/http-delivery.object.js';
import type { FetchImpl } from './http-sender.js';

/** A credential a real deployment would put in `headers`. Distinctive on purpose. */
const BEARER = 'Bearer prod_tok_8118_do_not_serve';
/** The flow half's credential — "interpolated per run", so a run-scoped value. */
const FLOW_BEARER = 'Bearer run_scoped_tok_8118_run_42';
/** Signing secret — proves the #7799/#7722 half is untouched by this change. */
const SECRET = 'whsec_8118_signing_untouched';

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

describe('sys_http_delivery — authored headers vs the data API (#8118)', () => {
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
        // Real DDL through the real path — physical columns exactly as prod.
        await engine.syncSchemas();
        return { driver, engine: engine! };
    }

    /** Every value in every column of every delivery row, as one string. */
    async function scanDeliveryTable(driver: SqlDriver): Promise<string> {
        const rows: Array<Record<string, unknown>> = await driver.getKnex()(SYS_HTTP_DELIVERY).select('*');
        expect(rows.length).toBeGreaterThan(0); // a scan of nothing proves nothing
        return rows.map((r) => Object.values(r).map((v) => String(v ?? '')).join(' ')).join(' ');
    }

    it('a webhook-source delivery: redacted on the data API, verbatim on the wire', async () => {
        const { driver, engine: eng } = await boot();
        const outbox = new SqlHttpOutbox(eng as any, { partitionCount: 1 });

        await outbox.enqueue({
            source: 'webhook',
            refId: 'wh_1',
            dedupKey: 'crm_account:acc_1:created:1760000000000',
            label: 'data.record.created',
            url: 'https://receiver.example/hook',
            headers: { Authorization: BEARER, 'X-Team': 'crm' },
            signingSecret: SECRET,
            payload: { object: 'crm_account', recordId: 'acc_1', action: 'created' },
        });

        // ── The read path an ordinary GET /api/v1/data/sys_http_delivery
        // takes (`enable.apiMethods: ['get','list']` route through here) ──
        const viaApi = await eng.find(SYS_HTTP_DELIVERY, {});
        expect(viaApi).toHaveLength(1);
        // The KEY is absent — omitted, not masked, not nulled (#7728 (b)).
        expect(Object.keys(viaApi[0] as any)).not.toContain('headers_json');
        expect(JSON.stringify(viaApi)).not.toContain(BEARER);
        // Falsifiability: this is the real row, not an emptied one.
        expect((viaApi[0] as any).url).toBe('https://receiver.example/hook');

        // An EXPLICIT projection naming the column does not bypass the omit —
        // `?select=headers_json` is served without it, not refused (#7823).
        const named = await eng.find(SYS_HTTP_DELIVERY, { fields: ['id', 'url', 'headers_json'] });
        expect(Object.keys(named[0] as any)).not.toContain('headers_json');
        expect((named[0] as any).url).toBe('https://receiver.example/hook');

        // The service-level admin surface narrows too: `list()` is not a
        // dispatch path and returns the redacted view.
        expect(JSON.stringify(await outbox.list())).not.toContain(BEARER);

        // ── The wire: every authored header arrives verbatim ──
        const { impl, calls } = makeFetch();
        await new HttpDispatcher({ nodeId: 'n1', outbox, fetchImpl: impl, partitionCount: 1 }).tick();
        expect(calls).toHaveLength(1);
        expect(calls[0].headers.Authorization).toBe(BEARER);
        expect(calls[0].headers['X-Team']).toBe('crm');
        // …and the signing half is byte-identical (#7799 / #7722 untouched):
        // verified the way a receiver verifies, not by header presence.
        const expected = createHmac('sha256', SECRET).update(calls[0].body).digest('hex');
        expect(calls[0].headers['X-Objectstack-Signature']).toBe(`sha256=${expected}`);

        // ── At rest the bytes are still there, and that is THIS CARD's ruled
        // posture, stated so the next reader is not misled: #8118 narrows the
        // READ surface only. `Field.secret()` (encrypt-at-rest) was measured
        // and rejected — orphan `sys_secret` row per delivery, boot-window
        // fail-open, per-tick decrypt; the row ages out via 30d retention. A
        // future card that changes the at-rest story flips this pin
        // deliberately, not by accident.
        const dump = await scanDeliveryTable(driver);
        expect(dump).toContain(BEARER);
        expect(dump).toContain('https://receiver.example/hook'); // guard the guard
    });

    it("a flow-source delivery — the half every author-declared shape forgets — gets the same pair", async () => {
        const { engine: eng } = await boot();
        const outbox = new SqlHttpOutbox(eng as any, { partitionCount: 1 });

        // Exactly the input shape `http-nodes.ts` produces for a durable flow
        // `http` node: `source: 'flow'`, `refId` = node id, a per-run dedup
        // key, and headers already interpolated from run-scoped variables —
        // they never passed through `WebhookSchema`, so no author-declared
        // sensitive-header list could ever have covered them.
        await outbox.enqueue({
            source: 'flow',
            refId: 'node_http_1',
            dedupKey: 'run_42:node_http_1',
            label: 'flow:node_http_1',
            url: 'https://receiver.example/flow',
            method: 'POST',
            headers: { Authorization: FLOW_BEARER, 'X-Run-Id': 'run_42' },
            payload: { hello: 'world' },
        });

        // Redacted on the generic read path — the row layer does not care
        // which producer wrote the map, which is WHY route 3 covers the whole
        // population.
        const viaApi = await eng.find(SYS_HTTP_DELIVERY, {});
        expect(Object.keys(viaApi[0] as any)).not.toContain('headers_json');
        expect(JSON.stringify(viaApi)).not.toContain(FLOW_BEARER);

        // …and delivered verbatim, per-run values intact.
        const { impl, calls } = makeFetch();
        await new HttpDispatcher({ nodeId: 'n1', outbox, fetchImpl: impl, partitionCount: 1 }).tick();
        expect(calls).toHaveLength(1);
        expect(calls[0].headers.Authorization).toBe(FLOW_BEARER);
        expect(calls[0].headers['X-Run-Id']).toBe('run_42');
    });

    it('a redelivered row still carries its headers — the privileged read serves every attempt', async () => {
        const { engine: eng } = await boot();
        const outbox = new SqlHttpOutbox(eng as any, { partitionCount: 1 });

        const id = await outbox.enqueue({
            source: 'webhook',
            refId: 'wh_1',
            dedupKey: 'once',
            url: 'https://receiver.example/hook',
            headers: { Authorization: BEARER },
            signingSecret: SECRET,
            payload: { a: 1 },
        });

        const first = makeFetch();
        await new HttpDispatcher({ nodeId: 'n1', outbox, fetchImpl: first.impl, partitionCount: 1 }).tick();
        expect(first.calls[0].headers.Authorization).toBe(BEARER);

        // `redeliver()` itself returns the REDACTED view (it is an admin verb,
        // not a dispatch path)…
        const redelivered = await outbox.redeliver(id);
        expect(redelivered.status).toBe('pending');
        expect(redelivered.headers).toBeUndefined();

        // …but the re-send goes through claim, which recovers the map: the
        // wire request is byte-identical to the first attempt.
        const second = makeFetch();
        await new HttpDispatcher({ nodeId: 'n2', outbox, fetchImpl: second.impl, partitionCount: 1 }).tick();
        expect(second.calls).toHaveLength(1);
        expect(second.calls[0].headers.Authorization).toBe(BEARER);
        expect(second.calls[0].body).toBe(first.calls[0].body);
        expect(second.calls[0].headers['X-Objectstack-Signature'])
            .toBe(first.calls[0].headers['X-Objectstack-Signature']);
    });

    it('a delivery authored WITHOUT headers still delivers — recovery of nothing is not a failure', async () => {
        const { engine: eng } = await boot();
        const outbox = new SqlHttpOutbox(eng as any, { partitionCount: 1 });
        await outbox.enqueue({
            source: 'flow',
            refId: 'n1',
            dedupKey: 'plain',
            url: 'https://receiver.example/plain',
            payload: { a: 1 },
        });

        const { impl, calls } = makeFetch();
        await new HttpDispatcher({ nodeId: 'n1', outbox, fetchImpl: impl, partitionCount: 1 }).tick();

        expect(calls).toHaveLength(1);
        // Standard transport headers only — no authored ones, and no artifact
        // of the hydration (`undefined`/`null` never becomes a header value).
        expect(calls[0].headers.Authorization).toBeUndefined();
        expect(calls[0].headers['Content-Type']).toBe('application/json');
    });

    it('FAIL-CLOSED: a redacting engine that cannot dereference refuses the claim — nothing goes out bare', async () => {
        const { engine: eng } = await boot();
        const realOutbox = new SqlHttpOutbox(eng as any, { partitionCount: 1 });
        await realOutbox.enqueue({
            source: 'webhook',
            refId: 'wh_1',
            dedupKey: 'guarded',
            url: 'https://receiver.example/hook',
            headers: { Authorization: BEARER },
            payload: { a: 1 },
        });

        // An engine that REDACTS (real ObjectQL find/getSchema underneath, so
        // `headers_json` is both flagged and omitted) but exposes no
        // `resolveInternalField`. Not a shape ObjectQL can produce — the flag
        // and the accessor ship together — but exactly the shape a foreign or
        // partially-faked engine would take, and the one combination in which
        // "keep going" means delivering a request that silently deviates from
        // its authored configuration.
        const noAccessor = {
            find: (o: string, q: unknown) => (eng as any).find(o, q),
            findOne: (o: string, q: unknown) => (eng as any).findOne(o, q),
            insert: (o: string, d: unknown) => (eng as any).insert(o, d),
            update: (o: string, d: unknown, q: unknown) => (eng as any).update(o, d, q),
            getSchema: (o: string) => (eng as any).getSchema(o),
        } as unknown as IDataEngine;
        const blindOutbox = new SqlHttpOutbox(noAccessor, { partitionCount: 1 });

        const { impl, calls } = makeFetch();
        const dispatcher = new HttpDispatcher({ nodeId: 'n1', outbox: blindOutbox, fetchImpl: impl, partitionCount: 1 });
        await expect(dispatcher.tick()).rejects.toThrow(/resolveInternalField/);
        // The delivery did NOT go out missing its headers.
        expect(calls).toHaveLength(0);

        // No work is lost either: the claim marked the row in_flight before
        // refusing, and the visibility timeout hands it back to a HEALTHY
        // claimer, headers intact.
        const later = Date.now() + 60_000;
        const recovered = await realOutbox.claim({ nodeId: 'n2', limit: 10, claimTtlMs: 1_000, now: later });
        expect(recovered).toHaveLength(1);
        expect(recovered[0].headers).toEqual({ Authorization: BEARER });
    });
});
