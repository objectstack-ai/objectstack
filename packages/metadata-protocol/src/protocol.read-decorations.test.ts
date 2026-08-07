// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #4326 — read decorations must not round-trip into the persisted body.
 *
 * `getMetaItem`/`getMetaItems` stamp `_diagnostics` on every served document
 * (and `_draft` on draft reads), while the write path persists the request body
 * VERBATIM by design (ADR-0005 §Validation — `parsed.data` would strip
 * Studio-only auxiliary fields). The standard Studio round-trip therefore used
 * to bake a read-time verdict into `sys_metadata.metadata`, into its checksum,
 * and into every history diff.
 *
 * Nothing user-visible was ever wrong — reads recompute and the fresh verdict
 * shadows the stale one — which is exactly why this needs a pin: the invariant
 * being protected is "a GET → PUT round-trip persists a byte-identical body",
 * and only the stored bytes can show it.
 *
 * cloud#971 then showed the SECOND consumer of the same invariant, where it is
 * not cosmetic at all: since #4001 closed the metadata schemas, a served
 * document handed back to its own schema THROWS on our annotation. The last
 * describe block pins that — and, more importantly, pins the general rule, so a
 * future third decoration key fails here instead of in a production boot log.
 */
import { describe, expect, it } from 'vitest';
// [#5619] The producer's OWN write-verb dispatch decisions (#4550 delete /
// #5480 update), so the fake engine below cannot accept a call ObjectQL
// refuses. Imported from `@objectstack/metadata-core` and not from
// `@objectstack/objectql`: objectql DEPENDS ON this package, so that import
// would close a dependency cycle turbo rejects outright — which is why all 26
// of this package's (file, verb) pairs sat in the gate's DEBT ledger until
// #5619 sank the two predicates into a package both sides already depend on.
import { assertEngineDeleteDispatch, assertEngineUpdateDispatch } from '@objectstack/metadata-core';
import { FlowSchema } from '@objectstack/spec/automation';
import { METADATA_READ_DECORATIONS } from '@objectstack/spec/kernel';
import { ObjectStackProtocolImplementation, stripReadDecorations } from './index.js';

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

function makeStubEngine() {
    const rows = new Map<string, Row>();
    let nextId = 0;
    const findRow = (w: Record<string, unknown>) => {
        for (const [k, r] of rows) if (matches(r, w)) return { key: k, row: r };
        return null;
    };
    const engine: any = {
        async findOne(_t: string, opts: { where: Record<string, unknown> }) {
            return findRow(opts.where)?.row ?? null;
        },
        async find(_t: string, opts: { where: Record<string, unknown> }) {
            return Array.from(rows.values()).filter((r) => matches(r, opts.where));
        },
        async insert(table: string, data: Record<string, unknown>) {
            if (table !== 'sys_metadata') return { id: 'side_table' };
            const row = { id: `r_${++nextId}`, ...(data as any) } as Row;
            rows.set(keyOf(data), row);
            return { id: row.id };
        },
        async update(table: string, data: Record<string, unknown>, opts: { where: Record<string, unknown> }) {
            assertEngineUpdateDispatch(data, opts);
            if (table !== 'sys_metadata') return { id: null };
            const found = findRow(opts.where);
            if (!found) return { id: null };
            const merged = { ...found.row, ...(data as any) };
            rows.delete(found.key);
            rows.set(keyOf(merged), merged);
            return { id: found.row.id };
        },
        async delete(_t: string, opts?: Record<string, unknown>) {
            assertEngineDeleteDispatch(opts);
            return { deleted: 0 };
        },
        async transaction<T>(cb: (ctx: any, info: { owned: boolean }) => Promise<T>): Promise<T> { return cb(undefined, { owned: true }); },
        async syncObjectSchema() { /* no DDL in this stub */ },
        registry: {
            listItems: () => [],
            isPackageDisabled: () => false,
            getItem: () => undefined,
            registerItem: () => {},
            registerObject: () => {},
            getPackage: () => undefined,
        },
    };
    return { engine, rows };
}

const storedBody = (rows: Map<string, Row>, name: string) => {
    const row = Array.from(rows.values()).find((r) => r.name === name)!;
    return JSON.parse(row.metadata);
};

const objectBody = (name: string) => ({
    name,
    label: 'Invoice',
    fields: { amount: { type: 'currency', label: 'Amount' } },
});

