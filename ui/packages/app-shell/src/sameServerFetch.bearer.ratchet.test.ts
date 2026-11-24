/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Ratchet — a request that sends the session cookie (`credentials: 'include'`)
 * goes through the console's authenticated fetch, never the bare global
 * `fetch`, in app-shell and the console.
 *
 * The defect this closes: a bare `fetch('/api/…', { credentials: 'include' })`
 * carries the session cookie and nothing else. A session held by its bearer
 * token alone (the cookie replaced by a second local runtime on the same host,
 * blocked as a third-party cookie, or cleared) is answered `401` there, while
 * every other console request works: the shell's package list went missing
 * this way, and with it the Studio and design entries, the AI chat lists and
 * the studio-design writes. `createAuthenticatedFetch` (`@object-ui/auth`)
 * sends the stored bearer token beside the cookie, and a `401` reaches the
 * console's session-ended check. Build it per call
 * (`createAuthenticatedFetch()(input, init)`), keeping `credentials: 'include'`.
 *
 * What counts as bare: a call whose transport is the global `fetch` (`fetch`,
 * `window.fetch`, `globalThis.fetch`, `self.fetch`, or one of those as the
 * fallback of `??` / `||`), and `sharedGetJson` without its transport argument
 * (its default is the global `fetch`), when the init it is handed — written
 * inline, or a `const` of this file named as the argument — carries
 * `credentials: 'include'`. The URL is not judged: a request to another origin
 * that must not see the bearer is an allow-list row with that reason.
 *
 * If this fails on a new call: route it through `createAuthenticatedFetch`
 * (`{ sameOriginOnly: true }` when the URL is author-written and may name
 * another host). If the call must stay bare, add a row to {@link ALLOWED} with
 * the reason. If it fails on a row: a row whose count went down is shrunk or
 * deleted in the same change. ⛔ Never raise a count to make room.
 */

import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const HERE = path.dirname(fileURLToPath(import.meta.url));
/** `ui/packages/app-shell/src` */
const APP_SHELL_SRC = HERE;
/** `ui/apps/console/src` */
const CONSOLE_SRC = path.resolve(HERE, '../../../apps/console/src');
/** Both trees' paths are written relative to `ui/`. */
const UI_ROOT = path.resolve(HERE, '../../..');

/**
 * The bare cookie-only calls left, per file, with the reason each stays.
 * SHRINK-ONLY: a row's count only goes down, a row only goes away.
 */
const ALLOWED: Readonly<Record<string, { count: number; reason: string }>> = {
  'apps/console/src/LocalizationFetchProvider.tsx': {
    count: 1,
    reason:
      'the boot read of `/api/v1/auth/me/localization`, shared in flight with the language seed and the early ' +
      'request `index.html` sends, by a key built from this init; a session it cannot see reads ' +
      '`authenticated: false` and falls back to the browser language rather than failing. Its transport is its own decision.',
  },
  'apps/console/src/components/FormPage.tsx': {
    count: 1,
    reason: 'the channel is the bare global fetch on the PUBLIC form route on purpose; the internal route hands the authenticated fetch.',
  },
  'apps/console/src/lib/auth-preflight.ts': {
    count: 1,
    reason: 'the session probe sets the bearer header itself, on purpose: it reads whether the stored token is stale.',
  },
  'apps/console/src/lib/early-discovery.ts': {
    count: 1,
    reason: 'sets the bearer header itself; the request mirrors, byte for byte, the one `index.html` sends early.',
  },
  'apps/console/src/pages/auth/OAuthConsentPage.tsx': {
    count: 3,
    reason: 'the OAuth hand-off, whose authorize step is a top-level navigation that can only carry the cookie.',
  },
  'apps/console/src/pages/auth/followAuthorize.ts': {
    count: 1,
    reason: 'the OAuth authorize step; its fallback is a top-level navigation that can only carry the cookie.',
  },
  'apps/console/src/pages/auth/handoffClientName.ts': {
    count: 1,
    reason: 'the OAuth hand-off sign-in page, read before a session exists.',
  },
  'apps/console/src/pages/auth/SetupPage.tsx': {
    count: 1,
    reason: 'the bootstrap-status read of the first-run setup page, answered without a session.',
  },
  'apps/console/src/pages/auth/VerifyEmailPage.tsx': {
    count: 1,
    reason: 'the email-verification link, which proves itself with its own token and is opened without a session.',
  },
  'packages/app-shell/src/chrome/ConditionalAuthWrapper.tsx': {
    count: 1,
    reason: 'the public discovery read that decides whether the auth provider mounts at all, answered without a session.',
  },
  'packages/app-shell/src/console/auth/bootstrapStatus.ts': {
    count: 1,
    reason: 'the bootstrap-status read, answered without a session.',
  },
  'packages/app-shell/src/console/ai/AiChatPage.tsx': {
    count: 1,
    reason: 'the object read of the AI chat page; an open pull request edits this file, so its call moves with that work.',
  },
  'packages/app-shell/src/console/marketplace/marketplaceApi.ts': {
    count: 5,
    reason:
      'each targets `getCloudBase() || SERVER_URL`: the cloud control plane\'s own origin whenever one is configured, ' +
      'which must never see this runtime\'s bearer.',
  },
  'packages/app-shell/src/runtime-config.ts': {
    count: 1,
    reason: 'the public runtime-config read, answered without a session and shared with the early request `index.html` sends.',
  },
  'packages/app-shell/src/views/metadata-admin/previews/ActionPreview.tsx': {
    count: 1,
    reason: 'the test request of an `api` action preview, sent to the author-written target; its transport is not decided here.',
  },
};

