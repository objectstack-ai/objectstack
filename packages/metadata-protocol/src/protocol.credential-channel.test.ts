// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#20790] The metadata protocol's half of a type's WRITE-ONLY credential
 * channel (`registerCredentialChannel`, beside the authoring gate): every
 * write that lands a body at rest consults it, so a credential never reaches
 * the stored row, its history, or the row's content hash.
 *
 *  - **the save door** stores what the channel's `store` returns, after the
 *    carry-forward and immediately before the put — and a channel refusal (no
 *    crypto provider) throws before anything is written;
 *  - **the runtime gate**, on an active save and on the draft → active
 *    promotion, reads the channel's held positions as present, so a withheld
 *    credential the channel keeps is not refused as missing;
 *  - **a restore (R2)** stores the channel's strip of the history body: a
 *    rollback past the move never puts a credential back at rest, never
 *    appends a history copy of one, and never writes the channel.
 *
 * The channel here is a stand-in for the automation plugin's (whose own
 * behaviour is pinned in `@objectstack/service-automation`), holding the start
 * node's `secret` only. The repository is the real `SysMetadataRepository`
 * over a fake engine that keeps both the stored rows and the history rows.
 *
 * Every value is a probe sentinel, not a credential.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import {
    assertEngineDeleteDispatch,
    assertEngineFindOnePredicate,
    assertEngineUpdateDispatch,
} from '@objectstack/metadata-core';
import { registerMetadataTypeRedactor } from '@objectstack/spec/kernel';

import { ObjectStackProtocolImplementation, type MetadataCredentialChannel } from './protocol.js';

const V1 = 'pin-protocol-secret-v1-3f1a';
const V2 = 'pin-protocol-secret-v2-b07c';
const DRAFT = 'pin-protocol-secret-draft-77e2';

type Row = Record<string, unknown>;

/** Exact-equality WHERE matching; an operator this stand-in does not implement is refused, never read as a field. */
function matchesWhere(row: Row, where: Record<string, unknown> = {}): boolean {
    return Object.entries(where).every(([k, v]) => {
        if (k.startsWith('$')) throw new Error(`fake engine: unsupported operator ${k}`);
        return v === undefined || row[k] === v;
    });
}

/** Rows AND history rows, exact-equality predicates, the producer's own write-verb dispatch. */
function makeEngine() {
    const rows: Row[] = [];
    const historyRows: Row[] = [];
    /** Every other table: reads find nothing, as the stand-in has none. */
    const others: Row[] = [];
    let next = 1;
    const tableOf = (t: string) => (t === 'sys_metadata_history' ? historyRows : t === 'sys_metadata' ? rows : null);
    const matches = matchesWhere;
    const engine: any = {
        async find(t: string, opts: { where?: Record<string, unknown>; limit?: number } = {}) {
            const table = t === 'sys_metadata_history' ? historyRows : t === 'sys_metadata' ? rows : others;
            const hits = table.filter((r) => matchesWhere(r, opts.where));
            return typeof opts?.limit === 'number' ? hits.slice(0, opts.limit) : hits;
        },
        async findOne(t: string, opts: { where: Record<string, unknown> }) {
            assertEngineFindOnePredicate(t, opts);
            return (tableOf(t) ?? []).find((r) => matches(r, opts.where)) ?? null;
        },
        async insert(t: string, data: Row) {
            const table = tableOf(t);
            const id = (data.id as string | undefined) ?? `r_${next++}`;
            table?.push({ ...data, id });
            return { id };
        },
        async update(t: string, data: Row, opts: { where: Record<string, unknown> }) {
            assertEngineUpdateDispatch(data, opts);
            const row = (tableOf(t) ?? []).find((r) => matches(r, opts.where));
            if (row) Object.assign(row, data);
            return { id: row?.id ?? null };
        },
        async delete(t: string, opts: { where: Record<string, unknown> }) {
            assertEngineDeleteDispatch(opts);
            const table = tableOf(t);
            const idx = table ? table.findIndex((r) => matches(r, opts.where)) : -1;
            if (table && idx >= 0) table.splice(idx, 1);
            return { deleted: idx >= 0 ? 1 : 0 };
        },
        async transaction<T>(cb: (ctx: unknown, info: { owned: boolean }) => Promise<T>): Promise<T> {
            return cb(undefined, { owned: true });
        },
        async syncObjectSchema() {},
        registry: {
            listItems: () => [],
            isPackageDisabled: () => false,
            getItem: () => undefined,
            registerItem: () => {},
            registerObject: () => {},
            getPackage: () => undefined,
        },
    };
    return { engine, rows, historyRows };
}

