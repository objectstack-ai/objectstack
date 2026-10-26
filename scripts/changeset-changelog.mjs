// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// changeset-changelog (#25638) -- the changelog generator `.changeset/config.json`
// names: `@changesets/cli/changelog`'s own lines, with each entry's commit read
// by `createChangelogAttribution` in scripts/release-pending-publish.mjs.
//
// The stock generator stamps an entry with the newest commit that added its
// changeset file. A revert of a version commit re-adds every changeset that cut
// consumed, so after a re-cut every entry names the revert: 260 of the 265
// entries in 18.1.0's CHANGELOGs open `- 3937697:`, the commit of #25605. Here
// an add that restores the bytes an earlier commit deleted is passed over, and
// the entry names the commit that first added the changeset.
//
// Nothing else moves: the line format is the stock generator's, and whatever
// the attribution cannot decide keeps the stock commit with a `::warning::`.
// The pins live in `node scripts/release-pending-publish.mjs --self-test`,
// which lint.yml runs: an add -> version -> revert -> re-cut fixture through
// these two functions.
//
// ## The stable cut folds its prerelease sections (#26079, ruling A′)
//
// Leaving pre mode (`changeset pre exit`) and versioning applies every
// changeset the cycle's prereleases consumed a second time, so the stable
// `## X.Y.Z` section repeats each `## X.Y.Z-next.N` section below it: 18.0.0's
// cut left spec with 4,076 duplicated long lines. On that cut the prerelease
// sections are FOLDED into the stable section instead of copied: the stable
// section is written whole, as the stock writer always writes it, and each
// prerelease section of the cycle is dropped once every entry it carries is
// found in the new stable section.
//
// What may fold is fixed by the file as it stood before the cut, never by a
// version guess: only a CHANGELOG whose top section was a prerelease when
// `changeset version` started and that now opens with a new stable section,
// and in it only the prerelease sections between that stable section and the
// next stable one below. Every stable section, and every older cycle's
// prerelease sections, is kept byte for byte -- existing text is not rewritten
// (#25919 A 「存量不横扫」). A prerelease section holding an entry the stable
// section does not reproduce (amended in place by a docs PR, say) is kept,
// with a `::warning::` naming it. An entry is compared without its commit
// prefix, and dependency-bump entries (`Updated dependencies` and the
// `pkg@X.Y.Z-next.N` lines under them) are superseded by the stable section's
// own, so neither holds a section back.
//
// The generator API hands out one release line at a time and nothing of it
// runs after the files are written, so the fold is armed on the first line of
// an exit-mode cut (`.changeset/pre.json` with `"mode": "exit"`, which the
// version pass itself deletes) and runs when that process exits 0. The ruling
// keeps `CHANGELOG.md` in every package's `files`: the tarball copy is still
// the text an upgrading agent greps (AGENTS.md, Documentation Guardrails).
// Its pins sit beside the attribution's, in the same CI-run self-test.

