// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#13331] Cross-node registry convergence — the protocol's `metadata.mutated`
 * fan-out, measured over the topology that failed in production: two protocol
 * instances ("replicas") over ONE shared `sys_metadata` store, each with its
 * OWN in-memory registry, joined by a bus that delivers every publish to every
 * subscriber (publisher included — that is what a real remote driver does, and
 * it is what the `originNode` loopback guard exists for).
 *
 * The defect this pins, measured on a live 3-replica EE deployment before the
 * fix: a runtime-authored object persists to the shared DB but registers with
 * the WRITING replica's engine registry only, so `/api/v1/data/<object>`
 * answers OBJECT_NOT_FOUND on every other replica, indefinitely (200
 * concurrent creates through the LB: 67×201 / 133×404; a boot-loaded control
 * object under the identical harness: 0 errors).
 *
 * ---------------------------------------------------------------------------
 * Two-arm design, directions declared BEFORE running
 * ---------------------------------------------------------------------------
 *  • Arm B (bridge attached): the writer's publish reaches the peer and the
 *    peer's registry converges FROM ITS OWN DB READ            -> GREEN
 *  • Arm A (control, no attach): the same write leaves the peer's registry
 *    EMPTY — the pre-fix production shape                      -> GREEN
 *    (constrains the instrument: Arm B's convergence is the bridge's doing,
 *    not a harness artifact that registers everywhere unconditionally)
 *
 * Ablation, direction declared in writing for the committed tree: reverting
 * the publisher (the `publishMetadataMutation` call inside
 * `emitMetadataMutation`) turns EXACTLY the Arm-B convergence cases red —
 * "peer converges after a writer publish", "a delete on the writer heals the
 * peer", "the peer's listeners hear a remote mutation" — while Arm A, the
 * loopback case, the draft-silence case and every local-write assertion stay
 * green: with no publisher nothing crosses the bus, which is indistinguishable
 * from the shipped defect.
 */

import { describe, expect, it, vi } from 'vitest';
import { assertEngineDeleteDispatch, assertEngineUpdateDispatch, assertEngineFindOnePredicate } from '@objectstack/metadata-core';
import {
    ObjectStackProtocolImplementation,
    METADATA_MUTATION_CLUSTER_CHANNEL,
    type ClusterMetadataMutationPayload,
    type MetadataMutationEvent,
} from './protocol.js';

interface Row {
    id: string;
    type: string;
    name: string;
    organization_id: string | null;
    package_id: string | null;
    state: string;
    metadata: string;
    checksum?: string;
    version?: number;
}

interface HistoryRow {
    id: string;
    type: string;
    name: string;
    version: number;
    organization_id: string | null;
    operation_type: string;
    metadata?: string | null;
    recorded_at?: string;
}

/** ADR-0048 overlay key — (type, name, org, state, package_id). */
const keyOf = (w: Record<string, unknown>) =>
    `${w.type}|${w.name}|${w.organization_id ?? '__env__'}|${w.state ?? 'active'}|${w.package_id ?? '__nopkg__'}`;

function matchesWhere(r: Row, where: Record<string, unknown>): boolean {
    for (const [k, v] of Object.entries(where)) {
        if (k === '$or') {
            const clauses = v as Array<Record<string, unknown>>;
            if (!clauses.some((c) => matchesWhere(r, c))) return false;
            continue;
        }
        if (v === undefined) continue;
        if ((r as unknown as Record<string, unknown>)[k] !== v) return false;
    }
    return true;
}

/** The SHARED database — what every replica of the deployment reads. */
function makeSharedStore() {
    return {
        rows: new Map<string, Row>(),
        historyRows: [] as HistoryRow[],
        nextId: { value: 0 },
    };
}

/**
 * One "replica": a stub engine over the SHARED store with its OWN registry,
 * wrapped by its own protocol instance. Registry verbs record their calls —
 * the observation channel every case below reads.
 */
