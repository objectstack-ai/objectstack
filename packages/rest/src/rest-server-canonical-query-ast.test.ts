// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#16337] Every server-built `findData` literal in `rest-server.ts` speaks the
 * CANONICAL QueryAST — the pin for the consumer half of #16066.
 *
 * ⭐ [#16638] The census is now keyed to the PACKAGE's server-built query
 * surface rather than to one file. `import-runner.ts` carried three more of
 * these literals and they hid the same way the fourth one did: they were the
 * argument to a `findArgsBase(query: any)` helper, so nothing type-checked them
 * and `$filter` / `$top` cost no diagnostic. A pin keyed to ONE file cannot
 * close a class that lives in a package, so §1 now runs per file, from a table
 * that a new file is added to instead of a new test.
 *
 * ⚠️ The two files get DIFFERENT census rules, and the difference is not
 * cosmetic. `rest-server.ts` is the HTTP door: it parses `filter` / `top` /
 * `skip` / `sort` / `select` off the caller's own querystring, so a wire
 * spelling outside a server-built `query:` literal is legitimate there.
 * `import-runner.ts` has NO door — every query in it is server-built — so the
 * wire dialect has nowhere legitimate to stand anywhere in the file, and its
 * census says exactly that. That whole-file rule is the one that would have
 * caught these three: they were never in a `query:` slot to begin with.
 *
 * ## What this file is pinning, and why a type-check alone cannot
 *
 * #15866 typed 22 protocol-dispatch sites in `rest-server.ts` against their
 * declared spec contracts. Three `findData` literals could not join, because
 * they built their `query` in the UNDECLARED wire dialect (`$filter`, `$top`,
 * `$skip`, `$orderby`, `$expand`, `filters`, `select`, `sort`), so they were
 * routed through a `wireDialectQuery` helper that cast the slot. #16337
 * rewrote all of them as QueryAST and retired the helper.
 *
 * ⛔ A type-level check cannot hold that ground on its own, and that is the
 * whole reason this file reads SOURCE. The erasure it replaces was a cast, and
 * a cast compiles: re-introducing `wireDialectQuery`, writing `as any`, or
 * routing one more literal through an `any`-typed protocol handle each leaves
 * `tsc --noEmit` at exit 0. §1 is therefore the load-bearing section, and §2 is
 * the type-level half that says the canonical shapes are the ones the contract
 * actually declares.
 *
 * ⚠️ The FOURTH literal is the reason §1 is phrased over the whole file rather
 * than over three named sites. `loadImportJob` built `{ $filter, $top }` and
 * handed it to a `p: any` handle — type-checked by nothing, named by no card,
 * and invisible to any pin keyed to the three known sites. A guard that closes
 * the CLASS finds it; a guard that enumerates instances does not.
 *
 * ## §3 is the equivalence receipt
 *
 * The rewrite is a spelling change and that is a claim, so it is measured:
 * every before/after pair is driven through the REAL
 * `ObjectStackProtocolImplementation` normalizer and the option bags it hands
 * `engine.find` are asserted EQUAL. `RPC_QUERY_ALIAS_SLOTS` is what makes them
 * equal (an alias folds onto its canonical key with the value moved verbatim);
 * if that table ever stops making them equal, this section is where it is
 * reported rather than in production.
 *
 * ⛔ What §3 is NOT: a claim that either dialect is SERVED. The public picker's
 * pair is asserted equal by both REFUSING — its `where` carries
 * `ViewFilterRule` rows, which the ingress declines with `400 INVALID_FILTER`
 * before and after this card alike. Equality is the assertion; the verdict on
 * either side is the ingress's.
 *
 * [#16581] The ROUTE no longer builds that literal — it lowers the rule rows to
 * the `FilterArray` grammar before dispatch — but the pair stays exactly as
 * frozen here, and its CONTROL becomes load-bearing in a second way: it is one
 * of the two independent pins that the object dialect is still REFUSED, i.e.
 * that #16581 lowered the route rather than loosening the parser. ⛔ Never
 * "update" the picker pair to the lowered shape: a frozen BEFORE that is
 * rewritten to match the after measures nothing.
 */

import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
import type { FindDataRequest } from '@objectstack/spec/api';
import { RestServer } from './rest-server.js';
import type { ImportProtocolLike } from './import-runner.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const sourceOf = (file: string) => readFileSync(resolve(HERE, file), 'utf8');

const REST_SERVER = sourceOf('rest-server.ts');
const IMPORT_RUNNER = sourceOf('import-runner.ts');

interface CensusEntry {
    /** File name, relative to this test — the census reads package sources only. */
    file: string;
    source: string;
    /**
     * Floor on the number of `query:` slots the file must still have. A file
     * whose slots stopped matching would make every §1 assertion vacuously
     * true, so each entry states what it expects to find.
     */
    minQuerySlots: number;
    /**
     * Does a wire spelling have anywhere legitimate to stand in this file?
     * `true` = no door, so the census covers the WHOLE file rather than only
     * its `query:` literals (see the header note).
     */
    noDoor: boolean;
}

const CENSUS: CensusEntry[] = [
    { file: 'rest-server.ts', source: REST_SERVER, minQuerySlots: 5, noDoor: false },
    { file: 'import-runner.ts', source: IMPORT_RUNNER, minQuerySlots: 3, noDoor: true },
];

// ---------------------------------------------------------------------------
// §1 The source census — the section that reds on a re-introduced erasure
// ---------------------------------------------------------------------------

/**
 * The undeclared spellings `@objectstack/metadata-protocol`'s normalizer folds
 * onto a canonical QueryAST key. `RPC_QUERY_ALIAS_SLOTS` (the spec's own table)
 * declares the bare ones; `WIRE_QUERY_ALIAS_SLOTS` / `WIRE_DOLLAR_ALIASES` add
 * the wire-only ones. ⛔ Not a copy of either table for the door to consult —
 * it is the list of spellings a SERVER-BUILT literal must not use, and the two
 * tables stay the authority on what a CALLER may send.
 */
const WIRE_DIALECT_KEYS = [
    '$filter', '$top', '$skip', '$orderby', '$select', '$expand', '$search', '$searchFields', '$count',
    'filters', 'filter', 'select', 'sort', 'skip', 'top', 'populate',
] as const;

/** Every `query:` slot in one file, as `{ line, text }` (1-based lines). */
function querySlots(source: string): { line: number; text: string }[] {
    return source.split('\n')
        .map((text, i) => ({ line: i + 1, text }))
        .filter(({ text }) => /^\s*query:\s/.test(text));
}

/**
 * The ONE `query:` slot in this file that is allowed to carry the wire dialect,
 * and the reason: `GET /data/:object` forwards the CALLER's own querystring
 * bag. That is caller input, not a server-built literal — the wire dialect is
 * exactly what the door exists to accept, and declaring those aliases is
 * #16066's spec half.
 */
const CALLER_SUPPLIED_SLOT = 'query: req.query,';

/**
 * The body of a server-built `query:` object literal, from its opening brace to
 * the line that closes it at the same indentation. Read from source so a slot
 * added later is covered without editing this file.
 */
function slotBody(source: string, line: number): string {
    const lines = source.split('\n');
    const open = lines[line - 1];
    const indent = (open.match(/^\s*/) ?? [''])[0];
    if (/^\s*query:\s*\{.*\},?\s*$/.test(open)) return open;
    const out = [open];
    for (let i = line; i < lines.length; i++) {
        out.push(lines[i]);
        if (lines[i] === `${indent}},` || lines[i] === `${indent}}`) return out.join('\n');
    }
    throw new Error(`unterminated query literal at line ${line}`);
}

/**
 * [#16638] Comment-ONLY lines, dropped. Deliberately conservative: a trailing
 * comment after code survives, so the whole-file scan below can only ever
 * over-report (a loud failure someone fixes), never under-report (a silent
 * pass). A string-aware stripper would be the alternative and it is the
 * unsafe one here — `replace(/[`"']/g, '')` in `import-runner.ts` opens a
 * quote state that no simple tokenizer closes, and everything after it would
 * stop being scanned at all.
 */
function withoutCommentLines(source: string): string {
    return source
        .split('\n')
        .filter((line) => !/^\s*(?:\/\/|\/\*|\*)/.test(line))
        .join('\n');
}

/**
 * Wire-dialect keys in OBJECT-LITERAL KEY position anywhere in a source — the
 * class-closing half. The preceding `{` or `,` is what separates a key from a
 * type annotation: `const filter: Record<string, any>` is preceded by `const`
 * and is not a key, while `{ $filter: …` and a key on its own line after a
 * trailing comma both are.
 */
function wireKeysAnywhere(source: string): string[] {
    const text = withoutCommentLines(source);
    const found: string[] = [];
    for (const key of WIRE_DIALECT_KEYS) {
        const asKey = new RegExp(`([{,])\\s*${key.replace('$', '\\$')}\\s*:`);
        if (asKey.test(text)) found.push(key);
    }
    return found;
}

for (const { file, source, minQuerySlots, noDoor } of CENSUS) {
    describe(`[#16337][#16638] §1 no server-built \`query\` slot in ${file} is erased or wire-spelled`, () => {
        it('the `wireDialectQuery` helper is gone — no declaration, no call', () => {
            // The retirement note in the file's prose may NAME the helper; what may
            // not survive is a declaration or a call. Both spellings are checked so
            // "it is mentioned in a comment" cannot be mistaken for either.
            expect(source).not.toMatch(/(?:const|function)\s+wireDialectQuery\b/);
            expect(source).not.toMatch(/wireDialectQuery\s*\(/);
        });

        it('every `query:` slot is an inline object literal or the caller-supplied bag — never a call or a cast', () => {
            const slots = querySlots(source);
            // A control on the census itself: a file whose slots stopped matching
            // would make every assertion below vacuously true.
            expect(slots.length).toBeGreaterThanOrEqual(minQuerySlots);

            const offenders = slots.filter(({ text }) => {
                const value = text.trim();
                if (value === CALLER_SUPPLIED_SLOT) return false;
                return !/^query:\s*\{/.test(value);
            });
            expect(
                offenders.map((o) => `line ${o.line}: ${o.text.trim()}`),
                'a `query` slot that is not an inline object literal is the erasure #16337 retired',
            ).toEqual([]);
        });

        it('no server-built `query` literal carries an `as` cast', () => {
            const cast = querySlots(source)
                .filter(({ text }) => text.trim() !== CALLER_SUPPLIED_SLOT)
                .filter(({ line }) => /\bas\s+(any|unknown|FindDataRequest)\b/.test(slotBody(source, line)));
            expect(cast.map((c) => `line ${c.line}`)).toEqual([]);
        });

        it('no server-built `query` literal spells a wire alias', () => {
            const found: string[] = [];
            for (const { line, text } of querySlots(source)) {
                if (text.trim() === CALLER_SUPPLIED_SLOT) continue;
                const body = slotBody(source, line);
                for (const key of WIRE_DIALECT_KEYS) {
                    // Key POSITION only: `where: filter` names a local called
                    // `filter` and is not a `filter:` key. The escape covers `$`.
                    const asKey = new RegExp(`(^|[\\s{,])${key.replace('$', '\\$')}\\s*:`, 'm');
                    if (asKey.test(body)) found.push(`line ${line}: ${key}`);
                }
            }
            expect(found, 'a server-built literal must speak the declared QueryAST, not the wire dialect').toEqual([]);
        });

        it.skipIf(!noDoor)('has no door, so NO wire spelling stands anywhere in the file', () => {
            // ⭐ [#16638] The rule the `query:` census structurally could not
            // reach. This file's three literals were arguments to a helper, not
            // `query:` slots — a guard that enumerates slots does not find
            // them; a guard that closes the class does.
            expect(
                wireKeysAnywhere(source),
                'every query in this file is server-built, so a wire alias has nowhere legitimate to stand',
            ).toEqual([]);
        });
    });
}

describe('[#16638] §1 CONTROLS on the census instrument itself', () => {
    it('the whole-file detector fires on a wire spelling, in every position it must', () => {
        // Without this the empty result above is equally consistent with a
        // detector that matches nothing.
        expect(wireKeysAnywhere('const a = { $filter: { id: 1 } };')).toEqual(['$filter']);
        expect(wireKeysAnywhere('const a = { where: 1,\n  $top: 2 };')).toEqual(['$top']);
        expect(wireKeysAnywhere('const a = { select: [] };')).toEqual(['select']);
    });

    it('the whole-file detector does NOT fire on a type annotation or a value reference', () => {
        // The two shapes `import-runner.ts` actually contains.
        expect(wireKeysAnywhere('const filter: Record<string, any> = {};')).toEqual([]);
        expect(wireKeysAnywhere('const a = { where: filter, limit: 2 };')).toEqual([]);
    });

    it('dropping comment lines leaves the code that is being censused', () => {
        // The stripper is the one step that could silently empty the input.
        const stripped = withoutCommentLines(IMPORT_RUNNER);
        expect(stripped).toContain('const findArgsBase = (request: FindDataRequest) => ({');
        expect(stripped.split('\n').length).toBeGreaterThan(400);
        // And it really does drop prose: the header of the helper names the
        // retired spellings, and that prose must not be censused.
        expect(IMPORT_RUNNER).toContain('`$filter` / `$top` wire spellings cost no diagnostic');
        expect(stripped).not.toContain('wire spellings cost no diagnostic');
    });
});

describe('[#16337] §1 the three sites rest-server.ts names are canonical, by name', () => {
    it('names them', () => {
        // Belt to §1's braces: the class-wide assertions above would still pass
        // over a file that had lost these literals entirely.
        expect(REST_SERVER).toContain("orderBy: [{ field: 'created_at', order: 'desc' }],");
        expect(REST_SERVER).toContain("orderBy: [{ field: displayFields[0], order: 'asc' }],");
        expect(REST_SERVER).toContain("fields: ['id', ...displayFields],");
        expect(REST_SERVER).toMatch(/expand: Object\.fromEntries\(/);
    });
});

describe('[#16638] §1 the three sites import-runner.ts names are canonical, and the helper still types them', () => {
    it('the three literals are there, canonical, and carry the required `object`', () => {
        expect(IMPORT_RUNNER).toContain('query: { object: referenceObject, where: { [f]: display }, limit: 2 },');
        expect(IMPORT_RUNNER).toContain('query: { object: objectName, where: filter, limit: 2 },');
        expect(IMPORT_RUNNER).toContain('query: { object: objectName, where: { id: { $in: ids } }, limit: ids.length },');
    });

    it('the envelope helper is compiled against the declared contract, not `any`', () => {
        // ⭐ The erasure vehicle this card retired. The whole-file rule above is
        // what actually holds the ground — reverting this signature alone
        // changes no spelling — but naming it here says which line is load
        // bearing, and the second assertion closes the vector class-wide.
        expect(IMPORT_RUNNER).toMatch(/const findArgsBase = \(request: FindDataRequest\) => \(\{/);
        const erased = withoutCommentLines(IMPORT_RUNNER).match(ERASED_PARAM) ?? [];
        expect(erased, 'a query-carrying parameter typed as any puts every literal handed to it back outside the compiler').toEqual([]);
    });
});

// ---------------------------------------------------------------------------
// §1b [#16952] The EXPORTED extension point — the erasure the detector missed
// ---------------------------------------------------------------------------

/**
 * ⭐ [#16952] `args` joined `query` / `request` here because the erasure that
 * survived #16638 was spelled with it: `ImportProtocolLike`'s three required
 * members were `findData(args: any)` / `createData(args: any)` /
 * `updateData(args: any)`, so the detector above swept the whole file and
 * reported nothing while the EXPORTED extension point declared no dialect at
 * all. A detector that enumerates parameter names it has already seen closes
 * yesterday's instance; the name an implementor actually writes is `args`.
 */
const ERASED_PARAM = /\(\s*(?:args|query|request)\s*:\s*any\b/g;

describe('[#16952] §1b the exported `ImportProtocolLike` declares what it is handed', () => {
    it('no required member takes `any` — the three that did are named', () => {
        // Source-read rather than type-read on purpose: §2 below cannot tell a
        // reverted signature from a declared one that happens to admit
        // everything, and `any` admits everything.
        expect(IMPORT_RUNNER).toContain('findData(args: ImportProtocolRequest<FindDataRequest>): Promise<any>;');
        expect(IMPORT_RUNNER).toContain('createData(args: ImportProtocolRequest<CreateDataRequest>): Promise<any>;');
        expect(IMPORT_RUNNER).toContain('updateData(args: ImportProtocolRequest<UpdateDataRequest>): Promise<any>;');
    });

    it('the envelope is declared ONCE and every member of the interface uses it', () => {
        // The interface used to spell `{ context?: any; environmentId?: string }`
        // inline on each of its already-typed members. One declaration is the
        // point of this card; three copies of it would be the same defect a
        // level down.
        expect(IMPORT_RUNNER).toMatch(/export type ImportProtocolRequest<R> = R & \{ context\?: any; environmentId\?: string \};/);
        const inlineEnvelopes = IMPORT_RUNNER.match(/context\?: any; environmentId\?: string/g) ?? [];
        expect(inlineEnvelopes, 'the envelope is declared once, not re-spelled per member').toHaveLength(1);
    });

    it('CONTROL: the erasure detector fires on the exact spelling this card removed', () => {
        // Without this the empty result above is equally consistent with a
        // detector that never matches `args` at all — which is precisely how
        // the erasure survived the previous card.
        expect('  findData(args: any): Promise<any>;'.match(ERASED_PARAM)).toHaveLength(1);
        expect('const findArgsBase = (request: any) => ({'.match(ERASED_PARAM)).toHaveLength(1);
        // …and does NOT fire on the declared form, so a green is a green.
        expect('  findData(args: ImportProtocolRequest<FindDataRequest>): Promise<any>;'.match(ERASED_PARAM)).toBeNull();
    });
});

// ---------------------------------------------------------------------------
// §2 The type-level half — what the declared contract actually admits
// ---------------------------------------------------------------------------

type Query = NonNullable<FindDataRequest['query']>;

describe('[#16337] §2 the declared `FindDataRequest[\'query\']` contract', () => {
    it('admits the canonical AST and refuses every wire spelling (compile-time)', () => {
        const canonical: Query = {
            object: 'sys_import_job',
            where: { status: 'queued' },
            orderBy: [{ field: 'created_at', order: 'desc' }],
            limit: 50,
            offset: 0,
            fields: ['id', 'status'],
            expand: { owner_id: { object: 'owner_id' } },
        };
        expect(canonical.limit).toBe(50);

        // Each directive below is LIVE: `tsconfig.test.json` compiles this
        // layer, and an unused `@ts-expect-error` is TS2578 there. So these are
        // assertions, not decoration — if the wire dialect were ever declared
        // on `QuerySchema`, this block reds rather than going quiet.
        // @ts-expect-error `$top` is not a declared QueryAST key
        const dollarTop: Query = { object: 'x', $top: 5 };
        // @ts-expect-error [#16638] `$filter` is not a declared QueryAST key
        const dollarFilter: Query = { object: 'x', $filter: { id: '1' } };
        // @ts-expect-error `filters` is not a declared QueryAST key
        const wireFilters: Query = { object: 'x', filters: [] };
        // @ts-expect-error `select` is the alias; the declared key is `fields`
        const wireSelect: Query = { object: 'x', select: ['id'] };
        // @ts-expect-error `sort` is the alias; the declared key is `orderBy`
        const wireSort: Query = { object: 'x', sort: [{ field: 'a', order: 'asc' }] };
        // @ts-expect-error the `{field: direction}` record is not `SortNode[]`
        const recordSort: Query = { object: 'x', orderBy: { created_at: 'desc' } };
        // @ts-expect-error a comma list is not `Record<string, QueryAST>`
        const commaExpand: Query = { object: 'x', expand: 'owner_id' };
        // @ts-expect-error `object` is REQUIRED on the declared query
        const noObject: Query = { limit: 1 };
        expect([dollarTop, dollarFilter, wireFilters, wireSelect, wireSort, recordSort, commaExpand, noObject]).toHaveLength(8);
    });
});

/**
 * ⭐ [#16952] The type-level half of the extension point itself. Every alias
 * below is derived from the EXPORTED declaration with `Parameters<…>`, so it
 * cannot drift into a fourth restatement of the dialect: revert
 * `ImportProtocolLike.findData` to `any` and these become `any` too, every
 * `@ts-expect-error` in the block goes unused, and `tsconfig.test.json` reds
 * the whole file with TS2578. That is the ablation this section is written to
 * lose.
 */
type FindArgs = Parameters<ImportProtocolLike['findData']>[0];
type CreateArgs = Parameters<ImportProtocolLike['createData']>[0];
type UpdateArgs = Parameters<ImportProtocolLike['updateData']>[0];

describe('[#16952] §2 the declared `ImportProtocolLike` parameter contract', () => {
    it('admits what the runner sends, and refuses the wire dialect (compile-time)', () => {
        // Exactly the three literals `import-runner.ts` builds, envelope included.
        const find: FindArgs = {
            object: 'sys_user',
            query: { object: 'sys_user', where: { email: 'a@b.c' }, limit: 2 },
            context: { isSystem: true },
            environmentId: 'env_1',
        };
        const create: CreateArgs = { object: 'task', data: { name: 'r0' }, context: {}, environmentId: 'env_1' };
        const update: UpdateArgs = { object: 'task', id: 'id_1', data: { name: 'r0' }, context: {} };
        expect([find.object, create.object, update.id]).toEqual(['sys_user', 'task', 'id_1']);

        // ⭐ The dialect an implementor used to freeze on, now refused at the
        // extension point rather than observed from it. Each directive is LIVE
        // — an unused `@ts-expect-error` is TS2578 under `tsconfig.test.json`.
        // @ts-expect-error `$filter` is the wire spelling; the declared key is `where`
        const wireFilter: FindArgs = { object: 'sys_user', query: { object: 'sys_user', $filter: { email: 'a@b.c' } } };
        // @ts-expect-error `$top` is the wire spelling; the declared key is `limit`
        const wireTop: FindArgs = { object: 'sys_user', query: { object: 'sys_user', $top: 2 } };
        // @ts-expect-error `object` is REQUIRED on every declared request
        const noObject: FindArgs = { query: { object: 'sys_user', where: {} } };
        // @ts-expect-error `data` is REQUIRED on a create
        const noData: CreateArgs = { object: 'task' };
        // @ts-expect-error `id` is REQUIRED on an update
        const noId: UpdateArgs = { object: 'task', data: { name: 'r0' } };
        expect([wireFilter, wireTop, noObject, noData, noId]).toHaveLength(5);
    });

    it('an implementor written against the declaration needs no annotation of its own', () => {
        // ⭐ The whole point: leave the parameter unannotated and the contract
        // types it. This is the shape `plugin-auth`'s hand-written implementor
        // could not have while the declaration said `any`.
        const probes: Array<Record<string, unknown> | undefined> = [];
        const p: ImportProtocolLike = {
            findData: async (args) => { probes.push(args.query?.where); return { records: [] }; },
            createData: async (args) => ({ id: String(args.data.name) }),
            updateData: async (args) => ({ id: args.id }),
        };
        return Promise.all([
            p.findData({ object: 'sys_user', query: { object: 'sys_user', where: { email: 'a@b.c' } } }),
            p.createData({ object: 'task', data: { name: 'r0' } }),
            p.updateData({ object: 'task', id: 'id_1', data: { name: 'r1' } }),
        ]).then(() => {
            expect(probes).toEqual([{ email: 'a@b.c' }]);
        });
    });
});

// ---------------------------------------------------------------------------
// §3 The equivalence receipt — driven through the REAL normalizer
// ---------------------------------------------------------------------------

const OBJECT_FIXTURE = {
    name: 'sys_import_job',
    nameField: 'id',
    searchableFields: ['object_name', 'status'],
    fields: {
        id: { name: 'id', type: 'text' },
        status: { name: 'status', type: 'text' },
        object_name: { name: 'object_name', type: 'text' },
        created_at: { name: 'created_at', type: 'datetime' },
        owner_id: { name: 'owner_id', type: 'lookup', reference: 'sys_user' },
    },
};

/**
 * The option bag the REAL normalizer hands `engine.find` for one query — or the
 * refusal it raises instead. Both outcomes are returned rather than thrown so a
 * pair that refuses on BOTH sides is still comparable: equality is what §3
 * asserts, never that either side is served.
 */
async function normalized(query: unknown): Promise<unknown> {
    let seen: unknown = undefined;
    const engine = {
        registry: { getObject: (n: string) => (n === OBJECT_FIXTURE.name ? OBJECT_FIXTURE : undefined) },
        find: async (_o: string, options: unknown) => { seen = options; return []; },
        aggregate: async () => [],
        count: async () => 0,
    };
    const protocol = new ObjectStackProtocolImplementation(engine as never);
    try {
        await protocol.findData({ object: OBJECT_FIXTURE.name, query } as never);
        return { served: seen };
    } catch (error) {
        const e = error as { code?: string; status?: number };
        return { refused: { code: e.code, status: e.status } };
    }
}

/**
 * The wire literals as #15866 left them, frozen. ⛔ Not a spec of what the door
 * may send — a historical record, kept only so §3 has a BEFORE to compare the
 * canonical rewrite against.
 */
const PAIRS: { site: string; wire: Record<string, unknown>; canonical: Record<string, unknown> }[] = [
    {
        site: 'import-job loader (loadImportJob)',
        wire: { $filter: { id: 'job_1' }, $top: 1 },
        canonical: { object: 'sys_import_job', where: { id: 'job_1' }, limit: 1 },
    },
    {
        site: 'import-job listing (GET /data/import/jobs)',
        wire: { $filter: { status: 'queued' }, $orderby: { created_at: 'desc' }, $top: 50, $skip: 10 },
        canonical: {
            object: 'sys_import_job',
            where: { status: 'queued' },
            orderBy: [{ field: 'created_at', order: 'desc' }],
            limit: 50,
            offset: 10,
        },
    },
    {
        site: 'export chunk loop (GET /data/:object/export)',
        wire: {
            $filter: { status: 'done' },
            $search: 'acme',
            $searchFields: ['object_name'],
            $orderby: { created_at: 'desc' },
            $expand: 'owner_id',
            $top: 500,
            $skip: 0,
        },
        canonical: {
            object: 'sys_import_job',
            where: { status: 'done' },
            search: 'acme',
            searchFields: ['object_name'],
            orderBy: [{ field: 'created_at', order: 'desc' }],
            expand: { owner_id: { object: 'owner_id' } },
            limit: 500,
            offset: 0,
        },
    },
    // ⭐ [#16638] The three `import-runner.ts` literals. Same instrument, same
    // assertion: this IS the negative control the card requires for the
    // reference resolver, the duplicate probe and the id recheck — the option
    // bag `engine.find` receives is identical before and after the rewrite, so
    // the three call paths cannot return anything different.
    {
        site: 'import-runner reference resolver (resolveRef lookup)',
        wire: { $filter: { object_name: 'Acme' }, $top: 2 },
        canonical: { object: 'sys_import_job', where: { object_name: 'Acme' }, limit: 2 },
    },
    {
        site: 'import-runner duplicate probe (findExisting)',
        wire: { $filter: { status: 'queued', object_name: 'Acme' }, $top: 2 },
        canonical: { object: 'sys_import_job', where: { status: 'queued', object_name: 'Acme' }, limit: 2 },
    },
    {
        site: 'import-runner id recheck (recheckByIds)',
        wire: { $filter: { id: { $in: ['job_1', 'job_2'] } }, $top: 2 },
        canonical: { object: 'sys_import_job', where: { id: { $in: ['job_1', 'job_2'] } }, limit: 2 },
    },
    {
        site: 'public reference picker (GET /forms/:slug/lookup/:field)',
        wire: {
            limit: 10,
            offset: 0,
            filters: [{ field: 'status', operator: 'equals', value: 'done' }],
            select: ['id', 'object_name'],
            sort: [{ field: 'object_name', order: 'asc' }],
        },
        canonical: {
            object: 'sys_import_job',
            limit: 10,
            offset: 0,
            where: [{ field: 'status', operator: 'equals', value: 'done' }],
            fields: ['id', 'object_name'],
            orderBy: [{ field: 'object_name', order: 'asc' }],
        },
    },
];

describe('[#16337] §3 the rewrite moves nothing — driven through the real normalizer', () => {
    it.each(PAIRS)('$site: wire and canonical reach the engine identically', async ({ wire, canonical }) => {
        const before = await normalized(wire);
        const after = await normalized(canonical);
        expect(after).toEqual(before);
    });

    it('CONTROL: the instrument can tell two option bags apart', () => {
        // Without this, every row above would also pass against an instrument
        // that returned a constant.
        return Promise.all([
            normalized({ object: 'sys_import_job', limit: 1 }),
            normalized({ object: 'sys_import_job', limit: 2 }),
        ]).then(([one, two]) => expect(one).not.toEqual(two));
    });

    it('CONTROL: the picker pair is equal by REFUSING, and the refusal is the ingress\'s', async () => {
        // Stated rather than left implicit: this pair's equality is not evidence
        // that the picker query is served. Both sides carry `ViewFilterRule`
        // rows on the filter slot, which is not a `FilterCondition`.
        //
        // [#16581] ⭐ And this is now the discriminating control for that card:
        // the route lowers those rows before dispatch, so it no longer sends
        // this literal — while the literal itself must still be REFUSED. A
        // green picker search plus a green line here means "the route lowers";
        // a green picker search with this line flipped would have meant "the
        // parser was loosened", the repair the ruling excludes.
        // [#16638] Located by NAME, not by index: three import-runner pairs were
        // inserted above and a positional reference would silently start
        // measuring a different row.
        const picker = PAIRS.find((p) => p.site.startsWith('public reference picker'))!;
        const outcome = await normalized(picker.canonical) as { refused?: { code?: string; status?: number } };
        expect(outcome.refused).toEqual({ code: 'INVALID_FILTER', status: 400 });
    });
});

// ---------------------------------------------------------------------------
// §4 The literals the doors ACTUALLY build, read off the mounted routes
// ---------------------------------------------------------------------------

function mockServer() {
    return {
        get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn(), patch: vi.fn(),
        use: vi.fn(), listen: vi.fn().mockResolvedValue(undefined), close: vi.fn().mockResolvedValue(undefined),
    };
}

function mockRes() {
    const res: Record<string, unknown> = { statusCode: 200, body: undefined };
    res.status = vi.fn((c: number) => { res.statusCode = c; return res; });
    res.json = vi.fn((b: unknown) => { res.body = b; return res; });
    res.header = vi.fn(() => res);
    res.write = vi.fn(() => true);
    res.end = vi.fn(() => res);
    return res;
}

/** Mount the real routes over a protocol that records every `findData` call. */
function mountedRoutes() {
    const findData = vi.fn().mockResolvedValue({ object: 'sys_import_job', records: [] });
    const protocol = {
        getDiscovery: vi.fn().mockResolvedValue({ version: 'v0', routes: { data: '', metadata: '' } }),
        getMetaTypes: vi.fn().mockResolvedValue([]),
        getMetaItems: vi.fn().mockResolvedValue([]),
        getMetaItem: vi.fn().mockResolvedValue(undefined),
        findData,
    };
    const rest = new RestServer(mockServer() as never, protocol as never, { api: { requireAuth: false } } as never);
    (rest as unknown as { resolveExecCtx: () => Promise<unknown> }).resolveExecCtx = async () => ({ userId: 'test-user' });
    rest.registerRoutes();
    const route = (method: string, suffix: string) => {
        const found = rest.getRoutes().find((r) => r.method === method && r.path.endsWith(suffix));
        if (!found) throw new Error(`route ${method} …${suffix} is not mounted`);
        return found as unknown as { handler: (req: unknown, res: unknown) => Promise<unknown> };
    };
    return { findData, route };
}

/** Declared QueryAST keys — anything else on a server-built literal is a wire alias. */
const DECLARED_QUERY_KEYS = new Set([
    'object', 'fields', 'where', 'search', 'searchFields', 'orderBy', 'limit', 'offset',
    'top', 'aggregations', 'groupBy', 'having', 'expand',
]);

describe('[#16337] §4 the mounted doors hand `findData` canonical keys', () => {
    it('GET /data/import/jobs builds a canonical query', async () => {
        const { findData, route } = mountedRoutes();
        const jobs = route('GET', '/data/import/jobs');
        await jobs.handler({ params: {}, query: { status: 'queued', limit: '7', offset: '3' } }, mockRes());

        expect(findData).toHaveBeenCalledTimes(1);
        const query = findData.mock.calls[0][0].query as Record<string, unknown>;
        expect(Object.keys(query).filter((k) => !DECLARED_QUERY_KEYS.has(k))).toEqual([]);
        expect(query.where).toEqual({ status: 'queued' });
        expect(query.orderBy).toEqual([{ field: 'created_at', order: 'desc' }]);
        expect(query.limit).toBe(7);
        expect(query.offset).toBe(3);
    });

    it('GET /data/:object/export builds a canonical query for its first chunk', async () => {
        const { findData, route } = mountedRoutes();
        const exportRoute = route('GET', '/data/:object/export');
        await exportRoute.handler(
            { params: { object: 'sys_import_job' }, query: { format: 'json', limit: '10', filter: '{"status":"done"}', search: 'acme' } },
            mockRes(),
        );

        expect(findData).toHaveBeenCalledTimes(1);
        const query = findData.mock.calls[0][0].query as Record<string, unknown>;
        expect(Object.keys(query).filter((k) => !DECLARED_QUERY_KEYS.has(k))).toEqual([]);
        expect(query.where).toEqual({ status: 'done' });
        expect(query.search).toBe('acme');
        expect(query.limit).toBe(10);
        expect(query.offset).toBe(0);
    });
});