import { closeSync, openSync, readFileSync, readSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import stock from '@changesets/cli/changelog';
import { createChangelogAttribution } from './release-pending-publish.mjs';

/** The two functions `changeset version` calls, attributing from the repository at `cwd`. */
export function changelogFunctions(options = {}) {
  const attribute = createChangelogAttribution({ cwd: process.cwd(), ...options });
  const attributed = (changeset) => ({ ...changeset, commit: attribute(changeset) });
  let armed = false;
  const arm = () => {
    if (armed) return;
    armed = true;
    armPrereleaseFold({ cwd: options.cwd ?? process.cwd(), log: options.log });
  };
  return {
    getReleaseLine: (changeset, type, opts) => {
      arm();
      return stock.getReleaseLine(attributed(changeset), type, opts);
    },
    getDependencyReleaseLine: (changesets, dependenciesUpdated, opts) => {
      arm();
      return stock.getDependencyReleaseLine(changesets.map(attributed), dependenciesUpdated, opts);
    },
  };
}

export default changelogFunctions();

// ─────────────────────────────────────────────────────────────────────────────
// The fold
// ─────────────────────────────────────────────────────────────────────────────

const HEADING = /^## (\S+)[ \t]*$/gm;
const STABLE = /^\d+\.\d+\.\d+$/;
const PRERELEASE = /^\d+\.\d+\.\d+-[0-9A-Za-z.-]+$/;
const COMMIT_PREFIX = /^[0-9a-f]{7,40}: /;

/** Every `## VERSION` section of a CHANGELOG: its version and [start, end) offsets. */
export function versionSections(text) {
  const heads = [...text.matchAll(HEADING)].filter((m) => STABLE.test(m[1]) || PRERELEASE.test(m[1]));
  return heads.map((m, i) => ({ version: m[1], start: m.index, end: i + 1 < heads.length ? heads[i + 1].index : text.length }));
}

/** A section's changeset entries, each without its commit prefix; dependency bumps are left out. */
function changesetEntries(body) {
  const entries = [];
  let current = null;
  for (const line of body.split('\n')) {
    if (line.startsWith('- ')) {
      current = [line.slice(2).replace(COMMIT_PREFIX, '')];
      entries.push(current);
    } else if (current && (line.startsWith(' ') || line === '')) {
      current.push(line);
    } else {
      current = null;
    }
  }
  return entries
    .map((lines) => lines.join('\n').trimEnd())
    .filter((entry) => !entry.startsWith('Updated dependencies'));
}

/**
 * Fold one CHANGELOG after a stable cut. `previousTop` is the version its top
 * section carried before the cut; nothing folds unless that was a prerelease
 * and the text now opens with a stable section directly above it.
 */
export function foldPrereleaseSections(text, previousTop) {
  const unchanged = (reason) => ({ text, folded: [], kept: [], reason });
  if (!PRERELEASE.test(previousTop ?? '')) return unchanged('the top section before the cut was not a prerelease');
  const sections = versionSections(text);
  if (sections.length < 2 || !STABLE.test(sections[0].version)) return unchanged('the file does not open with a stable section');
  if (sections[1].version !== previousTop) return unchanged(`the section under ${sections[0].version} is not ${previousTop}, the top before the cut`);
  const stable = new Set(changesetEntries(text.slice(sections[0].start, sections[0].end)));
  const folded = [];
  const kept = [];
  let out = text.slice(0, sections[1].start);
  let i = 1;
  for (; i < sections.length && PRERELEASE.test(sections[i].version); i += 1) {
    const s = sections[i];
    const missing = changesetEntries(text.slice(s.start, s.end)).filter((entry) => !stable.has(entry));
    if (missing.length === 0) {
      folded.push(s.version);
    } else {
      kept.push({ version: s.version, missing });
      out += text.slice(s.start, s.end);
    }
  }
  out += text.slice(i < sections.length ? sections[i].start : text.length);
  return { text: out, folded, kept, reason: null };
}

/** The first `## VERSION` of a file, read from its head only (spec's CHANGELOG is 10 MB). */
function topVersion(path) {
  const fd = openSync(path, 'r');
  try {
    const buf = Buffer.alloc(64 * 1024);
    const n = readSync(fd, buf, 0, buf.length, 0);
    return versionSections(buf.subarray(0, n).toString('utf8'))[0]?.version ?? null;
  } finally {
    closeSync(fd);
  }
}

/**
 * On an exit-mode cut, snapshot the tracked CHANGELOGs whose top section is a
 * prerelease, and hand back the function that folds them once written. Null
 * when this is not a stable cut out of pre mode.
 */
export function prepareFold({ cwd, log = console.log }) {
  let root;
  let mode;
  try {
    root = execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    mode = JSON.parse(readFileSync(join(root, '.changeset', 'pre.json'), 'utf8')).mode;
  } catch {
    return null;
  }
  if (mode !== 'exit') return null;
  const warn = (text) => log(`::warning::changeset-changelog: ${text}`);
  const tops = new Map();
  const listed = execFileSync('git', ['ls-files', '-z', '--', '*CHANGELOG.md'], { cwd: root, encoding: 'utf8' });
  for (const rel of listed.split('\0').filter(Boolean)) {
    try {
      const top = topVersion(join(root, rel));
      if (top && PRERELEASE.test(top)) tops.set(rel, top);
    } catch (err) {
      warn(`${rel} could not be read before the cut (${err instanceof Error ? err.message : err}); its prerelease sections stay.`);
    }
  }
  const apply = () => {
    let files = 0;
    let sections = 0;
    for (const [rel, previousTop] of tops) {
      try {
        const path = join(root, rel);
        const r = foldPrereleaseSections(readFileSync(path, 'utf8'), previousTop);
        for (const k of r.kept) {
          warn(`${rel}: ${k.version} holds ${k.missing.length} entr${k.missing.length === 1 ? 'y' : 'ies'} the stable section does not reproduce, so it stays.`);
        }
        if (r.folded.length === 0) continue;
        writeFileSync(path, r.text);
        files += 1;
        sections += r.folded.length;
      } catch (err) {
        warn(`${rel} could not be folded (${err instanceof Error ? err.message : err}); it stays as the version pass wrote it.`);
      }
    }
    log(`changeset-changelog: the stable cut folded ${sections} prerelease section(s) in ${files} CHANGELOG(s) into their stable section.`);
  };
  return { root, tops, apply };
}

function armPrereleaseFold({ cwd, log }) {
  const fold = prepareFold({ cwd, log });
  if (fold === null || fold.tops.size === 0) return;
  // `changeset version` writes the files after the last line is generated, so
  // the fold runs when the version pass ends, and only when it succeeded.
  process.once('exit', (code) => {
    if (code === 0) fold.apply();
  });
}
