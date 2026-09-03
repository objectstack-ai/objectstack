#!/usr/bin/env node
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// check-section-landing-index (#10738) -- a section landing page's
// "## What's in this module" block must enumerate its directory's meta.json
// pages, in meta.json order, in both directions.
//
//   node scripts/check-section-landing-index.mjs              # the gate
//   node scripts/check-section-landing-index.mjs --list        # the census, then the verdict
//   node scripts/check-section-landing-index.mjs --self-test   # verify the checker itself
//
// ## The defect
//
// A section's `meta.json` is the real routing source -- fumadocs builds the
// sidebar and the route order from it. The landing page's index block is
// hand-kept beside it and nothing reads the two against each other, so it
// drifts in BOTH directions, one edit at a time, and every gate stays green.
//
// Measured instances, each found by a human noticing rather than by a check:
// `runtime-services` omitted `services.sms` (#9604); `permissions` named 14 of
// 21 pages (#10339); `ai` omitted `connect-mcp`, which is meta.json's FIRST
// content page and was linked nowhere else on that page (#10737).
//
// Nothing breaks at runtime. The cost is that an index block's whole job is to
// be a trustworthy map: a reader who does not find React Pages in the list
// concludes the module has no React Pages page. `content/docs/` is also the
// corpus humans and AIs copy from, so a short list is read as a fact about the
// platform's surface. Declared = enforced.
//
// ## Check, don't generate (the #9604 precedent, re-measured here)
//
// #9604 did not derive its list -- it topped the list up by hand AND added a
// checker. That is the repo's answer to this class, and the measurement behind
// it still holds: `meta.json` carries SLUGS ONLY, so a generated block would
// have to synthesize link text from frontmatter, and doing that regresses a row
// that exists today -- `permissions/access-recipes.mdx` is titled "Who can see
// data / automation / interface" and would render as that instead of the
// curated "Access Recipes". The editorial glosses exist in no source file at
// all.
//
// So this gate reads HREFS and nothing else. Link text, glosses, bolding,
// grouping headings and `<Card>` descriptions are the page's own business --
// which is what lets one rule hold eight pages that gloss four different ways
// (`permissions` glosses 3 of 20, `ai` 8 of 8, `plugins` bolds its link text,
// the `<Card>` grids carry a `description` attribute instead).
//
// ## What opts a page in: the heading, not the rendering shape
//
// #10738 left open whether the `<Cards>`-grid sections were "a different
// object", and its own correction noted that `api/index.mdx` has BOTH a bullet
// list and a `<Cards>` block, so shape "cannot be treated as disjoint".
// Measured on this tree, shape is simply the wrong discriminator. The right one
// is the heading itself: writing `## What's in this module` is the author
// declaring "this block is the index of this module", and it is opt-in, so a
// page that means something else never acquires an obligation it did not ask
// for.
//
// Eight sections declare it -- four bullet lists (`ai`, `api`, `permissions`,
// `plugins`) and four `<Card>` grids (`automation`, `data-modeling`, `kernel`,
// `ui`) -- and the gate reads both spellings identically. The nine landing
// pages that DON'T declare it are exactly the ones a set-and-order rule would
// have been wrong about: `protocol/objectui` is a curated "For Implementers"
// reading list that mixes in `/docs/references/` links, `getting-started`'s
// "Next Steps" deliberately points OUT of its module, and `concepts`,
// `protocol`, `protocol/kernel`, `protocol/objectql`, `capabilities`,
// `deployment` and `releases` are narrative pages, not indexes. None of them is
// touched here, and none of them can be caught by accident: they would have to
// write the heading first.
//
// ## The rule, in one strength
//
// Inside the block, for the section's OWN pages:
//
//   1. every `meta.json` content page is linked at least once;
//   2. every in-section link resolves to a page `meta.json` declares;
//   3. those links, in first-appearance order, follow `meta.json` order.
//
// Order is held for all eight rather than only for the bullet lists, because it
// costs nothing to hold: seven of the eight already satisfy it, and the eighth
// (`ui`) is the drifted one this gate was written for. A weaker
// coverage-only strength for grids was considered and dropped -- it would have
// bought nothing and left the two shapes reading differently for no measured
// reason.
//
// Links pointing OUTSIDE `/docs/<section>/` are ignored entirely, never
// counted and never ordered. That is the clause that lets an editorially
// curated block stay curated: `ai`, `api`, `permissions` and `plugins` each end
// their block with cross-references into `/docs/protocol/` and
// `/docs/references/`, and all four are green.
//
// ## Refusing rather than passing
//
// This gate computes its own population, so a parse that stopped matching would
// print a confident green over a tree it never read (#4690's family). Three
// refusals close that: an empty census, a section whose block contains no
// in-section link at all, and a census smaller than `EXPECTED_MIN_SECTIONS`.
// A `meta.json` page with no file on disk is also refused -- the rule would
// otherwise demand that an author link a page that does not exist, so that is
// a meta.json defect reported as one, not an index defect.
//
import { readFileSync, readdirSync, existsSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname, relative, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

import { isEntrypoint } from './invoked-as.mjs';

// ── The self-test's own battery roster and floor (#13489) ──────────────────
//
// `failures.length === 0` used to be this self-test's ONLY success condition, so
// "every case held" and "the cases never ran" printed the same line. Closed the
// way PR #13487 validated on check-doc-authoring: what is pinned is the
// registered NAMES, not a number. Every section opens with `battery('<name>')`,
// every assertion is attributed to the battery most recently opened, and the
// floor requires the OPENED set to equal the DECLARED set with each battery at
// or above its own count.
//
// ⛔ A pinned TOTAL is not the repair: a battery dropping from 9 cases to 3
// keeps a total "right" the moment a sibling grows.
//
// The counts are a FLOOR, not an equality — adding cases is ordinary work and
// must not red. A battery BELOW its floor means cases stopped running; the
// remedy is to find what stopped registering.
const SELF_TEST_BATTERIES = Object.freeze({
  'Both shapes, in sync, are silent': 2,
  'Set, direction A: a page in meta.json with no row': 2,
  'Set, direction B: a row for a page meta.json does not declare': 1,
  'Order': 2,
  'The real `ui` defect, reproduced: the shape this gate was written for': 1,
  'Curation survives: out-of-section links are ignored, not counted': 1,
  'A sub-heading does not end the block (the `ui` "### Recipes" shape)': 2,
  'Masking: a fence cannot end the block, and neither fences nor MDX': 3,
  'meta.json shapes: index and group labels are not pages': 1,
  'Opt-in: a landing page with no heading is skipped, not judged': 1,
  'Refusals: none of these may be reported OK': 8,
  'The real run() path, over a temp fixture on disk': 7,
});

// DELETING an entry silences that battery's floor exactly as effectively as
// zeroing it, so the roster's own size is pinned too.
const SELF_TEST_BATTERY_FLOOR = 12;

// The key an assertion is filed under when no battery is open. It is not a
// declared battery, so it reds by the same set difference rather than silently
// inflating whichever battery happened to run last.
const UNATTRIBUTED_BATTERY = '(no battery open)';

const HERE = dirname(fileURLToPath(import.meta.url));
const repoRoot = () => join(HERE, '..');

/** The docs tree this gate sweeps. */
const DOCS_ROOT = 'content/docs';

/**
 * The heading that opts a landing page in. One spelling, ASCII apostrophe --
 * swept over this tree when the gate was written: eight `index.mdx` files carry
 * it, all with U+0027, no variant wording ("in this chapter"/"in this section")
 * exists anywhere under `content/docs`, and no NON-index page carries it.
 * A variant is therefore not a spelling to tolerate here; it is a page opting
 * out, and it would go unread. Widening this is a deliberate act.
 */
export const INDEX_HEADING = "What's in this module";

/**
 * The census floor. Eight sections declare the heading today. This may go UP
 * freely -- a new section that writes the heading is simply covered -- but it
 * may only go DOWN in a change that says which section stopped being an index
 * and why. Its job is to catch the silent direction: a block parser that
 * stopped matching reports every remaining section green, and without a floor
 * a census collapsing from 8 to 1 is indistinguishable from a clean run.
 */
export const EXPECTED_MIN_SECTIONS = 8;

/** Directories that are never a docs section. */
const SKIP_DIRS = new Set(['node_modules', 'dist', 'build', '.turbo', '.next']);

// ---------------------------------------------------------------------------
// Reading

/**
 * Every directory under `docsRoot` holding BOTH a `meta.json` and an
 * `index.mdx`, as section ids (`ui`, `kernel/runtime-services`).
 */
export function findSections(docsRoot) {
  const out = [];
  const walk = (dir) => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (!e.isDirectory() || SKIP_DIRS.has(e.name)) continue;
      const p = join(dir, e.name);
      if (existsSync(join(p, 'meta.json')) && existsSync(join(p, 'index.mdx'))) {
        out.push(relative(docsRoot, p).split(sep).join('/'));
      }
      walk(p);
    }
  };
  walk(docsRoot);
  return out.sort();
}

