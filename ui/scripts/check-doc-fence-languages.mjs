#!/usr/bin/env node
/**
 * A fenced block whose BODY is TypeScript must be fenced `ts` / `tsx` /
 * `typescript`. No spelling of an unhighlighted fence may hide one from
 * `check-doc-snippet-types`.
 *
 * Run:  node scripts/check-doc-fence-languages.mjs   (also `pnpm check:doc-fences`)
 *       node scripts/check-doc-fence-languages.mjs --self-test
 *       node scripts/check-doc-fence-languages.mjs --list
 * Exit: 0 = no TypeScript block sits under a non-TypeScript fence beyond the
 *       declared, shrink-only debt below. 1 = one does, or the debt list is
 *       stale.
 *
 * ## The hole this closes (objectui#6135, measured, not predicted)
 *
 * `check-doc-snippet-types` compiles `ts` / `tsx` / `typescript` fences and
 * nothing else, so a TypeScript block fenced any other way is invisible to it —
 * that is objectui#5867, and its remediation lane collects the population by
 * walking ```plaintext fences.
 *
 * ⚠️ `plaintext` is not the only spelling of an unhighlighted fence, and until
 * this file landed nothing pinned the vocabulary. Re-running objectui#5867's own
 * derivation on `origin/main` with the fence-language set widened by `text` and
 * `plain`, and nothing else changed, moves the population by exactly one block.
 * Measured twice, because objectui#5867's batches were landing underneath this
 * card while it was written — the delta is stable, the totals are not:
 *
 *                                      at bfdb9f906   at 273537957
 *     plaintext                        127 / 91       104 / 82
 *     plaintext + text + plain         128 / 92       105 / 83
 *     …+ txt + no info string at all   128 / 92       105 / 83
 *
 * (blocks / files. The 23 blocks across 9 files that left between those two
 * readings are objectui#5867 batch 4, PR #6136, plus PR #6137 — which is exactly
 * what the SHRINK-ONLY baseline below is for, and it caught the drift itself.)
 *
 * The block the wider set adds is `content/docs/components/form/file-upload.mdx:27`,
 * a ```text fence opening `interface FileUploadSchema {`. It had been outside the
 * lane's population — and outside the gate — the whole time, for no reason other
 * than how its fence is spelled.
 *
 * Widening the lane's derivation once fixes that one block. It does NOT stop a
 * sixth spelling reopening the identical gap tomorrow, and the 2026-08-24 ruling
 * on objectui#6135 (route "A then C") is explicit that the durable half is the
 * point: "A alone chases spellings … Fixing the lane's arithmetic without pinning
 * the vocabulary means this card gets refiled under a different fence name."
 *
 * ## Why this reads BODIES rather than pinning a list of languages
 *
 * The obvious shape — enumerate the allowed fence languages and ban the rest —
 * was measured and rejected here, because the enumeration IS the thing that
 * rots. It has to be extended every time a page picks up a new highlighter
 * language, each extension is a place to get it wrong, and the failure direction
 * is silent: a spelling nobody added is a spelling nobody notices.
 *
 * Reading the body removes the list from the load-bearing path entirely. The
 * question asked of every fence is triage's, not this file's:
 *
 *     a block whose first line starts with `import` / `export` / `interface` /
 *     `type X =` / `const x: T` IS code
 *
 * — objectui#5867's binding triage ruling, 2026-08-24. ⛔ That classifier is
 * quoted here, not extended: this gate widens WHICH FENCES are examined, never
 * what counts as code. Those are two different edges and only the second was
 * ruled. A block that fails the classifier is prose and this gate says nothing
 * about it, whatever its fence says.
 *
 * The consequence is the property the ruling asked for: `txt`, `console`, `raw`,
 * `output`, a bare ``` with no info string at all — none of them is named
 * anywhere in the enforcement path, and every one of them fails the moment it
 * carries a TypeScript body.
 *
 * ## The two failure modes, because only one of them can be auto-classified
 *
 * SYNONYM   the fence is a KNOWN spelling of an unhighlighted block —
 *           `plaintext`, `text`, `plain`, `txt`, or no info string at all
 *           (`UNHIGHLIGHTED_SPELLINGS`). The gate knows exactly what this is:
 *           objectui#5867's population, one block of it. The remedy is
 *           mechanical — re-fence it `ts` or `tsx` — so it is the only mode a
 *           baseline entry can describe.
 *
 * UNKNOWN   the fence names something else — a spelling nobody has thought of.
 *           The gate CANNOT auto-classify it: `raw` might be a sixth synonym of
 *           an unhighlighted fence, or a real highlighter language whose block
 *           happens to open with `import`. Deciding which is a human's call, so
 *           this mode ⛔ can never be baselined and fails on sight. There are
 *           ZERO of them in the tree today, which is what makes "never
 *           baselined" affordable rather than aspirational.
 *
 * `UNHIGHLIGHTED_SPELLINGS` therefore chooses a MESSAGE, never a verdict. Adding
 * a spelling to it moves a finding from UNKNOWN to SYNONYM; it does not excuse
 * the block, because SYNONYM findings still have to be inside a shrink-only
 * baseline that no supported route adds to. There is no edit to this file that
 * makes a new TypeScript-under-a-non-TypeScript-fence block pass.
 *
 * ## The baseline, and why it is the lane's population rather than a permit
 *
 * ⛔ SHRINK-ONLY, in the shape objectui#6133 landed for
 * `KNOWN_HAND_TYPED_GUARDS`: `path -> number of SYNONYM blocks the file carried
 * when this gate landed`. A count rather than a bare path, for that card's third
 * reason, which is the one that matters — a path-only baseline silently accepts a
 * SECOND hidden block being smuggled into an already-owed file.
 *
 *   • a file NOT in the map that carries one fails — a new hidden block cannot land;
 *   • a file IN the map carrying MORE than its number fails;
 *   • a file carrying FEWER fails as STALE and names itself, the remedy being to
 *     lower or delete the line. No supported route raises a number.
 *
 * The map is not a debt list this gate invented. It IS objectui#5867's remaining
 * population, per file, machine-readable and in the repository — 83 entries and
 * 105 blocks at the commit this landed on, reconciling exactly with that card's
 * own derivation. Every batch of that lane now lowers these numbers in the same
 * pull request that re-fences the blocks, which is what stops the lane's
 * arithmetic from being a figure re-derived by hand in each handback and trusted
 * by the next dispatch. When the last entry goes, so does the map, and the rule
 * above stands alone.
 *
 * ## What it reads, and what it deliberately does not
 *
 * The scan surface is `check-doc-snippet-types`'s, exactly: every `.mdx` and
 * `.md` under `content/docs`, every `packages/<name>/README.md`, the root
 * `README.md` (objectui#7115), and every `.mdx` / `.md` under
 * `apps/<app>/docs/**` (objectui#6600). The full ownership map for all three doc
 * gates — including the trees NO gate reads — is stated once in
 * `check-doc-snippet-types.mjs`, beside `UNGATED_DOCS`; this gate's roots are
 * that gate's roots by construction, which is the pin below.
 * It is re-implemented here rather than imported so
 * this gate needs NO install — that gate imports `typescript`, and an
 * install-gated docs check is one that a docs-only pull request skips, which is
 * the shape objectui#5174 records as the hole (and `repo-gates.yml`'s header,
 * which carries the folded workflows' reasoning since objectui#12214). The copy is not left to drift:
 * `scripts/__tests__/check-doc-fence-languages.test.ts` imports BOTH walks and
 * fails if they ever return different document lists, and pins this file's
 * TypeScript-fence set against the gate's own `TS_FENCE_LANGUAGES`.
 *
 * ⭐ That coupling pin is not decoration — it is what CAUGHT objectui#7115.
 * That card widened the two gates its ruling named onto the root `README.md`
 * and this one, the third, went red on `walks exactly the documents the snippet
 * gate walks` before anybody had thought to look for a third. The install-free
 * copy is deliberate; the pin is what makes a deliberate copy safe, and it did
 * the job it was written for.
 *
 * ⛔ It compiles nothing. Whether a block that reaches a `ts` fence then passes
 * `--strict` is `check-doc-snippet-types`'s question; this gate only makes sure
 * the block is asked.
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isEntrypoint } from './invoked-as.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// ── The scan surface — kept identical to check-doc-snippet-types by test ─────

const DOCS_ROOT = 'content/docs';
const PACKAGES_DIR = 'packages';
const DOC_EXTENSIONS = ['.mdx', '.md'];

/**
 * Per-app documentation trees, `apps/<app>/docs/**` (objectui#6600).
 *
 * ⛔ Deliberately a COPY of `check-doc-snippet-types.mjs`'s constant, for the same
 * reason `ROOT_PAGES` below is one: importing anything from that module pulls in
 * its `import ts from 'typescript'` at load, and this gate's whole value is that
 * it runs with no install. Exported so the equality is checked rather than hoped
 * for — `check-doc-fence-languages.test.ts` pins all three gates' copies.
 *
 * The walk is `apps/<app>/docs`, one level of app directory and no deeper before
 * the
 * `docs` segment: `apps/site/app/docs` is a Next.js ROUTE directory holding
 * `.tsx` route files, not a documentation tree, and a `**`-shaped walk that
 * happened to pick it up would be collecting routes.
 */
