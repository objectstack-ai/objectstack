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
// For each entry in `scripts/adr-anchors/`: the file exists, every ADR id
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
// ## The second thing it checks: an ADR number names ONE decision (#5992)
//
// Everything above rests on a premise nothing verified: that `ADR-0057` in a
// code comment identifies a decision. It did not. Three numbers under
// `docs/adr/` were each claimed by two unrelated records — 0010, 0019, 0057 —
// so PD #13's "grep the ADRs for the surface you are touching" lands an author
// on two documents with nothing to choose between them, and the cost is worst
// exactly where the pairs are furthest apart: `ADR-0057` is either the ERP
// authorization core (security) or system-data retention (reclamation), and
// four entries in `adr-anchors/` ride that number today.
//
// Maintainer ruling 2026-08-07 on #5992, in order: **C first, B to finish, A
// rejected.** C is this gate — stop the bleeding, so a FOURTH collision cannot
// be introduced. B (slug-qualified references for the three existing pairs) is
// separate work, amortised as those files are touched. A (renumbering the later
// record of each pair) was rejected outright: 296+ bare references would have
// to migrate, and it would establish that an accepted ADR's number can move.
// So the three existing pairs sit on `KNOWN_NUMBER_COLLISIONS` below — an
// explicit, shrink-only allowlist. Do not add a fourth entry to make a red
// build green; take the next free number instead.
//
// **Versions of one decision are not a collision.** `0006-project-environment-
// split{,.v2,.v4}.md` is one decision revised twice, and the rule that
// separates it from a real collision is structural rather than a name on a list:
// a version repeats the SAME `NNNN-slug` stem and adds `.vN`, while a collision
// is two different stems under one number. That is why the audit groups by stem
// and not by number alone.
//
// Deliberately NOT part of the rule: the records' `**Status**` lines. They are
// free prose (`Proposed`, `Draft (2026-05-24)`, `Accepted in part`, `Superseded
// by v4`), and the navigation damage a shared number does is the same whatever
// they say — a grep does not read status either.
//
// ## The third thing it checks: a cited ADR number RESOLVES to a record (#6634)
//
// The two checks above only ever look at ids listed in `adr-anchors/` — 30-odd
// ids, hand-registered. Every other `ADR-NNNN` written in a comment, a doc or a
// changeset was unchecked, and the gap is not theoretical: `ADR-0079` was cited
// by **77 files** in this repo, 14 times inside `packages/spec` alone, while
// `docs/adr/0079-*` had never existed here at all. Nothing was wrong with what
// those 77 files SAID — the display-name contract they describe is the one the
// code implements — but a reader following PD #13's "grep the ADRs for the
// surface you are touching" reached nothing, and the number was silently
// squatted: a future unrelated ADR-0079 would have retroactively falsified all
// 77 citations at once. It survived the repo growing to 120 distinct cited
// numbers because no check ever asked the question.
//
// So: every `ADR-NNNN` in a tracked file must name a record under `docs/adr/`.
// Two things are deliberately NOT failures, for opposite reasons:
//
//   - **Another repo's registry, named as such.** `ObjectUI ADR-0001` is
//     objectui's first decision, not ours, and `docs/adr/` is not its home. This
//     is handled STRUCTURALLY (a repo qualifier immediately before the id), like
//     the `.vN` version rule above and unlike an allowlist — an author who cites
//     a sibling repo has a spelling that is both correct to a reader and clean
//     to the gate. Bare `ADR-0001`, meaning ours, still fails.
//   - **A record that was withdrawn or deleted, cited as history.** ADR-0001's
//     record was deleted in the 2026-02-11 permission-protocol rewrite and is
//     cited as history by ADR-0002. Those numbers sit on
//     `UNRESOLVED_ADR_CITATIONS` below — an explicit, shrink-only allowlist,
//     audited in both directions like the collision list.
//
//     It is the WEAKER of the two remedies, and the list says so: preferred is
//     to give the number a record, even when the record is a tombstone. ADR-0107
//     left this list that way (#6676) — withdrawn nine hours after it landed
//     (#3735), it now has `docs/adr/0107-withdrawn-*.md` saying so, which both
//     resolves the historical citations and makes re-use collide loudly under
//     the number-uniqueness audit instead of merely going stale here.
//
// ## The fourth thing it checks: a tombstone is NOT anchorable (#7329)
//
// The tombstone remedy above buys the citation audit exactly what it wanted —
// `ADR-0107` in a changeset now resolves — and it did so by putting a FILE under
// `docs/adr/`. But `records` is assembled from filenames alone, so the same file
// also satisfied the anchor loop's `records.has(...)` guard, which was never meant
// to accept it: an entry in `adr-anchors/` could anchor live code to a number whose
// record says, in its own words, that "nothing in it is in force". Measured on
// `main` @ `69fde55` — a shard citing `ADR-0107` made this gate print OK and exit 0.
//
// The two audits want opposite answers about the same file, so one set is not
// enough. A tombstone number is now in `records` (citations resolve — wanted) AND
// in `nonDecisions` (anchors are refused — the gap this closes). Nothing about a
// live record's treatment changes.
//
// **The marker is the filename**, `NNNN-withdrawn-<slug>.md`, for the reason the
// `.vN` rule and the cross-repo qualifier are also spellings rather than lists: a
// structural signal is available to every future record without editing this file,
// and it is legible to a human reading `ls docs/adr/`. Two alternatives were
// weighed and rejected:
//
//   - **A `status:` field in YAML front-matter.** Self-describing, and the more
//     obvious design — but ZERO of the 119 records carry front-matter today, so it
//     is a new repo-wide convention introduced for one file; the records' status
//     lines are deliberately free prose and deliberately outside this gate's rules
//     (see the collision section above); and #6741 routes ANY diff touching
//     `docs/adr/**` to the maintainer's own merge, so marking the tombstone would
//     couple a script-only fix to a governance approval. It also fails open in
//     exactly the way the filename does — a future tombstone can forget either one.
//   - **An explicit `NON_DECISION_RECORDS` list here.** Cannot misfire, but it is
//     the one option that needs this file edited for every future tombstone, which
//     is the property the other two are chosen for.
//
// A number counts as a non-decision only when EVERY stem claiming it is a
// tombstone. A tombstone sharing its number with a live record is a collision, and
// the audit above already reports that, loudly and about the right fact.
//
// ## Where the registry lives (#6957)
//
// `scripts/adr-anchors/` — **one JSON file per anchor**, named after the path it
// anchors (`packages/objectql/src/engine.ts` →
// `packages__objectql__src__engine.ts.json`), assembled in id order by
// `scripts/adr-anchors.mjs`. It was a single `scripts/adr-anchors.json` until
// that file turned out to have the same append-only-ledger conflict profile as
// this repo's other hot files, on a registry where a mis-resolved merge drops an
// anchor **silently** — the entry stops being checked and nothing goes red. The
// full reasoning, the measurement and the maintainer's ruling are in
// `scripts/adr-anchors.mjs`'s header; read that before changing the layout.
//
// ## Adding an entry
//
// Add one when an accepted ADR's decision is realized in code that would look
// arbitrary — or plausibly wrong, or improvable — to someone reading the file
// alone. That is the tell: if a reasonable engineer could "fix" it and be
// reverting a decision, anchor it. Do not anchor everything; a map of
// everything is a map of nothing, and each entry must earn its failure mode.
//
// Mechanically: write ONE new file under `scripts/adr-anchors/`, named for the
// path it anchors, carrying `file`, `adrs` and `invariant`. Touch nothing else —
// there is no index to register it in, deliberately (an index would be the
// single append-only file this layout exists to remove).
//
//   node scripts/check-adr-anchors.mjs
//   node scripts/check-adr-anchors.mjs --self-test   # verify the checker itself

