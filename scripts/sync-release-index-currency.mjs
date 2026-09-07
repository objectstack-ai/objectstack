#!/usr/bin/env node
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// sync-release-index-currency (#15332) -- keep the release index's status field
// naming the NEWEST GA release of its major, by rewriting it at VERSION TIME.
//
//   node scripts/sync-release-index-currency.mjs
//   node scripts/sync-release-index-currency.mjs --self-test   # the rewriter itself
//
// ## The defect this closes: one class, three occurrences, three consecutive minors
//
// `content/docs/releases/index.mdx` ends each major's entry with a status
// parenthetical -- "(current series: 17.2.0, released 2026-08-23)". That sentence is
// DERIVED DATA: the newest GA of a major is already readable from
// `packages/spec/CHANGELOG.md`, which is exactly where check-release-section-coverage
// reads it from to produce its finding. Maintained by hand, it went stale on three
// consecutive minors, each time caught after the fact:
//
//   #10232   17.1.0 published; the index still ended at 17.0.0.
//   #11649   17.2.0 published; the index still named 17.1.0 -- recorded at the time
//            as "#10232 recurring one release later".
//   #15332   17.3.0 published; the index still named 17.2.0.
//
// `check-docs-image-tag.mjs`'s header states the threshold this clears: "Two
// occurrences of an identical drift is where a mechanical guard beats fixing the
// third one by hand." Three occurrences on three consecutive minors is a PRODUCER
// problem, not three authoring slips.
//
// It is not a tidiness problem either. A customer-shaped 17.2.0 -> 17.3.0 upgrade
// rehearsal run against the published docs alone (hotcrm#1576 / hotcrm#1577) hit this
// independently and filed it as its third documentation defect: the index says
// "current series: 17.2.0" while `upgrading.mdx` and `deployment/self-hosting.mdx`
// tell the reader to pin `17.3.0`. The docs contradict each other about what the
// current version IS, and a real upgrader walks into that contradiction.
//
// ## Why VERSION TIME, and why this is not new machinery
//
// The gate that names the finding cannot fire on the change that causes it.
// `sync-template-versions.mjs`'s header states the mechanism, and it is this file's
// whole reason for existing too:
//
//   > release PRs opened by changesets/action with the default GITHUB_TOKEN do not
//   > trigger CI, so fixing the file at version time is the only spot that cannot
//   > be skipped
//
// So the version commit that publishes 17.3.0 lands with no CI at all, and the index
// stays on 17.2.0 until someone notices. Worse here than for the sibling surfaces:
// `.github/workflows/lint.yml` runs check-release-section-coverage WITHOUT `--strict`,
// where a finding is advisory and the job is GREEN by design, so the staleness reaches
// `main` green on every ordinary PR as well. Only `release-coverage-patrol.yml` passes
// `--strict`, and a standing patrol is by construction an AFTER-THE-FACT reader.
//
// This repo has already chosen this exact shape for this exact drift class, three
// times: sync-protocol-version.mjs (#2769), sync-template-versions.mjs (#2907),
// sync-docs-image-tags.mjs (#9064, landed as e569cac32 -- "sync docs image tags at
// version time so check:docs-image-tag cannot misfire"). This is the fourth same-shaped
// script on the `version` chain, not a fourth mechanism.
//
// ## Why every list here is IMPORTED, not restated
//
// The path, the CHANGELOG it is judged against, the scope floor, the entry lookup, the
// status-field lookup and THE VERDICT all come from `check-release-section-coverage.mjs`
// -- the gate whose finding this file exists to clear. A second copy of any of them
// would be a second contract, and the two silently disagreeing is the original defect
// one layer up: the rewriter would stamp one sentence while the gate judged another.
// One list, two consumers -- the principle #9064 wrote down and cut-rc.yml joined as a
// third consumer.
//
// The rewrite is therefore defined as "make the gate's assertion-2 findings go away",
// and the verdict at the end is literally `indexCurrencyFindings()` -- the gate's own
// function over the REWRITTEN text, not an imitation of it.
//
// ## ⛔ Boundary 1: assertion 2 ONLY. This file never judges section coverage.
//
// check-release-section-coverage makes two assertions. Assertion 1 -- a published minor
// has a heading on its major's release page -- is NOT this file's business and its
// findings NEVER reach this file's exit code. Two reasons, both load-bearing:
//
//   • A rewriter cannot write it. The gate's own header: "This gate GENERATES NOTHING
//     ... a curated section is a judgement about what is user-facing", measured at 69
//     package CHANGELOGs / 314 entries for one minor.
//   • Hard-failing it here would overturn a decision the gate made ON MEASUREMENT. Its
//     header times the two real gaps at 5h44m (17.1.0) and 25 days (16.1.0) and
//     concludes that failing on them "would have red 2748 PRs for a debt not one of
//     them created". The version lane runs every six hours; failing there on a section
//     nobody has written yet would wedge the release lane for the same reason.
//
// Assertion 2 is different in kind: its remedy is one token, it is derived from an
// artifact the version step itself just wrote, and no judgement is involved.
//
// ## ⛔ Boundary 2: a SYNC step, never a release action (#6170, #9064 triage)
//
// This file rewrites one file and exits. It does not publish, tag, cut a Release, touch
// a Version Packages PR, or invoke any workflow. It is reached only because
// changesets/action runs `pnpm run version` on the `version-pr` lane in release.yml,
// which carries no `publish:` input and is structurally unable to publish.
//
// ## What it deliberately does NOT rewrite
//
// ONE status shape: `current series: <x.y.z>, released <YYYY-MM-DD>`. Everything else
// the gate can flag is left EXACTLY as it is and falls through to the verdict, which
// then stops the run loudly:
//
//   • `final release: 16.1.0` disagreeing with a newer 16.x. "Final" is a CLAIM, and a
//     rewriter that swapped the number would make the sentence say a series is finished
//     at a version that just proved it is not. Whether a closed series reopened is a
//     human judgement; stamping a number over it would hide the question.
//   • An entry with no trailing parenthetical at all. There is no field to stamp, and
//     inventing one means choosing between the two wordings above -- the same judgement.
//   • An entry whose parenthetical is prose. Same reason.
//
// An over-eager rewriter is not a lesser failure than an inert one: this file writes
// into curated, reader-facing prose, so `--self-test` asserts a CURRENT index is left
// BYTE-IDENTICAL with no write at all, and that each refused shape survives untouched.

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  INDEX_PATH,
  SPEC_CHANGELOG,
  gaMinors,
  gaVersions,
  inScope,
  indexCurrencyFindings,
  indexEntryLine,
  indexStatusField,
  newestGaOfMajor,
} from './check-release-section-coverage.mjs';
import { isEntrypoint } from './invoked-as.mjs';

