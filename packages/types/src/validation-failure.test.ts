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
import { FieldErrorCode, MarkNotificationsReadRequestSchema } from '@objectstack/spec/api';
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
