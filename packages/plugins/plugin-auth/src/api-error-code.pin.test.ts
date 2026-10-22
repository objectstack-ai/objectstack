// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#24243, ADR-0112] Every `new APIError(` this package throws carries a `code`.
 *
 * better-auth serialises an `APIError` body as it is given. A body without a
 * `code` reaches the caller as `message` alone, so a client (the console among
 * them) can only show or pattern-match English prose, on doors where
 * better-auth's own refusals carry codes. Eight throws in `auth-manager.ts`
 * shipped that way, found by hand; this pin is the enumeration, so the next one
 * cannot ship without a code. It is a test in this package, not a CI gate.
 *
 * It PARSES every non-test source file under `src/` and finds every
 * `new APIError(...)`. A site passes when its body carries the code in one of
 * two shapes, and is reported with its file and line otherwise:
 *
 *  1. an object literal with a top-level `code` property; or
 *  2. a body destructured, in the same function, from the result of
 *     `judgeHeldSession(...)`: the held-session judge's ADR-0112 envelope,
 *     whose code sits under `error` (`platform-admin-gate.held-session.test.ts`
 *     pins that body's shape).
 *
 * No body, a literal without `code`, a spread, or an identifier from anywhere
 * else is a site this pin cannot read a code from, so it fails.
 *
 * It parses and does not type-check, so the code's VALUE is not judged here.
 * Each stamp is a constant typed `RegisteredErrorCode` or `StandardErrorCode`,
 * so `tsc` judges the value, and `check:error-code-provenance` judges whether a
 * registered one is listed under this package.
 *
 * Two controls keep the walk honest:
 *  - a textual count over the comment-free source (the TypeScript printer, with
 *    comments removed) must equal the sites the walk found in each file, so a
 *    constructor spelling the walk does not recognise cannot slip past it;
 *  - the classifier must report each shape that shipped without a code and
 *    accept each shape that carries one (the fixture battery below).
 */

import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const HERE = dirname(fileURLToPath(import.meta.url));

interface ApiErrorSite {
  readonly file: string;
  readonly line: number;
  /** `null` when the body carries a code; otherwise why this pin cannot read one. */
  readonly missing: string | null;
}

const isTestFile = (name: string): boolean => /\.(test|spec)\.tsx?$/.test(name) || name.endsWith('.d.ts');

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...sourceFiles(path));
    else if (/\.tsx?$/.test(entry.name) && !isTestFile(entry.name)) out.push(path);
  }
  return out.sort();
}

const isApiErrorCallee = (callee: ts.Expression): boolean =>
  (ts.isIdentifier(callee) && callee.text === 'APIError') ||
  (ts.isPropertyAccessExpression(callee) && callee.name.text === 'APIError');

function propertyName(name: ts.PropertyName): string | undefined {
  if (ts.isIdentifier(name) || ts.isStringLiteral(name)) return name.text;
  return undefined;
}

function enclosingFunction(node: ts.Node): ts.Node | undefined {
  for (let cur = node.parent; cur; cur = cur.parent) {
    if (ts.isFunctionLike(cur)) return cur;
  }
  return undefined;
}

/** Every variable declaration inside `scope`, nested blocks included. */
function declarationsIn(scope: ts.Node): ts.VariableDeclaration[] {
  const found: ts.VariableDeclaration[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node)) found.push(node);
    ts.forEachChild(node, visit);
  };
  visit(scope);
  return found;
}

const unwrapAwait = (e: ts.Expression | undefined): ts.Expression | undefined =>
  e && ts.isAwaitExpression(e) ? e.expression : e;

/**
 * Shape 2: `const { body } = held;` (or `{ body: X }`) where `held` is
 * `judgeHeldSession(…)`'s result, both in the throw's own function.
 */
function isHeldSessionBody(body: ts.Identifier, site: ts.NewExpression): boolean {
  const scope = enclosingFunction(site);
  if (!scope) return false;
  const decls = declarationsIn(scope);
  const holders = decls
    .filter((d) => ts.isObjectBindingPattern(d.name) && d.initializer && ts.isIdentifier(d.initializer))
    .filter((d) =>
      (d.name as ts.ObjectBindingPattern).elements.some((el) => {
        const key = el.propertyName ? propertyName(el.propertyName) : ts.isIdentifier(el.name) ? el.name.text : undefined;
        return key === 'body' && ts.isIdentifier(el.name) && el.name.text === body.text;
      }),
    )
    .map((d) => (d.initializer as ts.Identifier).text);
  return holders.some((holder) =>
    decls.some((d) => {
      if (!ts.isIdentifier(d.name) || d.name.text !== holder) return false;
      const init = unwrapAwait(d.initializer);
      return (
        !!init && ts.isCallExpression(init) && ts.isIdentifier(init.expression) && init.expression.text === 'judgeHeldSession'
      );
    }),
  );
}

function whyCodeless(site: ts.NewExpression, sf: ts.SourceFile): string | null {
  const body = site.arguments?.[1];
  if (!body) return 'it passes no body at all';
  if (ts.isObjectLiteralExpression(body)) {
    const carriesCode = body.properties.some(
      (p) => (ts.isPropertyAssignment(p) || ts.isShorthandPropertyAssignment(p)) && propertyName(p.name) === 'code',
    );
    return carriesCode ? null : 'its body has no top-level `code` property';
  }
  if (ts.isIdentifier(body) && isHeldSessionBody(body, site)) return null;
  return `its body is \`${body.getText(sf)}\`, which this pin cannot read a code from`;
}

