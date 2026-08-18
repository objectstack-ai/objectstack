#!/usr/bin/env node
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// check-published-readme-links -- every outbound link in a PUBLISHED markdown
// file must be followable by the reader who is actually rendering it.
//
//   node scripts/check-published-readme-links.mjs
//   node scripts/check-published-readme-links.mjs --self-test
//
// ## The bug it exists to prevent (#9632, found while implementing #9589)
//
// A README listed in a package's `files` array with `private` unset is rendered
// on THREE surfaces: the npm package page, GitHub, and (for its content) the
// docs site. Seven links across five published service packages were spelled as
// a repo path rooted at `/`:
//
//     [Flows](/content/docs/automation/flows.mdx)
//
// That form resolves on NONE of the three. On npm a root-relative href resolves
// against `npmjs.com`; on GitHub against `github.com`; and it is not a docs-site
// route either, because `apps/docs/lib/source.ts` mounts
// `loader({ baseUrl: '/docs' })` over `content/docs` -- the route is
// `/docs/automation/flows`. `apps/docs/redirects.mjs` carries no `/content`
// source to rescue it. Every target file existed. The pages were reachable; the
// links were not.
//
// Nothing read them. Measured across every candidate before this gate was
// written: `check:published-readme-exports` has the right population but reads
// FENCED CODE BLOCKS ONLY and has no notion of a link; the lychee lane
// (`.github/workflows/check-links.yml`) runs over `content/**` plus the ROOT
// `README.md` and `ARCHITECTURE.md`, never `packages/**/README.md`;
// `check:doc-anchors` takes the same two EXTRA_SOURCES; `check:adr-links` is
// scoped to `docs/adr/`; `check:docs-redirects` to the redirect table. So a
// published README could link anywhere, in any spelling, and ship to npm green.
//
// That is why this gate exists rather than a one-time correction: an npm tarball
// outlives any in-repo fix, and the reader who follows a dead link is the one
// person who cannot file a bug about it.
//
// ## Scope, with the census that set it
//
// Measured on the tree this gate landed on: 69 publishable packages, 60
// published markdown documents (52 READMEs + 8 `packages/spec` prompt files;
// `CHANGELOG.md` excluded by the shared population helper), carrying 149
// outbound link destinations in total. That number is what makes the strict
// form affordable -- at 149 links a gate can assert per link without a
// baseline. The spelling census at that commit:
//
//     94  relative (../sibling, ./file.md)      -- not this gate's business
//     34  absolute, other hosts                  -- not this gate's business
//     10  fragment-only (#section)               -- not this gate's business
//      8  ROOT-RELATIVE                          -- assertion 1, all findings
//      2  relative into `content/docs`           -- lands on raw MDX source
//      1  docs.objectstack.ai                    -- assertion 2 + 3
//
// ## The three assertions, and why they are ordered by cost
//
//   1. ROOT-RELATIVE IS REJECTED OUTRIGHT. No filesystem lookup, and it cannot
//      false-positive: there is no root-relative href that is correct in a file
//      rendered off-site. This one assertion closes the whole measured defect
//      class, and it is the reason the gate is worth having even if 2 and 3 were
//      deleted tomorrow.
//
//   2. A `docs.objectstack.ai/docs/...` DESTINATION RESOLVES TO A REAL PAGE, the
//      way Fumadocs routes it. This is the anti-rot half: assertion 1 pushes
//      every author toward the absolute form, and an absolute form that 404s is
//      the next defect. It reuses `check-docs-redirects`'s `pageCandidates`
//      rather than growing a second resolver -- including that resolver's whole
//      subtlety, that a directory which EXISTS but carries no `index.mdx` is a
//      404. A URL the redirect table rescues is accepted, because the reader
//      does land on a page; `check:docs-redirects` separately guarantees every
//      redirect destination resolves.
//
//   3. A `#fragment` ON SUCH A URL NAMES A REAL HEADING ID, computed by
//      `check-doc-anchors`'s `headingIds` -- github-slugger plus the
//      `[#custom-id]` suffix, one Slugger per file so the duplicate-heading
//      counters match. A call into an existing implementation, not a second
//      slugger.
//
// Deliberately NOT asserted: whether a relative link resolves (that is a
// different claim, owned by nothing here yet, and `../../../content/docs/x.mdx`
// is *followable* -- it just lands on raw MDX source), and whether an external
// URL is alive (that is lychee's job and it needs the network).
//
// ## Why fenced blocks and code spans are stripped first
//
// A markdown link inside a code fence is example text, not a link. This gate
// reads PROSE ONLY -- the exact inverse of `check:published-readme-exports`,
// which reads fences only, and for the same reason: each reads the region where
// its subject actually lives. The stripping is not re-derived; it is
// `check-adr-links`'s `stripFencedBlocks` + `stripCodeSpans`, already shared
// with `check-doc-anchors`, so all three gates read a document the same way.
//
// ## No baseline, deliberately
//
// The census is 149 links and the strict assertion has a finite, small
// population, so there is nothing to amortise. A baseline here would only be a
// mute button, and a muted gate still reads as coverage.