function makeReplica(store: ReturnType<typeof makeSharedStore>) {
    const { rows, historyRows, nextId } = store;
    const registeredItems: Array<{ type: string; name: unknown }> = [];
    const registeredObjects: string[] = [];
    /** [#31722] The label each `registerObject` call carried, in order. */
    const registeredLabels: unknown[] = [];
    /**
     * [#31722] This replica's `sys_metadata` reads fail while set: `'all'`
     * fails every read, `'items'` only the by-item re-reads (a read asking
     * for no column subset), so the resync's one active-row read still answers.
     */
    const readFault: { mode?: 'all' | 'items' } = {};
    const failRead = (table: string, opts?: { fields?: unknown }) => {
        if (table !== 'sys_metadata' || !readFault.mode) return;
        if (readFault.mode === 'items' && opts?.fields !== undefined) return;
        throw new Error('sys_metadata read failed: connection reset');
    };
    const unregisteredObjects: string[] = [];
    const removedObjectOverlays: string[] = [];
    const removedEntries: string[] = [];

    const findRow = (w: Record<string, unknown>): { key: string; row: Row } | null => {
        if (w.id !== undefined) {
            for (const [k, r] of rows) if (r.id === w.id) return { key: k, row: r };
            return null;
        }
        if (w.package_id !== undefined) {
            const k = keyOf(w);
            const r = rows.get(k);
            if (r) return { key: k, row: r };
        }
        for (const [k, r] of rows) if (matchesWhere(r, w)) return { key: k, row: r };
        return null;
    };

    const matchesHistory = (h: HistoryRow, w: Record<string, unknown>): boolean => {
        if (w.organization_id !== undefined && h.organization_id !== w.organization_id) return false;
        if (w.type !== undefined && h.type !== w.type) return false;
        if (w.name !== undefined && h.name !== w.name) return false;
        if (w.version !== undefined && h.version !== w.version) return false;
        if (w.operation_type !== undefined && h.operation_type !== w.operation_type) return false;
        return true;
    };

    const engine: any = {
        async findOne(table: string, opts: { where: Record<string, unknown> }) {
            assertEngineFindOnePredicate(table, opts);
            failRead(table, opts);
            if (table === 'sys_metadata_history') {
                return historyRows.find((h) => matchesHistory(h, opts.where)) ?? null;
            }
            if (table !== 'sys_metadata') return null;
            return findRow(opts.where)?.row ?? null;
        },
        async find(table: string, opts?: { where?: Record<string, unknown>; limit?: number; fields?: string[] }) {
            failRead(table, opts);
            // Hold the caller's bound AFTER the filter, by PRESENCE — the
            // objectql-double-limit contract: a bound the double ignores makes
            // a pagination bug invisible to every test built on it.
            const bound = <T>(all: T[]): T[] =>
                typeof opts?.limit === 'number' ? all.slice(0, opts.limit) : all;
            if (table === 'sys_metadata_history') {
                return bound(historyRows.filter((h) => matchesHistory(h, opts?.where ?? {})));
            }
            if (table !== 'sys_metadata') return [];
            return bound(Array.from(rows.values()).filter((r) => matchesWhere(r, opts?.where ?? {})));
        },
        async insert(table: string, data: Record<string, unknown>) {
            if (table === 'sys_metadata_audit') return { id: 'audit_skip' };
            if (table === 'sys_metadata_history') {
                nextId.value += 1;
                const h = { ...(data as unknown as HistoryRow), id: `h_${nextId.value}` };
                historyRows.push(h);
                return { id: h.id };
            }
            if (table !== 'sys_metadata') return { id: 'side_effect_skip' };
            nextId.value += 1;
            const row = { ...(data as unknown as Row), id: `r_${nextId.value}` };
            rows.set(keyOf(data), row);
            return { id: row.id };
        },
        async update(_t: string, data: Record<string, unknown>, opts: { where: Record<string, unknown> }) {
            assertEngineUpdateDispatch(data, opts);
            const found = findRow(opts.where);
            if (!found) return { id: null };
            const merged = { ...found.row, ...(data as unknown as Row) };
            rows.delete(found.key);
            rows.set(keyOf(merged), merged);
            return { id: found.row.id };
        },
        async delete(_t: string, opts: { where: Record<string, unknown> }) {
            assertEngineDeleteDispatch(opts);
            const found = findRow(opts.where);
            if (!found) return { deleted: 0 };
            rows.delete(found.key);
            return { deleted: 1 };
        },
        async count() { return 0; },
        async transaction<T>(cb: (ctx: unknown, info: { owned: boolean }) => Promise<T>): Promise<T> {
            return cb(undefined, { owned: true });
        },
        async syncObjectSchema() { return true; },
        async dropObjectSchema() { return true; },
        registry: {
            registerItem: (type: string, item: any) => {
                registeredItems.push({ type, name: item?.name });
            },
            registerObject: (body: any) => { registeredObjects.push(body?.name); registeredLabels.push(body?.label); },
            unregisterObject: (name: string) => { unregisteredObjects.push(name); return true; },
            removeObjectOverlay: (name: string) => { removedObjectOverlays.push(name); },
            removeRuntimeShadow: () => false,
            removeOverlayEntry: (type: string, name: string) => {
                removedEntries.push(`${type}|${name}`);
                return true;
            },
            listItems: () => [],
            getItem: () => undefined,
            getObject: () => undefined,
            getPackage: () => undefined,
            getArtifactItem: () => undefined,
        },
    };

    const protocol = new ObjectStackProtocolImplementation(
        engine, () => new Map(), 'env_prod',
    ) as any;

    return {
        protocol,
        registeredItems,
        registeredObjects,
        registeredLabels,
        readFault,
        unregisteredObjects,
        removedObjectOverlays,
        removedEntries,
    };
}

