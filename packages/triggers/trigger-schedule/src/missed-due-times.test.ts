// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#25235] The due times a silence swallowed — the instants the schedule owed a
// fire strictly after the previous kernel's last-alive instant and up to now.

import { describe, it, expect } from 'vitest';
import { dueTimesInSilence, DROPPED_DUE_TIME_COUNT_CEILING } from './missed-due-times.js';
import { computeTickWindow } from './schedule-trigger.js';

const iso = (dates: readonly Date[]) => dates.map((d) => d.toISOString());

/** The run history's default per-flow cap — what the engine answers for `limit`. */
const LIMIT = 100;

describe('dueTimesInSilence', () => {
    it('cron: the occurrences inside the silence, chronological, and none outside it', () => {
        const got = dueTimesInSilence(
            { type: 'cron', expression: '0 * * * *' },
            new Date('2026-10-22T08:00:05Z'), // the 08:00 fire settled, then the kernel stopped
            new Date('2026-10-22T10:30:00Z'),
            LIMIT,
        );
        expect(iso(got.dueTimes)).toEqual(['2026-10-22T09:00:00.000Z', '2026-10-22T10:00:00.000Z']);
        expect(got.dropped).toBeNull();
    });

    it('cron: a silence that ends exactly on a due time includes it; one that starts on it does not', () => {
        const got = dueTimesInSilence(
            { type: 'cron', expression: '0 9 * * *' },
            new Date('2026-10-21T09:00:00Z'),
            new Date('2026-10-22T09:00:00Z'),
            LIMIT,
        );
        expect(iso(got.dueTimes)).toEqual(['2026-10-22T09:00:00.000Z']);
    });

    it('cron: honours the schedule timezone', () => {
        const got = dueTimesInSilence(
            { type: 'cron', expression: '0 9 * * *', timezone: 'Asia/Shanghai' },
            new Date('2026-10-21T02:00:00Z'),
            new Date('2026-10-22T02:00:00Z'),
            LIMIT,
        );
        expect(iso(got.dueTimes)).toEqual(['2026-10-22T01:00:00.000Z']);
    });

    it('a silence with no due time inside it answers none (the kernel ticked through)', () => {
        const got = dueTimesInSilence(
            { type: 'cron', expression: '0 9 * * *' },
            new Date('2026-10-22T09:00:03Z'),
            new Date('2026-10-22T18:00:00Z'),
            LIMIT,
        );
        expect(got.dueTimes).toEqual([]);
        expect(got.dropped).toBeNull();
    });

    it('interval: each epoch-bucket start inside the silence', () => {
        const got = dueTimesInSilence(
            { type: 'interval', intervalMs: 60_000 },
            new Date('2026-10-22T10:00:30Z'),
            new Date('2026-10-22T10:03:10Z'),
            LIMIT,
        );
        expect(iso(got.dueTimes)).toEqual([
            '2026-10-22T10:01:00.000Z',
            '2026-10-22T10:02:00.000Z',
            '2026-10-22T10:03:00.000Z',
        ]);
    });

    it('once: the instant when it fell inside, nothing when it did not', () => {
        const at = '2026-10-22T12:00:00.000Z';
        expect(iso(dueTimesInSilence({ type: 'once', at }, new Date('2026-10-22T11:00:00Z'), new Date('2026-10-22T13:00:00Z'), LIMIT).dueTimes))
            .toEqual([at]);
        expect(dueTimesInSilence({ type: 'once', at }, new Date('2026-10-22T12:30:00Z'), new Date('2026-10-22T13:00:00Z'), LIMIT).dueTimes)
            .toEqual([]);
        expect(dueTimesInSilence({ type: 'once', at }, new Date('2026-10-22T10:00:00Z'), new Date('2026-10-22T11:00:00Z'), LIMIT).dueTimes)
            .toEqual([]);
    });

    it('records the newest `limit`, and counts what it dropped — exactly, with the earliest — cron and interval alike', () => {
        // 06:00 back to 00:01 is 360 minute marks; 20 kept, 340 dropped, the earliest 00:01.
        const cron = dueTimesInSilence(
            { type: 'cron', expression: '* * * * *' },
            new Date('2026-10-22T00:00:30Z'),
            new Date('2026-10-22T06:00:00Z'),
            20,
        );
        expect(cron.dueTimes).toHaveLength(20);
        expect(cron.dueTimes[0].toISOString()).toBe('2026-10-22T05:41:00.000Z');
        expect(cron.dueTimes[19].toISOString()).toBe('2026-10-22T06:00:00.000Z');
        expect(cron.dropped).toEqual({ count: 340, earliest: new Date('2026-10-22T00:01:00.000Z'), atLeast: false });

        const interval = dueTimesInSilence(
            { type: 'interval', intervalMs: 60_000 },
            new Date('2026-10-22T00:00:30Z'),
            new Date('2026-10-22T06:00:00Z'),
            20,
        );
        expect(iso(interval.dueTimes)).toEqual(iso(cron.dueTimes));
        expect(interval.dropped).toEqual(cron.dropped);

        // Exactly `limit` inside: nothing dropped.
        for (const schedule of [{ type: 'cron', expression: '* * * * *' }, { type: 'interval', intervalMs: 60_000 }] as const) {
            const exact = dueTimesInSilence(schedule, new Date('2026-10-22T05:40:00Z'), new Date('2026-10-22T06:00:00Z'), 20);
            expect(exact.dueTimes).toHaveLength(20);
            expect(exact.dropped).toBeNull();
        }
    });

    it('a cron count past the walk ceiling says "at least", never walks on', () => {
        // Every second for an hour is 3 600 marks — past the ceiling.
        const got = dueTimesInSilence(
            { type: 'cron', expression: '* * * * * *' },
            new Date('2026-10-22T00:00:00Z'),
            new Date('2026-10-22T01:00:00Z'),
            5,
        );
        expect(got.dueTimes).toHaveLength(5);
        expect(got.dropped).toEqual({ count: DROPPED_DUE_TIME_COUNT_CEILING, earliest: new Date('2026-10-22T00:00:01.000Z'), atLeast: true });
    });

    it('every due time it answers is the start of its own tick window — the dispatch-ledger key', () => {
        for (const schedule of [
            { type: 'cron', expression: '*/15 * * * *', timezone: 'Europe/Berlin' },
            { type: 'interval', intervalMs: 300_000 },
        ] as const) {
            const { dueTimes } = dueTimesInSilence(schedule, new Date('2026-10-22T07:01:00Z'), new Date('2026-10-22T09:00:00Z'), LIMIT);
            expect(dueTimes.length).toBeGreaterThan(0);
            for (const due of dueTimes) {
                expect(computeTickWindow(schedule, due)?.startedAt).toBe(due.toISOString());
            }
        }
    });
});
