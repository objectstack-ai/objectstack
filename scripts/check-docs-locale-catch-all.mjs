#!/usr/bin/env node
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// check-docs-locale-catch-all -- keep `apps/docs`'s top-level dynamic route
// segments from serving the homepage under paths that are not locales.
//
//   node scripts/check-docs-locale-catch-all.mjs
//   node scripts/check-docs-locale-catch-all.mjs --self-test
//
// ## The defect this pins
//
// `apps/docs/app/[lang]/` is a catch-all: it matches ANY single path segment.
// It is normally unreachable with a junk segment, because `proxy.ts` rewrites
// `/<x>` to `/en/<x>` -- two segments, which match nothing, so `/nonsense`
// 404s. But the proxy's matcher deliberately excludes paths containing a dot
// (static assets must not be locale-rewritten), so a dotted single-segment path
// skips the proxy entirely and lands on `[lang]` with `lang` set to that
// literal segment.
//
// Measured on the dev server before the fix, from the request log's own timing
// breakdown -- `proxy.ts:` appears only where the proxy actually ran:
//
//   GET /docs                  200 (next.js: 23ms, proxy.ts: 1.9ms, ...)   <- rewritten
//   GET /this-page-does-not-exist 404 (next.js: 525ms, proxy.ts: 6ms, ...) <- rewritten, 404
//   GET /foo.txt               200 (next.js: 5ms, generate-params: 2ms, ...)   <- NO proxy.ts
//   GET /ads.txt               200 (next.js: 1.8ms, ...)                       <- NO proxy.ts
//   GET /robots.txt            200 (next.js: 1.8ms, ...)                       <- NO proxy.ts
//
// and a temporary probe in the layout printed the parameter it received:
//
//   [probe] lang="foo.txt"   [probe] lang="ads.txt"
//   [probe] lang="robots.txt"   [probe] lang="sitemap.xml"   [probe] lang="en"
//
// Every one of those rendered the full homepage under a 200. That publishes an
// unbounded set of duplicate homepages at exactly the URLs crawlers probe by
// default (`/ads.txt`, `/security.txt`, `/sitemap_index.xml`), and it hides the
// two paths that matter most -- `/robots.txt` and `/sitemap.xml` -- behind HTML.
//
// ## Why a gate rather than a comment
//
// The guard is three lines in a layout that is otherwise pure presentation, and
// deleting it breaks NOTHING that any other check can see: every page still
// renders, every type still checks, every link still resolves. The only symptom
// is a 200 where a 404 belongs, on URLs no test requests. That is the exact
// shape of a regression that comes back silently.
//
// ## The invariant, and why it is conditional
//
// The guard is required BECAUSE the proxy lets dotted paths through. Those are
// two halves of one invariant, so this gate checks them as one:
//
//   IF a dotted single-segment path bypasses `proxy.ts`'s matcher
//   THEN every top-level dynamic segment under `apps/docs/app/` must reject a
//        parameter that is not a declared locale, before it renders anything.
//
// Written that way the gate reasons instead of pattern-matching: a future
// change that makes the proxy handle dotted paths relaxes the requirement on
// its own, and `--self-test` proves the condition is live by flipping it (a
// matcher that DOES match dotted paths turns the missing guard green). A gate
// whose condition is decorative is a gate that will one day fail for the wrong
// reason.
//
// The requirement is on the SEGMENT, not on one filename: a new
// `apps/docs/app/[slug]/` would reintroduce the same soft-404 class, and this
// gate names it the moment it appears.
//
// ## Why this file is dependency-free
//
// Same reason `check-docs-redirects.mjs` is: it must run in any container with
// `node scripts/check-docs-locale-catch-all.mjs`, with no workspace install and
// no network. It reads four source files as text and compiles one regex.

import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isEntrypoint } from './invoked-as.mjs';

/** Paths a crawler probes by default -- the reachable half of the defect. */
const DOTTED_PROBES = ['/ads.txt', '/security.txt', '/sitemap_index.xml', '/anything.html'];

