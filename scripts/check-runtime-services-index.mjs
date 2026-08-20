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
// The label VOCABULARY -- which labels may exist at all -- is one level up
// again, and is now checks 9 and 10 below (#9751). Until they landed, a page
// declaring a label NOBODY defined was green here.
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
// ## The sixth claim: the "Source of Truth" canonical-source list (#9629)
//
// `index.mdx` carries a fourth list -- `- <Accessor>: \`<path>\`` rows under
// "## Source of Truth", introduced by the sentence "Each page links the canonical
// TypeScript source used to derive signatures."
//
// This gate deliberately did NOT read that list until now, and the reason is
// worth keeping: it was a superset by exactly one row on purpose-of-record.
// `Security: packages/spec/src/contracts/security-service.ts` named a real,
// registered slot (`security-plugin.ts:1157`) for a service this chapter has no
// page for, while `services.security` was documented NOWHERE under
// `content/docs/`. Whether that row should become a page, move to another
// chapter, or be dropped was a product-surface question, and encoding ANY of the
// three answers here -- an allowlist entry included -- would have decided it
// silently, in a gate, by a docs agent. So the limb was left unbuilt while the
// question was open, and #9684 pinned that restraint on the parser itself.
//
// The 2026-08-18 maintainer ruling closed the question: `services.security` is
// an INTERNAL accessor, not a publicly documented runtime accessor. The row is
// dropped, no page is created, the accessor is not relocated -- so the list is
// now exactly one row per page, and its own sentence is decidable. Held here:
//
//   - every page on disk has a canonical-source row, and every row names a page
//     -- the row's LABEL is the accessor, matched case-insensitively, so `SMS`
//     answers for `sms-service.mdx`;
//   - no accessor gets two rows: two canonical sources for one surface is a
//     contradiction a reader cannot resolve, and membership checking alone
//     passes it;
//   - every row's path exists in the tree. A canonical-source pointer to a file
//     that moved is the same broken map as a row with no page -- the reader
//     following it lands nowhere either way.
//
// Deliberately NOT checked here, each for a measured reason:
//
//   - ORDER. Checks 3 and 6 hold the chapter list and the stability matrix to
//     meta.json's nav order because both demonstrably follow it today, which
//     makes the convention the only thing telling the next author WHERE a new
//     entry goes. This list does not follow it -- `Data, Sharing, Queue, Email,
//     SMS, Storage, Settings, Audit` against a nav order of `data, sharing,
//     audit, queue, email, sms, settings, storage` -- and has never claimed to.
//     Enforcing order would mean re-sorting a published list to a convention it
//     never had: a docs edit dressed up as a gate, and not what was ruled.
//   - Whether a path is the RIGHT canonical source. Three of the eight rows
//     point outside `packages/spec/src/contracts/` on purpose (`Data` at
//     `packages/client/src/index.ts`, `Settings` at `service-settings`, `Audit`
//     at `plugin-audit` -- the last one deliberately, see #9605), so a rule like
//     "canonical sources live under contracts/" would be false on the day it
//     landed. Which file is canonical for a surface is a judgement no scan can
//     make. That the file EXISTS is not.

