#!/usr/bin/env node
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// check-docs-redirects (#9014) -- resolve every destination in
// `apps/docs/redirects.mjs` against the real `content/docs` tree, the way
// Fumadocs routes it, and reject redirect chains.
//
//   node scripts/check-docs-redirects.mjs
//   node scripts/check-docs-redirects.mjs --self-test   # verify the checker itself
//
// ## The blind spot this closes
//
// `apps/docs/redirects.mjs` is a 92-entry table of permanent (308) redirects
// from the pre-2026-07 docs IA to the module-based one. Before this gate,
// NOTHING verified it:
//
//   - `node scripts/pm/dispatch-gates.mjs apps/docs/redirects.mjs` reported
//     "No check family names the given paths in its own source", over 99
//     discovered families;
//   - `git grep -l 'redirects.mjs' -- scripts .github` had 0 hits. The table's
//     only consumer was `apps/docs/next.config.mjs`;
//   - the `Check Documentation Links` lane (`check-links.yml`) runs lychee over
//     `content/**` plus two root markdown files. A redirect DESTINATION is not
//     a link in any file lychee reads, so the table is outside that surface --
//     the lane that looks like it would cover this does not.
//
// So the rot was invisible in the worst way: invisible to CI, and invisible to
// the docs-links gate a reader would assume covers it. #8948 found three
// destinations aiming at pages that do not exist -- live URLs answering a
// permanent 308 into a 404, the single worst shape a docs redirect can take,
// because a 308 is cached by browsers and treated as final by crawlers.
//
// ## The three assertions
//
//   1. EVERY DESTINATION RESOLVES TO A REAL PAGE, resolved the way Fumadocs
//      does it (`apps/docs/lib/source.ts`: `loader({ baseUrl: '/docs' })` over
//      `content/docs`): `/docs/x` is served by `content/docs/x.mdx`, `x.md`,
//      `x/index.mdx` or `x/index.md`, and bare `/docs` by `content/docs/index.mdx`.
//      A destination outside the `/docs` route space is reported, never passed
//      over in silence -- see UNRESOLVABLE below.
//   2. WILDCARD DESTINATIONS RESOLVE TO A REAL DIRECTORY.
//      `/docs/kernel/runtime-services/:path*` names no single page, so there is
//      nothing to open; what CAN be asserted is that the directory the rewritten
//      path lands in exists at all.
//   3. NO CHAINS. A destination that is itself matched by a source in the table
//      costs the old URL a second round trip, and every hop is SEO signal lost.
//      That rule is already written into the table's own comments (maintainer
//      ruling 2026-08-15, the retired-deployment-pages block, which re-points two
//      `/docs/guides/*` entries at the final destination precisely to avoid a
//      chain) -- and until this gate it was enforced by nothing but reviewer
//      attention.
//
// ## Why this file is dependency-free
//
// Same reason `check-adr-links.mjs` is: an author must be able to run it in any
// container with `node scripts/check-docs-redirects.mjs`, with no workspace
// install and no network. The table is a plain ESM module with no imports, and
// the content tree is a filesystem walk, so the whole check is milliseconds.
//
// ## Why a --self-test with POSITIVE CONTROLS is the load-bearing half (#9014)
//
// A resolver that silently resolves everything is EXACTLY the defect this gate
// exists to fix. Since #8948's repair landed (62b2655d8) the live table is 100%
// green, so a passing run against real data cannot distinguish a working gate
// from a no-op one -- and two of the three limbs have never fired against real
// data at all (the chain limb has no historical instance; the wildcard limb has
// no live failing example whatsoever). A gate whose limbs have never been
// observed to fail is a gate whose exit code means nothing.
//
// So every limb carries a positive control in `--self-test`, over a temp fixture
// that runs `checkTable()` -- the SAME function `main()` calls -- including the
// module load, so the loader is exercised rather than bypassed. The fixture pairs
// each red with its green counterpart, and asserts the EXACT finding set rather
// than "at least one finding": a checker that flagged everything would pass a
// red-only fixture just as happily as a correct one.
//
// The dead-destination limb additionally has a real red -> green transition
// recorded against history rather than construction: `apps/docs/redirects.mjs`
// at `62b2655d8^` carries the three #8948 entries, and this script reports
// exactly those 3 there and 0 at `62b2655d8`, over the same 92 entries.
//
// ## Matching follows Next's own semantics
//
// The table is consumed by `next.config.mjs`'s `redirects()`, so "is this
// destination matched by a source" has to mean what NEXT means by it, not what
// a string compare would:
//
//   - `'/a/:path*'` matches `/a` AND `/a/deep/path` -- zero or more segments.
//     The table's own comment on the objectos entry depends on this ("`:path*`
//     matches zero or more segments, so this also covers the bare URL"), and a
//     chain checker that missed the bare case would miss the most likely chain.
//   - `'/a/:path+'` matches `/a/deep/path` but NOT `/a`; `'/a/:seg'` matches
//     exactly one segment.
//   - Sources with no parameter match exactly, with no prefix semantics.
//   - FIRST MATCH WINS: Next scans the table top-down and stops, so the source
//     a chain is reported against is the first matching one, not any matching one.
//
// A source spelling this gate cannot compile (an inline regex like `:id(\\d+)`,
// or a segment mixing a literal with a parameter) is reported as UNSUPPORTED
// rather than treated as a literal. Silently reading a pattern as text is how a
// matcher stops matching and nothing says so (#4690).

