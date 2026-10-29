#!/usr/bin/env node
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * record-recognisers — the readers of the ONE `## Contract review` record a
 * Tier S pull request lands on, and the copyable record they read.
 *
 *   node scripts/pm/record-recognisers.mjs --template   # the record, copyable; no network
 *   node scripts/pm/record-recognisers.mjs --brief-template   # the reviewer's brief, read-only shape built in; no network
 *   node scripts/pm/record-recognisers.mjs --template --paths PATH-ONE PATH-TWO   # face and `Scope:` read off the PR's paths
 *   node scripts/pm/record-recognisers.mjs --self-test  # offline, no network
 *   node scripts/pm/record-recognisers.mjs --help       # this usage; no network
 *
 * ## What lives here, and why it is its own file
 *
 * Ruling record 5770886272 on #19061 (letter B) made three layers one: the
 * gate label, the `--pair` landing pre-check and the independence pair are
 * retired, and exactly one `## Contract review` record per Tier S pull request
 * stays — the record `check-governed-queue-guard.mjs` reads in the merge group
 * to release `.claude/**`. This file is what reads it, and nothing else:
 *
 *   locateReviewOfRecord     the record on this head, on the PR thread or its card
 *   deliveredCardNumber      which card thread a pull request's record may sit on
 *   readServedTier           the `Served-tier:` line, and `servedTierStands` on it — at the tier its face maps to
 *   reviewFace / REVIEW_FACES which face made the review owed, and the ONE tier NAME it stands at
 *   reviewScopeHits          the at-tier review's scope floor — `reviewFace`'s `hits`, the record's `Scope:` line
 *   recordCarriesDesignJudgment  whether a face's record carries item ④, the full review's design judgment
 *   readLocalRuns            the `Local-runs:` line, and `localRunsStand` on it — judged when present, absent not re-judged
 *   contractReviewHandoff    whose review a PR's contract review is — the newest `Contract-review-handoff:` line against the head; `readContractReviewHandoff` reads the line; `contractReviewClaims` (`readContractReviewClaim`, `contractReviewClaimLapse`) who holds the head; `contractReviewHold` (`readContractReviewHold`) whether a lane holds it — the newest `Contract-review-hold:` line, its age a reading never a lapse
 *   isModelIdentifierToken   the token a refusal must never quote back
 *   REVIEW_OF_RECORD_THREADS the ONE thread set, and REVIEW_OF_RECORD_LOCATION its words
 *   unexplainedPathsBetween  the pure-regeneration test a carried record re-runs, prose arm included
 *   isOutsideReviewSurface   the prose faces a head may move on and keep its record
 *   contractReviewTemplateLines / contractReviewRecordLines   what `--template` prints
 *   contractReviewBriefLines what `--brief-template` prints — the brief a seat hands its reviewer
 *   readMailboxLine / mailboxEvents / MAILBOX_KEYS   the mailbox DOORBELL — the seven first-line keys a `pm:mailbox` comment may open with, read; anything else refused
 *
 * Every definition below was MOVED, names unchanged, out of
 * `check-clause2-carriers.mjs` at the ruling's last step, which deleted the
 * rest of that file — its `--pair` sweep, its C1–C9 rows, its claim readers,
 * its local copy of the retired label and the self-test battery for them. The
 * docblocks moved with the code, and so did the self-test cases that pin these
 * readers. Where a docblock names a retired row (C3, C4, C6, C7) or the
 * `--pair` path, it is saying why a reading has the shape it has; ⛔ it is not
 * saying the row still exists.
 *
 * ## ⚠️ Import it LAZILY, from a function body, and never at module scope
 *
 * This file imports `check-half-states.mjs`, which resolves its governed
 * register at MODULE SCOPE with a top-level await that imports
 * `check-governed-queue-guard.mjs`. So the guard reaching this file with a
 * module-scope import closes a module-evaluation cycle and deadlocks both
 * (node exits 13, "Detected unsettled top-level await"). The guard's
 * `REVIEW_OF_RECORD_LOCATION` and `loadRecordRecognisers` docblocks carry the
 * measurement and the rule: the import is taken lazily, after the guard has
 * finished evaluating. ⛔ Nothing here may add a top-level `await` either.
 *
 * ## Where these readings are tested
 *
 * Twice, from both ends. This file's own `--self-test` (`pnpm
 * check:pm-record-recognisers`, run by `lint.yml`) pins each reader offline and
 * drives the queue guard once with the record `--template` prints, on each
 * thread. The guard's `--self-test`, which the required `Governed Surface Queue
 * Guard` check runs first, loads this file through the real lazy import and
 * drives every state the queue acts on.
 *
 * ⛔ Nothing here reads a board, writes, or hangs a label. Rows, a head and an
 * injected git reader in; a reading out. The verdict on top of it — which tier,
 * which exit — is the guard's.
 */

// The self-test's reads of GOVERNED files, declared so a card editing either
// file derives this family (`dispatch-gates.mjs` `declaredSelfTestReads`; the
// row is `GOVERNED_READ_FLOOR` in `dispatch-gates.data.mjs`). The derivation
// grades it against the read the self-test really performs, so it cannot be
// satisfied by deleting either half.
// dispatch-gates: self-test-reads .claude/skills/pm-dispatch/references/project-forms.md .claude/skills/pm-dispatch/references/contract-review.md -- the mailbox doorbell battery pins each of the seven key templates verbatim in project-forms.md's 〈信箱 PR〉 section, the claim-line battery pins the `Contract-review-claim:` template and its lapse hours in contract-review.md, and the hold-line battery pins the `Contract-review-hold:` template and its listing hours there, so a change to any of those spellings is judged here

import process from 'node:process';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { isEntrypoint } from '../invoked-as.mjs';
import {
  CONTRACT_REVIEW_HEADING_MARKER,
  H51_SHA_MIN_HEX,
  branchNameTarget,
  closingKeywordTargets,
  contractReviewHeadMatch,
  deliveryEvidence,
  deliveryEvidenceNote,
  latestMarkedComment,
  partOfTargets,
  readSignatureLine,
  SEAT_SIGNATURE_SESSION_SOURCE,
  stripSignatureLine,
} from './check-half-states.mjs';
// The tier `isModelIdentifierToken` refuses by VALUE. IMPORTED, never restated:
// `dispatch-gates.mjs` is the one line in `scripts/pm/**` where the model id is
// spelled as a value, and a second value site here is the drift that let a
// declared tier and a served one differ unnoticed (#17915).
// The default tier's VALUE is imported on the same rule, for the same refusal; its NAME is the second
// token a `Served-tier:` line may carry, on the face that maps to it. The published-schema face is the
// clause-② suspect surface (`SUSPECT_TIER_GLOBS`, test files excepted), applied by `deriveTier`, the one
// function that applies it — ⛔ never a second spelling of `packages/spec/src/**` here.
import {
  CONTRACT_REVIEW_TIER,
  CONTRACT_REVIEW_TIER_NAME,
  SUSPECT_TIER_GLOBS,
  TIER_DEFAULT,
  TIER_DEFAULT_NAME,
  deriveTier,
} from './dispatch-gates.mjs';
// The governed-rules face is the governed register itself — the same function the queue guard
// classifies a merge group's paths with. `dispatch-gates.mjs` already imports this module at module
// scope, so the edge adds no new module to this file's graph and no cycle.
import { SELF_REPO_ID, governedPathsIn } from './check-governed-merges.mjs';
// How an unreadable `Served-tier:` line is quoted back — the declaration
// line's own quoting helper, one spelling for both. The narrowing face is read
// with the fleet's ONE reader of that line, imported, ⛔ never a second parser.
import { quoteLine, readClause2Line } from './clause2-line.mjs';


// ── the tier FOLLOWS THE FACE that made the review owed ─────────────────────
//
// Ruling record 6159870311 on #23352 (letter B′ with C, maintainer 「同意」):
// whether an isolated contract review is OWED stays by surface — the three
// contract faces of `references/contract-review.md` — and ⛔ never by lane; the
// TIER of that review follows the face that made it owed. A published schema or
// governed rules text maps to `CONTRACT_REVIEW_TIER`; a review owed ONLY by a
// `Clause-②: yes` declaration (a widening in application or UI code, a
// translation key, a version declaration) maps to `TIER_DEFAULT`, run as the
// lane seat's review of record. Nothing retires: the contract-review tier's
// identity and value are untouched, and `dispatch-gates.data.mjs` stays the
// default tier's value site.
//
// ⛔ EXACT, never a floor. `servedTierStands` accepts the one NAME the face maps
// to and nothing else: this regime orders no tiers (`deriveTier` refuses to
// rank two either), so "at least this tier" is a reading no file here can make.
//
// ⭐ The FOURTH face (ruling record 6203713500 on #23692, letter B, maintainer
// 「B (推荐)」): ruling C (6053791774) stands as a face of its own under B′ — a
// `Clause-②: no` card that NARROWS a published accept set owes one isolated
// review at `CONTRACT_REVIEW_TIER`. The face is keyed on the one spelling
// `Clause-②: no (narrowing)`, written at the start of a line in the PR body and
// the changeset, and it is exact like the other three: a `TIER_DEFAULT` record
// does not stand on it. Records written at `TIER_DEFAULT` on narrowing-only pull
// requests before this face existed are not re-opened (the ruling's item 3).

/**
 * The four contract faces, in the order a mixed diff is decided in, each with
 * the NAME of the tier it maps to.
 *
 *   `id`         the token `--template --face` takes and `reviewFace` answers with
 *   `tierName`   the ONE `Served-tier:` token a review owed on this face stands with
 *   `fullReview` whether a record on this face carries item ④, the design judgment. The project
 *                owner's order, transcribed on #25765 (2026-10-25, scope and cadence refined in
 *                ruling record 6396446237), makes the at-tier review of a published schema, a skill
 *                or an ADR a FULL review: ①②③ plus a judgment of the change against the code it
 *                cites and the scenario it is accepted against. Those three surfaces ARE the schema
 *                face and the rules face already — the governed register names `skills/**`,
 *                `.claude/**` and `docs/adr/**` — so ④ rides those two faces and no face is added.
 *                The maintainer's later ruling (record 6442046166, letter A) hangs ④ on the narrowing
 *                face too: a narrowing of a published accept set in runtime code alone is judged against
 *                the spec on `main` — does it take a declared capability away at the consumer, or make
 *                the spec's own refusal real? Only the declaration face, the lane seat's own review,
 *                carries no ④. `recordCarriesDesignJudgment` reads it.
 *   `words`      how the face is named to a human
 *
 * ⭐ The face is read off the PULL REQUEST'S COMMITTED TREE, and ⛔ never off a
 * seat's statement: its FILE LIST decides the schema and rules faces, the way
 * the queue guard already classifies governed paths; the `Clause-②:` line its
 * committed changeset carries decides the narrowing face, read by
 * `readClause2Line` (`clause2-line.mjs`, the fleet's one reader of that line).
 * The declaration face is what REMAINS: it is asked only of a review already
 * owed, and a review owed with no schema, no governed path and no narrowing
 * declared was owed by the `Clause-②: yes` line alone.
 */
export const REVIEW_FACES = Object.freeze([
  Object.freeze({ id: 'schema', tierName: CONTRACT_REVIEW_TIER_NAME, fullReview: true, words: 'a published schema (the clause-② suspect surface, test files excepted)' }),
  Object.freeze({ id: 'rules', tierName: CONTRACT_REVIEW_TIER_NAME, fullReview: true, words: 'governed rules text (a path the governed register names)' }),
  Object.freeze({ id: 'narrowing', tierName: CONTRACT_REVIEW_TIER_NAME, fullReview: true, words: 'a `Clause-②: no (narrowing)` declaration (a published accept set narrowed; no schema and no governed path in the diff)' }),
  Object.freeze({ id: 'declaration', tierName: TIER_DEFAULT_NAME, fullReview: false, words: 'the `Clause-②: yes` declaration alone (no schema, no governed path and no narrowing declared)' }),
]);

/** Every NAME a `Served-tier:` line can stand with — one per tier the faces map to, and nothing else. */
export const REVIEW_TIER_NAMES = Object.freeze([...new Set(REVIEW_FACES.map((face) => face.tierName))]);

/**
 * Is this path a CHANGESET — the committed carrier of the `Clause-②:` line? A
 * `.changeset/*.md` file other than the directory's own README. Pure.
 */
function isChangesetPath(path) {
  const p = String(path ?? '');
  return /^\.changeset\/[^/]+\.md$/.test(p) && p !== '.changeset/README.md';
}

/**
 * Which face made this review owed, and the NAME of the tier it is therefore
 * served at. Pure over its inputs.
 *
 * ⭐ A mixed diff maps to `CONTRACT_REVIEW_TIER` on ONE hit: a schema or governed
 * path anywhere in the list decides it, the way one governed path governs the
 * whole pull request. `hits` names the paths that decided, so a reader can see
 * why — and, since ruling record 6184805932 on #23578 (letter C), it is also the
 * SCOPE FLOOR of that review: `reviewScopeHits` below. A path-decided reading
 * never consults `declaredOn`: every face after `rules` maps to a tier the paths
 * already decided or to a cheaper one, so the declaration cannot move it.
 *
 * ⭐ Where the paths decide nothing, the DECLARATION decides (ruling record
 * 6203713500, letter B), read out of `declaredOn` — the texts the `Clause-②:`
 * line is written on: each committed changeset's text, and the PR body's where
 * the caller holds it. A `narrowing` arm on ANY of them ⇒ the narrowing face
 * (`yes (narrowing)` included: a diff that widens and narrows owes the narrowing
 * face's review, as a mixed diff owes its one hit's); else a `malformed` line on
 * any ⇒ UNREADABLE, because `readClause2Line` collapses a near-miss arm such as
 * `(narrowed)` into `malformed` exactly so that it cannot read as no narrowing;
 * else the declaration face.
 *
 * ⛔ A caller that hands NO declaration cannot say which of the two it is on, and
 * gets the reading the committed tree still allows. A tree with a changeset in
 * it carries a declaration carrier nobody read: UNREADABLE, ⛔ never the
 * cheaper tier — the queue guard's rule for a pair with no path list, one level
 * down. A tree with NO changeset carries no narrowing declaration at all — a
 * narrowing of a published accept set moves a published package, and that
 * ships a changeset — so the declaration face stands there exactly as before.
 * UNREADABLE answers `face: null` and `tierName: null`, which `servedTierStands`
 * stands nothing on, and a `reason`.
 *
 * `repo` selects the governed register's rows, as `governedPathsIn` requires;
 * this file runs in `objectstack-ai/objectstack`, so that is the default.
 *
 * @param {string[]} paths  the pull request's changed paths (its committed tree)
 * @param {{ declaredOn?: string[] }} [declaration]  the texts its `Clause-②:` line is read from
 * @returns {{ face: 'schema'|'rules'|'narrowing'|'declaration', tierName: string, words: string, hits: { schema: string[], rules: string[] } }
 *          | { face: null, tierName: null, words: string, hits: { schema: string[], rules: string[] }, reason: string }}
 */
export function reviewFace(paths, repo = SELF_REPO_ID, { declaredOn } = {}) {
  const list = (Array.isArray(paths) ? paths : []).filter((p) => typeof p === 'string' && p !== '');
  // ⭐ No mandate rows are passed: the question is the SUSPECT surface alone, and
  // an empty mandate table cannot make `deriveTier` throw on an ambiguity.
  const schema = [...new Set(deriveTier(list, [], SUSPECT_TIER_GLOBS).suspects.map((s) => s.path))];
  const rules = governedPathsIn(list, repo).flatMap((surface) => surface.files);
  const hits = { schema, rules };
  const unreadable = (reason) => ({ face: null, tierName: null, words: 'no face — UNREADABLE', hits, reason });
  // ⛔ A face this table does not hold reads UNREADABLE, never a neighbouring face.
  const named = (id) => {
    const face = reviewFaceById(id);
    return face === null ? unreadable(`REVIEW_FACES holds no \`${id}\` face`) : { face: face.id, tierName: face.tierName, words: face.words, hits };
  };
  if (schema.length > 0) return named('schema');
  if (rules.length > 0) return named('rules');
  const texts = (Array.isArray(declaredOn) ? declaredOn : []).filter((text) => typeof text === 'string');
  if (texts.length === 0) {
    const carrier = list.find(isChangesetPath);
    return carrier === undefined
      ? named('declaration')
      : unreadable(
        `the paths decide no face and the committed tree carries ${carrier}, whose \`Clause-②:\` line decides between ` +
        'the narrowing face and the declaration face, but no declaration was handed to read it',
      );
  }
  const readings = texts.map((text) => readClause2Line(text));
  if (readings.some((r) => r?.kind === 'declared' && r.arm === 'narrowing')) return named('narrowing');
  const malformed = readings.find((r) => r?.kind === 'malformed');
  if (malformed !== undefined) {
    return unreadable(`a \`Clause-②:\` line reads malformed (${malformed.line}), so whether it declares a narrowing is unknown`);
  }
  return named('declaration');
}

/** The face a `--face` argument names, or null — the CLI's half of the same table. */
export function reviewFaceById(id) {
  return REVIEW_FACES.find((face) => face.id === id) ?? null;
}

/**
 * Does the record printed for this face carry item ④, the design judgment? Read off the face
 * table's `fullReview` flag, ⛔ never a second list of faces. A null face is the bare template —
 * the tier of a schema or governed-path face — so it does; below tier nothing does. Pure.
 */
export function recordCarriesDesignJudgment(face, tierName) {
  return tierName === CONTRACT_REVIEW_TIER_NAME && (face === null || face.fullReview === true);
}

/**
 * The SCOPE FLOOR of the at-tier review: every path `reviewFace` returns as
 * `hits`, schema hits first, each once. Pure over the path list.
 *
 * Ruling record 6184805932 on #23578 (letter C, maintainer 「同意」): the TIER
 * stays the one the face maps to, but the at-tier review of a mixed diff covers
 * these paths plus every file their hunks make a claim about (a rule and the
 * gate that enforces it are one change, read as one); the rest is the lane
 * seat's ACCEPT at `TIER_DEFAULT`, exactly as a standalone pull request of those
 * files. The record's `Scope:` line lists both halves, and may widen, ⛔ never
 * narrow below this list. Tier H approval and the queue guard stay whole-PR:
 * nothing here is read by the guard.
 *
 * ⭐ Read off `reviewFace`, never a second classification: the same function the
 * queue guard decides the face with, so the floor cannot name a path the face
 * did not count, nor miss one it did. Empty on every face the paths did not
 * decide. ⭐ The narrowing face is at tier with NO path hit: its declaration is
 * the pull request's own and names no path, so its floor is every path of the
 * diff outside the prose faces — stated in the brief and on the `Scope:` line,
 * which the reviewer fills, since no path list read here can single them out.
 *
 * @param {string[]} paths  the pull request's changed paths (its committed tree)
 * @returns {string[]}
 */
export function reviewScopeHits(paths, repo = SELF_REPO_ID) {
  const { hits } = reviewFace(paths, repo);
  return [...new Set([...hits.schema, ...hits.rules])];
}


// ── the pure-regeneration carry (maintainer 2026-09-20 「纯重生成提交不需要开达档复核记录」) ──
//
// A record binds to a head, so any push re-owes the review — a loop the reviewed
// seat cannot exit on a generated-artefact-dense surface: somebody else lands,
// baselines drift, the seat regenerates, the head moves, the record is owed
// again (four times in one round, two PASSed pull requests unlanded). The ruling
// narrows it: when the move is a PURE REGENERATION the record keeps pointing at
// the new head — the POINTER test replaced by the CONTENT test it stood for.
//
// ⛔ MACHINE-READ ON COMMITTED TREES, never a seat's statement, and the committed
// half is not stylistic: before `git add -A` one regeneration answers `git
// status`, `git diff --cached` and `git diff` three DIFFERENT ways, and the
// `--cached` reading is main's side, which looks exactly like the answer. ⭐ The
// `Regen-provenance:` line is a POINTER, NEVER the evidence: it names the record
// and the two commits so a later reader RE-RUNS the test, and a reader that
// cannot reach both answers with a GAP — UNJUDGED, ⛔ never clean.
//
// ⭐ The PROSE arm (ruling record 6159870311 on #23352, letter B′ with C): a head
// that moves ONLY on faces outside the review surface keeps the record too —
// the prose faces the ACCEPT reads sentence by sentence, never the reviewer.
// Decided exactly like the regeneration arm, on the two COMMITTED trees, and
// pointed at by the SAME `Regen-provenance:` line rather than a second one: the
// line is a pointer and never the evidence, so a second key would be a second
// grammar naming the same two commits, and the common move — a merge-forward
// that also fixes the changeset — is ONE hop that would otherwise need both.

/**
 * The faces OUTSIDE the review surface — `references/contract-review.md`'s
 * prose faces, which the ACCEPT reads sentence by sentence against the diff. A
 * head move that touches only these (and generated artefacts, and main's
 * carry-over) is no reason to re-review: nothing the reviewer judged moved.
 *
 * ⛔ An EXCLUSION table, named as one so the dispatch derivation reads it as a
 * never-look-here list rather than as files this module opens (it opens none).
 *
 *   `prefix`    every path under this directory
 *   `basename`  every file of this name, at any depth
 */
export const REVIEW_SURFACE_EXCLUDED_PROSE_FACES = Object.freeze([
  Object.freeze({ id: 'changeset', prefix: '.changeset/' }),
  Object.freeze({ id: 'changelog', basename: 'CHANGELOG.md' }),
  Object.freeze({ id: 'docs-content', prefix: 'content/docs/' }),
  Object.freeze({ id: 'docs-app', prefix: 'apps/docs/' }),
]);

/** Does this path lie on a prose face outside the review surface? Pure. */
export function isOutsideReviewSurface(path) {
  const p = String(path ?? '');
  return REVIEW_SURFACE_EXCLUDED_PROSE_FACES.some((face) =>
    face.prefix !== undefined ? p.startsWith(face.prefix) : p === face.basename || p.endsWith(`/${face.basename}`),
  );
}

/**
 * One hop, as a seat posts it (the retired C3 row's remedy printed this shape):
 * `Regen-provenance: RECORD-ID · OLD-HEAD → NEW-HEAD · COMMAND → (empty)`.
 * Decoration is tolerated as `REVIEWED_BY_LINE` tolerates it — bullet, bold,
 * backticked shas — since none of it changes which commits the line names; the
 * tail after the second sha is the seat's own transcript and is deliberately
 * UNREAD, because a reader re-runs its own command, never a pasted one.
 */
export const REGEN_PROVENANCE_LINE =
  /^[\s>]*(?:[-*+]\s*)?\**\s*Regen-provenance\**\s*:\s*`?#?(\d+)`?\s*[·•]\s*`?([0-9a-fA-F]{7,40})`?\s*(?:→|->)\s*`?([0-9a-fA-F]{7,40})`?/;

/** Every hop the pair's threads carry, in thread order. ⛔ No head is judged here. */
export function regenProvenanceHops(pair) {
  return REVIEW_OF_RECORD_THREADS.flatMap((t) => (Array.isArray(pair?.[t.rows]) ? pair[t.rows] : []))
    .flatMap((row) => String(row?.body ?? '').split(/\r?\n/))
    .map((line) => REGEN_PROVENANCE_LINE.exec(line))
    .filter((m) => m !== null)
    .map((m) => ({ record: Number(m[1]), from: m[2].toLowerCase(), to: m[3].toLowerCase() }));
}

/** Either sha abbreviates the other — a seat writes 7, the API writes 40. */
const shaMeets = (a, b) => a.startsWith(b) || b.startsWith(a);

/**
 * The hops that chain BACK from this head, oldest first — `null` when none does.
 * Several hops are ordinary: a PR is re-synced once per drift. ⛔ Two hops
 * arriving at one head END the walk rather than being ranked, so a contradictory
 * thread carries no chain — the only direction this may err in.
 */
export function regenChainToHead(pair) {
  // ⭐ DE-DUPLICATED FIRST, on record + from + to. The reader searches BOTH
  // carriers and the governed text trains the dual-carrier habit, so ONE hop
  // posted on the PR and on its card arrives here twice — identical bytes, not
  // ambiguity. Judged by the ambiguity test below it would END the walk and
  // kill the carry in its most likely shape; two DIFFERENT hops into one head
  // still do, which is the fact that test exists for.
  const hops = [
    ...new Map(regenProvenanceHops(pair).map((h) => [`${h.record}\u0000${h.from}\u0000${h.to}`, h])).values(),
  ];
  let target = String(pair?.headSha ?? '').toLowerCase();
  if (target.length < H51_SHA_MIN_HEX) return null;
  const chain = [];
  const seen = new Set();
  while (!seen.has(target)) {
    seen.add(target);
    const step = hops.filter((h) => shaMeets(h.to, target));
    if (step.length !== 1) break;
    chain.unshift(step[0]);
    target = step[0].from;
  }
  return chain.length === 0 ? null : chain;
}

/**
 * The ruled test on COMMITTED trees: which moved paths are explained by NONE of
 * the arms of 「every touched path is a generated artefact OR THE MERGE COMMIT'S
 * OWN CARRY-OVER FROM MAIN」, widened by the prose arm (a path on a face outside
 * the review surface). Empty is the whole criterion.
 *
 * ⓪ the prose arm, `isOutsideReviewSurface`, read off the path alone: a moved
 * prose path is explained whoever moved it, the pull request itself included —
 * that is the whole of the exemption, and it is why this arm runs FIRST.
 * ① the `merge=os-regen` attribute, read with `--source <to>` so
 * `.gitattributes` itself comes out of that COMMIT rather than out of whatever
 * the working tree holds. ② the carry-over arm: a path this pull request never
 * touched AT EITHER HEAD moved only because `base` moved. ⛔ Without ② the
 * exception never fires on the loop this card measured — a merge-forward lists
 * every path main carried over, and a head-to-head diff reads them as hand-written.
 *
 * ⭐ The PR's OWN delta is read once per HEAD (`merge-base` + one name-only
 * diff), never once per path: a path is byte-explained by `base` exactly when
 * neither delta names it, which is the same verdict as comparing
 * `git diff FROM TO -- p` with `git diff MB_FROM MB_TO -- p` per path, at four
 * calls instead of two per path. The refusing direction is unchanged — a
 * hand-resolved merge leaves its resolution in the delta at the NEW head, and a
 * slipped-in edit in whichever delta carries it. `-z` throughout: a path may
 * hold a space, a quote or a colon and the parse must not be the weak link.
 */
export function unexplainedPathsBetween(runGit, { from, to, base }) {
  const names = (a, b) => String(runGit(['diff', '-z', '--name-only', a, b])).split('\0').filter((p) => p !== '');
  const moved = names(from, to).filter((p) => !isOutsideReviewSurface(p));
  if (moved.length === 0) return [];
  const f = String(runGit(['check-attr', '--source', to, '-z', 'merge', '--stdin'], moved.join('\0'))).split('\0');
  const hand = [];
  for (let i = 0; i + 2 < f.length; i += 3) if (f[i + 2] !== 'os-regen') hand.push(f[i]);
  if (hand.length === 0) return [];
  const mergeBase = (rev) => String(runGit(['merge-base', base, rev])).trim();
  const own = new Set([...names(mergeBase(from), from), ...names(mergeBase(to), to)]);
  return hand.filter((p) => own.has(p));
}

const REGEN_CARRY_MEMO = new WeakMap();

/**
 * Does a chain of certified pure regenerations carry the record to this head?
 * Memoised per pair: a caller may ask more than once in one run, and two
 * commits cannot change under one. ⛔ FOUR states, none foldable: `none` (no
 * line — today's rule, unchanged), `refused` (a line that does NOT certify: an
 * ordinary re-hang), `unreadable` (the environment could not answer), `carried`.
 *
 * @returns {{ state: 'none' } | { state: 'unreadable', gaps: string[] }
 *          | { state: 'refused', reason: string }
 *          | { state: 'carried', record: number, head: string, hops: number }}
 */
export function regenCarry(pair) {
  if (pair === null || typeof pair !== 'object') return { state: 'none' };
  if (!REGEN_CARRY_MEMO.has(pair)) REGEN_CARRY_MEMO.set(pair, computeRegenCarry(pair));
  return REGEN_CARRY_MEMO.get(pair);
}

function computeRegenCarry(pair) {
  const chain = regenChainToHead(pair);
  if (chain === null) return { state: 'none' };
  const records = [...new Set(chain.map((h) => h.record))];
  if (records.length !== 1) {
    return { state: 'refused', reason: `its \`Regen-provenance:\` hops name ${records.length} different records (${records.join(', ')}) and one chain carries ONE record` };
  }
  const runGit = pair?.runGit;
  if (typeof runGit !== 'function') {
    return { state: 'unreadable', gaps: [`PR #${pair?.pr}'s \`Regen-provenance:\` chain — this run holds no git reader, so the two committed trees were never compared`] };
  }
  // ⛔ The base ref is what separates 「what main brought」 from 「what the PR
  // changed」, so a run that names none cannot answer at all — never clean.
  const base = pair?.baseRef;
  if (typeof base !== 'string' || base === '') {
    return { state: 'unreadable', gaps: [`PR #${pair?.pr}'s base ref — this run names none, so the merge commit's own carry-over could not be told apart from a hand edit`] };
  }
  for (const hop of chain) {
    const span = `${hop.from.slice(0, 10)}..${hop.to.slice(0, 10)}`;
    let hand;
    try {
      hand = unexplainedPathsBetween(runGit, { from: hop.from, to: hop.to, base });
    } catch (error) {
      const why = String(error?.message ?? error).split('\n')[0];
      return { state: 'unreadable', gaps: [`the committed trees ${span} against base \`${base}\` (${why}) — fetch both (\`git fetch origin pull/${pair?.pr}/head\`, \`git fetch origin ${hop.from}\`) and re-run`] };
    }
    if (hand.length > 0) {
      return { state: 'refused', reason: `${span} moved ${hand.length} path(s) that lie on no prose face outside the review surface, carry no \`merge=os-regen\` attribute and are not what \`${base}\` brought (${hand.slice(0, 4).join(', ')}) — this pull request's own reviewed content moved, so it is neither a pure regeneration nor a prose-only move` };
    }
  }
  // Expanded through git so the carried head is spelled at least as fully as
  // the record spells it: the head-identity test is a PREFIX of the head, so an
  // abbreviation SHORTER than the record's own span matches nothing.
  let head = chain[0].from;
  try {
    head = String(runGit(['rev-parse', `${head}^{commit}`])).trim() || head;
  } catch {
    /* the diff already read both commits; an abbreviation is still usable */
  }
  return { state: 'carried', record: records[0], head, hops: chain.length };
}

/**
 * A machine key line, in this file's ONE convention: the key is literal and
 * case-sensitive, the decoration a seat writes without meaning anything by it
 * (a leading blockquote, a list bullet, backtick or bold wrapping on the key
 * and its colon) is tolerated, and the rest of the line is the raw value.
 *
 * Factored out rather than copied so a second key added later cannot arrive
 * with a second convention -- the drift this file refuses one family over.
 */
function keyLineRegex(key) {
  return new RegExp(`^[ \\t]*(?:>[ \\t]*)?(?:[-*][ \\t]+)?(?:\\*\\*)?\`?${key}\`?(?:\\*\\*)?[ \\t]*:(.*)$`);
}

/**
 * The markdown decoration a VALUE may open with — stripped, in any order and
 * any repetition, before the value's token is read. Written for the two
 * authorship tokens of the retired C4 row; here it runs before `TIER_TOKEN`.
 *
 * ⭐ Measured, and the fix for a genuine asymmetry (#17346). The key regexes
 * tolerate `**Implemented-by:**` — bold wrapping the key AND its colon — which
 * is what every 2026-09-09 specimen writes. But the colon inside the bold means
 * the captured VALUE opens with the closing `**`, and the old token regexes
 * admitted a leading `**` only when a backtick or the token followed it with no
 * space between: on `- **Implemented-by:** \`claude/issue-x\`` the value read
 * `"** \`claude/issue-x\`"` and BOTH tokens answered `null`. So the key was
 * recognised, the value was not, and the pair read `malformed` on a comment
 * whose author had written a perfectly good identity — a false positive
 * produced by the reader, which is a different fact from the corpus's own
 * prose values and is fixed HERE rather than tolerated downstream.
 *
 * ⛔ It strips DECORATION only — spaces, `**`, backticks — never a word. The
 * near misses the ruling turns on are untouched: `branch \`claude/…\``,
 * `the dev on claude/…` and the corpus's `isolated <model> subagent` all stop
 * the strip at their first letter, so the token is still required to be the
 * FIRST thing after the colon and its decoration.
 */
