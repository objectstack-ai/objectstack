#!/usr/bin/env node
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// check-future-spec-major — refuses prose that dates a change to an
// `@objectstack/spec` npm major ABOVE the one this tree publishes.
//
//   node scripts/check-future-spec-major.mjs [--self-test] [--census]
//
// WHY THIS EXISTS. ADR-0049 tombstones, refusal strings and doc pages name the
// release that carries a removal, so an author who meets one knows where to
// look. ADR-0087's level ruling (Amended 2026-09-13) settles which number that
// is: "**A tombstone names the npm release it ships in, ⛔ never the protocol
// major.** […] a retirement shipping `minor` lands in `17.x.y`". A pre-GA
// retirement therefore NEVER ships in the next npm major — an npm major is a
// planned act, never a side effect of one retirement card — so a tombstone
// dated to the next major sends the reader to a version that does not exist
// and, under that ruling, will not be the carrier.
//
// THE COST IS MEASURED, TWICE.
//
//   • It is a RECURRENCE. Ten sites of this exact class were corrected by hand
//     in July, the card closed `completed`, and NO gate landed with it. The
//     class came back at 36 live sites across 15 files.
//   • The wrong number caused real downstream harm: a sibling repository hung
//     a cleanup schedule on "the PR that pushes `@objectstack/spec` to 18" —
//     an event that will never come.
//
// WHY A GATE AND NOT ANOTHER SWEEP. The prose fix is one commit; the class
// returns because nothing reads the number. `docs/v17-docs-sweep.md` already
// carries a DETECTION FINGERPRINT row for it, and a fingerprint is a thing a
// human remembers to grep. This is the machine that greps.
//
// ── THE TWO WAYS THIS GATE COULD READ A FALSE ZERO, both measured ──────────
//
// A gate that reads zero and prints green is WORSE than no gate: it converts
// "nobody is looking" into "something is looking and it is fine" (#4690). Two
// independent axes make a naive matcher read zero on live sites:
//
//   (1) JOINTS. The phrase spans line breaks. `packages/core/src/
//       health-monitor.ts` splits it as
//           "'restartBackoff' was removed from PluginHealthCheck in @objectstack/spec "
//           + '18 (#12032, ADR-0049 enforce-or-remove) — it delayed a restart that '
//       so `git grep '@objectstack/spec 18'` MISSES it. Same for a JSDoc `*`
//       continuation and for a plain wrap with no concat operator at all.
//
//   (2) BACKTICKS. `packages/core/src/health-monitor.ts` also reads
//       "`restartBackoff` are tombstoned in `@objectstack/spec` 18, and this
//       class", and `content/docs/protocol/kernel/lifecycle.mdx` uses the same
//       form. The package name is a code span, so the unbackticked phrase does
//       not appear at all.
//
// Single-line, unbackticked: 33 sites / 14 files. Joints healed: 34 / 14.
// Joints + backticks: 39 / 17. Each axis is an independent way to ship green.
//
// ── AND THE WAY IT COULD READ A FALSE POSITIVE ─────────────────────────────
//
// Healing a joint is a whitespace decision, and an UNBOUNDED whitespace
// collapse manufactures findings out of column-aligned tables. The scratch
// instrument that first measured this card collapsed `\s+ → ' '` everywhere
// and duly reported `@objectstack/spec 414`, `432`, `4997`, `6526` — every one
// a table row, e.g. `scripts/partition-test-shards.mjs` reading
// `@objectstack/spec   414 files   496.4s`.
//
// So the gap between the package name and the number is bounded to a SENTENCE
// CONTINUATION and nothing else (`GAP` below): exactly one space on the same
// line, or a line break crossed through recognised joint syntax — a closing
// quote, a `+`, a JSDoc `*`, indentation. A run of two or more spaces or a tab
// is column alignment, never prose, and is not a gap. `PARTITION_SHARD_TABLE`
// in the self-test is that bound's fixture.
//
// ── THE CLASS IS DERIVED, NEVER HARDCODED ──────────────────────────────────
//
// `18` is not the rule. The rule is "an `@objectstack/spec` version whose
// MAJOR is above the major in `packages/spec/package.json`", read at runtime.
// A gate hardcoding `18` goes dormant the day the tree reaches 18 — and the
// next stale tombstone will say 19.
//
// The controls that make the class the right width, measured over the same
// corpus with this same matcher:
//
//   bare `@objectstack/spec 17`     588 sites / 174 files — ALL legitimate
//   dotted `@objectstack/spec 17.x` 433 sites at 17.0.0 alone — legitimate
//   historical bare 13 / 15 / 16    legitimate, below the current major
//   `@objectstack/spec 47`          0 sites
//
// A gate refusing every bare major fails the tree on day one; a gate refusing
// only the literal 18 fails nothing the day after. Above-the-major is the one
// width that is empty on a correct tree and non-empty on a wrong one.
//
// The PROTOCOL major is a different number and is deliberately out of reach:
// `toMajor: 18` in `packages/spec/src/conversions/registry.ts`, `step18` in
// the migrations registry and the `PROTOCOL_VERSION` ladder are all correct.
// ADR-0087: "Every 'major' above means a *protocol* major […] the two move
// independently." Nothing here matches a number that is not directly attached
// to the package name, so "retired in protocol major 18" is untouched.
//
// ── EXEMPTIONS: A QUOTATION IS NOT A TOMBSTONE ─────────────────────────────
//
// The hardest requirement is not the joints. Three sites CITE the bad number
// in order to forbid it, and a gate that cannot tell a tombstone from a
// quotation of a bad tombstone REDS ON THE RULING THAT FORBIDS THE BUG:
//
//   • `docs/adr/0087-…md` — the ruling itself, quoting the wrong form.
//   • `docs/v17-docs-sweep.md` — the sweep ledger's detection fingerprint for
//     this very class, plus the log line recording that it was added.
//   • `packages/spec/src/shared/retired-key.test.ts` — a synthetic "next
//     major" fixture that MUST name a version that does not exist.
//
// Two mechanisms, in this order, and NEITHER is a path allowlist:
//
//   R1 — STRUCTURAL. A citation wholly inside a Markdown DOUBLE-backtick code
//        span (`` … ``) is the phrase quoted AS A PATTERN, not a sentence
//        dating a removal. That is what a fingerprint row is, so the sweep
//        ledger's table needs no ledger entry and the next fingerprint row
//        will not either. A SINGLE-backtick span is NOT exempt — that is the
//        live tombstone form axis (2) above.
//
//   R2 — A WITNESSED, SELF-INVALIDATING LEDGER (`QUOTATION_EXEMPTIONS`). Each
//        entry names a file, the major it excuses, a `witness` regex that must
//        still match the quoting sentence, a pinned `covers` count, and a
//        written `why`. A path allowlist says "this file may say anything";
//        this says "this file may say EXACTLY THIS, and must still say it".
//        Three refusals follow from that and each has a self-test battery:
//          – a NEW citation in an exempt file matches no witness → RED, so the
//            exemption does not blind the rest of the file;
//          – an entry whose witness matches nothing → RED, so editing the
//            quotation away kills its exemption instead of leaving a hole;
//          – an entry covering more or fewer findings than pinned → RED, so
//            the fixture cannot grow a fifth site unnoticed.
//        Every failure prints the entry's `why`, so the reason is read at the
//        moment it is questioned rather than looked up.
//
// ⛔ EVERY ABSENCE IS RED, never a skip (#4690): no scanned file, a corpus
// holding no `@objectstack/spec` mention at all, or an unreadable
// `packages/spec/package.json` each fail. A gate that cannot find its input
// must not report that the input is fine.
//
// LAYERING — a root script, not a package filter: this is repo-wide prose
// policy over hand-written text in `packages/**`, `content/docs/**`, `docs/**`
// and `skills/**` at once, which is what root `scripts/` is for. It generates
// nothing and reads no package build output.

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isEntrypoint } from './invoked-as.mjs';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SPEC_MANIFEST = 'packages/spec/package.json';
const PKG = '@objectstack/spec';

