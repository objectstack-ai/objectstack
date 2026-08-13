// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #8124 — `zodIssuesToFields` in its new home: the ADR-0114 D3 mapper lives in
 * this package, beside the `FieldErrorCode` catalog it is total over, so
 * `@objectstack/rest` AND `@objectstack/types` read one implementation of the
 * table.
 *
 * The transport-grade behavior pins (every D3 row, union expansion, container
 * descent, junk tolerance) live in `packages/rest/src/zod-field-codes.test.ts`
 * and `zod-union-fields.test.ts`, which import through rest's re-export — kept
 * there deliberately, so the move is proven behavior-identical by the tests
 * that pinned the old module-local copy. What THIS file owns is the catalog
 * totality claim from the spec side, driven per ADR-0114 D3's own discipline:
 * REAL `safeParse` calls against the real `FlowSchema` (the #8055 fixture
 * source — the parse whose leaked codes #8124 was filed about), never
 * hand-written issue objects.
 */

import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { FieldErrorCode } from './errors.zod';
import { zodIssuesToFields } from './zod-issues-to-fields';
import { FlowSchema } from '../automation/flow.zod';

/** Parse and map, asserting the fixture really fails — with the parsed input. */
const fieldsFor = (schema: { safeParse: (v: unknown) => any }, value: unknown) => {
    const r = schema.safeParse(value);
    expect(r.success, 'the fixture must actually fail to parse').toBe(false);
    return zodIssuesToFields(r.error.issues, value);
};

/** The same, without the input — the degraded path a caller without it takes. */
const fieldsForBlind = (schema: { safeParse: (v: unknown) => any }, value: unknown) => {
    const r = schema.safeParse(value);
    expect(r.success, 'the fixture must actually fail to parse').toBe(false);
    return zodIssuesToFields(r.error.issues);
};

/** A flow definition that parses clean — each fixture below is one edit away. */
const WELL_FORMED_FLOW = {
    name: 'welcome_flow',
    label: 'Welcome',
    type: 'autolaunched',
    nodes: [{ id: 'n', type: 'notify', label: 'Notify', config: { message: 'hi' } }],
    edges: [],
};

describe('zodIssuesToFields — the D3 table against the real FlowSchema (#8124/#8055)', () => {
    it('the well-formed control parses clean, so every failure below is the planted edit', () => {
        expect(FlowSchema.safeParse(WELL_FORMED_FLOW).success).toBe(true);
    });

    it('an unknown node key arrives as unknown_field, never unrecognized_keys', () => {
        const fields = fieldsFor(FlowSchema, {
            ...WELL_FORMED_FLOW,
            nodes: [{ id: 'n', type: 'notify', label: 'Notify', next: 'other' }],
        });
        const unknownKey = fields.find((f) => f.message.includes('next'));
        expect(unknownKey, 'the offending key must still be named').toBeDefined();
        expect(unknownKey!.code).toBe('unknown_field');
        expect(fields.map((f) => f.code)).not.toContain('unrecognized_keys');
    });

    it('a node missing `label` is required with the input, invalid_type without — never a leak', () => {
        const bad = { ...WELL_FORMED_FLOW, nodes: [{ id: 'n', type: 'notify', config: { message: 'hi' } }] };

        const withInput = fieldsFor(FlowSchema, bad);
        const labelEntry = withInput.find((f) => f.field.endsWith('label'));
        expect(labelEntry).toBeDefined();
        expect(labelEntry!.code).toBe('required');

        const blind = fieldsForBlind(FlowSchema, bad);
        const blindLabel = blind.find((f) => f.field.endsWith('label'));
        expect(blindLabel).toBeDefined();
        expect(blindLabel!.code).toBe('invalid_type');
    });

    it('every code emitted for every #8055-shaped fixture is a catalog member', () => {
        const fixtures: unknown[] = [
            { ...WELL_FORMED_FLOW, nodes: [{ id: 'n', type: 'notify', config: { message: 'hi' } }] },
            { ...WELL_FORMED_FLOW, nodes: [{ id: 'n', type: 'notify', label: 'Notify', next: 'other' }] },
            { ...WELL_FORMED_FLOW, name: undefined },
            { ...WELL_FORMED_FLOW, type: 'no_such_flow_type' },
            { ...WELL_FORMED_FLOW, nodes: 'not-an-array' },
            'not even an object',
        ];
        for (const fixture of fixtures) {
            const fields = fieldsFor(FlowSchema, fixture);
            expect(fields.length).toBeGreaterThan(0);
            for (const f of fields) {
                expect(
                    () => FieldErrorCode.parse(f.code),
                    `'${f.code}' leaked onto the wire for ${JSON.stringify(fixture).slice(0, 60)}`,
                ).not.toThrow();
            }
        }
    });
});

describe('zodIssuesToFields — the ambiguous and unmapped Zod codes land on catalog members', () => {
    it('too_small / too_big are split by origin, the D3 disambiguation', () => {
        expect(fieldsFor(z.object({ a: z.string().min(3) }), { a: 'x' })[0].code).toBe('min_length');
        expect(fieldsFor(z.object({ a: z.number().min(5) }), { a: 1 })[0].code).toBe('min_value');
        expect(fieldsFor(z.object({ a: z.array(z.string()).min(2) }), { a: ['one'] })[0].code).toBe('min_items');
        expect(fieldsFor(z.object({ a: z.string().max(2) }), { a: 'toolong' })[0].code).toBe('max_length');
        expect(fieldsFor(z.object({ a: z.number().max(1) }), { a: 9 })[0].code).toBe('max_value');
        expect(fieldsFor(z.object({ a: z.array(z.string()).max(1) }), { a: ['a', 'b'] })[0].code).toBe('max_items');
    });

    it('custom lands on invalid_value; invalid_union on invalid_shape — catalog members both', () => {
        expect(fieldsFor(z.object({ a: z.string().refine(() => false, 'no') }), { a: 'x' })[0].code)
            .toBe('invalid_value');
        const unionFields = fieldsFor(
            z.object({ u: z.union([z.object({ k: z.string() }), z.object({ j: z.number() })]) }),
            { u: { k: 42 } },
        );
        expect(unionFields[0].code).toBe('invalid_shape');
        for (const f of unionFields) {
            expect(() => FieldErrorCode.parse(f.code), `'${f.code}' is not a catalog member`).not.toThrow();
        }
    });

    it('tolerates a non-array argument', () => {
        for (const junk of [null, undefined, {}, 'issues', 0]) {
            expect(zodIssuesToFields(junk)).toEqual([]);
        }
    });
});