/** A dotless single-segment path, which the proxy MUST still rewrite. */
const DOTLESS_PROBE = '/this-page-does-not-exist';

/** The shared predicate a guarded segment has to call. */
const PREDICATE = 'isSupportedLanguage';

/** The repo this script lives in -- resolved from the script, so cwd cannot lie. */
function scriptRepoRoot() {
  return join(dirname(fileURLToPath(import.meta.url)), '..');
}

// ---------------------------------------------------------------------------
// proxy.ts -- does a dotted path reach the router unrewritten?
// ---------------------------------------------------------------------------

/**
 * Pull the `matcher` entries out of `export const config = { matcher: [...] }`.
 *
 * @param {string} source
 * @returns {{ matchers: string[], error?: undefined } | { error: string, matchers?: undefined }}
 */
export function readMatchers(source) {
  const block = /matcher\s*:\s*\[([\s\S]*?)\]/.exec(source);
  if (!block) return { error: 'proxy.ts declares no `matcher` array in its exported config' };
  const matchers = [...block[1].matchAll(/'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)"/g)].map((m) => {
    const raw = m[1] ?? m[2];
    // The entry is a JS string literal; the only escape it carries is `\\`.
    return raw.replace(/\\\\/g, '\\');
  });
  if (!matchers.length) return { error: 'proxy.ts `matcher` array holds no string entries' };
  return { matchers };
}

/**
 * Decide whether the proxy runs for a path.
 *
 * A matcher this gate cannot compile is reported, never treated as
 * "matches nothing" -- reading a pattern as inert is the failure mode the gate
 * exists to prevent, relocated into the gate itself.
 *
 * @param {string[]} matchers
 * @returns {{ runsFor: (path: string) => boolean, error?: undefined } | { error: string, runsFor?: undefined }}
 */
export function compileMatchers(matchers) {
  const compiled = [];
  for (const matcher of matchers) {
    try {
      compiled.push(new RegExp(`^${matcher}$`));
    } catch (error) {
      return { error: `matcher ${JSON.stringify(matcher)} does not compile: ${error.message}` };
    }
  }
  return { runsFor: (path) => compiled.some((re) => re.test(path)) };
}

// ---------------------------------------------------------------------------
// The app tree -- which top-level segments are dynamic, and are they guarded?
// ---------------------------------------------------------------------------

/** `[lang]` -> `lang`, `[...rest]` -> `rest`, `[[...slug]]` -> `slug`; else null. */
export function dynamicParamName(dirName) {
  const parsed = /^\[{1,2}(?:\.{3})?([A-Za-z0-9_]+)\]{1,2}$/.exec(dirName);
  return parsed ? parsed[1] : null;
}

/**
 * Does this segment reject a parameter that is not a declared locale, before it
 * renders? Returns the reason it does not, or null when it does.
 *
 * @param {string} source
 * @param {string} param
 * @returns {string | null}
 */