export const APP_DOCS = { dir: 'apps', subdir: 'docs' };

/** Every `apps/<app>/docs` directory that exists, in a stable order. */
export function appDocsDirs(root) {
  const appsDir = join(root, APP_DOCS.dir);
  if (!existsSync(appsDir)) return [];
  const out = [];
  for (const entry of readdirSync(appsDir).sort()) {
    const docs = join(appsDir, entry, APP_DOCS.subdir);
    if (existsSync(docs) && statSync(docs).isDirectory()) out.push(docs);
  }
  return out;
}

/**
 * Pages at the repository ROOT that join the scan set by name (objectui#7115).
 *
 * ⛔ Deliberately a COPY of `check-doc-snippet-types.mjs`'s constant rather than
 * an import of it, for the reason stated in the header: importing anything from
 * that module pulls in its `import ts from 'typescript'` at load, and this gate's
 * whole value is that it runs with no install, in the unfiltered workflow a
 * docs-only pull request starts. Exported so the equality is checked rather than
 * hoped for — `check-doc-fence-languages.test.ts` pins this array against the
 * other two gates', which is the same bargain `TS_FENCE_LANGUAGES` and the
 * document walk already make: copy freely, compare always.
 */
export const ROOT_PAGES = ['README.md'];

/** Every document in the scan set, in a stable order. */
export function listDocuments(root = repoRoot) {
  const out = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir).sort()) {
      const p = join(dir, entry);
      if (statSync(p).isDirectory()) walk(p);
      else if (DOC_EXTENSIONS.some((ext) => entry.endsWith(ext))) out.push(relative(root, p).split(sep).join('/'));
    }
  };
  const docsRoot = join(root, DOCS_ROOT);
  if (existsSync(docsRoot)) walk(docsRoot);
  // Per-app docs trees, in the same slot the snippet gate appends them in —
  // the coupling pin compares the two lists element by element.
  for (const dir of appDocsDirs(root)) walk(dir);
  const pkgDir = join(root, PACKAGES_DIR);
  if (existsSync(pkgDir)) {
    for (const entry of readdirSync(pkgDir).sort()) {
      const readme = join(pkgDir, entry, 'README.md');
      if (existsSync(readme)) out.push(relative(root, readme).split(sep).join('/'));
    }
  }
  // Root pages last, by name — the same order the snippet gate appends them in,
  // because the coupling pin compares the lists element by element.
  for (const name of ROOT_PAGES) {
    if (existsSync(join(root, name))) out.push(name);
  }
  return out;
}