const VALUE_DECORATION = /^(?:[ \t]+|\*\*|`)+/;

function stripValueDecoration(raw) {
  return String(raw ?? '').replace(VALUE_DECORATION, '');
}

/**
 * The `Reviewed-by:` key line, in `keyLineRegex`'s one convention — the regex the
 * retired C4 row read it with, built the same way, so a record that row accepted
 * still reads as SIGNED here. Its value is not judged: the record names a
 * reviewer, and who that is stays human.
 */
export const REVIEWED_BY_LINE = keyLineRegex('Reviewed-by');

/**
 * The `Served-tier:` key line -- the THIRD provenance fact a verdict declares
 * about itself, read with `Reviewed-by:`'s own discipline (#17915).
 *
 * ⭐ A fact about what PRODUCED the verdict, never the verdict. `Reviewed-by:`
 * says WHO rendered it; this says WHAT SERVED the round that rendered it. The
 * READING behind it is the harness-stamped served-model field of the reviewer's
 * own transcript, ⛔ never the dispatch `model` parameter, which is
 * CONFIGURATION and not a reading -- that distinction is the whole defect: a
 * passed parameter and a served tier can differ, and until this row nothing in
 * the tree compared them, so a round served below tier cleared a carrier
 * indistinguishably from one served at it.
 *
 * ⛔ But the reading stays in the transcript and the LINE carries only the
 * constant's NAME -- 「值写常量名 `CONTRACT_REVIEW_TIER`」 -- because a record is
 * a GitHub comment and `AGENTS.md` lets no model identifier land in one
 * (#18060). See `CONTRACT_REVIEW_TIER_NAME` for why that costs no evidence.
 *
 * ⛔ The key is read ANYWHERE in the comment, on its own line. The rule text
 * asks the author to put it FIRST (「同形含首行 `Served-tier:`」) because a
 * reader should not have to hunt for it; a reader that REFUSED it below some
 * line number would be rejecting correct records over decoration, which is the
 * false-positive direction this file spends its self-test avoiding.
 */
const SERVED_TIER_LINE = keyLineRegex('Served-tier');

/**
 * The value token -- an opaque tier identifier.
 *
 * ⭐ Closed on an alphanumeric or a `]`, so a real id keeps its whole shape
 * (a bracketed context suffix included) while a trailing `.` or `,` stays with
 * the prose. What a seat writes AFTER the token is its argument, which this
 * file does not read -- so a value that opens with prose reads as that prose
 * and compares unequal, loudly, rather than being scanned for a model name
 * somewhere in the sentence. ⚠️ That looseness is precisely the false-positive
 * mode measured on the hand-rolled probes this row replaces: a bare model-name
 * token matched inside a QUOTED prior record, and a correct verdict came one
 * grep away from being voided.
 */
const TIER_TOKEN = /^([A-Za-z0-9](?:[A-Za-z0-9._:[\]-]*[A-Za-z0-9\]])?)/;

/**
 * The STAMP CONTROL that may precede the tier -- `N/M`, measured on the live
 * corpus and named by the ruling itself.
 *
 * ⭐ Corrected from a fixture against the board, which is the correction this
 * family has had to make before (#17346: the corpus moved and the discriminator
 * did not). Every record the remediation rounds write spells the value
 * `75/75 \`<tier>\`` -- the at-tier stamp count over the total, THEN the tier --
 * and the ruling's own specimen is written the same way. A reader that demanded
 * the tier token immediately after the colon would have refused every verdict
 * produced under the rule it enforces, on its first day.
 *
 * ⛔ And the count is not decoration to be skipped: it IS the zero-hit control
 * the discipline requires -- a stamp reading is void unless the same probe
 * returned a non-zero count on the same transcript -- and a count that is not
 * FULL is the 「回退证据」 whose own rule text voids the verdict entire. So it
 * is read, and it is judged: absent, the tier alone decides (the ruling's
 * minimum, and nothing the ruling permits is refused); present, it must be
 * non-zero and total.
 */
const STAMP_CONTROL = /^(\d+)[ \t]*\/[ \t]*(\d+)(?![\d/])/;

/**
 * Does a declared stamp control STAND? Absent is vacuous; present must be
 * total and non-zero. One predicate, so the row and the note cannot disagree.
 */
export function servedStampsHold(stamps) {
  return stamps === null || (stamps.total > 0 && stamps.atTier === stamps.total);
}

/**
 * The token a `Served-tier:` line may carry -- a tier constant's NAME, ⛔ never
 * its VALUE (#18060); ONE name per face, the one `reviewFace` maps it to.
 *
 * ⭐ `AGENTS.md` is unqualified about the surface: 「no model identifier lands in
 * a PR title or body, a comment, a changeset, a doc or a code comment」 -- and a
 * review of record IS a comment. The first spelling of this row compared the
 * token to the constant's VALUE, so a record could clear a carrier ONLY by
 * carrying a model identifier into the very artifact that rule names; the gate
 * would have cemented the violation rather than a habit. The NAME is governed
 * text, carries the same fact, and lands no identifier.
 *
 * ⭐ Nothing evidential is lost, and that is why this needed no ruling to trade
 * away: the line was never the reading. 「⛔ 自述档位与传参皆非读数」 -- the
 * reading is the seat's transcript grep against the constant's value, which
 * produces no repository artifact at all. What the line carries is the
 * DECLARATION plus its `N/N` stamp control, and both survive the rename.
 *
 * ⛔ Still EXACT: one accepted token per face, no family and no prefix floor.
 *
 * Both names are declared beside the constants they name, in
 * `dispatch-gates.mjs`, and RE-EXPORTED here: the claim reader there compares a
 * claim's `model:` value against the same token, and two spellings of one name
 * in two files is the drift this file refuses one family over.
 */
export { CONTRACT_REVIEW_TIER_NAME, TIER_DEFAULT_NAME };

/**
 * The id form of a model name -- the word claude, a hyphen, a model word.
 *
 * A SHAPE and not a list, so a model nobody has named yet binds for the same
 * reason the shipped ones do -- the same rule `check-commit-card-trailers.mjs`
 * binds over a trailer value, spelled here rather than imported because that
 * file is the pre-push entrypoint and this one is imported by the merge-queue
 * guard. The battery pins the two together through the constant's own value.
 */
const MODEL_IDENTIFIER_FORM = /\bclaude-[a-z]+(?:[-.][a-z0-9]+)*\b/i;

/**
 * Is this token a model identifier -- the thing `AGENTS.md` keeps out of a
 * comment?
 *
 * Two limbs: the VALUE of each tier a record may stand at -- the contract-review
 * tier's, which is the token this row used to REQUIRE (so a record written
 * correctly under the old rule is named for what it is, never read as an
 * ordinary off-tier miss), and the default tier's, the value a seat writing the
 * declaration face's record reaches for in place of its NAME -- and the id SHAPE.
 *
 * ⛔ A caller must NEVER echo a token this returns true for: quoting it back
 * would put the identifier straight into the artifact the rule is about, which
 * is how a refusal becomes a second violation.
 */
export function isModelIdentifierToken(value) {
  const text = String(value ?? '');
  return text === CONTRACT_REVIEW_TIER || text === TIER_DEFAULT || MODEL_IDENTIFIER_FORM.test(text);
}

/**
 * The whole reading, as one verdict: at the tier the FACE maps to, on a control
 * that stands.
 *
 * `tierName` is the NAME `reviewFace` answered for the pull request the record
 * sits on; it defaults to `CONTRACT_REVIEW_TIER_NAME`, the tier both path-read
 * faces map to and the only one a governed pull request can owe. ⛔ EXACT: a
 * record naming the other tier does not stand on this face, in either
 * direction, and a `tierName` that is not one of `REVIEW_TIER_NAMES` stands
 * NOTHING -- a caller that lost the face fails closed, never open.
 */
export function servedTierStands(served, tierName = CONTRACT_REVIEW_TIER_NAME) {
  return (
    REVIEW_TIER_NAMES.includes(tierName) &&
    served?.state === 'read' &&
    served.value === tierName &&
    servedStampsHold(served.stamps)
  );
}

/**
 * What one comment declares about the tier that served it.
 *
 * @returns {{ state: 'missing', stamps: null }
 *          | { state: 'unreadable', line: string, stamps: object|null }
 *          | { state: 'read', value: string, stamps: object|null }}
 *
 * Every shape carries `stamps`, so a caller never has to test for the key.
 *
 * `stamps` is the `N/M` control when the value carried one, `null` when it did
 * not -- read here, judged by `servedStampsHold`, so the reading and the
 * verdict stay two steps.
 *
 * Three-valued for the reason the retired authorship reader was four-valued: a carrier
 * that was never started and one that was started and left unreadable are
 * different facts about the seat that wrote it, and they earn different
 * remedies. Both are refusals -- neither is a reading equal to the constant.
 */
export function readServedTier(text) {
  for (const line of String(text ?? '').split(/\r?\n/)) {
    const m = SERVED_TIER_LINE.exec(line);
    if (!m) continue;
    let rest = stripValueDecoration(m[1]);
    let stamps = null;
    const control = STAMP_CONTROL.exec(rest);
    if (control) {
      stamps = { atTier: Number(control[1]), total: Number(control[2]) };
      rest = stripValueDecoration(rest.slice(control[0].length));
    }
    const token = TIER_TOKEN.exec(rest);
    return token
      ? { state: 'read', value: token[1], stamps }
      : { state: 'unreadable', line: quoteLine(line), stamps };
  }
  return { state: 'missing', stamps: null };
}

/**
 * The `Local-runs:` key line -- the FOURTH provenance fact a verdict declares
 * about itself: whether the round that rendered it ran anything locally.
 *
 * ⭐ The rule it makes visible is the review's read-only shape (the skill's
 * contract-review reference: only the diff and the card are read, the check
 * conclusions come from the head's check-runs, and the derived gate families
 * are ⛔ never re-run locally). Measured on one shift: hand-written briefs
 * told reviewers to open worktrees and re-run pins, ablations and type checks,
 * at 250k to 430k tokens per review, and no line on any record showed it. The
 * line carries `none` -- the shape held -- or `probe — REASON`, naming the ONE
 * local run the rule was broken for and why; a probe with no reason names no
 * deviation and is unreadable.
 *
 * ⛔ ABSENT IS NOT RE-JUDGED. Records written before this line existed carry no
 * line, and they are landed records: a reader that refused them would re-open
 * three PASS verdicts over a line nobody had been asked to write. So `missing`
 * STANDS, `read` stands, and only a line that is present and cannot be graded
 * refuses -- the one direction in which a new line can be added to a record
 * without re-judging the corpus.
 *
 * ⛔ The key is read anywhere in the comment, on its own line, for the reason
 * `Served-tier:` is: refusing a correct record over its position is the
 * false-positive direction.
 */
const LOCAL_RUNS_LINE = keyLineRegex('Local-runs');

/** `probe`, a separator (an em dash, a hyphen pair, a hyphen or a colon), then the reason -- which must be there. */
const LOCAL_RUNS_PROBE = /^probe\b[ \t]*(?:—|--|-|:)?[ \t]*(.*)$/i;

/**
 * What one comment declares about its local runs.
 *
 * @returns {{ state: 'missing' }
 *          | { state: 'unreadable', line: string }
 *          | { state: 'read', value: 'none', reason: null }
 *          | { state: 'read', value: 'probe', reason: string }}
 */
export function readLocalRuns(text) {
  for (const line of String(text ?? '').split(/\r?\n/)) {
    const m = LOCAL_RUNS_LINE.exec(line);
    if (!m) continue;
    const rest = stripValueDecoration(m[1]).replace(/(?:[ \t]|\*\*|`)+$/, '');
    if (/^none$/i.test(rest)) return { state: 'read', value: 'none', reason: null };
    const probe = LOCAL_RUNS_PROBE.exec(rest);
    if (probe && probe[1].trim().length > 0) return { state: 'read', value: 'probe', reason: probe[1].trim() };
    return { state: 'unreadable', line: quoteLine(line) };
  }
  return { state: 'missing' };
}

/** Does the `Local-runs:` reading STAND? Missing stands (not re-judged); read stands; unreadable does not. */
export function localRunsStand(reading) {
  return reading?.state === 'missing' || reading?.state === 'read';
}

/**
 * The `Contract-review-handoff:` key line -- the ONE way a dispatching seat
 * hands its contract review to the triage seat, read with `Reviewed-by:`'s own
 * key discipline.
 *
 * ⭐ The rule it makes machine-findable (the skill's contract-review reference,
 * 〈复核归属与资格〉, and the triage duties' round step): the seat that
 * dispatched the work runs the review at the contract-review tier. ONLY when
 * that tier's call is quota-refused does the seat hand the review over -- it
 * never reviews at a lower tier -- and the hand-off is one PR comment carrying
 * this line beside the existing `needs:contract-review` label:
 *
 *   Contract-review-handoff: triage — CONTRACT_REVIEW_TIER unavailable (HTTP 429, 2026-10-27T13:00Z) · head 1b03a9c3
 *
 * Three facts, each required: the TARGET (`triage`, the closed set of one), the
 * TIER that was unavailable -- the constant's NAME, exactly as `Served-tier:`
 * spells it, ⛔ never a model id -- with its reason and UTC time in the
 * parentheses, and the HEAD the hand-off is for, 7 to 40 hex. A line missing
 * any of them is started-and-unreadable: a hand-off nobody can date, or one
 * that names no head, is the ambiguity this line exists to remove.
 *
 * ⛔ No gate reads it. The queue guard keeps reading the ONE `## Contract
 * review` record; this line decides only WHO renders that record, and the
 * triage seat's record is the same shape, `Reviewed-by:` naming the triage
 * seat. `contractReviewHandoff` below is the reading a seat or patrol takes.
 */
export const CONTRACT_REVIEW_HANDOFF_KEY = 'Contract-review-handoff';
const CONTRACT_REVIEW_HANDOFF_LINE = keyLineRegex(CONTRACT_REVIEW_HANDOFF_KEY);
/** The same key as a MARKER over a whole comment body -- `latestMarkedComment`'s convention (multiline, `g`-less). */
const CONTRACT_REVIEW_HANDOFF_MARKER = new RegExp(CONTRACT_REVIEW_HANDOFF_LINE.source, 'm');
/** `triage`, a separator (an em dash, a hyphen pair, a hyphen or a colon), then the rest. */
const HANDOFF_TARGET = /^triage\b[ \t]*(?:—|--|-|:)?[ \t]*(.*)$/i;
/** `(reason, UTC time)` then ` · head SHA` -- the time is the LAST comma-separated item in the parentheses. */
const HANDOFF_TAIL = /^\(([^()]*?)[ \t]*,[ \t]*([^,()]+)\)[ \t]*·[ \t]*head[ \t]+`?([0-9a-fA-F]{7,40})`?[ \t]*$/;

/**
 * What one comment declares as a hand-off of its contract review.
 *
 * @returns {{ state: 'missing' }
 *          | { state: 'unreadable', line: string }
 *          | { state: 'read', to: 'triage', tier: string, reason: string, at: string, head: string }}
 */
export function readContractReviewHandoff(text) {
  for (const line of String(text ?? '').split(/\r?\n/)) {
    const m = CONTRACT_REVIEW_HANDOFF_LINE.exec(line);
    if (!m) continue;
    const unreadable = { state: 'unreadable', line: quoteLine(line) };
    const target = HANDOFF_TARGET.exec(stripValueDecoration(m[1]).replace(/(?:[ \t]|\*\*|`)+$/, ''));
    if (!target) return unreadable;
    // The tier is read by NAME, through the one token reader `Served-tier:` uses, so a model id
    // written here is refused for the same reason it is refused there.
    const named = stripValueDecoration(target[1]);
    const tier = TIER_TOKEN.exec(named);
    if (!tier || tier[1] !== CONTRACT_REVIEW_TIER_NAME) return unreadable;
    const rest = stripValueDecoration(named.slice(tier[0].length));
    const tail = /^unavailable\b[ \t]*(.*)$/i.exec(rest);
    const parts = tail ? HANDOFF_TAIL.exec(tail[1].trim()) : null;
    if (!parts || parts[1].trim() === '') return unreadable;
    return { state: 'read', to: 'triage', tier: tier[1], reason: parts[1].trim(), at: parts[2].trim(), head: parts[3] };
  }
  return { state: 'missing' };
}

/**
 * Whose review this pull request's contract review is, read off its comment thread:
 *
 *   absent    no hand-off line on any comment -- the dispatching seat's own review; a
 *             `needs:contract-review` label alone changes nothing here, and triage does not touch it
 *   triage    the NEWEST hand-off line names the current head -- the triage seat renders the record
 *   stale     the newest hand-off line names an earlier head -- the head moved past the hand-off, so
 *             it needs a fresh line or the seat's own review; triage does not act on it
 *   unreadable  the thread or the head could not be read, or the newest hand-off line cannot be graded
 *
 * Newest governs, chosen by `latestMarkedComment` -- the one resolution this file's locator uses --
 * and the head is matched by PREFIX, as `contractReviewHeadMatch` matches a record's span, so the
 * abbreviated and the full spelling answer alike.
 *
 * @param {{ id?: number, body?: string, created_at?: string }[]} rows  the PR's comment rows
 * @param {string} headSha  the pull request's current head
 */
export function contractReviewHandoff(rows, headSha) {
  const gaps = [];
  if (!Array.isArray(rows)) gaps.push("the pull request's comment thread");
  const head = String(headSha ?? '').toLowerCase();
  if (head.length < H51_SHA_MIN_HEX) gaps.push("the pull request's head sha");
  if (gaps.length > 0) return { state: 'unreadable', gaps };
  const newest = latestMarkedComment(rows, CONTRACT_REVIEW_HANDOFF_MARKER);
  if (!newest) return { state: 'absent', read: rows.length };
  const row = rows[newest.index];
  const line = readContractReviewHandoff(row?.body);
  const stamp = { id: row?.id ?? null, at: row?.created_at ?? null };
  if (line.state !== 'read') return { state: 'unreadable', gaps: [`the newest hand-off line (comment ${stamp.id ?? '?'}) cannot be read: ${line.line ?? 'no line'}`], ...stamp };
  // PREFIX either way, as `regenChainToHead` meets two spellings of one commit: the line may abbreviate the head.
  const current = shaMeets(head, line.head.toLowerCase());
  return { state: current ? 'triage' : 'stale', head: line.head, reason: line.reason, handedAt: line.at, ...stamp };
}

// ---------------------------------------------------------------------------
// The `Contract-review-claim:` line — one per head, so two reviewers never start on one
// ---------------------------------------------------------------------------

/**
 * The `Contract-review-claim:` key line -- who has STARTED the contract review
 * of one head, posted by that reviewer before it starts, lane seat or triage.
 *
 * ⭐ The rule it makes machine-findable (the skill's contract-review reference,
 * 〈复核归属与资格〉): the lane reviews its own; the triage seat takes a review
 * only when nobody is doing it. Before starting, every reviewer reads the PR:
 * a record or a LIVE claim on the current head means do not start. Otherwise it
 * posts ONE comment carrying this line first, then reviews:
 *
 *   Contract-review-claim: session_01AavokzJ5DndAwitDXvKy4U · head 3beee64fe77741d07f035f1b80eeaa07e7280ab4 · 2026-10-28T12:18Z
 *
 * Three facts, each required, separated by the doorbell's dot: the SESSION that
 * reviews (the signature line's session shape, `SEAT_SIGNATURE_SESSION_SOURCE`,
 * imported, ⛔ never a second spelling), the head as the FULL 40-hex sha --
 * the rule says full, because a claim is compared against a head that may move
 * to a sibling sharing a short prefix -- and the UTC time to the minute (seconds
 * allowed). Backtick wrapping on any value reads; a line missing a fact, or
 * with a fourth part, is started-and-unreadable, and an unreadable claim is NO
 * claim: it holds no head.
 *
 * A claim LAPSES (`contractReviewClaimLapse`) when the head moves, or
 * {@link CONTRACT_REVIEW_CLAIM_LAPSE_HOURS} hours after it was posted -- the
 * reviewer died -- after which the next reviewer may claim. A record on the
 * head settles the review whatever any claim says; that is the caller's read
 * (`locateReviewOfRecord`), never this one's. When a lane claim and a triage
 * claim are both live on one head the LANE wins: triage withdraws by replying
 * once and discards its subagent's work (`contractReviewClaims` names the
 * holder).
 *
 * ⛔ No gate reads it. The queue guard keeps reading the ONE `## Contract
 * review` record; this line is coordination between reviewers, never a merge
 * condition. `contractReviewClaims` below is the reading a seat or the
 * owed-review list (`check-owed-reviews.mjs`) takes.
 */
export const CONTRACT_REVIEW_CLAIM_KEY = 'Contract-review-claim';
/**
 * The line exactly as the rule text prints it, placeholders included. This file's self-test pins it
 * VERBATIM in `references/contract-review.md`, so the text and the reader cannot drift apart.
 */
export const CONTRACT_REVIEW_CLAIM_TEMPLATE = `${CONTRACT_REVIEW_CLAIM_KEY}: <session> · head <full sha> · <UTC>`;
/** Hours after posting that a claim with no record on its head lapses -- the rule's 「2 小时」. */
export const CONTRACT_REVIEW_CLAIM_LAPSE_HOURS = 2;
const CONTRACT_REVIEW_CLAIM_LINE = keyLineRegex(CONTRACT_REVIEW_CLAIM_KEY);
const CLAIM_SESSION = new RegExp(`^\`?(${SEAT_SIGNATURE_SESSION_SOURCE})\`?$`);
const CLAIM_HEAD = /^head[ \t]+`?([0-9a-fA-F]{40})`?$/;
const CLAIM_TIME = /^`?(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?Z)`?$/;

/**
 * What one comment declares as a claim on a contract review. The FIRST claim
 * line of the comment is read, after one leading signature line is set aside
 * (`stripSignatureLine`, as every reader here does).
 *
 * @returns {{ state: 'missing' }
 *          | { state: 'unreadable', line: string }
 *          | { state: 'read', session: string, head: string, time: string, at: number }}
 */
export function readContractReviewClaim(text) {
  for (const line of stripSignatureLine(String(text ?? '')).split(/\r?\n/)) {
    const m = CONTRACT_REVIEW_CLAIM_LINE.exec(line);
    if (!m) continue;
    const unreadable = { state: 'unreadable', line: quoteLine(line) };
    // Leading decoration is the key's (`stripValueDecoration`); trailing spaces and bold are the line's.
    const parts = stripValueDecoration(m[1]).replace(/(?:[ \t]|\*\*)+$/, '').split(MAILBOX_SEPARATOR);
    if (parts.length !== 3) return unreadable;
    const session = CLAIM_SESSION.exec(parts[0]);
    const head = CLAIM_HEAD.exec(parts[1]);
    const time = CLAIM_TIME.exec(parts[2]);
    const at = time ? Date.parse(time[1]) : Number.NaN;
    if (!session || !head || !Number.isFinite(at)) return unreadable;
    return { state: 'read', session: session[1], head: head[1].toLowerCase(), time: time[1], at };
  }
  return { state: 'missing' };
}

/**
 * Is this claim still holding its head? Pure arithmetic, no thread read.
 *
 *   live        it names the current head and was posted under the lapse window ago
 *   head-moved  it names another head -- the head moved past it
 *   expired     it names the current head and was posted the lapse window ago or more
 *
 * `postedAt` is the comment's own `created_at` when the caller holds it -- the
 * platform's stamp of when the claim was POSTED, which the rule times from --
 * else the time the line itself states. A head is matched in FULL (both
 * lowercased): the claim spells the full sha, and so does a pull row's head.
 *
 * @param {{ head: string, at: number }} claim  a `read` claim
 * @param {{ headSha: string, now: number, postedAt?: number }} context
 * @returns {'live'|'head-moved'|'expired'}
 */
export function contractReviewClaimLapse(claim, { headSha, now, postedAt } = {}) {
  if (String(claim?.head ?? '').toLowerCase() !== String(headSha ?? '').toLowerCase()) return 'head-moved';
  const posted = Number.isFinite(postedAt) ? postedAt : claim?.at;
  return now - posted >= CONTRACT_REVIEW_CLAIM_LAPSE_HOURS * 3600 * 1000 ? 'expired' : 'live';
}

/**
 * Who holds this pull request's current head, read off its comment thread:
 *
 *   live        a live claim names the current head -- `holder` is the claim to respect: the LANE's
 *               when a lane claim and a triage claim are both live (`tie` true), else the earliest posted
 *   lapsed      claims named the current head, and every one has expired
 *   none        no claim names the current head (claims on earlier heads lapsed when it moved)
 *   unreadable  the thread, the head or the clock could not be read
 *
 * A claim's SIDE is read off its comment's signature line (`readSignatureLine`): the triage seat
 * signs `triage#N · …`, and every other claim -- a lane seat's, a cross-account reviewer's, an
 * unsigned one -- is the `lane` side, which is the side the tie rule protects. Unreadable claim
 * lines are returned by comment id and hold nothing.
 *
 * @param {{ id?: number, body?: string, created_at?: string }[]} rows  the PR's comment rows
 * @param {string} headSha  the pull request's current head, full
 * @param {{ now: number }} clock  milliseconds since the epoch
 */
export function contractReviewClaims(rows, headSha, { now } = {}) {
  const gaps = [];
  if (!Array.isArray(rows)) gaps.push("the pull request's comment thread");
  const head = String(headSha ?? '').toLowerCase();
  if (!/^[0-9a-f]{40}$/.test(head)) gaps.push("the pull request's full head sha");
  if (!Number.isFinite(now)) gaps.push('the clock the lapse is measured on');
  if (gaps.length > 0) return { state: 'unreadable', gaps };
  const claims = [];
  const unreadable = [];
  for (const row of rows) {
    const line = readContractReviewClaim(row?.body);
    if (line.state === 'missing') continue;
    if (line.state === 'unreadable') {
      unreadable.push({ id: row?.id ?? null, line: line.line });
      continue;
    }
    const stamped = Date.parse(row?.created_at ?? '');
    const postedAt = Number.isFinite(stamped) ? stamped : line.at;
    const side = readSignatureLine(row?.body)?.lane === 'triage' ? 'triage' : 'lane';
    const lapse = contractReviewClaimLapse(line, { headSha: head, now, postedAt });
    claims.push({ id: row?.id ?? null, session: line.session, head: line.head, time: line.time, postedAt, side, lapse });
  }
  const live = claims.filter((c) => c.lapse === 'live').sort((a, b) => a.postedAt - b.postedAt);
  const tie = live.some((c) => c.side === 'lane') && live.some((c) => c.side === 'triage');
  const holder = live.find((c) => c.side === 'lane') ?? live[0] ?? null;
  const state = holder !== null ? 'live' : claims.some((c) => c.lapse === 'expired') ? 'lapsed' : 'none';
  return { state, holder, tie, claims, unreadable };
}

// ---------------------------------------------------------------------------
// The `Contract-review-hold:` line — a lane's "not this head yet", one per head
// ---------------------------------------------------------------------------

/**
 * The `Contract-review-hold:` key line -- a LANE saying "do not review this head
 * yet": the head will move again, or something must land first. Before it
 * existed that was prose on the PR, which no reader can tell from commentary, so
 * the triage seat claimed under gap rule (b) and then had to withdraw.
 *
 * ⭐ The rule it makes machine-findable (the skill's contract-review reference,
 * 〈复核归属与资格〉, beside the claim line): the holding lane posts ONE comment
 * carrying this line --
 *
 *   Contract-review-hold: session_01QSeKYmhU5KEj1nukYhp1Tg · head 3beee64f · the stack still lands under it · until the last sibling merges
 *
 * Four facts, each required, separated by the doorbell's dot: the SESSION that
 * holds (the signature line's session shape, read by the claim's own reader,
 * ⛔ never a second spelling), the HEAD (7 to 40 hex, matched by PREFIX as the
 * hand-off line's head is), the REASON, and `until` followed by the CONDITION.
 * Reason and condition are free text and are not graded -- but each must be
 * there, and the dot is the separator, so a fifth part is started-and-unreadable,
 * and an unreadable hold holds nothing.
 *
 * Per head, newest governs (`latestMarkedComment`, the hand-off line's
 * resolution): the newest hold naming the CURRENT head is `live`, and while it
 * is, gap rule (b) does not fire -- (a) and (c) still do. A new head clears it
 * (`stale`). The lane that holds owns the review once its condition is met: it
 * hangs `needs:contract-review` or posts a hand-off line, and either is (a).
 *
 * The AGE is a reading, ⛔ never a verdict. Whether the condition is met is free
 * text no reader can judge, so nothing here lapses a hold: at
 * {@link CONTRACT_REVIEW_HOLD_LIST_HOURS} hours a live hold reads `overdue`,
 * which the triage round record lists so a hold cannot become a silent skip --
 * and an overdue hold still holds (b). Age is timed from the comment's
 * `created_at`, the platform's stamp of when the hold was POSTED; the line
 * carries no time of its own.
 *
 * ⛔ No gate reads it. The queue guard keeps reading the ONE `## Contract
 * review` record; this line is coordination between reviewers, never a merge
 * condition. `contractReviewHold` below is the reading the owed-review list
 * (`check-owed-reviews.mjs`) takes.
 */
export const CONTRACT_REVIEW_HOLD_KEY = 'Contract-review-hold';
/**
 * The line exactly as the rule text prints it, placeholders included. This file's self-test pins it
 * VERBATIM in `references/contract-review.md`, so the text and the reader cannot drift apart.
 */
export const CONTRACT_REVIEW_HOLD_TEMPLATE = `${CONTRACT_REVIEW_HOLD_KEY}: <session> · head <sha> · <reason> · until <condition>`;
/** Hours after posting that a live hold reads `overdue` and is listed -- the rule's 「24 小时」. A reading, never a lapse. */
export const CONTRACT_REVIEW_HOLD_LIST_HOURS = 24;
const CONTRACT_REVIEW_HOLD_LINE = keyLineRegex(CONTRACT_REVIEW_HOLD_KEY);
/** The same key as a MARKER over a whole comment body -- `latestMarkedComment`'s convention (multiline, `g`-less). */
const CONTRACT_REVIEW_HOLD_MARKER = new RegExp(CONTRACT_REVIEW_HOLD_LINE.source, 'm');
const HOLD_HEAD = /^head[ \t]+`?([0-9a-fA-F]{7,40})`?$/;
const HOLD_UNTIL = /^until[ \t]+(\S.*)$/;

/**
 * What one comment declares as a hold on a contract review. The FIRST hold line
 * of the comment is read, after one leading signature line is set aside
 * (`stripSignatureLine`, as the claim reader does).
 *
 * @returns {{ state: 'missing' }
 *          | { state: 'unreadable', line: string }
 *          | { state: 'read', session: string, head: string, reason: string, until: string }}
 */
export function readContractReviewHold(text) {
  for (const line of stripSignatureLine(String(text ?? '')).split(/\r?\n/)) {
    const m = CONTRACT_REVIEW_HOLD_LINE.exec(line);
    if (!m) continue;
    const unreadable = { state: 'unreadable', line: quoteLine(line) };
    // Leading decoration is the key's (`stripValueDecoration`); trailing spaces and bold are the line's.
    const parts = stripValueDecoration(m[1]).replace(/(?:[ \t]|\*\*)+$/, '').split(MAILBOX_SEPARATOR);
    if (parts.length !== 4) return unreadable;
    const session = CLAIM_SESSION.exec(parts[0]);
    const head = HOLD_HEAD.exec(parts[1]);
    const reason = parts[2].trim();
    const until = HOLD_UNTIL.exec(parts[3].trim());
    // A reason that is itself the `until` clause means the reason was left out.
    if (!session || !head || reason === '' || /^until\b/.test(reason) || !until) return unreadable;
    return { state: 'read', session: session[1], head: head[1].toLowerCase(), reason, until: until[1].trim() };
  }
  return { state: 'missing' };
}

/**
 * Is a lane holding this pull request's current head, read off its comment thread:
 *
 *   live        the NEWEST hold line names the current head -- gap rule (b) does not fire;
 *               `overdue` is true once it was posted CONTRACT_REVIEW_HOLD_LIST_HOURS ago or more
 *               (a reading the round record lists; the hold still holds), null when the comment
 *               carries no stamp to time it from
 *   stale       the newest hold line names an earlier head -- the head moved, the hold is cleared
 *   absent      no hold line on any comment
 *   unreadable  the thread, the head or the clock could not be read, or the newest hold line cannot
 *               be graded -- it holds nothing
 *
 * Newest governs and the head is matched by PREFIX, exactly as `contractReviewHandoff` reads its line.
 *
 * @param {{ id?: number, body?: string, created_at?: string }[]} rows  the PR's comment rows
 * @param {string} headSha  the pull request's current head
 * @param {{ now: number }} clock  milliseconds since the epoch
 */
export function contractReviewHold(rows, headSha, { now } = {}) {
  const gaps = [];
  if (!Array.isArray(rows)) gaps.push("the pull request's comment thread");
  const head = String(headSha ?? '').toLowerCase();
  if (head.length < H51_SHA_MIN_HEX) gaps.push("the pull request's head sha");
  if (!Number.isFinite(now)) gaps.push("the clock the hold's age is read on");
  if (gaps.length > 0) return { state: 'unreadable', gaps };
  const newest = latestMarkedComment(rows, CONTRACT_REVIEW_HOLD_MARKER);
  if (!newest) return { state: 'absent', read: rows.length };
  const row = rows[newest.index];
  const line = readContractReviewHold(row?.body);
  const stamp = { id: row?.id ?? null, at: row?.created_at ?? null };
  if (line.state !== 'read') return { state: 'unreadable', gaps: [`the newest hold line (comment ${stamp.id ?? '?'}) cannot be read: ${line.line ?? 'no line'}`], ...stamp };
  const reading = { session: line.session, head: line.head, reason: line.reason, until: line.until, ...stamp };
  if (!shaMeets(head, line.head)) return { state: 'stale', ...reading };
  const posted = Date.parse(row?.created_at ?? '');
  const ageMinutes = Number.isFinite(posted) ? Math.max(0, Math.floor((now - posted) / 60000)) : null;
  const overdue = ageMinutes === null ? null : ageMinutes >= CONTRACT_REVIEW_HOLD_LIST_HOURS * 60;
  return { state: 'live', ...reading, ageMinutes, overdue };
}

