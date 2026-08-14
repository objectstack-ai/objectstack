// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * AutoEnqueuer end-to-end test.
 *
 * Verifies the bridge between `IRealtimeService` (data events) and the shared
 * `service-messaging` HTTP outbox (ADR-0018 M3 — enqueue via `messaging.enqueueHttp`):
 *
 *   - On startup, subscription rules are loaded from the engine.
 *   - `data.record.created/updated/deleted` events fan out to matching
 *     `sys_webhook` rows, enqueued as `source: 'webhook'`.
 *   - The `triggers` CSV column filters which actions fire.
 *   - The `object_name` field scopes events to a specific object.
 *   - Edits to `sys_webhook` self-heal the cache without restart.
 *   - Enqueue is fire-and-forget (handler never throws or blocks).
 *   - The deterministic dedupKey (`<webhookId>:<eventId>`) collapses replays.
 */

import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { BulkDataEventSchema, DataEventSchema } from '@objectstack/spec/api';
import type {
    IDataEngine,
    IRealtimeService,
    RealtimeEventHandler,
    RealtimeEventPayload,
} from '@objectstack/spec/contracts';
import type { EnqueueHttpInput } from '@objectstack/service-messaging';
import { AutoEnqueuer, type HttpEnqueueFn } from './auto-enqueuer.js';

// ---------------------------------------------------------------------------
// Fakes
// ---------------------------------------------------------------------------

/**
 * Records `enqueueHttp` calls and dedups on `(source, dedupKey)` — mirroring the
 * shared outbox's UNIQUE constraint so the replay test still holds.
 */
function makeRecorder() {
    const calls: EnqueueHttpInput[] = [];
    const seen = new Map<string, string>();
    const enqueue: HttpEnqueueFn = async (input) => {
        const key = `${input.source}::${input.dedupKey}`;
        const existing = seen.get(key);
        if (existing) return existing;
        seen.set(key, key);
        calls.push(input);
        return key;
    };
    return { enqueue, calls };
}

class FakeRealtime implements IRealtimeService {
    private subs = new Map<string, { handler: RealtimeEventHandler; opts?: any }>();
    private n = 0;

