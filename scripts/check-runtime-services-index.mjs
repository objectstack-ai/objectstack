#!/usr/bin/env node
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// check-runtime-services-index (#9604) -- hold the runtime-services chapter's
// two INDEX lists to the pages that actually exist.
//
//   node scripts/check-runtime-services-index.mjs
//   node scripts/check-runtime-services-index.mjs --self-test   # verify the checker itself
//
// ## What it guards
//
// `content/docs/kernel/runtime-services/` publishes one `<name>-service.mdx`
// page per documented `services.<name>` accessor, and THREE hand-written places
// claim to enumerate them:
//
//   1. `runtime-services/meta.json`  -> `pages`      (chapter nav order)
//   2. `runtime-services/index.mdx`  -> "This chapter documents ..." bullets
//   3. `kernel/index.mdx`            -> the `services.*` table
//
// None of the three is generated, so each drifts from the tree one edit at a
// time, and nothing reads them: `check:docs-audit-scope` derives WHICH pages the
// docs-accuracy audit covers, never whether an index enumerates them. #9604
// measured the result -- `services.sms` had a page, a `meta.json` entry, a
// registered slot (`sms-plugin.ts:181`) and a canonical-source row, and was
// still missing from BOTH index lists. It shipped that way and every gate was
// green. #9588 was the same page drifting on a different line.
//
// Nothing breaks at runtime; the cost is that an index page's whole job is to be
// a trustworthy map. A reader who does not find SMS in the list concludes the
// chapter has no SMS page. `content/docs/` is also the corpus humans and AIs
// copy from, so a short list is read as a fact about the platform's surface.
// Declared = enforced.
//
// ## What "derived" means here
//
// The pages on disk are the source of truth -- they are the thing a reader can
// actually open. Each page also has to declare its own accessor
// (`title: services.<name>` matching its filename), which is checked first: it
// is the premise the other three comparisons rest on, so a page that lies about
// its own name must go red here rather than silently redefine the expected set.
//
// Order is enforced too, not just membership. The chapter list currently
// follows `meta.json`'s `pages` order exactly, and that convention is the only
// thing that tells the next author WHERE a new bullet goes. Membership-only
// checking would have accepted `services.sms` appended at the end, next to a
// list whose order encodes the nav -- so the gate keeps the answer mechanical.
//
// ## Deliberately NOT checked: the "Source of Truth" list
//
// `index.mdx` carries a fourth list -- `- <Label>: \`<path>\`` canonical-source
// rows. This gate does not compare it with the pages, for two reasons:
//
//   - It is a superset by exactly one row on purpose-of-record: `Security:
//     packages/spec/src/contracts/security-service.ts` names a real, registered
//     slot (`security-plugin.ts:1157`) that this chapter has no page for, and
//     `services.security` is documented NOWHERE under `content/docs/`. Whether
//     that row should become a page, move, or be dropped is a product-surface
//     question for the maintainer (#9604 explicitly declines to guess). Encoding
//     any of the three answers here -- including as an allowlist entry -- would
//     pre-judge it.
//   - Its row labels are prose, not accessors (`Audit bridge`, `Data`), and that
//     line is under active edit.
//
// When the Security question is settled, extending this gate to that list is the
// natural follow-up; until then a green here means "the three enumerations agree
// with the tree", which is exactly what the summary line says.

