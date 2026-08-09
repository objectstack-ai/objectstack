// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { FieldErrorCode } from '@objectstack/spec/api';
// `.js` extension deliberately: under `moduleResolution: NodeNext` an
// extensionless relative import does not resolve, every symbol it names becomes
// `any`, and each callback over those symbols then reports TS7006 (AGENTS.md
// §Build & Test). This is the same spelling `rest-server.ts` itself uses.
import { zodIssuesToFields } from './rest-server.js';

/**
 * `invalid_union` expansion on the wire (#5014).
 *
 * Zod folds a failed `z.union([...])` into ONE top-level issue whose message is
 * the literal `"Invalid input"`; every branch's real complaint — including the
 * curated `strictObject` prescriptions the #4001 campaign wrote — lives in
 * `issue.errors`, one array per branch. Mapping only top-level issues therefore
 * put `{field: 'query.search', code: 'invalid_shape', message: 'Invalid input'}`
 * on the wire and dropped the sentence that says what to fix.
 *
 * Like `zod-field-codes.test.ts`, every case drives a REAL `safeParse`: the
 * expansion reads `issue.errors`, which is Zod's internal shape, so a test built
 * on a hand-written issue would keep passing after a Zod upgrade moved it while
 * the wire silently went back to reporting nothing but `Invalid input`.
 *
 * The selection policy is the one `formatZodError` landed for the terminal in
 * #4971 (`spec/src/shared/error-map.zod.ts`). The two must agree in VERDICT —
 * an author who publishes from the CLI and an author who POSTs the same mistake
 * must be told the same thing — so the cases below pin the parts of the policy
 * that decide *which* branches speak, not just that some branch does.
 */