// ── The vocabulary: one set gates, one set only labels ───────────────────────

/** Fences `check-doc-snippet-types` already compiles. Pinned against that gate's
 *  own export by the test, so a change there cannot leave this one behind. */
export const TS_FENCE_LANGUAGES = new Set(['ts', 'tsx', 'typescript']);

/**
 * Known spellings of an UNHIGHLIGHTED fence, including the empty info string.
 * This set picks the failure MODE and its remedy text; it never decides whether
 * a block fails. See the header: adding a spelling here moves a finding from
 * UNKNOWN to SYNONYM and nothing else.
 */
export const UNHIGHLIGHTED_SPELLINGS = new Set(['plaintext', 'text', 'plain', 'txt', '']);

// ── Triage's classifier, quoted rather than extended ─────────────────────────

/**
 * objectui#5867's binding triage ruling (2026-08-24): a block whose FIRST LINE
 * starts with `import` / `export` / `interface` / `type X =` / `const x: T` is
 * code.
 *
 * "First line" is read literally — line 1 of the body, no leading whitespace
 * tolerated — and that is a measurement rather than a preference. A variant that
 * trims first agrees with this one on every `plaintext` block in the tree and on
 * the `text` one, and disagrees on exactly one block in the tree:
 * `content/docs/guide/architecture-overview.md:123`, an ASCII-art plugin
 * lifecycle diagram whose first line is an INDENTED `import 'plugin-kanban'`
 * inside a box drawing. It is not TypeScript, and the strict reading is the one
 * that says so.
 */
