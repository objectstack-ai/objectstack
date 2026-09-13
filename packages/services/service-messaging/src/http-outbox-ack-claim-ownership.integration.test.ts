// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #17634 — an HTTP ack proves OWNERSHIP of the claim it completes, not just
 * that a row id exists: a late ack from a claim the visibility-timeout reap
 * took back must not overwrite the live re-claim on `sys_http_delivery`. The
 * notification outbox closed the same shape in #11859; this file pins the HTTP
 * outbox against the same sequence.
 *
 * ## The reachable sequence this file replays — for real
 *
 *  1. node A claims row R and starts a POST;
 *  2. the POST outruns `claimTtlMs`;
 *  3. node B's tick reaps R back to `pending` and re-claims it — R is
 *     `in_flight` again, claimed by B, and B is POSTing;
 *  4. A's POST finishes and A acks. Without the claim credential both stores
 *     write by id, so A's outcome (here a permanent 410 → `dead`) lands over
 *     B's live attempt.
 *
 * Two blocks, one table of stores:
 *
 *  - **Through the dispatcher.** Two real `HttpDispatcher`s share one store,
 *    with an injected clock and gated fetches: the defect lives in the
 *    interaction of the reap, the re-claim and the late ack, and in what the
 *    dispatcher hands the store at ack time. No step pokes the store by hand.
 *  - **Through the store contract.** `claim()` with an explicit `now`, then
 *    `ack(id, result, claimed)` with the credential the claim returned — the
 *    refusals a pair of dispatchers cannot reach deterministically: the same
 *    node's own re-claim, a claim reaped and not re-claimed, a credential
 *    missing a member.
 *
 * ## The vacuity traps closed explicitly
 *
 *  - **"Refused" cannot be told from "never ran" by the refusal alone.** Each
 *    refusal leg pins what the ack did NOT do — the row still reads as the live
 *    claim, with no attempt and no response code recorded — and, where a live
 *    claim exists, that its own ack then lands with its own outcome.
 *  - **A store that refuses EVERY ack passes the refusal legs.** Each block has
 *    a negative control: the same sequence WITHOUT the reap, whose ack MUST
 *    land.
 *  - **`toThrow()` alone proves nothing** — an unfixed store throws nothing, a
 *    broken one could throw anything: refusals assert the error IDENTITY,
 *    `name` + the ADR-0112 `code`. There is no HTTP envelope on this surface,
 *    so `code` is the whole machine-readable identity.
 *  - **A fix that stops honouring the two-argument `ack` breaks every outbox
 *    written against it.** The compatibility leg runs the dispatcher over an
 *    outbox whose `ack` reads `(id, result)` only, and requires the delivery to
 *    land.
 *
 * ## Why both stores, one table
 *
 * The guarantee is a property of {@link IHttpOutbox}. The SQL leg runs on a
 * REAL engine (`ObjectQL` + `SqlDriver`, better-sqlite3 `:memory:`) because the
 * fix IS a conditional UPDATE and a fake engine cannot refuse a write; the
 * memory leg keeps every test built on `MemoryHttpOutbox` honest about the same
 * contract.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { MemoryHttpOutbox } from './memory-http-outbox.js';
import { SqlHttpOutbox } from './sql-http-outbox.js';
import { HttpDelivery } from './objects/http-delivery.object.js';
import { HttpDispatcher } from './http-dispatcher.js';
import type { FetchImpl } from './http-sender.js';
import type {
    EnqueueHttpInput,
    HttpClaimCredential,
    HttpDelivery as HttpDeliveryRow,
    IHttpOutbox,
} from './http-outbox.js';

const TTL = 60_000;
/** Step-1 instant: node A's claim. */
const T0 = 1_000_000;
/** Step-3 instant: one past the visibility timeout, so the reap fires. */
const T_AFTER_TTL = T0 + TTL + 1;
/** The no-reap instant for the negative controls: inside the timeout. */
const T_WITHIN_TTL = T0 + TTL - 1;

/** What the dispatcher logs when the store refuses a lost claim's ack — the notification dispatcher's words. */
const ACK_REFUSED_WARN = 'http-dispatcher: ack refused, claim no longer held';
/** The refusal identity — `name` + ADR-0112 `code`, never a bare throw. */
const REFUSAL = { name: 'HttpAckError', code: 'DELIVERY_NOT_ELIGIBLE' };

const DELIVERY: EnqueueHttpInput = {
    source: 'flow', refId: 'r1', dedupKey: 'd_r1', url: 'https://receiver.example/r1', payload: { n: 1 },
};

type BuiltInHttpOutbox = MemoryHttpOutbox | SqlHttpOutbox;

