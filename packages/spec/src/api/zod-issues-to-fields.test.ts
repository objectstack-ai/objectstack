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
import { ZOD_UNION_DEFAULT_MESSAGE, zodIssuesToFields } from './zod-issues-to-fields';
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
    // `recipients` and `title` are the keys the notify executor contract
    // requires; the flow parse refuses a notify node that leaves them out.
    nodes: [{ id: 'n', type: 'notify', label: 'Notify', config: { recipients: [{ dialect: 'cel', source: 'record.owner' }], title: 'Welcome', message: 'hi' } }],
    edges: [],
};

describe('zodIssuesToFields — the D3 table against the real FlowSchema', () => {
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

    it('every code emitted for every malformed-flow-body fixture is a catalog member', () => {
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
        // Every branch a bare kind mismatch: nothing below explains the union,
        // so its own entry is the whole answer and is kept (#35433).
        const unionFields = fieldsFor(z.object({ u: z.union([z.string(), z.number()]) }), { u: {} });
        expect(unionFields.map((f) => f.code)).toEqual(['invalid_shape']);
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

/**
 * [#35433] The maintainer's ruling: `fields[]` drops a union's own entry — zod's
 * bare `"Invalid input"`, mapped to `invalid_shape` — whenever an entry below
 * explains it, at every depth, and keeps it when nothing does. The same rule the
 * metadata envelope took on #35400, so the two machine lists agree; the
 * cross-package pin lives in `metadata-protocol`'s
 * `union-branch-policy.cross-package-parity.test.ts`.
 */
describe('zodIssuesToFields — an explained bare union head is dropped (#35433)', () => {
    // adr0112-ok: D6 — a field-addressed FieldErrorCode in a fields[] entry
    const HEAD = { code: 'invalid_shape', message: ZOD_UNION_DEFAULT_MESSAGE };

    it('the compared text is zod\'s real default for a failed union', () => {
        const r = z.union([z.string(), z.number()]).safeParse({});
        expect(r.success).toBe(false);
        expect(r.error!.issues[0]!.code).toBe('invalid_union');
        expect(r.error!.issues[0]!.message).toBe(ZOD_UNION_DEFAULT_MESSAGE);
    });

    it('a top-level union head is dropped, so fields[0] is the located cause', () => {
        const fields = fieldsFor(
            z.object({ u: z.union([z.string(), z.object({ a: z.string() }).strict()]) }),
            { u: {} },
        );
        expect(fields.map((f) => [f.field, f.code])).toEqual([['u.a', 'required']]);
        expect(fields).not.toContainEqual(expect.objectContaining(HEAD));
    });

    it('every head of a nested union is dropped while something below explains it', () => {
        const inner = z.union([z.object({ a: z.string() }).strict(), z.object({ b: z.string() }).strict()]);
        const fields = fieldsFor(
            z.object({ outer: z.union([z.object({ inner }).strict(), z.number()]) }),
            { outer: { inner: { a: 1 } } },
        );
        expect(fields.map((f) => [f.field, f.code])).toEqual([['outer.inner.a', 'invalid_type']]);
    });

    it('a head nothing below explains is kept — every branch a kind mismatch, or the depth bound', () => {
        expect(fieldsFor(z.object({ u: z.union([z.string(), z.number()]) }), { u: {} }))
            .toEqual([{ field: 'u', ...HEAD }]);

        // Four nested unions; the walk stops after three levels, so the fourth
        // head is the last word and is kept, and only the three above it go.
        const nested = (depth: number): z.ZodTypeAny => depth === 0
            ? z.object({ leaf: z.string() }).strict()
            : z.union([z.object({ next: nested(depth - 1) }).strict(), z.object({ sibling: z.number() }).strict()]);
        expect(fieldsFor(z.object({ u: nested(4) }), { u: { next: { next: { next: { next: { leaf: 1 } } } } } }))
            .toEqual([{ field: 'u.next.next.next', ...HEAD }]);
    });

    it('a head carrying the schema\'s own sentence is kept ahead of what it explains', () => {
        const authored = 'Write a label string or an object with a `text` key.';
        const fields = fieldsFor(
            z.object({ u: z.union([z.string(), z.object({ text: z.string() }).strict()], { error: authored }) }),
            { u: {} },
        );
        expect(fields.map((f) => [f.field, f.code, f.message])).toEqual([
            ['u', 'invalid_shape', authored],
            ['u.text', 'required', expect.any(String)],
        ]);
    });

    it('a container head is kept whatever follows it — it alone says the KEY was refused', () => {
        const fields = fieldsFor(
            z.object({ m: z.record(z.string().regex(/^[a-z_]+$/, 'Must be snake_case.'), z.number()) }),
            { m: { 'Bad Key': 1 } },
        );
        expect(fields.map((f) => [f.field, f.code, f.message])).toEqual([
            ['m.Bad Key', 'invalid_shape', 'Invalid key in record'],
            ['m.Bad Key', 'invalid_format', 'Must be snake_case.'],
        ]);
    });
});