export function classifiesAsTypeScript(body) {
  const line = body.split('\n')[0];
  return (
    /^import\b/.test(line) ||
    /^export\b/.test(line) ||
    /^interface\s/.test(line) ||
    /^type\s+[A-Za-z_$][\w$]*\s*(<[^=]*>)?\s*=/.test(line) ||
    /^const\s+[A-Za-z_$][\w$]*\s*:/.test(line)
  );
}

// ── Fence scanning ───────────────────────────────────────────────────────────

/**
 * EVERY fenced block in one document, with its info-string language. Fences are
 * matched by their own run length — the same walk `check-doc-snippet-types`
 * uses — so a ```` ```` ```` wrapper containing ``` does not confuse it. This
 * one filters nothing: the whole point is to see the fences that gate cannot.
 */
export function scanFences(source) {
  const lines = source.split('\n');
  const blocks = [];
  for (let i = 0; i < lines.length; i++) {
    const open = /^([ \t]*)(`{3,})(.*)$/.exec(lines[i]);
    if (!open) continue;
    const ticks = open[2];
    let close = lines.length;
    for (let j = i + 1; j < lines.length; j++) {
      const c = /^[ \t]*(`{3,})[ \t]*$/.exec(lines[j]);
      if (c && c[1].length >= ticks.length) {
        close = j;
        break;
      }
    }
    const info = open[3].trim();
    blocks.push({
      fenceLine: i + 1,
      language: (info.split(/\s+/)[0] || '').toLowerCase(),
      body: lines.slice(i + 1, close).join('\n'),
    });
    i = close;
  }
  return blocks;
}

/** `null` when the block is nothing to this gate; otherwise its failure mode. */
export function classifyFence(block) {
  if (TS_FENCE_LANGUAGES.has(block.language)) return null;
  if (!classifiesAsTypeScript(block.body)) return null;
  return UNHIGHLIGHTED_SPELLINGS.has(block.language) ? 'synonym' : 'unknown';
}

/**
 * Every hidden TypeScript block across a set of `{ rel, source }` documents.
 * Pure, so the self-test drives it over fixture sources rather than the tree.
 */
export function census(documents) {
  const sites = [];
  for (const { rel, source } of documents) {
    for (const block of scanFences(source)) {
      const mode = classifyFence(block);
      if (!mode) continue;
      sites.push({
        rel,
        line: block.fenceLine,
        language: block.language,
        mode,
        head: (block.body.split('\n')[0] || '').trim().slice(0, 72),
      });
    }
  }
  const observed = new Map();
  for (const s of sites.filter((s) => s.mode === 'synonym')) observed.set(s.rel, (observed.get(s.rel) ?? 0) + 1);
  return { sites, observed, unknown: sites.filter((s) => s.mode === 'unknown') };
}

// ── The debt: objectui#5867's remaining population, per file ─────────────────

/**
 * ⛔ SHRINK-ONLY. `path -> number of SYNONYM-mode blocks the file carried when
 * this gate landed` — objectui#5867's remaining population, per file, at
 * `273537957`: 83 files, 105 blocks. The rationale, and why a COUNT rather than
 * a bare path, is in the header; the shape is objectui#6133's.
 *
 * The remedy for every line is the same, which is the property that makes a debt
 * list safe: re-fence the block ```ts (or ```tsx), fix whatever
 * `check-doc-snippet-types` then reports, and lower the number here — deleting
 * the line when it reaches 0. That is objectui#5867's batches, and no entry
 * records a judgement anyone has to re-make.
 *
 * ⚠️ ONE entry is different in kind and is labelled rather than left to be
 * re-derived. `content/docs/components/form/file-upload.mdx` is the block this
 * card surfaced, and it is NOT merely blocked — objectui#6138 measured that a
 * block declaring its OWN `interface` and then being checked against it compiles
 * VACUOUSLY, and `file-upload.mdx:27` opens `interface FileUploadSchema {`. Its
 * line comes down when objectui#6138 rules on what such a block should be, not
 * when someone re-fences it; re-fencing it today would add a block that reports
 * green while checking nothing.
 *
 * @type {Map<string, number>}
 */
