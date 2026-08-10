#!/usr/bin/env node
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// check-adr-links — resolve every relative Markdown link written in `docs/adr/`.
//
// ## The failure this exists for
//
// framework#6592. `.github/workflows/check-links.yml` runs lychee over exactly
// three globs — `content/**/*.md`, `content/**/*.mdx`, `README.md`. `docs/adr/`
// is not among them, so every relative cross-link between decision records was
// checked by nothing, and records link each other heavily: most carry a
// `**Builds on**:` line with 3-10 relative links in it.
//
// That is not a theoretical hole. `0057-erp-authorization-core-business-units-
// and-scope-depth.md:5` pointed at `./0010-metadata-protection.md`, a file that
// has never existed (the record is `0010-metadata-protection-model.md`). It sat
// there long enough that a triage comment inherited the wrong attribution and
// repeated it. PD #13 sends the next author to "go read that decision"; a dead
// link sends them to a 404 and then to a guess.
//
// ## Why this is a script and not three more lychee globs
//
// Measured on the pinned lychee (0.24.2, the version `lycheeverse/lychee-
// action@v2` installs), adding `docs/adr/**/*.md` to those globs today reports
// **8 broken links** — every one of them a genuine ADR → source-tree link whose
// target has since moved or left this repository (`apps/studio/**` now lives in
// the `cloud` repo; `packages/runtime/src/kernel-manager.ts` is gone). Those are
// real rot, they are not this gate's to rewrite, and turning the shared `Check
// Links` job red on day one would have cost every open PR its green lane while
// fixing nothing. #6028 landed that job advisory-first precisely so it could
// accumulate a green streak; a permanently-red advisory lane is the gate nobody
// reads, which is how `check-links.yml` came to sit dormant for six months.
//
// So the pre-existing breaks are FROZEN, individually, on `KNOWN_DEAD_TARGETS`
// below — the same shrink-only-baseline shape this repo already uses for
// `check:role-word`, the slot-lookup ratchet and `check-adr-anchors`'s
// `KNOWN_NUMBER_COLLISIONS`. A NEW dead link fails. A frozen one that stops
// being dead ALSO fails, as stale, so the baseline cannot outlive its excuse.
// lychee has no shrink-only exclusion: `.lycheeignore` never expires, and
// nothing tells you when an entry stopped being needed.
//
// Two more reasons the ADR surface belongs here rather than in lychee:
//
//   - `docs/adr/` is already governed by a repo-owned Node gate
//     (`check-adr-anchors.mjs`, which audits record filenames and ADR-number
//     uniqueness). Splitting one registry's rules across a Node script and a
//     Rust binary means neither file is where you look.
//   - This runs with `node`, offline, in any container. lychee does not: it is
//     installed by the action at CI time, and `lychee.toml`'s own header asks
//     authors to "run lychee against it locally before pushing" — an
//     instruction that costs a from-source Rust build in an agent container.
//
// ## The discrimination mechanism (the hard part — #6592's ⚠️)
//
// `0046-package-docs-as-metadata.md` is the record that DEFINES the package-docs
// link convention ("Docs reference each other with plain relative Markdown
// links"), so it documents that convention by example, naming a doc that
// deliberately does not exist in this repo:
//
//   line  30  ...links (`[guide](./crm_lead_guide.md)`); because the tree...
//   line 163  See the [lead guide](./crm_lead_guide.md#qualification)...   (in a ```md fence)
//   line 188  ...(publish lint rejects `![](…)`).
//
// Those three are correct as written. The gate has to learn to read them, not
// the document to accommodate the gate — so extraction skips **fenced code
// blocks and inline code spans** before it looks for links. Excluding the FILE
// (lychee's `exclude_path`, the tempting one-liner) is the recorded trap: it
// would blind the gate to ADR-0046's 4 real cross-links forever, which is the
// same "route around it" the card exists to prevent.
//
// One correction to #6592's premise, measured rather than assumed: lychee 0.24.2
// does NOT flag those three. Its Markdown extractor works off a CommonMark
// parse, so text inside a fence or a code span is never a link event to begin
// with — `lychee --offline 'docs/adr/0046-package-docs-as-metadata.md'` reports
// `4 Total, 4 OK, 0 Errors`, and even `--include-verbatim` adds only two
// EXCLUDED http links. The issue's "3 unresolved" figure came from a raw
// `](./…)` regex sweep, and that is exactly the shape THIS file is: a regex
// over lines. So the discrimination requirement is real here even though it was
// not real for lychee, and it is asserted rather than assumed.
//
// `--self-test` pins both halves every run: the three shapes above are pinned
// against the real ADR-0046, and synthetic fixtures prove a dead link in prose
// IS still reported. A discrimination rule that only ever says "nothing found"
// looks identical to a broken extractor, so the sweep also fails if the census
// of resolved targets is zero.
//
// ## Coverage parity with lychee, measured
//
// Dumping both extractors over `docs/adr/**/*.md` (lychee 0.24.2 `--dump`
// vs. `extractRelativeLinks` here): every file destination lychee finds, this
// finds. lychee's four extras are bare same-document anchors (`[Phasing]
// (#phasing)`), which name no file to resolve and are out of scope below.
//
// ## Scope, stated so the next reader does not have to infer it
//
//   - Relative + repo-root-relative Markdown link destinations only. `http(s):`,
//     `mailto:` and other schemes are out of scope BY DESIGN: this gate is
//     offline and deterministic, exactly like the `--offline` lychee lane.
//   - `#fragment` is stripped, never checked — same as `include_fragments =
//     "none"` in `lychee.toml`.
//   - Inline links (`[text](dest)`) only. `docs/adr/` uses no reference-style
//     links, no angle-bracket destinations and no indented code blocks
//     (verified at the time of writing); if one arrives, extend the extractor
//     rather than the baseline.
//
//   node scripts/check-adr-links.mjs
//   node scripts/check-adr-links.mjs --self-test   # verify the checker itself