/** The repo this script lives in -- resolved from the script, so cwd cannot lie. */
export function scriptRepoRoot() {
  return join(dirname(fileURLToPath(import.meta.url)), '..');
}

/**
 * The surface this rewriter writes, for the consumers that must know it WITHOUT
 * restating it -- release.yml's post-version shape assertion and cut-rc.yml's staging
 * allowlist, which resolve `SURFACES` and `stampedPaths()` from their rewriters on
 * exactly these terms ("a fourth literal is a fourth contract").
 *
 * Derived from the gate's `INDEX_PATH`, never a copy of it: if the gate is ever pointed
 * at a different index, this rewriter and both workflow allowlists follow in the same
 * edit rather than three of them following and one not.
 *
 * @returns {string[]} repo-relative, exactly the paths a run can write
 */
export function syncedPaths() {
  return [INDEX_PATH];
}

// ---------------------------------------------------------------------------
// The rewrite.
// ---------------------------------------------------------------------------

/**
 * The ONE status shape this file rewrites, anchored over the WHOLE field.
 *
 * Anchored rather than searched: an unanchored version match would also fire inside a
 * parenthetical this file has no business touching, and the refusals above are only
 * real if the matcher cannot reach them. `final release: 16.1.0` does not match (the
 * lead-in differs), and neither does a field carrying anything after the date.
 */
export const STATUS_SHAPE =
  /^(current series:[^\S\n]+)(\d+\.\d+\.\d+)([^\S\n]*,[^\S\n]*released[^\S\n]+)(\d{4}-\d{2}-\d{2})$/;