export const KNOWN_UNHIGHLIGHTED_TS_FENCES = new Map([
  ['content/docs/components/basic/text.mdx', 1],
  ['content/docs/components/form/file-upload.mdx', 1],
]);

/** Split observed counts against the baseline. Both directions are failures. */
export function reconcile(observed, baseline) {
  const fresh = [];
  for (const [rel, count] of observed) {
    const owed = baseline.get(rel) ?? 0;
    if (count > owed) fresh.push({ rel, count, owed });
  }
  const stale = [];
  for (const [rel, owed] of baseline) {
    const count = observed.get(rel) ?? 0;
    if (count < owed) stale.push({ rel, count, owed });
  }
  return { fresh: fresh.sort((a, b) => (a.rel < b.rel ? -1 : 1)), stale: stale.sort((a, b) => (a.rel < b.rel ? -1 : 1)) };
}

// ── Verdict ──────────────────────────────────────────────────────────────────

const REMEDY_SYNONYM =
  `\n    That block is TypeScript by objectui#5867's triage classifier, under a` +
  `\n    fence check-doc-snippet-types does not read. Re-fence it \`\`\`ts (or` +
  `\n    \`\`\`tsx) and fix what that gate then reports.` +
  `\n` +
  `\n    KNOWN_UNHIGHLIGHTED_TS_FENCES is SHRINK-ONLY: adding a line, or raising` +
  `\n    a number, is not a supported way to make this pass.`;

const REMEDY_UNKNOWN =
  `\n    A TypeScript body under a fence language this gate has never seen. It` +
  `\n    cannot auto-classify that, so it will not guess — and ⛔ this mode is` +
  `\n    never baselined. Two remedies, and the choice is yours to state:` +
  `\n` +
  `\n      • the block is TypeScript      -> re-fence it \`\`\`ts / \`\`\`tsx;` +
  `\n      • the fence is another spelling of an UNHIGHLIGHTED block` +
  `\n                                     -> add the spelling to` +
  `\n                                        UNHIGHLIGHTED_SPELLINGS *and* re-fence` +
  `\n                                        the block. Adding the spelling alone` +
  `\n                                        changes the message, never the verdict.`;

export function analyze(documents, baseline = KNOWN_UNHIGHLIGHTED_TS_FENCES) {
  const { sites, observed, unknown } = census(documents);
  return { sites, observed, unknown, ...reconcile(observed, baseline) };
}

function readTree(root) {
  return listDocuments(root).map((rel) => ({ rel, source: readFileSync(join(root, rel), 'utf8') }));
}

function list() {
  const { sites } = census(readTree(repoRoot));
  for (const s of sites) console.log(`${s.rel}:${s.line}  [${s.language || 'no info string'}]  ${s.mode}  ${s.head}`);
  console.log(`${sites.length} hidden TypeScript block(s).`);
  return 0;
}