/**
 * A remote-driver-shaped bus: one transport object, every publish delivered
 * synchronously to EVERY subscription — the publisher's own node included.
 */
function makeBus() {
    const subs: Array<{ channel: string; handler: (msg: { channel: string; payload: unknown; publishedAt: number }) => void }> = [];
    const published: Array<{ channel: string; payload: ClusterMetadataMutationPayload }> = [];
    const bus = {
        async publish(channel: string, payload: unknown) {
            published.push({ channel, payload: payload as ClusterMetadataMutationPayload });
            for (const s of [...subs]) {
                if (s.channel === channel) s.handler({ channel, payload, publishedAt: Date.now() });
            }
        },
        subscribe(channel: string, handler: (msg: never) => void) {
            const sub = { channel, handler: handler as (msg: { channel: string; payload: unknown; publishedAt: number }) => void };
            subs.push(sub);
            return () => {
                const i = subs.indexOf(sub);
                if (i >= 0) subs.splice(i, 1);
            };
        },
        async close() {},
    };
    return { bus, published, subscriptionCount: () => subs.length };
}

/** Clears the #8308 authoring gates — authored OWD plus at least one field. */
const objectBody = (name: string, label = 'Gadget') => ({
    name,
    label,
    sharingModel: 'private',
    fields: { title: { type: 'text', label: 'Title' } },
});

/** Both replicas over one store, joined (or not) by the bus. */
function makeCluster(opts: { attach: boolean } = { attach: true }) {
    const store = makeSharedStore();
    const writer = makeReplica(store);
    const peer = makeReplica(store);
    const { bus, published, subscriptionCount } = makeBus();
    if (opts.attach) {
        writer.protocol.attachMetadataMutationPubSub(bus, 'node-a');
        peer.protocol.attachMetadataMutationPubSub(bus, 'node-b');
    }
    return { store, writer, peer, bus, published, subscriptionCount };
}

const settle = () => new Promise((r) => setTimeout(r, 0));

describe('[#13331] ⭐ two-arm: peer registry convergence is the bridge’s doing', () => {
    it('Arm B — a runtime-authored object registers on the PEER after the writer’s save', async () => {
        const { writer, peer } = makeCluster({ attach: true });

        const res = await writer.protocol.saveMetaItem({
            type: 'object', name: 'gadget', item: objectBody('gadget'), mode: 'publish',
        });
        expect(res.success).toBe(true);

        // The writer registered synchronously at its own door…
        expect(writer.registeredObjects).toEqual(['gadget']);
        // …and the peer converges from its OWN read of the shared store —
        // this line is the fix: pre-fix it was `[]`, forever.
        await vi.waitFor(() => expect(peer.registeredObjects).toEqual(['gadget']));
        // Under the canonical singular key, like every other write-through
        // route (route 5 in the spelling file's trace).
        expect(peer.registeredItems).toEqual([{ type: 'object', name: 'gadget' }]);
    });

    it('Arm A — CONTROL: the identical write with no bridge leaves the peer empty', async () => {
        const { writer, peer } = makeCluster({ attach: false });

        const res = await writer.protocol.saveMetaItem({
            type: 'object', name: 'gadget', item: objectBody('gadget'), mode: 'publish',
        });
        expect(res.success).toBe(true);
        await settle();

        // The pre-fix production shape: writer registered, peer never hears.
        // This arm is what makes Arm B a measurement — the harness does not
        // register anywhere on its own.
        expect(writer.registeredObjects).toEqual(['gadget']);
        expect(peer.registeredObjects).toEqual([]);
        expect(peer.registeredItems).toEqual([]);
    });
});

