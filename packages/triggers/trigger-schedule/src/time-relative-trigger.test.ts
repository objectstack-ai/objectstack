// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, vi } from 'vitest';
import type { AutomationContext, JobSchedule, JobHandler } from '@objectstack/spec/contracts';
import {
    TimeRelativeTrigger,
    computeDateWindows,
    computeWindowClaimScopes,
    buildWindowWhere,
    type FlowDispatchClaimSurface,
    type TimeRelativeDataEngine,
    type FlowTriggerBinding,
    type JobServiceSurface,
    type TriggerLogger,
} from './index.js';
import { TimeRelativeTriggerPlugin } from './time-relative-plugin.js';

// ─── Test doubles ───────────────────────────────────────────────────

interface ScheduledJob {
    name: string;
    schedule: JobSchedule;
    handler: JobHandler;
}

/** Fake IJobService slice: records schedule()/cancel() and can fire a job. */
function fakeJobService() {
    const jobs = new Map<string, ScheduledJob>();
    const service: JobServiceSurface = {
        async schedule(name, schedule, handler) {
            jobs.set(name, { name, schedule, handler });
        },
        async cancel(name) {
            jobs.delete(name);
        },
    };
    return {
        service,
        jobs,
        async fire(name: string, jobId = 'run1') {
            await jobs.get(name)?.handler({ jobId });
        },
    };
}

type Row = Record<string, unknown>;

interface FindCall {
    objectName: string;
    where: Record<string, unknown>;
    limit?: number;
    context?: { isSystem?: boolean; tenantId?: string };
}

/**
 * Fake ObjectQL surface. `find` filters the dataset by the date-field range in
 * the `where` (compared temporally, exactly as the real driver does after
 * per-column coercion) plus any scalar equality keys, and records every call so
 * tests can assert the emitted filter shape.
 */
function fakeDataEngine(rows: Row[], knownObjects: string[] = ['contracts']) {
    const calls: FindCall[] = [];
    const engine: TimeRelativeDataEngine = {
        async find(objectName, query) {
            const where = (query?.where ?? {}) as Record<string, unknown>;
            calls.push({ objectName, where, limit: query?.limit, context: query?.context });
            const out = rows.filter((row) => matches(row, where));
            return typeof query?.limit === 'number' ? out.slice(0, query.limit) : out;
        },
        getObject(name) {
            return knownObjects.includes(name) ? { name } : undefined;
        },
    };
    return { engine, calls };
}

/**
 * [#16659] A fake ObjectQL surface that HONOURS `context.tenantId`, so the
 * differential control can put matching rows in two organizations and observe
 * which ones come back.
 *
 * The scope it implements is the SQL driver's documented one — `tenantId`
 * present ⇒ `(organization_id = :tenant OR organization_id IS NULL)`; `tenantId`
 * absent ⇒ no predicate at all, which is exactly how the unfixed sweep read.
 * ⛔ Not a convenience double that filters whatever it is handed: the "absent"
 * arm has to reproduce the DEFECT, or ablating the fix would still look scoped.
 */
function tenantScopedDataEngine(rows: Row[], knownObjects: string[] = ['contracts']) {
    const calls: FindCall[] = [];
    const engine: TimeRelativeDataEngine = {
        async find(objectName, query) {
            const where = (query?.where ?? {}) as Record<string, unknown>;
            calls.push({ objectName, where, limit: query?.limit, context: query?.context });
            const tenant = query?.context?.tenantId;
            const scoped = rows.filter((row) => {
                if (tenant === undefined) return true;
                const org = row.organization_id;
                return org === tenant || org == null;
            });
            const out = scoped.filter((row) => matches(row, where));
            return typeof query?.limit === 'number' ? out.slice(0, query.limit) : out;
        },
        getObject(name) {
            return knownObjects.includes(name) ? { name } : undefined;
        },
    };
    return { engine, calls };
}

/** Minimal where matcher: temporal range on the date field + scalar equality. */
function matches(row: Row, where: Record<string, unknown>): boolean {
    for (const [key, cond] of Object.entries(where)) {
        if (key.startsWith('$')) throw new Error(`fake driver: unsupported operator ${key}`);
        const val = row[key];
        if (cond && typeof cond === 'object' && !Array.isArray(cond)) {
            const c = cond as Record<string, unknown>;
            const t = typeof val === 'string' || val instanceof Date ? Date.parse(String(val)) : NaN;
            if ('$gte' in c && !(t >= Date.parse(String(c.$gte)))) return false;
            if ('$lte' in c && !(t <= Date.parse(String(c.$lte)))) return false;
        } else if (val !== cond) {
            return false;
        }
    }
    return true;
}

function silentLogger(): TriggerLogger {
    return { info: () => {}, warn: () => {}, debug: () => {} };
}

/** Fixed reference clock: 2026-07-18 (noon UTC). */
const NOW = () => new Date('2026-07-18T12:00:00.000Z');

/**
 * [#16659] The organization every fixture binding declares. Named rather than
 * inlined because it is now asserted from two directions — the sweep's query
 * scope and the launched run's identity — and a literal repeated at both ends
 * of that pair can drift into agreeing with itself.
 */
const TEST_ORG = 'org_2mtx1w9d0k4bqf7v';

function binding(timeRelative: unknown, overrides: Partial<FlowTriggerBinding> = {}): FlowTriggerBinding {
    return {
        flowName: 'renewal_alert',
        object: 'contracts',
        config: { timeRelative },
        // [#16659] see the schedule trigger's fixture note.
        organization: TEST_ORG,
        ...overrides,
    };
}