const GLOBAL_FETCH = new Set(['fetch', 'window.fetch', 'globalThis.fetch', 'self.fetch']);

function carriesInclude(node: ts.Node | undefined): boolean {
  return (
    !!node &&
    ts.isObjectLiteralExpression(node) &&
    node.properties.some(
      (p) =>
        ts.isPropertyAssignment(p) &&
        (ts.isIdentifier(p.name) || ts.isStringLiteral(p.name)) &&
        p.name.text === 'credentials' &&
        isIncludeLiteral(unwrap(p.initializer)),
    )
  );
}

/** `'include'`, also written `'include' as const`. */
function isIncludeLiteral(node: ts.Expression): boolean {
  return ts.isStringLiteralLike(node) && node.text === 'include';
}

function unwrap(node: ts.Expression): ts.Expression {
  let n = node;
  while (ts.isParenthesizedExpression(n) || ts.isAsExpression(n) || ts.isSatisfiesExpression(n) || ts.isNonNullExpression(n)) {
    n = n.expression;
  }
  return n;
}

/** True when the call's transport is the global `fetch`, directly or as a `??` / `||` fallback. */
function isGlobalFetchCallee(callee: ts.Expression, sf: ts.SourceFile): boolean {
  const c = unwrap(callee);
  if (GLOBAL_FETCH.has(c.getText(sf))) return true;
  if (
    ts.isBinaryExpression(c) &&
    (c.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken || c.operatorToken.kind === ts.SyntaxKind.BarBarToken)
  ) {
    return GLOBAL_FETCH.has(unwrap(c.right).getText(sf));
  }
  return false;
}

/** The bare cookie-only calls in one source text, as `line :: call` strings. */
function bareCookieOnlyCalls(fileName: string, text: string): string[] {
  const sf = ts.createSourceFile(
    fileName,
    text,
    ts.ScriptTarget.Latest,
    true,
    fileName.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  // A `const NAME = { credentials: 'include', … }` anywhere in the file: an
  // init handed to the call by name.
  const includeConsts = new Set<string>();
  const collect = (n: ts.Node): void => {
    if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.initializer && carriesInclude(unwrap(n.initializer))) {
      includeConsts.add(n.name.text);
    }
    ts.forEachChild(n, collect);
  };
  collect(sf);
  const initIncludes = (arg: ts.Expression | undefined): boolean => {
    if (!arg) return false;
    const a = unwrap(arg);
    return carriesInclude(a) || (ts.isIdentifier(a) && includeConsts.has(a.text));
  };
  const out: string[] = [];
  const visit = (n: ts.Node): void => {
    if (ts.isCallExpression(n)) {
      const bare =
        (isGlobalFetchCallee(n.expression, sf) && initIncludes(n.arguments[1])) ||
        (unwrap(n.expression).getText(sf) === 'sharedGetJson' && n.arguments.length < 3 && initIncludes(n.arguments[1]));
      if (bare) {
        const line = sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;
        out.push(`${line} :: ${n.expression.getText(sf)}(${n.arguments[0]?.getText(sf) ?? ''}, …)`);
      }
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return out;
}

function sourceFiles(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === '__tests__' || entry.name === '__mocks__') continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.tsx?$/.test(entry.name) && !/\.(test|spec)\.tsx?$/.test(entry.name) && !entry.name.endsWith('.d.ts')) out.push(full);
    }
  };
  walk(root);
  return out;
}