import { readFileSync, readdirSync, existsSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const repoRoot = () => join(HERE, '..');

const CHAPTER_DIR = 'content/docs/kernel/runtime-services';
const KERNEL_INDEX = 'content/docs/kernel/index.mdx';
const PAGE_SUFFIX = '-service.mdx';
const META_SUFFIX = '-service';

// ---------------------------------------------------------------------------
// Derivation

/** Accessor names from the pages that exist, plus each page's declared title. */
export function readPages(chapterDir) {
  return readdirSync(chapterDir)
    .filter((f) => f.endsWith(PAGE_SUFFIX))
    .sort()
    .map((file) => {
      const name = file.slice(0, -PAGE_SUFFIX.length);
      const text = readFileSync(join(chapterDir, file), 'utf8');
      const m = /^title:\s*(.+?)\s*$/m.exec(text);
      return { name, file, title: m ? m[1] : null };
    });
}

/** `pages` entries that name a service page, in nav order. */
export function readMetaOrder(chapterDir) {
  const raw = JSON.parse(readFileSync(join(chapterDir, 'meta.json'), 'utf8'));
  const pages = Array.isArray(raw.pages) ? raw.pages : [];
  return pages.filter((p) => typeof p === 'string' && p.endsWith(META_SUFFIX)).map((p) => p.slice(0, -META_SUFFIX.length));
}

/** The "This chapter documents ..." bullets, in page order. */
export function readChapterList(indexText) {
  return [...indexText.matchAll(/^-\s+`services\.([A-Za-z0-9_]+)`\s*$/gm)].map((m) => m[1]);
}

/** Accessors linked from the `services.*` table in kernel/index.mdx, in order. */
export function readKernelTable(kernelText) {
  return [...kernelText.matchAll(/\[`services\.([A-Za-z0-9_]+)`\]\(\/docs\/kernel\/runtime-services\/([A-Za-z0-9_-]+)\)/g)]
    .map((m) => ({ accessor: m[1], href: m[2] }));
}

// ---------------------------------------------------------------------------
// Comparison

const missing = (expected, actual) => expected.filter((n) => !actual.includes(n));
const extra = (expected, actual) => actual.filter((n) => !expected.includes(n));

export function check({ pages, metaOrder, chapterList, kernelTable }) {
  const findings = [];
  const add = (where, msg) => findings.push({ where, msg });

  // 0. The premise: every page declares the accessor its filename claims.
  for (const p of pages) {
    const want = `services.${p.name}`;
    if (p.title !== want) {
      add(`${CHAPTER_DIR}/${p.file}`, `frontmatter title is ${p.title === null ? '(absent)' : `"${p.title}"`}, expected "${want}" to match the filename`);
    }
  }
  // A page that lies about its own name makes every set below meaningless.
  if (findings.length) return findings;

  const onDisk = pages.map((p) => p.name);

  // 1. meta.json <-> disk
  for (const n of missing(onDisk, metaOrder)) add(`${CHAPTER_DIR}/meta.json`, `"pages" omits "${n}${META_SUFFIX}" (${n}${PAGE_SUFFIX} exists)`);
  for (const n of extra(onDisk, metaOrder)) add(`${CHAPTER_DIR}/meta.json`, `"pages" lists "${n}${META_SUFFIX}" but ${n}${PAGE_SUFFIX} does not exist`);

  // 2. chapter list <-> disk
  for (const n of missing(onDisk, chapterList)) add(`${CHAPTER_DIR}/index.mdx`, `chapter list omits \`services.${n}\` (${n}${PAGE_SUFFIX} exists)`);
  for (const n of extra(onDisk, chapterList)) add(`${CHAPTER_DIR}/index.mdx`, `chapter list names \`services.${n}\` but ${n}${PAGE_SUFFIX} does not exist`);

  // 3. chapter list order == meta.json nav order
  const navOrder = metaOrder.filter((n) => chapterList.includes(n));
  const listed = chapterList.filter((n) => metaOrder.includes(n));
  if (navOrder.join() !== listed.join()) {
    add(`${CHAPTER_DIR}/index.mdx`, `chapter list order ${JSON.stringify(listed)} does not follow meta.json "pages" order ${JSON.stringify(navOrder)}`);
  }

  // 4. kernel/index.mdx table <-> disk, and each row's href resolves
  const linked = kernelTable.map((r) => r.accessor);
  for (const n of missing(onDisk, linked)) add(KERNEL_INDEX, `\`services.*\` table has no row for \`services.${n}\` (${n}${PAGE_SUFFIX} exists)`);
  for (const n of extra(onDisk, linked)) add(KERNEL_INDEX, `\`services.*\` table has a row for \`services.${n}\` but ${n}${PAGE_SUFFIX} does not exist`);
  for (const r of kernelTable) {
    if (r.href !== `${r.accessor}${META_SUFFIX}`) {
      add(KERNEL_INDEX, `\`services.${r.accessor}\` links to "${r.href}", expected "${r.accessor}${META_SUFFIX}"`);
    }
  }

  return findings;
}

export function summarise({ pages, chapterList, kernelTable }) {
  return `${pages.length} chapter page(s) vs meta.json "pages", ${chapterList.length} chapter-list bullet(s) and ${kernelTable.length} kernel/index.mdx table row(s)`;
}

// ---------------------------------------------------------------------------

function run(root) {
  const chapterDir = join(root, CHAPTER_DIR);
  const pages = readPages(chapterDir);
  const metaOrder = readMetaOrder(chapterDir);
  const chapterList = readChapterList(readFileSync(join(chapterDir, 'index.mdx'), 'utf8'));
  const kernelTable = readKernelTable(readFileSync(join(root, KERNEL_INDEX), 'utf8'));
  if (pages.length === 0) throw new Error(`no ${PAGE_SUFFIX} pages found under ${CHAPTER_DIR} -- refusing to report OK over an empty set`);
  const input = { pages, metaOrder, chapterList, kernelTable };
  return { findings: check(input), summary: summarise(input) };
}

function main() {
  const root = repoRoot();
  if (!existsSync(join(root, CHAPTER_DIR))) {
    console.error(`✗ check-runtime-services-index -- ${CHAPTER_DIR} not found`);
    process.exit(1);
  }
  const { findings, summary } = run(root);
  if (findings.length) {
    console.error(`✗ check-runtime-services-index -- ${findings.length} drift(s) between the runtime-services indexes and the pages on disk\n`);
    for (const f of findings) console.error(`  • ${f.where}: ${f.msg}`);
    console.error('\n  The pages on disk are the source of truth. Add the missing entry (or delete the stale');
    console.error('  one) so all three enumerations agree; the chapter list follows meta.json "pages" order.');
    console.error('  The "Source of Truth" canonical-source list is deliberately not checked -- see the header.');
    process.exit(1);
  }
  console.log(`✓ check-runtime-services-index: ${summary} -- all three enumerations agree (Source-of-Truth list not in scope).`);
}

// ---------------------------------------------------------------------------
// Self-test: every limb observed FAILING on a synthetic tree, and observed silent.

function selfTest() {
  const failures = [];
  let checked = 0;
  const assert = (cond, why) => { checked++; if (!cond) failures.push(why); };

  const dir = mkdtempSync(join(tmpdir(), 'rt-services-index-'));
  try {
    const chapter = join(dir, CHAPTER_DIR);
    mkdirSync(chapter, { recursive: true });
    mkdirSync(join(dir, 'content/docs/kernel'), { recursive: true });

    const names = ['data', 'email', 'sms'];
    const writeTree = ({ pages = names, meta = names, list = names, table = names, titleFor = (n) => `services.${n}`, hrefFor = (n) => `${n}-service` } = {}) => {
      for (const f of readdirSync(chapter)) rmSync(join(chapter, f), { force: true });
      for (const n of pages) writeFileSync(join(chapter, `${n}${PAGE_SUFFIX}`), `---\ntitle: ${titleFor(n)}\n---\n`);
      writeFileSync(join(chapter, 'meta.json'), JSON.stringify({ pages: ['index', ...meta.map((n) => `${n}${META_SUFFIX}`), 'examples'] }));
      writeFileSync(join(chapter, 'index.mdx'), `# x\n\n${list.map((n) => `- \`services.${n}\``).join('\n')}\n\n## Source of Truth\n\n- Security: \`packages/spec/src/contracts/security-service.ts\`\n`);
      writeFileSync(join(dir, KERNEL_INDEX), `# k\n\n${table.map((n) => `| [\`services.${n}\`](/docs/kernel/runtime-services/${hrefFor(n)}) | stable | d |`).join('\n')}\n`);
    };
    const findingsFor = (opts) => { writeTree(opts); return run(dir).findings; };

    // ── The clean tree is silent ────────────────────────────────────────────
    const clean = findingsFor();
    assert(clean.length === 0, `a consistent tree reports nothing -- got ${JSON.stringify(clean)}`);
    assert(summarise({ pages: readPages(chapter), chapterList: names, kernelTable: names.map((n) => ({ accessor: n })) }).includes('3 chapter page(s)'), 'the summary names the counts, so a green can be read for its scope');

    // ── Each limb observed FAILING ──────────────────────────────────────────
    // This is the #9604 defect itself: page + meta entry, absent from both lists.
    const sms = findingsFor({ list: ['data', 'email'], table: ['data', 'email'] });
    assert(sms.some((f) => f.where.endsWith('runtime-services/index.mdx') && f.msg.includes('omits `services.sms`')), `the chapter list omitting a real page is caught -- got ${JSON.stringify(sms)}`);
    assert(sms.some((f) => f.where === KERNEL_INDEX && f.msg.includes('no row for `services.sms`')), `the kernel table omitting a real page is caught -- got ${JSON.stringify(sms)}`);

    assert(findingsFor({ meta: ['data', 'email'] }).some((f) => f.msg.includes('omits "sms-service"')), 'meta.json omitting a real page is caught');
    assert(findingsFor({ pages: ['data', 'email'] }).some((f) => f.msg.includes('does not exist')), 'an enumeration naming a page that does not exist is caught');
    assert(findingsFor({ list: ['data', 'sms', 'email'] }).some((f) => f.msg.includes('does not follow meta.json')), 'a chapter list in the wrong order is caught (membership alone would pass)');
    assert(findingsFor({ hrefFor: (n) => (n === 'sms' ? 'sms-svc' : `${n}-service`) }).some((f) => f.msg.includes('links to "sms-svc"')), 'a kernel table row whose href does not match its accessor is caught');

    const lying = findingsFor({ titleFor: (n) => (n === 'sms' ? 'services.text' : `services.${n}`) });
    assert(lying.some((f) => f.msg.includes('expected "services.sms"')), 'a page whose title contradicts its filename is caught');
    assert(lying.every((f) => f.where.endsWith(`sms${PAGE_SUFFIX}`)), 'the title premise short-circuits: no set comparison runs over a page that lies about its name');

    // ── Refuses to report OK over nothing ───────────────────────────────────
    let threw = false;
    try { findingsFor({ pages: [], meta: [], list: [], table: [] }); } catch { threw = true; }
    assert(threw, 'an EMPTY chapter is rejected, never reported OK');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }

  if (failures.length) {
    console.error(`✗ check-runtime-services-index --self-test -- ${failures.length} failure(s)\n`);
    for (const f of failures) console.error(`  • ${f}`);
    process.exit(1);
  }
  console.log(`✓ check-runtime-services-index --self-test: ${checked} assertions over a temp fixture (real run() path); every limb -- chapter list, kernel table, meta.json, order, href, title premise, empty tree -- observed FAILING and observed silent.`);
}

if (process.argv.includes('--self-test')) selfTest();
else main();