const flush = () => new Promise<void>((r) => setTimeout(r, 0));

// ─── computeDateWindows (pure) ──────────────────────────────────────

describe('computeDateWindows', () => {
    const now = new Date('2026-07-18T12:00:00.000Z');

    it('withinDays > 0 → one window [startOfToday, endOf(today+N)]', () => {
        const w = computeDateWindows({ object: 'c', dateField: 'd', withinDays: 60 }, now);
        expect(w).toEqual([{ gte: '2026-07-18T00:00:00.000Z', lte: '2026-09-16T23:59:59.999Z' }]);
    });

    it('withinDays === 0 → just today', () => {
        const w = computeDateWindows({ object: 'c', dateField: 'd', withinDays: 0 }, now);
        expect(w).toEqual([{ gte: '2026-07-18T00:00:00.000Z', lte: '2026-07-18T23:59:59.999Z' }]);
    });

    it('withinDays < 0 → overdue lookback [startOf(today-|N|), endOfToday]', () => {
        const w = computeDateWindows({ object: 'c', dateField: 'd', withinDays: -14 }, now);
        expect(w).toEqual([{ gte: '2026-07-04T00:00:00.000Z', lte: '2026-07-18T23:59:59.999Z' }]);
    });

    it('offsetDays → one single-day window per offset', () => {
        const w = computeDateWindows({ object: 'c', dateField: 'd', offsetDays: [60, 30, 7] }, now);
        expect(w).toEqual([
            { gte: '2026-09-16T00:00:00.000Z', lte: '2026-09-16T23:59:59.999Z' },
            { gte: '2026-08-17T00:00:00.000Z', lte: '2026-08-17T23:59:59.999Z' },
            { gte: '2026-07-25T00:00:00.000Z', lte: '2026-07-25T23:59:59.999Z' },
        ]);
    });

    it('is independent of the time-of-day of `now` (day-granular)', () => {
        const morning = computeDateWindows({ object: 'c', dateField: 'd', withinDays: 7 }, new Date('2026-07-18T00:01:00Z'));
        const night = computeDateWindows({ object: 'c', dateField: 'd', withinDays: 7 }, new Date('2026-07-18T23:59:00Z'));
        expect(morning).toEqual(night);
    });
});

describe('buildWindowWhere', () => {
    const window = { gte: '2026-07-18T00:00:00.000Z', lte: '2026-09-16T23:59:59.999Z' };

    it('ANDs the static filter with the date range', () => {
        const where = buildWindowWhere(
            { object: 'contracts', dateField: 'end_date', withinDays: 60, filter: { status: 'active' } },
            window,
        );
        expect(where).toEqual({ status: 'active', end_date: { $gte: window.gte, $lte: window.lte } });
    });

    it('emits just the date range when there is no filter', () => {
        const where = buildWindowWhere({ object: 'contracts', dateField: 'end_date', withinDays: 60 }, window);
        expect(where).toEqual({ end_date: { $gte: window.gte, $lte: window.lte } });
    });
});

// ─── TimeRelativeTrigger ─────────────────────────────────────────────