import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { stripCodeSpans, stripFencedBlocks } from './check-adr-links.mjs';
import { headingIds } from './check-doc-anchors.mjs';
import { docsRelative, firstMatchingSource, pageCandidates } from './check-docs-redirects.mjs';
import { publishedDocs } from './check-published-readme-exports.mjs';

const ROOT = resolve(import.meta.dirname, '..');
const SELF = 'scripts/check-published-readme-links.mjs';
const CONTENT_ROOT = join(ROOT, 'content/docs');
const REDIRECTS_FILE = join(ROOT, 'apps/docs/redirects.mjs');

/** The canonical published-docs origin. `www.` accepted; nothing else is this host. */
const DOCS_HOSTS = new Set(['docs.objectstack.ai', 'www.docs.objectstack.ai']);

/** The route prefix `apps/docs/lib/source.ts` mounts `content/docs` under. */
const DOCS_BASE = '/docs';

// ---------------------------------------------------------------------------
// Pure extraction -- offline-testable, and --self-test pins each shape.
// ---------------------------------------------------------------------------

/** `[text](dest)` / `![alt](dest)`, with an optional "title". Same shape as the sibling gates. */
const INLINE_LINK = /!?\[[^\]]*]\(\s*(<[^>\n]*>|[^)\s]*?)(?:\s+(?:"[^"]*"|'[^']*'|\([^)]*\)))?\s*\)/g;

/** `[label]: dest` at the start of a line -- the reference-definition form. */
const REFERENCE_DEFINITION = /^ {0,3}\[[^\]]+]:\s*(<[^>\n]*>|\S+)/;

/**
 * Every outbound link destination in one markdown document, with the 1-based
 * line it was written on.
 *
 * Fenced blocks and code spans are removed first -- that is the whole
 * discrimination mechanism, and both strippers preserve newlines so the line
 * number points at what a human will look at.
 *
 * @param {string} markdown
 * @returns {{ line: number, dest: string }[]}
 */
export function extractLinks(markdown) {
  const prose = stripCodeSpans(stripFencedBlocks(markdown));
  const found = [];
  prose.split('\n').forEach((line, idx) => {
    const dests = [];
    INLINE_LINK.lastIndex = 0;
    let m;
    while ((m = INLINE_LINK.exec(line)) !== null) dests.push(m[1]);
    const ref = REFERENCE_DEFINITION.exec(line);
    if (ref) dests.push(ref[1]);
    for (const raw of dests) {
      // CommonMark's pointy-bracket destination: `[x](<a b>)`.
      const dest = raw.startsWith('<') && raw.endsWith('>') ? raw.slice(1, -1) : raw;
      if (dest.trim() === '') continue;
      found.push({ line: idx + 1, dest: dest.trim() });
    }
  });
  return found;
}

