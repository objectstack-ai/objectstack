// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#32451, ADR-0150 D4; epic ruling 6819919065] Two replicas converge to the
 * same per-package answer for a type the metadata service stores per
 * `(package, name)`, because the cluster signal names the row's package.
 *
 * Two `ObjectStackProtocolImplementation` replicas over ONE shared
 * `sys_metadata` store, each with its OWN real `SchemaRegistry` (the registry
 * decides what each exact address serves, so a double cannot stand in for it)
 * and its own `MetadataManager`, joined on the real `metadata.mutated` lane by
 * a bus that delivers every publish to every subscriber. Packages alpha and
 * beta are installed as authored on both. Every write goes through replica A's
 * doors, naming its package; after every step replica B must serve what A
 * serves at alpha's exact address, at beta's, and at the bare read.
 *
 * Measured at #32447's head `45f80780`, before the signal carried the package
 * (step 0 of the card): B re-read the first row the store returned, so after
 * A saved beta's row B still served alpha's at every address (steps 2, 3 and
 * 5 below diverged), and a removal converged only because B re-registered
 * whichever row was left.
 *
 * The protocol's own pins (absent versus `null`, the unstamped signal, the
 * resync ledger) live in `@objectstack/metadata-protocol`'s
 * `protocol.cluster-mutation-fanout.test.ts`.
 */
import './__fixtures__/lint-root-preload.testkit.js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ObjectStackProtocolImplementation, METADATA_MUTATION_CLUSTER_CHANNEL } from '@objectstack/metadata-protocol';
import { MetadataManager } from '@objectstack/metadata';
import { assertEngineDeleteDispatch, assertEngineFindOnePredicate, assertEngineUpdateDispatch } from '@objectstack/metadata-core';
import { SchemaRegistry } from './registry.js';

const ALPHA = 'com.acme.alpha';
const BETA = 'com.acme.beta';
const NAME = 'digest';
const manifest = (id: string) => ({ id, name: id, version: '1.0.0', type: 'app', namespace: id.split('.').pop()! }) as never;

type Row = Record<string, unknown>;

/** Every publish to every subscription, the publisher's own included. */
function makeBus() {
    const subs: Array<{ channel: string; handler: (msg: unknown) => void }> = [];
    const events: Array<Record<string, unknown>> = [];
    const bus = {
        async publish(channel: string, payload: unknown) {
            events.push((payload as { event: Record<string, unknown> }).event);
            for (const s of [...subs]) if (s.channel === channel) s.handler({ channel, payload, publishedAt: Date.now() });
        },
        subscribe(channel: string, handler: (msg: never) => void) {
            const sub = { channel, handler: handler as (msg: unknown) => void };
            subs.push(sub);
            return () => { const i = subs.indexOf(sub); if (i >= 0) subs.splice(i, 1); };
        },
        async close() {},
    };
    return { bus, events };
}

/**
 * One replica: its own registry and service over the shared rows. The engine
 * double reads equality and `$in` only; any other operator or combinator is
 * refused loudly rather than read as a field.
 */
