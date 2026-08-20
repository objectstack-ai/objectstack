#!/usr/bin/env node
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// sync-docs-image-tags (#9064) -- rewrite every CONCRETE version a doc surface pins
// for the runtime image or the CLI to `packages/cli/package.json`'s version, at
// VERSION TIME.
//
//   node scripts/sync-docs-image-tags.mjs
//   node scripts/sync-docs-image-tags.mjs --self-test   # verify the rewriter itself
//
// ## The defect this closes: a gate that cannot fire on the change that breaks it
//
// `check-docs-image-tag.mjs` (#9018) pins those doc surfaces to the CLI's version, so
// a version bump turns it red until the surfaces move in the same change. That is the
// intended mechanism. The problem #9064 measured is WHERE the red lands:
//
//   1. the root `version` script is `changeset version && sync-protocol-version &&
//      sync-template-versions`, and `changeset version` is what rewrites
//      `packages/cli/package.json`'s version;
//   2. neither existing sync script touches any doc surface (a grep for
//      `Dockerfile|content/docs|docker/README|ghcr` over both returns zero hits), so
//      the release PR bumps the version and leaves all three surfaces on the old one;
//   3. `sync-template-versions.mjs`'s own header records why nothing catches it there:
//
//        > release PRs opened by changesets/action with the default GITHUB_TOKEN do
//        > not trigger CI, so fixing the file at version time is the only spot that
//        > cannot be skipped
//
// So the bump merges green with NO CI, and the gate goes red on the next ordinary PR,
// naming files that author never touched. The obligation is real but it lands on the
// wrong person, one merge late -- and a gate that reliably reddens for the wrong person
// trains authors to read red as noise, which is the worst possible outcome for a guard
// whose entire value is being believed.
//
// ## Why a version-time rewriter, and why that is not new machinery
//
// This repo already chose this exact shape once, for the identical drift class:
// `sync-template-versions.mjs` after #2907 (the blank template froze at ^6.0.0 while
// the registry published 14.x). Its conclusion was that the scaffold-time rewrite and
// the ratchet test both guard the file, but neither runs on the release PR, so the fix
// had to happen at version time. The docs image tags are the same problem with no
// version-time step; this is the third same-shaped script on that chain, not a new
// mechanism.
//
// ## ⛔ Boundary: this is a SYNC step, never a release action (#6170, #9064 triage)
//
// This file rewrites files and exits. It does not publish, tag, cut a Release, touch a
// Version Packages PR, or invoke any workflow -- release execution stays human. It is
// reached only because `changesets/action` runs `pnpm run version` on the `version-pr`
// lane in release.yml, which carries no `publish:` input and is therefore structurally
// unable to publish. Being ON the release path is not performing a release.
//
// ## Why every list here is IMPORTED, not restated
//
// SURFACES, PATTERNS, VERSION_SOURCE, the concreteness classifier, the extractor and the
// verdict all come from `check-docs-image-tag.mjs`. A second copy of any of them would
// be a second contract, and the two silently disagreeing is the ORIGINAL defect one
// layer up: the rewriter would fix a set of surfaces while the gate judged a different
// set, and the gap would be invisible until a release. One list, two consumers.
//
// The rewrite is therefore defined as "make the gate's own findings go away", and the
// verdict at the end is literally `checkSurfaces()` -- the gate's function, not an
// imitation of it. If this file leaves anything the gate would still flag, it fails
// loudly rather than reporting a sync it did not achieve.
//
// ## What it deliberately does NOT touch
//
// Only occurrences the gate classifies as CONCRETE and that DISAGREE with the target.
// Rolling tags (`latest`, `17.0`, `17`), the `X.Y.Z` tag-table metavariable, the
// `<version>` placeholder, `${OS_CLI_VERSION}`-style interpolations and version-shaped
// historical prose ("removed in @objectstack/spec 16.4.2") are all left exactly as they
// are -- the first three because the gate's own classifier rejects them, the last two
// because the anchors never capture them. An over-eager rewriter is not a lesser
// failure than an inert one: it would silently corrupt documented tag SCHEMES and
// historical facts across three files with nothing downstream to complain, so
// --self-test asserts a clean corpus is left BYTE-IDENTICAL, with no write at all.

