#!/usr/bin/env node
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// check-docs-locale-catch-all -- pin the two surfaces `apps/docs`'s
// dot-exclusion rule holds up: the top-level dynamic route segments must not
// serve the homepage under paths that are not locales, and the Open Graph card
// URL must keep the dotted final segment that keeps it out of the rewriter.
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
// ## The other surface the same dot rule holds up: the OG card URL
//
// `apps/docs/lib/source.ts`'s `getPageImage()` builds every Open Graph card URL
// as `/og/docs/<...page.slugs>/image.png`. That trailing marker is load-bearing
// TWICE, and only the first is discoverable from the code:
//
//   1. `app/og/docs/[...slug]/route.tsx` resolves the page with
//      `source.getPage(slug.slice(0, -1))` -- the marker is the sacrificial
//      segment that slice discards. Its NAME is irrelevant to that.
//   2. Its DOT is what keeps the URL out of the locale rewriter. Measured
//      against the matcher `proxy.ts` carries today:
//
//        /og/docs/ai/agents            -> proxy RUNS  -> rewritten to
//                                         /en/og/docs/ai/agents, which is not a
//                                         route (`app/og/` is top-level, NOT
//                                         under `app/[lang]/`) -> 404
//        /og/docs/ai/agents/x.png      -> proxy SKIPS -> 200 image/png
//        /og/docs/ai/agents/image.png  -> proxy SKIPS -> 200 image/png
//
// So the marker's name is free and its dot is not: renaming it to anything
// dotless takes every `og:image` on the site to 404 at once. A 404ing
// `og:image` is worse than none -- crawlers fall back to scraping whatever else
// the page offers -- and nothing fetches these URLs: no test, no link checker,
// no type. Silent by construction, which is the same reason the catch-all guard
// above needed a gate rather than a comment.
//
// This limb asserts the half that was asserted nowhere: the URL `getPageImage()`
// builds ends in a final segment containing a dot. It deliberately does NOT
// re-assert that the matcher excludes dotted paths -- that condition is read
// once, above, and both halves are reported in the summary line.
//
// The assertion is made on the URL the function RETURNS, not on the array
// literal alone. The marker is the URL's final segment only while the returned
// template still ends in `${segments.join('/')}`; checking the literal without
// that link would be a check on a variable that may no longer reach the URL --
// a phantom check, in a file whose whole subject is checks that stop checking.
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

/** The OG card URL builder this gate reads, in `apps/docs/lib/source.ts`. */
const OG_BUILDER = 'getPageImage';

/** Page slugs used only to render a concrete example path in the finding. */
const OG_SAMPLE_SLUGS = ['ai', 'agents'];

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
// lib/source.ts -- does the OG card URL still end in a dotted segment?
// ---------------------------------------------------------------------------

/**
 * Read the URL `getPageImage()` builds, as far as it is statically decidable:
 * the marker appended after the page slugs, and the literal path prefix the
 * joined segments are appended to.
 *
 * Every shape this cannot read is an ERROR, never a pass. A source file the
 * gate cannot parse is a source file it is not checking, and reporting that as
 * "fine" is the failure mode this whole file exists to prevent.
 *
 * @param {string} source
 * @returns {{ marker: string, prefix: string, error?: undefined }
 *   | { error: string, marker?: undefined, prefix?: undefined }}
 */
export function readOgCardUrl(source) {
  const at = source.search(new RegExp(`function\\s+${OG_BUILDER}\\s*\\(`));
  if (at < 0) {
    return {
      error: `lib/source.ts no longer declares \`${OG_BUILDER}()\` -- this gate cannot see what the `
        + 'OG card URLs are built from, so it is checking nothing',
    };
  }
  const rest = source.slice(at);
  const closes = rest.search(/\n\}/);
  const body = closes >= 0 ? rest.slice(0, closes) : rest;

  const array = /const\s+([A-Za-z_$][\w$]*)\s*=\s*\[([^\]]*)\]/.exec(body);
  if (!array) {
    return {
      error: `\`${OG_BUILDER}()\` no longer builds its path from one array literal; this gate reads `
        + "that literal to find the URL's final segment",
    };
  }
  const [, name, contents] = array;
  const elements = contents.split(',').map((e) => e.trim()).filter(Boolean);
  const last = elements[elements.length - 1] ?? '';
  const literal = /^'((?:[^'\\]|\\.)*)'$|^"((?:[^"\\]|\\.)*)"$/.exec(last);
  if (!literal) {
    return {
      error: `the last element of \`${name}\` in \`${OG_BUILDER}()\` is \`${last || '(nothing)'}\`, not a `
        + "string literal this gate can read -- the URL's final segment is no longer statically decidable",
    };
  }
  const marker = literal[1] ?? literal[2];

  const template = /url\s*:\s*`([^`]*)`/.exec(body);
  if (!template) {
    return { error: `\`${OG_BUILDER}()\` no longer returns a \`url\` built from a template literal` };
  }
  const joined = new RegExp(`\\$\\{\\s*${name}\\s*\\.join\\(\\s*(['"])/\\1\\s*\\)\\s*\\}$`);
  const ends = joined.exec(template[1]);
  if (!ends) {
    return {
      error: `\`${OG_BUILDER}()\`'s \`url\` no longer ENDS with \`\${${name}.join('/')}\` `
        + `(it is \`${template[1]}\`), so the last element of \`${name}\` is not the URL's final segment `
        + 'and the dot invariant below would be checking the wrong string',
    };
  }
  const prefix = template[1].slice(0, ends.index);
  if (prefix.includes('${')) {
    return {
      error: `\`${OG_BUILDER}()\`'s \`url\` interpolates before the segments (\`${prefix}\`), so this `
        + 'gate cannot render the path it produces',
    };
  }
  return { marker, prefix };
}