function main() {
  const documents = readTree(repoRoot);
  const { sites, observed, unknown, fresh, stale } = analyze(documents);
  const byFile = new Map();
  for (const s of sites) byFile.set(s.rel, [...(byFile.get(s.rel) ?? []), s]);

  if (unknown.length) {
    console.error(`❌  check:doc-fences — ${unknown.length} TypeScript block(s) under an UNKNOWN fence language:\n`);
    for (const s of unknown) console.error(`  ${s.rel}:${s.line}  \`\`\`${s.language}  — ${s.head}`);
    console.error(REMEDY_UNKNOWN);
    return 1;
  }

  if (fresh.length) {
    const total = fresh.reduce((n, f) => n + (f.count - f.owed), 0);
    console.error(`❌  check:doc-fences — ${total} TypeScript block(s) under an unhighlighted fence, beyond the baseline:\n`);
    for (const f of fresh) {
      for (const s of byFile.get(f.rel) ?? []) console.error(`  ${s.rel}:${s.line}  \`\`\`${s.language || '(no info string)'}  — ${s.head}`);
      if (f.owed) console.error(`    (${f.rel} is baselined at ${f.owed}; it now carries ${f.count}. The baseline only shrinks.)`);
    }
    console.error(REMEDY_SYNONYM);
    return 1;
  }

  if (stale.length) {
    console.error(`❌  check:doc-fences — ${stale.length} stale KNOWN_UNHIGHLIGHTED_TS_FENCES entry/entries:\n`);
    for (const s of stale) console.error(`  ${s.rel}  — baselined at ${s.owed}, now carries ${s.count}`);
    console.error(
      `\n    Good news, and the list has to say so: ${stale.some((s) => s.count === 0) ? 'delete the zero lines' : 'lower the numbers'} in` +
        `\n    KNOWN_UNHIGHLIGHTED_TS_FENCES in scripts/check-doc-fence-languages.mjs` +
        `\n    (delete the entry when it reaches 0). This map is objectui#5867's` +
        `\n    remaining population; a stale line is that number drifting away from` +
        `\n    the tree, which is the whole reason it is kept here rather than` +
        `\n    re-derived by hand in each handback.`,
    );
    return 1;
  }

  const owed = [...KNOWN_UNHIGHLIGHTED_TS_FENCES.values()].reduce((a, b) => a + b, 0);
  console.log(
    `✅  check:doc-fences — every TypeScript block in ${documents.length} document(s) is fenced ts/tsx/typescript, ` +
      `except ${KNOWN_UNHIGHLIGHTED_TS_FENCES.size} declared file(s) carrying ${owed} block(s) of objectui#5867's ` +
      `remaining population (⛔ SHRINK-ONLY). No unknown fence spelling hides one.`,
  );
  return 0;
}

// ── Self-test — a guard that has never been shown to fail is not a guard ─────

/**
 * Drives the real scanner over fixture sources. The three probes the 2026-08-24
 * ruling on objectui#6135 named by hand are the first three cases, and they are
 * here rather than only in a throwaway mutation so that the day this gate stops
 * seeing them is a red CI run rather than nothing at all.
 */
