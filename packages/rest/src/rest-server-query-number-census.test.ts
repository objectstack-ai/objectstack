// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#20139] The census that keeps the bare-`Number()` query-read family closed
 * in `rest-server.ts`.
 *
 * ## The family
 *
 * A published door read a numeric query parameter with a bare `Number(...)`.
 * That coercion does not fail: it INVENTS a value (`NaN`, `0`, a fallback) and
 * the door answered `200` with a widened or substituted window. The family was
 * closed one door at a time — four `?limit=` reads by `readDeclaredQueryNumber`
 * (`rest-server-limit-param-parsing.test.ts`), the rest by this card
 * (`rest-server-query-number-reads.test.ts`) — and a one-door-at-a-time close
 * is exactly how it reopens: the next handler copies the idiom from a
 * neighbour. This file makes that a red PR instead.
 *
 * ## What it counts — every numeric coercion, not "the ones that look like
 * query reads"
 *
 * It parses the file with the TypeScript AST and finds EVERY numeric coercion:
 * a call or `new` of `Number` / `parseInt` / `parseFloat` (bare or as
 * `Number.parseInt` / `Number.parseFloat`), one of those passed or assigned as
 * a value (`.map(Number)`), and unary `+`. Each site must be classified in
 * {@link LEDGER} below as one of:
 *
 * - `reader` — the one faithful coercion inside `readDeclaredQueryNumber`;
 * - `not-a-query-value` — the value comes from somewhere else (a stored row,
 *   stored metadata), and the reason names where;
 * - `exempt` — a request query value deliberately left coerced, and the reason
 *   says why refusing it would be wrong. Each exemption is also PINNED below,
 *   so the reason is a measured fact rather than a sentence.
 *
 * Deciding "is this a query value?" by pattern — `Number(req.query.x)`,
 * `Number(q.x)` — was tried against this card and fails on the one member the
 * card itself missed: `/diff`'s `Number(raw)` sat in a local `parseV` helper,
 * one frame away from the `req.query` it read, and no textual heuristic sees
 * through that frame. A person classifying each site once, with a written
 * reason, does. The cost is one ledger row per non-query coercion added to
 * this file, which is rare (ten sites in the whole file today).
 *
 * Out of scope by construction: arithmetic that coerces as a side effect
 * (`x * 1`, `x - 0`, `Math.trunc(x)`). None exists over a query value today;
 * a new one is a review question, not a census row.
 *
 * ## Keys
 *
 * A site is keyed `<anchor> » <coercion text>`: the anchor is the route it sits
 * in (`GET ${dataPath}/:object/export`, read from the registration's `method`
 * and `path`) or else the named function or method around it. Line numbers are
 * not used — this file is edited several times a day. Editing a ledgered
 * coercion changes its key and reddens this file on purpose: an edited read
 * is re-judged, not carried over.
 */

import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
// `.js` on purpose — NodeNext resolution requires the extension.
import { RestServer } from './rest-server.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const SOURCE_FILE = 'rest-server.ts';
const SOURCE = readFileSync(resolve(HERE, SOURCE_FILE), 'utf8');

// ─────────────────────────────────────────────────────────────────────────────
// The walker
// ─────────────────────────────────────────────────────────────────────────────

const COERCING_CALLEES: ReadonlySet<string> = new Set([
    'Number', 'parseInt', 'parseFloat', 'Number.parseInt', 'Number.parseFloat',
]);

interface CoercionSite {
    readonly key: string;
    readonly line: number;
}

