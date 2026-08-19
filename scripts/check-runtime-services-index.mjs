#!/usr/bin/env node
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// check-runtime-services-index (#9604, #9630, #9684) -- hold the runtime-services
// chapter's INDEX lists to the pages that actually exist, each page's documented
// registry slot to a real `registerService` call, and every published stability
// label to the page that declares it.
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
// and each page additionally claims the registry slot it is resolved by (see
// "The fourth claim" below) and the stability label it ships under, which
// `versioning.mdx`'s "Current Matrix" repeats for the whole chapter (see "The
// fifth claim" below).
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
// ## The fourth claim: which key `ctx.getService()` actually takes (#9630)
//
// The three enumerations above are all about page EXISTENCE and ORDER. None of
// them reads a line of `packages/`, so every one of them stayed green over a
// page that documented an accessor the kernel cannot resolve -- and one did:
//
//   * `storage-service.mdx` spelled its whole surface `services.storage.*`;
//   * the chapter's own binding note tells the reader that no literal
//     `services.*` object is injected and that plugin code goes through
//     `ctx.getService(...)`;
//   * the registered slot was `file-storage` (`storage-service-plugin.ts`),
//     and at the time NOTHING registered `storage`.
//
// Following both instructions together produced `ctx.getService('storage')`,
// which threw `[Kernel] Service 'storage' not found`. Seven of the eight pages
// were fine only because their accessor and their slot happened to be the same
// word, so the chapter had exactly one unannounced exception and no way to
// notice a second one.
//
// So each page now declares `- **Registry slot:** \`<key>\``, and this gate holds
// that declaration to a production `registerService`/`registerServiceFactory`
// call under `packages/`. Note what is deliberately NOT required: the slot does
// not have to equal the accessor -- the rule is only: say which key you mean,
// and be right. (History: at #9630 time `file-storage` was the canonical slot
// and this header warned against "fixing" the docs by renaming it; the
// 2026-08-18 maintainer ruling on #9683 then renamed the slot deliberately --
// `storage` is canonical, `file-storage` stays registered as a deprecated v17
// alias of the same instance -- so today BOTH keys are really registered and
// the storage page declares `storage`.)
//
// Test files are excluded from the sweep on purpose: a slot only a fixture
// registers is not a platform surface a reader can resolve. The sweep is also
// multiline-aware, because `plugin-audit` puts its key on the line after the
// `(` -- a line-at-a-time grep reports a confident zero for it, and a wrongly
// measured absence is precisely the failure this check exists to rule out.
//
// ## The fifth claim: the stability LABEL each surface publishes (#9684)
//
// Checks 1-4 hold page EXISTENCE and ORDER; check 5 holds the registry slot.
// Nothing held the two tables that publish a page's STABILITY, and the same
// class of drift landed a third time on this one chapter in a day:
// `versioning.mdx`'s "Current Matrix" shipped SEVEN rows for EIGHT pages --
// `services.sms` missing again, from a fifth enumeration of the same chapter,
// found by a human re-reading it rather than by anything mechanical.
//
// So the matrix is now held to the pages on disk (membership and order, like
// the chapter list), and both tables that repeat a label -- the matrix and the
// `services.*` table in `kernel/index.mdx` -- are held to the page's own
// `- **Stability:** \`<label>\`` bullet. The second half is the one with lasting
// value: membership checking catches a MISSING row, but a row that lists the
// page and contradicts its label is a live lie a reader plans an upgrade
// against, and until now nothing could see it.
//
// The page is the source of truth for its own label, exactly as the pages on
// disk are the source of truth for membership -- it is the thing a reader lands
// on. So a disagreement is always reported against the TABLE, never the page,
// and a page that declares no label at all is a finding: the tables that repeat
// it cannot be checked without it.
//
// Deliberately NOT checked here: the label VOCABULARY. `stable` /
// `experimental` are enumerated twice more (the "Stability Legend" table in
// `index.mdx` and the "Stability Labels" bullets in `versioning.mdx`), and
// nothing holds those two to each other or to the labels in use. Deriving a
// vocabulary from one of them would make this gate the authority on which
// labels exist -- a bigger claim than "the tables agree with the pages", and a
// separate finding.
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