describe('[#13331] the payload is a signal, never content', () => {
    it('publishes the row ADDRESS only — no body rides the channel', async () => {
        const { writer, published } = makeCluster({ attach: true });

        await writer.protocol.saveMetaItem({
            type: 'object', name: 'gadget', item: objectBody('gadget'), mode: 'publish',
        });
        await settle();

        expect(published).toHaveLength(1);
        expect(published[0].channel).toBe(METADATA_MUTATION_CLUSTER_CHANNEL);
        const payload = published[0].payload;
        expect(payload.originNode).toBe('node-a');
        // Address-only: the ruled contract (2026-09-01) — a peer must re-read
        // its own DB, so the wire must not offer it anything else to trust.
        expect(Object.keys(payload.event).sort()).toEqual(
            ['name', 'organizationId', 'state', 'type'],
        );
        expect(payload.event).toEqual({
            type: 'object', name: 'gadget', state: 'active', organizationId: null,
        });
    });

    it('a DRAFT save publishes nothing — drafts never enter any registry', async () => {
        const { writer, peer, published } = makeCluster({ attach: true });

        const res = await writer.protocol.saveMetaItem({
            type: 'object', name: 'gadget', item: objectBody('gadget'), mode: 'draft',
        });
        expect(res.success).toBe(true);
        await settle();

        expect(published).toHaveLength(0);
        expect(peer.registeredObjects).toEqual([]);
    });
});

describe('[#13331] loopback and idempotency', () => {
    it('the writer never re-applies its OWN publish (originNode suppression)', async () => {
        const { writer } = makeCluster({ attach: true });

        await writer.protocol.saveMetaItem({
            type: 'object', name: 'gadget', item: objectBody('gadget'), mode: 'publish',
        });
        await settle();

        // Exactly the local write-through's registration — a loopback apply
        // would make this 2 (the bus delivers to the publisher too).
        expect(writer.registeredObjects).toEqual(['gadget']);
    });

    it('duplicate delivery converges to the same state (at-least-once is harmless)', async () => {
        const { writer, peer, bus, published } = makeCluster({ attach: true });
        await writer.protocol.saveMetaItem({
            type: 'object', name: 'gadget', item: objectBody('gadget'), mode: 'publish',
        });
        await vi.waitFor(() => expect(peer.registeredObjects).toEqual(['gadget']));

        // Replay the captured message verbatim — a second delivery of the
        // same signal.
        await bus.publish(published[0].channel, published[0].payload);
        await vi.waitFor(() => expect(peer.registeredObjects).toEqual(['gadget', 'gadget']));

        // Same read, same registration, same key — nothing diverged.
        expect(peer.registeredItems).toEqual([
            { type: 'object', name: 'gadget' },
            { type: 'object', name: 'gadget' },
        ]);
    });

    it('re-attaching the same (pubsub, nodeId) pair does not double-subscribe', () => {
        const { writer, bus, subscriptionCount } = makeCluster({ attach: true });
        const before = subscriptionCount();
        writer.protocol.attachMetadataMutationPubSub(bus, 'node-a');
        expect(subscriptionCount()).toBe(before);
    });

    it('after detach, deliveries are no longer applied', async () => {
        const { writer, peer, bus, published } = makeCluster({ attach: true });
        await writer.protocol.saveMetaItem({
            type: 'object', name: 'gadget', item: objectBody('gadget'), mode: 'publish',
        });
        await vi.waitFor(() => expect(peer.registeredObjects).toEqual(['gadget']));

        peer.protocol.detachMetadataMutationPubSub();
        await bus.publish(published[0].channel, published[0].payload);
        await settle();

        expect(peer.registeredObjects).toEqual(['gadget']);
    });
});

