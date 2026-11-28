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
 * `fetch`, in the console and in every `ui/packages/*` source tree (app-shell,
 * and since objectstack#37225 the renderer packages beside it).
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
 * fallback of `??` / `||`, or a local name bound to any of those, objectstack#37242:
 * `const f = fetch` everywhere, and in app-shell and the console also `const
 * doFetch = opts.fetchImpl ?? fetch`, the fallback form below), and `sharedGetJson` without its transport argument
 * (its default is the global `fetch`), when the init it is handed — written
 * inline, or a `const` of this file named as the argument — carries
 * `credentials: 'include'`. The URL is not judged there: a request to another
 * origin that must not see the bearer is an allow-list row with that reason.
 *
 * Also bare (objectstack#37225): the global `fetch` on a written `/api/` path
 * with NO init, or an inline init that names no `credentials` — the default
 * `same-origin` credentials send the cookie alone just the same. Here the URL is
 * the only evidence the request is the server's, so it has to be written out.
 *
 * Written out in any of these spellings (objectstack#37505): a literal or
 * template, a `+` concatenation with such a part (`base + '/api/v1/x'`), or a
 * `const` of this file bound to one of those (`const url = \`${base}/api/…\``).
 * And the init's credentials are read through what it is built from: an
 * explicit `credentials: 'same-origin'` is the default spelled out (the cookie
 * alone), and a `{ ...COOKIE_INIT, method: 'POST' }` spread of a `const` of this
 * file carries that const's credentials unless a later key overrides them. A
 * spread of anything else (`{ ...init }`) is unknown, and unknown is not bare.
 *
 * The renderer packages (`components`, `fields`, `plugin-*`, …) do not import
 * `@object-ui/auth`: their channel is the host's authenticated fetch, handed
 * down as `SchemaRendererProvider`'s `apiFetch` (the console's is
 * `createAuthenticatedFetch({ sameOriginOnly: true })`), read straight off
 * `SchemaRendererContext` and falling back to the global `fetch` only in a host
 * that mounts none — so there a local `const doFetch = apiFetch ?? fetch` is
 * the channel, not a bare call. App-shell and the console build
 * `createAuthenticatedFetch` per call, and a name bound to a `?? fetch`
 * fallback there is the bare fetch under another name.
 *
 * If this fails on a new call: route it through the host's `apiFetch` (a
 * renderer package) or `createAuthenticatedFetch` (app-shell, the console;
 * `{ sameOriginOnly: true }` when the URL is author-written and may name another
 * host). If the call must stay bare, add a row to {@link ALLOWED} with the
 * reason. If it fails on a row: a row whose count went down is shrunk or deleted
 * in the same change. ⛔ Never raise a count to make room.
 */

import { describe, it, expect } from 'vitest';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const HERE = path.dirname(fileURLToPath(import.meta.url));
/** `ui/packages/app-shell/src` */
const APP_SHELL_SRC = HERE;
/** `ui/packages`, whose every package's `src` is scanned. */
const PACKAGES_ROOT = path.resolve(HERE, '../..');
/** `ui/apps/console/src` */
const CONSOLE_SRC = path.resolve(HERE, '../../../apps/console/src');
/** Every tree's paths are written relative to `ui/`. */
const UI_ROOT = path.resolve(HERE, '../../..');

/**
 * The renderer packages objectstack#37225 named: each must be read, so a scan
 * that silently lost one of them fails here rather than passing over it.
 */
const RENDERER_PACKAGES = [
  'components',
  'fields',
  'permissions',
  'plugin-charts',
  'plugin-chatbot',
  'plugin-dashboard',
  'plugin-detail',
  'plugin-grid',
  'plugin-report',
] as const;

/**
 * The bare cookie-only calls left, per file, with the reason each stays.
 * SHRINK-ONLY: a row's count only goes down, a row only goes away.
 */
const ALLOWED: Readonly<Record<string, { count: number; reason: string }>> = {
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
  'packages/auth/src/LoginForm.tsx': {
    count: 1,
    reason: 'the SSO sign-in request, sent before a session, and so a bearer, exists.',
  },
  'packages/permissions/src/MePermissionsProvider.tsx': {
    count: 1,
    reason:
      'the fallback of the injected `fetcher` (`fetcher ?? fetch`): the console hands its authenticated fetch ' +
      '(`AppContent`), and a host that hands none has only the cookie. The package depends on `@object-ui/types` alone.',
  },
};

/**
 * Calls that READ like a bare fetch and are not one, kept here so the reading
 * travels with the code (objectstack#37505, objectstack#37507): each is a
 * renderer package's injected channel with the global `fetch` as the fallback
 * of a host that hands none, which the detector does not count (see the
 * header). A row fails once its file no longer holds the spelling, or once the
 * scan counts a call in that file: delete or move the row then.
 */