// ---------------------------------------------------------------------------
// The mailbox DOORBELL — seven first-line keys, a CLOSED vocabulary
// ---------------------------------------------------------------------------

/**
 * The seven keys a mailbox comment may open with — the doorbell a seat rings
 * on a sibling seat's or the triage seat's mailbox PR (`pm:mailbox`, one per
 * seat, opened by `mailbox-open.mjs`), because only a comment on a PR wakes
 * the session subscribed to it; a line on an issue wakes nobody. The protocol
 * text is the pm-dispatch skill's `references/project-forms.md` 〈信箱 PR〉,
 * and this list is its spelling in code: `template` is the line exactly as
 * that text prints it, placeholders included, and the self-test pins each one
 * verbatim in that file, so the text and the reader cannot drift apart.
 *
 * The rules the reader enforces, from the same text: the FIRST line of the
 * comment is the key and nothing else is allowed on a mailbox; one event, one
 * line, at most {@link MAILBOX_LINE_MAX_BYTES} bytes, keys and numbers only —
 * reasons and readings stay on the card or the PR; no acknowledgement; no
 * re-send. Anything outside the table is a half-state. The vocabulary is
 * CLOSED on the maintainer's word (「只沟通必要的信息」): an eighth key is
 * refused here, never added by a reader that happens to want one.
 *
 * ⛔ No gate, workflow or queue guard reads a mailbox: coordination, never a
 * merge condition. `readMailboxLine` and `mailboxEvents` are the reading a seat
 * or a patrol takes; nothing here changes an exit.
 */
