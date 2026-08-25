#!/usr/bin/env node
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Page declaration shape (#11576) -- every page that REACHES the kernel must be
 * declared in a shape page discovery can SEE.
 *
 *   node scripts/check-page-declaration-shape.mjs
 *   node scripts/check-page-declaration-shape.mjs --self-test
 *
 * ## Ground truth vs the approximation the per-package gates scan for
 *
 * What makes something a served page is membership in a manifest bundle's
 * `pages: [...]` array -- NOT its declaration's type annotation. Verified
 * against the kernel's own read path rather than against prose: both seams that
 * admit a page (`registerApp` at the manifest, and the nested-plugin seam in
 * `registerPlugin`) funnel into ONE body, `registerMetadataCollections`, which
 * reads `source[key]` for each key of `METADATA_ARRAY_KEYS` -- `'pages'` among
 * them -- and hands each entry to `registerItem('page', ...)`. There is no third
 * entry route. `definePage()` is not one: it is `PageSchema.parse()`, an
 * authoring-time door whose RESULT still has to land in a `pages:` array to be
 * served.
 *
 * The canonical-envelope gates (#11255 -> #11480) discover their population by
 * EXPORT SHAPE instead -- `export const X: Page =`, scanned from comment-
 * stripped source. That is an approximation of the ground truth above, and
 * #11480 measured it failing on a live page: `MarketplaceInstalledPage` was
 * authored as a plain `export const MarketplaceInstalledPage = { ... }` with
 * per-field `as const` and no `: Page`, while reaching the kernel through
 * `MARKETPLACE_INSTALLED_UI_BUNDLE.pages`. The scan could not see it, so the
 * gate that exists to cover that wire path silently covered one page fewer.
 *
 * This gate closes the CLASS by making the approximation exact by construction:
 * walk the ground truth (`pages:` arrays), and demand every entry be declared in
 * a shape the export-shape scan can reach. Then "the scan sees every page" stops
 * being a property that happens to hold and becomes one that cannot stop
 * holding without this gate reddening.
 *
 * ## What counts as discoverable, and why there are two doors
 *
 *   export const X: Page = { ... }        the annotation the sibling gates scan
 *   export const X = definePage({ ... })  the parsing door
 *
 * Both are accepted because both are discoverable by a source scan AND both
 * carry a type commitment. `definePage()` is the stronger of the two -- it runs
 * `PageSchema.parse()` at authoring time, so it refuses a malformed page outright
 * rather than merely typing it -- and it is what every `examples/` page uses. A
 * gate that accepted only the annotation would have demanded 29 example pages
 * abandon the parsing door for a weaker one, which is the opposite of the
 * card's intent.
 *
 * ## Why only IDENTIFIER entries are judged
 *
 * Measured over the tree at the ref that landed this gate, `pages:` array entries
 * fall in exactly three classes:
 *
 *   identifier      34   `pages: [MarketplaceInstalledPage]` -- the real carriers
 *   inline literal  62   ALL of them in `packages/spec/src/conversions/registry.ts`,
 *                        inside `fixture: { before/after }` -- migration fixtures,
 *                        which reach no kernel and declare nothing
 *   string          181  `pages: ['showcase_index', ...]` -- a BOOK's page-NAME
 *                        list (`book.zod.ts`) and doc-site nav. A string is a
 *                        reference, never a declaration
 *
 * So judging identifier entries catches 100% of the real population and admits
 * 0% of the noise -- and it does so by CONSTRUCTION rather than by an exclusion
 * list that would rot: a fixture literal is anonymous, and an anonymous literal
 * has no declaration to be discoverable at. If a real bundle ever inlines a page
 * literal instead of naming it, that page is equally invisible to the export-
 * shape scan; `--self-test` pins that this gate does not pretend otherwise, and
 * `inlineLiteralSites()` is exported so the count can be re-measured rather than
 * remembered.
 *
 * ## The limit this gate CANNOT see, stated rather than hidden
 *
 * A computed carrier -- `pages: Object.values(pages)` in
 * `examples/app-crm/objectstack.config.ts` -- names no entry in source, so no
 * source scan (this one, or the one the card proposes) can enumerate it. Its one
 * page reaches the kernel through `definePage()` and so is discoverable anyway,
 * but that is a fact about today's tree, not a property this gate holds.
 * `computedCarrierSites()` is exported and reported in the success summary so
 * the blind spot stays counted instead of forgotten.
 *
 * ## Comment masking
 *
 * Via the shared `scripts/js-comment-mask.mjs` -- never a private
 * `stripComments`. Its header carries the measurement (16 files where a naive
 * regex and a regex-blind scanner disagree with a real parser, 15 of them in the
 * FABRICATES direction). A `pages:` array quoted in a docblock is prose, and an
 * `export const X: Page =` quoted in one -- both sibling gates' headers do quote
 * it -- is not a declaration.
 */

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { isEntrypoint } from './invoked-as.mjs';
import { maskComments } from './js-comment-mask.mjs';

const ROOT = new URL('..', import.meta.url).pathname;

/**
 * The roots this gate walks, spelled as SUBTREE GLOBS.
 *
 * The glob spelling is load-bearing twice, and neither reason is cosmetic:
 *
 *  1. It is what the population actually is. A page carrier is any workspace
 *     TypeScript source -- `packages/mcp/src/connect-ui.ts` (a plugin bundle),
 *     `examples/app-showcase/objectstack.config.ts` (a stack config at the
 *     package ROOT, not under `src/`). There is no narrower TRUE spelling, and a
 *     narrower false one would be a gate that reports clean over files it never
 *     opened.
 *
 *  2. It keeps this gate NAMEABLE by the PM dispatch derivation. A bare
 *     single-segment literal (`'packages'`) builds no watch hint at all
 *     (`extractWatchHints` refuses a separator-less word as too generic), so a
 *     gate spelled that way lands invisible to every dispatch brief and owes a
 *     row to one of two shrink-only ledgers -- `ESCAPABLE_LITERAL_LEDGER` in
 *     `scripts/pm/dispatch-gates.mjs`, or the `TRIAGE` map in
 *     `scripts/pm/bare-root-worklist.mjs`. Spelled WITH the separator the
 *     literal reaches the hint set, the declaration is true, and neither ledger
 *     is owed a line: `escapableLiteralRows` skips any hint containing `/`, and
 *     `bareRootLiterals` skips any literal `extractWatchHints` can already see.
 *     This is the ROOT_DIR_WATCH_HINTS idiom (`check-role-word.mjs`) discharged
 *     BY CONSTRUCTION -- one spelling, so the declaration cannot drift from the
 *     scan the way a hand-maintained sibling list can.
 *
 * ⛔ Do not respell these as bare words to "simplify" the walk. That trades a
 * true declaration for a ledger row and an invisible gate.
 */
const PAGE_CARRIER_GLOBS = ['packages/**', 'examples/**', 'apps/**'];

/** The walk roots, DERIVED from the globs above so the two cannot disagree. */
function carrierRoots() {
  return PAGE_CARRIER_GLOBS.map((g) => g.replace(/\/\*+$/, ''));
}

const SKIP_DIRS = new Set(['node_modules', 'dist', '.turbo', 'coverage', 'build', '.next']);

/** A test file, judged by filename infix -- the spelling the sibling gates use. */
function isTestFile(name) {
  return /\.(test|spec)\.[cm]?tsx?$/.test(name);
}

function walk(dir, out) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const e of entries) {
    if (SKIP_DIRS.has(e)) continue;
    const p = join(dir, e);
    let s;
    try {
      s = statSync(p);
    } catch {
      continue;
    }
    if (s.isDirectory()) walk(p, out);
    else if (/\.[cm]?tsx?$/.test(e) && !isTestFile(e)) out.push(p);
  }
  return out;
}