function scan(): Map<string, string[]> {
  const found = new Map<string, string[]>();
  for (const file of [...sourceFiles(APP_SHELL_SRC), ...sourceFiles(CONSOLE_SRC)]) {
    const calls = bareCookieOnlyCalls(file, readFileSync(file, 'utf8'));
    if (calls.length) found.set(path.relative(UI_ROOT, file).split(path.sep).join('/'), calls);
  }
  return found;
}

describe('cookie-only same-server fetch ratchet (app-shell + console)', () => {
  it('reads both trees (guards a broken scan path)', () => {
    expect(sourceFiles(APP_SHELL_SRC).length).toBeGreaterThan(500);
    expect(sourceFiles(CONSOLE_SRC).length).toBeGreaterThan(100);
  });

  it('the detector sees every bare spelling, and none of the authenticated ones', () => {
    const cases: Array<[string, number]> = [
      ["await fetch('/api/v1/packages', { credentials: 'include' });", 1],
      ["await window.fetch('/api/v1/x', { method: 'POST', credentials: 'include' });", 1],
      ["await globalThis.fetch(u, { credentials: 'include' } as RequestInit);", 1],
      ["await (apiFetch ?? fetch)('/api/v1/x', { credentials: 'include' });", 1],
      ["const init: RequestInit = { credentials: 'include' }; await fetch(u, init);", 1],
      ["const opts = { credentials: 'include' as const }; await fetch(u, opts);", 1],
      ["await sharedGetJson(u, { credentials: 'include' });", 1],
      ["await authFetch('/api/v1/packages', { credentials: 'include' });", 0],
      ["await createAuthenticatedFetch()('/api/v1/x', { credentials: 'include' });", 0],
      ["await (apiFetch ?? createAuthenticatedFetch())('/api/v1/x', { credentials: 'include' });", 0],
      ["await sharedGetJson(u, { credentials: 'include' }, authFetch);", 0],
      ["await fetch('https://cdn.example.com/a.json', { credentials: 'omit' });", 0],
      ["await fetch('/api/v1/x');", 0],
    ];
    for (const [code, expected] of cases) {
      expect({ code, found: bareCookieOnlyCalls('case.ts', code).length }).toEqual({ code, found: expected });
    }
  });

  it('every bare cookie-only call is a counted row of the shrink-only allow-list', () => {
    const found = scan();
    const unlisted: string[] = [];
    const over: string[] = [];
    for (const [file, calls] of found) {
      const row = ALLOWED[file];
      if (!row) unlisted.push(...calls.map((c) => `${file}:${c}`));
      else if (calls.length > row.count) over.push(`${file}: ${calls.length} found, ${row.count} allowed\n  ${calls.join('\n  ')}`);
    }
    // Route these through createAuthenticatedFetch (see the header).
    expect(unlisted).toEqual([]);
    expect(over).toEqual([]);
  });

  it('every allow-list row is still exact (shrink the row when its file sheds a call)', () => {
    const found = scan();
    const stale = Object.entries(ALLOWED)
      .filter(([file, row]) => (found.get(file)?.length ?? 0) !== row.count)
      .map(([file, row]) => `${file}: ${found.get(file)?.length ?? 0} found, ${row.count} allowed`);
    expect(stale).toEqual([]);
  });
});