/** Every `new APIError(…)` in one source text, each with its verdict. */
function apiErrorSites(file: string, text: string): ApiErrorSite[] {
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const sites: ApiErrorSite[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isNewExpression(node) && isApiErrorCallee(node.expression)) {
      sites.push({
        file,
        line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1,
        missing: whyCodeless(node, sf),
      });
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return sites;
}

/** The textual control: constructor calls counted in the source with its comments removed. */
function textualCount(file: string, text: string): number {
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, false, ts.ScriptKind.TS);
  const printed = ts.createPrinter({ removeComments: true }).printFile(sf);
  return printed.match(/\bnew\s+(?:[A-Za-z_$][\w$]*\s*\.\s*)*APIError\s*\(/g)?.length ?? 0;
}

describe('every new APIError( in plugin-auth/src carries an ADR-0112 code (#24243)', () => {
  const files = sourceFiles(HERE);
  const perFile = files.map((path) => {
    const text = readFileSync(path, 'utf8');
    const file = relative(HERE, path);
    return { file, sites: apiErrorSites(file, text), textual: textualCount(file, text) };
  });
  const sites = perFile.flatMap((f) => f.sites);

  it('the walk reaches the throws: a floor of sites and files, so a walk that reads nothing cannot pass', () => {
    // Measured when this pin landed: 30 sites in 4 files (`auth-manager.ts`
    // 24, `objectql-adapter.ts` 3, `impersonation-bearer-rotation.ts` 2,
    // `admin-impersonate-endpoint.ts` 1). A floor, not an exact count, so a new
    // throw does not have to edit this line; only losing them does.
    // [#25224] `AuthManager`'s throws are counted over the files its methods'
    // bodies live in: `auth-manager.ts` and the bodies moved out of it whole.
    const authManagerFiles = ['auth-manager.ts', 'auth-manager-actor-guards.ts'];
    expect(sites.length).toBeGreaterThanOrEqual(30);
    expect(new Set(sites.map((s) => s.file)).size).toBeGreaterThanOrEqual(4);
    expect(perFile.filter((f) => authManagerFiles.includes(f.file)).reduce((n, f) => n + f.sites.length, 0)).toBeGreaterThanOrEqual(24);
  });

  it('the textual control agrees with the walk in every file', () => {
    const disagreements = perFile
      .filter((f) => f.textual !== f.sites.length)
      .map((f) => `${f.file}: ${f.textual} textual, ${f.sites.length} walked`);
    expect(disagreements).toEqual([]);
  });

  it('no site throws a body without a code', () => {
    const codeless = sites.filter((s) => s.missing !== null).map((s) => `${s.file}:${s.line}: ${s.missing}`);
    expect(codeless).toEqual([]);
  });
});

describe('the classifier, against the shapes it must tell apart', () => {
  const verdicts = (body: string) => apiErrorSites('fixture.ts', body).map((s) => s.missing === null);

  it('reports both shapes the eight code-less throws had (the card enumeration)', () => {
    // As they stood before #24243: a status read off a constant with a
    // message-only body (the SMS quota wall), and a status literal with a
    // message-only body (the other seven).
    const fixture = `
      async function quota(message: string) { return new APIError(SMS_QUOTA_EXCEEDED_CODE, { message }); }
      async function hook() {
        throw new APIError('FORBIDDEN', { message: 'Creating additional organizations is disabled.' });
      }
      async function relayed(err: any) {
        throw new APIError('FORBIDDEN', { message: err?.message ?? 'outside your scope' });
      }`;
    expect(verdicts(fixture)).toEqual([false, false, false]);
  });

  it('reports a site with no body, a spread with no code, and an identifier it cannot trace', () => {
    const fixture = `
      function a() { throw new APIError('FORBIDDEN'); }
      function b(base: object) { throw new APIError('FORBIDDEN', { ...base }); }
      function c(body: object) { throw new APIError('FORBIDDEN', body); }
      function d() { const { body } = somethingElse(); throw new APIError('FORBIDDEN', body); }`;
    expect(verdicts(fixture)).toEqual([false, false, false, false]);
  });

  it('accepts a literal or shorthand `code`, a string key, a member callee and the held-session relay', () => {
    const fixture = `
      function a() { throw new APIError('FORBIDDEN', { message: 'm', code: SOME_CODE }); }
      function b(code: string) { throw new APIError('FORBIDDEN', { message: 'm', code }); }
      function c() { throw new APIError('FORBIDDEN', { 'code': 'X', message: 'm' }); }
      function d() { throw new api.APIError('FORBIDDEN', { message: 'm', code: SOME_CODE }); }
      async function e() {
        const held = judgeHeldSession({ authGate: await gateOf() });
        if (!held) return;
        const { body } = held;
        throw new APIError('FORBIDDEN', body);
      }`;
    expect(verdicts(fixture)).toEqual([true, true, true, true, true]);
  });

  it('the textual control sees past comments, and counts a member-callee site', () => {
    const fixture = `
      // new APIError('FORBIDDEN', { message: 'in a comment' })
      /** new APIError('X') in a doc block */
      function a() { throw new api.APIError('FORBIDDEN', { message: 'm', code: C }); }`;
    expect(textualCount('fixture.ts', fixture)).toBe(1);
    expect(apiErrorSites('fixture.ts', fixture)).toHaveLength(1);
  });
});
