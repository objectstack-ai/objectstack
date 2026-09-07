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
import { assertEngineFindOnePredicate } from '@objectstack/metadata-core';

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
        assertEngineFindOnePredicate(name, q);
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
    // [#13566] The RECORD's organization, the way the engine stamps it
    // (#14970). Omitted = the spec's one spelling for "belongs to no
    // organization"; the schema refuses the empty string.
    extra: { organizationId?: string } = {},
): RealtimeEventPayload {
    const payload = DataEventSchema.parse({
        id: randomUUID(),
        type: `data.record.${type}`,
        object,
        recordId: String(record.id),
        ...(type === 'deleted' ? {} : { after: record }),
        ...(extra.organizationId !== undefined ? { organizationId: extra.organizationId } : {}),
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
    // [#13566] The ONE organization the tenant wall named for the batch, the
    // way the engine stamps it (#15225 / #15813). Omitted = "the producer did
    // not assert one organization for the batch" — a routine value there.
    extra: { organizationId?: string } = {},
): RealtimeEventPayload {
    const payload = BulkDataEventSchema.parse({
        id: randomUUID(),
        type: `data.records.${type}`,
        object,
        ...(extra.organizationId !== undefined ? { organizationId: extra.organizationId } : {}),
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

    // [#13546] The delivery row belongs to the SUBSCRIPTION's organization —
    // `sys_webhook` is organization-scoped (#8554), the enqueuer runs
    // fire-and-forget off the write path with no request context, so the
    // subscription row is the one honest tenant source. Without the stamp the
    // row lands `organization_id = NULL` — the driver's global-row arm — and
    // the redeliver() cross-organization wall (#10740) excludes nothing.
    it("stamps the subscription's organization onto the enqueue input (#13546)", async () => {
        const engine = new FakeEngine({
            sys_webhook: [webhook({ organization_id: 'org_pin_alpha' })],
        });
        const realtime = new FakeRealtime();
        const { enqueue, calls } = makeRecorder();
        const ae = new AutoEnqueuer(engine, realtime, enqueue, { refreshIntervalMs: 0 });
        await ae.start();

        // [#13566] The event names the subscription's own organization: an
        // organization-owned subscription receives only its organization's
        // events now, so the stamp is pinned on a delivery that still happens.
        await realtime.publish(event('created', 'contact', { id: 'c-1' }, undefined, { organizationId: 'org_pin_alpha' }));
        await flush();

        expect(calls).toHaveLength(1);
        // Verbatim from the sys_webhook row — threaded, never fabricated.
        expect(calls[0].organizationId).toBe('org_pin_alpha');
        await ae.stop();
    });

    it('an org-less subscription enqueues with NO organization (the honest global-row shape, #13546)', async () => {
        // The over-denial control: a `single`-posture install has org-less
        // sys_webhook rows, and their events must still deliver — org-less,
        // never refused, never stamped with a guess.
        const engine = new FakeEngine({ sys_webhook: [webhook()] });
        const realtime = new FakeRealtime();
        const { enqueue, calls } = makeRecorder();
        const ae = new AutoEnqueuer(engine, realtime, enqueue, { refreshIntervalMs: 0 });
        await ae.start();

        await realtime.publish(event('created', 'contact', { id: 'c-1' }));
        await flush();

        expect(calls).toHaveLength(1);
        expect(calls[0].organizationId).toBeUndefined();
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

    it("the bulk path stamps the subscription's organization too (#13546)", async () => {
        // Same tenant seam as the per-record path — a bulk delivery for an
        // organization-owned subscription must not land as a global row either.
        const engine = new FakeEngine({
            sys_webhook: [webhook({ triggers: 'bulk_update', organization_id: 'org_pin_alpha' })],
        });
        const realtime = new FakeRealtime();
        const { enqueue, calls } = makeRecorder();
        const ae = new AutoEnqueuer(engine, realtime, enqueue, { refreshIntervalMs: 0 });
        await ae.start();

        // [#13566] Same as the per-record pin: the batch is attributed to the
        // subscription's own organization, so the delivery still happens.
        await realtime.publish(bulkEvent('updated', 'contact', 3, undefined, { organizationId: 'org_pin_alpha' }));
        await flush();

        expect(calls).toHaveLength(1);
        expect(calls[0].organizationId).toBe('org_pin_alpha');
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

/**
 * #13566 — the organization dimension of the match.
 *
 * On a walled deployment (`OS_TENANCY_POSTURE=isolated|group`) every
 * organization's `sys_webhook` rows sit in ONE cache keyed by object name, and
 * the producers now stamp the event with the organization the record belongs
 * to (#14970) or the one the tenant wall named for the batch (#15225 /
 * #15813). Matching on object name alone delivered organization A's records
 * to organization B's endpoint, signed with B's secret.
 *
 * ⭐ Every pin here asserts on WHICH SUBSCRIPTIONS THE ENQUEUER SELECTED —
 * the `refId`s handed to the enqueue seam — never on delivery rows. #13565
 * stamps each delivery with the SUBSCRIPTION's organization, so a leaked
 * delivery reads as natively owned by the receiver while carrying the
 * sender's payload: a test over `sys_http_delivery` rows passes on a live
 * leak.
 */
describe('AutoEnqueuer — organization dimension (#13566)', () => {
    const selected = (calls: EnqueueHttpInput[]) => calls.map((c) => c.refId).sort();

    describe('per-record path (data.record.*)', () => {
        it("fans out ONLY to the subscription of the organization the record belongs to", async () => {
            // The leak pin. Two organizations, each with its own webhook on
            // `contact`; before the fix both received both organizations'
            // records.
            const engine = new FakeEngine({
                sys_webhook: [
                    webhook({ id: 'wh-a', name: 'a', organization_id: 'org_a' }),
                    webhook({ id: 'wh-b', name: 'b', organization_id: 'org_b' }),
                ],
            });
            const realtime = new FakeRealtime();
            const { enqueue, calls } = makeRecorder();
            const warn = vi.fn();
            const ae = new AutoEnqueuer(engine, realtime, enqueue, { refreshIntervalMs: 0, logger: { warn } });
            await ae.start();

            await realtime.publish(event('created', 'contact', { id: 'c-a' }, undefined, { organizationId: 'org_a' }));
            await flush();
            expect(selected(calls)).toEqual(['wh-a']);

            await realtime.publish(
                event('updated', 'contact', { id: 'c-b' }, '2026-05-24T00:00:01.000Z', { organizationId: 'org_b' }),
            );
            await flush();
            expect(selected(calls)).toEqual(['wh-a', 'wh-b']);
            expect(calls.find((c) => c.refId === 'wh-b')!.organizationId).toBe('org_b');
            expect((calls.find((c) => c.refId === 'wh-b')!.payload as any).recordId).toBe('c-b');
            // A foreign organization's subscription is simply not a candidate
            // — the match term working, not a refusal worth a warning.
            expect(warn).not.toHaveBeenCalled();
            await ae.stop();
        });

        it('an org-less subscription does NOT receive an organization-walled record event — loud, once', async () => {
            // The ruling's case, verbatim: a subscription with no organisation
            // ownership does not fan out — loud refusal, never a silent
            // cross-organisation delivery.
            const engine = new FakeEngine({ sys_webhook: [webhook()] });
            const realtime = new FakeRealtime();
            const { enqueue, calls } = makeRecorder();
            const warn = vi.fn();
            const debug = vi.fn();
            const ae = new AutoEnqueuer(engine, realtime, enqueue, {
                refreshIntervalMs: 0,
                logger: { warn, debug },
            });
            await ae.start();

            await realtime.publish(event('created', 'contact', { id: 'c-1' }, undefined, { organizationId: 'org_a' }));
            await flush();
            expect(selected(calls)).toEqual([]);
            expect(warn).toHaveBeenCalledTimes(1);
            expect(warn).toHaveBeenCalledWith(
                expect.stringContaining('belongs to NO organization'),
                expect.objectContaining({ id: 'wh-1', type: 'data.record.created', object: 'contact' }),
            );
            expect(String(warn.mock.calls[0][0])).toContain('refusing to fan out');

            // Said once per subscription: the next refused event, from another
            // organization even, is debug-level.
            await realtime.publish(
                event('created', 'contact', { id: 'c-2' }, '2026-05-24T00:00:01.000Z', { organizationId: 'org_b' }),
            );
            await flush();
            expect(selected(calls)).toEqual([]);
            expect(warn).toHaveBeenCalledTimes(1);
            expect(debug).toHaveBeenCalledWith(expect.stringContaining('still refused'), expect.objectContaining({ id: 'wh-1' }));
            await ae.stop();
        });

        it('an organization-owned subscription does NOT receive a record event that names no organization (fail-closed)', async () => {
            // Absent on a DataEvent is "belongs to no organization" — an
            // environment-wide row, an object outside the wall, or the producer
            // publishing absent rather than substituting the caller's org when it
            // had no row in hand. None of those names organization A.
            const engine = new FakeEngine({ sys_webhook: [webhook({ organization_id: 'org_a' })] });
            const realtime = new FakeRealtime();
            const { enqueue, calls } = makeRecorder();
            const warn = vi.fn();
            const ae = new AutoEnqueuer(engine, realtime, enqueue, { refreshIntervalMs: 0, logger: { warn } });
            await ae.start();

            await realtime.publish(event('created', 'contact', { id: 'c-1' }));
            await flush();
            expect(selected(calls)).toEqual([]);
            expect(warn).toHaveBeenCalledTimes(1);
            expect(warn).toHaveBeenCalledWith(
                expect.stringContaining('names no organization'),
                expect.objectContaining({ id: 'wh-1', subscriptionOrganizationId: 'org_a', eventNamesOrganization: false }),
            );

            // …and its own organization's record still arrives (the positive
            // control on the same subscription).
            await realtime.publish(
                event('created', 'contact', { id: 'c-2' }, '2026-05-24T00:00:01.000Z', { organizationId: 'org_a' }),
            );
            await flush();
            expect(selected(calls)).toEqual(['wh-1']);
            await ae.stop();
        });

        it('an org-less subscription still receives an org-less record event (the single-posture control)', async () => {
            // A `single`-posture deployment stamps nothing on either side —
            // every webhook on every non-walled install lives in this cell.
            const engine = new FakeEngine({ sys_webhook: [webhook()] });
            const realtime = new FakeRealtime();
            const { enqueue, calls } = makeRecorder();
            const warn = vi.fn();
            const ae = new AutoEnqueuer(engine, realtime, enqueue, { refreshIntervalMs: 0, logger: { warn } });
            await ae.start();

            await realtime.publish(event('created', 'contact', { id: 'c-1' }));
            await flush();
            expect(selected(calls)).toEqual(['wh-1']);
            expect(calls[0].organizationId).toBeUndefined();
            expect(warn).not.toHaveBeenCalled();
            await ae.stop();
        });

        it("an any-object ('*') subscription goes through the same organization filter", async () => {
            const engine = new FakeEngine({
                sys_webhook: [
                    webhook({ id: 'wh-star-orgless', name: 'star-orgless', object_name: '' }),
                    webhook({ id: 'wh-star-a', name: 'star-a', object_name: '', organization_id: 'org_a' }),
                    webhook({ id: 'wh-star-b', name: 'star-b', object_name: '', organization_id: 'org_b' }),
                ],
            });
            const realtime = new FakeRealtime();
            const { enqueue, calls } = makeRecorder();
            const warn = vi.fn();
            const ae = new AutoEnqueuer(engine, realtime, enqueue, { refreshIntervalMs: 0, logger: { warn } });
            await ae.start();

            await realtime.publish(event('created', 'lead', { id: 'l-1' }, undefined, { organizationId: 'org_a' }));
            await flush();
            expect(selected(calls)).toEqual(['wh-star-a']);
            expect(warn).toHaveBeenCalledTimes(1);
            expect(warn).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ id: 'wh-star-orgless' }));
            await ae.stop();
        });

        it('drops a record event whose organizationId is present but off-contract, delivering to nobody', async () => {
            const engine = new FakeEngine({
                sys_webhook: [webhook({ id: 'wh-orgless' }), webhook({ id: 'wh-a', organization_id: 'org_a' })],
            });
            const realtime = new FakeRealtime();
            const { enqueue, calls } = makeRecorder();
            const warn = vi.fn();
            const ae = new AutoEnqueuer(engine, realtime, enqueue, { refreshIntervalMs: 0, logger: { warn } });
            await ae.start();

            // The schema refuses '' at the publish site; a producer that did not
            // validate is broken, and the event is dropped loudly — never
            // coerced, never read as "no organization".
            await realtime.publish({
                type: 'data.record.created',
                object: 'contact',
                payload: { recordId: 'c-1', organizationId: '' },
                timestamp: '2026-05-24T00:00:00.000Z',
            });
            await flush();
            expect(selected(calls)).toEqual([]);
            expect(warn).toHaveBeenCalledTimes(1);
            expect(String(warn.mock.calls[0][0])).toContain('off-contract');
            expect(String(warn.mock.calls[0][0])).toContain('organizationId');
            await ae.stop();
        });
    });

    describe('bulk path (data.records.*)', () => {
        it('fans out ONLY to the subscription of the organization the tenant wall named for the batch', async () => {
            const engine = new FakeEngine({
                sys_webhook: [
                    webhook({ id: 'wh-a', name: 'a', triggers: 'bulk_update', organization_id: 'org_a' }),
                    webhook({ id: 'wh-b', name: 'b', triggers: 'bulk_update', organization_id: 'org_b' }),
                ],
            });
            const realtime = new FakeRealtime();
            const { enqueue, calls } = makeRecorder();
            const warn = vi.fn();
            const ae = new AutoEnqueuer(engine, realtime, enqueue, { refreshIntervalMs: 0, logger: { warn } });
            await ae.start();

            await realtime.publish(bulkEvent('updated', 'contact', 12, undefined, { organizationId: 'org_a' }));
            await flush();
            expect(selected(calls)).toEqual(['wh-a']);
            expect((calls[0].payload as any).matched).toBe(12);
            expect(warn).not.toHaveBeenCalled();
            await ae.stop();
        });

        it('an organization-owned subscription does NOT receive a bulk event the producer could not attribute (absent = fail-closed)', async () => {
            // On the bulk path absent is a ROUTINE value: the producer stamps
            // the key only when the Layer 0 wall named exactly one organization
            // (#15687). A system sweep or a cross-membership `group` write
            // publishes it absent, and the contract says a tenant-scoped
            // consumer must not deliver that inside an organization wall.
            const engine = new FakeEngine({
                sys_webhook: [webhook({ triggers: 'bulk_update,bulk_delete', organization_id: 'org_a' })],
            });
            const realtime = new FakeRealtime();
            const { enqueue, calls } = makeRecorder();
            const warn = vi.fn();
            const ae = new AutoEnqueuer(engine, realtime, enqueue, { refreshIntervalMs: 0, logger: { warn } });
            await ae.start();

            await realtime.publish(bulkEvent('updated', 'contact', 40));
            await realtime.publish(bulkEvent('deleted', 'contact', 3));
            await flush();
            expect(selected(calls)).toEqual([]);
            expect(warn).toHaveBeenCalledTimes(1); // said once, not once per event
            expect(warn).toHaveBeenCalledWith(
                expect.stringContaining('names no organization'),
                expect.objectContaining({ id: 'wh-1', type: 'data.records.updated', eventNamesOrganization: false }),
            );

            // Positive control on the same subscription: a batch the wall
            // attributed to its organization is delivered.
            await realtime.publish(bulkEvent('updated', 'contact', 5, undefined, { organizationId: 'org_a' }));
            await flush();
            expect(selected(calls)).toEqual(['wh-1']);
            await ae.stop();
        });

        it('an org-less subscription receives an unattributed bulk event (the deployment-wide consumer the contract names)', async () => {
            const engine = new FakeEngine({ sys_webhook: [webhook({ triggers: 'bulk_update' })] });
            const realtime = new FakeRealtime();
            const { enqueue, calls } = makeRecorder();
            const warn = vi.fn();
            const ae = new AutoEnqueuer(engine, realtime, enqueue, { refreshIntervalMs: 0, logger: { warn } });
            await ae.start();

            await realtime.publish(bulkEvent('updated', 'contact', 40));
            await flush();
            expect(selected(calls)).toEqual(['wh-1']);
            expect(warn).not.toHaveBeenCalled();
            await ae.stop();
        });

        it('an org-less subscription does NOT receive an organization-walled bulk event — loud, once', async () => {
            const engine = new FakeEngine({ sys_webhook: [webhook({ triggers: 'bulk_update' })] });
            const realtime = new FakeRealtime();
            const { enqueue, calls } = makeRecorder();
            const warn = vi.fn();
            const ae = new AutoEnqueuer(engine, realtime, enqueue, { refreshIntervalMs: 0, logger: { warn } });
            await ae.start();

            await realtime.publish(bulkEvent('updated', 'contact', 40, undefined, { organizationId: 'org_a' }));
            await realtime.publish(bulkEvent('updated', 'contact', 41, undefined, { organizationId: 'org_b' }));
            await flush();
            expect(selected(calls)).toEqual([]);
            expect(warn).toHaveBeenCalledTimes(1);
            expect(warn).toHaveBeenCalledWith(
                expect.stringContaining('belongs to NO organization'),
                expect.objectContaining({ id: 'wh-1', type: 'data.records.updated' }),
            );
            await ae.stop();
        });

        it('drops a bulk event whose organizationId is present but off-contract, delivering to nobody', async () => {
            const engine = new FakeEngine({
                sys_webhook: [
                    webhook({ id: 'wh-orgless', triggers: 'bulk_update' }),
                    webhook({ id: 'wh-a', triggers: 'bulk_update', organization_id: 'org_a' }),
                ],
            });
            const realtime = new FakeRealtime();
            const { enqueue, calls } = makeRecorder();
            const warn = vi.fn();
            const ae = new AutoEnqueuer(engine, realtime, enqueue, { refreshIntervalMs: 0, logger: { warn } });
            await ae.start();

            await realtime.publish({
                type: 'data.records.updated',
                object: 'contact',
                payload: { id: randomUUID(), type: 'data.records.updated', object: 'contact', matched: 4, organizationId: 42 },
                timestamp: '2026-05-24T00:00:00.000Z',
            });
            await flush();
            expect(selected(calls)).toEqual([]);
            expect(warn).toHaveBeenCalledTimes(1);
            expect(String(warn.mock.calls[0][0])).toContain('off-contract bulk data event');
            expect(String(warn.mock.calls[0][0])).toContain('organizationId');
            await ae.stop();
        });
    });

    it('the say-once ledger forgets a row the refresh no longer sees, so a re-created row reports again', async () => {
        const engine = new FakeEngine({ sys_webhook: [webhook()] });
        const realtime = new FakeRealtime();
        const { enqueue, calls } = makeRecorder();
        const warn = vi.fn();
        const ae = new AutoEnqueuer(engine, realtime, enqueue, { refreshIntervalMs: 0, logger: { warn } });
        await ae.start();

        await realtime.publish(event('created', 'contact', { id: 'c-1' }, undefined, { organizationId: 'org_a' }));
        await flush();
        expect(warn).toHaveBeenCalledTimes(1);

        // Row deleted → refresh prunes the ledger; row re-created under the
        // same id → its first refusal is loud again.
        engine.rows.sys_webhook = [];
        await ae.refresh();
        engine.rows.sys_webhook = [webhook()];
        await ae.refresh();
        await realtime.publish(
            event('created', 'contact', { id: 'c-2' }, '2026-05-24T00:00:01.000Z', { organizationId: 'org_a' }),
        );
        await flush();
        expect(selected(calls)).toEqual([]);
        expect(warn).toHaveBeenCalledTimes(2);
        await ae.stop();
    });
});