describe('zodIssuesToFields — invalid_union expansion (#5014)', () => {
    const fieldsFor = (schema: z.ZodType, value: unknown) => {
        const r = schema.safeParse(value);
        expect(r.success, 'the fixture must actually fail to parse').toBe(false);
        return zodIssuesToFields((r as { error: { issues: unknown[] } }).error.issues, value);
    };

    describe('the live REST ingress path', () => {
        /**
         * `POST /api/v1/data/:object/query` parses the body against
         * `FindDataRequestSchema` (#3899) and reports through `zodIssuesToFields`.
         * `QuerySchema.search` is `z.union([z.string(), FullTextSearchSchema])`, so
         * a structured search missing its required `query` text is exactly the
         * defect: the union is all the author used to be told.
         */
        it('delivers a branch prescription instead of a bare Invalid input', async () => {
            const { FindDataRequestSchema } = await import('@objectstack/spec/api');
            const body = { object: 'account', query: { object: 'account', search: { fields: ['name'] } } };
            const fields = fieldsFor(FindDataRequestSchema as unknown as z.ZodType, body);

            // The union's own entry is still there, unchanged — clients read it today.
            expect(fields).toContainEqual({
                field: 'query.search',
                code: 'invalid_shape',
                message: 'Invalid input',
            });

            // …and now the branch that explains it reaches the author. `required`,
            // not `invalid_type`: the branch path is RELATIVE to the union, so the
            // input walk that tells "missing" from "wrong type" only lands on the
            // right slot once the path is resolved against the union's own.
            const prescription = fields.find((f) => f.field === 'query.search.query');
            expect(prescription, JSON.stringify(fields)).toBeDefined();
            expect(prescription!.code).toBe('required');
            expect(prescription!.message).not.toBe('Invalid input');
        });

        it('delivers the enum prescription from inside groupBy union arm', async () => {
            const { FindDataRequestSchema } = await import('@objectstack/spec/api');
            // `GroupByNodeSchema` = z.union([z.string(), {field, dateGranularity?, alias?}]).
            const body = {
                object: 'account',
                query: { object: 'account', groupBy: [{ field: 'closed_at', dateGranularity: 'decade' }] },
            };
            const fields = fieldsFor(FindDataRequestSchema as unknown as z.ZodType, body);

            const prescription = fields.find((f) => f.field === 'query.groupBy.0.dateGranularity');
            expect(prescription, JSON.stringify(fields)).toBeDefined();
            expect(prescription!.code).toBe('invalid_option');
            // The list of what IS accepted is the whole point of carrying it over.
            expect(prescription!.message).toContain('quarter');
        });
    });

    describe('branch selection', () => {
        /**
         * The regression the fewest-issues rule exists to prevent (the #4001 批 6c
         * shape): expanding every branch reports ONE unknown key once per branch,
         * so a three-member union turns a single typo into three `fields[]`
         * entries — noisier than the `Invalid input` it replaced.
         */
        it('reports a single unknown key once, not once per branch', () => {
            const member = (kind: string) =>
                z.object({ kind: z.literal(kind), [`${kind}Value`]: z.string() }).strict();
            const schema = z.object({
                widget: z.union([member('metric'), member('chart'), member('table')]),
            });

            const fields = fieldsFor(schema, {
                widget: { kind: 'metric', metricValue: 'x', typo: 1 },
            });

            const unknown = fields.filter((f) => f.code === 'unknown_field');
            expect(unknown, JSON.stringify(fields)).toHaveLength(1);
            expect(unknown[0].field).toBe('widget');
            expect(unknown[0].message).toContain('typo');
        });

        it('expands nothing when every branch is only a kind mismatch', () => {
            // `z.union([z.string(), z.number()])` handed an object: no branch has
            // anything to say beyond "not my type", and naming both is noise.
            const fields = fieldsFor(z.object({ u: z.union([z.string(), z.number()]) }), { u: {} });
            expect(fields).toEqual([{ field: 'u', code: 'invalid_shape', message: 'Invalid input' }]);
        });

        it('prefers the branch carrying unrecognized_keys when issue counts tie', () => {
            const schema = z.object({
                u: z.union([
                    // 1 issue: `a` is the wrong type.
                    z.object({ a: z.string() }),
                    // 1 issue too — but it is the unknown-key prescription, which is
                    // where the curated prose lives, so declaration order must not
                    // decide this one.
                    z.object({ b: z.string().optional() }).strict(),
                ]),
            });
            const fields = fieldsFor(schema, { u: { a: 1 } });
            const unknown = fields.find((f) => f.field === 'u' && f.code === 'unknown_field');
            expect(unknown, JSON.stringify(fields)).toBeDefined();
            expect(unknown!.message).toContain('a');
            // The loser branch's own complaint stays behind: one union, one story.
            expect(fields.some((f) => f.field === 'u.a')).toBe(false);
        });

        it('emits identical cross-branch verdicts once', () => {
            // Two members that reject the same key with the same words: the author
            // has one mistake, so the wire carries one entry.
            const same = () => z.object({ shared: z.string() });
            const fields = fieldsFor(z.object({ u: z.union([same(), same()]) }), { u: { shared: 1 } });
            expect(fields.filter((f) => f.field === 'u.shared')).toHaveLength(1);
        });

        it('caps how many tied branches are emitted', () => {
            const member = (n: number) => z.object({ [`k${n}`]: z.string() });
            const schema = z.object({ u: z.union([member(1), member(2), member(3), member(4), member(5)]) });
            const fields = fieldsFor(schema, { u: {} });
            // 1 union anchor + exactly 3 of the 5 tied branches: an author fixing
            // one shape does not need the other four spelled out, and an unbounded
            // expansion is how a union with many members becomes unreadable.
            expect(fields).toHaveLength(4);
            expect(fields[0]).toEqual({ field: 'u', code: 'invalid_shape', message: 'Invalid input' });
        });
    });

    describe('paths and codes of expanded entries', () => {
        it('resolves branch paths against the union path, through nesting', () => {
            const inner = z.union([z.string(), z.object({ kind: z.enum(['a', 'b']) }).strict()]);
            const outer = z.object({ w: z.union([z.number(), z.object({ nest: inner }).strict()]) });
            const fields = fieldsFor(outer, { w: { nest: { kind: 'zzz' } } });

            expect(fields.map((f) => f.field)).toContain('w.nest.kind');
            const leaf = fields.find((f) => f.field === 'w.nest.kind')!;
            expect(leaf.code).toBe('invalid_option');
        });

        it('tells missing from wrong-typed inside a branch, using the absolute path', () => {
            // The relative-path trap, pinned from both sides: `a` is PRESENT with
            // the wrong type, `b` is absent. Walking the branch-relative path would
            // miss both values and report each as `required`.
            const schema = z.object({ u: z.union([z.string(), z.object({ a: z.string(), b: z.string() })]) });
            const fields = fieldsFor(schema, { u: { a: 1 } });
            expect(fields.find((f) => f.field === 'u.a')!.code).toBe('invalid_type');
            expect(fields.find((f) => f.field === 'u.b')!.code).toBe('required');
        });

        it('keeps every expanded code inside the ADR-0114 catalog', () => {
            const schema = z.object({
                u: z.union([
                    z.string(),
                    z.object({
                        n: z.number().min(3),
                        s: z.string().email(),
                        arr: z.array(z.string()).max(1),
                    }).strict(),
                ]),
            });
            const fields = fieldsFor(schema, { u: { n: 1, s: 'nope', arr: ['a', 'b'], extra: true } });
            expect(fields.length).toBeGreaterThan(1);
            for (const f of fields) {
                expect(() => FieldErrorCode.parse(f.code), `'${f.code}' is not a catalog member`).not.toThrow();
            }
        });
    });

    describe('wire compatibility (ADR-0114)', () => {
        /**
         * The expansion is ADDITIVE. Every entry the route emitted before still
         * appears, in the same order, with the same `field`/`code`/`message`;
         * branch entries are inserted after the union entry they explain. Nothing
         * about `{field, code, message}` changes, which is what ADR-0114 requires
         * of anything sharing `mapDataError`'s envelope — the array's LENGTH was
         * never part of that contract.
         */
        it('leaves non-union issues mapped exactly one-to-one', () => {
            const schema = z.object({ a: z.string(), b: z.number() });
            const fields = fieldsFor(schema, { a: 1 });
            expect(fields).toEqual([
                { field: 'a', code: 'invalid_type', message: expect.any(String) },
                { field: 'b', code: 'required', message: expect.any(String) },
            ]);
        });

        it('keeps the union entry first and unchanged among its expansion', () => {
            const schema = z.object({
                a: z.string(),
                u: z.union([z.string(), z.object({ deep: z.string() })]),
                z: z.number(),
            });
            const fields = fieldsFor(schema, { a: 'ok', u: {}, z: 1 });
            const idx = fields.findIndex((f) => f.field === 'u');
            expect(fields[idx]).toEqual({ field: 'u', code: 'invalid_shape', message: 'Invalid input' });
            // The independent `z`/`a` issues keep their own relative order.
            expect(fields.filter((f) => f.field === 'u.deep')).toHaveLength(1);
            expect(fields.findIndex((f) => f.field === 'u.deep')).toBe(idx + 1);
        });

        it('still tolerates junk in place of an issue list', () => {
            for (const junk of [null, undefined, {}, 'issues', 0]) {
                expect(zodIssuesToFields(junk)).toEqual([]);
            }
            // …and an `invalid_union` whose `errors` is absent or malformed.
            expect(zodIssuesToFields([{ code: 'invalid_union', path: ['x'], message: 'Invalid input' }]))
                .toEqual([{ field: 'x', code: 'invalid_shape', message: 'Invalid input' }]);
            expect(zodIssuesToFields([{ code: 'invalid_union', path: ['x'], message: 'Invalid input', errors: 'nope' }]))
                .toEqual([{ field: 'x', code: 'invalid_shape', message: 'Invalid input' }]);
        });
    });
});

