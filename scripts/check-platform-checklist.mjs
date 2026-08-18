#!/usr/bin/env node
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// check-platform-checklist — keep the standing platform test checklist
// (docs/qa/platform-checklist/) machine-readable, append-only and honest.
//
// ## The failure this exists for
//
// Release verification used to live in one-off surfaces: a hand-written table
// per release (docs/plans/release-15.1-test-plan.md) and a checkbox issue per
// release (#3358). Both worked once and then rotted: items could not be reused
// across releases, results were checkboxes with no revision to pin them to, and
// every fixture gap the run discovered (#3408 phone persona never seeded, #3409
// per-group sign-off never launched, #3415 four of five projects silently
// rejected by seed validation) had to be rediscovered from prose. The standing
// checklist replaces those one-offs with a durable ledger; this gate keeps the
// ledger's invariants from decaying the same way.
//
// ## What this checks (deliberately dumb, presence-level — house ledger style)
//
//   - every docs/qa/platform-checklist/areas/*.json parses and its `area`
//     matches its filename;
//   - every item carries the required fields with sane enum values;
//   - ids are `<area>.<slug>`, globally unique, and — append-only discipline —
//     never removed: ids retired from service stay in the file with
//     `status: "retired"` (this check cannot see deletions; the README makes
//     removal a review-time offence, and `supersededBy` targets must resolve);
//   - `revision` matches the last `history` entry, so a semantic edit that
//     forgets to bump the revision (silently re-validating old run results)
//     fails here;
//   - active items have at least one acceptance clause, and every clause names
//     its oracle — a clause with no oracle is an invitation to tick on vibes,
//     which is the exact AI-accuracy failure the RUNNER.md protocol exists to
//     prevent.
//
// It does NOT judge whether an item is testable or its oracle sufficient — no
// static check can. It guarantees the *structure* a run can be trusted against.
//
// Usage: node scripts/check-platform-checklist.mjs   (pnpm check:platform-checklist)

import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { maskComments } from './js-comment-mask.mjs';
import { join, basename } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const AREAS_DIR = join(ROOT, 'docs/qa/platform-checklist/areas');

const STATUSES = new Set(['active', 'draft', 'retired']);
const PRIORITIES = new Set(['P0', 'P1', 'P2']);
const SURFACES = new Set(['browser', 'api', 'cli', 'build', 'mixed']);
const ORACLES = new Set(['api', 'network', 'screenshot', 'dom', 'log', 'test', 'build']);
const BLOCKED_BY = new Set(['fixture', 'environment', 'dependency', 'product-bug']);

const errors = [];
const err = (file, id, msg) => errors.push(`${file}${id ? ` · ${id}` : ''}: ${msg}`);

if (!existsSync(AREAS_DIR)) {
  console.error(`check-platform-checklist: missing ${AREAS_DIR}`);
  process.exit(1);
}

const files = readdirSync(AREAS_DIR).filter((f) => f.endsWith('.json')).sort();
if (files.length === 0) {
  console.error('check-platform-checklist: no area files found — the ledger cannot be empty.');
  process.exit(1);
}

const allIds = new Map(); // id -> file
const allItems = [];

