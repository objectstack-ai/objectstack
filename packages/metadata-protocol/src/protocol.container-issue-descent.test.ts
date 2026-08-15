// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #8783 — `saveMetaItem`'s `422 INVALID_METADATA` descends the CONTAINER issue
 * codes, so a rejected record KEY arrives with the rule it broke.
 *
 * ## The defect
 *
 * Zod raises `invalid_key` (a `z.record`/`z.map` key schema rejected a key) and
 * `invalid_element` (a `z.map` value schema rejected a value under a
 * non-`PropertyKey` key) with a bare wrapper as the issue's OWN message —
 * `"Invalid key in record"` — and the real diagnosis one level down in
 * `issue.issues`. That is structurally the `invalid_union` shape #4971 named:
 * the prescription is produced and then dropped by a walk that reads only the
 * top level.
 *
 * Both `packages/spec` walks learned to descend those codes in #5389.
 * `zodIssuesToMetadataIssues` — the walk behind this 422 (#5364) and the read
 * path's diagnostics (#5598) — expanded `invalid_union` only, so it stopped at
 * the wrapper.
 *
 * ## Why it mattered rather than being dormant drift
 *
 * `ObjectSchema.fields` is a record whose KEY schema carries the snake_case
 * rule (`spec/src/data/object.zod.ts`), and `object` is in the builtin
 * `getMetadataTypeSchema` registry. So the commonest authoring mistake on the
 * most-authored metadata type — writing `firstName` for a field key — went
 * `saveMetaItem` → 422 → this walk and reached Studio as
 * `{path: 'fields.firstName', code: 'invalid_key', message: 'Invalid key in
 * record'}`, with *"Field names must be lowercase snake_case"* stranded one
 * level below. {@link https://github.com/objectstack-ai/objectstack/issues/8783}
 *
 * ## What these pins assert, and what they deliberately do not
 *
 * The descent is ADDITIVE — the wrapper entry stays and the detail joins it —
 * because that is what the other two walks were **measured** to do over the
 * card's own repro before this changed, not because additive is nicer:
 *
 * ```
 * prose (formatZodIssue)   ✗ m.ab: Invalid key in record
 *                            ✗ m.ab: Too small: expected string to have >=4 characters
 * wire  (zodIssuesToFields) [{field: 'm.ab', code: 'invalid_shape', …wrapper},
 *                            {field: 'm.ab', code: 'min_length',    …detail }]
 * ```
 *
 * The three-walk agreement itself is pinned across the package boundary in
 * `union-branch-policy.cross-package-parity.test.ts` §5. This file pins the
 * envelope THIS package serves, plus the controls that show the change is a
 * targeted second descent rather than a widened walk: an `invalid_union` still
 * expanding exactly as it did, a plain issue still passing through untouched,
 * and an `issues` payload on any other code still ignored.
 */
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
// [#5619] The producer's OWN write-verb dispatch decisions, so the fake engine
// cannot accept a call ObjectQL would refuse. From `@objectstack/metadata-core`
// and not `@objectstack/objectql`, which depends on this package.
import { assertEngineDeleteDispatch, assertEngineUpdateDispatch } from '@objectstack/metadata-core';
import { getMetadataTypeSchema } from '@objectstack/spec/kernel';
import { ObjectStackProtocolImplementation, zodIssuesToMetadataIssues } from './protocol.js';

interface Row {
    id: string;
    type: string;
    name: string;
    organization_id: string | null;
    state: string;
    metadata: string;
}

const keyOf = (w: Record<string, unknown>) =>
    `${w.type}|${w.name}|${w.organization_id ?? '__env__'}|${w.state ?? 'active'}`;

/** The engine surface the repository write path touches (as #5364's harness). */
function makeProtocol() {
    const rows = new Map<string, Row>();
    let nextId = 0;
    const engine: any = {
        async findOne() { return null; },
        async find() { return []; },
        async insert(table: string, data: Record<string, unknown>) {
            if (table === 'sys_metadata_audit') return { id: 'audit_skip' };
            nextId += 1;
            const row = { id: `r_${nextId}`, ...(data as any) } as Row;
            rows.set(keyOf(data), row);
            return { id: row.id };
        },
        async update(_t: string, data: Record<string, unknown>, opts?: Record<string, unknown>) {
            assertEngineUpdateDispatch(data, opts);
            return { id: null };
        },
        async delete(_t: string, opts?: Record<string, unknown>) {
            assertEngineDeleteDispatch(opts);
            return { deleted: 0 };
        },
        registry: { registerItem: () => {}, registerObject: () => {} },
    };
    const protocol: any = new ObjectStackProtocolImplementation(engine, () => new Map());
    return { protocol, rows };
}

async function rejection(promise: Promise<unknown>): Promise<any> {
    try {
        await promise;
    } catch (err) {
        return err;
    }
    throw new Error('expected the save to be rejected, but it resolved');
}

/** The card's measured synthetic repro, verbatim. */
const syntheticSchema = z.object({ m: z.record(z.string().min(4), z.string()) });
const syntheticValue = { m: { ab: 'x' } };

/**
 * The real one: an authored object whose field key is not snake_case.
 *
 * `sharingModel` is present so the POSITIVE control below reaches a successful
 * save — ADR-0090 D1's author-time gate refuses a custom object that declares
 * no OWD, one layer AFTER the schema parse this card is about. It changes
 * nothing for the rejection fixtures, which never get that far.
 */
const authoredObject = (fieldKey: string) => ({
    name: 'contact',
    label: 'Contact',
    sharingModel: 'private',
    fields: {
        [fieldKey]: { name: fieldKey, label: 'First Name', type: 'text' },
    },
});

const SNAKE_CASE_RULE = 'Field names must be lowercase snake_case';

function issuesOf(schema: z.ZodTypeAny, value: unknown): readonly unknown[] {
    const result = schema.safeParse(value);
    expect(result.success, 'the fixture must actually fail to parse').toBe(false);
    return (result as { error: { issues: readonly unknown[] } }).error.issues;
}

describe('#8783 zod strands a container rejection one level down (the defect, pinned)', () => {
    it('the synthetic repro raises ONE issue whose own message says nothing useful', () => {
        // The reverse verification for this change, stated as a fact about zod
        // rather than as a code revert: this is exactly what a walk reading
        // only the top level had to work with. Take the container descent back
        // out of `collectMetadataIssues` and every assertion below that reads a
        // second entry goes red, because `issue.issues` is the only place the
        // prescription exists.
        const issues = issuesOf(syntheticSchema, syntheticValue) as any[];

        expect(issues).toHaveLength(1);
        expect(issues[0]).toMatchObject({ code: 'invalid_key', message: 'Invalid key in record' });
        expect(issues[0].path).toEqual(['m', 'ab']);
        expect(issues[0].issues[0].message).toContain('expected string to have >=4 characters');
    });

    it('the REAL repro does the same to the snake_case rule on `object.fields`', () => {
        const schema = getMetadataTypeSchema('object')! as any;
        const issues = issuesOf(schema, authoredObject('firstName')) as any[];

        expect(issues).toHaveLength(1);
        expect(issues[0]).toMatchObject({ code: 'invalid_key', message: 'Invalid key in record' });
        expect(issues[0].path).toEqual(['fields', 'firstName']);
        // The declared prescription exists and is correct — it was simply not
        // reachable from the top-level issue.
        expect(issues[0].issues[0].message).toContain(SNAKE_CASE_RULE);
    });
});

describe('#8783 the descent: the prescription reaches the envelope', () => {
    it('the card\'s synthetic repro surfaces the detail, not just the wrapper', () => {
        const out = zodIssuesToMetadataIssues(issuesOf(syntheticSchema, syntheticValue));

        expect(out).toEqual([
            // Additive: the wrapper is entry 0, unmoved, exactly as it shipped.
            { path: 'm.ab', message: 'Invalid key in record', code: 'invalid_key' },
            {
                path: 'm.ab',
                message: 'Too small: expected string to have >=4 characters',
                code: 'too_small',
            },
        ]);
    });

    it('the descended entry\'s path is resolved against the container\'s own', () => {
        // Container issues carry paths RELATIVE to the wrapper, the same trap
        // #5014 paid for on union branches: the inner issue's own path is `[]`,
        // and an unresolved reading would report the document root.
        const raw = issuesOf(syntheticSchema, syntheticValue) as any[];
        expect(raw[0].issues[0].path).toEqual([]);

        expect(zodIssuesToMetadataIssues(raw)[1]!.path).toBe('m.ab');
    });

    it('`invalid_element` descends too — the other half of the code set', () => {
        // `z.map`'s VALUE schema rejecting under a non-PropertyKey key is the
        // only way to reach this code, so the fixture needs an object key.
        const schema = z.map(z.object({ k: z.string() }), z.string().min(4));
        const issues = issuesOf(schema, new Map([[{ k: 'a' }, 'x']])) as any[];

        expect(issues[0].code).toBe('invalid_element');
        const out = zodIssuesToMetadataIssues(issues);
        expect(out).toHaveLength(2);
        expect(out[1]!.message).toContain('expected string to have >=4 characters');
    });
});

describe('#8783 the 422 an author actually receives', () => {
    it('a non-snake_case field key: the rule reaches the author through the envelope', async () => {
        const { protocol, rows } = makeProtocol();

        const err = await rejection(
            protocol.saveMetaItem({ type: 'object', name: 'contact', item: authoredObject('firstName') }),
        );

        // The ADR-0112 envelope, both halves.
        expect(err.code).toBe('INVALID_METADATA');
        expect(err.status).toBe(422);
        // Load-bearing: the verdict is unchanged. #8783 moves what the refusal
        // SAYS, never whether it is one — nothing is persisted either way.
        expect(rows.size).toBe(0);

        // The entry that shipped before this change, unmoved at index 0: it is
        // the only one naming the slot, and Studio's designer keys on it.
        expect(err.issues[0]).toEqual({
            path: 'fields.firstName',
            message: 'Invalid key in record',
            code: 'invalid_key',
        });

        // …and the sentence that says what a valid key looks like now rides
        // along, on the same slot, which is the whole card.
        expect(err.issues).toHaveLength(2);
        expect(err.issues[1]!.path).toBe('fields.firstName');
        expect(err.issues[1]!.message).toContain(SNAKE_CASE_RULE);
        expect(err.issues[1]!.message).toContain('first_name');
        expect(err.issues[1]!.code).toBe('invalid_format');
    });

    it('the same object with a snake_case key still saves — no rejection is invented', async () => {
        const { protocol, rows } = makeProtocol();

        const result = await protocol.saveMetaItem({
            type: 'object',
            name: 'contact',
            item: authoredObject('first_name'),
        });

        expect(result.success).toBe(true);
        expect(rows.size).toBe(1);
    });
});

describe('#8783 controls — a second descent, not a widened walk', () => {
    const union = (errors: unknown[][], path: unknown[] = []) =>
        ({ code: 'invalid_union', message: 'Invalid input', path, errors });

    it('a plain non-container issue still passes through byte-identical', () => {
        expect(zodIssuesToMetadataIssues([
            { code: 'invalid_type', message: 'Required', path: ['label'] },
        ])).toEqual([
            { path: 'label', message: 'Required', code: 'invalid_type' },
        ]);
    });

    it('an `invalid_union` still expands by the ranking, unchanged', () => {
        // Verbatim the #5364 pin: fewest issues wins, `unrecognized_keys`
        // breaks the tie. Container descent must not have perturbed it.
        const out = zodIssuesToMetadataIssues([union([
            [{ code: 'invalid_value', message: 'wrong discriminator', path: ['kind'] }],
            [{ code: 'unrecognized_keys', message: 'Unrecognized key(s): `nmae`', path: [] }],
            [
                { code: 'invalid_value', message: 'wrong discriminator', path: ['kind'] },
                { code: 'invalid_type', message: 'Required', path: ['title'] },
            ],
        ])]);

        expect(out).toEqual([
            { path: '', message: 'Invalid input', code: 'invalid_union' },
            { path: '', message: 'Unrecognized key(s): `nmae`', code: 'unrecognized_keys' },
        ]);
    });

    it('⛔ an `issues` payload on any OTHER code is NOT descended', () => {
        // The targeting assertion. Zod hangs `issues` on the container codes;
        // a walk that descended whatever nests would emit the inner entry here
        // too, and would be the "widened indiscriminately" outcome the card
        // ruled out. Only the code set opens the door.
        const out = zodIssuesToMetadataIssues([{
            code: 'custom',
            message: 'Invalid input',
            path: ['x'],
            issues: [{ code: 'too_small', message: 'inner detail', path: [] }],
        }]);

        expect(out).toEqual([{ path: 'x', message: 'Invalid input', code: 'custom' }]);
    });

    it('a container issue with no payload is the wrapper alone, as before', () => {
        expect(zodIssuesToMetadataIssues([
            { code: 'invalid_key', message: 'Invalid key in record', path: ['m', 'ab'] },
        ])).toEqual([
            { path: 'm.ab', message: 'Invalid key in record', code: 'invalid_key' },
        ]);
        // …and an empty list behaves the same, rather than descending nothing
        // and losing the de-duplication the non-expandable branch applies.
        expect(zodIssuesToMetadataIssues([
            { code: 'invalid_key', message: 'Invalid key in record', path: ['m'], issues: [] },
        ])).toEqual([
            { path: 'm', message: 'Invalid key in record', code: 'invalid_key' },
        ]);
    });

    it('a union BELOW a container is expanded by the ranking, not emitted whole', () => {
        // The two descents compose, and each level applies its own rule: the
        // container emits every issue it has, the union below it selects.
        const out = zodIssuesToMetadataIssues([{
            code: 'invalid_key',
            message: 'Invalid key in record',
            path: ['m', 'ab'],
            issues: [union([
                [{ code: 'invalid_type', message: 'expected string', path: [] }],
                [{ code: 'unrecognized_keys', message: 'Unrecognized key(s): `q`', path: [] }],
            ])],
        }]);

        expect(out.map((e) => [e.path, e.code])).toEqual([
            ['m.ab', 'invalid_key'],
            ['m.ab', 'invalid_union'],
            ['m.ab', 'unrecognized_keys'],
        ]);
    });

    it('the nesting bound covers the container descent as well', () => {
        // Four nested containers: three levels are expanded and the fourth is
        // emitted as a head only, so `leaf` is never reached — the same bound
        // the union descent has always applied, now shared.
        const container = (path: unknown[], inner: unknown): unknown => ({
            code: 'invalid_key', message: 'Invalid key in record', path, issues: [inner],
        });
        const leaf = { code: 'too_small', message: 'leaf', path: [] };
        const out = zodIssuesToMetadataIssues([
            container(['a'], container(['b'], container(['c'], container(['d'], leaf)))),
        ]);

        expect(out.map((e) => e.path)).toEqual(['a', 'a.b', 'a.b.c', 'a.b.c.d']);
        expect(out.some((e) => e.message === 'leaf')).toBe(false);
    });

    it('two containers rejecting the same key with the same words say it once', () => {
        // The `seen` de-duplication is per top-level issue and applies to the
        // descended leaves, exactly as it does under a union.
        const detail = () => [{ code: 'too_small', message: 'too short', path: [] }];
        const out = zodIssuesToMetadataIssues([{
            code: 'invalid_key',
            message: 'Invalid key in record',
            path: ['m', 'ab'],
            issues: [...detail(), ...detail()],
        }]);

        expect(out).toHaveLength(2);
        expect(out[1]!.message).toBe('too short');
    });
});