// Extensions that can hold prose a reader acts on. Everything else in the tree
// is data or binary: a citation there is not a sentence dating a removal.
const SCANNED_EXTENSIONS = Object.freeze([
  '.ts', '.tsx', '.mts', '.cts', '.js', '.mjs', '.cjs', '.jsx',
  '.md', '.mdx', '.json', '.yml', '.yaml', '.sh', '.txt',
]);

// `pnpm-lock.yaml` names every workspace package and holds no prose.
const SKIPPED_BASENAMES = Object.freeze(['pnpm-lock.yaml']);

// THE DETECTOR IS NOT ITS OWN CORPUS. This file documents the class in its
// header and holds the adversarial fixtures in its self-test table, so it
// cites the bad form dozens of times BY NECESSITY — an instrument that reds on
// its own fixtures cannot ship. The exclusion is by file identity, derived
// below, never a path pattern anyone else can land inside.
//
// ⛔ That is a hole unless something watches it, so the exclusion comes with a
// compensating control in the opposite direction: this file MUST still contain
// at least `SELF_FIXTURE_FLOOR` citations above the published major. Gut the
// fixtures — the one edit the exclusion would otherwise hide — and the gate
// REDS on itself instead of going quietly green.
const SELF_PATH = 'scripts/check-future-spec-major.mjs';
const SELF_FIXTURE_FLOOR = 12;

// ── The matcher ────────────────────────────────────────────────────────────
//
// GAP is the whole false-positive bound, so it is spelled out rather than
// folded into one `\s*`:
//
//   G1  a single space on the same line            `…/spec 18`
//   G2  a line break crossed through joint syntax  `…/spec " \n + '18 (…`
//
// G2's crossing is: an optional closing quote and/or `+` before the break,
// then indentation, then an optional JSDoc `*`, an optional `+`, an optional
// opening quote, and trailing indentation. Every one of those is syntax that
// CONTINUES a sentence. Nothing else crosses a break, and no run of two or
// more spaces or tabs is ever a gap.
const GAP =
  '(?:'
  + '[ ]'                                                                // G1
  + '|'
  // G2, the side BEFORE the break: at most one space on its own, or an
  // optional space then a closing quote and/or a `+`. A run of two or more
  // spaces with no joint syntax at all is alignment, so it is NOT a gap.
  + '(?:[ \\t]?|[ \\t]?[\'"][ \\t]*\\+?[ \\t]*|[ \\t]?\\+[ \\t]*)'
  + '\\r?\\n'
  // G2, the side AFTER the break: indentation, an optional JSDoc `*`, an
  // optional leading `+`, an optional opening quote.
  + '(?:[ \\t]*)(?:\\*[ \\t]*)?(?:\\+[ \\t]*)?[\'"]?[ \\t]*'
  + ')';

// A backtick may close the package-name span and/or open the number's own.
// `…/spec` 18`, `…/spec 18`, @objectstack/spec `18` are all one citation.
const CITATION = new RegExp(
  '@objectstack/spec' + '`?' + GAP + '`?' + '(\\d+(?:\\.\\d+)*)',
  'g',
);

