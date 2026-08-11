// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #5364 — `saveMetaItem`'s `422 INVALID_METADATA` keeps the union branch that
 * explains the rejection.
 *
 * The 422's own comment promises "structured Zod issues so the Studio form can
 * highlight the offending field". A top-level `z.union` broke that promise
 * completely: zod folds every branch of a failed union into ONE issue whose
 * path is `''` and whose message is the literal `"Invalid input"`, and the old
 * `parsed.error.issues.map(…)` mapped exactly that. Since `ViewMetadataSchema`
 * IS a top-level union (`view.zod.ts` — `z.preprocess(…, z.union([…]))`), EVERY
 * failed `view` save arrived at Studio as one rootless line with no field name
 * in it at all.
 *
 * This is the fourth consumer of one mechanism, and the verdict must match the
 * other three by construction — `formatZodError` (#4971, spec),
 * `zodIssuesToFields` (#5014, rest), `formatZodErrors` (#5341, cli). The tests
 * below therefore pin the SHARED ranking's behaviour, not a locally-nicer one.
 *
 * Harness: the real repository write path over a stub engine, same shape as
 * `protocol.save-flow-canonicalization.test.ts` — a fix INSIDE `saveMetaItem`
 * cannot use a harness that mocks `saveMetaItem`.
 */
import { describe, expect, it } from 'vitest';
// [#5619] The producer's OWN write-verb dispatch decisions (#4550 delete /
// #5480 update), so the fake engine below cannot accept a call ObjectQL
// refuses. Imported from `@objectstack/metadata-core` and not from
// `@objectstack/objectql`: objectql DEPENDS ON this package, so that import
// would close a dependency cycle turbo rejects outright — which is why all 26
// of this package's (file, verb) pairs sat in the gate's DEBT ledger until
// #5619 sank the two predicates into a package both sides already depend on.
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

/** The engine surface the repository write path touches. */
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

const save = (protocol: any, item: unknown, name = 'task_list', type = 'view') =>
    protocol.saveMetaItem({ type, name, item });

async function rejection(promise: Promise<unknown>): Promise<any> {
    try {
        await promise;
    } catch (err) {
        return err;
    }
    throw new Error('expected the save to be rejected, but it resolved');
}

/** The issue's verbatim repro body: a list view whose `summary` has a typo'd key. */
const issueReproView = () => ({
    name: 'task_list',
    object: 'task',
    type: 'list',
    label: 'Tasks',
    columns: [{ field: 'title', summary: { type: 'sum', fieldd: 'amount' } }],
});

describe('#5364 saveMetaItem 422 expands union branches', () => {
    it('zod really does fold the whole rejection into one rootless issue (the defect, pinned)', () => {
        // The "reverse verification" for this change, stated as a fact about
        // zod rather than as a code revert: this is EXACTLY what the old
        // `parsed.error.issues.map(…)` had to work with. Restore that map and
        // every assertion in the next two tests goes red, because the branch
        // payload below is the only place a field name exists.
        const schema = getMetadataTypeSchema('view')!;
        const parsed = (schema as any).safeParse(issueReproView());

        expect(parsed.success).toBe(false);
        expect(parsed.error.issues).toHaveLength(1);
        expect(parsed.error.issues[0]).toMatchObject({ code: 'invalid_union', message: 'Invalid input' });
        expect(parsed.error.issues[0].path).toEqual([]);
        // …while four branches, each with a real reason, hang off `errors`.
        expect(parsed.error.issues[0].errors.length).toBeGreaterThan(1);
    });

    it('the issue\'s view body: real key names now reach the author instead of "Invalid input"', async () => {
        const { protocol, rows } = makeProtocol();

        const err = await rejection(save(protocol, issueReproView()));

        expect(err.code).toBe('INVALID_METADATA');
        expect(err.status).toBe(422);
        // Load-bearing: an invalid body is still refused, and still persists nothing.
        expect(rows.size).toBe(0);

        // The union's own entry is KEPT — the expansion is strictly additive, so
        // no consumer reading `issues[0]` today loses what it reads.
        expect(err.issues[0]).toEqual({ path: '', message: 'Invalid input', code: 'invalid_union' });
        expect(err.issues.length).toBeGreaterThan(1);

        // …and the branch that explains the rejection now rides along, carrying
        // the #4001 curated prose WITH the offending key names in it.
        const unknownKey = err.issues.find((i: any) => i.code === 'unrecognized_keys');
        expect(unknownKey).toBeDefined();
        expect(unknownKey.message).toContain('`type`');
        expect(unknownKey.message).toContain('`columns`');

        // The 422's summary line is readable now — before this it was the
        // whole-message `…failed spec validation: <root>: Invalid input`.
        expect(err.message).toContain('Unrecognized key(s)');
    });

    it('a container body localises the failure to a real path Studio can highlight', async () => {
        // Ranking note (identical in all copies): the branch with the FEWEST
        // issues wins, and `unrecognized_keys` breaks a tie. For a container
        // body no branch reports an unknown key, so what survives is the
        // per-slot verdict — an absolute path plus the legal enum.
        const { protocol, rows } = makeProtocol();

        const err = await rejection(save(protocol, { list: { type: 'nope', columns: [{ field: 'a' }] } }));

        expect(err.status).toBe(422);
        expect(rows.size).toBe(0);

        const badType = err.issues.find((i: any) => i.path === 'list.type');
        expect(badType).toBeDefined();
        expect(badType.code).toBe('invalid_value');
        expect(badType.message).toContain('"grid"');
        // Absolute, not branch-relative: the branch raised this at `['list','type']`
        // relative to the union sitting at the document root (#5014's trap).
        expect(badType.path).toBe('list.type');
    });

    it('a spec-valid view still saves — the expansion never invents a rejection', async () => {
        const { protocol, rows } = makeProtocol();

        const result = await save(protocol, {
            name: 'task_list', object: 'task', type: 'grid', label: 'Tasks',
            columns: [{ field: 'title' }],
        });

        expect(result.success).toBe(true);
        expect(rows.size).toBe(1);
    });
});

/**
 * #7510 — the 422 for a ViewItem body names the key the AUTHOR typed.
 *
 * #5364 (above) got a field name onto the wire at all. It did not settle WHICH
 * branch's field name, and for a `viewKind`-carrying item the shared ranking
 * picked the container branch: the author was told to restructure a correct
 * container, in detail, with confidence, while the subkey they actually
 * mistyped went unmentioned. `ViewMetadataSchema` now focuses a failed union on
 * the branch the body claims (`spec/ui/view.zod.ts` → `focusClaimedBranch`), so
 * the expansion below has the right branch to expand.
 *
 * Pinned HERE and not only in spec because this is the door the defect was
 * measured through — `saveMetaItem`'s 422 is what Studio renders, and a spec
 * fix that did not reach this envelope would be a fix nobody sees.
 */
describe('#7510 the 422 for a broken ViewItem names its own key, not the container\'s', () => {
    /** The card's repro: a form ViewItem whose field's `publicPicker` carries `sort`. */
    const pickerReproView = () => ({
        name: 'lead.contact',
        object: 'lead',
        viewKind: 'form',
        label: 'Contact us',
        config: {
            type: 'simple',
            data: { provider: 'object', object: 'lead' },
            sections: [{
                label: 'About you',
                fields: [{ field: 'owner', publicPicker: { displayFields: ['name'], sort: [{ field: 'email', order: 'desc' }] } }],
            }],
        },
    });

    it('the issue\'s body: `sort` reaches the author, the container prescription does not', async () => {
        const { protocol, rows } = makeProtocol();

        const err = await rejection(save(protocol, pickerReproView(), 'lead.contact'));

        expect(err.code).toBe('INVALID_METADATA');
        expect(err.status).toBe(422);
        // Load-bearing: the verdict is unchanged — refused, nothing persisted.
        // #7510 moves which refusal is explained, never whether it is one.
        expect(rows.size).toBe(0);

        // The union's own entry is still entry 0, unmoved (#5364's additive
        // contract) — focusing happens inside its `errors`, not around it.
        expect(err.issues[0]).toEqual({ path: '', message: 'Invalid input', code: 'invalid_union' });

        const unknownKey = err.issues.find((i: any) => i.code === 'unrecognized_keys');
        expect(unknownKey).toBeDefined();
        expect(unknownKey.message).toContain('`sort`');
        expect(unknownKey.path).toBe('config.sections.0.fields.0.publicPicker');

        // ⛔ The measured misdirect, gone from the whole envelope: on
        // `origin/main` @ `9051802` this message was the container branch's.
        expect(err.message).not.toContain('belongs to a single VIEW, not to the container');
        expect(JSON.stringify(err.issues)).not.toContain('this view container');
    });

    it('the same item minus the bad subkey still saves', async () => {
        const { protocol, rows } = makeProtocol();
        const item: any = pickerReproView();
        delete item.config.sections[0].fields[0].publicPicker.sort;

        const result = await save(protocol, item, 'lead.contact');

        expect(result.success).toBe(true);
        expect(rows.size).toBe(1);
    });

    it('a genuine container failure keeps the container prescription', async () => {
        // Constraint (c) of the card: the #4001 guidance text is good, and a
        // body that really is a container with wrong-layer keys still reads it.
        const { protocol, rows } = makeProtocol();

        const err = await rejection(save(protocol, {
            name: 'lead',
            object: 'lead',
            list: { type: 'grid', columns: [{ field: 'title' }] },
            type: 'grid',
            columns: [{ field: 'title' }],
        }, 'lead'));

        expect(err.status).toBe(422);
        expect(rows.size).toBe(0);
        expect(err.message).toContain('Unrecognized key(s) on this view container');
        expect(err.message).toContain('belongs to a single VIEW, not to the container');
    });
});

describe('#5364 zodIssuesToMetadataIssues — the shared ranking, verbatim', () => {
    const union = (errors: unknown[][], path: unknown[] = []) =>
        ({ code: 'invalid_union', message: 'Invalid input', path, errors });

    it('a non-union issue passes through byte-identical', () => {
        const issues = [{ code: 'invalid_type', message: 'Required', path: ['label'] }];
        expect(zodIssuesToMetadataIssues(issues)).toEqual([
            { path: 'label', message: 'Required', code: 'invalid_type' },
        ]);
    });

    it('every branch a bare kind mismatch → output unchanged (no noise added)', () => {
        // `z.union([z.string(), z.number()])` handed an object. Neither branch
        // has a prescription; emitting both would be N× the noise for nothing.
        const issues = [union([
            [{ code: 'invalid_type', message: 'expected string', path: [] }],
            [{ code: 'invalid_type', message: 'expected number', path: [] }],
        ], ['mode'])];
        expect(zodIssuesToMetadataIssues(issues)).toEqual([
            { path: 'mode', message: 'Invalid input', code: 'invalid_union' },
        ]);
    });

    it('zod\'s "matched multiple" variant (errors: []) adds nothing', () => {
        expect(zodIssuesToMetadataIssues([union([])])).toEqual([
            { path: '', message: 'Invalid input', code: 'invalid_union' },
        ]);
    });

    it('fewest issues wins; unrecognized_keys breaks the tie', () => {
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

    it('branches that tie at the top are all emitted, capped at three', () => {
        const branch = (n: number) => [{ code: 'invalid_type', message: `bad ${n}`, path: [`f${n}`] }];
        const out = zodIssuesToMetadataIssues([union([branch(1), branch(2), branch(3), branch(4)])]);
        expect(out.map((i) => i.path)).toEqual(['', 'f1', 'f2', 'f3']);
    });

    it('branch paths are resolved against the union\'s own, at every level', () => {
        const inner = union([[{ code: 'invalid_type', message: 'Required', path: ['id'] }]], ['nodes', 0]);
        const out = zodIssuesToMetadataIssues([union([[inner]], ['flow'])]);
        expect(out.map((i) => i.path)).toEqual(['flow', 'flow.nodes.0', 'flow.nodes.0.id']);
    });

    it('nesting is bounded at three levels — the fourth union is not expanded', () => {
        const leaf = { code: 'invalid_type', message: 'Required', path: ['leaf'] };
        const level4 = union([[leaf]], ['d']);
        const level3 = union([[level4]], ['c']);
        const level2 = union([[level3]], ['b']);
        const level1 = union([[level2]], ['a']);
        const out = zodIssuesToMetadataIssues([level1]);
        // a → a.b → a.b.c → a.b.c.d, and there it stops: `leaf` never appears.
        expect(out.map((i) => i.path)).toEqual(['a', 'a.b', 'a.b.c', 'a.b.c.d']);
        expect(out.some((i) => i.path.endsWith('leaf'))).toBe(false);
    });

    it('two branches rejecting the same key with the same words say it once', () => {
        const same = () => [{ code: 'unrecognized_keys', message: 'Unrecognized key(s): `nmae`', path: [] }];
        const out = zodIssuesToMetadataIssues([union([same(), same()])]);
        expect(out).toHaveLength(2);
        expect(out[1]!.code).toBe('unrecognized_keys');
    });

    it('de-duplication is per top-level issue, never across two independent ones', () => {
        const issue = { code: 'invalid_type', message: 'Required', path: ['label'] };
        const out = zodIssuesToMetadataIssues([issue, issue]);
        expect(out).toHaveLength(2);
    });

    it('a non-array `issues` yields an empty envelope rather than throwing', () => {
        expect(zodIssuesToMetadataIssues(undefined)).toEqual([]);
        expect(zodIssuesToMetadataIssues(null)).toEqual([]);
    });
});