describe('TimeRelativeTrigger', () => {
    it('schedules a daily sweep with the explicit schedule descriptor', async () => {
        const job = fakeJobService();
        const { engine } = fakeDataEngine([]);
        const trigger = new TimeRelativeTrigger(() => job.service, () => engine, silentLogger(), NOW);

        trigger.start(
            binding(
                { object: 'contracts', dateField: 'end_date', withinDays: 60 },
                { schedule: { type: 'cron', expression: '0 6 * * *' } },
            ),
            async () => {},
        );
        await flush();

        expect(job.jobs.size).toBe(1);
        expect(job.jobs.get('flow-time-relative:renewal_alert')?.schedule).toEqual({
            type: 'cron',
            expression: '0 6 * * *',
        });
    });

    it('defaults to a daily cron when the flow declares no schedule', async () => {
        const job = fakeJobService();
        const { engine } = fakeDataEngine([]);
        const trigger = new TimeRelativeTrigger(() => job.service, () => engine, silentLogger(), NOW);

        trigger.start(binding({ object: 'contracts', dateField: 'end_date', withinDays: 30 }), async () => {});
        await flush();

        expect(job.jobs.get('flow-time-relative:renewal_alert')?.schedule).toEqual({
            type: 'cron',
            expression: '0 8 * * *',
        });
    });

    it('queries the window and launches the flow once per matching record', async () => {
        const rows: Row[] = [
            { id: 'c1', end_date: '2026-08-01T00:00:00.000Z', status: 'active' }, // in 60d window
            { id: 'c2', end_date: '2026-12-31T00:00:00.000Z', status: 'active' }, // out of window
            { id: 'c3', end_date: '2026-07-25T00:00:00.000Z', status: 'active' }, // in window
        ];
        const job = fakeJobService();
        const { engine, calls } = fakeDataEngine(rows);
        const trigger = new TimeRelativeTrigger(() => job.service, () => engine, silentLogger(), NOW);
        const seen: AutomationContext[] = [];

        trigger.start(
            binding({ object: 'contracts', dateField: 'end_date', withinDays: 60, filter: { status: 'active' } }),
            async (ctx) => {
                seen.push(ctx);
            },
        );
        await flush();
        await job.fire('flow-time-relative:renewal_alert');

        // Only c1 + c3 fall in [today, today+60d].
        expect(seen.map((c) => (c.record as Row).id)).toEqual(['c1', 'c3']);
        // Context is record-shaped (so `{record.x}` + start conditions work).
        expect(seen[0]).toMatchObject({ object: 'contracts', event: 'time_relative' });
        expect(seen[0].record).toBe(seen[0].params);
        // The sweep queries as a system op (sees all rows, RLS-bypassing) AND
        // inside its declared organization. [#16659] This assertion used to
        // read `{ isSystem: true }` and it was pinning the defect: `isSystem`
        // is AUTHORIZATION and `tenantId` is TENANCY, and a sweep carrying only
        // the first selects across every tenant while its runs act as one.
        // ⛔ Do not relax it back to a subset match — the exact-equality is
        // what makes "the sweep asks for no scope" red.
        expect(calls[0].context).toEqual({ isSystem: true, tenantId: TEST_ORG });
        expect(calls[0].where).toEqual({
            status: 'active',
            end_date: { $gte: '2026-07-18T00:00:00.000Z', $lte: '2026-09-16T23:59:59.999Z' },
        });
    });

    it('offset mode fires one query per offset and dedups records by id', async () => {
        const rows: Row[] = [
            { id: 'c1', end_date: '2026-09-16T09:00:00.000Z' }, // T-60
            { id: 'c2', end_date: '2026-07-25T09:00:00.000Z' }, // T-7
        ];
        const job = fakeJobService();
        const { engine, calls } = fakeDataEngine(rows);
        const trigger = new TimeRelativeTrigger(() => job.service, () => engine, silentLogger(), NOW);
        const launched: string[] = [];

        trigger.start(
            binding({ object: 'contracts', dateField: 'end_date', offsetDays: [60, 30, 7] }),
            async (ctx) => {
                launched.push((ctx.record as Row).id as string);
            },
        );
        await flush();
        await job.fire('flow-time-relative:renewal_alert');

        expect(calls).toHaveLength(3); // one find per offset
        expect(launched.sort()).toEqual(['c1', 'c2']); // each fired exactly once
    });

    it('caps the number of records launched per sweep at maxRecords (and warns)', async () => {
        const rows: Row[] = Array.from({ length: 5 }, (_, i) => ({
            id: `c${i}`,
            end_date: '2026-07-20T00:00:00.000Z',
        }));
        const job = fakeJobService();
        const { engine } = fakeDataEngine(rows);
        const warn = vi.fn();
        const trigger = new TimeRelativeTrigger(
            () => job.service,
            () => engine,
            { info: () => {}, warn, debug: () => {} },
            NOW,
        );
        const launched: string[] = [];

        trigger.start(
            binding({ object: 'contracts', dateField: 'end_date', withinDays: 30, maxRecords: 2 }),
            async (ctx) => {
                launched.push((ctx.record as Row).id as string);
            },
        );
        await flush();
        await job.fire('flow-time-relative:renewal_alert');

        expect(launched).toHaveLength(2);
        expect(warn).toHaveBeenCalledWith(expect.stringContaining('2-record cap'));
    });

    it('isolates a per-record failure so the rest of the batch still runs', async () => {
        const rows: Row[] = [
            { id: 'c1', end_date: '2026-07-20T00:00:00.000Z' },
            { id: 'boom', end_date: '2026-07-21T00:00:00.000Z' },
            { id: 'c3', end_date: '2026-07-22T00:00:00.000Z' },
        ];
        const job = fakeJobService();
        const { engine } = fakeDataEngine(rows);
        const error = vi.fn();
        const trigger = new TimeRelativeTrigger(
            () => job.service,
            () => engine,
            { info: () => {}, warn: () => {}, debug: () => {}, error },
            NOW,
        );
        const ok: string[] = [];

        trigger.start(binding({ object: 'contracts', dateField: 'end_date', withinDays: 30 }), async (ctx) => {
            const id = (ctx.record as Row).id as string;
            if (id === 'boom') throw new Error('flow blew up');
            ok.push(id);
        });
        await flush();
        await expect(job.fire('flow-time-relative:renewal_alert')).resolves.toBeUndefined();

        expect(ok).toEqual(['c1', 'c3']);
        expect(error).toHaveBeenCalledWith(expect.stringContaining("record 'boom'"));
    });

    it('isolates a query failure so the job runner is never broken', async () => {
        const job = fakeJobService();
        const engine: TimeRelativeDataEngine = {
            async find() {
                throw new Error('db down');
            },
        };
        const warn = vi.fn();
        const trigger = new TimeRelativeTrigger(
            () => job.service,
            () => engine,
            { info: () => {}, warn, debug: () => {} },
            NOW,
        );

        trigger.start(binding({ object: 'contracts', dateField: 'end_date', withinDays: 30 }), async () => {});
        await flush();

        await expect(job.fire('flow-time-relative:renewal_alert')).resolves.toBeUndefined();
        expect(warn).toHaveBeenCalledWith(expect.stringContaining('sweep failed'));
    });

    it('does not bind when the timeRelative descriptor is invalid', async () => {
        const job = fakeJobService();
        const { engine } = fakeDataEngine([]);
        const warn = vi.fn();
        const trigger = new TimeRelativeTrigger(
            () => job.service,
            () => engine,
            { info: () => {}, warn, debug: () => {} },
            NOW,
        );

        // Neither withinDays nor offsetDays → invalid.
        trigger.start(binding({ object: 'contracts', dateField: 'end_date' }), async () => {});
        await flush();

        expect(job.jobs.size).toBe(0);
        expect(warn).toHaveBeenCalledWith(expect.stringContaining('no valid `timeRelative` descriptor'));
    });

    it('does not bind when both windowing modes are set (mutually exclusive)', async () => {
        const job = fakeJobService();
        const { engine } = fakeDataEngine([]);
        const trigger = new TimeRelativeTrigger(() => job.service, () => engine, silentLogger(), NOW);

        trigger.start(
            binding({ object: 'contracts', dateField: 'end_date', withinDays: 30, offsetDays: [7] }),
            async () => {},
        );
        await flush();
        expect(job.jobs.size).toBe(0);
    });

    it('warns (but still binds) when the swept object is unknown', async () => {
        const job = fakeJobService();
        const { engine } = fakeDataEngine([], ['other_object']);
        const warn = vi.fn();
        const trigger = new TimeRelativeTrigger(
            () => job.service,
            () => engine,
            { info: () => {}, warn, debug: () => {} },
            NOW,
        );

        trigger.start(binding({ object: 'contracts', dateField: 'end_date', withinDays: 30 }), async () => {});
        await flush();

        expect(job.jobs.size).toBe(1);
        expect(warn).toHaveBeenCalledWith(expect.stringContaining("unknown object 'contracts'"));
    });

    it('skips the sweep (warns) when the data engine is unavailable at fire time', async () => {
        const job = fakeJobService();
        const warn = vi.fn();
        const trigger = new TimeRelativeTrigger(
            () => job.service,
            () => null,
            { info: () => {}, warn, debug: () => {} },
            NOW,
        );

        trigger.start(binding({ object: 'contracts', dateField: 'end_date', withinDays: 30 }), async () => {});
        await flush();
        await expect(job.fire('flow-time-relative:renewal_alert')).resolves.toBeUndefined();
        expect(warn).toHaveBeenCalledWith(expect.stringContaining('data engine unavailable'));
    });

    it('stop() cancels the flow\'s sweep job; re-binding is idempotent', async () => {
        const job = fakeJobService();
        const { engine } = fakeDataEngine([]);
        const trigger = new TimeRelativeTrigger(() => job.service, () => engine, silentLogger(), NOW);

        trigger.start(binding({ object: 'contracts', dateField: 'end_date', withinDays: 30 }), async () => {});
        await flush();
        trigger.start(binding({ object: 'contracts', dateField: 'end_date', withinDays: 90 }), async () => {});
        await flush();
        expect(job.jobs.size).toBe(1); // idempotent — one job

        trigger.stop('renewal_alert');
        await flush();
        expect(job.jobs.size).toBe(0);
    });

    it('does not schedule when the job service is unavailable', () => {
        const { engine } = fakeDataEngine([]);
        const trigger = new TimeRelativeTrigger(() => null, () => engine, silentLogger(), NOW);
        expect(() =>
            trigger.start(binding({ object: 'contracts', dateField: 'end_date', withinDays: 30 }), async () => {}),
        ).not.toThrow();
    });
});

