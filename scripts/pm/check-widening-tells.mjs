#!/usr/bin/env node
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * check-widening-tells — the MECHANICAL half of the directional clause-②
 * ruling (#16349, decision batch #62): a diff that ADDS a key, an arm, an
 * export or a registration while its card's claim reads `Clause-②: no` is
 * refused at enqueue, with the file:line of the tell (#16448).
 *
 *   node scripts/pm/check-widening-tells.mjs --self-test
 *   node scripts/pm/check-widening-tells.mjs --declaration no --diff /tmp/pr.diff
 *   node scripts/pm/check-widening-tells.mjs --declaration no --files /tmp/files.json
 *   git diff origin/main...HEAD | node scripts/pm/check-widening-tells.mjs --declaration no --diff -
 *
 * ## Why this file exists at all
 *
 * Clause ② used to be judged as a two-sided question ("does this card touch
 * the contract?"), and #16349 made it DIRECTIONAL: widening the accept set or
 * the public surface triggers the contract-review tier; pulling code back to
 * the declared contract does not. The maintainer's condition on that
 * relaxation was explicit — **the direction claim becomes checkable instead of
 * trusted**. A direction nobody can check is a self-declaration, and a
 * self-declaration that only ever loosens the tier is the one shape the whole
 * clause-② chain is written against.
 *
 * `dispatch-gates.mjs`'s `SUSPECT_TIER_GLOBS` already says where the check
 * belongs, in its own words: "whichever tier is dispatched, the PR's ACTUAL
 * diff passes the clause-② enqueue gate before the card may enqueue — the diff
 * is a fact; the card's semantics were a prediction. The gate itself lives in
 * the PM skill (入队与落地); this output only points at it." Until this file,
 * that gate was a human reading. This is it, mechanized.
 *
 * ## The four tells, and what each one is a tell OF
 *
 * A TELL, never a proof (#16448 states this as a prohibition, so it is stated
 * here as one too). Each tell is a syntactic shape that a WIDENING diff
 * normally has and a narrowing diff normally does not:
 *
 *   T1  a new key on a Zod object schema on the contract source surface — the
 *       accept set gains a spelling an author may now write.
 *   T2  a new member of a closed set: `z.enum([…])`, `z.union([…])`,
 *       `z.discriminatedUnion(…)`, or a `CORE_PLUGIN_TYPES`-shaped `as const`
 *       array — the accept set gains a VALUE.
 *   T3  a new row in a published entry point's export listing
 *       (`packages/spec/api-surface/*.json` and its signatures sibling) — the
 *       PUBLIC SURFACE grows, which ADR-0059's backward-compatibility gate
 *       already treats as the breadth half of a contract change.
 *   T4  a new registration in a registry / catalog — the error-code ledger,
 *       the dispatcher vocabulary, the metadata form registry. A registration
 *       widens what the runtime will ACCEPT without any schema file moving.
 *
 * ## What it deliberately does NOT do
 *
 * **It does not judge narrowings.** A removal-only diff with `Clause-②: no`
 * passes, and so does a tightened `.refine(…)`: a tell is an ADDITION shape and
 * this file reads added lines only. That is the ruling's own direction, not a
 * gap — a narrowing claim that is wrong is a different card's problem.
 *
 * **It never blocks a `yes`.** `Clause-②: yes` already routes to contract
 * review, so a tell on top of it adds nothing to decide. Refusing a `yes` would
 * make the honest declaration the expensive one, which is how a gate teaches
 * people to declare `no`.
 *
 * **False positives are the accepted cost; false negatives are the ruling's.**
 * #16448 fixes both directions: "False positives are acceptable (the author
 * re-declares or explains); false negatives are the cost the ruling accepted."
 * So a fixture whose added line merely LOOKS like a schema key is refused.
 *
 * ⛔ But never again describe that refusal as costing "one word in the claim
 * comment". This file said exactly that until #16822, and the sentence was
 * wrong twice over. It UNDERSTATED the price: C5's exit-0 condition is "no
 * tell, OR the declaration is not `no`", so the only word that clears a false
 * tell is flipping `Clause-②: no` to `yes` — writing a widening that does not
 * exist into a ledger consulted later as evidence of direction, where it is
 * afterwards indistinguishable from a real one. The refusal sentence's other
 * door, "explain in the claim", is a reading a human can act on; it moves no
 * exit code. ⛔ Recording that is not proposing a bypass, and this file offers
 * none: the #16448 row stands and a non-zero `--pair` exit stays a hard block.
 * It means a DEMONSTRATED false positive is repaired HERE, in the matcher —
 * the author is not asked to pay for a regex collision with a false
 * declaration, because the declaration is a governance record, not a log.
 *
 * ⛔ And the sentence's second half — "never a weakened rule here" — was
 * defending something real, so it is restated rather than dropped: a tell may
 * be narrowed only on evidence the hunk actually CARRIES, and never in a way
 * that trades a loud failure for a quiet one. A matcher that stops reporting a
 * real widening is worse than one that over-reports, because an over-report
 * argues back and a silence does not. Every narrowing below therefore declines
 * ONLY on positive evidence; absence of evidence leaves the tell firing.
 *
 * ## The two accidental variables #16822 removed — what a hunk DOES carry
 *
 * Both refinements read bytes the hunk already contains: the added line's
 * NEIGHBOURS on the new-file side, and the lines the same hunk REMOVED. ⛔
 * Neither recovers block state. This file still cannot tell an array element
 * from a call argument, still does not know whether a property sits inside
 * `z.object({`, and ⛔ still has no notion of DIRECTION — a tell, never a
 * proof, exactly as before.
 *
 * **A fragment of a multi-line string concatenation is not a set member.**
 * #16822's filing left the instrument that proves the variable was accidental:
 * a prose message of EIGHT fragments produced exactly ONE tell, because
 * fragments 2-8 begin `+ '…'` and `^[ \t]*'` cannot match a leading `+`.
 * Moving the first fragment up onto the calling line makes the IDENTICAL
 * string stop being a tell. So the continuation operator is now read on both
 * sides — the `+` that opens the next line, and the `+` left at the end of the
 * previous one, since both spellings are in the tree. Measured 2026-09-08 over
 * `packages/spec/src/**`: of 6,035 lines matching the bare-element shape,
 * 1,707 are followed by a `+ '…'` continuation and 479 follow a line ending in
 * `+` — 2,186 prose fragments on the surface T2 polices, none of them a member
 * of anything.
 *
 * ⚠️ The quiet direction that buys, stated plainly rather than buried: a
 * closed-set MEMBER spelled as a multi-line concatenation — `'be'` on one line,
 * `+ 'ta',` on the next — is now declined, and adding one would go unreported.
 * Measured over `packages/spec/src/**` and `packages/runtime/src/**`: of 4,957
 * member lines inside 401 array / closed-set blocks, the 116 that are
 * multi-line concatenations are all property VALUES (the `reason:` prose of
 * the ledger's waiver rows), and no MEMBER is spelled that way. ⛔ That is not
 * zero risk; it is the only quiet direction #16822 added, and it is here so the
 * next reader can weigh it rather than discover it.
 *
 * **An opener that re-declares the SAME binding adds no value.**
 * `CLOSED_SET_OPENER` fires on the constructor keyword, identically whether the
 * rewrite widens the set or narrows it. #16822's second instance was three
 * `z.union([` → `z.discriminatedUnion('type', [` conversions, which cannot
 * widen — the discriminated form tries exactly ONE arm where the flat form
 * tried all of them, so its accept set is a subset — and the gate called them
 * widening tells. ⛔ The fix does not teach the matcher direction: direction is
 * no more recoverable from a hunk than block state is. It drops a line that
 * never carried the information. An opener whose list opens on a LATER line
 * declares no member at all, and when the SAME hunk removes an opener with the
 * identical binding prefix, the set was already there; its members are still
 * read one line each by the two member tells, so an arm the rewrite ADDS still
 * fires.
 *
 * ⚠️ The evidence must be in the hunk: no paired removal, no suppression — a
 * brand-new `z.union([` still tells. A prefix that differs is not the same
 * binding and keeps the tell, which is the right answer when the difference is
 * `const X =` → `export const X =`: that rewrite really does widen, on the
 * published surface rather than the accept set. And an opener carrying its
 * members INLINE (`z.enum(['a', 'b'])`) is not an opener-only line, so it is
 * never suppressed.
 *
 * **An unread diff is not a narrow diff.** A file on a tell surface whose
 * content this gate could not read is reported as a GAP (exit 2), never folded
 * into the clean verdict — and the counting that decides it distinguishes a
 * count that was TAKEN from a count that is MISSING (`addedNothing`). The
 * failure this rule is written against is not hypothetical: the local diff
 * splitter briefly stamped `additions: 0` on binary rows, which made a binary
 * edit to a published-surface file read as clean through the very gate whose
 * contract this is.
 *
 * **It writes nothing and hangs no label.** Same call `check-clause2-carriers`
 * and `check-half-states` make: a checker that hung `needs:contract-review`
 * would be issuing the review verdict, which is 自查放行. ⛔ No new label and no
 * new claim-line syntax exist because of this file — #16448 forbids both, and
 * the reader it uses is the sibling's existing `Clause-②:` reader.
 *
 * ## Where the surfaces come from — imported, never hand-copied
 *
 * The contract SOURCE surface is `SUSPECT_TIER_GLOBS`, imported from
 * `dispatch-gates.mjs`. It is declared once there and a second spelling here
 * would be the hand-copied register `check:pm-governed-prose` exists to stop
 * one family over — and the two would then disagree about the same path on the
 * day one of them moved.
 *
 * The PUBLISHED surface is derived from `REGEN_ARTIFACTS` in
 * `scripts/regen-artifacts.mjs` — the rows whose `check` is
 * `check:api-surface`. Same reason: that table already owns the answer to
 * "which committed files ARE the published export listing", it is guarded by
 * its own gate, and a shard added there (#5837 sharded this surface once
 * already) reaches this gate without an edit.
 *
 * `REGISTRATION_SURFACES` below is the ONE table this file declares itself,
 * because no register in the tree carries it: "which files are closed-vocabulary
 * registries" is not a question `regen-artifacts` or the tier globs answer. It
 * is kept from rotting the same way `MANDATORY_TIER_GLOBS` is — every row must
 * name a path that EXISTS in this tree, asserted in `--self-test`, which CI
 * runs. A renamed registry leaves dead data that guards nothing while reading
 * as protection, and that is the incident class itself.
 *
 * ⚠️ Measured 2026-09-07, and recorded because the card names it: the
 * "renderer registry" of #16448's tell list has NO implementation in this repo
 * — `RendererRegistry` appears only in ADR-0012's notification-platform table.
 * The nearest live shape is `METADATA_FORM_REGISTRY`
 * (`packages/spec/src/system/metadata-form-registry.ts`), whose own docblock
 * calls it the "canonical registry of FormView layouts" consumed by "the
 * generic SchemaForm renderer", so that is the row declared. ⛔ A row for a
 * path that does not exist was NOT written: a declared-but-absent glob is the
 * dead data the existence guard exists against.
 *
 * ## The objectui mirror, and why its row is repo-keyed
 *
 * #16448 scopes T1/T2 to `packages/spec/src/**` "(or the objectui mirror
 * equivalents when run there)". objectui's mirror is `packages/types/src/zod/**`
 * (measured 2026-09-07: `app.zod.ts`, `blocks.zod.ts`, `form.zod.ts`,
 * `navigation.zod.ts`, `theme.zod.ts` all live there). This script ships only
 * in THIS repo's `scripts/pm/`, so that glob would be dead data here — hence
 * the `repo` key: a surface row applies to the repo it names, the existence
 * guard only runs over rows applicable to the local tree, and porting the gate
 * is a data edit rather than a rewrite. ⛔ The mirror row is not a claim that
 * anything runs this gate in objectui today; nothing does.
 *
 * ## Exit codes — one register, shared with the sibling
 *
 *   0  no tell, or the declaration is not `no` (a `yes` is never blocked here,
 *      and an UNREADABLE declaration is `check-clause2-carriers`'s C2 row, not
 *      this file's verdict to issue).
 *   1  bad usage — the input could not be formed, so nothing was judged.
 *   2  INCOMPLETE — a file on a tell surface arrived with no patch to read
 *      (binary, truncated by the API, or a document that omitted it). An
 *      unread diff is NOT a clean diff (#4690), and this is the one exit that
 *      must never be mistaken for 0.
 *   4  REFUSED — a widening tell with `Clause-②: no`.
 *
 * The values are pinned equal to `check-clause2-carriers`'s in THAT file's
 * self-test (it imports this one, so the pin is written on the importing side
 * and no cycle is created): a seat reading `$?` reads one table, not two.
 *
 * ## The caller
 *
 * `check-clause2-carriers.mjs --pair N` — the enqueue-path predicate a seat
 * runs before it may hand a pair to the queue (`references/contract-review.md`,
 * landing pre-check ②). That call pays ONE extra request, and only for a pair
 * whose declaration reads `no`; the report-only board SWEEP deliberately does
 * not pay it (a 29-PR sweep already costs about GitHub's whole documented
 * anonymous hourly budget, and a board fact is not a fact about whichever PR
 * runs CI next).
 *
 * The `check:pm-widening-tells` step in `lint.yml` runs the SELF-TEST only, for
 * the reason its two neighbours record: this gate's verdict is about ONE pair's
 * diff, and failing an unrelated PR's CI over it would punish the wrong actor.
 */

// ⛔ NO `dispatch-gates: no-path-population` MARKER HERE — deliberately, and the
// reasoning is worth the paragraph because the marker LOOKS right.
//
// This gate's CI command is its own `--self-test`, which is the second of the
// three causes that marker's docblock lists ("the derivation NEED NOT place it").
// On that reading the declaration is true: no card's file surface should
// schedule this command, because running it says nothing about that card's diff.
//
// But the marker is refused by `dispatch-gates`'s live guard the moment a family
// NAMES paths, and this one names 59 of them (measured on this tree): 9 from its
// own module body — the registry table, the objectui mirror glob, the two repo
// slugs and four fixture filenames — and 50 inherited from the two registers it
// imports ON PURPOSE, `SUSPECT_TIER_GLOBS` and `REGEN_ARTIFACTS`. That guard's
// own text gives the fork: "If the literals are the real population, delete the
// marker and let the matched column do its job; if they are artifacts rather
// than a population, the marker stands and the literals do not belong in a
// scanned position."
//
// Both halves of getting them out of scanned positions cost more than they buy:
// the 9 would have to become segment predicates instead of paths, and the 50
// would have to become a HAND COPY of two registers this file imports precisely
// so it can never disagree with them — which is the drift
// `check:pm-governed-prose` exists to stop one family over, and the single
// strongest property this gate has. So the marker goes and the derivation
// stands.
//
// What the derivation now says, and why it is not wrong: a card touching any of
// those 59 paths gets `pnpm check:pm-widening-tells` in its MATCHED column. For
// `packages/spec/src/**`, `packages/spec/api-surface/**` and the three
// registries that is exactly right — they are the surfaces this gate polices,
// and a dev editing one is the dev whose claim it will judge. For the tail
// inherited from `REGEN_ARTIFACTS` (`*/test-typecheck-debt.json`,
// `content/docs/references/**`, and the rest) it is noise, and the cost of that
// noise is bounded and small: the command is an offline self-test that runs in
// about a second and whose green means "the tells still work". An
// over-matched gate pastes one cheap command into a prompt; the alternative was
// a marker sitting above a live population, which is the rot direction
// `dispatch-gates` measured and refused. ⛔ Do not re-add the marker without
// first removing the imports — a green local run is not evidence, because the
// case that catches this sits at ~1534 of the self-test's assertions and needs
// well over 540s to reach (#16448 patch round 2).

import process from 'node:process';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { isEntrypoint } from '../invoked-as.mjs';
import { SUSPECT_TIER_GLOBS, hintCovers } from './dispatch-gates.mjs';
import { REGEN_ARTIFACTS } from '../regen-artifacts.mjs';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));

// -- The self-test's own battery roster and floor ---------------------------
//
// Same instrument the sibling carries, for the same reason: `failed.length === 0`
// alone cannot tell "every case held" from "the cases never ran". Every section
// opens with `battery('<name>')`, every assertion is attributed to the battery
// most recently opened, and the floor requires the OPENED set to equal the
// DECLARED set with each battery at or above its own count.
//
// The counts are a FLOOR, not an equality — adding cases is ordinary work and
// must not red. A battery BELOW its floor means cases stopped running.
const SELF_TEST_BATTERIES = Object.freeze({
  'the patch reader: added lines, and the line numbers they carry': 17,
  'the unified-diff splitter, for the local `git diff` path': 15,
  'the local path composed: an unread diff is not a narrow diff': 7,
  'the surfaces, imported rather than restated': 11,
  'T1 — a new key on a Zod object schema': 14,
  'T2 — a new member of a closed set': 13,
  '#16822 — the two accidental variables, and the evidence each one needs': 15,
  'T3 — a new row in a published entry point': 8,
  'T4 — a new registration in a registry': 10,
  '#16448 acceptance: the four positive controls, each with its file:line': 8,
  '#16448 acceptance: the negative controls a widening gate must let through': 10,
  'the refusal sentence, and the two prohibitions it must keep': 8,
  'the exit register is distinct in every direction it must be': 6,
  'the declared registry rows still exist in this tree': 4,
});

// DELETING an entry silences that battery's floor exactly as effectively as
// zeroing it, so the roster's own size is pinned too.
const SELF_TEST_BATTERY_FLOOR = 13;

// The key an assertion is filed under when no battery is open. It is not a
// declared battery, so it reds by the same set difference rather than silently
// inflating whichever battery happened to run last.
const UNATTRIBUTED_BATTERY = '(no battery open)';

export const EXIT_OK = 0;
export const EXIT_USAGE = 1;
export const EXIT_INCOMPLETE = 2;
/** A widening tell was found on a diff whose card declares `Clause-②: no`. */
export const EXIT_REFUSED = 4;

/**
 * The sentence #16448 fixes, quoted from the card and NOT paraphrased.
 *
 * It is a constant because the whole point of the refusal is that the author
 * knows the two ways out of it — re-declare, or explain — without reading this
 * file. A row renders it once; ⛔ never a second wording per tell.
 */
export const REFUSAL_SENTENCE =
  'a widening tell with `Clause-②: no` — re-declare `yes` or explain in the claim why this ' +
  'addition does not widen';

// ---------------------------------------------------------------------------
// The surfaces
// ---------------------------------------------------------------------------

/** This repo, as a surface row names it. Rows with no `repo` mean this one. */
export const THIS_REPO = 'objectstack-ai/objectstack';

/**
 * The contract SOURCE surface — T1 and T2 live here.
 *
 * Built from `SUSPECT_TIER_GLOBS`, imported. That table's own docblock calls
 * `packages/spec/src/**` "the contract surface (error-code ledger, *.zod.ts
 * contract schemas) — the normal landing zone of a clause-② card", which is
 * exactly the population these two tells want, and it is declared THERE.
 *
 * The objectui mirror is repo-keyed; see the header for why it is declared but
 * inert in this tree.
 */
export const CONTRACT_SOURCE_SURFACES = Object.freeze([
  ...SUSPECT_TIER_GLOBS.map((g) => Object.freeze({ glob: g.glob, repo: THIS_REPO, why: g.why, imported: 'SUSPECT_TIER_GLOBS' })),
  Object.freeze({
    glob: 'packages/types/src/zod/**',
    repo: 'objectstack-ai/objectui',
    why: "objectui's mirror of the contract schemas (#16448: \"or the objectui mirror equivalents when run there\")",
    imported: null,
  }),
]);

/**
 * The PUBLISHED export surface — T3.
 *
 * Derived from the generated-artifact register, so a new shard reaches this
 * gate without an edit here. `check:api-surface` is the discriminator because
 * it is what the register itself uses to name this artifact family.
 */
export const PUBLISHED_SURFACES = Object.freeze(
  REGEN_ARTIFACTS.filter((row) => row.check === 'check:api-surface').map((row) =>
    Object.freeze({ glob: row.path, repo: THIS_REPO, why: `the ${row.check} artifact family`, imported: 'REGEN_ARTIFACTS' }),
  ),
);

/**
 * The REGISTRY surface — T4. The one table this file declares itself.
 *
 * Every row must name a path that EXISTS in this tree (asserted in
 * `--self-test`); see the header for why a row for #16448's "renderer registry"
 * was not written, and what was written in its place.
 */
export const REGISTRATION_SURFACES = Object.freeze([
  Object.freeze({
    glob: 'packages/spec/src/api/error-code-ledger.zod.ts',
    repo: THIS_REPO,
    why: 'ERROR_CODE_LEDGER — a registered code is one `ApiErrorSchema.code` accepts, so a row here widens the wire vocabulary (ADR-0112 D3)',
    imported: null,
  }),
  Object.freeze({
    glob: 'packages/runtime/src/dispatcher-error-vocabulary.ts',
    repo: THIS_REPO,
    why: "the dispatcher vocabulary's declaration half — the classification ledger check:dispatcher-error-vocabulary reconciles against the scan",
    imported: null,
  }),
  Object.freeze({
    glob: 'packages/spec/src/system/metadata-form-registry.ts',
    repo: THIS_REPO,
    why: 'METADATA_FORM_REGISTRY — the canonical FormView registry the generic SchemaForm renderer reads; the live shape nearest #16448\'s "renderer registry"',
    imported: null,
  }),
]);

/** Every declared surface, in one list, so a caller can render the whole set. */
export const ALL_SURFACES = Object.freeze([
  ...CONTRACT_SOURCE_SURFACES,
  ...PUBLISHED_SURFACES,
  ...REGISTRATION_SURFACES,
]);

/**
 * Do any of these surface rows cover `filename`, for a run against `repo`?
 *
 * A row whose `repo` is not the run's repo is INERT — not a miss to be
 * explained, simply not this repo's surface. `hintCovers` is the sibling
 * family's one path matcher (imported), so a glob gets segment-boundary
 * semantics rather than string-prefix ones for free.
 */
export function surfaceCovers(surfaces, filename, repo = THIS_REPO) {
  if (typeof filename !== 'string' || filename === '') return false;
  return surfaces.some((s) => (s.repo == null || s.repo === repo) && hintCovers(s.glob, filename));
}

/** A source file the tells read — ⛔ never a test, which declares no contract. */
export function isContractSourceFile(filename) {
  return /\.(?:ts|mts|cts)$/.test(filename) && !/\.(?:test|spec|pin\.test)\.[cm]?ts$/.test(filename);
}

// ---------------------------------------------------------------------------
// Reading a patch
// ---------------------------------------------------------------------------

const HUNK_HEADER = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/;

/**
 * Every line of one patch, tagged with the side it is on and the hunk it came
 * from — `addedLines` below is one projection of this reading.
 *
 * The three kinds are kept apart because two of #16822's readings need what an
 * added line's NEIGHBOURS say: `context` lines are the new file's other lines,
 * `removed` lines are what the same hunk replaced. ⛔ A removed line carries
 * `line: null` — it has no position in the new file, and the one thing this
 * reader must never do is invent one. `hunk` is carried so no caller can read
 * adjacency ACROSS a hunk boundary, where the file's real lines are missing.
 *
 * The line number is the whole reason this is not a `split('\n').filter()`: the
 * card requires a file:line on every refusal, and a refusal an author cannot
 * navigate to is a refusal they will argue with rather than fix.
 *
 * ⛔ Removed lines advance nothing and context lines advance by one — getting
 * that backwards produces plausible numbers that point at the wrong line, which
 * is worse than no number at all. Both directions are pinned in `--self-test`.
 *
 * @param {string|null|undefined} patch — a unified diff body, hunk headers
 *   included. GitHub's `/pulls/N/files` `patch` field is exactly this shape.
 * @returns {{ line: number, text: string }[]}
 */
export function patchLines(patch) {
  const out = [];
  if (typeof patch !== 'string' || patch === '') return out;
  let lineNo = 0;
  let hunk = -1;
  let inHunk = false;
  for (const raw of patch.split('\n')) {
    const header = HUNK_HEADER.exec(raw);
    if (header) {
      lineNo = Number(header[1]);
      inHunk = true;
      hunk += 1;
      continue;
    }
    // The file headers of a full `git diff` — `+++` must be tested BEFORE the
    // `+` branch below, or every patch reports a phantom addition at line 1.
    if (raw.startsWith('+++') || raw.startsWith('---') || raw.startsWith('diff --git')) continue;
    if (raw.startsWith('\\')) continue; // "\ No newline at end of file"
    if (!inHunk) continue;
    if (raw.startsWith('+')) {
      out.push({ line: lineNo, text: raw.slice(1), kind: 'added', hunk });
      lineNo += 1;
      continue;
    }
    if (raw.startsWith('-')) {
      // Removed: consumes no new-file line, so it carries NO number. ⛔ Not 0
      // and not the next line's — a removal has no position in the file the
      // author will open, and inventing one is the off-by-one this reader's
      // whole battery exists against.
      out.push({ line: null, text: raw.slice(1), kind: 'removed', hunk });
      continue;
    }
    out.push({ line: lineNo, text: raw.startsWith(' ') ? raw.slice(1) : raw, kind: 'context', hunk });
    lineNo += 1; // context (a leading space, and the empty trailing line)
  }
  return out;
}

/**
 * The ADDED lines of one patch — the projection of `patchLines` this file's
 * four tells are written against, and the shape every caller already reads.
 */
export function addedLines(patch) {
  return patchLines(patch)
    .filter((r) => r.kind === 'added')
    .map((r) => ({ line: r.line, text: r.text }));
}

const DIFF_GIT = /^diff --git a\/(.+?) b\/(.+)$/;

/**
 * How `git diff` says "there is no text hunk because the content is BINARY".
 *
 * Both spellings, because both reach this reader: the default one-line
 * `Binary files a/x and b/x differ`, and the `GIT binary patch` block a
 * `--binary` diff emits instead. A file with neither marker AND no hunk is a
 * mode-only change or a pure rename — those really do add nothing, and telling
 * them apart from a binary is the whole point of reading the marker rather than
 * inferring from the missing hunk.
 */
const BINARY_MARKER = /^(?:Binary files .* differ|GIT binary patch)$/m;

/**
 * Split a whole `git diff` into the per-file rows this gate judges.
 *
 * This is the LOCAL read path — `git diff <merge-base>...HEAD` — and it exists
 * so a seat with no API budget can run the same predicate on the same bytes.
 * The row shape is GitHub's (`filename`, `status`, `patch`) so nothing
 * downstream can tell the two paths apart, which is what stops them drifting.
 *
 * A file with a `diff --git` header and no hunk yields `patch: null`. Whether
 * that is UNREAD or genuinely EMPTY is read off the diff itself, never guessed:
 * a `Binary files … differ` / `GIT binary patch` marker means git could not show
 * the content, so `additions` is `null` (UNKNOWN) and the caller reports a gap
 * on a tell surface; no marker and no hunk means a mode-only change or a pure
 * rename, which really did add nothing, so `additions` is `0` and the row is
 * clean. ⛔ This function never turns an unread file into a clean reading — and
 * the way it used to was by stamping `addedLines(null).length` on every row,
 * which wrote `0` for a binary change and let a binary edit to
 * `api-surface/*.json` pass as narrow.
 *
 * ## Why the two input paths differ here, and why that is not drift
 *
 * On the API path GitHub sends `additions: 0` for a binary row, and this file
 * KEEPS it: that zero is GitHub's own reading of its own object store, taken by
 * something that can see the blob. The local path has strictly less
 * information — `git diff` refused to show the content, and nothing downstream
 * can recover it — so it answers `null`. Same field, two producers, two
 * genuinely different states of knowledge; the asymmetry is *information
 * available*, not two readers drifting apart. `addedNothing` is where both are
 * interpreted, once.
 */
export function splitUnifiedDiff(text) {
  const rows = [];
  if (typeof text !== 'string' || text.trim() === '') return rows;
  let current = null;
  const flush = () => {
    if (!current) return;
    const body = current.body.join('\n');
    const hasHunk = HUNK_HEADER.test(body) || /\n@@ /.test(`\n${body}`);
    const patch = hasHunk ? body : null;
    // `additions` is carried so the local path answers "did this file add
    // anything" in the SAME field the API path answers it in — the gap
    // accounting below reads one field, not one per input path.
    //
    // ⛔ And it is a COUNT THAT WAS TAKEN, never a default. `addedLines(null)`
    // returns an empty array, so writing `addedLines(patch).length` for every
    // row would stamp `0` on a BINARY file — a number nobody counted — and the
    // gap accounting, which skips a row that added nothing, would then read a
    // binary change to a tell surface as CLEAN. That is the exact
    // declared-but-not-enforced shape this gate exists against, inside the gate
    // itself. So the three cases are told apart by what the diff SAYS:
    //
    //   a hunk           -> the count, taken from the hunk
    //   a binary marker  -> `null`, i.e. UNKNOWN — git did not show the content,
    //                       so this reader cannot say whether anything was added
    //   neither          -> `0`, a real reading: a mode-only change or a pure
    //                       rename adds no line, and git says so by emitting
    //                       no hunk AND no binary marker
    const additions = hasHunk ? addedLines(patch).length : BINARY_MARKER.test(body) ? null : 0;
    rows.push({ filename: current.filename, status: current.status, patch, additions });
    current = null;
  };
  for (const raw of text.split('\n')) {
    const head = DIFF_GIT.exec(raw);
    if (head) {
      flush();
      current = { filename: head[2], status: 'modified', body: [] };
      continue;
    }
    if (!current) continue;
    if (raw.startsWith('new file mode')) current.status = 'added';
    else if (raw.startsWith('deleted file mode')) current.status = 'removed';
    else if (raw.startsWith('rename to ')) {
      current.status = 'renamed';
      current.filename = raw.slice('rename to '.length).trim();
    }
    current.body.push(raw);
  }
  flush();
  return rows;
}

// ---------------------------------------------------------------------------
// The four tells
// ---------------------------------------------------------------------------

/** A line that is prose inside the code — a tell never fires on a comment. */
const COMMENT_LINE = /^[ \t]*(?:\/\/|\/\*|\*|#)/;

/**
 * T1 — a property whose value is a SCHEMA.
 *
 * Calibrated against the real tree rather than guessed (measured 2026-09-07 over
 * `packages/spec/src/**`): 8,102 property lines take a `z.` value, and the
 * whole non-`z.` schema vocabulary beneath them is `retiredKey(` (235),
 * `I18nLabelSchema` and its `*Schema` siblings (≈300), `strictObject(` (46) and
 * `lazySchema(`. Requiring a schema-shaped VALUE is what keeps the tell off the
 * 1,655 `x: true` / 1,170 `x: string` lines that are object literals and type
 * annotations, not accept-set members.
 *
 * ⛔ It does NOT verify the property sits inside a `z.object({` block. A hunk
 * is a fragment — block state cannot be recovered from one honestly — and a
 * reader that guessed would fail SILENTLY in the direction that matters. The
 * card's own boundary applies: a tell, not a proof.
 */
const SCHEMA_PROPERTY = /^[ \t]*(?:'[^']+'|"[^"]+"|\[[^\]]+\]|[A-Za-z_$][\w$]*)[ \t]*\??[ \t]*:[ \t]*(?:z\.|lazySchema\(|strictObject\(|retiredKey\(|[A-Za-z_$][\w$]*Schema\b)/;

/** T2 — a closed set DECLARED or re-written on one line. */
const CLOSED_SET_OPENER = /z\.(?:enum|union|discriminatedUnion|literal)\(/;

/** T2 — a bare string element of a multi-line `z.enum([…])` or `as const` array. */
const BARE_STRING_ELEMENT = /^[ \t]*(?:'[^']*'|"[^"]*")[ \t]*,?[ \t]*(?:\/\/.*)?$/;

/** T2 — a bare schema arm of a multi-line `z.union([…])`. */
const BARE_SCHEMA_ARM = /^[ \t]*[A-Za-z_$][\w$]*Schema[ \t]*,[ \t]*(?:\/\/.*)?$/;

/**
 * The two spellings of a string CONCATENATION continuing across lines (#16822).
 *
 * `CONTINUATION_HEAD` is the operator opening the NEXT line (`+ 'more prose'`),
 * `CONTINUATION_TAIL` the one left at the END of the previous line (`'prose ' +`).
 * Both are in the tree, so both are read; a bare-string line with either
 * neighbour is a FRAGMENT of one expression, never an element of a list.
 *
 * ⛔ `++` is excluded in both directions — an increment is not a concatenation,
 * and reading one as the other would decline a real member for no reason.
 */
const CONTINUATION_HEAD = /^[ \t]*\+(?!\+)[ \t]*(?:['"`]|[A-Za-z_$(])/;
const CONTINUATION_TAIL = /(?<!\+)\+[ \t]*$/;

/**
 * An opener whose list opens on a LATER line, with its BINDING PREFIX captured.
 *
 * `[^[\]]*` between the constructor and the bracket admits a discriminator
 * argument (`z.discriminatedUnion('type', [`) while refusing any line that
 * already carries members, and the anchored end refuses one that closes on the
 * same line (`z.enum(['a', 'b'])`). Group 1 is everything left of the
 * constructor — `export const AnyComponentSchema = ` — which is what makes two
 * openers the same DECLARATION rather than merely the same shape.
 */
const CLOSED_SET_OPENER_HEAD = /^(.*?)z\.(?:enum|union|discriminatedUnion|literal)\([^[\]]*\[[ \t]*(?:\/\/.*)?$/;

/** The binding an opener-only line declares, or `null` if it is not one. */
export function closedSetOpenerBinding(text) {
  const m = CLOSED_SET_OPENER_HEAD.exec(String(text ?? ''));
  return m ? m[1].trim() : null;
}

/**
 * Is this added line a FRAGMENT of a multi-line string concatenation?
 *
 * ⭐ Positive evidence only: a neighbour this hunk actually shows. `null` for a
 * neighbour means the hunk does not reach that line — a different hunk, or the
 * edge of this one — and an unseen neighbour is never read as evidence. The
 * tell keeps firing, which is the loud direction.
 */
export function isConcatenationFragment(prev, next) {
  if (typeof next === 'string' && CONTINUATION_HEAD.test(next)) return true;
  return typeof prev === 'string' && CONTINUATION_TAIL.test(prev);
}

/**
 * Does this added opener merely RE-DECLARE a closed set the same hunk removed?
 *
 * ⛔ Not a direction claim — see the header. An opener-only line declares no
 * member, so when the same hunk removes an opener binding the same name, the
 * set already existed and this line adds no value to it. The members decide,
 * and they are read separately, one line each.
 */
export function rewritesExistingOpener(text, removedTexts) {
  const binding = closedSetOpenerBinding(text);
  if (binding === null || !Array.isArray(removedTexts)) return false;
  return removedTexts.some((r) => closedSetOpenerBinding(r) === binding);
}

/** T3 — a row of a published export listing: every entry is a JSON string. */
const JSON_STRING_ROW = /^[ \t]*"/;

/**
 * T4 — a registration.
 *
 * Two shapes, because the three declared registries write entries two ways
 * (measured 2026-09-07): a BARE element of a list — `'WORKFLOW_STEP_FAILED',`
 * in `ERROR_CODE_LEDGER` — and a keyed member — `'@objectstack/rest': [`
 * opening an owner's list, `code: 'X',` inside a dispatcher-vocabulary row,
 * `workflow: workflowForm,` in the form registry. A structural line (`]`,
 * `},`, `});`) matches neither, and comments are already excluded upstream.
 */
const REGISTRATION_ROW =
  /^[ \t]*(?:'[^']*'|"[^"]*")[ \t]*,[ \t]*(?:\/\/.*)?$|^[ \t]*(?:'[^']+'|"[^"]+"|[A-Za-z_$][\w$]*)[ \t]*:[ \t]*\S/;

/**
 * Every tell one file's added lines carry.
 *
 * @param {{ filename?: string, status?: string, patch?: string|null }} file
 * @param {{ repo?: string }} [opts]
 * @returns {{ tell: string, file: string, line: number, text: string, why: string }[]}
 */
export function tellsInFile(file, { repo = THIS_REPO } = {}) {
  const filename = String(file?.filename ?? '');
  if (filename === '') return [];
  if (file?.status === 'removed') return []; // a deleted file adds nothing.
  const rows = [];
  const lines = patchLines(file?.patch);
  // The NEW file's lines, in order — added and context, which is what
  // "the line before / after this one" means to the author who opens the file.
  const newFile = lines.filter((r) => r.kind !== 'removed');
  // What each hunk REPLACED, keyed by hunk so no reading crosses a boundary.
  const removedByHunk = new Map();
  for (const r of lines) {
    if (r.kind !== 'removed') continue;
    if (!removedByHunk.has(r.hunk)) removedByHunk.set(r.hunk, []);
    removedByHunk.get(r.hunk).push(r.text);
  }
  const neighbour = (i, step) => {
    const n = newFile[i + step];
    return n && n.hunk === newFile[i].hunk ? n.text : null;
  };
  const onContractSource = surfaceCovers(CONTRACT_SOURCE_SURFACES, filename, repo) && isContractSourceFile(filename);
  const onPublished = surfaceCovers(PUBLISHED_SURFACES, filename, repo);
  const onRegistry = surfaceCovers(REGISTRATION_SURFACES, filename, repo);
  for (let i = 0; i < newFile.length; i += 1) {
    if (newFile[i].kind !== 'added') continue;
    const { line, text } = newFile[i];
    if (COMMENT_LINE.test(text)) continue;
    // #16822 — a line that is one FRAGMENT of a multi-line string
    // concatenation is not a bare element of anything: not a member of a
    // closed set (T2) and not a registration (T4). The 8-fragment instrument
    // on the card is the proof that the tell keyed on the accidental absence
    // of a continuation operator; the header states the one quiet direction
    // this buys. ⛔ Only the bare-STRING shape is declined — a keyed line
    // (`reason: 'prose ' +`) is a different reading and keeps its own tells.
    if (BARE_STRING_ELEMENT.test(text) && isConcatenationFragment(neighbour(i, -1), neighbour(i, 1))) continue;
    const at = { file: filename, line, text: text.trim().slice(0, 160) };
    // A DECLARED registry is read as a registry first. Its files also sit on
    // the contract source surface (two of the three live under
    // `packages/spec/src/**`), and a ledger code read as "a member of a closed
    // set" would be true but less useful than the reading that names the
    // register it was added to. One line is one row, never one per surface.
    if (onRegistry && REGISTRATION_ROW.test(text)) {
      rows.push({ tell: 'T4', ...at, why: 'a new registration in a registry / catalog — what the runtime accepts grows with no schema file moving' });
      continue;
    }
    if (onContractSource && SCHEMA_PROPERTY.test(text)) {
      rows.push({ tell: 'T1', ...at, why: 'a new key on a Zod object schema — the accept set gains a spelling an author may now write' });
      continue;
    }
    // #16822 — an opener that re-declares a set the same hunk removed adds no
    // member; the members are read below, one line each.
    const opener = CLOSED_SET_OPENER.test(text) && !rewritesExistingOpener(text, removedByHunk.get(newFile[i].hunk));
    if (onContractSource && (opener || BARE_STRING_ELEMENT.test(text) || BARE_SCHEMA_ARM.test(text))) {
      rows.push({ tell: 'T2', ...at, why: 'a new member of a closed set (z.enum / union / an `as const` array) — the accept set gains a value' });
      continue;
    }
    if (onPublished && JSON_STRING_ROW.test(text)) {
      rows.push({ tell: 'T3', ...at, why: 'a new row in a published entry point\'s export listing — the public surface grows (ADR-0059)' });
      continue;
    }
  }
  return rows;
}

/**
 * Did this row add NOTHING — as a fact this reader can point at?
 *
 * ⭐ The asymmetry is the safety property, and it is the same one the sibling's
 * `--pair-json` reader has: a MISSING count is not a zero. `additions: 0` is a
 * reading somebody took — GitHub's own on the API path, this file's hunk count
 * on the local one — and a row that added nothing owes no patch, so skipping it
 * keeps every rename and mode-only change out of the gap list. `null` or an
 * absent field is the ABSENCE of that reading, and an absent reading can never
 * be turned into "nothing was added" here.
 *
 * The one inference this function does make is narrow and named: a row whose
 * status is `renamed`, which carries NO count at all and NO patch, is a pure
 * rename. That shape only reaches this file from a hand-assembled document —
 * both real input paths carry a count — and a pure rename genuinely adds
 * nothing.
 */
export function addedNothing(file) {
  if (typeof file?.additions === 'number') return file.additions === 0;
  if (file?.additions != null) return false; // a non-number count is no count.
  return file?.status === 'renamed' && (file?.patch == null || file.patch === '');
}

/**
 * A file this gate had to read and could not.
 *
 * Only a file ON a tell surface owes a patch: an unread `README.md` decides
 * nothing here, and reporting it would bury the readings that matter. A file
 * that IS on a surface, added something (or might have), and arrived with no
 * patch is a gap — because "no added line matched" and "no line was read" are
 * the two states this whole family keeps apart.
 */
export function unreadFiles(files, { repo = THIS_REPO } = {}) {
  const gaps = [];
  for (const file of files ?? []) {
    const filename = String(file?.filename ?? '');
    if (filename === '' || file?.status === 'removed') continue;
    if (addedNothing(file)) continue;
    if (typeof file?.patch === 'string' && file.patch !== '') continue;
    const onSurface =
      (surfaceCovers(CONTRACT_SOURCE_SURFACES, filename, repo) && isContractSourceFile(filename)) ||
      surfaceCovers(PUBLISHED_SURFACES, filename, repo) ||
      surfaceCovers(REGISTRATION_SURFACES, filename, repo);
    if (!onSurface) continue;
    gaps.push(filename);
  }
  return gaps;
}

/** Every tell in a whole changed-file listing, in file order. */
export function wideningTells(files, { repo = THIS_REPO } = {}) {
  const rows = [];
  for (const file of files ?? []) rows.push(...tellsInFile(file, { repo }));
  return rows;
}

/**
 * The verdict: a declaration plus a diff.
 *
 * @param {{ declaration: 'yes'|'no'|null|undefined,
 *           files: object[]|null, repo?: string }} input
 * @returns {{ state: 'not-applicable'|'unreadable'|'incomplete'|'refused'|'clean',
 *   rows: object[], gaps: string[], text: string|null }}
 */
export function wideningRefusal({ declaration, files, repo = THIS_REPO } = {}) {
  // A `yes` is never blocked here, and an unreadable declaration is the
  // sibling's C2 row — issuing a verdict on it from this file would be a second
  // reader of the same limb, which is the drift this family punishes.
  if (declaration !== 'no') {
    return { state: 'not-applicable', rows: [], gaps: [], text: null };
  }
  if (!Array.isArray(files)) {
    return {
      state: 'unreadable',
      rows: [],
      gaps: [],
      text:
        'the changed-file listing could not be read, so this diff is UNJUDGED for widening tells. ' +
        '⛔ An unread diff is not a narrow diff.',
    };
  }
  const gaps = unreadFiles(files, { repo });
  const rows = wideningTells(files, { repo });
  if (rows.length > 0) {
    const where = rows.map((r) => `${r.file}:${r.line}`).join(', ');
    return {
      state: 'refused',
      rows,
      gaps,
      text: `${REFUSAL_SENTENCE} — ${rows.length} tell(s): ${where}`,
    };
  }
  if (gaps.length > 0) {
    return {
      state: 'incomplete',
      rows,
      gaps,
      text:
        `${gaps.length} file(s) on a tell surface arrived with no patch to read (${gaps.join(', ')}), ` +
        'so this diff is UNJUDGED for widening tells rather than clear of them.',
    };
  }
  return { state: 'clean', rows: [], gaps: [], text: null };
}

/** The exit code one verdict maps to — one place, so no caller re-derives it. */
export function exitForRefusal(verdict) {
  if (verdict?.state === 'refused') return EXIT_REFUSED;
  if (verdict?.state === 'incomplete' || verdict?.state === 'unreadable') return EXIT_INCOMPLETE;
  return EXIT_OK;
}

/** The rows a caller prints, one line each, file:line first. */
export function refusalLines(verdict) {
  return (verdict?.rows ?? []).map((r) => `${r.tell} ${r.file}:${r.line} — ${r.why}\n    + ${r.text}`);
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function readInput(source) {
  if (source === '-') return readFileSync(0, 'utf8');
  return readFileSync(source, 'utf8');
}

function argValue(argv, flag) {
  const i = argv.indexOf(flag);
  if (i === -1) return null;
  const v = argv[i + 1];
  return typeof v === 'string' && !v.startsWith('--') ? v : '';
}

function main(argv) {
  if (argv.includes('--self-test')) {
    const code = selfTest();
    if (!selfTestReachedVerdict) {
      console.error(
        '\n✗ check-widening-tells self-test: selfTest() returned without reaching its verdict,\n' +
          'so no success line was printed. Exiting 0 here would report a self-test\n' +
          'that never finished as a self-test that passed.\n',
      );
      return 1;
    }
    return code;
  }

  const declaration = argValue(argv, '--declaration');
  if (declaration === null || declaration === '') {
    console.error(
      'check-widening-tells: --declaration <yes|no> is required — this gate is a predicate about a ' +
        'DIFF AND a claim, and reading only one of them decides nothing. ⛔ Silence is not a clearance.',
    );
    return EXIT_USAGE;
  }
  if (declaration !== 'yes' && declaration !== 'no') {
    console.error(
      `check-widening-tells: --declaration ${JSON.stringify(declaration)} is neither \`yes\` nor \`no\`. ` +
        'Those two spellings are the whole set the clause-② reader recognises.',
    );
    return EXIT_USAGE;
  }

  const diffArg = argValue(argv, '--diff');
  const filesArg = argValue(argv, '--files');
  if ((diffArg === null) === (filesArg === null)) {
    console.error(
      'check-widening-tells: name exactly one input — `--diff <file|->` (a `git diff` body) or ' +
        '`--files <file|->` (the /pulls/N/files rows). Two inputs would be half one diff and half another.',
    );
    return EXIT_USAGE;
  }

  let files;
  try {
    if (diffArg !== null) {
      if (diffArg === '') throw new Error('--diff needs a file path, or `-` for stdin');
      files = splitUnifiedDiff(readInput(diffArg));
    } else {
      if (filesArg === '') throw new Error('--files needs a file path, or `-` for stdin');
      const doc = JSON.parse(readInput(filesArg));
      files = Array.isArray(doc) ? doc : Array.isArray(doc?.files) ? doc.files : null;
      if (!files) throw new Error('--files needs a JSON array of /pulls/N/files rows, or an object carrying one as `files`');
    }
  } catch (err) {
    console.error(`check-widening-tells: ${err.message}. ⛔ Not a reading of a narrow diff.`);
    return EXIT_USAGE;
  }

  const verdict = wideningRefusal({ declaration, files });
  if (verdict.state === 'not-applicable') {
    console.log(
      `✓ check-widening-tells: the claim declares \`Clause-②: ${declaration}\`, which this gate never ` +
        'blocks — a `yes` already routes to contract review, so a tell on top of it decides nothing.',
    );
    return EXIT_OK;
  }
  if (verdict.state === 'clean') {
    console.log(
      `✓ check-widening-tells: ${files.length} changed file(s) read, no widening tell on any declared ` +
        'surface. ⚠️ A tell is not a proof and its absence is not one either — false negatives are the ' +
        'cost the #16349 ruling accepted.',
    );
    return EXIT_OK;
  }
  for (const line of refusalLines(verdict)) console.error(`✗ ${line}`);
  console.error(`check-widening-tells: ${verdict.text}`);
  return exitForRefusal(verdict);
}

// ---------------------------------------------------------------------------
// Self-test — offline, and the fixtures are the shapes measured in the tree
// ---------------------------------------------------------------------------

/** A patch body from added lines starting at `start`, the shape the API sends. */
const patchOf = (start, ...lines) => [`@@ -${start},0 +${start},${lines.length} @@`, ...lines].join('\n');

const FILE_SCHEMA_KEY = {
  filename: 'packages/spec/src/kernel/manifest.zod.ts',
  status: 'modified',
  patch: patchOf(44, '+    telemetry: z.array(z.string()).optional()', ' ', '-    stale: z.string(),'),
};
const FILE_ENUM_MEMBER = {
  filename: 'packages/spec/src/kernel/plugin.zod.ts',
  status: 'modified',
  patch: patchOf(95, "+  'workflow',       // Business: long-running orchestration"),
};
const FILE_API_SURFACE = {
  filename: 'packages/spec/api-surface/kernel.json',
  status: 'modified',
  patch: patchOf(14, '+    "WorkflowPluginSchema (const)",'),
};
const FILE_REGISTRY = {
  filename: 'packages/spec/src/api/error-code-ledger.zod.ts',
  status: 'modified',
  patch: patchOf(140, "+    'WORKFLOW_STEP_FAILED',"),
};

let selfTestReachedVerdict = false;

export function selfTest() {
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
  const tells = (file) => tellsInFile(file);
  const at = (file) => tells(file).map((r) => `${r.file}:${r.line}`);

  // -- the patch reader ------------------------------------------------------
  battery('the patch reader: added lines, and the line numbers they carry');
  t('an empty patch reads as no added lines, never as an added line', addedLines('').length === 0 && addedLines(null).length === 0 && addedLines(undefined).length === 0);
  t('one added line carries the hunk header\'s start', addedLines('@@ -1,0 +7,1 @@\n+alpha')[0]?.line === 7);
  t('…and its text, with the `+` stripped', addedLines('@@ -1,0 +7,1 @@\n+alpha')[0]?.text === 'alpha');
  t('a context line advances the number by one', addedLines('@@ -1,2 +7,2 @@\n ctx\n+beta')[0]?.line === 8);
  t('⛔ a REMOVED line advances nothing — the classic off-by-one that points at the wrong line', addedLines('@@ -1,2 +7,1 @@\n-gone\n+beta')[0]?.line === 7);
  t('two additions after a removal keep counting from the same base', JSON.stringify(addedLines('@@ -1,3 +7,2 @@\n-gone\n+b1\n+b2').map((r) => r.line)) === '[7,8]');
  t('a second hunk RESETS to its own header rather than continuing', addedLines('@@ -1,1 +7,1 @@\n+a\n@@ -40,1 +60,1 @@\n+b')[1]?.line === 60);
  t('⛔ the `+++` file header is not an added line', addedLines('--- a/x\n+++ b/x\n@@ -1,0 +3,1 @@\n+real').length === 1);
  t('…and the one line it would have fabricated is the real one, at the right number', addedLines('--- a/x\n+++ b/x\n@@ -1,0 +3,1 @@\n+real')[0]?.line === 3);
  t('"\\ No newline at end of file" is not an added line', addedLines('@@ -1,1 +1,1 @@\n+x\n\\ No newline at end of file').length === 1);
  t('a line before any hunk header is ignored — there is no number to give it', addedLines('+orphan').length === 0);
  t('an added EMPTY line is still an added line', addedLines('@@ -1,0 +5,1 @@\n+')[0]?.text === '');
  t('a hunk header with no comma on the new side still reads', addedLines('@@ -1 +9 @@\n+solo')[0]?.line === 9);
  t('a removal-only patch yields nothing to judge', addedLines('@@ -1,2 +1,0 @@\n-a\n-b').length === 0);
  t('the trailing empty split element does not fabricate a line', addedLines('@@ -1,1 +1,1 @@\n+a\n').length === 1);
  t('a `diff --git` header line inside the body is skipped', addedLines('diff --git a/x b/x\n@@ -1,0 +2,1 @@\n+z').length === 1);
  t('mixed context/add/remove keeps every number right', JSON.stringify(addedLines('@@ -1,4 +10,4 @@\n ctx\n-old\n+new\n ctx2\n+tail').map((r) => r.line)) === '[11,13]');
  t('`patchLines` tags all three sides — the reading `addedLines` is a projection of', JSON.stringify(patchLines('@@ -1,3 +10,2 @@\n ctx\n-old\n+new').map((r) => r.kind)) === '["context","removed","added"]');
  t('⛔ a REMOVED line carries NO new-file number — it has no line the author can open', patchLines('@@ -1,3 +10,2 @@\n ctx\n-old\n+new')[1]?.line === null);
  t('…and every added line agrees with `addedLines`, so the two readers cannot drift', JSON.stringify(patchLines('@@ -1,4 +10,4 @@\n ctx\n-old\n+new\n ctx2\n+tail').filter((r) => r.kind === 'added').map((r) => r.line)) === '[11,13]');
  t('a second hunk gets its own index, so adjacency can never cross a boundary', patchLines('@@ -1,1 +7,1 @@\n+a\n@@ -40,1 +60,1 @@\n+b').map((r) => r.hunk).join(',') === '0,1');

  // -- the unified-diff splitter --------------------------------------------
  battery('the unified-diff splitter, for the local `git diff` path');
  const twoFiles = [
    'diff --git a/packages/spec/src/a.zod.ts b/packages/spec/src/a.zod.ts',
    'index 111..222 100644',
    '--- a/packages/spec/src/a.zod.ts',
    '+++ b/packages/spec/src/a.zod.ts',
    '@@ -1,0 +5,1 @@',
    '+  extra: z.string(),',
    'diff --git a/README.md b/README.md',
    '--- a/README.md',
    '+++ b/README.md',
    '@@ -1,0 +1,1 @@',
    '+prose',
  ].join('\n');
  t('two files split into two rows', splitUnifiedDiff(twoFiles).length === 2);
  t('…named by their b-side path', splitUnifiedDiff(twoFiles)[0]?.filename === 'packages/spec/src/a.zod.ts');
  t('…each carrying its own hunk', addedLines(splitUnifiedDiff(twoFiles)[1]?.patch)[0]?.text === 'prose');
  t('an empty diff is no rows, never one row with nothing in it', splitUnifiedDiff('').length === 0 && splitUnifiedDiff('   ').length === 0);
  t('a new file is marked `added`', splitUnifiedDiff('diff --git a/x b/x\nnew file mode 100644\n@@ -0,0 +1,1 @@\n+a')[0]?.status === 'added');
  t('a deleted file is marked `removed`', splitUnifiedDiff('diff --git a/x b/x\ndeleted file mode 100644\n@@ -1,1 +0,0 @@\n-a')[0]?.status === 'removed');
  t('a rename takes the NEW name, which is the path a tell must be reported at', splitUnifiedDiff('diff --git a/x b/y\nsimilarity index 98%\nrename from x\nrename to y\n')[0]?.filename === 'y');
  t('a binary change yields `patch: null` — UNREAD, not empty', splitUnifiedDiff('diff --git a/i.png b/i.png\nBinary files a/i.png and b/i.png differ')[0]?.patch === null);
  t('…and null is what `unreadFiles` counts as a gap when it is on a surface', unreadFiles([{ filename: 'packages/spec/api-surface/kernel.json', patch: null }]).length === 1);
  t('⛔ a file OFF every surface with no patch is not a gap — it decides nothing here', unreadFiles([{ filename: 'README.md', patch: null }]).length === 0);
  t('the local path and the API path produce the same verdict on the same bytes', JSON.stringify(wideningTells(splitUnifiedDiff(twoFiles)).map((r) => r.tell)) === '["T1"]');
  // `additions` is a COUNT THAT WAS TAKEN. The three states below are told
  // apart by what the diff SAYS, and conflating them is what let a binary
  // change to a tell surface read as clean.
  t('⛔ a binary row carries additions `null` — UNKNOWN, never a fabricated 0', splitUnifiedDiff('diff --git a/i.png b/i.png\nBinary files a/i.png and b/i.png differ')[0]?.additions === null);
  t('…and the `GIT binary patch` spelling reads as UNKNOWN too', splitUnifiedDiff('diff --git a/i.png b/i.png\nGIT binary patch\nliteral 0\nHcmV?d00001')[0]?.additions === null);
  t('a MODE-ONLY change carries a real 0 — no hunk AND no binary marker is git saying nothing was added', splitUnifiedDiff('diff --git a/x b/x\nold mode 100644\nnew mode 100755')[0]?.additions === 0);
  t('a pure rename carries a real 0 for the same reason', splitUnifiedDiff('diff --git a/x b/y\nsimilarity index 100%\nrename from x\nrename to y')[0]?.additions === 0);

  // -- the local path composed, end to end ----------------------------------
  //
  // The two halves below were each pinned separately before, and the defect
  // lived exactly between them: `patch: null` was asserted on one fixture and
  // "null is a gap" on a DIFFERENT, hand-built row that carried no `additions`
  // at all — so nothing drove a real binary row through `unreadFiles`. These
  // cases compose the actual functions, in the order a caller calls them.
  battery('the local path composed: an unread diff is not a narrow diff');
  const composed = (diff) => wideningRefusal({ declaration: 'no', files: splitUnifiedDiff(diff) });
  const BINARY_ON_SURFACE = 'diff --git a/packages/spec/api-surface/kernel.json b/packages/spec/api-surface/kernel.json\nindex 111..222 100644\nBinary files a/packages/spec/api-surface/kernel.json and b/packages/spec/api-surface/kernel.json differ';
  t('⭐ a BINARY change to a tell surface reads INCOMPLETE, never clean', composed(BINARY_ON_SURFACE).state === 'incomplete');
  t('…and maps to exit 2, the one exit that must never be mistaken for 0', exitForRefusal(composed(BINARY_ON_SURFACE)) === EXIT_INCOMPLETE);
  t('…naming the file whose content could not be read', composed(BINARY_ON_SURFACE).gaps[0] === 'packages/spec/api-surface/kernel.json');
  t('⛔ but a binary change OFF every surface is clean — it decides nothing here', composed('diff --git a/docs/logo.png b/docs/logo.png\nBinary files a/docs/logo.png and b/docs/logo.png differ').state === 'clean');
  t('a MODE-ONLY change to a tell surface is clean — it really did add nothing', composed('diff --git a/packages/spec/api-surface/kernel.json b/packages/spec/api-surface/kernel.json\nold mode 100644\nnew mode 100755').state === 'clean');
  t('addedNothing: a MISSING count is never a zero', addedNothing({ filename: 'x', additions: null }) === false && addedNothing({ filename: 'x' }) === false);
  t('…while a count that WAS taken is one', addedNothing({ filename: 'x', additions: 0 }) === true && addedNothing({ filename: 'x', additions: 3 }) === false);

  // -- the surfaces ---------------------------------------------------------
  battery('the surfaces, imported rather than restated');
  t('the contract source surface is IMPORTED from SUSPECT_TIER_GLOBS, not spelled here', CONTRACT_SOURCE_SURFACES.some((s) => s.imported === 'SUSPECT_TIER_GLOBS'));
  t('…and it covers exactly what that table declares', SUSPECT_TIER_GLOBS.every((g) => CONTRACT_SOURCE_SURFACES.some((s) => s.glob === g.glob)));
  t('the published surface is DERIVED from REGEN_ARTIFACTS', PUBLISHED_SURFACES.length > 0 && PUBLISHED_SURFACES.every((s) => s.imported === 'REGEN_ARTIFACTS'));
  t('…so both api-surface artifacts reach it without a literal here', surfaceCovers(PUBLISHED_SURFACES, 'packages/spec/api-surface/kernel.json') && surfaceCovers(PUBLISHED_SURFACES, 'packages/spec/api-surface-signatures.json'));
  t('a spec source file is on the contract surface', surfaceCovers(CONTRACT_SOURCE_SURFACES, 'packages/spec/src/kernel/plugin.zod.ts'));
  t('⛔ a sibling directory that merely shares a prefix is not', !surfaceCovers(CONTRACT_SOURCE_SURFACES, 'packages/spec/src-legacy/plugin.zod.ts'));
  t('an api-surface file is NOT on the contract source surface — the two tells stay apart', !surfaceCovers(CONTRACT_SOURCE_SURFACES, 'packages/spec/api-surface/kernel.json'));
  t("the objectui mirror row is INERT in this repo's run", !surfaceCovers(CONTRACT_SOURCE_SURFACES, 'packages/types/src/zod/app.zod.ts', THIS_REPO));
  t('…and live when the run names objectui', surfaceCovers(CONTRACT_SOURCE_SURFACES, 'packages/types/src/zod/app.zod.ts', 'objectstack-ai/objectui'));
  t('a test file on the contract surface is not a contract source file', !isContractSourceFile('packages/spec/src/kernel/plugin.zod.test.ts') && !isContractSourceFile('packages/spec/src/x.spec.ts'));
  t('…and a plain source file is', isContractSourceFile('packages/spec/src/kernel/plugin.zod.ts'));

  // -- T1 --------------------------------------------------------------------
  battery('T1 — a new key on a Zod object schema');
  t('a new `key: z.…` line is a tell', tells(FILE_SCHEMA_KEY)[0]?.tell === 'T1');
  t('…reported at its file:line', at(FILE_SCHEMA_KEY)[0] === 'packages/spec/src/kernel/manifest.zod.ts:44');
  t('an optional-marked key reads too', tells({ filename: 'packages/spec/src/a.zod.ts', patch: patchOf(3, '+  slug?: z.string(),') }).length === 1);
  t('a quoted key reads too — a dotted hook name is a real spelling in this tree', tells({ filename: 'packages/spec/src/a.zod.ts', patch: patchOf(3, "+  'record.beforeInsert': z.array(z.string()),") }).length === 1);
  t('a `*Schema` value reads — the measured non-`z.` vocabulary', tells({ filename: 'packages/spec/src/a.zod.ts', patch: patchOf(3, '+  label: I18nLabelSchema.optional(),') })[0]?.tell === 'T1');
  t('`retiredKey(` reads — 235 lines in the tree take it', tells({ filename: 'packages/spec/src/a.zod.ts', patch: patchOf(3, "+  legacy: retiredKey('legacy'),") })[0]?.tell === 'T1');
  t('`strictObject(` reads', tells({ filename: 'packages/spec/src/a.zod.ts', patch: patchOf(3, '+  nested: strictObject({ a: z.string() }),') })[0]?.tell === 'T1');
  t('`lazySchema(` reads', tells({ filename: 'packages/spec/src/a.zod.ts', patch: patchOf(3, '+  deep: lazySchema(() => z.string()),') })[0]?.tell === 'T1');
  t('⛔ an object-literal boolean is NOT a schema key — 1,655 such lines exist and none is an accept-set member', tells({ filename: 'packages/spec/src/a.zod.ts', patch: patchOf(3, '+  enabled: true,') }).length === 0);
  t('⛔ nor a TypeScript type annotation', tells({ filename: 'packages/spec/src/a.ts', patch: patchOf(3, '+  name: string;') }).length === 0);
  t('⛔ nor a key added in a COMMENT', tells({ filename: 'packages/spec/src/a.zod.ts', patch: patchOf(3, '+  // future: z.string() — not yet') }).length === 0);
  t('⛔ nor the same line in a TEST file', tells({ filename: 'packages/spec/src/a.zod.test.ts', patch: patchOf(3, '+  extra: z.string(),') }).length === 0);
  t('⛔ nor the same line OUTSIDE the contract surface', tells({ filename: 'packages/runtime/src/a.ts', patch: patchOf(3, '+  extra: z.string(),') }).length === 0);
  t('a file whose only change is a REMOVED key yields no tell', tells({ filename: 'packages/spec/src/a.zod.ts', patch: '@@ -3,1 +3,0 @@\n-  gone: z.string(),' }).length === 0);

  // -- T2 --------------------------------------------------------------------
  battery('T2 — a new member of a closed set');
  t('a bare string element is a tell', tells(FILE_ENUM_MEMBER)[0]?.tell === 'T2');
  t('…reported at its file:line', at(FILE_ENUM_MEMBER)[0] === 'packages/spec/src/kernel/plugin.zod.ts:95');
  t('…with the trailing comment stripped off the quoted text', says(tells(FILE_ENUM_MEMBER)[0]?.text, "'workflow'"));
  t('a double-quoted element reads too', tells({ filename: 'packages/spec/src/a.zod.ts', patch: patchOf(3, '+  "workflow",') })[0]?.tell === 'T2');
  t('a re-written one-line `z.enum([…])` reads', tells({ filename: 'packages/spec/src/a.zod.ts', patch: patchOf(3, "+export const K = z.enum(['a', 'b', 'c']);") })[0]?.tell === 'T2');
  t('a `z.union([` opener reads', tells({ filename: 'packages/spec/src/a.zod.ts', patch: patchOf(3, '+const U = z.union([') })[0]?.tell === 'T2');
  t('a `z.discriminatedUnion(` opener reads', tells({ filename: 'packages/spec/src/a.zod.ts', patch: patchOf(3, "+const D = z.discriminatedUnion('kind', [") })[0]?.tell === 'T2');
  t('a bare union ARM reads', tells({ filename: 'packages/spec/src/a.zod.ts', patch: patchOf(3, '+  WorkflowSchema,') })[0]?.tell === 'T2');
  t('⛔ a bare string in a COMMENT does not', tells({ filename: 'packages/spec/src/a.zod.ts', patch: patchOf(3, "+  // 'workflow',") }).length === 0);
  t('⛔ nor a bare string outside the contract surface', tells({ filename: 'apps/docs/x.ts', patch: patchOf(3, "+  'workflow',") }).length === 0);
  t('⛔ a REMOVED member is not a tell — the ruling is directional', tells({ filename: 'packages/spec/src/a.zod.ts', patch: "@@ -3,1 +3,0 @@\n-  'legacy'," }).length === 0);
  t('T1 wins over T2 on a line that could read as both, so one line is never two rows', tells({ filename: 'packages/spec/src/a.zod.ts', patch: patchOf(3, "+  kind: z.enum(['a']),") }).length === 1);
  t('…and the row it produces is the key reading', tells({ filename: 'packages/spec/src/a.zod.ts', patch: patchOf(3, "+  kind: z.enum(['a']),") })[0]?.tell === 'T1');

  // -- #16822: the accidental variables ------------------------------------
  //
  // Both halves of the card, each with the evidence it declines on and the
  // evidence it refuses to invent. ⭐ The instrument first: the SAME string,
  // spelled two ways, used to read differently.
  battery('#16822 — the two accidental variables, and the evidence each one needs');
  const FRAGMENTS = [
    "'RETIRED (ADR-0049 enforce-or-remove) — `action` had two published faces whose '",
    "+ 'accept sets were DISJOINT and one of them EMPTY: this mirror admitted a node '",
    "+ 'or a list of nodes, while the twin declared an object with both members '",
    "+ 'required, which no JSON document can satisfy. The renderer read neither '",
    "+ 'face. There is NO replacement spelling and the capability was never '",
    "+ 'fulfilled. Raise the toast from the node itself and label its trigger '",
    "+ 'with `buttonLabel` / `buttonVariant`. See ADR-0049 and the retirement '",
    "+ 'playbook for the conversion.',",
  ];
  const proseArgument = (fragments) => ({
    filename: 'packages/spec/src/kernel/manifest.zod.ts',
    status: 'modified',
    patch: patchOf(83, '+  action: retirementTombstone(', ...fragments.map((f) => `+    ${f}`), '+  ),'),
  });
  const asWritten = proseArgument(FRAGMENTS);
  const respelled = {
    filename: 'packages/spec/src/kernel/manifest.zod.ts',
    status: 'modified',
    patch: patchOf(83, `+  action: retirementTombstone(${FRAGMENTS[0]}`, ...FRAGMENTS.slice(1).map((f) => `+    ${f}`), '+  ),'),
  };
  t('⭐ an 8-fragment prose ARGUMENT is not a closed-set member — its first fragment used to be the only tell', FRAGMENTS.length === 8 && tells(asWritten).length === 0);
  t('⭐ …and the IDENTICAL string with that fragment moved up onto the calling line reads the same — the accidental variable is gone', tells(respelled).length === tells(asWritten).length);
  t('a bare string whose NEXT line opens with `+ \'…\'` is a fragment, not an element', tells({ filename: 'packages/spec/src/a.zod.ts', patch: patchOf(3, "+  'half a sentence '", "+  + 'and the rest',") }).length === 0);
  t('…and the other spelling, the operator left at the END of the line before', tells({ filename: 'packages/spec/src/a.zod.ts', patch: patchOf(3, "+  'half a sentence ' +", "+  'and the rest',") }).length === 0);
  t('⛔ a bare string with NO continuation neighbour is STILL a tell — absence of evidence is not evidence', tells({ filename: 'packages/spec/src/a.zod.ts', patch: patchOf(3, "+  'workflow',") })[0]?.tell === 'T2');
  t('⛔ a neighbour in a DIFFERENT hunk is not a neighbour — the hunk does not show the lines between', tells({ filename: 'packages/spec/src/a.zod.ts', patch: "@@ -3,0 +3,1 @@\n+  'workflow'\n@@ -90,0 +90,1 @@\n+  + 'more prose'," })[0]?.line === 3);
  t('⛔ `++` is an increment, never a concatenation — it must not decline a real member', tells({ filename: 'packages/spec/src/a.zod.ts', patch: patchOf(3, "+  'workflow',", '+  ++seen;') })[0]?.tell === 'T2');
  t('⛔ only the BARE-string shape is declined: a keyed prose head keeps its own reading', tells({ filename: 'packages/spec/src/api/error-code-ledger.zod.ts', patch: patchOf(140, "+    reason: 'Pre-gate synonym on the wire ' +", "+      'kept per #8211.',") })[0]?.tell === 'T4');
  const rewrite = (removed, added) => splitUnifiedDiff(['diff --git a/packages/spec/src/a.zod.ts b/packages/spec/src/a.zod.ts', '@@ -207,4 +207,4 @@', ` ${'/** doc */'}`, `-${removed}`, `+${added}`, '   ArmSchema,', ' ]);'].join('\n'))[0];
  t('⭐ an opener that RE-DECLARES the set the same hunk removed is not a tell — the constructor changed, no member did', tells(rewrite('export const X = z.union([', "export const X = z.discriminatedUnion('type', [")).length === 0);
  t('…and that is the card\'s own second instance, arm for arm', tells(rewrite('export const CRUDComponentSchema = z.union([', "export const CRUDComponentSchema = z.discriminatedUnion('type', [")).length === 0);
  t('⛔ but an ARM the rewrite ADDS still fires — the members were never the suppressed part', tells({ filename: 'packages/spec/src/a.zod.ts', patch: "@@ -207,3 +207,4 @@\n-export const X = z.union([\n+export const X = z.discriminatedUnion('type', [\n+  NewlyAdmittedSchema,\n   ArmSchema," })[0]?.tell === 'T2');
  t('⛔ an opener with NO paired removal still fires — a brand-new closed set is exactly what T2 is for', tells({ filename: 'packages/spec/src/a.zod.ts', patch: patchOf(3, "+export const X = z.discriminatedUnion('type', [") })[0]?.tell === 'T2');
  t('⛔ a DIFFERENT binding prefix is not the same declaration — and `export` added is itself a widening', tells(rewrite('const X = z.union([', 'export const X = z.union([')).length === 1);
  t('⛔ an opener carrying its members INLINE is not an opener-only line, so it is never suppressed', tells(rewrite('export const X = z.enum([', "export const X = z.enum(['a', 'b']);"))[0]?.tell === 'T2');
  t('⛔ a removed opener in ANOTHER hunk does not pair — the evidence must be where the reader can see it', tells({ filename: 'packages/spec/src/a.zod.ts', patch: "@@ -3,1 +3,0 @@\n-export const X = z.union([\n@@ -90,0 +90,1 @@\n+export const X = z.discriminatedUnion('type', [" })[0]?.tell === 'T2');

  // -- T3 --------------------------------------------------------------------
  battery('T3 — a new row in a published entry point');
  t('a new export row is a tell', tells(FILE_API_SURFACE)[0]?.tell === 'T3');
  t('…reported at its file:line', at(FILE_API_SURFACE)[0] === 'packages/spec/api-surface/kernel.json:14');
  t('the signatures sibling is on the surface too', tells({ filename: 'packages/spec/api-surface-signatures.json', patch: patchOf(4, '+  "defineWorkflow": "sha256:0000000000000000",') })[0]?.tell === 'T3');
  t('⛔ a removed row is not a tell', tells({ filename: 'packages/spec/api-surface/kernel.json', patch: '@@ -14,1 +14,0 @@\n-    "Gone (const)",' }).length === 0);
  t('⛔ a JSON file elsewhere is not on this surface', tells({ filename: 'packages/spec/package.json', patch: patchOf(4, '+    "./workflow": "./dist/workflow.js",') }).length === 0);
  t('⛔ nor a non-string structural line inside the listing', tells({ filename: 'packages/spec/api-surface/kernel.json', patch: patchOf(4, '+  ]') }).length === 0);
  t('an unread api-surface file is a GAP, not a clean reading', unreadFiles([{ filename: 'packages/spec/api-surface/kernel.json', patch: undefined }])[0] === 'packages/spec/api-surface/kernel.json');
  t('a DELETED api-surface file adds nothing and owes no patch', unreadFiles([{ filename: 'packages/spec/api-surface/kernel.json', status: 'removed', patch: null }]).length === 0);

  // -- T4 --------------------------------------------------------------------
  battery('T4 — a new registration in a registry');
  t('a new ledger code is a tell', tells(FILE_REGISTRY)[0]?.tell === 'T4');
  t('…reported at its file:line', at(FILE_REGISTRY)[0] === 'packages/spec/src/api/error-code-ledger.zod.ts:140');
  t('a new OWNER key opening a list is a tell', tells({ filename: 'packages/spec/src/api/error-code-ledger.zod.ts', patch: patchOf(140, "+  '@objectstack/workflow': [") })[0]?.tell === 'T4');
  t('the dispatcher vocabulary is on the registry surface, outside packages/spec', tells({ filename: 'packages/runtime/src/dispatcher-error-vocabulary.ts', patch: patchOf(300, "+        code: 'WORKFLOW_STEP_FAILED',") })[0]?.tell === 'T4');
  t('the metadata form registry is on it too', tells({ filename: 'packages/spec/src/system/metadata-form-registry.ts', patch: patchOf(70, '+  workflow: workflowForm,') }).length === 1);
  t('⛔ a comment in a registry is not a registration', tells({ filename: 'packages/runtime/src/dispatcher-error-vocabulary.ts', patch: patchOf(300, "+    // 'WORKFLOW_STEP_FAILED' is pending") }).length === 0);
  t('⛔ a removed registration is not a tell', tells({ filename: 'packages/spec/src/api/error-code-ledger.zod.ts', patch: "@@ -140,1 +140,0 @@\n-    'GONE'," }).length === 0);
  t('⛔ a runtime file that is NOT a declared registry is off the surface', tells({ filename: 'packages/runtime/src/other.ts', patch: patchOf(300, "+        code: 'WORKFLOW_STEP_FAILED',") }).length === 0);
  t('a registry file inside packages/spec reports ONE row, not one per overlapping surface', tells(FILE_REGISTRY).length === 1);
  t('…because the ledger line is read by the registry tell, which the contract-source tells do not claim', tells(FILE_REGISTRY)[0]?.tell === 'T4');

  // -- acceptance: the positive controls ------------------------------------
  battery('#16448 acceptance: the four positive controls, each with its file:line');
  const positives = [FILE_SCHEMA_KEY, FILE_ENUM_MEMBER, FILE_API_SURFACE, FILE_REGISTRY];
  const refusedAll = wideningRefusal({ declaration: 'no', files: positives });
  t('all four tells fire on one diff', refusedAll.rows.length === 4);
  t('…one of each kind, none collapsed into another', JSON.stringify(refusedAll.rows.map((r) => r.tell).sort()) === '["T1","T2","T3","T4"]');
  t('the verdict is REFUSED', refusedAll.state === 'refused');
  t('…which maps to the adverse exit', exitForRefusal(refusedAll) === EXIT_REFUSED);
  t('the refusal carries the card\'s sentence verbatim', says(refusedAll.text, REFUSAL_SENTENCE));
  t('…and every tell\'s file:line', ['packages/spec/src/kernel/manifest.zod.ts:44', 'packages/spec/src/kernel/plugin.zod.ts:95', 'packages/spec/api-surface/kernel.json:14', 'packages/spec/src/api/error-code-ledger.zod.ts:140'].every((p) => says(refusedAll.text, p)));
  t('each printed row leads with its file:line', refusalLines(refusedAll).every((l) => /^T[1-4] [^ ]+:\d+ — /.test(l)));
  t('…and quotes the added line so the reader need not open the file', refusalLines(refusedAll).every((l) => l.includes('\n    + ')));

  // -- acceptance: the negative controls ------------------------------------
  battery('#16448 acceptance: the negative controls a widening gate must let through');
  const yesVerdict = wideningRefusal({ declaration: 'yes', files: positives });
  t('the SAME four diffs with `yes` are not blocked', yesVerdict.state === 'not-applicable');
  t('…and exit 0', exitForRefusal(yesVerdict) === EXIT_OK);
  t('…with no rows computed at all — a `yes` is never even judged here', yesVerdict.rows.length === 0);
  const removalOnly = [
    { filename: 'packages/spec/src/kernel/plugin.zod.ts', status: 'modified', patch: "@@ -95,2 +95,0 @@\n-  'legacy',\n-  'deprecated'," },
    { filename: 'packages/spec/api-surface/kernel.json', status: 'modified', patch: '@@ -14,1 +14,0 @@\n-    "LegacySchema (const)",' },
    { filename: 'packages/spec/src/api/error-code-ledger.zod.ts', status: 'modified', patch: "@@ -140,1 +140,0 @@\n-    'GONE'," },
  ];
  const removalVerdict = wideningRefusal({ declaration: 'no', files: removalOnly });
  t('a removal-only diff with `no` PASSES — the ruling is directional', removalVerdict.state === 'clean');
  t('…and exits 0', exitForRefusal(removalVerdict) === EXIT_OK);
  t('a tightened refine with `no` passes', wideningRefusal({ declaration: 'no', files: [{ filename: 'packages/spec/src/a.zod.ts', patch: patchOf(9, '+  .refine((v) => v.length < 10, { message: "too long" })') }] }).state === 'clean');
  t('a pure rename with `no` passes', wideningRefusal({ declaration: 'no', files: splitUnifiedDiff('diff --git a/packages/spec/src/a.zod.ts b/packages/spec/src/b.zod.ts\nrename from packages/spec/src/a.zod.ts\nrename to packages/spec/src/b.zod.ts\n') }).state === 'clean');
  t('a docs-only diff with `no` passes', wideningRefusal({ declaration: 'no', files: [{ filename: 'content/docs/x.mdx', patch: patchOf(1, '+  newKey: z.string(),') }] }).state === 'clean');
  t('an absent declaration is NOT this gate\'s verdict to issue — that is the sibling\'s C2 row', wideningRefusal({ declaration: null, files: positives }).state === 'not-applicable');
  t('…and neither is a malformed one', wideningRefusal({ declaration: 'YES', files: positives }).state === 'not-applicable');

  // -- the sentence and the prohibitions ------------------------------------
  battery('the refusal sentence, and the two prohibitions it must keep');
  t('the sentence names both ways out', says(REFUSAL_SENTENCE, 're-declare `yes`') && says(REFUSAL_SENTENCE, 'explain in the claim'));
  t('…and quotes the declaration in the spelling the reader uses', says(REFUSAL_SENTENCE, '`Clause-②: no`'));
  t('⛔ no label name appears anywhere in this file\'s outputs — a checker that hung one would be issuing the verdict', !says(REFUSAL_SENTENCE, 'needs:') && refusalLines(refusedAll).every((l) => !l.includes('needs:')));
  t('⛔ no new claim-line syntax is invented: the two values are the sibling\'s two', wideningRefusal({ declaration: 'maybe', files: positives }).state === 'not-applicable');
  t('a tell is reported as a tell — its `why` says what it is evidence OF', refusedAll.rows.every((r) => typeof r.why === 'string' && r.why.length > 20));
  t('the quoted line is CAPPED, so one row cannot swamp the report', tells({ filename: 'packages/spec/src/a.zod.ts', patch: patchOf(3, `+  k: z.string() // ${'x'.repeat(400)}`) })[0]?.text.length <= 160);
  t('a clean verdict carries no text to mistake for a finding', removalVerdict.text === null);
  t('a not-applicable verdict likewise', yesVerdict.text === null);

  // -- the exit register ----------------------------------------------------
  battery('the exit register is distinct in every direction it must be');
  t('the four codes are four distinct values', new Set([EXIT_OK, EXIT_USAGE, EXIT_INCOMPLETE, EXIT_REFUSED]).size === 4);
  t('REFUSED is never 0 — silence is what this file exists against', EXIT_REFUSED !== EXIT_OK);
  t('INCOMPLETE is never REFUSED — an unread diff is not a widening one', EXIT_INCOMPLETE !== EXIT_REFUSED);
  const unread = wideningRefusal({ declaration: 'no', files: null });
  t('an unreadable listing is INCOMPLETE, never clean', unread.state === 'unreadable' && exitForRefusal(unread) === EXIT_INCOMPLETE);
  const gapped = wideningRefusal({ declaration: 'no', files: [{ filename: 'packages/spec/api-surface/kernel.json', patch: null }] });
  t('a surface file with no patch is INCOMPLETE, never clean', gapped.state === 'incomplete' && exitForRefusal(gapped) === EXIT_INCOMPLETE);
  t('⛔ but a REFUSAL outranks a gap — a tell that was read is a fact, whatever else was not', wideningRefusal({ declaration: 'no', files: [...positives, { filename: 'packages/spec/api-surface/ui.json', patch: null }] }).state === 'refused');

  // -- the declared rows still exist ----------------------------------------
  battery('the declared registry rows still exist in this tree');
  const localRows = REGISTRATION_SURFACES.filter((s) => s.repo === THIS_REPO);
  t('every declared registry row names a path in THIS tree — a renamed registry must red here, not go quiet', localRows.every((s) => existsSync(new URL(s.glob, `file://${ROOT}`))), localRows.filter((s) => !existsSync(new URL(s.glob, `file://${ROOT}`))).map((s) => s.glob).join(', '));
  t('the table is not empty — an empty register guards nothing while reading as protection', localRows.length >= 3);
  t('every surface row carries a `why`, so a reader can tell what it is protecting', ALL_SURFACES.every((s) => typeof s.why === 'string' && s.why.length > 10));
  t('every surface row names the repo it applies to', ALL_SURFACES.every((s) => typeof s.repo === 'string' && s.repo.includes('/')));

  // -- the floor -------------------------------------------------------------
  const floorFailures = [];
  const floorFailure = (text) => {
    floorFailures.push(text);
    console.error(`  ✗ ${text}`);
  };
  const declared = new Set(Object.keys(SELF_TEST_BATTERIES));
  const opened = new Set(batterySeen.keys());
  if (declared.size < SELF_TEST_BATTERY_FLOOR) {
    floorFailure(
      `the battery roster declares ${declared.size} batteries, below its pinned floor of ` +
        `${SELF_TEST_BATTERY_FLOOR} — deleting an entry silences its floor exactly as effectively as zeroing it.`,
    );
  }
  for (const name of opened) {
    if (!declared.has(name)) floorFailure(`self-test battery "${name}" ran but is NOT declared in the roster.`);
  }
  for (const name of declared) {
    const count = batterySeen.get(name) ?? 0;
    if (count >= SELF_TEST_BATTERIES[name]) continue;
    floorFailure(
      count === 0
        ? `self-test battery "${name}" DID NOT RUN — 0 cases registered, ${SELF_TEST_BATTERIES[name]} pinned. ` +
            'The verdict below would have claimed those cases hold.'
        : `self-test battery "${name}" registered ${count} case(s), below its pinned floor of ` +
            `${SELF_TEST_BATTERIES[name]} — cases that used to run no longer do.`,
    );
  }
  if (floorFailures.length > 0) {
    console.error(
      '✗ check-widening-tells self-test: the battery floor is breached — cases STOPPED RUNNING. ' +
        'Find what stopped registering (an early return, a deleted block, a guard that now skips).',
    );
    return 1;
  }

  const failed = cases.filter((c) => !c.ok);
  for (const c of failed) console.error(`  ✗ ${c.name}${c.detail ? ` — ${c.detail}` : ''}`);
  if (failed.length) {
    console.error(`✗ check-widening-tells self-test: ${failed.length} of ${cases.length} case(s) failed.`);
    return 1;
  }
  console.log(
    `✓ check-widening-tells self-test: ${cases.length} cases pass (the patch reader with its ` +
      'line-number directions, the unified-diff splitter, the three imported/declared surfaces, the ' +
      'four tells, the two accidental variables #16822 removed and the evidence each declines on, ' +
      "#16448's four positive controls each with its file:line, its negative controls — " +
      'the same diffs with `yes`, and a removal-only diff with `no` — the local path composed end ' +
      'to end so a binary change to a tell surface cannot read as clean — and the exit register).',
  );

  selfTestReachedVerdict = true;
  return 0;
}

if (isEntrypoint(import.meta.url)) {
  process.exit(main(process.argv.slice(2)));
}