import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync, statSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  PATTERNS,
  SURFACES,
  VERSION_SOURCE,
  checkSurfaces,
  extractOccurrences,
  isConcreteVersion,
  loadExpectedVersion,
} from './check-docs-image-tag.mjs';
import { isEntrypoint } from './invoked-as.mjs';

/** The repo this script lives in -- resolved from the script, so cwd cannot lie. */
function scriptRepoRoot() {
  return join(dirname(fileURLToPath(import.meta.url)), '..');
}

// ---------------------------------------------------------------------------
// The rewrite.
// ---------------------------------------------------------------------------

/**
 * The replacement token for one occurrence.
 *
 * Every PATTERN captures its tag as a SUFFIX of the whole anchored match
 * (`ghcr.io/...:16.0.0` captures `16.0.0`), which is what makes "swap the tail" a
 * safe rewrite. That is a property of the shared PATTERNS list, not of this file, so
 * it is CHECKED rather than assumed: a future pattern whose capture sits in the middle
 * of its match would make this splice corrupt the surrounding text, and a rewriter
 * that mangles docs must fail rather than guess.
 *
 * @param {string} raw the whole anchored match
 * @param {string} tag the captured tag token
 * @param {string} expected the version to pin to
 */
export function replacementFor(raw, tag, expected) {
  if (!raw.endsWith(tag)) {
    throw new Error(
      `sync-docs-image-tags: pattern match ${JSON.stringify(raw)} does not END with its captured tag `
      + `${JSON.stringify(tag)}, so swapping the tail would corrupt the line. A PATTERN in `
      + 'check-docs-image-tag.mjs must capture its tag as a suffix of the whole match; if one legitimately '
      + 'cannot, this rewriter needs a per-pattern replacement rule rather than the shared one.',
    );
  }
  return raw.slice(0, raw.length - tag.length) + expected;
}

/**
 * @typedef {{ line: number, column: number, pattern: string, from: string, to: string }} Rewrite
 */

/**
 * Rewrite every concrete, disagreeing pin in `text` to `expected`.
 *
 * Splices are applied RIGHT-TO-LEFT within each line. The columns reported by
 * `extractOccurrences` describe the ORIGINAL line, and a replacement of a different
 * length (16.0.0 -> 17.0.10) shifts every column after it; rewriting left-to-right
 * would therefore corrupt the second pin on any line carrying two. --self-test pins
 * that case with tags of deliberately different lengths.
 *
 * @param {string} text
 * @param {string} expected
 * @returns {{ text: string, rewrites: Rewrite[] }}
 */
export function rewriteText(text, expected) {
  const occurrences = extractOccurrences(text).filter(
    (occurrence) => occurrence.concrete && occurrence.tag !== expected,
  );
  if (occurrences.length === 0) return { text, rewrites: [] };

  // split/join on '\n' is an exact round trip, so every byte this function does not
  // deliberately splice survives -- including line endings and the trailing newline.
  const lines = text.split('\n');
  /** @type {Rewrite[]} */
  const rewrites = [];

  const byLine = new Map();
  for (const occurrence of occurrences) {
    if (!byLine.has(occurrence.line)) byLine.set(occurrence.line, []);
    byLine.get(occurrence.line).push(occurrence);
  }

  for (const [lineNumber, lineOccurrences] of byLine) {
    let line = lines[lineNumber - 1];
    for (const occurrence of [...lineOccurrences].sort((a, b) => b.column - a.column)) {
      const start = occurrence.column - 1;
      const found = line.slice(start, start + occurrence.raw.length);
      if (found !== occurrence.raw) {
        // Position and text disagree: refuse rather than write at a guessed offset.
        throw new Error(
          `sync-docs-image-tags: expected ${JSON.stringify(occurrence.raw)} at line ${lineNumber} `
          + `column ${occurrence.column}, found ${JSON.stringify(found)}. Refusing to splice at an `
          + 'offset that does not hold what the extractor reported.',
        );
      }
      line = line.slice(0, start)
        + replacementFor(occurrence.raw, occurrence.tag, expected)
        + line.slice(start + occurrence.raw.length);
      rewrites.push({
        line: lineNumber,
        column: occurrence.column,
        pattern: occurrence.pattern,
        from: occurrence.tag,
        to: expected,
      });
    }
    lines[lineNumber - 1] = line;
  }

  return { text: lines.join('\n'), rewrites: rewrites.sort((a, b) => a.line - b.line || a.column - b.column) };
}