import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

import { ANCHORS_DIR, assembleAnchors, loadAnchors, shardNameFor } from './adr-anchors.mjs';

const ROOT = process.cwd();
/** Where the registry lives. One shard per anchor — see `scripts/adr-anchors.mjs`. */
const MAP_PATH = ANCHORS_DIR;
const ADR_DIR = 'docs/adr';
const SELF_PATH = 'scripts/check-adr-anchors.mjs';

/** An ADR id as written in code comments: `ADR-0090`. */
const ADR_ID = /^ADR-(\d{4})$/;

/**
 * A decision-record filename.
 *
 *   `0057-system-data-lifecycle-and-retention.md` → number 0057, stem
 *     `0057-system-data-lifecycle-and-retention`, no version
 *   `0006-project-environment-split.v4.md`        → number 0006, stem
 *     `0006-project-environment-split`, version 4
 *
 * The stem is the decision's identity; `.vN` is a revision OF that stem. Two
 * stems under one number is the collision this file audits.
 */
const ADR_FILENAME = /^(\d{4})-([a-z0-9]+(?:-[a-z0-9]+)*)(?:\.v(\d+))?\.md$/;

/**
 * Markdown under `docs/adr/` that is deliberately not a decision record.
 * Kept explicit rather than pattern-matched: the directory IS the decision
 * registry, so a file that is not a record should have to say so once, here,
 * instead of slipping past the number audit because its name did not parse.
 */
const NON_RECORD_FILES = new Set(['PRIORITIZATION.md']);

/**
 * The slug prefix that marks a record as a TOMBSTONE — a file whose whole content
 * is "this number is withdrawn, do not reuse" (`0107-withdrawn-hook-body-write-
 * set-static-gap.md`, the first one, #6676).
 *
 * A tombstone is a record for the purpose of RESOLVING citations, which is the
 * job it exists to do, and is NOT a record for the purpose of ANCHORING code:
 * an anchor's `invariant` has to state what the ADR decided, and this number
 * decided nothing. See the "#7329" section of the header for why the marker is
 * the filename and not a status field or a list.
 *
 * It is a prefix of the SLUG, not a substring of the name, so a live decision
 * *about* withdrawing something (`0123-withdrawn-plugin-cleanup-policy.md` would
 * be the collision to worry about) has a spelling that stays clear of it: name
 * the decision for what it decides.
 */
const TOMBSTONE_SLUG_PREFIX = 'withdrawn-';

/**
 * An ADR citation as written in prose or a code comment, with the word before it
 * (if any) captured so a SIBLING REPO's registry can be recognised.
 *
 *   `ADR-0090`                → { qualifier: '',         number: '0090' }
 *   `(ObjectUI ADR-0001)`     → { qualifier: 'ObjectUI', number: '0001' }
 *   `see ADR-0090`            → { qualifier: 'see',      number: '0090' }
 *
 * Only qualifiers in {@link CROSS_REPO_QUALIFIERS} exempt a citation; every other
 * preceding word (`see`, `cf.`, `per`) is noise and the id must still resolve.
 */
const ADR_CITATION = /(?:([A-Za-z0-9_./-]+)[ \t]+)?ADR-(\d{4})/g;

/**
 * Words that, immediately before an id, say "this number belongs to ANOTHER
 * repository's decision registry". The two siblings this repo is developed
 * alongside (see AGENTS.md); matched case-insensitively, and `objectstack-ai/x`
 * counts as `x`.
 *
 * This is a structural escape hatch, not an allowlist: it is available to every
 * future citation, it keeps the sentence honest for a human reader, and it
 * cannot hide a BARE id that was meant to be ours.
 */
const CROSS_REPO_QUALIFIERS = new Set(['objectui', 'object-ui', 'cloud']);

/**
 * ⛔ SHRINK-ONLY. ADR numbers that are cited in this repo but have no record
 * under `docs/adr/`, and legitimately so: the record was **withdrawn** or
 * **deleted**, and the citations are history discussing that fact.
 *
 * **Adding an entry is not the fix for a red build.** If this gate just told you
 * that the id you wrote resolves to nothing, the id is wrong or the record is
 * missing — write the record, or cite the number that exists. Widening this list
 * re-opens #6634 (77 files citing a decision no reader could reach) for every
 * future reader of that number rather than for you once.
 *
 * Removing an entry is always welcome and the gate enforces it in BOTH
 * directions: an entry whose number gains a record, or that nothing cites any
 * more, fails as stale — so a number cannot be quietly re-used under cover of
 * its own grandfather clause, which is the squatting half of #6634.
 */
const UNRESOLVED_ADR_CITATIONS = [
  {
    number: '0001',
    // Deleted 2026-02-11 (9da8e3e72) together with 0002-database-driven-metadata-
    // storage.md and docs/adr/README.md, in the permission-protocol rewrite.
    // Cited as history by `docs/adr/0002-...md` ("already discarded in v3.4's
    // ADR-0001"), which is what keeps this entry earning its place.
    // ARCHITECTURE.md used to carry a markdown LINK to the deleted path — a
    // genuinely broken pointer rather than history, filed separately from #6634
    // and fixed in #6733: that section now names the deleted path as plain text
    // and states the current single-provider architecture (MetadataPlugin is the
    // sole `metadata` provider; ObjectQL consumes it) instead of pointing at a
    // 404. This entry never blessed that link and does not bless any future one.
    why: 'record deleted 2026-02-11 (9da8e3e72); cited as history by ADR-0002',
  },
  // 0107 was the second entry until #6676. It is gone from this list because the
  // number gained a record — `docs/adr/0107-withdrawn-hook-body-write-set-static-
  // gap.md`, a tombstone. That is the (a) remedy the dangling-citation message
  // recommends over this list, and it is strictly stronger here: an allowlist
  // entry survives only as long as something still cites the number (the
  // direction-B staleness rule below), and 0107's citations are a changeset
  // awaiting release plus an audit, so the grandfather clause would have expired
  // on its own and quietly re-freed the number. A record does not expire, and a
  // re-use now collides in `auditAdrDirectory` — loud, and about the right fact.
  // The one thing the tombstone bought that this list never could — resolving the
  // citations — is also the one thing it must NOT buy for anchors, which is why
  // `nonDecisions` exists (#7329).
];

/**
 * ⛔ SHRINK-ONLY. The number collisions that already existed when this audit
 * was written (#5992). Every entry is a navigation tax being paid daily, kept
 * only because the maintainer ruled renumbering an accepted record out.
 *
 * **Adding an entry is not the fix for a red build.** If this gate just told you
 * your new record collides, the fix is the next free number — it names the one
 * to use. Widening this list re-opens the exact defect the gate closes, and does
 * it for every future reader of that number rather than for you once.
 *
 * Removing an entry is always welcome and the gate enforces it: an entry that
 * no longer matches `docs/adr/` fails as stale, so a resolved collision cannot
 * silently return under cover of its own grandfather clause.
 */