describe('[#13331] delete fan-out — the peer heals from its own read', () => {
    it('a delete on the writer retires the peer’s registry entry', async () => {
        const { writer, peer } = makeCluster({ attach: true });
        await writer.protocol.saveMetaItem({
            type: 'object', name: 'gadget', item: objectBody('gadget'), mode: 'publish',
        });
        await vi.waitFor(() => expect(peer.registeredObjects).toEqual(['gadget']));

        const res = await writer.protocol.deleteMetaItem({ type: 'object', name: 'gadget' });
        expect(res.success).toBe(true);

        // No active row remains in the shared store, so the peer runs the
        // same heal walk the writer ran locally (#6808's two-place removal).
        await vi.waitFor(() => expect(peer.unregisteredObjects).toEqual(['gadget']));
        expect(peer.removedObjectOverlays).toEqual(['gadget']);
        expect(peer.removedEntries).toContain('object|gadget');
    });

    it('a draft DISCARD leaves the peer’s active registration standing', async () => {
        const { writer, peer } = makeCluster({ attach: true });
        await writer.protocol.saveMetaItem({
            type: 'object', name: 'gadget', item: objectBody('gadget'), mode: 'publish',
        });
        await writer.protocol.saveMetaItem({
            type: 'object', name: 'gadget', item: objectBody('gadget', 'Draft rename'), mode: 'draft',
        });
        await vi.waitFor(() => expect(peer.registeredObjects).toEqual(['gadget']));

        const res = await writer.protocol.deleteMetaItem({ type: 'object', name: 'gadget', state: 'draft' });
        expect(res.success).toBe(true);

        // The ACTIVE row survives the discard, so the peer's DB read finds it
        // and re-registers (idempotent) rather than healing it away — the
        // event name does not decide, the read does.
        await vi.waitFor(() => expect(peer.registeredObjects).toEqual(['gadget', 'gadget']));
        expect(peer.unregisteredObjects).toEqual([]);
    });
});

describe('[#13331] listener replay — boot-cached consumers hear remote mutations', () => {
    it('the peer’s onMetadataMutation listeners receive the remote event, once, after convergence', async () => {
        const { writer, peer } = makeCluster({ attach: true });
        const writerSeen: MetadataMutationEvent[] = [];
        const peerSeen: MetadataMutationEvent[] = [];
        writer.protocol.onMetadataMutation((evt: MetadataMutationEvent) => { writerSeen.push(evt); });
        peer.protocol.onMetadataMutation((evt: MetadataMutationEvent) => {
            // #5109 invalidate-before-notify, cross-node edition: by the time
            // a listener hears it, the registry must already serve the row.
            peerSeen.push({ ...evt });
            expect(peer.registeredObjects).toEqual(['gadget']);
        });

        await writer.protocol.saveMetaItem({
            type: 'object', name: 'gadget', item: objectBody('gadget'), mode: 'publish',
        });
        await vi.waitFor(() => expect(peerSeen).toHaveLength(1));

        expect(peerSeen[0]).toEqual({
            type: 'object', name: 'gadget', state: 'active', organizationId: null,
        });
        // The writer's listeners heard the LOCAL emit exactly once — the
        // remote replay stays local to the receiving node (no echo).
        expect(writerSeen).toHaveLength(1);
    });
});

/**
 * [#31722] `cluster.resync` on lane 2: the hint a cluster outage lost.
 *
 * The bus below drops every publish while `down` — the at-most-once loss of a
 * real driver whose store is unreachable. `resyncMetadataMutationPubSub()` is
 * the seam `MetadataClusterBridgePlugin` calls on the driver's local
 * `cluster.resync` event (its own tests pin that call, and that the in-process
 * driver never wires it).
 */
