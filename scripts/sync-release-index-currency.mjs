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
// One list, two consumers -- the principle #9064 wrote down.
//
// The rewrite is therefore defined as "make the gate's assertion-2 findings go away",
// and the verdict at the end is literally `indexCurrencyFindings()` -- the gate's own
// function over the REWRITTEN text, not an imitation of it. One field is held out of
// it, by name and out loud: a field written AHEAD of the cut (section below).
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
//   • A `current series:` field that already names the newest GA, whatever its date --
//     on every run EXCEPT that GA's own version run (next section). The gate has no
//     finding there, and the date belongs to the version commit of the version the
//     field names, which a run that moves nothing is not -- every prerelease cut is
//     such a run (see `releaseDate`).
//   • A `current series:` field naming a NEWER version of its own major than that major's
//     newest GA -- written ahead of the cut. This one does NOT fall through to the verdict:
//     it is left for that GA's own version run, see "A field written AHEAD of the cut".
//
// ## The one same-version field it DOES re-date: the newest GA's own version run (#25356)
//
// Measured on 18.0.0. `8fbbd5082` (#24584) wrote the v18 field by hand ahead of the
// cut, "(current series: 18.0.0, released 2026-10-19)". When the version pass that
// wrote `## 18.0.0` ran, the field already named the newest GA, so the refusal above
// left it alone, date included. That pass's commit (`31abb7184c`, #24524) is dated
// 2026-10-20, npm published 18.0.0 on 2026-10-20, and the index shipped a day early
// until #25354 corrected it by hand.
//
// The date this run holds IS true on exactly one run per GA: the one whose
// `changeset version` wrote that GA's CHANGELOG heading. That run is detectable
// with no clock and no network: the heading of the major's newest GA is in the
// working tree's `packages/spec/CHANGELOG.md` and NOT in the one committed at `HEAD`
// (`committedChangelogText`). On that run, and only on it, a same-version field is
// re-dated. Every other run keeps the refusal, so the 17.7.0 re-dating it prevents
// (see `rewriteStatusField`) cannot come back:
//
//   • a prerelease cut writes only a prerelease heading, which is never a GA;
//   • a run with nothing pending writes no heading at all;
//   • a run on a tree whose version commit has already landed finds the heading at
//     `HEAD`.
//
// Judged PER MAJOR, never as "the newest GA of the repository moved": on the 18.1.0
// run a v17 field naming 17.7.0 still names 17.x's newest GA, and re-dating it to
// 18.1.0's day would be the 17.7.0 defect again.
//
// Rejected: comparing the date with npm's `time` for the version. That needs the
// network at version time, and the `version-pr` lane must not depend on it.
//
// ## A field written AHEAD of the cut: left for that GA's own version run (#25408)
//
// The 18.0.0 producer again, seen from the other side: a PR writes the field for a GA
// that has not been cut. Until that GA's version run, the field names a version NEWER
// than its major's newest GA heading, and it used to be read as stale and rewritten
// BACKWARDS on every version pass that was not that GA's own. Measured on a throwaway
// repository before `## 18.1.0` existed: on "(current series: 18.1.0, released
// 2026-10-21)", a run with nothing pending and an `18.1.0-rc.0` cut alike wrote
// "(current series: 18.0.0, released 2026-10-23)" -- an older version under a date that
// belongs to neither release (18.0.0's version commit is dated 2026-10-20).
//
// Such a field is early, not stale, and exactly one run can make it true: that GA's own
// version run, which re-dates it (previous section). So on every run, that one included
// when it is a LOWER version's GA run (an 18.0.1 patch), the field is left byte-identical,
// date included (`aheadOfNewestGa`), and the run prints why (`deferralNotice`).
//
// It is also held out of this file's verdict, and that departs from "the verdict is the
// gate's own function" on purpose. The gate still reports the field -- advisory on `main`,
// red under `--strict` -- and nothing here changes that. But a STOP here fails `pnpm run
// version`: every `version-pr` refresh in pre mode
// would go red until the GA, for a state no hand-written sentence improves and the GA's
// own run resolves. The exit-1 ladder below is for the shapes that need a SENTENCE.
//
// Judged against the entry's OWN major. A v17 entry naming 18.1.0 is not 17.x written
// ahead of a 17.x cut -- no 17.x run will ever make it true -- so it stays a stale field and
// is stamped to 17.x's newest GA, as before. A field naming a GA that never ships (the
// series is closed first) is deferred on every run; the notice names that case and its
// remedy, a correction by hand.
//
// An over-eager rewriter is not a lesser failure than an inert one: this file writes
// into curated, reader-facing prose, so `--self-test` asserts a CURRENT index is left
// BYTE-IDENTICAL with no write at all, and that each refused shape survives untouched.

import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
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
import { gitFreeEnv } from './git-env.mjs';
import { isEntrypoint } from './invoked-as.mjs';

/** The repo this script lives in -- resolved from the script, so cwd cannot lie. */
export function scriptRepoRoot() {
  return join(dirname(fileURLToPath(import.meta.url)), '..');
}

