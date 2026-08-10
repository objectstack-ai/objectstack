// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The ADR-anchor registry, sharded one file per anchor (#6957).
 *
 * ## Why this is a directory and not `scripts/adr-anchors.json`
 *
 * It used to be one file: a single JSON array that every card appending an
 * anchor had to edit. That is an append-only ledger, and this repo has now
 * measured what append-only ledgers cost it three separate times:
 *
 *   - `.changeset/*.md` — one file per change, the original answer;
 *   - `merge=os-regen` (#4675) — a local merge driver for generator-owned
 *     artifacts, after four merges produced nine conflicts in one afternoon and
 *     NOT ONE of them was a real semantic conflict;
 *   - sharding (#5837) — because that driver is a **local** git facility, and
 *     the GitHub merge queue rebuilds each PR server-side where no custom merge
 *     driver runs. A text conflict there evicts the second PR. The three
 *     hottest spec artifacts were split one file per category for exactly that
 *     reason.
 *
 * `scripts/adr-anchors.json` was in the same shape and had the same symptom.
 * The measurement on #6957 (2026-08-06..10, replayed with `git merge-tree
 * --merge-base` against every real re-merge lap): of the laps where two sides
 * both appended to it, **one of two conflicted** — PR #6608's only hand-resolved
 * conflict of that night — while `packages/spec/src/migrations/registry.ts`,
 * the sibling ledger, conflicted in **6 of 11** for 613 hand-resolved lines in
 * four days.
 *
 * The danger is not the wall-clock cost. Both ledgers are consumed as **sets**,
 * so a resolution that drops one side's entry produces no error anywhere: the
 * anchor simply stops being checked, and the decision it was protecting goes
 * back to being reversible by a patch-level changeset — which is #3723, the
 * incident `check-adr-anchors.mjs` exists to prevent. Conflict-free by
 * construction beats "resolve carefully" precisely when careful is undetectable.
 *
 * Maintainer ruling, 2026-08-10 (#6957), verbatim and untranslated:
 *
 * > **hybrid — batch now, split the append surface as the durable fix.**
 * > Now: the PM landing relay batches same-window retirement cards into one PR …
 * > Queued: implement per-card registry entry files concatenated by a generator,
 * > the `.changeset/*.md` shape that already de-conflicted this repo's other
 * > hottest file; `scripts/adr-anchors.json` is in the same fix space and may
 * > ride the same mechanism. Option B (uncommitted build-time artifacts) is
 * > rejected — the review diff of `spec-changes.json` / the upgrade guide is
 * > worth the laps it costs.
 *
 * ⚠️ Note what this is NOT. No data left version control and no reviewable diff
 * was traded away — that is option B, which the ruling rejected. Every byte of
 * the old file is still committed, one entry per file, and the review diff got
 * *better*: a new anchor is a new file rather than a hunk in a 343-line blob.
 * There is deliberately **no concatenated artifact checked in** either, because
 * a committed aggregate would be precisely the server-side merge-queue conflict
 * surface #5837 says a driver cannot rescue. The concatenation happens here, at
 * read time, in memory.
 *
 * ## The two structural properties, and why each is load-bearing
 *
 * **1. The filename is a pure function of the entry id.** The id is the anchored
 * path; the filename is that path with `/` → `__`, plus `.json`. So:
 *
 *   - two cards anchoring DIFFERENT files write different filenames and merge
 *     clean — the property this shard exists for;
 *   - two cards anchoring the SAME file write the SAME filename and git reports
 *     an add/add conflict — which is correct and must stay true. A layout in
 *     which two edits to one entry *don't* conflict is a layout that silently
 *     loses one of them, i.e. the defect being fixed, wearing a new shape.
 *
 * {@link assembleAnchors} enforces the correspondence rather than assuming it,
 * so a hand-renamed file cannot quietly opt an entry out of that second half.
 *
 * **2. Order is DERIVED, never declared.** Entries are concatenated sorted by
 * id. There is deliberately no index file listing the shards: an index is itself
 * a single append-only file every card must edit, which reintroduces the exact
 * conflict being removed (PM decision on #6957, carried from the escalation).
 * The directory listing is the index, and it costs nothing to merge.
 *
 * Order is not contractual for this registry in any case — `check-adr-anchors`
 * iterates the entries to accumulate errors and never compares positions — so
 * sorting is for the reader's benefit and for deterministic output, not for
 * correctness.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/** The shard directory, repo-relative. */
export const ANCHORS_DIR = 'scripts/adr-anchors';

/**
 * Non-entry files the shard directory is allowed to carry. Kept explicit for the
 * same reason `NON_RECORD_FILES` is in `check-adr-anchors.mjs`: the directory IS
 * the registry, so anything in it that is not an entry should have to say so
 * once, here, instead of being skipped by a pattern that also skips typos.
 */
const NON_ENTRY_FILES = new Set(['README.md']);

/**
 * The shard filename for an anchored path — the whole naming rule, in one place.
 *
 * `packages/objectql/src/engine.ts` → `packages__objectql__src__engine.ts.json`
 *
 * The extension is kept (`engine.ts` and a hypothetical `engine.tsx` must not
 * collapse into one shard) and the path separator is doubled so the mapping is
 * unambiguous for a reader scanning the directory.
 *
 * @param {string} file  the anchored path, repo-relative and `/`-separated
 * @returns {string}
 */
export function shardNameFor(file) {
  return `${file.replaceAll('/', '__')}.json`;
}

/**
 * Assemble the registry from a shard listing — pure, so `--self-test` can drive
 * every red path below with synthetic shards instead of an imitation of them.
 *
 * @param {string[]} names  directory listing of {@link ANCHORS_DIR}
 * @param {(name: string) => string} read  shard name → its text
 * @returns {{ anchors: object[], errors: string[] }} entries sorted by id
 */
export function assembleAnchors(names, read) {
  const errors = [];
  const anchors = [];

  for (const name of [...names].sort()) {
    if (NON_ENTRY_FILES.has(name)) continue;
    if (!name.endsWith('.json')) {
      errors.push(
        `${ANCHORS_DIR}/${name}: not an anchor entry. Entries are one JSON file per anchored path, named ` +
          `\`<path with / replaced by __>.json\`. If this file is documentation, it needs to be named in ` +
          'NON_ENTRY_FILES in scripts/adr-anchors.mjs — the directory is the registry, so a non-entry says so once.',
      );
      continue;
    }

    let entry;
    try {
      entry = JSON.parse(read(name));
    } catch (e) {
      errors.push(`${ANCHORS_DIR}/${name}: cannot parse — ${e.message}`);
      continue;
    }
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
      errors.push(`${ANCHORS_DIR}/${name}: must be a JSON object with "file", "adrs" and "invariant".`);
      continue;
    }
    if (typeof entry.file !== 'string' || entry.file === '') {
      errors.push(`${ANCHORS_DIR}/${name}: has no "file" — the anchored path is the entry's id.`);
      continue;
    }
    // The correspondence is what makes two cards anchoring the SAME file collide
    // (add/add on one name) while two cards anchoring different files do not.
    // Unenforced, a rename re-opens the losing half of that.
    const expected = shardNameFor(entry.file);
    if (name !== expected) {
      errors.push(
        `${ANCHORS_DIR}/${name}: filename does not match its "file" (${entry.file}) — expected ` +
          `${ANCHORS_DIR}/${expected}.\n` +
          '      The name is derived from the id on purpose: it is what makes two cards anchoring the same ' +
          'file collide in git instead of landing as two entries, and two cards anchoring different files ' +
          'never share a file at all (#6957).',
      );
      continue;
    }
    anchors.push(entry);
  }

  // Sorted by id. Duplicates cannot occur — the name is a function of the id and
  // a directory cannot hold two files with one name — which is why nothing here
  // checks for them.
  anchors.sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : 0));
  return { anchors, errors };
}

/**
 * {@link assembleAnchors} against the real directory.
 *
 * @param {string} root  repo root
 * @returns {{ anchors: object[], errors: string[] }}
 */
export function loadAnchors(root) {
  const dir = join(root, ANCHORS_DIR);
  let names;
  try {
    names = readdirSync(dir);
  } catch (e) {
    return { anchors: [], errors: [`check-adr-anchors: cannot read ${ANCHORS_DIR}/ — ${e.message}`] };
  }
  return assembleAnchors(names, (name) => readFileSync(join(dir, name), 'utf8'));
}
