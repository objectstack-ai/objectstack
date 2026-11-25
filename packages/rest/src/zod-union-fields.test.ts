// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, afterEach } from 'vitest';
import { z } from 'zod';
import { FieldErrorCode } from '@objectstack/spec/api';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
import { installDefaultOrganization } from './default-organization.testkit.js';
// `.js` extension deliberately: under `moduleResolution: NodeNext` an
// extensionless relative import does not resolve, every symbol it names becomes
// `any`, and each callback over those symbols then reports TS7006 (AGENTS.md
// §Build & Test). This is the same spelling `rest-server.ts` itself uses.
import { RestServer, zodIssuesToFields } from './rest-server.js';

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

            // [#35433] The union's own bare entry is gone: the branch below
            // explains it, so `fields[0]` is the located cause.
            expect(fields).not.toContainEqual(expect.objectContaining({
                field: 'query.search',
                code: 'invalid_shape',
            }));
            expect(fields[0]!.field).toBe('query.search.query');

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
            // Exactly 3 of the 5 tied branches: an author fixing one shape does
            // not need the other four spelled out, and an unbounded expansion is
            // how a union with many members becomes unreadable. The explained
            // bare union entry is not among them (#35433).
            expect(fields.map((f) => f.field)).toEqual(['u.k1', 'u.k2', 'u.k3']);
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
         * Branch entries take the place of the union entry they explain, and
         * nothing about `{field, code, message}` changes, which is what ADR-0114
         * requires of anything sharing `mapDataError`'s envelope — the array's
         * LENGTH was never part of that contract. [#35433] The union entry
         * itself — zod's bare `Invalid input`, `invalid_shape` — is dropped when
         * an entry below explains it, and kept when nothing does; the
         * expansion is no longer strictly additive, by the maintainer's ruling.
         */
        it('leaves non-union issues mapped exactly one-to-one', () => {
            const schema = z.object({ a: z.string(), b: z.number() });
            const fields = fieldsFor(schema, { a: 1 });
            expect(fields).toEqual([
                { field: 'a', code: 'invalid_type', message: expect.any(String) },
                { field: 'b', code: 'required', message: expect.any(String) },
            ]);
        });

        it('puts the explanation where the explained union entry stood, and keeps an unexplained one', () => {
            const schema = z.object({
                a: z.string(),
                u: z.union([z.string(), z.object({ deep: z.string() })]),
                z: z.string(),
            });
            const fields = fieldsFor(schema, { a: 1, u: {}, z: 1 });
            // [#35433] `u`'s bare entry is dropped; its one cause sits in its
            // place, between the independent `a` and `z` issues.
            expect(fields.map((f) => [f.field, f.code])).toEqual([
                ['a', 'invalid_type'], ['u.deep', 'required'], ['z', 'invalid_type'],
            ]);

            // CONTROL — every branch a bare kind mismatch: nothing explains the
            // union, so its own entry is the whole answer and stays.
            const alone = fieldsFor(z.object({ u: z.union([z.string(), z.number()]) }), { u: {} });
            expect(alone).toEqual([{ field: 'u', code: 'invalid_shape', message: 'Invalid input' }]);
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
 * This expansion is strictly ADDITIVE: the container's own entry stays (its
 * code is the only one saying a KEY was refused, and existing clients read it)
 * and the leaf entries follow it. The union expansion (#5014) no longer is —
 * since #35433 an explained union entry is dropped — so the two descents now
 * differ on exactly this point. ADR-0114's `{field, code, message}`
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

/**
 * [#35500] `POST /api/v1/data/:object/query` with a `where` of the wrong kind,
 * through the real route over a real engine and driver.
 *
 * `where` on that door is `z.union([FilterArraySchema, DataEngineFilterSchema])`,
 * and both members are themselves unions. A number, a string or `null` used to
 * answer one bare `{field: 'query.where', code: 'invalid_shape', message:
 * 'Invalid input'}` per member and nothing that said what to send, so an AI
 * caller had nothing to retry with. A member that is itself a bare union of
 * kinds is now read as the kind mismatch it is, and the slot's own sentence
 * names the two shapes it takes.
 */
describe('[#35500] POST /data/:object/query — a wrong-typed where answers one entry that names the shapes', () => {
    const OBJECT = 'where_shape_35500';
    const TASKS = {
        name: OBJECT,
        label: 'Where shape 35500',
        fields: {
            status: { name: 'status', type: 'text' as const },
            amount: { name: 'amount', type: 'number' as const },
        },
    };
    const ROWS = [
        { id: 'r1', status: 'open', amount: 50 },
        { id: 'r2', status: 'done', amount: 500 },
    ];

    const live: ObjectQL[] = [];
    afterEach(async () => {
        while (live.length) {
            try { await live.pop()?.destroy(); } catch { /* noop */ }
        }
    });

    const noop = () => {};
    const mockServer = () => ({ get: noop, post: noop, put: noop, delete: noop, patch: noop, use: noop, listen: async () => {}, close: async () => {} });
    const makeRes = () => {
        const res: any = {
            write: () => true, end: () => {},
            header: () => res,
            status: (code: number) => { res._status = code; return res; },
            json: (body: any) => { res._json = body; return res; },
        };
        return res;
    };

    async function boot() {
        const driver: any = new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true });
        const engine = new ObjectQL();
        live.push(engine);
        engine.registerDriver(driver, true);
        await engine.init();
        engine.registry.registerObject(TASKS as any);
        await engine.syncSchemas();
        await installDefaultOrganization(engine);
        await engine.insert(OBJECT, ROWS as any);

        const calls = { find: 0 };
        const find = driver.find.bind(driver);
        driver.find = (o: string, ...rest: unknown[]) => { if (o === OBJECT) calls.find += 1; return find(o, ...rest); };

        const protocol = new ObjectStackProtocolImplementation(engine as any);
        const rest = new RestServer(mockServer() as any, protocol as any, { api: { requireAuth: false } } as any);
        (rest as any).resolveExecCtx = async () => ({ userId: 'test-user' });
        rest.registerRoutes();
        const route = rest.getRoutes().find((r: any) => r.method === 'POST' && r.path === '/api/v1/data/:object/query');
        expect(route).toBeDefined();
        const post = async (body: Record<string, unknown>) => {
            const res = makeRes();
            // What the wire carries: JSON.
            await route!.handler({ params: { object: OBJECT }, body: JSON.parse(JSON.stringify(body)) } as any, res);
            return res;
        };
        return { post, calls };
    }

    it.each([
        ['42', 42],
        ['a string', 'status = open'],
        ['null', null],
    ])('%s: 400 VALIDATION_FAILED with exactly one fields[] entry, before any read', async (_name, where) => {
        const { post, calls } = await boot();
        const res = await post({ where });
        expect(res._status).toBe(400);
        expect(res._json.code).toBe('VALIDATION_FAILED');
        expect(res._json.fields.map((f: any) => [f.field, f.code])).toEqual([['query.where', 'invalid_shape']]);
        // The entry names both accepted shapes instead of zod's bare default.
        expect(res._json.fields[0].message).not.toBe('Invalid input');
        expect(res._json.fields[0].message).toContain('condition object');
        expect(res._json.fields[0].message).toContain('filter array');
        expect(calls.find).toBe(0);
    });

    it('a malformed AST: 400 VALIDATION_FAILED with its located causes and no duplicate Invalid input', async () => {
        const { post, calls } = await boot();
        const res = await post({ where: [['status', '=', 'open'], 'and'] });
        expect(res._status).toBe(400);
        expect(res._json.code).toBe('VALIDATION_FAILED');
        expect(res._json.fields).toEqual([
            { field: 'query.where', code: 'min_items', message: expect.any(String) },
            { field: 'query.where.1', code: 'invalid_shape', message: 'Invalid input' },
        ]);
        expect(calls.find).toBe(0);
    });

    it('CONTROL: a valid filter object and a valid filter array are still served', async () => {
        const { post, calls } = await boot();
        const asObject = await post({ where: { status: 'open' } });
        expect(asObject._status ?? 200).toBe(200);
        expect(asObject._json.records.map((r: any) => r.id)).toEqual(['r1']);

        const asArray = await post({ where: ['amount', '>', 100] });
        expect(asArray._status ?? 200).toBe(200);
        expect(asArray._json.records.map((r: any) => r.id)).toEqual(['r2']);
        expect(calls.find).toBe(2);
    });
});