describe('stripReadDecorations (#4326)', () => {
    it('removes the read-only decorations', () => {
        const out = stripReadDecorations({
            name: 'x', _diagnostics: { valid: true }, _draft: true,
        }) as Record<string, unknown>;
        expect(out).toEqual({ name: 'x' });
    });

    it('returns the SAME reference when there is nothing to strip', () => {
        const body = { name: 'x', label: 'X' };
        expect(stripReadDecorations(body)).toBe(body);
    });

    it('leaves the ADR-0010 protection envelope and package provenance alone', () => {
        // These share the underscore spelling but are envelope state the write
        // path legitimately carries — stripping them would loosen a packaged lock.
        const body = {
            name: 'x',
            _lock: 'full',
            _lockReason: 'shipped by package',
            _provenance: 'package',
            _packageId: 'app.crm',
            _diagnostics: { valid: false },
        };
        const out = stripReadDecorations(body) as Record<string, unknown>;
        expect(out).toEqual({
            name: 'x',
            _lock: 'full',
            _lockReason: 'shipped by package',
            _provenance: 'package',
            _packageId: 'app.crm',
        });
    });

    it('passes non-object input through untouched', () => {
        expect(stripReadDecorations(null)).toBe(null);
        expect(stripReadDecorations('str')).toBe('str');
        const arr = [{ _diagnostics: {} }];
        expect(stripReadDecorations(arr)).toBe(arr);
    });

    it('does not mutate the caller input', () => {
        const body = { name: 'x', _diagnostics: { valid: true } };
        stripReadDecorations(body);
        expect(body._diagnostics).toEqual({ valid: true });
    });
});

describe('saveMetaItem — the Studio round-trip persists a byte-identical body (#4326)', () => {
    it('GET → PUT the whole served document stores no _diagnostics', async () => {
        const { engine, rows } = makeStubEngine();
        const protocol = new ObjectStackProtocolImplementation(engine);

        const authored = objectBody('crm_invoice');
        await protocol.saveMetaItem({ type: 'object', name: 'crm_invoice', item: authored });
        const firstStored = storedBody(rows, 'crm_invoice');

        // What Studio actually holds: the SERVED document, decorations included.
        const served: any = (await protocol.getMetaItem({ type: 'object', name: 'crm_invoice' })).item;
        expect(served._diagnostics).toBeDefined(); // precondition — the read does decorate

        // Edit one label and PUT the whole thing back, as the designer does.
        await protocol.saveMetaItem({
            type: 'object',
            name: 'crm_invoice',
            item: { ...served, label: 'Invoice (edited)' },
        });

        const stored = storedBody(rows, 'crm_invoice');
        expect('_diagnostics' in stored).toBe(false);
        expect(stored.label).toBe('Invoice (edited)');
        // Everything except the edited key is byte-identical to the first save.
        expect({ ...stored, label: firstStored.label }).toEqual(firstStored);
    });

    it('a draft read PUT back does not persist the _draft preview badge', async () => {
        const { engine, rows } = makeStubEngine();
        const protocol = new ObjectStackProtocolImplementation(engine);

        await protocol.saveMetaItem({
            type: 'object', name: 'crm_quote', item: objectBody('crm_quote'), mode: 'draft',
        });
        // The badge comes from the PREVIEW read (`previewDrafts`), which is what
        // the designer's "preview pending changes" surface calls — a plain
        // `state: 'draft'` read returns the body unbadged.
        const draft: any = (await protocol.getMetaItem({
            type: 'object', name: 'crm_quote', previewDrafts: true,
        })).item;
        expect(draft._draft).toBe(true); // precondition — the preview read badges

        await protocol.saveMetaItem({
            type: 'object', name: 'crm_quote', item: draft, mode: 'draft',
        });

        const stored = storedBody(rows, 'crm_quote');
        expect('_draft' in stored).toBe(false);
        expect('_diagnostics' in stored).toBe(false);
        // Draft-ness lives in the row's state column, not the body.
        expect(Array.from(rows.values()).find((r) => r.name === 'crm_quote')!.state).toBe('draft');
    });

    it('keeps the checksum stable across a decoration-only round-trip', async () => {
        const { engine, rows } = makeStubEngine();
        const protocol = new ObjectStackProtocolImplementation(engine);

        await protocol.saveMetaItem({ type: 'object', name: 'crm_lead', item: objectBody('crm_lead') });
        const before = Array.from(rows.values()).find((r) => r.name === 'crm_lead')!.checksum;

        // Re-save the served document unchanged — the only difference is our own
        // decoration, so the content hash must not move.
        const served: any = (await protocol.getMetaItem({ type: 'object', name: 'crm_lead' })).item;
        await protocol.saveMetaItem({ type: 'object', name: 'crm_lead', item: served });

        const after = Array.from(rows.values()).find((r) => r.name === 'crm_lead')!.checksum;
        expect(after).toBe(before);
    });
});

