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
//      1  docs.objectstack.ai                    -- assertions 3 + 4
//
// ## The four assertions, and why they are ordered by cost
//
//   1. ROOT-RELATIVE IS REJECTED OUTRIGHT. No filesystem lookup, and it cannot
//      false-positive: there is no root-relative href that is correct in a file
//      rendered off-site. This one assertion closes the whole measured defect
//      class, and it is the reason the gate is worth having even if the rest
//      were deleted tomorrow.
//
//   2. THE ORIGIN IS THE RULED CANONICAL ONE. Also no I/O -- a string compare
//      against `CANONICAL_DOCS_ORIGIN`. This is a CONVENTION claim, not a
//      reachability one; the section below explains why that distinction is
//      what shapes the whole host handling here.
//
//   3. A DOCS-SITE DESTINATION RESOLVES TO A REAL PAGE, the way Fumadocs
//      routes it. This is the anti-rot half: assertion 1 pushes every author
//      toward the absolute form, and an absolute form that 404s is the next
//      defect. It reuses `check-docs-redirects`'s `pageCandidates`
//      rather than growing a second resolver -- including that resolver's whole
//      subtlety, that a directory which EXISTS but carries no `index.mdx` is a
//      404. A URL the redirect table rescues is accepted, because the reader
//      does land on a page; `check:docs-redirects` separately guarantees every
//      redirect destination resolves.
//
//   4. A `#fragment` ON SUCH A URL NAMES A REAL HEADING ID, computed by
//      `check-doc-anchors`'s `headingIds` -- github-slugger plus the
//      `[#custom-id]` suffix, one Slugger per file so the duplicate-heading
//      counters match. A call into an existing implementation, not a second
//      slugger.
//
// ## The host split: the classifier ACCEPTS more than the remedy PRESCRIBES
//
// Maintainer ruling, 2026-08-21, verbatim and untranslated:
//
//     「这个仓的文档站规范 URL 是 https://objectstack.ai」
//
// The tree named three hosts for one site before that ruling was applied:
// `content/docs.site.json` declared `protocol.objectstack.ai`, this gate
// prescribed `docs.objectstack.ai`, and the root README already used the apex.
// The aliases are not separate deployments -- the apex was made primary in
// July, with `www` and `docs` answering 30x to it path-preservingly (that is
// the commit message of the PR that moved the prominent links, and it is the
// only evidence available here: this gate must run with no network, so it
// cannot and does not probe a host).
//
// That is why the two halves are deliberately NOT symmetric:
//
//   * `DOCS_HOSTS` -- what the CLASSIFIER accepts -- carries the canonical host
//     AND the redirecting aliases. Dropping an alias from this set does not
//     reject it; it reclassifies it as `external`, which is out of scope BY
//     NAME, so assertions 3 and 4 stop reading it. Tightening here would
//     therefore DELETE the page and anchor checks from exactly the URLs most
//     likely to rot -- links already shipped inside npm tarballs, which outlive
//     any in-repo fix. Accepting an alias costs nothing and keeps it verified.
//
//   * `CANONICAL_DOCS_ORIGIN` -- what the REMEDY PRESCRIBES, and what assertion
//     2 requires -- is the ruled origin, alone. A remedy that prescribes one
//     host while the classifier silently accepts another is the state this
//     split exists to avoid: authors would keep writing whatever they found in
//     a neighbouring file, and the gate would keep agreeing with all of it.
//
// So an alias URL is *accepted for checking* and *rejected for authoring*. It
// is followable, and it is still a finding, and those two facts do not
// conflict -- which is exactly why assertion 2 is documented as a convention
// claim rather than folded in with the reachability ones.
//
// This gate prescribed `docs.objectstack.ai` when it landed on 2026-08-18, and
// authors followed it: the census below counted ONE such link at that commit
// and twelve by 2026-08-21. A gate that prescribes is a gate that propagates,
// so the prescription has to be the ruled one.
//
// Deliberately NOT asserted: whether a relative link resolves (that is a
// different claim, owned by nothing here yet, and `../../../content/docs/x.mdx`
// is *followable* -- it just lands on raw MDX source), and whether an external
// URL is alive (that is lychee's job and it needs the network).
//
// ## The three link shapes read, and the one that only looks like a fourth
//
// The header above claims "every outbound link in a PUBLISHED markdown file",
// so the extractor owes that population every shape a reader can actually
// follow. Three of them:
//
//   * INLINE_LINK           `[text](dest)`, `![alt](dest)`, title optional
//   * REFERENCE_DEFINITION  `[label]: dest` at the head of a line
//   * AUTOLINK              a bare absolute URI wrapped in angle brackets
//
// The autolink was missing for this gate's first three days, and the hole was
// not academic: 13 docs-site links across 6 published READMEs sat in it,
// every one of them in the "Docs" / "API Reference" footer -- the most
// prominent link position these files have. All 13 resolved, so nothing was
// broken through it; what was broken was the population. A 404 written in that
// form was read by NONE of the four assertions and shipped to npm green.
//
// The shape that only looks like a fourth is the pointy-bracket DESTINATION,
// `[text](<dest>)` -- angle brackets INSIDE an inline link's parentheses, which
// is how CommonMark spells a destination containing a space. That is not an
// autolink and never was; `INLINE_LINK`'s own `(<...>|...)` alternative has
// always read it. The two are distinguished POSITIONALLY here: `extractLinks`
// records the span each link construct consumed and refuses an autolink match
// that starts inside one. Without that, `[d](<https://objectstack.ai/docs/x>)`
// -- a pointy destination that happens to contain no space, and so is a
// well-formed autolink body too -- would be counted twice, and the census this
// gate prints would over-report by one per occurrence. The `--self-test` pins
// the count, not just the presence, for exactly that reason.
//
// Deliberately NOT matched: CommonMark's EMAIL autolink, the address-shaped
// `<foo@example.com>` with no scheme. It renders as a `mailto:` link, so it is
// a link -- but it can never be a docs-site URL, so every assertion here would
// classify it `external` and read no further. Matching it would widen the
// recognizer and change no verdict. The scheme'd `<mailto:foo@example.com>`
// form IS matched, because it costs nothing to fold into the URI pattern, and
// it too classifies `external`; a pin holds that so a later reader does not
// have to re-derive which of the two is in.
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