/**
 * The release date this run stamps: the UTC calendar day of the version commit.
 *
 * Measured against every entry the index has carried, the date IS the version-commit
 * day -- 17.1.0 / 47d1ae89e / 2026-08-20, 17.2.0 / e7d2cc67f / 2026-08-23, 17.3.0 /
 * 8a1bad8b8 / 2026-09-04 -- and this script runs inside that commit's own `pnpm run
 * version`. UTC, not local: a runner in any timezone must stamp the day the commit is
 * dated, and `git` dates the commit in UTC in CI.
 *
 * A clock this cannot read is a REFUSAL, never a silently wrong date written into
 * published prose.
 *
 * @param {Date} [now]
 * @returns {string} `YYYY-MM-DD`
 */
export function releaseDate(now = new Date()) {
  if (!(now instanceof Date) || Number.isNaN(now.getTime())) {
    throw new Error(
      'sync-release-index-currency: the clock supplied is not a usable Date, so the release date '
      + 'this stamps into published prose would be invented. Refusing to write a date rather than '
      + 'writing a wrong one.',
    );
  }
  return now.toISOString().slice(0, 10);
}

/**
 * The rewritten status field, or null when this field is one this file REFUSES.
 *
 * Null is not a failure here: it means the gate's finding (if any) survives to the
 * verdict, which is where a refusal becomes loud. See "What it deliberately does NOT
 * rewrite".
 *
 * @param {string} field the inner text of the entry's trailing parenthetical
 * @param {string} newestVersion
 * @param {string} date `YYYY-MM-DD`
 * @returns {string | null}
 */
export function rewriteStatusField(field, newestVersion, date) {
  const m = STATUS_SHAPE.exec(field);
  if (m === null) return null;
  const rewritten = `${m[1]}${newestVersion}${m[3]}${date}`;
  return rewritten === field ? null : rewritten;
}

/**
 * @typedef {{ major: number, from: string, to: string }} Rewrite
 */

/**
 * Rewrite one entry line, or leave it exactly as it is.
 *
 * The field is spliced back at the position `indexStatusField`'s own matcher found it,
 * so the surrounding prose -- which can itself carry parentheticals ("(21 dead methods
 * out, 40+ real ones in)") -- is never touched. Refusing to splice at an offset that
 * does not hold what the extractor reported is the same discipline
 * sync-docs-image-tags.mjs applies to its occurrences.
 *
 * @param {string} line
 * @param {number} major
 * @param {string} newestVersion
 * @param {string} date
 * @returns {{ line: string, rewrite: Rewrite | null }}
 */
export function rewriteEntryLine(line, major, newestVersion, date) {
  const field = indexStatusField(line);
  if (field === null) return { line, rewrite: null };
  const rewritten = rewriteStatusField(field, newestVersion, date);
  if (rewritten === null) return { line, rewrite: null };

  const at = line.lastIndexOf(`(${field})`);
  if (at < 0) {
    throw new Error(
      `sync-release-index-currency: the v${major} entry's status field ${JSON.stringify(field)} was `
      + 'reported by indexStatusField but is not findable as a parenthesised span on the line. '
      + 'Refusing to splice at a guessed offset -- this rewriter writes into curated prose.',
    );
  }
  const next = `${line.slice(0, at)}(${rewritten})${line.slice(at + field.length + 2)}`;
  return { line: next, rewrite: { major, from: field, to: rewritten } };
}

/**
 * Rewrite every in-scope major's status field in `indexText`.
 *
 * The major set is built the way the gate's own `main()` builds it -- `gaMinors()`
 * filtered by the gate's `inScope()` -- so this rewriter can never consider a major the
 * gate does not judge, nor skip one it does.
 *
 * @param {{ indexText: string, changelogText: string, date: string }} input
 * @returns {{ text: string, rewrites: Rewrite[], majors: number[] }}
 */