for (const file of files) {
  let doc;
  try {
    doc = JSON.parse(readFileSync(join(AREAS_DIR, file), 'utf8'));
  } catch (e) {
    err(file, null, `does not parse as JSON: ${e.message}`);
    continue;
  }
  const stem = basename(file, '.json');
  if (doc.area !== stem) err(file, null, `"area" is ${JSON.stringify(doc.area)} but the filename says "${stem}"`);
  if (typeof doc.title !== 'string' || !doc.title) err(file, null, 'missing "title"');
  if (!Array.isArray(doc.items) || doc.items.length === 0) {
    err(file, null, '"items" must be a non-empty array');
    continue;
  }

  for (const item of doc.items) {
    const id = typeof item.id === 'string' ? item.id : '<no id>';
    const where = (msg) => err(file, id, msg);

    if (!/^[a-z0-9-]+\.[a-z0-9-]+$/.test(id)) where('id must be "<area>.<slug>" in kebab-case');
    else if (!id.startsWith(`${doc.area}.`)) where(`id must be prefixed with its own area ("${doc.area}.")`);
    if (allIds.has(id)) where(`duplicate id — already defined in ${allIds.get(id)}; ids are immutable and never reused`);
    allIds.set(id, file);
    allItems.push({ file, item });

    if (typeof item.title !== 'string' || !item.title) where('missing "title"');
    if (!STATUSES.has(item.status)) where(`"status" must be one of ${[...STATUSES].join('|')}`);
    if (!PRIORITIES.has(item.priority)) where(`"priority" must be one of ${[...PRIORITIES].join('|')}`);
    if (!SURFACES.has(item.surface)) where(`"surface" must be one of ${[...SURFACES].join('|')}`);
    if (typeof item.since !== 'string' || !/^v\d+(\.\d+)?$/.test(item.since)) {
      where('"since" must be the release that introduced the capability, e.g. "v16" or "v16.0"');
    }

    if (!Number.isInteger(item.revision) || item.revision < 1) where('"revision" must be an integer >= 1');
    if (!Array.isArray(item.history) || item.history.length === 0) {
      where('"history" must be a non-empty array — every item records why it exists');
    } else {
      const last = item.history[item.history.length - 1];
      if (last.revision !== item.revision) {
        where(`"revision" (${item.revision}) must equal the last history entry's revision (${last.revision}) — a semantic edit bumps both`);
      }
      for (const h of item.history) {
        if (!Number.isInteger(h.revision) || typeof h.date !== 'string' || typeof h.change !== 'string') {
          where('each history entry needs { revision, date, change }');
          break;
        }
      }
    }

    if (!Array.isArray(item.steps) || item.steps.length === 0) where('"steps" must be a non-empty array of strings');

    if (item.status === 'retired') {
      if (typeof item.retiredReason !== 'string' || !item.retiredReason) where('retired items must carry "retiredReason"');
    } else {
      if (!Array.isArray(item.acceptance) || item.acceptance.length === 0) {
        where('active/draft items must have at least one acceptance clause');
      } else {
        item.acceptance.forEach((c, i) => {
          if (typeof c.clause !== 'string' || !c.clause) where(`acceptance[${i}] missing "clause"`);
          if (!ORACLES.has(c.oracle)) where(`acceptance[${i}] "oracle" must be one of ${[...ORACLES].join('|')}`);
          if (typeof c.verify !== 'string' || !c.verify) where(`acceptance[${i}] missing "verify" — how the oracle is consulted`);
        });
      }
    }

    if (item.blocked !== undefined) {
      if (!BLOCKED_BY.has(item.blocked?.by)) where(`"blocked.by" must be one of ${[...BLOCKED_BY].join('|')}`);
      if (typeof item.blocked?.ref !== 'string' || !item.blocked.ref) {
        where('"blocked.ref" must name the tracking issue/fixture gap — waive-with-a-reference, never silently');
      }
    }

    if (item.automated !== undefined && item.automated !== null) {
      if (typeof item.automated.ref !== 'string' || !item.automated.ref) where('"automated.ref" must point at the pinning test');
    }

    if (item.enumSource !== undefined) {
      const es = item.enumSource;
      if (typeof es?.file !== 'string' || typeof es?.export !== 'string' || !Number.isInteger(es?.expect)) {
        where('"enumSource" needs { file, export, expect } — the spec enum this item\'s variants matrix was authored against');
      }
    }
  }
}

// ── Variants-freshness ratchet ──────────────────────────────────────────────
// A matrix item's `variants` list is hand-authored against a spec value enum
// (49 field types, 20 chart types, …). When the spec grows or shrinks that
// enum, nothing used to force the matrix to follow — the drift was only caught
// indirectly by the showcase coverage.test.ts demonstrability gate. `enumSource`
// pins the enum here: {file, export, expect}. This check extracts the CURRENT
// member count from the spec source (comment-stripped, deduped — enum blocks
// carry prose comments quoting member names) and fails when it no longer equals
// `expect`. Fixing the failure = revising the item's variants for the new
// member(s), bumping the item revision, and updating `expect` — exactly the
// "platform grew a capability, the checklist must follow" moment this gate
// exists to force. Extractor rot is loud, not fail-open: a missing file or
// export is an error, never a silent skip.
function extractEnumMembers(absFile, exportName) {
  // Masked ONCE, up front, rather than per-segment: comment spans are blanked
  // in place, so every offset below still indexes the real file, and the
  // bracket walk can no longer be closed early by a `]` that lives in a
  // comment. Masking a SLICE would be the same defect one level down -- a
  // fragment starting mid-file has no literal context to scan from.
  const src = maskComments(readFileSync(absFile, 'utf8'));
  const decl = src.match(new RegExp(`(?:export\\s+)?const\\s+${exportName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b[^=]*=`));
  if (!decl) return null;
  const start = src.indexOf('[', decl.index + decl[0].length);
  if (start === -1) return null;
  let depth = 0;
  for (let j = start; j < src.length; j++) {
    if (src[j] === '[') depth++;
    else if (src[j] === ']') {
      depth--;
      if (depth === 0) {
        const seg = src.slice(start, j + 1);
        const seen = new Set();
        for (const m of seg.matchAll(/'([a-zA-Z0-9_\-]+)'/g)) seen.add(m[1]);
        return [...seen];
      }
    }
  }
  return null;
}