interface Backend {
    readonly name: string;
    create(): Promise<BuiltInHttpOutbox>;
    destroy(): Promise<void>;
}

function memoryBackend(): Backend {
    return {
        name: 'MemoryHttpOutbox',
        async create() { return new MemoryHttpOutbox(); },
        async destroy() { /* nothing to tear down */ },
    };
}

function sqlBackend(): Backend {
    let engine: ObjectQL | undefined;
    return {
        name: 'SqlHttpOutbox',
        async create() {
            const driver = new SqlDriver({
                client: 'better-sqlite3',
                connection: { filename: ':memory:' },
                useNullAsDefault: true,
            });
            engine = new ObjectQL();
            engine.registerDriver(driver, true);
            await engine.init();
            engine.registry.registerObject(HttpDelivery as any, '@objectstack/service-messaging');
            await engine.syncSchemas();
            return new SqlHttpOutbox(engine as any, { partitionCount: 1 });
        },
        async destroy() {
            try { await engine?.destroy(); } catch { /* noop */ }
            engine = undefined;
        },
    };
}

function respond(status: number) {
    return { ok: status >= 200 && status < 300, status, async text() { return `status ${status}`; } };
}

function deferred(): { promise: Promise<void>; resolve: () => void } {
    let resolve!: () => void;
    const promise = new Promise<void>((r) => { resolve = r; });
    return { promise, resolve };
}

/** One line a human can diff: status, holder, claim instant, attempts, and WHOSE response was recorded. */
function fingerprint(r: HttpDeliveryRow): string {
    return `${r.status}:${r.claimedBy ?? '-'}:${r.claimedAt ?? '-'}:${r.attempts}:${r.responseCode ?? '-'}`;
}

function claimOpts(nodeId: string, now: number) {
    return { nodeId, limit: 10, claimTtlMs: TTL, now };
}

/** The credential on a row `claim()` returned — asserted present, because handing it back IS the contract. */
function credentialOf(row: HttpDeliveryRow): HttpClaimCredential {
    const { claimedBy, claimedAt } = row;
    if (typeof claimedBy !== 'string' || typeof claimedAt !== 'number') {
        throw new Error(`claim() returned row '${row.id}' without its claim credential`);
    }
    return { claimedBy, claimedAt };
}