/**
 * The content pages a `meta.json` declares, in order.
 *
 * `index` is the landing page itself and `---Group---` entries are sidebar
 * group labels, not pages -- `ui/meta.json` carries a `---Recipes---` label, so
 * its 17-entry array is 15 content pages. Both are dropped here rather than at
 * the call sites, so a caller cannot forget one.
 */
export function readMetaPages(metaText) {
  const meta = JSON.parse(metaText);
  const raw = Array.isArray(meta.pages) ? meta.pages : null;
  if (!raw) return { pages: null, reason: 'meta.json has no "pages" array' };
  const pages = raw.filter((p) => typeof p === 'string' && p !== 'index' && !p.startsWith('---'));
  return { pages, reason: null };
}

/**
 * Blank out fenced code and MDX expression comments before the block is read.
 *
 * Both directions matter. A fence containing a `## ` line would end the block
 * early and hide every row after it; a link inside a fence or inside a
 * commented-out row is text a reader never sees, and counting it would let a
 * commented-out row satisfy the gate. Replaced with same-length blanks rather
 * than removed, so line numbers still address the real file.
 */
export function maskNonProse(src) {
  const blank = (m) => m.replace(/[^\n]/g, ' ');
  return src
    .replace(/^([ \t]*)(```+|~~~+)[^\n]*\n[\s\S]*?^\1\2[^\n]*$/gm, blank)
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, blank);
}

/**
 * The lines of the index block: everything after the heading up to the next
 * heading of the SAME OR HIGHER level, or a thematic break, or end of file.
 *
 * Same-or-higher on purpose. `ui/index.mdx` splits its block with a `### Recipes`
 * sub-heading and four more rows under it, matching the `---Recipes---` group
 * label in its meta.json; stopping at the next heading of ANY level would drop
 * those four rows and report them missing.
 *
 * @returns {{ start: number, end: number, text: string } | null} 1-based line span
 */
export function readIndexBlock(src) {
  const masked = maskNonProse(src);
  const lines = masked.split('\n');
  const heading = new RegExp(`^##\\s+${INDEX_HEADING.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`);
  const start = lines.findIndex((l) => heading.test(l));
  if (start === -1) return null;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (/^#{1,2}\s+\S/.test(lines[i]) || /^(-{3,}|\*{3,}|_{3,})\s*$/.test(lines[i])) {
      end = i;
      break;
    }
  }
  return { start: start + 1, end, text: lines.slice(start + 1, end).join('\n') };
}

/**
 * Doc links in the block, split into the section's own pages and everything
 * else. Reads both spellings -- markdown `](/docs/…)` and the `href="/docs/…"`
 * of a `<Card>` -- because the two shapes are the same object here.
 *
 * In-section slugs are deduped on FIRST appearance: a page linked twice is not
 * a defect, and first appearance is what the order rule reads.
 */
export function readBlockLinks(blockText, section) {
  const prefix = `/docs/${section}/`;
  const own = [];
  const foreign = [];
  for (const m of blockText.matchAll(/(?:\]\(|href=["'])(\/docs\/[^)"'\s#]+)/g)) {
    const url = m[1].replace(/\/+$/, '');
    if (url.startsWith(prefix)) {
      const slug = url.slice(prefix.length);
      if (!own.includes(slug)) own.push(slug);
    } else {
      foreign.push(url);
    }
  }
  return { own, foreign };
}

// ---------------------------------------------------------------------------
// The verdict, as a pure function

/**
 * Judge every section handed in.
 *
 * Pure: every input is an argument, so `--self-test` drives this exact decision
 * over mutated inputs instead of a parallel imitation of it.
 *
 * @param {{ sections: Array<{ id: string, metaText?: string, indexText?: string,
 *          filesOnDisk?: string[], error?: string }>, minSections?: number }} input
 * @returns {{ problems: string[], covered: string[], skipped: string[] }}
 */
export function judge({ sections, minSections = EXPECTED_MIN_SECTIONS }) {
  const problems = [];
  const covered = [];
  const skipped = [];

  for (const s of sections) {
    if (s.error) {
      problems.push(`${s.id}: ${s.error} -- nothing about it was verified (see #4690).`);
      continue;
    }

    const block = readIndexBlock(s.indexText ?? '');
    if (!block) {
      skipped.push(s.id);
      continue;
    }
    covered.push(s.id);

    let pages;
    try {
      const read = readMetaPages(s.metaText ?? '');
      if (!read.pages) {
        problems.push(`${s.id}: ${read.reason} -- its index block was not verified (see #4690).`);
        continue;
      }
      pages = read.pages;
    } catch (err) {
      problems.push(`${s.id}: meta.json did not parse (${err.message}) -- its index block was not verified (see #4690).`);
      continue;
    }

    // A meta.json page with no file is a meta.json defect, reported as one: the
    // set rule below would otherwise order an author to link a dead route.
    if (Array.isArray(s.filesOnDisk)) {
      const onDisk = new Set(s.filesOnDisk);
      const ghosts = pages.filter((p) => !onDisk.has(p));
      if (ghosts.length) {
        problems.push(
          `${s.id}/meta.json declares ${ghosts.length} page(s) with no file: ${ghosts.join(', ')}. ` +
            `Fix meta.json (or add the page) -- until then the index block cannot be held to it.`
        );
        continue;
      }
    }

    const { own } = readBlockLinks(block.text, s.id);

    if (own.length === 0) {
      problems.push(
        `${s.id}/index.mdx: the "## ${INDEX_HEADING}" block (lines ${block.start}-${block.end}) ` +
          `links to no /docs/${s.id}/ page at all -- an empty index is refused, never reported OK (see #4690).`
      );
      continue;
    }

    const missing = pages.filter((p) => !own.includes(p));
    if (missing.length) {
      problems.push(
        `${s.id}/index.mdx: the "## ${INDEX_HEADING}" block omits ${missing.length} page(s) ` +
          `declared in ${s.id}/meta.json: ${missing.join(', ')}. ` +
          `Add a row for each (link text is yours to write -- meta.json stores slugs only).`
      );
    }

    const undeclared = own.filter((p) => !pages.includes(p));
    if (undeclared.length) {
      problems.push(
        `${s.id}/index.mdx: the "## ${INDEX_HEADING}" block links ${undeclared.length} /docs/${s.id}/ page(s) ` +
          `that ${s.id}/meta.json does not declare: ${undeclared.join(', ')}. ` +
          `Either add them to meta.json (they are unreachable from the sidebar) or drop the rows.`
      );
    }

    if (!missing.length && !undeclared.length) {
      const expected = pages.join(' → ');
      const actual = own.join(' → ');
      if (expected !== actual) {
        problems.push(
          `${s.id}/index.mdx: the "## ${INDEX_HEADING}" block lists the right pages in the wrong order.\n` +
            `      meta.json: ${expected}\n` +
            `      the block: ${actual}`
        );
      }
    }
  }

  if (minSections > 0 && covered.length === 0) {
    problems.push(
      `No section landing page carries a "## ${INDEX_HEADING}" heading. ` +
        `Either the docs tree moved or this gate's block parser stopped matching -- ` +
        `an empty census is refused, never reported OK (see #4690).`
    );
  } else if (covered.length < minSections) {
    problems.push(
      `Only ${covered.length} section(s) carry a "## ${INDEX_HEADING}" heading; ${minSections} are expected ` +
        `(${covered.join(', ')}). If a section deliberately stopped being an index, lower ` +
        `EXPECTED_MIN_SECTIONS in this file in the same change and say which one and why.`
    );
  }

  return { problems, covered, skipped };
}

// ---------------------------------------------------------------------------
// Running against a real tree

/** Read one section's inputs off disk. */
export function readSection(docsRoot, id) {
  const dir = join(docsRoot, ...id.split('/'));
  try {
    const metaText = readFileSync(join(dir, 'meta.json'), 'utf8');
    const indexText = readFileSync(join(dir, 'index.mdx'), 'utf8');
    const filesOnDisk = [];
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (e.isFile() && e.name.endsWith('.mdx') && e.name !== 'index.mdx') {
        filesOnDisk.push(e.name.slice(0, -'.mdx'.length));
      } else if (e.isDirectory() && existsSync(join(dir, e.name, 'index.mdx'))) {
        filesOnDisk.push(e.name);
      }
    }
    return { id, metaText, indexText, filesOnDisk };
  } catch (err) {
    return { id, error: `could not be read (${err.message})` };
  }
}

/** The gate over a real docs tree. */
export function run(docsRoot) {
  const sections = findSections(docsRoot).map((id) => readSection(docsRoot, id));
  return { ...judge({ sections }), scanned: sections.length };
}

function main() {
  const docsRoot = join(repoRoot(), DOCS_ROOT);
  if (!existsSync(docsRoot)) {
    console.error(`✗ check-section-landing-index: ${DOCS_ROOT} does not exist -- nothing was verified (see #4690).`);
    process.exit(1);
  }

  const { problems, covered, skipped, scanned } = run(docsRoot);

  if (process.argv.includes('--list')) {
    console.log(`Sections with a meta.json + index.mdx: ${scanned}\n`);
    console.log(`  held to meta.json (carry "## ${INDEX_HEADING}"): ${covered.length}`);
    for (const id of covered) console.log(`    • ${id}`);
    console.log(`\n  not an index, not held: ${skipped.length}`);
    for (const id of skipped) console.log(`    · ${id}`);
    console.log('');
  }

  if (problems.length) {
    console.error(`✗ check-section-landing-index -- ${problems.length} problem(s)\n`);
    for (const p of problems) console.error(`  • ${p}`);
    console.error(
      `\n  A section's meta.json is the routing source: fumadocs builds the sidebar and the\n` +
        `  route order from it. The "## ${INDEX_HEADING}" block is the reader's map of the\n` +
        `  same set, hand-kept beside it. Link text and glosses stay hand-written on purpose\n` +
        `  (meta.json stores slugs only); only the hrefs and their order are held.\n`
    );
    process.exit(1);
  }

  console.log(
    `✓ check-section-landing-index: ${covered.length} section index block(s) enumerate their meta.json ` +
      `pages, in order, both directions (${covered.join(', ')}); ` +
      `${skipped.length} landing page(s) of ${scanned} declare no index block and are not held.`
  );
}

// ---------------------------------------------------------------------------
// Self-test

// Returned by `selfTest()` only after its verdict is printed. The dispatch
// refuses anything else: a `return` that leaves the function above that line
// prints nothing and still exits 0 — a self-test that never finished, reported
// as one that passed (#13798).
const SELF_TEST_VERDICT = 'check-section-landing-index self-test reached its verdict';

function selfTest() {
  // The battery ledger this self-test's floor is evaluated against (#13489).
  // `battery()` opens a battery; every assertion below is attributed to the one
  // most recently opened, so a section that stops running stops registering and
  // names ITSELF at the floor rather than going quiet.
  const batterySeen = new Map();
  let openBattery = null;
  const battery = (name) => {
    openBattery = name;
  };
  const registerCase = () => {
    const b = openBattery ?? UNATTRIBUTED_BATTERY;
    batterySeen.set(b, (batterySeen.get(b) ?? 0) + 1);
  };

  const failures = [];
  let checked = 0;
  const assert = (cond, what) => {
    registerCase();
    checked++;
    if (!cond) failures.push(what);
  };

  /** Build a one-section input for `judge`, so the REAL decision path runs. */
  const section = (id, pages, indexText, filesOnDisk) => ({
    id,
    metaText: JSON.stringify({ pages: ['index', ...pages] }),
    indexText,
    filesOnDisk: filesOnDisk ?? pages,
  });
  const one = (s) => judge({ sections: [s], minSections: 1 }).problems;
  const bullets = (section_, slugs) =>
    `# T\n\n## ${INDEX_HEADING}\n\n` + slugs.map((s) => `- [${s}](/docs/${section_}/${s})\n`).join('') + `\n## Related\n\n- x\n`;
  const cards = (section_, slugs) =>
    `# T\n\n## ${INDEX_HEADING}\n\n<Cards>\n` +
    slugs.map((s) => `  <Card href="/docs/${section_}/${s}" title="${s}" description="d" />\n`).join('') +
    `</Cards>\n\n## Related\n\n- x\n`;

  // ── Both shapes, in sync, are silent ──────────────────────────────────────
  battery('Both shapes, in sync, are silent');
  assert(one(section('m', ['a', 'b', 'c'], bullets('m', ['a', 'b', 'c']))).length === 0, 'a synced BULLET list is reported OK');
  assert(one(section('m', ['a', 'b', 'c'], cards('m', ['a', 'b', 'c']))).length === 0, 'a synced CARD grid is reported OK');

  // ── Set, direction A: a page in meta.json with no row ─────────────────────
  battery('Set, direction A: a page in meta.json with no row');
  for (const shape of [bullets, cards]) {
    const p = one(section('m', ['a', 'b', 'c'], shape('m', ['a', 'c'])));
    assert(p.length === 1 && /omits 1 page\(s\)/.test(p[0]) && /: b\./.test(p[0]), `a MISSING page is named (${shape === bullets ? 'bullets' : 'cards'})`);
  }

  // ── Set, direction B: a row for a page meta.json does not declare ─────────
  battery('Set, direction B: a row for a page meta.json does not declare');
  {
    const p = one(section('m', ['a', 'b'], bullets('m', ['a', 'b', 'gone']), ['a', 'b', 'gone']));
    assert(p.length === 1 && /does not declare/.test(p[0]) && /gone/.test(p[0]), 'an UNDECLARED row is named');
  }

  // ── Order ─────────────────────────────────────────────────────────────────
  battery('Order');
  {
    const p = one(section('m', ['a', 'b', 'c'], bullets('m', ['b', 'a', 'c'])));
    assert(p.length === 1 && /wrong order/.test(p[0]), 'a REORDERED block fails');
    assert(/a → b → c/.test(p[0]) && /b → a → c/.test(p[0]), 'the order failure prints both orders');
  }

  // ── The real `ui` defect, reproduced: the shape this gate was written for ──
  battery('The real `ui` defect, reproduced: the shape this gate was written for');
  {
    const uiMeta = ['apps', 'pages', 'react-pages', 'views', 'actions', 'dashboards', 'reports', 'translations', 'forms', 'doc-pages', 'setup-app'];
    const uiHas = ['apps', 'views', 'pages', 'dashboards', 'forms', 'doc-pages', 'setup-app'];
    const p = one(section('ui', uiMeta, cards('ui', uiHas)));
    assert(p.length === 1 && /react-pages/.test(p[0]) && /actions/.test(p[0]) && /reports/.test(p[0]) && /translations/.test(p[0]),
      "the pre-fix `ui` grid fails, naming all four omitted pages");
  }

  // ── Curation survives: out-of-section links are ignored, not counted ──────
  battery('Curation survives: out-of-section links are ignored, not counted');
  {
    const text = `# T\n\n## ${INDEX_HEADING}\n\n- [a](/docs/m/a)\n- [b](/docs/m/b)\n- Spec: [x](/docs/protocol/kernel/plugin-spec)\n- Ref: [y](/docs/references/kernel)\n\n## Related\n`;
    assert(one(section('m', ['a', 'b'], text)).length === 0, 'FOREIGN links are ignored, never counted or ordered');
  }

  // ── A sub-heading does not end the block (the `ui` "### Recipes" shape) ───
  battery('A sub-heading does not end the block (the `ui` "### Recipes" shape)');
  {
    const text = `# T\n\n## ${INDEX_HEADING}\n\n<Cards>\n  <Card href="/docs/m/a" title="a" />\n</Cards>\n\n### Recipes\n\n<Cards>\n  <Card href="/docs/m/b" title="b" />\n</Cards>\n\n## Related\n`;
    assert(one(section('m', ['a', 'b'], text)).length === 0, 'a `###` sub-heading does NOT truncate the block');
    const truncated = `# T\n\n## ${INDEX_HEADING}\n\n- [a](/docs/m/a)\n\n## Related\n\n- [b](/docs/m/b)\n`;
    assert(one(section('m', ['a', 'b'], truncated)).length === 1, 'a `##` heading DOES end the block, so a row after it does not count');
  }

  // ── Masking: a fence cannot end the block, and neither fences nor MDX ─────
  //     comments may satisfy a row.
  battery('Masking: a fence cannot end the block, and neither fences nor MDX');
  {
    const fenced = `# T\n\n## ${INDEX_HEADING}\n\n- [a](/docs/m/a)\n\n\`\`\`md\n## Not a heading\n\`\`\`\n\n- [b](/docs/m/b)\n\n## Related\n`;
    assert(one(section('m', ['a', 'b'], fenced)).length === 0, 'a `## ` line INSIDE a fence does not end the block');
    const inFence = `# T\n\n## ${INDEX_HEADING}\n\n- [a](/docs/m/a)\n\n\`\`\`md\n- [b](/docs/m/b)\n\`\`\`\n\n## Related\n`;
    const p = one(section('m', ['a', 'b'], inFence));
    assert(p.length === 1 && /: b\./.test(p[0]), 'a link inside a FENCE does not satisfy a row');
    const commented = `# T\n\n## ${INDEX_HEADING}\n\n- [a](/docs/m/a)\n{/* - [b](/docs/m/b) */}\n\n## Related\n`;
    const q = one(section('m', ['a', 'b'], commented));
    assert(q.length === 1 && /: b\./.test(q[0]), 'a COMMENTED-OUT row does not satisfy a row');
  }

  // ── meta.json shapes: index and group labels are not pages ────────────────
  battery('meta.json shapes: index and group labels are not pages');
  {
    const s = {
      id: 'm',
      metaText: JSON.stringify({ pages: ['index', 'a', '---Recipes---', 'b'] }),
      indexText: bullets('m', ['a', 'b']),
      filesOnDisk: ['a', 'b'],
    };
    assert(judge({ sections: [s], minSections: 1 }).problems.length === 0, '`index` and `---Group---` entries are not pages');
  }

  // ── Opt-in: a landing page with no heading is skipped, not judged ─────────
  battery('Opt-in: a landing page with no heading is skipped, not judged');
  {
    const r = judge({ sections: [{ id: 'curated', metaText: JSON.stringify({ pages: ['index', 'a', 'b'] }), indexText: `# T\n\n## For Implementers\n\n- [a](/docs/curated/a)\n`, filesOnDisk: ['a', 'b'] }], minSections: 0 });
    assert(r.problems.length === 0 && r.skipped.includes('curated') && !r.covered.includes('curated'),
      'a landing page WITHOUT the heading is skipped, not judged');
  }

  // ── Refusals: none of these may be reported OK ────────────────────────────
  battery('Refusals: none of these may be reported OK');
  {
    const empty = one(section('m', ['a'], `# T\n\n## ${INDEX_HEADING}\n\nProse, no links.\n\n## Related\n`));
    assert(empty.length === 1 && /links to no/.test(empty[0]) && /#4690/.test(empty[0]), 'an EMPTY index block is refused');

    const ghost = judge({ sections: [{ id: 'm', metaText: JSON.stringify({ pages: ['index', 'a', 'ghost'] }), indexText: bullets('m', ['a']), filesOnDisk: ['a'] }], minSections: 1 }).problems;
    assert(ghost.length === 1 && /no file/.test(ghost[0]) && /ghost/.test(ghost[0]), 'a meta.json page with NO FILE is refused as a meta.json defect');
    assert(!/omits/.test(ghost[0]), 'and it is NOT reported as a missing index row');

    const broken = judge({ sections: [{ id: 'm', metaText: '{ not json', indexText: bullets('m', ['a']), filesOnDisk: ['a'] }], minSections: 1 }).problems;
    assert(broken.length === 1 && /did not parse/.test(broken[0]) && /#4690/.test(broken[0]), 'an UNPARSEABLE meta.json is refused, never silent');

    const noPages = judge({ sections: [{ id: 'm', metaText: '{"title":"t"}', indexText: bullets('m', ['a']), filesOnDisk: ['a'] }], minSections: 1 }).problems;
    assert(noPages.length === 1 && /no "pages" array/.test(noPages[0]), 'a meta.json with no `pages` array is refused');

    const unreadable = judge({ sections: [{ id: 'm', error: 'could not be read (EACCES)' }], minSections: 0 }).problems;
    assert(unreadable.length === 1 && /#4690/.test(unreadable[0]), 'an UNREADABLE section is refused, never silent');

    const censusEmpty = judge({ sections: [{ id: 'x', metaText: '{"pages":["index","a"]}', indexText: '# T\n\nno heading\n', filesOnDisk: ['a'] }] }).problems;
    assert(censusEmpty.length === 1 && /No section landing page carries/.test(censusEmpty[0]), 'an EMPTY census is refused');

    const censusShort = judge({ sections: [section('m', ['a'], bullets('m', ['a']))] }).problems;
    assert(censusShort.length === 1 && /are expected/.test(censusShort[0]), `a census below EXPECTED_MIN_SECTIONS (${EXPECTED_MIN_SECTIONS}) is refused`);
  }

  // ── The real run() path, over a temp fixture on disk ──────────────────────
  battery('The real run() path, over a temp fixture on disk');
  const dir = mkdtempSync(join(tmpdir(), 'section-landing-'));
  try {
    const mk = (id, pages, indexText) => {
      const d = join(dir, ...id.split('/'));
      mkdirSync(d, { recursive: true });
      writeFileSync(join(d, 'meta.json'), JSON.stringify({ pages: ['index', ...pages] }));
      writeFileSync(join(d, 'index.mdx'), indexText);
      for (const p of pages) writeFileSync(join(d, `${p}.mdx`), `---\ntitle: ${p}\n---\n`);
    };
    mk('good', ['a', 'b'], bullets('good', ['a', 'b']));
    mk('bad', ['a', 'b'], cards('bad', ['a']));
    mk('curated', ['a', 'b'], `# T\n\n## For Implementers\n\n- [a](/docs/curated/a)\n`);

    const r = run(dir);
    assert(r.scanned === 3, 'run() finds every directory with meta.json + index.mdx');
    assert(r.covered.join(',') === 'bad,good', 'run() holds only the sections that declare the heading');
    assert(r.skipped.join(',') === 'curated', 'run() skips the curated landing page');
    assert(r.problems.some((p) => /^bad\/index\.mdx/.test(p) && /: b\./.test(p)), 'run() names the drifted fixture and the omitted page');
    assert(!r.problems.some((p) => /^good\//.test(p)), 'run() is silent about the synced fixture');
    assert(r.problems.some((p) => /are expected/.test(p)), 'run() applies the census floor to a real tree');

    // Nested sections are found too (`kernel/runtime-services` is real).
    mk('nest/deep', ['a'], bullets('nest/deep', ['a']));
    assert(run(dir).covered.includes('nest/deep'), 'run() finds a NESTED section');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }

  // ── The floor: every declared battery RAN, and ran its cases (#13489) ───
  //
  // Evaluated after every battery has had its chance and BEFORE the verdict, so
  // the success line below can only be printed by a run in which the set of
  // batteries that registered assertions EQUALS the set declared. A set
  // difference names WHICH battery stopped; a count says only that something did.
  const floorFailure = (message) => {
    failures.push(message);
  };
  const declaredBatteries = Object.keys(SELF_TEST_BATTERIES);
  let floorBreached = false;
  if (declaredBatteries.length < SELF_TEST_BATTERY_FLOOR) {
    floorBreached = true;
    floorFailure(
      `SELF_TEST_BATTERIES declares ${declaredBatteries.length} batteries, below the pinned ` +
        `${SELF_TEST_BATTERY_FLOOR} — a battery deleted from the roster takes its own floor with it.`,
    );
  }
  for (const [name, count] of batterySeen) {
    if (declaredBatteries.includes(name)) continue;
    floorBreached = true;
    floorFailure(
      `self-test battery "${name}" registered ${count} case(s) but is not declared in ` +
        'SELF_TEST_BATTERIES — an assertion attributed to no declared battery is one nothing floors.',
    );
  }
  for (const name of declaredBatteries) {
    const count = batterySeen.get(name) ?? 0;
    if (count >= SELF_TEST_BATTERIES[name]) continue;
    floorBreached = true;
    floorFailure(
      count === 0
        ? `self-test battery "${name}" DID NOT RUN — 0 cases registered, ${SELF_TEST_BATTERIES[name]} pinned. ` +
          'The verdict below would have claimed those cases hold.'
        : `self-test battery "${name}" registered ${count} case(s), below its pinned floor of ` +
          `${SELF_TEST_BATTERIES[name]} — cases that used to run no longer do.`,
    );
  }
  if (floorBreached) {
    floorFailure(
      'A battery at or below its floor means cases STOPPED RUNNING — the battery is the bug, not the ' +
        'number. Find what stopped registering (an early return, a deleted block, a guard that now ' +
        'skips) and restore it.',
    );
  }

  if (failures.length) {
    console.error(`✗ check-section-landing-index --self-test -- ${failures.length} failure(s)\n`);
    for (const f of failures) console.error(`  • ${f}`);
    process.exit(1);
  }
  console.log(
    `✓ check-section-landing-index --self-test: ${checked} assertions over synthetic inputs and a temp fixture ` +
      `(real judge()/run() path); every limb -- both shapes in sync, missing page, undeclared row, wrong order, the ` +
      `pre-fix \`ui\` grid, foreign-link curation, sub-heading vs same-level heading, fence and MDX-comment masking, ` +
      `\`index\`/\`---Group---\` filtering, opt-in skipping, and all seven refusals (empty block, page with no file, ` +
      `unparseable meta.json, no \`pages\` array, unreadable section, empty census, short census) -- observed FAILING and observed silent.`
  );

  return SELF_TEST_VERDICT;
}

// Exports bindings, so an import for those exports alone must run nothing (#10667).
const invokedDirectly = isEntrypoint(import.meta.url);

if (!invokedDirectly) {
  // imported as a module — expose the exports and do nothing else
} else if (process.argv.includes('--self-test')) {
    if (selfTest() !== SELF_TEST_VERDICT) {
        console.error(
            '\n✗ check-section-landing-index self-test: selfTest() returned without reaching its verdict,\n'
                + 'so no success line was printed. Exiting 0 here would report a self-test\n'
                + 'that never finished as a self-test that passed.\n',
        );
        process.exit(1);
    }
}
else main();