// A Markdown DOUBLE-backtick span quotes the phrase AS A PATTERN (R1).
//
// Two guards, each one a measured false zero this gate would otherwise ship:
//   • `(?<!`)…(?!`)` on BOTH delimiters — without them a three-backtick FENCE
//     opens a "span" that runs to the next fence, and every citation inside a
//     fenced code block is silently exempted. `packages/core/
//     PHASE2_IMPLEMENTATION.md` holds two live sites inside a ```ts fence and
//     went green on exactly that bug while this gate was being written.
//   • no newline inside — a pattern quotation is one sentence in one table
//     row. An unbounded span reaches across paragraphs to the next stray pair.
const DOUBLE_BACKTICK_SPAN = /(?<!`)``(?!`)(?:[^`\n]|`(?!`))*(?<!`)``(?!`)/g;

/**
 * Every finding in one file's text. A finding carries the offset so R1 can ask
 * whether it sits inside a pattern-quotation span, and the line it starts on
 * so the report and the ledger witnesses have something to read.
 */
function findCitations(text) {
  const spans = [];
  DOUBLE_BACKTICK_SPAN.lastIndex = 0;
  for (let m = DOUBLE_BACKTICK_SPAN.exec(text); m; m = DOUBLE_BACKTICK_SPAN.exec(text)) {
    spans.push([m.index, m.index + m[0].length]);
  }
  const lineStarts = [0];
  for (let i = 0; i < text.length; i += 1) if (text[i] === '\n') lineStarts.push(i + 1);
  const lineOf = (offset) => {
    let lo = 0;
    let hi = lineStarts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (lineStarts[mid] <= offset) lo = mid; else hi = mid - 1;
    }
    return lo + 1;
  };

  const found = [];
  CITATION.lastIndex = 0;
  for (let m = CITATION.exec(text); m; m = CITATION.exec(text)) {
    const version = m[1];
    const line = lineOf(m.index);
    const lineText = text.slice(lineStarts[line - 1], (lineStarts[line] ?? text.length + 1) - 1);
    // The sentence a witness is matched against: the starting line plus, when
    // the citation crossed a break, the line the number landed on.
    const endLine = lineOf(m.index + m[0].length - 1);
    const tail = endLine === line
      ? ''
      : `\n${text.slice(lineStarts[endLine - 1], (lineStarts[endLine] ?? text.length + 1) - 1)}`;
    found.push({
      version,
      major: Number.parseInt(version.split('.')[0], 10),
      dotted: version.includes('.'),
      wrapped: endLine !== line,
      line,
      lineText,
      context: `${lineText}${tail}`,
      patternQuoted: spans.some(([a, b]) => m.index >= a && m.index + m[0].length <= b),
    });
  }
  return found;
}

// ── R2: the witnessed, self-invalidating ledger ────────────────────────────
//
// ⛔ Adding an entry here is not a way to silence a finding — it is a claim
// that the sentence does not DATE anything to that version. A tombstone, a
// refusal string, a doc page and a generated reference row are never that.
// Fix the number instead.
//
// Two kinds, and both are measured in this tree:
//
//   kind: 'quotation'   — the sentence cites the wrong number in order to
//                         forbid it, or fixtures a version that must not
//                         exist. Rewriting it would corrupt the authority the
//                         card cites, or delete the thing under test.
//   kind: 'measurement' — the number is a HIT COUNT or a pass/total ratio
//                         that happens to sit one space after the package
//                         name (`@objectstack/spec 4997 on the same corpus`,
//                         `` `@objectstack/spec` 6526/6526 ``). No whitespace
//                         rule can tell these from a version, and the matcher
//                         is deliberately NOT narrowed to try: a narrower
//                         matcher is how this class reads a false zero. They
//                         are declared here instead, one witness each.
const QUOTATION_EXEMPTIONS = Object.freeze([
  {
    file: 'docs/adr/0087-metadata-protocol-upgrade-contract.md',
    major: 18,
    kind: 'quotation',
    covers: 1,
    witness: /"`@objectstack\/spec` 18" is wrong on the day it is written/,
    why:
      'The ADR-0087 level ruling itself, quoting the wrong form in order to '
      + 'forbid it. This gate exists because of this sentence; reddening on it '
      + 'would make the gate refuse its own authority.',
  },
  {
    file: 'docs/v17-docs-sweep.md',
    major: 18,
    kind: 'quotation',
    covers: 1,
    witness: /\*\*Fingerprint added:\*\* the `@objectstack\/spec` 18 row above/,
    why:
      'The sweep ledger\'s append-only run log, recording the run that added '
      + 'the detection fingerprint for this class. The log is history: '
      + 'rewriting the number would falsify what that run did.',
  },
  {
    file: 'packages/spec/src/shared/retired-key.test.ts',
    major: 99,
    kind: 'quotation',
    covers: 4,
    witness: /was removed in @objectstack\/spec 99/,
    why:
      'A deliberate synthetic "next major" fixture. These four strings MUST '
      + 'name a version that does not exist — that is what they are testing. '
      + 'A real tombstone never says 99.',
  },
  {
    file: 'packages/spec/src/migrations/entries/semantic/18.kernel-health-check-and-hot-reload-durations-unit-in-key.ts',
    major: 4997,
    kind: 'measurement',
    covers: 1,
    witness: /controls objectstack 12966 and @objectstack\/spec 4997 on the same corpus/,
    why:
      'A hit COUNT in a recorded evidence sentence — 4997 occurrences of the '
      + 'package name across a sibling corpus, beside its `objectstack 12966` '
      + 'twin. Not a version, and no whitespace rule can tell a count from a '
      + 'version when both sit one space after the name.',
  },
  {
    file: 'packages/spec/src/migrations/registry.ts',
    major: 4997,
    kind: 'measurement',
    covers: 1,
    witness: /controls objectstack 12966 and @objectstack\/spec 4997 on the same corpus/,
    why:
      'The same recorded evidence sentence, in the registry that carries the '
      + 'semantic entry above. A count, not a version.',
  },
  {
    file: 'docs/adr/0021-analytics-dataset-semantic-layer.md',
    major: 6526,
    kind: 'measurement',
    covers: 1,
    witness: /`@objectstack\/spec` 6526\/6526/,
    why:
      'A pass/total RATIO from a recorded downstream verification run '
      + '(6526 of 6526), beside `turbo build 72/72` and `turbo test 123/123`. '
      + 'Not a version.',
  },
]);

// ── Corpus ─────────────────────────────────────────────────────────────────

/**
 * Tracked text files, read from disk so an uncommitted edit is seen. Falls
 * back to nothing on a non-git tree, which the caller turns into a RED.
 */
function listTrackedFiles(root) {
  let out;
  try {
    out = execFileSync('git', ['-C', root, 'ls-files', '-z'], {
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    });
  } catch {
    return [];
  }
  return out.split('\0').filter(Boolean).filter((rel) => {
    if (SKIPPED_BASENAMES.includes(rel.split('/').pop())) return false;
    return SCANNED_EXTENSIONS.some((ext) => rel.endsWith(ext));
  });
}

/** The major this tree publishes. Unreadable ⇒ the caller REDs. */
function readSpecMajor(readFile) {
  const raw = readFile(SPEC_MANIFEST);
  if (raw === null) return { problem: `${SPEC_MANIFEST} is unreadable — the class this gate refuses is derived from its \`version\`, so without it there is no class and a green verdict would be meaningless.` };
  let version;
  try {
    version = JSON.parse(raw).version;
  } catch (err) {
    return { problem: `${SPEC_MANIFEST} is not parseable JSON (${err.message}).` };
  }
  const major = Number.parseInt(String(version ?? '').split('.')[0], 10);
  if (!Number.isInteger(major)) {
    return { problem: `${SPEC_MANIFEST} declares no usable \`version\` (read ${JSON.stringify(version)}).` };
  }
  return { major, version };
}

// ── The check ──────────────────────────────────────────────────────────────

/**
 * @param files {Array<{file: string, text: string}>} the scanned corpus
 * @param ledger the QUOTATION_EXEMPTIONS to evaluate against
 * @param manifestRaw the text of packages/spec/package.json, or null
 */
function runAllChecks(files, ledger, manifestRaw, selfPath = null) {
  const problems = [];
  const readFile = (rel) => (rel === SPEC_MANIFEST ? manifestRaw : null);
  const spec = readSpecMajor(readFile);
  if (spec.problem) return { problems: [spec.problem], findings: [], census: new Map(), specMajor: null };

  if (files.length === 0) {
    problems.push(
      'no file was scanned at all — the corpus is empty. A gate that cannot find its '
      + 'input must not report that the input is fine (#4690).',
    );
    return { problems, findings: [], census: new Map(), specMajor: spec.major };
  }

  const census = new Map();
  const live = [];
  const exemptHits = ledger.map(() => []);
  let selfFixtures = 0;

  for (const { file, text } of files) {
    if (!text.includes(PKG)) continue;
    for (const f of findCitations(text)) {
      if (selfPath !== null && file === selfPath) {
        if (f.major > spec.major) selfFixtures += 1;
        continue;
      }
      const key = f.dotted ? `${f.major}.x (dotted)` : `${f.major} (bare)`;
      const bucket = census.get(key) ?? { sites: 0, files: new Set() };
      bucket.sites += 1;
      bucket.files.add(file);
      census.set(key, bucket);

      if (f.major <= spec.major) continue;          // legitimate: at or below the published major
      if (f.patternQuoted) continue;                // R1: quoted as a pattern
      const idx = ledger.findIndex(
        (e) => e.file === file && e.major === f.major && e.witness.test(f.context),
      );
      if (idx >= 0) { exemptHits[idx].push(f); continue; }   // R2
      live.push({ file, ...f });
    }
  }

  // The corpus must contain the package name SOMEWHERE. Zero mentions across a
  // repo whose own packages are named `@objectstack/*` means the reader broke,
  // not that the tree is clean.
  const mentioning = files.filter((f) => f.text.includes(PKG)).length;
  if (mentioning === 0) {
    problems.push(
      `not one of the ${files.length} scanned files mentions \`${PKG}\` — in THIS repository that `
      + 'is a broken reader, not a clean tree. Every verdict below would be vacuous.',
    );
  }

  if (selfPath !== null && files.some((f) => f.file === selfPath) && selfFixtures < SELF_FIXTURE_FLOOR) {
    problems.push(
      `${selfPath} holds ${selfFixtures} citation(s) above the published major, below the floor of `
      + `${SELF_FIXTURE_FLOOR}. This file is excluded from its own scan because its header documents `
      + 'the class and its self-test table holds the adversarial fixtures — both cite the bad form by '
      + 'necessity. Gutting those fixtures is the one edit that exclusion would otherwise hide, so the '
      + 'floor watches it from the other side. Restore the fixtures, or re-pin SELF_FIXTURE_FLOOR '
      + 'deliberately and say why.',
    );
  }

  for (const f of live) {
    problems.push(
      `${f.file}:${f.line} — dates a change to \`${PKG}\` ${f.version}, above the published major `
      + `${spec.major} (${SPEC_MANIFEST} → ${spec.version})`
      + `${f.wrapped ? ' [the citation crosses a line break — a single-line grep misses it]' : ''}\n`
      + `      ${f.lineText.trim().slice(0, 160)}\n`
      + '      Name the npm release that actually carries the change. Already shipped ⇒ the version '
      + 'from `packages/spec/CHANGELOG.md`. Not shipped yet ⇒ the bare published major, which ADR-0087 '
      + 'guarantees is the carrier (a pre-GA retirement ships `minor`), never a guessed minor. Quoting '
      + 'the bad number on purpose ⇒ a witnessed QUOTATION_EXEMPTIONS entry in this script.',
    );
  }

  ledger.forEach((entry, i) => {
    const hits = exemptHits[i];
    if (hits.length === entry.covers) return;
    problems.push(
      hits.length === 0
        ? `QUOTATION_EXEMPTIONS entry ${i} (${entry.file}, major ${entry.major}) matched NOTHING — its `
          + `witness ${entry.witness} no longer finds the sentence it excuses. The quotation moved or `
          + `was edited away, so the exemption is now a hole. Re-point it or delete it.\n      why: ${entry.why}`
        : `QUOTATION_EXEMPTIONS entry ${i} (${entry.file}, major ${entry.major}) covers ${hits.length} `
          + `citation(s), pinned at ${entry.covers} — lines ${hits.map((h) => h.line).join(', ')}. An `
          + `exemption is a claim about specific sentences, never about the file. Re-pin \`covers\` `
          + `deliberately, or fix the new citation.\n      why: ${entry.why}`,
    );
  });

  return { problems, findings: live, census, specMajor: spec.major };
}

// ── Self-test ──────────────────────────────────────────────────────────────
//
// This gate's defect class IS its matching rule, and a clean tree cannot
// observe a weakened rule: green means the finding set is empty, weakening can
// only shrink that set, and the empty set is the fixed point of shrinking. The
// production verdict is identical before and after the rule breaks. This
// self-test supplies the adversarial input a correct tree by construction does
// not contain, so it is the ONLY instrument watching the rule.
//
// Set as `selfTest()`'s last statement, after its verdict prints, and read at
// the dispatch: a `return` above that line prints nothing and still exits 0 —
// a self-test that never finished, reported as one that passed. The exit code
// stays load-bearing, so the handshake is a flag rather than a return value.
let selfTestReachedVerdict = false;

// The roster is a LITERAL the table is checked against, never derived from it:
// `cases.length` moves with the table, so a deleted row would delete its own
// floor. Each row LABEL is a declared battery with a floor of 1, and
// `registerCase(c.label)` is the FIRST statement of the loop body — before any
// guard or `try` — so the floor asserts REACH. A count alone cannot say which
// row stopped running; a set difference names it.
const SELF_TEST_BATTERIES = Object.freeze({
  'plain same-line citation above the major → RED': 1,
  'WRAPPED across a concat joint, the shape a single-line grep misses → RED': 1,
  'WRAPPED with the `+` trailing the first line instead of leading the second → RED': 1,
  'WRAPPED across a JSDoc `*` continuation → RED': 1,
  'WRAPPED across a plain wrap with no concat operator at all → RED': 1,
  'BACKTICKED package name, the second false-zero axis → RED': 1,
  'both name and number backticked → RED': 1,
  'a sentence-final citation (`18.`) is bare, not dotted → RED': 1,
  'a DOTTED version above the major is equally nonexistent → RED': 1,
  'legitimate bare citation AT the published major → GREEN': 1,
  'legitimate dotted citation at the published major → GREEN': 1,
  'historical majors below the published one → GREEN': 1,
  'column-aligned table, the unbounded-collapse false positive → GREEN': 1,
  'a tab between name and number is alignment, not prose → GREEN': 1,
  'the protocol major is never attached to the package name → GREEN': 1,
  'R1 — a double-backtick pattern span → GREEN': 1,
  'R1 — a SINGLE-backtick span is the live tombstone form → RED': 1,
  'R1 — a ```-fenced code block is NOT a pattern span → RED': 1,
  'R2 — a witnessed quotation entry → GREEN': 1,
  'R2 — a witnessed measurement count → GREEN': 1,
  'R2 — a NEW citation in an exempt file is not covered → RED (not a path allowlist)': 1,
  'R2 — a witness that matches nothing → RED (self-invalidating)': 1,
  'R2 — a ledger entry covering more citations than pinned → RED': 1,
  'the class is DERIVED — the same corpus is green once the tree reaches 18': 1,
  'the detector excludes its OWN source, which must cite the pattern → GREEN': 1,
  'the detector\'s own source stripped of its fixtures → RED (instrument gutted)': 1,
  'an empty corpus → RED, never a green skip (#4690)': 1,
  'a corpus that never mentions the package → RED (broken reader)': 1,
  'an unreadable spec manifest → RED': 1,
});

// Deleting an entry silences that battery's floor exactly as effectively as
// zeroing it, so the roster's own size is pinned. This is also half of the
// duplicate-label refusal: two rows sharing a label collapse to ONE key above,
// so the roster falls below this number; the table cross-check names WHICH
// label collided.
const SELF_TEST_BATTERY_FLOOR = 29;

const MANIFEST_17 = JSON.stringify({ name: PKG, version: '17.4.0' });
const MANIFEST_18 = JSON.stringify({ name: PKG, version: '18.0.0' });

// The column-aligned table that broke the scratch instrument, verbatim.
const PARTITION_SHARD_TABLE =
  '//   @objectstack/cli                135 files   548.6s / 474.4s\n'
  + '//   @objectstack/spec               414 files   496.4s\n'
  + '//   @objectstack/service-automation  83 files   118.9s\n';

function selfTest() {
  const F = (text, file = 'packages/core/src/demo.ts') => [{ file, text }];

  const cases = [
    {
      label: 'plain same-line citation above the major → RED',
      files: F("'gone' was removed from PluginHealthCheck in @objectstack/spec 18 (ADR-0049)."),
      expect: 'red',
      wants: [/demo\.ts:1 .*18, above the published major 17/],
    },
    {
      label: 'WRAPPED across a concat joint, the shape a single-line grep misses → RED',
      files: F(
        '  const G =\n'
        + '    "\'restartBackoff\' was removed from PluginHealthCheck in @objectstack/spec "\n'
        + "    + '18 (#12032, ADR-0049 enforce-or-remove) — it delayed a restart.';\n",
      ),
      expect: 'red',
      wants: [/crosses a line break/],
    },
    {
      label: 'WRAPPED with the `+` trailing the first line instead of leading the second → RED',
      files: F(
        "  const G = 'removed in @objectstack/spec ' +\n"
        + "    '18 (ADR-0049). Delete the key.';\n",
      ),
      expect: 'red',
      wants: [/crosses a line break/],
    },
    {
      label: 'WRAPPED across a JSDoc `*` continuation → RED',
      files: F(
        '/**\n'
        + ' * `restartBackoff` is tombstoned in @objectstack/spec\n'
        + ' * 18, and this class refuses a config that carries it.\n'
        + ' */\n',
      ),
      expect: 'red',
      wants: [/crosses a line break/],
    },
    {
      label: 'WRAPPED across a plain wrap with no concat operator at all → RED',
      files: F(
        'The three keys were removed in @objectstack/spec\n'
        + '18 under ADR-0049 enforce-or-remove.\n',
        'content/docs/protocol/kernel/lifecycle.mdx',
      ),
      expect: 'red',
      wants: [/lifecycle\.mdx:1/, /crosses a line break/],
    },
    {
      label: 'BACKTICKED package name, the second false-zero axis → RED',
      files: F(' * `restartBackoff` are tombstoned in `@objectstack/spec` 18, and this class\n'),
      expect: 'red',
      wants: [/above the published major 17/],
    },
    {
      label: 'both name and number backticked → RED',
      files: F('Removed in `@objectstack/spec 18` (ADR-0049).\n', 'docs/notes.md'),
      expect: 'red',
      wants: [/notes\.md:1/],
    },
    {
      label: 'a sentence-final citation (`18.`) is bare, not dotted → RED',
      files: F('`watchPatterns` was removed in @objectstack/spec 18. Declare your globs elsewhere.\n'),
      expect: 'red',
      wants: [/\`@objectstack\/spec\` 18, above/],
    },
    {
      label: 'a DOTTED version above the major is equally nonexistent → RED',
      files: F('`schedule` was removed in @objectstack/spec 18.0.0 (ADR-0049).\n'),
      expect: 'red',
      wants: [/18\.0\.0, above the published major 17/],
    },
  ];

  cases.push(
    {
      label: 'legitimate bare citation AT the published major → GREEN',
      files: F(
        "'interval' was renamed to 'intervalMs' on PluginHealthCheck in\n"
        + "  + '@objectstack/spec 17 — the unit lives in the key name.';\n",
      ),
      expect: 'green',
    },
    {
      label: 'legitimate dotted citation at the published major → GREEN',
      files: F('`reference_to` was removed in `@objectstack/spec` 17.3.0 (ADR-0049).\n'),
      expect: 'green',
    },
    {
      label: 'historical majors below the published one → GREEN',
      files: F(
        '- **Adopt @objectstack/spec 13** — the Permission Model v2 rename.\n'
        + 'Since `@objectstack/spec` 15 (ADR-0089 D3a) the form field and page\n'
        + 'shapes agree. Reworked again in @objectstack/spec 16.\n',
        'content/docs/releases/v13.mdx',
      ),
      expect: 'green',
    },
    {
      label: 'column-aligned table, the unbounded-collapse false positive → GREEN',
      files: F(PARTITION_SHARD_TABLE, 'scripts/partition-test-shards.mjs'),
      expect: 'green',
    },
    {
      label: 'a tab between name and number is alignment, not prose → GREEN',
      files: F('| @objectstack/spec\t432 | shard b |\n', 'docs/shards.md'),
      expect: 'green',
    },
    {
      label: 'the protocol major is never attached to the package name → GREEN',
      files: F(
        'The key was retired in @objectstack/spec protocol major 18 (D2 ladder).\n'
        + 'const STEP = { toMajor: 18, id: 18 };\n'
        + 'export const step18 = { toMajor: 18 };\n',
        'packages/spec/src/conversions/registry.ts',
      ),
      expect: 'green',
    },
    {
      label: 'R1 — a double-backtick pattern span → GREEN',
      files: F(
        '| `` `@objectstack/spec` 18 `` (any v17 removal dated to **18**) | dates a removal '
        + 'that ships in **17** to the next major | #4286 |\n',
        'docs/v17-docs-sweep.md',
      ),
      expect: 'green',
    },
    {
      label: 'R1 — a SINGLE-backtick span is the live tombstone form → RED',
      files: F('Removed in `@objectstack/spec` 18 under ADR-0049.\n', 'docs/v17-docs-sweep.md'),
      expect: 'red',
      wants: [/v17-docs-sweep\.md:1/],
    },
    {
      label: 'R1 — a ```-fenced code block is NOT a pattern span → RED',
      // Verbatim shape of `packages/core/PHASE2_IMPLEMENTATION.md`, which went
      // GREEN while this gate was being written: a three-backtick fence opened
      // a "double-backtick span" that swallowed every citation inside it.
      files: F(
        '```ts\n'
        + '// The monitor REPORTS; it does not act. `autoRestart`, `maxRestartAttempts`\n'
        + '// and `restartBackoff` were removed in @objectstack/spec 18 (ADR-0049) because\n'
        + '// no restart ever happened.\n'
        + '```\n',
        'packages/core/PHASE2_IMPLEMENTATION.md',
      ),
      expect: 'red',
      wants: [/PHASE2_IMPLEMENTATION\.md:3/],
    },
    {
      label: 'R2 — a witnessed measurement count → GREEN',
      files: F(
        "        + 'the string debounceDelay each occur 0 times across its 8228 tracked files, against lit '\n"
        + "        + 'controls objectstack 12966 and @objectstack/spec 4997 on the same corpus.',\n",
        'packages/spec/src/migrations/registry.ts',
      ),
      ledger: [QUOTATION_EXEMPTIONS[4]],
      expect: 'green',
    },
    {
      label: 'R2 — a witnessed quotation entry → GREEN',
      files: F(
        'The ruling: prose dating it to\n'
        + '"`@objectstack/spec` 18" is wrong on the day it is written (#18021).\n',
        'docs/adr/0087-metadata-protocol-upgrade-contract.md',
      ),
      ledger: [QUOTATION_EXEMPTIONS[0]],
      expect: 'green',
    },
    {
      label: 'R2 — a NEW citation in an exempt file is not covered → RED (not a path allowlist)',
      files: F(
        'The ruling: prose dating it to\n'
        + '"`@objectstack/spec` 18" is wrong on the day it is written (#18021).\n'
        + '\nAnd separately: `startTime` was removed in @objectstack/spec 18 (ADR-0049).\n',
        'docs/adr/0087-metadata-protocol-upgrade-contract.md',
      ),
      ledger: [QUOTATION_EXEMPTIONS[0]],
      expect: 'red',
      wants: [/0087-metadata-protocol-upgrade-contract\.md:4/],
    },
    {
      label: 'R2 — a witness that matches nothing → RED (self-invalidating)',
      files: F('Nothing here quotes the bad form, though the package is named: @objectstack/spec 17.\n',
        'docs/adr/0087-metadata-protocol-upgrade-contract.md'),
      ledger: [QUOTATION_EXEMPTIONS[0]],
      expect: 'red',
      wants: [/matched NOTHING/, /no longer finds the sentence it excuses/],
    },
    {
      label: 'R2 — a ledger entry covering more citations than pinned → RED',
      files: F(
        "const A = '`gone` was removed in @objectstack/spec 99 (#0000). Delete the key.';\n"
        + "const B = '`legacyMode` was removed in @objectstack/spec 99 (#0000). Delete the key.';\n"
        + "const C = '`x` was removed in @objectstack/spec 99 — a third.';\n"
        + "const D = '`y` was removed in @objectstack/spec 99 — a fourth.';\n"
        + "const E = '`z` was removed in @objectstack/spec 99 — a FIFTH, unpinned.';\n",
        'packages/spec/src/shared/retired-key.test.ts',
      ),
      ledger: [QUOTATION_EXEMPTIONS[2]],
      expect: 'red',
      wants: [/covers 5 citation\(s\), pinned at 4/],
    },
    {
      label: 'the class is DERIVED — the same corpus is green once the tree reaches 18',
      files: F('`watchPatterns` was removed in @objectstack/spec 18 (ADR-0049).\n'),
      manifest: MANIFEST_18,
      expect: 'green',
    },
    {
      label: 'the detector excludes its OWN source, which must cite the pattern → GREEN',
      files: [{
        file: SELF_PATH,
        text: Array.from(
          { length: SELF_FIXTURE_FLOOR },
          (_, i) => `// fixture ${i}: removed in @objectstack/spec 18 (ADR-0049).`,
        ).join('\n'),
      }],
      selfPath: SELF_PATH,
      expect: 'green',
    },
    {
      label: 'the detector\'s own source stripped of its fixtures → RED (instrument gutted)',
      files: [{
        file: SELF_PATH,
        text: '// removed in @objectstack/spec 18 (ADR-0049).\n// and nothing else.\n',
      }],
      selfPath: SELF_PATH,
      expect: 'red',
      wants: [/below the floor of 12/, /the one edit that exclusion would otherwise hide/],
    },
    {
      label: 'an empty corpus → RED, never a green skip (#4690)',
      files: [],
      expect: 'red',
      wants: [/no file was scanned at all/],
    },
    {
      label: 'a corpus that never mentions the package → RED (broken reader)',
      files: F('Nothing about the protocol here at all.\n'),
      expect: 'red',
      wants: [/is a broken reader, not a clean tree/],
    },
    {
      label: 'an unreadable spec manifest → RED',
      files: F('`watchPatterns` was removed in @objectstack/spec 18 (ADR-0049).\n'),
      manifest: null,
      expect: 'red',
      wants: [/is unreadable/],
    },
  );

  // The ledger this self-test's floor is evaluated against.
  const batterySeen = new Map();
  const registerCase = (name) => {
    batterySeen.set(name, (batterySeen.get(name) ?? 0) + 1);
  };

  let failed = 0;
  for (const c of cases) {
    registerCase(c.label);
    let problems;
    try {
      ({ problems } = runAllChecks(
        c.files,
        c.ledger ?? [],
        'manifest' in c ? c.manifest : MANIFEST_17,
        c.selfPath ?? null,
      ));
    } catch (err) {
      console.error(`  ✗ ${c.label}\n      threw: ${err.message}`);
      failed += 1;
      continue;
    }
    const isRed = problems.length > 0;
    if (isRed !== (c.expect === 'red')) {
      failed += 1;
      console.error(
        `  ✗ ${c.label}\n      expected ${c.expect}, got ${isRed ? 'red' : 'green'}`
        + (isRed ? `\n      ${problems.join('\n      ')}` : ''),
      );
      continue;
    }
    let ok = true;
    for (const want of c.wants ?? []) {
      if (problems.some((p) => want.test(p))) continue;
      ok = false;
      console.error(
        `  ✗ ${c.label}\n      red for the wrong reason — no message matched ${want}\n`
        + `      ${problems.join('\n      ')}`,
      );
    }
    if (!ok) { failed += 1; continue; }
    console.log(`  ✓ ${c.label}`);
  }

  // A corpus-scale positive control. Every battery above runs on synthetic
  // text, so a matcher that stopped reading real files would keep them all
  // green. This drives the REAL corpus and asserts the reader reaches it.
  {
    const real = readCorpus();
    const mentioning = real.filter((f) => f.text.includes(PKG));
    if (real.length < 500 || mentioning.length < 50) {
      failed += 1;
      console.error(
        `  ✗ corpus positive control: read ${real.length} scanned file(s), `
        + `${mentioning.length} mentioning \`${PKG}\` — the reader is not reaching the tree.`,
      );
    } else {
      console.log(
        `  ✓ corpus positive control: ${real.length} scanned file(s), `
        + `${mentioning.length} mentioning \`${PKG}\``,
      );
    }
  }

  // Evaluated after every row has had its chance and BEFORE the verdict, so
  // the success line can only be printed by a run in which the set of rows
  // that registered EQUALS the set declared.
  const floorFailure = (message) => {
    console.error(`✗ self-test floor: ${message}`);
    failed += 1;
  };
  const declaredBatteries = Object.keys(SELF_TEST_BATTERIES);
  let floorBreached = false;
  if (declaredBatteries.length < SELF_TEST_BATTERY_FLOOR) {
    floorBreached = true;
    floorFailure(
      `SELF_TEST_BATTERIES declares ${declaredBatteries.length} batteries, below the pinned `
      + `${SELF_TEST_BATTERY_FLOOR} — a battery deleted from the roster takes its own floor with it.`,
    );
  }
  const rowLabels = cases.map((c) => c.label);
  const duplicated = [...new Set(rowLabels.filter((n, i) => rowLabels.indexOf(n) !== i))];
  if (duplicated.length > 0) {
    floorBreached = true;
    floorFailure(
      `the cases table uses ${duplicated.map((n) => JSON.stringify(n)).join(', ')} as a row label more `
      + 'than once — two rows sharing a label are ONE battery, so the second can stop running while '
      + 'the first keeps the floor met.',
    );
  }
  for (const [name, count] of batterySeen) {
    if (declaredBatteries.includes(name)) continue;
    floorBreached = true;
    floorFailure(
      `self-test battery "${name}" registered ${count} case(s) but is not declared in `
      + 'SELF_TEST_BATTERIES — a case attributed to no declared battery is one nothing floors.',
    );
  }
  for (const name of declaredBatteries) {
    const count = batterySeen.get(name) ?? 0;
    if (count >= SELF_TEST_BATTERIES[name]) continue;
    floorBreached = true;
    floorFailure(
      count === 0
        ? `self-test battery "${name}" DID NOT RUN — 0 cases registered, ${SELF_TEST_BATTERIES[name]} `
          + 'pinned. The verdict below would have claimed that case holds.'
        : `self-test battery "${name}" registered ${count} case(s), below its pinned floor of `
          + `${SELF_TEST_BATTERIES[name]} — cases that used to run no longer do.`,
    );
  }
  if (floorBreached) {
    floorFailure(
      'A battery at or below its floor means cases STOPPED RUNNING — the battery is the bug, not the '
      + 'number. Find what stopped registering (a deleted row, a renamed label, a loop that no longer '
      + 'reaches it) and restore it.',
    );
  }

  if (failed > 0) {
    console.error(`\n✗ check-future-spec-major self-test: ${failed} failure(s) (cases and floor).`);
    process.exit(1);
  }
  console.log(`\n✓ check-future-spec-major self-test: ${cases.length} cases pass.`);
  selfTestReachedVerdict = true;
}

// ---------------------------------------------------------------------------

function readCorpus() {
  const files = [];
  for (const rel of listTrackedFiles(REPO_ROOT)) {
    const abs = join(REPO_ROOT, rel);
    try {
      if (!existsSync(abs) || !statSync(abs).isFile()) continue;
      files.push({ file: rel, text: readFileSync(abs, 'utf8') });
    } catch {
      // A tracked path that is not readable as text is not prose.
    }
  }
  return files;
}

function main() {
  if (process.argv.includes('--self-test')) {
    selfTest();
    if (!selfTestReachedVerdict) {
      console.error(
        '\n✗ check-future-spec-major self-test: selfTest() returned without reaching its verdict,\n'
        + 'so no success line was printed. Exiting 0 here would report a self-test\n'
        + 'that never finished as a self-test that passed.\n',
      );
      process.exit(1);
    }
    return;
  }

  const files = readCorpus();
  const manifestPath = join(REPO_ROOT, SPEC_MANIFEST);
  let manifestRaw = null;
  try { manifestRaw = readFileSync(manifestPath, 'utf8'); } catch { manifestRaw = null; }

  const { problems, census, specMajor } = runAllChecks(
    files, QUOTATION_EXEMPTIONS, manifestRaw, SELF_PATH,
  );

  if (process.argv.includes('--census')) {
    const rows = [...census.entries()].sort((a, b) => a[0].localeCompare(b[0], 'en', { numeric: true }));
    console.log(`census — \`${PKG}\` <version> citations, published major ${specMajor}`);
    for (const [key, { sites, files: fs }] of rows) {
      console.log(`  ${key.padEnd(18)} ${String(sites).padStart(5)} sites  ${String(fs.size).padStart(4)} files`);
    }
  }

  if (problems.length > 0) {
    console.error(`✗ check-future-spec-major: ${problems.length} problem(s)\n`);
    for (const p of problems) console.error(`  • ${p}`);
    console.error(
      `\nADR-0087 (Amended 2026-09-13): "A tombstone names the npm release it ships in, ⛔ never the\n`
      + 'protocol major." A pre-GA retirement ships `minor`, so it lands in a version of the CURRENT\n'
      + 'major — never in the next one.',
    );
    process.exit(1);
  }

  const scanned = files.length;
  const mentioning = files.filter((f) => f.text.includes(PKG)).length;
  const atMajor = census.get(`${specMajor} (bare)`);
  console.log(
    `✓ check-future-spec-major: no \`${PKG}\` citation names a major above ${specMajor}\n`
    + `  ${scanned} scanned file(s), ${mentioning} mentioning \`${PKG}\`\n`
    + `  control — bare \`${PKG}\` ${specMajor}: ${atMajor?.sites ?? 0} site(s) / `
    + `${atMajor?.files.size ?? 0} file(s), all legitimate and all read by this same matcher\n`
    + `  ${QUOTATION_EXEMPTIONS.length} witnessed ledger entr(y|ies), every witness still matching\n`
    + `  ${SELF_PATH} is excluded from its own scan and still carries at least `
    + `${SELF_FIXTURE_FLOOR} citation(s) above ${specMajor} — its fixtures are intact`,
  );
}

if (isEntrypoint(import.meta.url)) {
  main();
}
