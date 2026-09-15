// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #8124 — `fieldsFromZodIssues` no longer leaks Zod's issue codes onto the
 * wire's `fields[].code`.
 *
 * The runtime domain routes (`/analytics`, `/notifications`, `/automation`)
 * emit their entry refusals through this helper, and it used to assign
 * `issue.code` verbatim — `unrecognized_keys`, `too_small`, … on a position
 * `FieldErrorSchema.code` declares as the CLOSED ADR-0114 catalog. It now maps
 * through `zodIssuesToFields` (`@objectstack/spec`, the one D3 implementation).
 *
 * Per ADR-0114 D3's own discipline these tests drive REAL `safeParse` calls —
 * against the very spec schemas the runtime domains parse with (this package
 * declares no `zod` of its own, and a hand-written issue fixture is exactly
 * what D3 says not to trust) — never hand-built issue objects.
 */

import { describe, it, expect } from 'vitest';
import {
    AnalyticsQueryRequestSchema,
    FieldErrorCode,
    MarkNotificationsReadRequestSchema,
} from '@objectstack/spec/api';
import { FlowSchema } from '@objectstack/spec/automation';
import { fieldsFromZodIssues } from './validation-failure';

/** Parse `value` against `schema`, asserting it fails, and map the issues. */
function issuesOf(schema: { safeParse: (v: unknown) => any }, value: unknown) {
    const r = schema.safeParse(value);
    expect(r.success, 'the fixture must actually fail to parse').toBe(false);
    return r.error.issues;
}

/** A flow definition that parses clean — fixtures below are one edit away. */
const WELL_FORMED_FLOW = {
    name: 'welcome_flow',
    label: 'Welcome',
    type: 'autolaunched',
    nodes: [{ id: 'n', type: 'notify', label: 'Notify', config: { message: 'hi' } }],
    edges: [],
};

describe('fieldsFromZodIssues — ADR-0114 D3 catalog codes, not Zod codes (#8124)', () => {
    it('an unknown node key on the real FlowSchema is unknown_field, not unrecognized_keys', () => {
        // The exact fixture #8124 measured: the #8055 flow-registration refusal.
        const fields = fieldsFromZodIssues(issuesOf(FlowSchema, {
            ...WELL_FORMED_FLOW,
            nodes: [{ id: 'n', type: 'notify', label: 'Notify', next: 'other' }],
        }));
        expect(fields.length).toBeGreaterThan(0);
        expect(fields.map((f) => f.code)).toContain('unknown_field');
        expect(fields.map((f) => f.code)).not.toContain('unrecognized_keys');
        // The located fault survives the mapping.
        expect(fields.some((f) => f.message.includes('next'))).toBe(true);
    });

    it('every emitted code is a catalog member, for every fixture', () => {
        const fixtures: Array<[{ safeParse: (v: unknown) => any }, unknown]> = [
            // The mark-read contract the notifications domain parses (#3899).
            [MarkNotificationsReadRequestSchema, { notificationIds: ['n1'] }],
            [MarkNotificationsReadRequestSchema, { ids: 'n1' }],
            [MarkNotificationsReadRequestSchema, []],
            // The flow contract the automation domain parses (#8055). The
            // unknown-key fixture is the load-bearing one: reverse-verifying
            // this file showed the OTHER fixtures produce only `invalid_type`,
            // which Zod and the catalog spell identically — so without a
            // fixture whose Zod code is outside the catalog, this test stayed
            // green against the raw pass-through it exists to refuse.
            [FlowSchema, { ...WELL_FORMED_FLOW, nodes: [{ id: 'n', type: 'notify', label: 'Notify', next: 'other' }] }],
            [FlowSchema, { ...WELL_FORMED_FLOW, nodes: [{ id: 'n', type: 'notify', config: {} }] }],
            [FlowSchema, 'not even an object'],
        ];
        for (const [schema, value] of fixtures) {
            for (const f of fieldsFromZodIssues(issuesOf(schema, value))) {
                expect(
                    () => FieldErrorCode.parse(f.code),
                    `'${f.code}' leaked for ${JSON.stringify(value)?.slice(0, 60)}`,
                ).not.toThrow();
            }
        }
    });

    it("a root-level failure keeps the '(body)' spelling the dispatcher documents", () => {
        // A body that is the wrong TYPE entirely has no path to point at; the
        // domains' contrast tests and `flowDefinitionRefusal` both read this
        // convention, so the delegation to `zodIssuesToFields` (which spells an
        // empty path as '') must not have changed it.
        const fields = fieldsFromZodIssues(issuesOf(FlowSchema, 'not even an object'));
        expect(fields.length).toBeGreaterThan(0);
        expect(fields[0].field).toBe('(body)');
    });

    it('the optional input upgrades a missing required property to required', () => {
        const bad = { ...WELL_FORMED_FLOW, nodes: [{ id: 'n', type: 'notify', config: { message: 'hi' } }] };
        const issues = issuesOf(FlowSchema, bad);

        // Without the input — every caller today — the D3 degradation: still a
        // catalog member, just the less specific one.
        const blind = fieldsFromZodIssues(issues);
        expect(blind.find((f) => f.field.endsWith('label'))?.code).toBe('invalid_type');

        // With it, the D3 `invalid_type` split fires.
        const informed = fieldsFromZodIssues(issues, bad);
        expect(informed.find((f) => f.field.endsWith('label'))?.code).toBe('required');
    });
});