describe.each([memoryBackend(), sqlBackend()])('$name — HttpDispatcher acks with the claim it holds (#17634)', (backend) => {
    let outbox: BuiltInHttpOutbox;
    /** Held-open POSTs to release before the store goes away, so a red leg cannot strand one. */
    let cleanups: Array<() => Promise<void>>;

    beforeEach(async () => {
        outbox = await backend.create();
        cleanups = [];
    });
    afterEach(async () => {
        for (const cleanup of cleanups) await cleanup();
        await backend.destroy();
    });

    async function readRow(id: string): Promise<HttpDeliveryRow> {
        const row = (await outbox.list()).find((r) => r.id === id);
        if (!row) throw new Error(`row '${id}' vanished — the harness, not the contract, is broken`);
        return row;
    }

    /**
     * Two dispatchers on one store and one injected clock. Node A claims the
     * row at `T0`; its POST moves the clock to `secondTickAt` and runs node B's
     * tick, then answers 410 — a permanent failure, so A's outcome is `dead`,
     * the card's shape — once B is either POSTing the row it re-claimed or has
     * finished a tick that took nothing. B's POST is held open until the leg
     * calls `finishB()`, so A's ack lands while B is still sending.
     */
    async function raceTwoDispatchers(secondTickAt: number) {
        const id = await outbox.enqueue(DELIVERY);
        let clock = T0;
        const now = () => clock;
        const posts: string[] = [];
        const warnsA: Array<{ msg: string; meta: unknown }> = [];
        const bSending = deferred();
        const releaseB = deferred();
        let bTick: Promise<void> = Promise.resolve();
        cleanups.push(async () => { releaseB.resolve(); await bTick; });

        const bFetch: FetchImpl = async () => {
            posts.push('node-b');
            bSending.resolve();
            await releaseB.promise;
            return respond(200);
        };
        const b = new HttpDispatcher({
            nodeId: 'node-b', outbox, fetchImpl: bFetch, partitionCount: 1, claimTtlMs: TTL, intervalMs: 10_000, now,
        });

        const aFetch: FetchImpl = async () => {
            posts.push('node-a');
            // 2. A's POST takes until `secondTickAt`…
            clock = secondTickAt;
            // 3. …and node B ticks meanwhile.
            bTick = b.tick();
            await Promise.race([bSending.promise, bTick]);
            return respond(410);
        };
        const a = new HttpDispatcher({
            nodeId: 'node-a', outbox, fetchImpl: aFetch, partitionCount: 1, claimTtlMs: TTL, intervalMs: 10_000, now,
            logger: { warn: (msg, meta) => { warnsA.push({ msg, meta }); } },
        });

        // 1. + 4. A claims, POSTs and acks: one whole tick.
        await a.tick();
        return {
            id,
            posts,
            warnsA,
            async finishB() { releaseB.resolve(); await bTick; },
        };
    }

    it("replays the card: A's late ack leaves B's live re-claim alone, and B's own ack lands", async () => {
        const race = await raceTwoDispatchers(T_AFTER_TTL);

        // Both nodes really POSTed: B re-claimed the row A's POST outran.
        expect(race.posts).toEqual(['node-a', 'node-b']);

        // A's ack did NOT land: the row still reads as B's claim — B's claim
        // instant, no attempt recorded, and A's 410 nowhere on it.
        expect(fingerprint(await readRow(race.id))).toBe(`in_flight:node-b:${T_AFTER_TTL}:0:-`);
        // …and A's dispatcher said so, once, naming itself and the row.
        expect(race.warnsA).toEqual([
            { msg: ACK_REFUSED_WARN, meta: expect.objectContaining({ nodeId: 'node-a', deliveryId: race.id }) },
        ]);

        // B finishes: its ack — the live attempt A would have overwritten —
        // records exactly one attempt, with B's outcome.
        await race.finishB();
        expect(fingerprint(await readRow(race.id))).toBe('success:-:-:1:200');
    });

    it("negative control: the same two dispatchers WITHOUT the reap — A's ack lands", async () => {
        const race = await raceTwoDispatchers(T_WITHIN_TTL);

        // B's tick found the row still inside A's claim and took nothing.
        expect(race.posts).toEqual(['node-a']);
        // A's ack, completing the claim it still holds, MUST land.
        expect(fingerprint(await readRow(race.id))).toBe('dead:-:-:1:410');
        expect(race.warnsA).toEqual([]);
    });

    it('an outbox whose ack() reads (id, result) only keeps working: the dispatcher still records its attempts', async () => {
        // The shape of an outbox written before the credential existed: the same
        // store underneath, reached through an `ack` that reads two parameters.
        const acked: string[] = [];
        const legacy: IHttpOutbox = {
            enqueue: (input) => outbox.enqueue(input),
            recordUndeliverable: (input) => outbox.recordUndeliverable(input),
            reap: (opts) => outbox.reap(opts),
            claim: (opts) => outbox.claim(opts),
            ack: (id, result) => { acked.push(id); return outbox.ack(id, result); },
            list: (filter) => outbox.list(filter),
            redeliver: (id, options) => outbox.redeliver(id, options),
        };
        const id = await outbox.enqueue(DELIVERY);
        const fetchImpl: FetchImpl = async () => respond(200);

        await new HttpDispatcher({
            nodeId: 'node-a', outbox: legacy, fetchImpl, partitionCount: 1, claimTtlMs: TTL, intervalMs: 10_000,
            now: () => T0,
        }).tick();

        expect(acked).toEqual([id]);
        expect(fingerprint(await readRow(id))).toBe('success:-:-:1:200');
    });
});