const REGISTERED_CHANNELS: ReadonlyArray<{ file: string; spelling: string; reason: string }> = [
  {
    file: 'packages/react/src/hooks/useDatasetDimensionLabels.ts',
    spelling: 'const doFetch = apiFetch ?? fetch;',
    reason: 'the host\'s `apiFetch` off `SchemaRendererContext` (the console\'s authenticated fetch); the global fetch only where no host mounts one.',
  },
  {
    file: 'packages/react/src/element-data-source/useElementApiDataSource.ts',
    spelling: 'const doFetch: ApiFetch = context?.apiFetch ?? fetch;',
    reason: 'the host\'s `apiFetch` off `SchemaRendererContext` (the console\'s authenticated fetch); the global fetch only where no host mounts one.',
  },
  {
    file: 'packages/auth/src/createAuthClient.ts',
    spelling: 'const rawFetch = fetchFn || globalThis.fetch.bind(globalThis);',
    reason:
      'the stale-bearer self-heal: `get-session` retried once WITHOUT the stored bearer, on purpose, because an invalid ' +
      'bearer shadows a valid cookie session; every other request of the client goes through `bearerFetch`.',
  },
];

const GLOBAL_FETCH = new Set(['fetch', 'window.fetch', 'globalThis.fetch', 'self.fetch']);

/**
 * What an init sends as `credentials`: a written value (`'include'`,
 * `'same-origin'`, `'omit'`, also `as const`), `'none'` when it names none (the
 * default `same-origin`: the cookie alone), or `'unknown'` when it cannot be read
 * here (a parameter, a computed value, or a spread of anything but a `const` of
 * this file with no value written before it). `consts` holds this file's
 * `const NAME = { … }` inits, by name.
 */
type Credentials = string;