// ---------------------------------------------------------------------------

/**
 * @param {{ appDir: string, proxyPath: string, i18nPath: string, sourcePath: string }} paths
 * @returns {{ findings: string[], stats: Record<string, unknown> }}
 */
export function checkApp({ appDir, proxyPath, i18nPath, sourcePath }) {
  const findings = [];
  const stats = {
    segments: 0,
    guarded: 0,
    dottedBypassesProxy: null,
    ogMarker: null,
    ogFinalSegmentDotted: null,
    ogUrlSkipsProxy: null,
  };

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

  // The OTHER consumer of the same dot rule: the OG card URL (see the header).
  // Unconditional, unlike the catch-all guard below -- a matcher that stopped
  // excluding dotted paths would not relax this requirement, it would break the
  // surface outright, so there is no condition under which a dotless marker is
  // the right answer. The matcher half is read once above and reported, never
  // re-asserted here.
  if (!existsSync(sourcePath)) {
    findings.push(`missing ${sourcePath}`);
  } else {
    const og = readOgCardUrl(readFileSync(sourcePath, 'utf8'));
    if (og.error) {
      findings.push(og.error);
    } else {
      const finalSegment = og.marker.split('/').filter(Boolean).pop() ?? '';
      const probe = `${og.prefix}${[...OG_SAMPLE_SLUGS, og.marker].join('/')}`;
      stats.ogMarker = og.marker;
      stats.ogFinalSegmentDotted = finalSegment.includes('.');
      stats.ogUrlSkipsProxy = !compiled.runsFor(probe);
      if (!stats.ogFinalSegmentDotted) {
        findings.push(
          `the OG card URL \`${OG_BUILDER}()\` builds ends in \`${finalSegment || '(no final segment)'}\`, `
          + "which contains no dot. proxy.ts's matcher excludes ONLY paths containing a dot, so "
          + `\`${probe}\` is now locale-rewritten to \`/<locale>${probe}\` -- a path app/og/ does not `
          + 'serve, because that tree is top-level and not under app/[lang]/. Every `og:image` on the '
          + 'site 404s at once, and nothing fetches these URLs, so no other check sees it. Restore a '
          + "final segment containing a dot in apps/docs/lib/source.ts (the marker's NAME is free; its "
          + 'dot is not).',
        );
      }
    }
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
    + `dotted paths bypass proxy.ts: ${stats.dottedBypassesProxy}; `
    + `OG card marker ${JSON.stringify(stats.ogMarker)} ends in a dot: ${stats.ogFinalSegmentDotted} `
    + `(that URL skips proxy.ts: ${stats.ogUrlSkipsProxy})`;
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

const FIXTURE_SOURCE = `export function getPageImage(page) {
  const segments = [...page.slugs, 'image.png'];

  return {
    segments,
    url: \`/og/docs/\${segments.join('/')}\`,
  };
}
`;

function writeFixture(
  dir,
  { proxy = FIXTURE_PROXY, i18n = FIXTURE_I18N, layout = FIXTURE_LAYOUT, pageSource = FIXTURE_SOURCE, extra } = {},
) {
  const appDir = join(dir, 'app');
  rmSync(appDir, { recursive: true, force: true });
  mkdirSync(join(appDir, '[lang]'), { recursive: true });
  mkdirSync(join(dir, 'lib'), { recursive: true });
  writeFileSync(join(dir, 'proxy.ts'), proxy);
  writeFileSync(join(dir, 'lib', 'i18n.ts'), i18n);
  writeFileSync(join(dir, 'lib', 'source.ts'), pageSource);
  writeFileSync(join(appDir, '[lang]', 'layout.tsx'), layout);
  // A static sibling segment must never be mistaken for a dynamic one.
  mkdirSync(join(appDir, 'llms.txt'), { recursive: true });
  writeFileSync(join(appDir, 'llms.txt', 'route.ts'), 'export const revalidate = false;\n');
  if (extra) {
    mkdirSync(join(appDir, extra.name), { recursive: true });
    writeFileSync(join(appDir, extra.name, 'layout.tsx'), extra.layout);
  }
  return {
    appDir,
    proxyPath: join(dir, 'proxy.ts'),
    i18nPath: join(dir, 'lib', 'i18n.ts'),
    sourcePath: join(dir, 'lib', 'source.ts'),
  };
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
    assert(
      run.stats.ogMarker === 'image.png' && run.stats.ogFinalSegmentDotted === true && run.stats.ogUrlSkipsProxy === true,
      `the clean fixture's OG card URL must be read as dotted and proxy-skipping -- got ${summarise(run.stats)}`,
    );

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

    // 9. RED -- THE ABLATION. The marker keeps its position and loses only its
    //    dot. Nothing else in the tree moves: the route still slices off the
    //    last segment, every type still checks, every page still renders. This
    //    is the whole reason the limb exists, so it is observed failing here.
    paths = writeFixture(dir, { pageSource: FIXTURE_SOURCE.replace(`'image.png'`, `'image'`) });
    run = checkApp(paths);
    assert(
      run.findings.length === 1 && /ends in `image`, which contains no dot/.test(run.findings[0]),
      `a marker that lost its dot must be reported -- got ${JSON.stringify(run.findings)}`,
    );
    assert(run.stats.ogFinalSegmentDotted === false, 'the dotless marker must be read as dotless');
    assert(run.stats.ogUrlSkipsProxy === false, 'the dotless URL must be read as one the proxy now rewrites');

    // 10. GREEN control: the marker's name is free, so a differently-named dotted marker
    //     is GREEN -- the gate must pin the dot, not the filename.
    paths = writeFixture(dir, { pageSource: FIXTURE_SOURCE.replace(`'image.png'`, `'card.jpeg'`) });
    run = checkApp(paths);
    assert(run.findings.length === 0, `a renamed but still-dotted marker must stay green -- got ${JSON.stringify(run.findings)}`);
    assert(run.stats.ogMarker === 'card.jpeg', `the renamed marker must be read back -- got ${summarise(run.stats)}`);

    // 11. RED: the marker dropped entirely -- the URL now ends in a page slug.
    paths = writeFixture(dir, { pageSource: FIXTURE_SOURCE.replace(`, 'image.png'`, '') });
    run = checkApp(paths);
    assert(
      run.findings.length === 1 && /not a\s+string literal this gate can read/.test(run.findings[0]),
      `a dropped marker must be reported, not read as absent-and-fine -- got ${JSON.stringify(run.findings)}`,
    );

    // 12. RED: the array literal is intact but no longer reaches the END of the
    //     URL, so its last element is not the final segment. Checking the
    //     literal alone here would report GREEN over a broken surface.
    paths = writeFixture(dir, {
      pageSource: FIXTURE_SOURCE.replace(`\${segments.join('/')}\``, `\${segments.join('/')}/card\``),
    });
    run = checkApp(paths);
    assert(
      run.findings.length === 1 && /no longer ENDS with/.test(run.findings[0]),
      `a url that stopped ending in the joined segments must be reported -- got ${JSON.stringify(run.findings)}`,
    );

    // 13. RED: the builder is gone. An unreadable input is never a pass.
    paths = writeFixture(dir, { pageSource: 'export function somethingElse() {}\n' });
    run = checkApp(paths);
    assert(
      run.findings.length === 1 && /no longer declares/.test(run.findings[0]),
      `a missing ${OG_BUILDER}() must be reported -- got ${JSON.stringify(run.findings)}`,
    );
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
    + 'an uncompilable matcher, an OG marker stripped of its dot, an OG marker dropped, an OG url that '
    + 'stopped ending in its segments, a missing builder -- observed FAILING, the proxy condition observed '
    + "flipping the catch-all requirement off, and the OG marker's NAME observed free while its dot is not.",
  );
}

function main() {
  const root = scriptRepoRoot();
  const { findings, stats } = checkApp({
    appDir: join(root, 'apps/docs/app'),
    proxyPath: join(root, 'apps/docs/proxy.ts'),
    i18nPath: join(root, 'apps/docs/lib/i18n.ts'),
    sourcePath: join(root, 'apps/docs/lib/source.ts'),
  });
  process.exit(report(findings, stats));
}

if (isEntrypoint(import.meta.url)) {
  if (process.argv.includes('--self-test')) selfTest();
  else main();
}