/** The start node's `secret` is the one credential position this stand-in table knows. */
const startIndex = (body: any) => (Array.isArray(body?.nodes) ? body.nodes.findIndex((n: any) => n?.type === 'start') : -1);

function withoutSecret(body: any): any {
    const i = startIndex(body);
    if (i < 0 || !body.nodes[i].config || !('secret' in body.nodes[i].config) || body.nodes[i].config.secret === '') return body;
    const nodes = body.nodes.slice();
    const { secret: _s, ...config } = nodes[i].config;
    void _s;
    nodes[i] = { ...nodes[i], config };
    return { ...body, nodes };
}

/** A stand-in for the automation plugin's channel: `${name}|${state}` → secret. */
function makeChannel(opts: { refuse?: boolean } = {}) {
    const held = new Map<string, string>();
    const calls: string[] = [];
    const channel: MetadataCredentialChannel = {
        async store({ name, state, body }) {
            calls.push(`store:${state}`);
            const i = startIndex(body);
            const secret = i >= 0 ? (body as any).nodes[i].config?.secret : undefined;
            if (typeof secret === 'string' && secret !== '') {
                if (opts.refuse) {
                    throw Object.assign(new Error('no crypto provider'), { code: 'SERVICE_UNAVAILABLE', status: 503 });
                }
                held.set(`${name}|${state}`, secret);
            }
            return withoutSecret(body);
        },
        async heldPaths({ name, state, item }) {
            calls.push(`heldPaths:${state}`);
            const i = startIndex(item);
            if (i < 0 || (item as any).nodes[i].config?.secret !== undefined) return [];
            const has = held.has(`${name}|active`) || (state === 'draft' && held.has(`${name}|draft`));
            return has ? [`nodes.${i}.config.secret`] : [];
        },
        strip(body) {
            calls.push('strip');
            return withoutSecret(body);
        },
    };
    return { channel, held, calls };
}

/** The read projection the automation plugin registers for `flow`, start-node half. */
function registerStandInRedactor(): void {
    registerMetadataTypeRedactor('flow', (item) => {
        const out = withoutSecret(item);
        const i = startIndex(item);
        return { item: out, redactedKeys: out === item ? [] : [`nodes.${i}.config.secret`] };
    });
}

function inbound(secret?: string, label = 'Inbound') {
    return {
        name: 'channel_intake',
        label,
        type: 'api',
        status: 'active',
        nodes: [
            { id: 'begin', type: 'start', label: 'Start', config: { hookId: 'h1', ...(secret !== undefined ? { secret } : {}) } },
            { id: 'finish', type: 'end', label: 'End' },
        ],
        edges: [{ id: 'e1', source: 'begin', target: 'finish' }],
    };
}

const bodiesOf = (table: Row[]) => table.filter((r) => r.name === 'channel_intake').map((r) => String(r.metadata));

describe('[#20790] the save door stores the body the credential channel returns', () => {
    beforeEach(registerStandInRedactor);

    it('the stored row, its history row and its hash carry no credential; the channel holds it', async () => {
        const { engine, rows, historyRows } = makeEngine();
        const protocol = new ObjectStackProtocolImplementation(engine);
        const { channel, held } = makeChannel();
        protocol.registerCredentialChannel('flows', channel);

        await protocol.saveMetaItem({ type: 'flow', name: 'channel_intake', item: inbound(V1) });

        expect(held.get('channel_intake|active')).toBe(V1);
        expect(bodiesOf(rows)).toHaveLength(1);
        for (const body of [...bodiesOf(rows), ...bodiesOf(historyRows)]) expect(body).not.toContain(V1);
        // The hash is over the stored body, so it is no verifier of the secret either.
        const stored = rows.find((r) => r.name === 'channel_intake')!;
        expect(String(stored.checksum ?? '')).not.toBe('');
    });

    it('an active save in the WITHHELD form passes the runtime gate on the channel\'s held position', async () => {
        const { engine } = makeEngine();
        const protocol = new ObjectStackProtocolImplementation(engine);
        const { channel, held, calls } = makeChannel();
        protocol.registerCredentialChannel('flow', channel);
        await protocol.saveMetaItem({ type: 'flow', name: 'channel_intake', item: inbound(V1) });

        // The served form round-trips: no secret in the body, none refused.
        await expect(
            protocol.saveMetaItem({ type: 'flow', name: 'channel_intake', item: inbound(undefined, 'Edited') }),
        ).resolves.toMatchObject({ success: true });
        expect(calls).toContain('heldPaths:active');
        expect(held.get('channel_intake|active')).toBe(V1);
    });

    it('a channel refusal (no crypto provider) refuses the save before anything is written', async () => {
        const { engine, rows, historyRows } = makeEngine();
        const protocol = new ObjectStackProtocolImplementation(engine);
        protocol.registerCredentialChannel('flow', makeChannel({ refuse: true }).channel);

        const refusal = await protocol
            .saveMetaItem({ type: 'flow', name: 'channel_intake', item: inbound(V1) })
            .then(() => undefined, (e: any) => e);
        expect(refusal?.code).toBe('SERVICE_UNAVAILABLE');
        expect(refusal?.status).toBe(503);
        expect(bodiesOf(rows)).toEqual([]);
        expect(bodiesOf(historyRows)).toEqual([]);
    });
});