import { readFileSync, readdirSync, statSync, existsSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname, relative, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const repoRoot = () => join(HERE, '..');

const CHAPTER_DIR = 'content/docs/kernel/runtime-services';
const KERNEL_INDEX = 'content/docs/kernel/index.mdx';
const PACKAGES_DIR = 'packages';
const PAGE_SUFFIX = '-service.mdx';
const META_SUFFIX = '-service';
const VERSIONING_FILE = 'versioning.mdx';

/** Directories that never hold a production registration. */
const SKIP_DIRS = new Set(['node_modules', 'dist', 'build', '.turbo', '.next', 'coverage']);
/** A registration in one of these is a fixture, not a platform surface. */
const IS_TEST_PATH = (rel) =>
  /\.(test|spec|conformance|e2e)\./.test(rel) || /(^|\/)(test|tests|__tests__|__mocks__|mocks|fixtures)\//.test(rel);

// MULTILINE-AWARE ON PURPOSE. `\s*` spans newlines, so a registration whose key
// sits on the line after the `(` is still found -- `plugin-audit` really is
// written that way (`audit-plugin.ts:117`), and a `^.*registerService\('x'` style
// line-at-a-time grep reports a confident ZERO for it. An absence measured with
// the wrong tool is the failure mode this whole check exists to rule out, so the
// self-test pins the split-line form explicitly.
const REGISTER_RE = /register(?:Service|ServiceFactory)\s*(?:<[^>]*>)?\s*\(\s*['"`]([^'"`]+)['"`]/g;

// ---------------------------------------------------------------------------
// Derivation

/** Accessor names from the pages that exist, plus each page's declared title,
 *  its declared registry slot and its declared stability label. */
export function readPages(chapterDir) {
  return readdirSync(chapterDir)
    .filter((f) => f.endsWith(PAGE_SUFFIX))
    .sort()
    .map((file) => {
      const name = file.slice(0, -PAGE_SUFFIX.length);
      const text = readFileSync(join(chapterDir, file), 'utf8');
      const m = /^title:\s*(.+?)\s*$/m.exec(text);
      const slot = /^-\s+\*\*Registry slot:\*\*\s+`([^`]+)`/m.exec(text);
      const stability = /^-\s+\*\*Stability:\*\*\s+`([^`]+)`/m.exec(text);
      return { name, file, title: m ? m[1] : null, slot: slot ? slot[1] : null, stability: stability ? stability[1] : null };
    });
}

/** Every service key a PRODUCTION `registerService` / `registerServiceFactory`
 *  call registers under `packages/`, mapped to its call sites. */
export function readRegisteredSlots(root) {
  const found = new Map();
  const pkgRoot = join(root, PACKAGES_DIR);
  if (!existsSync(pkgRoot)) return found;
  const walk = (dir) => {
    for (const entry of readdirSync(dir)) {
      if (SKIP_DIRS.has(entry)) continue;
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) { walk(full); continue; }
      if (!/\.(ts|tsx|mts|js|mjs)$/.test(entry) || entry.endsWith('.d.ts')) continue;
      const rel = relative(root, full).split(sep).join('/');
      if (IS_TEST_PATH(rel)) continue;
      const text = readFileSync(full, 'utf8');
      for (const m of text.matchAll(REGISTER_RE)) {
        const line = text.slice(0, m.index).split('\n').length;
        if (!found.has(m[1])) found.set(m[1], []);
        found.get(m[1]).push(`${rel}:${line}`);
      }
    }
  };
  walk(pkgRoot);
  return found;
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

// ONE shape covers BOTH tables that publish a stability label, because both
// already write the accessor in the first cell and the label in the second:
//
//   versioning.mdx   | `services.data` | `stable` |
//   kernel/index.mdx | [`services.data`](/docs/kernel/runtime-services/data-service) | stable | ... |
//
// It is anchored to `^|` on purpose. The chapter index's other lists are PROSE
// -- `- \`services.sms\`` bullets and `- Security: \`packages/...\`` canonical-source
// rows -- so none of them can be read as a stability claim. That is what keeps
// the deliberately-unchecked Source-of-Truth list (and its extra `Security` row,
// #9629) out of reach of this limb.
const STABILITY_ROW_RE = /^\|\s*\[?`services\.([A-Za-z0-9_]+)`\]?(?:\([^)]*\))?\s*\|\s*`?([A-Za-z0-9_-]+)`?\s*\|/gm;

/** Table rows that publish a stability label for an accessor, in table order. */
export function readStabilityRows(text) {
  return [...text.matchAll(STABILITY_ROW_RE)].map((m) => ({ accessor: m[1], stability: m[2] }));
}

// ---------------------------------------------------------------------------
// Comparison

const missing = (expected, actual) => expected.filter((n) => !actual.includes(n));
const extra = (expected, actual) => actual.filter((n) => !expected.includes(n));

export function check({ pages, metaOrder, chapterList, kernelTable, registeredSlots, stabilityMatrix, kernelStability }) {
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

  // 5. Each page names the registry slot it is really resolved by, and that
  //    slot is a key something actually registers (#9630). The four checks
  //    above hold page EXISTENCE and ORDER to each other; none of them reads a
  //    single line of `packages/`, so a page could document a slot nothing has
  //    ever registered and stay green -- which is exactly what shipped:
  //    `services.storage` was resolvable only as `file-storage` at the time,
  //    the accessor and the slot differed on that one page alone, and the page
  //    never said so. A reader following the chapter's own binding note wrote
  //    `ctx.getService('storage')` and got a throw. (#9683 later renamed the
  //    slot to `storage` by maintainer ruling, keeping `file-storage` as a
  //    deprecated v17 alias registration.)
  //
  //    The accessor is NOT required to equal the slot. What is required is
  //    that the page SAYS which one it is, and that what it says is true.
  if (registeredSlots) {
    for (const p of pages) {
      if (!p.slot) {
        add(`${CHAPTER_DIR}/${p.file}`, `no \`- **Registry slot:** \`<key>\`\` bullet -- state the key \`ctx.getService()\` resolves this surface by (it is \`${p.name}\` unless the page says otherwise)`);
        continue;
      }
      if (!registeredSlots.has(p.slot)) {
        const near = [...registeredSlots.keys()].filter((k) => k.includes(p.name) || p.name.includes(k));
        add(
          `${CHAPTER_DIR}/${p.file}`,
          `declares registry slot \`${p.slot}\`, but no production registerService() call under ${PACKAGES_DIR}/ registers that key`
            + (near.length ? ` -- did you mean ${near.map((k) => `\`${k}\``).join(' / ')}?` : ''),
        );
      }
    }
  }

  // 6. The "Current Matrix" in versioning.mdx <-> the pages on disk (#9684).
  //    A FIFTH enumeration of the same chapter, and the third one to drift off
  //    it in a day: seven rows for eight pages, `services.sms` missing again.
  //    Order is held for the same reason check 3 holds the chapter list's --
  //    the matrix follows meta.json's nav order today, and that convention is
  //    the only thing that tells the next author WHERE a new row goes.
  if (stabilityMatrix) {
    const rows = stabilityMatrix.map((r) => r.accessor);
    const where = `${CHAPTER_DIR}/${VERSIONING_FILE}`;
    for (const n of missing(onDisk, rows)) add(where, `"Current Matrix" has no row for \`services.${n}\` (${n}${PAGE_SUFFIX} exists)`);
    for (const n of extra(onDisk, rows)) add(where, `"Current Matrix" has a row for \`services.${n}\` but ${n}${PAGE_SUFFIX} does not exist`);
    const navOrder = metaOrder.filter((n) => rows.includes(n));
    const rowed = rows.filter((n) => metaOrder.includes(n));
    if (navOrder.join() !== rowed.join()) {
      add(where, `"Current Matrix" row order ${JSON.stringify(rowed)} does not follow meta.json "pages" order ${JSON.stringify(navOrder)}`);
    }
  }

  // 7. Every published stability LABEL == the label its page declares (#9684).
  //    Check 6 catches a MISSING row; this catches a WRONG one -- a table that
  //    lists the page and contradicts it. That is the strictly more valuable
  //    half: a reader plans an upgrade against a guarantee the page never made,
  //    and membership checking passes it silently. The page is the source of
  //    truth, so the finding is always reported against the TABLE.
  const labelled = [
    [`${CHAPTER_DIR}/${VERSIONING_FILE}`, '"Current Matrix"', stabilityMatrix],
    [KERNEL_INDEX, '`services.*` table', kernelStability],
  ].filter(([, , rows]) => rows);
  if (labelled.length) {
    for (const p of pages) {
      if (!p.stability) {
        add(`${CHAPTER_DIR}/${p.file}`, `no \`- **Stability:** \`<label>\`\` bullet -- the page is the source of truth for its own label, and the tables that repeat it cannot be checked without it`);
      }
    }
    for (const [where, what, rows] of labelled) {
      for (const r of rows) {
        const page = pages.find((p) => p.name === r.accessor);
        if (!page || !page.stability) continue; // membership / missing-bullet findings above already name it
        if (page.stability !== r.stability) {
          add(where, `${what} labels \`services.${r.accessor}\` \`${r.stability}\`, but ${page.file} declares \`${page.stability}\` -- fix the table, the page is the source of truth`);
        }
      }
    }
  }

  return findings;
}

export function summarise({ pages, chapterList, kernelTable, registeredSlots, stabilityMatrix }) {
  const slots = registeredSlots
    ? `, and ${pages.filter((p) => p.slot).length} declared registry slot(s) vs ${registeredSlots.size} registered key(s)`
    : '';
  const matrix = stabilityMatrix ? `, ${stabilityMatrix.length} stability-matrix row(s)` : '';
  return `${pages.length} chapter page(s) vs meta.json "pages", ${chapterList.length} chapter-list bullet(s) and ${kernelTable.length} kernel/index.mdx table row(s)${matrix}${slots}`;
}

// ---------------------------------------------------------------------------

function run(root) {
  const chapterDir = join(root, CHAPTER_DIR);
  const pages = readPages(chapterDir);
  const metaOrder = readMetaOrder(chapterDir);
  const chapterList = readChapterList(readFileSync(join(chapterDir, 'index.mdx'), 'utf8'));
  const kernelText = readFileSync(join(root, KERNEL_INDEX), 'utf8');
  const kernelTable = readKernelTable(kernelText);
  const registeredSlots = readRegisteredSlots(root);
  const versioningPath = join(chapterDir, VERSIONING_FILE);
  if (pages.length === 0) throw new Error(`no ${PAGE_SUFFIX} pages found under ${CHAPTER_DIR} -- refusing to report OK over an empty set`);
  if (!existsSync(versioningPath)) {
    throw new Error(`${CHAPTER_DIR}/${VERSIONING_FILE} not found -- its stability matrix is one of the enumerations this gate holds; refusing to report OK without it`);
  }
  const stabilityMatrix = readStabilityRows(readFileSync(versioningPath, 'utf8'));
  const kernelStability = readStabilityRows(kernelText);
  const input = { pages, metaOrder, chapterList, kernelTable, registeredSlots, stabilityMatrix, kernelStability };
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
    console.error('  A "Registry slot" finding is different: the page must name the key ctx.getService() really');
  console.error('  resolves it by. Fix the PAGE, never the slot -- the registered key is the contract (#9630).');
    console.error('  A "Current Matrix" / stability finding is the other way round: the page\'s own Stability');
    console.error('  bullet is the source of truth, so fix the TABLE that repeats it (#9684).');
  console.error('  The "Source of Truth" canonical-source list is deliberately not checked -- see the header.');
    process.exit(1);
  }
  console.log(`✓ check-runtime-services-index: ${summary} -- all enumerations agree, every declared slot is really registered, and every published stability label matches its page (Source-of-Truth list not in scope).`);
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
    // A synthetic `packages/` tree so check 5 has a registry to compare against.
    // `email` is registered on the SAME line; `sms` is registered with its key on
    // the line AFTER the `(` -- the `plugin-audit` shape that defeats a
    // line-at-a-time grep. Both must be found, or the "no such slot" finding
    // below would be a false positive rather than a measurement.
    const pkg = join(dir, PACKAGES_DIR, 'svc/src');
    mkdirSync(pkg, { recursive: true });
    writeFileSync(join(pkg, 'plugin.ts'), [
      "ctx.registerService('data', engine);",
      "ctx.registerService('email', mailer);",
      'ctx.registerService(',
      "  'sms',",
      '  texter,',
      ');',
      "ctx.registerServiceFactory('file-storage', async () => adapter);",
    ].join('\n'));
    // Registered ONLY by a test file: must NOT count as a platform surface.
    mkdirSync(join(dir, PACKAGES_DIR, 'svc/src/__tests__'), { recursive: true });
    writeFileSync(join(dir, PACKAGES_DIR, 'svc/src/__tests__/fake.ts'), "ctx.registerService('testonly', {});");

    const slotFor = (n) => n;
    const writeTree = ({
      pages = names, meta = names, list = names, table = names,
      titleFor = (n) => `services.${n}`, hrefFor = (n) => `${n}-service`, slot = slotFor,
      // #9684: the page bullet is the source of truth; each table repeats it.
      // The table defaults READ the page's label, so a fixture only has to say
      // where it wants them to disagree.
      stability = () => 'stable',
      matrix = names, matrixLabel = (n) => stability(n) ?? 'stable', kernelLabel = (n) => stability(n) ?? 'stable',
      versioning = true,
    } = {}) => {
      for (const f of readdirSync(chapter)) rmSync(join(chapter, f), { force: true });
      for (const n of pages) {
        const declared = slot(n);
        const bullet = declared === null ? '' : `\n- **Registry slot:** \`${declared}\` — resolve with \`ctx.getService('${declared}')\`.\n`;
        const label = stability(n);
        const stabilityBullet = label === null ? '' : `\n- **Stability:** \`${label}\`\n`;
        writeFileSync(join(chapter, `${n}${PAGE_SUFFIX}`), `---\ntitle: ${titleFor(n)}\n---\n${stabilityBullet}${bullet}`);
      }
      if (versioning) {
        writeFileSync(
          join(chapter, VERSIONING_FILE),
          `---\ntitle: v\n---\n\n## Stability Labels\n\n- \`stable\`: x\n- \`experimental\`: y\n\n## Current Matrix\n\n| Service | Stability |\n|:--|:--|\n${matrix.map((n) => `| \`services.${n}\` | \`${matrixLabel(n)}\` |`).join('\n')}\n`,
        );
      }
      writeFileSync(join(chapter, 'meta.json'), JSON.stringify({ pages: ['index', ...meta.map((n) => `${n}${META_SUFFIX}`), 'examples'] }));
      writeFileSync(join(chapter, 'index.mdx'), `# x\n\n${list.map((n) => `- \`services.${n}\``).join('\n')}\n\n## Source of Truth\n\n- Security: \`packages/spec/src/contracts/security-service.ts\`\n`);
      writeFileSync(join(dir, KERNEL_INDEX), `# k\n\n${table.map((n) => `| [\`services.${n}\`](/docs/kernel/runtime-services/${hrefFor(n)}) | ${kernelLabel(n)} | d |`).join('\n')}\n`);
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

    // ── Check 5: declared registry slot vs the real registry (#9630) ────────
    // The defect itself: a page documenting an accessor that resolves to nothing.
    const ghost = findingsFor({ slot: (n) => (n === 'sms' ? 'storage' : n) });
    assert(
      ghost.some((f) => f.where.endsWith(`sms${PAGE_SUFFIX}`) && f.msg.includes('no production registerService() call')),
      `a page declaring a slot nothing registers is caught -- got ${JSON.stringify(ghost)}`,
    );
    assert(ghost.some((f) => f.msg.includes('did you mean')), 'the finding suggests the near-miss key rather than only rejecting');

    // An accessor that legitimately differs from its slot is ACCEPTED -- the rule
    // is "say which key you mean and be right", never "the two must match".
    assert(
      findingsFor({ slot: (n) => (n === 'sms' ? 'file-storage' : n) }).length === 0,
      'a page whose slot deliberately differs from its accessor is silent when that slot is really registered',
    );

    // The split-line registration is REACHED, not merely tolerated: `sms` is only
    // registered in the multiline form, so a line-at-a-time scan would flag it.
    assert(findingsFor().every((f) => !f.where.endsWith(`sms${PAGE_SUFFIX}`)), 'a registration whose key sits on the next line is found (the plugin-audit shape)');

    // A test-only registration does not make a slot real.
    assert(
      findingsFor({ slot: (n) => (n === 'sms' ? 'testonly' : n) }).some((f) => f.msg.includes('no production registerService() call')),
      'a slot registered only under a test path is not accepted as a platform surface',
    );

    // A page that declares no slot at all is caught -- silence is not a pass.
    assert(
      findingsFor({ slot: (n) => (n === 'sms' ? null : n) }).some((f) => f.where.endsWith(`sms${PAGE_SUFFIX}`) && f.msg.includes('Registry slot')),
      'a page with no Registry slot bullet is caught',
    );

    // ── Check 6: the stability matrix vs the pages on disk (#9684) ─────────
    // The defect itself: seven rows for eight pages.
    const shortMatrix = findingsFor({ matrix: ['data', 'email'] });
    assert(
      shortMatrix.some((f) => f.where.endsWith(VERSIONING_FILE) && f.msg.includes('no row for `services.sms`')),
      `the "Current Matrix" omitting a real page is caught -- got ${JSON.stringify(shortMatrix)}`,
    );
    assert(
      findingsFor({ matrix: [...names, 'ghost'] }).some((f) => f.where.endsWith(VERSIONING_FILE) && f.msg.includes('`services.ghost`')),
      'a matrix row for a page that does not exist is caught',
    );
    assert(
      findingsFor({ matrix: ['data', 'sms', 'email'] }).some((f) => f.where.endsWith(VERSIONING_FILE) && f.msg.includes('does not follow meta.json')),
      'a matrix in the wrong order is caught (membership alone would pass)',
    );

    // ── Check 7: a WRONG row, not just a missing one (#9684) ───────────────
    // Membership checking passes both of these: the row is present and names a
    // real page, it just contradicts the label that page declares.
    const wrongMatrix = findingsFor({ matrixLabel: (n) => (n === 'sms' ? 'experimental' : 'stable') });
    assert(
      wrongMatrix.some((f) => f.where.endsWith(VERSIONING_FILE) && f.msg.includes('`experimental`') && f.msg.includes('declares `stable`')),
      `a matrix row contradicting the page it describes is caught, naming both labels -- got ${JSON.stringify(wrongMatrix)}`,
    );
    const wrongKernel = findingsFor({ kernelLabel: (n) => (n === 'sms' ? 'experimental' : 'stable') });
    assert(
      wrongKernel.some((f) => f.where === KERNEL_INDEX && f.msg.includes('`services.sms`') && f.msg.includes('declares `stable`')),
      `the kernel table publishing a label its page contradicts is caught too -- got ${JSON.stringify(wrongKernel)}`,
    );
    // A page whose label legitimately differs from its siblings is ACCEPTED --
    // the rule is "the tables repeat what the page says", never "all pages match".
    assert(
      findingsFor({ stability: (n) => (n === 'sms' ? 'experimental' : 'stable') }).length === 0,
      'a page whose label differs from its siblings is silent when both tables repeat it correctly',
    );
    // No bullet, nothing to check the tables against -- silence is not a pass.
    assert(
      findingsFor({ stability: (n) => (n === 'sms' ? null : 'stable') }).some((f) => f.where.endsWith(`sms${PAGE_SUFFIX}`) && f.msg.includes('**Stability:**')),
      'a page with no Stability bullet is caught',
    );

    // ── #9629 stays the maintainer's call ──────────────────────────────────
    // The chapter index's Source-of-Truth list carries a `Security` row for a
    // service this chapter has no page for. It is PROSE, so no stability limb
    // can see it -- pinned directly on the parser, and again on a failing tree.
    assert(
      readStabilityRows(readFileSync(join(chapter, 'index.mdx'), 'utf8')).length === 0,
      'the chapter index\'s prose lists (incl. the Source-of-Truth `Security` row) are never read as stability rows',
    );
    assert(
      shortMatrix.every((f) => !/[Ss]ecurity/.test(f.msg)),
      'no finding drags the Source-of-Truth list\'s Security row in (#9629 is not decided here)',
    );

    // ── Refuses to report OK over nothing ───────────────────────────────────
    let threwVersioning = false;
    try { findingsFor({ versioning: false }); } catch { threwVersioning = true; }
    assert(threwVersioning, 'a chapter with no versioning.mdx is rejected, never reported OK over a matrix that is not there');

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
  console.log(`✓ check-runtime-services-index --self-test: ${checked} assertions over a temp fixture (real run() path); every limb -- chapter list, kernel table, meta.json, order, href, title premise, registry slot (incl. the split-line registration), stability matrix (missing row, stale row, order) and stability LABEL on both tables, empty tree, missing versioning.mdx -- observed FAILING and observed silent.`);
}

if (process.argv.includes('--self-test')) selfTest();
else main();