const KNOWN_NUMBER_COLLISIONS = [
  {
    number: '0010',
    decisions: ['0010-metadata-protection-model', '0010-nl-to-flow-authoring'],
    // Metadata Protection Model (L1/L2/L3 lock states, package provenance) vs
    // Natural-Language → Flow Authoring. Ten other records link the first by
    // path, four link the second; nothing but the path tells them apart.
    why: 'metadata protection (L1/L2/L3 lock states) vs natural-language → flow authoring',
  },
  {
    number: '0019',
    decisions: ['0019-app-as-consumer-unit', '0019-approval-as-flow-node'],
    // App as the consumer-installable unit vs collapsing approval into the flow
    // engine as a durable-pause node. The second is Accepted and fully
    // implemented, so a bare `ADR-0019` in code most likely means it — "most
    // likely" being precisely the problem.
    why: 'app as the consumer-facing unit vs approval-as-a-flow-node',
  },
  {
    number: '0057',
    decisions: [
      '0057-erp-authorization-core-business-units-and-scope-depth',
      '0057-system-data-lifecycle-and-retention',
    ],
    // The worst pair, and the one #5992 was filed over: security vs
    // reclamation, no shared vocabulary, and four `ADR-0057` entries in
    // scripts/adr-anchors/ plus hundreds of bare references in packages/**.
    why: 'ERP authorization core (security) vs system-data lifecycle/retention (reclamation)',
  },
];

/**
 * The registry, assembled from its shards in id order.
 *
 * Layout errors are RETURNED rather than fatal, so they join the run's other
 * findings instead of pre-empting them — and so `--self-test`, which runs below
 * this line, no longer depends on the live registry parsing.
 */
const { anchors, errors: registryErrors } = loadAnchors(ROOT);

/**
 * Inventory `docs/adr/` and audit the premise every anchor rests on: one
 * number, one decision.
 *
 * Pure over a filename list — `--self-test` drives it with synthetic
 * directories, so the red paths below are exercised by the REAL function
 * rather than by an imitation of it.
 *
 * @param {string[]} filenames
 * @param {{ number: string, decisions: string[], why: string }[]} allowlist
 * @returns {{ records: Set<string>, nonDecisions: Set<string>, errors: string[] }}
 *   `records` is the set of numbers that name a real record, as the citation audit
 *   needs it; `nonDecisions` is the subset of those whose every claimant is a
 *   tombstone, as the anchor loop needs it (#7329).
 */
function auditAdrDirectory(filenames, allowlist) {
  const errors = [];
  const records = new Set();
  /** number → set of decision stems claiming it. */
  const stemsByNumber = new Map();
  /** number → set of those stems that are tombstones. */
  const tombstoneStemsByNumber = new Map();

  for (const name of [...filenames].sort()) {
    if (!name.endsWith('.md') || NON_RECORD_FILES.has(name)) continue;
    const m = ADR_FILENAME.exec(name);
    if (!m) {
      errors.push(
        `${ADR_DIR}/${name}: filename does not parse as a decision record. Expected \`NNNN-kebab-slug.md\`, ` +
          'or `NNNN-kebab-slug.vN.md` for a later version of the SAME decision.\n' +
          '      The number-uniqueness audit reads the number off the FILENAME, so a record it cannot parse is ' +
          'a record it cannot protect — and `ADR-NNNN` in a code comment would resolve to "no record under ' +
          `${ADR_DIR}/".\n` +
          `      If this is a companion doc rather than a decision, add it to NON_RECORD_FILES in ${SELF_PATH}.`,
      );
      continue;
    }
    const [, number, slug] = m;
    records.add(number);
    const stem = `${number}-${slug}`;
    if (!stemsByNumber.has(number)) stemsByNumber.set(number, new Set());
    stemsByNumber.get(number).add(stem);
    if (slug.startsWith(TOMBSTONE_SLUG_PREFIX)) {
      if (!tombstoneStemsByNumber.has(number)) tombstoneStemsByNumber.set(number, new Set());
      tombstoneStemsByNumber.get(number).add(stem);
    }
  }

  // A number is a non-decision only if EVERY stem claiming it is a tombstone. A
  // tombstone sharing a number with a live record is a collision, reported as one
  // below — and until it is resolved, the live record keeps its anchors.
  const nonDecisions = new Set();
  for (const [number, tombstones] of tombstoneStemsByNumber) {
    if (tombstones.size === stemsByNumber.get(number).size) nonDecisions.add(number);
  }

  /** number → the sorted stems sharing it, for numbers claimed more than once. */
  const collisions = new Map();
  for (const [number, stems] of stemsByNumber) {
    if (stems.size > 1) collisions.set(number, [...stems].sort());
  }
  const allowed = new Map(allowlist.map((e) => [e.number, { ...e, decisions: [...e.decisions].sort() }]));

  const nextFree = String(Math.max(0, ...[...records].map(Number)) + 1).padStart(4, '0');
  const sameSet = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);

  // One error per NUMBER, not one per side: a third record joining an
  // allowlisted pair is a single fact and reads as one.
  for (const number of [...new Set([...collisions.keys(), ...allowed.keys()])].sort()) {
    const found = collisions.get(number);
    const known = allowed.get(number);
    if (found && known && sameSet(found, known.decisions)) continue;

    if (found && !known) {
      errors.push(
        `${ADR_DIR}/: ADR number ${number} is claimed by ${found.length} unrelated decisions —\n` +
          found.map((s) => `        ${s}.md`).join('\n') +
          '\n      An ADR number must name exactly ONE decision. AGENTS.md Prime Directive #13 tells the next ' +
          'author to grep the ADRs for the id they found in the code; a shared number hands them two records ' +
          'and no way to choose, which is how an accepted decision gets reversed by someone who read the ' +
          'other one (#3723, the incident this whole file exists for).\n' +
          `      Fix: give the NEW record the next free number — ${nextFree} — and update any reference you ` +
          'already wrote. Renumbering an ALREADY-ACCEPTED record was ruled out (#5992: 296+ bare references ' +
          "would migrate, and an accepted decision's number must not move), so before it is referenced is the " +
          'only cheap moment.\n' +
          '      Successive versions of ONE decision are not a collision and do not belong here — they repeat ' +
          'the same stem and add `.vN` (see 0006-project-environment-split{,.v2,.v4}.md).',
      );
    } else if (known && !found) {
      errors.push(
        `${SELF_PATH}: the KNOWN_NUMBER_COLLISIONS entry for ${number} is stale — nothing under ${ADR_DIR}/ ` +
          `collides on that number any more (it listed ${known.decisions.join(', ')}).\n` +
          '      Delete the entry. The allowlist is shrink-only: a resolved collision that keeps its ' +
          'grandfather clause can silently come back.',
      );
    } else {
      errors.push(
        `${ADR_DIR}/: ADR number ${number} is allowlisted (#5992) for ${known.decisions.length} records, but ` +
          `${found.length} claim it now —\n` +
          `        allowlisted: ${known.decisions.join(', ')}\n` +
          `        found:       ${found.join(', ')}\n` +
          `      The allowlist grandfathers exactly the pair that existed; it does not licence the number. ` +
          `Give the new record the next free number — ${nextFree} — or, if a record was renamed, update the ` +
          `entry in ${SELF_PATH} to the stems that remain.`,
      );
    }
  }

  return { records, nonDecisions, errors };
}

