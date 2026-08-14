// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#8038] The write path takes back exactly what the converged read added
 * (#4326) — the `__search` half.
 *
 * `packages/rest/src/meta-object-search-companion-agreement.test.ts` pins the
 * READ: the by-name and list reads of an object agree about the hidden
 * `__search` companion column, because both now converge on the registry's
 * materialized schema. That convergence adds a real, spec-valid field
 * declaration to bodies that did not carry one, and the write path persists a
 * request body VERBATIM by design (ADR-0005 §Validation) — so without a strip
 * counterpart the ordinary Studio GET → edit → PUT bakes the platform's own
 * column into `sys_metadata.metadata`, into its checksum, and into every
 * history diff. #6562 owed `applyInjectedSystemColumns` exactly this and says
 * so in `governServedItem`'s docstring; this is the same debt for the same
 * reason, one column over.
 *
 * Measured before the strip existed, on the host below: the stored row went
 * from `fields: [name]` to `fields: [__search, name]` on a single round-trip.
 *
 * ## Why the object here is RUNTIME-CREATED, and why this file is in objectql
 *
 * Type `object` carries `allowOrgOverride: false`, so a save over an
 * artifact-backed object is (correctly) refused with `NOT_OVERRIDABLE` and a
 * test written that way would only measure the refusal. The write door that IS
 * open by default is the runtime-created path (`allowRuntimeCreate` — the
 * AI-authoring surface), which is what this seeds; the same body is reachable
 * on any deployment listing `object` in `OS_METADATA_WRITABLE`. And the file
 * lives here for the reason `protocol-meta-effective-schema.test.ts` does: the
 * claim is about the REAL `SchemaRegistry` provisioning and the REAL protocol
 * write agreeing, and only this package has both — `@objectstack/objectql`
 * depends on `@objectstack/metadata-protocol`, never the reverse.
 */

import { describe, it, expect } from 'vitest';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
// [#5619] The producer's OWN write-verb dispatch decisions, so the fake engine
// below cannot accept a call ObjectQL refuses.
import { assertEngineDeleteDispatch, assertEngineUpdateDispatch } from '@objectstack/metadata-core';
import { SchemaRegistry } from './registry.js';
import { SEARCH_COMPANION_FIELD } from './search-companion.js';

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

/** A title-eligible field, so the materialization seam provisions a companion. */
const AUTHORED = {
    name: 'crm_lead',
    label: 'Lead',
    // [#8310] The runtime object door requires an authored OWD.
    sharingModel: 'private',
    fields: { name: { name: 'name', label: 'Name', type: 'text' } },
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
    const registry = new SchemaRegistry({ multiTenant: false, searchCompanion: true } as never);
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
    const storedBody = () => {
        const row = Array.from(rows.values()).find((r) => r.name === AUTHORED.name);
        return row ? (JSON.parse(row.metadata) as Record<string, any>) : undefined;
    };
    return { protocol, rows, registry, storedBody };
}

async function seed() {
    const host = makeHost();
    await host.protocol.saveMetaItem({
        type: 'object', name: AUTHORED.name, item: clone(AUTHORED),
    } as never);
    return host;
}

describe('[#8038] the write path takes back the `__search` the read added (#4326)', () => {
    it('GET → PUT the whole served document stores no companion column', async () => {
        const host = await seed();
        const firstStored = host.storedBody()!;
        // Precondition: the author's own row never carried the column.
        expect(Object.keys(firstStored.fields)).toEqual(['name']);

        // What a client actually holds: the SERVED document, companion included.
        const served: any = (await host.protocol.getMetaItem({
            type: 'object', name: AUTHORED.name,
        })).item;
        expect(Object.keys(served.fields)).toContain(SEARCH_COMPANION_FIELD);

        // Edit one label and PUT the whole thing back, as the designer does.
        await host.protocol.saveMetaItem({
            type: 'object', name: AUTHORED.name, item: { ...served, label: 'Lead (edited)' },
        } as never);

        const stored = host.storedBody()!;
        expect(Object.keys(stored.fields)).toEqual(['name']);
        expect(stored.label).toBe('Lead (edited)');
        // Everything except the edited key is byte-identical to the first save.
        expect({ ...stored, label: firstStored.label }).toEqual(firstStored);
    });

    it('a round-trip with NO edit leaves the stored body byte-identical', async () => {
        const host = await seed();
        const firstStored = host.storedBody()!;

        const served: any = (await host.protocol.getMetaItem({
            type: 'object', name: AUTHORED.name,
        })).item;
        await host.protocol.saveMetaItem({
            type: 'object', name: AUTHORED.name, item: served,
        } as never);

        expect(host.storedBody()).toEqual(firstStored);
    });

    it('strips ONLY the platform’s own definition, never a body carrying something else', async () => {
        const host = await seed();

        // Same field NAME, a definition the provisioning seam would never
        // stamp. The strip is exact — recomputed from `provisionSearchCompanion`
        // — so this survives, and a future drift between the two is a failure
        // here rather than a silently discarded declaration.
        const foreign = { type: 'text', label: 'Not the platform stamp' };
        await host.protocol.saveMetaItem({
            type: 'object',
            name: AUTHORED.name,
            item: {
                ...clone(AUTHORED),
                fields: { ...clone(AUTHORED.fields), [SEARCH_COMPANION_FIELD]: foreign },
            },
        } as never);

        const stored = host.storedBody()!;
        expect(stored.fields[SEARCH_COMPANION_FIELD]).toEqual(foreign);
    });
});