/** Every non-test TypeScript source under the declared roots, repo-relative. */
export function sourceFiles(root = ROOT) {
  const out = [];
  for (const r of carrierRoots()) {
    const abs = join(root, r);
    if (existsSync(abs)) walk(abs, out);
  }
  return out.map((p) => p.slice(root.length).replace(/^\/+/, '')).sort();
}

// ---------------------------------------------------------------------------
// Source-shape primitives
// ---------------------------------------------------------------------------

/**
 * The index of the bracket/brace/paren closing the one that opens at `open`.
 * Quote-aware, so a bracket inside a string cannot close a span early.
 * Returns -1 when the span never closes.
 */
export function matchBracket(source, open) {
  let depth = 0;
  let quote = null;
  for (let i = open; i < source.length; i++) {
    const c = source[i];
    if (quote) {
      if (c === '\\') { i++; continue; }
      if (c === quote) quote = null;
      continue;
    }
    if (c === "'" || c === '"' || c === '`') { quote = c; continue; }
    if (c === '[' || c === '{' || c === '(') depth++;
    else if (c === ']' || c === '}' || c === ')') {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/** Top-level comma-separated entries of an array body. */
export function splitEntries(body) {
  const out = [];
  let depth = 0;
  let quote = null;
  let cur = '';
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (quote) {
      cur += c;
      if (c === '\\') { cur += body[++i] ?? ''; continue; }
      if (c === quote) quote = null;
      continue;
    }
    if (c === "'" || c === '"' || c === '`') { quote = c; cur += c; continue; }
    if (c === '[' || c === '{' || c === '(') depth++;
    if (c === ']' || c === '}' || c === ')') depth--;
    if (c === ',' && depth === 0) { out.push(cur); cur = ''; continue; }
    cur += c;
  }
  if (cur.trim()) out.push(cur);
  return out.map((e) => e.trim()).filter(Boolean);
}

const IDENTIFIER = /^[A-Za-z_$][\w$]*$/;

/** `pages: [ ... ]` array literals in one MASKED source, with their entries. */
export function pagesArrays(masked) {
  const sites = [];
  // The leading class refuses `.pages: `-style member spellings and any word
  // ending in `pages` (`subpages:`), so only a genuine `pages:` key matches.
  for (const m of masked.matchAll(/(^|[^\w$.])pages\s*:\s*\[/g)) {
    const open = masked.indexOf('[', m.index);
    if (open < 0) continue;
    const close = matchBracket(masked, open);
    if (close < 0) continue;
    sites.push({
      index: open,
      line: masked.slice(0, open).split('\n').length,
      entries: splitEntries(masked.slice(open + 1, close)),
    });
  }
  return sites;
}

/**
 * Every `export const X = ...` in one MASKED source, classified by the door its
 * initializer takes. `annotated` and `definePage` are the discoverable doors.
 */
export function pageDeclarations(masked) {
  const out = [];
  for (const m of masked.matchAll(/export\s+const\s+([A-Za-z_$][\w$]*)\s*(:\s*Page\s*)?=\s*([^\s;]{0,12})/g)) {
    const [, name, annotation, head] = m;
    out.push({
      name,
      line: masked.slice(0, m.index).split('\n').length,
      door: annotation ? 'annotated' : /^definePage\s*\(/.test(head) ? 'definePage' : 'raw',
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// The scan
// ---------------------------------------------------------------------------

export function scan(root = ROOT) {
  const files = sourceFiles(root);
  const declarations = new Map();
  const carriers = [];
  let inlineLiterals = 0;
  let stringEntries = 0;
  const inlineLiteralFiles = new Set();

  for (const rel of files) {
    const masked = maskComments(readFileSync(join(root, rel), 'utf8'));
    for (const d of pageDeclarations(masked)) {
      // First declaration wins; a duplicate export name across packages is a
      // different defect and not this gate's to judge.
      if (!declarations.has(d.name)) declarations.set(d.name, { ...d, file: rel });
    }
    for (const site of pagesArrays(masked)) {
      for (const entry of site.entries) {
        if (/^['"`]/.test(entry)) { stringEntries++; continue; }
        if (/^\{/.test(entry)) { inlineLiterals++; inlineLiteralFiles.add(rel); continue; }
        if (IDENTIFIER.test(entry)) carriers.push({ file: rel, line: site.line, name: entry });
      }
    }
  }

  const findings = [];
  for (const c of carriers) {
    const decl = declarations.get(c.name);
    if (decl && (decl.door === 'annotated' || decl.door === 'definePage')) continue;
    findings.push({ ...c, decl });
  }

  return {
    files: files.length,
    carriers,
    findings,
    declarations,
    inlineLiterals,
    inlineLiteralFiles: [...inlineLiteralFiles].sort(),
    stringEntries,
  };
}

/** Re-measurable counts for the two classes the header prices. */
export function inlineLiteralSites(root = ROOT) {
  const s = scan(root);
  return { count: s.inlineLiterals, files: s.inlineLiteralFiles };
}

/**
 * `pages:` carriers whose entries are COMPUTED, so no source scan can enumerate
 * them. Reported, never failed on -- see the header's limit section.
 *
 * The recognizer is deliberately NARROW: it admits only the `Object.*`
 * collection accessors, which yield the page VALUES themselves. Two shapes look
 * similar and are refused, because naming either would be a fabricated lead --
 * worse than the blind spot it claims to price:
 *
 *   pages: z.array(PageSchema)   a SCHEMA declaration (`stack.zod.ts`), which
 *                                describes the key; it carries no page
 *   pages: count(config.pages)   a numeric SUMMARY (`cli/utils/format.ts`),
 *                                sitting in an object whose sibling keys are
 *                                the real collection names -- so "has manifest
 *                                siblings" cannot separate it, and only the
 *                                expression's own shape can
 *
 * Both directions are pinned by `--self-test`; widening this regex without
 * adding the refusal case is how the summary starts inventing blind spots.
 */
export function computedCarrierSites(root = ROOT) {
  const out = [];
  for (const rel of sourceFiles(root)) {
    const masked = maskComments(readFileSync(join(root, rel), 'utf8'));
    for (const m of masked.matchAll(/(^|[^\w$.])pages\s*:\s*(Object\.(?:values|entries|freeze)\s*\()/g)) {
      out.push({ file: rel, line: masked.slice(0, m.index).split('\n').length, expr: m[2].trim() });
    }
  }
  return out;
}

function findingMessage({ file, line, name, decl }) {
  if (!decl) {
    return `${file}:${line}: \`${name}\` reaches the kernel through this \`pages:\` array, but no `
      + '`export const` declaration for it was found under the scanned roots. Declare it as '
      + `\`export const ${name}: Page = { ... }\` (or via \`definePage()\`) in a scanned source.`;
  }
  return `${file}:${line}: \`${name}\` reaches the kernel through this \`pages:\` array, but it is `
    + `declared at ${decl.file}:${decl.line} as a bare \`export const ${name} = { ... }\` — no `
    + '`: Page` annotation and not through `definePage()`. The export-shape scan the '
    + 'canonical-envelope gates (#11255, #11480) discover pages with CANNOT SEE it, so that page '
    + `ships uncovered. Annotate it — \`export const ${name}: Page = { ... }\` — or author it `
    + `through \`definePage({ ... })\`.`;
}

// ---------------------------------------------------------------------------
// Self-test
// ---------------------------------------------------------------------------

function selfTest() {
  let failed = 0;
  const t = (label, ok) => {
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}`);
    if (!ok) failed++;
  };

  // The judgement under test, run over a synthetic source rather than the tree:
  // a clean tree is the fixed point of a weakened rule, so production green can
  // never witness this.
  const judge = (source) => {
    const masked = maskComments(source);
    const decls = new Map();
    for (const d of pageDeclarations(masked)) if (!decls.has(d.name)) decls.set(d.name, d);
    const bad = [];
    for (const site of pagesArrays(masked)) {
      for (const e of site.entries) {
        if (!IDENTIFIER.test(e)) continue;
        const d = decls.get(e);
        if (!d || (d.door !== 'annotated' && d.door !== 'definePage')) bad.push(e);
      }
    }
    return bad;
  };

  // ── The red case the card asks for ────────────────────────────────────────
  t('an un-annotated raw-literal page in a bundle `pages:` array is FOUND (the '
    + '#11480 shape: `export const X = { ... }` reaching the kernel)',
    judge(`
      export const ConnectPage = { name: 'connect', regions: [] };
      export const BUNDLE = { id: 'b', pages: [ConnectPage] };
    `).join(',') === 'ConnectPage');

  // ── The two discoverable doors ────────────────────────────────────────────
  t('the `: Page` annotation clears it', judge(`
      export const P: Page = { name: 'p', regions: [] };
      export const BUNDLE = { pages: [P] };
    `).length === 0);
  t('`definePage()` clears it too — the parsing door is stronger than the '
    + 'annotation, not weaker, and every examples/ page uses it', judge(`
      export const P = definePage({ name: 'p', regions: [] });
      export const BUNDLE = { pages: [P] };
    `).length === 0);

  // ── Comment masking, both directions ──────────────────────────────────────
  t('a `pages:` array MENTIONED in a docblock does not count as a carrier — the '
    + 'sibling gates\' own headers quote one', judge(`
      /** Registered as \`pages: [GhostPage]\` by the plugin. */
      export const GhostPage = { name: 'g' };
    `).length === 0);
  t('…and a `// pages: [X]` line comment does not either', judge(`
      // pages: [GhostPage]
      export const GhostPage = { name: 'g' };
    `).length === 0);
  t('a `: Page` annotation quoted in PROSE does not make a raw literal '
    + 'discoverable — the fabrication direction, where a gate reads a docblock '
    + 'as a declaration and reports clean over a real hole', judge(`
      /** Authored as \`export const P: Page = { ... }\` — see #11480. */
      export const P = { name: 'p' };
      export const BUNDLE = { pages: [P] };
    `).join(',') === 'P');

  // ── The noise classes, refused by construction ────────────────────────────
  t('a BOOK\'s page-NAME list is ignored — a string is a reference, never a '
    + 'declaration (`pages: [\'showcase_index\']`, book.zod.ts)',
    judge(`export const BOOK = { groups: [{ pages: ['showcase_index', 'tour'] }] };`).length === 0);
  t('an inline object literal is not judged — every one in the tree is a '
    + 'migration fixture, and an anonymous literal has no declaration to be '
    + 'discoverable at', judge(`
      export const CONVERSION = { fixture: { before: { pages: [{ name: 'crm_home' }] } } };
    `).length === 0);
  t('a `subpages:`/member spelling is not mistaken for the manifest key',
    judge(`export const X = { subpages: [Ghost] }; const y = a.pages[0];`).length === 0);

  // ── The computed-carrier recognizer, both directions ─────────────────────
  const computed = computedCarrierSites();
  t('the computed-carrier recognizer finds the one real unenumerable carrier '
    + '(`pages: Object.values(pages)`, examples/app-crm/objectstack.config.ts)',
    computed.length === 1 && computed[0].file === 'examples/app-crm/objectstack.config.ts');
  t('…and refuses a zod SCHEMA declaration and a numeric SUMMARY — both spell '
    + '`pages: <call>` and neither carries a page, so counting them would '
    + 'fabricate blind spots the tree does not have',
    !computed.some((c) => c.file.endsWith('.zod.ts') || c.file.endsWith('utils/format.ts')));

  // ── Primitives ────────────────────────────────────────────────────────────
  t('matchBracket is quote-aware — a `]` inside a string cannot close the array',
    (() => {
      const s = `[ 'a]b', C ]`;
      return splitEntries(s.slice(1, matchBracket(s, 0))).join('|') === "'a]b'|C";
    })());
  t('splitEntries splits at TOP level only — a nested array/object stays one entry',
    splitEntries(`A, { pages: [X, Y] }, B`).length === 3);

  // ── The live tree, through the SAME pass production runs ──────────────────
  const live = scan();
  t(`the walk reaches a real population (${live.files} sources, ${live.carriers.length} `
    + 'identifier entries) — a gate that silently reads nothing is green forever',
    live.files > 500 && live.carriers.length >= 30);
  t('every live carrier resolves to a declaration this scan can see — the '
    + 'recognizer reaches REAL exports across package boundaries, not just fixtures',
    live.carriers.every((c) => live.declarations.has(c.name)));
  t('…and the annotated door is actually exercised on the tree (the sibling '
    + 'gates\' five pages), so this is not a definePage-only rule',
    live.carriers.some((c) => live.declarations.get(c.name)?.door === 'annotated'));
  t('…and so is the definePage door', 
    live.carriers.some((c) => live.declarations.get(c.name)?.door === 'definePage'));

  // ── The declared population, held mechanically ────────────────────────────
  t('every declared glob names a root this gate really walks — a declaration '
    + 'that can drift from the scan is worse than none',
    carrierRoots().every((r) => existsSync(join(ROOT, r))));
  t('…and every declared glob carries a separator, so the PM derivation can SEE '
    + 'it and neither shrink-only bare-root ledger is owed a row',
    PAGE_CARRIER_GLOBS.every((g) => g.includes('/')));

  console.log(failed ? `\ncheck-page-declaration-shape --self-test: ${failed} FAILED` : '\ncheck-page-declaration-shape --self-test: all passed');
  return failed === 0;
}

// ---------------------------------------------------------------------------

if (isEntrypoint(import.meta.url)) {
  if (process.argv.includes('--self-test')) {
    process.exit(selfTest() ? 0 : 1);
  }
  const result = scan();
  const computed = computedCarrierSites();
  if (result.findings.length) {
    console.error(`check-page-declaration-shape: ${result.findings.length} problem(s)\n`);
    for (const f of result.findings) console.error('  • ' + findingMessage(f));
    console.error(
      '\nWhy this is a gate and not a style note: what makes something a served page is '
      + 'membership in a bundle\'s `pages:` array, not its annotation. The per-package '
      + 'canonical-envelope gates discover their population by export shape, so a page '
      + 'declared outside that shape is served but UNCOVERED — green gates over a page '
      + 'nobody audits (#11576).',
    );
    process.exit(1);
  }
  console.log(
    `check-page-declaration-shape: OK — ${result.carriers.length} page entries across `
    + `${result.files} sources under ${PAGE_CARRIER_GLOBS.join(', ')} all reach the kernel through `
    + 'a discoverable declaration (`: Page` or `definePage()`).\n'
    + `  not judged: ${result.inlineLiterals} inline literal(s) in `
    + `${result.inlineLiteralFiles.length} file(s) (migration fixtures — anonymous, so nothing to `
    + `discover), ${result.stringEntries} string page-name reference(s) (book/doc nav).\n`
    + `  blind spot: ${computed.length} computed carrier(s) no source scan can enumerate`
    + (computed.length ? ` — ${computed.map((c) => `${c.file}:${c.line}`).join(', ')}` : '') + '.',
  );
}