/**
 * Classify one destination into the bucket that decides which assertions apply.
 *
 * `root-relative` is the finding class. `docs-site` is the resolvable class.
 * Everything else is out of scope BY NAME rather than by falling through, so
 * the census can show that the scan saw them.
 *
 * @param {string} dest
 * @returns {'root-relative'|'docs-site'|'docs-host-other'|'external'|'protocol-relative'|'fragment'|'relative'}
 */
export function classify(dest) {
  if (dest.startsWith('#')) return 'fragment';
  if (dest.startsWith('//')) return 'protocol-relative';
  if (dest.startsWith('/')) return 'root-relative';
  if (!/^[a-z][a-z0-9+.-]*:/i.test(dest)) return 'relative';
  let url;
  try {
    url = new URL(dest);
  } catch {
    return 'external'; // `mailto:`, and anything else WHATWG will not parse
  }
  if (!DOCS_HOSTS.has(url.hostname.toLowerCase())) return 'external';
  return docsRelative(url.pathname) === null ? 'docs-host-other' : 'docs-site';
}

/**
 * The absolute URL a root-relative docs destination should have been written as.
 *
 * Both dead spellings map mechanically: `/content/docs/a/b.mdx` and `/docs/a/b`
 * are the same page. `index` and the page extensions are dropped because the
 * route carries neither. Returns null when the destination is not a docs path at
 * all -- there the remedy is a judgment, and the message says so instead of
 * inventing a URL.
 *
 * @param {string} dest
 * @returns {string|null}
 */
export function absoluteRemedy(dest) {
  const [pathOnly, ...rest] = dest.split('#');
  const suffix = rest.length > 0 ? `#${rest.join('#')}` : '';
  let route = null;
  if (pathOnly === '/content/docs' || pathOnly.startsWith('/content/docs/')) {
    route = pathOnly.slice('/content/docs'.length);
  } else if (pathOnly === DOCS_BASE || pathOnly.startsWith(`${DOCS_BASE}/`)) {
    route = pathOnly.slice(DOCS_BASE.length);
  }
  if (route === null) return null;
  route = route.replace(/\.(mdx|md)$/, '').replace(/\/index$/, '').replace(/\/+$/, '');
  return `https://docs.objectstack.ai${DOCS_BASE}${route}${suffix}`;
}

// ---------------------------------------------------------------------------
// Resolution -- the two assertions that read the content tree.
// ---------------------------------------------------------------------------

/**
 * The `content/docs`-relative file Fumadocs would serve a `/docs/...` URL from,
 * or null when nothing would.
 *
 * `pageCandidates` is `check-docs-redirects`'s, not a second walk: `x.mdx`,
 * `x.md`, `x/index.mdx`, `x/index.md`, in that order. A directory that exists
 * but carries no index page is a 404, and this returns null for it.
 *
 * @param {string} contentRoot
 * @param {string} pathname
 * @returns {string|null}
 */
export function resolveDocsPage(contentRoot, pathname) {
  const relative = docsRelative(pathname);
  if (relative === null) return null;
  for (const candidate of pageCandidates(relative)) {
    if (existsSync(join(contentRoot, candidate))) return candidate;
  }
  return null;
}

/**
 * @typedef {{ kind: string, file: string, line: number, dest: string, detail: string }} Finding
 */

/**
 * Run all three assertions over one document.
 *
 * @param {{ file: string, text: string, contentRoot: string, table: [string, string][] }} options
 * @returns {{ findings: Finding[], stats: Record<string, number> }}
 */