import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ADR_DIR = 'docs/adr';

/**
 * The record that documents the package-docs link convention, and the exact
 * illustrative strings the discrimination mechanism has to keep quiet about.
 * Pinned in `--self-test` so a regression in fence/code-span handling fails
 * there instead of turning up as a mystery finding on someone else's PR.
 */
const CONVENTION_RECORD = `${ADR_DIR}/0046-package-docs-as-metadata.md`;
const CONVENTION_ILLUSTRATIVE_TARGETS = [
  './crm_lead_guide.md', // line 30, inside an inline code span
  './crm_lead_guide.md#qualification', // line 163, inside a ```md fence
  '…', // line 188, `![](…)` inside an inline code span
];

/**
 * ⛔ SHRINK-ONLY. Relative links under `docs/adr/` that were already dead when
 * this gate was written (#6592). Every entry is a reader being sent to a 404.
 *
 * **Adding an entry is not the fix for a red build.** If this gate just told you
 * a link you wrote does not resolve, fix the link — it prints the path it tried.
 * Widening this list re-opens the exact defect the gate closes, and does it for
 * every future reader of that record rather than for you once.
 *
 * Removing an entry is always welcome and the gate enforces it: an entry that no
 * longer matches a live finding fails as STALE, so a fixed link cannot silently
 * regress back under cover of its own grandfather clause.
 *
 * **The list is EMPTY, and that is the finished state.** The 8 ADR → source-tree
 * links it was seeded with (#6592) were repaired under #6726: each target had
 * genuinely left this repository, so each link became a plain unlinked path plus
 * a short note saying where the code went. The ADR → ADR surface this gate was
 * filed for was already clean. An empty baseline means the gate is now a gate
 * rather than a grandfather clause — do not re-seed it.
 */
const KNOWN_DEAD_TARGETS = [];

/**
 * Blank out fenced code blocks, preserving line count so findings keep their
 * line numbers.
 *
 * A fence opens on a line whose first non-space run is 3+ backticks or 3+
 * tildes (CommonMark allows up to 3 leading spaces) and closes on the next line
 * whose fence uses the SAME character and is at least as long. ADR-0046's
 * example lives in a ```md fence, and an info string on the opening fence must
 * not be mistaken for a closing one — hence the "same char, >= length" rule
 * rather than a bare toggle.
 */
