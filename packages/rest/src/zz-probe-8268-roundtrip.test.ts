// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
// TEMPORARY probe for #8268 (write round-trip) — deleted before the PR.
import { describe, it } from 'vitest';
import { SchemaRegistry } from '@objectstack/objectql';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
import { assertEngineDeleteDispatch, assertEngineUpdateDispatch } from '@objectstack/metadata-core';

interface Row { [k: string]: any }

function makeEngine(registry: unknown) {
    const rows = new Map<string, Row>();
    let seq = 0;
    const keyOf = (r: Row) => `${r.type}:${r.name}:${r.organization_id ?? ''}:${r.state ?? 'active'}`;
    const engine: any = {
        registry,
        async find(_t: string, opts?: any) {
            const where = opts?.where ?? {};
            return Array.from(rows.values()).filter((r) => {
                for (const [k, v] of Object.entries(where)) {
                    if (v === undefined) continue;
                    if (r[k] !== v) return false;
                }
                return true;
            });
        },
        async findOne(_t: string, opts?: any) { return (await engine.find(_t, opts))[0]; },
        async insert(_t: string, data: Record<string, unknown>) {
            const row = { id: `row_${++seq}`, ...data };
            if (_t === 'sys_metadata') rows.set(keyOf(row), row);
            return row;
        },
        async update(table: string, data: Record<string, unknown>, opts: any) {
            assertEngineUpdateDispatch(data, opts);
            if (table !== 'sys_metadata') return { id: null };
            const where = opts?.where ?? {};
            const found = Array.from(rows.entries()).find(([, r]) => {
                for (const [k, v] of Object.entries(where)) {
                    if (v === undefined) continue;
                    if (r[k] !== v) return false;
                }
                return true;
            });
            if (!found) return { id: null };
            const merged = { ...found[1], ...(data as any) };
            rows.delete(found[0]);
            rows.set(keyOf(merged), merged);
            return { id: merged.id };
        },
        async delete(_t: string, data?: any, opts?: any) { assertEngineDeleteDispatch(data, opts); return { deleted: 0 }; },
        async transaction<T>(cb: (ctx: any, info: { owned: boolean }) => Promise<T>): Promise<T> {
            return cb(undefined, { owned: true });
        },
        async syncObjectSchema() { /* no DDL */ },
    };
    return { engine, rows };
}

const storedBody = (rows: Map<string, Row>, name: string) =>
    JSON.parse(Array.from(rows.values()).find((r) => r.name === name)!.metadata);
const storedChecksum = (rows: Map<string, Row>, name: string) =>
    Array.from(rows.values()).find((r) => r.name === name)!.checksum;

/** A runtime-authored object with a TITLE-ELIGIBLE field, so the seam designates. */
const authored = (name: string) => ({
    name,
    label: 'Contact',
    sharingModel: 'private',
    fields: { full_name: { type: 'text', label: 'Full name' } },
});

describe('#8268 write round-trip probe', () => {
    it('GET -> PUT: does the read-added nameField persist?', async () => {
        const registry = new SchemaRegistry({ multiTenant: false, searchCompanion: false } as never);
        const { engine, rows } = makeEngine(registry);
        const protocol = new ObjectStackProtocolImplementation(engine);

        const name = 'crm_contact';
        const fs0 = await import('node:fs');
        try {
            await protocol.saveMetaItem({ type: 'object', name, item: authored(name) } as never);
        } catch (e) {
            fs0.writeFileSync(process.env.OS_PROBE_OUT!, JSON.stringify({
                saveThrew: String((e as Error)?.message), code: (e as any)?.code, status: (e as any)?.status,
                rows: Array.from(rows.values()),
            }, null, 2));
            return;
        }
        if (rows.size === 0) {
            fs0.writeFileSync(process.env.OS_PROBE_OUT!, JSON.stringify({ noRows: true }, null, 2));
            return;
        }
        const firstStored = storedBody(rows, name);
        const firstChecksum = storedChecksum(rows, name);

        const served: any = (await protocol.getMetaItem({ type: 'object', name })).item;

        await protocol.saveMetaItem({ type: 'object', name, item: { ...served } } as never);
        const afterStored = storedBody(rows, name);
        const afterChecksum = storedChecksum(rows, name);

        const fs = await import('node:fs');
        fs.writeFileSync(process.env.OS_PROBE_OUT!, JSON.stringify({
            registryKnows: !!(registry as any).getObject(name),
            registryNameField: (registry as any).getObject(name)?.nameField,
            firstStoredNameField: firstStored.nameField ?? '<absent>',
            servedNameField: served?.nameField ?? '<absent>',
            afterStoredNameField: afterStored.nameField ?? '<absent>',
            checksumStable: firstChecksum === afterChecksum,
            firstStoredKeys: Object.keys(firstStored).sort(),
            afterStoredKeys: Object.keys(afterStored).sort(),
        }, null, 2));
    });
});