describe('[#31722] cluster.resync — the peer re-converges what a lost hint would have told it', () => {
    /** `makeCluster()`, over a bus that loses every publish while `outage.down`. */
    function makeLossyCluster() {
        const cluster = makeCluster({ attach: false });
        const outage = { down: false };
        const publish = cluster.bus.publish.bind(cluster.bus);
        cluster.bus.publish = async (channel: string, payload: unknown) => {
            if (outage.down) return;
            await publish(channel, payload);
        };
        cluster.writer.protocol.attachMetadataMutationPubSub(cluster.bus, 'node-a');
        cluster.peer.protocol.attachMetadataMutationPubSub(cluster.bus, 'node-b');
        return { ...cluster, outage };
    }

    const save = (replica: ReturnType<typeof makeReplica>, name: string, label?: string) =>
        replica.protocol.saveMetaItem({ type: 'object', name, item: objectBody(name, label), mode: 'publish' });

    it('⭐ an object authored while the hint was lost is served by the peer after its resync', async () => {
        const { writer, peer, outage } = makeLossyCluster();

        outage.down = true;
        expect((await save(writer, 'gadget')).success).toBe(true);
        outage.down = false;
        await settle();
        // The loss: the writer serves it, the peer never heard.
        expect(writer.registeredObjects).toEqual(['gadget']);
        expect(peer.registeredObjects).toEqual([]);

        const report = await peer.protocol.resyncMetadataMutationPubSub();
        expect(peer.registeredObjects).toEqual(['gadget']);
        expect(report).toMatchObject({ rows: 1, converged: 1, deleted: 0, kept: 0, unchanged: 0 });
    });

    it('a lost update re-converges that item only; an unchanged item is not re-applied', async () => {
        const { writer, peer, outage } = makeLossyCluster();
        await save(writer, 'gadget', 'Gadget');
        await save(writer, 'widget', 'Widget');
        await vi.waitFor(() => expect(peer.registeredObjects).toEqual(['gadget', 'widget']));
        // Both hints were delivered: a first resync re-reads the two items the hints named.
        expect(await peer.protocol.resyncMetadataMutationPubSub()).toMatchObject({ converged: 2, unchanged: 0 });
        expect(peer.registeredObjects).toEqual(['gadget', 'widget', 'gadget', 'widget']);

        outage.down = true;
        await save(writer, 'gadget', 'Gadget renamed');
        outage.down = false;

        const report = await peer.protocol.resyncMetadataMutationPubSub();
        expect(report).toMatchObject({ rows: 2, converged: 1, unchanged: 1 });
        expect(peer.registeredObjects).toEqual(['gadget', 'widget', 'gadget', 'widget', 'gadget']);
        expect(peer.registeredLabels.at(-1)).toBe('Gadget renamed');
    });

    it('a lost delete takes the delete’s heal walk on the peer', async () => {
        const { writer, peer, outage } = makeLossyCluster();
        await save(writer, 'gadget');
        await vi.waitFor(() => expect(peer.registeredObjects).toEqual(['gadget']));

        outage.down = true;
        expect((await writer.protocol.deleteMetaItem({ type: 'object', name: 'gadget' })).success).toBe(true);
        outage.down = false;
        await settle();
        expect(peer.unregisteredObjects).toEqual([]);

        const report = await peer.protocol.resyncMetadataMutationPubSub();
        // The same removal a delivered delete makes (the lane's #13331 case above).
        expect(peer.unregisteredObjects).toEqual(['gadget']);
        expect(peer.removedObjectOverlays).toEqual(['gadget']);
        expect(report).toMatchObject({ rows: 0, deleted: 1, kept: 0 });
    });

    it('a delete of a row present at attach, lost in the outage, is found from the baseline', async () => {
        const { writer, peer, outage, bus } = makeLossyCluster();
        // Stored before the peer's lane attached: the peer never heard a hint for it.
        peer.protocol.detachMetadataMutationPubSub();
        await save(writer, 'gadget');
        peer.protocol.attachMetadataMutationPubSub(bus, 'node-b');

        outage.down = true;
        await writer.protocol.deleteMetaItem({ type: 'object', name: 'gadget' });
        outage.down = false;

        expect(await peer.protocol.resyncMetadataMutationPubSub()).toMatchObject({ rows: 0, deleted: 1 });
        expect(peer.unregisteredObjects).toEqual(['gadget']);
    });

    it('a revert to an earlier body (an earlier checksum) is still re-converged after a delivered hint', async () => {
        const { writer, peer, outage } = makeLossyCluster();
        await save(writer, 'gadget', 'One');
        await vi.waitFor(() => expect(peer.registeredLabels).toEqual(['One']));
        await peer.protocol.resyncMetadataMutationPubSub();
        await save(writer, 'gadget', 'Two');
        await vi.waitFor(() => expect(peer.registeredLabels.at(-1)).toBe('Two'));

        outage.down = true;
        await save(writer, 'gadget', 'One');
        outage.down = false;

        await peer.protocol.resyncMetadataMutationPubSub();
        expect(peer.registeredLabels.at(-1)).toBe('One');
    });

    it('a failed active-row read rejects and keeps every entry; the next resync converges', async () => {
        const { writer, peer, outage } = makeLossyCluster();
        await save(writer, 'gadget');
        await vi.waitFor(() => expect(peer.registeredObjects).toEqual(['gadget']));

        outage.down = true;
        await writer.protocol.deleteMetaItem({ type: 'object', name: 'gadget' });
        outage.down = false;

        peer.readFault.mode = 'all';
        await expect(peer.protocol.resyncMetadataMutationPubSub()).rejects.toThrow(
            /could not read sys_metadata .*every registry entry is kept/,
        );
        expect(peer.unregisteredObjects).toEqual([]);

        peer.readFault.mode = undefined;
        await peer.protocol.resyncMetadataMutationPubSub();
        expect(peer.unregisteredObjects).toEqual(['gadget']);
    });

    it('an item whose own re-read fails is kept, logged once, and re-read on the next resync', async () => {
        const { writer, peer, outage } = makeLossyCluster();
        await save(writer, 'gadget');
        await save(writer, 'widget');
        await vi.waitFor(() => expect(peer.registeredObjects).toEqual(['gadget', 'widget']));

        outage.down = true;
        await writer.protocol.deleteMetaItem({ type: 'object', name: 'gadget' });
        await writer.protocol.deleteMetaItem({ type: 'object', name: 'widget' });
        outage.down = false;

        const error = vi.spyOn(console, 'error').mockImplementation(() => {});
        try {
            peer.readFault.mode = 'items';
            const report = await peer.protocol.resyncMetadataMutationPubSub();
            // A transient failure is not a delete.
            expect(peer.unregisteredObjects).toEqual([]);
            expect(report).toMatchObject({ rows: 0, deleted: 0, kept: 2 });
            const lines = error.mock.calls.map((c) => String(c[0])).filter((l) => l.includes('metadata.mutated resync'));
            expect(lines).toHaveLength(1);
            expect(lines[0]).toContain('could not re-read 2 stored item(s) (object/gadget, object/widget)');
        } finally {
            error.mockRestore();
        }

        peer.readFault.mode = undefined;
        expect(await peer.protocol.resyncMetadataMutationPubSub()).toMatchObject({ deleted: 2, kept: 0 });
        expect([...peer.unregisteredObjects].sort()).toEqual(['gadget', 'widget']);
    });

    it('CONTROL — nothing lost: a resync after a quiet outage re-applies nothing', async () => {
        const { writer, peer } = makeLossyCluster();
        await save(writer, 'gadget');
        await vi.waitFor(() => expect(peer.registeredObjects).toEqual(['gadget']));
        await peer.protocol.resyncMetadataMutationPubSub();
        const before = [...peer.registeredObjects];

        expect(await peer.protocol.resyncMetadataMutationPubSub()).toMatchObject({ rows: 1, converged: 0, unchanged: 1 });
        expect(peer.registeredObjects).toEqual(before);
        expect(peer.unregisteredObjects).toEqual([]);
    });

    it('CONTROL — no transport attached (a single node): the seam reads nothing and does nothing', async () => {
        const store = makeSharedStore();
        const solo = makeReplica(store);
        await solo.protocol.saveMetaItem({ type: 'object', name: 'gadget', item: objectBody('gadget'), mode: 'publish' });
        solo.readFault.mode = 'all';

        await expect(solo.protocol.resyncMetadataMutationPubSub()).resolves.toBeUndefined();
        expect(solo.registeredObjects).toEqual(['gadget']);
        expect(solo.unregisteredObjects).toEqual([]);
    });
});