/**
 * The surface this rewriter writes, for the consumers that must know it WITHOUT
 * restating it -- release.yml's post-version shape assertion, which resolves
 * `SURFACES` and `stampedPaths()` from their rewriters on exactly these terms
 * ("a fourth literal is a fourth contract").
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
 * ⛔ So the date is TRUE only for the version whose version commit this run is: the
 * version it moves the field TO, or the newest GA whose CHANGELOG heading this run's
 * `changeset version` wrote (`gaVersionRun`). A run that is neither -- every
 * prerelease cut, `18.0.0-next.N` and `X.Y.Z-rc.N` alike, because a prerelease
 * heading never becomes the newest GA -- is not that version's version commit, and
 * today is not its release date. That is why `rewriteStatusField` refuses a
 * same-version field on every such run instead of re-dating it.
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
 * Whether `named` is a NEWER version of `newestVersion`'s own major than `newestVersion`
 * -- a status field written ahead of its GA cut. See "A field written AHEAD of the cut".
 *
 * A numeric triple compare, the gate's `newestGaOfMajor` discipline: 17.10.0 is newer
 * than 17.9.0, which a string compare gets backwards. A different major is never ahead:
 * no run of this major can ever make that field true.
 *
 * A version this cannot read as `x.y.z` is a REFUSAL. Answering false would rewrite the
 * field backwards -- the defect; answering true would defer it on every run, unseen.
 *
 * @param {string} named the version the status field names
 * @param {string} newestVersion the newest GA of the entry's major
 * @returns {boolean}
 */
export function aheadOfNewestGa(named, newestVersion) {
  const triple = (v) => {
    const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(v);
    if (m === null) {
      throw new Error(
        `sync-release-index-currency: ${JSON.stringify(v)} is not an x.y.z version, so whether a `
        + 'status field was written ahead of its GA cut cannot be judged. Refusing rather than '
        + 'either rewriting the field backwards or leaving it alone on a guess.',
      );
    }
    return [Number(m[1]), Number(m[2]), Number(m[3])];
  };
  const [aMaj, aMin, aPat] = triple(named);
  const [bMaj, bMin, bPat] = triple(newestVersion);
  if (aMaj !== bMaj) return false;
  return aMin > bMin || (aMin === bMin && aPat > bPat);
}

/**
 * The rewritten status field, or null when this field is one this file REFUSES.
 *
 * Null is not a failure here: it means the gate's finding (if any) survives to the
 * verdict, which is where a refusal becomes loud. See "What it deliberately does NOT
 * rewrite". The one null the verdict holds back is a field written ahead of the cut
 * (`aheadOfNewestGa`): it is null on EVERY run, a GA run of a lower version included,
 * because rewriting it moves it backwards -- see "A field written AHEAD of the cut".
 *
 * A field that already names `newestVersion` is left alone, date included, unless
 * `gaVersionRun` says this run IS `newestVersion`'s version commit. The gate judges the
 * VERSION only (`indexCurrencyFindings` has nothing to say about such a field), and the
 * date this run holds is the release date of the version whose version commit it is --
 * see `releaseDate`. Re-dating a field on any other run would write the day of an
 * unrelated version pass into published prose: measured on the first `18.0.0-next.0`
 * cut, `(current series: 17.7.0, released 2026-10-06)` became `released 2026-10-07`,
 * while 17.7.0's version commit `4e4e881427` is dated 2026-10-06. In pre mode the
 * newest GA never moves, so every prerelease cut did it.
 *
 * On the GA's own version run the same-version field is re-dated, because there the
 * date is true and a field written by hand ahead of the cut is not -- the 18.0.0 case,
 * see "The one same-version field it DOES re-date". A re-date that changes nothing (the
 * field already carries this run's date) is null too, so a current index stays unwritten.
 *
 * @param {string} field the inner text of the entry's trailing parenthetical
 * @param {string} newestVersion
 * @param {string} date `YYYY-MM-DD`
 * @param {{ gaVersionRun?: boolean }} [options] true only on the run whose `changeset
 *   version` wrote `newestVersion`'s CHANGELOG heading (`gaVersionRunMajors`)
 * @returns {string | null}
 */
export function rewriteStatusField(field, newestVersion, date, { gaVersionRun = false } = {}) {
  const m = STATUS_SHAPE.exec(field);
  if (m === null) return null;
  if (aheadOfNewestGa(m[2], newestVersion)) return null;
  if (m[2] === newestVersion && !gaVersionRun) return null;
  const rewritten = `${m[1]}${newestVersion}${m[3]}${date}`;
  return rewritten === field ? null : rewritten;
}

/**
 * The spec CHANGELOG as committed at `HEAD`: the tree as it stood BEFORE this run's
 * `changeset version`, read from the object database. No clock and no network.
 *
 * On the `version-pr` lane `HEAD` is the main commit being rendered: release.yml's
 * post-version step and changesets/action both run `pnpm run version` on a tree reset
 * to it, and the step diffs its output against `HEAD` the same way. A shallow
 * checkout still holds `HEAD`'s own tree.
 *
 * `gitFreeEnv()`: the repository is the one `root` names, never one an inherited
 * GIT_DIR names (`GIT_ENV_ISOLATION_RULE`), so the self-test can hand this a throwaway
 * repository from inside a hook.
 *
 * A `HEAD` this cannot read is a REFUSAL. Treating it as "no GA at HEAD" would re-date
 * every same-version field on every run, the 17.7.0 defect; treating it as "nothing
 * moved" would leave a hand-written date in place, the 18.0.0 one.
 *
 * @param {string} root
 * @returns {string}
 */