// ## The seventh claim: which labels may EXIST at all (#9751)
//
// Check 7 holds each table to the page it repeats, so `stable` in the matrix
// can no longer contradict `experimental` on the page. What none of checks 1-8
// can see is a label NOBODY DEFINED. Measured on this tree before this limb
// landed: `audit-service.mdx` declaring `- **Stability:** \`beta\``, with the
// "Current Matrix" row and the `kernel/index.mdx` row faithfully repeating
// `beta`, was GREEN -- while neither legend defined `beta` anywhere. Every
// enumeration agreed with every other one, and the chapter published a maturity
// promise its own reader cannot look up. The two legends could drift apart from
// each other just as silently: a `beta` row added to the "Stability Legend" in
// `index.mdx` ALONE was green too.
//
// `stable` / `experimental` was the whole vocabulary, written out by hand in
// exactly two places that nothing compared -- the "Stability Legend" table in
// `index.mdx` and the "Stability Labels" bullets in `versioning.mdx` -- with no
// enum in code behind either of them.
//
// So the vocabulary now has ONE definition, `STABILITY_VOCABULARY` below. Both
// legends are held to it by exact ordered EQUALITY, and every page's label is
// drawn from it. Note which comparison does the work: equality, not membership.
// A subset check ("every label a legend names is in the enum") passes one
// legend quietly dropping a row the other keeps -- the two legends disagreeing
// about what the chapter offers, which is the drift this card was filed for and
// the leg easiest to leave out. Order is held for the same reason checks 3 and
// 6 hold theirs: both legends are already in vocabulary order, so nothing is
// re-sorted, and the convention is the only thing that tells the next author
// WHERE a new row goes.
//
// The two TABLES are deliberately not checked against the vocabulary. They are
// already held to the page (check 7), and the page is held to the vocabulary,
// so a bad label reports ONCE, against the file where the label was actually
// chosen. Two recognizers of one fact is how a gate starts contradicting
// itself, and the author gets sent to the wrong file.
//
// Why a constant here rather than one of the two pages: deriving the vocabulary
// from a legend makes whichever page an author happens to edit the authority on
// which labels exist -- a docs edit silently widening a gate's accept set --
// and it picks a winner between two legends nobody has ranked. A constant makes
// extension a deliberate edit HERE, in the same PR that defines what the new
// label promises on BOTH pages.
//
// Why NOT `PluginInterfaceSchema.stability` (`packages/spec/src/kernel/
// plugin-capability.zod.ts`), the repo's only other `stability` enum: it is a
// different surface -- the maturity a PLUGIN declares for a protocol interface
// in its own `objectstack.config.ts` manifest (two live declarations today,
// both `stable`), never read from or written to a docs page. Its four values
// (`stable`/`beta`/`alpha`/`experimental`) would LEGALISE exactly the `beta`
// page this check exists to reject, and would oblige both legends to publish
// what `alpha` and `beta` promise about a runtime service API -- a product
// decision this chapter has never made, made silently in a gate. If the two
// vocabularies should ever become one, that is a ruling, not a refactor.
//
// Deliberately NOT checked: what a label MEANS. The two legends word the same
// promise differently on purpose ("within a major version" against "within the
// current major version"), and holding prose to prose would force one page's
// wording onto the other for no gain a reader can feel. Also not checked: that
// every defined label is USED by some page -- a legend documents what an author
// may choose, not what they happened to choose.
//
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

// The CLOSED vocabulary of stability labels (#9751). This is the one definition
// in the repo: both legends are held to it and every page label is drawn from
// it. Adding a label here is the deliberate act -- do it in the same PR that
// says what the label promises, in BOTH legends. See "The seventh claim" above,
// including why this is not derived from `PluginInterfaceSchema.stability`.
export const STABILITY_VOCABULARY = Object.freeze(['stable', 'experimental']);

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
// -- `- \`services.sms\`` bullets and `- Data: \`packages/...\`` canonical-source
// rows -- so none of them can be read as a stability claim. The canonical-source
// rows ARE checked now (check 8, #9629), but as canonical-source rows: a prose
// row must never reach this limb and be reported as a stability disagreement,
// which is a separate finding against a different file.
const STABILITY_ROW_RE = /^\|\s*\[?`services\.([A-Za-z0-9_]+)`\]?(?:\([^)]*\))?\s*\|\s*`?([A-Za-z0-9_-]+)`?\s*\|/gm;

/** Table rows that publish a stability label for an accessor, in table order. */
export function readStabilityRows(text) {
  return [...text.matchAll(STABILITY_ROW_RE)].map((m) => ({ accessor: m[1], stability: m[2] }));
}

// `- <Accessor>: \`<path>\`` rows, read ONLY inside the "## Source of Truth"
// section. Scoping to the section rather than the whole page is deliberate: the
// chapter list a few lines above is also `- ` bullets, and reading the page
// whole would make every accessor bullet look like a malformed canonical-source
// row. The section runs to the next `##` heading (or the end of the file), so a
// callout that trails the list is inside it -- its prose lines do not start with
// `- `, and the `^-` anchor is what keeps them out. Pinned in the self-test.
const SOURCE_HEADING_RE = /^##\s+Source of Truth\s*$/m;
const SOURCE_ROW_RE = /^-\s+(.+?):\s*`([^`]+)`\s*$/gm;

/** The text of one `## <heading>` section, or `null` when the heading is absent.
 *  The section runs to the next `##` heading, or to the end of the file. */