/**
 * [#17598] ONE condition, ONE wording — for the `timeDimensions[].dateRange`
 * refusal, on the wire and not merely at `error.issues`.
 *
 * `AnalyticsDateRangeSchema` is a `z.union` carrying its own error map, so the
 * single issue zod raises is already a prescription AND already names the
 * arity ("received a 1-element array, not the two bounds [start, end]"). Its
 * tuple arm complains about the same value at the same path in zod's own words
 * ("Too small: expected array to have >=2 items"), and the #5014 union
 * expansion put both on the wire — one condition, two wordings, which is what
 * the #5240 convention exists to prevent and what `analytics.zod.ts` claims for
 * this refusal.
 *
 * Before #17598 the arm was `z.array(z.string())` with no length constraint, so
 * a 1-element window was not refused by the schema at all and there was no
 * second wording to have; the narrowing is what introduced it, and this is
 * where it is collapsed. The two edge cases below are as load-bearing as the
 * collapse itself: this narrows a RESTATEMENT, never a diagnosis.
 */
describe('fieldsFromZodIssues — the dateRange refusal keeps one wording (#17598)', () => {
    const analyticsBody = (dateRange: unknown) => ({
        cube: 'orders',
        measures: ['count'],
        timeDimensions: [{ dimension: 'created_at', granularity: 'day', dateRange }],
    });

    const arities: Array<[string, unknown]> = [
        ['a 1-element window', ['2026-01-01']],
        ['an empty array', []],
        ['three bounds', ['2026-01-01', '2026-01-15', '2026-01-31']],
    ];

    for (const [name, dateRange] of arities) {
        it(`${name} maps to exactly one entry, and it is the prescription`, () => {
            const fields = fieldsFromZodIssues(
                issuesOf(AnalyticsQueryRequestSchema, analyticsBody(dateRange)),
            );
            expect(fields).toHaveLength(1);
            expect(fields[0].field).toBe('timeDimensions.0.dateRange');
            expect(fields[0].message).toContain('not the two bounds [start, end]');
            // ⛔ The arm's own arity text is the second wording, and it is gone.
            expect(fields[0].message).not.toMatch(/Too (small|big)/);
        });
    }

    it('a NON-string bound keeps the branch entry naming WHICH bound is wrong', () => {
        // The prescription says "an array with a non-string bound"; it does not
        // say WHICH one. `dateRange.1` names a position the prescription has
        // not, so it is a diagnosis rather than a restatement and it stays.
        const fields = fieldsFromZodIssues(
            issuesOf(AnalyticsQueryRequestSchema, analyticsBody(['2026-01-01', 3])),
        );
        expect(fields.map((f) => f.field)).toContain('timeDimensions.0.dateRange');
        expect(fields.map((f) => f.field)).toContain('timeDimensions.0.dateRange.1');
    });

    it('CONTROL — a branch issue at its own branch ROOT still reaches the wire for every other key', () => {
        // `unrecognized_keys` is raised at the BRANCH root — structurally the
        // same position as the tuple arm's arity text — and it carries the
        // #4001 campaign's curated prose. If the collapse above were written as
        // "drop branch issues at the union's own path" rather than keyed on the
        // date-range recogniser, this is the family it would have silenced.
        const fields = fieldsFromZodIssues(issuesOf(FlowSchema, {
            ...WELL_FORMED_FLOW,
            nodes: [{ id: 'n', type: 'notify', label: 'Notify', next: 'other' }],
        }));
        expect(fields.map((f) => f.code)).toContain('unknown_field');
        expect(fields.some((f) => f.message.includes('next'))).toBe(true);
    });
});