import { stripCodeSpans, stripFencedBlocks } from './check-adr-links.mjs';
import { headingIds } from './check-doc-anchors.mjs';
import { docsRelative, firstMatchingSource, pageCandidates } from './check-docs-redirects.mjs';
import { publishedDocs } from './check-published-readme-exports.mjs';
import { isEntrypoint } from './invoked-as.mjs';

const ROOT = resolve(import.meta.dirname, '..');
const SELF = 'scripts/check-published-readme-links.mjs';
const CONTENT_ROOT = join(ROOT, 'content/docs');
const REDIRECTS_FILE = join(ROOT, 'apps/docs/redirects.mjs');

/**
 * The one origin an author may write, ruled by the maintainer on 2026-08-21.
 * Assertion 2 requires it and every remedy string is built from it -- so the
 * prescription cannot drift from the classifier by being edited in one place.
 */
export const CANONICAL_DOCS_ORIGIN = 'https://objectstack.ai';

/**
 * Every hostname that NAMES this docs site, canonical and alias alike.
 *
 * Membership decides only whether assertions 2-4 read a URL at all; it is not
 * approval of the spelling (assertion 2 is). The aliases 30x to the apex
 * path-preservingly, so a link written on one is followable and its page and
 * anchor are worth verifying -- see the host-split section in the header for
 * why removing one from this set would silently *reduce* coverage.
 */
