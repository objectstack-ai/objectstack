#!/usr/bin/env node
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// check-adr-anchors — keep an accepted ADR's decision readable from the code it
// governs.
//
// ## The failure this exists for
//
// framework#3723. Three accepted ADRs said the same thing — ADR-0057 D4 ("feed
// the names to better-auth ONLY so invitations are accepted, never as the
// authority for RBAC"), ADR-0090 D3's word ban ("distribution = position"), and
// ADR-0095 D3 ("no enforcement-time code path may consult the better-auth role
// directly"). A patch-level changeset reversed all three by making app-declared
// names storable in `sys_member.role`; a follow-up then made the derivation
// automatic in every host. Nobody noticed for a day, and the issue tracking it
// was closed, reopened and rewritten three times while the cause moved.
//
// The mechanism of that failure is worth naming precisely, because it is not
// "someone was careless": **the file being edited never mentioned the ADRs that
// governed it.** `auth-manager.ts` cited ADR-0105 D8 (why `delegated_admin` is
// registered) and said nothing about why the app-role loop next to it was a
// violation. An author — human or agent — reading that file could not have
// known. ADRs are only binding if the code they bind points back at them.
//
// ## What this checks
//
// For each entry in `scripts/adr-anchors.json`: the file exists, every ADR id
// listed for it names a real record under `docs/adr/`, and every one of those
// ids still appears somewhere in the file. That is all — a presence check,
// deliberately dumb:
//
//   - It cannot be satisfied usefully by a drive-by edit that guts the logic,
//     because the failure text carries the INVARIANT, not just an id to paste
//     back.
//   - It costs nothing to keep green while the invariant holds, and it fails
//     the moment someone rewrites a governed block and drops the rationale with
//     it — which is exactly the diff that needs a second look.
//
// It does NOT verify the code still obeys the ADR; no static check can. It
// guarantees the next author is TOLD which decision they are standing on. The
// enforcement of each invariant lives in its own tests (see the ADR).
//
// ## Adding an entry
//
// Add one when an accepted ADR's decision is realized in code that would look
// arbitrary — or plausibly wrong, or improvable — to someone reading the file
// alone. That is the tell: if a reasonable engineer could "fix" it and be
// reverting a decision, anchor it. Do not anchor everything; a map of
// everything is a map of nothing, and each entry must earn its failure mode.
//
//   node scripts/check-adr-anchors.mjs

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const MAP_PATH = 'scripts/adr-anchors.json';
const ADR_DIR = 'docs/adr';

/** An ADR id as written in code comments: `ADR-0090`. */
const ADR_ID = /^ADR-(\d{4})$/;

let anchors;
try {
  ({ anchors } = JSON.parse(readFileSync(join(ROOT, MAP_PATH), 'utf8')));
} catch (e) {
  console.error(`check-adr-anchors: cannot read ${MAP_PATH} — ${e.message}`);
  process.exit(1);
}
if (!Array.isArray(anchors)) {
  console.error(`check-adr-anchors: ${MAP_PATH} must carry an "anchors" array.`);
  process.exit(1);
}

/** Decision records that actually exist, by number: `0090` → `0090-permission-model-...md`. */
const records = new Set();
try {
  for (const f of readdirSync(join(ROOT, ADR_DIR))) {
    const m = /^(\d{4})-/.exec(f);
    if (m) records.add(m[1]);
  }
} catch {
  console.error(`check-adr-anchors: no ${ADR_DIR}/ directory — run from the repo root.`);
  process.exit(1);
}

const errors = [];
let checked = 0;

for (const entry of anchors) {
  const { file, adrs, invariant } = entry ?? {};

  if (typeof file !== 'string' || !Array.isArray(adrs) || adrs.length === 0) {
    errors.push(`${MAP_PATH}: every anchor needs a "file" and a non-empty "adrs" array (got ${JSON.stringify(entry)}).`);
    continue;
  }
  if (typeof invariant !== 'string' || invariant.trim() === '') {
    // The invariant IS the value of this check — an entry without one degrades
    // the failure into "put this string back", which teaches nothing.
    errors.push(`${MAP_PATH}: anchor for ${file} has no "invariant" — state what the ADR decided, in a sentence or two.`);
    continue;
  }

  const abs = join(ROOT, file);
  if (!existsSync(abs)) {
    errors.push(
      `${file}: anchored file is missing. If it moved, update ${MAP_PATH}; if the code is gone, say so in ` +
        `the ADR — a decision whose implementation vanished is one to revisit, not to drop silently.`,
    );
    continue;
  }

  const body = readFileSync(abs, 'utf8');
  for (const adr of adrs) {
    const m = ADR_ID.exec(adr);
    if (!m) {
      errors.push(`${MAP_PATH}: "${adr}" is not an ADR id (expected e.g. ADR-0090).`);
      continue;
    }
    // Anchoring a withdrawn or never-written record sends the next author to a
    // dead end (cf. ADR-0107, withdrawn before it landed).
    if (!records.has(m[1])) {
      errors.push(`${MAP_PATH}: ${adr} has no record under ${ADR_DIR}/ — anchor a decision that exists.`);
      continue;
    }
    if (!body.includes(adr)) {
      errors.push(
        `${file}: no longer references ${adr}.\n` +
          `      ${invariant}\n` +
          `      If the code still obeys it, restore the reference where the decision shows up.\n` +
          `      If you are deliberately changing it, that needs a superseding ADR under ${ADR_DIR}/ — ` +
          `not a comment edit — and then an update to ${MAP_PATH}.`,
      );
    }
  }
  checked++;
}

if (errors.length) {
  console.error(`check-adr-anchors: ${errors.length} problem(s)\n`);
  for (const e of errors) console.error('  • ' + e);
  console.error(
    '\n  Why this check exists: an accepted ADR was reversed by a patch-level changeset (#3723) because\n' +
      '  the code it governed never named it. Anchors keep the decision reachable from the diff.\n',
  );
  process.exit(1);
}
console.log(`check-adr-anchors: OK (${checked} anchored file(s), every governing ADR still referenced).`);
