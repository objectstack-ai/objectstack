// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#20599] A time-relative window that lands in 0001..0099 is that day's
 * window. `startOfUtcDay` / `endOfUtcDay` built both bounds with
 * `Date.UTC(year, …)`, which reads a year from 0 to 99 as 1900 + year, so an
 * offset reaching 0050-09-30 swept 1950-09-30 instead. They build through
 * core's `wallClockToUtcMs` now.
 *
 * Pins: 0001, 0050 and 0099, with 0100 (the first year `Date.UTC` reads as
 * written) and a 2026 control. The window is UTC calendar arithmetic by
 * contract, with no reference zone to vary.
 */

import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { computeDateWindows, computeWindowClaimScopes } from './index.js';

// Wed 2026-09-30 12:00 UTC. Each offset below is the day count from 2026-09-30
// to the named day, proleptic Gregorian.
const NOW = new Date('2026-09-30T12:00:00.000Z');

const CASES = [
    [-739616, '0001-09-30'],
    [-721719, '0050-09-30'],
    [-703822, '0099-09-30'],
    [-703457, '0100-09-30'],
    [-272, '2026-01-01'],
] as const;

// Every pin runs on a UTC host and on an Asia/Shanghai host: the sites read
// UTC components only, and the answer must not move with the process zone.
const HOSTS = ['UTC', 'Asia/Shanghai'] as const;
const originalTz = process.env.TZ;
afterAll(() => {
    if (originalTz === undefined) delete process.env.TZ;
    else process.env.TZ = originalTz;
});

describe.each(HOSTS)('on a %s host', (host) => {
    beforeEach(() => {
        process.env.TZ = host;
        expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBe(host);
    });

    describe('[#20599] a time-relative window in 0001..0099 keeps its year', () => {
        it.each(CASES)('offsetDays [%i] sweeps %s, and its claim scope names that day', (offset, day) => {
            const desc = { object: 'c', dateField: 'd', offsetDays: [offset] };
            expect(computeDateWindows(desc, NOW)).toEqual([{ gte: `${day}T00:00:00.000Z`, lte: `${day}T23:59:59.999Z` }]);
            expect(computeWindowClaimScopes(desc, NOW)[0]?.scope).toBe(`${day}:offset${offset}`);
        });

        it.each(CASES)('withinDays %i opens the lookback at %s', (within, day) => {
            expect(computeDateWindows({ object: 'c', dateField: 'd', withinDays: within }, NOW)).toEqual([
                { gte: `${day}T00:00:00.000Z`, lte: '2026-09-30T23:59:59.999Z' },
            ]);
        });
    });
});