describe('[#20790] the draft → active promotion reads the channel\'s held positions', () => {
    beforeEach(registerStandInRedactor);

    it('publishing a draft whose secret the channel holds is not refused as missing', async () => {
        const { engine, rows } = makeEngine();
        const protocol = new ObjectStackProtocolImplementation(engine);
        const { channel, held, calls } = makeChannel();
        protocol.registerCredentialChannel('flow', channel);

        await protocol.saveMetaItem({ type: 'flow', name: 'channel_intake', item: inbound(V1) });
        await protocol.saveMetaItem({ type: 'flow', name: 'channel_intake', item: inbound(DRAFT, 'Drafted'), mode: 'draft' });
        expect(held.get('channel_intake|draft')).toBe(DRAFT);
        // The live row is untouched by the draft save.
        expect(held.get('channel_intake|active')).toBe(V1);

        await expect(protocol.publishMetaItem({ type: 'flow', name: 'channel_intake' })).resolves.toMatchObject({ success: true });
        expect(calls).toContain('heldPaths:draft');
        for (const body of bodiesOf(rows)) expect(body).not.toContain(DRAFT);
    });
});

describe('[#20790] R2 — a rollback past the move keeps the channel\'s current secret and stores none', () => {
    beforeEach(registerStandInRedactor);

    it('restores version 1 (written before the move, with the literal) without putting it back at rest', async () => {
        const { engine, rows, historyRows } = makeEngine();
        const protocol = new ObjectStackProtocolImplementation(engine);

        // v1 — stored the way every flow was before the channel existed.
        await protocol.saveMetaItem({ type: 'flow', name: 'channel_intake', item: inbound(V1) });
        expect(bodiesOf(historyRows).join()).toContain(V1);

        // The channel arrives; v2 moves the secret (rotated) out of the body.
        const { channel, held, calls } = makeChannel();
        protocol.registerCredentialChannel('flow', channel);
        await protocol.saveMetaItem({ type: 'flow', name: 'channel_intake', item: inbound(V2, 'Moved') });
        expect(held.get('channel_intake|active')).toBe(V2);
        const historyBefore = historyRows.length;
        calls.length = 0;

        const result: any = await protocol.rollbackMetaItem({ type: 'flow', name: 'channel_intake', toVersion: 1 });
        expect(result?.success ?? true).toBe(true);

        // The restored row is version 1's body WITHOUT its credential …
        const stored = JSON.parse(String(rows.find((r) => r.name === 'channel_intake')!.metadata));
        expect(stored.label).toBe('Inbound');
        expect(JSON.stringify(stored)).not.toContain(V1);
        // … the history row the restore appended carries none …
        expect(historyRows.length).toBe(historyBefore + 1);
        expect(String(historyRows[historyRows.length - 1]!.metadata)).not.toContain(V1);
        // … the version written before the move keeps what it recorded (append-only, Q1 B) …
        expect(String(historyRows[0]!.metadata)).toContain(V1);
        // … and the channel keeps its current secret: a restore only strips.
        expect(calls).toEqual(['strip']);
        expect(held.get('channel_intake|active')).toBe(V2);
    });
});