/**
 * Decide whether an anchor entry may cite `adr` — the whole ADR-id judgement of
 * the anchor loop, extracted so its red paths are exercised by `--self-test`
 * rather than only by a real registry someone would have to break on purpose.
 *
 * @param {string} adr  the id as written in the shard, e.g. `ADR-0090`
 * @param {Set<string>} records  numbers that name a real record
 * @param {Set<string>} nonDecisions  the subset that are tombstones
 * @returns {string|null} why it may not, or null if it may
 */
function anchorIdProblem(adr, records, nonDecisions) {
  const m = ADR_ID.exec(adr);
  if (!m) return `"${adr}" is not an ADR id (expected e.g. ADR-0090).`;
  // Anchoring a never-written or deleted record sends the next author to a
  // dead end (cf. ADR-0001, whose record was deleted in the 2026-02-11
  // permission-protocol rewrite and never restored).
  if (!records.has(m[1])) return `${adr} has no record under ${ADR_DIR}/ — anchor a decision that exists.`;
  if (nonDecisions.has(m[1])) {
    return (
      `${adr} names a WITHDRAWN record, not a decision — nothing may be anchored to it (#7329).\n` +
      `      ${ADR_DIR}/${m[1]}-${TOMBSTONE_SLUG_PREFIX}*.md is a tombstone: it exists so the number RESOLVES for ` +
      'the citations that discuss its withdrawal, and so the number can never be handed to an unrelated ' +
      'decision. Nothing in it is in force, so no code can be governed by it and no "invariant" can be ' +
      'written for it truthfully.\n' +
      '      If the code really is governed by a decision, that decision has a live record — anchor that one. ' +
      'If the decision was never written down, write it under the next free number; reviving this one would ' +
      'retroactively re-point every historical citation of it (#6634).'
    );
  }
  return null;
}

/**
 * Parse every ADR citation out of one file's text.
 *
 * Pure over a string so the self-test can drive it with fixtures instead of
 * planting files in the tree.
 *
 * @param {string} file  path, used only in the returned rows
 * @param {string} text
 * @returns {{ file: string, number: string, qualifier: string }[]}
 */