export function rewriteIndexText({ indexText, changelogText, date }) {
  const versions = gaVersions(changelogText);
  const minors = gaMinors(versions).filter(([maj]) => inScope(maj));
  const majors = [...new Set(minors.map(([maj]) => maj))].sort((a, b) => a - b);

  const normalised = indexText.replace(/\r\n?/g, '\n');
  if (normalised !== indexText) {
    throw new Error(
      `sync-release-index-currency: ${INDEX_PATH} carries CRLF or CR line endings. Every lookup `
      + 'this rewriter shares with the gate normalises them away, so a splice computed on the '
      + 'normalised text would be written at the wrong offset. Normalise the file first.',
    );
  }

  const lines = indexText.split('\n');
  /** @type {Rewrite[]} */
  const rewrites = [];
  let text = indexText;

  for (const major of majors) {
    const newest = newestGaOfMajor(versions, major);
    if (newest === null) continue;
    const line = indexEntryLine(text, major);
    // A major with no entry line is check:release-page-status's verdict, not this
    // file's -- the gate says nothing about it either.
    if (line === null) continue;
    const { line: next, rewrite } = rewriteEntryLine(line, major, newest, date);
    if (rewrite === null) continue;
    const at = lines.indexOf(line);
    if (at < 0) {
      throw new Error(
        `sync-release-index-currency: the v${major} entry line returned by indexEntryLine is not a `
        + `whole line of ${INDEX_PATH}. Refusing to write.`,
      );
    }
    lines[at] = next;
    text = lines.join('\n');
    rewrites.push(rewrite);
  }

  return { text, rewrites, majors };
}

/**
 * The gate's OWN assertion-2 verdict over a given index text.
 *
 * Assertion 1 is deliberately not consulted -- see "Boundary 1". This is the function
 * that makes "the rewriter and the gate cannot drift apart" a mechanical fact rather
 * than an intention: anything this file failed to bring into line is reported by the
 * very code that would have reddened the patrol, in the same words.
 *
 * @param {{ indexText: string, changelogText: string }} input
 * @returns {string[]}
 */
export function currencyFindings({ indexText, changelogText }) {
  const versions = gaVersions(changelogText);
  const minors = gaMinors(versions).filter(([maj]) => inScope(maj));
  const majors = [...new Set(minors.map(([maj]) => maj))].sort((a, b) => a - b);
  const findings = [];
  for (const major of majors) {
    const newest = newestGaOfMajor(versions, major);
    if (newest === null) continue;
    findings.push(...indexCurrencyFindings(major, newest, indexEntryLine(indexText, major)));
  }
  return findings;
}

/**
 * Read, rewrite, write, then let the GATE pronounce.
 *
 * A file with nothing to change is not written at all -- not rewritten to identical
 * bytes. Leaving mtime untouched keeps a no-op release from showing a "modified" file a
 * reviewer then has to diff to discover is empty.
 *
 * @param {{ root: string, date: string }} options
 * @returns {{ path: string, rewrites: Rewrite[], wrote: boolean, findings: string[], majors: number[] }}
 */
export function syncIndex({ root, date }) {
  const indexFull = join(root, INDEX_PATH);
  const changelogFull = join(root, SPEC_CHANGELOG);

  // Both are REFUSALS rather than skips. The gate treats a missing index as "nothing to
  // say" (existence is check:release-page-status's verdict), which is right for a
  // reader of the tree and wrong for a writer of it: silently stamping nothing is this
  // card's own defect class wearing a different hat.
  if (!existsSync(changelogFull)) {
    throw new Error(
      `sync-release-index-currency: ${SPEC_CHANGELOG} is not there, so the newest GA release of any `
      + 'major cannot be read and nothing can be stamped. This is the instrument, not the corpus.',
    );
  }
  if (!existsSync(indexFull)) {
    throw new Error(
      `sync-release-index-currency: ${INDEX_PATH} is not there, so the surface this stamps is gone. `
      + 'Page and index EXISTENCE is check:release-page-status\'s verdict -- fix it there; this '
      + 'refuses rather than reporting a sync it did not perform.',
    );
  }

  const changelogText = readFileSync(changelogFull, 'utf8');
  const indexText = readFileSync(indexFull, 'utf8');

  const { text, rewrites, majors } = rewriteIndexText({ indexText, changelogText, date });
  const wrote = rewrites.length > 0;
  if (wrote) writeFileSync(indexFull, text);

  return { path: INDEX_PATH, rewrites, wrote, majors, findings: currencyFindings({ indexText: text, changelogText }) };
}

// ---------------------------------------------------------------------------

