// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#20338] THE census of the doors in `rest-server.ts` that read a PENDING
 * draft — so the next one cannot arrive ungated.
 *
 * ## The rule it holds
 *
 * A door that asks the protocol for draft content asks `mayReadPendingDrafts`
 * first — the one predicate `GET /meta/_drafts` has always asked
 * (`isObjectSchemaMaskExempt`) — and answers a caller it does not admit what it
 * answers without the draft switch: the published version, or its own absence.
 * The four doors that broke the rule until this card are pinned on the real
 * stack in `meta-draft-read-builder-gate.test.ts`; this file makes a FIFTH a
 * red PR instead of a finding.
 *
 * ## What it counts
 *
 * It walks the file's AST for every draft switch: a comparison against the
 * literal `'draft'`, a `.previewDrafts` read, and a `.listDrafts` reference.
 * Each is keyed `<route> » <text>` (the registration's `method` and `path`,
 * else the named function around it — never a line number, this file is edited
 * several times a day) and must be LEDGERED below as one of:
 *
 *  - `read` — a read door's draft switch. It must carry its admission in its
 *    own declaration (`const previewDrafts = … && mayReadPendingDrafts(ctx)`),
 *    so no later branch can re-derive the switch past the gate. (The item read
 *    used to parse `?state=` twice; the second parse is gone for that reason.)
 *  - `listing` — `GET /meta/_drafts`, which lists drafts and nothing else, so it
 *    refuses (403) rather than falling back: it must sit behind an earlier
 *    `if (!mayReadPendingDrafts(…))` in an enclosing block.
 *  - `write` — a write door's own draft mode, admitted by the write-capability
 *    gate (`metaSaveVerdict`), which it answers before this switch is read.
 *
 * Spellings it cannot see — a switch read under another name, a draft asked
 * for by a spread of the raw query — are review questions, not rows; the
 * behaviour pins are what hold the doors it names.
 *
 * [#22141] `PUT /meta/:type/:name?mode=draft` — a `write` switch — is no row
 * here because it is no longer read in this file: the door asks
 * `metaSaveRequestOptions` (`meta-save-request.ts`), the one mapping the
 * runtime dispatcher's `/meta` door asks too, after its write-capability gate.
 * Its behaviour is held by `meta-compound-save-mode-parity.test.ts` and by both
 * doors' rows in `packages/runtime/src/domains/meta-save-preconditions-parity.test.ts`.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const HERE = dirname(fileURLToPath(import.meta.url));
const SOURCE_FILE = 'rest-server.ts';
const sf = ts.createSourceFile(
    SOURCE_FILE, readFileSync(resolve(HERE, SOURCE_FILE), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS,
);

const collapse = (text: string): string => text.replace(/\s+/g, ' ').trim();
const unquote = (text: string): string => text.replace(/^[`'"]|[`'"]$/g, '');

function propertyInitializer(literal: ts.ObjectLiteralExpression, name: string): ts.Expression | undefined {
    for (const property of literal.properties) {
        if (ts.isPropertyAssignment(property) && property.name.getText(sf) === name) return property.initializer;
    }
    return undefined;
}

/** The route registration (`{ method, path, handler }`) or named function around a site. */
function anchorOf(node: ts.Node): string {
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

const isDraftSite = (n: ts.Node): boolean =>
    (ts.isBinaryExpression(n)
        && (n.operatorToken.kind === ts.SyntaxKind.EqualsEqualsEqualsToken || n.operatorToken.kind === ts.SyntaxKind.EqualsEqualsToken)
        && [n.left, n.right].some((side) => ts.isStringLiteral(side) && side.text === 'draft'))
    || (ts.isPropertyAccessExpression(n) && ['previewDrafts', 'listDrafts'].includes(n.name.text));

const isAdmission = (n: ts.Node): boolean =>
    ts.isCallExpression(n) && n.expression.getText(sf) === 'mayReadPendingDrafts';

function contains(root: ts.Node, pred: (n: ts.Node) => boolean): boolean {
    let hit = false;
    const walk = (n: ts.Node): void => {
        if (hit) return;
        if (pred(n)) { hit = true; return; }
        ts.forEachChild(n, walk);
    };
    walk(root);
    return hit;
}

/** Admitted in its own declaration. */
function admittedInDeclaration(site: ts.Node): boolean {
    for (let at: ts.Node | undefined = site.parent; at; at = at.parent) {
        if (ts.isVariableDeclaration(at)) return at.initializer ? contains(at.initializer, isAdmission) : false;
        if (ts.isStatement(at)) return false;
    }
    return false;
}

/** Behind an earlier `if (!mayReadPendingDrafts(…))` in an enclosing block. */
function behindRefusal(site: ts.Node): boolean {
    for (let child: ts.Node = site, at = site.parent; at; child = at, at = at.parent) {
        if (!ts.isBlock(at)) continue;
        const before = at.statements.filter((s) => s.end <= child.getStart(sf));
        if (before.some((s) => ts.isIfStatement(s)
            && ts.isPrefixUnaryExpression(s.expression) && s.expression.operator === ts.SyntaxKind.ExclamationToken
            && isAdmission(s.expression.operand))) return true;
    }
    return false;
}

interface Site { readonly key: string; readonly node: ts.Node; readonly line: number }
const SITES: Site[] = [];
const visit = (n: ts.Node): void => {
    if (isDraftSite(n)) {
        SITES.push({
            key: `${anchorOf(n)} » ${collapse(n.getText(sf))}`,
            node: n,
            line: sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1,
        });
    }
    ts.forEachChild(n, visit);
};
visit(sf);

// ─────────────────────────────────────────────────────────────────────────────
// The ledger — every draft switch in `rest-server.ts`, classified
// ─────────────────────────────────────────────────────────────────────────────

type Disposition = 'read' | 'listing' | 'write';
interface LedgerRow { readonly site: string; readonly disposition: Disposition; readonly door: string; readonly count?: number }

const LEDGER: readonly LedgerRow[] = [
    {
        site: "GET ${metaPath}/_drafts » (p as any).listDrafts",
        disposition: 'listing',
        door: 'GET /meta/_drafts — the 501 probe and the listing itself, both behind the 403',
        count: 2,
    },
    {
        site: "GET ${metaPath}/:type » req.query.preview.toLowerCase() === 'draft'",
        disposition: 'read',
        door: 'GET /meta/:type?preview=draft — the draft overlay on the list',
    },
    {
        site: "GET ${metaPath}/:type/:name » req.query.state.toLowerCase() === 'draft'",
        disposition: 'read',
        door: 'GET /meta/:type/:name?state=draft — the pending draft row',
    },
    {
        site: "GET ${metaPath}/:type/:name » req.query.preview.toLowerCase() === 'draft'",
        disposition: 'read',
        door: 'GET /meta/:type/:name?preview=draft — the draft overlaid on the active item',
    },
    {
        site: "DELETE ${metaPath}/:type/:name » req.query.state.toLowerCase() === 'draft'",
        disposition: 'write',
        door: 'DELETE /meta/:type/:name?state=draft — DISCARDS a draft; admitted by the write-capability gate first',
    },
    {
        site: 'POST ${basePath}/analytics/dataset/query » body.previewDrafts',
        disposition: 'read',
        door: 'POST /analytics/dataset/query previewDrafts — the draft dataset and the pending seed draft\'s rows',
    },
    {
        site: "POST ${basePath}/analytics/dataset/query » req.query?.preview === 'draft'",
        disposition: 'read',
        door: 'POST /analytics/dataset/query?preview=draft — the same switch, spelled on the query',
    },
];

// ─────────────────────────────────────────────────────────────────────────────

describe('[#20338] census: every draft switch in rest-server.ts is ledgered', () => {
    it('the sites found are exactly the ledgered ones', () => {
        const found = SITES.map((s) => s.key).sort();
        const declared = LEDGER.flatMap((r) => Array<string>(r.count ?? 1).fill(r.site)).sort();
        expect(
            found,
            'a draft switch this ledger does not name: a door that reads a pending draft asks mayReadPendingDrafts first, '
            + 'answers a caller it does not admit the published version (or its own absence), is pinned in '
            + 'meta-draft-read-builder-gate.test.ts, and is ledgered here',
        ).toEqual(declared);
    });

    it('every read switch carries its admission in its own declaration', () => {
        for (const site of SITES) {
            const row = LEDGER.find((r) => r.site === site.key);
            if (row?.disposition !== 'read') continue;
            expect(admittedInDeclaration(site.node), `${SOURCE_FILE}:${site.line} ${row.door}`).toBe(true);
        }
    });

    it('the listing sits behind its refusal', () => {
        const listing = SITES.filter((s) => LEDGER.find((r) => r.site === s.key)?.disposition === 'listing');
        expect(listing.length).toBeGreaterThan(0);
        for (const site of listing) expect(behindRefusal(site.node), `${SOURCE_FILE}:${site.line}`).toBe(true);
    });

    it('mayReadPendingDrafts is a bare delegation to isObjectSchemaMaskExempt — the one predicate, never a second rule', () => {
        const fns = sf.statements.filter(
            (s): s is ts.FunctionDeclaration => ts.isFunctionDeclaration(s) && s.name?.text === 'mayReadPendingDrafts',
        );
        expect(fns).toHaveLength(1);
        const [param] = fns[0].parameters;
        expect(collapse(fns[0].body?.statements.map((s) => s.getText(sf)).join(' ') ?? ''))
            .toBe(`return isObjectSchemaMaskExempt(${param.name.getText(sf)});`);
    });
});