/**
 * [#5389] `invalid_key` / `invalid_element` — the same defect, one property
 * name over, on the same wire.
 *
 * `invalid_union` buries a branch's real complaint in `issue.errors[]`; these
 * two bury the key/element schema's real complaint in `issue.issues[]`. Before
 * this, a client POSTing a record with a bad KEY got exactly one `fields[]`
 * entry — `{field: 'fields.First Name', code: 'invalid_shape', message:
 * 'Invalid key in record'}` — with the sentence naming the rule produced and
 * dropped, which is #5014 verbatim.
 *
 * The expansion is strictly ADDITIVE, same contract as #5014: the container's
 * own entry stays (it is the only one naming the slot, and existing clients
 * read it) and the leaf entries follow it. ADR-0114's `{field, code, message}`
 * shape is unchanged, and the container entry keeps mapping to `invalid_shape`.
 *
 * Every fixture drives a REAL `safeParse`, for the reason the file's header
 * gives: `issue.issues` is Zod's internal shape.
 */
describe('zodIssuesToFields — invalid_key / invalid_element descent (#5389)', () => {
    const fieldsFor = (schema: z.ZodType, value: unknown) => {
        const r = schema.safeParse(value);
        expect(r.success, 'the fixture must actually fail to parse').toBe(false);
        return zodIssuesToFields((r as { error: { issues: unknown[] } }).error.issues, value);
    };

    const SnakeKey = z
        .string()
        .regex(/^[a-z][a-z0-9_]*$/, "Invalid identifier. Must be lowercase snake_case (e.g. 'first_name').");

    it('delivers the KEY schema prescription beside the container entry', () => {
        const schema = z.object({ fields: z.record(SnakeKey, z.object({ type: z.string() })) });
        const fields = fieldsFor(schema, { fields: { 'First Name': { type: 'text' } } });

        expect(fields).toEqual([
            // Unchanged — the entry clients read today.
            { field: 'fields.First Name', code: 'invalid_shape', message: 'Invalid key in record' },
            // …and the leaf that says WHY, with the container's path resolved.
            {
                field: 'fields.First Name',
                code: 'invalid_format',
                message: "Invalid identifier. Must be lowercase snake_case (e.g. 'first_name').",
            },
        ]);
    });

    it('emits EVERY nested issue — a container has no branches to rank', () => {
        // Deliberate divergence from the union descent: `errors[]` holds
        // competing candidates, so it is ranked and capped; `issues[]` is the
        // one list the element schema produced, and each entry is a real field.
        const schema = z.map(
            z.object({ id: z.string() }),
            z.object({ a: z.string(), b: z.string(), c: z.string() }),
        );
        const fields = fieldsFor(schema, new Map([[{ id: 'x' }, {}]]));
        expect(fields[0]).toMatchObject({ code: 'invalid_shape' });
        expect(fields.map((f) => f.field)).toEqual(['', 'a', 'b', 'c']);
    });

    it('keeps the catalog code an ADR-0114 member on every entry', () => {
        const schema = z.object({ fields: z.record(SnakeKey, z.unknown()) });
        const codes = FieldErrorCode.options as readonly string[];
        for (const entry of fieldsFor(schema, { fields: { 'Bad Key': 1 } })) {
            expect(codes).toContain(entry.code);
        }
    });

    it('leaves an ordinary issue exactly as it was', () => {
        const schema = z.object({ a: z.string() });
        expect(fieldsFor(schema, {})).toEqual([
            { field: 'a', code: 'required', message: 'Invalid input: expected string, received undefined' },
        ]);
    });

    it('still tolerates a container issue with no nested list', () => {
        expect(zodIssuesToFields([{ code: 'invalid_key', path: ['m', 'k'], message: 'Invalid key in record' }]))
            .toEqual([{ field: 'm.k', code: 'invalid_shape', message: 'Invalid key in record' }]);
        expect(zodIssuesToFields([{ code: 'invalid_element', path: ['m'], message: 'Invalid value', issues: 'nope' }]))
            .toEqual([{ field: 'm', code: 'invalid_shape', message: 'Invalid value' }]);
    });
});