const DOCS_HOSTS = new Set([
  'objectstack.ai',
  'www.objectstack.ai',
  'docs.objectstack.ai',
  'www.docs.objectstack.ai',
  'protocol.objectstack.ai',
  'www.protocol.objectstack.ai',
]);

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
 * CommonMark's URI autolink: a bare absolute URI in angle brackets, rendered as
 * a live link by GitHub and by npm alike.
 *
 * Transcribed from the CommonMark scheme production rather than approximated: 2
 * to 32 characters, opening with an ASCII letter, continuing with letters,
 * digits, `+`, `.` or `-`; then a colon; then any run of characters that are
 * not ASCII control, space, or either angle bracket. The final class is what
 * keeps the pattern honest about the shapes it must NOT claim -- `<not a url>`
 * carries a space and no scheme, and an HTML tag like `<br>` has no colon, so
 * neither can match. Both are pinned.
 *
 * The absent `g`-flag twin of the pointy-destination question above: this one
 * IS global, and `extractLinks` filters its matches by span rather than by
 * pattern, because a pointy destination and an autolink are genuinely the same
 * characters in different positions -- no regex reading one line at a time can
 * separate them, and a lookbehind that tried would be guessing at nesting.
 */
const AUTOLINK = /<([A-Za-z][A-Za-z0-9+.-]{1,31}:[^<>\x00-\x20]*)>/g;

/**
 * Every outbound link destination in one markdown document, with the 1-based
 * line it was written on.
 *
 * Fenced blocks and code spans are removed first -- that is the whole
 * discrimination mechanism, and both strippers preserve newlines so the line
 * number points at what a human will look at.
 *
 * Autolinks are matched LAST and filtered by span, because the two bracketed
 * forms are the same characters in different positions: the angle brackets of
 * `[d](<https://x/y>)` belong to the inline link that already claimed them, and
 * counting them again would inflate the census by one per occurrence. So each
 * link construct records the range it consumed, and an autolink starting inside
 * one is dropped rather than re-read.
 *
 * @param {string} markdown
 * @returns {{ line: number, dest: string }[]}
 */