for (const { file, item } of allItems) {
  const es = item.enumSource;
  if (!es || typeof es.file !== 'string' || typeof es.export !== 'string') continue;
  const abs = join(ROOT, es.file);
  if (!existsSync(abs)) {
    err(file, item.id, `enumSource.file not found: ${es.file} — the pinned spec source moved; re-point the pin`);
    continue;
  }
  const members = extractEnumMembers(abs, es.export);
  if (members === null) {
    err(file, item.id, `enumSource export "${es.export}" not found in ${es.file} — renamed or reshaped; re-point the pin (extractor must stay loud, never fail-open)`);
    continue;
  }
  if (members.length !== es.expect) {
    err(file, item.id, `VARIANTS STALE — ${es.export} in ${es.file} now has ${members.length} members but this item's variants were authored against ${es.expect}. The platform grew/shrank this surface: revise the variants matrix, bump the item revision, and set enumSource.expect to ${members.length}.`);
  }
}

// Cross-file referential integrity: supersededBy must land on a real id.
for (const { file, item } of allItems) {
  if (item.supersededBy !== undefined && !allIds.has(item.supersededBy)) {
    err(file, item.id, `"supersededBy" points at unknown id "${item.supersededBy}"`);
  }
}

// ── Capability-coverage ratchet ─────────────────────────────────────────────
// "凡是有的能力, 都要测试" made mechanical: the universe of governed metadata
// kinds is derived from packages/spec/liveness/*.json (the ADR-0049 ledger
// set), and coverage.json must map every kind to ≥1 checklist item or waive it
// with a reason. Bidirectional, mirroring the liveness ledger's own
// UNCLASSIFIED/ORPHAN discipline: an unmapped kind fails (the platform grew a
// capability the checklist doesn't test), and a mapped kind with no liveness
// ledger fails (the entry outlived the capability).
const COVERAGE_FILE = join(ROOT, 'docs/qa/platform-checklist/coverage.json');
const LIVENESS_DIR = join(ROOT, 'packages/spec/liveness');
let waivedCount = 0;
let mappedCount = 0;
if (!existsSync(COVERAGE_FILE)) {
  err('coverage.json', null, 'missing — every liveness-governed metadata kind must be mapped or waived');
} else if (!existsSync(LIVENESS_DIR)) {
  err('coverage.json', null, `cannot derive the kind universe: ${LIVENESS_DIR} not found`);
} else {
  let cov;
  try {
    cov = JSON.parse(readFileSync(COVERAGE_FILE, 'utf8'));
  } catch (e) {
    cov = null;
    err('coverage.json', null, `does not parse as JSON: ${e.message}`);
  }
  if (cov) {
    const universe = readdirSync(LIVENESS_DIR)
      .filter((f) => f.endsWith('.json'))
      .map((f) => basename(f, '.json'))
      .sort();
    const map = cov.metadataKinds ?? {};
    for (const kind of universe) {
      const entry = map[kind];
      if (entry === undefined) {
        err('coverage.json', kind, 'UNCLASSIFIED — the platform has this capability (liveness ledger exists) but the checklist neither tests nor waives it. Add items or a waiver with a reason.');
        continue;
      }
      const hasItems = Array.isArray(entry.items) && entry.items.length > 0;
      const hasWaiver = typeof entry.waived === 'string' && entry.waived.trim().length > 0;
      if (hasItems === hasWaiver) {
        err('coverage.json', kind, 'must have EITHER non-empty "items" OR a non-empty "waived" reason — not both, not neither');
        continue;
      }
      if (hasItems) {
        mappedCount++;
        for (const id of entry.items) {
          if (!allIds.has(id)) err('coverage.json', kind, `maps to unknown item id "${id}"`);
          else {
            const mapped = allItems.find((r) => r.item.id === id);
            if (mapped?.item.status === 'retired') {
              err('coverage.json', kind, `maps to retired item "${id}" — point at its successor or re-waive the kind`);
            }
          }
        }
      } else {
        waivedCount++;
      }
    }
    for (const kind of Object.keys(map)) {
      if (!universe.includes(kind)) {
        err('coverage.json', kind, `ORPHAN — mapped kind has no packages/spec/liveness/${kind}.json ledger; remove the entry or restore the ledger`);
      }
    }
  }
}

if (errors.length) {
  console.error(`check-platform-checklist: ${errors.length} problem(s)\n`);
  for (const e of errors) console.error(`  ✗ ${e}`);
  console.error('\nContract: docs/qa/platform-checklist/README.md (authoring) · RUNNER.md (execution).');
  process.exit(1);
}

const total = allItems.length;
const active = allItems.filter(({ item }) => item.status === 'active').length;
console.log(`check-platform-checklist: OK — ${files.length} areas, ${total} items (${active} active); coverage: ${mappedCount} kinds mapped, ${waivedCount} waived.`);