import { existsSync, mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { isEntrypoint } from './invoked-as.mjs';

/** The docs site's `baseUrl` (apps/docs/lib/source.ts). */
const DOCS_BASE = '/docs';

/** Page file extensions Fumadocs picks up, in resolution order. */
const PAGE_EXTENSIONS = ['.mdx', '.md'];

/** The repo this script lives in -- resolved from the script, so cwd cannot lie. */
function scriptRepoRoot() {
  return join(dirname(fileURLToPath(import.meta.url)), '..');
}

// ---------------------------------------------------------------------------
// Source patterns -- compiled the way Next matches them.
// ---------------------------------------------------------------------------

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Compile a redirect `source` into a matcher.
 *
 * Returns `{ match }` on success, or `{ error }` for a pattern this gate cannot
 * reason about. The error path is deliberate and loud: a pattern read as a
 * literal would quietly stop matching anything, which is the failure this gate
 * is built to prevent, relocated into the gate itself.
 *
 * @param {string} source
 * @returns {{ match: (url: string) => boolean, error?: undefined } | { error: string, match?: undefined }}
 */
export function compileSource(source) {
  if (typeof source !== 'string' || !source.startsWith('/')) {
    return { error: `source ${JSON.stringify(source)} is not an absolute path` };
  }
  let pattern = '';
  for (const segment of source.split('/').slice(1)) {
    if (!segment.includes(':')) {
      pattern += `/${escapeRegExp(segment)}`;
      continue;
    }
    const parsed = /^:([A-Za-z0-9_]+)([*+?]?)$/.exec(segment);
    if (!parsed) {
      return {
        error:
          `segment ${JSON.stringify(segment)} is a path parameter this gate cannot compile. `
          + 'Supported: `:name` (one segment), `:name*` (zero or more), `:name+` (one or more), '
          + '`:name?` (zero or one). An inline regex (`:id(\\d+)`) or a segment mixing a literal '
          + 'with a parameter needs this compiler extended -- it is NOT read as literal text, '
          + 'because a matcher that silently stops matching is the defect this gate exists to catch.',
      };
    }
    const modifier = parsed[2];
    if (modifier === '*') pattern += '(?:/[^/]+)*';
    else if (modifier === '+') pattern += '(?:/[^/]+)+';
    else if (modifier === '?') pattern += '(?:/[^/]+)?';
    else pattern += '/[^/]+';
  }
  const regex = new RegExp(`^${pattern}$`);
  return { match: (url) => regex.test(url) };
}

/**
 * The FIRST source in the table matching `url`, or null.
 *
 * First, not any: Next scans the table top-down and stops at the first hit, so
 * the entry a chain is attributed to has to be the one that would actually fire.
 * Reporting a later match would send an author to re-point the wrong row.
 *
 * @param {[string, string][]} table
 * @param {string} url
 */
export function firstMatchingSource(table, url) {
  for (let index = 0; index < table.length; index++) {
    const compiled = compileSource(table[index][0]);
    if (compiled.error) continue; // reported separately as UNSUPPORTED
    if (compiled.match(url)) return { index, source: table[index][0] };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Destinations -- split, then resolved against the content tree.
// ---------------------------------------------------------------------------

/**
 * Split a destination into the part this gate can resolve.
 *
 * A `#fragment` or `?query` is stripped first: Next serves those through to the
 * client untouched, so they say nothing about whether the PAGE exists, and
 * failing on one would be a false red. (The anchor half of a docs link is owned
 * by `check:doc-anchors`; this gate resolves files.)
 *
 * @param {string} destination
 * @returns {{ path: string, wildcard: boolean, prefix: string }}
 *   `prefix` is the fixed leading part, i.e. the whole path for a non-wildcard
 *   destination and everything before the first parameter segment otherwise.
 */
export function splitDestination(destination) {
  const path = destination.split('#')[0].split('?')[0];
  const segments = path.split('/');
  const firstParam = segments.findIndex((segment) => segment.includes(':'));
  if (firstParam === -1) return { path, wildcard: false, prefix: path };
  const prefix = segments.slice(0, firstParam).join('/');
  return { path, wildcard: true, prefix: prefix === '' ? '/' : prefix };
}

/**
 * The path of a `/docs/...` URL relative to the content root, or null when the
 * URL is not in the docs route space at all.
 *
 * `''` for bare `/docs` -- the content root itself.
 */
export function docsRelative(url) {
  if (url === DOCS_BASE) return '';
  if (url.startsWith(`${DOCS_BASE}/`)) return url.slice(DOCS_BASE.length);
  return null;
}

/**
 * The files Fumadocs would serve `/docs/...` from, in resolution order.
 *
 * Four candidates for a normal route and two for the root, which is the whole
 * subtlety of this limb: a directory that EXISTS but carries no `index.mdx` is
 * a 404, and a resolver that checked for the directory would pass it. The
 * self-test pins that case (`dead-section` below).
 *
 * @param {string} relative result of `docsRelative()`
 */
export function pageCandidates(relative) {
  if (relative === '') return PAGE_EXTENSIONS.map((extension) => `index${extension}`);
  const trimmed = relative.replace(/^\//, '').replace(/\/$/, '');
  return [
    ...PAGE_EXTENSIONS.map((extension) => `${trimmed}${extension}`),
    ...PAGE_EXTENSIONS.map((extension) => `${trimmed}/index${extension}`),
  ];
}

function isDirectory(path) {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// The check itself. `main()` and `--self-test` both go through here, so the
// self-test exercises the real code path rather than a parallel imitation.
// ---------------------------------------------------------------------------

/**
 * Probe URLs used to ask "would this destination be redirected again?".
 *
 * For an exact destination that is the destination itself. For a wildcard
 * destination the rewritten URL is not one string but a family, so the family
 * is probed at three depths under the fixed prefix:
 *
 *   - zero segments (the bare prefix) -- a REAL url, produced whenever the
 *     matching source matched its own bare form, and the depth a `:path*`
 *     source catches;
 *   - one and two segments -- synthetic, and the only depths at which a
 *     `:path+` or single-segment source can be caught. A source matching a
 *     synthetic segment matches every real segment too, so these cannot
 *     manufacture a false chain: no exact source can match them.
 */
export function chainProbes(destination) {
  const { path, wildcard, prefix } = splitDestination(destination);
  if (!wildcard) return [path];
  const base = prefix === '/' ? '' : prefix;
  return [prefix, `${base}/_probe`, `${base}/_probe/_probe`];
}

/**
 * @typedef {{ kind: string, index: number, source: string, destination: string, detail: string }} Finding
 */

/**
 * Run all three assertions over a table and a content root.
 *
 * @param {{ table: [string, string][], contentRoot: string }} options
 * @returns {{ findings: Finding[], stats: Record<string, number> }}
 */
export function checkTable({ table, contentRoot }) {
  /** @type {Finding[]} */
  const findings = [];
  const stats = { entries: table.length, pages: 0, wildcards: 0, unresolvable: 0, probes: 0 };

  for (let index = 0; index < table.length; index++) {
    const [source, destination] = table[index];
    const add = (kind, detail) => findings.push({ kind, index, source, destination, detail });

    // ── The source has to be compilable before anything else means anything ──
    const compiled = compileSource(source);
    if (compiled.error) add('UNSUPPORTED', `source is uncheckable: ${compiled.error}`);

    // ── 1 & 2: the destination resolves ────────────────────────────────────
    const { wildcard, prefix, path } = splitDestination(destination);
    const relative = docsRelative(wildcard ? prefix : path);

    if (relative === null) {
      // Not silently passed: a destination outside `/docs` is not "fine", it is
      // OUTSIDE WHAT THIS GATE CAN SEE, and a green that quietly covered fewer
      // entries than it claims is the exact shape of the blind spot above.
      stats.unresolvable++;
      add(
        'UNRESOLVABLE',
        `destination is not under ${DOCS_BASE}, so this gate cannot resolve it against content/docs. `
          + 'If the docs really should redirect off-site, that is a decision to take in the open: extend '
          + 'this gate with the rule that makes the new destination checkable, rather than letting it pass unseen.',
      );
    } else if (wildcard) {
      stats.wildcards++;
      const directory = join(contentRoot, relative);
      if (!isDirectory(directory)) {
        const what = existsSync(directory) ? 'exists but is a FILE, not a directory' : 'does not exist';
        add(
          'WILDCARD-DIR',
          `wildcard destination rewrites into ${prefix}/..., but content/docs${relative} ${what}. `
            + 'A wildcard destination names no single page, so what has to hold is that the directory '
            + 'the rewritten path lands in is real -- otherwise every URL the wildcard catches 308s into a 404.',
        );
      }
    } else {
      stats.pages++;
      const candidates = pageCandidates(relative);
      if (!candidates.some((candidate) => existsSync(join(contentRoot, candidate)))) {
        add(
          'DEAD',
          `destination resolves to no page. Fumadocs would serve ${path} from one of: `
            + `${candidates.map((candidate) => `content/docs/${candidate}`).join(', ')} -- none exists. `
            + 'A permanent (308) redirect into a 404 is cached by browsers and treated as final by crawlers, '
            + 'so the old URL is worse off than if the entry had never been added.',
        );
      }
    }

    // ── 3: no chains ───────────────────────────────────────────────────────
    for (const probe of chainProbes(destination)) {
      stats.probes++;
      const hit = firstMatchingSource(table, probe);
      if (!hit) continue;
      const via = probe === destination ? '' : ` (probed as ${probe})`;
      add(
        'CHAIN',
        `destination${via} is itself matched by the source at entry ${hit.index + 1}, `
          + `${JSON.stringify(hit.source)} -> ${JSON.stringify(table[hit.index][1])}. `
          + 'Next matches this table once per request, so the old URL pays a second round trip and every '
          + `hop is SEO signal lost. Point entry ${index + 1} at the FINAL destination instead `
          + '(the retired-deployment-pages block in the table does exactly this, on the 2026-08-15 ruling).',
      );
      break; // first match wins -- reporting later ones would name rows that never fire
    }
  }

  return { findings, stats };
}

// ---------------------------------------------------------------------------
// Loading the table.
// ---------------------------------------------------------------------------

/**
 * Import `docsRedirects` from a redirects module and validate its SHAPE.
 *
 * Every failure here is thrown, never softened into an empty table: a gate that
 * printed OK because it loaded nothing is the vacuous green this whole file
 * exists to prevent (#4690).
 *
 * @param {string} file absolute path to a redirects module
 * @returns {Promise<[string, string][]>}
 */
export async function loadTable(file) {
  const module = await import(pathToFileURL(file).href);
  const table = module.docsRedirects;
  if (!Array.isArray(table)) {
    throw new Error(`${file} does not export a \`docsRedirects\` array (got ${typeof table})`);
  }
  if (table.length === 0) {
    throw new Error(`${file} exports an EMPTY \`docsRedirects\` table -- refusing to report OK over nothing`);
  }
  table.forEach((entry, index) => {
    if (!Array.isArray(entry) || entry.length !== 2 || entry.some((part) => typeof part !== 'string')) {
      throw new Error(
        `${file}: entry ${index + 1} is not a [source, destination] pair of strings (got ${JSON.stringify(entry)})`,
      );
    }
  });
  return table;
}

// ---------------------------------------------------------------------------
// Reporting.
// ---------------------------------------------------------------------------

/**
 * What the run actually asserted, stated so a GREEN can be read for its scope.
 *
 * Every count is named unconditionally, zeroes included. The table is green
 * today, so the only thing distinguishing "92 destinations were opened" from
 * "the loop never ran" is this line.
 */
export function summarise(stats) {
  return (
    `${stats.entries} entries -- ${stats.pages} page destination(s) resolved against content/docs, `
    + `${stats.wildcards} wildcard destination(s) resolved to a directory, `
    + `${stats.unresolvable} outside the ${DOCS_BASE} route space, `
    + `${stats.probes} chain probe(s) matched against every source`
  );
}

function report(findings, stats, label) {
  if (findings.length === 0) {
    console.log(`check-docs-redirects: OK (${label}: ${summarise(stats)}).`);
    return 0;
  }
  const byKind = findings.reduce((acc, finding) => {
    acc[finding.kind] = (acc[finding.kind] ?? 0) + 1;
    return acc;
  }, {});
  const kinds = Object.entries(byKind).map(([kind, count]) => `${count} ${kind}`).join(', ');
  console.error(`check-docs-redirects: ${findings.length} problem(s) in ${label} -- ${kinds}\n`);
  for (const finding of findings) {
    console.error(`  • [${finding.kind}] entry ${finding.index + 1}: '${finding.source}' -> '${finding.destination}'`);
    console.error(`      ${finding.detail}\n`);
  }
  console.error(`Scope of this run: ${summarise(stats)}.`);
  return 1;
}

// ---------------------------------------------------------------------------
// Self-test -- every limb has a positive control, each paired with its green.
// ---------------------------------------------------------------------------

/**
 * Build a throwaway content tree plus two redirect modules, and run the real
 * `checkTable()` over them.
 *
 * Two tables over ONE content root on purpose. The clean one proves the checker
 * can be silent -- without it, a checker that flagged every entry would pass
 * every red fixture below. The dirty one is asserted by its EXACT finding set,
 * so an over-eager checker fails just as loudly as a blind one.
 */
async function selfTest() {
  const failures = [];
  let checked = 0;
  const assert = (condition, message) => {
    checked++;
    if (!condition) failures.push(message);
  };

  const dir = mkdtempSync(join(tmpdir(), 'check-docs-redirects-selftest-'));
  const write = (relative, contents) => {
    const full = join(dir, relative);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, contents);
  };

  try {
    // ── The fixture content tree ────────────────────────────────────────────
    const contentRoot = join(dir, 'content/docs');
    write('content/docs/index.mdx', '# Docs root\n'); // bare /docs
    write('content/docs/plain.mdx', '# Plain mdx\n'); // /docs/plain
    write('content/docs/legacy.md', '# Plain md\n'); // /docs/legacy  (.md, not .mdx)
    write('content/docs/section/index.mdx', '# Section\n'); // /docs/section
    write('content/docs/older/index.md', '# Older\n'); // /docs/older  (index.md)
    write('content/docs/section/page.mdx', '# Page\n'); // /docs/section/page
    write('content/docs/wild/kept.mdx', '# Kept\n'); // /docs/wild/* lands here
    // A directory that EXISTS and holds no index page. Fumadocs serves nothing
    // at /docs/dead-section, so it must be reported DEAD -- this is the fixture
    // that separates a page resolver from a directory-existence check.
    write('content/docs/dead-section/child.mdx', '# Child\n');
    // A FILE where a wildcard destination expects a directory.
    write('content/docs/not-a-dir.mdx', '# Not a dir\n');

    // ── Table 1: clean. Every resolution shape, and no chains. ──────────────
    const cleanTable = [
      ['/old/plain', '/docs/plain'],
      ['/old/legacy', '/docs/legacy'],
      ['/old/section', '/docs/section'],
      ['/old/older', '/docs/older'],
      ['/old/root', '/docs'],
      ['/old/anchored', '/docs/section/page#heading'],
      ['/old/queried', '/docs/section/page?utm=1'],
      ['/old/wild/:path*', '/docs/wild/:path*'],
    ];
    write(
      'clean-redirects.mjs',
      `export const docsRedirects = ${JSON.stringify(cleanTable, null, 2)};\n`,
    );
    const cleanLoaded = await loadTable(join(dir, 'clean-redirects.mjs'));
    const clean = checkTable({ table: cleanLoaded, contentRoot });

    // Anti-vacuity, and the anti-over-eagerness control in one: a table where
    // every limb has something real to look at reports NOTHING.
    assert(
      clean.findings.length === 0,
      `a clean table reports zero findings -- got ${JSON.stringify(clean.findings.map((f) => `${f.kind}@${f.index + 1}`))}`,
    );
    // ...and it really did look. A silent checker over an unexamined table would
    // satisfy the assertion above just as well.
    assert(
      clean.stats.pages === 7 && clean.stats.wildcards === 1 && clean.stats.entries === 8,
      `the clean run examined all 8 entries (7 pages + 1 wildcard) -- got ${JSON.stringify(clean.stats)}`,
    );
    assert(clean.stats.probes === 10, `the clean run probed 7 exact + 3 wildcard depths = 10 -- got ${clean.stats.probes}`);
    // Each resolution shape is asserted individually, because "the clean table
    // is green" would also hold if one shape resolved for the wrong reason.
    const resolves = (url) => pageCandidates(docsRelative(url)).some((c) => existsSync(join(contentRoot, c)));
    assert(resolves('/docs/plain'), 'a .mdx page resolves');
    assert(resolves('/docs/legacy'), 'a .md page resolves');
    assert(resolves('/docs/section'), 'a directory index.mdx resolves');
    assert(resolves('/docs/older'), 'a directory index.md resolves');
    assert(resolves('/docs'), 'bare /docs resolves to content/docs/index.mdx');
    assert(!resolves('/docs/dead-section'), 'a directory with no index page does NOT resolve');

    // ── Table 2: dirty. One control per limb, each a distinct failure. ──────
    //
    // Ordered so that the CHAIN controls sit after the sources they collide
    // with: first match wins, so where a probe lands is an ordering fact.
    const dirtyTable = [
      /* 1 */ ['/old/gone', '/docs/no-such-page'], // DEAD -- nothing there at all
      /* 2 */ ['/old/section-ish', '/docs/dead-section'], // DEAD -- dir exists, no index page
      /* 3 */ ['/old/offsite', '/pricing'], // UNRESOLVABLE -- outside /docs
      /* 4 */ ['/old/w1/:path*', '/docs/no-such-dir/:path*'], // WILDCARD-DIR -- missing directory
      /* 5 */ ['/old/w2/:path*', '/docs/not-a-dir/:path*'], // WILDCARD-DIR -- a file, not a directory
      // Entries 6, 8 and 11 are the sources the CHAIN controls collide with.
      // Their own destinations are deliberately pages that NO source matches, so
      // each stays clean and the discrimination assertion below is real. (The
      // first draft of this fixture had them pointing at each other's sources;
      // the checker reported the extra chains, which is the fixture being wrong
      // and the gate being right -- recorded here because it is the cheapest
      // evidence in this file that the chain limb is not decorative.)
      /* 6 */ ['/docs/plain', '/docs/older'], // (an exact source entry 7 collides with)
      /* 7 */ ['/old/chain-exact', '/docs/plain'], // CHAIN -- exact source at entry 6
      /* 8 */ ['/docs/section/:path*', '/docs/legacy'], // (a zero-or-more source, entries 9 and 10)
      /* 9 */ ['/old/chain-wild', '/docs/section/page'], // CHAIN -- wildcard source, deep url
      /* 10 */ ['/old/chain-bare', '/docs/section'], // CHAIN -- ':path*' matches the BARE url too
      /* 11 */ ['/docs/wild/:path+', '/docs/older'], // (a one-or-more source, entry 12)
      /* 12 */ ['/old/chain-deep/:path*', '/docs/wild/:path*'], // CHAIN -- only the DEEP probe catches it
      /* 13 */ ['/old/weird/:id(\\d+)', '/docs/legacy'], // UNSUPPORTED -- inline regex
    ];
    write(
      'dirty-redirects.mjs',
      `export const docsRedirects = ${JSON.stringify(dirtyTable, null, 2)};\n`,
    );
    const dirtyLoaded = await loadTable(join(dir, 'dirty-redirects.mjs'));
    const dirty = checkTable({ table: dirtyLoaded, contentRoot });
    const at = (entry) => dirty.findings.filter((f) => f.index === entry - 1).map((f) => f.kind);

    // Limb 1 -- dead destinations, in both of its shapes.
    assert(at(1).includes('DEAD'), `entry 1 (no such page) is DEAD -- got ${JSON.stringify(at(1))}`);
    assert(
      at(2).includes('DEAD'),
      `entry 2 (directory with no index page) is DEAD -- a resolver that only checked for the directory `
        + `would pass this, which is the "resolves everything" failure mode. Got ${JSON.stringify(at(2))}`,
    );
    assert(at(3).includes('UNRESOLVABLE'), `entry 3 (off-site) is UNRESOLVABLE, not silently green -- got ${JSON.stringify(at(3))}`);

    // Limb 2 -- wildcard destinations. This limb has NO live failing example in
    // the real table, so these two are the only evidence it can fire at all.
    assert(at(4).includes('WILDCARD-DIR'), `entry 4 (missing directory) is WILDCARD-DIR -- got ${JSON.stringify(at(4))}`);
    assert(
      at(5).includes('WILDCARD-DIR'),
      `entry 5 (a FILE where a directory is needed) is WILDCARD-DIR -- got ${JSON.stringify(at(5))}`,
    );

    // Limb 3 -- chains. Never fired against the real table either.
    assert(at(7).includes('CHAIN'), `entry 7 (destination is an exact source) is a CHAIN -- got ${JSON.stringify(at(7))}`);
    assert(at(9).includes('CHAIN'), `entry 9 (deep url under a :path* source) is a CHAIN -- got ${JSON.stringify(at(9))}`);
    assert(
      at(10).includes('CHAIN'),
      `entry 10 (BARE url under a :path* source) is a CHAIN -- ':path*' matches zero segments too, and a `
        + `chain checker missing that misses the likeliest chain. Got ${JSON.stringify(at(10))}`,
    );
    assert(
      at(12).includes('CHAIN'),
      `entry 12 is a CHAIN found only by the DEEP probe: the ':path+' source at entry 11 cannot match the `
        + `bare prefix, so a bare-prefix-only probe would report this table clean. Got ${JSON.stringify(at(12))}`,
    );
    // The chain finding names the FIRST matching source, not any -- entry 8's
    // '/docs/section/:path*' precedes nothing else that matches, and entry 6's
    // exact source precedes it for '/docs/plain'.
    const chainAt7 = dirty.findings.find((f) => f.index === 6 && f.kind === 'CHAIN');
    assert(
      chainAt7?.detail.includes('entry 6') === true,
      `the chain at entry 7 is attributed to entry 6 (first match wins) -- got ${chainAt7?.detail}`,
    );

    assert(at(13).includes('UNSUPPORTED'), `entry 13 (inline regex) is UNSUPPORTED, not read as a literal -- got ${JSON.stringify(at(13))}`);

    // Discrimination: the entries that are FINE in the dirty table stay silent.
    // Without this the assertions above would also pass for a checker that
    // reported every entry, which is a no-op with the opposite exit code.
    for (const innocent of [6, 8, 11]) {
      assert(
        at(innocent).length === 0,
        `entry ${innocent} is fine and must produce no finding -- got ${JSON.stringify(at(innocent))}`,
      );
    }
    const kinds = dirty.findings.map((f) => `${f.kind}@${f.index + 1}`).sort();
    assert(
      kinds.join() === [
        'CHAIN@10', 'CHAIN@12', 'CHAIN@7', 'CHAIN@9',
        'DEAD@1', 'DEAD@2',
        'UNRESOLVABLE@3', 'UNSUPPORTED@13',
        'WILDCARD-DIR@4', 'WILDCARD-DIR@5',
      ].join(),
      `the dirty table produces EXACTLY the 10 expected findings -- got ${JSON.stringify(kinds)}`,
    );

    // ── The matcher's Next semantics, asserted directly ─────────────────────
    const matches = (source, url) => compileSource(source).match?.(url) === true;
    assert(matches('/a/:path*', '/a'), "'/a/:path*' matches the bare '/a' (zero segments)");
    assert(matches('/a/:path*', '/a/deep/path'), "'/a/:path*' matches '/a/deep/path'");
    assert(!matches('/a/:path*', '/ab'), "'/a/:path*' does not match a longer sibling segment '/ab'");
    assert(!matches('/a/:path+', '/a'), "'/a/:path+' requires at least one segment");
    assert(matches('/a/:path+', '/a/x'), "'/a/:path+' matches one segment");
    assert(matches('/a/:seg', '/a/x'), "'/a/:seg' matches exactly one segment");
    assert(!matches('/a/:seg', '/a/x/y'), "'/a/:seg' does not match two segments");
    assert(matches('/a/b', '/a/b'), 'an exact source matches exactly');
    assert(!matches('/a/b', '/a/b/c'), 'an exact source has no prefix semantics');
    assert(compileSource('/a/:id(\\d+)').error !== undefined, 'an inline regex is an error, never a literal');
    assert(compileSource('/a/pre:name').error !== undefined, 'a literal+parameter segment is an error, never a literal');
    assert(compileSource('relative/path').error !== undefined, 'a non-absolute source is an error');

    // Destination splitting, including the parts Next passes through.
    assert(splitDestination('/docs/a/b').wildcard === false, 'a plain destination is not a wildcard');
    assert(splitDestination('/docs/a/:path*').prefix === '/docs/a', 'a wildcard destination yields its fixed prefix');
    assert(splitDestination('/docs/a#h').path === '/docs/a', 'a #fragment is stripped before resolution');
    assert(splitDestination('/docs/a?x=1').path === '/docs/a', 'a ?query is stripped before resolution');
    assert(docsRelative('/pricing') === null, 'a non-docs url has no content-root path');
    assert(docsRelative('/docs') === '', 'bare /docs is the content root itself');
    assert(chainProbes('/docs/a/:path*').length === 3, 'a wildcard destination is probed at three depths');
    assert(chainProbes('/docs/a').join() === '/docs/a', 'an exact destination is probed once, as itself');

    // ── The loader refuses to report OK over nothing (#4690) ────────────────
    const rejects = async (relative, contents, why) => {
      write(relative, contents);
      let threw = false;
      try {
        await loadTable(join(dir, relative));
      } catch {
        threw = true;
      }
      assert(threw, why);
    };
    await rejects('empty-redirects.mjs', 'export const docsRedirects = [];\n', 'an EMPTY table is rejected, never reported OK');
    await rejects('missing-redirects.mjs', 'export const other = 1;\n', 'a module with no docsRedirects export is rejected');
    await rejects('shape-redirects.mjs', 'export const docsRedirects = [["/a"]];\n', 'a malformed entry is rejected');

    // ── The green states its own scope ──────────────────────────────────────
    const line = summarise(clean.stats);
    assert(
      line.includes('7 page destination(s)') && line.includes('1 wildcard destination(s)') && line.includes('10 chain probe(s)'),
      `the summary names every count, so a green can be read for its scope -- got "${line}"`,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }

  if (failures.length) {
    console.error(`✗ check-docs-redirects --self-test -- ${failures.length} failure(s)\n`);
    for (const failure of failures) console.error(`  • ${failure}`);
    process.exit(1);
  }
  console.log(
    `✓ check-docs-redirects --self-test: ${checked} assertions over a temp fixture (real loadTable + checkTable path); `
    + 'every limb -- dead page, wildcard directory, chain -- observed FAILING and observed silent.',
  );
}

// ---------------------------------------------------------------------------

async function main() {
  const root = scriptRepoRoot();
  const table = await loadTable(join(root, 'apps/docs/redirects.mjs'));
  const { findings, stats } = checkTable({ table, contentRoot: join(root, 'content/docs') });
  process.exit(report(findings, stats, 'apps/docs/redirects.mjs'));
}

/* Run only when invoked as a program — `docsRelative`, `pageCandidates` and
 * `firstMatchingSource` are exported so a sibling gate can ask "would Fumadocs
 * serve this /docs/... URL?" without the import itself checking the redirect
 * table (and calling `process.exit` out from under its caller). */
if (isEntrypoint(import.meta.url)) {
  if (process.argv.includes('--self-test')) {
    await selfTest();
  } else {
    await main();
  }
}
