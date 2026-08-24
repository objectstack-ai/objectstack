#!/usr/bin/env node
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * check-doc-route-spelling (#11050) — wire-path literals taught in published
 * prose must spell routes the way the route ledgers do.
 *
 *   node scripts/check-doc-route-spelling.mjs              # enforce: findings exit 1
 *   node scripts/check-doc-route-spelling.mjs --advisory   # findings printed, exit 0
 *   node scripts/check-doc-route-spelling.mjs --self-test  # prove the battery can go red
 *
 * ## The gap this closes
 *
 * #9180 step ② retired the plural `/api/v1/meta/objects/:name/state/:field`
 * registration. Nothing in the tree connected that change to the prose that
 * teaches the route, so two published sites kept teaching a retired spelling
 * until a hand sweep found them — and the sweep found a THIRD spelling
 * (`/metadata/objects/...`) that a grep for `meta/objects` cannot match at
 * all. #10178 pinned those two files for that one route
 * (`packages/rest/src/meta-state-route-doc-spelling.test.ts`); a curated list
 * of files that already exist can never contain the one added tomorrow, which
 * is exactly how those two sites came to exist. This gate is the corpus-wide
 * detector: every `/api/v1` literal in the published corpora, judged against
 * every ledger row, no per-file enumeration to go stale.
 *
 * ## Why a root-level script and not a package test
 *
 * A package test reading `content/docs/**` and `skills/**` would need both
 * corpora as declared turbo inputs, invalidating that package's cache on
 * every docs edit (`check-cross-package-test-inputs` exists to make exactly
 * that cost visible). Whole-corpus scans are root gates here —
 * `check-doc-authoring.mjs` is the model, and this file copies its dead-root
 * / empty-scan / floor discipline (#4916 / #4932).
 *
 * ## Scope — the corpora this gate owns (#11050 ruling)
 *
 * `content/docs/**` minus `releases/`, plus `skills/**` — the PUBLISHED
 * corpora, where a wrong spelling reaches a customer. `docs/` and `.claude/`
 * are deliberately out: every expansion of `check-doc-authoring.mjs`'s roots
 * was its own card, and this gate's roots grow the same way. Note that
 * `content/docs/references/**` (generated from spec) is IN scope on purpose:
 * a finding there prescribes fixing the `.describe()` source in
 * `packages/spec`, not hand-editing the generated page.
 *
 * ## The authority — two ledgers, parsed as source text
 *
 * `packages/rest/src/rest-route-ledger.ts` (full wire paths at the default
 * unscoped base) and `packages/runtime/src/route-ledger.ts` (dispatcher
 * cleanPaths; the wire path is `/api/v1` + cleanPath unless the row says
 * `absolute: true`, and `* /x/**` rows claim a prefix FAMILY whose real
 * table lives elsewhere — better-auth's, the cloud repo's, metadata-declared
 * endpoints). Parsed textually, `route: '...'` per row, so this gate has no
 * dependency that could fail to resolve in CI; the floors below make an
 * under-parse (a quoting-style migration, a moved file) fail loudly instead
 * of scanning against a quietly smaller authority.
 *
 * Surfaces those two ledgers do NOT carry — service-storage, service-i18n
 * (own per-package ledgers), trigger-api's webhook mount, the cloud repo's
 * routes — simply produce no row here. The verdict logic is built so their
 * absence cannot flag correct prose: a literal is flagged ONLY when it
 * matches a known row's SHAPE while differing from its spelling. Widening
 * the authority to the other ledgers is a future card, same as roots.
 *
 * ## What is flagged, and what deliberately is not
 *
 * FLAGGED — a literal that aligns with a ledger row segment-for-segment
 * where every differing literal segment is a spelling VARIANT of the row's
 * (singular/plural, or the pinned lexicon: `meta` ↔ `metadata`). That is the
 * measured drift class: `/meta/objects/...` (plural) and
 * `/metadata/objects/...` (the third spelling) both flag against the
 * singular row while `/api/v1/no-such-route` and value-level examples do
 * not. A broader "similar prefix" rule was measured to false-positive
 * (`datasources` vs `data`) and rejected.
 *
 * NOT flagged, deliberately:
 *  - unknown shapes (no row aligns) — recorded and printed as UNMATCHED so
 *    the population stays enumerated, never judged: most are real routes the
 *    two ledgers do not carry, or generic pattern teaching;
 *  - wrong VALUES at parameter positions (`/meta/viewes` teaching a 400,
 *    plural object names in `/data/:object`) — parameter values are not the
 *    ledgers' vocabulary, and the error catalog documents refusals with
 *    exactly such spellings;
 *  - anything under a wildcard family's prefix (`/auth`, `/ai`, `/mcp`,
 *    `/apps`) — the real tables live outside these ledgers;
 *  - the `/api/v1/environments/:environmentId/...` scoped mirror — stripped
 *    before judging, per the REST ledger's own header.
 *
 * ## ⛔ The plural tolerance is not this gate's to narrow
 *
 * `/meta/objects/:name/state/:field` is refused by a REST-fronted deployment
 * and still ANSWERED wherever `dispatch()` fronts the request — deliberate,
 * by the maintainer re-weigh of the #9180 ruling (2026-08-17 item 3), pinned
 * by `packages/runtime/src/domains/meta-state-plural-tolerance.test.ts` and
 * recorded on both ledger rows. This gate says nothing about what the
 * runtime ANSWERS; it says what the docs TEACH, which is the ledger row's
 * canonical spelling. It is also NOT the `META_URL_TO_SINGULAR` fold, whose
 * retirement was deferred separately — the runtime ledger row calls
 * conflating the two "the specific error to avoid". A page that must show a
 * non-canonical spelling on purpose (migration guides, refusal examples)
 * carries `route-spelling-allow` on the literal's line or the line above.
 *
 * ## Advisory posture (#11050 triage ruling)
 *
 * Measurement-first: the population was enumerated before the gate was
 * wired (585 occurrences, 251 distinct, 442 files on 2026-08-24 — zero
 * flags), and the lint.yml step runs `--advisory` until the maintainer
 * flips it. Advisory covers FINDINGS only: the self-test, a dead root, an
 * evaporated corpus, an under-parsed ledger and a broken floor all stay
 * hard failures in every mode — a scan that cannot see is never a pass
 * (#4690 / #4916 / #4932).
 *
 * ## Floors (#4932)
 *
 * Every floor is far below the population measured at introduction
 * (content/docs: 521 occurrences, skills: 64; rest ledger ~95 rows, runtime
 * ~60) — they catch evaporation (a broken extractor, a moved corpus, a
 * reformatted ledger), never growth, so they need no maintenance as the
 * corpus grows.
 */
import {
  mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, sep } from 'node:path';

const posix = (p) => p.split(sep).join('/');

// ── Real configuration ──────────────────────────────────────────────────────

const REAL_CONFIG = {
  roots: ['content/docs', 'skills'],
  skipDirs: new Set(['node_modules', '.git', 'dist']),
  // By PATH, not by directory name (the check-doc-authoring lesson): a bare
  // name would also skip a legitimately-named directory elsewhere.
  // `content/docs/releases` is release-owned and out of this gate's scope by
  // the #11050 ruling (and out of every code PR's reach besides).
  skipPaths: new Set(['content/docs/releases']),
  ledgers: [
    { label: 'rest', file: 'packages/rest/src/rest-route-ledger.ts', prefix: '', floor: 50 },
    { label: 'runtime', file: 'packages/runtime/src/route-ledger.ts', prefix: '/api/v1', floor: 40 },
  ],
  // Occurrences of extracted literals per root, not files: the failure this
  // guards is the EXTRACTOR going blind (a regex edit, an escaping change)
  // while the walk still returns every file — a per-root file floor cannot
  // see that. Measured at introduction (2026-08-24): content/docs 521,
  // skills 64.
  occurrenceFloors: { 'content/docs': 100, skills: 10 },
};

/** Segment-spelling variants the detector recognises as "same route, drifted
 * spelling". Plural/singular is computed; everything else is pinned HERE so a
 * new variant class is a reviewed one-line addition, never a loosened
 * heuristic. `meta` ↔ `metadata` is the measured third spelling from the
 * incident this gate exists for. */
const VARIANT_LEXICON = [['meta', 'metadata']];

/** Suppression marker: on the literal's own line or the line directly above.
 * For prose that must show a non-canonical spelling on purpose (migration
 * guides, refusal examples). Allowed literals stay counted and listed. */
const ALLOW_MARKER = 'route-spelling-allow';

// ── Errors (hard in every mode) ─────────────────────────────────────────────

class DeadRootError extends Error {
  constructor(dead) {
    super(`unresolvable ROOT(s): ${dead.map((d) => `${d.root} — ${d.reason}`).join('; ')}`);
    this.name = 'DeadRootError';
    this.dead = dead;
    this.roots = dead.map((d) => d.root);
  }
}

class EmptyRootError extends Error {
  constructor(empty, total) {
    super(`ROOT(s) contributed no Markdown/MDX file: ${empty.join(', ')} (total scanned: ${total})`);
    this.name = 'EmptyRootError';
    this.roots = empty;
    this.total = total;
  }
}

class LedgerError extends Error {
  constructor(label, file, reason) {
    super(`route ledger '${label}' (${file}): ${reason}`);
    this.name = 'LedgerError';
    this.label = label;
    this.file = file;
  }
}

class OccurrenceFloorError extends Error {
  constructor(root, found, floor) {
    super(`root '${root}' yielded ${found} /api/v1 literal(s); floor is ${floor}`);
    this.name = 'OccurrenceFloorError';
    this.root = root;
    this.found = found;
    this.floor = floor;
  }
}

// ── Corpus walk (check-doc-authoring discipline) ────────────────────────────

function assertRootsResolvable(roots) {
  const dead = [];
  for (const root of roots) {
    let stat = null;
    try {
      stat = statSync(root);
    } catch (err) {
      dead.push({ root, reason: err?.code === 'ENOENT' ? 'does not exist' : `cannot be read (${err?.code ?? err})` });
      continue;
    }
    if (!stat.isDirectory()) dead.push({ root, reason: 'exists but is not a directory' });
  }
  if (dead.length) throw new DeadRootError(dead);
}

function walk(dir, cfg, out) {
  for (const e of readdirSync(dir)) {
    if (cfg.skipDirs.has(e)) continue;
    const p = join(dir, e);
    if (cfg.skipPaths.has(posix(p))) continue;
    const s = statSync(p);
    if (s.isDirectory()) walk(p, cfg, out);
    else if (/\.mdx?$/.test(e)) out.push(p);
  }
}

/** Every Markdown/MDX file in scope, grouped per root. No catch anywhere: a
 * partly-read corpus must not report as a clean one. */
function collectFiles(cfg) {
  assertRootsResolvable(cfg.roots);
  const byRoot = new Map();
  let total = 0;
  const empty = [];
  for (const r of cfg.roots) {
    const files = [];
    walk(r, cfg, files);
    byRoot.set(r, files);
    total += files.length;
    if (files.length === 0) empty.push(r);
  }
  if (empty.length) throw new EmptyRootError(empty, total);
  return byRoot;
}

// ── Ledger parsing ──────────────────────────────────────────────────────────

/**
 * Parse one ledger's source text into wire-path route patterns and wildcard
 * family prefixes.
 *
 * The format assumption — one `route: '<VERB> <path>'` single-quoted string
 * per row — is deliberately narrow: if the ledger migrates to another quoting
 * style or shape, the parse count collapses and the FLOOR fails naming the
 * ledger, which is the safe direction (#4932). `servedBy:` strings are not
 * `route:` and are ignored by construction. `absolute: true` is looked up in
 * the window from this row's `route:` to the next one — the property sits
 * beside `route` in the row object, and the token cannot occur in note prose
 * (notes describe it in words, never in `key: value` spelling).
 */
function parseRouteLedger(source, { label, file, prefix, floor }) {
  const routes = [];
  const families = [];
  const matches = [...source.matchAll(/route:\s*'([^']+)'/g)];
  for (let i = 0; i < matches.length; i++) {
    const raw = matches[i][1];
    const windowEnd = i + 1 < matches.length ? matches[i + 1].index : source.length;
    const win = source.slice(matches[i].index, windowEnd);
    const absolute = /\babsolute:\s*true\b/.test(win);
    const sp = raw.indexOf(' ');
    if (sp <= 0) throw new LedgerError(label, file, `row without a VERB prefix: '${raw}'`);
    const verb = raw.slice(0, sp);
    let path = raw.slice(sp + 1);
    if (!absolute && prefix) path = prefix + path;
    if (verb === '*' && path.endsWith('/**')) {
      families.push(path.slice(0, -'/**'.length));
      continue;
    }
    routes.push({ path, ledger: label });
  }
  if (routes.length + families.length < floor) {
    throw new LedgerError(label, file,
      `parsed only ${routes.length + families.length} row(s); floor is ${floor}. Either the ledger `
      + `moved/shrank or its row format changed and this parser no longer reads it — fix the parse, `
      + `never lower the floor to match a number you have not explained.`);
  }
  return { routes, families };
}

function loadLedgers(cfg) {
  const routes = [];
  const families = [];
  for (const l of cfg.ledgers) {
    let source;
    try {
      source = readFileSync(l.file, 'utf8');
    } catch (err) {
      throw new LedgerError(l.label, l.file, `cannot be read (${err?.code ?? err}) — the authority this `
        + `gate judges against is gone, which is a failure, not an empty route set`);
    }
    const parsed = parseRouteLedger(source, l);
    routes.push(...parsed.routes);
    families.push(...parsed.families);
  }
  return { routes, families };
}

// ── Matching ────────────────────────────────────────────────────────────────

/** ':x' (and ':x?') on a ledger row is a parameter position. */
const rowParam = (s) => s.startsWith(':');

/** A prose segment that stands for "some value here" rather than a concrete
 * spelling: `:id`, `{object}`, `<name>`, `[provider]`, `${object}`, `*`.
 * Brace-set prose (`{approve` from `{approve,reject}`) lands here too. */
const prosePlaceholder = (s) => /^[:{<[$]/.test(s) || s.includes('*');

/**
 * One route pattern, pre-split. `:x?` on the LAST segment (the runtime
 * ledger's `GET /ui/view/:object/:type?`) yields two arities.
 */
function routeArities(path) {
  const segs = path.split('/').slice(1);
  const last = segs[segs.length - 1];
  if (last && last.startsWith(':') && last.endsWith('?')) {
    return [[...segs.slice(0, -1), last.slice(0, -1)], segs.slice(0, -1)];
  }
  return [segs];
}

/**
 * Align prose segments with one row arity.
 *
 * Returns `null` when the arity differs, otherwise the list of positions
 * where a CONCRETE prose segment differs from a LITERAL row segment — the
 * only kind of difference this gate is entitled to judge. A row parameter
 * matches any prose segment (values are not the ledger's vocabulary); a
 * prose placeholder matches any row segment (a doc writing `<verb>` over a
 * literal position is teaching the family, not a spelling).
 */
function alignRow(proseSegs, rowSegs) {
  if (proseSegs.length !== rowSegs.length) return null;
  const misses = [];
  for (let i = 0; i < rowSegs.length; i++) {
    const r = rowSegs[i];
    const p = proseSegs[i];
    if (rowParam(r)) continue;
    if (prosePlaceholder(p)) continue;
    if (p === r) continue;
    misses.push({ index: i, prose: p, row: r });
  }
  return misses;
}

/** Singular/plural pair, or a pinned lexicon pair. Deliberately NOT a
 * common-prefix or edit-distance rule: `datasources` vs `data` measured as a
 * false positive under a prefix rule, and a flag on correct published prose
 * is this gate's worst failure mode. */
function isVariantPair(a, b) {
  if (a === b) return false;
  const plural = (x, y) => y === `${x}s` || y === `${x}es`
    || (x.endsWith('y') && y === `${x.slice(0, -1)}ies`);
  if (plural(a, b) || plural(b, a)) return true;
  return VARIANT_LEXICON.some(([x, y]) => (a === x && b === y) || (a === y && b === x));
}

/**
 * Judge one extracted literal against the route population.
 *
 * Verdicts: 'exact' | 'family' | 'surface' | 'flag' | 'unmatched'.
 * Order matters: any exact/family/surface reading anywhere (including the
 * environment-mirror strip) passes the literal before near-miss flagging is
 * considered — `/meta/types` must match its literal row, or the `:type`
 * parameter row, without ever being weighed against near-misses.
 */
function judgeLiteral(lit, { routes, families, firstSegs }) {
  const candidates = [lit.split('/').slice(1)];
  // The scoped mirror: every row is additionally mounted under
  // `/api/v1/environments/:environmentId` (rest-route-ledger.ts header).
  // Strip it and judge the remainder as well.
  const segs0 = candidates[0];
  if (segs0.length >= 4 && segs0[2] === 'environments') {
    candidates.push([segs0[0], segs0[1], ...segs0.slice(4)]);
  }

  for (const cand of candidates) {
    const candPath = `/${cand.join('/')}`;
    for (const fam of families) {
      // Families carry the full wire prefix already ('/api/v1/auth').
      if (candPath === fam || candPath.startsWith(`${fam}/`)) {
        return { verdict: 'family', family: fam };
      }
    }
    for (const route of routes) {
      for (const arity of routeArities(route.path)) {
        const misses = alignRow(cand, arity);
        if (misses && misses.length === 0) return { verdict: 'exact', route };
      }
    }
    // A bare one-segment mention of a surface the ledgers do carry
    // (`/api/v1/data`, `/api/v1/analytics`) is prose talking ABOUT a family,
    // not teaching a route; passing it keeps the unmatched list meaningful.
    if (cand.length === 3 && !prosePlaceholder(cand[2]) && firstSegs.has(cand[2])) {
      return { verdict: 'surface', segment: cand[2] };
    }
  }

  let best = null;
  for (const cand of candidates) {
    for (const route of routes) {
      for (const arity of routeArities(route.path)) {
        const misses = alignRow(cand, arity);
        if (!misses || misses.length === 0) continue;
        if (!misses.every((m) => isVariantPair(m.prose, m.row))) continue;
        if (!best || misses.length < best.misses.length) best = { route, misses };
      }
    }
  }
  if (best) return { verdict: 'flag', route: best.route, misses: best.misses };
  return { verdict: 'unmatched' };
}

/** First cleanPath segments the ledgers carry, for surface-mention passes. */
function collectFirstSegs({ routes, families }) {
  const out = new Set();
  for (const r of routes) {
    const segs = r.path.split('/').slice(1);
    if (segs[0] === 'api' && segs[1] === 'v1' && segs.length >= 3 && !rowParam(segs[2]) && segs[2] !== '') {
      out.add(segs[2]);
    }
  }
  for (const f of families) {
    const segs = f.split('/').slice(1);
    if (segs[0] === 'api' && segs[1] === 'v1' && segs.length >= 3) out.add(segs[2]);
  }
  return out;
}

// ── Extraction ──────────────────────────────────────────────────────────────

const LITERAL_RE = /\/api\/v1(?![A-Za-z0-9_])[A-Za-z0-9_.:{}<>[\]$*/-]*/g;

/** Trim trailing sentence punctuation, keeping a closer that balances an
 * opener inside the literal (`/data/{object}` keeps `}`; `(see /search).`
 * drops `).`). Query/fragment and trailing slashes are cut. */
function tidyLiteral(raw) {
  let lit = raw.replace(/[?#].*$/, '');
  for (;;) {
    const ch = lit[lit.length - 1];
    if ('.,;:)*\''.includes(ch)) { lit = lit.slice(0, -1); continue; }
    if (ch === '}' || ch === ']' || ch === '>') {
      const open = { '}': '{', ']': '[', '>': '<' }[ch];
      const opens = lit.split('').filter((c) => c === open).length;
      const closes = lit.split('').filter((c) => c === ch).length;
      if (closes > opens) { lit = lit.slice(0, -1); continue; }
    }
    break;
  }
  lit = lit.replace(/\/+$/, '');
  return lit === '' ? '/api/v1' : lit;
}

/**
 * Every /api/v1 literal in one file, with location and allow-marker state.
 * Fenced code is scanned like prose — routes are taught inside fences.
 */
function extractLiterals(source, file) {
  const out = [];
  const lines = source.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const allowed = lines[i].includes(ALLOW_MARKER) || (i > 0 && lines[i - 1].includes(ALLOW_MARKER));
    for (const m of lines[i].matchAll(LITERAL_RE)) {
      const lit = tidyLiteral(m[0]);
      if (lit !== '/api/v1' && !lit.startsWith('/api/v1/')) continue;
      out.push({ literal: lit, file: posix(file), line: i + 1, allowed });
    }
  }
  return out;
}

// ── Scan runner ─────────────────────────────────────────────────────────────

/**
 * Walk, extract, judge. Throws the hard errors; returns everything else —
 * the caller decides what a flag costs (enforce vs advisory), never whether
 * an unreadable corpus counts (#4690: it does not).
 */
function runScan(cfg) {
  const ledger = loadLedgers(cfg);
  const firstSegs = collectFirstSegs(ledger);
  const byRoot = collectFiles(cfg);

  const occurrences = [];
  const perRootCounts = new Map();
  let fileCount = 0;
  for (const [root, files] of byRoot) {
    let count = 0;
    for (const f of files) {
      fileCount += 1;
      const found = extractLiterals(readFileSync(f, 'utf8'), f);
      count += found.length;
      occurrences.push(...found);
    }
    perRootCounts.set(root, count);
    const floor = cfg.occurrenceFloors[root];
    if (typeof floor === 'number' && count < floor) throw new OccurrenceFloorError(root, count, floor);
  }

  const stats = { exact: 0, family: 0, surface: 0, unmatched: 0, allowed: 0 };
  const flags = [];
  const unmatched = new Map(); // literal -> first site
  for (const occ of occurrences) {
    if (occ.allowed) { stats.allowed += 1; continue; }
    const j = judgeLiteral(occ.literal, { ...ledger, firstSegs });
    if (j.verdict === 'flag') {
      flags.push({ ...occ, route: j.route, misses: j.misses });
    } else {
      stats[j.verdict] += 1;
      if (j.verdict === 'unmatched' && !unmatched.has(occ.literal)) {
        unmatched.set(occ.literal, `${occ.file}:${occ.line}`);
      }
    }
  }
  return {
    fileCount, occurrences, perRootCounts, stats, flags, unmatched,
    ledgerCounts: { routes: ledger.routes.length, families: ledger.families.length },
  };
}

// ── Reporting ───────────────────────────────────────────────────────────────

function printHardError(err) {
  if (err instanceof DeadRootError) {
    console.error('\n✗ route-spelling guard: declared ROOT(s) do not resolve, so the scan would have been silently narrower:\n');
    for (const d of err.dead) console.error(`  ${d.root} — ${d.reason}`);
    console.error('\nEvery root in scripts/check-doc-route-spelling.mjs must be a directory in the checkout.'
      + '\nIf a corpus directory moved, follow it; if it was deleted, remove the entry deliberately.'
      + '\nNever a tolerant skip (#4916).\n');
    return true;
  }
  if (err instanceof EmptyRootError) {
    console.error('\n✗ route-spelling guard: declared ROOT(s) resolved but contributed no Markdown/MDX file:\n');
    for (const r of err.roots) console.error(`  ${r} — 0 files`);
    console.error(`\n${err.total} file(s) found across all roots. A root that yields nothing is the same`
      + '\nevaporation as one that does not resolve (#4932) — point the root at the corpus or remove it'
      + '\ndeliberately; never lower this to a total count.\n');
    return true;
  }
  if (err instanceof LedgerError) {
    console.error(`\n✗ route-spelling guard: ${err.message}\n`);
    return true;
  }
  if (err instanceof OccurrenceFloorError) {
    console.error(`\n✗ route-spelling guard: root '${err.root}' yielded ${err.found} /api/v1 literal(s); the floor is ${err.floor}.`
      + '\nThe corpus is still there (the file walk succeeded), so this means the EXTRACTOR went blind'
      + '\nor the corpus stopped spelling wire paths at all — either way "0 findings" would be a scan'
      + '\nthat read nothing, which must not report as clean (#4932). Fix the extraction; never lower'
      + '\nthe floor to match a number you have not explained.\n');
    return true;
  }
  return false;
}

function printFlags(flags) {
  console.error('\n✗ Route spellings taught in prose differ from the ledger rows they shape-match (#11050):\n');
  for (const f of flags) {
    console.error(`  ${f.file}:${f.line}`);
    console.error(`    teaches:   ${f.literal}`);
    console.error(`    ledger:    ${f.route.path}   (${f.route.ledger} ledger)`);
    for (const m of f.misses) console.error(`    differs:   segment ${m.index + 1}: '${m.prose}' vs '${m.row}'`);
  }
  console.error(`\n${flags.length} flagged literal(s). Teach the ledger row's spelling; if the ledger row itself is`
    + '\nwrong, fix the ledger first and let the prose follow. A runtime TOLERANCE for an old spelling'
    + '\n(e.g. the dispatch()-side plural of /meta/object/:name/state/:field, kept by the 2026-08-17'
    + '\nmaintainer re-weigh) does not make the old spelling the one to teach — and this gate says'
    + '\nnothing about what the runtime answers, only about what the docs teach. Prose that must show'
    + `\na non-canonical spelling on purpose carries '${ALLOW_MARKER}' on its line or the line above.\n`);
}

function printSummary(r, { advisory }) {
  const roots = [...r.perRootCounts.entries()].map(([k, v]) => `${k}=${v}`).join(' ');
  console.log(`route-spelling: ${r.occurrences.length} /api/v1 literal(s) across ${r.fileCount} files (${roots}); `
    + `authority: ${r.ledgerCounts.routes} ledger rows + ${r.ledgerCounts.families} wildcard families; `
    + `${r.stats.exact} exact, ${r.stats.family} family-covered, ${r.stats.surface} surface mentions, `
    + `${r.stats.allowed} allowed, ${r.stats.unmatched} unmatched, ${r.flags.length} flagged.`);
  if (r.unmatched.size) {
    console.log(`\n  ${r.unmatched.size} distinct unmatched literal(s) — no ledger row of that shape; recorded, not judged`
      + ' (real routes outside the two ledgers, generic pattern teaching, deliberate examples):');
    for (const [lit, site] of [...r.unmatched.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
      console.log(`    ${lit}   (${site})`);
    }
  }
  if (advisory && r.flags.length === 0) {
    console.log('\n✓ route-spelling guard (advisory): population clean — every shape-matched literal spells its ledger row.');
  } else if (!advisory && r.flags.length === 0) {
    console.log('\n✓ route-spelling guard: population clean — every shape-matched literal spells its ledger row.');
  }
}

// ── Self-test ───────────────────────────────────────────────────────────────

/** Findings cost an exit only in enforce mode; hard errors are not findings
 * and never reach this decision. */
function exitCodeFor(flagCount, advisory) {
  return flagCount > 0 && !advisory ? 1 : 0;
}

// The wiring is asserted against a real temporary tree, walked by the real
// walker, judged against fixture LEDGER FILES parsed by the real parser —
// never against the regexes alone (#4913: a gate can run, stay green, and be
// structurally unable to reach the thing it claims to check).
function selfTest() {
  const failures = [];
  const expect = (label, got, want) => {
    if (got !== want) failures.push(`  ✗ self-test "${label}": expected ${JSON.stringify(want)}, got ${JSON.stringify(got)}`);
  };

  // ── Unit: extraction tidy-up ──────────────────────────────────────────────
  expect('query string is cut', tidyLiteral('/api/v1/data/task?limit=5'), '/api/v1/data/task');
  expect('sentence punctuation is trimmed', tidyLiteral('/api/v1/search).'), '/api/v1/search');
  expect('a closer that balances an opener survives', tidyLiteral('/api/v1/data/{object}'), '/api/v1/data/{object}');
  expect('an unbalanced closer is trimmed', tidyLiteral('/api/v1/search>.'), '/api/v1/search');
  expect('trailing slash is normalised away', tidyLiteral('/api/v1/meta/'), '/api/v1/meta');
  expect('bare base with slash collapses to the base', tidyLiteral('/api/v1/'), '/api/v1');

  // ── Unit: the variant relation is exactly plural + lexicon ────────────────
  expect('plural pair flags', isVariantPair('object', 'objects'), true);
  expect('es-plural pair flags', isVariantPair('view', 'viewes'), true);
  expect('lexicon pair flags (the measured third spelling)', isVariantPair('meta', 'metadata'), true);
  expect('shared-prefix words are NOT variants (measured false positive)', isVariantPair('data', 'datasources'), false);
  expect('unrelated words are NOT variants', isVariantPair('keys', 'leads'), false);

  // ── Unit: exit semantics ──────────────────────────────────────────────────
  expect('enforce mode reds on findings', exitCodeFor(1, false), 1);
  expect('advisory mode does not red on findings', exitCodeFor(1, true), 0);
  expect('clean is green in both modes', exitCodeFor(0, false) + exitCodeFor(0, true), 0);

  // ── Fixture tree ──────────────────────────────────────────────────────────
  const restLedger = [
    "export const REST_ROUTE_LEDGER = [",
    "  { route: 'GET /api/v1' },",
    "  { route: 'GET /api/v1/meta' },",
    "  { route: 'GET /api/v1/meta/types' },",
    "  { route: 'GET /api/v1/meta/:type' },",
    "  { route: 'GET /api/v1/meta/:type/:name' },",
    "  { route: 'GET /api/v1/meta/object/:name/state/:field', note: 'the route: spelled out in prose must not parse as a row' },",
    "  { route: 'GET /api/v1/data/:object' },",
    "  { route: 'GET /api/v1/data/:object/:id' },",
    "  { route: 'POST /api/v1/data/:object/query' },",
    "  { route: 'GET /api/v1/search' },",
    "  { route: 'POST /api/v1/reports/:id/run' },",
    "  { route: 'GET /api/v1/forms/:slug' },",
    "];",
  ].join('\n');
  const runtimeLedger = [
    "export const ROUTE_LEDGER = [",
    "  { route: 'GET /.well-known/objectstack', absolute: true },",
    "  { route: 'GET /health' },",
    "  { route: 'POST /automation/:name/trigger' },",
    "  { route: 'POST /actions//:action' },",
    "  { route: 'POST /actions/global/:action', servedBy: '/api/v1/actions/:object/:action' },",
    "  { route: 'GET /ui/view/:object/:type?' },",
    "  { route: '* /auth/**' },",
    "  { route: '* /ai/**' },",
    "];",
  ].join('\n');

  const goodDoc = [
    'Call `/api/v1/meta/object/:name/state/:field` for legal next states.',
    'The /api/v1/data surface is auto-generated. (see /api/v1/search).',
    'Sign in via /api/v1/auth/sign-in/email — the auth table lives elsewhere.',
    'Scoped: /api/v1/environments/env_1/meta and /api/v1/meta/ both list types.',
    'Fetch GET /api/v1/data/task?limit=5 or POST /api/v1/data/{object}/query.',
    'A bogus example: /api/v1/no-such-route answers 404.',
    'A wrong VALUE example: GET /api/v1/meta/viewes answers 400.',
    'Drivers: /api/v1/datasources/drivers is served outside these ledgers.',
    'Views: /api/v1/ui/view/customer and /api/v1/ui/view/customer/form.',
    'Probes: /api/v1/health. Global actions: POST /api/v1/actions//:action.',
  ].join('\n');
  const driftDoc = [
    'Old plural: /api/v1/meta/objects/lead/state/status still appears here.',
    'Third spelling: /api/v1/metadata/objects/lead/state/status too.',
    'Singular family: POST /api/v1/report/:id/run runs a report.',
    'Scoped drift: /api/v1/environments/env_9/meta/objects/lead/state/status.',
    `<!-- ${ALLOW_MARKER}: migration guide shows the retired spelling on purpose -->`,
    'Replace /api/v1/meta/objects/lead/state/status with the singular form.',
  ].join('\n');
  const skillDoc = [
    'Trigger flows with POST /api/v1/automation/:name/trigger.',
    'Chat lives under /api/v1/ai/chat (cloud repo).',
  ].join('\n');

  const tree = {
    'packages/rest/src/rest-route-ledger.ts': restLedger,
    'packages/runtime/src/route-ledger.ts': runtimeLedger,
    'content/docs/good.mdx': goodDoc,
    'content/docs/drift.mdx': driftDoc,
    // Release notes are out of scope by ruling — a flaggable literal here
    // must never surface.
    'content/docs/releases/v99.mdx': 'Retired: /api/v1/meta/objects/lead/state/status.',
    // Skipped directory names still apply inside a root.
    'content/docs/node_modules/x.mdx': 'Bad: /api/v1/meta/objects/lead/state/status.',
    'skills/demo/SKILL.md': skillDoc,
  };

  const cfg = {
    roots: ['content/docs', 'skills'],
    skipDirs: new Set(['node_modules', '.git', 'dist']),
    skipPaths: new Set(['content/docs/releases']),
    ledgers: [
      { label: 'rest', file: 'packages/rest/src/rest-route-ledger.ts', prefix: '', floor: 5 },
      { label: 'runtime', file: 'packages/runtime/src/route-ledger.ts', prefix: '/api/v1', floor: 5 },
    ],
    occurrenceFloors: { 'content/docs': 3, skills: 1 },
  };

  const dir = mkdtempSync(join(tmpdir(), 'doc-route-spelling-selftest-'));
  const cwd = process.cwd();
  try {
    for (const [rel, body] of Object.entries(tree)) {
      const full = join(dir, ...rel.split('/'));
      mkdirSync(dirname(full), { recursive: true });
      writeFileSync(full, body);
    }
    process.chdir(dir);

    const r = runScan(cfg);

    // ── Ledger parsing reached the real files ────────────────────────────
    expect('ledger rows parsed (12 rest + 6 runtime; servedBy and note prose are not rows)',
      r.ledgerCounts.routes, 18);
    expect('wildcard families parsed', r.ledgerCounts.families, 2);

    // ── Walk wiring ──────────────────────────────────────────────────────
    expect('corpus files walked (releases/ and node_modules/ excluded)', r.fileCount, 3);
    expect('no verdict came from the releases tree',
      r.flags.some((f) => f.file.includes('releases')), false);
    expect('no verdict came from node_modules',
      r.flags.some((f) => f.file.includes('node_modules')), false);

    // ── The teeth: measured drift class flags, by name ───────────────────
    expect('flag count', r.flags.length, 4);
    const flagged = r.flags.map((f) => f.literal).sort();
    expect('the plural flags', flagged.includes('/api/v1/meta/objects/lead/state/status'), true);
    expect('the third spelling flags (invisible to a plural grep)',
      flagged.includes('/api/v1/metadata/objects/lead/state/status'), true);
    expect('a singular of a plural route family flags', flagged.includes('/api/v1/report/:id/run'), true);
    expect('the scoped mirror does not hide drift',
      flagged.includes('/api/v1/environments/env_9/meta/objects/lead/state/status'), true);
    const stateFlags = r.flags.filter((f) => f.literal.endsWith('/state/status'));
    expect('every state flag names the canonical ledger row',
      stateFlags.every((f) => f.route.path === '/api/v1/meta/object/:name/state/:field'), true);
    expect('the flag carries which segments differ',
      stateFlags.some((f) => f.misses.some((m) => m.prose === 'objects' && m.row === 'object')), true);

    // ── Precision pins: what must NOT flag ───────────────────────────────
    expect('exact literals pass', r.stats.exact >= 10, true);
    expect('a wrong VALUE at a parameter position is not this gate’s business (meta/viewes)',
      r.flags.some((f) => f.literal.includes('viewes')), false);
    expect('an unknown shape is recorded, never flagged (no-such-route)',
      r.unmatched.has('/api/v1/no-such-route'), true);
    expect('datasources does not near-miss data (the measured false positive)',
      r.flags.some((f) => f.literal.includes('datasources')), false);
    expect('datasources lands in unmatched instead', r.unmatched.has('/api/v1/datasources/drivers'), true);
    expect('family prefixes cover their subtrees (auth, ai)', r.stats.family, 2);
    expect('a bare surface mention passes (the /api/v1/data surface)', r.stats.surface >= 1, true);
    expect('the allow marker suppresses the line below it', r.stats.allowed, 1);
    expect('an optional-param row matches both arities (ui/view)',
      r.unmatched.has('/api/v1/ui/view/customer') || r.unmatched.has('/api/v1/ui/view/customer/form'), false);
    expect('the empty-segment route matches (actions//:action)',
      r.unmatched.has('/api/v1/actions//:action'), false);

    // ── Red/green: dead root (#4916) ─────────────────────────────────────
    renameSync(join(dir, 'skills'), join(dir, 'skills-renamed'));
    let deadErr = null;
    try { runScan(cfg); } catch (err) { deadErr = err; }
    renameSync(join(dir, 'skills-renamed'), join(dir, 'skills'));
    expect('a renamed root is red', deadErr instanceof DeadRootError, true);
    expect('the failure names the dead root only', deadErr?.roots?.join(','), 'skills');

    // ── Red/green: empty root (#4932) ────────────────────────────────────
    const skillPath = join(dir, 'skills', 'demo', 'SKILL.md');
    rmSync(skillPath);
    let emptyErr = null;
    try { runScan(cfg); } catch (err) { emptyErr = err; }
    writeFileSync(skillPath, skillDoc);
    expect('a root with no files is red', emptyErr instanceof EmptyRootError, true);
    expect('the failure names the empty root only', emptyErr?.roots?.join(','), 'skills');

    // ── Red/green: extractor evaporation (the occurrence floor) ──────────
    writeFileSync(skillPath, 'No wire paths taught here any more.');
    let floorErr = null;
    try { runScan(cfg); } catch (err) { floorErr = err; }
    writeFileSync(skillPath, skillDoc);
    expect('a root whose literals evaporate is red', floorErr instanceof OccurrenceFloorError, true);
    expect('the floor failure names the root', floorErr?.root, 'skills');

    // ── Red/green: the authority itself (#4932 applied to the ledgers) ───
    const restPath = join(dir, 'packages', 'rest', 'src', 'rest-route-ledger.ts');
    renameSync(restPath, `${restPath}.moved`);
    let ledgerGone = null;
    try { runScan(cfg); } catch (err) { ledgerGone = err; }
    renameSync(`${restPath}.moved`, restPath);
    expect('a missing ledger is red, not an empty route set', ledgerGone instanceof LedgerError, true);
    expect('the failure names the ledger', ledgerGone?.label, 'rest');

    writeFileSync(restPath, restLedger.replace(/route:/g, 'route :x'));
    let ledgerBlind = null;
    try { runScan(cfg); } catch (err) { ledgerBlind = err; }
    writeFileSync(restPath, restLedger);
    expect('a ledger the parser can no longer read fails its floor', ledgerBlind instanceof LedgerError, true);

    // ...and the fixture is restored: the same scan is green again, so every
    // red above was caused by the mutation and nothing else.
    const r2 = runScan(cfg);
    expect('restoring the tree restores the verdicts', r2.flags.length, r.flags.length);
  } finally {
    process.chdir(cwd);
    rmSync(dir, { recursive: true, force: true });
  }

  if (failures.length) {
    console.error(`\n✗ check-doc-route-spelling self-test failed:\n${failures.join('\n')}\n`);
    process.exit(1);
  }
  console.log('✓ check-doc-route-spelling self-test: extraction tidy-up, the variant relation (plural + '
    + 'pinned lexicon, no prefix heuristic), walk wiring (releases/ and node_modules/ out, both roots in), '
    + 'ledger parsing (absolute rows unprefixed, wildcard families, servedBy/note prose not rows), the '
    + 'measured drift class flagging by name (plural, the metadata third spelling, a singularised family, '
    + 'the scoped mirror), the precision pins (values, unknown shapes, datasources vs data, families, '
    + 'surface mentions, the allow marker, optional and empty segments), and every hard-error direction '
    + '(dead root, empty root, evaporated extraction, missing and unreadable ledger — each red naming its '
    + 'subject, green again on restore) all hold.');
}

// ── Main ────────────────────────────────────────────────────────────────────

function main() {
  if (process.argv.includes('--self-test')) return selfTest();
  const advisory = process.argv.includes('--advisory');

  let result;
  try {
    result = runScan(REAL_CONFIG);
  } catch (err) {
    if (printHardError(err)) process.exit(1);
    throw err;
  }

  if (result.flags.length) {
    printFlags(result.flags);
    if (advisory) {
      console.error('ADVISORY (#11050): not enforced yet — this run exits 0. These findings are what '
        + 'the gate will fail on once the maintainer strengthens it; fix them with the ledger spelling '
        + `or mark deliberate teaching with '${ALLOW_MARKER}'.\n`);
    }
  }
  printSummary(result, { advisory });
  process.exit(exitCodeFor(result.flags.length, advisory));
}

main();
