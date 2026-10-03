// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#21613] A webhook delivers the declared record — never a column no
 * metadata declares — because the engine shapes a write's returned row before
 * the `data.record.*` event that carries it is published.
 *
 * The chain this drives is the real one on both sides of the hand-off: a real
 * `ObjectQL` engine writes through a SQL-shaped store driver (every write
 * answers with the whole stored row, as driver-sql's `returning('*')` and its
 * `select *` readback do), publishes its event to the realtime service, and
 * the real {@link AutoEnqueuer} copies that event into the outbox payload a
 * receiver gets. `rq_contact`'s table still carries two columns of fields an
 * upgrade retired, `mailing_street` and `mailing_city`.
 *
 * The enqueuer copies the event's `after` verbatim (`payload: { ...payload }`),
 * so no edit here is involved: the engine's shaping is what this pins.
 */

import { describe, expect, it } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import type {
    IRealtimeService,
    RealtimeEventHandler,
    RealtimeEventPayload,
} from '@objectstack/spec/contracts';
import { AutoEnqueuer, type HttpEnqueueFn } from './auto-enqueuer.js';

type Row = Record<string, unknown>;

const CONTACT = 'rq_contact';
const RETIRED = ['mailing_street', 'mailing_city'] as const;

class FakeRealtime implements IRealtimeService {
    private subs = new Map<string, { handler: RealtimeEventHandler; opts?: any }>();
    private n = 0;
    async publish(event: RealtimeEventPayload): Promise<void> {
        for (const sub of this.subs.values()) {
            if (sub.opts?.object && event.object !== sub.opts.object) continue;
            await sub.handler(event);
        }
    }
    async subscribe(_channel: string, handler: any, opts?: any): Promise<string> {
        const id = `s-${++this.n}`;
        this.subs.set(id, { handler, opts });
        return id;
    }
    async unsubscribe(id: string): Promise<void> {
        this.subs.delete(id);
    }
}

/** A SQL-shaped store: every write answers with the whole stored row. */
function makeSqlShapedStore() {
    const tables = new Map<string, Map<string, Row>>();
    const tableFor = (o: string): Map<string, Row> => {
        let t = tables.get(o);
        if (!t) { t = new Map<string, Row>(); tables.set(o, t); }
        return t;
    };
    const run = (o: string, where?: Row, limit?: number): Row[] => {
        const rows = Array.from(tableFor(o).values())
            .filter((r) => Object.entries(where ?? {}).every(([k, v]) => k.startsWith('$') || (r[k] ?? null) === (v ?? null)));
        // The caller's bound, after the filter, by presence.
        const page = typeof limit === 'number' ? rows.slice(0, limit) : rows;
        return page.map((r) => ({ ...r }));
    };
    let seq = 0;
    const driver = {
        name: 'store-sql-shaped', version: '0.0.0', supports: {},
        async connect(): Promise<void> {},
        async disconnect(): Promise<void> {},
        async checkHealth(): Promise<boolean> { return true; },
        async execute(): Promise<null> { return null; },
        async find(o: string, ast?: { where?: Row; limit?: number }): Promise<Row[]> { return run(o, ast?.where, ast?.limit); },
        async findOne(o: string, ast?: { where?: Row; limit?: number }): Promise<Row | null> { return run(o, ast?.where, ast?.limit)[0] ?? null; },
        async create(o: string, data: Row): Promise<Row> {
            seq += 1;
            const retired = o === CONTACT ? Object.fromEntries(RETIRED.map((c) => [c, null])) : {};
            const row: Row = { ...retired, ...data, id: data.id ?? `new_${seq}` };
            tableFor(o).set(String(row.id), row);
            return { ...row };
        },
        async update(o: string, id: string, data: Row): Promise<Row | null> {
            const cur = tableFor(o).get(id);
            if (!cur) return null;
            const next: Row = { ...cur, ...data, id };
            tableFor(o).set(id, next);
            return { ...next };
        },
        async delete(o: string, id: string): Promise<boolean> { return tableFor(o).delete(id); },
        async count(o: string, ast?: { where?: Row }): Promise<number> { return run(o, ast?.where).length; },
    };
    return { driver, seed: (o: string, row: Row) => { tableFor(o).set(String(row.id), { ...row }); } };
}

async function boot() {
    const engine = new ObjectQL();
    const store = makeSqlShapedStore();
    engine.registerDriver(store.driver as never, true);
    await engine.init();
    engine.registry.registerObject({
        name: CONTACT,
        label: 'Contact',
        fields: { name: { type: 'text' }, email: { type: 'text' } },
    } as never, 'test');
    // Just the columns the enqueuer's subscription cache reads.
    engine.registry.registerObject({
        name: 'sys_webhook',
        label: 'Webhook',
        fields: {
            name: { type: 'text' }, active: { type: 'boolean' }, object_name: { type: 'text' },
            triggers: { type: 'text' }, url: { type: 'text' }, method: { type: 'text' },
        },
    } as never, 'test');
    store.seed('sys_webhook', {
        id: 'wh_1', name: 'crm_hook', active: true, object_name: CONTACT,
        triggers: 'create,update', url: 'https://receiver.example/hook', method: 'POST',
    });
    store.seed(CONTACT, {
        id: 'c1', name: 'Ada', email: 'ada@example.com',
        mailing_street: '1 Retired Way', mailing_city: 'Oldtown',
    });

    const realtime = new FakeRealtime();
    engine.setRealtimeService(realtime);
    const delivered: Array<{ label?: string; payload: Row }> = [];
    const enqueue: HttpEnqueueFn = async (input) => {
        delivered.push({ label: input.label, payload: input.payload as Row });
        return `delivery_${delivered.length}`;
    };
    const enqueuer = new AutoEnqueuer(engine as never, realtime, enqueue);
    await enqueuer.start();
    return { engine, enqueuer, delivered };
}

function expectDeclaredOnly(row: unknown): void {
    expect(row).toBeTruthy();
    for (const retired of RETIRED) expect(Object.keys(row as Row)).not.toContain(retired);
}

describe('[#21613] a webhook delivers the declared record of a write', () => {
    it('data.record.created and data.record.updated payloads carry no retired column', async () => {
        const { engine, enqueuer, delivered } = await boot();
        try {
            await engine.insert(CONTACT, { id: 'n1', name: 'New' });
            await engine.update(CONTACT, { id: 'c1', name: 'Ada 2' });
        } finally {
            await enqueuer.stop();
        }

        const created = delivered.find((d) => d.label === 'data.record.created');
        const updated = delivered.find((d) => d.label === 'data.record.updated');
        expect(created?.payload).toMatchObject({ recordId: 'n1', action: 'created', after: { id: 'n1', name: 'New' } });
        expectDeclaredOnly(created?.payload.after);
        expect(updated?.payload).toMatchObject({ recordId: 'c1', action: 'updated', after: { id: 'c1', name: 'Ada 2', email: 'ada@example.com' } });
        expectDeclaredOnly(updated?.payload.after);
    });
});