export const MAILBOX_KEYS = Object.freeze([
  { id: 'request:contract-review', kind: 'Request', key: 'contract-review', from: 'lane', to: 'triage', template: 'Request: contract-review · PR #n · head SHA · REASON' },
  { id: 'request:urgent-triage', kind: 'Request', key: 'urgent-triage', from: 'any seat', to: 'triage', template: 'Request: urgent-triage · #n · ONE-LINE-CRITERION' },
  { id: 'request:main-red', kind: 'Request', key: 'main-red', from: 'the finding seat', to: 'triage, or the director when triage is absent', template: 'Request: main-red · CHECK-NAME · anchor #n · suggested lane X' },
  { id: 'notify:contract-review', kind: 'Notify', key: 'contract-review', from: 'triage', to: 'lane', template: 'Notify: contract-review PASS or FAIL · PR #n · record ID' },
  { id: 'notify:seat-online', kind: 'Notify', key: 'seat-online', from: 'the seating session', to: 'the lane\'s sibling seats and triage', template: 'Notify: seat-online · LANE#N · LOGIN · mailbox #m · takes: #a #b …' },
  { id: 'notify:seat-offline', kind: 'Notify', key: 'seat-offline', from: 'the signing-off session', to: 'the lane\'s sibling seats and triage', template: 'Notify: seat-offline · LANE#N · in-flight: … · stay-behind: … · brief ID' },
  { id: 'notify:split', kind: 'Notify', key: 'split', from: 'a seat of a multi-seat lane', to: 'its sibling seats', template: 'Notify: split · LANE#N · takes: … · leaves: …' },
]);
/** One event, one line: the longest a mailbox line may be, in bytes (the text's 「≤200 字节」). */
export const MAILBOX_LINE_MAX_BYTES = 200;
/** The two kinds, in `keyLineRegex`'s one convention as ONE alternation — a third kind cannot arrive unnoticed. */
const MAILBOX_KINDS = Object.freeze(['Request', 'Notify']);
const MAILBOX_KEY_LINE = keyLineRegex(`(${MAILBOX_KINDS.join('|')})`);
/** ` · ` — the middle dot the templates spell between fields; the spaces around it are optional. */
const MAILBOX_SEPARATOR = /[ \t]*·[ \t]*/;
const NUMBER_REF = /^#([1-9][0-9]*)$/;
const PR_REF = /^PR #([1-9][0-9]*)$/;
const HEAD_REF = /^head `?([0-9a-fA-F]{7,40})`?$/;
const ANCHOR_REF = /^anchor #([1-9][0-9]*)$/;
const MAILBOX_REF = /^mailbox #([1-9][0-9]*)$/;
const RECORD_REF = /^record `?#?([1-9][0-9]*)`?$/;
const BRIEF_REF = /^brief `?#?([1-9][0-9]*)`?$/;
const LANE_REF = /^suggested lane ([A-Za-z][A-Za-z0-9:_-]*)$/;
const VERDICT_REF = /^contract-review (PASS|FAIL)$/;
/** `LANE#N` — `domain:skills#2`, `skills#1`, or a seat that carries no number (`triage`, `director`). */
const SEAT_REF = /^([A-Za-z][A-Za-z0-9:_-]*)(?:#([1-9][0-9]*))?$/;
/** GitHub's own login rule, as `mailbox-open.mjs` spells it for `--login`: alphanumerics and single inner hyphens, ≤ 39. */
const LOGIN_REF = /^[A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38}$/;
/** The attribution block the platform APPENDS to a comment (AGENTS.md): a rule line and the bare or session-URL footer. Not a second line. */
const FOOTER_RULE = /^-{3,}$/;
const FOOTER_LINE = /^_Generated by \[Claude Code\]\(https:\/\/claude\.ai\/code(?:\/session_[A-Za-z0-9]+)?\)_$/;

/** `LANE#N` → `{ lane, n }`, or null. */
function readSeat(part) {
  const m = SEAT_REF.exec(String(part ?? '').trim());
  return m ? { lane: m[1], n: m[2] === undefined ? null : Number(m[2]) } : null;
}

/** `NAME: #a #b …` → the numbers; `NAME: none` → `[]`; anything else (a comma, a word, an empty list) → null. */
function readList(part, name) {
  const m = new RegExp(`^${name}:[ \\t]*(.*)$`).exec(String(part ?? '').trim());
  if (!m) return null;
  const rest = m[1].trim();
  if (rest === 'none') return [];
  if (rest === '') return null;
  const items = rest.split(/[ \t]+/).map((item) => NUMBER_REF.exec(item)?.[1]);
  return items.every((n) => n !== undefined) ? items.map(Number) : null;
}

/**
 * One reader per key: the ` · `-split parts in (the key word is `parts[0]`), the
 * fields out, or null when the line does not spell the template. `numbers` is
 * every card, PR or mailbox NUMBER the line names, in order — never a seat
 * number, which is not a thing on the board.
 */
const MAILBOX_FIELD_READERS = Object.freeze({
  'request:contract-review': (p) => {
    if (p.length < 4) return null;
    const pr = PR_REF.exec(p[1]);
    const head = HEAD_REF.exec(p[2]);
    const reason = p.slice(3).join(' · ').trim();
    return pr && head && reason !== '' ? { pr: Number(pr[1]), head: head[1], reason, numbers: [Number(pr[1])] } : null;
  },
  'request:urgent-triage': (p) => {
    if (p.length < 3) return null;
    const card = NUMBER_REF.exec(p[1]);
    const criterion = p.slice(2).join(' · ').trim();
    return card && criterion !== '' ? { card: Number(card[1]), criterion, numbers: [Number(card[1])] } : null;
  },
  'request:main-red': (p) => {
    if (p.length !== 4) return null;
    const check = p[1].trim();
    const anchor = ANCHOR_REF.exec(p[2]);
    const lane = LANE_REF.exec(p[3]);
    return check !== '' && !/#/.test(check) && anchor && lane ? { check, anchor: Number(anchor[1]), lane: lane[1], numbers: [Number(anchor[1])] } : null;
  },
  'notify:contract-review': (p) => {
    if (p.length !== 3) return null;
    const verdict = VERDICT_REF.exec(p[0]);
    const pr = PR_REF.exec(p[1]);
    const record = RECORD_REF.exec(p[2]);
    return verdict && pr && record ? { verdict: verdict[1], pr: Number(pr[1]), record: Number(record[1]), numbers: [Number(pr[1])] } : null;
  },
  'notify:seat-online': (p) => {
    if (p.length !== 5) return null;
    const seat = readSeat(p[1]);
    const login = LOGIN_REF.test(p[2]) ? p[2] : null;
    const mailbox = MAILBOX_REF.exec(p[3]);
    const takes = readList(p[4], 'takes');
    return seat && login && mailbox && takes ? { seat, login, mailbox: Number(mailbox[1]), takes, numbers: [Number(mailbox[1]), ...takes] } : null;
  },
  'notify:seat-offline': (p) => {
    if (p.length !== 5) return null;
    const seat = readSeat(p[1]);
    const inFlight = readList(p[2], 'in-flight');
    const stayBehind = readList(p[3], 'stay-behind');
    const brief = BRIEF_REF.exec(p[4]);
    return seat && inFlight && stayBehind && brief ? { seat, inFlight, stayBehind, brief: Number(brief[1]), numbers: [...inFlight, ...stayBehind] } : null;
  },
  'notify:split': (p) => {
    if (p.length !== 4) return null;
    const seat = readSeat(p[1]);
    const takes = readList(p[2], 'takes');
    const leaves = readList(p[3], 'leaves');
    return seat && takes && leaves ? { seat, takes, leaves, numbers: [...takes, ...leaves] } : null;
  },
});

/**
 * What ONE mailbox comment says, read off its first line. Body in, reading out; nothing is fetched.
 *
 *   read        the first line is one of the seven keys and spells its template: `id`, `kind`, `key`,
 *               the key's own fields, and `numbers` (every card, PR or mailbox number the line names)
 *   refused     the first line is not a key line at all, or names a key outside the seven — free text,
 *               an acknowledgement, an eighth key: the half-state the text names
 *   unreadable  a known key whose line does not spell its template, runs over the byte cap, or is
 *               followed by a second line of content (the platform's appended footer is not one)
 *
 * The key is read in `keyLineRegex`'s one convention (a bullet, a blockquote, bold or backticks around
 * the key are decoration), the fields are split on ` · `, and a head is 7 to 40 hex as everywhere here.
 *
 * @returns {{ state: 'refused', reason: string, kind?: string, line?: string }
 *          | { state: 'unreadable', kind: string, reason: string, line: string }
 *          | { state: 'read', id: string, kind: string, key: string, numbers: number[] } & Record<string, unknown>}
 */
export function readMailboxLine(text) {
  // The key is the first line AFTER one leading signature line (`stripSignatureLine`, #27113): the
  // signature names who rang, and is neither the key nor a second line of content.
  const lines = stripSignatureLine(text).split(/\r?\n/);
  const at = lines.findIndex((l) => l.trim() !== '');
  if (at < 0) return { state: 'refused', reason: 'an empty comment' };
  const first = lines[at];
  const m = MAILBOX_KEY_LINE.exec(first);
  if (!m) return { state: 'refused', reason: 'the first line is not a `Request:` or `Notify:` key line', line: quoteLine(first) };
  const kind = m[1];
  const unreadable = (reason) => ({ state: 'unreadable', kind, reason, line: quoteLine(first) });
  const value = stripValueDecoration(m[2]).replace(/(?:[ \t]|\*\*|`)+$/, '');
  const parts = value.split(MAILBOX_SEPARATOR);
  const word = parts[0].trim().split(/[ \t]+/)[0];
  const entry = MAILBOX_KEYS.find((k) => k.kind === kind && k.key === word) ?? null;
  if (!entry) return { state: 'refused', kind, reason: `\`${kind}: ${word}\` is not one of the seven keys`, line: quoteLine(first) };
  if (Buffer.byteLength(first, 'utf8') > MAILBOX_LINE_MAX_BYTES) return unreadable(`over ${MAILBOX_LINE_MAX_BYTES} bytes — one event, one line, keys and numbers only`);
  const tail = lines.slice(at + 1).map((l) => l.trim()).filter((l) => l !== '');
  if (!tail.every((l) => FOOTER_RULE.test(l) || FOOTER_LINE.test(l))) return unreadable('more than one line — reasons and readings stay on the card or the PR');
  const fields = MAILBOX_FIELD_READERS[entry.id](parts.map((part) => part.trim()));
  if (fields === null) return unreadable(`does not spell \`${entry.template}\``);
  return { state: 'read', id: entry.id, kind, key: entry.key, ...fields };
}

/**
 * Every comment on a mailbox PR, read: what `readMailboxLine` makes of each row, stamped with the row's
 * `comment` (its id), `at` (`created_at` — the TIME a bell rang) and `by` (the author login), plus the
 * comment ids of the rows that are not a reading — the half-states a patrol reports. Rows in, readings
 * out; the newest is the last, as the thread orders them. The stamp is spread LAST so a reading's own
 * `id` (the key id) can never shadow the comment id.
 *
 * @param {{ id?: number, body?: string, created_at?: string, user?: { login?: string } }[]} rows
 */
export function mailboxEvents(rows) {
  if (!Array.isArray(rows)) return { state: 'unreadable', gaps: ["the mailbox's comment thread"] };
  const events = rows.map((row) => ({ ...readMailboxLine(row?.body), comment: row?.id ?? null, at: row?.created_at ?? null, by: row?.user?.login ?? null }));
  return { state: 'read', events, halfStates: events.filter((e) => e.state !== 'read').map((e) => e.comment) };
}

// ---------------------------------------------------------------------------
// The record TEMPLATE — the one machine-read artefact with nothing to copy (#18042)
// ---------------------------------------------------------------------------

/**
 * The placeholders the printed record ships with.
 *
 * ⭐ Every one of them PARSES through the readers that judge the real thing, so
 * a seat who copies the block and replaces nothing still gets a record whose
 * SHAPE is legible — what an unedited paste changes is whose record it is, never
 * whether it reads. That is exactly the property the four measured misses did
 * not have: `Implemented-by: branch claude/…` was never copied from anything, it
 * was composed from the prose rule one file over, and C4 refused all four as
 * HALF WRITTEN — two of them after they had already reached `main`.
 *
 * ⛔ The head placeholder is git's null oid, deliberately and not decoratively:
 * it is a hex code span, so `contractReviewHeadMatch` recognises the SHAPE and
 * the template is provably round-trippable — and it can prefix NO real head, so
 * a record pasted with the placeholder left in is read as a review of some other
 * head and C6 refuses it. Fail-closed in the one direction that matters.
 *
 * ⛔ No angle brackets in any of them. GitHub's body sanitizer eats tag-shaped
 * fragments, backticked ones included, so a placeholder spelled that way would
 * be eaten out of the very comment a seat pastes it into, and a template whose
 * placeholders vanish on arrival is worse than no template.
 */
export const RECORD_TEMPLATE_PLACEHOLDERS = Object.freeze({
  headSha: '0'.repeat(40),
  // ⛔ ASSEMBLED, never spelled as one span -- and for the same reason the
  // deleted sweep spelled its repo-shape example in two: the
  // dispatch derivation reads any quoted path-shaped literal in a module body
  // as the population this gate watches, and a branch placeholder names no
  // tracked file. Spelled whole, it made this family's ONLY declared literal a
  // dead one, which `check:declared-population-live` refuses out loud -- a gate
  // telling the derivation it reads a population while the derivation reads
  // none. Neither half carries a separator, so neither is admitted, and this
  // file goes on declaring no path population at all (it reads no file in the
  // tree). ⛔ Do not re-join these into one literal to tidy it.
  implementedBy: ['claude', 'issue-NNNN-slug'].join('/'),
  reviewedBy: 'session_SEATSESSIONID',
});

/**
 * The two slots of the at-tier record's `Scope:` line (ruling record 6184805932,
 * letter C): the `hits` floor, which `--paths` fills from `reviewScopeHits`, and
 * the files the reviewer read because those hunks make a claim about them,
 * which only the reviewer can name (`none` when there are none).
 *
 * ⭐ Kept apart from the placeholders above on purpose: those PARSE through the
 * readers that judge a record, and no reader reads `Scope:` — the queue guard is
 * unchanged by the ruling, so this line is the reviewer's statement to the seats
 * and the post-merge audit, never a landing fact. ⛔ No angle brackets, for the
 * same sanitizer reason, and no path separator, so neither reads as a path.
 */
export const RECORD_SCOPE_PLACEHOLDERS = Object.freeze({
  hits: 'PATH-ONE, PATH-TWO',
  cited: 'CITED-FILE',
});

/**
 * The record itself — the lines a seat copies, and nothing else.
 *
 * ⭐ Rendered from the same constants the readers compare against
 * (`CONTRACT_REVIEW_TIER_NAME` here, the two token grammars above), so the
 * template cannot teach a spelling this file refuses. The self-test drives THIS
 * function's output back through `locateReviewOfRecord`, `readServedTier` and
 * `contractReviewHeadMatch`, which is what makes "copy it" a safe instruction.
 *
 * ⛔ The head sha is a code span of its OWN. The live corpus wrote the whole
 * `Head-sha: …` pair inside one span, and `H51_SHA_SPAN` matches a span that is
 * hex and nothing else — so that spelling names no head, and a record written it
 * is read as a review of nothing. The key stays outside the span here.
 *
 * ⭐ `tierName` is the NAME the face maps to (`reviewFace`, `REVIEW_FACES`), and
 * defaults to `CONTRACT_REVIEW_TIER_NAME` — the tier of both path-read faces and
 * the only one a governed pull request can owe. ⛔ A name no face maps to is
 * REFUSED here rather than printed: the template cannot teach a spelling
 * `servedTierStands` refuses.
 *
 * ⭐ The at-tier record carries `Scope:` (ruling record 6184805932, letter C):
 * the `hits` floor, then `+` and the files read for those hunks' claims.
 * `scopeHits` fills the floor (`reviewScopeHits`); left out, it is the
 * placeholder. ⛔ Only at `CONTRACT_REVIEW_TIER`: the declaration face has no
 * hits, its whole review is the lane seat's own, and so it has no scope to state.
 * Plain text, ⛔ never a code span: a span is where `contractReviewHeadMatch`
 * looks for the head, and a path must never be a candidate for it.
 *
 * ⭐ Item ④, the design judgment, is a FOURTH section of this ONE record — the full review the
 * owner's order makes mandatory on a published schema, a skill or an ADR rides the record every
 * reader here already locates, so one record shape stays and no second record is read anywhere.
 * It prints on the schema, rules and narrowing faces and on the bare template, which is their tier
 * (`recordCarriesDesignJudgment`); ⛔ not below tier, so not on the declaration face. `faceId` says
 * which face; left out, the bare record.
 * The heading is prose to every reader in this file: the locator, the `Served-tier:` and head
 * readers are unchanged by it, which the self-test drives.
 *
 * @param {{headSha?: string, implementedBy?: string, reviewedBy?: string, tierName?: string, scopeHits?: string[], faceId?: string}} values
 * @returns {string[]}
 */
export function contractReviewRecordLines(values = {}) {
  const { headSha, implementedBy, reviewedBy } = { ...RECORD_TEMPLATE_PLACEHOLDERS, ...values };
  const tierName = values.tierName ?? CONTRACT_REVIEW_TIER_NAME;
  if (!REVIEW_TIER_NAMES.includes(tierName)) {
    throw new Error(`record-recognisers: no face maps to the tier name '${tierName}' — known: ${REVIEW_TIER_NAMES.join(', ')}`);
  }
  const face = values.faceId === undefined ? null : reviewFaceById(values.faceId);
  if (values.faceId !== undefined && face === null) {
    throw new Error(`record-recognisers: unknown face '${values.faceId}' — known: ${REVIEW_FACES.map((f) => f.id).join(', ')}`);
  }
  const designJudgment = recordCarriesDesignJudgment(face, tierName);
  const scopeHits = values.scopeHits === undefined ? RECORD_SCOPE_PLACEHOLDERS.hits : values.scopeHits.join(', ');
  return [
    '## Contract review',
    '',
    `Served-tier: \`${tierName}\``,
    `Head-sha: \`${headSha}\``,
    'Local-runs: none',
    ...(tierName === CONTRACT_REVIEW_TIER_NAME ? [`Scope: ${scopeHits} + ${RECORD_SCOPE_PLACEHOLDERS.cited}`] : []),
    '',
    '### ① Derived judgments',
    '',
    '### ② Semver level',
    '',
    '### ③ Boundary flags',
    '',
    ...(designJudgment ? ['### ④ Design judgment', ''] : []),
    `Implemented-by: \`${implementedBy}\``,
    `Reviewed-by: \`${reviewedBy}\``,
    '',
    '**VERDICT: PASS**',
  ];
}

/** Where the copyable region starts and ends, so "copy it" names a boundary. */
export const RECORD_TEMPLATE_FENCE_START = '----- copy from here; replace every placeholder -----';
export const RECORD_TEMPLATE_FENCE_END = '----- to here -----';

/**
 * ⭐ WHERE A REVIEW OF RECORD LIVES — the ONE set every reader in this regime
 * searches and every printed instruction names.
 *
 * The governed text decides this and the constant does not; what the constant
 * stops is TWO TOOLS ANSWERING IT DIFFERENTLY. The rule is quoted rather than
 * paraphrased because it IS the operative criterion, and untranslated because
 * rewriting a quoted ruling rewrites the ruling:
 *
 *   > 复核记录 = 一条评论落 PR 或卡，达档与默认档同形
 *
 * — `references/contract-review.md` 〈复核归属与资格〉, with SKILL.md
 * 〈入队与落地〉 saying the same in the same words
 * (「记录 = 同形评论落 PR 或卡」) and the landing check's own ① repeating it
 * (「即 PR 或卡上同形的复核记录」). Two carriers, one record.
 *
 * ⚖️ THE MEASURED COST of spelling that set twice, on one pull request in one
 * day: the skills seat posted its `## Contract review` on carrier card #18426
 * (comment 5716694216) — a location `--template` offers in those exact words —
 * and this file's `--pair` read it as a record on the card thread. The merge
 * queue's own guard read the PR thread ALONE, answered
 * 「0 comment(s) read on the PR thread」 and dequeued PR #18689 `CI_FAILURE`. A
 * SECOND COPY of the same comment, on the PR thread, is what cured it. The two
 * tools already shared every recogniser; what they did not share was the set of
 * threads to run them over.
 *
 * ⛔ So nothing here spells a thread set of its own. `locateReviewOfRecord`
 * builds the rows it searches from this list, `contractReviewTemplateLines`
 * builds the sentence it prints from it, and `check-governed-queue-guard.mjs`
 * fetches one thread per entry in it — which is what the cross-tool pin in this
 * file's self-test measures, by DRIVING that guard rather than by restating the
 * two sets beside each other.
 *
 *   `where`   the tag a located record carries, so a row can name its thread
 *   `rows`    the key a pair carries that thread's comment rows under
 *   `number`  the key a pair carries that thread's issue number under
 *   `words`   how that location is NAMED to a human, in reading order
 */
export const REVIEW_OF_RECORD_THREADS = Object.freeze([
  Object.freeze({ where: 'PR', rows: 'prComments', number: 'pr', words: 'the PR' }),
  Object.freeze({ where: 'card', rows: 'cardComments', number: 'card', words: 'its card' }),
]);

/**
 * The location in the words every instruction prints — DERIVED from the set
 * above, so an instruction can never offer a thread no reader searches.
 */
export const REVIEW_OF_RECORD_LOCATION = REVIEW_OF_RECORD_THREADS.map((thread) => thread.words).join(' or ');

/**
 * The grades `deliveryEvidence` answers with, STRONGEST FIRST — the ranking that
 * function already applies internally, written down here because a caller
 * choosing AMONG several delivered cards needs it as data and
 * `check-half-states.mjs` exports the relation rather than its ordering.
 *
 * ⛔ A MIRROR, so the self-test MEASURES it rather than trusting it: every
 * neighbouring pair is driven through `deliveryEvidence` on a body that could
 * grade either way, and the set is held equal to the kinds `deliveryEvidenceNote`
 * recognises. A grade added or reordered upstream reds here instead of silently
 * re-ranking a governance reading.
 */
export const DELIVERY_EVIDENCE_PRECEDENCE = Object.freeze(['closing-keyword', 'part-of', 'part-of-inline', 'branch-name']);

/**
 * The card a pull request DELIVERS, as a number — the other half of the pair a
 * record read needs, for a caller that holds the pull request and no board.
 *
 * ⭐ DERIVED THROUGH `deliveryEvidence`, never beside it: this function only
 * enumerates the numbers a body or a branch name could be naming, and then asks
 * the ONE relation H8 already asks whether each is delivered. So it can never accept a card that relation rejects, and the
 * precedence between a closing keyword, a `Part of` declaration and the branch
 * name stays where it is written down rather than being graded twice.
 *
 * ⛔ AMBIGUITY IS NOT RESOLVED, it is REPORTED. A body naming two cards at the
 * same strength delivers both, and picking one of them would decide which
 * thread a governance reading searches by an accident of number order. The
 * caller gets `card: null` and a reason it can print; on the queue guard that
 * is the REFUSING direction (no card thread is searched, so no record can be
 * found on one), which is the direction a governance reading is wrong in
 * safely.
 *
 * @param {object} pr — a REST pull row: `body`, and `head.ref` for the fallback
 * @returns {{ card: number, evidence: string } | { card: null, reason: string }}
 */
export function deliveredCardNumber(pr) {
  const body = String(pr?.body ?? '');
  const candidates = new Set([
    ...closingKeywordTargets(body).keys(),
    ...partOfTargets(body).keys(),
    ...[branchNameTarget(pr?.head?.ref)].filter((n) => n !== null && n !== undefined),
  ]);
  const delivered = [];
  for (const n of candidates) {
    const evidence = deliveryEvidence(pr, n);
    if (evidence === null) continue;
    delivered.push({ card: Number(n), evidence, rank: DELIVERY_EVIDENCE_PRECEDENCE.indexOf(evidence) });
  }
  if (delivered.length === 0) {
    return {
      card: null,
      reason:
        'its body names no card (no closing keyword and no `Part of` declaration) and its branch is not '
        + 'the protocol dev-branch shape, so no card thread could be located for it',
    };
  }
  const best = Math.min(...delivered.map((row) => row.rank));
  const strongest = delivered.filter((row) => row.rank === best);
  if (strongest.length > 1) {
    return {
      card: null,
      reason:
        `it delivers ${strongest.length} cards at the same strength (${strongest.map((row) => `#${row.card}`).join(', ')}, `
        + `${deliveryEvidenceNote(strongest[0].evidence)}), so WHICH card thread carries its record is not derivable `
        + 'from the pull request alone',
    };
  }
  return { card: strongest[0].card, evidence: strongest[0].evidence };
}

/**
 * What `--template` prints: the record, fenced, with the calibration around it.
 *
 * ⭐ The notes live OUTSIDE the fence and carry no key-initial line, so nothing
 * here can be mistaken for a second declaration by any reader in this file —
 * and a seat who copies the fenced region alone loses none of the record.
 *
 * ⭐ The ⛔ note is the whole card: the value is the FIRST thing after the colon.
 * Prose said so in `references/contract-review.md` and four consecutive readers
 * wrote a leading word anyway. A template shows it instead of saying it.
 */
export function contractReviewTemplateLines(values = {}) {
  const { face: faceId, paths, ...recordValues } = values;
  const { face, scopeHits } = templateFace({ face: faceId, paths });
  const tierName = face?.tierName ?? CONTRACT_REVIEW_TIER_NAME;
  const faceLine = face === null
    ? `                    No face asked: this is ${CONTRACT_REVIEW_TIER_NAME}, the tier of a schema or governed-path face.`
    : paths === undefined
      ? `                    Asked for the ${face.id} face: ${tierName}.`
      : `                    Read off --paths: the ${face.id} face, ${tierName}.`;
  return [
    'record-recognisers --template — the contract-review record of record, copyable. It is',
    `ONE comment on ${REVIEW_OF_RECORD_LOCATION}; the NEWEST one naming this head governs.`,
    '',
    '⛔ The value is the FIRST thing after the colon. A leading word — "branch ", "the dev on " —',
    '   IS the value as far as the reader is concerned, the pair is refused HALF WRITTEN, and a',
    '   half-written pair is worse than none: a record carrying neither line is a legacy verdict',
    '   and stays silent, so writing one line badly is the only way to be refused.',
    '',
    RECORD_TEMPLATE_FENCE_START,
    ...contractReviewRecordLines({ ...recordValues, tierName, ...(scopeHits === undefined ? {} : { scopeHits }), ...(face === null ? {} : { faceId: face.id }) }),
    RECORD_TEMPLATE_FENCE_END,
    '',
    "  · Served-tier     the NAME of the tier the review's FACE maps to, ⛔ never a model id, and EXACT:",
    "                    the PR's committed tree decides it. A published schema or a governed path anywhere in it ⇒",
    `                    ${CONTRACT_REVIEW_TIER_NAME} (--face schema or rules); neither, a \`Clause-②: no (narrowing)\``,
    `                    line on the PR body and changeset ⇒ ${CONTRACT_REVIEW_TIER_NAME} too (--face narrowing); else`,
    `                    the review owed by the \`Clause-②: yes\` line alone ⇒ ${TIER_DEFAULT_NAME} (--face declaration).`,
    faceLine,
    '                    An at-tier/total stamp control may precede it — 75/75, then the constant.',
    '  · Head-sha        the head you reviewed, 7 to 40 hex in a span of ITS OWN; a span holding',
    '                    the key as well is not a sha, and the record then names no head.',
    '  · Local-runs      `none` — the read-only shape held (the diff, the card and the head\'s check-runs;',
    '                    nothing built, run or re-run locally); or `probe — REASON`, naming the ONE local run',
    '                    the rule was broken for. A record without the line predates it and is not re-judged;',
    '                    a line present that reads neither is refused before the write.',
    `  · Scope           at ${CONTRACT_REVIEW_TIER_NAME} only: first the paths \`reviewFace\` returns as \`hits\` on`,
    "                    the PR's file list (--paths PATH... prints them filled in), then `+` and every other",
    '                    file those hunks make a claim about, read in the cited code (`+ none` if none); a rule',
    '                    and the gate that enforces it are one change, read as one. Widen it freely, ⛔ never',
    `                    below \`hits\`. The rest of a mixed diff is the lane seat's ACCEPT at ${TIER_DEFAULT_NAME},`,
    '                    named there; Tier H approval and the queue guard stay whole-PR. On the narrowing',
    '                    face the floor is every path of the diff outside the prose faces: no path is a remainder.',
    '  · ④ Design judgment  on the schema, rules and narrowing faces — the published spec, and the governed register,',
    '                    which holds the skills and ADR surfaces the full-review order names among its rows, and a',
    '                    declared narrowing; the declaration face alone carries no ④. For each `hits` file: does the',
    '                    change hold against the code it cites and the scenario it is accepted against? A skill file',
    "                    against the card's eval prompt and the spec it teaches on `main`; a schema file",
    '                    against the ruling or ADR it implements and its first consumer; an ADR against its',
    '                    first consumer and its execution plan. On the narrowing face, with no `hits`, the narrowing',
    '                    itself against the published spec on `main`: does it take a declared capability away at the',
    "                    consumer, or make the spec's own refusal real? The cited code is READ to judge it, never",
    '                    reviewed; a must-fix found here is a FAIL like any other.',
    '  · Implemented-by  the identity that produced the diff, read off the implementation claim:',
    "                    a mode:subagent dev's BRANCH, a mode:remote dev's session id.",
    '  · Reviewed-by     the session that RENDERS or ADOPTS the verdict — a session only. Prose',
    '                    naming the reviewing model is not an identity and compares to nothing.',
    '  · VERDICT         PASS or FAIL, in caps; FAIL strips the two carriers exactly as PASS does.',
    '  ⛔ Replace every placeholder. Left in, the null-oid head names no commit and the record is',
    '     read as a review of some other head — refused, never silently adopted.',
    '  ⛔ And keep angle brackets out of what you paste: the body sanitizer eats tag-shaped',
    '     fragments, backticked ones included, so a field spelled that way is stored short and',
    '     read as absent.',
  ];
}

/**
 * Which face a template is printed for — from `face` (a table id) or from `paths`
 * (the pull request's file list, read through `reviewFace` and
 * `reviewScopeHits`), ⛔ never both: two answers to one question would let a
 * seat print one face's tier beside another face's scope. An empty list is no
 * list, and is refused rather than read as the declaration face.
 *
 * ⛔ A list `reviewFace` reads UNREADABLE is refused too, with its reason: the
 * paths decide no face and the committed tree carries a changeset whose
 * `Clause-②:` line decides between the narrowing and the declaration face,
 * which no path list can read. Printing the declaration face there is the
 * cheaper tier for a narrowing, which is how this command answered a
 * narrowing-only pull request before the narrowing face existed.
 *
 * @returns {{ face: object|null, scopeHits: string[]|undefined }}
 */
function templateFace({ face: faceId, paths }) {
  if (faceId !== undefined && paths !== undefined) {
    throw new Error('record-recognisers: `face` and `paths` both given — the face is read off the paths, pass one');
  }
  if (paths !== undefined) {
    if (!Array.isArray(paths) || paths.length === 0) {
      throw new Error('record-recognisers: `paths` names no path — the face and the scope are read off a non-empty file list');
    }
    const read = reviewFace(paths);
    if (read.face === null) {
      throw new Error(
        `record-recognisers: ${read.reason} — read that \`Clause-②:\` line and pass \`--face narrowing\` ` +
        'when it carries the `(narrowing)` arm, else `--face declaration`, in place of `--paths`',
      );
    }
    return { face: reviewFaceById(read.face), scopeHits: reviewScopeHits(paths) };
  }
  const face = faceId === undefined ? null : reviewFaceById(faceId);
  if (faceId !== undefined && face === null) {
    throw new Error(`record-recognisers: unknown face '${faceId}' — known: ${REVIEW_FACES.map((f) => f.id).join(', ')}`);
  }
  return { face, scopeHits: undefined };
}

/** Where the brief's copyable region starts and ends. */
export const BRIEF_TEMPLATE_FENCE_START = '----- copy from here; replace every placeholder -----';
export const BRIEF_TEMPLATE_FENCE_END = '----- to here -----';

/** The placeholders the printed brief ships with — the four slots a seat fills. */
export const BRIEF_TEMPLATE_PLACEHOLDERS = Object.freeze({
  pr: 'PR-NUMBER',
  card: 'CARD-NUMBER',
  headSha: RECORD_TEMPLATE_PLACEHOLDERS.headSha,
  scratchpad: 'SCRATCHPAD',
});

/**
 * What `--brief-template` prints: the brief a seat hands its contract reviewer,
 * with the review's READ-ONLY shape built in.
 *
 * ⭐ Why a template and not the rule: `references/contract-review.md` states
 * the shape in one line (only the diff and the card are read; the check
 * conclusions come from the head's check-runs; the derived gate families are
 * ⛔ never re-run locally), and a seat writing the brief by hand dropped it —
 * measured on one shift, reviewers were told to open worktrees and re-run
 * pins, ablations and type checks, at 250k to 430k tokens per review. A brief
 * that carries the ⛔ lines cannot drop them by omission, and the record it
 * asks for carries `Local-runs:`, so a deviation from the shape is written
 * down where `readLocalRuns` reads it.
 *
 * ⭐ Adversarial by construction, as the rule asks (「简报写成对抗性」): the
 * inputs are the card, the PR and the check-runs — ⛔ not the dispatch order and
 * ⛔ not the dispatching seat's conclusions. The record's own template is named
 * rather than restated, so the two cannot drift.
 *
 * ⭐ At `CONTRACT_REVIEW_TIER` the brief states the review's SCOPE (ruling record
 * 6184805932, letter C): the `hits` floor — filled in when `paths` is given, and
 * then the record command is `--template --paths` over those hits, which reads
 * back the same face and the same floor — plus the files those hunks claim
 * about; widen freely, ⛔ never below `hits`. The declaration face states none.
 * The narrowing face is at tier with no `hits` (ruling record 6203713500,
 * letter B): its floor is every path of the diff outside the prose faces, and
 * the brief says so instead of handing the reviewer an empty floor and the whole
 * diff as the lane seat's remainder.
 *
 * ⭐ Item ④, on the faces whose record carries it (`recordCarriesDesignJudgment`): the brief
 * hands the reviewer the design judgment as an ADVERSARIAL instruction — hold the change against
 * the code it cites and the scenario it is accepted against, named per surface (a skill file
 * against the card's eval prompt and the spec it teaches, a schema file against the ruling or ADR
 * it implements and its first consumer, an ADR against its first consumer and its execution
 * plan), and try to break it — and the surface-file scope rule the owner refined
 * the order with: ④ judges the `hits` files only; lockfiles, generated output, changesets and
 * prose elsewhere in the PR are not reviewed, and the cited code is READ to judge them, never
 * reviewed. The narrowing brief carries ④ in the narrowing's own shape (ruling record 6442046166,
 * letter A): no `hits`, so the judgment is of the narrowing itself against the published spec on
 * `main` — a declared capability taken away at the consumer, or the spec's own refusal made real —
 * over the whole-diff floor; lockfiles, generated output, changesets and prose elsewhere are not
 * reviewed there either.
 */
export function contractReviewBriefLines(values = {}) {
  const { pr, card, headSha, scratchpad } = { ...BRIEF_TEMPLATE_PLACEHOLDERS, ...values };
  // The brief names the tier its face maps to, and the record command that prints that face's
  // record — so a brief for a declaration-only review cannot hand its reviewer the other tier.
  const { face, scopeHits } = templateFace({ face: values.face, paths: values.paths });
  const tierName = face?.tierName ?? CONTRACT_REVIEW_TIER_NAME;
  const atTier = tierName === CONTRACT_REVIEW_TIER_NAME;
  const designJudgment = recordCarriesDesignJudgment(face, tierName);
  const templateArgs = scopeHits !== undefined && atTier
    ? ` --paths ${scopeHits.join(' ')}`
    : face === null ? '' : ` --face ${face.id}`;
  const templateCommand = `node scripts/pm/record-recognisers.mjs --template${templateArgs}`;
  const scopeLines = !atTier ? [] : face?.id === 'narrowing' ? [
    "Scope — the narrowing is declared of the whole PR, never of a path: the floor is EVERY path of the diff outside the",
    `  prose faces (${RECORD_SCOPE_PLACEHOLDERS.hits}), plus every file those hunks make a claim about, read in the cited code.`,
    "  Widen it freely, ⛔ never below that floor; the record's `Scope:` line lists both. No path is the lane seat's remainder.",
    '  ④ judges the narrowing itself over that floor: lockfiles, generated output, changesets and prose elsewhere in',
    '  the PR are not reviewed; the published spec and the cited code are READ to judge it, never reviewed.',
    '',
  ] : [
    `Scope — the paths \`reviewFace\` returns as \`hits\` on this PR's file list: ${scopeHits?.join(', ') ?? RECORD_SCOPE_PLACEHOLDERS.hits};`,
    '  plus every file those hunks make a claim about, read in the cited code — a rule and the gate that enforces it',
    "  are one change, read as one. Widen it freely, ⛔ never below `hits`; the record's `Scope:` line lists both.",
    `  The rest of the diff is the lane seat's ACCEPT at \`${TIER_DEFAULT_NAME}\`, exactly as a standalone PR of those files.`,
    ...(designJudgment ? [
      '  ④ judges the `hits` files ONLY: lockfiles, generated output, changesets and prose elsewhere in the PR are',
      '  not reviewed; the cited code is READ to judge them, never reviewed.',
    ] : []),
    '',
  ];
  return [
    'record-recognisers --brief-template — the brief a seat hands its contract reviewer, copyable. The',
    "read-only shape is built in: keep every ⛔ line, they are the review's shape and not advice to it.",
    '',
    BRIEF_TEMPLATE_FENCE_START,
    `## Contract review brief — PR #${pr} @ \`${headSha}\` (card #${card})`,
    '',
    `You review at \`${tierName}\`. Render ONE \`## Contract review\` record on this head — its shape is`,
    `\`${templateCommand}\` — with a PASS or FAIL verdict, and post it as ONE comment`,
    `on ${REVIEW_OF_RECORD_LOCATION}.`,
    '',
    'Inputs — these and nothing else:',
    `  · card #${card}: its body and EVERY comment (rulings and earlier records included)`,
    `  · PR #${pr}: its body, its file list, and the net diff against \`main\` at \`${headSha}\``,
    `  · the check-runs on \`${headSha}\`: their conclusions ARE the gate verdicts`,
    "⛔ Not the dispatch order, ⛔ not the dispatching seat's own conclusions — this brief is adversarial by design.",
    '',
    ...scopeLines,
    '⛔ READ-ONLY. No worktree, no checkout, no build, no test run, no gate re-run, no ablation: the check-runs',
    '   on the head already answered every derived gate family, and a local run costs more than it returns.',
    "   If ONE probe is unavoidable, the record's `Local-runs:` line says `probe — REASON`; otherwise `none`.",
    `   Scratch space is \`${scratchpad}/pr-${pr}/\` alone; nothing there you did not write this round is read.`,
    '',
    "Judge, in the record's own sections:",
    '  ① Derived judgments — every accept-set and public-surface change the diff implies, each named right or wrong.',
    '  ② Semver level — the changeset (or `skip-changeset`) matches what the diff publishes, and the `Clause-②:` line.',
    '  ③ Boundary flags — every dev flag and every `open_questions` entry answered, or escalated.',
    ...(designJudgment && face?.id === 'narrowing' ? [
      '  ④ Design judgment — the narrowing itself, read against the published spec on `main`: does it take a',
      "     declared capability away at the consumer, or make the spec's own refusal real? A capability declared",
      '     and not delivered is an implementation gap, implemented or retired, ⛔ never narrowed at the consumer.',
      '     Read the spec and the cited code in the live tree, and try to break the design; name each finding',
      "     must-fix or should-fix. A must-fix is a FAIL. ⛔ Judge the tree, never the PR body's account of it.",
    ] : designJudgment ? [
      '  ④ Design judgment — for EVERY `hits` file: does the change hold against the code it cites and the',
      "     scenario it is accepted against? A skill file against the card's eval prompt and the spec it teaches",
      '     on `main`; a schema file against the ruling or ADR it implements and its first consumer; an ADR',
      '     against its first consumer and its execution plan. Read the cited code in the live tree, and',
      '     try to break the design; name each finding must-fix or should-fix.',
      "     A must-fix is a FAIL. ⛔ Judge the tree, never the PR body's account of it.",
    ] : []),
    "Sign `Implemented-by:` with the dev's branch and `Reviewed-by:` with your session id — the value is the FIRST",
    'thing after each colon.',
    BRIEF_TEMPLATE_FENCE_END,
  ];
}

/**
 * LOCATE the review of record for one pair -- read from the PR's thread AND the
 * card's, because the rule lets it live on either -- WITHOUT asking what state
 * the gate is in.
 *
 * ⭐ The gate-independent half, split out by #18174. `reviewOfRecord` (deleted
 * with the sweep) was this function under C6's population gate, and the two
 * readings had been one
 * function: a pair that owed no record answered `not-owed` BEFORE any thread
 * was read, so every row downstream of it inherited C6's scope whether or not
 * the fact it judges has that scope. C7's does not -- 「无此行不成裁决」 is a
 * property of a RECORD, on whatever pair carries one -- and the consequence was
 * measured on one board in one day: record 5661052272 (PR #18157 / card #17991,
 * non-gated) carried `Served-tier: 2433/2444, then `CONTRACT_REVIEW_TIER``, a
 * spelling this file's own reader answers `unreadable` for, and `--pair`
 * answered 0; the SAME spelling on objectui PR #9486 / card #9191 (record
 * 5662548425) was refused exit 4 -- because that pair's gate had been hung and
 * cleared. One rule, two answers, decided by a fact the rule does not mention.
 *
 * ⛔ The split moves no recognition. Every fact below -- the heading, the head
 * sha, the `Reviewed-by:` line, the newest-governs choice -- is the same one
 * C6 read before, in the same order; what moved is WHERE the population gate
 * sits, and it now sits on C6's own row rather than under both of them.
 *
 * ## The recognition shape, and why it is H51's and not a new one
 *
 * `check-half-states.mjs` H51 already reads "a contract-review verdict on THIS
 * head" out of a thread, and measured its shape over four live dialects: a
 * level-2 heading whose line begins `## Contract review`, plus the head sha
 * written as a code span somewhere in the comment. Both facts are IMPORTED
 * from it (`CONTRACT_REVIEW_HEADING_MARKER`, `contractReviewHeadMatch`) rather
 * than restated, and the newest such comment is chosen by the same
 * `latestMarkedComment` H47 resolves with. The filter is
 * `latestContractReviewOnHead`'s, spelled out here because that finder returns
 * an id and not the row, and the row is what the third fact is read from.
 *
 * ⭐ The third fact is the CARRIER the rule text names -- 「独立性对」: a
 * `Reviewed-by:` line, read by C4's own key regex so the two rows cannot
 * disagree about what one looks like. Its VALUE is not judged here: who
 * reviewed, and whether that is the implementer, is C4's row. This row asks
 * only that the record names a reviewer at all, which is what separates a
 * review of record from a dev's own report -- and from the shape the filing
 * sweep found on the seat's side: an ACCEPT paragraph carrying the head and the
 * line under a bold first line, with no heading anywhere.
 *
 * ⛔ Not read: the verdict WORD (the file's boundary, and the corpus already
 * spells it two ways) and the ①②③ items (prose the seat reads).
 *
 * @returns {{ state: 'unreadable', gaps: string[] }
 *          | { state: 'absent', read: { pr: number, card: number } }
 *          | { state: 'unsigned', where: 'PR'|'card', id: number|null, sha: string, at: string|null }
 *          | { state: 'found', where: 'PR'|'card', id: number|null, sha: string, at: string|null }}
 */
export function locateReviewOfRecord(pair, carriedHead = null) {
  const gaps = [];
  // \u2b50 THE THREAD SET IS READ FROM `REVIEW_OF_RECORD_THREADS`, never spelled
  // here: this loop, the template's printed sentence and the queue guard's
  // fetches are the three consumers of that one list, and the whole point of it
  // is that no two of them can name different threads (#18701).
  for (const thread of REVIEW_OF_RECORD_THREADS) {
    if (!Array.isArray(pair?.[thread.rows])) gaps.push(`${thread.where} #${pair?.[thread.number]}'s comment thread`);
  }
  const head = String(carriedHead ?? pair?.headSha ?? '');
  // A head too short to be matched by H51's span test can never find its
  // record, so it is a read that could not be made -- never an absent record.
  if (head.length < H51_SHA_MIN_HEX) gaps.push(`PR #${pair?.pr}'s head sha`);
  if (gaps.length > 0) return { state: 'unreadable', gaps };

  const tagged = REVIEW_OF_RECORD_THREADS.flatMap((thread) =>
    pair[thread.rows].map((row) => ({ row, where: thread.where })),
  );
  const onHead = tagged.filter(
    ({ row }) =>
      CONTRACT_REVIEW_HEADING_MARKER.test(String(row?.body ?? '')) &&
      contractReviewHeadMatch(row?.body, head) !== null,
  );
  const newest = latestMarkedComment(onHead.map(({ row }) => row), CONTRACT_REVIEW_HEADING_MARKER);
  if (!newest) {
    // ⭐ The ruled exception, consulted ONLY here — after the ordinary read found
    // nothing — so it turns an absence into a record and never the reverse. The
    // second read is pinned to the carried head AND to the record id the chain
    // names; depth is one, since the recursive call passes that head.
    if (carriedHead === null) {
      const carry = regenCarry(pair);
      if (carry.state === 'unreadable') return { state: 'unreadable', gaps: carry.gaps };
      if (carry.state === 'carried') {
        const back = locateReviewOfRecord(pair, carry.head);
        if ((back.state === 'found' || back.state === 'unsigned') && back.id === carry.record) {
          return { ...back, carriedFrom: carry.head, carriedHops: carry.hops };
        }
      }
    }
    return {
      state: 'absent',
      read: Object.fromEntries(REVIEW_OF_RECORD_THREADS.map((thread) => [thread.number, pair[thread.rows].length])),
    };
  }
  const { row, where } = onHead[newest.index];
  const found = {
    where,
    id: row?.id ?? null,
    sha: contractReviewHeadMatch(row?.body, head),
    at: row?.created_at ?? null,
    // The provenance fact C7 judges, read off the SAME comment this row chose,
    // so the two can never disagree about which verdict governs this head.
    served: readServedTier(row?.body),
  };
  const signed = String(row?.body ?? '').split(/\r?\n/).some((line) => REVIEWED_BY_LINE.test(line));
  return signed ? { state: 'found', ...found } : { state: 'unsigned', ...found };
}


// ---------------------------------------------------------------------------
// The self-test — the readers above, offline, and the queue guard driven once
// ---------------------------------------------------------------------------

// -- The self-test's own battery roster and floor (#13489) ------------------
//
// Moved with the readers it pins, out of `check-clause2-carriers.mjs`'s own
// battery: every case below exercised a function this file now owns, and the
// docblocks above cite them ("the self-test drives THIS function's output",
// "a MIRROR, so the self-test MEASURES it", "the cross-tool pin in this file's
// self-test"). A case that read a deleted row (C3, C4, C6's and C7's refusal
// text, the `--pair` exit) left with that row; where the same READING was
// pinned through a row, it is asserted here on the reader itself.
//
// What is pinned is the registered NAMES, not a number. Every section opens
// with `battery('<name>')`, every assertion is attributed to the battery most
// recently opened, and the floor requires the OPENED set to equal the DECLARED
// set with each battery at or above its own count. The counts are a FLOOR, not
// an equality -- adding cases is ordinary work and must not red. A battery
// BELOW its floor means cases stopped running; the remedy is to find what
// stopped registering.
const SELF_TEST_BATTERIES = Object.freeze({
  'the locator: the newest `## Contract review` on this head, on EITHER thread (#17302)': 18,
  '#18141: the head sha sits in a span of ITS OWN — the key-in-span spelling names no head': 7,
  'the `Served-tier:` reading — the tier that SERVED the record (#17915 · #18060 · #18174)': 27,
  '⭐ the 2026-09-20 ruling: a pure-regeneration head move KEEPS the record, decided on the COMMITTED trees': 22,
  '#18042: the copyable record TEMPLATE — the one machine-read artefact with nothing to copy': 29,
  '#18701: ONE thread set -- what the template STATES is what the queue guard READS': 17,
  'the `Local-runs:` reading — `none` or ONE named probe, judged when present; an absent line is not re-judged': 12,
  'the reviewer BRIEF template — the read-only shape a hand-written brief dropped, built in and printed': 18,
  '⭐ B′ with C: the review tier FOLLOWS THE FACE that made it owed — exact, never a floor': 23,
  '⭐ B′ with C: a PROSE-ONLY head move keeps the record, decided on the COMMITTED trees like a regeneration': 6,
  '⭐ letter C: the at-tier review of a mixed diff is SCOPED — `hits` plus what they claim, on the `Scope:` line': 18,
  '⭐ letter B: a declared NARROWING is a face of its own at CONTRACT_REVIEW_TIER — keyed on the `Clause-②:` line, exact': 17,
  '⭐ the `Contract-review-handoff:` line — names the current head ⇒ triage\'s review; head moved ⇒ stale; absent ⇒ the seat\'s own': 13,
  '⭐ the mailbox doorbell: the seven first-line keys read — kind, numbers, sha, login, time — and anything else refused': 21,
  '⭐ the signature line: the reader reads LANE#N · ACCOUNT · SESSION exactly, and one leading signature changes no first-line reading': 22,
  '⭐ the `Contract-review-claim:` line — session, FULL head, time; lapses on a moved head or after two hours; the lane wins a tie': 21,
  '⭐ the `Contract-review-hold:` line — session, head, reason, until; a new head clears it; at 24 hours it reads overdue and still holds': 19,
});

// DELETING an entry silences that battery's floor exactly as effectively as
// zeroing it, so the roster's own size is pinned too.
// Raised 8 → 10 with the two B′-with-C batteries (ruling record 6159870311): two batteries, two rows.
// Raised 10 → 11 with the letter-C scope battery (ruling record 6184805932): one battery, one row.
// Raised 11 → 12 with the letter-B narrowing-face battery (ruling record 6203713500): one battery, one row.
// Item ④ (the owner's full-review order, #25765) added no battery: the template battery's floor rose 19 → 27
// and the brief battery's 10 → 16, one pin per new printed line or face reading, so a pin that stops
// registering reds here instead of leaving the ④ lines unmeasured. The per-surface scenario lines
// and the governed-register wording added one pin to each: 27 → 28 and 16 → 17. Hanging ④ on the narrowing
// face (ruling record 6442046166, letter A) flipped three pins and added one to each: 28 → 29 and 17 → 18.
// Raised 12 → 13 with the hand-off battery (the maintainer's exhausted-tier rule): one battery, one row.
// Raised 13 → 14 with the mailbox doorbell battery (the maintainer's per-seat mailbox and its closed
// vocabulary): one battery, one row.
// Raised 14 → 15 with the signature-line battery (the maintainer's signed-post rule): one battery, one row.
// Raised 15 → 16 with the claim-line battery (the maintainer's one-claim-per-head rule): one battery, one row.
// Raised 16 → 17 with the hold-line battery (the maintainer's lane-hold rule): one battery, one row.
const SELF_TEST_BATTERY_FLOOR = 17;

// The key an assertion is filed under when no battery is open. It is not a
// declared battery, so it reds by the same set difference rather than silently
// inflating whichever battery happened to run last.
const UNATTRIBUTED_BATTERY = '(no battery open)';

// Set by `selfTest()` only after its verdict is printed, and read at the
// dispatch: a `return` that leaves the function above that line prints nothing
// and still exits 0 — a self-test that never finished, reported as one that
// passed (#13798). The self-test's own exit code stays load-bearing, so the
// handshake is a flag rather than a returned sentinel.
let selfTestReachedVerdict = false;

export async function selfTest() {
  const batterySeen = new Map();
  let openBattery = null;
  const battery = (name) => {
    openBattery = name;
  };
  const registerCase = () => {
    const b = openBattery ?? UNATTRIBUTED_BATTERY;
    batterySeen.set(b, (batterySeen.get(b) ?? 0) + 1);
  };
  const cases = [];
  const t = (name, ok, detail) => {
    registerCase();
    cases.push({ name, ok: Boolean(ok), detail });
  };
  const says = (s, frag) => typeof s === 'string' && s.includes(frag);

  // The reference record, in the shape measured on every 2026-09-09 specimen:
  // the `## Contract review` heading, the head as a code span, the authorship
  // lines and the `Served-tier:` line — whose token is the constant's NAME,
  // ⛔ never its value and never a spelled model id (#18060).
  const HEAD_9AF9 = '9af92aa3'; // the head the 2026-09-01 review judged, as the board abbreviated it.
  const RECORD_SESSION = 'session_01489YWhZEoHT9oXshiyywQy';
  const RECORD = (
    sha,
    lines = [
      '- **Implemented-by:** `claude/issue-13657-x`',
      `- **Reviewed-by:** \`${RECORD_SESSION}\``,
      `- **Served-tier:** 121/121 \`${CONTRACT_REVIEW_TIER_NAME}\``,
    ],
    at = '2026-09-01T08:50:00Z',
    id = 3301,
  ) => ({
    id,
    created_at: at,
    body: [`## Contract review (clause ②) — **PASS** · head \`${sha}\``, '', ...lines, '', '### ① Derived judgments', '- none', '### ② semver', '- patch', '### ③ Boundary flags', '- none'].join('\n'),
  });
  const RECORD_ON_9AF9 = RECORD(HEAD_9AF9);
  // A pair as the queue guard hands one over: both threads READ (arrays), the
  // head in hand. `null` for a thread is "could not be read", never "empty".
  const pairOf = (o) => ({ pr: 13864, card: 13657, headSha: HEAD_9AF9, prComments: [], cardComments: [], ...o });

  // -- the locator ------------------------------------------------------------
  battery('the locator: the newest `## Contract review` on this head, on EITHER thread (#17302)');
  const onPr = locateReviewOfRecord(pairOf({ prComments: [RECORD_ON_9AF9] }));
  t('the 2026-09-09 verdict shape on the PR thread reads FOUND', onPr.state === 'found');
  t('…naming where it was found, its id and the head span it names', JSON.stringify([onPr.where, onPr.id, onPr.sha]) === JSON.stringify(['PR', 3301, HEAD_9AF9]), JSON.stringify(onPr));
  const onCard = locateReviewOfRecord(pairOf({ cardComments: [RECORD_ON_9AF9] }));
  t('the same comment on the CARD thread reads FOUND too — the rule lets it live on either', onCard.state === 'found' && onCard.where === 'card');
  const absent = locateReviewOfRecord(pairOf({ prComments: [], cardComments: [{ id: 1, body: 'Claim: x' }] }));
  t('⭐ NO record on either thread is ABSENT, and states what was read — both threads, with their counts', absent.state === 'absent' && absent.read.pr === 0 && absent.read.card === 1, JSON.stringify(absent));
  t('⛔ a record naming an OLDER head is not a record on this head — 「head 后移或无结论才重挂」 read forwards', locateReviewOfRecord(pairOf({ prComments: [RECORD('0ldhead00')] })).state === 'absent');
  const ADOPTION = { id: 3302, created_at: '2026-09-01T08:52:00Z', body: `**Director seat adoption record** — the verdict below is adopted verbatim.\n\n---\n\n## Contract review (\`CONTRACT_REVIEW_TIER\`, isolated seat) — PR #13864 @ \`${HEAD_9AF9}\`\n\n- **Reviewed-by:** isolated subagent, adopted by \`${RECORD_SESSION}\`\n- **Implemented-by:** branch \`claude/issue-13657-x\`` };
  t('a director ADOPTION record — heading on a later line — reads FOUND: H51\'s fourth dialect, line-anchored', locateReviewOfRecord(pairOf({ prComments: [ADOPTION] })).state === 'found');
  t('a blockquoted heading still reads — H51 tolerates the `>` a seat writes without meaning it', locateReviewOfRecord(pairOf({ prComments: [{ ...RECORD_ON_9AF9, body: RECORD_ON_9AF9.body.replace(/^## /, '> ## ') }] })).state === 'found');
  t('⛔ a `###` sub-heading is not the marker', locateReviewOfRecord(pairOf({ prComments: [{ ...RECORD_ON_9AF9, body: RECORD_ON_9AF9.body.replace(/^## /, '### ') }] })).state === 'absent');
  t('⛔ the heading mentioned inside a paragraph is not the marker', locateReviewOfRecord(pairOf({ prComments: [{ ...RECORD_ON_9AF9, body: RECORD_ON_9AF9.body.replace(/^## /, 'see the ## ') }] })).state === 'absent');
  const DEV_REPORT = { id: 3303, created_at: '2026-09-01T08:40:00Z', body: `os-dev-report\n\n\`\`\`json\n{ "issue": 13657, "pr": "https://github.com/o/r/pull/13864", "summary": "landed at \`${HEAD_9AF9}\`" }\n\`\`\`` };
  t('⛔ a bare os-dev-report naming the head is NOT a record — the implementer is not the reviewer', locateReviewOfRecord(pairOf({ prComments: [DEV_REPORT], cardComments: [DEV_REPORT] })).state === 'absent');
  const SEAT_ACCEPT = { id: 3304, created_at: '2026-09-01T08:45:00Z', body: `**ACCEPT — PR #13864 (head \`${HEAD_9AF9}\`) reviewed in-seat at the contract-review tier** (skills seat, session \`${RECORD_SESSION}\`).\n\n- Implemented-by: os-dev subagent on branch \`claude/issue-13657-x\`.\n- Reviewed-by: the skills seat, this session — independence pair holds.` };
  t('⛔ a seat\'s ACCEPT paragraph — head and `Reviewed-by:` under a bold first line, NO heading — is NOT a record', locateReviewOfRecord(pairOf({ cardComments: [SEAT_ACCEPT] })).state === 'absent');
  const UNSIGNED = RECORD(HEAD_9AF9, ['- **Implemented-by:** branch `claude/issue-13657-x`'], '2026-09-01T08:50:00Z', 3305);
  const unsigned = locateReviewOfRecord(pairOf({ prComments: [UNSIGNED] }));
  t('a heading comment on this head with NO `Reviewed-by:` line reads UNSIGNED, naming the comment', unsigned.state === 'unsigned' && unsigned.id === 3305);
  t('the NEWEST heading comment on this head governs — a signed record after an unsigned one reads FOUND', locateReviewOfRecord(pairOf({ prComments: [UNSIGNED, RECORD(HEAD_9AF9, undefined, '2026-09-01T08:55:00Z', 3306)] })).state === 'found');
  t('…and an unsigned one after a signed one is the reading, in either arrival order', locateReviewOfRecord(pairOf({ prComments: [RECORD(HEAD_9AF9, [], '2026-09-01T08:55:00Z', 3307), RECORD(HEAD_9AF9, undefined, '2026-09-01T08:50:00Z', 3306)] })).state === 'unsigned');
  t('`Reviewed-by:` is read by the one key regex — bullets, bold and backticks read; a different CASE does not', locateReviewOfRecord(pairOf({ prComments: [RECORD(HEAD_9AF9, ['- **`Reviewed-by`**: `session_x`'])] })).state === 'found' && locateReviewOfRecord(pairOf({ prComments: [RECORD(HEAD_9AF9, ['REVIEWED-BY: `session_x`'])] })).state === 'unsigned');
  const noPrThread = locateReviewOfRecord(pairOf({ prComments: null }));
  t('an UNREADABLE PR thread is UNREADABLE, never absent — and the gap names the thread', noPrThread.state === 'unreadable' && noPrThread.gaps.some((g) => g.includes('PR #13864\'s comment thread')), JSON.stringify(noPrThread));
  const shortHead = locateReviewOfRecord(pairOf({ headSha: 'abc' }));
  t('a head sha too short to match is UNREADABLE, not absent — and the gap names the head', shortHead.state === 'unreadable' && shortHead.gaps.some((g) => g.includes('head sha')));
  t('`reviewed-by` is ONE regex, built by the one key-line convention — never a second spelling', REVIEWED_BY_LINE.source === keyLineRegex('Reviewed-by').source && REVIEWED_BY_LINE.test('Reviewed-by: `session_x`'));

  // -- #18141: the head sha's span holds the sha ALONE -----------------------
  //
  // The accept set is exactly one spelling: the head in a code span of its OWN.
  // The live corpus once wrote `Head-sha: …` inside ONE span, which names no
  // head, so a complete review written that way reads as no record at all.
  battery('#18141: the head sha sits in a span of ITS OWN — the key-in-span spelling names no head');
  // ⛔ Derived by collapsing the TEMPLATE's own line, never retyped: the key is
  // the key `--template` prints, so a template that renamed it reds here.
  const OWN_SPAN = contractReviewRecordLines({ headSha: HEAD_9AF9, implementedBy: 'claude/issue-13657-x', reviewedBy: RECORD_SESSION }).join('\n');
  const IN_SPAN = OWN_SPAN.replace(/^([A-Za-z-]+): `([0-9a-fA-F]{7,40})`$/m, '`$1: $2`');
  const KEYED_ROW = { id: 3401, created_at: '2026-09-01T08:50:00Z', body: IN_SPAN };
  const NEWER_RECORD = RECORD(HEAD_9AF9, undefined, '2026-09-01T08:55:00Z', 3403);
  t('⭐ the template writes the key OUTSIDE the span, and that record names the head', IN_SPAN !== OWN_SPAN && contractReviewHeadMatch(OWN_SPAN, HEAD_9AF9) === HEAD_9AF9);
  t('⛔ …and the SAME record with the key folded INTO the span names no head — the defect isolated to the fold', contractReviewHeadMatch(IN_SPAN, HEAD_9AF9) === null);
  t('⛔ so it is not a review of record: the accept set is still exactly one spelling', locateReviewOfRecord(pairOf({ prComments: [KEYED_ROW] })).state === 'absent');
  const RESCUED = { id: 3402, created_at: '2026-09-01T08:51:00Z', body: `${IN_SPAN}\n\nCross-file staleness, searched at \`${HEAD_9AF9}\`.` };
  t('⭐ the refused line BESIDE a bare sha span elsewhere in the prose reads FOUND — the spelling is the defect, not that comment', locateReviewOfRecord(pairOf({ prComments: [RESCUED] })).state === 'found');
  t('⭐ a correct record beside a refused one is FOUND, in either arrival order', locateReviewOfRecord(pairOf({ prComments: [KEYED_ROW, NEWER_RECORD] })).state === 'found' && locateReviewOfRecord(pairOf({ prComments: [RECORD(HEAD_9AF9, undefined, '2026-09-01T08:45:00Z', 3404), KEYED_ROW] })).state === 'found');
  t('…and the locator chooses the CORRECT one — a refused spelling is never chosen over it, and never chosen at all', locateReviewOfRecord(pairOf({ prComments: [KEYED_ROW, NEWER_RECORD] })).id === 3403 && locateReviewOfRecord(pairOf({ prComments: [RECORD(HEAD_9AF9, undefined, '2026-09-01T08:45:00Z', 3404), KEYED_ROW] })).id === 3404);
  t('the template and the reader name ONE spelling — and the printed template still round-trips', contractReviewHeadMatch(contractReviewTemplateLines({ headSha: HEAD_9AF9 }).join('\n'), HEAD_9AF9) === HEAD_9AF9);

  // -- the `Served-tier:` reading --------------------------------------------
  //
  // ⛔ No specimen spells a real model id in SOURCE. The at-tier one uses the
  // constant's NAME, the below-tier one an obviously synthetic value, and the
  // near-miss ones are DERIVED from the name. The one specimen that carries the
  // VALUE reaches it through the IMPORTED constant, and it is there to prove
  // the identifier is REFUSED (#18060).
  battery('the `Served-tier:` reading — the tier that SERVED the record (#17915 · #18060 · #18174)');
  const TIER_LINES = (value) => [
    '- **Implemented-by:** `claude/issue-13657-x`',
    `- **Reviewed-by:** \`${RECORD_SESSION}\``,
    `- **Served-tier:** \`${value}\``,
  ];
  const SERVED = (value, at = '2026-09-01T08:50:00Z', id = 3401) => RECORD(HEAD_9AF9, TIER_LINES(value), at, id);
  const servedOn = (rows) => locateReviewOfRecord(pairOf({ prComments: rows })).served;
  const BELOW = 'example-below-tier';
  t('⭐ AT TIER — the reference record\'s reading STANDS', servedTierStands(servedOn([RECORD_ON_9AF9])), JSON.stringify(servedOn([RECORD_ON_9AF9])));
  t('…and it declares it with the constant\'s NAME, so the record a seat posts carries NO model identifier', RECORD_ON_9AF9.body.includes(CONTRACT_REVIEW_TIER_NAME) && !RECORD_ON_9AF9.body.includes(CONTRACT_REVIEW_TIER));
  t('⭐ BELOW TIER — an off-tier value is READ, and does not stand', servedOn([SERVED(BELOW)]).state === 'read' && servedOn([SERVED(BELOW)]).value === BELOW && !servedTierStands(servedOn([SERVED(BELOW)])));
  const NO_TIER_LINE = RECORD(HEAD_9AF9, TIER_LINES('x').slice(0, 2), '2026-09-01T08:50:00Z', 3402);
  t('⭐ LINE MISSING — a record that declares nothing about what served it reads `missing`, and does not stand', servedOn([NO_TIER_LINE]).state === 'missing' && !servedTierStands(servedOn([NO_TIER_LINE])));
  t('a `Served-tier:` line with no readable token is STARTED-and-unreadable, not missing', servedOn([SERVED('')]).state === 'unreadable');
  t('⛔ a FAMILY prefix is refused — the comparison is EXACT, never a floor', !servedTierStands(servedOn([SERVED(CONTRACT_REVIEW_TIER_NAME.split('_')[0])])));
  t('⛔ …and so is a value that merely STARTS with the constant', !servedTierStands(servedOn([SERVED(`${CONTRACT_REVIEW_TIER_NAME}_EXAMPLE_SUFFIX`)])));
  t('⭐ the constant\'s VALUE — a literal model identifier — is refused, though it is what the reading once required', !servedTierStands(servedOn([SERVED(CONTRACT_REVIEW_TIER)])) && isModelIdentifierToken(servedOn([SERVED(CONTRACT_REVIEW_TIER)]).value));
  // ⛔ The specimen below is a model NOBODY has shipped, so it identifies no
  // model and spelling it lands no identifier -- the same device
  // `check-commit-card-trailers.mjs` uses to prove its own rule binds a SHAPE.
  t('⛔ a model id nobody has shipped binds too — the predicate reads a SHAPE, never a list', isModelIdentifierToken('claude-example-9-9') && !servedTierStands(readServedTier('Served-tier: `claude-example-9-9`')));
  t('the identifier predicate binds the constant\'s own VALUE, so a tier bump cannot slip past it', isModelIdentifierToken(CONTRACT_REVIEW_TIER) && !isModelIdentifierToken(CONTRACT_REVIEW_TIER_NAME) && !isModelIdentifierToken(BELOW));
  t('⛔ and the reading is NOT widened by any of it — one accepted token, and a missing line is still a refusal', servedTierStands(readServedTier(`Served-tier: \`${CONTRACT_REVIEW_TIER_NAME}\``)) && !servedTierStands(readServedTier('Served-tier: `CONTRACT_REVIEW_TIER_X`')) && readServedTier('no line here').state === 'missing');
  t('the value must be FIRST after the colon — prose in front is read as the value and compares unequal', readServedTier(`Served-tier: read 139/139 as ${CONTRACT_REVIEW_TIER_NAME}`).value === 'read');
  t('decoration around the key reads, exactly as it does for `Reviewed-by:`', readServedTier(`- **Served-tier:** \`${CONTRACT_REVIEW_TIER_NAME}\``).value === CONTRACT_REVIEW_TIER_NAME && readServedTier(`> Served-tier: ${CONTRACT_REVIEW_TIER_NAME}`).value === CONTRACT_REVIEW_TIER_NAME);
  t('⛔ a different CASE is a different key — one convention for machine spellings', readServedTier(`SERVED-TIER: ${CONTRACT_REVIEW_TIER_NAME}`).state === 'missing');
  t('the line is read anywhere in the comment — the rule asks the AUTHOR for the top, the reader refuses nobody over placement', servedTierStands(servedOn([RECORD(HEAD_9AF9, [...TIER_LINES(CONTRACT_REVIEW_TIER_NAME).slice(0, 2), '', 'some prose', ...TIER_LINES(CONTRACT_REVIEW_TIER_NAME).slice(2)])])));
  t('the NEWEST record on this head governs — a corrected record is the reading, never the older off-tier one', servedTierStands(servedOn([SERVED(BELOW), SERVED(CONTRACT_REVIEW_TIER_NAME, '2026-09-01T08:53:00Z', 3403)])));
  // ⭐ The LIVE spelling, corrected from a fixture against the board: the STAMP
  // CONTROL first, `75/75 \`<tier>\``. A reader that demanded the tier token
  // immediately after the colon would have refused every record written under
  // the rule it enforces, on day one.
  t('⭐ the LIVE value shape — stamp control, then the tier — reads at tier and stands', servedTierStands(readServedTier(`Served-tier: 75/75 \`${CONTRACT_REVIEW_TIER_NAME}\``)));
  t('…and the count is READ, not skipped', JSON.stringify(readServedTier(`Served-tier: 138/138 \`${CONTRACT_REVIEW_TIER_NAME}\``).stamps) === JSON.stringify({ atTier: 138, total: 138 }));
  t('…on a bulleted, bolded key too — the shape the seats actually post', servedTierStands(readServedTier(`- **Served-tier:** 102/102 \`${CONTRACT_REVIEW_TIER_NAME}\``)));
  t('⛔ a ZERO control is void — a zero counts only against a non-zero stamp count on the same transcript', servedTierStands(readServedTier(`Served-tier: 0/0 \`${CONTRACT_REVIEW_TIER_NAME}\``)) === false);
  t('⛔ a control that is not TOTAL is 回退证据, and the tier alone does not rescue it', servedTierStands(readServedTier(`Served-tier: 12/133 \`${CONTRACT_REVIEW_TIER_NAME}\``)) === false);
  t('⛔ a count with NO tier after it declares no tier — unreadable, never a reading', readServedTier('Served-tier: 75/75').state === 'unreadable');
  t('⭐ an ABSENT control is vacuous, never a refusal — the ruling\'s minimum is the tier alone', readServedTier(`Served-tier: \`${CONTRACT_REVIEW_TIER_NAME}\``).stamps === null && servedStampsHold(null));
  t('the control is judged by ONE predicate', servedStampsHold({ atTier: 5, total: 5 }) && !servedStampsHold({ atTier: 5, total: 6 }) && !servedStampsHold({ atTier: 0, total: 0 }));
  t('⛔ a below-tier value with a PERFECT control is still refused — the control never substitutes for the tier', servedTierStands(readServedTier('Served-tier: 99/99 example-below-tier')) === false);
  // #18174 — the continuation spelling measured on record 5661052272, which
  // this reader answers `unreadable` for, on EVERY record that carries it.
  const MEASURED_SPELLING = `2433/2444, then \`${CONTRACT_REVIEW_TIER_NAME}\``;
  t('⭐ THE MEASURED SPELLING — a continuation after the stamp control reads `unreadable`', readServedTier(`Served-tier: ${MEASURED_SPELLING}`).state === 'unreadable');
  t('…and does not stand, on whatever record carries it', !servedTierStands(servedOn([SERVED(MEASURED_SPELLING, '2026-09-14T08:17:29Z', 3501)])));

  // -- B′ with C: the review TIER follows the FACE that made it owed ----------
  //
  // Ruling record 6159870311 on #23352. ⛔ No specimen spells a tier VALUE: the
  // names are the constants', and the values are read from `dispatch-gates.mjs`.
  battery('⭐ B′ with C: the review tier FOLLOWS THE FACE that made it owed — exact, never a floor');
  const SCHEMA_PATH = ['packages', 'spec', 'src', 'data', 'field.zod.ts'].join('/');
  const SCHEMA_TEST_PATH = ['packages', 'spec', 'src', 'data', 'field.test.ts'].join('/');
  const RULES_PATH = '.claude/skills/pm-dispatch/references/contract-review.md';
  const DECL_PATHS = [['packages', 'rest', 'src', 'routes.ts'].join('/'), ['apps', 'console', 'src', 'i18n.ts'].join('/')];
  const AT = (name) => readServedTier(`Served-tier: 12/12 \`${name}\``);
  t('⭐ a published schema maps to CONTRACT_REVIEW_TIER', (() => { const f = reviewFace([SCHEMA_PATH]); return f.face === 'schema' && f.tierName === CONTRACT_REVIEW_TIER_NAME && f.hits.schema.join() === SCHEMA_PATH; })());
  t('⭐ governed rules text maps to CONTRACT_REVIEW_TIER — the register decides, every governed surface alike', ['AGENTS.md', RULES_PATH, ['skills', 'x', 'SKILL.md'].join('/'), ['.github', 'workflows', 'lint.yml'].join('/'), ['docs', 'adr', '0001-x.md'].join('/')].every((p) => { const f = reviewFace([p]); return f.face === 'rules' && f.tierName === CONTRACT_REVIEW_TIER_NAME && f.hits.rules.join() === p; }));
  t('⭐ a diff with NEITHER — the review owed by the `Clause-②: yes` line alone — maps to TIER_DEFAULT', (() => { const f = reviewFace(DECL_PATHS); return f.face === 'declaration' && f.tierName === TIER_DEFAULT_NAME && f.hits.schema.length === 0 && f.hits.rules.length === 0; })());
  t('⭐ a MIXED diff maps to CONTRACT_REVIEW_TIER on ONE hit, and names the path that decided', reviewFace([...DECL_PATHS, SCHEMA_PATH]).tierName === CONTRACT_REVIEW_TIER_NAME && reviewFace([...DECL_PATHS, 'AGENTS.md']).tierName === CONTRACT_REVIEW_TIER_NAME && reviewFace([...DECL_PATHS, 'AGENTS.md']).hits.rules.join() === 'AGENTS.md');
  t('…a schema hit outranks a governed one in the NAMING only — both faces map to the same tier', reviewFace([SCHEMA_PATH, 'AGENTS.md']).face === 'schema' && reviewFace([SCHEMA_PATH, 'AGENTS.md']).tierName === reviewFace(['AGENTS.md']).tierName);
  t('⛔ a spec TEST file is not a published schema — the suspect surface\'s own exception, imported, not respelled', reviewFace([SCHEMA_TEST_PATH]).face === 'declaration');
  t('the faces are the closed set of four, in decision order, and they map to exactly two NAMES', REVIEW_FACES.map((f) => f.id).join() === 'schema,rules,narrowing,declaration' && REVIEW_TIER_NAMES.join() === `${CONTRACT_REVIEW_TIER_NAME},${TIER_DEFAULT_NAME}`);
  t('⭐ a TIER_DEFAULT record STANDS on a declaration-only pull request', servedTierStands(AT(TIER_DEFAULT_NAME), reviewFace(DECL_PATHS).tierName));
  t('⛔ …and does NOT stand on a schema pull request, nor on a governed one', !servedTierStands(AT(TIER_DEFAULT_NAME), reviewFace([SCHEMA_PATH]).tierName) && !servedTierStands(AT(TIER_DEFAULT_NAME), reviewFace([RULES_PATH]).tierName));
  t('⭐ a CONTRACT_REVIEW_TIER record stands on the schema and governed faces', servedTierStands(AT(CONTRACT_REVIEW_TIER_NAME), reviewFace([SCHEMA_PATH]).tierName) && servedTierStands(AT(CONTRACT_REVIEW_TIER_NAME), reviewFace([RULES_PATH]).tierName));
  t('⛔ EXACT, never a floor, in BOTH directions — the contract-review NAME does not stand on the declaration face', !servedTierStands(AT(CONTRACT_REVIEW_TIER_NAME), reviewFace(DECL_PATHS).tierName));
  t('⛔ a tier name no face maps to stands NOTHING — a caller that lost the face fails closed', !servedTierStands(AT('TIER_FLOOR'), 'TIER_FLOOR') && !servedTierStands(AT(TIER_DEFAULT_NAME), null) && !servedTierStands(AT(TIER_DEFAULT_NAME), 'TIER_DEFAULT_X'));
  t('the one-argument call is unchanged — the contract-review face, as every governed reading always was', servedTierStands(AT(CONTRACT_REVIEW_TIER_NAME)) && !servedTierStands(AT(TIER_DEFAULT_NAME)));
  t('⭐ the default tier\'s VALUE is refused as an identifier and stands nowhere, while its NAME is no identifier', isModelIdentifierToken(TIER_DEFAULT) && !isModelIdentifierToken(TIER_DEFAULT_NAME) && !servedTierStands(AT(TIER_DEFAULT), reviewFace(DECL_PATHS).tierName));
  const DECL_TPL = contractReviewTemplateLines({ face: 'declaration' }).join('\n');
  const declOn = (body, headSha = RECORD_TEMPLATE_PLACEHOLDERS.headSha) => locateReviewOfRecord(pairOf({ headSha, prComments: [{ id: 3701, created_at: '2026-10-14T03:00:00Z', body }] }));
  t('⭐ `--face declaration`\'s template carries TIER_DEFAULT, round-trips through the locator and STANDS on that face', (() => { const r = declOn(DECL_TPL); return readServedTier(DECL_TPL).value === TIER_DEFAULT_NAME && r.state === 'found' && servedTierStands(r.served, reviewFace(DECL_PATHS).tierName); })());
  t('⛔ …and the same printed record does NOT stand on a governed face — the template cannot teach the wrong face', !servedTierStands(declOn(DECL_TPL).served, reviewFace([RULES_PATH]).tierName));
  t('the schema and rules faces print the contract-review NAME, byte-identical to the bare template\'s record', ['schema', 'rules'].every((id) => contractReviewTemplateLines({ face: id }).join('\n').includes(`Served-tier: \`${CONTRACT_REVIEW_TIER_NAME}\``)) && contractReviewRecordLines().join('\n') === contractReviewRecordLines({ tierName: CONTRACT_REVIEW_TIER_NAME }).join('\n'));
  t('⛔ no template spells a tier VALUE — neither the identifier shape nor the default tier\'s word', ['schema', 'rules', 'declaration', undefined].every((id) => { const text = contractReviewTemplateLines(id === undefined ? {} : { face: id }).join('\n'); return !isModelIdentifierToken(text) && !new RegExp(`\\b${TIER_DEFAULT}\\b`).test(text) && !text.includes(CONTRACT_REVIEW_TIER); }));
  t('⛔ a tier name or a face no table maps is REFUSED, never printed', (() => { try { contractReviewRecordLines({ tierName: 'TIER_FLOOR' }); return false; } catch { /* refused */ } try { contractReviewTemplateLines({ face: 'lane' }); return false; } catch { return true; } })());
  t('the brief names the face\'s tier and the face\'s record command', (() => { const b = contractReviewBriefLines({ face: 'declaration' }).join('\n'); return b.includes(`You review at \`${TIER_DEFAULT_NAME}\``) && b.includes('--template --face declaration') && !isModelIdentifierToken(b) && !new RegExp(`\\b${TIER_DEFAULT}\\b`).test(b); })());
  const faceCli = (args) => spawnSync(process.execPath, [fileURLToPath(import.meta.url), ...args], { encoding: 'utf8', timeout: 60_000 });
  t('⭐ `--template --face declaration` prints exactly that face\'s template and exits 0', (() => { const r = faceCli(['--template', '--face', 'declaration']); return r.status === 0 && r.stdout === `${DECL_TPL}\n`; })());
  t('⛔ `--face` naming no face is REFUSED with the usage, exit 1', (() => { const r = faceCli(['--template', '--face', 'lane']); return r.status === 1 && says(r.stderr, 'usage:'); })() && faceCli(['--template', '--face']).status === 1);
  t('`--brief-template --face declaration` prints exactly that face\'s brief', (() => { const r = faceCli(['--brief-template', '--face', 'declaration']); return r.status === 0 && r.stdout === `${contractReviewBriefLines({ face: 'declaration' }).join('\n')}\n`; })());

  // -- letter C: the at-tier review of a mixed diff is SCOPED ----------------
  //
  // Ruling record 6184805932 on #23578. The TIER is untouched (the battery
  // above); what moved is the SCOPE: `hits` plus the files their hunks claim
  // about, stated on the record's `Scope:` line, the rest the lane seat's
  // ACCEPT at the default tier. ⛔ No reader reads the line — the guard is
  // unchanged — so these cases pin what is PRINTED, and the thread-set battery
  // below drives the guard with the very record that carries it.
  battery('⭐ letter C: the at-tier review of a mixed diff is SCOPED — `hits` plus what they claim, on the `Scope:` line');
  const MIXED = [...DECL_PATHS, RULES_PATH, SCHEMA_PATH, RULES_PATH];
  const SCOPE_HEAD = 'c0ffee'.padEnd(40, '0');
  const scopeLineOf = (text) => String(text).split('\n').filter((line) => line.startsWith('Scope:'));
  const fenced = (lines) => lines.slice(lines.indexOf(RECORD_TEMPLATE_FENCE_START) + 1, lines.indexOf(RECORD_TEMPLATE_FENCE_END)).join('\n');
  t('⭐ the floor of a mixed diff is exactly its `hits` — schema first, each once — and the remainder is not in it', reviewScopeHits(MIXED).join() === [SCHEMA_PATH, RULES_PATH].join() && DECL_PATHS.every((p) => !reviewScopeHits(MIXED).includes(p)));
  t('…read off `reviewFace` itself, on every face — never a second classification', [MIXED, DECL_PATHS, [RULES_PATH], [SCHEMA_PATH, SCHEMA_TEST_PATH]].every((list) => { const { hits } = reviewFace(list); return reviewScopeHits(list).join() === [...new Set([...hits.schema, ...hits.rules])].join(); }));
  t('⛔ the declaration face has NO floor — its whole review is the lane seat\'s own', reviewScopeHits(DECL_PATHS).length === 0 && reviewScopeHits([SCHEMA_TEST_PATH]).length === 0);
  t('⭐ the at-tier record carries ONE `Scope:` line, right after `Local-runs:`, with both slots as placeholders', (() => { const rec = contractReviewRecordLines(); const i = rec.indexOf(`Scope: ${RECORD_SCOPE_PLACEHOLDERS.hits} + ${RECORD_SCOPE_PLACEHOLDERS.cited}`); return i > 0 && rec[i - 1] === 'Local-runs: none' && scopeLineOf(rec.join('\n')).length === 1; })());
  t('⛔ the declaration face\'s record carries none — no hits to floor, and no tier to scope', scopeLineOf(DECL_TPL).length === 0 && scopeLineOf(contractReviewRecordLines({ tierName: TIER_DEFAULT_NAME }).join('\n')).length === 0);
  t('⛔ the slots carry no angle bracket and no path separator, so a placeholder never reads as a path', Object.values(RECORD_SCOPE_PLACEHOLDERS).every((p) => !/[<>/]/.test(p)));
  t('⛔ the line is plain text, never a code span — a span is where the head is looked for', scopeLineOf(contractReviewTemplateLines({ paths: MIXED }).join('\n')).every((line) => !line.includes('`')));
  t('⭐ `paths` reads the face AND fills the floor: a mixed diff prints CONTRACT_REVIEW_TIER and its hits, not its remainder', (() => { const text = contractReviewTemplateLines({ paths: MIXED }).join('\n'); return readServedTier(text).value === CONTRACT_REVIEW_TIER_NAME && scopeLineOf(text).join() === `Scope: ${SCHEMA_PATH}, ${RULES_PATH} + ${RECORD_SCOPE_PLACEHOLDERS.cited}` && DECL_PATHS.every((p) => !text.includes(p)); })());
  t('…and that record still round-trips: FOUND on its head, and its tier STANDS on the face its paths put it on', (() => { const body = fenced(contractReviewTemplateLines({ paths: MIXED, headSha: SCOPE_HEAD })); const r = locateReviewOfRecord(pairOf({ headSha: SCOPE_HEAD, prComments: [{ id: 3801, created_at: '2026-10-15T10:00:00Z', body }] })); return r.state === 'found' && servedTierStands(r.served, reviewFace(MIXED).tierName); })());
  t('⭐ `paths` with no hit prints the declaration face\'s record, byte-identical to `--face declaration`\'s', fenced(contractReviewTemplateLines({ paths: DECL_PATHS })) === fenced(contractReviewTemplateLines({ face: 'declaration' })));
  t('⛔ `face` and `paths` together are REFUSED, and so is an empty list — never a guess between two answers', (() => { for (const v of [{ face: 'rules', paths: [RULES_PATH] }, { paths: [] }]) { try { contractReviewTemplateLines(v); return false; } catch { /* refused */ } try { contractReviewBriefLines(v); return false; } catch { /* refused */ } } return true; })());
  t('⭐ the at-tier brief states the scope: `hits`, the claimed files, widen-never-narrow, the remainder\'s ACCEPT tier', (() => { const b = contractReviewBriefLines().join('\n'); return says(b, '`reviewFace` returns as `hits`') && says(b, RECORD_SCOPE_PLACEHOLDERS.hits) && says(b, 'make a claim about') && says(b, 'never below `hits`') && says(b, '`Scope:` line lists both') && says(b, `ACCEPT at \`${TIER_DEFAULT_NAME}\``); })());
  t('⛔ the declaration-face brief states none', !says(contractReviewBriefLines({ face: 'declaration' }).join('\n'), '`Scope:` line'));
  t('⭐ the brief over `paths` names the hits and hands the reviewer `--template --paths` over THEM — which reads back the same face and floor', (() => { const b = contractReviewBriefLines({ paths: MIXED }).join('\n'); const hits = reviewScopeHits(MIXED); return says(b, `file list: ${hits.join(', ')};`) && says(b, `--template --paths ${hits.join(' ')}\``) && fenced(contractReviewTemplateLines({ paths: hits })) === fenced(contractReviewTemplateLines({ paths: MIXED })); })());
  t('…and over a declaration-only list it hands `--face declaration`, as the face table would', says(contractReviewBriefLines({ paths: DECL_PATHS }).join('\n'), '--template --face declaration`') && contractReviewBriefLines({ paths: DECL_PATHS }).join('\n') === contractReviewBriefLines({ face: 'declaration' }).join('\n'));
  t('⭐ `--template --paths` and `--brief-template --paths` print exactly the function output and exit 0', (() => { const a = faceCli(['--template', '--paths', ...MIXED]); const b = faceCli(['--brief-template', '--paths', ...MIXED]); return a.status === 0 && a.stdout === `${contractReviewTemplateLines({ paths: MIXED }).join('\n')}\n` && b.status === 0 && b.stdout === `${contractReviewBriefLines({ paths: MIXED }).join('\n')}\n`; })());
  t('⛔ `--paths` naming no path, or beside `--face` in either order, is REFUSED with the usage, exit 1', [['--template', '--paths'], ['--template', '--paths', RULES_PATH, '--face', 'rules'], ['--brief-template', '--face', 'rules', '--paths', RULES_PATH], ['--template', '--paths', '']].every((args) => { const r = faceCli(args); return r.status === 1 && says(r.stderr, 'usage:'); }));
  t('…and the usage names the flag, the face it reads and the line it fills', ['--paths PATH...', '`reviewFace`', '`Scope:`'].every((s) => usageLines().join('\n').includes(s)));

  // -- letter B: a declared NARROWING is a face of its own -------------------
  //
  // Ruling record 6203713500 on #23692 (letter B, maintainer 「B (推荐)」): ruling
  // C stands as a fourth face under B′ — a `Clause-②: no (narrowing)` line puts
  // the review at CONTRACT_REVIEW_TIER, exactly. The specimen path list is the
  // shape that met it: one changeset, one non-schema source file, one test — no
  // schema and no governed path, so the paths decide nothing and the line does.
  battery('⭐ letter B: a declared NARROWING is a face of its own at CONTRACT_REVIEW_TIER — keyed on the `Clause-②:` line, exact');
  const NARROW_PATHS = [
    ['.changeset', 'overlay-package-mismatch.md'].join('/'),
    ['packages', 'metadata-protocol', 'src', 'protocol.ts'].join('/'),
    ['packages', 'runtime', 'src', 'overlay-promotion.test.ts'].join('/'),
  ];
  const carrier = (line) => `---\n"@objectstack/metadata-protocol": minor\n---\n\n${line}\n\nTwo promotion doors now refuse what they accepted.\n`;
  const NARROW_ON = { declaredOn: [carrier('Clause-②: no (narrowing)')] };
  const faceOn = (line, paths = NARROW_PATHS) => reviewFace(paths, undefined, { declaredOn: [carrier(line)] });
  t('⭐ a narrowing-only path list with `Clause-②: no (narrowing)` on its changeset ⇒ the narrowing face, CONTRACT_REVIEW_TIER', (() => { const f = reviewFace(NARROW_PATHS, undefined, NARROW_ON); return f.face === 'narrowing' && f.tierName === CONTRACT_REVIEW_TIER_NAME && f.hits.schema.length === 0 && f.hits.rules.length === 0; })());
  t('⭐ …and a CONTRACT_REVIEW_TIER record STANDS on that pull request — the ruling\'s first half', servedTierStands(AT(CONTRACT_REVIEW_TIER_NAME), reviewFace(NARROW_PATHS, undefined, NARROW_ON).tierName));
  t('⛔ …and a TIER_DEFAULT record does NOT — exact, the ruling\'s second half', !servedTierStands(AT(TIER_DEFAULT_NAME), reviewFace(NARROW_PATHS, undefined, NARROW_ON).tierName));
  t('⭐ the line read off the PR BODY counts as well — the ruling writes the one spelling on both carriers', reviewFace(NARROW_PATHS, undefined, { declaredOn: [carrier('Clause-②: no'), 'Fixes #1\nClause-②: no (narrowing)\n'] }).face === 'narrowing');
  t('⭐ `Clause-②: yes` still maps to the declaration face and TIER_DEFAULT, and only that NAME stands on it', (() => { const f = faceOn('Clause-②: yes'); return f.face === 'declaration' && f.tierName === TIER_DEFAULT_NAME && servedTierStands(AT(TIER_DEFAULT_NAME), f.tierName) && !servedTierStands(AT(CONTRACT_REVIEW_TIER_NAME), f.tierName); })());
  t('…and so do a bare `no`, a `yes (widening)` and a carrier with no line at all — the declaration face is what REMAINS', ['Clause-②: no', 'Clause-②: yes (widening)', 'no declaration here'].every((line) => faceOn(line).face === 'declaration'));
  t('⭐ `yes (narrowing)` is the narrowing face — a diff that widens and narrows owes the narrowing review, as a mixed diff owes its hit', faceOn('Clause-②: yes (narrowing)').face === 'narrowing');
  t('⛔ a near-miss arm reads malformed and the face UNREADABLE — standing NO name, never a narrowing read as none', ['Clause-②: no (narrowed)', 'Clause-②: no (Narrowing)', 'Clause-②: no (widening)'].every((line) => { const f = faceOn(line); return f.face === null && f.tierName === null && /malformed/.test(f.reason) && !servedTierStands(AT(TIER_DEFAULT_NAME), f.tierName) && !servedTierStands(AT(CONTRACT_REVIEW_TIER_NAME), f.tierName); }));
  t('⛔ ONE reader: a line that QUOTES the spelling is no declaration, exactly as `readClause2Line` reads it', faceOn('- `Clause-②: no (narrowing)` is the spelling the ruling fixed').face === 'declaration');
  t('⛔ NO declaration handed on a tree that carries a changeset ⇒ UNREADABLE, never the cheaper tier — and the reason names the carrier', (() => { const f = reviewFace(NARROW_PATHS); return f.face === null && f.tierName === null && f.reason.includes(NARROW_PATHS[0]) && !servedTierStands(AT(TIER_DEFAULT_NAME), f.tierName); })());
  t('⛔ …an EMPTY `declaredOn`, or one holding no text, is no declaration either', [[], [null, 7]].every((declaredOn) => reviewFace(NARROW_PATHS, undefined, { declaredOn }).face === null));
  t('⭐ a tree with NO changeset and no declaration keeps the declaration face, exactly as the two-argument call read it', JSON.stringify(reviewFace(DECL_PATHS)) === JSON.stringify({ face: 'declaration', tierName: TIER_DEFAULT_NAME, words: reviewFaceById('declaration').words, hits: { schema: [], rules: [] } }));
  t('⭐ a schema or governed path decides BEFORE the line is read — byte-identical with a narrowing, a malformed line or none', [[SCHEMA_PATH], [RULES_PATH], [...NARROW_PATHS, RULES_PATH]].every((list) => ['Clause-②: no (narrowing)', 'Clause-②: no (narrowed)'].every((line) => JSON.stringify(reviewFace(list, undefined, { declaredOn: [carrier(line)] })) === JSON.stringify(reviewFace(list)))));
  // ⛔ A refusal inside a case is that case's red, never the battery's crash: without the row these
  // calls throw, and the run must still NAME every case that went red (the ablation reads them).
  const safely = (fn) => { try { return fn(); } catch { return false; } };
  const NARROW_TPL = safely(() => contractReviewTemplateLines({ face: 'narrowing' }).join('\n')) || '';
  t('⭐ `--face narrowing`\'s record carries CONTRACT_REVIEW_TIER and the `Scope:` line, round-trips through the locator and STANDS on the narrowing face', NARROW_TPL !== '' && (() => { const r = declOn(NARROW_TPL); return readServedTier(NARROW_TPL).value === CONTRACT_REVIEW_TIER_NAME && scopeLineOf(NARROW_TPL).length === 1 && r.state === 'found' && servedTierStands(r.served, reviewFace(NARROW_PATHS, undefined, NARROW_ON).tierName) && !servedTierStands(r.served, faceOn('Clause-②: yes').tierName); })());
  t('⭐ `--template --face narrowing` prints exactly that template and exits 0', (() => { const r = faceCli(['--template', '--face', 'narrowing']); return NARROW_TPL !== '' && r.status === 0 && r.stdout === `${NARROW_TPL}\n`; })());
  t('⭐ the narrowing brief reviews at CONTRACT_REVIEW_TIER, hands `--face narrowing`, and floors the WHOLE diff — no lane remainder', safely(() => { const b = contractReviewBriefLines({ face: 'narrowing' }).join('\n'); return b.includes(`You review at \`${CONTRACT_REVIEW_TIER_NAME}\``) && b.includes('--template --face narrowing`') && says(b, 'EVERY path of the diff outside the') && !says(b, `ACCEPT at \`${TIER_DEFAULT_NAME}\``) && !isModelIdentifierToken(b); }));
  t('⛔ `--paths` over that list is REFUSED, exit 1, naming `--face narrowing` — the brief that once answered TIER_DEFAULT there', ['--template', '--brief-template'].every((flag) => { const r = faceCli([flag, '--paths', ...NARROW_PATHS]); return r.status === 1 && r.stdout === '' && says(r.stderr, 'usage:') && says(r.stderr, '--face narrowing') && says(r.stderr, NARROW_PATHS[0]); }));

  // -- the 2026-09-20 ruling: a PURE REGENERATION keeps the record -----------
  battery('⭐ the 2026-09-20 ruling: a pure-regeneration head move KEEPS the record, decided on the COMMITTED trees');
  const NEW_HEAD = 'e1ae0257'; // the head a whole-tree regeneration produced, as the board abbreviated it.
  const PROV = (from = HEAD_9AF9, to = NEW_HEAD, record = 3301, id = 3350) => ({ id, created_at: '2026-09-01T09:10:00Z', body: `Regen-provenance: ${record} · \`${from}\` → \`${to}\` · \`git diff --name-only\` → (empty)` });
  const GIT_SEEN = [];
  const BASE = 'origin/main';
  // A fake git over COMMITTED trees. `moved` is the head-to-head name list,
  // `attrs` the `check-attr` answer, `own` the PULL REQUEST'S OWN delta at each
  // head (`merge-base BASE head` .. head) — the fact the carry-over arm reads.
  const GIT = (spec) => (args) => {
    GIT_SEEN.push(args.join(' '));
    if (args[0] === 'merge-base') return `mb-${args[2]}\n`;
    if (args[0] === 'check-attr') return spec.attrs;
    if (args[0] === 'rev-parse') return `${HEAD_9AF9}00\n`;
    const [, , , a, b] = args; // diff -z --name-only A B
    return a === HEAD_9AF9 && b === NEW_HEAD ? spec.moved : (spec.own?.[b] ?? '');
  };
  const REGEN_ONLY = { moved: 'packages/spec/api-surface/data.txt\0', attrs: 'packages/spec/api-surface/data.txt\0merge\0os-regen\0' };
  // (i) the loop the ruling measured: a merge-forward carries a hand-written path
  // ANOTHER pull request landed, beside this one's regeneration.
  const CARRY_OVER = { moved: 'packages/spec/api-surface/data.txt\0AGENTS.md\0', attrs: 'packages/spec/api-surface/data.txt\0merge\0os-regen\0AGENTS.md\0merge\0unspecified\0', own: {} };
  // (ii) an edit slipped in beside the regeneration: this PR's own delta at the new head names it.
  const SEAT_EDIT = { moved: 'packages/spec/api-surface/data.txt\0scripts/pm/x.mjs\0', attrs: 'packages/spec/api-surface/data.txt\0merge\0os-regen\0scripts/pm/x.mjs\0merge\0unspecified\0', own: { [NEW_HEAD]: 'scripts/pm/x.mjs\0' } };
  // (iii) the same path as (i), but the merge was RESOLVED BY HAND, so the new head no longer holds what main brought.
  const HAND_RESOLVED = { moved: 'AGENTS.md\0', attrs: 'AGENTS.md\0merge\0unspecified\0', own: { [NEW_HEAD]: 'AGENTS.md\0' } };
  const GIT_EMPTY = GIT(REGEN_ONLY);
  const GIT_HAND = GIT(SEAT_EDIT);
  const GIT_BLIND = () => { throw new Error(`fatal: bad object ${HEAD_9AF9}`); };
  const moved = (rows, runGit, over = {}) => pairOf({ headSha: NEW_HEAD, prComments: rows, runGit, baseRef: BASE, ...over });
  const CARRIED = () => moved([RECORD_ON_9AF9, PROV()], GIT_EMPTY);
  const withGit = (runGit, over) => moved([RECORD_ON_9AF9, PROV()], runGit, over);
  // the line and the chain, before any tree is touched
  t('the hop is READ off either thread, decorated or bare', regenProvenanceHops({ prComments: [PROV()], cardComments: [{ id: 9, body: '- **Regen-provenance**: `3301` · `aaaaaaa` -> `bbbbbbb`' }] }).length === 2);
  t('⛔ a line naming only one sha is not a hop — the tail after it is the seat\'s transcript and is unread', regenProvenanceHops({ prComments: [{ id: 9, body: `Regen-provenance: 3301 · \`${HEAD_9AF9}\`` }] }).length === 0);
  t('the chain walks BACK over several hops, oldest first', regenChainToHead({ headSha: 'cccccccc', prComments: [PROV(HEAD_9AF9, 'bbbbbbbb'), PROV('bbbbbbbb', 'cccccccc')] })?.map((h) => h.from).join() === `${HEAD_9AF9},bbbbbbbb`);
  t('⛔ two hops arriving at ONE head carry no chain — ambiguity is never ranked', regenChainToHead({ headSha: NEW_HEAD, prComments: [PROV(HEAD_9AF9), PROV('bbbbbbbb')] }) === null);
  t('⭐ the SAME hop on BOTH carriers is ONE hop, ⛔ not ambiguity — posting it twice must not kill the carry', regenChainToHead({ headSha: NEW_HEAD, prComments: [PROV()], cardComments: [PROV(HEAD_9AF9, NEW_HEAD, 3301, 3351)] })?.length === 1);
  t('…and it CARRIES end to end from there — the record is FOUND on the new head', locateReviewOfRecord(moved([RECORD_ON_9AF9, PROV()], GIT_EMPTY, { cardComments: [PROV(HEAD_9AF9, NEW_HEAD, 3301, 3351)] })).state === 'found');
  t('⛔ a thread with no line carries none, so the ordinary rule is untouched where nobody claims the exception', regenChainToHead(moved([RECORD_ON_9AF9])) === null && regenCarry(moved([RECORD_ON_9AF9])).state === 'none' && locateReviewOfRecord(moved([RECORD_ON_9AF9], GIT_EMPTY)).state === 'absent');
  // the tree test — and it reads COMMITTED trees, never the working one
  t('⭐ an EMPTY non-`merge=os-regen` diff CARRIES the record', regenCarry(CARRIED()).state === 'carried');
  t('…and a generated path DID move: the test named two COMMITS and read `.gitattributes` out of the new one', GIT_SEEN.includes(`diff -z --name-only ${HEAD_9AF9} ${NEW_HEAD}`) && GIT_SEEN.includes(`check-attr --source ${NEW_HEAD} -z merge --stdin`), GIT_SEEN.join(' | '));
  t('…so the record is FOUND on the new head, naming the head it actually judged and the hop count', (() => { const r = locateReviewOfRecord(CARRIED()); return r.state === 'found' && r.carriedFrom.startsWith(HEAD_9AF9) && r.carriedHops === 1; })());
  t('⛔ a HAND-WRITTEN path in the same range certifies nothing — refused, and the reason says which path', (() => { const r = regenCarry(moved([RECORD_ON_9AF9, PROV()], GIT_HAND)); return r.state === 'refused' && says(r.reason, 'scripts/pm/x.mjs'); })() && locateReviewOfRecord(moved([RECORD_ON_9AF9, PROV()], GIT_HAND)).state === 'absent');
  t('⛔ a chain whose hops name DIFFERENT records certifies nothing', regenCarry(moved([RECORD_ON_9AF9, PROV(HEAD_9AF9, 'bbbbbbbb', 3301), PROV('bbbbbbbb', NEW_HEAD, 9999)], GIT_EMPTY)).state === 'refused');
  t('⛔ a line naming a record the thread does not carry on that head leaves the record ABSENT', locateReviewOfRecord(moved([RECORD_ON_9AF9, PROV(HEAD_9AF9, NEW_HEAD, 9999)], GIT_EMPTY)).state === 'absent');
  // the environment that cannot answer — ⛔ never clean
  const blind = locateReviewOfRecord(moved([RECORD_ON_9AF9, PROV()], GIT_BLIND));
  t('⭐ a tree this checkout cannot reach is a GAP: UNREADABLE, ⛔ never carried and ⛔ never absent', regenCarry(moved([RECORD_ON_9AF9, PROV()], GIT_BLIND)).state === 'unreadable' && blind.state === 'unreadable');
  t('…and the gap names the remedy, so the reader knows what to fetch', blind.gaps?.some((g) => g.includes('git fetch origin pull/13864/head')), JSON.stringify(blind));
  t('⛔ a run holding NO git reader is a gap too — a claim nobody re-ran is not a certification', regenCarry(moved([RECORD_ON_9AF9, PROV()], undefined)).state === 'unreadable');
  t('the unexplained set is read from the ATTRIBUTE and the PR\'s own delta, ⛔ never from a path list spelled here', unexplainedPathsBetween(GIT_HAND, { from: HEAD_9AF9, to: NEW_HEAD, base: BASE }).join() === 'scripts/pm/x.mjs');
  // ⭐ the CARRY-OVER arm — 「every touched path is a generated artefact OR THE
  // MERGE COMMIT'S OWN CARRY-OVER FROM MAIN」.
  t('⭐ (i) a MERGE-FORWARD carrying ANOTHER PR\'s hand-written path beside the regeneration is CARRIED', regenCarry(withGit(GIT(CARRY_OVER))).state === 'carried' && locateReviewOfRecord(withGit(GIT(CARRY_OVER))).state === 'found');
  t('⛔ (iii) the SAME path, hand-resolved so the new head no longer holds what main brought, is REFUSED', (() => { const r = regenCarry(withGit(GIT(HAND_RESOLVED))); return r.state === 'refused' && says(r.reason, 'AGENTS.md'); })());
  t('⇒ the DELTA decides, ⛔ never the path name: one path, two specimens, two verdicts', unexplainedPathsBetween(GIT(CARRY_OVER), { from: HEAD_9AF9, to: NEW_HEAD, base: BASE }).length === 0 && unexplainedPathsBetween(GIT(HAND_RESOLVED), { from: HEAD_9AF9, to: NEW_HEAD, base: BASE }).join() === 'AGENTS.md');
  t('…and the delta is read ONCE PER HEAD against `merge-base BASE head`, ⛔ never once per path', GIT_SEEN.includes(`merge-base ${BASE} ${HEAD_9AF9}`) && GIT_SEEN.includes(`diff -z --name-only mb-${NEW_HEAD} ${NEW_HEAD}`), GIT_SEEN.slice(-4).join(' | '));
  t('⛔ (iv) a run naming NO base ref cannot tell main\'s carry-over from a hand edit — UNREADABLE, ⛔ never clean', (() => { const r = regenCarry(withGit(GIT(CARRY_OVER), { baseRef: null })); return r.state === 'unreadable' && r.gaps.some((g) => g.includes('base ref')); })());

  // ⭐ the PROSE arm (B′ with C, ruling record 6159870311): a head that moves only on faces outside the
  // review surface keeps the record — decided on the same committed trees, by the same line.
  battery('⭐ B′ with C: a PROSE-ONLY head move keeps the record, decided on the COMMITTED trees like a regeneration');
  const PROSE_MOVE = { moved: '.changeset/brave-owls.md\0content/docs/guides/x.mdx\0packages/core/CHANGELOG.md\0', attrs: '', own: { [NEW_HEAD]: '.changeset/brave-owls.md\0content/docs/guides/x.mdx\0' } };
  const PROSE_AND_CODE = { moved: '.changeset/brave-owls.md\0packages/core/src/kernel.ts\0', attrs: 'packages/core/src/kernel.ts\0merge\0unspecified\0', own: { [NEW_HEAD]: '.changeset/brave-owls.md\0packages/core/src/kernel.ts\0' } };
  t('⭐ a head that moved ONLY prose faces — the pull request\'s OWN changeset and docs edit — CARRIES the record', regenCarry(withGit(GIT(PROSE_MOVE))).state === 'carried' && locateReviewOfRecord(withGit(GIT(PROSE_MOVE))).state === 'found');
  t('…and nothing about it was read off the attribute: a prose path is explained by its face before `check-attr` runs', unexplainedPathsBetween(GIT(PROSE_MOVE), { from: HEAD_9AF9, to: NEW_HEAD, base: BASE }).length === 0);
  t('⛔ a CODE path moved beside the prose — refused, and the reason names the code path, never the changeset', (() => { const r = regenCarry(withGit(GIT(PROSE_AND_CODE))); return r.state === 'refused' && says(r.reason, 'packages/core/src/kernel.ts') && !says(r.reason, '.changeset/') && says(r.reason, 'prose-only'); })() && locateReviewOfRecord(withGit(GIT(PROSE_AND_CODE))).state === 'absent');
  t('the prose faces are the four the charter names: `.changeset/**`, any CHANGELOG.md, `content/docs/**`, `apps/docs/**`', ['.changeset/x.md', 'CHANGELOG.md', 'packages/spec/CHANGELOG.md', 'content/docs/a/b.mdx', 'apps/docs/app/page.tsx'].every((p) => isOutsideReviewSurface(p)));
  t('⛔ and nothing beside them: near-miss names, schema paths and governed rules text stay ON the review surface', ['.changesets/x.md', 'CHANGELOG.md.bak', 'docs/CHANGELOG.txt', 'content/docs-old/x.mdx', 'apps/docsite/x.ts', 'packages/spec/src/data/field.zod.ts', '.claude/skills/pm-dispatch/references/contract-review.md', 'AGENTS.md'].every((p) => !isOutsideReviewSurface(p)));
  t('⛔ a prose-only move with NO `Regen-provenance:` line carries nothing — the line still points the reader at the trees', regenCarry(moved([RECORD_ON_9AF9], GIT(PROSE_MOVE))).state === 'none' && locateReviewOfRecord(moved([RECORD_ON_9AF9], GIT(PROSE_MOVE))).state === 'absent');

  // -- the `Local-runs:` reading ---------------------------------------------
  //
  // Judged when present, and ONLY then: the three landed PASS records of the
  // day this line was added carry no line, and a reader that refused them
  // would re-open verdicts over a line nobody had been asked to write.
  battery('the `Local-runs:` reading — `none` or ONE named probe, judged when present; an absent line is not re-judged');
  const LR = (value) => `## Contract review\n\nServed-tier: \`${CONTRACT_REVIEW_TIER_NAME}\`\nLocal-runs: ${value}\n\n**VERDICT: PASS**`;
  t('⭐ `none` reads, and stands', readLocalRuns(LR('none')).value === 'none' && localRunsStand(readLocalRuns(LR('none'))));
  t('⭐ `probe — REASON` reads as a probe carrying its reason, and stands', (() => { const r = readLocalRuns(LR('probe — re-ran the one pin the check-run log truncated')); return r.value === 'probe' && r.reason === 're-ran the one pin the check-run log truncated' && localRunsStand(r); })());
  t('⛔ ABSENT stands and is NOT re-judged — the landed records carry no line', readLocalRuns(RECORD_ON_9AF9.body).state === 'missing' && localRunsStand(readLocalRuns(RECORD_ON_9AF9.body)));
  t('⛔ a probe with NO reason names no deviation — unreadable, and does not stand', readLocalRuns(LR('probe')).state === 'unreadable' && !localRunsStand(readLocalRuns(LR('probe'))) && readLocalRuns(LR('probe —')).state === 'unreadable');
  t('⛔ any other word is unreadable, never a reading — the two values are the closed set', readLocalRuns(LR('yes')).state === 'unreadable' && readLocalRuns(LR('re-ran everything')).state === 'unreadable' && !localRunsStand(readLocalRuns(LR('yes'))));
  t('⛔ an EMPTY value is started-and-unreadable, not missing', readLocalRuns(LR('')).state === 'unreadable');
  t('decoration reads: a backticked `none`, a bulleted bolded key, a blockquoted line', readLocalRuns(LR('`none`')).value === 'none' && readLocalRuns('- **Local-runs:** none').value === 'none' && readLocalRuns('> Local-runs: `probe — one pin`').value === 'probe');
  t('the separator is any of the four spellings, and the reason is what follows it', ['probe — r', 'probe -- r', 'probe - r', 'probe: r'].every((v) => readLocalRuns(LR(v)).reason === 'r'));
  t('the value compares case-insensitively — `None` and `PROBE` read', readLocalRuns(LR('None')).value === 'none' && readLocalRuns(LR('PROBE — r')).value === 'probe');
  t('the unreadable line is quoted back through the shared quoting helper, key included', readLocalRuns(LR('maybe')).line.includes('Local-runs') && readLocalRuns(LR('maybe')).line.includes('maybe'));
  t('the key is ONE regex, built by the one key-line convention — never a second spelling', LOCAL_RUNS_LINE.source === keyLineRegex('Local-runs').source);
  t('prose naming the key mid-sentence is not the line — the declaration is line-initial', readLocalRuns('the Local-runs: line goes here').state === 'missing');

  // -- the `Contract-review-handoff:` line --------------------------------------
  //
  // The maintainer's rule: a seat with a working contract-review tier reviews
  // its own dispatches; only an exhausted tier hands the review to triage, and
  // triage must be able to TELL that case apart from a label alone. The line is
  // the telling; these cases pin the three readings a seat or patrol takes.
  battery('⭐ the `Contract-review-handoff:` line — names the current head ⇒ triage\'s review; head moved ⇒ stale; absent ⇒ the seat\'s own');
  const HO_HEAD = '1b03a9c36be249502c1160b1f262f835f7ccaf02';
  const HO_LINE = (head = HO_HEAD, reason = 'HTTP 429', at = '2026-10-27T13:00Z') => `${CONTRACT_REVIEW_HANDOFF_KEY}: triage — ${CONTRACT_REVIEW_TIER_NAME} unavailable (${reason}, ${at}) · head ${head}`;
  const HO_ROW = (line, id = 4401, at = '2026-10-27T13:01:00Z') => ({ id, created_at: at, body: `Seat note — the review tier was refused this round.\n\n${line}\n\nLabel kept.` });
  t('⭐ the line names the CURRENT head ⇒ the review is triage\'s, with the reason, the time and the comment that handed it off', (() => { const r = contractReviewHandoff([HO_ROW(HO_LINE())], HO_HEAD); return r.state === 'triage' && r.head === HO_HEAD && r.reason === 'HTTP 429' && r.handedAt === '2026-10-27T13:00Z' && r.id === 4401; })());
  t('⭐ the head MOVED past the line ⇒ stale, naming the head the hand-off was for — a fresh line or the seat\'s own review', (() => { const r = contractReviewHandoff([HO_ROW(HO_LINE())], 'c260fddc'.padEnd(40, '0')); return r.state === 'stale' && r.head === HO_HEAD; })());
  t('⭐ NO hand-off line on any comment ⇒ absent, the seat\'s own review — a record, a seat note, a label mention change nothing', (() => { const r = contractReviewHandoff([RECORD_ON_9AF9, { id: 4402, created_at: '2026-10-27T13:02:00Z', body: 'ACCEPT — `needs:contract-review` stays until the seat reviews.' }], HO_HEAD); return r.state === 'absent' && r.read === 2; })());
  t('the head is matched by PREFIX, as a record\'s span is: an abbreviated head on the line names the full head, and the reverse', contractReviewHandoff([HO_ROW(HO_LINE(HO_HEAD.slice(0, 7)))], HO_HEAD).state === 'triage' && contractReviewHandoff([HO_ROW(HO_LINE(HO_HEAD))], HO_HEAD.slice(0, 8)).state === 'triage');
  t('NEWEST governs — an older line on an old head under a newer one on the current head reads triage\'s, and the reverse reads stale', contractReviewHandoff([HO_ROW(HO_LINE('deadbeef1'), 4403, '2026-10-27T12:00:00Z'), HO_ROW(HO_LINE(), 4404, '2026-10-27T13:30:00Z')], HO_HEAD).state === 'triage' && contractReviewHandoff([HO_ROW(HO_LINE(), 4403, '2026-10-27T12:00:00Z'), HO_ROW(HO_LINE('deadbeef1'), 4404, '2026-10-27T13:30:00Z')], HO_HEAD).state === 'stale');
  t('decoration reads: a bulleted bolded key, a backticked tier name, a backticked head, a blockquoted line', (() => { const dec = `> - **${CONTRACT_REVIEW_HANDOFF_KEY}:** triage — \`${CONTRACT_REVIEW_TIER_NAME}\` unavailable (quota exhausted, 2026-10-27T13:00Z) · head \`${HO_HEAD.slice(0, 12)}\``; const r = readContractReviewHandoff(dec); return r.state === 'read' && r.head === HO_HEAD.slice(0, 12) && r.reason === 'quota exhausted' && contractReviewHandoff([HO_ROW(dec)], HO_HEAD).state === 'triage'; })());
  t('the separator is any of the four spellings, and the reason may itself carry a comma — the time is the LAST item in the parentheses', ['—', '--', '-', ':'].every((sep) => readContractReviewHandoff(`${CONTRACT_REVIEW_HANDOFF_KEY}: triage ${sep} ${CONTRACT_REVIEW_TIER_NAME} unavailable (HTTP 429, quota exhausted, 2026-10-27T13:00Z) · head ${HO_HEAD}`).reason === 'HTTP 429, quota exhausted'));
  t('⛔ a line with no reason, no time or no head is started-and-unreadable, never a reading — the ambiguity the line exists to remove', [`${CONTRACT_REVIEW_HANDOFF_KEY}: triage — ${CONTRACT_REVIEW_TIER_NAME} unavailable (, 2026-10-27T13:00Z) · head ${HO_HEAD}`, `${CONTRACT_REVIEW_HANDOFF_KEY}: triage — ${CONTRACT_REVIEW_TIER_NAME} unavailable (HTTP 429) · head ${HO_HEAD}`, `${CONTRACT_REVIEW_HANDOFF_KEY}: triage — ${CONTRACT_REVIEW_TIER_NAME} unavailable (HTTP 429, 2026-10-27T13:00Z)`, `${CONTRACT_REVIEW_HANDOFF_KEY}: triage — ${CONTRACT_REVIEW_TIER_NAME} unavailable (HTTP 429, 2026-10-27T13:00Z) · head 1b03a`, `${CONTRACT_REVIEW_HANDOFF_KEY}:`].every((l) => readContractReviewHandoff(l).state === 'unreadable'));
  t('⛔ the target is the closed set of one and the tier is the constant\'s NAME — another seat, the default tier or a model id is unreadable', [`${CONTRACT_REVIEW_HANDOFF_KEY}: director — ${CONTRACT_REVIEW_TIER_NAME} unavailable (HTTP 429, 2026-10-27T13:00Z) · head ${HO_HEAD}`, `${CONTRACT_REVIEW_HANDOFF_KEY}: triage — ${TIER_DEFAULT_NAME} unavailable (HTTP 429, 2026-10-27T13:00Z) · head ${HO_HEAD}`, `${CONTRACT_REVIEW_HANDOFF_KEY}: triage — ${CONTRACT_REVIEW_TIER} unavailable (HTTP 429, 2026-10-27T13:00Z) · head ${HO_HEAD}`].every((l) => readContractReviewHandoff(l).state === 'unreadable'));
  t('an unreadable NEWEST line makes the thread unreadable, naming the comment — never absent, never stale', (() => { const r = contractReviewHandoff([HO_ROW(`${CONTRACT_REVIEW_HANDOFF_KEY}: triage — ${CONTRACT_REVIEW_TIER_NAME} unavailable (HTTP 429) · head ${HO_HEAD}`, 4405)], HO_HEAD); return r.state === 'unreadable' && r.gaps.length === 1 && r.gaps[0].includes('4405'); })());
  t('a thread that is not an array, or a head too short to match, is a read that could not be made', contractReviewHandoff(null, HO_HEAD).state === 'unreadable' && contractReviewHandoff([], 'abc').state === 'unreadable' && contractReviewHandoff([], HO_HEAD).state === 'absent');
  t('the key is ONE regex, built by the one key-line convention, and prose naming it mid-sentence is not the line', CONTRACT_REVIEW_HANDOFF_LINE.source === keyLineRegex(CONTRACT_REVIEW_HANDOFF_KEY).source && readContractReviewHandoff(`the ${CONTRACT_REVIEW_HANDOFF_KEY}: line goes on the PR`).state === 'missing' && contractReviewHandoff([HO_ROW(`the ${CONTRACT_REVIEW_HANDOFF_KEY}: line goes on the PR`)], HO_HEAD).state === 'absent');
  t('⛔ no gate reads it: the queue guard\'s record reading is untouched — a hand-off line beside a record on this head still reads FOUND', (() => { const r = locateReviewOfRecord(pairOf({ prComments: [RECORD_ON_9AF9, HO_ROW(HO_LINE(HEAD_9AF9))] })); return r.state === 'found' && r.id === 3301; })());

  // -- the `Contract-review-claim:` line ----------------------------------------
  //
  // The maintainer's rule: the lane reviews its own, triage takes only a review
  // nobody is doing, and one claim line per head keeps two reviewers off one
  // head. These cases read the line as the triage seat really posted it, with
  // and without the signature above it, refuse every shape that names no head
  // or no time, and pin the lapse arithmetic and the lane-wins tie.
  battery('⭐ the `Contract-review-claim:` line — session, FULL head, time; lapses on a moved head or after two hours; the lane wins a tie');
  const CL_HEAD = '3beee64fe77741d07f035f1b80eeaa07e7280ab4';
  const CL_SESSION = 'session_01AavokzJ5DndAwitDXvKy4U';
  const CL_LANE_SESSION = 'session_01JQwxbZeBv2y91towxasSUT';
  const CL_TRIAGE_SIG = `triage#1 · os-zhuang · ${CL_SESSION}`;
  const CL_LANE_SIG = `domain:ui#1 · os-bill · ${CL_LANE_SESSION}`;
  const CL_LINE = (session = CL_SESSION, head = CL_HEAD, time = '2026-10-28T12:18Z') => `${CONTRACT_REVIEW_CLAIM_KEY}: \`${session}\` · head \`${head}\` · ${time}`;
  // The comment exactly as the triage seat posted it on the first draft it took (signature, line, prose).
  const CL_BODY = (sig = CL_TRIAGE_SIG, line = CL_LINE()) => `${sig === null ? '' : `${sig}\n\n`}${line}\n\nTriage seat, taking the hand-off that names this head.`;
  const CL_ROW = (body, id = 6468788431, at = '2026-10-28T12:18:56Z') => ({ id, created_at: at, body });
  const CL_NOW = Date.parse('2026-10-28T13:00:00Z');
  const CL_J = (v) => JSON.stringify(v);
  t('⭐ the live specimen reads: the session, the FULL head and the minute, behind the signature line', (() => { const r = readContractReviewClaim(CL_BODY()); return r.state === 'read' && r.session === CL_SESSION && r.head === CL_HEAD && r.time === '2026-10-28T12:18Z' && r.at === Date.parse('2026-10-28T12:18:00Z'); })());
  t('⭐ with and without the signature line the reading is the same, byte for byte', CL_J(readContractReviewClaim(CL_BODY())) === CL_J(readContractReviewClaim(CL_BODY(null))) && readContractReviewClaim(CL_BODY(null)).state === 'read');
  t('decoration reads: bare values, a bulleted bolded key, a blockquoted line, seconds on the time', [`${CONTRACT_REVIEW_CLAIM_KEY}: ${CL_SESSION} · head ${CL_HEAD} · 2026-10-28T12:18Z`, `- **${CONTRACT_REVIEW_CLAIM_KEY}:** \`${CL_SESSION}\` · head \`${CL_HEAD}\` · \`2026-10-28T12:18Z\``, `> ${CL_LINE()}`, CL_LINE(CL_SESSION, CL_HEAD, '2026-10-28T12:18:30Z')].every((l) => readContractReviewClaim(l).state === 'read' && readContractReviewClaim(l).head === CL_HEAD));
  t('the head is read lowercased, so an uppercased spelling holds the same head', readContractReviewClaim(CL_LINE(CL_SESSION, CL_HEAD.toUpperCase())).head === CL_HEAD);
  t('⛔ an ABBREVIATED head is unreadable — the rule says full, and a short prefix can name a sibling head', readContractReviewClaim(CL_LINE(CL_SESSION, CL_HEAD.slice(0, 8))).state === 'unreadable');
  t('⛔ a missing fact, a fourth part, a non-UTC or impossible time, a session of another shape: unreadable, never a reading', [`${CONTRACT_REVIEW_CLAIM_KEY}: ${CL_SESSION} · head ${CL_HEAD}`, `${CL_LINE()} · round 3`, CL_LINE(CL_SESSION, CL_HEAD, '2026-10-28 12:18'), CL_LINE(CL_SESSION, CL_HEAD, '2026-10-28T12:18+08:00'), CL_LINE(CL_SESSION, CL_HEAD, '2026-13-45T12:18Z'), CL_LINE('domain:skills#2', CL_HEAD), CL_LINE('session_x', CL_HEAD), `${CONTRACT_REVIEW_CLAIM_KEY}:`].every((l) => readContractReviewClaim(l).state === 'unreadable'));
  t('⛔ the TEMPLATE copied unedited is unreadable — a placeholder holds no head', readContractReviewClaim(CONTRACT_REVIEW_CLAIM_TEMPLATE).state === 'unreadable' && CONTRACT_REVIEW_CLAIM_TEMPLATE === 'Contract-review-claim: <session> · head <full sha> · <UTC>');
  t('the unreadable line is quoted back, key included', readContractReviewClaim(`${CONTRACT_REVIEW_CLAIM_KEY}: soon`).line.includes(CONTRACT_REVIEW_CLAIM_KEY));
  t('the key is ONE regex, built by the one key-line convention, and prose naming it mid-sentence is not the line', CONTRACT_REVIEW_CLAIM_LINE.source === keyLineRegex(CONTRACT_REVIEW_CLAIM_KEY).source && readContractReviewClaim(`triage posts the ${CONTRACT_REVIEW_CLAIM_KEY}: line first`).state === 'missing' && readContractReviewClaim('').state === 'missing');
  t('the FIRST claim line of a comment is the one read', readContractReviewClaim(`${CL_LINE(CL_SESSION, CL_HEAD)}\n${CL_LINE(CL_LANE_SESSION, CL_HEAD)}`).session === CL_SESSION);
  t('⭐ lapse: the current head under two hours ⇒ live; two hours or more ⇒ expired; another head ⇒ head-moved', (() => { const c = readContractReviewClaim(CL_LINE()); const at = c.at; return contractReviewClaimLapse(c, { headSha: CL_HEAD, now: at + 119 * 60000 }) === 'live' && contractReviewClaimLapse(c, { headSha: CL_HEAD, now: at + 120 * 60000 }) === 'expired' && contractReviewClaimLapse(c, { headSha: 'f'.repeat(40), now: at }) === 'head-moved' && CONTRACT_REVIEW_CLAIM_LAPSE_HOURS === 2; })());
  t('the lapse is timed from when the comment was POSTED when that stamp is held, else from the line\'s own time', (() => { const c = readContractReviewClaim(CL_LINE()); const posted = c.at + 90 * 60000; return contractReviewClaimLapse(c, { headSha: CL_HEAD, now: c.at + 150 * 60000, postedAt: posted }) === 'live' && contractReviewClaimLapse(c, { headSha: CL_HEAD, now: c.at + 150 * 60000 }) === 'expired'; })());
  t('⭐ the thread: a live claim on the current head holds it — named by session, comment and side', (() => { const r = contractReviewClaims([CL_ROW(CL_BODY())], CL_HEAD, { now: CL_NOW }); return r.state === 'live' && r.holder.session === CL_SESSION && r.holder.id === 6468788431 && r.holder.side === 'triage' && r.tie === false; })());
  t('⭐ the LANE wins a tie: a triage claim posted FIRST and a lane claim posted later, both live ⇒ the lane holds, tie named', (() => { const r = contractReviewClaims([CL_ROW(CL_BODY(), 1, '2026-10-28T12:18:56Z'), CL_ROW(CL_BODY(CL_LANE_SIG, CL_LINE(CL_LANE_SESSION, CL_HEAD, '2026-10-28T12:20Z')), 2, '2026-10-28T12:20:10Z')], CL_HEAD, { now: CL_NOW }); return r.state === 'live' && r.tie === true && r.holder.side === 'lane' && r.holder.session === CL_LANE_SESSION; })());
  t('two claims on one side: the EARLIEST posted holds, and no tie is declared', (() => { const r = contractReviewClaims([CL_ROW(CL_BODY(CL_LANE_SIG, CL_LINE(CL_LANE_SESSION)), 2, '2026-10-28T12:30:00Z'), CL_ROW(CL_BODY(null, CL_LINE(CL_SESSION)), 1, '2026-10-28T12:10:00Z')], CL_HEAD, { now: CL_NOW }); return r.holder.id === 1 && r.tie === false; })());
  t('an UNSIGNED claim is the lane side — only a `triage#N` signature makes a claim triage\'s', contractReviewClaims([CL_ROW(CL_BODY(null))], CL_HEAD, { now: CL_NOW }).holder.side === 'lane');
  t('⭐ the head MOVED past every claim ⇒ none; every claim on this head expired ⇒ lapsed; nothing holds either way', (() => { const moved = contractReviewClaims([CL_ROW(CL_BODY())], 'a'.repeat(40), { now: CL_NOW }); const old = contractReviewClaims([CL_ROW(CL_BODY())], CL_HEAD, { now: Date.parse('2026-10-28T14:19:00Z') }); return moved.state === 'none' && moved.holder === null && old.state === 'lapsed' && old.holder === null && old.claims[0].lapse === 'expired'; })());
  t('an unreadable claim line holds nothing and is returned by comment id', (() => { const r = contractReviewClaims([CL_ROW(`${CL_TRIAGE_SIG}\n${CL_LINE(CL_SESSION, CL_HEAD.slice(0, 8))}`, 77)], CL_HEAD, { now: CL_NOW }); return r.state === 'none' && r.unreadable.length === 1 && r.unreadable[0].id === 77; })());
  t('a thread that is not an array, an abbreviated head, or no clock is a read that could not be made', contractReviewClaims(null, CL_HEAD, { now: CL_NOW }).state === 'unreadable' && contractReviewClaims([], CL_HEAD.slice(0, 12), { now: CL_NOW }).state === 'unreadable' && contractReviewClaims([], CL_HEAD, {}).state === 'unreadable' && contractReviewClaims([], CL_HEAD, { now: CL_NOW }).state === 'none');
  t('⛔ no gate reads it: a claim beside a record on this head leaves the record reading FOUND, and the hand-off reading is untouched', (() => { const rec = locateReviewOfRecord(pairOf({ prComments: [RECORD_ON_9AF9, CL_ROW(CL_BODY(CL_TRIAGE_SIG, CL_LINE(CL_SESSION, HEAD_9AF9.padEnd(40, '0'))))] })); return rec.state === 'found' && rec.id === 3301 && contractReviewHandoff([CL_ROW(CL_BODY())], CL_HEAD).state === 'absent'; })());
  t('⭐ the line is spelled VERBATIM, in a code span, in the rule text (`references/contract-review.md`), beside its two-hour lapse', (() => { const rules = readFileSync(new URL('../../.claude/skills/pm-dispatch/references/contract-review.md', import.meta.url), 'utf8'); return rules.includes(`\`${CONTRACT_REVIEW_CLAIM_TEMPLATE}\``) && rules.includes(`${CONTRACT_REVIEW_CLAIM_LAPSE_HOURS} 小时`); })());

  // -- the `Contract-review-hold:` line -----------------------------------------
  //
  // The maintainer's rule: a lane that does not want a head reviewed yet says so
  // in ONE line a reader can find, instead of prose the triage seat has to
  // re-read. These cases read the line as a lane posts it, with and without the
  // signature above it, refuse every shape missing a fact, pin newest-governs and
  // the per-head clearing, and pin the 24-hour age as a READING: an overdue hold
  // is listed and still holds.
  battery('⭐ the `Contract-review-hold:` line — session, head, reason, until; a new head clears it; at 24 hours it reads overdue and still holds');
  const HL_HEAD = '3beee64fe77741d07f035f1b80eeaa07e7280ab4';
  const HL_SESSION = 'session_01JQwxbZeBv2y91towxasSUT';
  const HL_SIG = `domain:ui#1 · os-bill · ${HL_SESSION}`;
  const HL_LINE = (head = HL_HEAD, reason = 'the stack still lands under it', until = 'the last sibling PR merges', session = HL_SESSION) => `${CONTRACT_REVIEW_HOLD_KEY}: \`${session}\` · head \`${head}\` · ${reason} · until ${until}`;
  // The comment as a lane posts it: signature, the line, prose.
  const HL_BODY = (sig = HL_SIG, line = HL_LINE()) => `${sig === null ? '' : `${sig}\n\n`}${line}\n\nThe lane hangs the label once the condition is met.`;
  const HL_ROW = (body, id = 6472451890, at = '2026-10-28T09:00:00Z') => ({ id, created_at: at, body });
  const HL_NOW = Date.parse('2026-10-28T13:00:00Z');
  const HL_POSTED = Date.parse('2026-10-28T09:00:00Z');
  const HL_J = (v) => JSON.stringify(v);
  t('⭐ the live specimen reads: the session, the head, the reason and the condition, behind the signature line', (() => { const r = readContractReviewHold(HL_BODY()); return r.state === 'read' && r.session === HL_SESSION && r.head === HL_HEAD && r.reason === 'the stack still lands under it' && r.until === 'the last sibling PR merges'; })());
  t('with and without the signature line the reading is the same, byte for byte', HL_J(readContractReviewHold(HL_BODY())) === HL_J(readContractReviewHold(HL_BODY(null))) && readContractReviewHold(HL_BODY(null)).state === 'read');
  t('decoration reads: bare values, a bulleted bolded key, a blockquoted line, an abbreviated head', [`${CONTRACT_REVIEW_HOLD_KEY}: ${HL_SESSION} · head ${HL_HEAD} · r · until c`, `- **${CONTRACT_REVIEW_HOLD_KEY}:** \`${HL_SESSION}\` · head \`${HL_HEAD.slice(0, 12)}\` · r · until c`, `> ${HL_LINE()}`].every((l) => readContractReviewHold(l).state === 'read' && HL_HEAD.startsWith(readContractReviewHold(l).head)));
  t('the head is read lowercased; seven hex is the shortest head that reads, six is unreadable', readContractReviewHold(HL_LINE(HL_HEAD.toUpperCase())).head === HL_HEAD && readContractReviewHold(HL_LINE(HL_HEAD.slice(0, 7))).state === 'read' && readContractReviewHold(HL_LINE(HL_HEAD.slice(0, 6))).state === 'unreadable');
  t('⛔ a missing fact, a fifth part, an empty reason, no `until`, a reason that is the `until`, a session of another shape: unreadable', [`${CONTRACT_REVIEW_HOLD_KEY}: \`${HL_SESSION}\` · head \`${HL_HEAD}\` · until c`, `${HL_LINE()} · round 3`, HL_LINE(HL_HEAD, ''), `${CONTRACT_REVIEW_HOLD_KEY}: \`${HL_SESSION}\` · head \`${HL_HEAD}\` · r · when c`, HL_LINE(HL_HEAD, 'r', ''), HL_LINE(HL_HEAD, 'until a'), HL_LINE(HL_HEAD, 'r', 'c', 'domain:ui#1'), `${CONTRACT_REVIEW_HOLD_KEY}:`].every((l) => readContractReviewHold(l).state === 'unreadable'));
  t('⛔ the TEMPLATE copied unedited is unreadable — a placeholder holds no head', readContractReviewHold(CONTRACT_REVIEW_HOLD_TEMPLATE).state === 'unreadable' && CONTRACT_REVIEW_HOLD_TEMPLATE === 'Contract-review-hold: <session> · head <sha> · <reason> · until <condition>');
  t('the key is ONE regex, built by the one key-line convention, and prose naming it mid-sentence is not the line', CONTRACT_REVIEW_HOLD_LINE.source === keyLineRegex(CONTRACT_REVIEW_HOLD_KEY).source && readContractReviewHold(`the lane posts the ${CONTRACT_REVIEW_HOLD_KEY}: line first`).state === 'missing' && readContractReviewHold('').state === 'missing');
  t('⭐ the thread: the newest hold naming the current head is LIVE — session, reason, condition and the comment that holds', (() => { const r = contractReviewHold([HL_ROW(HL_BODY())], HL_HEAD, { now: HL_NOW }); return r.state === 'live' && r.session === HL_SESSION && r.until === 'the last sibling PR merges' && r.id === 6472451890 && r.ageMinutes === 240 && r.overdue === false; })());
  t('⭐ per head: the head MOVED past the newest hold ⇒ stale, naming the head it held — a new head clears it', (() => { const r = contractReviewHold([HL_ROW(HL_BODY())], 'f'.repeat(40), { now: HL_NOW }); return r.state === 'stale' && r.head === HL_HEAD && r.overdue === undefined; })());
  t('NEWEST governs — an older hold on this head under a newer one on another head reads stale, and the reverse reads live', contractReviewHold([HL_ROW(HL_BODY(), 1, '2026-10-28T09:00:00Z'), HL_ROW(HL_BODY(HL_SIG, HL_LINE('deadbeef1')), 2, '2026-10-28T10:00:00Z')], HL_HEAD, { now: HL_NOW }).state === 'stale' && contractReviewHold([HL_ROW(HL_BODY(HL_SIG, HL_LINE('deadbeef1')), 1, '2026-10-28T09:00:00Z'), HL_ROW(HL_BODY(), 2, '2026-10-28T10:00:00Z')], HL_HEAD, { now: HL_NOW }).state === 'live');
  t('the head is matched by PREFIX either way, as the hand-off line\'s is', contractReviewHold([HL_ROW(HL_BODY(HL_SIG, HL_LINE(HL_HEAD.slice(0, 8))))], HL_HEAD, { now: HL_NOW }).state === 'live' && contractReviewHold([HL_ROW(HL_BODY())], HL_HEAD.slice(0, 12), { now: HL_NOW }).state === 'live');
  t('⭐ NO hold line ⇒ absent — a claim, a hand-off line and a record on the thread change nothing', (() => { const r = contractReviewHold([CL_ROW(CL_BODY()), HO_ROW(HO_LINE(HL_HEAD)), RECORD(HL_HEAD)], HL_HEAD, { now: HL_NOW }); return r.state === 'absent' && r.read === 3; })());
  t('⭐ the age is a READING: 23 h 59 min ⇒ live, not overdue; 24 h ⇒ live AND overdue — ⛔ an overdue hold is not lapsed', (() => { const young = contractReviewHold([HL_ROW(HL_BODY())], HL_HEAD, { now: HL_POSTED + (24 * 60 - 1) * 60000 }); const old = contractReviewHold([HL_ROW(HL_BODY())], HL_HEAD, { now: HL_POSTED + 24 * 3600000 }); return young.state === 'live' && young.overdue === false && old.state === 'live' && old.overdue === true && old.ageMinutes === 1440 && CONTRACT_REVIEW_HOLD_LIST_HOURS === 24; })());
  t('the age is timed from when the comment was POSTED; a row with no stamp reads overdue null — unknown, never false', (() => { const r = contractReviewHold([{ id: 9, body: HL_BODY() }], HL_HEAD, { now: HL_NOW }); return r.state === 'live' && r.ageMinutes === null && r.overdue === null; })());
  t('an unreadable NEWEST line makes the reading unreadable, naming the comment — it holds nothing', (() => { const r = contractReviewHold([HL_ROW(HL_BODY(), 1, '2026-10-28T09:00:00Z'), HL_ROW(HL_BODY(HL_SIG, `${CONTRACT_REVIEW_HOLD_KEY}: soon`), 7701, '2026-10-28T10:00:00Z')], HL_HEAD, { now: HL_NOW }); return r.state === 'unreadable' && r.gaps.length === 1 && r.gaps[0].includes('7701'); })());
  t('a thread that is not an array, a head too short to match, or no clock is a read that could not be made', contractReviewHold(null, HL_HEAD, { now: HL_NOW }).state === 'unreadable' && contractReviewHold([], 'abc', { now: HL_NOW }).state === 'unreadable' && contractReviewHold([], HL_HEAD, {}).state === 'unreadable' && contractReviewHold([], HL_HEAD, { now: HL_NOW }).state === 'absent');
  t('a claim line and a hand-off line are not hold lines, and a hold line is neither of them', readContractReviewClaim(HL_BODY()).state === 'missing' && readContractReviewHandoff(HL_BODY()).state === 'missing' && readContractReviewHold(CL_BODY()).state === 'missing' && readContractReviewHold(HO_LINE()).state === 'missing');
  t('⛔ no gate reads it: a hold beside a record on this head leaves the record FOUND, and the claim and hand-off readings untouched', (() => { const rec = locateReviewOfRecord(pairOf({ prComments: [RECORD_ON_9AF9, HL_ROW(HL_BODY(HL_SIG, HL_LINE(HEAD_9AF9)))] })); return rec.state === 'found' && rec.id === 3301 && contractReviewClaims([HL_ROW(HL_BODY())], HL_HEAD, { now: HL_NOW }).state === 'none' && contractReviewHandoff([HL_ROW(HL_BODY())], HL_HEAD).state === 'absent'; })());
  t('⭐ the line is spelled VERBATIM, in a code span, in the rule text (`references/contract-review.md`), beside its 24-hour listing', (() => { const rules = readFileSync(new URL('../../.claude/skills/pm-dispatch/references/contract-review.md', import.meta.url), 'utf8'); return rules.includes(`\`${CONTRACT_REVIEW_HOLD_TEMPLATE}\``) && rules.includes(`${CONTRACT_REVIEW_HOLD_LIST_HOURS} 小时`); })());

  // -- the mailbox doorbell -----------------------------------------------------
  //
  // One mailbox PR per seat, and a CLOSED vocabulary on it (the maintainer's
  // 「只沟通必要的信息」): the first line of a mailbox comment is one of the seven
  // keys and nothing else is allowed. These cases read one example of each key
  // and refuse free text, an acknowledgement, an eighth key, a second line and
  // an over-long line — the half-state faces — and pin each key's spelling to
  // the protocol text, so the reader and the text cannot drift apart.
  battery('⭐ the mailbox doorbell: the seven first-line keys read — kind, numbers, sha, login, time — and anything else refused');
  const DB_ROW = (body, id = 5101, at = '2026-10-28T07:00:00Z') => ({ id, created_at: at, user: { login: 'os-bill' }, body });
  const DB = {
    cr: `Request: contract-review · PR #26766 · head ${HO_HEAD} · ${CONTRACT_REVIEW_TIER_NAME} refused, HTTP 429`,
    ut: 'Request: urgent-triage · #27047 · main red on the merge group, deterministic',
    mr: 'Request: main-red · Test Core · anchor #27090 · suggested lane server',
    nc: 'Notify: contract-review PASS · PR #26766 · record 6450011111',
    on: 'Notify: seat-online · domain:skills#2 · os-bill · mailbox #27120 · takes: #27077 #27062',
    off: 'Notify: seat-offline · domain:skills#2 · in-flight: #27077 · stay-behind: #27082 #26749 · brief 6450022222',
    sp: 'Notify: split · domain:skills#2 · takes: #27077 #27062 · leaves: #27047',
  };
  t('⭐ `Request: contract-review` reads the PR, the head (7–40 hex) and the reason — the reason may carry a comma', (() => { const r = readMailboxLine(DB.cr); return r.state === 'read' && r.id === 'request:contract-review' && r.kind === 'Request' && r.key === 'contract-review' && r.pr === 26766 && r.head === HO_HEAD && r.reason === `${CONTRACT_REVIEW_TIER_NAME} refused, HTTP 429` && r.numbers.join() === '26766'; })());
  t('⭐ `Request: urgent-triage` reads the card and the one-line criterion', (() => { const r = readMailboxLine(DB.ut); return r.state === 'read' && r.id === 'request:urgent-triage' && r.card === 27047 && r.criterion === 'main red on the merge group, deterministic' && r.numbers.join() === '27047'; })());
  t('⭐ `Request: main-red` reads the check name, the anchor card and the suggested lane', (() => { const r = readMailboxLine(DB.mr); return r.state === 'read' && r.id === 'request:main-red' && r.check === 'Test Core' && r.anchor === 27090 && r.lane === 'server' && r.numbers.join() === '27090'; })());
  t('⭐ `Notify: contract-review` reads the verdict, the PR and the record id — PASS and FAIL, and the template\'s own `PASS or FAIL` is a placeholder, not a verdict', (() => { const p = readMailboxLine(DB.nc); const f = readMailboxLine(DB.nc.replace('PASS', 'FAIL')); const tpl = readMailboxLine('Notify: contract-review PASS or FAIL · PR #26766 · record 6450011111'); return p.state === 'read' && p.id === 'notify:contract-review' && p.verdict === 'PASS' && p.pr === 26766 && p.record === 6450011111 && p.numbers.join() === '26766' && f.state === 'read' && f.verdict === 'FAIL' && tpl.state === 'unreadable'; })());
  t('⭐ `Notify: seat-online` reads the seat (lane and number), the login, the mailbox and the takes list', (() => { const r = readMailboxLine(DB.on); return r.state === 'read' && r.id === 'notify:seat-online' && r.seat.lane === 'domain:skills' && r.seat.n === 2 && r.login === 'os-bill' && r.mailbox === 27120 && r.takes.join() === '27077,27062' && r.numbers.join() === '27120,27077,27062'; })());
  t('⭐ `Notify: seat-offline` reads the seat, the in-flight and stay-behind lists and the brief id', (() => { const r = readMailboxLine(DB.off); return r.state === 'read' && r.id === 'notify:seat-offline' && r.seat.n === 2 && r.inFlight.join() === '27077' && r.stayBehind.join() === '27082,26749' && r.brief === 6450022222 && r.numbers.join() === '27077,27082,26749'; })());
  t('⭐ `Notify: split` reads the seat and the takes and leaves lists', (() => { const r = readMailboxLine(DB.sp); return r.state === 'read' && r.id === 'notify:split' && r.seat.lane === 'domain:skills' && r.takes.join() === '27077,27062' && r.leaves.join() === '27047' && r.numbers.join() === '27077,27062,27047'; })());
  t('⭐ every key\'s template is spelled VERBATIM, in a code span, in the protocol text (`references/project-forms.md` 〈信箱 PR〉) — and that text lists exactly seven', (() => { const forms = readFileSync(new URL('../../.claude/skills/pm-dispatch/references/project-forms.md', import.meta.url), 'utf8'); const keyLines = forms.split('\n').filter((l) => /^- `(Request|Notify): /.test(l)); return MAILBOX_KEYS.every((k) => forms.includes(`\`${k.template}\``)) && keyLines.length === MAILBOX_KEYS.length && MAILBOX_KEYS.length === 7; })());
  t('decoration reads: a bulleted bolded key and a blockquoted line are the same event', (() => { const a = readMailboxLine(`- **Request:** contract-review · PR #26766 · head ${HO_HEAD} · quota exhausted`); const b = readMailboxLine(`> ${DB.sp}`); return a.state === 'read' && a.pr === 26766 && b.state === 'read' && b.id === 'notify:split'; })());
  t('the attribution block the platform APPENDS (bare or session-URL footer under a rule line) is not a second line', ['\n\n---\n_Generated by [Claude Code](https://claude.ai/code)_', `\n\n---\n_Generated by [Claude Code](https://claude.ai/code/${RECORD_SESSION})_`].every((tail) => readMailboxLine(`${DB.on}${tail}`).state === 'read'));
  t('⛔ free text, an acknowledgement and an empty comment are REFUSED, naming the line — the half-state the text names', (() => { const a = readMailboxLine('Seat note: picking up the review now, will report on the card.'); const b = readMailboxLine('收到,谢谢!'); const c = readMailboxLine(''); return a.state === 'refused' && typeof a.line === 'string' && b.state === 'refused' && c.state === 'refused'; })());
  t('⛔ an EIGHTH key is refused, whatever its kind — the vocabulary is closed — and the kinds are case-sensitive', ['Request: coffee · #27077', 'Notify: ack · #27077', 'Ack: #27077', 'request: urgent-triage · #27047 · x', 'Request: contract-review-done · PR #1'].every((l) => readMailboxLine(l).state === 'refused'));
  t(`⛔ a line over ${MAILBOX_LINE_MAX_BYTES} bytes is unreadable — keys and numbers only, the reasoning stays on the card`, (() => { const r = readMailboxLine(`Request: contract-review · PR #26766 · head ${HO_HEAD} · ${'x'.repeat(160)}`); return r.state === 'unreadable' && /bytes/.test(r.reason) && readMailboxLine(DB.cr).state === 'read'; })());
  t('⛔ a second line of content is unreadable — one event, one line', (() => { const r = readMailboxLine(`${DB.cr}\n\nbecause the reviewer tier was refused twice this round`); return r.state === 'unreadable' && /more than one line/.test(r.reason); })());
  t('⛔ a known key that does not spell its template is unreadable: no head, a 6-hex head, a login GitHub refuses, no mailbox, no lane, a record that is not a number', [`Request: contract-review · PR #26766 · ${HO_HEAD} · x`, 'Request: contract-review · PR #26766 · head 1b03a9 · x', 'Notify: seat-online · domain:skills#2 · -bad-- · mailbox #27120 · takes: none', 'Notify: seat-online · domain:skills#2 · os-bill · takes: none', 'Request: main-red · Test Core · anchor #27090', 'Notify: contract-review PASS · PR #26766 · record six'].every((l) => { const r = readMailboxLine(l); return r.state === 'unreadable' && /does not spell/.test(r.reason); }));
  t('lists: `none` is the empty list, `#a #b` the numbers; a comma, an empty list or a `PR #n` item is unreadable', (() => { const ok = readMailboxLine('Notify: split · domain:skills#2 · takes: none · leaves: #1 #2'); return ok.state === 'read' && ok.takes.length === 0 && ok.leaves.join() === '1,2' && ['Notify: split · domain:skills#2 · takes: #1, #2 · leaves: none', 'Notify: split · domain:skills#2 · takes: · leaves: none', 'Notify: split · domain:skills#2 · takes: PR #1 · leaves: none'].every((l) => readMailboxLine(l).state === 'unreadable'); })());
  t('the spaces around the ` · ` separator are optional', readMailboxLine('Request: urgent-triage·#27047·main red').state === 'read' && readMailboxLine('Request: urgent-triage ·#27047· main red').card === 27047);
  t('a seat with no number reads (`triage`), and the `LANE#N` placeholder itself does not', readMailboxLine('Notify: split · triage · takes: none · leaves: none').seat.lane === 'triage' && readMailboxLine('Notify: split · triage · takes: none · leaves: none').seat.n === null && readMailboxLine('Notify: split · LANE#N · takes: none · leaves: none').state === 'unreadable');
  t('⭐ `mailboxEvents` reads a thread: each row\'s comment id, time and author beside its reading (the key id never shadows the comment id), and the half-states by comment id', (() => { const r = mailboxEvents([DB_ROW(DB.cr, 5101, '2026-10-28T07:00:00Z'), DB_ROW('thanks, on it', 5102, '2026-10-28T07:05:00Z'), DB_ROW(DB.on, 5103, '2026-10-28T07:10:00Z')]); return r.state === 'read' && r.events.length === 3 && r.events[0].state === 'read' && r.events[0].id === 'request:contract-review' && r.events[0].comment === 5101 && r.events[0].at === '2026-10-28T07:00:00Z' && r.events[0].by === 'os-bill' && r.events[2].mailbox === 27120 && r.events[2].comment === 5103 && r.halfStates.join() === '5102'; })());
  t('a thread that is not an array is a read that could not be made, never an empty one', mailboxEvents(null).state === 'unreadable' && mailboxEvents([]).state === 'read' && mailboxEvents([]).events.length === 0);
  t('⛔ no gate reads it: the queue guard\'s record reading is untouched — a doorbell comment beside a record on this head still reads FOUND', (() => { const r = locateReviewOfRecord(pairOf({ prComments: [RECORD_ON_9AF9, DB_ROW(DB.nc, 5104)] })); return r.state === 'found' && r.id === 3301; })());
  t('the roster: seven keys, unique ids, each of the two kinds, the byte cap the text states', MAILBOX_KEYS.length === 7 && new Set(MAILBOX_KEYS.map((k) => k.id)).size === 7 && MAILBOX_KEYS.every((k) => ['Request', 'Notify'].includes(k.kind) && k.template.startsWith(`${k.kind}: ${k.key}`)) && MAILBOX_LINE_MAX_BYTES === 200);

  // -- the signature line (#27113) ----------------------------------------------
  //
  // Every seat-authored body now opens with `LANE#N · ACCOUNT · SESSION`, so every recogniser that keys
  // on a body's FIRST line must read the same thing with that line above it. These cases read the
  // reader's own shape, pin its session half to the relay envelope's, and then drive each recogniser
  // the card names twice — the fixture as it is, and the same fixture signed — asserting the reading
  // is positive AND identical. Readers that live in other modules are imported here, in the self-test
  // body, so the module the queue guard loads lazily gains no edge.
  battery('⭐ the signature line: the reader reads LANE#N · ACCOUNT · SESSION exactly, and one leading signature changes no first-line reading');
  {
    const hs = await import('./check-half-states.mjs');
    const { SESSION_SHAPE } = await import('./fleet-write/ops.mjs');
    const { SEAT_RECORD_MARKER } = await import('./seat-record.mjs');
    const { classifyRulingComment } = await import('./check-prior-rulings.mjs');
    const SIG = 'domain:skills#2 · os-justin · session_01QSeKYmhU5KEj1nukYhp1Tg';
    const signed = (body) => `${SIG}\n${body}`;
    const J = (v) => JSON.stringify(v, (k, x) => (x instanceof Set ? [...x] : x));
    const same = (read, body) => J(read(body)) === J(read(signed(body)));

    // The reader's own shape.
    t('the four parts read: lane, seat number, account, session', J(hs.readSignatureLine(SIG)) === J({ lane: 'domain:skills', seat: 2, account: 'os-justin', session: 'session_01QSeKYmhU5KEj1nukYhp1Tg', line: SIG }));
    t('every lane the role table names reads — a hyphenated lane, a repo seat, an epic, triage, director, coordinator', ['domain:engine-core#1', 'repo:cloud#2', 'epic:#26000#1', 'triage#1', 'director#1', 'coordinator#3'].every((lane) => hs.readSignatureLine(`${lane} · os-zhuang · session_01JQwxbZeBv2y91towxasSUT`)?.lane === lane.replace(/#[0-9]+$/u, '')));
    t('a container-derived session (`cse_` tail) reads: the relay envelope\'s shape, not only the desktop one', hs.readSignatureLine('triage#1 · huangyiirene · session_01ABCDEFGHJKMNPQRSTVWXYZ')?.session === 'session_01ABCDEFGHJKMNPQRSTVWXYZ');
    t('⛔ the near misses are NOT signatures: no seat number, seat 0, a bare lane, a capital, hyphens or doubled spaces for the dot, a short session, bold wrapping, trailing words', [
      'triage · os-justin · session_01QSeKYmhU5KEj1nukYhp1Tg',
      'triage#0 · os-justin · session_01QSeKYmhU5KEj1nukYhp1Tg',
      'skills#2 · os-justin · session_01QSeKYmhU5KEj1nukYhp1Tg',
      'domain:Skills#2 · os-justin · session_01QSeKYmhU5KEj1nukYhp1Tg',
      'domain:skills#2 - os-justin - session_01QSeKYmhU5KEj1nukYhp1Tg',
      'domain:skills#2  ·  os-justin · session_01QSeKYmhU5KEj1nukYhp1Tg',
      'domain:skills#2 · os-justin · session_x',
      '**domain:skills#2 · os-justin · session_01QSeKYmhU5KEj1nukYhp1Tg**',
      'domain:skills#2 · os-justin · session_01QSeKYmhU5KEj1nukYhp1Tg · round 3',
    ].every((line) => hs.readSignatureLine(line) === null));
    t('the FIRST non-empty line decides: blank lines above it and a CRLF read; a signature on line two does not', hs.readSignatureLine(`\n\n${SIG}\r\nbody`) !== null && hs.readSignatureLine(`body\n${SIG}`) === null && hs.readSignatureLine('') === null);
    t('⭐ the session half IS the relay envelope\'s `SESSION_SHAPE` (fleet-write/ops.mjs) — mirrored, held equal here', SESSION_SHAPE.source === `^${hs.SEAT_SIGNATURE_SESSION_SOURCE}$`);
    t('the separator is the doorbell\'s dot, exactly: one space, U+00B7, one space', hs.SEAT_SIGNATURE_SEPARATOR === ' · ' && hs.SEAT_SIGNATURE_SEPARATOR.split(MAILBOX_SEPARATOR).length === 2);
    t('`stripSignatureLine` leaves an unsigned body byte-identical, leading blank lines and all', ['', '\n\nClaim: x\n', 'os-dev-report\n{}', `body\n${SIG}`].every((b) => hs.stripSignatureLine(b) === b));
    t('…removes ONE signature line and the blank lines after it, and only one', hs.stripSignatureLine(`${SIG}\n\n\nClaim: x`) === 'Claim: x' && hs.stripSignatureLine(`${SIG}\n${SIG}\nClaim: x`) === `${SIG}\nClaim: x` && hs.stripSignatureLine(SIG) === '');

    // Each named recogniser, unsigned and signed.
    const rec = RECORD_ON_9AF9;
    const recSigned = { ...rec, body: signed(rec.body) };
    const found = locateReviewOfRecord(pairOf({ prComments: [recSigned] }));
    t('`## Contract review`: the signed record on this head reads FOUND with the same id and head span; its `Served-tier:` and `Local-runs:` read the same', found.state === 'found' && J([found.id, found.sha]) === J([onPr.id, onPr.sha]) && same(readServedTier, rec.body) && same(readLocalRuns, `${rec.body}\n- **Local-runs:** none`));
    const report = 'os-dev-report\n```json\n{"issue": 1}\n```';
    t('`os-dev-report`: the marker reads with and without, and the newest report is found on a signed thread', hs.OS_DEV_REPORT_MARKER.test(report) && hs.OS_DEV_REPORT_MARKER.test(signed(report)) && hs.latestMarkedComment([{ body: signed(report), created_at: '2026-10-28T09:00:00Z' }], hs.OS_DEV_REPORT_MARKER) !== null);
    t('⛔ …while a marker on a LATER line, below anything but one signature, is still no report', hs.OS_DEV_REPORT_MARKER.test(`${SIG}\n## PM review\n\nos-dev-report\n`) === false && hs.OS_DEV_REPORT_MARKER.test(`${SIG}\n${SIG}\nos-dev-report\n`) === false);
    t('`Contract-review-handoff:` reads the same newest-line verdict on a signed thread', (() => { const a = contractReviewHandoff([HO_ROW(HO_LINE())], HO_HEAD); const b = contractReviewHandoff([{ ...HO_ROW(HO_LINE()), body: signed(HO_ROW(HO_LINE()).body) }], HO_HEAD); return a.state === 'triage' && J(a) === J(b); })());
    const claim = 'Claim: PM loop round 1 · 2026-10-28T12:44Z\nSession: `session_01QSeKYmhU5KEj1nukYhp1Tg`\nSeat: `domain:skills#2`\nBranch: `claude/issue-1-x`';
    t('claim lines: the `Claim:` marker and the seat number read the same signed', hs.markerMatches(hs.CLAIM_COMMENT_MARKER, signed(claim)) && same(hs.claimSeatNumber, claim) && hs.claimSeatNumber(signed(claim)) === 2);
    t('release lines: the `Release:` marker reads the same signed', hs.markerMatches(hs.RELEASE_COMMENT_MARKER, 'Release: session_x · reason · back to pm:queue') && hs.markerMatches(hs.RELEASE_COMMENT_MARKER, signed('Release: session_x · reason · back to pm:queue')));
    const YL = 'session_01TsiNYHjuek413vNgFHqcAm';
    const yRows = (yieldBody) => [
      { id: 1, created_at: '2026-10-25T09:47:34Z', body: 'Claim: a · 2026-10-25T09:47Z\nSession: `session_014FZ3TJucS1L7BdMe5DAzXC`' },
      { id: 2, created_at: '2026-10-25T09:54:58Z', body: `Claim: b · 2026-10-25T09:54Z\nSession: \`${YL}\`` },
      { id: 3, created_at: '2026-10-25T10:01:06Z', body: yieldBody },
    ];
    const YIELD = `already claimed — yielding · \`domain:skills#2\` · \`${YL}\` · 2026-10-25T10:00Z\n\nThe earlier claim decides.`;
    t('a claim\'s yield line: the yielded claim is the same one under a signed yield', J(hs.yieldedClaimIndexes(yRows(YIELD))) === J([1]) && J(hs.yieldedClaimIndexes(yRows(signed(YIELD)))) === J([1]));
    const ROUNDS = ['**Round-open marker** · triage seat · `session_01x` · **R+236** · fire 2026-09-15T14:51Z', 'R+12 open · triage', '分诊轮收尾 · R+234 · `session_01x`', '# 🔻 收班简报 · 分诊席 · `session_01x` · **R+220 → R+234**'];
    t('round records: every round-artefact headline is the same line signed, and its shape still matches', ROUNDS.every((r) => same(hs.h65Headline, `${r}\n\nbody`) && hs.H65_ROUND_ARTEFACT_SHAPES.some((shape) => shape.re.test(hs.h65Headline(signed(`${r}\n\nbody`))))));
    t('`## 席位核对`: the seat-record heading reads the same signed', SEAT_RECORD_MARKER.test('## 席位核对\n- ① ok') && SEAT_RECORD_MARKER.test(signed('## 席位核对\n- ① ok')));
    t('⭐ the mailbox doorbell: all seven keys read IDENTICALLY signed — the signature is neither the key nor a second line', Object.values(DB).every((line) => readMailboxLine(line).state === 'read' && same(readMailboxLine, line)) && readMailboxLine(signed(`${DB.ut}\n\n---\n_Generated by [Claude Code](https://claude.ai/code)_`)).state === 'read');
    t('⛔ …a signature with no key under it is refused, and so is a key under a near-miss signature or under two', readMailboxLine(SIG).state === 'refused' && readMailboxLine(`domain:skills#2 - os-justin - session_01QSeKYmhU5KEj1nukYhp1Tg\n${DB.ut}`).state === 'refused' && readMailboxLine(`${SIG}\n${SIG}\n${DB.ut}`).state === 'refused');
    t('triage rulings and director rulings: the first-line shape reads the same signed', ['Triage: lands in domain:skills', '**Grading (skills seat):** p2'].every((r) => hs.isTriageRulingComment(r) && same(hs.isTriageRulingComment, r)) && classifyRulingComment('Ruling: batch #9 item 2 · letter A') !== null && same(classifyRulingComment, 'Ruling: batch #9 item 2 · letter A'));
    t('the act\'s OPENING-line stamp (H56, which post-stamped\'s positional refusal imports) is the same reading under a signature', hs.h56StampedReadings('Claim: x · 2026-10-28T12:44Z\nbody').length === 1 && same(hs.h56StampedReadings, 'Claim: x · 2026-10-28T12:44Z\nbody'));
  }

  // -- #18042: the copyable record TEMPLATE ----------------------------------
  //
  // `references/contract-review.md` DESCRIBES the record in prose and once
  // shipped nothing to copy, so four in-seat records in one session composed
  // `Implemented-by: branch claude/…` from the prose instead. So the file that
  // READS the record now EMITS it, and these cases are what make "copy it" a
  // safe instruction: the printed bytes are driven back through the very
  // readers that judge a real record.
  battery('#18042: the copyable record TEMPLATE — the one machine-read artefact with nothing to copy');
  const TPL_TEXT = contractReviewTemplateLines().join('\n');
  const TPL_RECORD = contractReviewRecordLines().join('\n');
  const TPL_NULL_HEAD = RECORD_TEMPLATE_PLACEHOLDERS.headSha;
  const TPL_REAL_HEAD = 'a90a9f26794e5a2c34c1eded83ba0e25087e4433';
  const tplOn = (body, headSha) => locateReviewOfRecord(pairOf({ headSha, prComments: [{ id: 3601, created_at: '2026-09-16T10:00:00Z', body }] }));
  t('⭐ the PRINTED template round-trips through the locator that judges the real thing — FOUND, signed', tplOn(TPL_TEXT, TPL_NULL_HEAD).state === 'found');
  t('…and its `Served-tier:` reading STANDS, read off the same comment', servedTierStands(tplOn(TPL_TEXT, TPL_NULL_HEAD).served));
  t('the fenced record ALONE reads the same — the notes around it are not load-bearing', tplOn(TPL_RECORD, TPL_NULL_HEAD).state === 'found' && servedTierStands(tplOn(TPL_RECORD, TPL_NULL_HEAD).served));
  t('filled in with a real head and real identities, it still reads FOUND and STANDS on that head', (() => { const r = tplOn(contractReviewRecordLines({ headSha: TPL_REAL_HEAD, implementedBy: 'claude/issue-18042-contract-review-record-template', reviewedBy: 'session_01DAcomhvR9kKizeYgg89Vo8' }).join('\n'), TPL_REAL_HEAD); return r.state === 'found' && r.sha === TPL_REAL_HEAD && servedTierStands(r.served); })());
  t('its `Served-tier:` line STANDS on the printed text itself', servedTierStands(readServedTier(TPL_TEXT)));
  t('⛔ carrying the constant\'s NAME — and no model identifier anywhere in the whole output', readServedTier(TPL_TEXT).value === CONTRACT_REVIEW_TIER_NAME && !isModelIdentifierToken(TPL_TEXT));
  t('the record\'s two recognition facts hold: the `## Contract review` heading…', CONTRACT_REVIEW_HEADING_MARKER.test(TPL_TEXT));
  t('…and a head sha in a code span of ITS OWN, which is what makes it findable at all', contractReviewHeadMatch(TPL_TEXT, TPL_NULL_HEAD) === TPL_NULL_HEAD);
  t('⛔ CONTROL: the live corpus spelling puts the KEY inside the span, and then no head is found', contractReviewHeadMatch(`## Contract review\n\n\`Head-sha: ${TPL_REAL_HEAD}\``, TPL_REAL_HEAD) === null);
  t('⛔ the head placeholder is git\'s null oid and prefixes NO real head — an unedited paste is refused, never silently adopted', contractReviewHeadMatch(TPL_TEXT, TPL_REAL_HEAD) === null && tplOn(TPL_TEXT, TPL_REAL_HEAD).state === 'absent');
  t('the template SHOWS the rule prose failed to convey, and says it too', says(TPL_TEXT, 'FIRST thing after the colon'));
  t('the stamp control the rule line traded away survives HERE, where the author copies from', says(TPL_TEXT, '75/75'));
  t('⛔ no angle bracket anywhere in the output — the body sanitizer eats tag-shaped placeholders', !TPL_TEXT.includes('<') && !TPL_TEXT.includes('>'));
  t('⛔ nor an unfilled MENU in the record — one value per slot, never a `yes|no` shape', !TPL_RECORD.includes('|'));
  t('⭐ the record carries `Local-runs: none` — the read-only shape, declared where the reader reads it', TPL_RECORD.includes('Local-runs: none') && readLocalRuns(TPL_RECORD).value === 'none' && localRunsStand(readLocalRuns(TPL_TEXT)));
  t('…and the notes explain both values and that an absent line is not re-judged', says(TPL_TEXT, 'probe — REASON') && says(TPL_TEXT, 'not re-judged'));
  t('the printed location is the ONE thread set\'s own words', says(TPL_TEXT, `ONE comment on ${REVIEW_OF_RECORD_LOCATION};`));
  // -- item ④: the owner's full-review order rides THIS record as a fourth section ------------
  const DJ = '### ④ Design judgment';
  const headings = (lines) => lines.filter((line) => line.startsWith('### '));
  t('⭐ the bare record carries `### ④ Design judgment` right after `### ③ Boundary flags` — ONE record shape, a fourth item, never a second record', (() => { const rec = contractReviewRecordLines(); const i3 = rec.indexOf('### ③ Boundary flags'); const i4 = rec.indexOf(DJ); return i3 > 0 && i4 === i3 + 2 && headings(rec).length === 4 && rec.indexOf('Implemented-by: `claude/issue-NNNN-slug`') > i4; })());
  t('…and the schema and rules faces print it, as does `--paths` over a mixed list — read off the face table', ['schema', 'rules'].every((id) => contractReviewRecordLines({ faceId: id }).includes(DJ) && contractReviewTemplateLines({ face: id }).includes(DJ)) && contractReviewTemplateLines({ paths: MIXED }).includes(DJ));
  t('⭐ the narrowing face carries ④ too (ruling letter A): its record prints the fourth heading and `--face narrowing` fences it', contractReviewRecordLines({ faceId: 'narrowing' }).includes(DJ) && fenced(contractReviewTemplateLines({ face: 'narrowing' })).includes(DJ) && headings(contractReviewRecordLines({ faceId: 'narrowing' })).length === 4);
  t('⛔ nor the declaration face, below tier — with or without its face named', !contractReviewRecordLines({ tierName: TIER_DEFAULT_NAME }).includes(DJ) && !contractReviewRecordLines({ faceId: 'declaration', tierName: TIER_DEFAULT_NAME }).includes(DJ) && !fenced(contractReviewTemplateLines({ face: 'declaration' })).includes('④'));
  t('⭐ the face table marks exactly the three at-tier faces as full-review faces, every face answering — never a second list', REVIEW_FACES.filter((f) => f.fullReview === true).map((f) => f.id).join() === 'schema,rules,narrowing' && REVIEW_FACES.every((f) => typeof f.fullReview === 'boolean') && recordCarriesDesignJudgment(null, CONTRACT_REVIEW_TIER_NAME) && !recordCarriesDesignJudgment(null, TIER_DEFAULT_NAME));
  t('⛔ an unknown `faceId` is REFUSED, never printed as the bare record', (() => { try { contractReviewRecordLines({ faceId: 'lane' }); return false; } catch { return true; } })());
  t('⭐ item ④ is prose to every reader — a record carrying it still reads FOUND on its head and its tier STANDS', (() => { const r = tplOn(contractReviewRecordLines({ headSha: TPL_REAL_HEAD, reviewedBy: 'session_01PINFOUR' }).join('\n'), TPL_REAL_HEAD); return r.state === 'found' && r.sha === TPL_REAL_HEAD && servedTierStands(r.served); })());
  t('the notes name the rules face as the governed register, never as three surfaces, and give each surface its scenario: a skill its eval prompt and the spec it teaches, a schema its ruling or ADR and first consumer', ['the published spec, and the governed register,', 'which holds the skills and ADR surfaces the full-review order names', "against the card's eval prompt and the spec it teaches", 'against the ruling or ADR it implements and its first consumer'].every((frag) => says(TPL_TEXT, frag)) && !says(TPL_TEXT, 'the published spec, skills and ADR surfaces'));
  t('the notes explain ④: which faces, judged against the cited code and the accepted scenario, an ADR against its first consumer, the cited code READ never reviewed', ['on the schema, rules and narrowing faces', 'against the code it cites', 'scenario it is accepted', 'first consumer and its execution plan', 'READ to judge it, never', 'the declaration face alone carries no ④'].every((frag) => says(TPL_TEXT, frag)));
  t('…and name the narrowing face\'s scenario: the narrowing itself against the published spec on `main` — a declared capability taken away at the consumer, or the spec\'s own refusal made real', ['On the narrowing face, with no `hits`, the narrowing', 'against the published spec on `main`', 'declared capability away at the', "spec's own refusal real"].every((frag) => says(TPL_TEXT, frag)) && says(fenced(contractReviewTemplateLines({ face: 'narrowing' })), DJ) && !says(fenced(contractReviewTemplateLines({ face: 'declaration' })), '④'));
  // The branch placeholder is ASSEMBLED in the module body so the derivation
  // does not read it as a dead path population. This pin spells the printed
  // form OUT, here where the scan does not reach, so the assembly can never
  // quietly print something else. ⛔ Not derived from the constant: a pin
  // written from the thing it pins asserts nothing.
  t('⭐ the printed placeholder is EXACTLY the branch form, assembled or not', says(TPL_RECORD, 'Implemented-by: `claude/issue-NNNN-slug`') && RECORD_TEMPLATE_PLACEHOLDERS.implementedBy === 'claude/issue-NNNN-slug');
  // The CLI: `--template` prints exactly these lines, from a bare terminal.
  const cli = (args) => spawnSync(process.execPath, [fileURLToPath(import.meta.url), ...args], { encoding: 'utf8', timeout: 60_000 });
  const printed = cli(['--template']);
  t('⭐ `--template` prints exactly `contractReviewTemplateLines()` and exits 0', printed.status === 0 && printed.stdout === `${contractReviewTemplateLines().join('\n')}\n`, `status ${printed.status} ${String(printed.stderr).split('\n')[0]}`);
  const refused = cli(['--pair', '13910']);
  t('⛔ an argument this file does not honour is REFUSED with the usage, exit 1 — never a silent 0', refused.status === 1 && says(refused.stderr, 'usage: node scripts/pm/record-recognisers.mjs') && says(refused.stderr, '--pair 13910'), `status ${refused.status}`);
  t('`--help` prints the same usage on stdout and exits 0', (() => { const h = cli(['--help']); return h.status === 0 && h.stdout === `${usageLines().join('\n')}\n`; })());

  // -- the reviewer BRIEF template -------------------------------------------
  //
  // The read-only shape lives in one rule line, and a hand-written brief
  // dropped it for a whole shift. A brief printed from the file that reads the
  // record cannot drop it, and it names the record's template instead of
  // restating it.
  battery('the reviewer BRIEF template — the read-only shape a hand-written brief dropped, built in and printed');
  const BRIEF_TEXT = contractReviewBriefLines().join('\n');
  const BRIEF_BODY = BRIEF_TEXT.slice(BRIEF_TEXT.indexOf(BRIEF_TEMPLATE_FENCE_START) + BRIEF_TEMPLATE_FENCE_START.length, BRIEF_TEXT.indexOf(BRIEF_TEMPLATE_FENCE_END));
  t('⭐ the brief carries the READ-ONLY rule in the ⛔ form: no worktree, no build, no test run, no gate re-run, no ablation', says(BRIEF_BODY, '⛔ READ-ONLY') && ['No worktree', 'no checkout', 'no build', 'no test run', 'no gate re-run', 'no ablation'].every((s) => says(BRIEF_BODY, s)));
  t('…and says the check-runs on the head ARE the gate verdicts', says(BRIEF_BODY, 'check-runs') && says(BRIEF_BODY, 'ARE the gate verdicts'));
  t('…and is adversarial: not the dispatch order, not the dispatching seat\'s conclusions', says(BRIEF_BODY, 'Not the dispatch order') && says(BRIEF_BODY, "dispatching seat's own conclusions"));
  t('…and names the record\'s `Local-runs:` line with both values, so a deviation is written where `readLocalRuns` reads it', says(BRIEF_BODY, 'Local-runs:') && says(BRIEF_BODY, 'probe — REASON') && says(BRIEF_BODY, '`none`'));
  t('…and points at `--template` for the record rather than restating it, and at the ONE thread set for where it lands', says(BRIEF_BODY, 'record-recognisers.mjs --template') && says(BRIEF_BODY, REVIEW_OF_RECORD_LOCATION));
  t('…and scopes scratch to the PR-named directory, reading nothing not written this round', says(BRIEF_BODY, '/pr-') && says(BRIEF_BODY, 'did not write this round'));
  t('the tier is named by the constant\'s NAME — and no model identifier anywhere in the output', says(BRIEF_BODY, CONTRACT_REVIEW_TIER_NAME) && !isModelIdentifierToken(BRIEF_TEXT));
  t('⛔ no angle bracket anywhere in the output — the body sanitizer eats tag-shaped placeholders', !BRIEF_TEXT.includes('<') && !BRIEF_TEXT.includes('>'));
  t('the four placeholders are all in the fenced region, and are words, not digits a reader could mistake for a real number', Object.values(BRIEF_TEMPLATE_PLACEHOLDERS).every((p) => BRIEF_BODY.includes(p)) && !/#\d/.test(BRIEF_BODY));
  t('filled in, the placeholders are gone and the values are there', (() => { const b = contractReviewBriefLines({ pr: 20254, card: 20188, headSha: 'a'.repeat(40), scratchpad: '/tmp/s' }).join('\n'); return b.includes('PR #20254') && b.includes('card #20188') && b.includes('/tmp/s/pr-20254/') && !b.includes('PR-NUMBER') && !b.includes('CARD-NUMBER'); })());
  const printedBrief = cli(['--brief-template']);
  t('⭐ `--brief-template` prints exactly `contractReviewBriefLines()` and exits 0', printedBrief.status === 0 && printedBrief.stdout === `${contractReviewBriefLines().join('\n')}\n`, `status ${printedBrief.status} ${String(printedBrief.stderr).split('\n')[0]}`);
  t('…and the usage names it', usageLines().join('\n').includes('--brief-template'));
  // -- item ④ in the brief: the adversarial design-judgment instruction and the surface-file scope rule --
  t('⭐ the brief carries the ④ instruction, adversarial: hold against the code it cites and the accepted scenario, an ADR against its first consumer and execution plan, try to break it, a must-fix is a FAIL', ['④ Design judgment', 'against the code it cites', 'scenario it is accepted against', 'first consumer and its execution plan', 'try to break the design', 'must-fix or should-fix', 'A must-fix is a FAIL', 'Judge the tree'].every((frag) => says(BRIEF_BODY, frag)));
  t('…and names the accepted scenario per surface, not for an ADR alone: a skill file against the card\'s eval prompt and the spec it teaches, a schema file against its ruling or ADR and its first consumer', ["A skill file against the card's eval prompt and the spec it teaches", 'a schema file against the ruling or ADR it implements and its first consumer', 'an ADR', 'against its first consumer and its execution plan'].every((frag) => says(BRIEF_BODY, frag)));
  t('…and the surface-file scope rule: ④ judges the `hits` files ONLY; lockfiles, generated output, changesets and prose elsewhere are not reviewed; the cited code is READ, never reviewed', ['④ judges the `hits` files ONLY', 'lockfiles, generated output, changesets and prose', 'not reviewed', 'READ to judge them, never reviewed'].every((frag) => says(BRIEF_BODY, frag)));
  t('…on the schema, rules and narrowing faces and over a mixed path list alike', ['schema', 'rules', 'narrowing'].every((id) => contractReviewBriefLines({ face: id }).join('\n').includes('④ Design judgment')) && contractReviewBriefLines({ paths: MIXED }).join('\n').includes('④ judges the `hits` files ONLY'));
  t('⭐ the narrowing brief carries ④ in the narrowing\'s own shape — the narrowing itself against the published spec on `main`, over the whole-diff floor, no `hits`-ONLY rule', (() => { const b = contractReviewBriefLines({ face: 'narrowing' }).join('\n'); return ['④ Design judgment — the narrowing itself, read against the published spec on `main`', 'declared capability away at the consumer', "spec's own refusal real", '⛔ never narrowed at the consumer', '④ judges the narrowing itself over that floor', 'A must-fix is a FAIL', 'Judge the tree'].every((frag) => says(b, frag)) && !b.includes('files ONLY') && !b.includes('<') && !b.includes('>') && !isModelIdentifierToken(b); })());
  t('…and the `hits` faces keep the per-file ④ shape, never the narrowing\'s', ['schema', 'rules'].every((id) => { const b = contractReviewBriefLines({ face: id }).join('\n'); return says(b, 'for EVERY `hits` file') && !says(b, 'the narrowing itself'); }) && !says(BRIEF_BODY, 'the narrowing itself'));
  t('⛔ nor the declaration brief, below tier', !contractReviewBriefLines({ face: 'declaration' }).join('\n').includes('④'));
  t('⛔ the ④ text keeps the brief free of angle brackets, model identifiers and digit-shaped card numbers', !BRIEF_TEXT.includes('<') && !BRIEF_TEXT.includes('>') && !isModelIdentifierToken(BRIEF_TEXT) && !/#\d/.test(BRIEF_BODY));

  // -- #18701: ONE thread set -- what the template STATES, the guard READS -----
  //
  // The set of threads a review of record may live on is DECLARED once
  // (`REVIEW_OF_RECORD_THREADS`), and these cases drive the queue guard's
  // references tier with it rather than writing the two sets side by side. The
  // stated set is read out of the text `--template` prints; the read set is
  // measured by running the guard once per thread with this file's own
  // template sitting on that thread ALONE. Edit either side by hand and one
  // of them reddens.
  battery('#18701: ONE thread set -- what the template STATES is what the queue guard READS');
  const GUARD = await import('./check-governed-queue-guard.mjs');
  // The register is scoped per row, so every guard question names its
  // repository; this pin drives the guard for THIS repository's own queue.
  const { SELF_REPO_ID: GUARD_REPO } = await import('./check-governed-merges.mjs');
  const TEMPLATE_TEXT = contractReviewTemplateLines().join('\n');
  const THREAD_SET = REVIEW_OF_RECORD_THREADS.map((thread) => thread.where).join();

  // STATED -- read off the printed instruction, never restated here.
  const stated = REVIEW_OF_RECORD_THREADS.filter((thread) => TEMPLATE_TEXT.includes(thread.words)).map((thread) => thread.where).join();

  // READ -- measured by driving the guard's references tier, one run per thread.
  const PIN_HEAD = 'dead1234beef5678'.padEnd(40, '0');
  const PIN_PR = 4101;
  const PIN_CARD = 4102;
  // ⭐ The fixture record IS what `--template` tells a seat to paste, so this
  // pin also answers "is the thing we tell them to copy accepted where we tell
  // them to put it" -- in both places, on the same run.
  const PIN_RECORD = {
    id: 7701,
    created_at: '2026-09-16T10:00:00Z',
    body: contractReviewRecordLines({ headSha: PIN_HEAD, reviewedBy: 'session_01PINSEAT' }).join('\n'),
  };
  // A Tier S path (the register's `.claude/**` row since #19133). The control
  // below asks the register, so a row moving tiers reddens here instead of
  // silently driving the approval leg.
  const TIER_S_PATH = '.claude/skills/pm-dispatch/references/contract-review.md';
  t('⛔ CONTROL: the fixture path is Tier S under the register, so the record leg is the one being driven', GUARD.governedTierFor([TIER_S_PATH], GUARD_REPO) === GUARD.TIER_S);
  const pinRun = async (where) => {
    const threadsRead = [];
    const verdict = await GUARD.runGuard({
      event: GUARD.EVENT_MERGE_GROUP,
      repo: GUARD_REPO,
      rows: [{ sha: 'e'.repeat(40), subject: `x (#${PIN_PR})`, pr: PIN_PR, paths: [TIER_S_PATH] }],
      fetchReviews: async () => [],
      fetchPull: async () => ({ sha: PIN_HEAD, body: `Fixes #${PIN_CARD}`, headRef: `claude/issue-${PIN_CARD}-x` }),
      fetchComments: async (n) => {
        threadsRead.push(n);
        return (n === PIN_PR ? 'PR' : 'card') === where ? [PIN_RECORD] : [];
      },
      loadRecognisers: GUARD.loadRecordRecognisers,
    });
    return { verdict, threadsRead, record: verdict.entries[0]?.record ?? null };
  };
  const pinRuns = [];
  for (const thread of REVIEW_OF_RECORD_THREADS) pinRuns.push([thread.where, await pinRun(thread.where)]);
  const readSet = pinRuns.filter(([, r]) => r.verdict.exitCode === GUARD.EXIT_CLEAR && r.record?.state === 'stands').map(([where]) => where).join();

  t(`⭐ the set the TEMPLATE states IS the set the GUARD reads (${THREAD_SET})`, stated === THREAD_SET && readSet === THREAD_SET, `stated=[${stated}] read=[${readSet}]`);
  t('⛔ CONTROL: the pin is not vacuous -- the set has two locations, not one', REVIEW_OF_RECORD_THREADS.length === 2 && stated.includes('PR') && stated.includes('card'));
  t('…and each run located the record on the thread it was posted to, not on the other one', pinRuns.every(([where, r]) => r.record?.where === where), JSON.stringify(pinRuns.map(([w, r]) => [w, r.record?.where])));
  t('…and the guard fetched exactly ONE thread per entry in the set, no more and no fewer', pinRuns.every(([, r]) => r.threadsRead.join() === `${PIN_PR},${PIN_CARD}`), JSON.stringify(pinRuns.map(([, r]) => r.threadsRead)));
  t('⛔ CONTROL: with the record on NEITHER thread the same run is refused -- the pin can fail', await (async () => { const none = await pinRun('nowhere'); return none.verdict.exitCode !== GUARD.EXIT_CLEAR && none.record?.state === 'absent'; })());
  t('the guard prints the location in the WORDS this file owns, so a seat is told one thing', GUARD.REVIEW_OF_RECORD_LOCATION === REVIEW_OF_RECORD_LOCATION && TEMPLATE_TEXT.includes(`ONE comment on ${REVIEW_OF_RECORD_LOCATION}`));
  t('⭐ the record the guard cleared carries the at-tier `Scope:` line — the guard reads past it, unchanged (ruling record 6184805932)', PIN_RECORD.body.includes(`\nScope: ${RECORD_SCOPE_PLACEHOLDERS.hits} + ${RECORD_SCOPE_PLACEHOLDERS.cited}\n`) && readSet === THREAD_SET);

  // The reader itself is built FROM the set, so a thread added to it is a thread
  // searched -- the property the two consumers above rest on.
  const PIN_PAIR = { pr: PIN_PR, card: PIN_CARD, headSha: PIN_HEAD, prComments: [], cardComments: [] };
  t('`locateReviewOfRecord` accounts for EVERY thread in the set, by the keys the set itself declares', (() => { const r = locateReviewOfRecord(PIN_PAIR); return r.state === 'absent' && REVIEW_OF_RECORD_THREADS.every((thread) => Object.hasOwn(r.read, thread.number)); })());
  t('…and a thread the pair does not carry is a GAP named in the words the set itself declares', (() => { const r = locateReviewOfRecord({ ...PIN_PAIR, cardComments: null }); return r.state === 'unreadable' && r.gaps.some((g) => g.includes(`card #${PIN_CARD}`)); })());

  // `deliveredCardNumber` -- the other half the guard needs, and it asks the ONE
  // relation rather than grading evidence a second time.
  const PIN_PULL = (body, ref = 'feat/none') => ({ number: PIN_PR, body, head: { ref } });
  t('a closing keyword names the card', deliveredCardNumber(PIN_PULL(`Fixes #${PIN_CARD}`)).card === PIN_CARD && deliveredCardNumber(PIN_PULL(`Fixes #${PIN_CARD}`)).evidence === 'closing-keyword');
  t('a `Part of` declaration names it too, at its own grade', deliveredCardNumber(PIN_PULL(`Part of #${PIN_CARD}`)).evidence === 'part-of');
  t('the branch name is the fallback, and ONLY when the body declares nothing', deliveredCardNumber(PIN_PULL('no declaration', `claude/issue-${PIN_CARD}-x`)).evidence === 'branch-name' && deliveredCardNumber(PIN_PULL('Fixes #4444', `claude/issue-${PIN_CARD}-x`)).card === 4444);
  t('⛔ a body naming NO card yields no card and a reason, never a guess', (() => { const r = deliveredCardNumber(PIN_PULL('nothing here')); return r.card === null && r.reason.includes('names no card'); })());
  t('⛔ two cards at the SAME strength yield NEITHER, and the reason names both', (() => { const r = deliveredCardNumber(PIN_PULL('Fixes #4444\nFixes #5555')); return r.card === null && r.reason.includes('#4444') && r.reason.includes('#5555'); })());
  t('…while a STRONGER grade still decides, so a stray `Part of` beside a keyword is not a tie', deliveredCardNumber(PIN_PULL(`Fixes #${PIN_CARD}\n\npart of #4444 already landed`)).card === PIN_CARD);
  t('⛔ CONTROL: the ranking belongs to `deliveryEvidence` -- every grade it answers is ranked here, none invented', DELIVERY_EVIDENCE_PRECEDENCE.every((kind) => deliveryEvidenceNote(kind) !== 'evidence unread') && new Set(DELIVERY_EVIDENCE_PRECEDENCE).size === DELIVERY_EVIDENCE_PRECEDENCE.length);
  t('…and it is ranked in the order that function applies, measured pair by pair', DELIVERY_EVIDENCE_PRECEDENCE.indexOf(deliveryEvidence(PIN_PULL(`Fixes #1\nPart of #2`), '1')) < DELIVERY_EVIDENCE_PRECEDENCE.indexOf(deliveryEvidence(PIN_PULL(`Fixes #1\nPart of #2`), '2')) && DELIVERY_EVIDENCE_PRECEDENCE.indexOf('part-of') < DELIVERY_EVIDENCE_PRECEDENCE.indexOf('branch-name'));

  // -- The floor: every declared battery RAN, and ran its cases (#13489) -----
  //
  // Evaluated after every battery has had its chance and BEFORE the verdict, so
  // the success line below can only be printed by a run in which the set of
  // batteries that registered assertions EQUALS the set declared. A set
  // difference names WHICH battery stopped; a count says only that something did.
  const floorFailure = (message) => { cases.push({ name: message, ok: false }); };
  const declaredBatteries = Object.keys(SELF_TEST_BATTERIES);
  let floorBreached = false;
  if (declaredBatteries.length < SELF_TEST_BATTERY_FLOOR) {
    floorBreached = true;
    floorFailure(
      `SELF_TEST_BATTERIES declares ${declaredBatteries.length} batteries, below the pinned `
        + `${SELF_TEST_BATTERY_FLOOR} — a battery deleted from the roster takes its own floor with it.`,
    );
  }
  for (const [name, count] of batterySeen) {
    if (declaredBatteries.includes(name)) continue;
    floorBreached = true;
    floorFailure(
      `self-test battery "${name}" registered ${count} case(s) but is not declared in `
        + 'SELF_TEST_BATTERIES — an assertion attributed to no declared battery is one nothing floors.',
    );
  }
  for (const name of declaredBatteries) {
    const count = batterySeen.get(name) ?? 0;
    if (count >= SELF_TEST_BATTERIES[name]) continue;
    floorBreached = true;
    floorFailure(
      count === 0
        ? `self-test battery "${name}" DID NOT RUN — 0 cases registered, ${SELF_TEST_BATTERIES[name]} pinned. `
          + 'The verdict below would have claimed those cases hold.'
        : `self-test battery "${name}" registered ${count} case(s), below its pinned floor of `
          + `${SELF_TEST_BATTERIES[name]} — cases that used to run no longer do.`,
    );
  }
  if (floorBreached) {
    floorFailure(
      'A battery at or below its floor means cases STOPPED RUNNING — the battery is the bug, not the '
        + 'number. Find what stopped registering (an early return, a deleted block, a guard that now '
        + 'skips) and restore it.',
    );
  }

  const failed = cases.filter((c) => !c.ok);
  for (const c of failed) console.error(`  ✗ ${c.name}${c.detail ? ` — ${c.detail}` : ''}`);
  if (failed.length) {
    console.error(`✗ record-recognisers self-test: ${failed.length} of ${cases.length} case(s) failed.`);
    return 1;
  }
  console.log(
    `✓ record-recognisers self-test: ${cases.length} cases pass (the locator on either thread with its `
      + 'recognition dialects, the unsigned and newest-governs readings and the two gaps; the head sha in a span '
      + 'of its own; the `Served-tier:` reading — at tier, below, missing, unreadable, the identifier refused by '
      + 'value and by shape, the stamp control and the measured continuation spelling; the review tier read off '
      + 'the face — schema, governed rules text, a declared narrowing read off the `Clause-②:` line, the declaration alone — '
      + 'exact in both directions, an unread or malformed declaration UNREADABLE; the at-tier scope '
      + 'floor read off `hits` onto the `Scope:` line and into the brief, `--paths` included; the pure-regeneration carry and the prose-only carry decided on committed trees in '
      + 'every direction; the copyable template, per face, driven back through the '
      + 'locator and printed by `--template`; the `Local-runs:` reading — none, one named probe, absent not re-judged, '
      + 'unreadable refused; the reviewer brief printed by `--brief-template` with its read-only shape; the mailbox '
      + 'doorbell — seven keys read, each spelled verbatim in the protocol text, and free text, an acknowledgement, '
      + 'an eighth key, a second line and an over-long line refused; the review claim line — read signed and unsigned, '
      + 'spelled verbatim in the rule text, lapsing on a moved head or after two hours, the lane winning a tie; the review hold '
      + 'line — read signed and unsigned, spelled verbatim in the rule text, cleared by a new head, its 24-hour age a reading '
      + 'that still holds; and the ONE '
      + 'thread set, driven through the queue guard itself).',
  );

  selfTestReachedVerdict = true;
  return 0;
}


// ---------------------------------------------------------------------------
// The CLI — the record, copyable, from a bare terminal
// ---------------------------------------------------------------------------

/**
 * The usage text. A closed set of flags and nothing else: this file judges no
 * pull request from the command line — the queue guard does that, in the merge
 * group. `--paths` only PRINTS: it reads the face and the scope floor off the
 * list a seat hands it, through the function the guard uses.
 */
export function usageLines() {
  return [
    'usage: node scripts/pm/record-recognisers.mjs [--template|--brief-template [--face FACE | --paths PATH...]] [--self-test] [--help]',
    '',
    '  --template   print the copyable contract-review record and exit 0 -- no board is read',
    "  --brief-template   print the copyable reviewer's brief, read-only shape built in, and exit 0 -- no board is read",
    `  --face FACE  the face that made the review owed, one of: ${REVIEW_FACES.map((f) => `${f.id} (${f.tierName})`).join(', ')};`,
    `               the record's \`Served-tier:\` names that tier. Without it: ${CONTRACT_REVIEW_TIER_NAME}.`,
    "  --paths PATH...  the PR's changed paths, in place of --face: `reviewFace` reads the face off them, and the",
    "               at-tier record's `Scope:` line and the brief print its `hits` filled in. Not with --face.",
    "               Refused when the paths decide no face and one is a changeset: its `Clause-②:` line decides.",
    "  --self-test  run this file's own battery, offline -- no board is read",
    '  --help, -h   print this text and exit 0',
    '',
    `  The record lands a Tier S pull request: ONE comment on ${REVIEW_OF_RECORD_LOCATION}, naming the`,
    '  head it reviewed. `check-governed-queue-guard.mjs` reads it in the merge group.',
  ];
}

/**
 * What follows `--template` / `--brief-template`: nothing, `--face FACE` naming
 * a table id, or `--paths` and at least one path — or null, and the line is
 * refused with the usage. ⛔ A flag-shaped or empty word among the paths is
 * refused too, so `--paths a --face rules` can never print one face's tier
 * beside another's scope.
 */
function templateArgsOf(rest) {
  if (rest.length === 0) return {};
  if (rest.length === 2 && rest[0] === '--face' && reviewFaceById(rest[1]) !== null) return { face: rest[1] };
  const paths = rest.slice(1);
  if (rest[0] === '--paths' && paths.length > 0 && paths.every((p) => p !== '' && !p.startsWith('-'))) return { paths };
  return null;
}

if (isEntrypoint(import.meta.url)) {
  const argv = process.argv.slice(2);
  if (argv.length === 1 && argv[0] === '--self-test') {
    // ⭐ `.then`, ⛔ never a top-level `await`. `selfTest` is async to take a LAZY
    // import of `check-governed-queue-guard.mjs` for the thread-set pin, and that
    // guard's own docblock records what a top-level await costs on this cycle:
    // node exits 13 with "Detected unsettled top-level await" and BOTH modules
    // stop loading.
    selfTest().then(
      (selfTestCode) => {
        if (!selfTestReachedVerdict) {
          console.error(
            '\n✗ record-recognisers self-test: selfTest() returned without reaching its verdict,\n'
              + 'so no success line was printed. Exiting 0 here would report a self-test\n'
              + 'that never finished as a self-test that passed.\n',
          );
          process.exit(1);
        }
        process.exit(selfTestCode);
      },
      (error) => {
        console.error(`\n✗ record-recognisers self-test threw: ${String(error?.stack ?? error)}\n`);
        process.exit(1);
      },
    );
  } else if ((argv[0] === '--template' || argv[0] === '--brief-template') && templateArgsOf(argv.slice(1)) !== null) {
    // ⛔ `--face` takes one of the table's ids or the whole line is refused below — a face this file does
    // not map would print a tier no reader accepts.
    const asked = templateArgsOf(argv.slice(1));
    let lines;
    try {
      lines = argv[0] === '--template' ? contractReviewTemplateLines(asked) : contractReviewBriefLines(asked);
    } catch (error) {
      // A path list the face cannot be read off is refused like any other bad line: usage, the reason, exit 1.
      for (const line of usageLines()) console.error(line);
      console.error('');
      console.error(String(error?.message ?? error));
      process.exit(1);
    }
    for (const line of lines) console.log(line);
    process.exit(0);
  } else if (argv.length === 1 && (argv[0] === '--help' || argv[0] === '-h')) {
    for (const line of usageLines()) console.log(line);
    process.exit(0);
  } else {
    for (const line of usageLines()) console.error(line);
    console.error('');
    console.error(
      argv.length === 0
        ? 'record-recognisers: no flag given — this file judges nothing from the command line; `--template` prints the record.'
        : `record-recognisers: unrecognised argument(s): ${argv.join(' ')}`,
    );
    process.exit(1);
  }
}