export function stripFencedBlocks(text) {
  const lines = text.split('\n');
  const out = [];
  let fenceChar = null;
  let fenceLen = 0;
  for (const line of lines) {
    const m = /^ {0,3}(`{3,}|~{3,})/.exec(line);
    if (m) {
      const char = m[1][0];
      const len = m[1].length;
      if (fenceChar === null) {
        fenceChar = char;
        fenceLen = len;
        out.push('');
        continue;
      }
      if (char === fenceChar && len >= fenceLen && !/^ {0,3}[`~]+[^`~\s]/.test(line)) {
        fenceChar = null;
        fenceLen = 0;
        out.push('');
        continue;
      }
    }
    out.push(fenceChar === null ? line : '');
  }
  return out.join('\n');
}

/**
 * Blank out inline code spans, preserving every newline so line numbers survive.
 * CommonMark: a span opens with a run of N backticks and closes with the next
 * run of exactly N. ADR-0046 line 30 is `[guide](./crm_lead_guide.md)` inside
 * such a span, and line 188 is `![](…)`.
 */
export function stripCodeSpans(text) {
  let out = '';
  let i = 0;
  while (i < text.length) {
    if (text[i] !== '`') {
      out += text[i];
      i += 1;
      continue;
    }
    let open = 0;
    while (text[i + open] === '`') open += 1;
    // Look for a closing run of exactly `open` backticks.
    let j = i + open;
    let close = -1;
    while (j < text.length) {
      if (text[j] === '`') {
        let run = 0;
        while (text[j + run] === '`') run += 1;
        if (run === open) {
          close = j;
          break;
        }
        j += run;
        continue;
      }
      j += 1;
    }
    if (close === -1) {
      // Unterminated run: not a code span, emit verbatim.
      out += text.slice(i, i + open);
      i += open;
      continue;
    }
    const span = text.slice(i, close + open);
    out += span.replace(/[^\n]/g, ' ');
    i = close + open;
  }
  return out;
}