export function guardFailure(source, param) {
  if (!new RegExp(`\\bnotFound\\b[\\s\\S]*from\\s+['"]next/navigation['"]`).test(source)
    && !/from\s+['"]next\/navigation['"][\s\S]*?\bnotFound\b/.test(source)) {
    return `does not import \`notFound\` from 'next/navigation'`;
  }
  if (!new RegExp(`import\\s*\\{[^}]*\\b${PREDICATE}\\b[^}]*\\}\\s*from\\s+['"][^'"]*i18n['"]`).test(source)) {
    return `does not import the shared \`${PREDICATE}\` predicate from lib/i18n`;
  }
  const call = new RegExp(
    `if\\s*\\(\\s*!\\s*${PREDICATE}\\s*\\(\\s*${param}\\s*\\)\\s*\\)\\s*\\{?\\s*notFound\\s*\\(\\s*\\)`,
  );
  const guardAt = source.search(call);
  if (guardAt < 0) {
    return `never calls \`if (!${PREDICATE}(${param})) notFound()\``;
  }
  const returnAt = source.search(/\n\s*return\s*\(/);
  if (returnAt >= 0 && guardAt > returnAt) {
    return `calls \`${PREDICATE}\` only AFTER it has started rendering -- the guard must run first`;
  }
  return null;
}

/**
 * Is the shared predicate still derived from the declared locale list? A
 * predicate that stopped reading `i18n.languages` would answer `true` for
 * everything and take the whole gate green with it.
 *
 * @param {string} source
 * @returns {string | null}
 */
export function predicateFailure(source) {
  const declared = new RegExp(`export\\s+function\\s+${PREDICATE}\\s*\\(`);
  if (!declared.test(source)) return `lib/i18n.ts does not export \`${PREDICATE}\``;
  const body = source.slice(source.search(declared));
  if (!/i18n\.languages/.test(body.slice(0, 400))) {
    return `\`${PREDICATE}\` does not read \`i18n.languages\` -- it cannot be enforcing the declared locales`;
  }
  return null;
}

// ---------------------------------------------------------------------------

/**
 * @param {{ appDir: string, proxyPath: string, i18nPath: string }} paths
 * @returns {{ findings: string[], stats: Record<string, unknown> }}
 */
export function checkApp({ appDir, proxyPath, i18nPath }) {
  const findings = [];
  const stats = { segments: 0, guarded: 0, dottedBypassesProxy: null };

  if (!existsSync(proxyPath)) return { findings: [`missing ${proxyPath}`], stats };
  const read = readMatchers(readFileSync(proxyPath, 'utf8'));
  if (read.error) return { findings: [read.error], stats };
  const compiled = compileMatchers(read.matchers);
  if (compiled.error) return { findings: [compiled.error], stats };

  const bypassing = DOTTED_PROBES.filter((p) => !compiled.runsFor(p));
  stats.dottedBypassesProxy = bypassing.length > 0;
  stats.bypassing = bypassing;

  if (compiled.runsFor(DOTLESS_PROBE) === false) {
    findings.push(
      `proxy.ts no longer rewrites \`${DOTLESS_PROBE}\`. A dotless unknown segment now reaches the `
      + 'dynamic route too, so the locale guard is the ONLY thing standing between the homepage and '
      + 'every one-segment URL -- re-measure before relaxing anything here.',
    );
  }

  const entries = existsSync(appDir)
    ? readdirSync(appDir, { withFileTypes: true }).filter((e) => e.isDirectory())
    : [];
  for (const entry of entries) {
    const param = dynamicParamName(entry.name);
    if (!param) continue;
    stats.segments += 1;
    if (!stats.dottedBypassesProxy) continue;

    const candidates = ['layout.tsx', 'layout.jsx', 'page.tsx', 'page.jsx']
      .map((f) => join(appDir, entry.name, f))
      .filter((f) => existsSync(f));
    if (!candidates.length) {
      findings.push(`app/${entry.name}/ has no layout or page to carry the locale guard`);
      continue;
    }
    const reasons = candidates.map((file) => ({ file, why: guardFailure(readFileSync(file, 'utf8'), param) }));
    if (reasons.some((r) => r.why === null)) {
      stats.guarded += 1;
      continue;
    }
    findings.push(
      `app/${entry.name}/ is a top-level catch-all and nothing rejects a non-locale \`${param}\`: `
      + reasons.map((r) => `${r.file.split('/').slice(-2).join('/')} ${r.why}`).join('; ')
      + `. Dotted paths (${bypassing.join(', ')}) skip proxy.ts and land here, so every one of them `
      + 'renders this segment under a 200.',
    );
  }

  if (!existsSync(i18nPath)) {
    findings.push(`missing ${i18nPath}`);
  } else if (stats.dottedBypassesProxy) {
    const why = predicateFailure(readFileSync(i18nPath, 'utf8'));
    if (why) findings.push(why);
  }

  return { findings, stats };
}

function summarise(stats) {
  return `${stats.segments} top-level dynamic segment(s), ${stats.guarded} guarded; `
    + `dotted paths bypass proxy.ts: ${stats.dottedBypassesProxy}`;
}

function report(findings, stats) {
  if (findings.length) {
    console.error(`✗ check-docs-locale-catch-all -- ${findings.length} finding(s)\n`);
    for (const finding of findings) console.error(`  • ${finding}`);
    console.error('');
    return 1;
  }
  console.log(`✓ check-docs-locale-catch-all: ${summarise(stats)}`);
  return 0;
}

// ---------------------------------------------------------------------------
// --self-test -- every limb observed FAILING and observed silent.
// ---------------------------------------------------------------------------

const FIXTURE_PROXY = `export const config = {
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico|.*\\\\..*).*)'],
};
`;

const FIXTURE_I18N = `export const i18n = { defaultLanguage: 'en', languages: ['en'] };

export function isSupportedLanguage(value) {
  return i18n.languages.includes(value);
}
`;

const FIXTURE_LAYOUT = `import { notFound } from 'next/navigation';
import { i18n, isSupportedLanguage } from '@/lib/i18n';

export default async function LanguageLayout({ params, children }) {
  const { lang } = await params;

  if (!isSupportedLanguage(lang)) notFound();

  return (
    <div lang={lang}>{children}</div>
  );
}
`;

function writeFixture(dir, { proxy = FIXTURE_PROXY, i18n = FIXTURE_I18N, layout = FIXTURE_LAYOUT, extra } = {}) {
  const appDir = join(dir, 'app');
  rmSync(appDir, { recursive: true, force: true });
  mkdirSync(join(appDir, '[lang]'), { recursive: true });
  mkdirSync(join(dir, 'lib'), { recursive: true });
  writeFileSync(join(dir, 'proxy.ts'), proxy);
  writeFileSync(join(dir, 'lib', 'i18n.ts'), i18n);
  writeFileSync(join(appDir, '[lang]', 'layout.tsx'), layout);
  // A static sibling segment must never be mistaken for a dynamic one.
  mkdirSync(join(appDir, 'llms.txt'), { recursive: true });
  writeFileSync(join(appDir, 'llms.txt', 'route.ts'), 'export const revalidate = false;\n');
  if (extra) {
    mkdirSync(join(appDir, extra.name), { recursive: true });
    writeFileSync(join(appDir, extra.name, 'layout.tsx'), extra.layout);
  }
  return { appDir, proxyPath: join(dir, 'proxy.ts'), i18nPath: join(dir, 'lib', 'i18n.ts') };
}

function selfTest() {
  const failures = [];
  let checked = 0;
  const assert = (ok, what) => {
    checked += 1;
    if (!ok) failures.push(what);
  };
  const dir = mkdtempSync(join(tmpdir(), 'docs-locale-catch-all-'));
  try {
    // 1. GREEN: the real shape passes, and the summary names its own scope.
    let paths = writeFixture(dir);
    let run = checkApp(paths);
    assert(run.findings.length === 0, `clean fixture must be silent -- got ${JSON.stringify(run.findings)}`);
    assert(run.stats.segments === 1 && run.stats.guarded === 1, `clean fixture must find 1 guarded segment -- got ${summarise(run.stats)}`);
    assert(run.stats.dottedBypassesProxy === true, 'the real matcher must be read as letting dotted paths through');

    // 2. RED: the guard call deleted -- the exact regression this gate exists for.
    paths = writeFixture(dir, { layout: FIXTURE_LAYOUT.replace('  if (!isSupportedLanguage(lang)) notFound();\n', '') });
    run = checkApp(paths);
    assert(run.findings.length === 1 && /never calls/.test(run.findings[0]), `deleting the guard must be reported once -- got ${JSON.stringify(run.findings)}`);

    // 3. RED: the guard present but AFTER rendering starts.
    paths = writeFixture(dir, {
      layout: FIXTURE_LAYOUT
        .replace('  if (!isSupportedLanguage(lang)) notFound();\n', '')
        .replace('  );\n}', '  );\n  if (!isSupportedLanguage(lang)) notFound();\n}'),
    });
    run = checkApp(paths);
    assert(run.findings.length === 1 && /AFTER it has started rendering/.test(run.findings[0]), `a guard behind the return must be reported -- got ${JSON.stringify(run.findings)}`);

    // 4. RED: the predicate stops reading the declared locales.
    paths = writeFixture(dir, { i18n: FIXTURE_I18N.replace('return i18n.languages.includes(value);', 'return true;') });
    run = checkApp(paths);
    assert(run.findings.length === 1 && /does not read/.test(run.findings[0]), `a predicate that stopped reading i18n.languages must be reported -- got ${JSON.stringify(run.findings)}`);

    // 5. RED: a NEW unguarded top-level dynamic segment -- the class, not the file.
    paths = writeFixture(dir, { extra: { name: '[slug]', layout: 'export default function S({ children }) { return children; }\n' } });
    run = checkApp(paths);
    assert(run.findings.length === 1 && /app\/\[slug\]\//.test(run.findings[0]), `a new unguarded segment must be reported -- got ${JSON.stringify(run.findings)}`);
    assert(run.stats.segments === 2 && run.stats.guarded === 1, `both segments must be counted -- got ${summarise(run.stats)}`);

    // 6. The condition is LIVE, not decorative: a matcher that DOES cover dotted
    //    paths makes the guard unnecessary, and the missing guard goes green.
    paths = writeFixture(dir, {
      proxy: `export const config = { matcher: ['/((?!api|_next/static).*)'] };\n`,
      layout: FIXTURE_LAYOUT.replace('  if (!isSupportedLanguage(lang)) notFound();\n', ''),
    });
    run = checkApp(paths);
    assert(run.findings.length === 0, `a proxy that rewrites dotted paths must not demand the guard -- got ${JSON.stringify(run.findings)}`);
    assert(run.stats.dottedBypassesProxy === false, 'the widened matcher must be read as covering dotted paths');

    // 7. RED: a matcher that stops rewriting the dotless probe is reported, not
    //    silently read as "everything bypasses".
    paths = writeFixture(dir, { proxy: `export const config = { matcher: ['/docs/(.*)'] };\n` });
    run = checkApp(paths);
    assert(run.findings.some((f) => /no longer rewrites/.test(f)), `a matcher that stops covering the dotless probe must be reported -- got ${JSON.stringify(run.findings)}`);

    // 8. RED: an uncompilable matcher is loud, never treated as inert.
    paths = writeFixture(dir, { proxy: `export const config = { matcher: ['/((?!unclosed.*)'] };\n` });
    run = checkApp(paths);
    assert(run.findings.length === 1 && /does not compile/.test(run.findings[0]), `an uncompilable matcher must be reported -- got ${JSON.stringify(run.findings)}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }

  if (failures.length) {
    console.error(`✗ check-docs-locale-catch-all --self-test -- ${failures.length} failure(s)\n`);
    for (const failure of failures) console.error(`  • ${failure}`);
    process.exit(1);
  }
  console.log(
    `✓ check-docs-locale-catch-all --self-test: ${checked} assertions over a temp fixture (real checkApp path); `
    + 'every limb -- deleted guard, guard behind the return, hollowed predicate, a new unguarded segment, '
    + 'an uncompilable matcher -- observed FAILING, and the proxy condition observed flipping the requirement off.',
  );
}

function main() {
  const root = scriptRepoRoot();
  const { findings, stats } = checkApp({
    appDir: join(root, 'apps/docs/app'),
    proxyPath: join(root, 'apps/docs/proxy.ts'),
    i18nPath: join(root, 'apps/docs/lib/i18n.ts'),
  });
  process.exit(report(findings, stats));
}

if (isEntrypoint(import.meta.url)) {
  if (process.argv.includes('--self-test')) selfTest();
  else main();
}