function sectionOf(text, headingRe) {
  const at = text.search(headingRe);
  if (at === -1) return null;
  const rest = text.slice(at);
  const next = rest.slice(1).search(/^##\s/m);
  return next === -1 ? rest : rest.slice(0, next + 1);
}

/** Canonical-source rows from the chapter index, in list order.
 *  `null` when the section is absent -- a caller must not read that as "no rows". */
export function readSourceRows(indexText) {
  const section = sectionOf(indexText, SOURCE_HEADING_RE);
  if (section === null) return null;
  return [...section.matchAll(SOURCE_ROW_RE)].map((m) => ({ label: m[1].trim(), path: m[2].trim() }));
}

// The two LEGENDS that define the vocabulary (#9751). Both are read
// section-scoped, for the same reason the canonical-source rows are: read whole,
// each file's OTHER list has the same shape as the one wanted here. In
// `versioning.mdx` the "Current Matrix" is a two-column table of backticked
// cells exactly like the legend table; in `index.mdx` the chapter list and the
// canonical-source rows are `- ` bullets exactly like the legend bullets. A
// reader that walked either file whole would report the wrong list's contents as
// the vocabulary -- a wrongly measured definition, which is worse than none.
// Both directions are pinned in the self-test.
const LEGEND_HEADING_RE = /^##\s+Stability Legend\s*$/m;
const LABELS_HEADING_RE = /^##\s+Stability Labels\s*$/m;
const LEGEND_ROW_RE = /^\|\s*`([A-Za-z0-9_-]+)`\s*\|/gm;
const LABEL_BULLET_RE = /^-\s+`([A-Za-z0-9_-]+)`\s*:/gm;

/** Labels defined by the "Stability Legend" table in the chapter index, in order.
 *  `null` when the section is absent -- never read that as "defines nothing". */
export function readLegendTable(indexText) {
  const section = sectionOf(indexText, LEGEND_HEADING_RE);
  if (section === null) return null;
  return [...section.matchAll(LEGEND_ROW_RE)].map((m) => m[1]);
}

/** Labels defined by the "Stability Labels" bullets in versioning.mdx, in order.
 *  `null` when the section is absent -- never read that as "defines nothing". */
export function readLegendBullets(versioningText) {
  const section = sectionOf(versioningText, LABELS_HEADING_RE);
  if (section === null) return null;
  return [...section.matchAll(LABEL_BULLET_RE)].map((m) => m[1]);
}

// ---------------------------------------------------------------------------
// Comparison

const missing = (expected, actual) => expected.filter((n) => !actual.includes(n));
const extra = (expected, actual) => actual.filter((n) => !expected.includes(n));

export function check({ pages, metaOrder, chapterList, kernelTable, registeredSlots, stabilityMatrix, kernelStability, sourceRows, legendTable, legendBullets }) {
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

  // 8. The "Source of Truth" canonical-source list <-> the pages on disk (#9629).
  //    A SIXTH enumeration of the same chapter, and the last one left unheld.
  //    It stayed out of scope while `services.security` was an open product
  //    question, because any rule written over it would have answered that
  //    question in a gate; the 2026-08-18 ruling made the accessor internal, the
  //    row is gone, and "one row per page" is now simply true. See the header.
  //
  //    Membership runs BOTH ways, like checks 1-2: a missing row leaves a page
  //    with no canonical source, and a row with no page is the drift this card
  //    was filed for -- the list advertising a canonical source for a service
  //    the chapter never introduces. The path check is the third failure the
  //    same reader hits: a row that resolves to nothing is a broken map even
  //    when both sets agree.
  if (sourceRows) {
    const where = `${CHAPTER_DIR}/index.mdx`;
    const rowNames = sourceRows.map((r) => r.label.toLowerCase());
    for (const n of missing(onDisk, rowNames)) {
      add(where, `"Source of Truth" has no canonical-source row for \`services.${n}\` (${n}${PAGE_SUFFIX} exists)`);
    }
    const seen = new Set();
    for (const r of sourceRows) {
      const name = r.label.toLowerCase();
      if (seen.has(name)) {
        add(where, `"Source of Truth" has more than one row for \`services.${name}\` -- two canonical sources for one surface is a contradiction, not a superset`);
      }
      seen.add(name);
      if (!onDisk.includes(name)) {
        add(
          where,
          `"Source of Truth" row "${r.label}" names no page in this chapter -- label each row with the accessor it documents, one of ${onDisk.map((n) => `\`${n}\``).join(', ')}`,
        );
        continue;
      }
      if (r.exists === false) {
        add(where, `"Source of Truth" row "${r.label}" links \`${r.path}\`, which does not exist -- the row's whole job is to be a source a reader can open`);
      }
    }
  }

  // 9. Both legends define EXACTLY the vocabulary, in its order (#9751).
  //    EQUALITY, not membership, and that is the whole point: a subset check
  //    passes one legend dropping a row the other keeps, which is the two
  //    legends disagreeing about what labels the chapter offers -- green today,
  //    and indefinitely. Neither page is the authority; both answer to the
  //    constant, so no legend can widen the vocabulary by being edited.
  const vocabulary = [...STABILITY_VOCABULARY];
  for (const [where, what, defined] of [
    [`${CHAPTER_DIR}/index.mdx`, '"Stability Legend"', legendTable],
    [`${CHAPTER_DIR}/${VERSIONING_FILE}`, '"Stability Labels"', legendBullets],
  ]) {
    if (!defined) continue;
    if (defined.join() !== vocabulary.join()) {
      add(
        where,
        `${what} defines ${JSON.stringify(defined)}, but the stability vocabulary is ${JSON.stringify(vocabulary)}`
          + ` -- both legends must define exactly it, in that order. To add a label, extend STABILITY_VOCABULARY`
          + ` in scripts/check-runtime-services-index.mjs in the same change that says what it promises on BOTH pages.`,
      );
    }
  }

  // 10. Every page draws its label FROM the vocabulary (#9751). Reported against
  //     the PAGE: that is where the label was chosen, and check 7 already holds
  //     both tables to the page, so the label reaches the tables only through
  //     here. A page with no bullet at all is check 7's finding, not this one.
  for (const p of pages) {
    if (!p.stability) continue;
    if (!STABILITY_VOCABULARY.includes(p.stability)) {
      add(
        `${CHAPTER_DIR}/${p.file}`,
        `declares stability \`${p.stability}\`, which no legend defines -- the vocabulary is`
          + ` ${vocabulary.map((l) => `\`${l}\``).join(', ')}. A label a reader cannot look up is a maturity`
          + ` promise with no meaning behind it.`,
      );
    }
  }

  return findings;
}

export function summarise({ pages, chapterList, kernelTable, registeredSlots, stabilityMatrix, sourceRows }) {
  const slots = registeredSlots
    ? `, and ${pages.filter((p) => p.slot).length} declared registry slot(s) vs ${registeredSlots.size} registered key(s)`
    : '';
  const matrix = stabilityMatrix ? `, ${stabilityMatrix.length} stability-matrix row(s)` : '';
  const sources = sourceRows ? `, ${sourceRows.length} canonical-source row(s)` : '';
  const vocab = `, ${STABILITY_VOCABULARY.length} defined stability label(s) (${STABILITY_VOCABULARY.join(', ')})`;
  return `${pages.length} chapter page(s) vs meta.json "pages", ${chapterList.length} chapter-list bullet(s) and ${kernelTable.length} kernel/index.mdx table row(s)${matrix}${sources}${slots}${vocab}`;
}

// ---------------------------------------------------------------------------

function run(root) {
  const chapterDir = join(root, CHAPTER_DIR);
  const pages = readPages(chapterDir);
  const metaOrder = readMetaOrder(chapterDir);
  const indexText = readFileSync(join(chapterDir, 'index.mdx'), 'utf8');
  const chapterList = readChapterList(indexText);
  const kernelText = readFileSync(join(root, KERNEL_INDEX), 'utf8');
  const kernelTable = readKernelTable(kernelText);
  const registeredSlots = readRegisteredSlots(root);
  const versioningPath = join(chapterDir, VERSIONING_FILE);
  if (pages.length === 0) throw new Error(`no ${PAGE_SUFFIX} pages found under ${CHAPTER_DIR} -- refusing to report OK over an empty set`);
  if (!existsSync(versioningPath)) {
    throw new Error(`${CHAPTER_DIR}/${VERSIONING_FILE} not found -- its stability matrix is one of the enumerations this gate holds; refusing to report OK without it`);
  }
  const versioningText = readFileSync(versioningPath, 'utf8');
  const stabilityMatrix = readStabilityRows(versioningText);
  const kernelStability = readStabilityRows(kernelText);
  const rawSourceRows = readSourceRows(indexText);
  // Same refusal as the empty chapter and the missing versioning.mdx: the
  // Source-of-Truth list is one of the enumerations this gate holds, and a green
  // over a section that is not there would be the exact shape of the drift it
  // exists to catch.
  if (rawSourceRows === null || rawSourceRows.length === 0) {
    throw new Error(
      `${CHAPTER_DIR}/index.mdx has no "Source of Truth" canonical-source rows -- that list is one of the enumerations this gate holds; refusing to report OK without it`,
    );
  }
  const sourceRows = rawSourceRows.map((r) => ({ ...r, exists: existsSync(join(root, r.path)) }));
  // Same refusal again, for the two legends (#9751): they are the definition
  // this gate now holds everything else to, and an ABSENT legend read as "the
  // vocabulary is empty" would turn every page label into a finding while the
  // one file that could have answered went unnoticed. Missing is not empty.
  const legendTable = readLegendTable(indexText);
  const legendBullets = readLegendBullets(versioningText);
  if (legendTable === null || legendTable.length === 0) {
    throw new Error(
      `${CHAPTER_DIR}/index.mdx has no "Stability Legend" rows -- that legend is one of the two definitions of the stability vocabulary this gate holds; refusing to report OK without it`,
    );
  }
  if (legendBullets === null || legendBullets.length === 0) {
    throw new Error(
      `${CHAPTER_DIR}/${VERSIONING_FILE} has no "Stability Labels" bullets -- that legend is one of the two definitions of the stability vocabulary this gate holds; refusing to report OK without it`,
    );
  }
  const input = { pages, metaOrder, chapterList, kernelTable, registeredSlots, stabilityMatrix, kernelStability, sourceRows, legendTable, legendBullets };
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
  console.error('  A "Source of Truth" finding is the canonical-source list (#9629): one row per page, the row');
  console.error('  labelled with the accessor, and its path a file that exists. A row for a service this chapter');
  console.error('  has no page for is the drift that card was filed for -- drop the row, or add the page and its');
  console.error('  five other enumerations. Row ORDER is deliberately not held; the header says why.');
    console.error('  A "Stability Legend" / "Stability Labels" finding is the label VOCABULARY (#9751): both legends');
    console.error('  define exactly STABILITY_VOCABULARY, in that order, and every page picks its label from it. To');
    console.error('  add a label, extend that constant in this script in the same change that says what the label');
    console.error('  promises on BOTH pages -- never by editing one legend alone.');
    process.exit(1);
  }
  console.log(`✓ check-runtime-services-index: ${summary} -- all enumerations agree, every declared slot is really registered, every published stability label matches its page and is one the two legends define, and every canonical-source row names a page whose file exists.`);
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
    // The chapter index's Source-of-Truth rows. `SMS` is spelled in caps on
    // purpose: the real list writes it that way, and the label-to-accessor match
    // is case-insensitive. Every default path is the synthetic plugin file that
    // really exists in the fixture tree, so the path limb is silent unless a
    // case asks for it.
    const SOURCE_LABEL = { data: 'Data', email: 'Email', sms: 'SMS' };
    const REAL_PATH = 'packages/svc/src/plugin.ts';
    const defaultSourceRows = names.map((n) => ({ label: SOURCE_LABEL[n] ?? n, path: REAL_PATH }));
    const writeTree = ({
      pages = names, meta = names, list = names, table = names,
      titleFor = (n) => `services.${n}`, hrefFor = (n) => `${n}-service`, slot = slotFor,
      // #9684: the page bullet is the source of truth; each table repeats it.
      // The table defaults READ the page's label, so a fixture only has to say
      // where it wants them to disagree.
      stability = () => 'stable',
      matrix = names, matrixLabel = (n) => stability(n) ?? 'stable', kernelLabel = (n) => stability(n) ?? 'stable',
      versioning = true,
      // #9629: the Source-of-Truth canonical-source rows.
      sourceRows = defaultSourceRows,
      // #9751: the two LEGENDS that define the vocabulary. `null` omits the
      // section entirely, so the refusal-over-a-missing-definition can be
      // measured rather than assumed.
      legend = [...STABILITY_VOCABULARY],
      labels = [...STABILITY_VOCABULARY],
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
          `---\ntitle: v\n---\n`
            + (labels === null ? '' : `\n## Stability Labels\n\n${labels.map((l) => `- \`${l}\`: what it promises.`).join('\n')}\n`)
            // A DECOY bullet, outside the labels section on purpose: it has the
            // exact shape of a legend definition. If the reader ever stops being
            // section-scoped this is what it picks up, and the assertion below
            // is what notices.
            + `\n## Breaking-Change Tracking\n\n1. Update the page.\n- \`ghost\`: not a label, and not in the section above.\n`
            + `\n## Current Matrix\n\n| Service | Stability |\n|:--|:--|\n${matrix.map((n) => `| \`services.${n}\` | \`${matrixLabel(n)}\` |`).join('\n')}\n`,
        );
      }
      writeFileSync(join(chapter, 'meta.json'), JSON.stringify({ pages: ['index', ...meta.map((n) => `${n}${META_SUFFIX}`), 'examples'] }));
      // The index carries FOUR things this gate reads: the chapter-list bullets,
      // the Source-of-Truth rows, and (never) a stability claim. The trailing
      // callout is written on purpose -- it sits inside the Source-of-Truth
      // section, and its prose must not be read as a canonical-source row.
      writeFileSync(
        join(chapter, 'index.mdx'),
        `# x\n\n${list.map((n) => `- \`services.${n}\``).join('\n')}\n\n`
          + (legend === null ? '' : `## Stability Legend\n\n| Level | Meaning |\n|:--|:--|\n${legend.map((l) => `| \`${l}\` | what it promises |`).join('\n')}\n\n`)
          + `## Source of Truth\n\nEach page links the canonical TypeScript source used to derive signatures.\n\n`
          + `${sourceRows.map((r) => `- ${r.label}: \`${r.path}\``).join('\n')}\n\n`
          + `<Callout type="warn" title="Not this">\nA second shape shares the word: \`SettingsAuditSink\` — canonical source\n\`${REAL_PATH}\` — is constructor-injected, never registered. See \`services.audit\`: the full contrast.\n</Callout>\n`
          // A DECOY legend row, outside the legend section on purpose -- same
          // shape as a real one. Only the section scoping keeps it out.
          + `\n## Other\n\n| Level | Meaning |\n|:--|:--|\n| \`ghost\` | not a label, and not in the legend |\n`,
      );
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

    // ── Check 8: the Source-of-Truth canonical-source list (#9629) ─────────
    // Until the 2026-08-18 ruling this list was deliberately unread, and the two
    // assertions here pinned that restraint: a `Security` row for a page-less
    // service reached no limb. The ruling made the accessor internal and the row
    // is gone, so the same two facts are re-pinned around the answer -- the row
    // is now CAUGHT, and caught as a canonical-source row, never as a stability
    // claim (that half of the old pin is the one with lasting value).

    // The defect this card was filed for: the list advertising a canonical
    // source for a service the chapter never introduces.
    const pageless = findingsFor({ sourceRows: [...defaultSourceRows, { label: 'Security', path: REAL_PATH }] });
    assert(
      pageless.some((f) => f.where.endsWith('runtime-services/index.mdx') && f.msg.includes('"Security" names no page')),
      `a Source-of-Truth row for a service with no page is caught -- got ${JSON.stringify(pageless)}`,
    );
    // ...and caught HERE. The row is prose, so no stability limb may see it: a
    // finding against versioning.mdx or kernel/index.mdx would send the author
    // to the wrong file for a row that is not in either of them.
    assert(
      pageless.every((f) => !f.where.endsWith(VERSIONING_FILE) && f.where !== KERNEL_INDEX),
      `a canonical-source row is never reported against a stability table -- got ${JSON.stringify(pageless.map((f) => f.where))}`,
    );
    assert(
      readStabilityRows(readFileSync(join(chapter, 'index.mdx'), 'utf8')).length === 0,
      'the chapter index\'s other lists -- chapter bullets, canonical-source rows and the Stability Legend table alike -- are never read as stability rows',
    );
    // The trailing callout lives inside the section; its prose is not a row.
    assert(
      readSourceRows(readFileSync(join(chapter, 'index.mdx'), 'utf8')).length === defaultSourceRows.length + 1,
      'only the `- Accessor: `path`` bullets are read as rows -- the callout that trails the list is not',
    );

    // A page with no canonical source: the other direction of the same list.
    assert(
      findingsFor({ sourceRows: defaultSourceRows.filter((r) => r.label !== 'SMS') })
        .some((f) => f.msg.includes('no canonical-source row for `services.sms`')),
      'a page with no canonical-source row is caught',
    );
    // `SMS` answers for `sms-service.mdx`: the label match is case-insensitive,
    // so the list's real spelling is silent. Measured in two halves, because a
    // silent run alone would also be explained by the row never being parsed.
    const cleanRows = (findingsFor(), readSourceRows(readFileSync(join(chapter, 'index.mdx'), 'utf8')));
    assert(cleanRows.some((r) => r.label === 'SMS'), 'the caps label is really parsed as a row (not skipped into silence)');
    assert(findingsFor().length === 0, 'a row labelled `SMS` matches `sms-service.mdx` -- the accessor match ignores case');
    // A prose label is not an accessor. This is the `Audit bridge` shape the
    // list really carried before #9605 renamed it.
    assert(
      findingsFor({ sourceRows: defaultSourceRows.map((r) => (r.label === 'SMS' ? { ...r, label: 'SMS bridge' } : r)) })
        .some((f) => f.msg.includes('"SMS bridge" names no page')),
      'a descriptive row label that is not an accessor is caught',
    );
    // Two canonical sources for one surface. Membership alone passes this.
    assert(
      findingsFor({ sourceRows: [...defaultSourceRows, { label: 'Data', path: REAL_PATH }] })
        .some((f) => f.msg.includes('more than one row for `services.data`')),
      'a duplicated canonical-source row is caught (membership checking passes it)',
    );
    // A row whose path moved: both sets agree and the map is still broken.
    const gonePath = findingsFor({ sourceRows: defaultSourceRows.map((r) => (r.label === 'Data' ? { ...r, path: 'packages/svc/src/moved.ts' } : r)) });
    assert(
      gonePath.some((f) => f.msg.includes('packages/svc/src/moved.ts') && f.msg.includes('does not exist')),
      `a canonical-source row pointing at a file that is not there is caught -- got ${JSON.stringify(gonePath)}`,
    );
    // Silence is not a pass: a section with no rows is refused, like the empty
    // chapter and the missing versioning.mdx.
    let threwSources = false;
    try { findingsFor({ sourceRows: [] }); } catch { threwSources = true; }
    assert(threwSources, 'a chapter index with no Source-of-Truth rows is rejected, never reported OK over a list that is not there');


    // ── Checks 9-10: the label VOCABULARY (#9751) ──────────────────────────
    // The hole itself, reproduced: a page declaring a label NOBODY defined,
    // with both tables faithfully repeating it. Check 7 is silent by
    // construction here -- the tables agree with the page -- so this is the
    // shape that was green before this limb existed.
    const undefinedLabel = findingsFor({ stability: (n) => (n === 'sms' ? 'beta' : 'stable') });
    assert(
      undefinedLabel.some((f) => f.where.endsWith(`sms${PAGE_SUFFIX}`) && f.msg.includes('`beta`')),
      `a page declaring a label no legend defines is caught -- got ${JSON.stringify(undefinedLabel)}`,
    );
    assert(
      undefinedLabel.some((f) => f.msg.includes('`stable`') && f.msg.includes('`experimental`')),
      'the finding names the ALLOWED SET, not just the rejection -- the author has to know what to pick instead',
    );
    // ...and reported against the PAGE alone. The tables repeat the page
    // faithfully, so a finding against either of them would send the author to
    // change a row that is not wrong.
    assert(
      undefinedLabel.every((f) => f.where.endsWith(`sms${PAGE_SUFFIX}`)),
      `an out-of-vocabulary label is reported once, against the page that chose it -- got ${JSON.stringify(undefinedLabel.map((f) => f.where))}`,
    );

    // The other side of the same rule: every label IN the vocabulary is
    // accepted, including the one only a single page uses. A check that went
    // red here would be enforcing uniformity, not a vocabulary.
    for (const label of STABILITY_VOCABULARY) {
      assert(
        findingsFor({ stability: (n) => (n === 'sms' ? label : 'stable') }).length === 0,
        `a page labelled \`${label}\` is silent -- every defined label is really accepted`,
      );
    }

    // THE LEGENDS DRIFTING APART FROM EACH OTHER. This is the card's actual
    // subject and the leg a membership-only check silently passes: every label
    // still named is in the vocabulary, and the two legends no longer offer the
    // same set. Equality is what catches it.
    const drift = findingsFor({ labels: ['stable'] });
    assert(
      ['stable'].every((l) => STABILITY_VOCABULARY.includes(l)),
      'the drifting legend names only labels that ARE in the vocabulary -- otherwise this measures membership, not drift',
    );
    assert(
      drift.some((f) => f.where.endsWith(VERSIONING_FILE) && f.msg.includes('"Stability Labels"') && f.msg.includes('experimental')),
      `one legend dropping a label the other keeps is caught, naming both sets -- got ${JSON.stringify(drift)}`,
    );
    const driftIndex = findingsFor({ legend: ['stable'] });
    assert(
      driftIndex.some((f) => f.where.endsWith('runtime-services/index.mdx') && f.msg.includes('"Stability Legend"')),
      `the drift is caught in the other direction too -- got ${JSON.stringify(driftIndex)}`,
    );

    // A legend widening the vocabulary on its own: the docs edit that would
    // otherwise make a page-level `beta` legal without anyone deciding.
    assert(
      findingsFor({ legend: [...STABILITY_VOCABULARY, 'beta'] })
        .some((f) => f.where.endsWith('runtime-services/index.mdx') && f.msg.includes('beta')),
      'a legend defining a label the vocabulary does not is caught -- a page cannot be granted a new label by editing one page',
    );
    // Order, for the reason checks 3 and 6 hold theirs: membership alone passes.
    assert(
      findingsFor({ legend: [...STABILITY_VOCABULARY].reverse() })
        .some((f) => f.where.endsWith('runtime-services/index.mdx') && f.msg.includes('"Stability Legend"')),
      'a legend listing the right labels in the wrong order is caught (membership alone would pass)',
    );

    // Section scoping, measured rather than assumed: each file carries a DECOY
    // with the exact shape of a legend entry, outside the legend section. A
    // reader that walked either file whole would report `ghost` as part of the
    // vocabulary -- a wrongly measured definition, worse than none at all.
    writeTree();
    const idxText = readFileSync(join(chapter, 'index.mdx'), 'utf8');
    const verText = readFileSync(join(chapter, VERSIONING_FILE), 'utf8');
    assert(idxText.includes('| `ghost` |') && verText.includes('- `ghost`:'), 'the decoys really are in the fixture (or the two assertions below measure nothing)');
    assert(readLegendTable(idxText).join() === STABILITY_VOCABULARY.join(), `the legend table reads exactly the legend section -- got ${JSON.stringify(readLegendTable(idxText))}`);
    assert(readLegendBullets(verText).join() === STABILITY_VOCABULARY.join(), `the legend bullets read exactly the labels section -- got ${JSON.stringify(readLegendBullets(verText))}`);

    // Silence is not a pass: a legend that is not there is refused, exactly like
    // the empty chapter, the missing versioning.mdx and the empty
    // Source-of-Truth list. An absent definition read as "defines nothing" would
    // turn every page label into a finding and never name the real cause.
    for (const [what, opts] of [['index.mdx "Stability Legend"', { legend: null }], [`${VERSIONING_FILE} "Stability Labels"`, { labels: null }]]) {
      let threwLegend = false;
      try { findingsFor(opts); } catch { threwLegend = true; }
      assert(threwLegend, `a chapter with no ${what} is rejected, never reported OK over a vocabulary that is not defined`);
    }

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
  console.log(`✓ check-runtime-services-index --self-test: ${checked} assertions over a temp fixture (real run() path); every limb -- chapter list, kernel table, meta.json, order, href, title premise, registry slot (incl. the split-line registration), stability matrix (missing row, stale row, order) and stability LABEL on both tables, canonical-source rows (page-less row, page with no row, prose label, duplicate, missing path, and never read as a stability claim), label VOCABULARY (undefined label named with its allowed set and reported only against the page, every defined label accepted, the two legends drifting apart from EACH OTHER while every label they name is still in the enum, a legend widening it alone, legend order, section scoping past a decoy in each file, and a missing legend refused), empty tree, missing versioning.mdx, empty Source-of-Truth list -- observed FAILING and observed silent.`);
}

if (process.argv.includes('--self-test')) selfTest();
else main();
