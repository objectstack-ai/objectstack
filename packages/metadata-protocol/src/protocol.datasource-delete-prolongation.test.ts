// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#13609] RE-VERIFICATION — how long does a PEER replica keep serving a
 * DELETED datasource on `GET /api/v1/meta/datasource`?
 *
 * ---------------------------------------------------------------------------
 * What this file is, and why it is a measurement rather than a fix
 * ---------------------------------------------------------------------------
 * QA observed a deleted datasource still being served by
 * `/api/v1/meta/datasource` on all three replicas of a cluster, prolonging an
 * exposure. The maintainer ruled (2026-09-01, director decision batch A) that
 * the #13331 fix — a publisher at the protocol's mutation choke point, a
 * `service-cluster` bridge, and peers re-reading their OWN DB — was expected to
 * close this observation too, and that this card stays open as the
 * re-verification carrier: re-measure the prolongation once that fix lands, and
 * close only on the measurement.
 *
 * ⭐ The discriminator is DURATION, and it is sharp:
 *
 *     bounded (≲ one cache TTL window) = fixed
 *     unbounded                        = not fixed
 *
 * "It cleared eventually" is not a reading unless the bound is stated. So this
 * file does not assert a boolean; it MEASURES a bound (see
 * {@link measureProlongationMs}) and asserts the number.
 *
 * ---------------------------------------------------------------------------
 * The read door under measurement is the PROTOCOL's, not the manager's
 * ---------------------------------------------------------------------------
 * `GET /api/v1/meta/:type` is served by `rest-server.ts`' list route, whose
 * body is `const items = await p.getMetaItems(listRequest)` — `p` being this
 * protocol. So the door QA watched is `getMetaItems`, and its answer is built
 * from TWO local, per-replica sources, which is what makes a peer able to serve
 * a row the shared DB no longer has:
 *
 *   1. `engine.registry.listItems(type)` — the in-memory registry. It is the
 *      BASE of the answer, and `sys_metadata` rows are merged ON TOP of it
 *      (`mergePackageAwareOverlay`). Nothing in that merge prunes a base item
 *      whose row is gone. ⭐ The registry carries NO TTL, so a stale entry here
 *      is served until the process restarts — this is the UNBOUNDED seam, and
 *      it is the mechanism PR #13883 identified one layer up on
 *      `MetadataManager` (registry hit never re-checked against the loader).
 *   2. The `meta-overlay-cache` row-set cache — keyed on the engine's write
 *      EPOCH plus a TTL (`OS_METADATA_OVERLAY_CACHE_TTL_MS`, default 30s). The
 *      epoch is LOCAL: a peer's write never moves it, so this cache's own
 *      header names exactly this residue — "a PEER node's write on a deployment
 *      with no bridge attached". ⭐ This is the BOUNDED seam.
 *
 * ⚠️ A precision the card's checklist did not have: at THIS door the cache in
 * play is `meta-overlay-cache`'s, not `MetadataManager.LIST_CACHE_TTL_MS`. Both
 * default to 30_000 ms, so the ruling's bound is unchanged in magnitude — but
 * they are different caches, a future author tuning `LIST_CACHE_TTL_MS` would
 * not move this number, and only this one feeds the registry. The constant is
 * imported here, never retyped, so this pin tracks whichever value ships.
 *
 * ---------------------------------------------------------------------------
 * Topology: a PROXY for a live multi-node deployment, declared as one
 * ---------------------------------------------------------------------------
 * ⛔ This is NOT a live multi-node run, and must never be read as one. No live
 * cluster driver or multi-process deployment is reachable from the dev
 * container, so the live measurement the ruling asks for is reported NOT
 * MEASURED. What runs here is the shape PR #13331's own fan-out pin uses and
 * that the PM declared acceptable as the proxy: TWO protocol instances over ONE
 * shared `sys_metadata` store, each with its OWN registry, its OWN overlay
 * cache and its OWN write epoch, joined by a real cross-instance transport that
 * delivers every publish to every subscriber (the publisher included — what a
 * real remote driver does, and what the `originNode` loopback guard exists
 * for).
 *
 * What the proxy leaves open, named rather than papered over: whether the QA
 * deployment was running the shipped in-process `memory` cluster driver (which
 * has no cross-process delivery, so nothing was listening) or hit a SECOND
 * defect in a genuinely distributed driver. Only a real-driver run separates
 * those, and it is not run here.
 *
 * ---------------------------------------------------------------------------
 * Arms — predicted BEFORE the run, and the prediction was FALSIFIED
 * ---------------------------------------------------------------------------
 * Predicted, in writing, before running:
 *
 *  • Arm B (bridge attached — the landed #13331 shape): the peer's registry
 *    converges within one bus hop, so the unbounded seam is shut and the only
 *    residue is the peer's own overlay cache.  -> BOUNDED at one TTL window
 *  • Arm A (control, no bridge — the pre-fix shape): the peer's registry is
 *    never healed.                             -> UNBOUNDED past 10 windows
 *  • Negative control: an unrelated datasource is untouched in every arm.
 *
 * ⭐ MEASURED: Arm A came out as predicted. Arm B did NOT, and the direction of
 * the miss is the finding — it is worse than predicted, not better. The first
 * half of the prediction holds: the bridge really does heal the peer's registry
 * within one bus hop, before the clock moves (case 3 below pins it). The second
 * half does not:
 *
 *      A SINGLE READ of the peer's own `/api/v1/meta/datasource` door,
 *      landing while the peer's stale overlay-cache entry is still fresh,
 *      writes the deleted row straight back into the registry the bridge
 *      just healed — and the registry has no TTL.
 *
 * So the prolongation is neither unconditionally bounded nor unconditionally
 * unbounded, and the discriminator is not time but TRAFFIC:
 *
 *      read lands inside the residue window  -> UNBOUNDED  (cases 4, 6)
 *      no read lands inside it               -> BOUNDED, one TTL window (case 5)
 *
 * Both are pinned, side by side and differing in exactly that one step, because
 * either one alone reads as a clean verdict and neither one alone is true.
 *
 * ⚠️ On a replica actually serving `/api/v1/meta/datasource` — the door QA was
 * watching — a read inside a 30s window is the ordinary case, not the unlucky
 * one. The bounded arm is the quiet-replica arm.
 *
 * ---------------------------------------------------------------------------
 * Why the re-hydration happens, precisely
 * ---------------------------------------------------------------------------
 * Nothing on the bridge's receipt path touches the WRITE EPOCH that keys the
 * overlay cache. `applyRemoteMetadataMutation` re-reads the row and repairs the
 * registry; it performs no engine write, and a peer replica does no writing of
 * its own on this path, so the peer's epoch does not move and its pre-delete
 * row set stays "fresh" for the rest of its TTL. `getMetaItems` then does what
 * the cache's own header says it always does, hit or miss — it runs
 * `hydrateOverlayIntoRegistry` over those rows.
 *
 * ⭐ The comparison that makes this a gap rather than a design: the SIBLING
 * bridge for the same substrate does bump it. `authz-invalidation-bridge.ts`
 * calls `epoch.bump('remote')` when it applies a peer hint, and the overlay
 * cache's own header cites that as the reason cross-node convergence "narrows
 * for free" there. The `metadata.mutated` bridge added for #13331 contains no
 * epoch reference at all. So the two cross-node paths over one substrate
 * disagree, and this door sits on the half that does not invalidate.
 *
 * ⛔ NOT FIXED HERE. This card is a measurement carrier and its source surface
 * is read-only, so the reading is reported and the repair is left to a card
 * that can be decided on it.
 *
 * ---------------------------------------------------------------------------
 * Four-seam checklist (the card's own elimination list) — verdicts
 * ---------------------------------------------------------------------------
 *  1. pubsub / bridge not attached ....... RE-MEASURED. Arm A reproduces the
 *     unbounded pre-fix prolongation; the landed publisher + bridge do fan the
 *     DELETE out and do heal the peer's registry. This seam is CLOSED — and it
 *     is not the whole story, see 3.
 *  2. `restoreRuntimeDatasources` re-seeding ... ELIMINATED by PR #13883 —
 *     boot-only, and it reads the already-corrected DB, so it cannot explain a
 *     steady-state cross-replica prolongation without a restart. Cited, not
 *     re-derived (the dispatch forbids re-deriving that finding).
 *  3. list-cache TTL (#5109) ............. ⛔ NOT the bounded residue the ruling
 *     expected. At this door the cache is `meta-overlay-cache`, not
 *     `MetadataManager.listCache` — and it does not merely delay the correct
 *     answer, it FEEDS the untimed registry, converting a 30s residue into an
 *     unbounded one on any read. That conversion is what this file measures.
 *  4. same class as #13578 ............... ELIMINATED by PR #13883 — same
 *     symptom, opposite mechanism (that driver registry had NO eviction door;
 *     this one's door exists and does broadcast). Cited, not re-derived.
 *
 * ⛔ Neither the QA observation nor the source counter-evidence is discarded by
 * this file, and it is written so it cannot be: Arm A and case 4 reproduce the
 * observed cluster-wide prolongation, and case 3 reproduces the counter-
 * evidence that the delete path really does fan out and really does heal. Both
 * readings are true, then and now.
 *
 * ---------------------------------------------------------------------------
 * Reverse verification (ablation), direction predicted BEFORE the run
 * ---------------------------------------------------------------------------
 * Flipping the `attach: true` of the two cases that depend on the bridge — the
 * registry-heal case and the bounded no-read case — to `false`, neutering the
 * bridge in the HARNESS and never in source, which this card may not touch,
 * must turn EXACTLY those two RED (an unhealed registry, and a row still served
 * after the window) while every other case stays GREEN. The already-unbounded
 * cases cannot move, which is the point: they are unbounded with the bridge as
 * well, so an ablation that reddened them would mean the harness, not the
 * bridge, was deciding the outcome. No rebuild leg applies: this test imports the
 * subject as `./protocol.js`, a relative specifier inside its own package that
 * vitest resolves to `src/protocol.ts`, so nothing is served from `dist/`.
 * Measured in the PR body.
 */

import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { assertEngineDeleteDispatch, assertEngineUpdateDispatch, assertEngineFindOnePredicate } from '@objectstack/metadata-core';
import { META_OVERLAY_CACHE_DEFAULT_TTL_MS } from './meta-overlay-cache.js';
import {
    ObjectStackProtocolImplementation,
    METADATA_MUTATION_CLUSTER_CHANNEL,
    type ClusterMetadataMutationPayload,
} from './protocol.js';

/** The residue window this door is bounded by. Imported, never retyped. */
const TTL_MS = META_OVERLAY_CACHE_DEFAULT_TTL_MS;

/** How far past the bound Arm A is chased before it is called unbounded. */
const WINDOWS_PROBED = 10;

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

/** The SHARED database — the one thing every replica of a deployment agrees on. */
function makeSharedStore() {
    return {
        rows: new Map<string, Row>(),
        historyRows: [] as HistoryRow[],
        nextId: { value: 0 },
    };
}

/**
 * A registry that actually STORES what is registered, because the answer under
 * measurement is what `listItems` returns — a call-recording double would make
 * the read door answer `[]` on every replica and the prolongation would be
 * invisible by construction.
 *
 * `removeRuntimeShadow` answers `false` (no packaged artifact underneath) and
 * no `metadata` service is installed, so `restoreArtifactRegistryView`'s tier
 * walk reaches tier 3 — `removeOverlayEntry` — which is the limb that retires a
 * runtime-only row. That is the shape a runtime-authored datasource has: the
 * row WAS the item, with no code-shipped layer under it.
 */
function makeRegistry() {
    const byType = new Map<string, Map<string, any>>();
    const removedEntries: string[] = [];
    const bucket = (type: string) => {
        let m = byType.get(type);
        if (!m) byType.set(type, (m = new Map<string, any>()));
        return m;
    };
    return {
        removedEntries,
        registry: {
            registerItem: (type: string, item: any) => {
                if (item && typeof item === 'object' && typeof item.name === 'string') {
                    bucket(type).set(item.name, item);
                }
            },
            listItems: (type: string) => Array.from(byType.get(type)?.values() ?? []),
            getItem: (type: string, name: string) => byType.get(type)?.get(name),
            removeOverlayEntry: (type: string, name: string) => {
                removedEntries.push(`${type}|${name}`);
                return bucket(type).delete(name);
            },
            removeRuntimeShadow: () => false,
            // The read door filters by package state and merges nav
            // contributions for `app`; neither is under measurement here, so
            // both answer the neutral value rather than being left absent.
            isPackageDisabled: () => false,
            applyNavContributions: (app: unknown) => app,
            registerObject: () => {},
            unregisterObject: () => true,
            removeObjectOverlay: () => {},
            getObject: () => undefined,
            getPackage: () => undefined,
            getArtifactItem: () => undefined,
        },
    };
}

/**
 * One "replica": a stub engine over the SHARED store, with its OWN registry and
 * its OWN write-epoch seam, wrapped by its own protocol instance.
 *
 * ⭐ The write epoch is REQUIRED for this measurement, not decoration. The
 * overlay cache declines outright on an engine that exposes no epoch seam
 * ("only a real engine caches"), so a double without one would make the bounded
 * residue unobservable and Arm B would report a zero-length prolongation that
 * no shipped deployment has. Modelling the seam is what puts the residue on the
 * clock.
 *
 * The kernel is UNSCOPED (`environmentId === undefined`) — the control-plane
 * shape. That is the shape in which `getMetaItems` hydrates overlay rows into
 * the registry, which is how a replica that merely SERVED the datasource comes
 * to hold it locally. That is the QA-observed precondition: all three replicas
 * were serving the entry before the delete.
 */
function makeReplica(store: ReturnType<typeof makeSharedStore>, environmentId?: string) {
    const { rows, historyRows, nextId } = store;
    const { registry, removedEntries } = makeRegistry();

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

    // The write-epoch seam, per replica. Any write advances it; a PEER's write
    // does not — which is the whole reason the overlay cache has a TTL at all.
    const writeEpoch = {
        current: 0,
        bump() { this.current += 1; },
        subscribe: () => () => {},
    };

    const engine: any = {
        writeEpoch,
        async findOne(table: string, opts: { where: Record<string, unknown> }) {
            assertEngineFindOnePredicate(table, opts);
            if (table === 'sys_metadata_history') {
                return historyRows.find((h) => matchesHistory(h, opts.where)) ?? null;
            }
            if (table !== 'sys_metadata') return null;
            return findRow(opts.where)?.row ?? null;
        },
        async find(table: string, opts?: { where?: Record<string, unknown>; limit?: number }) {
            // Honour the caller's bound AFTER the filter, by PRESENCE — the
            // objectql-double-limit contract.
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
            writeEpoch.bump();
            return { id: row.id };
        },
        async update(_t: string, data: Record<string, unknown>, opts: { where: Record<string, unknown> }) {
            assertEngineUpdateDispatch(data, opts);
            const found = findRow(opts.where);
            if (!found) return { id: null };
            const merged = { ...found.row, ...(data as unknown as Row) };
            rows.delete(found.key);
            rows.set(keyOf(merged), merged);
            writeEpoch.bump();
            return { id: found.row.id };
        },
        async delete(_t: string, opts: { where: Record<string, unknown> }) {
            assertEngineDeleteDispatch(opts);
            const found = findRow(opts.where);
            if (!found) return { deleted: 0 };
            rows.delete(found.key);
            writeEpoch.bump();
            return { deleted: 1 };
        },
        async count() { return 0; },
        async transaction<T>(cb: (ctx: unknown, info: { owned: boolean }) => Promise<T>): Promise<T> {
            return cb(undefined, { owned: true });
        },
        async syncObjectSchema() { return true; },
        async dropObjectSchema() { return true; },
        registry,
    };

    const protocol = new ObjectStackProtocolImplementation(
        engine, () => new Map(), environmentId,
    ) as any;

    return { protocol, engine, registry, removedEntries };
}

/**
 * A remote-driver-shaped bus: one transport, every publish delivered to EVERY
 * subscription — the publisher's own node included.
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
    return { bus, published };
}

/** A runtime-authored datasource body — the shape a `PUT /meta/datasource/:name` writes. */
const datasourceBody = (name: string) => ({
    name,
    label: `Datasource ${name}`,
    driver: 'postgres',
    config: { host: 'db.internal', database: name },
});

/**
 * Both replicas over one store, joined (or not) by the bus.
 *
 * `environmentId` selects the KERNEL SHAPE, and it is a variable of this
 * measurement rather than a detail: it is the flag `getMetaItems` and
 * `applyRegistryWriteThrough` both gate registry hydration on, so it decides
 * whether a replica keeps a local registry copy of an overlay row at all —
 * which is precisely the difference between a bounded and an unbounded
 * prolongation. Unscoped (`undefined`) is the control-plane shape.
 */
function makeCluster(opts: { attach: boolean; environmentId?: string }) {
    const store = makeSharedStore();
    const writer = makeReplica(store, opts.environmentId);
    const peer = makeReplica(store, opts.environmentId);
    const { bus, published } = makeBus();
    if (opts.attach) {
        writer.protocol.attachMetadataMutationPubSub(bus, 'node-a');
        peer.protocol.attachMetadataMutationPubSub(bus, 'node-b');
    }
    return { store, writer, peer, bus, published };
}

/**
 * Settle the cluster without moving the clock.
 *
 * The bridge's receipt path (`applyRemoteMetadataMutation`) is async and
 * fire-and-forget — `deleteMetaItem` returns before the peer has converged —
 * but it awaits only PROMISES, never timers. So draining microtasks is the
 * correct and complete settle, and it leaves the fake clock untouched, which
 * matters because the clock is the instrument here.
 *
 * ⭐ Its adequacy is not assumed: the Arm-B convergence case below asserts the
 * peer's registry IS healed after exactly this drain, so an insufficient drain
 * fails loudly there rather than silently inflating a prolongation elsewhere.
 */
async function settle(): Promise<void> {
    for (let i = 0; i < 50; i++) await Promise.resolve();
}

/**
 * What `GET /api/v1/meta/datasource` answers on this replica, by name.
 *
 * Both response shapes are unwrapped, exactly as the REST list route unwraps
 * them: `getMetaItems` is typed `{ type, items[] }` while the implementation
 * may answer the bare array, and the route handles both. Reading only one shape
 * here would make the door's answer look empty and every prolongation below
 * would measure zero.
 */
async function servedNames(replica: { protocol: any }): Promise<string[]> {
    const answer = await replica.protocol.getMetaItems({ type: 'datasource' });
    const items: Array<{ name?: unknown }> = Array.isArray(answer)
        ? answer
        : ((answer as { items?: Array<{ name?: unknown }> })?.items ?? []);
    return items.map((i) => String(i?.name));
}

const serves = async (replica: { protocol: any }, name: string): Promise<boolean> =>
    (await servedNames(replica)).includes(name);

/**
 * ⭐ THE MEASUREMENT. Advance the peer's clock one TTL window at a time and
 * return how long it kept serving `name`, in ms — or `null` for UNBOUNDED,
 * meaning it was still serving the deleted entry after {@link WINDOWS_PROBED}
 * full windows.
 *
 * Returns a DURATION rather than a boolean on purpose: the card's pass/fail is
 * a bound, and "it cleared eventually" is not a reading unless the number is
 * stated.
 */
async function measureProlongationMs(
    replica: { protocol: any },
    name: string,
): Promise<number | null> {
    if (!(await serves(replica, name))) return 0;
    for (let window = 1; window <= WINDOWS_PROBED; window++) {
        vi.setSystemTime(Date.now() + TTL_MS);
        await settle();
        if (!(await serves(replica, name))) return window * TTL_MS;
    }
    return null;
}

/**
 * Bring both replicas to the QA-observed pre-condition: runtime-authored
 * datasources that BOTH replicas are serving on their own read door.
 *
 * Every name is written BEFORE the peer's first read, deliberately. The peer's
 * overlay cache memoises the whole row SET for `datasource`, and the peer's own
 * write epoch never moves (it does no writing), so a name created after the
 * peer has read once is invisible to the peer until that cache lapses. Seeding
 * name-by-name through the peer's door would therefore fail on the second name
 * for a reason that has nothing to do with deletes.
 *
 * The peer's read is what hydrates the rows into the peer's registry on an
 * unscoped kernel — the local copy that later outlives the shared row. Doing it
 * through the door (rather than by reaching into the registry) is the point:
 * this is exactly how a replica that only ever SERVED an entry ends up holding
 * it.
 */
async function seedServedDatasources(
    cluster: ReturnType<typeof makeCluster>,
    names: string[],
): Promise<void> {
    for (const name of names) {
        const res = await cluster.writer.protocol.saveMetaItem({
            type: 'datasource', name, item: datasourceBody(name), mode: 'publish',
        });
        expect(res.success).toBe(true);
    }
    await settle();
    for (const name of names) {
        expect(await serves(cluster.writer, name)).toBe(true);
        expect(await serves(cluster.peer, name)).toBe(true);
    }
}

describe('[#13609] the read door under measurement', () => {
    it('`datasource` takes the EMITTING repository delete exit — the premise this card rests on', async () => {
        const { writer, published } = makeCluster({ attach: true });
        await writer.protocol.saveMetaItem({
            type: 'datasource', name: 'billing_db', item: datasourceBody('billing_db'), mode: 'publish',
        });
        await settle();
        published.length = 0;

        const res = await writer.protocol.deleteMetaItem({ type: 'datasource', name: 'billing_db' });
        expect(res.success).toBe(true);
        await settle();

        // `datasource` is `allowRuntimeCreate: true`, so `deleteMetaItem`'s
        // `useRepoPath` fork takes the REPOSITORY exit — the one that emits. A
        // code-only exit would publish nothing and this card's re-verification
        // would be measuring a channel the delete never uses.
        expect(published).toHaveLength(1);
        expect(published[0].channel).toBe(METADATA_MUTATION_CLUSTER_CHANNEL);
        expect(published[0].payload.event).toEqual({
            type: 'datasource', name: 'billing_db', state: 'deleted', organizationId: null,
        });
    });

    it('the peer serves the row from its OWN registry, so the shared DB alone cannot answer for it', async () => {
        const cluster = makeCluster({ attach: false });
        await seedServedDatasources(cluster, ['billing_db']);

        // The peer never wrote this row; it hydrated it by READING. This is the
        // local, untimed copy whose lifetime the rest of the file measures.
        expect(cluster.peer.registry.listItems('datasource').map((i: any) => i.name))
            .toEqual(['billing_db']);
    });
});

describe('[#13609] ⭐ the re-verification: how long does the peer keep serving a DELETED datasource?', () => {
    beforeEach(() => { vi.useFakeTimers(); });
    afterEach(() => { vi.useRealTimers(); });

    it('Arm B — WITH the landed publisher + bridge, the bridge DOES heal the peer registry', async () => {
        const cluster = makeCluster({ attach: true });
        await seedServedDatasources(cluster, ['billing_db']);

        const res = await cluster.writer.protocol.deleteMetaItem({ type: 'datasource', name: 'billing_db' });
        expect(res.success).toBe(true);
        await settle();

        // ⭐ The #13331 counter-evidence is vindicated, cross-node and on the
        // DELETE direction: the publish crosses, the peer re-reads its own DB,
        // finds no active row, and runs the same heal walk the writer ran. The
        // peer's untimed registry copy is retired within one bus hop, before
        // the clock moves at all.
        //
        // This assertion is also what proves `settle()` is a sufficient drain:
        // an inadequate drain fails HERE, loudly, instead of silently inflating
        // a prolongation in the cases below.
        expect(cluster.peer.registry.listItems('datasource')).toEqual([]);
        expect(cluster.peer.removedEntries).toContain('datasource|billing_db');
    });

    it('⛔ …but the peer’s very next READ re-hydrates the deleted row from its own stale overlay cache', async () => {
        const cluster = makeCluster({ attach: true });
        await seedServedDatasources(cluster, ['billing_db']);

        await cluster.writer.protocol.deleteMetaItem({ type: 'datasource', name: 'billing_db' });
        await settle();
        expect(cluster.peer.registry.listItems('datasource')).toEqual([]);

        // One read of the peer's own door, with the clock untouched.
        expect(await serves(cluster.peer, 'billing_db')).toBe(true);

        // ⭐ THE SEAM. The convergence retired the registry entry but did NOT
        // retire the peer's overlay-cache entry — nothing on the receipt path
        // touches the write epoch that keys it, and the peer does no writing of
        // its own, so the pre-delete row set is still "fresh". `getMetaItems`
        // then does what its cache's own header says it always does, hit or
        // miss: it runs `hydrateOverlayIntoRegistry` over those rows. The
        // deleted row is written straight back into the registry the bridge
        // just cleaned — and the registry has no TTL.
        expect(cluster.peer.registry.listItems('datasource').map((i: any) => i.name))
            .toEqual(['billing_db']);
    });

    it('⛔ Arm B measured, door READ during the residue window: UNBOUNDED, past 10 windows', async () => {
        const cluster = makeCluster({ attach: true });
        await seedServedDatasources(cluster, ['billing_db']);

        await cluster.writer.protocol.deleteMetaItem({ type: 'datasource', name: 'billing_db' });
        await settle();

        // `measureProlongationMs` reads the door once BEFORE advancing the
        // clock — i.e. inside the residue window, which is what a replica under
        // load does continuously. That read converts the bounded cache residue
        // into an unbounded registry entry, so waiting the TTL out no longer
        // helps: once the cache lapses the registry is the only source left,
        // and it is the one now holding the deleted row.
        const prolongation = await measureProlongationMs(cluster.peer, 'billing_db');
        expect(prolongation).toBeNull();
        expect(await serves(cluster.peer, 'billing_db')).toBe(true);
    });

    it('⭐ Arm B measured, door NOT read during the residue window: BOUNDED by one TTL window', async () => {
        const cluster = makeCluster({ attach: true });
        await seedServedDatasources(cluster, ['billing_db']);

        await cluster.writer.protocol.deleteMetaItem({ type: 'datasource', name: 'billing_db' });
        await settle();

        // Identical to the case above in every respect except one: nothing
        // reads the peer's door while its stale cache entry is still fresh, so
        // nothing re-hydrates the registry the bridge just healed. The entry
        // lapses on its own and the peer converges.
        //
        // ⇒ The two cases together are the finding. The prolongation is not
        // unconditionally unbounded and not unconditionally bounded: a SINGLE
        // read of `/api/v1/meta/datasource` inside the residue window is what
        // separates them, and that door under live traffic is read constantly.
        vi.setSystemTime(Date.now() + TTL_MS);
        await settle();
        expect(await serves(cluster.peer, 'billing_db')).toBe(false);
        expect(cluster.peer.registry.listItems('datasource')).toEqual([]);
    });

    it('Arm A — CONTROL, no bridge (the pre-fix shape): UNBOUNDED, still served past 10 windows', async () => {
        const cluster = makeCluster({ attach: false });
        await seedServedDatasources(cluster, ['billing_db']);

        const res = await cluster.writer.protocol.deleteMetaItem({ type: 'datasource', name: 'billing_db' });
        expect(res.success).toBe(true);
        await settle();

        // The writer's own door is correct immediately — the asymmetry QA saw.
        expect(await serves(cluster.writer, 'billing_db')).toBe(false);

        // The peer's registry was never healed: no transport carried the signal.
        expect(cluster.peer.registry.listItems('datasource').map((i: any) => i.name))
            .toEqual(['billing_db']);

        // ⭐ The firing positive control. It proves the probe CAN see a
        // prolongation and CAN see it end — the bounded case below returns a
        // number on the same instrument — so the two unbounded readings above
        // are measurements, not an instrument that never clears anything.
        const prolongation = await measureProlongationMs(cluster.peer, 'billing_db');
        expect(prolongation).toBeNull();
    });

    it('⭐ SCOPED kernel: the same delete IS bounded — at exactly one overlay-cache TTL window', async () => {
        const cluster = makeCluster({ attach: true, environmentId: 'env_prod' });
        await seedServedDatasources(cluster, ['billing_db']);

        // On a scoped kernel BOTH hydration seams are gated off — the read-side
        // loop and the write-through alike — so no replica ever holds a local
        // registry copy of an overlay row, and the only local source is the
        // overlay cache, which does expire.
        expect(cluster.peer.registry.listItems('datasource')).toEqual([]);

        const res = await cluster.writer.protocol.deleteMetaItem({ type: 'datasource', name: 'billing_db' });
        expect(res.success).toBe(true);
        await settle();

        // ⭐ The bound, stated as a number: one window, and the constant is
        // imported rather than retyped so this tracks whatever ships.
        const prolongation = await measureProlongationMs(cluster.peer, 'billing_db');
        expect(prolongation).toBe(TTL_MS);
        expect(TTL_MS).toBe(30_000);

        // This is the residue the ruling permits ("listCache TTL is the one
        // bounded residue that may legitimately remain") — refined to the cache
        // that actually holds it at this door.
        expect(await serves(cluster.peer, 'billing_db')).toBe(false);
    });

    it('negative control — an unrelated datasource is untouched, in every arm', async () => {
        for (const shape of [
            { attach: true, environmentId: undefined },
            { attach: false, environmentId: undefined },
            { attach: true, environmentId: 'env_prod' },
        ]) {
            const cluster = makeCluster(shape);
            await seedServedDatasources(cluster, ['billing_db', 'analytics_db']);

            await cluster.writer.protocol.deleteMetaItem({ type: 'datasource', name: 'billing_db' });
            await settle();
            vi.setSystemTime(Date.now() + TTL_MS * (WINDOWS_PROBED + 1));
            await settle();

            // The delete reached exactly one name on the peer, in every shape —
            // so the prolongations measured above are about the deleted row and
            // not about a peer that has stopped answering.
            expect(await serves(cluster.peer, 'analytics_db')).toBe(true);
            // No read landed inside the residue window here (the clock jumps
            // straight past it), so the bridged shapes converge and only the
            // unbridged one prolongs — the same discriminator as above, seen
            // from the other side.
            expect(await serves(cluster.peer, 'billing_db')).toBe(!shape.attach);
        }
    });
});