export function selfTest() {
  const cases = [];
  const t = (name, ok, detail) => cases.push({ name, ok, detail });

  const TS_BODY = 'interface FileUploadSchema {\n  accept?: string;\n}';
  const doc = (info, body = TS_BODY) => [{ rel: 'probe.mdx', source: ['```' + info, body, '```'].join('\n') }];
  const modeOf = (info, body) => census(doc(info, body)).sites[0]?.mode ?? 'none';
  const named = (info) => {
    const { sites } = census(doc(info));
    return sites.length === 1 && sites[0].rel === 'probe.mdx' && sites[0].line === 1;
  };

  // ── the three spellings the ruling named, each reddening AND named ────────
  t('a ```text-fenced TypeScript block is a SYNONYM finding', modeOf('text') === 'synonym');
  t('a ```txt-fenced TypeScript block is a SYNONYM finding', modeOf('txt') === 'synonym');
  t('a TypeScript block with NO info string is a SYNONYM finding', modeOf('') === 'synonym');
  t('…and each is reported with its file and fence line', named('text') && named('txt') && named(''));
  t('```plain and ```plaintext are the same finding', modeOf('plain') === 'synonym' && modeOf('plaintext') === 'synonym');

  // ── corrected blocks go green ────────────────────────────────────────────
  t('the SAME block fenced ```ts is not a finding', modeOf('ts') === 'none');
  t('…fenced ```tsx is not a finding', modeOf('tsx') === 'none');
  t('…fenced ```typescript is not a finding', modeOf('typescript') === 'none');

  // ── a spelling nobody has thought of is the OTHER mode, never baselined ──
  t('a TypeScript block fenced ```console is an UNKNOWN finding', modeOf('console') === 'unknown');
  t('…so is ```raw, and ```output', modeOf('raw') === 'unknown' && modeOf('output') === 'unknown');
  t(
    'an UNKNOWN finding fails even when its file is baselined',
    (() => {
      const { unknown } = analyze(doc('console'), new Map([['probe.mdx', 99]]));
      return unknown.length === 1;
    })(),
  );

  // ── the classifier is quoted, not widened ────────────────────────────────
  t('a prose block under any of those fences is NOT a finding', modeOf('text', 'Upload a file, then press Save.') === 'none');
  t('a bare object literal is NOT a finding', modeOf('plaintext', '{\n  "accept": "image/*"\n}') === 'none');
  t('a comment-opening block is NOT a finding', modeOf('plaintext', '// the shape a slot receives\nfoo();') === 'none');
  t(
    'every limb of triage’s classifier fires',
    ['import x from "y";', 'export const a = 1;', 'interface A {}', 'type A = B;', 'const a: A = b;'].every(
      (b) => modeOf('plaintext', b) === 'synonym',
    ),
  );
  t(
    'an INDENTED first line is not code — the ASCII-diagram reading',
    modeOf('', "  import 'plugin-kanban'\n       │\n       ▼") === 'none',
  );

  // ── the fence walk is the gate's: run length, not a bare ``` ─────────────
  t(
    'a ```` block is closed by its OWN run length, not by an inner ```',
    (() => {
      const s = ['````text', 'import a from "b";', '```', 'still inside', '````'].join('\n');
      const { sites } = census([{ rel: 'p.mdx', source: s }]);
      return sites.length === 1 && sites[0].line === 1 && sites[0].mode === 'synonym';
    })(),
  );
  t(
    'a ```ts fence QUOTED inside a ```` block is that block’s body, not a block',
    census([{ rel: 'p.mdx', source: ['````plaintext', '```ts', 'import a from "b";', '```', '````'].join('\n') }]).sites.length === 0,
  );
  t(
    'an info string with attributes still reads its language',
    modeOf('text title="schema.ts"') === 'synonym' && modeOf('ts title="schema.ts"') === 'none',
  );

  // ── the baseline moves in exactly one direction ──────────────────────────
  const two = [{ rel: 'a.mdx', source: ['```text', TS_BODY, '```', '```plain', TS_BODY, '```'].join('\n') }];
  t('a file not in the map that carries one is FRESH', analyze(two, new Map()).fresh.length === 1);
  t('a file carrying MORE than its number is FRESH', analyze(two, new Map([['a.mdx', 1]])).fresh.length === 1);
  t('a file carrying exactly its number is clean', (() => {
    const r = analyze(two, new Map([['a.mdx', 2]]));
    return r.fresh.length === 0 && r.stale.length === 0;
  })());
  t('a file carrying FEWER is STALE', analyze(two, new Map([['a.mdx', 3]])).stale.length === 1);
  t('a baselined file that no longer carries any is STALE', analyze([], new Map([['a.mdx', 1]])).stale.length === 1);

  // ── the map describes the SYNONYM mode only ─────────────────────────────
  t(
    'UNHIGHLIGHTED_SPELLINGS carries the empty info string',
    UNHIGHLIGHTED_SPELLINGS.has('') && UNHIGHLIGHTED_SPELLINGS.has('text') && UNHIGHLIGHTED_SPELLINGS.has('txt'),
  );
  t('no TS fence language is also an unhighlighted spelling', [...TS_FENCE_LANGUAGES].every((l) => !UNHIGHLIGHTED_SPELLINGS.has(l)));

  const failed = cases.filter((c) => !c.ok);
  for (const c of failed) console.error(`  ✗ ${c.name}${c.detail ? ` — ${c.detail}` : ''}`);
  if (failed.length) {
    console.error(`✗ check-doc-fence-languages self-test: ${failed.length} of ${cases.length} case(s) failed.`);
    return 1;
  }
  console.log(
    `✓ check-doc-fence-languages self-test: ${cases.length} cases pass — a TypeScript block fenced text, txt, plain or ` +
      `with no info string at all is found and NAMED, the same block fenced ts/tsx/typescript is not, an unrecognised ` +
      `spelling is the second failure mode and is never baselined, triage's classifier is quoted rather than widened, ` +
      `and the shrink-only baseline is pinned in every direction it can move.`,
  );
  return 0;
}

if (isEntrypoint(import.meta.url)) {
  const argv = process.argv;
  process.exit(argv.includes('--self-test') ? selfTest() : argv.includes('--list') ? list() : main());
}