/**
 * @typedef {{ file: string, rewrites: Rewrite[] }} FileResult
 */

/**
 * Rewrite every enumerated surface, then let the GATE pronounce the verdict.
 *
 * A file with nothing to change is not written at all -- not rewritten to identical
 * bytes. Leaving mtime untouched keeps a no-op release from showing three "modified"
 * files that a reviewer then has to diff to discover are empty.
 *
 * @param {{ surfaces: { file: string, why: string }[], expected: string, root: string }} options
 */
export function syncSurfaces({ surfaces, expected, root }) {
  /** @type {FileResult[]} */
  const changed = [];
  let read = 0;

  for (const surface of surfaces) {
    const full = join(root, surface.file);
    // A missing surface is NOT repaired here and not skipped either: it falls through
    // to checkSurfaces below, which reports MISSING-SURFACE. The gate owns that verdict.
    if (!existsSync(full)) continue;
    read++;
    const before = readFileSync(full, 'utf8');
    const { text, rewrites } = rewriteText(before, expected);
    if (rewrites.length === 0) continue;
    writeFileSync(full, text);
    changed.push({ file: surface.file, rewrites });
  }

  // The verdict is the gate's own function over the REWRITTEN tree. This is what makes
  // "the rewriter and the gate cannot drift apart" a mechanical fact rather than an
  // intention: anything this file failed to bring into line is reported by the very
  // code that would have reddened CI, in the same words.
  const { findings, stats } = checkSurfaces({ surfaces, expected, root });
  return { changed, read, findings, stats };
}

// ---------------------------------------------------------------------------