    async publish(event: RealtimeEventPayload): Promise<void> {
        for (const sub of this.subs.values()) {
            const o = sub.opts ?? {};
            if (o.object && event.object !== o.object) continue;
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

class FakeEngine implements IDataEngine {
    rows: Record<string, any[]> = {};

    constructor(seed?: Record<string, any[]>) {
        if (seed) this.rows = JSON.parse(JSON.stringify(seed));
    }

    async find(name: string, q?: any): Promise<any[]> {
        const all = this.rows[name] ?? [];
        if (!q?.where) return all;
        return all.filter((r) => Object.entries(q.where).every(([k, v]) => { if (k.startsWith('$')) throw new Error(`fake driver: unsupported operator ${k}`); return r[k] === v; }));
    }
    async findOne(name: string, q?: any): Promise<any> {
        return (await this.find(name, q))[0] ?? null;
    }
    async insert(name: string, data: any): Promise<any> {
        const arr = (this.rows[name] = this.rows[name] ?? []);
        arr.push(data);
        return data;
    }
    async update(name: string, data: any, opts?: any): Promise<any> {
        const arr = this.rows[name] ?? [];
        for (const r of arr) {
            if (opts?.where && Object.entries(opts.where).every(([k, v]) => r[k] === v)) {
                Object.assign(r, data);
            }
        }
        return { affected: 0 };
    }
    async delete(name: string, opts?: any): Promise<any> {
        const arr = this.rows[name] ?? [];
        const before = arr.length;
        this.rows[name] = arr.filter(
            (r) =>
                !(
                    opts?.where &&
                    Object.entries(opts.where).every(([k, v]) => {
                        if (k.startsWith('$')) throw new Error(`fake driver: unsupported operator ${k}`);
                        return r[k] === v;
                    })
                ),
        );
        return { affected: before - this.rows[name].length };
    }
    async count(name: string): Promise<number> {
        return (this.rows[name] ?? []).length;
    }
    async aggregate(): Promise<any[]> {
        return [];
    }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function webhook(over: Partial<any> = {}): any {
    return {
        id: over.id ?? 'wh-1',
        name: over.name ?? 'default',
        active: over.active ?? true,
        object_name: over.object_name ?? 'contact',
        triggers: over.triggers ?? 'create,update,delete',
        url: over.url ?? 'https://hooks.example/wh',
        method: 'POST',
        definition_json: over.definition_json,
        ...over,
    };
}

/**
 * A `data.record.*` envelope whose `payload` is a full `DataEvent`
 * (`@objectstack/spec/api`) — what the engine publishes since #4626. Built
 * through the spec schema so the fixture cannot drift from the contract the
 * enqueuer now reads (`recordId` is a required top-level string).
 */
function event(
    type: 'created' | 'updated' | 'deleted',
    object: string,
    record: any,
    timestamp = '2026-05-24T00:00:00.000Z',
): RealtimeEventPayload {
    const payload = DataEventSchema.parse({
        id: randomUUID(),
        type: `data.record.${type}`,
        object,
        recordId: String(record.id),
        ...(type === 'deleted' ? {} : { after: record }),
        timestamp,
    });
    return { type: payload.type, object, payload: { ...payload }, timestamp };
}

/**
 * A `data.records.*` envelope whose `payload` is a full `BulkDataEvent`
 * (#4639) — what the engine publishes for a predicate (`multi: true`) write.
 * Built through the spec schema for the same reason as {@link event}: the
 * fixture cannot drift from the contract the enqueuer reads.
 */
function bulkEvent(
    type: 'updated' | 'deleted',
    object: string,
    matched: number,
    timestamp = '2026-05-24T00:00:00.000Z',
): RealtimeEventPayload {
    const payload = BulkDataEventSchema.parse({
        id: randomUUID(),
        type: `data.records.${type}`,
        object,
        matched,
        timestamp,
    });
    return { type: payload.type, object, payload: { ...payload }, timestamp };
}

async function flush() {
    await new Promise((r) => setTimeout(r, 0));
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('AutoEnqueuer', () => {
    it('enqueues a delivery when a matching data event fires', async () => {
        const engine = new FakeEngine({ sys_webhook: [webhook()] });
        const realtime = new FakeRealtime();
        const { enqueue, calls } = makeRecorder();
        const ae = new AutoEnqueuer(engine, realtime, enqueue, { refreshIntervalMs: 0 });
        await ae.start();

        await realtime.publish(event('created', 'contact', { id: 'c-1', name: 'Alice' }));
        await flush();

        expect(calls).toHaveLength(1);
        expect(calls[0].source).toBe('webhook');
        expect(calls[0].refId).toBe('wh-1');
        expect(calls[0].url).toBe('https://hooks.example/wh');
        expect(calls[0].label).toBe('data.record.created');
        expect((calls[0].payload as any).recordId).toBe('c-1');
        // [#4626] The delivered body carries the fulfilled DataEvent — the
        // record itself stays nested under `after`, and the envelope keys
        // (object/recordId/action/timestamp) still win.
        expect((calls[0].payload as any).after).toEqual({ id: 'c-1', name: 'Alice' });
        expect((calls[0].payload as any).object).toBe('contact');
        expect((calls[0].payload as any).action).toBe('created');
        await ae.stop();
    });

    it('[#4626] drops an off-contract data event instead of enqueuing it as "unknown"', async () => {
        // Pre-#4626 the enqueuer read `recordId ?? id ?? after?.id ?? 'unknown'`,
        // so a payload that named no record still produced a delivery whose
        // recordId was the literal string 'unknown'. The payload IS a DataEvent
        // now: no top-level string `recordId` means the producer is broken, and
        // the event is dropped loudly rather than tolerated here.
        const engine = new FakeEngine({ sys_webhook: [webhook()] });
        const realtime = new FakeRealtime();
        const { enqueue, calls } = makeRecorder();
        const warn = vi.fn();
        const ae = new AutoEnqueuer(engine, realtime, enqueue, {
            refreshIntervalMs: 0,
            logger: { warn } as any,
        });
        await ae.start();

        await realtime.publish({
            type: 'data.record.created',
            object: 'contact',
            // The pre-fix engine shape for a bulk write: no usable record id.
            payload: { recordId: '', after: 2 },
            timestamp: '2026-05-24T00:00:00.000Z',
        });
        await flush();

        expect(calls).toHaveLength(0);
        expect(warn).toHaveBeenCalled();
        expect(String(warn.mock.calls[0][0])).toContain('off-contract');
        await ae.stop();
    });

    it('skips events for other objects', async () => {
        const engine = new FakeEngine({ sys_webhook: [webhook({ object_name: 'contact' })] });
        const realtime = new FakeRealtime();
        const { enqueue, calls } = makeRecorder();
        const ae = new AutoEnqueuer(engine, realtime, enqueue, { refreshIntervalMs: 0 });
        await ae.start();

        await realtime.publish(event('created', 'lead', { id: 'l-1' }));
        await flush();

        expect(calls).toHaveLength(0);
        await ae.stop();
    });

    it('respects the triggers CSV (create-only webhook ignores updates)', async () => {
        const engine = new FakeEngine({ sys_webhook: [webhook({ triggers: 'create' })] });
        const realtime = new FakeRealtime();
        const { enqueue, calls } = makeRecorder();
        const ae = new AutoEnqueuer(engine, realtime, enqueue, { refreshIntervalMs: 0 });
        await ae.start();

        await realtime.publish(event('created', 'contact', { id: 'c-1' }));
        await realtime.publish(event('updated', 'contact', { id: 'c-1' }, '2026-05-24T00:00:01.000Z'));
        await realtime.publish(event('deleted', 'contact', { id: 'c-1' }, '2026-05-24T00:00:02.000Z'));
        await flush();

        expect(calls).toHaveLength(1);
        expect(calls[0].label).toBe('data.record.created');
        await ae.stop();
    });

    it('parses triggers authored as a multi-select array', async () => {
        // The `triggers` field is now a multi-select stored as an array; the
        // parser must treat it identically to the legacy CSV form.
        const engine = new FakeEngine({ sys_webhook: [webhook({ triggers: ['create'] })] });
        const realtime = new FakeRealtime();
        const { enqueue, calls } = makeRecorder();
        const ae = new AutoEnqueuer(engine, realtime, enqueue, { refreshIntervalMs: 0 });
        await ae.start();

        await realtime.publish(event('created', 'contact', { id: 'c-1' }));
        await realtime.publish(event('updated', 'contact', { id: 'c-1' }, '2026-05-24T00:00:01.000Z'));
        await flush();

        expect(calls).toHaveLength(1);
        expect(calls[0].label).toBe('data.record.created');
        await ae.stop();
    });

    it('parses triggers stored as a JSON-encoded array string', async () => {
        // Some drivers hand a JSON array column back as a string — accept it.
        const engine = new FakeEngine({ sys_webhook: [webhook({ triggers: '["create","update"]' })] });
        const realtime = new FakeRealtime();
        const { enqueue, calls } = makeRecorder();
        const ae = new AutoEnqueuer(engine, realtime, enqueue, { refreshIntervalMs: 0 });
        await ae.start();

        await realtime.publish(event('created', 'contact', { id: 'c-1' }));
        await realtime.publish(event('deleted', 'contact', { id: 'c-1' }, '2026-05-24T00:00:02.000Z'));
        await flush();

        // create + update are subscribed; delete is not.
        expect(calls).toHaveLength(1);
        expect(calls[0].label).toBe('data.record.created');
        await ae.stop();
    });

    it('fans out to multiple matching webhooks', async () => {
        const engine = new FakeEngine({
            sys_webhook: [
                webhook({ id: 'wh-1', name: 'slack', url: 'https://slack.test' }),
                webhook({ id: 'wh-2', name: 'analytics', url: 'https://amplitude.test' }),
            ],
        });
        const realtime = new FakeRealtime();
        const { enqueue, calls } = makeRecorder();
        const ae = new AutoEnqueuer(engine, realtime, enqueue, { refreshIntervalMs: 0 });
        await ae.start();

        await realtime.publish(event('created', 'contact', { id: 'c-1' }));
        await flush();

        expect(calls).toHaveLength(2);
        expect(calls.map((r) => r.url).sort()).toEqual([
            'https://amplitude.test',
            'https://slack.test',
        ]);
        await ae.stop();
    });

    it('skips inactive webhooks', async () => {
        const engine = new FakeEngine({ sys_webhook: [webhook({ active: false })] });
        const realtime = new FakeRealtime();
        const { enqueue, calls } = makeRecorder();
        const ae = new AutoEnqueuer(engine, realtime, enqueue, { refreshIntervalMs: 0 });
        await ae.start();

        await realtime.publish(event('created', 'contact', { id: 'c-1' }));
        await flush();

        expect(calls).toHaveLength(0);
        await ae.stop();
    });

    it('skips manual-only webhooks (no triggers)', async () => {
        const engine = new FakeEngine({ sys_webhook: [webhook({ triggers: '' })] });
        const realtime = new FakeRealtime();
        const { enqueue, calls } = makeRecorder();
        const ae = new AutoEnqueuer(engine, realtime, enqueue, { refreshIntervalMs: 0 });
        await ae.start();

        await realtime.publish(event('created', 'contact', { id: 'c-1' }));
        await flush();

        expect(calls).toHaveLength(0);
        await ae.stop();
    });

    it('warns and ignores a legacy trigger the engine never emits (#3196)', async () => {
        // A row authored before undelete/api were removed keeps its valid
        // triggers; the dead ones are dropped with a warning (drift-guard).
        const engine = new FakeEngine({
            sys_webhook: [webhook({ triggers: 'create,undelete,api' })],
        });
        const realtime = new FakeRealtime();
        const { enqueue, calls } = makeRecorder();
        const warn = vi.fn();
        const ae = new AutoEnqueuer(engine, realtime, enqueue, { refreshIntervalMs: 0, logger: { warn } });
        await ae.start();

        await realtime.publish(event('created', 'contact', { id: 'c-1' }));
        await flush();

        expect(calls).toHaveLength(1); // the valid `create` trigger still fires
        expect(warn).toHaveBeenCalledWith(
            expect.stringContaining('undelete'),
            expect.objectContaining({ unknown: expect.arrayContaining(['undelete', 'api']) }),
        );
        await ae.stop();
    });

    it('skips a webhook whose only triggers are removed values (#3196)', async () => {
        const engine = new FakeEngine({ sys_webhook: [webhook({ triggers: 'undelete,api' })] });
        const realtime = new FakeRealtime();
        const { enqueue, calls } = makeRecorder();
        const ae = new AutoEnqueuer(engine, realtime, enqueue, { refreshIntervalMs: 0 });
        await ae.start();

        await realtime.publish(event('created', 'contact', { id: 'c-1' }));
        await flush();

        expect(calls).toHaveLength(0);
        await ae.stop();
    });

    it('says OUT LOUD that a zero-trigger webhook will never fire (ADR-0078 Phase 4)', async () => {
        // The skip used to be silent, under a comment blessing it as "a
        // manual-only webhook" — a mode #3196 removed (no manual fire path
        // exists). A zero-trigger ACTIVE row is a dead subscription that looks
        // armed in Setup, so the skip now warns with the same rule id the
        // author-time gate reports (`webhook/without-triggers`). Inactive rows
        // never reach parseRow (the cache query filters `active: true`), so a
        // deliberately-disabled webhook stays warning-free.
        const engine = new FakeEngine({ sys_webhook: [webhook({ triggers: '' })] });
        const realtime = new FakeRealtime();
        const { enqueue, calls } = makeRecorder();
        const warn = vi.fn();
        const ae = new AutoEnqueuer(engine, realtime, enqueue, { refreshIntervalMs: 0, logger: { warn } });
        await ae.start();

        await realtime.publish(event('created', 'contact', { id: 'c-1' }));
        await flush();

        expect(calls).toHaveLength(0);
        expect(warn).toHaveBeenCalledWith(
            expect.stringContaining('webhook/without-triggers'),
            expect.objectContaining({ id: 'wh-1' }),
        );
        expect(String(warn.mock.calls[0][0])).toContain('NEVER fire');
        await ae.stop();
    });

    it('self-heals the cache when sys_webhook changes', async () => {
        const engine = new FakeEngine({ sys_webhook: [] });
        const realtime = new FakeRealtime();
        const { enqueue, calls } = makeRecorder();
        const ae = new AutoEnqueuer(engine, realtime, enqueue, { refreshIntervalMs: 0 });
        await ae.start();

        await realtime.publish(event('created', 'contact', { id: 'c-1' }));
        await flush();
        expect(calls).toHaveLength(0);

        await engine.insert('sys_webhook', webhook());
        await realtime.publish({
            type: 'data.record.created',
            object: 'sys_webhook',
            payload: { recordId: 'wh-1' },
            timestamp: '2026-05-24T00:01:00.000Z',
        });
        await flush();
        await flush(); // Two ticks: the self-heal handler itself awaits refresh

        await realtime.publish(event('created', 'contact', { id: 'c-2' }, '2026-05-24T00:01:01.000Z'));
        await flush();

        expect(calls).toHaveLength(1);
        expect((calls[0].payload as any).recordId).toBe('c-2');
        await ae.stop();
    });

    it('uses a deterministic dedupKey so replays collapse', async () => {
        const engine = new FakeEngine({ sys_webhook: [webhook()] });
        const realtime = new FakeRealtime();
        const { enqueue, calls } = makeRecorder();
        const ae = new AutoEnqueuer(engine, realtime, enqueue, { refreshIntervalMs: 0 });
        await ae.start();

        const evt = event('created', 'contact', { id: 'c-1' });
        await realtime.publish(evt);
        await realtime.publish(evt);
        await flush();

        expect(calls).toHaveLength(1);
        await ae.stop();
    });

    it('handler is fire-and-forget (publish does not block on enqueue)', async () => {
        const engine = new FakeEngine({ sys_webhook: [webhook()] });
        const realtime = new FakeRealtime();
        let slowResolve!: () => void;
        const blocker = new Promise<void>((res) => {
            slowResolve = res;
        });
        const calls: EnqueueHttpInput[] = [];
        const enqueue: HttpEnqueueFn = async (input) => {
            await blocker;
            calls.push(input);
            return 'id';
        };

        const ae = new AutoEnqueuer(engine, realtime, enqueue, { refreshIntervalMs: 0 });
        await ae.start();

        const before = Date.now();
        await realtime.publish(event('created', 'contact', { id: 'c-1' }));
        const elapsed = Date.now() - before;
        expect(elapsed).toBeLessThan(20); // publish must not have awaited blocker

        slowResolve();
        await flush();
        expect(calls).toHaveLength(1);
        await ae.stop();
    });

    it('logs but swallows enqueue errors so other webhooks still fire', async () => {
        const engine = new FakeEngine({
            sys_webhook: [
                webhook({ id: 'wh-bad', url: 'https://bad.test' }),
                webhook({ id: 'wh-good', url: 'https://good.test' }),
            ],
        });
        const realtime = new FakeRealtime();
        const calls: EnqueueHttpInput[] = [];
        const enqueue: HttpEnqueueFn = vi.fn(async (input) => {
            if (input.refId === 'wh-bad') throw new Error('boom');
            calls.push(input);
            return 'id';
        });
        const warn = vi.fn();
        const ae = new AutoEnqueuer(engine, realtime, enqueue, { refreshIntervalMs: 0, logger: { warn } });
        await ae.start();

        await realtime.publish(event('created', 'contact', { id: 'c-1' }));
        await flush();

        expect(calls).toHaveLength(1);
        expect(calls[0].url).toBe('https://good.test');
        expect(warn).toHaveBeenCalled();
        await ae.stop();
    });
});

/**
 * #4639 — predicate writes dispatch under their OWN opt-in triggers.
 *
 * A `multi: true` update/delete publishes `data.records.*` carrying a count and
 * no record. Routing that to the existing `update`/`delete` subscribers would
 * hand them a body missing every field they read, so it gets its own trigger
 * pair: `bulk_update` / `bulk_delete`.
 */
describe('AutoEnqueuer — bulk data events (#4639)', () => {
    it('dispatches data.records.updated to a bulk_update subscriber', async () => {
        const engine = new FakeEngine({ sys_webhook: [webhook({ triggers: 'bulk_update' })] });
        const realtime = new FakeRealtime();
        const { enqueue, calls } = makeRecorder();
        const ae = new AutoEnqueuer(engine, realtime, enqueue, { refreshIntervalMs: 0 });
        await ae.start();

        await realtime.publish(bulkEvent('updated', 'contact', 40));
        await flush();

        expect(calls).toHaveLength(1);
        expect(calls[0].label).toBe('data.records.updated');
        const payload = calls[0].payload as any;
        expect(payload.matched).toBe(40);
        expect(payload.object).toBe('contact');
        expect(payload.action).toBe('updated');
        // No record to name — that is the contract, not an omission.
        expect(payload.recordId).toBeUndefined();
        expect(payload.after).toBeUndefined();
        await ae.stop();
    });

    it('dispatches data.records.deleted to a bulk_delete subscriber', async () => {
        const engine = new FakeEngine({ sys_webhook: [webhook({ triggers: ['bulk_delete'] })] });
        const realtime = new FakeRealtime();
        const { enqueue, calls } = makeRecorder();
        const ae = new AutoEnqueuer(engine, realtime, enqueue, { refreshIntervalMs: 0 });
        await ae.start();

        await realtime.publish(bulkEvent('deleted', 'contact', 7));
        await flush();

        expect(calls).toHaveLength(1);
        expect(calls[0].label).toBe('data.records.deleted');
        expect((calls[0].payload as any).matched).toBe(7);
        await ae.stop();
    });

    it('does NOT deliver a bulk event to a per-record update subscriber', async () => {
        // The opt-in half of the decision: an existing `update` webhook keeps
        // receiving only bodies shaped the way it already reads them.
        const engine = new FakeEngine({ sys_webhook: [webhook({ triggers: 'create,update,delete' })] });
        const realtime = new FakeRealtime();
        const { enqueue, calls } = makeRecorder();
        const ae = new AutoEnqueuer(engine, realtime, enqueue, { refreshIntervalMs: 0 });
        await ae.start();

        await realtime.publish(bulkEvent('updated', 'contact', 40));
        await realtime.publish(bulkEvent('deleted', 'contact', 40));
        await flush();

        expect(calls).toHaveLength(0);
        await ae.stop();
    });

    it('does NOT deliver a per-record event to a bulk-only subscriber', async () => {
        const engine = new FakeEngine({ sys_webhook: [webhook({ triggers: 'bulk_update,bulk_delete' })] });
        const realtime = new FakeRealtime();
        const { enqueue, calls } = makeRecorder();
        const ae = new AutoEnqueuer(engine, realtime, enqueue, { refreshIntervalMs: 0 });
        await ae.start();

        await realtime.publish(event('updated', 'contact', { id: 'c-1' }));
        await flush();

        expect(calls).toHaveLength(0);
        await ae.stop();
    });

    it('drops an off-contract bulk event instead of guessing a count', async () => {
        const engine = new FakeEngine({ sys_webhook: [webhook({ triggers: 'bulk_update' })] });
        const realtime = new FakeRealtime();
        const { enqueue, calls } = makeRecorder();
        const warn = vi.fn();
        const ae = new AutoEnqueuer(engine, realtime, enqueue, { refreshIntervalMs: 0, logger: { warn } });
        await ae.start();

        // `matched` is the entire substance of a bulk delivery: a wrong one is
        // worse than none, so the event is dropped loudly (same discipline as
        // the #4626 per-record `recordId` check).
        await realtime.publish({
            type: 'data.records.updated',
            object: 'contact',
            payload: { id: randomUUID(), type: 'data.records.updated', object: 'contact' },
            timestamp: '2026-05-24T00:00:00.000Z',
        });
        await flush();

        expect(calls).toHaveLength(0);
        expect(warn).toHaveBeenCalledWith(
            expect.stringContaining('BulkDataEvent'),
            expect.anything(),
        );
        await ae.stop();
    });

    it('dedups on the event uuid, so same-millisecond sweeps do not collapse', async () => {
        const engine = new FakeEngine({ sys_webhook: [webhook({ triggers: 'bulk_delete' })] });
        const realtime = new FakeRealtime();
        const { enqueue, calls } = makeRecorder();
        const ae = new AutoEnqueuer(engine, realtime, enqueue, { refreshIntervalMs: 0 });
        await ae.start();

        // Two DISTINCT sweeps sharing a timestamp. A `${object}:${action}:${ts}`
        // key would silently drop the second; the producer's per-event uuid
        // keeps them apart.
        const ts = '2026-05-24T00:00:00.000Z';
        const first = bulkEvent('deleted', 'contact', 3, ts);
        const second = bulkEvent('deleted', 'contact', 5, ts);
        await realtime.publish(first);
        await realtime.publish(second);
        await flush();
        expect(calls).toHaveLength(2);

        // …while a genuine redelivery of the SAME event still collapses.
        await realtime.publish(first);
        await flush();
        expect(calls).toHaveLength(2);
        await ae.stop();
    });

    it('self-heals the cache when sys_webhook is changed by a predicate write', async () => {
        // Deactivating every webhook on an object is a bulk update. If only
        // `data.record.*` refreshed the cache, the enqueuer would keep
        // dispatching from rows the admin just turned off.
        const engine = new FakeEngine({ sys_webhook: [webhook()] });
        const realtime = new FakeRealtime();
        const { enqueue, calls } = makeRecorder();
        const ae = new AutoEnqueuer(engine, realtime, enqueue, { refreshIntervalMs: 0 });
        await ae.start();

        engine.rows.sys_webhook[0].active = false;
        await realtime.publish(bulkEvent('updated', 'sys_webhook', 1));
        await flush();

        await realtime.publish(event('created', 'contact', { id: 'c-1' }));
        await flush();

        expect(calls).toHaveLength(0);
        await ae.stop();
    });
});
