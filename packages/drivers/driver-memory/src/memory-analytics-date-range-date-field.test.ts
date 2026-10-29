// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #27272 — a preset `dateRange` on a `date` field counts the calendar days the
 * period covers in the reference zone, on this driver's cube face too.
 *
 * ADR-0053's one window rule: a `date` field compares CALENDAR DAYS and a
 * `datetime` field compares INSTANTS. Q3 is 2026-07-01 through 2026-09-30 in
 * any zone. The rule is `@objectstack/core`'s `dateRangeWindowBounds`, the one
 * spelling service-analytics' faces share (#27172).
 *
 * ⛔ Before the repair the face compared the preset's resolved instants (the
 * zone's midnight, `2026-07-01T07:00:00.000Z` in Los Angeles) against the
 * stored bare day as TEXT. West of UTC `'2026-07-01' < '2026-07-01T07:…'`, so
 * `this_quarter` dropped Jul 1 and counted Oct 1. East of UTC the same text
 * order happened to land on the right days.
 *
 * The declaration decides, as everywhere in this driver: a field declared
 * `date` through `syncSchema` takes the calendar-day rule; a field whose type
 * the driver was never told keeps the instant pair (`dateColumn: false`), as
 * `dateRangeWindowBounds` does for a column whose type the caller cannot name.
 */

import { afterEach, describe, it, expect, vi } from 'vitest';
import { InMemoryDriver } from './memory-driver.js';
import { MemoryAnalyticsService } from './memory-analytics.js';
import { AnalyticsQuerySchema } from '@objectstack/spec/data';
import type { AnalyticsDateRange, AnalyticsQuery, Cube } from '@objectstack/spec/data';

const CUBE: Cube = {
    name: 'deals',
    title: 'Deals',
    sql: 'deals',
    measures: {
        count: { label: 'Count', type: 'count', sql: 'id' },
    },
    dimensions: {
        probe: { label: 'Probe', type: 'string', sql: 'probe' },
        closeDate: { label: 'Close Date', type: 'time', sql: 'close_date' },
        closedAt: { label: 'Closed At', type: 'time', sql: 'closed_at' },
    },
    public: true,
};

/** The card's four rows: one day either side of Q3, and Q3's own first and last day. */
const DAYS = ['2026-06-30', '2026-07-01', '2026-09-30', '2026-10-01'];
const Q3 = ['2026-07-01', '2026-09-30'];

afterEach(() => {
    vi.useRealTimers();
});

async function serviceOver(declare: boolean, rows: Record<string, unknown>[]): Promise<MemoryAnalyticsService> {
    const driver = new InMemoryDriver({ initialData: { deals: rows } });
    await driver.connect();
    if (declare) {
        await driver.syncSchema('deals', {
            name: 'deals',
            fields: {
                probe: { type: 'text' },
                close_date: { type: 'date' },
                closed_at: { type: 'datetime' },
            },
        });
    }
    return new MemoryAnalyticsService({ driver, cubes: [CUBE] });
}

async function probes(
    service: MemoryAnalyticsService,
    dimension: 'deals.closeDate' | 'deals.closedAt',
    timezone: string,
    dateRange: AnalyticsDateRange = 'this_quarter',
): Promise<string[]> {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-09-09T12:00:00Z'));
    const query: AnalyticsQuery = AnalyticsQuerySchema.parse({
        cube: 'deals',
        measures: ['deals.count'],
        dimensions: ['deals.probe'],
        timeDimensions: [{ dimension, dateRange }],
        timezone,
    });
    const result = await service.query(query);
    return result.rows.map((row) => String(row['deals.probe'])).sort();
}

describe('#27272 — a preset dateRange on a declared date field counts calendar days', () => {
    const dateRows = DAYS.map((day, i) => ({ id: i + 1, probe: day, close_date: day }));

    for (const zone of ['America/Los_Angeles', 'Asia/Shanghai', 'UTC']) {
        it(`${zone}: this_quarter selects Jul 1 through Sep 30`, async () => {
            const service = await serviceOver(true, dateRows);
            expect(await probes(service, 'deals.closeDate', zone)).toEqual(Q3);
        });
    }

    it('Los Angeles: this_month on Sep 9 selects Sep 30 and not Oct 1', async () => {
        const service = await serviceOver(true, dateRows);
        expect(await probes(service, 'deals.closeDate', 'America/Los_Angeles', 'this_month')).toEqual(['2026-09-30']);
    });

    it('an explicit window keeps its inclusive bare-day reading, untouched', async () => {
        const service = await serviceOver(true, dateRows);
        expect(await probes(service, 'deals.closeDate', 'America/Los_Angeles', ['2026-07-01', '2026-09-30'])).toEqual(Q3);
    });
});

describe('#27272 — a datetime field keeps comparing instants', () => {
    // Los Angeles' Q3 opens at 2026-07-01T07:00Z and closes before 2026-10-01T07:00Z.
    const instants = [
        '2026-07-01T06:59:59.000Z', // Jun 30, 23:59:59 local — outside
        '2026-07-01T07:00:00.000Z', // Jul 1, 00:00 local — inside
        '2026-10-01T06:59:59.000Z', // Sep 30, 23:59:59 local — inside
        '2026-10-01T07:00:00.000Z', // Oct 1, 00:00 local — outside
    ];
    const rows = instants.map((iso, i) => ({ id: i + 1, probe: iso, closed_at: iso }));

    it('Los Angeles: this_quarter on a declared datetime is the zone-midnight instant pair', async () => {
        const service = await serviceOver(true, rows);
        expect(await probes(service, 'deals.closedAt', 'America/Los_Angeles')).toEqual([
            '2026-07-01T07:00:00.000Z',
            '2026-10-01T06:59:59.000Z',
        ]);
    });
});

describe('#27272 — a field whose type was never declared keeps the instant pair', () => {
    it('Los Angeles: an undeclared column is compared as the instants the preset resolved to', async () => {
        const rows = ['2026-07-01T06:59:59.000Z', '2026-07-01T07:00:00.000Z'].map((iso, i) => ({
            id: i + 1,
            probe: iso,
            close_date: iso,
        }));
        const service = await serviceOver(false, rows);
        expect(await probes(service, 'deals.closeDate', 'America/Los_Angeles')).toEqual(['2026-07-01T07:00:00.000Z']);
    });
});