// ─── Dispatch idempotency (#10220) ──────────────────────────────────

/**
 * Fake persisted claim ledger: a Set that OUTLIVES trigger instances, so
 * sharing one across two triggers simulates a kernel rebuild against a
 * surviving `sys_flow_dispatch` table.
 */
function fakeClaimLedger() {
    const keys = new Set<string>();
    const claims: string[] = [];
    const surface: FlowDispatchClaimSurface = {
        async claim(key) {
            claims.push(key);
            if (keys.has(key)) return false;
            keys.add(key);
            return true;
        },
    };
    return { surface, keys, claims };
}

describe('TimeRelativeTrigger dispatch idempotency (#10220)', () => {
    const JOB = 'flow-time-relative:renewal_alert';

    it('offset mode: two sweeps over the same window dispatch once', async () => {
        const rows: Row[] = [{ id: 'c1', end_date: '2026-07-25T09:00:00.000Z' }]; // T+7 from NOW
        const job = fakeJobService();
        const { engine } = fakeDataEngine(rows);
        const ledger = fakeClaimLedger();
        const trigger = new TimeRelativeTrigger(
            () => job.service, () => engine, silentLogger(), NOW, () => ledger.surface,
        );
        const launched: string[] = [];

        trigger.start(binding({ object: 'contracts', dateField: 'end_date', offsetDays: [7] }), async (ctx) => {
            launched.push((ctx.record as Row).id as string);
        });
        await flush();
        await job.fire(JOB);
        await job.fire(JOB);

        expect(launched).toEqual(['c1']);
        // The key names the MATCHED WINDOW's identity (windowDay + offset + record).
        expect(ledger.claims[0]).toBe('time-relative:renewal_alert:2026-07-25:offset7:c1');
        expect(ledger.claims).toHaveLength(2); // second sweep asked and was refused
    });

    it('kernel rebuild (fresh trigger instance, same persisted ledger): still once', async () => {
        const rows: Row[] = [{ id: 'c1', end_date: '2026-07-25T09:00:00.000Z' }];
        const ledger = fakeClaimLedger();
        const launched: string[] = [];
        const desc = { object: 'contracts', dateField: 'end_date', offsetDays: [7] };

        for (let boot = 0; boot < 2; boot++) {
            const job = fakeJobService();
            const { engine } = fakeDataEngine(rows);
            // A NEW trigger instance per boot — only the ledger survives.
            const trigger = new TimeRelativeTrigger(
                () => job.service, () => engine, silentLogger(), NOW, () => ledger.surface,
            );
            trigger.start(binding(desc), async (ctx) => {
                launched.push((ctx.record as Row).id as string);
            });
            await flush();
            await job.fire(JOB);
        }

        expect(launched).toEqual(['c1']); // the rebuild did not re-mint
    });

    it('range mode: twice in one day → once; the next day → fires again (withinDays prose preserved)', async () => {
        const rows: Row[] = [{ id: 'c1', end_date: '2026-08-10T09:00:00.000Z' }]; // in [today, +30d]
        let current = new Date('2026-07-18T12:00:00.000Z');
        const clock = () => current;
        const job = fakeJobService();
        const { engine } = fakeDataEngine(rows);
        const ledger = fakeClaimLedger();
        const trigger = new TimeRelativeTrigger(
            () => job.service, () => engine, silentLogger(), clock, () => ledger.surface,
        );
        const launched: string[] = [];

        trigger.start(binding({ object: 'contracts', dateField: 'end_date', withinDays: 30 }), async (ctx) => {
            launched.push((ctx.record as Row).id as string);
        });
        await flush();
        await job.fire(JOB);
        await job.fire(JOB); // same sweep day — deduped
        expect(launched).toEqual(['c1']);
        expect(ledger.claims[0]).toBe('time-relative:renewal_alert:2026-07-18:within30:c1');

        current = new Date('2026-07-19T12:00:00.000Z'); // next day — new sweepDay, new key
        await job.fire(JOB);
        expect(launched).toEqual(['c1', 'c1']);
        expect(ledger.claims[ledger.claims.length - 1]).toBe('time-relative:renewal_alert:2026-07-19:within30:c1');
    });

    it('offset mode: a dateField edit that moves the window fires again for the NEW window', async () => {
        const row: Row = { id: 'c1', end_date: '2026-07-25T09:00:00.000Z' }; // T+7 from 07-18
        let current = new Date('2026-07-18T12:00:00.000Z');
        const clock = () => current;
        const job = fakeJobService();
        const { engine } = fakeDataEngine([row]);
        const ledger = fakeClaimLedger();
        const trigger = new TimeRelativeTrigger(
            () => job.service, () => engine, silentLogger(), clock, () => ledger.surface,
        );
        const launched: string[] = [];

        trigger.start(binding({ object: 'contracts', dateField: 'end_date', offsetDays: [7] }), async (ctx) => {
            launched.push((ctx.record as Row).id as string);
        });
        await flush();
        await job.fire(JOB);
        expect(launched).toEqual(['c1']);

        // The due date is postponed → the record leaves the old window and,
        // three days later, matches a NEW window day (07-28 = 07-21 + 7).
        row.end_date = '2026-07-28T09:00:00.000Z';
        current = new Date('2026-07-21T12:00:00.000Z');
        await job.fire(JOB);
        expect(launched).toEqual(['c1', 'c1']); // re-fired for the new window
        expect(ledger.claims[ledger.claims.length - 1]).toBe('time-relative:renewal_alert:2026-07-28:offset7:c1');
    });

    it('a claim-store failure never blocks the dispatch (availability over strict-once)', async () => {
        const rows: Row[] = [{ id: 'c1', end_date: '2026-07-25T09:00:00.000Z' }];
        const job = fakeJobService();
        const { engine } = fakeDataEngine(rows);
        const warn = vi.fn();
        const surface: FlowDispatchClaimSurface = {
            async claim() { throw new Error('ledger table unreachable'); },
        };
        const trigger = new TimeRelativeTrigger(
            () => job.service, () => engine,
            { info: () => {}, warn, debug: () => {} },
            NOW, () => surface,
        );
        const launched: string[] = [];

        trigger.start(binding({ object: 'contracts', dateField: 'end_date', offsetDays: [7] }), async (ctx) => {
            launched.push((ctx.record as Row).id as string);
        });
        await flush();
        await job.fire(JOB);

        expect(launched).toEqual(['c1']); // dispatched despite the failing claim
        expect(warn).toHaveBeenCalledWith(expect.stringContaining('dispatch-claim failed'));
    });

    it('no claim surface: in-process dedup still holds within one process, and the degradation is warned once', async () => {
        const rows: Row[] = [{ id: 'c1', end_date: '2026-07-25T09:00:00.000Z' }];
        const job = fakeJobService();
        const { engine } = fakeDataEngine(rows);
        const warn = vi.fn();
        // Four-arg construction — the pre-#10220 shape every host without an
        // automation claim() surface effectively uses.
        const trigger = new TimeRelativeTrigger(
            () => job.service, () => engine,
            { info: () => {}, warn, debug: () => {} },
            NOW,
        );
        const launched: string[] = [];

        trigger.start(binding({ object: 'contracts', dateField: 'end_date', offsetDays: [7] }), async (ctx) => {
            launched.push((ctx.record as Row).id as string);
        });
        await flush();
        await job.fire(JOB);
        await job.fire(JOB);

        expect(launched).toEqual(['c1']); // deduped in-process
        const degradations = warn.mock.calls.filter(
            (c) => typeof c[0] === 'string' && (c[0] as string).includes('IN-PROCESS ONLY'),
        );
        expect(degradations).toHaveLength(1); // said once, not per tick
    });

    it('records without an id are dispatched unconditionally (never claimed)', async () => {
        const rows: Row[] = [{ end_date: '2026-07-25T09:00:00.000Z' }]; // no id
        const job = fakeJobService();
        const { engine } = fakeDataEngine(rows);
        const ledger = fakeClaimLedger();
        const trigger = new TimeRelativeTrigger(
            () => job.service, () => engine, silentLogger(), NOW, () => ledger.surface,
        );
        let launched = 0;

        trigger.start(binding({ object: 'contracts', dateField: 'end_date', offsetDays: [7] }), async () => {
            launched++;
        });
        await flush();
        await job.fire(JOB);
        await job.fire(JOB);

        expect(launched).toBe(2); // not dedupable — unchanged pre-#10220 behaviour
        expect(ledger.claims).toHaveLength(0);
    });
});