/** `[text](dest)` / `![alt](dest)`, with an optional "title". */
const INLINE_LINK = /!?\[[^\]]*\]\(\s*([^)\s]*?)(?:\s+(?:"[^"]*"|'[^']*'|\([^)]*\)))?\s*\)/g;

/** A destination that names a file in this repository (not a URL, not a bare anchor). */
function isRepoRelative(dest) {
  if (!dest) return false;
  if (dest.startsWith('#')) return false;
  return !/^[a-z][a-z0-9+.\-]*:/i.test(dest) && !dest.startsWith('//');
}

/**
 * Every repo-relative link destination in one Markdown document, with the line
 * it was written on. Fenced blocks and code spans are removed first — that is
 * the whole discrimination mechanism.
 */
export function extractRelativeLinks(markdown) {
  const prose = stripCodeSpans(stripFencedBlocks(markdown));
  const found = [];
  prose.split('\n').forEach((line, idx) => {
    INLINE_LINK.lastIndex = 0;
    let m;
    while ((m = INLINE_LINK.exec(line)) !== null) {
      const dest = m[1];
      if (isRepoRelative(dest)) found.push({ line: idx + 1, target: dest });
    }
  });
  return found;
}

/** Strip `#fragment` / `?query` and percent-decode, then resolve against the linking file. */
function resolveTarget(root, fromFile, target) {
  let pathPart = target.split('#')[0].split('?')[0];
  if (!pathPart) return null;
  try {
    pathPart = decodeURIComponent(pathPart);
  } catch {
    /* leave as written */
  }
  const base = pathPart.startsWith('/') ? join(root, pathPart.slice(1)) : join(root, dirname(fromFile), pathPart);
  return resolve(base);
}

function listRecords(root, dir) {
  const abs = join(root, dir);
  if (!existsSync(abs)) return [];
  return readdirSync(abs, { withFileTypes: true, recursive: true })
    .filter((e) => e.isFile() && e.name.endsWith('.md'))
    .map((e) => relative(root, join(e.parentPath ?? abs, e.name)))
    .sort();
}

/**
 * Sweep a directory of records. Returns `{ checked, findings }` — `checked` is
 * the census of repo-relative destinations examined, so "clean tree" can be told
 * apart from "extractor matched nothing" (#4690's family).
 */
export function sweep(dir = ADR_DIR, root = process.cwd()) {
  const findings = [];
  let checked = 0;
  for (const file of listRecords(root, dir)) {
    const text = readFileSync(join(root, file), 'utf8');
    for (const { line, target } of extractRelativeLinks(text)) {
      checked += 1;
      const abs = resolveTarget(root, file, target);
      if (abs && !existsSync(abs)) findings.push({ file, line, target, resolved: relative(root, abs) });
    }
  }
  return { checked, findings };
}

function keyOf(f) {
  return `${f.file} -> ${f.target}`;
}

function runCheck() {
  const { checked, findings } = sweep();
  const problems = [];

  if (checked === 0) {
    problems.push(
      `No repo-relative link destinations found under ${ADR_DIR}/ at all.\n` +
        `  A green run over nothing is not a green run: either the directory moved or the\n` +
        `  extractor stopped matching. Fix the sweep, do not delete this guard.`,
    );
  }

  const baselineKeys = new Set(KNOWN_DEAD_TARGETS.map(keyOf));
  const seenKeys = new Set(findings.map(keyOf));

  const fresh = findings.filter((f) => !baselineKeys.has(keyOf(f)));
  if (fresh.length > 0) {
    problems.push(
      `${fresh.length} broken relative link(s) under ${ADR_DIR}/:\n` +
        fresh.map((f) => `  ${f.file}:${f.line}  ->  ${f.target}\n      resolves to: ${f.resolved} (missing)`).join('\n') +
        `\n\n  A decision record is only binding if the next reader can reach it. Fix the\n` +
        `  destination; do not add it to KNOWN_DEAD_TARGETS to make this green.\n` +
        `  Links inside fenced code blocks and inline code spans are already ignored, so\n` +
        `  an illustrative example does not need an entry either.`,
    );
  }

  const stale = KNOWN_DEAD_TARGETS.filter((e) => !seenKeys.has(keyOf(e)));
  if (stale.length > 0) {
    problems.push(
      `${stale.length} stale KNOWN_DEAD_TARGETS entr(y/ies) — the link is no longer broken:\n` +
        stale.map((e) => `  ${e.file}  ->  ${e.target}`).join('\n') +
        `\n\n  Delete these entries from scripts/check-adr-links.mjs. The baseline is\n` +
        `  shrink-only: an entry that outlives its excuse would hide the next break of\n` +
        `  the same link.`,
    );
  }

  if (problems.length > 0) {
    console.error(`\n❌ check-adr-links\n\n${problems.join('\n\n')}\n`);
    process.exit(1);
  }

  console.log(
    `✅ check-adr-links: ${checked} relative link destination(s) under ${ADR_DIR}/ resolve` +
      (KNOWN_DEAD_TARGETS.length > 0 ? ` (${KNOWN_DEAD_TARGETS.length} frozen on the shrink-only baseline)` : ''),
  );
}

/* ------------------------------------------------------------------ self-test */

function assert(cond, message) {
  if (!cond) {
    console.error(`❌ check-adr-links --self-test: ${message}`);
    process.exit(1);
  }
}

function selfTest() {
  // 1. Discrimination: verbatim link shapes are invisible; prose ones are not.
  const doc = [
    '# Fixture',
    '',
    'Prose link to [a record](./0001-real.md) and [a dead one](./0002-missing.md).',
    '',
    'Convention, by example (`[guide](./crm_lead_guide.md)`), inside a code span.',
    '',
    'Image ban (`![](…)`) inside a code span.',
    '',
    '```md',
    'See the [lead guide](./crm_lead_guide.md#qualification) for details.',
    '```',
    '',
    '~~~',
    '[tilde fenced](./nope.md)',
    '~~~',
    '',
    'External [site](https://example.com/x.md) and an [anchor](#section).',
  ].join('\n');
  const targets = extractRelativeLinks(doc).map((l) => l.target);
  assert(targets.includes('./0001-real.md'), 'prose link was not extracted');
  assert(targets.includes('./0002-missing.md'), 'second prose link was not extracted');
  assert(!targets.includes('./crm_lead_guide.md'), 'code-span link leaked into the extraction');
  assert(!targets.includes('./crm_lead_guide.md#qualification'), 'fenced-block link leaked into the extraction');
  assert(!targets.includes('…'), 'code-span image link leaked into the extraction');
  assert(!targets.includes('./nope.md'), 'tilde-fenced link leaked into the extraction');
  assert(!targets.some((t) => t.startsWith('http')), 'an http(s) destination was treated as repo-relative');
  assert(targets.length === 2, `expected exactly 2 prose destinations, got ${targets.length}: ${targets.join(', ')}`);
  assert(extractRelativeLinks(doc)[0].line === 3, 'line numbers did not survive verbatim stripping');

  // 2. Reverse verification on a real directory: the dead one IS reported, the
  //    illustrative ones are not, and removing the dead one turns the sweep green.
  const tmp = mkdtempSync(join(tmpdir(), 'adr-links-'));
  try {
    const dir = join(tmp, 'records');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, '0001-real.md'), '# Real\n');
    writeFileSync(join(dir, '0003-linker.md'), doc);
    const red = sweep('records', tmp);
    assert(red.checked === 2, `self-test sweep census expected 2, got ${red.checked}`);
    assert(red.findings.length === 1, `expected exactly 1 finding, got ${red.findings.length}`);
    assert(red.findings[0].target === './0002-missing.md', `wrong finding: ${red.findings[0].target}`);
    writeFileSync(join(dir, '0002-missing.md'), '# Now it exists\n');
    const green = sweep('records', tmp);
    assert(green.findings.length === 0, `expected 0 findings after the target appeared, got ${green.findings.length}`);
    assert(green.checked === 2, `census must not change when a target appears: ${green.checked}`);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }

  // 3. The ADR-0046 pin. The three illustrative strings must still BE in the
  //    record (otherwise this pin is measuring nothing), and none of them may
  //    reach the extractor.
  const conventionPath = join(process.cwd(), CONVENTION_RECORD);
  assert(existsSync(conventionPath), `${CONVENTION_RECORD} is missing — re-point this pin at the record that now documents the link convention (#6592)`);
  const convention = readFileSync(conventionPath, 'utf8');
  for (const target of CONVENTION_ILLUSTRATIVE_TARGETS) {
    assert(
      convention.includes(target),
      `${CONVENTION_RECORD} no longer contains the illustrative destination ${JSON.stringify(target)}. ` +
        `This pin has gone stale — re-point it at whatever now documents the package-docs link convention (#6592); ` +
        `do NOT delete it, it is the assertion that keeps the fence/code-span discrimination honest.`,
    );
  }
  const conventionTargets = extractRelativeLinks(convention).map((l) => l.target);
  for (const target of CONVENTION_ILLUSTRATIVE_TARGETS) {
    assert(
      !conventionTargets.includes(target),
      `${CONVENTION_RECORD}'s illustrative destination ${JSON.stringify(target)} was extracted as a real link. ` +
        `That record DEFINES the package-docs link convention and names a doc that deliberately does not exist here; ` +
        `the gate must skip fenced blocks and code spans, not the file (#6592).`,
    );
  }
  assert(conventionTargets.length > 0, `${CONVENTION_RECORD} yielded no real links at all — the extractor is over-stripping`);

  // 4. Stale-baseline detection is what makes KNOWN_DEAD_TARGETS shrink-only.
  const live = new Set(sweep().findings.map(keyOf));
  const staleEntries = KNOWN_DEAD_TARGETS.filter((e) => !live.has(keyOf(e)));
  assert(
    staleEntries.length === 0,
    `KNOWN_DEAD_TARGETS has ${staleEntries.length} entr(y/ies) that no longer match a broken link — delete them:\n` +
      staleEntries.map((e) => `  ${e.file} -> ${e.target}`).join('\n'),
  );

  console.log('✅ check-adr-links --self-test: discrimination, census, ADR-0046 pin and baseline staleness all verified');
}

/* Run only when invoked as a program. The extractor is exported so a future
 * caller (or a REPL session chasing a false positive) can import it without the
 * import itself sweeping the repo. */
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.includes('--self-test')) selfTest();
  else runCheck();
}