export function committedChangelogText(root) {
  const r = spawnSync('git', ['show', `HEAD:${SPEC_CHANGELOG}`], {
    cwd: root,
    env: gitFreeEnv(),
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  if (r.error || r.status !== 0) {
    const why = r.error ? String(r.error.message ?? r.error) : `exit ${r.status}: ${String(r.stderr).trim()}`;
    throw new Error(
      `sync-release-index-currency: could not read ${SPEC_CHANGELOG} as committed at HEAD in ${root} `
      + `(git show ${why}). Without it this run cannot tell whether it is the version commit of a `
      + 'newest GA, which decides whether a same-version status field may be re-dated. Refusing '
      + 'rather than guessing either way.',
    );
  }
  return r.stdout;
}

/**
 * The majors whose newest GA this run's `changeset version` introduced: the heading of
 * that GA is in `changelogText` (the working tree) and not in `headChangelogText`
 * (committed at `HEAD`). This run is that GA's version run, and its date is that GA's.
 *
 * "Introduced" rather than "the newest GA differs": a working tree that LOST a heading
 * `HEAD` carries also differs, and it is not anyone's version commit. Per major, never
 * repository-wide -- see "The one same-version field it DOES re-date".
 *
 * @param {{ changelogText: string, headChangelogText: string, majors: number[] }} input
 * @returns {Set<number>}
 */
export function gaVersionRunMajors({ changelogText, headChangelogText, majors }) {
  const versions = gaVersions(changelogText);
  const atHead = new Set(gaVersions(headChangelogText).map((v) => v.join('.')));
  const out = new Set();
  for (const major of majors) {
    const newest = newestGaOfMajor(versions, major);
    if (newest !== null && !atHead.has(newest)) out.add(major);
  }
  return out;
}

/**
 * @typedef {{ major: number, from: string, to: string, redated: boolean }} Rewrite
 *   `redated`: the version already matched, and this is the GA's own version run.
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
 * @param {{ gaVersionRun?: boolean }} [options] see `rewriteStatusField`
 * @returns {{ line: string, rewrite: Rewrite | null }}
 */
export function rewriteEntryLine(line, major, newestVersion, date, { gaVersionRun = false } = {}) {
  const field = indexStatusField(line);
  if (field === null) return { line, rewrite: null };
  const rewritten = rewriteStatusField(field, newestVersion, date, { gaVersionRun });
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
  const redated = STATUS_SHAPE.exec(field)?.[2] === newestVersion;
  return { line: next, rewrite: { major, from: field, to: rewritten, redated } };
}

/**
 * Rewrite every in-scope major's status field in `indexText`.
 *
 * The major set is built the way the gate's own `main()` builds it -- `gaMinors()`
 * filtered by the gate's `inScope()` -- so this rewriter can never consider a major the
 * gate does not judge, nor skip one it does.
 *
 * `headChangelogText` is REQUIRED: it is the CHANGELOG committed at `HEAD`, and it is
 * what tells a GA's own version run from every other run (`gaVersionRunMajors`). On a
 * run with nothing to version it equals `changelogText`. A caller that omitted it would
 * silently get the 18.0.0 behaviour back, so its absence is a refusal.
 *
 * @param {{ indexText: string, changelogText: string, headChangelogText: string, date: string }} input
 * @returns {{ text: string, rewrites: Rewrite[], majors: number[], gaVersionRun: number[] }}
 */
export function rewriteIndexText({ indexText, changelogText, headChangelogText, date }) {
  if (typeof headChangelogText !== 'string') {
    throw new Error(
      'sync-release-index-currency: rewriteIndexText needs headChangelogText, the CHANGELOG as '
      + 'committed at HEAD. Without it a GA\'s own version run cannot be told from any other run, '
      + 'so a same-version status field could be neither re-dated safely nor left alone safely.',
    );
  }
  const versions = gaVersions(changelogText);
  const minors = gaMinors(versions).filter(([maj]) => inScope(maj));
  const majors = [...new Set(minors.map(([maj]) => maj))].sort((a, b) => a - b);
  const versionRun = gaVersionRunMajors({ changelogText, headChangelogText, majors });

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
    const { line: next, rewrite } = rewriteEntryLine(line, major, newest, date, {
      gaVersionRun: versionRun.has(major),
    });
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

  return { text, rewrites, majors, gaVersionRun: [...versionRun].sort((a, b) => a - b) };
}

/**
 * @typedef {{ major: number, field: string, named: string, newest: string }} Deferral
 *   A status field written ahead of its GA cut: `named` is newer than `newest`, the
 *   newest GA of `major`. Left byte-identical for that GA's own version run.
 */

/**
 * The gate's OWN assertion-2 verdict over a given index text, with ONE shape held out:
 * a `current series:` field written ahead of the cut (`aheadOfNewestGa`), returned as a
 * deferral instead of a finding -- see "A field written AHEAD of the cut".
 *
 * Assertion 1 is deliberately not consulted -- see "Boundary 1". This is the function
 * that makes "the rewriter and the gate cannot drift apart" a mechanical fact rather
 * than an intention: anything this file failed to bring into line is reported by the
 * very code that would have reddened the patrol, in the same words. A deferral is judged
 * per major, from the same entry line the gate reads, so it can hold out that major's
 * finding and no other.
 *
 * @param {{ indexText: string, changelogText: string }} input
 * @returns {{ findings: string[], deferred: Deferral[] }}
 */
export function currencyVerdict({ indexText, changelogText }) {
  const versions = gaVersions(changelogText);
  const minors = gaMinors(versions).filter(([maj]) => inScope(maj));
  const majors = [...new Set(minors.map(([maj]) => maj))].sort((a, b) => a - b);
  const findings = [];
  /** @type {Deferral[]} */
  const deferred = [];
  for (const major of majors) {
    const newest = newestGaOfMajor(versions, major);
    if (newest === null) continue;
    const line = indexEntryLine(indexText, major);
    const field = line === null ? null : indexStatusField(line);
    const m = field === null ? null : STATUS_SHAPE.exec(field);
    if (m !== null && aheadOfNewestGa(m[2], newest)) {
      deferred.push({ major, field, named: m[2], newest });
      continue;
    }
    findings.push(...indexCurrencyFindings(major, newest, line));
  }
  return { findings, deferred };
}

/**
 * `currencyVerdict`'s findings alone: what stops the run.
 *
 * @param {{ indexText: string, changelogText: string }} input
 * @returns {string[]}
 */
export function currencyFindings(input) {
  return currencyVerdict(input).findings;
}

/**
 * The line a run prints for a deferral: which field, why it was left, whose run dates
 * it, and the remedy when that GA never ships.
 *
 * @param {Deferral} deferral
 * @returns {string}
 */
export function deferralNotice({ major, field, named, newest }) {
  return `    v${major}: (${field}) left as written — ${named} is newer than v${major}'s newest GA in `
    + `${SPEC_CHANGELOG} (${newest}), so the field was written ahead of the ${named} cut. Only `
    + `${named}'s own version run can date it, and it will; rewriting it now would move it back to `
    + `${newest} under a date that belongs to neither release. If ${named} will not ship, correct `
    + 'the field by hand. check-release-section-coverage reports it until then.';
}

/**
 * Read, rewrite, write, then let the GATE pronounce.
 *
 * A file with nothing to change is not written at all -- not rewritten to identical
 * bytes. Leaving mtime untouched keeps a no-op release from showing a "modified" file a
 * reviewer then has to diff to discover is empty.
 *
 * The CHANGELOG committed at `HEAD` is read here, by `committedChangelogText`, so the
 * one path `main()` takes is the path the self-test drives on a real repository.
 *
 * @param {{ root: string, date: string }} options
 * @returns {{ path: string, rewrites: Rewrite[], wrote: boolean, findings: string[], deferred: Deferral[], majors: number[], gaVersionRun: number[] }}
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
  const headChangelogText = committedChangelogText(root);

  const { text, rewrites, majors, gaVersionRun } = rewriteIndexText({
    indexText, changelogText, headChangelogText, date,
  });
  const wrote = rewrites.length > 0;
  if (wrote) writeFileSync(indexFull, text);

  const { findings, deferred } = currencyVerdict({ indexText: text, changelogText });
  return { path: INDEX_PATH, rewrites, wrote, majors, gaVersionRun, findings, deferred };
}

// ---------------------------------------------------------------------------

function main() {
  const root = scriptRepoRoot();
  const date = releaseDate();
  const { rewrites, majors, findings, deferred } = syncIndex({ root, date });

  if (rewrites.length === 0 && deferred.length === 0) {
    console.log(
      `✓ sync-release-index-currency: every in-scope entry in ${INDEX_PATH} (v${majors.join(', v')}) `
      + `already names the newest GA release of its major, per ${SPEC_CHANGELOG} — nothing rewritten.`,
    );
  } else if (rewrites.length === 0) {
    console.log(`  ${INDEX_PATH}`);
    for (const deferral of deferred) console.log(deferralNotice(deferral));
    console.log(
      `✓ sync-release-index-currency: nothing rewritten — ${deferred.length} status field(s) written `
      + 'ahead of the cut wait for their GA\'s own version run (above), and every other in-scope entry '
      + 'already names the newest GA release of its major.',
    );
  } else {
    console.log(`  ${INDEX_PATH}`);
    for (const rewrite of rewrites) {
      const why = rewrite.redated
        ? ` — re-dated: this run's version pass wrote the newest v${rewrite.major} GA heading, `
          + 'so this is its version commit'
        : '';
      console.log(`    v${rewrite.major}: (${rewrite.from}) → (${rewrite.to})${why}`);
    }
    for (const deferral of deferred) console.log(deferralNotice(deferral));
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
    // exists to prevent. A field written ahead of the cut needs no sentence and never
    // reaches here: it is deferred above.
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
  'Control H: a prerelease cut never re-dates the newest GA': 7,
  'Control I: the newest GA\'s own version run re-dates a pre-written field': 16,
  'Control J: a field written AHEAD of the cut waits for its GA\'s own run': 17,
});

// DELETING an entry silences that battery's floor exactly as effectively as zeroing it,
// so the roster's own size is pinned too.
const SELF_TEST_BATTERY_FLOOR = 10;

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

/** The same CHANGELOG as committed BEFORE the 17.3.0 version run: no `## 17.3.0` yet. */
const CHANGELOG_BEFORE_17_3_FIXTURE = CHANGELOG_FIXTURE.replace('\n## 17.3.0\n\n', '\n');

/** 17.3.0's field written by hand ahead of the cut, dated the day it was written. */
const PREWRITTEN_V17 = CURRENT_V17.replace('released 2026-09-04', 'released 2026-09-01');

const STAMP_DATE = '2026-09-04';

const indexOf = (...entries) => ['## Versions', '', ...entries, ''].join('\n');

/**
 * A throwaway repository shaped like the version lane's checkout: `index` and
 * `committed` are the release index and spec CHANGELOG at `HEAD` (`committed: null`
 * commits no CHANGELOG), and `working` is the CHANGELOG this run's `changeset version`
 * left in the tree. Every git child gets `gitFreeEnv()` (`GIT_ENV_ISOLATION_RULE`).
 *
 * @param {{ index: string, committed: string | null, working: string }} input
 */
function checkoutTree({ index, committed, working }) {
  const dir = mkdtempSync(join(tmpdir(), 'sync-release-index-currency-'));
  const git = (...args) => execFileSync('git', args, {
    cwd: dir, env: gitFreeEnv(), stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8',
  });
  const write = (rel, text) => {
    mkdirSync(dirname(join(dir, rel)), { recursive: true });
    writeFileSync(join(dir, rel), text);
  };
  git('init', '-q', '-b', 'main');
  git('config', 'user.email', 'selftest@example.invalid');
  git('config', 'user.name', 'self test');
  git('config', 'commit.gpgsign', 'false');
  write(INDEX_PATH, index);
  if (committed !== null) write(SPEC_CHANGELOG, committed);
  git('add', '-A');
  git('commit', '-q', '--no-gpg-sign', '-m', 'HEAD');
  write(SPEC_CHANGELOG, working);
  return { dir, git };
}

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

  // Controls A-E run on a tree with nothing to version: the CHANGELOG at HEAD is the
  // CHANGELOG in the tree, so no major is on its GA's own version run.
  const run = (indexText, date = STAMP_DATE) =>
    rewriteIndexText({ indexText, changelogText: CHANGELOG_FIXTURE, headChangelogText: CHANGELOG_FIXTURE, date });

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
    expect('B — and neither is a same-version entry with a DIFFERENT date: the date belongs to the '
      + 'version commit that moved the field, which a run that moves nothing is not',
      rewriteStatusField('current series: 17.3.0, released 2026-09-01', '17.3.0', '2026-09-04') === null);
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
      String(currencyVerdict).indexOf('coverageFindings') === -1);
    expect('E — the verdict is computed over the REWRITTEN text, not the text as read',
      currencyFindings({ indexText: stamped.text, changelogText: CHANGELOG_FIXTURE }).length === 0
        && stale.length === 1);
  }

  // ── Control F ─────────────────────────────────────────────────────────────
  battery('Control F: the surface and the scope are the gate\'s, not copies');
  {
    expect('F — syncedPaths() is exactly the gate\'s INDEX_PATH, so release.yml '
      + 'resolves the same one path this file can write',
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

  // ── Control H ─────────────────────────────────────────────────────────────
  // The measured defect: the first `18.0.0-next.0` cut re-dated the v17 entry from its
  // GA day to the cut's day. A prerelease heading never becomes the newest GA, so a
  // prerelease cut leaves the version where it is -- and must leave the date too.
  battery('Control H: a prerelease cut never re-dates the newest GA');
  {
    const CUT_DATE = '2026-10-07';
    const withHeading = (heading) => CHANGELOG_FIXTURE.replace('## 17.3.0-rc.1', heading);
    const nextCut = withHeading('## 18.0.0-next.0');
    const rcCut = withHeading('## 17.4.0-rc.0');
    const current = indexOf(CURRENT_V17, CURRENT_V16);

    // HEAD carries the fixture as committed; the cut's `changeset version` added only
    // the prerelease heading.
    const cut = (indexText, changelogText) => rewriteIndexText({
      indexText, changelogText, headChangelogText: CHANGELOG_FIXTURE, date: CUT_DATE,
    });
    const afterNext = cut(current, nextCut);
    expect('H — a `next` prerelease cut on a later day rewrites nothing',
      afterNext.rewrites.length === 0 && afterNext.text === current);
    expect('H — the newest GA keeps its own release date, not the cut\'s',
      afterNext.text.includes('current series: 17.3.0, released 2026-09-04')
        && !afterNext.text.includes(`released ${CUT_DATE}`));
    expect('H — the prerelease major is not a judged major: no GA of 18 exists yet',
      !afterNext.majors.includes(18) && afterNext.majors.includes(17));
    expect('H — and refusing the re-date leaves the gate nothing to say',
      currencyFindings({ indexText: afterNext.text, changelogText: nextCut }).length === 0);

    const afterRc = cut(current, rcCut);
    expect('H — an `rc` prerelease cut on a later day rewrites nothing either',
      afterRc.rewrites.length === 0 && afterRc.text === current);

    // Positive control on the same later day: the date still travels WITH a version that
    // moves, so the refusal above is about the version standing still, not an inert date.
    const staleAfterNext = cut(indexOf(STALE_V17, CURRENT_V16), nextCut);
    expect('H — control: a STALE entry on the same cut is still stamped, version AND that day',
      staleAfterNext.rewrites.length === 1
        && staleAfterNext.text.includes(`current series: 17.3.0, released ${CUT_DATE}`));

    // End to end through syncIndex, the function main() calls: on a checkout-shaped temp
    // repository the index file is not written at all, not rewritten to identical bytes.
    const { dir: tmp } = checkoutTree({ index: current, committed: CHANGELOG_FIXTURE, working: nextCut });
    try {
      const result = syncIndex({ root: tmp, date: CUT_DATE });
      expect('H — syncIndex on a next-cut tree reports no write and leaves the index byte-identical',
        result.wrote === false && result.rewrites.length === 0
          && readFileSync(join(tmp, INDEX_PATH), 'utf8') === current && result.findings.length === 0);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  }

  // ── Control I ─────────────────────────────────────────────────────────────
  // The measured defect (#25356): 18.0.0's field was written by hand ahead of the cut,
  // and the version run that wrote `## 18.0.0` left the hand-written date in place. On
  // that run, and on no other, a same-version field takes the run's date.
  battery('Control I: the newest GA\'s own version run re-dates a pre-written field');
  {
    const prewritten = indexOf(PREWRITTEN_V17, CURRENT_V16);
    const gaRun = (indexText, changelogText, headChangelogText, date = STAMP_DATE) =>
      rewriteIndexText({ indexText, changelogText, headChangelogText, date });

    const onGaRun = gaRun(prewritten, CHANGELOG_FIXTURE, CHANGELOG_BEFORE_17_3_FIXTURE);
    expect('I — on the run whose version pass wrote `## 17.3.0`, a pre-written 17.3.0 field is '
      + 're-dated: there the date is true and the hand-written one is not',
    onGaRun.rewrites.length === 1 && onGaRun.rewrites[0].major === 17 && onGaRun.rewrites[0].redated === true);
    expect('I — the re-dated line is EXACTLY the current entry, version kept, date moved',
      onGaRun.text.split('\n').includes(CURRENT_V17) && !onGaRun.text.includes('released 2026-09-01'));
    expect('I — only v17 is on its GA\'s version run; 16.1.0\'s heading is already at HEAD',
      onGaRun.gaVersionRun.length === 1 && onGaRun.gaVersionRun[0] === 17);
    expect('I — and the gate has nothing to say after it',
      currencyFindings({ indexText: onGaRun.text, changelogText: CHANGELOG_FIXTURE }).length === 0);

    const alreadyDated = indexOf(CURRENT_V17, CURRENT_V16);
    const sameDay = gaRun(alreadyDated, CHANGELOG_FIXTURE, CHANGELOG_BEFORE_17_3_FIXTURE);
    expect('I — on the GA run a field already carrying the run\'s date is no rewrite and no write',
      sameDay.rewrites.length === 0 && sameDay.text === alreadyDated);

    const rcAfter17 = CHANGELOG_FIXTURE.replace('## 17.3.0-rc.1', '## 17.4.0-rc.0\n\n## 17.3.0-rc.1');
    const onRc = gaRun(prewritten, rcAfter17, CHANGELOG_FIXTURE);
    expect('I — a PRERELEASE run leaves the pre-written field alone: its version pass wrote only '
      + 'a prerelease heading, so it is no GA\'s version commit',
    onRc.rewrites.length === 0 && onRc.text === prewritten && onRc.gaVersionRun.length === 0);

    const onNothing = gaRun(prewritten, CHANGELOG_FIXTURE, CHANGELOG_FIXTURE);
    expect('I — a NON-VERSION run (CHANGELOG at HEAD = CHANGELOG in the tree) leaves it alone too',
      onNothing.rewrites.length === 0 && onNothing.text === prewritten);

    const lostHeading = gaRun(prewritten, CHANGELOG_FIXTURE,
      CHANGELOG_FIXTURE.replace('## 17.3.0-rc.1', '## 17.4.0'));
    expect('I — a tree that LOST a GA heading HEAD carries is no version run: 17.3.0\'s heading is '
      + 'at HEAD, so nothing is re-dated (introduced, not merely different)',
    lostHeading.rewrites.length === 0 && lostHeading.gaVersionRun.length === 0);

    expect('I — at the field level the re-date keeps the version and takes the run\'s date',
      rewriteStatusField('current series: 17.3.0, released 2026-09-01', '17.3.0', STAMP_DATE, { gaVersionRun: true })
        === `current series: 17.3.0, released ${STAMP_DATE}`);
    expect('I — the GA run opens no refused shape: "final release:" and trailing matter stay refused',
      rewriteStatusField('final release: 16.1.0', '16.1.0', STAMP_DATE, { gaVersionRun: true }) === null
        && rewriteStatusField('current series: 17.3.0, released 2026-09-01; see below', '17.3.0', STAMP_DATE,
          { gaVersionRun: true }) === null);

    // Per major, on the measured shape: the 18.0.0 run must re-date v18 and leave v17,
    // whose field still names 17.x's newest GA, exactly as it is.
    const V18_PREWRITTEN = '- [v18](/docs/releases/v18) — The line that carries ADR-0131 '
      + '(current series: 18.0.0, released 2026-10-19).';
    const ga18 = CHANGELOG_FIXTURE.replace('## 17.3.0-rc.1', '## 18.0.0\n\n## 18.0.0-next.5\n\n## 17.3.0-rc.1');
    const before18 = CHANGELOG_FIXTURE.replace('## 17.3.0-rc.1', '## 18.0.0-next.5\n\n## 17.3.0-rc.1');
    const on18 = gaRun(indexOf(V18_PREWRITTEN, CURRENT_V17, CURRENT_V16), ga18, before18, '2026-10-20');
    expect('I — the 18.0.0 shape: v18\'s hand-written 2026-10-19 becomes the run\'s 2026-10-20',
      on18.rewrites.length === 1 && on18.rewrites[0].major === 18
        && on18.text.includes('(current series: 18.0.0, released 2026-10-20)'));
    expect('I — and v17 is NOT re-dated on 18.0.0\'s run: the version run is judged per major, never '
      + '"the repository\'s newest GA moved"', on18.text.includes(CURRENT_V17) && on18.gaVersionRun.join() === '18');

    let threwWithoutHead = false;
    try {
      rewriteIndexText({ indexText: prewritten, changelogText: CHANGELOG_FIXTURE, date: STAMP_DATE });
    } catch { threwWithoutHead = true; }
    expect('I — rewriteIndexText REFUSES without the CHANGELOG at HEAD rather than defaulting to '
      + 'either answer', threwWithoutHead);

    // End to end through syncIndex on a real repository: `committedChangelogText` reads
    // HEAD with git, the path main() takes.
    const ga = checkoutTree({ index: prewritten, committed: CHANGELOG_BEFORE_17_3_FIXTURE, working: CHANGELOG_FIXTURE });
    try {
      const first = syncIndex({ root: ga.dir, date: STAMP_DATE });
      expect('I — syncIndex on the GA version run re-dates the field ON DISK',
        first.wrote === true && first.rewrites.length === 1 && first.rewrites[0].redated === true
          && readFileSync(join(ga.dir, INDEX_PATH), 'utf8') === alreadyDated && first.findings.length === 0);

      // The version commit lands; the next run on a later day finds `## 17.3.0` at HEAD.
      ga.git('add', '-A');
      ga.git('commit', '-q', '--no-gpg-sign', '-m', 'chore: version packages');
      const next = syncIndex({ root: ga.dir, date: '2026-09-10' });
      expect('I — once the version commit is at HEAD, a later run leaves the date alone, unwritten',
        next.wrote === false && next.rewrites.length === 0 && next.gaVersionRun.length === 0
          && readFileSync(join(ga.dir, INDEX_PATH), 'utf8') === alreadyDated);
    } finally {
      rmSync(ga.dir, { recursive: true, force: true });
    }

    const headless = checkoutTree({ index: prewritten, committed: null, working: CHANGELOG_FIXTURE });
    try {
      let refused = false;
      try { syncIndex({ root: headless.dir, date: STAMP_DATE }); } catch { refused = true; }
      expect('I — a CHANGELOG git cannot read at HEAD is a REFUSAL, and the index is left untouched',
        refused && readFileSync(join(headless.dir, INDEX_PATH), 'utf8') === prewritten);
    } finally {
      rmSync(headless.dir, { recursive: true, force: true });
    }
  }

  // ── Control J ─────────────────────────────────────────────────────────────
  // The measured defect (#25408): before `## 18.1.0` existed, a field pre-written as
  // "(current series: 18.1.0, released 2026-10-21)" was rewritten BACKWARDS to 18.0.0
  // under the run's date by every version pass that was not 18.1.0's own. Both
  // directions are pinned: ahead is left alone, behind is still stamped forward.
  battery('Control J: a field written AHEAD of the cut waits for its GA\'s own run');
  {
    const AHEAD_FIELD = 'current series: 17.4.0, released 2026-09-08';
    const AHEAD_V17 = CURRENT_V17.replace('current series: 17.3.0, released 2026-09-04', AHEAD_FIELD);
    const ahead = indexOf(AHEAD_V17, CURRENT_V16);
    const RUN_DATE = '2026-09-10';
    const runOn = (indexText, changelogText, headChangelogText = changelogText) =>
      rewriteIndexText({ indexText, changelogText, headChangelogText, date: RUN_DATE });
    const headingAbove = (heading) => CHANGELOG_FIXTURE.replace('## 17.3.0-rc.1', `${heading}\n\n## 17.3.0-rc.1`);

    const idle = runOn(ahead, CHANGELOG_FIXTURE);
    expect('J — a run with nothing to version leaves a field naming 17.4.0 (newest GA 17.3.0) '
      + 'byte-identical: it is early, not stale, and moving it back to 17.3.0 is the defect',
    idle.rewrites.length === 0 && idle.text === ahead);
    const onRc = runOn(ahead, headingAbove('## 17.4.0-rc.0'), CHANGELOG_FIXTURE);
    expect('J — a prerelease cut of that very version (`17.4.0-rc.0`) leaves it byte-identical too',
      onRc.rewrites.length === 0 && onRc.text === ahead);
    const onPatch = runOn(ahead, headingAbove('## 17.3.1'), CHANGELOG_FIXTURE);
    expect('J — and so does the GA run of a LOWER version (17.3.1): that run is 17.3.1\'s version '
      + 'commit, not 17.4.0\'s', onPatch.rewrites.length === 0 && onPatch.text === ahead
      && onPatch.gaVersionRun.join() === '17');
    expect('J — at the field level an ahead field is refused on every run, the GA-run flag included',
      rewriteStatusField(AHEAD_FIELD, '17.3.0', RUN_DATE) === null
        && rewriteStatusField(AHEAD_FIELD, '17.3.0', RUN_DATE, { gaVersionRun: true }) === null);

    expect('J — "ahead" is a numeric triple compare: 17.10.0 is ahead of 17.9.0, 17.9.0 is behind '
      + '17.10.0, 17.3.1 is ahead of 17.3.0, and a version is not ahead of itself',
    aheadOfNewestGa('17.10.0', '17.9.0') && !aheadOfNewestGa('17.9.0', '17.10.0')
      && aheadOfNewestGa('17.3.1', '17.3.0') && !aheadOfNewestGa('17.3.0', '17.3.0'));
    let threwOnShape = false;
    try { aheadOfNewestGa('17.4', '17.3.0'); } catch { threwOnShape = true; }
    expect('J — a version that is not x.y.z is a REFUSAL, never a guess in either direction', threwOnShape);

    const behind = runOn(indexOf(STALE_V17, CURRENT_V16), CHANGELOG_FIXTURE);
    expect('J — the other direction, on the same run: a field BEHIND the newest GA (17.2.0) is still '
      + 'stamped forward, version and date',
    behind.rewrites.length === 1 && behind.text.includes(`current series: 17.3.0, released ${RUN_DATE}`));
    const otherMajor = runOn(
      indexOf(CURRENT_V17.replace('current series: 17.3.0', 'current series: 18.4.0'), CURRENT_V16),
      CHANGELOG_FIXTURE,
    );
    expect('J — judged against the entry\'s OWN major: a v17 field naming 18.4.0 is no 17.x written '
      + 'ahead of a 17.x cut (its minor and patch say nothing about 17.x), so it is stamped to '
      + '17.3.0 as a stale field',
    !aheadOfNewestGa('18.4.0', '17.3.0') && otherMajor.rewrites.length === 1
      && otherMajor.text.includes(`current series: 17.3.0, released ${RUN_DATE}`));

    expect('J — the GATE still reports the field: the deferral holds it out of this run\'s verdict, '
      + 'it does not blind the gate', indexCurrencyFindings(17, '17.3.0', AHEAD_V17).length === 1);
    const verdict = currencyVerdict({ indexText: ahead, changelogText: CHANGELOG_FIXTURE });
    expect('J — the verdict carries no finding for it and one deferral naming the major, the field, '
      + 'the version it names and the newest GA',
    verdict.findings.length === 0 && verdict.deferred.length === 1 && verdict.deferred[0].major === 17
      && verdict.deferred[0].field === AHEAD_FIELD && verdict.deferred[0].named === '17.4.0'
      && verdict.deferred[0].newest === '17.3.0');
    const mixed = currencyVerdict({ indexText: indexOf(AHEAD_V17, STALE_FINAL_V16), changelogText: CHANGELOG_FIXTURE });
    expect('J — a deferral holds out ITS major only: a refused "final release:" on v16 in the same '
      + 'index still reaches the verdict and stops the run',
    mixed.deferred.length === 1 && mixed.findings.length === 1 && mixed.findings[0].includes('final release: 16.0.0'));

    const notice = verdict.deferred.length === 1 ? deferralNotice(verdict.deferred[0]) : '';
    expect('J — the run says why: the field, the newest GA, whose own run dates it, and the remedy '
      + 'when that GA never ships',
    notice.includes(`(${AHEAD_FIELD})`) && notice.includes('(17.3.0)') && notice.includes('17.4.0\'s own version run')
      && notice.includes('by hand'));
    expect('J — and that runtime prose carries no tracker number', !/#\d/.test(notice));

    const ga174 = headingAbove('## 17.4.0');
    const onGa = runOn(ahead, ga174, CHANGELOG_FIXTURE);
    expect('J — on 17.4.0\'s own version run the field is no longer ahead: it is re-dated to that run '
      + 'and nothing is deferred',
    onGa.rewrites.length === 1 && onGa.rewrites[0].redated === true
      && onGa.text.includes(`current series: 17.4.0, released ${RUN_DATE}`)
      && currencyVerdict({ indexText: onGa.text, changelogText: ga174 }).deferred.length === 0);

    // End to end through syncIndex, on the measured shape: newest GA 18.0.0, field
    // pre-written for 18.1.0.
    const V18_AHEAD = '- [v18](/docs/releases/v18) — The line that carries ADR-0131 '
      + '(current series: 18.1.0, released 2026-10-21).';
    const at18 = CHANGELOG_FIXTURE.replace('## 17.3.0-rc.1', '## 18.0.0\n\n## 18.0.0-next.5\n\n## 17.3.0-rc.1');
    const index18 = indexOf(V18_AHEAD, CURRENT_V17, CURRENT_V16);
    const shapes = [
      ['with nothing pending', at18],
      ['on an 18.1.0-rc.0 cut', at18.replace('## 18.0.0\n', '## 18.1.0-rc.0\n\n## 18.0.0\n')],
    ];
    for (const [shape, working] of shapes) {
      const tree = checkoutTree({ index: index18, committed: at18, working });
      try {
        const result = syncIndex({ root: tree.dir, date: '2026-10-23' });
        expect(`J — syncIndex ${shape}: the 18.1.0 field is not written back to 18.0.0 — no write, `
          + 'byte-identical on disk, no finding, one v18 deferral',
        result.wrote === false && result.rewrites.length === 0 && result.findings.length === 0
          && result.deferred.length === 1 && result.deferred[0].major === 18
          && readFileSync(join(tree.dir, INDEX_PATH), 'utf8') === index18);
      } finally {
        rmSync(tree.dir, { recursive: true, force: true });
      }
    }
    const gaTree = checkoutTree({
      index: index18, committed: at18, working: at18.replace('## 18.0.0\n', '## 18.1.0\n\n## 18.0.0\n'),
    });
    try {
      const result = syncIndex({ root: gaTree.dir, date: '2026-10-23' });
      expect('J — syncIndex on 18.1.0\'s own version run re-dates the field ON DISK and defers nothing',
        result.wrote === true && result.rewrites.length === 1 && result.rewrites[0].redated === true
          && result.deferred.length === 0 && result.findings.length === 0
          && readFileSync(join(gaTree.dir, INDEX_PATH), 'utf8')
            .includes('(current series: 18.1.0, released 2026-10-23)'));
    } finally {
      rmSync(gaTree.dir, { recursive: true, force: true });
    }
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
    + 'out-of-scope majors are never touched, a prerelease cut (`next` or `rc`) leaves the newest '
    + 'GA\'s release date alone while the GA\'s own version run re-dates a pre-written field (per '
    + 'major, read from the CHANGELOG at HEAD), a field written ahead of the cut is left for that '
    + 'GA\'s own run instead of being rewritten backwards, and the surface, the scope floor and the '
    + 'verdict are the gate\'s rather than copies of it.',
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