describe('computeWindowClaimScopes', () => {
    const now = new Date('2026-07-18T12:00:00.000Z');

    it('offset mode scopes on the window day + offset', () => {
        const scopes = computeWindowClaimScopes({ object: 'c', dateField: 'd', offsetDays: [7, 30] }, now);
        expect(scopes.map((s) => s.scope)).toEqual(['2026-07-25:offset7', '2026-08-17:offset30']);
    });

    it('range mode scopes on the SWEEP day + range spec (fires daily, never twice a day)', () => {
        expect(computeWindowClaimScopes({ object: 'c', dateField: 'd', withinDays: 30 }, now)[0].scope)
            .toBe('2026-07-18:within30');
        expect(computeWindowClaimScopes({ object: 'c', dateField: 'd', withinDays: -14 }, now)[0].scope)
            .toBe('2026-07-18:within-14');
    });

    it('windows are exactly computeDateWindows (one derivation, no drift)', () => {
        const desc = { object: 'c', dateField: 'd', offsetDays: [60, 30, 7] };
        expect(computeWindowClaimScopes(desc, now).map((s) => s.window)).toEqual(computeDateWindows(desc, now));
    });
});

// ─── TimeRelativeTriggerPlugin ──────────────────────────────────────

describe('TimeRelativeTriggerPlugin', () => {
    function fakePluginCtx(services: Record<string, unknown>) {
        const readyHandlers: Array<() => Promise<void> | void> = [];
        return {
            readyHandlers,
            ctx: {
                logger: silentLogger() as TriggerLogger,
                getService<T>(name: string): T {
                    if (!(name in services)) throw new Error(`no service '${name}'`);
                    return services[name] as T;
                },
                hook(event: string, handler: () => Promise<void> | void) {
                    if (event === 'kernel:ready') readyHandlers.push(handler);
                },
            },
        };
    }

    it('registers the time_relative trigger when automation + job + objectql exist', async () => {
        const registerTrigger = vi.fn();
        const job = fakeJobService();
        const { engine } = fakeDataEngine([]);
        const fake = fakePluginCtx({ automation: { registerTrigger }, job: job.service, objectql: engine });

        const plugin = new TimeRelativeTriggerPlugin();
        await plugin.start(fake.ctx as never);
        await fake.readyHandlers[0]();

        expect(registerTrigger).toHaveBeenCalledTimes(1);
        expect((registerTrigger.mock.calls[0][0] as TimeRelativeTrigger).type).toBe('time_relative');
    });

    it('still registers when job/objectql are missing (warns, lazy pickup)', async () => {
        const registerTrigger = vi.fn();
        const fake = fakePluginCtx({ automation: { registerTrigger } });

        const plugin = new TimeRelativeTriggerPlugin();
        await plugin.start(fake.ctx as never);
        await fake.readyHandlers[0]();

        expect(registerTrigger).toHaveBeenCalledTimes(1);
    });

    it('wires the automation service claim() as the dispatch-idempotency surface (#10220)', async () => {
        const registerTrigger = vi.fn();
        const claim = vi.fn(async () => true);
        const job = fakeJobService();
        // Far-future date: the plugin wires the real wall clock, so the row
        // must sit inside [real-today, +36500d] whenever this suite runs.
        const { engine } = fakeDataEngine([{ id: 'c1', end_date: '2099-01-01T00:00:00.000Z' }]);
        const fake = fakePluginCtx({ automation: { registerTrigger, claim }, job: job.service, objectql: engine });

        const plugin = new TimeRelativeTriggerPlugin();
        await plugin.start(fake.ctx as never);
        await fake.readyHandlers[0]();

        const trigger = registerTrigger.mock.calls[0][0] as TimeRelativeTrigger;
        // Deterministic clock is a constructor-only injection, so drive the
        // sweep through a descriptor whose window is computed from real "now":
        // withinDays 36500 always includes the row's date.
        trigger.start(binding({ object: 'contracts', dateField: 'end_date', withinDays: 36_500 }), async () => {});
        await flush();
        await job.fire('flow-time-relative:renewal_alert');

        expect(claim).toHaveBeenCalledTimes(1);
        expect(claim).toHaveBeenCalledWith(expect.stringMatching(/^time-relative:renewal_alert:\d{4}-\d{2}-\d{2}:within36500:c1$/));
    });

    it('skips gracefully when the automation service is absent', async () => {
        const job = fakeJobService();
        const fake = fakePluginCtx({ job: job.service });

        const plugin = new TimeRelativeTriggerPlugin();
        await plugin.start(fake.ctx as never);
        await expect(fake.readyHandlers[0]()).resolves.toBeUndefined();
    });
});