function makeReplica(rows: Row[], type: string) {
    const registry = new SchemaRegistry({ multiTenant: false });
    for (const id of [ALPHA, BETA]) registry.installPackage(manifest(id), 'authored');
    const manager = new MetadataManager({ formats: ['json'], loaders: [] });
    const matches = (row: Row, where: Record<string, unknown> | undefined) =>
        Object.entries(where ?? {}).every(([k, v]) => {
            if (k.startsWith('$')) throw new Error(`engine double: logical operator ${k} is not implemented`);
            if (v !== null && typeof v === 'object') {
                const ops = Object.keys(v);
                if (ops.length !== 1 || ops[0] !== '$in' || !Array.isArray((v as { $in?: unknown }).$in)) {
                    throw new Error(`engine double: operator ${ops.join(', ')} is not implemented`);
                }
                return (v as { $in: unknown[] }).$in.includes(row[k] ?? null);
            }
            return (row[k] ?? null) === v;
        });
    const pick = (table: string, opts?: { where?: Record<string, unknown>; limit?: number }) => {
        if (table !== 'sys_metadata') return [];
        const hits = rows.filter((r) => matches(r, opts?.where));
        return typeof opts?.limit === 'number' ? hits.slice(0, opts.limit) : hits;
    };
    let inserted = 0;
    const engine: Record<string, unknown> = {
        registry,
        async find(table: string, opts?: { where?: Record<string, unknown>; limit?: number }) { return pick(table, opts); },
        async findOne(table: string, opts?: { where?: Record<string, unknown> }) {
            assertEngineFindOnePredicate(table, opts as never);
            return pick(table, opts)[0] ?? null;
        },
        async insert(table: string, data: Row) {
            if (table !== 'sys_metadata') return { id: 'side_effect_skip' };
            inserted += 1;
            const row = { ...data, id: `${type}_${String(data.package_id)}_${String(data.bundle_member ?? '')}_${inserted}` };
            rows.push(row);
            return { id: row.id };
        },
        async update(table: string, data: Row, options?: Record<string, unknown>) {
            assertEngineUpdateDispatch(data, options);
            if (table !== 'sys_metadata') return { id: null };
            const hit = rows.find((r) => r.id === (options as { where?: { id?: unknown } })?.where?.id);
            if (!hit) return { id: null };
            Object.assign(hit, data);
            return { id: hit.id };
        },
        async delete(_t: string, options?: Record<string, unknown>) {
            assertEngineDeleteDispatch(options);
            const at = rows.findIndex((r) => r.id === (options as { where?: { id?: unknown } })?.where?.id);
            if (at >= 0) rows.splice(at, 1);
            return { deleted: at >= 0 ? 1 : 0 };
        },
        async count(table: string, opts?: { where?: Record<string, unknown> }) { return pick(table, opts).length; },
        async transaction(fn: (ctx: unknown, info: unknown) => Promise<unknown>) { return fn(undefined, { owned: true }); },
        async execute() { return {}; },
        async syncObjectSchema() { return true; },
    };
    // A control-plane kernel, whose registry takes stored rows.
    const protocol = new ObjectStackProtocolImplementation(
        engine as never, () => new Map<string, unknown>([['metadata', manager]]) as never, undefined,
    ) as any;
    const label = (item: unknown) => (item as { label?: string } | undefined)?.label ?? null;
    /** `[alpha, beta, bare]`: what this replica serves at each address. */
    const serves = (member?: string) => [
        label(registry.getPackageScopedItem(type, NAME, ALPHA, member)),
        label(registry.getPackageScopedItem(type, NAME, BETA, member)),
        label(registry.getItem(type, NAME, undefined, member)),
    ];
    return { protocol, serves };
}

function makeCluster(type: string) {
    const rows: Row[] = [];
    const { bus, events } = makeBus();
    const a = makeReplica(rows, type);
    const b = makeReplica(rows, type);
    a.protocol.attachMetadataMutationPubSub(bus, 'node-a');
    b.protocol.attachMetadataMutationPubSub(bus, 'node-b');
    return { rows, bus, events, a, b };
}

const settle = () => new Promise((r) => setTimeout(r, 0));

const bodyOf = (type: string, label: string, extra: Record<string, unknown> = {}) => (type === 'action'
    ? { name: NAME, label, type: 'script', target: `${label}_impl`, ...extra }
    : type === 'email_template'
        ? { name: NAME, label, subject: `${label} subject`, bodyHtml: `${label} body`, ...extra }
        : { name: NAME, label, widgets: [], ...extra });

async function save(c: ReturnType<typeof makeCluster>, type: string, packageId: string, label: string, extra?: Record<string, unknown>) {
    const res = await c.a.protocol.saveMetaItem({ type, name: NAME, packageId, item: bodyOf(type, label, extra) });
    expect(res.success).toBe(true);
    await settle();
}

async function remove(c: ReturnType<typeof makeCluster>, type: string, packageId: string) {
    const res = await c.a.protocol.deleteMetaItem({ type, name: NAME, packageId });
    expect(res.success).toBe(true);
    await settle();
}

