// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#16337] Every server-built `findData` literal in `rest-server.ts` speaks the
 * CANONICAL QueryAST — the pin for the consumer half of #16066.
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

const HERE = dirname(fileURLToPath(import.meta.url));
const SOURCE = readFileSync(resolve(HERE, 'rest-server.ts'), 'utf8');

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

/** Every `query:` slot in the file, as `{ line, text }` (1-based lines). */
function querySlots(): { line: number; text: string }[] {
    return SOURCE.split('\n')
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
function slotBody(line: number): string {
    const lines = SOURCE.split('\n');
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

describe('[#16337] §1 no server-built `query` slot in rest-server.ts is erased or wire-spelled', () => {
    it('the `wireDialectQuery` helper is gone — no declaration, no call', () => {
        // The retirement note in the file's prose may NAME the helper; what may
        // not survive is a declaration or a call. Both spellings are checked so
        // "it is mentioned in a comment" cannot be mistaken for either.
        expect(SOURCE).not.toMatch(/(?:const|function)\s+wireDialectQuery\b/);
        expect(SOURCE).not.toMatch(/wireDialectQuery\s*\(/);
    });

    it('every `query:` slot is an inline object literal or the caller-supplied bag — never a call or a cast', () => {
        const slots = querySlots();
        // A control on the census itself: a file whose slots stopped matching
        // would make every assertion below vacuously true.
        expect(slots.length).toBeGreaterThanOrEqual(5);

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
        const cast = querySlots()
            .filter(({ text }) => text.trim() !== CALLER_SUPPLIED_SLOT)
            .filter(({ line }) => /\bas\s+(any|unknown|FindDataRequest)\b/.test(slotBody(line)));
        expect(cast.map((c) => `line ${c.line}`)).toEqual([]);
    });

    it('no server-built `query` literal spells a wire alias', () => {
        const found: string[] = [];
        for (const { line, text } of querySlots()) {
            if (text.trim() === CALLER_SUPPLIED_SLOT) continue;
            const body = slotBody(line);
            for (const key of WIRE_DIALECT_KEYS) {
                // Key POSITION only: `where: filter` names a local called
                // `filter` and is not a `filter:` key. The escape covers `$`.
                const asKey = new RegExp(`(^|[\\s{,])${key.replace('$', '\\$')}\\s*:`, 'm');
                if (asKey.test(body)) found.push(`line ${line}: ${key}`);
            }
        }
        expect(found, 'a server-built literal must speak the declared QueryAST, not the wire dialect').toEqual([]);
    });

    it('the three sites the card names are canonical, by name', () => {
        // Belt to §1's braces: the class-wide assertions above would still pass
        // over a file that had lost these literals entirely.
        expect(SOURCE).toContain("orderBy: [{ field: 'created_at', order: 'desc' }],");
        expect(SOURCE).toContain("orderBy: [{ field: displayFields[0], order: 'asc' }],");
        expect(SOURCE).toContain("fields: ['id', ...displayFields],");
        expect(SOURCE).toMatch(/expand: Object\.fromEntries\(/);
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
        expect([dollarTop, wireFilters, wireSelect, wireSort, recordSort, commaExpand, noObject]).toHaveLength(7);
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
        const outcome = await normalized(PAIRS[3].canonical) as { refused?: { code?: string; status?: number } };
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
