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

// #4001 batch 11. This descriptor was off the strictness map entirely until the
// 2026-08-03 re-measurement: its single site is written `z\n  .object({`, the
// old textual counter read zero sites, and a zero-site file is SKIPPED by the
// coverage walk as "nothing to classify" — so the gate that promises "no
// undeclared authorable surface" printed green over it.
//
// It also sits BELOW the deliberately-open node `config` slot (ADR-0018), so
// the flow gate cannot see inside it. This schema is the only gate there is.
describe('unknown keys are rejected, not stripped (#4001 batch 11)', () => {
    const unknownKeyIssue = (value: unknown) => {
        const result = TimeRelativeTriggerSchema.safeParse(value);
        expect(result.success).toBe(false);
        return result.error!.issues.find((i) => i.code === 'unrecognized_keys');
    };

    it('rejects the singular slip that used to bind a sweep matching nothing', () => {
        // The exact shape the ledger row names: `offsetDay` next to a VALID
        // mode key. Before this, the descriptor parsed, the plugin bound a
        // daily sweep, and the author's narrowing was gone — a trigger that
        // never fires on the day it was configured for, reported as configured.
        const issue = unknownKeyIssue({
            object: 'contracts', dateField: 'end_date', withinDays: 30, offsetDay: 7,
        });
        expect(issue!.message).toContain('`config.timeRelative` descriptor');
        expect(issue!.message).toContain('`offsetDay` → `offsetDays`');
    });

    it('points ObjectQL / record-change vocabulary at the descriptor\'s keys', () => {
        expect(unknownKeyIssue({ object: 'c', field: 'due_date', withinDays: 1 })!.message)
            .toContain('`field` → `dateField`');
        expect(unknownKeyIssue({ object: 'c', dateField: 'd', withinDays: 1, filters: {} })!.message)
            .toContain('`filters` → `filter`');
        expect(unknownKeyIssue({ objectName: 'c', dateField: 'd', withinDays: 1 })!.message)
            .toContain('`objectName` → `object`');
    });

    it('sends the two sibling keys to the layer that owns them', () => {
        // `schedule` and `runAs` are real and adjacent — a rename would be
        // wrong; the prescription is where they belong.
        expect(unknownKeyIssue({ object: 'c', dateField: 'd', withinDays: 1, schedule: {} })!.message)
            .toContain("START node's `config`");
        expect(unknownKeyIssue({ object: 'c', dateField: 'd', withinDays: 1, runAs: 'system' })!.message)
            .toContain('FLOW-level');
    });

    it('still accepts every key it declares, in both windowing modes', () => {
        expect(TimeRelativeTriggerSchema.parse({
            object: 'contracts', dateField: 'end_date', offsetDays: [60, 30, 7],
            filter: { status: 'active' }, maxRecords: 500,
        }).maxRecords).toBe(500);
        expect(TimeRelativeTriggerSchema.parse({
            object: 'hr_document', dateField: 'expires_on', withinDays: 30,
        }).withinDays).toBe(30);
    });

    it('keeps the exactly-one-mode refinement after the shape went strict', () => {
        // The `.refine` chains off `strictObject(...)` now; losing it would let
        // a descriptor with neither mode (or both) through.
        expect(TimeRelativeTriggerSchema.safeParse({ object: 'c', dateField: 'd' }).success).toBe(false);
        expect(TimeRelativeTriggerSchema.safeParse({
            object: 'c', dateField: 'd', withinDays: 1, offsetDays: [1],
        }).success).toBe(false);
    });
});