function main() {
  const root = scriptRepoRoot();
  const date = releaseDate();
  const { rewrites, majors, findings } = syncIndex({ root, date });

  if (rewrites.length === 0) {
    console.log(
      `✓ sync-release-index-currency: every in-scope entry in ${INDEX_PATH} (v${majors.join(', v')}) `
      + `already names the newest GA release of its major, per ${SPEC_CHANGELOG} — nothing rewritten.`,
    );
  } else {
    console.log(`  ${INDEX_PATH}`);
    for (const rewrite of rewrites) {
      console.log(`    v${rewrite.major}: (${rewrite.from}) → (${rewrite.to})`);
    }
    console.log(
      `✓ sync-release-index-currency: ${rewrites.length} status field(s) stamped from `
      + `${SPEC_CHANGELOG} (release date ${date}).`,
    );
  }

  if (findings.length > 0) {
    // Reached only when the rewrite could not clear the gate: a status shape this file
    // refuses (a "final release:" claim a newer minor contradicts, or a missing
    // parenthetical). Both need a human sentence, and at version time this is a LOUD
    // STOP rather than a routine branch -- the release PR gets no CI, so finishing
    // quietly here hands the next author exactly the misaddressed red this script
    // exists to prevent.
    console.error(
      `\n✗ sync-release-index-currency: ${findings.length} finding(s) this rewrite cannot fix — `
      + 'check-release-section-coverage --strict would be RED on this tree:\n',
    );
    for (const finding of findings) console.error(`  • ${finding}\n`);
    console.error(
      '  These are the shapes this rewriter deliberately refuses, because each needs a SENTENCE '
      + 'and not a token: whether a series that was called final has reopened, or what an entry '
      + 'with no status field should say. Write it, then re-run.\n',
    );
    process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// Self-test -- the rewriter's two opposite failure modes, each with a control.
//
// An INERT rewriter (changes nothing) and an OVER-EAGER one (moves prose, or stamps a
// claim it has no right to make) are equally fatal here, and a green run over the live
// corpus distinguishes neither once the corpus is current: there is nothing left for a
// correct rewriter to do to it. Every limb therefore gets a positive control on a
// fixture, paired with a byte-identity control on a current one.
// ---------------------------------------------------------------------------

// Set by `selfTest()` only after its verdict is printed, and read at the dispatch: a
// `return` that leaves the function above that line prints nothing and still exits 0 --
// a self-test that never finished, reported as one that passed (#13798).
let selfTestReachedVerdict = false;

// ── The self-test's own battery roster and floor (#13489) ───────────────────
//
// `failures.length === 0` is not a success condition on its own: "every case held" and
// "the cases never ran" print the same line. What is pinned is the registered NAMES,
// not a number -- every section opens with `battery('<name>')`, every assertion is
// attributed to the battery most recently opened, and the floor requires the OPENED set
// to equal the DECLARED set with each battery at or above its own count.
//
// ⛔ A pinned TOTAL is not the repair: a battery dropping from 9 cases to 3 keeps a
// total "right" the moment a sibling grows. The counts are a FLOOR, not an equality --
// adding cases is ordinary work and must not red.
const SELF_TEST_BATTERIES = Object.freeze({
  'Control A: a STALE entry is stamped — version AND date': 7,
  'Control B: a CURRENT index is left BYTE-IDENTICAL, unwritten': 4,
  'Control C: the shapes this rewriter REFUSES, and hands to the gate': 7,
  'Control D: selectivity — prose, siblings and out-of-scope majors': 5,
  'Control E: the verdict is the GATE\'s function, assertion 2 ONLY': 5,
  'Control F: the surface and the scope are the gate\'s, not copies': 4,
  'Control G: the date refuses an unusable clock': 3,
});

// DELETING an entry silences that battery's floor exactly as effectively as zeroing it,
// so the roster's own size is pinned too.
const SELF_TEST_BATTERY_FLOOR = 7;

// The key an assertion is filed under when no battery is open. It is not a declared
// battery, so it reds by the same set difference rather than silently inflating
// whichever battery happened to run last.
const UNATTRIBUTED_BATTERY = '(no battery open)';

/** A CHANGELOG whose newest GA of 17 is 17.3.0 and of 16 is 16.1.0. */
const CHANGELOG_FIXTURE = [
  '# @objectstack/spec',
  '',
  '## 17.3.0-rc.1',
  '',
  '## 17.3.0',
  '',
  '## 17.2.0',
  '',
  '## 17.0.0',
  '',
  '## 16.1.0',
  '',
  '## 16.0.0',
  '',
  '## 15.1.0',
  '',
].join('\n');

const STALE_V17 =
  '- [v17.0.0](/docs/releases/v17) — Files become owned `sys_file` records (21 dead methods out, '
  + '40+ real ones in) and analytics stops answering the wrong number (current series: 17.2.0, '
  + 'released 2026-08-23).';
const CURRENT_V17 =
  '- [v17.0.0](/docs/releases/v17) — Files become owned `sys_file` records (21 dead methods out, '
  + '40+ real ones in) and analytics stops answering the wrong number (current series: 17.3.0, '
  + 'released 2026-09-04).';
const CURRENT_V16 =
  '- [v16.0.0](/docs/releases/v16) — One org identifier (`organizationId`) across hooks and actions '
  + '(final release: 16.1.0).';
const STALE_FINAL_V16 =
  '- [v16.0.0](/docs/releases/v16) — One org identifier (`organizationId`) across hooks and actions '
  + '(final release: 16.0.0).';
const NO_PARENTHETICAL_V17 =
  '- [v17.0.0](/docs/releases/v17) — Files become owned `sys_file` records and analytics stops '
  + 'answering the wrong number.';
const OUT_OF_SCOPE_V15 =
  '- [v15.0.0](/docs/releases/v15) — Explain record access layer by layer (current series: 15.0.0, '
  + 'released 2026-07-01).';

const STAMP_DATE = '2026-09-04';

const indexOf = (...entries) => ['## Versions', '', ...entries, ''].join('\n');

export function selfTest() {
  const seen = new Map();
  let openBattery = null;
  const battery = (name) => {
    openBattery = name;
  };
  const failures = [];
  let cases = 0;
  const expect = (label, cond) => {
    const b = openBattery ?? UNATTRIBUTED_BATTERY;
    seen.set(b, (seen.get(b) ?? 0) + 1);
    cases += 1;
    if (!cond) failures.push(label);
  };

  const run = (indexText, date = STAMP_DATE) =>
    rewriteIndexText({ indexText, changelogText: CHANGELOG_FIXTURE, date });

  // ── Control A ─────────────────────────────────────────────────────────────
  battery('Control A: a STALE entry is stamped — version AND date');
  {
    const before = indexOf(STALE_V17, CURRENT_V16);
    const after = run(before);
    expect(
      'A — a stale "current series" entry is rewritten (an inert rewriter is the failure this '
      + 'whole file exists to prevent, and the live corpus cannot show it once it is current)',
      after.rewrites.length === 1,
    );
    expect('A — the rewrite is attributed to v17', after.rewrites[0]?.major === 17);
    expect('A — the VERSION is stamped to the newest GA of the major', after.text.includes('current series: 17.3.0'));
    expect('A — the DATE is stamped too; a right version beside a stale date is still a wrong sentence',
      after.text.includes(`released ${STAMP_DATE}`));
    expect('A — the superseded version is gone, not merely joined', !after.text.includes('17.2.0'));
    expect('A — the resulting line is EXACTLY the hand-written current entry, byte for byte',
      after.text.split('\n').includes(CURRENT_V17));
    expect('A — the prose before the status field is untouched',
      after.text.includes('(21 dead methods out, 40+ real ones in)'));
  }

  // ── Control B ─────────────────────────────────────────────────────────────
  battery('Control B: a CURRENT index is left BYTE-IDENTICAL, unwritten');
  {
    const before = indexOf(CURRENT_V17, CURRENT_V16);
    const after = run(before);
    expect('B — a current corpus yields NO rewrite', after.rewrites.length === 0);
    expect('B — and is byte-identical, so main() never writes it', after.text === before);
    expect('B — re-stamping an already-current entry is not a rewrite (the date is not churned '
      + 'on every release either)', rewriteStatusField('current series: 17.3.0, released 2026-09-04', '17.3.0', '2026-09-04') === null);
    expect('B — but a same-version entry with a DIFFERENT date still is one',
      rewriteStatusField('current series: 17.3.0, released 2026-09-01', '17.3.0', '2026-09-04')
        === 'current series: 17.3.0, released 2026-09-04');
  }

  // ── Control C ─────────────────────────────────────────────────────────────
  battery('Control C: the shapes this rewriter REFUSES, and hands to the gate');
  {
    const before = indexOf(CURRENT_V17, STALE_FINAL_V16);
    const after = run(before);
    expect('C — a "final release:" claim contradicted by a newer minor is NOT stamped: "final" is a '
      + 'claim about a series, and swapping the token would hide the question instead of asking it',
      after.rewrites.length === 0 && after.text === before);
    const findings = currencyFindings({ indexText: after.text, changelogText: CHANGELOG_FIXTURE });
    expect('C — and the refusal is LOUD: the gate\'s own finding survives to the verdict',
      findings.length === 1 && findings[0].includes('final release: 16.0.0'));

    const noField = indexOf(NO_PARENTHETICAL_V17, CURRENT_V16);
    const noFieldAfter = run(noField);
    expect('C — an entry with no trailing status parenthetical is not given one',
      noFieldAfter.rewrites.length === 0 && noFieldAfter.text === noField);
    expect('C — and that too reaches the verdict rather than passing quietly',
      currencyFindings({ indexText: noFieldAfter.text, changelogText: CHANGELOG_FIXTURE }).length === 1);

    expect('C — the status matcher is anchored over the WHOLE field, so a version inside prose in '
      + 'the trailing parenthetical is not a status field',
      rewriteStatusField('see 17.2.0 for details', '17.3.0', STAMP_DATE) === null);
    expect('C — "final release:" is refused at the field level too',
      rewriteStatusField('final release: 16.0.0', '16.1.0', STAMP_DATE) === null);
    expect('C — a field with trailing matter after the date is refused rather than half-rewritten',
      rewriteStatusField('current series: 17.2.0, released 2026-08-23; see below', '17.3.0', STAMP_DATE) === null);
  }

  // ── Control D ─────────────────────────────────────────────────────────────
  battery('Control D: selectivity — prose, siblings and out-of-scope majors');
  {
    const before = indexOf(STALE_V17, STALE_FINAL_V16, OUT_OF_SCOPE_V15);
    const after = run(before);
    expect('D — exactly ONE line moves', after.text.split('\n').filter((l, i) => l !== before.split('\n')[i]).length === 1);
    expect('D — the v16 line is untouched', after.text.includes(STALE_FINAL_V16));
    expect('D — a v15 entry is out of scope by the GATE\'s floor and is never considered, however '
      + 'stale its status field reads', after.text.includes(OUT_OF_SCOPE_V15));
    expect('D — the mid-sentence prose parenthetical is not mistaken for the status field',
      after.text.includes('(21 dead methods out, 40+ real ones in)'));
    expect('D — a prerelease heading never becomes the newest GA (`## 17.3.0-rc.1` is in the '
      + 'fixture on purpose)', !after.text.includes('17.3.0-rc.1') && after.text.includes('current series: 17.3.0'));
  }

  // ── Control E ─────────────────────────────────────────────────────────────
  battery('Control E: the verdict is the GATE\'s function, assertion 2 ONLY');
  {
    const stamped = run(indexOf(STALE_V17, CURRENT_V16));
    expect('E — after a successful stamp the gate has nothing left to say',
      currencyFindings({ indexText: stamped.text, changelogText: CHANGELOG_FIXTURE }).length === 0);
    const stale = currencyFindings({ indexText: indexOf(STALE_V17, CURRENT_V16), changelogText: CHANGELOG_FIXTURE });
    expect('E — and it DID have something to say before it (a verdict that cannot fail is not one)',
      stale.length === 1);
    expect('E — the words are the gate\'s own, so a reader sees one sentence in both places',
      stale[0].includes('the newest released 17.x version is 17.3.0'));
    expect('E — a missing SECTION never reaches this file\'s verdict: assertion 1 is not consulted '
      + 'here, because a rewriter cannot write curated prose and hard-failing the version lane on '
      + 'unwritten prose would wedge it for a debt the release did not create',
      String(currencyFindings).indexOf('coverageFindings') === -1);
    expect('E — the verdict is computed over the REWRITTEN text, not the text as read',
      currencyFindings({ indexText: stamped.text, changelogText: CHANGELOG_FIXTURE }).length === 0
        && stale.length === 1);
  }

  // ── Control F ─────────────────────────────────────────────────────────────
  battery('Control F: the surface and the scope are the gate\'s, not copies');
  {
    expect('F — syncedPaths() is exactly the gate\'s INDEX_PATH, so release.yml and cut-rc.yml '
      + 'resolve the same one path this file can write',
      syncedPaths().length === 1 && syncedPaths()[0] === INDEX_PATH);
    expect('F — and that surface really exists in this tree; an allowlist naming a path that is '
      + 'gone is an allowlist that stages nothing',
      existsSync(join(scriptRepoRoot(), INDEX_PATH)));
    expect('F — the CHANGELOG this reads is the gate\'s, and it is there',
      existsSync(join(scriptRepoRoot(), SPEC_CHANGELOG)));
    expect('F — the scope floor is the gate\'s predicate, not a number restated here',
      inScope(16) === true && inScope(15) === false);
  }

  // ── Control G ─────────────────────────────────────────────────────────────
  battery('Control G: the date refuses an unusable clock');
  {
    expect('G — a real clock yields a UTC YYYY-MM-DD',
      releaseDate(new Date(Date.UTC(2026, 8, 4, 23, 59, 59))) === '2026-09-04');
    let threwOnInvalid = false;
    try { releaseDate(new Date('not a date')); } catch { threwOnInvalid = true; }
    expect('G — an Invalid Date REFUSES rather than stamping "NaN" into published prose', threwOnInvalid);
    let threwOnNonDate = false;
    try { releaseDate('2026-09-04'); } catch { threwOnNonDate = true; }
    expect('G — and so does a value that is not a Date at all', threwOnNonDate);
  }

  // ── Floor ─────────────────────────────────────────────────────────────────
  const declared = Object.keys(SELF_TEST_BATTERIES);
  let floorBreached = false;
  const floorFailure = (line) => {
    floorBreached = true;
    console.error(`  x self-test floor: ${line}`);
  };
  if (declared.length < SELF_TEST_BATTERY_FLOOR) {
    floorFailure(
      `SELF_TEST_BATTERIES declares ${declared.length} batteries, below the pinned floor of `
      + `${SELF_TEST_BATTERY_FLOOR} — a battery deleted from the roster takes its own floor with it.`,
    );
  }
  for (const [name, count] of seen) {
    if (declared.includes(name)) continue;
    floorFailure(
      `battery "${name}" registered ${count} case(s) but is not declared in SELF_TEST_BATTERIES — `
      + 'an assertion attributed to no declared battery is one nothing floors.',
    );
  }
  for (const name of declared) {
    const count = seen.get(name) ?? 0;
    if (count >= SELF_TEST_BATTERIES[name]) continue;
    floorFailure(
      count === 0
        ? `battery "${name}" DID NOT RUN — 0 cases registered, ${SELF_TEST_BATTERIES[name]} pinned. `
          + 'The verdict below would have claimed those cases hold.'
        : `battery "${name}" registered ${count} case(s), below its pinned floor of `
          + `${SELF_TEST_BATTERIES[name]} — cases that used to run no longer do.`,
    );
  }
  if (floorBreached) {
    console.error(
      '  x self-test floor: a battery at or below its floor means cases STOPPED RUNNING — the '
      + 'battery is the bug, not the number. Find what stopped registering.',
    );
    return 1;
  }

  if (failures.length > 0) {
    for (const f of failures) console.error(`  x self-test: ${f}`);
    console.error(`\nsync-release-index-currency --self-test: ${failures.length} failure(s).\n`);
    return 1;
  }

  console.log(
    `OK  self-test: ${cases} cases pass — a stale "current series" entry is stamped to the newest `
    + 'GA of its major with the version AND the date, a current index is left byte-identical and '
    + 'unwritten, the shapes that need a human sentence ("final release:", a missing parenthetical, '
    + 'prose) are REFUSED and reach the gate\'s own verdict instead, prose parentheticals and '
    + 'out-of-scope majors are never touched, and the surface, the scope floor and the verdict are '
    + 'the gate\'s rather than copies of it.',
  );
  selfTestReachedVerdict = true;
  return 0;
}

if (isEntrypoint(import.meta.url)) {
  if (process.argv.slice(2).includes('--self-test')) {
    const code = selfTest();
    if (!selfTestReachedVerdict && code === 0) {
      console.error(
        '\n✗ sync-release-index-currency self-test: selfTest() returned without reaching its '
        + 'verdict, so no success line was printed. Exiting 0 here would report a self-test that '
        + 'never finished as a self-test that passed.\n',
      );
      process.exit(1);
    }
    process.exit(code);
  }
  main();
}