export function checkDocument({ file, text, contentRoot, table }) {
  /** @type {Finding[]} */
  const findings = [];
  const stats = {
    links: 0,
    'root-relative': 0,
    'docs-site': 0,
    'docs-host-other': 0,
    external: 0,
    'protocol-relative': 0,
    fragment: 0,
    relative: 0,
    resolved: 0,
    redirected: 0,
    fragments: 0,
  };

  for (const { line, dest } of extractLinks(text)) {
    stats.links++;
    const kind = classify(dest);
    stats[kind]++;
    const add = (k, detail) => findings.push({ kind: k, file, line, dest, detail });

    // ── 1. root-relative: dead on npm and on GitHub, always ──────────────
    if (kind === 'root-relative') {
      const remedy = absoluteRemedy(dest);
      add(
        'root-relative',
        remedy
          ? `is root-relative. This file is PUBLISHED (npm renders it against npmjs.com, `
            + `GitHub against github.com), so this href reaches the docs site on neither. `
            + `Write it absolute: ${remedy}`
          : `is root-relative. This file is PUBLISHED (npm renders it against npmjs.com, `
            + `GitHub against github.com), so this href resolves against neither host's idea `
            + `of the repo. It is not a docs path either, so there is no mechanical remedy: `
            + `link the rendered page absolutely (https://docs.objectstack.ai/docs/...) or, `
            + `for a file in this repo, use a path relative to this README.`,
      );
      continue;
    }

    if (kind !== 'docs-site') continue;

    // ── 2. the absolute docs URL has to name a page that exists ──────────
    const url = new URL(dest);
    const page = resolveDocsPage(contentRoot, url.pathname);
    if (page === null) {
      const redirect = firstMatchingSource(table, url.pathname);
      if (redirect === null) {
        add(
          'dead-page',
          `points at ${url.pathname}, which Fumadocs serves from none of `
            + `${pageCandidates(docsRelative(url.pathname))
              .map((c) => `content/docs/${c}`)
              .join(', ')} — and apps/docs/redirects.mjs has no source matching it. `
            + `A directory with no index page is a 404, not a section.`,
        );
        continue;
      }
      // Followable via a hop; check:docs-redirects owns the destination's health.
      stats.redirected++;
      continue;
    }
    stats.resolved++;

    // ── 3. the fragment, if any, has to name a heading the page renders ──
    const fragment = decodeURIComponent(url.hash.replace(/^#/, ''));
    if (fragment === '') continue;
    stats.fragments++;
    const ids = headingIds(readFileSync(join(contentRoot, page), 'utf8'));
    if (!ids.includes(fragment)) {
      const near = ids.filter((id) => id.startsWith(fragment.slice(0, 8))).slice(0, 3);
      add(
        'dead-anchor',
        `names #${fragment}, which content/docs/${page} does not render. `
          + (near.length > 0
            ? `Closest heading ids: ${near.map((id) => `#${id}`).join(', ')}.`
            : `That page renders ${ids.length} heading id(s).`),
      );
    }
  }

  return { findings, stats };
}

// ---------------------------------------------------------------------------
// Reporting
// ---------------------------------------------------------------------------

function report(findings, stats, population) {
  if (findings.length === 0) {
    console.log(
      `✓ check:published-readme-links — ${stats.links} outbound link(s) across `
        + `${population} published markdown file(s): 0 root-relative, `
        + `${stats.resolved} docs.objectstack.ai page(s) resolved `
        + `(${stats.redirected} via redirect), ${stats.fragments} anchor(s) verified.`,
    );
    return 0;
  }
  console.error(`✗ check:published-readme-links — ${findings.length} finding(s)\n`);
  for (const f of findings) {
    console.error(`  ${f.file}:${f.line}`);
    console.error(`    [${f.kind}] ${f.dest}`);
    console.error(`      ${f.detail}\n`);
  }
  console.error(
    'A PUBLISHED markdown file (in its package `files` array, `private` unset) is rendered on\n'
      + 'npm and on GitHub as well as here. The only link form that works on all three is the\n'
      + 'absolute one: https://docs.objectstack.ai/docs/<path under content/docs, no extension>.\n'
      + 'There is NO baseline for this gate — the fix is the link.',
  );
  return 1;
}

async function loadRedirectTable(file) {
  const module = await import(`${resolve(file)}`);
  return module.docsRedirects;
}

async function run() {
  const { docs } = publishedDocs(SELF);
  const table = await loadRedirectTable(REDIRECTS_FILE);
  /** @type {Finding[]} */
  const findings = [];
  const totals = {};
  for (const doc of docs) {
    const { findings: f, stats } = checkDocument({
      file: doc.file,
      text: doc.text,
      contentRoot: CONTENT_ROOT,
      table,
    });
    findings.push(...f);
    for (const [k, v] of Object.entries(stats)) totals[k] = (totals[k] ?? 0) + v;
  }
  // A scan that matched nothing is green and indistinguishable from a clean
  // tree (#4690). The population helper already refuses an empty doc set; this
  // refuses an empty LINK set, which is the failure specific to this gate.
  if (!totals.links) {
    throw new Error(
      `${SELF}: read ${docs.length} published document(s) and found NO links at all. `
        + 'The extractor matched nothing — that is a broken scanner, not a clean tree.',
    );
  }
  return report(findings, totals, docs.length);
}

// ---------------------------------------------------------------------------
// Self-test: every limb observed FAILING and observed SILENT.
// ---------------------------------------------------------------------------

function selfTest() {
  const failures = [];
  const ok = (label, cond) => {
    if (!cond) failures.push(label);
  };

  // A fixture content tree, described rather than written: `resolveDocsPage`
  // only ever asks `existsSync`, so the fixture is the set of paths that exist.
  const FIXTURE_PAGES = new Set([
    'automation/flows.mdx',
    'automation/index.mdx',
    'legacy-md-page.md',
    'section/index.md',
    'anchors.mdx',
  ]);
  const fixtureResolve = (pathname) => {
    const relative = docsRelative(pathname);
    if (relative === null) return null;
    for (const candidate of pageCandidates(relative)) {
      if (FIXTURE_PAGES.has(candidate)) return candidate;
    }
    return null;
  };

  // ---- extractLinks: discrimination -------------------------------------
  const doc = [
    'Prose [a](/content/docs/x.mdx) here.',
    '',
    '```ts',
    'const s = "[fenced](/content/docs/never.mdx)";',
    '```',
    '',
    'A code span `[spanned](/content/docs/never.mdx)` is not a link.',
    '',
    '[ref]: /content/docs/refdef.mdx',
    '',
    'Pointy [b](</content/docs/spaced page.mdx>) form.',
    'Titled [c](/content/docs/titled.mdx "A title") form.',
    '![img](/content/docs/pic.png)',
  ].join('\n');
  const links = extractLinks(doc);
  const dests = links.map((l) => l.dest);
  ok('extractLinks reads an inline link', dests.includes('/content/docs/x.mdx'));
  ok('extractLinks SKIPS a link inside a fenced block', !dests.includes('/content/docs/never.mdx'));
  ok('extractLinks reads a reference definition', dests.includes('/content/docs/refdef.mdx'));
  ok('extractLinks unwraps a pointy-bracket destination', dests.includes('/content/docs/spaced page.mdx'));
  ok('extractLinks drops a link title', dests.includes('/content/docs/titled.mdx'));
  ok('extractLinks reads an image destination', dests.includes('/content/docs/pic.png'));
  ok('extractLinks reports the real line number', links.find((l) => l.dest === '/content/docs/x.mdx')?.line === 1);
  // Five, not seven: the fenced one and the code-spanned one are the discrimination.
  ok('extractLinks finds exactly the five PROSE destinations', links.length === 5);

  // ---- classify: every bucket, both directions --------------------------
  ok('classify: root-relative', classify('/content/docs/a.mdx') === 'root-relative');
  ok('classify: root-relative (site route)', classify('/docs/a') === 'root-relative');
  ok('classify: relative is NOT root-relative', classify('../../spec/src/automation/') === 'relative');
  ok('classify: bare fragment', classify('#see-also') === 'fragment');
  ok('classify: protocol-relative is not root-relative', classify('//example.com/x') === 'protocol-relative');
  ok('classify: docs site', classify('https://docs.objectstack.ai/docs/automation/flows') === 'docs-site');
  ok('classify: docs site (www)', classify('https://www.docs.objectstack.ai/docs/a') === 'docs-site');
  ok('classify: docs host outside /docs', classify('https://docs.objectstack.ai/blog/x') === 'docs-host-other');
  ok('classify: another host', classify('https://github.com/infiniflow/ragflow') === 'external');
  ok('classify: mailto', classify('mailto:hi@objectstack.ai') === 'external');

  // ---- absoluteRemedy: both dead spellings, and the refusal -------------
  ok(
    'remedy: /content/docs/*.mdx -> absolute route',
    absoluteRemedy('/content/docs/automation/flows.mdx')
      === 'https://docs.objectstack.ai/docs/automation/flows',
  );
  ok(
    'remedy: trailing-slash directory -> bare route',
    absoluteRemedy('/content/docs/automation/') === 'https://docs.objectstack.ai/docs/automation',
  );
  ok(
    'remedy: site-root-relative -> absolute, fragment preserved',
    absoluteRemedy('/docs/permissions/permission-sets#access-depth')
      === 'https://docs.objectstack.ai/docs/permissions/permission-sets#access-depth',
  );
  ok(
    'remedy: an explicit /index is dropped, the route carries none',
    absoluteRemedy('/content/docs/automation/index.mdx')
      === 'https://docs.objectstack.ai/docs/automation',
  );
  ok('remedy: REFUSED for a non-docs root path', absoluteRemedy('/LICENSING.md') === null);

  // ---- resolveDocsPage: the pageCandidates subtlety ---------------------
  ok('resolve: a page file', fixtureResolve('/docs/automation/flows') === 'automation/flows.mdx');
  ok('resolve: a directory WITH an index', fixtureResolve('/docs/automation') === 'automation/index.mdx');
  ok('resolve: the .md extension too', fixtureResolve('/docs/legacy-md-page') === 'legacy-md-page.md');
  ok('resolve: index.md as well as index.mdx', fixtureResolve('/docs/section') === 'section/index.md');
  ok('resolve: a directory with NO index is a 404', fixtureResolve('/docs/references') === null);
  ok('resolve: a page that does not exist', fixtureResolve('/docs/automation/nope') === null);
  ok('resolve: a non-/docs path is not this gate\'s', fixtureResolve('/blog/x') === null);

  // ---- checkDocument, against a real temp tree --------------------------
  // The resolution limbs read the filesystem, so they are exercised against the
  // REAL content root with links known to exist / not exist there. Using the
  // real tree keeps the self-test honest about the resolver it actually ships.
  const table = [['/docs/guides/:path*', '/docs']];
  const runDoc = (text) =>
    checkDocument({ file: 'fixture/README.md', text, contentRoot: CONTENT_ROOT, table });

  // Assertion 1 -- observed FAILING, then observed SILENT.
  const a1 = runDoc('See [Flows](/content/docs/automation/flows.mdx).');
  ok('A1 FAILS on a root-relative destination', a1.findings.length === 1 && a1.findings[0].kind === 'root-relative');
  ok(
    'A1 failure carries the absolute remedy',
    a1.findings[0]?.detail.includes('https://docs.objectstack.ai/docs/automation/flows'),
  );
  const a1clean = runDoc('See [Flows](https://docs.objectstack.ai/docs/automation/flows).');
  ok('A1 SILENT on the absolute form', a1clean.findings.length === 0);
  ok('A1 SILENT on a relative link', runDoc('See [spec](../../spec/src/).').findings.length === 0);
  ok('A1 SILENT on an external URL', runDoc('See [x](https://github.com/o/r).').findings.length === 0);
  ok('A1 SILENT on a bare fragment', runDoc('See [x](#see-also).').findings.length === 0);
  ok(
    'A1 SILENT on a root-relative link inside a fence',
    runDoc('```md\n[x](/content/docs/a.mdx)\n```').findings.length === 0,
  );

  // Assertion 2 -- observed FAILING, then observed SILENT.
  const a2 = runDoc('See [Nope](https://docs.objectstack.ai/docs/automation/no-such-page).');
  ok('A2 FAILS on a docs URL with no page', a2.findings.length === 1 && a2.findings[0].kind === 'dead-page');
  ok('A2 failure names the candidates it tried', a2.findings[0]?.detail.includes('content/docs/automation/no-such-page.mdx'));
  ok('A2 SILENT on a docs URL that resolves', a1clean.stats.resolved === 1);
  const a2dir = runDoc('See [Automation](https://docs.objectstack.ai/docs/automation).');
  ok('A2 SILENT on a directory WITH an index page', a2dir.findings.length === 0 && a2dir.stats.resolved === 1);
  const a2redirect = runDoc('See [Old](https://docs.objectstack.ai/docs/guides/business-logic).');
  ok('A2 SILENT when the redirect table rescues the URL', a2redirect.findings.length === 0);
  ok('A2 counts a rescued URL as redirected, not resolved', a2redirect.stats.redirected === 1);
  ok(
    'A2 SILENT on the docs host outside /docs',
    runDoc('See [Blog](https://docs.objectstack.ai/blog/hello).').findings.length === 0,
  );

  // Assertion 3 -- observed FAILING, then observed SILENT.
  const anchorPage = 'content/docs/automation/flows.mdx';
  const realIds = headingIds(readFileSync(join(ROOT, anchorPage), 'utf8'));
  if (realIds.length === 0) {
    failures.push(`${anchorPage} renders no heading ids — the A3 fixture has rotted`);
  } else {
    const good = runDoc(`See [Flows](https://docs.objectstack.ai/docs/automation/flows#${realIds[0]}).`);
    ok('A3 SILENT on a fragment that names a real heading', good.findings.length === 0);
    ok('A3 counted the anchor it verified', good.stats.fragments === 1);
    const bad = runDoc(
      'See [Flows](https://docs.objectstack.ai/docs/automation/flows#no-such-heading-anywhere).',
    );
    ok('A3 FAILS on a fragment naming no heading', bad.findings.length === 1 && bad.findings[0].kind === 'dead-anchor');
    ok('A3 failure names the page it read', bad.findings[0]?.detail.includes(anchorPage));
  }

  // ---- the empty-scan guard is real, not decorative ---------------------
  const empty = runDoc('No links here at all.\n\n```ts\nconst x = 1;\n```\n');
  ok('a document with no links yields no findings and no links', empty.stats.links === 0 && empty.findings.length === 0);

  if (failures.length > 0) {
    console.error(`✗ check:published-readme-links --self-test — ${failures.length} failure(s)\n`);
    for (const f of failures) console.error(`  ${f}`);
    process.exit(1);
  }
  console.log(
    '✓ check:published-readme-links --self-test — extraction discrimination (fence, code span,\n'
      + '  ref-def, pointy brackets, titles), all seven classify buckets, the remedy builder and its\n'
      + '  refusal, the pageCandidates directory/index subtlety, and all three assertions observed\n'
      + '  both FAILING and SILENT.',
  );
}

/* Run only when invoked as a program — the extractor, the classifier and the
 * resolvers are exported so a caller chasing a false positive can import them
 * without the import itself sweeping the workspace. */
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.includes('--self-test')) {
    selfTest();
    process.exit(0);
  }
  try {
    process.exit(await run());
  } catch (err) {
    console.error(`✗ check:published-readme-links — ${err.message}`);
    process.exit(1);
  }
}