function main() {
  const root = scriptRepoRoot();
  const expected = loadExpectedVersion(join(root, VERSION_SOURCE));
  const { changed, findings, stats } = syncSurfaces({ surfaces: SURFACES, expected, root });

  const total = changed.reduce((sum, file) => sum + file.rewrites.length, 0);
  if (total === 0) {
    console.log(
      `✓ sync-docs-image-tags: all ${stats.compared} concrete pin(s) across ${stats.read} surface(s) `
      + `already at ${VERSION_SOURCE} ${expected} — nothing rewritten.`,
    );
  } else {
    for (const file of changed) {
      console.log(`  ${file.file}`);
      for (const rewrite of file.rewrites) {
        console.log(`    ${rewrite.line}:${rewrite.column}  ${rewrite.pattern}: ${rewrite.from} → ${rewrite.to}`);
      }
    }
    console.log(
      `✓ sync-docs-image-tags: ${total} pin(s) across ${changed.length} surface(s) → ${expected} `
      + `(lockstep with ${VERSION_SOURCE}).`,
    );
  }

  if (findings.length > 0) {
    // Reached only when the rewrite could not make the gate green -- an enumerated
    // surface that is gone, or one that no longer pins anything concrete. Both are
    // conditions an ordinary PR cannot merge with (the gate is red on it), so at
    // version time this is a loud stop, not a routine branch: the release PR gets no
    // CI, and finishing quietly here would hand the next author exactly the misaddressed
    // red this script exists to prevent.
    console.error(
      `\n✗ sync-docs-image-tags: ${findings.length} finding(s) the rewrite cannot fix — `
      + 'check-docs-image-tag would be RED on this tree:\n',
    );
    for (const finding of findings) {
      const at = finding.line > 0 ? `${finding.file}:${finding.line}` : finding.file;
      console.error(`  • [${finding.kind}] ${at}`);
      console.error(`      ${finding.detail}\n`);
    }
    process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// Self-test -- the rewriter's two opposite failure modes, each with a control.
//
// An INERT rewriter (changes nothing) and an OVER-EAGER one (reformats, or moves a
// version-shaped string that must never track the CLI) are equally fatal here, and a
// green run over the live corpus distinguishes neither: the corpus is green today, so
// there is nothing for a correct rewriter to do to it. Every limb therefore gets a
// positive control on a temp fixture, paired with a byte-identity control on a clean one.
// ---------------------------------------------------------------------------

function selfTest() {
  const failures = [];
  let checked = 0;
  const assert = (condition, message) => {
    checked++;
    if (!condition) failures.push(message);
  };

  const dir = mkdtempSync(join(tmpdir(), 'sync-docs-image-tags-selftest-'));
  const write = (relative, contents) => {
    const full = join(dir, relative);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, contents);
  };

  try {
    const expected = '17.0.0';

    // ── Control A: a STALE corpus is brought to the target ──────────────────
    //
    // Every pattern, plus the two mis-pins a prefix-only comparison would miss.
    const staleBody = [
      '# Deploy',
      '',
      '```dockerfile',
      'FROM ghcr.io/objectstack-ai/objectstack:16.0.0',
      '```',
      '',
      '```bash',
      'docker build --build-arg OS_CLI_VERSION=16.4.2 docker/',
      'npm install -g @objectstack/cli@15.0.0',
      '```',
      '',
      'A prerelease pin and a typo are both concrete, so both move:',
      '',
      'FROM ghcr.io/objectstack-ai/objectstack:17.0.0-beta.1',
      'FROM ghcr.io/objectstack-ai/objectstack:17.0.0.0',
      '',
      'And one already correct, which must NOT be counted as a rewrite:',
      '',
      'FROM ghcr.io/objectstack-ai/objectstack:17.0.0',
      '',
    ].join('\n');
    write('stale/deploy.md', staleBody);

    const staleSurfaces = [{ file: 'stale/deploy.md', why: 'fixture' }];

    // Anti-vacuity: the fixture is RED before the rewrite. Without this, every
    // assertion below would also pass over a corpus that never needed fixing.
    const before = checkSurfaces({ surfaces: staleSurfaces, expected, root: dir });
    assert(
      before.findings.filter((finding) => finding.kind === 'STALE').length === 5,
      `the stale fixture starts with exactly 5 STALE findings, so the rewrite has something real to do — `
        + `got ${JSON.stringify(before.findings.map((f) => `${f.kind}:${f.line}`))}`,
    );

    const staleResult = syncSurfaces({ surfaces: staleSurfaces, expected, root: dir });

    // The end-to-end claim of #9064, hermetically: after the rewriter, the GATE is green.
    assert(
      staleResult.findings.length === 0,
      `after the rewrite the gate reports ZERO findings — got ${JSON.stringify(staleResult.findings.map((f) => `${f.kind}@${f.line}`))}`,
    );
    assert(
      staleResult.changed.length === 1 && staleResult.changed[0].rewrites.length === 5,
      `exactly the 5 disagreeing pins were rewritten — got ${JSON.stringify(staleResult.changed.map((c) => [c.file, c.rewrites.length]))}`,
    );
    const rewritten = readFileSync(join(dir, 'stale/deploy.md'), 'utf8');
    assert(
      !rewritten.includes('16.0.0') && !rewritten.includes('16.4.2') && !rewritten.includes('15.0.0')
        && !rewritten.includes('17.0.0-beta.1') && !rewritten.includes('17.0.0.0'),
      'no stale tag survives the rewrite',
    );
    assert(
      (rewritten.match(/ghcr\.io\/objectstack-ai\/objectstack:17\.0\.0(?![.\-\d])/g) ?? []).length === 4,
      'all four image-tag pins (three stale + one already correct) read 17.0.0 afterwards — '
        + `got ${JSON.stringify(rewritten.match(/ghcr\.io\/objectstack-ai\/objectstack:[^\s]*/g))}`,
    );
    assert(
      rewritten.includes('OS_CLI_VERSION=17.0.0') && rewritten.includes('@objectstack/cli@17.0.0'),
      'the build arg and the npm pin were rewritten too, not just the image tag',
    );
    // Structure survives: only tags moved. Line count and every non-pin line identical.
    assert(
      rewritten.split('\n').length === staleBody.split('\n').length,
      'the rewrite changed no line count — it splices tags, it does not reformat',
    );
    assert(
      rewritten.split('\n')[0] === '# Deploy' && rewritten.split('\n')[2] === '```dockerfile',
      'untouched lines are byte-identical after the rewrite',
    );

    // Re-running is a no-op: the second pass finds nothing to do. A rewriter that
    // "changed" something every run would churn the release diff forever.
    const second = syncSurfaces({ surfaces: staleSurfaces, expected, root: dir });
    assert(second.changed.length === 0, `a second run rewrites NOTHING — got ${JSON.stringify(second.changed)}`);

    // ── Control B: a CLEAN corpus is left BYTE-IDENTICAL, unwritten ─────────
    //
    // The over-eagerness control. Every shape that must never move is here: the
    // documented tag SCHEME, rolling tags, the placeholder, an interpolation, and
    // version-shaped historical prose.
    const cleanBody = [
      '# Tags',
      '',
      '| Tag | Meaning |',
      '|:---|:---|',
      '| `X.Y.Z` | Exact release — **pin this in production** |',
      '| `X.Y`, `X` | Rolling minor / major |',
      '| `latest` | Latest release — quick starts only |',
      '',
      '```dockerfile',
      'FROM ghcr.io/objectstack-ai/objectstack:17.0.0',
      'FROM ghcr.io/objectstack-ai/objectstack:latest',
      'FROM ghcr.io/objectstack-ai/objectstack:17.0',
      'FROM ghcr.io/objectstack-ai/objectstack:17',
      '#   FROM ghcr.io/objectstack-ai/objectstack:<version>',
      'ARG OS_CLI_VERSION=latest',
      'RUN npm install -g @objectstack/cli@${OS_CLI_VERSION}',
      '```',
      '',
      'docker build --build-arg OS_CLI_VERSION=17.0.0 docker/',
      'npm install -g @objectstack/cli@17.0.0',
      '',
      'The key was removed in @objectstack/spec 16.4.2, and 15.0.0 before that.',
      '',
    ].join('\n');
    write('clean/docs.md', cleanBody);
    const cleanSurfaces = [{ file: 'clean/docs.md', why: 'fixture' }];
    const cleanPath = join(dir, 'clean/docs.md');
    const mtimeBefore = statSync(cleanPath).mtimeMs;

    const cleanResult = syncSurfaces({ surfaces: cleanSurfaces, expected, root: dir });

    assert(
      readFileSync(cleanPath, 'utf8') === cleanBody,
      'a clean surface is left BYTE-IDENTICAL — an over-eager rewriter that reformats, re-spells a rolling '
        + 'tag, or moves a version-shaped historical fact must fail as loudly as an inert one',
    );
    assert(statSync(cleanPath).mtimeMs === mtimeBefore, 'a clean surface is not written AT ALL, not rewritten to identical bytes');
    assert(cleanResult.changed.length === 0, `a clean corpus yields zero rewrites — got ${JSON.stringify(cleanResult.changed)}`);
    // ...and it really did look at it. Byte-identity over a corpus the scanner never
    // read would satisfy the assertions above just as happily.
    assert(
      cleanResult.stats.compared === 3,
      `the clean run compared all 3 concrete pins — got ${cleanResult.stats.compared}`,
    );
    assert(
      cleanResult.stats.skipped === 4,
      `the clean run SAW and skipped the 4 anchored non-concrete tags (latest, 17.0, 17, latest) — got ${cleanResult.stats.skipped}`,
    );
    assert(
      readFileSync(cleanPath, 'utf8').includes('removed in @objectstack/spec 16.4.2, and 15.0.0 before that'),
      'version-shaped historical prose carries no anchor and is never rewritten — it stays true forever',
    );

    // ── Control C: selectivity ON ONE LINE ──────────────────────────────────
    //
    // A stale pin sharing a line with a rolling tag and a historical fact: only the
    // concrete anchored pin moves. This is the assertion that would catch a rewriter
    // that fell back to a global string replace of the old version.
    write(
      'mixed/one-line.md',
      'Was ghcr.io/objectstack-ai/objectstack:16.0.0 (see :latest, :17.0) — spec 16.0.0 removed it.\n',
    );
    const mixed = syncSurfaces({ surfaces: [{ file: 'mixed/one-line.md', why: 'fixture' }], expected, root: dir });
    assert(
      readFileSync(join(dir, 'mixed/one-line.md'), 'utf8')
        === 'Was ghcr.io/objectstack-ai/objectstack:17.0.0 (see :latest, :17.0) — spec 16.0.0 removed it.\n',
      'only the anchored concrete pin moved: the rolling tags and the unanchored "spec 16.0.0" prose on the '
        + `SAME LINE are untouched — got ${JSON.stringify(readFileSync(join(dir, 'mixed/one-line.md'), 'utf8'))}`,
    );
    // Optional chaining, not indexing: an INERT rewriter leaves `changed` empty, and
    // this assertion must NAME that failure rather than dying of a TypeError two limbs
    // before the byte-identity control ever runs.
    assert(
      mixed.changed[0]?.rewrites.length === 1,
      `exactly one rewrite on that line — got ${JSON.stringify(mixed.changed.map((c) => c.rewrites.length))}`,
    );

    // ── Control D: two pins on ONE line, of DIFFERENT lengths ───────────────
    //
    // The splice-order control. Columns describe the ORIGINAL line, so a left-to-right
    // rewrite whose replacement changes length corrupts every later pin on the line.
    // The target here is one character LONGER than the first tag, so a wrong order
    // does not merely misplace the text, it produces visibly broken output.
    write(
      'mixed/two-pins.md',
      'ghcr.io/objectstack-ai/objectstack:16.0.0 then ghcr.io/objectstack-ai/objectstack:9.9.9 end\n',
    );
    const twoPins = syncSurfaces({
      surfaces: [{ file: 'mixed/two-pins.md', why: 'fixture' }],
      expected: '17.0.10',
      root: dir,
    });
    assert(
      readFileSync(join(dir, 'mixed/two-pins.md'), 'utf8')
        === 'ghcr.io/objectstack-ai/objectstack:17.0.10 then ghcr.io/objectstack-ai/objectstack:17.0.10 end\n',
      'BOTH pins on one line are rewritten correctly when the replacement changes length — a left-to-right '
        + `splice using original columns would corrupt the second. Got ${JSON.stringify(readFileSync(join(dir, 'mixed/two-pins.md'), 'utf8'))}`,
    );
    assert(
      twoPins.changed[0]?.rewrites.length === 2,
      `both pins counted as rewrites — got ${JSON.stringify(twoPins.changed.map((c) => c.rewrites.length))}`,
    );

    // ── Control E: the gate's verdicts the rewrite CANNOT fix ───────────────
    //
    // A surface that stopped pinning anything, and one that is gone. Neither is
    // repairable by rewriting, and both must survive as findings rather than being
    // quietly passed over at the one moment CI is not watching.
    write('rot/rotted.md', 'FROM ghcr.io/objectstack-ai/objectstack:latest\n');
    const rot = syncSurfaces({
      surfaces: [{ file: 'rot/rotted.md', why: 'fixture' }, { file: 'rot/gone.md', why: 'fixture' }],
      expected,
      root: dir,
    });
    const kinds = rot.findings.map((finding) => finding.kind).sort();
    assert(
      kinds.join() === 'MISSING-SURFACE,NO-OCCURRENCES',
      `a rotted surface and a missing one both survive the sync as findings — got ${JSON.stringify(kinds)}`,
    );
    assert(rot.changed.length === 0, 'neither is "repaired" by inventing a pin');

    // ── Control F: the expectation refuses to be unusable ───────────────────
    //
    // The catastrophic over-eager case: rewriting every doc pin to `workspace:*` or to
    // `undefined`. loadExpectedVersion is imported from the gate precisely so this
    // refusal is the same refusal, not a second implementation of it.
    write('bad/pkg.json', '{"version":"workspace:*"}');
    let threw = false;
    try {
      loadExpectedVersion(join(dir, 'bad/pkg.json'));
    } catch {
      threw = true;
    }
    assert(threw, 'a non-concrete version is rejected before anything is written — the docs are never pinned to garbage');

    // ── Control G: the suffix invariant on the SHARED pattern list ──────────
    //
    // "Swap the tail" is only safe while every PATTERN captures its tag as a suffix.
    // That is a property of a list this file does not own, so it is asserted against
    // the real PATTERNS rather than trusted.
    for (const pattern of PATTERNS) {
      const sample = { 'image-tag': 'ghcr.io/objectstack-ai/objectstack:16.0.0', 'build-arg': 'OS_CLI_VERSION=16.0.0', 'npm-pin': '@objectstack/cli@16.0.0' }[pattern.name];
      assert(
        sample !== undefined,
        `PATTERNS carries '${pattern.name}', which this self-test has no sample for — a new pattern needs a `
          + 'sample here (and a check that its capture is a suffix) before the rewriter can splice it safely',
      );
      if (sample === undefined) continue;
      const occurrences = extractOccurrences(sample);
      assert(occurrences.length === 1, `the sample for '${pattern.name}' yields exactly one occurrence`);
      assert(
        occurrences[0].raw.endsWith(occurrences[0].tag),
        `pattern '${pattern.name}' captures its tag as a SUFFIX of the match, which is what makes the tail `
          + 'swap safe',
      );
    }
    let suffixThrew = false;
    try {
      replacementFor('OS_CLI_VERSION=16.0.0 tail', '16.0.0', '17.0.0');
    } catch {
      suffixThrew = true;
    }
    assert(suffixThrew, 'replacementFor REFUSES a match whose capture is not a suffix rather than corrupting the line');

    // ── Control H: the shared surface list is the gate's, not a copy ────────
    assert(
      Array.isArray(SURFACES) && SURFACES.length > 0 && SURFACES.every((surface) => typeof surface.file === 'string'),
      'SURFACES is imported from check-docs-image-tag.mjs and non-empty — the rewriter and the gate read ONE list',
    );
    assert(
      VERSION_SOURCE === 'packages/cli/package.json',
      `VERSION_SOURCE is imported from the gate — got ${JSON.stringify(VERSION_SOURCE)}`,
    );
    assert(isConcreteVersion('17.0.0') && !isConcreteVersion('latest'), 'the concreteness classifier is the gate\'s own');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }

  if (failures.length) {
    console.error(`✗ sync-docs-image-tags --self-test — ${failures.length} failure(s)\n`);
    for (const failure of failures) console.error(`  • ${failure}`);
    process.exit(1);
  }
  console.log(
    `✓ sync-docs-image-tags --self-test: ${checked} assertions over temp fixtures (real syncSurfaces path). `
    + 'A stale corpus is observed going GREEN through the gate\'s own checkSurfaces; a clean corpus is observed '
    + 'BYTE-IDENTICAL and unwritten; rolling tags, the X.Y.Z metavariable, placeholders, interpolations and '
    + 'version-shaped prose are observed UNMOVED.',
  );
}

// ---------------------------------------------------------------------------

// Entry-point guard, for the reason #9064 exists: this file is importable, and an
// import that rewrote three doc surfaces as a side effect would be strictly worse than
// the gate's version of the same bug.
if (isEntrypoint(import.meta.url)) {
  if (process.argv.includes('--self-test')) {
    selfTest();
  } else {
    main();
  }
}
