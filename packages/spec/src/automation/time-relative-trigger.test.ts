// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import {
    TimeRelativeTriggerSchema,
    TIME_RELATIVE_DEFAULT_CRON,
    TIME_RELATIVE_DEFAULT_MAX_RECORDS,
} from './time-relative-trigger.zod';

describe('TimeRelativeTriggerSchema', () => {
    it('accepts a range-mode descriptor (withinDays)', () => {
        const parsed = TimeRelativeTriggerSchema.parse({
            object: 'contracts',
            dateField: 'end_date',
            withinDays: 60,
            filter: { status: 'active' },
        });
        expect(parsed.withinDays).toBe(60);
        expect(parsed.offsetDays).toBeUndefined();
    });

    it('accepts an offset-mode descriptor (offsetDays)', () => {
        const parsed = TimeRelativeTriggerSchema.parse({
            object: 'contracts',
            dateField: 'end_date',
            offsetDays: [60, 30, 7],
        });
        expect(parsed.offsetDays).toEqual([60, 30, 7]);
    });

    it('accepts negative offsets/windows (overdue / day-after)', () => {
        expect(() =>
            TimeRelativeTriggerSchema.parse({ object: 'po', dateField: 'due_date', withinDays: -14 }),
        ).not.toThrow();
        expect(() =>
            TimeRelativeTriggerSchema.parse({ object: 'po', dateField: 'due_date', offsetDays: [-1] }),
        ).not.toThrow();
    });

    it('rejects a descriptor with neither windowing mode', () => {
        const r = TimeRelativeTriggerSchema.safeParse({ object: 'contracts', dateField: 'end_date' });
        expect(r.success).toBe(false);
    });

    it('rejects a descriptor with BOTH windowing modes (mutually exclusive)', () => {
        const r = TimeRelativeTriggerSchema.safeParse({
            object: 'contracts',
            dateField: 'end_date',
            withinDays: 30,
            offsetDays: [7],
        });
        expect(r.success).toBe(false);
    });

    it('rejects an empty offsetDays array', () => {
        const r = TimeRelativeTriggerSchema.safeParse({
            object: 'contracts',
            dateField: 'end_date',
            offsetDays: [],
        });
        expect(r.success).toBe(false);
    });

    it('rejects non-snake_case object / field names (contract-first)', () => {
        expect(
            TimeRelativeTriggerSchema.safeParse({ object: 'Contracts', dateField: 'end_date', withinDays: 1 }).success,
        ).toBe(false);
        expect(
            TimeRelativeTriggerSchema.safeParse({ object: 'contracts', dateField: 'endDate', withinDays: 1 }).success,
        ).toBe(false);
    });

    it('rejects a non-integer / non-positive maxRecords', () => {
        expect(
            TimeRelativeTriggerSchema.safeParse({ object: 'c', dateField: 'd', withinDays: 1, maxRecords: 0 }).success,
        ).toBe(false);
        expect(
            TimeRelativeTriggerSchema.safeParse({ object: 'c', dateField: 'd', withinDays: 1, maxRecords: 2.5 }).success,
        ).toBe(false);
    });

    it('exposes sane defaults as constants', () => {
        expect(TIME_RELATIVE_DEFAULT_CRON).toBe('0 8 * * *');
        expect(TIME_RELATIVE_DEFAULT_MAX_RECORDS).toBeGreaterThan(0);
    });
});