function citationsIn(file, text) {
  const out = [];
  for (const m of text.matchAll(ADR_CITATION)) {
    const raw = (m[1] ?? '').toLowerCase();
    // `objectstack-ai/cloud` qualifies as `cloud`; trailing punctuation dropped.
    const qualifier = raw.replace(/^.*\//, '').replace(/[^a-z0-9-]+$/, '');
    out.push({ file, number: m[2], qualifier });
  }
  return out;
}

/**
 * Audit that every cited ADR number names a record — the #6634 check.
 *
 * Pure over the citation rows and the record set, for the same reason
 * {@link auditAdrDirectory} is pure over a filename list: the red paths below
 * are exercised by the REAL function in `--self-test`, not by an imitation.
 *
 * @param {{ file: string, number: string, qualifier: string }[]} citations
 * @param {Set<string>} records  numbers that name a real record
 * @param {{ number: string, why: string }[]} allowlist
 * @returns {string[]} errors
 */
function auditCitedNumbers(citations, records, allowlist) {
  const errors = [];
  const allowed = new Map(allowlist.map((e) => [e.number, e]));
  /** number → sorted files citing it, for numbers that resolve to nothing. */
  const danglingFiles = new Map();

  for (const { file, number, qualifier } of citations) {
    if (CROSS_REPO_QUALIFIERS.has(qualifier)) continue; // another repo's registry
    if (records.has(number)) continue;
    if (!danglingFiles.has(number)) danglingFiles.set(number, new Set());
    danglingFiles.get(number).add(file);
  }

  const nextFree = String(Math.max(0, ...[...records].map(Number)) + 1).padStart(4, '0');

  for (const number of [...danglingFiles.keys()].sort()) {
    if (allowed.has(number)) continue;
    const files = [...danglingFiles.get(number)].sort();
    const shown = files.slice(0, 8);
    errors.push(
      `ADR-${number} is cited by ${files.length} file(s) but names no record under ${ADR_DIR}/ —\n` +
        shown.map((f) => `        ${f}`).join('\n') +
        (files.length > shown.length ? `\n        … and ${files.length - shown.length} more` : '') +
        '\n      A citation is a promise that the decision is readable at the other end. PD #13 tells the ' +
        'next author to grep the ADRs for the id they found in the code; an id that resolves to nothing ' +
        'costs them the search and teaches them the citation was decoration.\n' +
        '      It is also a squat: whoever later writes a real ADR-' +
        `${number} retroactively falsifies all ${files.length} of those citation(s) at once (#6634, where ` +
        'one number had accumulated 77 of them).\n' +
        `      Fix, in order of preference: (a) write the record — if the decision is real, ${ADR_DIR}/${number}-` +
        `<kebab-slug>.md; (b) cite the number that exists; (c) if it is a SIBLING repo's decision, say so — ` +
        `\`ObjectUI ADR-${number}\` / \`cloud ADR-${number}\` is recognised and skipped. A brand-new record ` +
        `takes the next free number — ${nextFree} — not this one.`,
    );
  }

  for (const { number, why } of allowlist) {
    if (records.has(number)) {
      errors.push(
        `${SELF_PATH}: the UNRESOLVED_ADR_CITATIONS entry for ${number} is stale — ${ADR_DIR}/ now HAS a ` +
          `record for that number (the entry said: ${why}).\n` +
          '      Delete the entry, and check the existing citations still mean what the new record says: a ' +
          'number that gained a record after being cited as a dead one is exactly the squat #6634 was about.',
      );
    } else if (!danglingFiles.has(number)) {
      errors.push(
        `${SELF_PATH}: the UNRESOLVED_ADR_CITATIONS entry for ${number} is stale — nothing cites ADR-${number} ` +
          `any more (the entry said: ${why}).\n` +
          '      Delete the entry. The allowlist is shrink-only: a grandfather clause outliving its citations ' +
          'silently re-licences the number.',
      );
    }
  }

  return errors;
}

/**
 * Every ADR citation in the repo's TRACKED text files.
 *
 * `git grep` rather than a directory walk: it is the tool that already knows
 * what is tracked, what is ignored (`node_modules/`, `dist/`) and what is
 * binary, and getting any of those three wrong is how a repo-wide scan becomes
 * either slow or wrong. Collection is deliberately the only impure part — the
 * judgement lives in {@link auditCitedNumbers}, which is pure and self-tested.
 *
 * @returns {{ file: string, number: string, qualifier: string }[]}
 */
function collectCitations() {
  let out;
  try {
    // -I text files only · -o just the matches · -h no filename... except we
    // need it, so: --no-color -n gives `file:line:match`, one per match.
    // `--untracked` so a NEW file citing a nonexistent record goes red before it
    // is committed, not after CI has it. Ignored paths (`node_modules/`, `dist/`)
    // stay excluded either way.
    out = execFileSync('git', ['grep', '--untracked', '-IonE', '([A-Za-z0-9_./-]+[ \t]+)?ADR-[0-9]{4}'], {
      cwd: ROOT,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    });
  } catch (e) {
    // git grep exits 1 with no output when nothing matches — a repo with zero
    // ADR citations is odd but not an error.
    if (e && e.status === 1 && !e.stdout) return [];
    console.error(
      `check-adr-anchors: cannot scan for ADR citations — ${e && e.message ? e.message : e}\n` +
        '  This check reads the tracked tree via `git grep`, so it must run inside the repo checkout.',
    );
    process.exit(1);
  }

  const citations = [];
  for (const row of out.split('\n')) {
    if (!row) continue;
    // `path:lineno:matchtext` — the path may itself contain ':' on no platform
    // we support, but the first two fields are known-shaped, so split from the
    // left exactly twice.
    const first = row.indexOf(':');
    const second = row.indexOf(':', first + 1);
    if (first < 0 || second < 0) continue;
    citations.push(...citationsIn(row.slice(0, first), row.slice(second + 1)));
  }
  return citations;
}

/** Anchor ids whose number names two decisions — reported, never failed. */
function ambiguousAnchorRefs(anchorList, allowlist) {
  const ambiguous = new Set(allowlist.map((e) => e.number));
  const hits = [];
  for (const entry of anchorList ?? []) {
    for (const adr of entry?.adrs ?? []) {
      const m = ADR_ID.exec(adr);
      if (m && ambiguous.has(m[1])) hits.push(`${entry.file} → ${adr}`);
    }
  }
  return hits;
}

if (process.argv.includes('--self-test')) selfTest();

let adrFiles;
try {
  adrFiles = readdirSync(join(ROOT, ADR_DIR));
} catch {
  console.error(`check-adr-anchors: no ${ADR_DIR}/ directory — run from the repo root.`);
  process.exit(1);
}

/** Decision records that actually exist, by number: `0090` → `0090-permission-model-...md`. */
const { records, nonDecisions, errors: numberErrors } = auditAdrDirectory(adrFiles, KNOWN_NUMBER_COLLISIONS);

const errors = [...registryErrors, ...numberErrors];
let checked = 0;

// #6634 — every `ADR-NNNN` written anywhere in the tracked tree resolves to a
// record, not just the ~30 ids registered in adr-anchors/.
const citations = collectCitations();
errors.push(...auditCitedNumbers(citations, records, UNRESOLVED_ADR_CITATIONS));

for (const entry of anchors) {
  const { file, adrs, invariant } = entry;
  // The shard that carries this entry — its name is a pure function of the id,
  // so every message below can point at the exact file to edit.
  const shard = `${MAP_PATH}/${shardNameFor(file)}`;

  if (!Array.isArray(adrs) || adrs.length === 0) {
    errors.push(`${shard}: every anchor needs a non-empty "adrs" array (got ${JSON.stringify(entry.adrs)}).`);
    continue;
  }
  if (typeof invariant !== 'string' || invariant.trim() === '') {
    // The invariant IS the value of this check — an entry without one degrades
    // the failure into "put this string back", which teaches nothing.
    errors.push(`${shard}: anchor for ${file} has no "invariant" — state what the ADR decided, in a sentence or two.`);
    continue;
  }

  const abs = join(ROOT, file);
  if (!existsSync(abs)) {
    errors.push(
      `${file}: anchored file is missing. If it moved, rename ${shard} to match its new path and update the ` +
        `"file" inside it; if the code is gone, say so in the ADR — a decision whose implementation vanished ` +
        'is one to revisit, not to drop silently.',
    );
    continue;
  }

  const body = readFileSync(abs, 'utf8');
  for (const adr of adrs) {
    // Resolution — the id parses, names a record, and that record is a DECISION
    // rather than a tombstone (#7329). All three live in `anchorIdProblem` so
    // `--self-test` drives the real judgement.
    const problem = anchorIdProblem(adr, records, nonDecisions);
    if (problem) {
      errors.push(`${shard}: ${problem}`);
      continue;
    }
    if (!body.includes(adr)) {
      errors.push(
        `${file}: no longer references ${adr}.\n` +
          `      ${invariant}\n` +
          `      If the code still obeys it, restore the reference where the decision shows up.\n` +
          `      If you are deliberately changing it, that needs a superseding ADR under ${ADR_DIR}/ — ` +
          `not a comment edit — and then an update to ${shard}.`,
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
console.log(
  `check-adr-anchors: OK (${checked} anchored file(s), every governing ADR still referenced; ` +
    `${records.size} decision number(s), each naming one decision or an allowlisted pair; ` +
    `${citations.length} citation(s) across ${new Set(citations.map((c) => c.file)).size} file(s) resolve).`,
);

// Reported, never failed. These anchors are correct — the number they name is
// the ambiguous thing, and #5992's route B (slug-qualified references) is the
// separate change that fixes it. Printing them keeps the size of that debt
// visible instead of leaving it to be rediscovered.
const ambiguous = ambiguousAnchorRefs(anchors, KNOWN_NUMBER_COLLISIONS);
if (ambiguous.length) {
  console.log(
    `check-adr-anchors: note — ${ambiguous.length} anchor reference(s) name an ADR number that two records ` +
      'share (#5992, allowlisted):',
  );
  for (const hit of ambiguous) console.log(`  · ${hit}`);
}

/**
 * Verify the number audit itself — both directions, over the real function.
 *
 * A gate whose red path was never exercised is not a gate, and this one's red
 * path is rare by construction: a fourth collision has to be introduced before
 * anyone sees it fail. So the failures are provoked here instead, on synthetic
 * directories, plus one ablation against the live tree (drop the allowlist and
 * the three real collisions must surface).
 *
 * Every assertion is NAMED and the whole body is guarded: a self-test that dies
 * with a stack trace at the moment a reader needs to know which invariant broke
 * has failed at its one job.
 */
function selfTest() {
  const failures = [];
  let checked = 0;
  /** @param {string} name @param {boolean} cond @param {string} detail */
  const assert = (name, cond, detail) => {
    checked++;
    if (!cond) failures.push(`${name} — ${detail}`);
  };
  const audit = (files, allowlist = []) => auditAdrDirectory(files, allowlist);
  const joined = (errs) => errs.join('\n');

  const BASE = ['0001-alpha.md', '0002-beta.md', 'PRIORITIZATION.md'];
  const PAIR = [{ number: '0002', decisions: ['0002-beta', '0002-gamma'], why: 'synthetic' }];

  try {
    {
      const { errors: e, records } = audit(BASE);
      assert('clean-directory-is-green', e.length === 0, `expected no errors, got:\n${joined(e)}`);
      assert(
        'records-carries-every-number',
        records.has('0001') && records.has('0002') && records.size === 2,
        `expected {0001,0002}, got {${[...records].join(',')}}`,
      );
      assert(
        'companion-doc-is-not-audited',
        !joined(e).includes('PRIORITIZATION'),
        'PRIORITIZATION.md must be skipped as a non-record, not reported as unparseable',
      );
    }

    {
      // The 0006 case, derived from structure rather than named: same stem, `.vN`.
      const { errors: e } = audit([...BASE, '0002-beta.v2.md', '0002-beta.v4.md']);
      assert('versions-of-one-decision-are-not-a-collision', e.length === 0, `expected no errors, got:\n${joined(e)}`);
    }

    {
      // The whole point: a FOURTH collision, unlisted.
      const { errors: e } = audit([...BASE, '0002-gamma.md']);
      assert('new-collision-is-red', e.length === 1, `expected exactly 1 error, got ${e.length}:\n${joined(e)}`);
      const msg = joined(e);
      assert('collision-message-names-the-number', msg.includes('0002'), `message lacks the number:\n${msg}`);
      assert(
        'collision-message-names-both-records',
        msg.includes('0002-beta.md') && msg.includes('0002-gamma.md'),
        `message must list the colliding files:\n${msg}`,
      );
      assert(
        'collision-message-names-the-next-free-number',
        msg.includes('0003'),
        `message must offer the next free number so the fix is mechanical:\n${msg}`,
      );
      assert(
        'collision-message-does-not-invite-allowlisting',
        !/add .*KNOWN_NUMBER_COLLISIONS/i.test(msg),
        `the remedy must be "take the next number", never "widen the allowlist":\n${msg}`,
      );
    }

    {
      const { errors: e } = audit([...BASE, '0002-gamma.md'], PAIR);
      assert('allowlisted-collision-is-green', e.length === 0, `expected no errors, got:\n${joined(e)}`);
    }

    {
      // A `.vN` on a DIFFERENT stem is still a different decision.
      const { errors: e } = audit([...BASE, '0002-gamma.v2.md']);
      assert(
        'version-suffix-cannot-launder-a-collision',
        e.length === 1 && joined(e).includes('0002-gamma'),
        `expected the collision to be reported, got:\n${joined(e)}`,
      );
    }

    {
      const { errors: e } = audit([...BASE, '0002-gamma.md', '0002-delta.md'], PAIR);
      assert(
        'third-record-on-an-allowlisted-number-is-red',
        e.length === 1 && joined(e).includes('0002-delta'),
        `an allowlisted PAIR must not licence a third claimant, got:\n${joined(e)}`,
      );
    }

    {
      const { errors: e } = audit(BASE, PAIR);
      assert(
        'stale-allowlist-entry-is-red',
        e.length === 1 && /stale/.test(joined(e)),
        `a grandfather clause outliving its collision must fail, got:\n${joined(e)}`,
      );
    }

    {
      const { errors: e } = audit([...BASE, '0003_underscore.md']);
      assert(
        'unparseable-record-filename-is-red',
        e.length === 1 && joined(e).includes('0003_underscore.md'),
        `a filename the audit cannot parse is a record it cannot protect, got:\n${joined(e)}`,
      );
    }

    // ── A tombstone resolves citations but is not anchorable (#7329) ─────────
    //
    // The two halves pull in OPPOSITE directions over the SAME file, which is
    // exactly why one `records` set was not enough — so both are pinned, and a
    // test of only the red half would pass on an implementation that broke the
    // citation resolution the tombstone exists for.
    {
      const TOMB = [...BASE, '0003-withdrawn-something.md'];
      const { errors: e, records, nonDecisions } = audit(TOMB);
      assert('tombstone-directory-is-green', e.length === 0, `a tombstone is a legal record, got:\n${joined(e)}`);
      assert(
        'tombstone-number-still-resolves-citations',
        records.has('0003'),
        `a tombstone must stay in \`records\` — resolving citations is the job it exists for; got {${[...records].join(',')}}`,
      );
      assert(
        'tombstone-number-is-a-non-decision',
        nonDecisions.has('0003'),
        `got {${[...nonDecisions].join(',')}}`,
      );
      assert(
        'live-records-are-not-non-decisions',
        !nonDecisions.has('0001') && !nonDecisions.has('0002') && nonDecisions.size === 1,
        `only the tombstone may be flagged, got {${[...nonDecisions].join(',')}}`,
      );
    }

    {
      // A revised tombstone is still a tombstone: `.vN` repeats the stem.
      const { nonDecisions } = audit([...BASE, '0003-withdrawn-something.md', '0003-withdrawn-something.v2.md']);
      assert('versioned-tombstone-is-still-a-non-decision', nonDecisions.has('0003'), 'the `.vN` rule must carry the marker');
    }

    {
      // The marker is a SLUG PREFIX, not a substring: a live decision whose slug
      // merely contains the word keeps its anchors.
      const { nonDecisions } = audit([...BASE, '0003-policy-for-withdrawn-plugins.md']);
      assert(
        'marker-is-a-prefix-not-a-substring',
        !nonDecisions.has('0003'),
        'a live decision that merely mentions withdrawal must not be disarmed',
      );
    }

    {
      // A tombstone sharing its number with a live record is a COLLISION, and the
      // live record must keep its anchors rather than being silently disarmed by
      // its squatter — the number audit is the check that speaks to this.
      const { errors: e, nonDecisions } = audit([...BASE, '0002-withdrawn-something.md']);
      assert(
        'tombstone-colliding-with-a-live-record-is-red',
        e.length === 1 && joined(e).includes('0002-withdrawn-something'),
        `expected the collision to be reported, got:\n${joined(e)}`,
      );
      assert(
        'a-contested-number-is-not-a-non-decision',
        !nonDecisions.has('0002'),
        'only a number whose EVERY claimant is a tombstone may be disarmed',
      );
    }

    {
      // The anchor loop's own judgement, over the real function.
      const id = (n) => 'ADR-' + n;
      const RECS = new Set(['0090', '0107']);
      const TOMBS = new Set(['0107']);

      assert(
        'anchor-to-a-live-record-is-allowed',
        anchorIdProblem(id('0090'), RECS, TOMBS) === null,
        `got: ${anchorIdProblem(id('0090'), RECS, TOMBS)}`,
      );
      assert(
        'anchor-to-a-missing-record-is-refused',
        /has no record under/.test(anchorIdProblem(id('0202'), RECS, TOMBS) ?? ''),
        `got: ${anchorIdProblem(id('0202'), RECS, TOMBS)}`,
      );
      assert(
        'anchor-to-a-malformed-id-is-refused',
        /is not an ADR id/.test(anchorIdProblem('ADR-90', RECS, TOMBS) ?? ''),
        `got: ${anchorIdProblem('ADR-90', RECS, TOMBS)}`,
      );

      // The point of the whole change: this returned null before #7329.
      const tomb = anchorIdProblem(id('0107'), RECS, TOMBS) ?? '';
      assert('anchor-to-a-tombstone-is-refused', tomb !== '', 'a tombstone must not satisfy the anchor guard');
      assert('tombstone-message-names-the-id', tomb.includes('0107'), `message lacks the id:\n${tomb}`);
      assert(
        'tombstone-message-says-what-to-do-instead',
        /next free number/.test(tomb) && /anchor that one/.test(tomb),
        `the author must be told to anchor the live decision or write a new record, not just that this is wrong:\n${tomb}`,
      );
      assert(
        'tombstone-message-is-distinct-from-the-missing-record-one',
        !/has no record under/.test(tomb),
        `"the record is missing" and "the record decided nothing" are different facts and must read differently:\n${tomb}`,
      );
    }

    // ── Cited numbers resolve (#6634) ────────────────────────────────────────
    //
    // ⚠️ Fixture ids are BUILT, never written literally: this file is itself in
    // the tracked tree the real scan reads, so a literal `ADR-` + four digits in
    // a fixture would be collected as a genuine citation and fail the gate it is
    // testing. `id('0202')` keeps the token out of the source.
    {
      const id = (n) => 'ADR-' + n;
      const RECORDS = new Set(['0090', '0107']);
      const rows = (text, file = 'src/x.ts') => citationsIn(file, text);
      const cited = auditCitedNumbers;

      {
        const e = cited(rows(`see ${id('0090')} for why`), RECORDS, []);
        assert('citation-to-a-real-record-is-green', e.length === 0, `expected no errors, got:\n${joined(e)}`);
      }

      {
        const parsed = rows(`(ObjectUI ${id('0202')}) and bare ${id('0203')}`);
        assert(
          'citation-parser-reads-the-qualifier',
          parsed.length === 2 && parsed[0].qualifier === 'objectui' && parsed[1].qualifier === 'bare',
          `expected [objectui, bare], got ${JSON.stringify(parsed)}`,
        );
        assert(
          'citation-parser-reads-the-number',
          parsed[0].number === '0202' && parsed[1].number === '0203',
          `expected [0202, 0203], got ${JSON.stringify(parsed)}`,
        );
      }

      {
        // The whole point: an id nobody can follow.
        const e = cited(rows(`governed by ${id('0202')}`, 'packages/spec/src/a.ts'), RECORDS, []);
        assert('dangling-citation-is-red', e.length === 1, `expected exactly 1 error, got ${e.length}:\n${joined(e)}`);
        const msg = joined(e);
        assert('dangling-message-names-the-number', msg.includes('0202'), `message lacks the number:\n${msg}`);
        assert(
          'dangling-message-names-the-citing-file',
          msg.includes('packages/spec/src/a.ts'),
          `message must point at the file to edit:\n${msg}`,
        );
        assert(
          'dangling-message-names-the-next-free-number',
          msg.includes('0108'),
          `message must offer the next free number for a NEW record:\n${msg}`,
        );
        assert(
          'dangling-message-offers-the-cross-repo-spelling',
          /ObjectUI ADR-|cloud ADR-/.test(msg),
          `an author citing a sibling repo must be told the recognised spelling:\n${msg}`,
        );
        assert(
          'dangling-message-does-not-invite-allowlisting',
          !/add .*UNRESOLVED_ADR_CITATIONS/i.test(msg),
          `the remedy must be "write the record / cite a real one", never "widen the allowlist":\n${msg}`,
        );
      }

      {
        const e = cited(rows(`(ObjectUI ${id('0202')})`), RECORDS, []);
        assert('cross-repo-qualified-citation-is-skipped', e.length === 0, `expected no errors, got:\n${joined(e)}`);
      }

      {
        const e = cited(rows(`objectstack-ai/cloud ${id('0202')}`), RECORDS, []);
        assert('org-qualified-sibling-repo-is-skipped', e.length === 0, `expected no errors, got:\n${joined(e)}`);
      }

      {
        // A noise word is not a repo. This is the hole the structural rule
        // would have if it exempted "any preceding word".
        const e = cited(rows(`see ${id('0202')}`), RECORDS, []);
        assert(
          'noise-word-does-not-exempt-a-bare-id',
          e.length === 1,
          `only a sibling-repo qualifier may exempt an id, got ${e.length}:\n${joined(e)}`,
        );
      }

      {
        const e = cited(rows(`withdrawn ${id('0202')}`), RECORDS, [{ number: '0202', why: 'synthetic' }]);
        assert('allowlisted-dangling-citation-is-green', e.length === 0, `expected no errors, got:\n${joined(e)}`);
      }

      {
        // Stale, direction A — the number gained a record. This is the squat
        // half of #6634: old citations now point at a decision they never meant.
        const e = cited(rows(`see ${id('0107')}`), RECORDS, [{ number: '0107', why: 'synthetic' }]);
        assert(
          'allowlist-entry-whose-number-gained-a-record-is-red',
          e.length === 1 && /stale/.test(joined(e)) && joined(e).includes('now HAS a record'),
          `an allowlisted dead number that came back must fail, got:\n${joined(e)}`,
        );
      }

      {
        // Stale, direction B — nothing cites it any more.
        const e = cited(rows(`see ${id('0090')}`), RECORDS, [{ number: '0202', why: 'synthetic' }]);
        assert(
          'allowlist-entry-nothing-cites-is-red',
          e.length === 1 && /stale/.test(joined(e)),
          `a grandfather clause outliving its citations must fail, got:\n${joined(e)}`,
        );
      }
    }

    // ── Live tree: green as shipped, red under ablation ──────────────────────
    let liveFiles = null;
    try {
      liveFiles = readdirSync(join(ROOT, ADR_DIR));
    } catch (e) {
      assert('live-tree-is-readable', false, `cannot read ${ADR_DIR}/ (run from the repo root) — ${e.message}`);
    }
    if (liveFiles) {
      const { errors: green } = audit(liveFiles, KNOWN_NUMBER_COLLISIONS);
      assert('live-tree-is-green-today', green.length === 0, `${ADR_DIR}/ must pass as shipped, got:\n${joined(green)}`);

      // Ablation, predicted RED: drop the allowlist and the three real
      // collisions must each surface. If this ever goes green, the allowlist is
      // no longer what keeps the build green and the entries are dead weight.
      const { errors: red } = audit(liveFiles, []);
      const numbers = KNOWN_NUMBER_COLLISIONS.map((c) => c.number);
      assert(
        'ablation-without-allowlist-is-red',
        red.length === numbers.length,
        `expected ${numbers.length} collision(s) with the allowlist removed, got ${red.length}:\n${joined(red)}`,
      );
      for (const n of numbers) {
        assert(
          `ablation-reports-${n}`,
          red.some((e) => e.includes(`number ${n} is claimed`)),
          `ADR number ${n} is allowlisted but does not collide under ablation — the entry is stale`,
        );
      }

      // ── Tombstones on the real tree (#7329) ───────────────────────────────
      //
      // The live half of the synthetic assertions above: ADR-0107 is the corpus's
      // only tombstone today, and the shipped registry must be clean under the
      // new rule — a green build here is what says the rule costs nothing to keep.
      {
        const { records: liveRecs, nonDecisions: liveTombs } = audit(liveFiles, KNOWN_NUMBER_COLLISIONS);
        assert(
          'live-tombstone-is-flagged',
          liveTombs.has('0107'),
          `docs/adr/0107-withdrawn-*.md is the corpus's tombstone; got {${[...liveTombs].join(',')}}`,
        );
        assert(
          'live-tombstone-still-resolves-citations',
          liveRecs.has('0107'),
          'flagging the tombstone must not un-resolve the citations it was written to resolve',
        );
        const anchored = (anchors ?? []).flatMap((entry) => (entry?.adrs ?? []).map((adr) => `${entry.file} → ${adr}`));
        const disarmed = anchored.filter((hit) => anchorIdProblem(hit.split(' → ')[1], liveRecs, liveTombs) !== null);
        assert(
          'live-registry-anchors-only-decisions',
          disarmed.length === 0,
          `no shipped anchor may name a tombstone, got:\n        ${disarmed.join('\n        ')}`,
        );

        // Ablation, predicted RED: an anchor to the tombstone must be refused. This
        // is the exact probe run on `main` @ `69fde55`, where it came back GREEN.
        assert(
          'ablation-anchoring-the-live-tombstone-is-red',
          anchorIdProblem('ADR-' + '0107', liveRecs, liveTombs) !== null,
          'the #7329 gap is open again — a shard citing the tombstone would pass',
        );
      }

      // ── The citation scan, over the real tree (#6634) ─────────────────────
      const liveRecords = audit(liveFiles, KNOWN_NUMBER_COLLISIONS).records;
      const liveCitations = collectCitations();

      // A scan that reads nothing is a phantom gate, and it would fail SILENTLY
      // — every citation resolving vacuously. Pin that it really walked the tree
      // before trusting anything it says.
      assert(
        'live-citation-scan-reads-the-tree',
        liveCitations.length > 100 && new Set(liveCitations.map((c) => c.file)).size > 50,
        `expected the scan to find citations across the repo, got ${liveCitations.length} in ` +
          `${new Set(liveCitations.map((c) => c.file)).size} file(s) — the collector is not reading the tree`,
      );

      const citeGreen = auditCitedNumbers(liveCitations, liveRecords, UNRESOLVED_ADR_CITATIONS);
      assert(
        'live-citations-are-green-today',
        citeGreen.length === 0,
        `every cited ADR number must resolve as shipped, got:\n${joined(citeGreen)}`,
      );

      // Ablation, predicted RED: drop the citation allowlist and each entry's
      // number must surface. Green here means the entries are dead weight.
      const citeRed = auditCitedNumbers(liveCitations, liveRecords, []);
      const citeNumbers = UNRESOLVED_ADR_CITATIONS.map((c) => c.number);
      assert(
        'citation-ablation-without-allowlist-is-red',
        citeRed.length === citeNumbers.length,
        `expected ${citeNumbers.length} dangling number(s) with the allowlist removed, got ${citeRed.length}:\n` +
          joined(citeRed),
      );
      for (const n of citeNumbers) {
        assert(
          `citation-ablation-reports-${n}`,
          citeRed.some((e) => e.includes('ADR-' + n + ' is cited')),
          `ADR-${n} is allowlisted as unresolved but resolves under ablation — the entry is stale`,
        );
      }
    }

    // ---- the sharded registry's assembly (#6957) -----------------------------
    //
    // Two of these are the properties the split was adopted for, and they pull in
    // OPPOSITE directions — so testing only the happy one would leave a layout
    // that merges everything cleanly, including the two edits that must not.
    {
      const shard = (file) => [shardNameFor(file), JSON.stringify({ file, adrs: ['ADR-0001'], invariant: 'x' })];
      const from = (pairs) => {
        const m = new Map(pairs);
        return assembleAnchors([...m.keys()], (n) => m.get(n));
      };

      {
        const { anchors: a, errors: e } = from([shard('b/two.ts'), shard('a/one.ts')]);
        assert('shards-assemble-clean', e.length === 0, `expected no errors, got:\n${joined(e)}`);
        assert(
          'shards-assemble-in-id-order',
          JSON.stringify(a.map((x) => x.file)) === JSON.stringify(['a/one.ts', 'b/two.ts']),
          `order is derived from the id, never declared — got ${JSON.stringify(a.map((x) => x.file))}`,
        );
      }

      {
        // The name IS the id. A shard whose filename disagrees with its `file`
        // is the hole that would let two entries for one path coexist under two
        // names — i.e. the silent-drop this layout removes, re-entering by the
        // back door.
        const [, body] = shard('a/one.ts');
        const { anchors: a, errors: e } = from([['renamed.json', body]]);
        assert(
          'shard-name-must-match-its-id',
          e.length === 1 && e[0].includes('filename does not match'),
          `expected exactly one filename-mismatch error, got:\n${joined(e)}`,
        );
        assert('shard-name-mismatch-drops-the-entry', a.length === 0, `expected the entry to be rejected, got ${a.length}`);
      }

      assert(
        'shard-name-is-a-pure-function-of-the-id',
        shardNameFor('packages/objectql/src/engine.ts') === 'packages__objectql__src__engine.ts.json',
        `got ${shardNameFor('packages/objectql/src/engine.ts')}`,
      );
      assert(
        'shard-name-keeps-the-extension',
        shardNameFor('a/x.ts') !== shardNameFor('a/x.tsx'),
        'two source files differing only in extension must not collapse into one shard',
      );

      {
        const { errors: e } = from([['packages__a__b.ts.json', '{ not json']]);
        assert(
          'unparseable-shard-is-red',
          e.length === 1 && e[0].includes('cannot parse'),
          `expected a parse error, got:\n${joined(e)}`,
        );
      }
      {
        const { errors: e } = from([['stray.txt', 'whatever']]);
        assert(
          'non-json-in-the-registry-is-red',
          e.length === 1 && e[0].includes('not an anchor entry'),
          `a stray file must not be silently skipped — a skipped typo is a dropped anchor. Got:\n${joined(e)}`,
        );
      }
      {
        const { errors: e } = from([['README.md', '# docs']]);
        assert('readme-is-not-an-entry', e.length === 0, `README.md is allowed alongside the entries, got:\n${joined(e)}`);
      }
      {
        const { errors: e } = from([['a__b.ts.json', JSON.stringify({ adrs: ['ADR-0001'], invariant: 'x' })]]);
        assert(
          'shard-without-an-id-is-red',
          e.length === 1 && e[0].includes('has no "file"'),
          `expected a missing-id error, got:\n${joined(e)}`,
        );
      }

      {
        // The live registry, through the real loader: it must assemble with zero
        // layout errors and land in id order. This is the one impure assertion
        // here, and it is the one that would catch a hand-renamed shard on main.
        const { anchors: live, errors: e } = loadAnchors(ROOT);
        assert('live-registry-assembles-clean', e.length === 0, `expected no layout errors, got:\n${joined(e)}`);
        const ids = live.map((x) => x.file);
        assert(
          'live-registry-is-in-id-order',
          JSON.stringify(ids) === JSON.stringify([...ids].sort()),
          'the loader must emit id order regardless of readdir order',
        );
        assert('live-registry-is-not-empty', live.length > 0, 'an empty registry would make every check below vacuous');
      }
    }
  } catch (e) {
    // Never let the harness itself be the message.
    failures.push(`self-test threw before finishing — ${e && e.stack ? e.stack : e}`);
  }

  if (failures.length) {
    console.error(`✗ check-adr-anchors --self-test — ${failures.length} failure(s) of ${checked} assertion(s)\n`);
    for (const f of failures) console.error('  • ' + f + '\n');
    process.exit(1);
  }
  console.log(
    `✓ check-adr-anchors --self-test: ${checked} assertions over the real auditAdrDirectory() / ` +
      'auditCitedNumbers() / assembleAnchors() paths.',
  );
  process.exit(0);
}