afterEach(() => { vi.restoreAllMocks(); });

describe('[#32451] two replicas converge to the same per-package answer for a slotted type (ADR-0150 D4)', () => {
    it.each([['action'], ['email_template']])('%s: after every one of the six measured steps, B serves what A serves at alpha\'s address, at beta\'s and at the bare read', async (type) => {
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        const c = makeCluster(type);
        const step = async (label: string, write: () => Promise<void>) => {
            await write();
            expect({ step: label, b: c.b.serves() }).toEqual({ step: label, b: c.a.serves() });
        };

        await step('1 save alpha-1', () => save(c, type, ALPHA, 'alpha-1'));
        await step('2 save beta-1', () => save(c, type, BETA, 'beta-1'));
        await step('3 save beta-2', () => save(c, type, BETA, 'beta-2'));
        await step('4 remove alpha', () => remove(c, type, ALPHA));
        await step('5 save alpha-3', () => save(c, type, ALPHA, 'alpha-3'));
        await step('6 remove beta', () => remove(c, type, BETA));

        // The step-2 answer the peer used to get wrong, by value: A serves
        // beta's row, and so does B (at 45f80780 B served alpha-1 here).
        expect(c.events.filter((e) => e.state === 'active').map((e) => e.packageId)).toEqual([ALPHA, BETA, BETA, ALPHA]);
        expect(c.events.filter((e) => e.state === 'deleted').map((e) => e.packageId)).toEqual([ALPHA, BETA]);
    });

    it('email_template: a member of one package\'s template converges at that member\'s address, beside the other package\'s template', async () => {
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        const c = makeCluster('email_template');
        await save(c, 'email_template', ALPHA, 'alpha-1');
        await save(c, 'email_template', BETA, 'beta-1');

        await save(c, 'email_template', ALPHA, 'alpha-zh', { locale: 'zh-CN' });

        expect(c.events[c.events.length - 1]).toMatchObject({ member: 'zh-CN', packageId: ALPHA });
        expect(c.b.serves('zh-CN')).toEqual(c.a.serves('zh-CN'));
        expect(c.b.serves()).toEqual(c.a.serves());
        expect(c.b.serves('zh-CN')[0]).toBe('alpha-zh');
    });

    describe('CONTROLS', () => {
        it('a name one package holds converges as before, stamped and unstamped', async () => {
            vi.spyOn(console, 'warn').mockImplementation(() => {});
            const c = makeCluster('action');
            await save(c, 'action', ALPHA, 'alpha-1');
            expect(c.b.serves()).toEqual(c.a.serves());
            expect(c.b.serves()).toEqual(['alpha-1', null, 'alpha-1']);

            // An unstamped hint from a replica that predates the field, after a
            // write whose own hint was lost: the one stored binding converges.
            c.rows[0].metadata = JSON.stringify(bodyOf('action', 'alpha-2'));
            c.rows[0].checksum = 'sha256:alpha-2';
            await c.bus.publish(METADATA_MUTATION_CLUSTER_CHANNEL, {
                originNode: 'node-c',
                event: { type: 'action', name: NAME, state: 'active', organizationId: null },
            });
            await settle();
            expect(c.b.serves()).toEqual(['alpha-2', null, 'alpha-2']);
        });

        it('`dashboard`, a type converged by name, is unchanged: the peer still re-reads the name (the two-row residual the ruling carries to its own card)', async () => {
            vi.spyOn(console, 'warn').mockImplementation(() => {});
            const c = makeCluster('dashboard');
            await save(c, 'dashboard', ALPHA, 'alpha-1');
            expect(c.b.serves()).toEqual(c.a.serves());

            await save(c, 'dashboard', BETA, 'beta-1');

            // The signal is stamped for every type…
            expect(c.events[c.events.length - 1]).toMatchObject({ packageId: BETA });
            // …and a by-name type is read by name, as at 45f80780: the first
            // stored row (alpha's), not the row the writer wrote.
            expect(c.a.serves()[2]).toBe('beta-1');
            expect(c.b.serves()[2]).toBe('alpha-1');
        });
    });
});