export function extractLinks(markdown) {
  const prose = stripCodeSpans(stripFencedBlocks(markdown));
  const found = [];
  prose.split('\n').forEach((line, idx) => {
    const dests = [];
    /** @type {[number, number][]} half-open spans already claimed on this line */
    const claimed = [];
    INLINE_LINK.lastIndex = 0;
    let m;
    while ((m = INLINE_LINK.exec(line)) !== null) {
      dests.push(m[1]);
      claimed.push([m.index, m.index + m[0].length]);
    }
    const ref = REFERENCE_DEFINITION.exec(line);
    if (ref) {
      dests.push(ref[1]);
      claimed.push([ref.index, ref.index + ref[0].length]);
    }
    AUTOLINK.lastIndex = 0;
    while ((m = AUTOLINK.exec(line)) !== null) {
      if (claimed.some(([start, end]) => m.index >= start && m.index < end)) continue;
      dests.push(m[1]);
    }
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
  return `${CANONICAL_DOCS_ORIGIN}${DOCS_BASE}${route}${suffix}`;
}

/**
 * The canonical spelling of a destination already on one of `DOCS_HOSTS`, or
 * null when it is already canonical (or is not this site's URL at all).
 *
 * Compares ORIGIN, not hostname: the ruling names a URL, so `http://` on the
 * canonical host is a non-canonical origin too, and the rewrite fixes the
 * scheme in the same move. Path, query and fragment are carried across
 * untouched -- the aliases redirect path-preservingly, so the canonical URL of
 * a given page differs from the alias one in the origin and nothing else.
 *
 * @param {string} dest
 * @returns {string|null}
 */
export function canonicalDocsUrl(dest) {
  let url;
  try {
    url = new URL(dest);
  } catch {
    return null;
  }
  if (!DOCS_HOSTS.has(url.hostname.toLowerCase())) return null;
  if (url.origin === CANONICAL_DOCS_ORIGIN) return null;
  return `${CANONICAL_DOCS_ORIGIN}${url.pathname}${url.search}${url.hash}`;
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
    'non-canonical': 0,
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
            + `link the rendered page absolutely (${CANONICAL_DOCS_ORIGIN}${DOCS_BASE}/...) or, `
            + `for a file in this repo, use a path relative to this README.`,
      );
      continue;
    }

    if (kind !== 'docs-site') continue;

    const url = new URL(dest);

    // ── 2. the origin has to be the ruled one ────────────────────────────
    // NOT a reachability claim: the aliases 30x here. It is the convention
    // claim, and it does NOT `continue` -- a link can be both off-convention
    // and dead, and the author needs to be told both in one run.
    const canonical = canonicalDocsUrl(dest);
    if (canonical !== null) {
      stats['non-canonical']++;
      add(
        'non-canonical-host',
        `is written on ${url.origin}, which is not this repo's canonical docs origin. `
          + `Maintainer ruling, 2026-08-21: 「这个仓的文档站规范 URL 是 ${CANONICAL_DOCS_ORIGIN}」. `
          + `The alias does redirect here, so the link is followable — it is the spelling that `
          + `is wrong, and every README copied from this one inherits it. Write: ${canonical}`,
      );
    }

    // ── 3. the absolute docs URL has to name a page that exists ──────────
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

    // ── 4. the fragment, if any, has to name a heading the page renders ──
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
        + `0 non-canonical origin(s), ${stats.resolved} docs-site page(s) resolved `
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
      + `absolute one, on the canonical origin:\n`
      + `  ${CANONICAL_DOCS_ORIGIN}${DOCS_BASE}/<path under content/docs, no extension>\n`
      + 'An alias host (docs. / protocol. / www.) redirects here, so such a link is followable —\n'
      + 'but it is still a finding: the spelling propagates by copy, which is how this gate\n'
      + 'grew twelve of them in three days while prescribing one of the aliases itself.\n'
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
    'const t = "<https://objectstack.ai/docs/never-fenced>";',
    '```',
    '',
    'A code span `[spanned](/content/docs/never.mdx)` is not a link.',
    'A code span `<https://objectstack.ai/docs/never-spanned>` is not one either.',
    '',
    '[ref]: /content/docs/refdef.mdx',
    '',
    'Pointy [b](</content/docs/spaced page.mdx>) form.',
    'Titled [c](/content/docs/titled.mdx "A title") form.',
    '![img](/content/docs/pic.png)',
    '',
    'Bare autolink <https://objectstack.ai/docs/autolinked> in prose.',
    'Mail <mailto:hi@objectstack.ai> too.',
    // The double-count trap: a pointy DESTINATION whose body is also a
    // well-formed autolink, because it happens to contain no space.
    'Pointy [d](<https://objectstack.ai/docs/pointy-no-space>) form.',
    // Angle brackets that are not links at all.
    'Not <not a url> and not <br> and not <a href="https://x.ai">tagged</a>.',
    'And not the address-shaped <foo@example.com> either.',
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

  // ---- extractLinks: the CommonMark autolink ----------------------------
  // The shape this gate could not see for its first three days. Every one of
  // the 13 it was blind to sat in a published README's "Docs" footer, so the
  // ACCEPT pins below are the population and the REJECT pins are the price:
  // widening a recognizer is only safe if what it newly claims is exactly the
  // links and nothing else that wears angle brackets.
  ok('extractLinks reads a bare autolink', dests.includes('https://objectstack.ai/docs/autolinked'));
  ok('extractLinks reads a mailto autolink', dests.includes('mailto:hi@objectstack.ai'));
  ok(
    'extractLinks reports the real line number for an autolink',
    links.find((l) => l.dest === 'https://objectstack.ai/docs/autolinked')?.line === 17,
  );
  ok(
    'extractLinks SKIPS an autolink inside a fenced block',
    !dests.includes('https://objectstack.ai/docs/never-fenced'),
  );
  ok(
    'extractLinks SKIPS an autolink inside a code span',
    !dests.includes('https://objectstack.ai/docs/never-spanned'),
  );
  // The reject side, one pin per shape that wears the brackets without being a
  // link: no scheme, no colon, a tag with attributes, and the address-shaped
  // EMAIL autolink this recognizer deliberately leaves out (see the header).
  ok('extractLinks does NOT match angle-bracketed prose', !dests.some((d) => d.includes('not a url')));
  ok('extractLinks does NOT match an HTML tag', !dests.some((d) => d === 'br' || d.startsWith('a href')));
  ok('extractLinks does NOT match a bare email autolink', !dests.includes('foo@example.com'));
  // The double-count guard, asserted as a COUNT rather than a presence: a
  // pointy-bracket destination with no space is a valid autolink body too, so
  // a span-blind recognizer reads it twice and every census this gate prints
  // inflates by one per occurrence. Presence alone cannot see that.
  ok(
    'extractLinks counts a pointy-bracket destination exactly ONCE',
    dests.filter((d) => d === 'https://objectstack.ai/docs/pointy-no-space').length === 1,
  );
  ok(
    'extractLinks still unwraps the pointy destination it always read',
    dests.includes('/content/docs/spaced page.mdx'),
  );
  // Eight, not thirteen: two fenced, two code-spanned, and the three
  // bracket-wearing non-links are the discrimination.
  ok('extractLinks finds exactly the eight PROSE destinations', links.length === 8);

  // ---- classify: every bucket, both directions --------------------------
  ok('classify: root-relative', classify('/content/docs/a.mdx') === 'root-relative');
  ok('classify: root-relative (site route)', classify('/docs/a') === 'root-relative');
  ok('classify: relative is NOT root-relative', classify('../../spec/src/automation/') === 'relative');
  ok('classify: bare fragment', classify('#see-also') === 'fragment');
  ok('classify: protocol-relative is not root-relative', classify('//example.com/x') === 'protocol-relative');
  ok('classify: docs site (canonical apex)', classify('https://objectstack.ai/docs/automation/flows') === 'docs-site');
  ok('classify: docs site (docs. alias)', classify('https://docs.objectstack.ai/docs/automation/flows') === 'docs-site');
  ok('classify: docs site (www of the alias)', classify('https://www.docs.objectstack.ai/docs/a') === 'docs-site');
  ok('classify: docs site (protocol. alias)', classify('https://protocol.objectstack.ai/docs/a') === 'docs-site');
  ok('classify: docs host outside /docs', classify('https://docs.objectstack.ai/blog/x') === 'docs-host-other');
  ok('classify: canonical host outside /docs', classify('https://objectstack.ai/pricing') === 'docs-host-other');
  ok('classify: another host', classify('https://github.com/infiniflow/ragflow') === 'external');
  ok('classify: mailto', classify('mailto:hi@objectstack.ai') === 'external');
  // The accept-wide half of the split, pinned as a claim rather than left to
  // be inferred: an alias is IN the resolvable class, so assertions 3 and 4
  // read it. Narrow this set and those two checks go silent, not strict.
  ok(
    'classify: an alias stays in the class assertions 3 and 4 read',
    ['docs.objectstack.ai', 'protocol.objectstack.ai', 'www.objectstack.ai'].every(
      (h) => classify(`https://${h}/docs/automation/flows`) === 'docs-site',
    ),
  );

  // ---- absoluteRemedy: both dead spellings, and the refusal -------------
  ok(
    'remedy: /content/docs/*.mdx -> absolute route',
    absoluteRemedy('/content/docs/automation/flows.mdx')
      === 'https://objectstack.ai/docs/automation/flows',
  );
  ok(
    'remedy: trailing-slash directory -> bare route',
    absoluteRemedy('/content/docs/automation/') === 'https://objectstack.ai/docs/automation',
  );
  ok(
    'remedy: site-root-relative -> absolute, fragment preserved',
    absoluteRemedy('/docs/permissions/permission-sets#access-depth')
      === 'https://objectstack.ai/docs/permissions/permission-sets#access-depth',
  );
  ok(
    'remedy: an explicit /index is dropped, the route carries none',
    absoluteRemedy('/content/docs/automation/index.mdx')
      === 'https://objectstack.ai/docs/automation',
  );
  ok('remedy: REFUSED for a non-docs root path', absoluteRemedy('/LICENSING.md') === null);
  // The prescribe-narrow half: every remedy this gate emits names the ruled
  // origin and no alias. Asserted over the builder's whole output rather than
  // one sample, so an alias cannot come back through a branch nobody sampled.
  ok(
    'remedy: NEVER prescribes an alias host',
    ['/content/docs/a.mdx', '/content/docs/a/', '/docs/a#b', '/content/docs/a/index.mdx'].every(
      (d) => absoluteRemedy(d)?.startsWith('https://objectstack.ai/docs/'),
    ),
  );

  // ---- canonicalDocsUrl: the host swap, both directions -----------------
  ok(
    'canonical: an alias is rewritten, path and fragment carried',
    canonicalDocsUrl('https://docs.objectstack.ai/docs/a/b#c')
      === 'https://objectstack.ai/docs/a/b#c',
  );
  ok(
    'canonical: the OTHER alias too',
    canonicalDocsUrl('https://protocol.objectstack.ai/docs/a') === 'https://objectstack.ai/docs/a',
  );
  ok(
    'canonical: a query string survives',
    canonicalDocsUrl('https://docs.objectstack.ai/docs/a?q=1') === 'https://objectstack.ai/docs/a?q=1',
  );
  ok(
    'canonical: compares ORIGIN, so http on the canonical host is rewritten',
    canonicalDocsUrl('http://objectstack.ai/docs/a') === 'https://objectstack.ai/docs/a',
  );
  ok('canonical: SILENT on the canonical origin', canonicalDocsUrl('https://objectstack.ai/docs/a') === null);
  ok('canonical: SILENT on a host that is not this site', canonicalDocsUrl('https://github.com/o/r') === null);
  ok('canonical: SILENT on a relative destination', canonicalDocsUrl('../sibling/README.md') === null);

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
    a1.findings[0]?.detail.includes('https://objectstack.ai/docs/automation/flows'),
  );
  ok(
    'A1 remedy does NOT name an alias host',
    !a1.findings[0]?.detail.includes('docs.objectstack.ai'),
  );
  const a1clean = runDoc('See [Flows](https://objectstack.ai/docs/automation/flows).');
  ok('A1 SILENT on the absolute form', a1clean.findings.length === 0);
  ok('A1 SILENT on a relative link', runDoc('See [spec](../../spec/src/).').findings.length === 0);
  ok('A1 SILENT on an external URL', runDoc('See [x](https://github.com/o/r).').findings.length === 0);
  ok('A1 SILENT on a bare fragment', runDoc('See [x](#see-also).').findings.length === 0);
  ok(
    'A1 SILENT on a root-relative link inside a fence',
    runDoc('```md\n[x](/content/docs/a.mdx)\n```').findings.length === 0,
  );

  // Assertion 2 -- observed FAILING, then observed SILENT.
  const a2 = runDoc('See [Flows](https://docs.objectstack.ai/docs/automation/flows).');
  ok(
    'A2 FAILS on an alias origin',
    a2.findings.length === 1 && a2.findings[0].kind === 'non-canonical-host',
  );
  ok(
    'A2 failure prescribes the canonical rewrite of THAT url',
    a2.findings[0]?.detail.includes('https://objectstack.ai/docs/automation/flows'),
  );
  ok('A2 counts it', a2.stats['non-canonical'] === 1);
  ok('A2 FAILS on the other alias too', runDoc('See [F](https://protocol.objectstack.ai/docs/automation/flows).').stats['non-canonical'] === 1);
  ok('A2 SILENT on the canonical origin', a1clean.stats['non-canonical'] === 0);
  ok(
    'A2 SILENT on another host entirely',
    runDoc('See [x](https://github.com/o/r).').stats['non-canonical'] === 0,
  );
  // The whole point of accepting the aliases: an alias link is STILL resolved
  // and STILL anchor-checked. If a later edit narrows `DOCS_HOSTS`, these two
  // go green by going silent -- so they assert the resolution counters, not
  // just the absence of a finding.
  ok('A2 does not consume the link: an alias page still RESOLVES', a2.stats.resolved === 1);
  const a2both = runDoc('See [Nope](https://docs.objectstack.ai/docs/automation/no-such-page).');
  ok(
    'A2 does not `continue`: an alias URL with a dead page yields BOTH findings',
    a2both.findings.length === 2
      && a2both.findings.some((f) => f.kind === 'non-canonical-host')
      && a2both.findings.some((f) => f.kind === 'dead-page'),
  );

  // Assertion 3 -- observed FAILING, then observed SILENT.
  const a3 = runDoc('See [Nope](https://objectstack.ai/docs/automation/no-such-page).');
  ok('A3 FAILS on a docs URL with no page', a3.findings.length === 1 && a3.findings[0].kind === 'dead-page');
  ok('A3 failure names the candidates it tried', a3.findings[0]?.detail.includes('content/docs/automation/no-such-page.mdx'));
  ok('A3 SILENT on a docs URL that resolves', a1clean.stats.resolved === 1);
  const a3dir = runDoc('See [Automation](https://objectstack.ai/docs/automation).');
  ok('A3 SILENT on a directory WITH an index page', a3dir.findings.length === 0 && a3dir.stats.resolved === 1);
  const a3redirect = runDoc('See [Old](https://objectstack.ai/docs/guides/business-logic).');
  ok('A3 SILENT when the redirect table rescues the URL', a3redirect.findings.length === 0);
  ok('A3 counts a rescued URL as redirected, not resolved', a3redirect.stats.redirected === 1);
  ok(
    'A3 SILENT on the canonical host outside /docs',
    runDoc('See [Blog](https://objectstack.ai/blog/hello).').findings.length === 0,
  );
  ok(
    'A3 SILENT on an alias host outside /docs (and A2 too — no route mapping to prescribe)',
    runDoc('See [Blog](https://docs.objectstack.ai/blog/hello).').findings.length === 0,
  );

  // Assertion 4 -- observed FAILING, then observed SILENT.
  const anchorPage = 'content/docs/automation/flows.mdx';
  const realIds = headingIds(readFileSync(join(ROOT, anchorPage), 'utf8'));
  if (realIds.length === 0) {
    failures.push(`${anchorPage} renders no heading ids — the A4 fixture has rotted`);
  } else {
    const good = runDoc(`See [Flows](https://objectstack.ai/docs/automation/flows#${realIds[0]}).`);
    ok('A4 SILENT on a fragment that names a real heading', good.findings.length === 0);
    ok('A4 counted the anchor it verified', good.stats.fragments === 1);
    const bad = runDoc(
      'See [Flows](https://objectstack.ai/docs/automation/flows#no-such-heading-anywhere).',
    );
    ok('A4 FAILS on a fragment naming no heading', bad.findings.length === 1 && bad.findings[0].kind === 'dead-anchor');
    ok('A4 failure names the page it read', bad.findings[0]?.detail.includes(anchorPage));
    // Anchor coverage survives on an alias host too -- the other half of the
    // "accepted for checking" claim, and the one a narrowed DOCS_HOSTS would
    // silently drop.
    const aliasBad = runDoc(
      'See [Flows](https://docs.objectstack.ai/docs/automation/flows#no-such-heading-anywhere).',
    );
    ok(
      'A4 still reads the anchor when the origin is an alias',
      aliasBad.stats.fragments === 1 && aliasBad.findings.some((f) => f.kind === 'dead-anchor'),
    );
  }

  // ---- the autolink reaches the assertions, not just the extractor ------
  // Extraction is necessary and not sufficient: the defect was that all four
  // assertions were SILENT on this shape, so each is re-observed FAILING with
  // the destination written as an autolink. Pinning extraction alone would
  // leave the gate free to read the link and then check nothing about it.
  // A1 is the one assertion this shape cannot reach, and that is CommonMark's
  // doing rather than an omission here: an autolink body must be an ABSOLUTE
  // URI, so a root-relative path in angle brackets is not a link on any of the
  // three surfaces -- GitHub and npm render `</content/docs/x.mdx>` as literal
  // text. Pinned in the direction that is actually true, so a later author does
  // not read the missing A1 pin as a hole and "fix" it by dropping the scheme
  // requirement -- which would start claiming every HTML tag in the tree.
  const auto1 = runDoc('Docs: </content/docs/automation/flows.mdx>');
  ok(
    'a root-relative path in angle brackets is NOT an autolink (no scheme)',
    auto1.stats.links === 0 && auto1.findings.length === 0,
  );
  const auto2 = runDoc('Docs: <https://docs.objectstack.ai/docs/automation/flows>');
  ok(
    'A2 FAILS on an alias origin written as an autolink',
    auto2.findings.length === 1 && auto2.findings[0].kind === 'non-canonical-host',
  );
  ok('A2 counts the autolink it read', auto2.stats['non-canonical'] === 1);
  const auto3 = runDoc('Docs: <https://objectstack.ai/docs/automation/no-such-page>');
  ok(
    'A3 FAILS on a dead docs page written as an autolink',
    auto3.findings.length === 1 && auto3.findings[0].kind === 'dead-page',
  );
  const auto3ok = runDoc('Docs: <https://objectstack.ai/docs/automation/flows>');
  ok(
    'A3 SILENT on a resolving autolink, and COUNTS it resolved',
    auto3ok.findings.length === 0 && auto3ok.stats.resolved === 1,
  );
  const auto4 = runDoc(
    'Docs: <https://objectstack.ai/docs/automation/flows#no-such-heading-anywhere>',
  );
  ok(
    'A4 FAILS on a dead anchor written as an autolink',
    auto4.stats.fragments === 1 && auto4.findings.some((f) => f.kind === 'dead-anchor'),
  );
  // The card's own positive control, kept as a pin: this exact input returned
  // [] from the shipped extractor, which is what made the hole measurable.
  const autoCard = runDoc('Docs: <https://objectstack.ai/docs/no-such-page-anywhere>');
  ok(
    'the reported 404-in-an-autolink is now a finding rather than silence',
    autoCard.stats.links === 1 && autoCard.findings.some((f) => f.kind === 'dead-page'),
  );
  // A mailto autolink is a LINK (it is counted) and is out of scope BY NAME
  // (it is classified external and yields nothing) -- both halves, because
  // "no findings" alone is also what a recognizer that never saw it produces.
  const autoMail = runDoc('Mail: <mailto:hi@objectstack.ai>');
  ok(
    'a mailto autolink is counted as a link and classified external',
    autoMail.stats.links === 1 && autoMail.stats.external === 1 && autoMail.findings.length === 0,
  );
  // The non-links, at document level: an angle bracket in prose must not
  // manufacture a link, or the empty-scan guard above stops meaning anything.
  const autoNone = runDoc('Text <not a url>, a tag <br>, and <foo@example.com>.');
  ok('bracket-wearing non-links yield no links at all', autoNone.stats.links === 0);

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
      + '  ref-def, pointy brackets, titles, AUTOLINKS), all seven classify buckets, the remedy\n'
      + '  builder and its refusal, the canonicaliser both ways, the pageCandidates directory/index\n'
      + '  subtlety, and all four assertions observed both FAILING and SILENT — including the host\n'
      + '  split itself (an alias origin is a FINDING, and is still resolved and still\n'
      + '  anchor-checked) and the autolink shape (assertions 2, 3 and 4 re-observed FAILING on it;\n'
      + '  A1 pinned UNREACHABLE through it, since an autolink body must be an absolute URI; a\n'
      + '  pointy-bracket destination counted exactly ONCE; and angle-bracketed non-links —\n'
      + '  tags, prose, bare addresses — claimed by nothing).',
  );
}

/* Run only when invoked as a program — the extractor, the classifier and the
 * resolvers are exported so a caller chasing a false positive can import them
 * without the import itself sweeping the workspace. */
if (isEntrypoint(import.meta.url)) {
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
