// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#8375] The write path takes back exactly what the converged read added
 * (#4326) — the multi-tenant `indexes` half.
 *
 * `packages/rest/src/meta-object-materialization-agreement.test.ts` pins the
 * READ: `GET /meta/object/:name` now serves the tenant-scope index the registry
 * stamps, so an object answered from the `metadata` service or a `sys_metadata`
 * overlay row no longer reports that a walled deployment has no index on its
 * hottest predicate. That convergence writes a real, authorable key onto bodies
 * that did not have one, and the write path persists a request body VERBATIM by
 * design (ADR-0005 §Validation) — so without a strip counterpart the ordinary
 * Studio GET → edit → PUT bakes a platform-computed index into
 * `sys_metadata.metadata`, into its checksum, and into every history diff.
 *
 * ## Why this file exists rather than one more case in the `nameField` pin
 *
 * `indexes` is the first CONCATENATING key to cross this seam, and that changes
 * the shape of the risk rather than repeating it. `nameField` is a scalar and
 * `fields` is keyed by name, so a re-added stamp overwrites its predecessor and
 * the worst case is a wrong value. A list under `mergeObjectDefinitions`
 * accumulates: a strip that is not exactness-bounded leaves the entry in the
 * stored row, and every actor that concatenates over that row — the extender
 * fold, an overlay merge — is then working from a base that already contains
 * what it is about to contribute.
 *
 * So the measurement that matters here is not "does one round trip come back
 * clean" but "does the list stay the same length across TWO of them, with the
 * stored row unchanged". A strip that never fires and a strip that is bounded
 * are indistinguishable on a single cycle read only at the served document —
 * both serve one entry. They differ in the ROW, immediately, and in the list
 * length as soon as anything concatenates.
 *
 * ## The boundary
 *
 * The strip removes the LAST entry identical to the platform's own and keeps the
 * removal only when re-stamping the remainder reproduces the arriving list
 * byte-for-byte (see `stripProvisionedTenantIndexFrom`). The cases below are the
 * four that boundary has to separate, and each is a real authoring shape: a
 * named entry, an author's own tenant index sitting before their others, the
 * same entry on a SINGLE-TENANT deployment where the seam would add nothing at
 * all, and an object that opts out of tenancy entirely.
 *
 * Lives in this package for the reason its two siblings do: the claim is about
 * the REAL `SchemaRegistry` and the REAL protocol write agreeing, and only this
 * package has both — `@objectstack/objectql` depends on
 * `@objectstack/metadata-protocol`, never the reverse.
 */

import { describe, it, expect } from 'vitest';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
// [#5619] The producer's OWN write-verb dispatch decisions, so the fake engine
// below cannot accept a call ObjectQL refuses.
import { assertEngineDeleteDispatch, assertEngineUpdateDispatch } from '@objectstack/metadata-core';
import { SchemaRegistry } from './registry.js';

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

/** The platform's own entry — the exact value the seam appends. */
const PLATFORM_TENANT_INDEX = { fields: ['organization_id'] };

/** A plain business object: one authored field, no indexes of its own. */
const AUTHORED = {
    name: 'crm_lead',
    label: 'Lead',
    fields: {
        name: { name: 'name', label: 'Name', type: 'text' },
        code_label: { name: 'code_label', label: 'Code label', type: 'text' },
    },
};

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

function matches(r: Row, where: Record<string, unknown>): boolean {
    for (const [k, v] of Object.entries(where)) {
        if (v === undefined) continue;
        if ((r as any)[k] !== v) return false;
    }
    return true;
}

function keyOf(w: Record<string, unknown>) {
    return `${w.type}|${w.name}|${w.organization_id ?? '__env__'}|${w.state ?? 'active'}|${w.package_id ?? '__nopkg__'}`;
}

/** A `sys_metadata` store over a REAL {@link SchemaRegistry}. */
function makeHost(multiTenant: boolean) {
    // Companions OFF: this file is about the tenant index, and leaving the other
    // stamps' deployment gate out keeps a failure here unambiguous about which
    // half moved. The title designation still travels — it is not gated.
    const registry = new SchemaRegistry({ multiTenant, searchCompanion: false } as never);
    const rows = new Map<string, Row>();
    let nextId = 0;
    const findRow = (w: Record<string, unknown>) => {
        for (const [k, r] of rows) if (matches(r, w)) return { key: k, row: r };
        return null;
    };
    const engine: any = {
        registry,
        async findOne(_t: string, o: { where: Record<string, unknown> }) {
            return findRow(o.where)?.row ?? null;
        },
        async find(_t: string, o: { where: Record<string, unknown> }) {
            return Array.from(rows.values()).filter((r) => matches(r, o.where));
        },
        async insert(table: string, data: Record<string, unknown>) {
            if (table !== 'sys_metadata') return { id: 'side_table' };
            const row = { id: `r_${++nextId}`, ...(data as any) } as Row;
            rows.set(keyOf(data), row);
            return { id: row.id };
        },
        async update(table: string, data: Record<string, unknown>, o: { where: Record<string, unknown> }) {
            assertEngineUpdateDispatch(data, o);
            if (table !== 'sys_metadata') return { id: null };
            const found = findRow(o.where);
            if (!found) return { id: null };
            const merged = { ...found.row, ...(data as any) };
            rows.delete(found.key);
            rows.set(keyOf(merged), merged);
            return { id: found.row.id };
        },
        async delete(_t: string, o?: Record<string, unknown>) {
            assertEngineDeleteDispatch(o);
            return { deleted: 0 };
        },
        async transaction<T>(cb: (c: any, i: { owned: boolean }) => Promise<T>): Promise<T> {
            return cb(undefined, { owned: true });
        },
        async syncObjectSchema() { /* no DDL in this stub */ },
        async count() { return 0; },
        async aggregate() { return []; },
    };
    const protocol = new ObjectStackProtocolImplementation(engine as never, () => new Map() as never);
    const row = () => Array.from(rows.values()).find((r) => r.name === AUTHORED.name);
    const storedBody = () => {
        const r = row();
        return r ? (JSON.parse(r.metadata) as Record<string, any>) : undefined;
    };
    return { protocol, rows, registry, storedBody, row };
}

async function seed(multiTenant: boolean, item: Record<string, unknown> = clone(AUTHORED)) {
    const host = makeHost(multiTenant);
    await host.protocol.saveMetaItem({ type: 'object', name: AUTHORED.name, item } as never);
    return host;
}

/** The served document, as a client actually holds it. */
async function served(host: { protocol: ObjectStackProtocolImplementation }) {
    return (await host.protocol.getMetaItem({
        type: 'object', name: AUTHORED.name,
    } as never)).item as any;
}

describe('[#8375] the write path takes back the tenant index the read added (#4326)', () => {
    it('GET → PUT → GET → PUT: the list does not grow, and the row never carries the stamp', async () => {
        // The anti-vacuity arm of this file. One cycle cannot separate a strip
        // that is exactness-bounded from one that never fires — both SERVE a
        // single entry. Two cycles plus the stored row can.
        const host = await seed(true);
        const firstStored = host.storedBody()!;
        // Precondition: the author's own row never carried an index at all.
        expect(firstStored.indexes).toBeUndefined();

        for (const cycle of [1, 2]) {
            const item = await served(host);
            // The read really does add it — non-vacuous on every cycle, not
            // only the first.
            expect(item.indexes, `cycle ${cycle} served`).toEqual([PLATFORM_TENANT_INDEX]);
            // …and adds exactly ONE, however many times we have been round.
            expect(item.indexes.length, `cycle ${cycle} length`).toBe(1);

            await host.protocol.saveMetaItem({
                type: 'object', name: AUTHORED.name, item,
            } as never);

            // The row is where duplication would accumulate, and it is the
            // assertion a served-document check cannot make for you.
            expect(host.storedBody()!.indexes, `cycle ${cycle} stored`).toBeUndefined();
            expect(host.storedBody(), `cycle ${cycle} body`).toEqual(firstStored);
        }
    });

    it('a round-trip with NO edit leaves the stored body and its checksum identical', async () => {
        const host = await seed(true);
        const firstStored = host.storedBody()!;
        const firstChecksum = host.row()!.checksum;

        await host.protocol.saveMetaItem({
            type: 'object', name: AUTHORED.name, item: await served(host),
        } as never);

        expect(host.storedBody()).toEqual(firstStored);
        // The checksum is the half a byte-identity assertion can still miss —
        // it is what history diffs and change detection read.
        expect(host.row()!.checksum).toBe(firstChecksum);
    });

    it('an EDIT round-trip stores the edit and nothing else', async () => {
        const host = await seed(true);
        const firstStored = host.storedBody()!;

        const item = await served(host);
        await host.protocol.saveMetaItem({
            type: 'object', name: AUTHORED.name, item: { ...item, label: 'Lead (edited)' },
        } as never);

        const stored = host.storedBody()!;
        expect(stored.label).toBe('Lead (edited)');
        expect(stored.indexes).toBeUndefined();
        // Everything except the edited key is byte-identical to the first save.
        expect({ ...stored, label: firstStored.label }).toEqual(firstStored);
    });

    // ── The boundary that makes the strip safe ──────────────────────────────

    it('KEEPS an author’s NAMED tenant index — never a candidate for the strip', async () => {
        // A named entry is not the value the seam appends, so the seam leaves it
        // alone on the way out (`declaresTenantIndex` already covers the single
        // organization_id column, named or not) and the strip never considers
        // it on the way in.
        const authored = { ...clone(AUTHORED), indexes: [{ name: 'my_tenant_idx', fields: ['organization_id'] }] };
        const host = await seed(true, authored);
        expect(host.storedBody()!.indexes).toEqual(authored.indexes);

        const item = await served(host);
        // The read adds nothing: the object already declares a tenant index.
        expect(item.indexes).toEqual(authored.indexes);

        await host.protocol.saveMetaItem({ type: 'object', name: AUTHORED.name, item } as never);
        expect(host.storedBody()!.indexes).toEqual(authored.indexes);
    });

    it('KEEPS an author’s own tenant index declared BEFORE their other indexes', async () => {
        // The ORDER case, and the reason the strip compares whole lists rather
        // than asking "is there a matching entry". The author's tenant index is
        // byte-identical to the platform's, but it is not where the seam APPENDS
        // — so re-stamping the remainder produces a different list and the
        // removal is refused.
        const authored = {
            ...clone(AUTHORED),
            indexes: [{ fields: ['organization_id'] }, { fields: ['code_label'] }],
        };
        const host = await seed(true, authored);
        expect(host.storedBody()!.indexes).toEqual(authored.indexes);

        const item = await served(host);
        expect(item.indexes).toEqual(authored.indexes);

        await host.protocol.saveMetaItem({ type: 'object', name: AUTHORED.name, item } as never);
        expect(host.storedBody()!.indexes).toEqual(authored.indexes);
    });

    it('KEEPS the identical entry on a SINGLE-TENANT deployment — the seam adds nothing there', async () => {
        // The control that separates "bounded" from "removes anything that
        // looks like the platform's entry". These are the same BYTES as the
        // stamp; what differs is that on this deployment the seam would never
        // have produced them, so re-stamping cannot reproduce the list.
        const authored = { ...clone(AUTHORED), indexes: [{ fields: ['organization_id'] }] };
        const host = await seed(false, authored);
        expect(host.storedBody()!.indexes).toEqual(authored.indexes);

        const item = await served(host);
        // …and the read adds no second copy either.
        expect(item.indexes).toEqual(authored.indexes);

        await host.protocol.saveMetaItem({ type: 'object', name: AUTHORED.name, item } as never);
        expect(host.storedBody()!.indexes).toEqual(authored.indexes);
    });

    it('adds and strips NOTHING on an object that opts out of the tenant column', async () => {
        // The stamp is gated on the spec's own derivation, not on the
        // deployment flag alone: `systemFields.tenant: false` withholds the
        // index exactly as it withholds the column, on a multi-tenant host.
        const opted = { ...clone(AUTHORED), systemFields: { tenant: false } };
        const host = await seed(true, opted);
        const firstStored = host.storedBody()!;
        expect(firstStored.indexes).toBeUndefined();

        const item = await served(host);
        expect(item.indexes).toBeUndefined();
        expect(Object.keys(item.fields)).not.toContain('organization_id');

        await host.protocol.saveMetaItem({ type: 'object', name: AUTHORED.name, item } as never);
        expect(host.storedBody()).toEqual(firstStored);
    });
});