describe.each([memoryBackend(), sqlBackend()])('$name — ack() with a claim credential proves the claim (#17634)', (backend) => {
    let outbox: BuiltInHttpOutbox;

    beforeEach(async () => { outbox = await backend.create(); });
    afterEach(async () => { await backend.destroy(); });

    async function readRow(id: string): Promise<HttpDeliveryRow> {
        const row = (await outbox.list()).find((r) => r.id === id);
        if (!row) throw new Error(`row '${id}' vanished — the harness, not the contract, is broken`);
        return row;
    }

    it('replays the card: a late ack from a reaped claim is refused, and touches NOTHING', async () => {
        const id = await outbox.enqueue(DELIVERY);

        // 1. node A claims R and "starts a send".
        const byA = await outbox.claim(claimOpts('node-a', T0));
        expect(byA.map((r) => `${r.id}:${r.claimedBy}:${r.claimedAt}`)).toEqual([`${id}:node-a:${T0}`]);

        // 2.–3. The send outruns claimTtlMs; node B's claim() reaps R back to
        // pending and re-claims it in the same call — `in_flight` AGAIN, the
        // state a status-only predicate cannot tell from step 1.
        const byB = await outbox.claim(claimOpts('node-b', T_AFTER_TTL));
        expect(byB.map((r) => `${r.id}:${r.claimedBy}:${r.claimedAt}`)).toEqual([`${id}:node-b:${T_AFTER_TTL}`]);

        // 4. node A finishes and acks with the credential its own claim returned.
        await expect(
            outbox.ack(id, { success: false, httpStatus: 410, error: 'gone', durationMs: TTL + 5, dead: true }, credentialOf(byA[0])),
        ).rejects.toMatchObject(REFUSAL);
        // What the refusal did NOT do: the row still belongs to B's claim.
        expect(fingerprint(await readRow(id))).toBe(`in_flight:node-b:${T_AFTER_TTL}:0:-`);

        // …and B's own ack — the live attempt A would have overwritten — lands.
        await expect(
            outbox.ack(id, { success: true, httpStatus: 200, durationMs: 3 }, credentialOf(byB[0])),
        ).resolves.toBeUndefined();
        expect(fingerprint(await readRow(id))).toBe('success:-:-:1:200');
    });

    it('negative control: the SAME sequence without the reap still acks', async () => {
        const id = await outbox.enqueue(DELIVERY);
        const byA = await outbox.claim(claimOpts('node-a', T0));
        expect(byA.map((r) => r.id)).toEqual([id]);

        // 2'. Slow, but INSIDE the visibility timeout: node B's claim() reaps
        // nothing and takes nothing — proven, not assumed.
        expect(await outbox.claim(claimOpts('node-b', T_WITHIN_TTL))).toEqual([]);
        expect(fingerprint(await readRow(id))).toBe(`in_flight:node-a:${T0}:0:-`);

        // 4'. A's ack with its own credential MUST land — a predicate that
        // refused every ack fails here.
        await expect(
            outbox.ack(id, { success: false, httpStatus: 410, error: 'gone', durationMs: 5, dead: true }, credentialOf(byA[0])),
        ).resolves.toBeUndefined();
        expect(fingerprint(await readRow(id))).toBe('dead:-:-:1:410');
    });

    it("the credential is the CLAIM, not the node: a stale ack loses to the same node's own re-claim", async () => {
        const id = await outbox.enqueue(DELIVERY);
        const stale = await outbox.claim(claimOpts('node-a', T0));
        expect(stale.map((r) => r.id)).toEqual([id]);

        // A ITSELF reaps and re-claims on a later tick. Same node id — a
        // claimed_by-only predicate would match.
        const fresh = await outbox.claim(claimOpts('node-a', T_AFTER_TTL));
        expect(fresh.map((r) => `${r.claimedBy}:${r.claimedAt}`)).toEqual([`node-a:${T_AFTER_TTL}`]);

        // The FIRST attempt's late ack is refused — `claimedAt` is what tells two
        // claims by one node apart.
        await expect(
            outbox.ack(
                id,
                { success: false, httpStatus: 503, error: 'unavailable', durationMs: 1, nextRetryAt: T_AFTER_TTL + 1_000 },
                credentialOf(stale[0]),
            ),
        ).rejects.toMatchObject(REFUSAL);
        expect(fingerprint(await readRow(id))).toBe(`in_flight:node-a:${T_AFTER_TTL}:0:-`);

        // The fresh claim's ack still lands.
        await expect(
            outbox.ack(id, { success: true, httpStatus: 200, durationMs: 1 }, credentialOf(fresh[0])),
        ).resolves.toBeUndefined();
        expect(fingerprint(await readRow(id))).toBe('success:-:-:1:200');
    });

    it('a claim reaped and NOT re-claimed: the late ack is refused, and the row stays queued with no attempt recorded', async () => {
        const id = await outbox.enqueue(DELIVERY);
        const byA = await outbox.claim(claimOpts('node-a', T0));
        await outbox.reap({ claimTtlMs: TTL, now: T_AFTER_TTL });
        expect(fingerprint(await readRow(id))).toBe('pending:-:-:0:-');

        // A retry outcome, deliberately: its post-state would ALSO read
        // `pending`, so only the attempt counter could expose a write that landed.
        await expect(
            outbox.ack(
                id,
                { success: false, httpStatus: 503, error: 'unavailable', durationMs: 1, nextRetryAt: T_AFTER_TTL + 1_000 },
                credentialOf(byA[0]),
            ),
        ).rejects.toMatchObject(REFUSAL);
        expect(fingerprint(await readRow(id))).toBe('pending:-:-:0:-');
    });

    it('a credential missing a member is refused before anything is written', async () => {
        const id = await outbox.enqueue(DELIVERY);
        await outbox.claim(claimOpts('node-a', T0));

        // A JS caller or a cast: `claimedAt` absent.
        const partial = { claimedBy: 'node-a' } as unknown as HttpClaimCredential;
        await expect(
            outbox.ack(id, { success: true, httpStatus: 200, durationMs: 1 }, partial),
        ).rejects.toMatchObject(REFUSAL);
        expect(fingerprint(await readRow(id))).toBe(`in_flight:node-a:${T0}:0:-`);
    });
});