function credentialsOf(node: ts.Expression | undefined, consts: ReadonlyMap<string, ts.Expression>, seen = new Set<string>()): Credentials {
  if (!node) return 'none';
  const n = unwrap(node);
  if (ts.isIdentifier(n)) {
    const bound = consts.get(n.text);
    if (!bound || seen.has(n.text)) return 'unknown';
    return credentialsOf(bound, consts, new Set(seen).add(n.text));
  }
  if (!ts.isObjectLiteralExpression(n)) return 'unknown';
  // Later keys win, as they do at run time. A spread this file cannot read
  // (`...init`) does not erase a credentials value written before it: the
  // caller's init seldom names one, so the written value is the reading.
  let credentials: Credentials = 'none';
  for (const p of n.properties) {
    if (ts.isSpreadAssignment(p)) {
      const spread = credentialsOf(p.expression, consts, seen);
      if (spread === 'unknown') {
        if (credentials === 'none') credentials = 'unknown';
      } else if (spread !== 'none') {
        credentials = spread;
      }
    } else if (
      (ts.isPropertyAssignment(p) || ts.isShorthandPropertyAssignment(p)) &&
      (ts.isIdentifier(p.name) || ts.isStringLiteral(p.name)) &&
      p.name.text === 'credentials'
    ) {
      const value = ts.isPropertyAssignment(p) ? unwrap(p.initializer) : undefined;
      credentials = value && ts.isStringLiteralLike(value) ? value.text : 'unknown';
    }
  }
  return credentials;
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

/**
 * A URL written out, read only for whether it names an `/api/` path: a literal,
 * a template, a `+` concatenation with such a part, or a `const` of this file
 * bound to one of those (`urlConsts`, by name).
 */
function namesApiPath(node: ts.Expression | undefined, urlConsts: ReadonlyMap<string, ts.Expression> = new Map(), seen = new Set<string>()): boolean {
  if (!node) return false;
  const n = unwrap(node);
  if (ts.isStringLiteralLike(n)) return n.text.includes('/api/');
  if (ts.isTemplateExpression(n)) {
    return [n.head.text, ...n.templateSpans.map((span) => span.literal.text)].some((part) => part.includes('/api/'));
  }
  if (ts.isBinaryExpression(n) && n.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    return namesApiPath(n.left, urlConsts, seen) || namesApiPath(n.right, urlConsts, seen);
  }
  if (ts.isIdentifier(n)) {
    const bound = urlConsts.get(n.text);
    return !!bound && !seen.has(n.text) && namesApiPath(bound, urlConsts, new Set(seen).add(n.text));
  }
  return false;
}

/** The cookie alone: no `credentials` named (the default), or `same-origin` spelled out. */
function sendsCookieAlone(credentials: Credentials): boolean {
  return credentials === 'none' || credentials === 'same-origin';
}

/**
 * The bare cookie-only calls in one source text, as `line :: call` strings.
 * `builds` — the file sits in a tree that builds `createAuthenticatedFetch`
 * (app-shell, the console), where a name bound to a `?? fetch` fallback is bare;
 * in a renderer package that name is the host's `apiFetch` channel.
 */
function bareCookieOnlyCalls(fileName: string, text: string, builds = true): string[] {
  const sf = ts.createSourceFile(
    fileName,
    text,
    ts.ScriptTarget.Latest,
    true,
    fileName.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  // A `const NAME = { … }` anywhere in the file: an init handed to the call by
  // name, or spread into one. A `const NAME = <string, template or +>`: a URL
  // handed to the call by name (objectstack#37505).
  const initConsts = new Map<string, ts.Expression>();
  const urlConsts = new Map<string, ts.Expression>();
  const collect = (n: ts.Node): void => {
    if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.initializer) {
      const bound = unwrap(n.initializer);
      if (ts.isObjectLiteralExpression(bound)) initConsts.set(n.name.text, bound);
      else if (
        ts.isStringLiteralLike(bound) ||
        ts.isTemplateExpression(bound) ||
        (ts.isBinaryExpression(bound) && bound.operatorToken.kind === ts.SyntaxKind.PlusToken) ||
        ts.isIdentifier(bound)
      ) {
        urlConsts.set(n.name.text, bound);
      }
    }
    ts.forEachChild(n, collect);
  };
  // objectstack#37242 — a local name bound to the global `fetch` is that
  // transport under another name: `const f = fetch` anywhere, and `const doFetch
  // = opts.fetchImpl ?? fetch` where the tree builds the authenticated fetch.
  const fetchAliases = new Set<string>();
  const collectAliases = (n: ts.Node): void => {
    if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.initializer) {
      const bound = unwrap(n.initializer);
      if (GLOBAL_FETCH.has(bound.getText(sf)) || (builds && isGlobalFetchCallee(bound, sf))) fetchAliases.add(n.name.text);
    }
    ts.forEachChild(n, collectAliases);
  };
  collect(sf);
  collectAliases(sf);
  const isBareTransport = (callee: ts.Expression): boolean => {
    const c = unwrap(callee);
    return isGlobalFetchCallee(c, sf) || (ts.isIdentifier(c) && fetchAliases.has(c.text));
  };
  const initIncludes = (arg: ts.Expression | undefined): boolean => !!arg && credentialsOf(arg, initConsts) === 'include';
  const out: string[] = [];
  const visit = (n: ts.Node): void => {
    if (ts.isCallExpression(n)) {
      const bare =
        (isBareTransport(n.expression) && initIncludes(n.arguments[1])) ||
        (isBareTransport(n.expression) &&
          namesApiPath(n.arguments[0], urlConsts) &&
          sendsCookieAlone(credentialsOf(n.arguments[1], initConsts))) ||
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

/** Every `ui/packages/<name>/src` that exists, by package directory name. */
function packageSourceRoots(): Map<string, string> {
  const roots = new Map<string, string>();
  for (const entry of readdirSync(PACKAGES_ROOT, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const src = path.join(PACKAGES_ROOT, entry.name, 'src');
    if (existsSync(src)) roots.set(entry.name, src);
  }
  return roots;
}

let scanned: Map<string, string[]> | undefined;

/** The whole scan, once per run: two cases read it. */
function scan(): Map<string, string[]> {
  if (scanned) return scanned;
  const found = new Map<string, string[]>();
  const files = [...[...packageSourceRoots().values()].flatMap(sourceFiles), ...sourceFiles(CONSOLE_SRC)];
  const inside = (root: string, file: string) => !path.relative(root, file).startsWith('..');
  for (const file of files) {
    const builds = inside(APP_SHELL_SRC, file) || inside(CONSOLE_SRC, file);
    const calls = bareCookieOnlyCalls(file, readFileSync(file, 'utf8'), builds);
    if (calls.length) found.set(path.relative(UI_ROOT, file).split(path.sep).join('/'), calls);
  }
  scanned = found;
  return found;
}

describe('cookie-only same-server fetch ratchet (every ui package + console)', () => {
  it('reads every tree (guards a broken scan path)', () => {
    expect(sourceFiles(APP_SHELL_SRC).length).toBeGreaterThan(500);
    expect(sourceFiles(CONSOLE_SRC).length).toBeGreaterThan(100);
    const roots = packageSourceRoots();
    expect(roots.size).toBeGreaterThan(30);
    const unread = RENDERER_PACKAGES.filter((name) => !roots.has(name) || sourceFiles(roots.get(name)!).length === 0);
    expect(unread).toEqual([]);
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
      // No init, or no `credentials`, on a written `/api/` path: the cookie alone (objectstack#37225).
      ["await fetch('/api/v1/x');", 1],
      ['await fetch(`/api/v1/objects/${name}/fields`);', 1],
      ["await window.fetch(`${base}/api/v1/x`, { method: 'POST', headers: h });", 1],
      // `same-origin` spelled out is the default: the cookie alone (objectstack#37505).
      ["await fetch('/api/v1/x', { credentials: 'same-origin' });", 1],
      ["const init = { credentials: 'same-origin' as const }; await fetch('/api/v1/x', init);", 1],
      ["await fetch('/api/v1/x', { credentials: 'omit' });", 0],
      // A spread init is unknown, unless it spreads a `const` of the file (objectstack#37505).
      ["await fetch('/api/v1/x', { ...init });", 0],
      ["const COOKIE = { credentials: 'include' as const }; await fetch(u, { ...COOKIE, method: 'POST' });", 1],
      ["const BASE_INIT = { method: 'POST' }; await fetch('/api/v1/x', { ...BASE_INIT });", 1],
      ["const COOKIE = { credentials: 'include' as const }; await fetch(u, { ...COOKIE, credentials: 'omit' });", 0],
      ["const COOKIE = { credentials: 'include' as const }; await authFetch(u, { ...COOKIE });", 0],
      ["await (channel ?? fetch)(`${API_BASE}${path}`, { credentials: 'include', ...init });", 1],
      // A URL written as a `+` concatenation or held in a `const` (objectstack#37505).
      ["await fetch(base + '/api/v1/x');", 1],
      ["await fetch(SERVER_URL + `/api/v1/objects/${name}`, { method: 'POST' });", 1],
      ["const url = '/api/v1/x'; await fetch(url);", 1],
      ['const url = `${this.baseUrl}/api/data/${encodeURIComponent(r)}/upload`; await fetch(url, { method: \'POST\', body });', 1],
      ["const ROUTE = '/api/v1/x'; await window.fetch(origin + ROUTE);", 1],
      ["const url = 'https://cdn.example.com/a.json'; await fetch(url);", 0],
      ["await fetch(base + '/static/a.json');", 0],
      ["const url = '/api/v1/x'; await createAuthenticatedFetch()(url);", 0],
      ["await fetch(url);", 0],
      ["await fetch('https://cdn.example.com/a.json');", 0],
      ["await authFetch('/api/v1/x');", 0],
      ["await doFetch(`/api/v1/objects/${name}/fields`);", 0],
      // A local name bound to the global fetch is that fetch (objectstack#37242).
      ["const doFetch = opts.fetchImpl ?? fetch; await doFetch(`/api/v1/objects/${name}/fields`, { credentials: 'include' });", 1],
      ["const doFetch = opts.fetchImpl || globalThis.fetch; await doFetch('/api/v1/x');", 1],
      ["const f = window.fetch; await f(u, { credentials: 'include' });", 1],
      ["const doFetch = opts.fetchImpl ?? createAuthenticatedFetch(); await doFetch('/api/v1/x', { credentials: 'include' });", 0],
      ["const doFetch = createAuthenticatedFetch(); await doFetch('/api/v1/x');", 0],
    ];
    // A renderer package's `?? fetch` name is the host's `apiFetch` channel; a plain alias is still bare.
    const rendererCases: Array<[string, number]> = [
      ["const doFetch = apiFetch ?? fetch; await doFetch(listUrl, { credentials: 'include' });", 0],
      ["const f = fetch; await f('/api/v1/x', { credentials: 'include' });", 1],
    ];
    for (const [code, expected] of rendererCases) {
      const found = bareCookieOnlyCalls('case.ts', `async function run() { ${code} }`, false).length;
      expect({ code, found, renderer: true }).toEqual({ code, found: expected, renderer: true });
    }
    for (const [code, expected] of cases) {
      // Inside an async function: at a script's top level `await (x)(…)` parses as a call of `await`.
      const found = bareCookieOnlyCalls('case.ts', `async function run() { ${code} }`).length;
      expect({ code, found }).toEqual({ code, found: expected });
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

  it('every registered channel still reads as written, and is still not counted', () => {
    const found = scan();
    const drifted = REGISTERED_CHANNELS.filter(({ file, spelling }) => {
      const full = path.join(UI_ROOT, file);
      return !existsSync(full) || !readFileSync(full, 'utf8').includes(spelling) || found.has(file);
    }).map(({ file }) => file);
    expect(drifted).toEqual([]);
  });

  it('every allow-list row is still exact (shrink the row when its file sheds a call)', () => {
    const found = scan();
    const stale = Object.entries(ALLOWED)
      .filter(([file, row]) => (found.get(file)?.length ?? 0) !== row.count)
      .map(([file, row]) => `${file}: ${found.get(file)?.length ?? 0} found, ${row.count} allowed`);
    expect(stale).toEqual([]);
  });
});
