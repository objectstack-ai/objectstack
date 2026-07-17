// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import {
    PerfTiming,
    formatServerTiming,
    runWithPerfTiming,
    currentPerfTiming,
    recordServerTiming,
    startServerTiming,
    measureServerTiming,
    countServerTiming,
} from './perf-timing.js';

describe('formatServerTiming', () => {
    it('serializes name + duration', () => {
        expect(formatServerTiming([{ name: 'db', dur: 12.3 }])).toBe('db;dur=12.3');
    });

    it('rounds duration to 2 decimals', () => {
        expect(formatServerTiming([{ name: 'db', dur: 12.34567 }])).toBe('db;dur=12.35');
    });

    it('emits a quoted desc when present', () => {
        expect(formatServerTiming([{ name: 'total', dur: 5, desc: 'Total time' }])).toBe(
            'total;dur=5;desc="Total time"',
        );
    });

    it('joins multiple marks with comma-space', () => {
        expect(
            formatServerTiming([
                { name: 'parse', dur: 1 },
                { name: 'handler', dur: 4 },
            ]),
        ).toBe('parse;dur=1, handler;dur=4');
    });

    it('sanitizes names into tokens', () => {
        expect(formatServerTiming([{ name: 'db query!', dur: 1 }])).toBe('db_query;dur=1');
    });

    it('drops marks whose name is empty after sanitization', () => {
        expect(formatServerTiming([{ name: '!!!', dur: 1 }])).toBe('');
    });

    it('strips quotes/backslashes/control chars from desc (no header injection)', () => {
        const out = formatServerTiming([
            { name: 'x', dur: 1, desc: 'a"b\\c\r\nInjected: 1' },
        ]);
        expect(out).toBe('x;dur=1;desc="a b c Injected: 1"');
        expect(out).not.toContain('\n');
        expect(out).not.toContain('"a"b"');
    });

    it('coerces non-finite durations to 0', () => {
        expect(formatServerTiming([{ name: 'x', dur: Number.NaN }])).toBe('x;dur=0');
        expect(formatServerTiming([{ name: 'x', dur: Number.POSITIVE_INFINITY }])).toBe('x;dur=0');
    });

    it('returns empty string for no marks', () => {
        expect(formatServerTiming([])).toBe('');
    });
});

describe('PerfTiming', () => {
    it('records explicit marks in order', () => {
        const t = new PerfTiming();
        t.record('a', 1);
        t.record('b', 2);
        expect(t.marks().map((m) => m.name)).toEqual(['a', 'b']);
        expect(t.toHeader()).toBe('a;dur=1, b;dur=2');
    });

    it('start() returns an idempotent end()', () => {
        const t = new PerfTiming();
        const end = t.start('phase');
        end();
        end(); // second call ignored
        expect(t.marks()).toHaveLength(1);
        expect(t.marks()[0].name).toBe('phase');
        expect(t.marks()[0].dur).toBeGreaterThanOrEqual(0);
    });

    it('measure() records duration and returns the value', async () => {
        const t = new PerfTiming();
        const value = await t.measure('work', async () => {
            await new Promise((r) => setTimeout(r, 5));
            return 42;
        });
        expect(value).toBe(42);
        expect(t.marks()).toHaveLength(1);
        expect(t.marks()[0].dur).toBeGreaterThan(0);
    });

    it('measure() records even when the function throws', async () => {
        const t = new PerfTiming();
        await expect(
            t.measure('boom', async () => {
                throw new Error('nope');
            }),
        ).rejects.toThrow('nope');
        expect(t.marks()).toHaveLength(1);
        expect(t.marks()[0].name).toBe('boom');
    });

    describe('count() aggregate', () => {
        it('folds repeated events into one mark carrying total + count', () => {
            const t = new PerfTiming();
            t.count('db', 10, 'queries');
            t.count('db', 5, 'queries');
            t.count('db', 3, 'queries');
            expect(t.marks()).toHaveLength(1);
            expect(t.toHeader()).toBe('db;dur=18;desc="3 queries"');
        });

        it('keeps the aggregate at its first-seen position (before a later total)', () => {
            const t = new PerfTiming();
            t.count('db', 4, 'queries');
            t.record('total', 20, 'Total server time');
            t.count('db', 6, 'queries'); // still folds into the first db mark
            expect(t.marks().map((m) => m.name)).toEqual(['db', 'total']);
            expect(t.toHeader()).toBe('db;dur=10;desc="2 queries", total;dur=20;desc="Total server time"');
        });

        it('tracks independent names separately', () => {
            const t = new PerfTiming();
            t.count('db', 10, 'queries');
            t.count('hooks', 2, 'hooks');
            t.count('hooks', 3, 'hooks');
            expect(t.toHeader()).toBe('db;dur=10;desc="1 queries", hooks;dur=5;desc="2 hooks"');
        });

        it('emits a bare count when no unit is given', () => {
            const t = new PerfTiming();
            t.count('x', 1);
            t.count('x', 1);
            expect(t.toHeader()).toBe('x;dur=2;desc="2"');
        });

        it('ignores non-finite / negative durations but still counts the event', () => {
            const t = new PerfTiming();
            t.count('db', Number.NaN, 'queries');
            t.count('db', -5, 'queries');
            t.count('db', 7, 'queries');
            expect(t.toHeader()).toBe('db;dur=7;desc="3 queries"');
        });
    });
});