/** A minimal but complete record-change flow — what the automation service binds. */
const flowBody = (name: string) => ({
    name,
    label: 'Pause project when hours are logged',
    type: 'record_change',
    status: 'active',
    nodes: [
        {
            id: 'start',
            type: 'start',
            label: 'Start',
            config: { objectName: 'task', triggerType: 'record-after-update' },
        },
        { id: 'end', type: 'end', label: 'End' },
    ],
    edges: [{ id: 'e1', source: 'start', target: 'end' }],
});

/**
 * cloud#971 — the read path's annotations must not break a strict re-parse.
 *
 * This is the same invariant as the round-trip block above, seen from the other
 * side. `saveMetaItem` already strips on the WRITE path; the cold-boot flow bind
 * (`service-automation`: `getMetaItems('flow')` → `registerFlow` →
 * `FlowSchema.parse`) re-parses instead of persisting, and since #4001 closed
 * `FlowSchema` that parse THREW `unrecognized_keys: ["_diagnostics"]` for every
 * flow on every boot — an entire binding path dead behind a WARN, masked only
 * because the record-change plugin binds record flows a second way.
 *
 * These run against the REAL `getMetaItems`, so they fail if the read path ever
 * grows a decoration that consumers don't know to remove.
 */
describe('a served document survives its own (closed) schema — cloud#971', () => {
    /** Serve `flowBody(name)` back through the real read path. */
    async function serveFlow(name: string): Promise<Record<string, unknown>> {
        const { engine } = makeStubEngine();
        const protocol = new ObjectStackProtocolImplementation(engine);
        await protocol.saveMetaItem({ type: 'flow', name, item: flowBody(name) });
        const res: any = await protocol.getMetaItems({ type: 'flow' });
        const items: any[] = Array.isArray(res) ? res : (res?.items ?? []);
        const served = items.find((i) => i?.name === name);
        expect(served, `getMetaItems('flow') served ${name}`).toBeDefined();
        return served as Record<string, unknown>;
    }

    it('the raw served flow does NOT parse — the strip is load-bearing', async () => {
        const served = await serveFlow('task_hours_pause_project');
        expect(served._diagnostics).toBeDefined(); // precondition — the read decorates

        const raw = FlowSchema.safeParse(served);
        expect(raw.success, 'a decorated flow must still be rejected by the closed schema').toBe(false);
        // Exactly the production symptom, so a reader of this test can match it
        // against the WARN in the issue.
        expect(raw.error!.issues.some((i) => i.code === 'unrecognized_keys')).toBe(true);
    });

    it('stripping the read decorations makes it parse — the cold-boot bind path', async () => {
        const served = await serveFlow('task_hours_pause_project');
        const parsed = FlowSchema.safeParse(stripReadDecorations(served));
        expect(
            parsed.success,
            `flow must bind after the strip; issues: ${JSON.stringify(parsed.error?.issues)}`,
        ).toBe(true);
    });

    it('every key the read ADDS is either a known decoration or allowed by the schema', async () => {
        // The drift guard. `stripReadDecorations` only removes what
        // METADATA_READ_DECORATIONS lists, so a NEW annotation stamped by the
        // read path would sail past it and start throwing in `registerFlow`
        // again. Diff the served document against the authored one and hold
        // every added key to one of the two escapes.
        const name = 'task_hours_pause_project';
        const served = await serveFlow(name);
        const authoredKeys = new Set(Object.keys(flowBody(name)));
        const added = Object.keys(served).filter((k) => !authoredKeys.has(k));

        const unaccounted = added.filter((k) => {
            if ((METADATA_READ_DECORATIONS as readonly string[]).includes(k)) return false;
            // Not a decoration ⇒ it must be envelope state the closed schema
            // allowlists (the ADR-0010 `_lock`/`_packageId` family).
            return !FlowSchema.safeParse({ ...stripReadDecorations(served) as object, [k]: served[k] }).success;
        });

        expect(
            unaccounted,
            'the read path stamped a key that is neither stripped (add it to '
            + 'METADATA_READ_DECORATIONS in @objectstack/spec) nor accepted by the closed schema — '
            + 'every strict re-parse of a served flow, including the cold-boot bind, now throws',
        ).toEqual([]);
    });
});
