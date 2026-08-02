// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import { defineJob } from '@objectstack/spec/system';
import { toBoundaryJobSchedule } from './job-schedule.js';

/**
 * #4567 — the authoring↔boundary downgrade itself.
 *
 * `defineJob` parses the cron `expression` into the ADR expression envelope;
 * `IJobService.schedule` (and croner behind it) take a bare string. These pin
 * the one conversion that bridges them.
 */
describe('toBoundaryJobSchedule', () => {
    it('unwraps the cron expression envelope a parsed Schedule carries', () => {
        const job = defineJob({
            name: 'health_sweep',
            schedule: { type: 'cron', expression: '0 1 * * *' },
            handler: 'sweep',
        });

        // The premise of #4567: parsing produced an envelope, not a string.
        expect(job.schedule).toEqual({
            type: 'cron',
            expression: { dialect: 'cron', source: '0 1 * * *' },
            timezone: 'UTC',
        });

        expect(toBoundaryJobSchedule(job.schedule, 'health_sweep')).toEqual({
            type: 'cron',
            expression: '0 1 * * *',
            timezone: 'UTC',
        });
    });

    it('accepts the authoring-input spelling (bare string) unchanged', () => {
        expect(toBoundaryJobSchedule({ type: 'cron', expression: '*/5 * * * *' }, 'j')).toEqual({
            type: 'cron',
            expression: '*/5 * * * *',
        });
    });

    it('carries a string timezone across and drops a non-string one', () => {
        expect(
            toBoundaryJobSchedule(
                { type: 'cron', expression: { dialect: 'cron', source: '0 2 * * *' }, timezone: 'America/New_York' },
                'j',
            ),
        ).toEqual({ type: 'cron', expression: '0 2 * * *', timezone: 'America/New_York' });

        expect(
            toBoundaryJobSchedule({ type: 'cron', expression: '0 2 * * *', timezone: 42 as unknown as string }, 'j'),
        ).toEqual({ type: 'cron', expression: '0 2 * * *' });
    });

    it('passes interval / once schedules through (no envelope on those branches)', () => {
        const interval = defineJob({
            name: 'ping',
            schedule: { type: 'interval', intervalMs: 5000 },
            handler: 'h',
        });
        expect(toBoundaryJobSchedule(interval.schedule, 'ping')).toEqual({ type: 'interval', intervalMs: 5000 });

        const once = defineJob({
            name: 'kickoff',
            schedule: { type: 'once', at: '2030-01-01T00:00:00.000Z' },
            handler: 'h',
        });
        expect(toBoundaryJobSchedule(once.schedule, 'kickoff')).toEqual({
            type: 'once',
            at: '2030-01-01T00:00:00.000Z',
        });
    });

    it('throws — naming the job — on shapes that cannot reach the boundary', () => {
        // Wrong dialect: a CEL expression is not a schedule.
        expect(() =>
            toBoundaryJobSchedule({ type: 'cron', expression: { dialect: 'cel', source: 'now()' } }, 'bad_job'),
        ).toThrow(/bad_job.*cel/s);

        // AST-only envelope: nothing for croner to parse.
        expect(() =>
            toBoundaryJobSchedule({ type: 'cron', expression: { dialect: 'cron', ast: {} } }, 'bad_job'),
        ).toThrow(/bad_job.*AST-only/s);

        expect(() => toBoundaryJobSchedule({ type: 'cron' }, 'bad_job')).toThrow(/bad_job/);
        expect(() => toBoundaryJobSchedule({ type: 'cron', expression: '  ' }, 'bad_job')).toThrow(/bad_job/);
        expect(() => toBoundaryJobSchedule({ type: 'interval' }, 'bad_job')).toThrow(/bad_job.*intervalMs/s);
        expect(() => toBoundaryJobSchedule({ type: 'once' }, 'bad_job')).toThrow(/bad_job.*at/s);
        expect(() => toBoundaryJobSchedule({ type: 'weekly' }, 'bad_job')).toThrow(/bad_job.*weekly/s);
        expect(() => toBoundaryJobSchedule(undefined, 'bad_job')).toThrow(/bad_job/);
        expect(() => toBoundaryJobSchedule('0 1 * * *', 'bad_job')).toThrow(/bad_job/);
    });
});