const collapse = (text: string): string => text.replace(/\s+/g, ' ').trim();
const unquote = (text: string): string => text.replace(/^[`'"]|[`'"]$/g, '');

function propertyInitializer(literal: ts.ObjectLiteralExpression, name: string): ts.Expression | undefined {
    for (const property of literal.properties) {
        if (ts.isPropertyAssignment(property) && property.name.getText() === name) return property.initializer;
    }
    return undefined;
}

/** The route registration (`{ method, path, handler }`) or named function around a site. */
function anchorOf(node: ts.Node, sf: ts.SourceFile): string {
    for (let at: ts.Node | undefined = node.parent; at; at = at.parent) {
        if (ts.isObjectLiteralExpression(at)) {
            const method = propertyInitializer(at, 'method');
            const path = propertyInitializer(at, 'path');
            if (method && path && propertyInitializer(at, 'handler')) {
                return `${unquote(method.getText(sf))} ${unquote(path.getText(sf))}`;
            }
        }
        if ((ts.isFunctionDeclaration(at) || ts.isMethodDeclaration(at)) && at.name) {
            return `${ts.isFunctionDeclaration(at) ? 'function' : 'method'} ${at.name.getText(sf)}`;
        }
    }
    return 'module scope';
}

function isCoercion(node: ts.Node, sf: ts.SourceFile): boolean {
    if ((ts.isCallExpression(node) || ts.isNewExpression(node))
        && COERCING_CALLEES.has(node.expression.getText(sf))) {
        return true;
    }
    if (ts.isPrefixUnaryExpression(node) && node.operator === ts.SyntaxKind.PlusToken) return true;
    // `Number` / `parseInt` / `parseFloat` handed on as a VALUE (`.map(Number)`,
    // `const toN = Number`) — the callee position is the arm above, a member
    // access (`Number.isFinite`) is not a coercion, and a type is not a value.
    if (ts.isIdentifier(node) && COERCING_CALLEES.has(node.text)) {
        const parent = node.parent;
        if ((ts.isCallExpression(parent) || ts.isNewExpression(parent)) && parent.expression === node) return false;
        if (ts.isPropertyAccessExpression(parent) || ts.isTypeReferenceNode(parent)) return false;
        return true;
    }
    return false;
}

function coercionSites(sourceText: string, fileName: string): CoercionSite[] {
    const sf = ts.createSourceFile(fileName, sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    const sites: CoercionSite[] = [];
    const visit = (node: ts.Node): void => {
        if (isCoercion(node, sf)) {
            sites.push({
                key: `${anchorOf(node, sf)} » ${collapse(node.getText(sf))}`,
                line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1,
            });
        }
        ts.forEachChild(node, visit);
    };
    visit(sf);
    return sites;
}

// ─────────────────────────────────────────────────────────────────────────────
// The ledger — every numeric coercion in `rest-server.ts`, classified
// ─────────────────────────────────────────────────────────────────────────────

type Disposition = 'reader' | 'not-a-query-value' | 'exempt';

interface LedgerRow {
    readonly site: string;
    readonly disposition: Disposition;
    readonly reason: string;
}

const LEDGER: readonly LedgerRow[] = [
    {
        site: 'function readDeclaredQueryNumber » Number(raw)',
        disposition: 'reader',
        reason: 'The family\'s one faithful coercion: a non-blank string whose `Number()` is not `NaN` '
            + 'is parsed AS that number and everything else reaches the declared schema as it came, '
            + 'so the declaration — never this call — decides what is refused.',
    },
    ...[
        'Number(row?.total_rows ?? 0)',
        'Number(row?.processed_rows ?? 0)',
        'Number(row?.created_count ?? 0)',
        'Number(row?.updated_count ?? 0)',
        'Number(row?.skipped_count ?? 0)',
        'Number(row?.error_count ?? 0)',
    ].map((text): LedgerRow => ({
        site: `function importJobToProgress » ${text}`,
        disposition: 'not-a-query-value',
        reason: 'A counter column of a persisted `sys_import_job` row, read back from the store and '
            + 'mapped to the ImportJobProgress DTO — no request value reaches it.',
    })),
    {
        site: 'POST ${metaPath}/:type/:name/rollback » Number(toVersionRaw)',
        disposition: 'exempt',
        reason: 'Read body-first (`body.toVersion ?? body.version ?? req.query.toVersion`) and then '
            + 'CHECKED, not served: a non-finite or below-1 result is already refused `400` before '
            + '`rollbackMetaItem` runs, so an unreadable value is never dropped or substituted — '
            + 'outside this family by its own definition. Its refusal is the door\'s own '
            + '`INVALID_REQUEST`; moving it onto `VALIDATION_FAILED` would be a wire change to a door '
            + 'that already refuses, which no card here decides. Pinned below.',
    },
    {
        site: 'GET ${dataPath}/:object/export » Number(q.page)',
        disposition: 'exempt',
        reason: '`page` sets only the CHUNK size of the export\'s own `findData` loop (clamped to '
            + '[50, 5000], default 500). An unreadable value (`abc`, empty, blank) is answered exactly '
            + 'as an absent one, and no chunk size adds, drops or reorders a streamed row — so no '
            + 'value of it widens or substitutes the answer, and refusing one would turn a correct '
            + 'export into a `400`. Pinned below.',
    },
];

// ─────────────────────────────────────────────────────────────────────────────
// 1. The walker can see every spelling it claims to count
// ─────────────────────────────────────────────────────────────────────────────

describe('#20139 census — the walker', () => {
    it('finds every coercion spelling, and nothing that is not one', () => {
        const probe = [
            'function probe(req: any, q: any) {',
            '    const a = Number(req.query.a);',
            '    const b = parseInt(q.b, 10);',
            '    const c = parseFloat(q.c);',
            '    const d = +q.d;',
            '    const e = [q.e].map(Number);',
            '    const f = new Number(q.f);',
            '    const g = Number.parseInt(q.g, 10);',
            '    const h = Number.parseFloat(q.h);',
            '    const toN = Number;',
            // Not coercions: a member of `Number`, a type, arithmetic, a method named alike.
            '    const ok = Number.isFinite(a) && Number.isInteger(b);',
            '    let typed: Number | undefined;',
            '    const sum = a + b;',
            '    const other = q.parseInt(q.i);',
            '    return [c, d, e, f, g, h, toN, ok, typed, sum, other];',
            '}',
        ].join('\n');
        expect(coercionSites(probe, 'probe.ts').map((s) => s.key)).toEqual([
            'function probe » Number(req.query.a)',
            'function probe » parseInt(q.b, 10)',
            'function probe » parseFloat(q.c)',
            'function probe » +q.d',
            'function probe » Number',
            'function probe » new Number(q.f)',
            'function probe » Number.parseInt(q.g, 10)',
            'function probe » Number.parseFloat(q.h)',
            'function probe » Number',
        ]);
    });

    it('anchors a site in a route handler to the route, however deep the helper that holds it', () => {
        const probe = [
            'class Probe {',
            '    register(routes: any) {',
            '        routes.register({',
            "            method: 'GET',",
            '            path: `${base}/things/:id/diff`,',
            '            handler: async (req: any) => {',
            '                const parseV = (raw: any) => Number(raw);',
            '                return parseV(req.query.from);',
            '            },',
            '        });',
            '    }',
            '}',
        ].join('\n');
        expect(coercionSites(probe, 'probe.ts').map((s) => s.key)).toEqual([
            'GET ${base}/things/:id/diff » Number(raw)',
        ]);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. Every numeric coercion in rest-server.ts is routed or ledgered
// ─────────────────────────────────────────────────────────────────────────────

describe('#20139 census — every numeric coercion in rest-server.ts is classified', () => {
    const sites = coercionSites(SOURCE, SOURCE_FILE);
    const ledgered = new Map(LEDGER.map((row) => [row.site, row]));

    it('the ledger names each site once', () => {
        expect(ledgered.size, 'a ledger row is duplicated').toBe(LEDGER.length);
    });

    it('no coercion is unclassified — a new bare `Number(req.query.x)` lands here', () => {
        const unclassified = sites
            .filter((site) => !ledgered.has(site.key))
            .map((site) => [
                `${SOURCE_FILE}:${site.line} — \`${site.key}\` is a numeric coercion the census has not classified.`,
                '  A request query value: read it through `readDeclaredQueryNumber` against its declared',
                '  schema (or `UNDECLARED_WHOLE_NUMBER_PARAM` where none is declared) — never a bare coercion,',
                '  which invents `NaN` / `0` and answers 200.',
                '  Anything else: add a LEDGER row in this file — `not-a-query-value` naming where the value',
                '  comes from, or `exempt` with the reason refusing it would be wrong, pinned by a test.',
            ].join('\n'));
        expect(unclassified, `\n${unclassified.join('\n\n')}\n`).toEqual([]);
    });

    it('each site appears exactly once, and no ledger row outlives its site', () => {
        const counts = new Map<string, number>();
        for (const site of sites) counts.set(site.key, (counts.get(site.key) ?? 0) + 1);
        const repeated = [...counts].filter(([key, n]) => n > 1 && ledgered.has(key)).map(([key, n]) => `${key} ×${n}`);
        expect(repeated, 'a ledgered coercion was copied: classify the copy on its own').toEqual([]);
        const stale = LEDGER.filter((row) => !counts.has(row.site)).map((row) => row.site);
        expect(stale, 'these rows name no site any more — delete them (or re-judge the edited read)').toEqual([]);
    });

    it('the reader is the only `reader`, and every other row carries its reason', () => {
        expect(LEDGER.filter((row) => row.disposition === 'reader').map((row) => row.site))
            .toEqual(['function readDeclaredQueryNumber » Number(raw)']);
        for (const row of LEDGER) {
            expect(row.reason.length, `${row.site} needs a reason a reviewer can check`).toBeGreaterThan(60);
        }
    });

    it('positive control: the census sees the reader and both exemptions in the real file', () => {
        const keys = new Set(sites.map((s) => s.key));
        for (const row of LEDGER.filter((r) => r.disposition !== 'not-a-query-value')) {
            expect(keys.has(row.site), row.site).toBe(true);
        }
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. Each exemption's reason, measured on the real routes
// ─────────────────────────────────────────────────────────────────────────────

function mockServer() {
    return {
        get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn(), patch: vi.fn(),
        use: vi.fn(),
        listen: vi.fn().mockResolvedValue(undefined),
        close: vi.fn().mockResolvedValue(undefined),
    };
}

function mockRes() {
    const res: any = {
        statusCode: 200,
        _headers: {} as Record<string, string>,
        _written: [] as string[],
        json: vi.fn(function (this: any, body: any) { this._body = body; return this; }),
        send: vi.fn(function (this: any) { return this; }),
        write: vi.fn(function (this: any, chunk: any) { this._written.push(String(chunk)); return true; }),
        end: vi.fn(function (this: any, chunk?: any) { if (chunk != null) this._written.push(String(chunk)); return this; }),
        setHeader: vi.fn(function (this: any) { return this; }),
        status: vi.fn(function (this: any, code: number) { this.statusCode = code; return this; }),
        header: vi.fn(function (this: any, k: string, v: string) { this._headers[k] = v; return this; }),
    };
    return res;
}

/** 1200 rows, so every chunk size in play here takes more than one `findData` call. */
const ROWS = Array.from({ length: 1200 }, (_, i) => ({ id: `r${i}`, n: i }));

function boot() {
    const protocol: any = {
        getDiscovery: vi.fn().mockResolvedValue({
            version: 'v0', routes: { data: '', metadata: '', ui: '', auth: '/auth' },
        }),
        getMetaItem: vi.fn().mockResolvedValue({
            type: 'object', name: 'account', item: { name: 'account', fields: {} }, lock: 'none',
        }),
        findData: vi.fn(async ({ query }: any) => ({
            records: ROWS.slice(query.offset, query.offset + query.limit),
        })),
        rollbackMetaItem: vi.fn().mockResolvedValue({
            success: true, version: 'v2', seq: 9, restoredFromVersion: 3,
        }),
    };
    const rest = new RestServer(
        mockServer() as any,
        protocol as any,
        { api: { requireAuth: false } } as any,
    );
    (rest as any).resolveExecCtx = async () => ({ isSystem: true, userId: 'u1' });
    rest.registerRoutes();

    const drive = async (method: string, path: string, req: Record<string, unknown> = {}) => {
        const found = (rest as any).getRoutes().find(
            (r: any) => r.method === method && r.path === path,
        );
        if (!found) throw new Error(`route not registered: ${method} ${path}`);
        const res = mockRes();
        await found.handler(
            { method, path, params: {}, query: {}, headers: {}, body: {}, ...req } as any,
            res,
        );
        return {
            status: res.statusCode as number,
            body: res.json.mock.calls.at(-1)?.[0],
            streamed: (res._written as string[]).join(''),
        };
    };

    return { protocol, drive };
}

describe('#20139 census — exemption: export `?page=` changes chunking, never the rows', () => {
    const exportWith = async (query: Record<string, unknown>) => {
        const { drive, protocol } = boot();
        const answer = await drive('GET', '/api/v1/data/:object/export', {
            params: { object: 'account' },
            query: { format: 'json', limit: String(ROWS.length), ...query },
        });
        const takes = protocol.findData.mock.calls.map((call: any[]) => call[0].query.limit);
        return { ...answer, takes };
    };

    it('streams the same rows, in the same order, whatever `page` holds', async () => {
        const absent = await exportWith({});
        expect(absent.status).toBe(200);
        expect(JSON.parse(absent.streamed)).toHaveLength(ROWS.length);
        for (const page of ['abc', '', ' ', '1.5', 'Infinity', '-5', '50', '5000']) {
            const answer = await exportWith({ page });
            expect(answer.status, `?page=${JSON.stringify(page)}`).toBe(200);
            expect(answer.streamed, `?page=${JSON.stringify(page)} changed the exported rows`).toBe(absent.streamed);
        }
    });

    it('an unreadable `page` is answered exactly as an absent one: the default 500-row chunk', async () => {
        const absent = await exportWith({});
        expect(absent.takes).toEqual([500, 500, 200]);
        for (const page of ['abc', '', ' ']) {
            expect((await exportWith({ page })).takes, `?page=${JSON.stringify(page)}`).toEqual(absent.takes);
        }
    });

    it('lit control: a readable `page` really is read — it sets the chunk, and only the chunk', async () => {
        const fifty = await exportWith({ page: '50' });
        expect(fifty.takes).toHaveLength(ROWS.length / 50);
        expect(new Set(fifty.takes)).toEqual(new Set([50]));
    });
});

describe('#20139 census — exemption: rollback `toVersion` is already refused, never substituted', () => {
    const rollback = async (query: Record<string, unknown>) => {
        const { drive, protocol } = boot();
        const answer = await drive('POST', '/api/v1/meta/:type/:name/rollback', {
            params: { type: 'view', name: 'all_accounts' },
            query,
        });
        return { answer, protocol };
    };

    it.each([
        ['abc'],      // `NaN` → refused
        [''],         // `Number('')` = 0 → below 1 → refused
        ['Infinity'], // non-finite → refused
    ])('?toVersion=%j answers 400 INVALID_REQUEST and nothing is restored', async (toVersion) => {
        const { answer, protocol } = await rollback({ toVersion });
        expect(answer.status).toBe(400);
        expect(answer.body?.code).toBe('INVALID_REQUEST');
        expect(protocol.rollbackMetaItem).not.toHaveBeenCalled();
    });

    it('lit control: ?toVersion=3 reaches rollbackMetaItem as 3', async () => {
        const { answer, protocol } = await rollback({ toVersion: '3' });
        expect(answer.status).toBe(200);
        expect(protocol.rollbackMetaItem).toHaveBeenCalledTimes(1);
        expect(protocol.rollbackMetaItem.mock.calls[0][0].toVersion).toBe(3);
    });
});
