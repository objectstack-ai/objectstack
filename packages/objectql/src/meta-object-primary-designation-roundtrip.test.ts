// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#8268] The write path takes back exactly what the converged read added
 * (#4326) — the ADR-0079 `nameField` half.
 *
 * `packages/rest/src/meta-object-materialization-agreement.test.ts` pins the
 * READ: every `/meta` object read exit now materializes a served base the way
 * `SchemaRegistry.registerObject` materializes its own, so a body from the
 * `metadata` service or from a `sys_metadata` overlay row carries the title
 * designation the registry's own resolved schema carries. That convergence
 * writes a real, authorable key onto bodies that did not have one, and the
 * write path persists a request body VERBATIM by design (ADR-0005 §Validation)
 * — so without a strip counterpart the ordinary Studio GET → edit → PUT bakes a
 * platform-computed designation into `sys_metadata.metadata`, into its
 * checksum, and into every history diff.
 *
 * Measured on this host before the strip existed: the stored body went from
 * `{name, label, fields}` to `{name, label, fields, nameField: 'name'}` on a
 * single round-trip, and the row's checksum moved. The sibling `__search` pin
 * (`meta-object-search-companion-roundtrip.test.ts`) went red at the same
 * moment for the same reason — which is the point of #8268: the seam's read
 * half and write half are one pair, and a stamp added to one owes the other.
 *
 * ## What this file adds that the `__search` pin cannot
 *
 * The two strips are NOT the same trade, and the difference is the reason this
 * file exists rather than one more case over there.
 * `stripProvisionedSearchCompanionFrom` removes a value byte-identical to a
 * platform-canonical FIELD DEFINITION, where coincidence with something an
 * author typed is implausible. `nameField` is a single string an author writes
 * deliberately to OVERRIDE the derivation — so the strip's boundary is
 * load-bearing, and the case that matters is not "the added pointer comes off"
 * but "an author's own pointer does NOT".
 *
 * Lives in this package for the reason its sibling does: the claim is about the
 * REAL `SchemaRegistry` and the REAL protocol write agreeing, and only this
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

/**
 * `name` is tier-1 name-ish EXACT and the highest-priority derivation there is,
 * so `provisionPrimary` designates it and an author pointing anywhere else is
 * unambiguously overriding rather than agreeing.
 */
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
function makeHost() {
    // Companions OFF: this file is about the title designation, and leaving the
    // other stamp out keeps a failure here unambiguous about which half moved.
    const registry = new SchemaRegistry({ multiTenant: false, searchCompanion: false } as never);
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

async function seed(item: Record<string, unknown> = clone(AUTHORED)) {
    const host = makeHost();
    await host.protocol.saveMetaItem({
        type: 'object', name: AUTHORED.name, item,
    } as never);
    return host;
}

describe('[#8268] the write path takes back the `nameField` the read added (#4326)', () => {
    it('GET → PUT the whole served document stores no designation', async () => {
        const host = await seed();
        const firstStored = host.storedBody()!;
        // Precondition: the author's own row never carried the pointer.
        expect(firstStored.nameField).toBeUndefined();

        // What a client actually holds: the SERVED document, designation
        // included. Non-vacuous — the read really does add it.
        const served: any = (await host.protocol.getMetaItem({
            type: 'object', name: AUTHORED.name,
        })).item;
        expect(served.nameField).toBe('name');

        // Edit one label and PUT the whole thing back, as the designer does.
        await host.protocol.saveMetaItem({
            type: 'object', name: AUTHORED.name, item: { ...served, label: 'Lead (edited)' },
        } as never);

        const stored = host.storedBody()!;
        expect(stored.nameField).toBeUndefined();
        expect(stored.label).toBe('Lead (edited)');
        // Everything except the edited key is byte-identical to the first save.
        expect({ ...stored, label: firstStored.label }).toEqual(firstStored);
    });

    it('a round-trip with NO edit leaves the stored body and its checksum identical', async () => {
        const host = await seed();
        const firstStored = host.storedBody()!;
        const firstChecksum = host.row()!.checksum;

        const served: any = (await host.protocol.getMetaItem({
            type: 'object', name: AUTHORED.name,
        })).item;
        await host.protocol.saveMetaItem({
            type: 'object', name: AUTHORED.name, item: served,
        } as never);

        expect(host.storedBody()).toEqual(firstStored);
        // The checksum is the half a byte-identity assertion can still miss —
        // it is what history diffs and change detection read.
        expect(host.row()!.checksum).toBe(firstChecksum);
    });

    // ── The boundary that makes the strip safe ──────────────────────────────

    it('KEEPS an author’s own designation that overrides the derivation', async () => {
        // The case the `__search` strip never has to face. `code_label` is
        // title-eligible but NOT what the derivation picks (`name` outranks it),
        // so this pointer is the author overriding the platform — exactly what
        // writing `nameField` is for. A strip that removed it would silently
        // move every record title on the object to a different column.
        const host = await seed({ ...clone(AUTHORED), nameField: 'code_label' });
        expect(host.storedBody()!.nameField).toBe('code_label');

        const served: any = (await host.protocol.getMetaItem({
            type: 'object', name: AUTHORED.name,
        })).item;
        // The read leaves an explicit pointer alone — `provisionPrimary` is a
        // no-op when the designation already resolves.
        expect(served.nameField).toBe('code_label');

        await host.protocol.saveMetaItem({
            type: 'object', name: AUTHORED.name, item: served,
        } as never);

        expect(host.storedBody()!.nameField).toBe('code_label');
    });

    it('strips nothing from an object the seam would designate nothing for', async () => {
        // No title-eligible field at all, so `provisionPrimary(_, { synthesize:
        // false })` designates nothing, the read adds nothing, and the write has
        // nothing to take back. Pins that the strip is driven by the seam's own
        // answer rather than by the key's presence.
        const untitled = {
            name: AUTHORED.name,
            label: 'Lead',
            fields: { seats: { name: 'seats', label: 'Seats', type: 'number' } },
        };
        const host = await seed(untitled);
        const firstStored = host.storedBody()!;
        expect(firstStored.nameField).toBeUndefined();

        const served: any = (await host.protocol.getMetaItem({
            type: 'object', name: AUTHORED.name,
        })).item;
        expect(served.nameField).toBeUndefined();

        await host.protocol.saveMetaItem({
            type: 'object', name: AUTHORED.name, item: served,
        } as never);

        expect(host.storedBody()).toEqual(firstStored);
    });
});