describe('ambient collector', () => {
    it('currentPerfTiming() is undefined outside a run scope', () => {
        expect(currentPerfTiming()).toBeUndefined();
    });

    it('free functions are no-ops with no active collector', async () => {
        recordServerTiming('x', 1); // must not throw
        const end = startServerTiming('y');
        end(); // must not throw
        countServerTiming('db', 1, 'queries'); // must not throw
        const v = await measureServerTiming('z', async () => 7);
        expect(v).toBe(7);
    });

    it('countServerTiming folds onto the ambient collector', async () => {
        const t = new PerfTiming();
        await runWithPerfTiming(t, async () => {
            countServerTiming('db', 4, 'queries');
            await new Promise((r) => setTimeout(r, 1));
            countServerTiming('db', 6, 'queries'); // after an await — same ALS scope
        });
        expect(t.toHeader()).toBe('db;dur=10;desc="2 queries"');
    });

    it('pins the ambient store to a global-registry symbol (shared across module copies)', () => {
        // The store MUST live on globalThis under Symbol.for so that a second
        // copy of this module (ESM vs CJS build, or an inlined bundle) shares it
        // — otherwise cross-layer spans (db/auth/hooks recorded from the SQL
        // driver / engine) never reach the collector the HTTP server opened.
        const key = Symbol.for('@objectstack/observability:perf-timing-store');
        expect((globalThis as Record<symbol, unknown>)[key]).toBeDefined();
        // And the ambient free functions must read THAT store.
        const t = new PerfTiming();
        runWithPerfTiming(t, () => recordServerTiming('shared', 1));
        expect(t.marks().map((m) => m.name)).toContain('shared');
    });

    it('records onto the ambient collector inside runWithPerfTiming', async () => {
        const t = new PerfTiming();
        await runWithPerfTiming(t, async () => {
            expect(currentPerfTiming()).toBe(t);
            recordServerTiming('db', 3, 'Database');
            const v = await measureServerTiming('compute', async () => 'ok');
            expect(v).toBe('ok');
        });
        const names = t.marks().map((m) => m.name);
        expect(names).toContain('db');
        expect(names).toContain('compute');
        expect(t.toHeader()).toContain('db;dur=3;desc="Database"');
    });

    it('propagates across async boundaries', async () => {
        const t = new PerfTiming();
        await runWithPerfTiming(t, async () => {
            await new Promise((r) => setTimeout(r, 1));
            recordServerTiming('after-await', 1);
        });
        expect(t.marks().map((m) => m.name)).toContain('after-await');
    });
});
