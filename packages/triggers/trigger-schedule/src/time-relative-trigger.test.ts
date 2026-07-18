// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, vi } from 'vitest';
import type { AutomationContext, JobSchedule, JobHandler } from '@objectstack/spec/contracts';
import {
    TimeRelativeTrigger,
    computeDateWindows,
    buildWindowWhere,
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
    context?: { isSystem?: boolean };
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

/** Minimal where matcher: temporal range on the date field + scalar equality. */
function matches(row: Row, where: Record<string, unknown>): boolean {
    for (const [key, cond] of Object.entries(where)) {
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

function binding(timeRelative: unknown, overrides: Partial<FlowTriggerBinding> = {}): FlowTriggerBinding {
    return {
        flowName: 'renewal_alert',
        object: 'contracts',
        config: { timeRelative },
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
        // The sweep queries as a system op (sees all rows, RLS-bypassing).
        expect(calls[0].context).toEqual({ isSystem: true });
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

    it('skips gracefully when the automation service is absent', async () => {
        const job = fakeJobService();
        const fake = fakePluginCtx({ job: job.service });

        const plugin = new TimeRelativeTriggerPlugin();
        await plugin.start(fake.ctx as never);
        await expect(fake.readyHandlers[0]()).resolves.toBeUndefined();
    });
});
