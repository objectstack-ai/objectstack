// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#21207] Exit two — the `/meta` doors serve a stored content hash only in
 * KEYED form, and compare an inbound version token in that same form.
 *
 * The stored content hash of a metadata body stays the canonical, unkeyed hash
 * at rest (the repository's invariant is untouched). Every door that SERVES it
 * — the save, publish and rollback receipts, the history read, and the 409
 * conflict refusal — serves the crypto provider's keyed digest of it instead,
 * so a caller holding the projected body cannot recompute it and confirm a guess
 * about withheld credential material offline. Every door that takes a version
 * token back (the save door's and the reset door's optimistic lock) compares it
 * in keyed form against the current stored value and hands the STORED value to
 * the repository. With no provider registered the key is a process-scoped
 * ephemeral one: tokens are still served, so the optimistic lock never fails
 * open on an empty token.
 *
 * Pinned per door, as an administrator would read it:
 *  - the served value is neither the stored hash nor a recomputation from the
 *    served body; two reads agree; a change to the body moves it;
 *  - the keyed token is accepted inbound, the raw stored hash is refused with
 *    the ADR-0112 envelope (`METADATA_CONFLICT` / 409);
 *  - the refusal's text and attributes carry the keyed value or none, and the
 *    decision-audit note it writes carries no hash at all;
 *  - no provider: tokens keyed under the process key, never empty; an empty,
 *    withheld, raw or stale token is refused on every door.
 *
 * The engine is an in-memory double of the stored tables with the repository's
 * own read and write shapes (the `protocol.lifecycle-audit-rows.test.ts` double,
 * plus the engine's `getKeyedDigest` accessor), so the stored values compared
 * against are the ones the real repository writes.
 *
 * [#21978] The last two blocks pin the same doors on a stored row with NO
 * `checksum`: it is saved, deleted and published over through the version its
 * read serves, a stale version is still refused, a `null` parent still matches
 * it, the write stamps it, and a row WITH a `checksum` is judged as before.
 */

import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
    assertEngineDeleteDispatch,
    assertEngineFindOnePredicate,
    assertEngineUpdateDispatch,
    ConflictError,
    hashSpec,
} from '@objectstack/metadata-core';
import { ObjectStackProtocolImplementation } from './protocol.js';
import { SysMetadataRepository } from './sys-metadata-repository.js';

const TEST_KEY = 'served-content-hash-test-key';
/** A keyed digest with the provider contract's output shape, under a key this file holds. */
const keyedDigest = async (plain: string): Promise<string> =>
    `hmac-sha256:${createHmac('sha256', TEST_KEY).update(plain, 'utf8').digest('hex')}`;

/** An unkeyed content hash — the keyed form's `hmac-sha256:` prefix is not one. */
const SHA256 = /(?<!hmac-)sha256:[0-9a-f]{64}/;
const KEYED = /^hmac-sha256:[0-9a-f]{64}$/;

interface Row {
    id: string;
    type: string;
    name: string;
    organization_id: string | null;
    package_id: string | null;
    state: string;
    metadata: string;
    checksum?: string;
    [k: string]: unknown;
}

function keyOf(w: Record<string, unknown>) {
    return `${w.type}|${w.name}|${w.organization_id ?? '__env__'}|${w.state ?? 'active'}|${w.package_id ?? '__nopkg__'}`;
}

function matchesWhere(r: Record<string, unknown>, where: Record<string, unknown> = {}): boolean {
    for (const [k, v] of Object.entries(where)) {
        if (k === '$or') {
            if (!(v as Array<Record<string, unknown>>).some((c) => matchesWhere(r, c))) return false;
            continue;
        }
        // Any other combinator is REFUSED, never read as a field name.
        if (k.startsWith('$')) throw new Error(`stub engine: combinator '${k}' is not implemented`);
        if (v === undefined) continue;
        if (r[k] !== v) return false;
    }
    return true;
}

function makeEngine(opts: { provider?: boolean } = {}) {
    const rows = new Map<string, Row>();
    const historyRows: Array<Record<string, unknown>> = [];
    const auditRows: Array<Record<string, unknown>> = [];
    let nextId = 0;
    const findRow = (w: Record<string, unknown>): { key: string; row: Row } | null => {
        if (w.id !== undefined) {
            for (const [k, r] of rows) if (r.id === w.id) return { key: k, row: r };
            return null;
        }
        if (w.package_id !== undefined) {
            const k = keyOf(w);
            const r = rows.get(k);
            return r ? { key: k, row: r } : null;
        }
        for (const [k, r] of rows) if (matchesWhere(r, w)) return { key: k, row: r };
        return null;
    };
    const engine: any = {
        async findOne(table: string, o: { where: Record<string, unknown> }) {
            assertEngineFindOnePredicate(table, o);
            if (table === 'sys_metadata_history') return historyRows.find((h) => matchesWhere(h, o.where)) ?? null;
            return findRow(o.where)?.row ?? null;
        },
        async find(table: string, o: { where?: Record<string, unknown>; limit?: number } = {}) {
            const matched = table === 'sys_metadata_audit'
                ? auditRows.filter((a) => matchesWhere(a, o.where))
                : table === 'sys_metadata_history'
                    ? historyRows.filter((h) => matchesWhere(h, o.where))
                    : Array.from(rows.values()).filter((r) => matchesWhere(r, o.where));
            // The caller's bound, applied after the filter, by presence.
            return typeof o?.limit === 'number' ? matched.slice(0, o.limit) : matched;
        },
        async insert(table: string, data: Record<string, unknown>) {
            nextId += 1;
            if (table === 'sys_metadata_audit') {
                auditRows.push({ id: `a_${nextId}`, ...data });
                return { id: `a_${nextId}` };
            }
            if (table === 'sys_metadata_history') {
                historyRows.push({ id: `h_${nextId}`, ...data });
                return { id: `h_${nextId}` };
            }
            const row = { id: `r_${nextId}`, ...data } as Row;
            rows.set(keyOf(data), row);
            return { id: row.id };
        },
        async update(_t: string, data: Record<string, unknown>, o: { where: Record<string, unknown> }) {
            assertEngineUpdateDispatch(data, o);
            const found = findRow(o.where);
            if (!found) return { id: null };
            const merged = { ...found.row, ...data } as Row;
            rows.delete(found.key);
            rows.set(keyOf(merged), merged);
            return { id: found.row.id };
        },
        async delete(_t: string, o: { where: Record<string, unknown> }) {
            assertEngineDeleteDispatch(o);
            const found = findRow(o.where);
            if (!found) return { deleted: 0 };
            rows.delete(found.key);
            return { deleted: 1 };
        },
        async transaction<T>(cb: (ctx: any, info: { owned: boolean }) => Promise<T>): Promise<T> {
            return cb(undefined, { owned: true });
        },
        registry: { registerItem: () => {}, registerObject: () => {}, getPackage: () => undefined },
    };
    if (opts.provider !== false) engine.getKeyedDigest = () => keyedDigest;
    return { engine, rows, historyRows, auditRows };
}

const viewBody = (label: string) => ({
    name: 'case_grid',
    type: 'grid',
    label,
    columns: ['id', 'title'],
    object: 'case',
    viewKind: 'list',
});
const ORG = 'org_alpha';
const ref = { type: 'view', name: 'case_grid', organizationId: ORG, actor: 'admin' } as const;

/** Every stored content hash the double holds, active rows and history alike. */
function storedHashes(h: ReturnType<typeof makeEngine>): Set<string> {
    const out = new Set<string>();
    for (const r of h.rows.values()) if (typeof r.checksum === 'string') out.add(r.checksum);
    for (const r of h.historyRows) {
        if (typeof r.checksum === 'string') out.add(r.checksum);
        if (typeof r.previous_checksum === 'string') out.add(r.previous_checksum);
    }
    return out;
}

function activeHash(h: ReturnType<typeof makeEngine>): string {
    const row = [...h.rows.values()].find((r) => r.name === 'case_grid' && r.state === 'active');
    return String(row?.checksum);
}

async function rejection(run: () => Promise<unknown>): Promise<any> {
    let caught: any;
    let resolved = false;
    try {
        await run();
        resolved = true;
    } catch (e) {
        caught = e;
    }
    expect(resolved, 'expected a refusal, but the call resolved').toBe(false);
    return caught;
}

/** No stored hash, in either the message or any attribute of a refusal. */
function expectNoStoredHash(value: unknown, stored: Set<string>): void {
    const text = typeof value === 'string' ? value : JSON.stringify({
        ...(value as object),
        message: (value as { message?: string })?.message,
    });
    for (const s of stored) expect(text).not.toContain(s);
    expect(text).not.toMatch(SHA256);
}

describe('[#21207] /meta receipts serve the keyed form of the stored content hash', () => {
    it('save receipt: keyed, not the stored hash, not a recomputation; stable; moves on change', async () => {
        const h = makeEngine();
        const p = new ObjectStackProtocolImplementation(h.engine);

        const first: any = await p.saveMetaItem({ ...ref, item: viewBody('v1') } as any);
        const stored1 = activeHash(h);
        expect(first.version).toMatch(KEYED);
        expect(first.version).not.toBe(stored1);
        expect(first.version).not.toBe(hashSpec(viewBody('v1')));
        expect(first.version).toBe(await keyedDigest(stored1));

        // An identical re-save writes nothing and serves the same value.
        const again: any = await p.saveMetaItem({ ...ref, item: viewBody('v1'), parentVersion: first.version } as any);
        expect(again.version).toBe(first.version);

        const changed: any = await p.saveMetaItem({ ...ref, item: viewBody('v2'), parentVersion: first.version } as any);
        expect(changed.version).toMatch(KEYED);
        expect(changed.version).not.toBe(first.version);
        expect(changed.version).not.toBe(activeHash(h));
    });

    it('publish and rollback receipts: keyed, never the stored hash', async () => {
        const h = makeEngine();
        const p = new ObjectStackProtocolImplementation(h.engine);

        await p.saveMetaItem({ ...ref, item: viewBody('v1') } as any);
        await p.saveMetaItem({ ...ref, item: viewBody('staged'), mode: 'draft' } as any);
        const published: any = await p.publishMetaItem({ ...ref } as any);
        expect(published.version).toMatch(KEYED);
        expect(published.version).toBe(await keyedDigest(activeHash(h)));
        expect(storedHashes(h).has(published.version)).toBe(false);

        const rolled: any = await p.rollbackMetaItem({ ...ref, toVersion: 1 } as any);
        expect(rolled.version).toMatch(KEYED);
        expect(rolled.version).toBe(await keyedDigest(activeHash(h)));
        expect(storedHashes(h).has(rolled.version)).toBe(false);
    });
});

describe('[#21207] the history read serves keyed hashes per event', () => {
    it('every event hash and parent hash is keyed, none is stored, and two reads agree', async () => {
        const h = makeEngine();
        const p = new ObjectStackProtocolImplementation(h.engine);
        const v1: any = await p.saveMetaItem({ ...ref, item: viewBody('v1') } as any);
        await p.saveMetaItem({ ...ref, item: viewBody('v2'), parentVersion: v1.version } as any);

        const read1 = await p.historyMetaItem({ type: 'view', name: 'case_grid', organizationId: ORG });
        const read2 = await p.historyMetaItem({ type: 'view', name: 'case_grid', organizationId: ORG });
        expect(read1.events.length).toBeGreaterThanOrEqual(2);
        for (const ev of read1.events) {
            expect(ev.hash).toMatch(KEYED);
            if (ev.parentHash !== null) expect(ev.parentHash).toMatch(KEYED);
        }
        expect(read1.events.some((ev) => ev.parentHash !== null)).toBe(true);
        expectNoStoredHash(JSON.stringify(read1), storedHashes(h));
        expect(JSON.stringify(read2)).toBe(JSON.stringify(read1));
        // The head event's keyed hash IS the token the save receipt served.
        expect(read1.events.map((e) => e.hash)).toContain(v1.version);
    });
});

describe('[#21207] inbound version tokens are compared in keyed form', () => {
    it('save door: the served token is accepted, the raw stored hash is refused (METADATA_CONFLICT / 409)', async () => {
        const h = makeEngine();
        const p = new ObjectStackProtocolImplementation(h.engine);
        const v1: any = await p.saveMetaItem({ ...ref, item: viewBody('v1') } as any);
        const raw = activeHash(h);

        const refused = await rejection(() =>
            p.saveMetaItem({ ...ref, item: viewBody('raw'), parentVersion: raw } as any));
        expect(refused.code).toBe('METADATA_CONFLICT');
        expect(refused.status).toBe(409);
        expect(activeHash(h)).toBe(raw);

        const accepted: any = await p.saveMetaItem({ ...ref, item: viewBody('keyed'), parentVersion: v1.version } as any);
        expect(accepted.success).toBe(true);
        expect(activeHash(h)).not.toBe(raw);
    });

    it('save door: a stale keyed token is refused, and the refusal carries the keyed value or none', async () => {
        const h = makeEngine();
        const p = new ObjectStackProtocolImplementation(h.engine);
        const v1: any = await p.saveMetaItem({ ...ref, item: viewBody('v1') } as any);
        const v2: any = await p.saveMetaItem({ ...ref, item: viewBody('v2'), parentVersion: v1.version } as any);

        const stale = await rejection(() =>
            p.saveMetaItem({ ...ref, item: viewBody('lost'), parentVersion: v1.version } as any));
        expect(stale.code).toBe('METADATA_CONFLICT');
        expect(stale.status).toBe(409);
        expectNoStoredHash(stale, storedHashes(h));
        for (const attr of [stale.expectedParent, stale.actualHead]) {
            if (attr !== undefined && attr !== null) expect(attr).toMatch(KEYED);
        }
        expect(stale.actualHead).toBe(v2.version);
    });

    it('the decision-audit note of a refused write names no hash, stored or keyed', async () => {
        const h = makeEngine();
        const p = new ObjectStackProtocolImplementation(h.engine);
        const v1: any = await p.saveMetaItem({ ...ref, item: viewBody('v1') } as any);
        await p.saveMetaItem({ ...ref, item: viewBody('v2'), parentVersion: v1.version } as any);
        await rejection(() => p.saveMetaItem({ ...ref, item: viewBody('lost'), parentVersion: v1.version } as any));

        const denials = h.auditRows.filter((a) => a.code === 'metadata_conflict'); // adr0112-ok: D6b persisted audit column
        expect(denials).toHaveLength(1);
        const note = String(denials[0]!.note);
        expect(note).not.toMatch(SHA256);
        expect(note).not.toMatch(/hmac-sha256:/);
        expectNoStoredHash(note, storedHashes(h));
    });

    it('reset door: the served token is accepted, the raw stored hash is refused', async () => {
        const h = makeEngine();
        const p = new ObjectStackProtocolImplementation(h.engine);
        const v1: any = await p.saveMetaItem({ ...ref, item: viewBody('v1') } as any);

        const refused = await rejection(() =>
            p.deleteMetaItem({ ...ref, parentVersion: activeHash(h) } as any));
        expect(refused.code).toBe('METADATA_CONFLICT');
        expect(refused.status).toBe(409);
        expectNoStoredHash(refused, storedHashes(h));

        const reset: any = await p.deleteMetaItem({ ...ref, parentVersion: v1.version } as any);
        expect(reset.success).toBe(true);
    });
});

describe('[#21207] no crypto provider: tokens keyed under a process-scoped ephemeral key', () => {
    it('receipts and history serve a keyed token: never empty, never stored, distinct per content, stable', async () => {
        const h = makeEngine({ provider: false });
        const p = new ObjectStackProtocolImplementation(h.engine);
        const v1: any = await p.saveMetaItem({ ...ref, item: viewBody('v1') } as any);
        const stored1 = activeHash(h);
        expect(v1.version).toMatch(KEYED);
        expect(v1.version).not.toBe(stored1);
        expect(v1.version).not.toBe(hashSpec(viewBody('v1')));
        // Not this file's test key either: the key is the process's own.
        expect(v1.version).not.toBe(await keyedDigest(stored1));

        const v2: any = await p.saveMetaItem({ ...ref, item: viewBody('v2'), parentVersion: v1.version } as any);
        expect(v2.version).toMatch(KEYED);
        expect(v2.version).not.toBe(v1.version);

        const read1 = await p.historyMetaItem({ type: 'view', name: 'case_grid', organizationId: ORG });
        const read2 = await p.historyMetaItem({ type: 'view', name: 'case_grid', organizationId: ORG });
        expect(read1.events.length).toBeGreaterThanOrEqual(2);
        for (const ev of read1.events) expect(ev.hash).toMatch(KEYED);
        expect(read1.events.map((e) => e.hash)).toContain(v2.version);
        expect(JSON.stringify(read2)).toBe(JSON.stringify(read1));
        expectNoStoredHash(JSON.stringify({ v1, v2, read1 }), storedHashes(h));
    });

    it('the served token is accepted on both doors; a stale, raw, empty or withheld token is refused (METADATA_CONFLICT / 409)', async () => {
        const h = makeEngine({ provider: false });
        const p = new ObjectStackProtocolImplementation(h.engine);
        const v1: any = await p.saveMetaItem({ ...ref, item: viewBody('v1') } as any);
        const v2: any = await p.saveMetaItem({ ...ref, item: viewBody('v2'), parentVersion: v1.version } as any);
        expect(v2.success).toBe(true);
        const raw = activeHash(h);

        for (const token of [v1.version, raw, '', '(withheld)']) {
            for (const run of [
                () => p.saveMetaItem({ ...ref, item: viewBody('lost'), parentVersion: token } as any),
                () => p.deleteMetaItem({ ...ref, parentVersion: token } as any),
            ]) {
                const refused = await rejection(run);
                expect(refused.code).toBe('METADATA_CONFLICT');
                expect(refused.status).toBe(409);
                expectNoStoredHash(refused, storedHashes(h));
            }
        }
        expect(activeHash(h)).toBe(raw);

        const reset: any = await p.deleteMetaItem({ ...ref, parentVersion: v2.version } as any);
        expect(reset.success).toBe(true);
    });

    it('one key per process: a second protocol answers the first one\'s token', async () => {
        const h = makeEngine({ provider: false });
        const first = new ObjectStackProtocolImplementation(h.engine);
        const second = new ObjectStackProtocolImplementation(h.engine);
        const v1: any = await first.saveMetaItem({ ...ref, item: viewBody('v1') } as any);
        const v2: any = await second.saveMetaItem({ ...ref, item: viewBody('v2'), parentVersion: v1.version } as any);
        expect(v2.success).toBe(true);
    });

    it('a provider registered later moves the tokens: the held token is refused once, the next served one is accepted', async () => {
        const h = makeEngine({ provider: false });
        const p = new ObjectStackProtocolImplementation(h.engine);
        const before: any = await p.saveMetaItem({ ...ref, item: viewBody('v1') } as any);

        h.engine.getKeyedDigest = () => keyedDigest;
        const refused = await rejection(() =>
            p.saveMetaItem({ ...ref, item: viewBody('v2'), parentVersion: before.version } as any));
        expect(refused.code).toBe('METADATA_CONFLICT');
        expect(refused.status).toBe(409);

        const { events } = await p.historyMetaItem({ type: 'view', name: 'case_grid', organizationId: ORG });
        const current = events.find((e) => e.hash === refused.actualHead);
        expect(refused.actualHead).toBe(await keyedDigest(activeHash(h)));
        expect(current).toBeDefined();
        const after: any = await p.saveMetaItem({ ...ref, item: viewBody('v2'), parentVersion: refused.actualHead } as any);
        expect(after.success).toBe(true);
        expect(after.version).toBe(await keyedDigest(activeHash(h)));
    });
});

describe('[#21207] a sent token is never read as no pin', () => {
    it('an empty or withheld token is refused on both doors with a provider registered (METADATA_CONFLICT / 409)', async () => {
        const h = makeEngine();
        const p = new ObjectStackProtocolImplementation(h.engine);
        await p.saveMetaItem({ ...ref, item: viewBody('v1') } as any);
        const raw = activeHash(h);
        for (const token of ['', '(withheld)']) {
            for (const run of [
                () => p.saveMetaItem({ ...ref, item: viewBody('lost'), parentVersion: token } as any),
                () => p.deleteMetaItem({ ...ref, parentVersion: token } as any),
            ]) {
                const refused = await rejection(run);
                expect(refused.code).toBe('METADATA_CONFLICT');
                expect(refused.status).toBe(409);
            }
        }
        expect(activeHash(h)).toBe(raw);
    });
});

describe('[#21207] a change note that quotes a stored hash', () => {
    it('the publish door writes a note that quotes no hash', async () => {
        const h = makeEngine();
        const p = new ObjectStackProtocolImplementation(h.engine);
        await p.saveMetaItem({ ...ref, item: viewBody('staged'), mode: 'draft' } as any);
        await p.publishMetaItem({ ...ref } as any);
        const notes = h.historyRows.map((r) => r.change_note).filter((n) => typeof n === 'string') as string[];
        expect(notes.length).toBeGreaterThan(0);
        for (const note of notes) expect(note).not.toMatch(SHA256);
    });

    it('the history read serves a stored note\'s quoted hash keyed, under the provider\'s key or the process key', async () => {
        for (const provider of [true, false]) {
            const h = makeEngine({ provider });
            const p = new ObjectStackProtocolImplementation(h.engine);
            const saved: any = await p.saveMetaItem({ ...ref, item: viewBody('v1') } as any);
            const stored = activeHash(h);
            // A row written before the publish door stated its own message.
            for (const row of h.historyRows) row.change_note = `publish draft (hash ${stored})`;

            const { events } = await p.historyMetaItem({ type: 'view', name: 'case_grid', organizationId: ORG });
            expect(events.length).toBeGreaterThan(0);
            for (const ev of events) {
                // The quote is served as the very token the receipt served.
                expect(ev.message).toBe(`publish draft (hash ${saved.version})`);
                if (provider) expect(saved.version).toBe(await keyedDigest(stored));
            }
            expectNoStoredHash(JSON.stringify(events), storedHashes(h));
        }
    });
});

// ---------------------------------------------------------------------------
// [#21978] A stored row with no `checksum`
// ---------------------------------------------------------------------------
//
// The datasource admin door stored its rows with no `checksum` before it
// stamped them, and such rows stay at rest (no backfill). The repository serves
// a row like that as the hash of its stored body; its `put` / `delete` used to
// judge the caller's parent against the raw column (`null`) instead, so every
// save and delete of such a row through the metadata door answered 409 — the
// unpinned (last-write-wins) ones included, since the door takes the parent
// from the same read. The lock is type-agnostic, so this file's `view` row
// stands in for the datasource one.

const VIEW_REF = { type: 'view', name: 'case_grid', org: ORG } as const;

/** Store the active row the way a writer that stamps no `checksum` did. */
async function seedUnstamped(h: ReturnType<typeof makeEngine>, label = 'legacy', state = 'active'): Promise<void> {
    await h.engine.insert('sys_metadata', {
        type: 'view',
        name: 'case_grid',
        organization_id: ORG,
        package_id: null,
        state,
        metadata: JSON.stringify(viewBody(label)),
        version: 1,
    });
}

function caseGridRow(h: ReturnType<typeof makeEngine>, state = 'active'): Row | undefined {
    return [...h.rows.values()].find((r) => r.name === 'case_grid' && r.state === state);
}

function repoFor(h: ReturnType<typeof makeEngine>): SysMetadataRepository {
    return new SysMetadataRepository({ engine: h.engine, organizationId: ORG, orgLabel: ORG });
}

/** The version the repository's own read serves for the row, keyed as a door hands it out. */
async function servedToken(h: ReturnType<typeof makeEngine>): Promise<string> {
    const item = await repoFor(h).get(VIEW_REF as any);
    expect(item).not.toBeNull();
    return keyedDigest(item!.hash);
}

describe('[#21978] a stored row with no checksum is written through the version its read serves', () => {
    it('save door: the served version is accepted as the parent, and the write stamps the row', async () => {
        const h = makeEngine();
        const p = new ObjectStackProtocolImplementation(h.engine);
        await seedUnstamped(h);
        expect(caseGridRow(h)?.checksum).toBeUndefined();

        const token = await servedToken(h);
        // The read serves the hash of the stored body, as `put` would stamp it.
        expect(token).toBe(await keyedDigest(hashSpec(viewBody('legacy'), 'view')));

        const saved: any = await p.saveMetaItem({ ...ref, item: viewBody('edited'), parentVersion: token } as any);
        expect(saved.success).toBe(true);
        expect(JSON.parse(caseGridRow(h)!.metadata).label).toBe('edited');
        // The write stamped the row: it now carries the checksum of its new body.
        expect(caseGridRow(h)!.checksum).toBe(hashSpec(viewBody('edited'), 'view'));
        expect(saved.version).toBe(await keyedDigest(caseGridRow(h)!.checksum!));
    });

    it('reset door: the served version is accepted as the parent, and the row is removed', async () => {
        const h = makeEngine();
        const p = new ObjectStackProtocolImplementation(h.engine);
        await seedUnstamped(h);

        const reset: any = await p.deleteMetaItem({ ...ref, parentVersion: await servedToken(h) } as any);
        expect(reset.success).toBe(true);
        expect(caseGridRow(h)).toBeUndefined();
    });

    it('unpinned save and delete (last-write-wins) succeed; an identical re-save stamps the row too', async () => {
        const saveSide = makeEngine();
        const p = new ObjectStackProtocolImplementation(saveSide.engine);
        await seedUnstamped(saveSide);
        const saved: any = await p.saveMetaItem({ ...ref, item: viewBody('legacy') } as any);
        expect(saved.success).toBe(true);
        expect(caseGridRow(saveSide)!.checksum).toBe(hashSpec(viewBody('legacy'), 'view'));

        const deleteSide = makeEngine();
        const q = new ObjectStackProtocolImplementation(deleteSide.engine);
        await seedUnstamped(deleteSide);
        const reset: any = await q.deleteMetaItem({ ...ref } as any);
        expect(reset.success).toBe(true);
        expect(caseGridRow(deleteSide)).toBeUndefined();
    });

    it('a stale version is still refused (METADATA_CONFLICT / 409), the refusal names the served version, and that version is then accepted', async () => {
        const h = makeEngine();
        const p = new ObjectStackProtocolImplementation(h.engine);
        await seedUnstamped(h);
        const served = await servedToken(h);

        const staleTokens = [
            await keyedDigest(hashSpec(viewBody('someone else'), 'view')),
            // The served hash in stored (unkeyed) form stays refused at the door.
            hashSpec(viewBody('legacy'), 'view'),
        ];
        let saveRefusal: any;
        for (const token of staleTokens) {
            for (const [door, run] of [
                ['save', () => p.saveMetaItem({ ...ref, item: viewBody('lost'), parentVersion: token } as any)],
                ['delete', () => p.deleteMetaItem({ ...ref, parentVersion: token } as any)],
            ] as const) {
                const refused = await rejection(run);
                expect(refused.code, `${door} with ${token}`).toBe('METADATA_CONFLICT');
                expect(refused.status, `${door} with ${token}`).toBe(409);
                expect(refused.actualHead, `${door} with ${token}`).toBe(served);
                if (door === 'save') saveRefusal = refused;
            }
        }
        // Nothing was written: the row is the one stored, still unstamped.
        expect(JSON.parse(caseGridRow(h)!.metadata).label).toBe('legacy');
        expect(caseGridRow(h)!.checksum).toBeUndefined();

        const after: any = await p.saveMetaItem({ ...ref, item: viewBody('edited'), parentVersion: saveRefusal.actualHead } as any);
        expect(after.success).toBe(true);
        expect(caseGridRow(h)!.checksum).toBe(hashSpec(viewBody('edited'), 'view'));
    });

    it('a writer passing null for such a row still succeeds (the stored-row migration hands the raw column on)', async () => {
        const h = makeEngine();
        const p = new ObjectStackProtocolImplementation(h.engine);
        await seedUnstamped(h);

        // `migrateStoredMetadata`'s in-process spelling: `row.checksum ?? null`.
        const saved: any = await p.saveMetaItem({
            ...ref,
            item: viewBody('migrated'),
            storedParentVersion: caseGridRow(h)!.checksum ?? null,
        } as any);
        expect(saved.success).toBe(true);
        expect(caseGridRow(h)!.checksum).toBe(hashSpec(viewBody('migrated'), 'view'));
    });

    it('publish over such a row: the promotion takes the active row\'s served version as its parent', async () => {
        const h = makeEngine();
        const p = new ObjectStackProtocolImplementation(h.engine);
        await seedUnstamped(h);
        await p.saveMetaItem({ ...ref, item: viewBody('staged'), mode: 'draft' } as any);

        const published: any = await p.publishMetaItem({ ...ref } as any);
        expect(published.version).toBe(await keyedDigest(hashSpec(viewBody('staged'), 'view')));
        expect(JSON.parse(caseGridRow(h)!.metadata).label).toBe('staged');
        expect(caseGridRow(h)!.checksum).toBe(hashSpec(viewBody('staged'), 'view'));
        expect(caseGridRow(h, 'draft')).toBeUndefined();
    });

    it('the post-promotion drain removes a draft row stored with no checksum', async () => {
        const h = makeEngine();
        const p = new ObjectStackProtocolImplementation(h.engine);
        await seedUnstamped(h, 'staged', 'draft');

        await p.publishMetaItem({ ...ref } as any);
        expect(JSON.parse(caseGridRow(h)!.metadata).label).toBe('staged');
        // The drain deletes by the draft's served version; judged against the raw
        // column it read as the benign "newer draft saved" race and survived.
        expect(caseGridRow(h, 'draft')).toBeUndefined();
    });
});

describe('[#21978] the repository lock: a row with a checksum is judged exactly as before', () => {
    it('its stamp is its head: the hash of its body and a null parent are refused when the stamp differs', async () => {
        const h = makeEngine();
        const repo = repoFor(h);
        // A stamp that is not the hash of the bytes beside it (a row stamped
        // before its type's canonical form changed): the stamp, not the body,
        // is the version that row is served as.
        const stamp = hashSpec(viewBody('stamped earlier'), 'view');
        await h.engine.insert('sys_metadata', {
            type: 'view',
            name: 'case_grid',
            organization_id: ORG,
            package_id: null,
            state: 'active',
            metadata: JSON.stringify(viewBody('stamped')),
            checksum: stamp,
        });
        expect((await repo.get(VIEW_REF as any))!.hash).toBe(stamp);

        for (const parent of [hashSpec(viewBody('stamped'), 'view'), null]) {
            const refused = await rejection(() =>
                repo.put(VIEW_REF as any, viewBody('next'), { parentVersion: parent, actor: null }));
            expect(refused).toBeInstanceOf(ConflictError);
            expect(refused.code).toBe('METADATA_CONFLICT');
            expect(refused.actualHead).toBe(stamp);
        }
        const refusedDelete = await rejection(() =>
            repo.delete(VIEW_REF as any, { parentVersion: hashSpec(viewBody('stamped'), 'view'), actor: null }));
        expect(refusedDelete).toBeInstanceOf(ConflictError);
        expect(refusedDelete.actualHead).toBe(stamp);
        expect(caseGridRow(h)!.checksum).toBe(stamp);

        const written = await repo.put(VIEW_REF as any, viewBody('next'), { parentVersion: stamp, actor: null });
        expect(written.version).toBe(hashSpec(viewBody('next'), 'view'));
    });

    it('a row with no checksum: null and its served version are accepted, anything else is refused with the served version as head', async () => {
        const h = makeEngine();
        const repo = repoFor(h);
        await seedUnstamped(h);
        const served = hashSpec(viewBody('legacy'), 'view');

        const refused = await rejection(() =>
            repo.put(VIEW_REF as any, viewBody('next'), { parentVersion: hashSpec(viewBody('other'), 'view'), actor: null }));
        expect(refused).toBeInstanceOf(ConflictError);
        expect(refused.code).toBe('METADATA_CONFLICT');
        expect(refused.actualHead).toBe(served);

        const viaNull = await repo.put(VIEW_REF as any, viewBody('legacy'), { parentVersion: null, actor: null });
        // An identical body still writes: the row had no stamp, and now has one.
        expect(viaNull.version).toBe(served);
        expect(caseGridRow(h)!.checksum).toBe(served);
        expect(h.historyRows).toHaveLength(1);

        const again = makeEngine();
        await seedUnstamped(again);
        const removed = await repoFor(again).delete(VIEW_REF as any, { parentVersion: served, actor: null });
        expect(removed).toBeDefined();
        expect(caseGridRow(again)).toBeUndefined();
    });
});