// ─── The acting-organization refusal (#16659) ───────────────────────
//
// The time-relative sweep is NOT the weaker case for carrying an organization,
// it is the stronger one: it runs ELEVATED on purpose (`isSystem` — a
// background sweep must see every row, not the RLS-scoped subset), so the
// declaration is the only thing keeping its SELECTION inside one organization.
// An org-less sweep selects across every tenant and then launches a run that
// can write into none of them; a sweep whose declaration reached only the run
// selects across every tenant and launches runs that write into ONE, which is
// worse. Both halves are pinned below.

describe('TimeRelativeTrigger — the acting-organization refusal (#16659)', () => {
    const DESC = { object: 'contracts', dateField: 'end_date', withinDays: 60 };

    function recordingLogger(): { logger: TriggerLogger; errors: string[]; warns: string[] } {
        const errors: string[] = [];
        const warns: string[] = [];
        return {
            logger: {
                info: () => {},
                debug: () => {},
                warn: (msg: string) => void warns.push(String(msg)),
                error: (msg: string) => void errors.push(String(msg)),
            },
            errors,
            warns,
        };
    }

    it('THROWS from start() and arms no sweep, naming the flow and the key', () => {
        const job = fakeJobService();
        const { engine } = fakeDataEngine([]);
        const log = recordingLogger();
        const trigger = new TimeRelativeTrigger(() => job.service, () => engine, log.logger, NOW);

        expect(() =>
            trigger.start(binding(DESC, { organization: undefined, config: { timeRelative: DESC } }), async () => {}),
        ).toThrow(/declares no acting organization/);

        expect(job.jobs.size, 'a refused sweep must have no job at all').toBe(0);
        expect(log.errors).toHaveLength(1);
        expect(log.errors[0]).toContain('[time-relative] NOT BOUND');
        expect(log.errors[0]).toContain('renewal_alert');
        // The sentence is the time-relative one, not the plain-schedule one.
        expect(log.errors[0]).toContain('time-relative flow');
    });

    it('a hot re-publish that REMOVES the key drops the prior sweep', async () => {
        const job = fakeJobService();
        const { engine } = fakeDataEngine([]);
        const log = recordingLogger();
        const trigger = new TimeRelativeTrigger(() => job.service, () => engine, log.logger, NOW);

        trigger.start(binding(DESC), async () => {});
        await flush();
        expect(job.jobs.size, 'precondition: the declaring binding armed').toBe(1);

        expect(() =>
            trigger.start(binding(DESC, { organization: undefined, config: { timeRelative: DESC } }), async () => {}),
        ).toThrow();
        await flush();
        expect(job.jobs.size).toBe(0);
    });

    // ── the SELECTION half (#16659, F2) ───────────────────────────────────
    //
    // Declaring an organization bounded the RUN and left the QUERY unbounded,
    // so a sweep declared for A matched rows in every tenant and launched runs
    // stamped A about other organizations' records. These pins are about the
    // query.

    it('EVERY window query carries the declared organization, not just the first', async () => {
        // Offset mode issues one query per offset — a scope threaded onto only
        // the first would leave the rest crossing organizations, and a pin that
        // read `calls[0]` alone would not notice.
        const job = fakeJobService();
        const { engine, calls } = fakeDataEngine([]);
        const trigger = new TimeRelativeTrigger(() => job.service, () => engine, silentLogger(), NOW);

        trigger.start(
            binding({ object: 'contracts', dateField: 'end_date', offsetDays: [60, 30, 7] }),
            async () => {},
        );
        await flush();
        await job.fire('flow-time-relative:renewal_alert');

        expect(calls.length, 'offset mode must issue one query per offset').toBe(3);
        expect(
            calls.map((c) => c.context?.tenantId ?? 'NO-SCOPE'),
            'an unscoped window query selects every organization\'s rows',
        ).toEqual([TEST_ORG, TEST_ORG, TEST_ORG]);
        // The scope is the ONLY thing tenancy contributes: the author's filter
        // and the date window are untouched, so no organization predicate was
        // hand-built onto `where` (which would hardcode a column name the
        // object is free to rename, and select nothing where there is none).
        for (const call of calls) {
            expect(Object.keys(call.where)).toEqual(['end_date']);
        }
    });

    it('DIFFERENTIAL: with matching rows in two organizations only the declared one is swept', async () => {
        // The discriminating shape. A pin that only proved "A's rows are found"
        // passes on the defect too — the defect FOUND them, alongside B's.
        //
        // The double implements the documented driver contract rather than a
        // convenient one: `DriverOptions.tenantId` scopes to
        // `(organization_id = :tenant OR organization_id IS NULL)`
        // (sql-driver's own `tenantFieldByTable` note), and an ABSENT scope
        // applies no predicate at all — which is precisely how the unfixed
        // sweep read.
        const ORG_B = 'org_beta_0000000000000';
        const rows: Row[] = [
            { id: 'a1', end_date: '2026-07-25T00:00:00.000Z', organization_id: TEST_ORG },
            { id: 'b1', end_date: '2026-07-25T00:00:00.000Z', organization_id: ORG_B },
            { id: 'b2', end_date: '2026-07-26T00:00:00.000Z', organization_id: ORG_B },
        ];
        const job = fakeJobService();
        const { engine, calls } = tenantScopedDataEngine(rows);
        const trigger = new TimeRelativeTrigger(() => job.service, () => engine, silentLogger(), NOW);
        const seen: AutomationContext[] = [];

        trigger.start(
            binding({ object: 'contracts', dateField: 'end_date', withinDays: 60 }),
            async (ctx) => void seen.push(ctx),
        );
        await flush();
        await job.fire('flow-time-relative:renewal_alert');

        expect(
            seen.map((c) => (c.record as Row).id),
            'the sweep launched a run for a record in an organization the flow never declared',
        ).toEqual(['a1']);
        expect(
            seen.map((c) => c.tenantId),
            'and the run still acts as the declared organization',
        ).toEqual([TEST_ORG]);
        expect(calls[0].context?.tenantId, 'the scope must reach the engine, not be applied afterwards').toBe(TEST_ORG);
    });

    it('NEGATIVE CONTROL: a single-organization install selects exactly what it selected before', async () => {
        // The narrowing must remove NOTHING where there is nothing to remove.
        // Two legs over ONE fixture:
        //   A — the sweep as it ships, scoped to the declared organization;
        //   B — the SAME query with `context: { isSystem: true }` and no scope,
        //       which is the pre-fix sweep byte for byte.
        // Equal answers is the claim; ⛔ the pair is what makes it a measurement
        // rather than an argument, and the DIFFERENTIAL above is its opposite
        // limb — add a second organization and these two legs must diverge.
        //
        // The NULL-organization row is in the fixture on purpose: the driver's
        // scope is `org = :tenant OR org IS NULL`, so a platform row stays
        // visible to a scoped read. That is part of "identical", not an
        // exception to it.
        const DESC = { object: 'contracts', dateField: 'end_date', withinDays: 60 };
        const rows: Row[] = [
            { id: 'c1', end_date: '2026-07-25T00:00:00.000Z', organization_id: TEST_ORG },
            { id: 'c2', end_date: '2026-08-01T00:00:00.000Z', organization_id: TEST_ORG },
            { id: 'c3', end_date: '2026-07-20T00:00:00.000Z', organization_id: null },
        ];
        const job = fakeJobService();
        const { engine, calls } = tenantScopedDataEngine(rows);
        const trigger = new TimeRelativeTrigger(() => job.service, () => engine, silentLogger(), NOW);
        const seen: AutomationContext[] = [];

        trigger.start(binding(DESC), async (ctx) => void seen.push(ctx));
        await flush();
        await job.fire('flow-time-relative:renewal_alert');
        const scoped = seen.map((c) => (c.record as Row).id);

        // Leg B, through the same double: the query the sweep used to send.
        const window = computeDateWindows(DESC, NOW())[0];
        const before =
            (await engine.find('contracts', {
                where: buildWindowWhere(DESC, window),
                limit: 1000,
                context: { isSystem: true },
            })) ?? [];
        const unscoped = before.map((r) => r.id);

        expect(
            scoped,
            'a single-organization install must see the same rows it saw before — the scope removes nothing there',
        ).toEqual(unscoped);
        // Non-vacuity, both directions: the set is not empty, and the scope was
        // genuinely applied rather than quietly absent.
        expect(scoped, 'an empty answer would make the equality above pass with everything broken').toEqual(['c1', 'c2', 'c3']);
        expect(calls[0].context?.tenantId, 'leg A must really have asked for a scope').toBe(TEST_ORG);
    });

    it('a store that CANNOT honour the scope is reported at `error`, never answered unscoped', async () => {
        // `driver-memory` refuses any call handed a tenant scope (#16589). A
        // sweep required to stay inside one organization, talking to a store
        // that cannot keep it there, must be LOUD — "selected nothing this
        // tick" and "cannot select at all" are different facts.
        const job = fakeJobService();
        const engine: TimeRelativeDataEngine = {
            async find(_objectName, query) {
                if (query?.context?.tenantId !== undefined) {
                    throw Object.assign(new Error('[driver-memory] Refusing to answer: this driver has NO row-level tenant isolation.'), {
                        code: 'MEMORY_MULTI_TENANT_UNSUPPORTED',
                    });
                }
                return [];
            },
            getObject: () => ({ name: 'contracts' }),
        };
        const log = recordingLogger();
        const trigger = new TimeRelativeTrigger(() => job.service, () => engine, log.logger, NOW);

        trigger.start(binding({ object: 'contracts', dateField: 'end_date', withinDays: 60 }), async () => {});
        await flush();
        await job.fire('flow-time-relative:renewal_alert');

        const failure = log.errors.find((l) => l.includes('sweep failed'));
        expect(failure, `the sweep failed silently; errors seen: ${JSON.stringify(log.errors)}`).toBeTruthy();
        expect(failure, 'the failure must name the flow it belongs to').toContain('renewal_alert');
        expect(failure, "and carry the store's own reason").toContain('NO row-level tenant isolation');
    });

    it('says so at bind when the swept object is one the engine will NOT scope', async () => {
        // ⚠️ The quiet direction. A `tenancy.enabled: false` object (ADR-0066)
        // is exempt from the engine's tenant scope, so the declaration cannot
        // narrow this sweep at all — it still selects across every
        // organization, while the flow's `organization` line makes it LOOK
        // contained. Nothing here changes which rows come back; the pin is that
        // the operator is TOLD.
        const job = fakeJobService();
        const { engine } = fakeDataEngine([]);
        engine.getObject = () => ({ name: 'contracts', tenancy: { enabled: false } });
        const log = recordingLogger();
        const trigger = new TimeRelativeTrigger(() => job.service, () => engine, log.logger, NOW);

        trigger.start(binding({ object: 'contracts', dateField: 'end_date', withinDays: 60 }), async () => {});
        await flush();

        const said = log.warns.find((l) => l.includes('tenancy'));
        expect(said, `nothing was said; warns seen: ${JSON.stringify(log.warns)}`).toBeTruthy();
        expect(said, 'the warning must name the object whose declaration makes the scope inert').toContain('contracts');
        expect(said, 'and state the consequence, not just the fact').toContain('does NOT narrow this sweep');
        expect(job.jobs.size, 'the sweep still binds — this is a disclosure, not a refusal').toBe(1);
    });

    it('control: a tenant-scoped object gets NO such warning', async () => {
        const job = fakeJobService();
        const { engine } = fakeDataEngine([]);
        const log = recordingLogger();
        const trigger = new TimeRelativeTrigger(() => job.service, () => engine, log.logger, NOW);

        trigger.start(binding({ object: 'contracts', dateField: 'end_date', withinDays: 60 }), async () => {});
        await flush();

        expect(
            log.warns.filter((l) => l.includes('does NOT narrow this sweep')),
            'an ordinary object must not be warned about — that would train operators to ignore the line',
        ).toHaveLength(0);
    });
});
