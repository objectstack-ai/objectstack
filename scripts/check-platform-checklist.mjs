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
//   - every `traps` entry is a trap RUNNER.md's `### Trap vocabulary` table
//     actually defines, and every documented trap is used by some item — the
//     vocabulary is READ from that table, never copied into this file, and a
//     table this script cannot parse is a refusal rather than an empty
//     allow-list (see the trap-vocabulary block below for why that matters).
//   - every `fixtures.provisioning.use` resolves to a real recipe — either a
//     key of its own area's area-level `fixtures` block, or `<area>:<recipe>`
//     naming one another area owns — because an item that reads as provisioned
//     and is not costs the run the clauses the recipe was meant to unblock,
//     mid-run and on a live boot (see the provisioning block below);
//   - and the reverse: every area-level recipe is referenced by some item's
//     `use`. A recipe nobody opts into is dead text a runner may still replay.
//     Both directions together are what the trap vocabulary beside them has
//     always had — used implies documented, documented implies used.
//   - every SYMBOL ANCHOR (`<dir>/<file>.ts#<symbol>`, the spelling
//     `scripts/symbol-anchors.mjs#ANCHOR_GRAMMAR` defines) resolves — and this
//     gate neither detects nor resolves one itself. It is a REGISTERED CORPUS
//     (`CORPUS` below, a `scripts/symbol-anchors.mjs#defineCorpus` call swept by
//     `scripts/symbol-anchors.mjs#sweepCorpus`), which is the one shape the
//     #13556 ruling allows a second body of documents to join in: #16898 bound
//     the verdict, #18107 the grammar and the sweep. The 56 anchors that stopped
//     resolving when the private permissive rule was withdrawn are a named,
//     closed, grow-never residual. A shrink-never floor per family file keeps
//     the population from being emptied one deleted `#symbol` at a time (see the
//     symbol-anchor block below);
//   - and no `call` string — the one field in this ledger a runner REPLAYS —
//     instructs a `/meta/<plural>` URL spelling the boundary merely folds.
//     `call` ONLY: the fields beside it legitimately quote plural spellings to
//     narrate the fold (see the meta-URL block below, which also explains why
//     the fold itself is not this gate's to narrow).
//
// It does NOT judge whether an item is testable or its oracle sufficient — no
// static check can. It guarantees the *structure* a run can be trusted against.
//
// ## Honest limitations, stated up front rather than discovered later
//
//   1. **An anchor whose file extension is outside the shared anchorable
//      vocabulary is NOT REPORTED — it is simply not swept.** Detection is the
//      registered corpus's, and the shared extractor matches only a path ending
//      in one of `scripts/symbol-anchors.mjs#ANCHORABLE_EXTENSIONS`, so a
//      `#symbol` on any other extension matches nothing and produces no finding
//      at all — where the pre-registration detector raised a hard
//      `UNRESOLVABLE ANCHOR` red telling the author to cite that file bare.
//      The silent class is recorded here rather than compensated: the shared
//      vocabulary is 23 extensions against the private 8, so what it can hide
//      is strictly smaller than what the private set refused, and MEASURED on
//      today's population it is ZERO — every anchor-shaped token in this family
//      names `.ts` (622), `.json` (9) or `.mjs` (3), all three inside the
//      vocabulary. ⚠️ Read that zero with the cadence beside it: this gate is
//      NOT wired into per-PR CI (the maintainer decision recorded in
//      `.github/workflows/lint.yml` — it runs by hand before a release or after
//      a large platform surface lands, with
//      `.github/workflows/platform-checklist-watchdog.yml` sweeping `main`
//      daily as its only standing caller), so a future out-of-vocabulary anchor
//      sits unreported until somebody runs this gate. The exit is the ruling's
//      own: widen the shared vocabulary in `scripts/symbol-anchors.mjs`, and
//      ⛔ never re-fork a private extension set here.
//
// Usage: node scripts/check-platform-checklist.mjs   (pnpm check:platform-checklist)

import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { maskComments } from './js-comment-mask.mjs';
import * as symbolAnchorsModule from './symbol-anchors.mjs';
import { ANCHORABLE_EXTENSIONS, defineCorpus, extractAnchors, sweepCorpus, symbolSegmentResolution } from './symbol-anchors.mjs';
import { join, basename, relative } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const CHECKLIST_REL = 'docs/qa/platform-checklist';
const CHECKLIST_DIR = join(ROOT, CHECKLIST_REL);
const AREAS_DIR = join(CHECKLIST_DIR, 'areas');

/**
 * Every authored `.json`/`.md` file in the checklist family, as paths relative
 * to `CHECKLIST_DIR`. `runs/` is excluded: run records are outputs, written by
 * a runner against whatever the ledger said at the time, and holding a past
 * record to today's authoring rules would make the rule unfixable.
 *
 * @param {string} dir
 * @param {string} [prefix]
 * @returns {string[]}
 */
function familyFiles(dir, prefix = '') {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      if (entry.name === 'runs') continue;
      out.push(...familyFiles(join(dir, entry.name), rel));
    } else if (entry.name.endsWith('.json') || entry.name.endsWith('.md')) {
      out.push(rel);
    }
  }
  return out;
}

const STATUSES = new Set(['active', 'draft', 'planned', 'retired']);

// ── Which statuses CARRY coverage ───────────────────────────────────────────
// The capability-coverage ratchet below asks "does the checklist test this
// governed metadata kind?". `planned` is the ledger's answer to "the definition
// requires this capability and nothing verifies it yet" — a promise, not a
// test. So a planned item is a legal MAP TARGET (that is how a capability-gap
// card gets somewhere to point) and contributes ZERO coverage: a kind whose
// only items are planned is UNMAPPED, exactly as if the entry were empty.
// ⛔ Folding `planned` in here is the one edit that would turn this ratchet
// into a way to green a kind by promising to test it.
const COVERAGE_BEARING_STATUSES = new Set(['active', 'draft']);

const PRIORITIES = new Set(['P0', 'P1', 'P2']);
const SURFACES = new Set(['browser', 'api', 'cli', 'build', 'mixed']);
const ORACLES = new Set(['api', 'network', 'screenshot', 'dom', 'log', 'test', 'build']);
const BLOCKED_BY = new Set(['fixture', 'environment', 'dependency', 'product-bug']);

const RELEASE_RE = /^v\d+(\.\d+)?$/;

/**
 * The field rules an item's `status` implies, as a pure function so the battery
 * can drive every status through it with no tree to read.
 *
 * `planned` is the only status that RELAXES anything, and it relaxes exactly
 * the three fields that cannot honestly exist before the capability does:
 * `since` (no release has introduced it), `steps` (nothing to drive) and
 * `acceptance` (no oracle to consult — handled at its own site below). In
 * exchange it REQUIRES `personas`: who the capability is for is what makes a
 * gap readable to the next sweep, and it is knowable the day the gap is found.
 *
 * @param {{status?: string, since?: unknown, steps?: unknown, personas?: unknown}} item
 * @returns {string[]}
 */
function statusFieldProblems(item) {
  const problems = [];
  const isRelease = typeof item.since === 'string' && RELEASE_RE.test(item.since);
  const hasSteps = Array.isArray(item.steps) && item.steps.length > 0;

  if (item.status === 'planned') {
    if (!(item.since === null || isRelease)) {
      problems.push('"since" on a planned item must be null (no target release chosen yet) or the TARGET release, e.g. "v18" — never a release that already shipped without it');
    }
    if (hasSteps) {
      problems.push('a planned item carries NO "steps" — there is nothing to drive yet. Steps arrive in the PR that implements the capability, in the same edit that promotes it to "active"');
    }
    if (!Array.isArray(item.personas) || item.personas.length === 0) {
      problems.push('a planned item must name its "personas" — who the capability is for is what makes the gap readable before anything exists to run');
    }
    return problems;
  }

  if (!isRelease) problems.push('"since" must be the release that introduced the capability, e.g. "v16" or "v16.0"');
  if (!hasSteps) problems.push('"steps" must be a non-empty array of strings');
  return problems;
}

/**
 * One `coverage.json` entry's `items` list, judged. Pure, and the ONE place the
 * ratchet decides what counts — so the battery can drive both directions of the
 * planned rule without a tree, and so there is no second opinion to drift from.
 *
 * The two directions that matter, and why the second is the load-bearing one:
 *
 *   - a kind mapped to an ACTIVE item is covered, and stays covered when a
 *     planned item is listed beside it (the planned id is where the next
 *     capability-gap card points; it must not turn a green kind red);
 *   - a kind whose ONLY items are planned is UNMAPPED. The platform has the
 *     capability on its definition list, the checklist records that nothing
 *     verifies it, and the ratchet must say so — otherwise `planned` becomes
 *     the cheapest way to green an untested kind, and the ratchet measures
 *     intentions instead of tests.
 *
 * @param {string[]} ids the entry's `items`
 * @param {(id: string) => string|undefined} statusOf item id -> status, undefined when unknown
 * @returns {{problems: string[], bearing: number}} `bearing` = items that CARRY coverage
 */
function coverageEntryProblems(ids, statusOf) {
  const problems = [];
  let bearing = 0;
  for (const id of ids) {
    const status = statusOf(id);
    if (status === undefined) {
      problems.push(`maps to unknown item id "${id}"`);
      continue;
    }
    if (status === 'retired') {
      problems.push(`maps to retired item "${id}" — point at its successor or re-waive the kind`);
      continue;
    }
    if (COVERAGE_BEARING_STATUSES.has(status)) bearing += 1;
  }
  if (bearing === 0) {
    problems.push(
      'UNMAPPED — nothing here CARRIES coverage: every item mapped to this kind is `planned` (or does not resolve).'
        + ' A planned item records that the definition requires the capability and that nothing verifies it yet — it is a promise, not a test,'
        + ' and counting it would let any kind go green by promising to cover it. Add an item that RUNS, or waive the kind with a reason.',
    );
  }
  return { problems, bearing };
}

const errors = [];
const err = (file, id, msg) => errors.push(`${file}${id ? ` · ${id}` : ''}: ${msg}`);

// ── Trap vocabulary ─────────────────────────────────────────────────────────
// Every other enum-ish field above is a hardcoded `Set`. `traps` deliberately
// is NOT, and that choice is the whole design of this block.
//
// RUNNER.md rule 3 tells a runner to "check the `traps` field and rule each
// listed trap out". The definitions that make that instruction executable live
// in ONE place — RUNNER.md's `### Trap vocabulary` table — and nothing used to
// hold the items and the table together: the string `traps` did not appear in
// this file at all. Measured on `main` at 6b0be02209: 19 distinct traps in use
// across 205 items, 11 documented, 8 used-but-undocumented (#10416 wrote the
// eight definitions; this check is why they cannot come back). Two drift
// shapes, and the validator saw neither:
//
//   1. a value nobody ever defined, exactly as the eight arrived;
//   2. a TYPO in a documented one — `hydration-races`, `wrong-persona ` —
//      which is the likelier and the worse of the two, because it reads as a
//      documented trap right up until someone greps the table for it.
//      `hydration-race` is on 79 of the 205 items; one mistyped instance is
//      simply a twentieth trap that no runner rules out and nobody notices.
//
// Both close the same way — check the vocabulary — and a hardcoded `TRAPS` set
// would close NEITHER honestly: it only moves the drift one level up, between
// this script and RUNNER.md, with nothing watching that seam either.
//
// ## Why the parser carries a positive control that runs on EVERY invocation
//
// A markdown-table extractor has one failure mode that matters: it reads zero
// rows — heading renamed, table moved, a row's backtick spelling changed — and
// every item then validates against an empty allow-list. Zero violations. A
// green line indistinguishable from the green a working parse prints. That is
// the silent-success direction this tree treats as worse than no check at all
// (#4690), so `extractTrapVocabulary` REFUSES on a table it cannot recognise
// and never returns an empty vocabulary with no complaint — and a fixture
// battery proves the refusal still fires.
//
// The battery runs inline, on every invocation, not only behind `--self-test`,
// because a `--self-test` here would otherwise execute NOWHERE: this gate is
// not CI-wired by maintainer decision (README "Operating cadence"), so nothing
// on a PR would ever reach a `--self-test` leg.
//
// ⚠️ CORRECTED (#11730): the second half of that sentence no longer holds, and
// the first half is unaffected. `.github/workflows/platform-checklist-watchdog.yml`
// now runs this gate on `main` daily through its package script, so a
// `--self-test` leg DOES execute somewhere — and the root alias
// `check:platform-checklist` carries one, which is what `check:self-test-wired`
// requires of every script CI runs. The gate is still NOT wired into per-PR CI;
// only the reporting channel changed. The inline battery stays inline: a
// `--self-test` that runs once a day is not a reason to stop running the cases
// on the invocation whose verdict is being published. NOT because its `pnpm` alias is
// unavailable to it: `check:platform-checklist` is already a key in root
// package.json, and the reading that the #9465 fence covers that file is false
// -- the GATE INVOCATION IDIOM note at the top of `.github/workflows/lint.yml`
// carries that lane's verbatim scope, and is not restated here. A self-test
// nothing runs is the documented defect of #10574/#10573 — CI enforcing the
// spelling of a guarantee while never once checking the guarantee still holds.
// The battery is in-memory string work (~1 ms of a ~270 ms run), so "always"
// costs nothing worth naming, and its assertion count is printed on the OK
// line: the green states how many rows it read and that its own control passed.

const RUNNER_FILE = join(ROOT, 'docs/qa/platform-checklist/RUNNER.md');
const TRAP_HEADING = '### Trap vocabulary';

/**
 * Extract the trap vocabulary from RUNNER.md's `### Trap vocabulary` table.
 *
 * Returns `{ traps, duplicates, refusal }`. A non-null `refusal` means the
 * table could not be recognised and the caller MUST treat it as a hard
 * failure. This never returns an empty `traps` with a null `refusal`: an empty
 * vocabulary and a working parse are not allowed to look alike.
 */
function extractTrapVocabulary(md) {
  const no = (refusal) => ({ traps: [], duplicates: [], refusal });
  const lines = String(md).split('\n');

  const h = lines.findIndex((l) => l.trimEnd().startsWith(TRAP_HEADING));
  if (h === -1) {
    return no(`the "${TRAP_HEADING}" heading is not in the file — renamed, moved or removed. Restore it: this check reads the vocabulary from that table and refuses to guess.`);
  }

  let i = h + 1;
  for (; i < lines.length; i++) {
    if (/^#{1,6}\s/.test(lines[i])) return no(`no markdown table under "${TRAP_HEADING}" — the next heading arrives first`);
    if (lines[i].trimStart().startsWith('|')) break;
  }
  if (i >= lines.length) return no(`no markdown table under "${TRAP_HEADING}" — the file ends first`);

  const header = lines[i].trim();
  if (!/^\|\s*trap\s*\|/i.test(header)) {
    return no(`the first table under "${TRAP_HEADING}" is not the trap table — expected a "| trap | … |" header row, found ${JSON.stringify(header.slice(0, 60))}`);
  }
  if (!/^\|[\s:|-]+\|$/.test((lines[i + 1] ?? '').trim())) {
    return no(`the trap table's header row is not followed by a markdown separator row — found ${JSON.stringify((lines[i + 1] ?? '').trim().slice(0, 60))}. This parser cannot read that shape, and reading it wrong would shrink the vocabulary silently.`);
  }

  const rows = [];
  const unreadable = [];
  for (i += 2; i < lines.length && lines[i].trimStart().startsWith('|'); i++) {
    const m = lines[i].trim().match(/^\|\s*`([^`]+)`\s*\|/);
    if (m) rows.push(m[1]);
    else unreadable.push(lines[i].trim().slice(0, 60));
  }

  if (unreadable.length) {
    return no(`${unreadable.length} row(s) of the trap table do not name a single backticked trap in the first cell — e.g. ${JSON.stringify(unreadable[0])}. Every row must read "| \`trap-name\` | what it fakes | counter |"; a row this parser cannot read would drop that trap out of the vocabulary without a word.`);
  }
  if (rows.length === 0) {
    return no(`the trap table under "${TRAP_HEADING}" has a header but ZERO rows. An empty vocabulary would make every item's \`traps\` validate against nothing and report zero problems, so this is a refusal — never an empty allow-list.`);
  }

  const seen = new Set();
  const duplicates = [];
  for (const t of rows) {
    if (seen.has(t)) duplicates.push(t);
    seen.add(t);
  }
  return { traps: [...seen], duplicates, refusal: null };
}

/** Levenshtein, for the did-you-mean that makes drift shape 2 readable. */
function editDistance(a, b) {
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length];
}

function didYouMean(name, vocabulary) {
  let best = null;
  let bestD = Infinity;
  for (const t of vocabulary) {
    const d = editDistance(name, t);
    if (d < bestD) {
      bestD = d;
      best = t;
    }
  }
  return best !== null && bestD <= 3 ? ` — did you mean \`${best}\`?` : '';
}

/** Problems with one item's `traps`, as message strings. Pure; battery-tested below. */
function trapProblems(item, vocabulary) {
  const out = [];
  if (item.traps === undefined) return out; // optional field: 8 of 205 items carry none
  if (!Array.isArray(item.traps)) {
    out.push(`"traps" must be an array of trap names from RUNNER.md's \`${TRAP_HEADING}\` table`);
    return out;
  }
  const seen = new Set();
  item.traps.forEach((t, i) => {
    if (typeof t !== 'string' || !t.trim()) {
      out.push(`traps[${i}] must be a non-empty string`);
      return;
    }
    if (t !== t.trim()) {
      out.push(`traps[${i}] ${JSON.stringify(t)} has surrounding whitespace — a padded name is a different string to everyone who greps the table for it`);
    }
    const name = t.trim();
    if (seen.has(name)) out.push(`traps[${i}] \`${name}\` is listed twice`);
    seen.add(name);
    if (!vocabulary.has(name)) {
      out.push(
        `traps[${i}] \`${name}\` is not in RUNNER.md's \`${TRAP_HEADING}\` table${didYouMean(name, vocabulary)}` +
          ` — either it is a typo of a documented trap, or it is a new one; document it in that table (name · what it fakes · the counter) before using it, so the runner told to "rule each listed trap out" has something to rule out.`,
      );
    }
  });
  return out;
}

// ── Provisioning recipes (`fixtures.provisioning.use`) ─────────────────────
// An area may write ONE provisioning recipe at the area level and have many
// items opt into it by key (README "Area-level `fixtures` — one named
// provisioning recipe, many items"). Both halves have to be real: a recipe
// nobody references is dead text, and a `use` naming a key that is not there
// is a dangling pointer — an item that READS as provisioned and is not. The
// run finds out at the worst possible moment: mid-run, on a live boot, with
// the clauses the recipe was supposed to unblock now scoring blocked(fixture).
//
// This resolves the dangling direction. It was deliberately deferred while the
// recipe shape lived in exactly one area (option C on #7716's open question,
// tracked at #7720), on the stated condition that it be revisited if the shape
// spread. It has: three area files, six references (#10593).
//
// TWO SPELLINGS, one lookup (maintainer ruling 2026-08-22, #10593 gap 2 —
// option A, area-qualified references):
//
//   "qa-scratch-authz"                      → a recipe of the item's OWN area
//   "search:qa-contributor-bound-member"    → "<area>:<recipe>", any area
//
// The qualified form exists because a recipe is proved by one area and needed
// by another, and until it existed that pointer could only be prose. Prose is
// the one form that cannot drift-check: rename the recipe and `search.json`
// moves while the sentence in `records-forms.json` does not. The unqualified
// form stays exactly as valid as it was — every reference already written
// resolves unchanged; the qualifier is an addition, not a migration.
//
// ── The reverse direction: a recipe no item references (#11506) ────────────
// This was deliberately deferred, and the deferral's stated reason has since
// been discharged rather than forgotten — which is the only thing that makes
// turning it on now correct rather than merely overdue.
//
// The reason: while cross-area reuse had no spelling, a recipe whose only
// consumer lived in another area could be referenced ONLY from that item's
// `knownGaps` prose, invisible here. Redding the unreferenced direction would
// then have answered the open cross-area question by accident, in the
// direction of "recipes are area-local" — a convention ruling smuggled in as a
// mechanical check. Discharged by the maintainer's option-A ruling of
// 2026-08-22 (#10593 gap 2), implemented directly above: EVERY legitimate
// consumer can now express itself as a `use`, from any area. So a recipe with
// no `use` pointing at it is no longer "possibly referenced from prose we
// cannot see" — it is dead text, and this check may say so.
//
// Three definitional edges, each decided here rather than left to the reader:
//
//   1. WHAT COUNTS AS A REFERENCE — a resolved `fixtures.provisioning.use`,
//      and nothing else. A recipe NAME appearing in prose does not count, and
//      several do appear: `automation.json` and `search.json` both open their
//      block with "Shape copied from qa-scratch-authz", which is provenance,
//      not consumption. Counting prose would restore exactly the invisible,
//      un-drift-checkable pointer the qualified spelling exists to retire.
//
//   2. RETIRED ITEMS COUNT — "referenced" means referenced by ANY item, not
//      by an active one. This is mechanical, not a convention call, and the
//      forward direction is what forces it: `provisioningProblems` runs on
//      every item regardless of `status`, so a retired item's `use` must still
//      resolve, so its recipe must still exist. Were "referenced" active-only,
//      a recipe whose last consumer retired would be flagged here, and
//      deleting it to clear that flag would dangle the retired item's `use`
//      and red the forward direction — two checks in the same gate made
//      mutually unsatisfiable, escapable only by editing a retired item, which
//      the append-only lifecycle forbids. Referenced-at-all is the only
//      self-consistent reading, and it is pinned in the battery below.
//
//   3. IT IS SUPPRESSED WHILE ANY `use` DANGLES. An unresolved reference means
//      the consumer graph is incomplete, so "nobody references this recipe" is
//      not yet a statement worth making: the intended consumer may BE the
//      broken reference. One typo would otherwise print twice — once against
//      the item that has it, and once against the perfectly correct recipe it
//      meant to name, inviting the author to delete live text to clear a
//      message caused by a neighbouring typo. Nothing is hidden by waiting:
//      the run is already red from the dangling reference, and this direction
//      speaks on the next one.
//
// No waiver spelling is offered for a deliberately-kept-but-unreferenced
// recipe, deliberately: the population needing one is zero (all four recipes
// are referenced, by seven items) and a waiver field invented ahead of its
// first real case is a guess at what that case will want. The failure names
// the two remedies that exist today — give it a consumer, or delete it. A
// genuine keep-it-anyway case is the moment to decide the spelling, on the
// evidence of that case; #10885 (recipes carry no `revision`/`history` of
// their own) may well answer it as a retired recipe rather than a waived one.
//
// `$`-prefixed keys are annotations, not recipes — every area `fixtures` block
// opens with a `$comment` stating the block's purpose and replay rule — so
// they are excluded from the recipe set, and from the did-you-mean.

/** The recipe keys of one area doc's area-level `fixtures` block. `$…` keys are annotations, not recipes. */
function areaRecipeKeys(doc) {
  const f = doc?.fixtures;
  if (!f || typeof f !== 'object' || Array.isArray(f)) return [];
  return Object.keys(f).filter((k) => !k.startsWith('$'));
}

const USE_SEP = ':';

/**
 * Split a `use` into the area it addresses and the recipe key it names.
 * `{ area: null }` is the unqualified spelling (resolve against the item's own
 * area). `{ malformed }` is a shape that is neither — reported as itself
 * rather than resolved to nothing, because "no recipe called `search:`" would
 * send the author hunting for a recipe when the defect is the reference.
 */
function parseUse(use) {
  if (!use.includes(USE_SEP)) return { area: null, recipe: use };
  const parts = use.split(USE_SEP);
  if (parts.length > 2) {
    return { malformed: `it carries ${parts.length - 1} "${USE_SEP}" separators — a qualified reference names exactly one area and one recipe` };
  }
  const [area, recipe] = parts;
  if (!area) return { malformed: `its area half is empty — write "<area>${USE_SEP}<recipe>", or drop the "${USE_SEP}" to name a recipe of this item's own area` };
  if (!recipe) return { malformed: `its recipe half is empty — write "<area>${USE_SEP}<recipe>"` };
  if (area !== area.trim() || recipe !== recipe.trim()) {
    return { malformed: 'it has whitespace around a half — a padded name is a different string to everyone who greps for it' };
  }
  return { area, recipe, qualified: true };
}

/**
 * Problems with one item's `fixtures.provisioning`, as message strings.
 *
 * `ownArea` is the item's area (the filename stem); `recipesByArea` maps every
 * area to its recipe keys, so a qualified `use` can be resolved against the
 * area it names. Pure; battery-tested below.
 */
function provisioningProblems(item, ownArea, recipesByArea) {
  const out = [];
  const p = item?.fixtures?.provisioning;
  if (p === undefined) return out; // optional field: 6 of 205 items opt into a recipe
  if (typeof p !== 'object' || p === null || Array.isArray(p) || typeof p.use !== 'string' || !p.use.trim()) {
    out.push(`"fixtures.provisioning" must carry a non-empty string "use" naming a recipe — either a key of this area's area-level "fixtures" block, or "<area>${USE_SEP}<recipe>" for one another area owns — a provisioning block that opts into nothing reads as provisioned and is not`);
    return out;
  }

  const parsed = parseUse(p.use);
  if (parsed.malformed) {
    out.push(
      `"fixtures.provisioning.use" is ${JSON.stringify(p.use)}, which is not a usable reference: ${parsed.malformed}.` +
        ` Both spellings are accepted: \`qa-scratch-authz\` (a recipe of this area) or \`search${USE_SEP}qa-contributor-bound-member\` (one another area owns).`,
    );
    return out;
  }

  // Which area's block answers this reference — the named one, or this item's own.
  const targetArea = parsed.area ?? ownArea;
  const recipes = new Set(recipesByArea.get(targetArea) ?? []);
  if (recipes.has(parsed.recipe)) return out;

  if (parsed.qualified && !recipesByArea.has(targetArea)) {
    const areas = [...recipesByArea.keys()];
    const withRecipes = areas.filter((a) => (recipesByArea.get(a) ?? []).length > 0);
    out.push(
      `"fixtures.provisioning.use" is "${p.use}", whose area half names "${targetArea}" — there is no such area file` +
        `${didYouMean(targetArea, areas)} — the areas that define recipes today are ${withRecipes.map((a) => `\`${a}\``).join(', ')}.`,
    );
    return out;
  }

  // The recipe key is unknown wherever we were told to look. When some OTHER
  // area does define it, say so with the exact spelling to write: an author
  // who copied an unqualified key across areas is one qualifier away from a
  // working reference, and that is the drift this two-level lookup exists for.
  const elsewhere = [...recipesByArea].filter(([a, keys]) => a !== targetArea && keys.includes(parsed.recipe)).map(([a]) => a);
  const hint = elsewhere.length
    ? ` — ${elsewhere.map((a) => `\`${a}\``).join(', ')} define${elsewhere.length === 1 ? 's' : ''} it: write \`${elsewhere[0]}${USE_SEP}${parsed.recipe}\` to opt into it from here, and do NOT fork a second copy into this area.`
    : '';

  if (recipes.size === 0) {
    out.push(
      `"fixtures.provisioning.use" names "${parsed.recipe}"` +
        (parsed.qualified ? ` in area "${targetArea}", which has no area-level "fixtures" block to resolve it against` : ' but this area file has no area-level "fixtures" block to resolve it against') +
        (hint || ' — write the recipe as a sibling of "area"/"title"/"items" (README "Area-level `fixtures`"), or drop the reference.'),
    );
    return out;
  }

  out.push(
    `"fixtures.provisioning.use" names "${parsed.recipe}", which is not a recipe in ${parsed.qualified ? `area "${targetArea}"'s` : "this area's"} area-level "fixtures" block${didYouMean(parsed.recipe, recipes)}` +
      ` — ${parsed.qualified ? `\`${targetArea}\`` : 'this area'} offers ${[...recipes].map((k) => `\`${k}\``).join(', ')}${hint || '.'}`,
  );
  return out;
}

/**
 * The recipe one item's `fixtures.provisioning` points at, as
 * `{ area, recipe }` — or `null` when it opts into nothing.
 *
 * Deliberately status-INDEPENDENT (edge 2 above): a retired item's `use` is
 * still a reference, because the forward direction still requires it to
 * resolve. Deliberately shape-tolerant in the other direction: a malformed
 * `use` names nothing and returns `null` rather than a half-parsed target, so
 * a broken reference can never accidentally keep a recipe alive.
 *
 * `ownArea` supplies the area half of an unqualified spelling — the same
 * `parsed.area ?? ownArea` resolution the forward direction performs, so the
 * two directions cannot disagree about which recipe a `use` addresses.
 */
function referencedRecipe(item, ownArea) {
  const use = item?.fixtures?.provisioning?.use;
  if (typeof use !== 'string' || !use.trim()) return null;
  const parsed = parseUse(use);
  if (parsed.malformed) return null;
  return { area: parsed.area ?? ownArea, recipe: parsed.recipe };
}

/**
 * The recipes no item references, as `{ area, recipe }` in area-then-key order.
 *
 * `recipesByArea` is the recipe universe (`$…` annotations already excluded by
 * `areaRecipeKeys`); `referencedByArea` maps an area to the set of ITS recipe
 * keys some item addressed, collected from every area via `referencedRecipe`.
 *
 * `danglingRefs` is the count of items whose `use` did not resolve, and a
 * non-zero count returns EMPTY by design (edge 3 above): with the consumer
 * graph broken, an unreferenced verdict could name a correct recipe whose only
 * consumer is the very reference that is misspelt.
 */
function unreferencedRecipes(recipesByArea, referencedByArea, danglingRefs) {
  if (danglingRefs > 0) return [];
  const out = [];
  for (const [area, keys] of recipesByArea) {
    const hit = referencedByArea.get(area);
    for (const recipe of keys) {
      if (!hit?.has(recipe)) out.push({ area, recipe });
    }
  }
  return out;
}

/** How an unreferenced recipe is reported — one place, so the battery pins the text a reader gets. */
function unreferencedRecipeMessage(area, recipe) {
  return (
    `area-level recipe "${recipe}" is referenced by no item — dead text. A recipe exists to be opted into:` +
    ` give it a consumer (\`"use": "${recipe}"\` from an item in this area, or \`"use": "${area}${USE_SEP}${recipe}"\` from an item in any other),` +
    ' or delete the recipe. Since the area-qualified spelling was ruled (2026-08-22, #10593 gap 2) every legitimate consumer can express itself as a `use`,' +
    ' so an unreferenced recipe is no longer possibly-referenced-from-prose — it is a call sequence a runner may still replay for nothing.'
  );
}

// ── `/meta` URL spelling inside `call` strings (#13010) ─────────────────────
// A checklist step's `call` is not prose. RUNNER.md has an operator REPLAY it
// against a live boot, so a `call` is the one field in this ledger that is an
// executable instruction — and this repo shipped four steps telling that
// operator to send `PUT /api/v1/meta/objects/:name`, a plural item write on
// the metadata write door. The `/meta` type segment is always SINGULAR; those
// steps answered 200 only because the boundary FOLDS the plural spelling.
//
// ## Why a guard and not just a fix
//
// The four were measured and repaired (#11042 → #13011). What makes this a
// gate rather than a sweep is the population's shape: measured at merged
// `main` 2866d5f97e, `areas/records-forms.json` contained ZERO `meta/objects`
// occurrences — and four days later a FIFTH site arrived in 5737222b89
// (#12382), authored, reviewed and merged with nothing in the tree able to
// see it. The class is not a backlog being drained; it is still being newly
// introduced, one honest PR at a time. So the deliverable is "what stops the
// next one", and a sweep — however complete on the day it runs — is by
// construction the thing that already failed here.
//
// ## ⛔ The fold is NOT the defect and is NOT narrowed here
//
// `/meta/objects/:name` and `/meta/object/:name` answer identically today and
// must keep doing so: the plural spellings are a published tolerance, and the
// sibling gate `check-doc-route-spelling.mjs` carries the same fence in its
// own header. What this refuses is the repo INSTRUCTING the non-canonical
// spelling in a step somebody is told to replay. Nothing here reaches the
// wire, the router, or any accept/reject decision.
//
// ## ⛔ `call` ONLY — the boundary that keeps this from redding correct prose
//
// The neighbouring fields legitimately CONTAIN plural spellings, because
// their job is to narrate the fold or the defect: a `why` explaining why the
// plural door was a hole, a `source` citing the registration that was
// retired, and `attachments-storage.json`'s `requires` prose correctly naming
// the parameterized `PUT /api/v1/meta/:type/:name` — a segment-shaped
// literal, not a plural. That is also precisely why this could not be a root
// expansion of `check-doc-route-spelling.mjs` instead: that gate scans a
// file's TEXT against the route ledgers, and text-scanning these files would
// flag the narration along with the instruction. A gate that reds a correct
// row costs more than the defect it catches, so the read is field-addressed:
// values under the key `call`, at any depth, and nothing else.
//
// Depth, not a curated path, for the same reason the gate exists: every
// `call` on the ledger today sits in an AREA-LEVEL `fixtures.<recipe>
// .sequence[]`, but a path list that matches where they happen to live now
// can never match the one added tomorrow — which is the exact failure this
// block is a response to.
//
// ## The vocabulary is READ from the contract, never copied
//
// The refusal keys on `META_URL_TO_SINGULAR` in
// `packages/spec/src/meta-spelling/meta-url-data.generated.ts` — the closed
// set of spellings the boundary folds, DERIVED (Prime Directive #8) by
// `packages/spec/scripts/build-meta-url-spelling.ts` from `PLURAL_TO_SINGULAR`
// and `DEFAULT_METADATA_TYPE_REGISTRY`, and re-derived from those live sources
// on every CI lap by `check:meta-url-spelling` (.github/workflows/lint.yml,
// "Check the meta-url-spelling data module is current and spellings agree").
// So the set this guard refuses cannot drift from the set the boundary
// tolerates: a new metadata type arrives here with its plural already known,
// and a retired one leaves. Copying the 34 spellings into this file would
// move the drift one seam up with nothing watching it — the same argument the
// trap-vocabulary block above makes about RUNNER.md.
//
// This is also why keying on the CLOSED SET matters more than it looks. A
// trailing-`s` heuristic would flag `/meta/positions` (a real fold, fine) and
// also anything that merely LOOKS plural, while missing every camelCase
// spelling (`sharingRules`, `analyticsCubes`, `ragPipelines`) that folds just
// as much. Membership answers both directions exactly.
//
// Same refusal discipline as the trap table: an extractor that reads zero
// pairs would validate every `call` against an empty set and print a green
// indistinguishable from a working parse (#4690), so it REFUSES rather than
// returning an empty vocabulary, and the battery below proves the refusal
// still fires.

const META_URL_DATA_FILE = join(ROOT, 'packages/spec/src/meta-spelling/meta-url-data.generated.ts');
const META_URL_EXPORT = 'META_URL_TO_SINGULAR';

// Measured floor, not a pin. The live map held 34 spellings at introduction
// (2026-08-29, `check:meta-url-spelling`: "34 spellings, 27 registry-declared
// types"). An exact pin would red on every legitimate metadata type the
// platform adds; a floor only speaks when the PARSE has collapsed — a quoting
// migration, a reshaped literal — which is the failure that would otherwise be
// silent. Well below 34 on purpose: this number should never need touching.
const META_URL_SPELLING_FLOOR = 20;

// The anchor. `objects → object` is the spelling this whole class is about and
// the one metadata type that reaches the map through BOTH derivation limbs
// (the manifest map and the registry). Losing it means the derivation moved
// somewhere this extractor is no longer reading, and a silent green would then
// be exactly wrong.
const META_URL_ANCHOR = 'objects';

/**
 * Extract `META_URL_TO_SINGULAR`'s plural→singular pairs from the generated
 * spec module, as source text.
 *
 * Returns `{ folded, canonical, refusal }`. A non-null `refusal` means the map
 * could not be read and the caller MUST treat it as a hard failure — never as
 * "no spellings to check". Read as text rather than imported because this gate
 * is a zero-dependency `node` script on an unbuilt tree (README "Operating
 * cadence": zero-dependency, ~1s, no tokens); `extractEnumMembers` below reads
 * `packages/spec` the same way, for the same reason.
 */
function extractMetaUrlSpellings(src) {
  const no = (refusal) => ({ folded: [], canonical: [], refusal });
  // Masked first: the file's docblock quotes spellings in prose, and a
  // comment-blind read would mint vocabulary out of the explanation.
  const masked = maskComments(String(src));

  const decl = masked.match(new RegExp(`(?:export\\s+)?const\\s+${META_URL_EXPORT}\\b[^=]*=`));
  if (!decl) {
    return no(`\`${META_URL_EXPORT}\` is not declared in packages/spec/src/meta-spelling/meta-url-data.generated.ts — renamed, moved, or the generator now emits a different shape. Re-point this extractor at the contract; it will not guess.`);
  }

  const start = masked.indexOf('{', decl.index + decl[0].length);
  if (start === -1) return no(`\`${META_URL_EXPORT}\` is declared but no object literal follows it.`);

  let depth = 0;
  let end = -1;
  for (let j = start; j < masked.length; j++) {
    if (masked[j] === '{') depth++;
    else if (masked[j] === '}' && --depth === 0) {
      end = j;
      break;
    }
  }
  if (end === -1) return no(`\`${META_URL_EXPORT}\`'s object literal is never closed — the file is truncated or unparseable.`);

  // Both quoting styles, so a generator that stops quoting its keys reshapes
  // the file without silently halving what this reads.
  const pairs = [...masked.slice(start, end + 1).matchAll(/(["']?)([A-Za-z0-9_]+)\1\s*:\s*["']([A-Za-z0-9_]+)["']/g)];
  if (pairs.length === 0) {
    return no(`\`${META_URL_EXPORT}\` parsed to ZERO spellings — the literal's shape changed. An empty vocabulary would validate every \`call\` against nothing and print a green identical to a working parse, so this is a refusal.`);
  }
  const folded = pairs.map((m) => m[2]);
  const canonical = pairs.map((m) => m[3]);
  if (folded.length < META_URL_SPELLING_FLOOR) {
    return no(`\`${META_URL_EXPORT}\` parsed to only ${folded.length} spellings, below the floor of ${META_URL_SPELLING_FLOOR} (34 at introduction) — a partial parse, not a shrunken contract. Fix the extractor rather than lowering the floor.`);
  }
  if (!folded.includes(META_URL_ANCHOR)) {
    return no(`\`${META_URL_EXPORT}\` parsed ${folded.length} spellings but not the \`${META_URL_ANCHOR}\` anchor — the one spelling reaching the map through both derivation limbs. Its absence means this extractor is reading something other than the live contract.`);
  }
  return { folded, canonical, refusal: null };
}

// A `/meta` or `/metadata` path segment, wherever it appears in the string.
// Scanned rather than anchored because a `call` is not always a bare URL: the
// ledger carries steps like "toggle a stock flow OFF for the 409 row: POST
// /api/v1/automation/…", where the instruction wraps the address in prose.
// The segment ends at the next path separator, query, fragment or delimiter,
// so `?package=com.objectstack.qa.feeds` never becomes part of it, and a
// parameter placeholder (`:type`, `{type}`, `<type>`) is simply never a member
// of the closed set.
const META_URL_PATH_SEGMENT = /\/(?:metadata|meta)\/([^/?#\s"'`)\],;]+)/g;

/** The folded spellings one `call` string instructs, deduped. Pure; battery-tested below. */
function foldedSpellingsInCall(call, folded) {
  if (typeof call !== 'string') return [];
  const hits = new Set();
  for (const m of call.matchAll(META_URL_PATH_SEGMENT)) {
    if (folded.has(m[1])) hits.add(m[1]);
  }
  return [...hits];
}

/**
 * Every `call` string in one area document, with a readable path to it.
 *
 * Field-addressed at any depth — see the `call` ONLY note above. Array
 * elements render by their `id` when they carry one, so an item-level `call`
 * reports as `items[records-forms.foo].call` rather than by ordinal.
 */
function collectCalls(node, path = '', out = []) {
  if (Array.isArray(node)) {
    node.forEach((v, i) => {
      const label = v && typeof v === 'object' && typeof v.id === 'string' && v.id ? v.id : i;
      collectCalls(v, `${path}[${label}]`, out);
    });
    return out;
  }
  if (node && typeof node === 'object') {
    for (const [k, v] of Object.entries(node)) {
      const p = path ? `${path}.${k}` : k;
      if (k === 'call' && typeof v === 'string') out.push({ path: p, call: v });
      collectCalls(v, p, out);
    }
  }
  return out;
}

/** How a folded `call` spelling is reported — one place, so the battery pins the text a reader gets. */
function foldedCallMessage(path, call, spelling, singular) {
  return (
    `${path} instructs the non-canonical \`/meta/${spelling}\` spelling: ${JSON.stringify(call)}.` +
    ` The metadata door's type segment is always SINGULAR — write \`/meta/${singular}/…\`.` +
    ` \`${spelling}\` is a key of \`${META_URL_EXPORT}\` (packages/spec/src/meta-spelling/meta-url-data.generated.ts), i.e. a spelling the boundary FOLDS,` +
    ' so this step answers 200 today and no run will ever notice — which is why it needs a gate rather than a reviewer.' +
    ' ⛔ The fold is NOT the defect and is not being narrowed: `call` is the one field here an operator REPLAYS, and the repo must not INSTRUCT the spelling it merely tolerates.'
  );
}

// ── Self-test verdict handshake ─────────────────────────────────────────────
//
// Five batteries, each returning `{ checked, failures }` for a caller to
// report. A `return` above a battery's own end prints nothing, registers no
// failure, and yields a SMALLER `checked` that both legs below read as a pass.
// Measured on this file: a section that stopped running took the `--self-test`
// verdict from 141 assertions to 119, exited 0, and still claimed in prose that
// the direction it had skipped "REFUSES an empty/renamed/reshaped" table. A
// bare `return` is no better — it yields `undefined` and CRASHES the combine
// below, and an exit code alone reads that crash as a handshake rather than as
// the accident it is.
//
// So each battery sets its own flag as its last act and every caller checks it.
// The return value is load-bearing here (it carries `checked` and `failures`),
// so the handshake is a flag rather than a returned sentinel — the spelling
// `check-durability-degradation-log-level.mjs` and
// `check-dispatcher-error-vocabulary.mjs` carry, for that same reason.
let trapReachedVerdict = false;
let provisioningReachedVerdict = false;
let unreferencedReachedVerdict = false;
let metaCallReachedVerdict = false;
let lineCitationsReachedVerdict = false;
let symbolAnchorsReachedVerdict = false;
let plannedStatusReachedVerdict = false;

// ── The self-test's own battery roster and floor (#13489, adopted here) ────
//
// The handshake flags above answer "did this battery reach its verdict?". They
// cannot answer the other half: a battery that reaches its verdict having run
// FEWER assertions than it used to reports a smaller number, and every leg
// below reads the smaller number as a pass. This file already measured that
// exact shape — 141 assertions down to 119, exit 0 — and fixed only the
// early-return half of it.
//
// So the counts are pinned, per battery, as a FLOOR. Adding assertions is
// ordinary work and must not red; a battery BELOW its floor means cases
// stopped running and the remedy is to find what stopped registering.
//
// ⛔ A pinned TOTAL is not the repair: one battery dropping from 20 rows to 3
// keeps a total "right" the moment a sibling grows. And DELETING an entry
// silences that battery exactly as effectively as zeroing it, so the roster's
// own size is pinned beside it.
//
// The attribution differs from `scripts/pm/ci-failure.mjs`, whose rows open a
// battery by name so a stray assertion lands in a declared bucket: here each
// battery is a FUNCTION returning its own `checked`, so a row cannot be filed
// under the wrong battery in the first place, and the roster's job is the
// floor alone.
const BATTERY_TRAP_VOCABULARY = 'selfTestTrapVocabulary: the trap table, read and refused';
const BATTERY_PROVISIONING_USE = 'selfTestProvisioningUse: both `use` spellings and all three dangling shapes';
const BATTERY_UNREFERENCED_RECIPES = 'selfTestUnreferencedRecipes: the reverse direction';
const BATTERY_META_CALL_SPELLING = 'selfTestMetaCallSpelling: the folded `/meta` plural, read from the live contract';
const BATTERY_LINE_CITATION_BINDING = 'selfTestLineCitationBinding: the corpus declaration, the absent fork, and the binding driven both ways';
const BATTERY_SYMBOL_ANCHORS = 'selfTestSymbolAnchors: the corpus registration, the binding to the shared resolver, the residual and the floor';
const BATTERY_PLANNED_STATUS = 'selfTestPlannedStatus: the `planned` accept set, the fields it relaxes, and the coverage ratchet driven BOTH ways';

const SELF_TEST_BATTERIES = Object.freeze({
  [BATTERY_TRAP_VOCABULARY]: 22,
  [BATTERY_PROVISIONING_USE]: 34,
  [BATTERY_UNREFERENCED_RECIPES]: 19,
  [BATTERY_META_CALL_SPELLING]: 53,
  // 19 → 9 at #18592, and the SHAPE of the battery changed under it exactly as
  // the symbol-anchor battery's did at #18107: the 19 spelling cases that
  // pinned this file's own forked LINE-CITATION grammar moved into
  // `scripts/symbol-anchors.mjs`'s battery (122 → 149 there), and 9 took their
  // place — the corpus declaration, the source read that says no fork survives
  // here, its control, the binding driven ON and OFF against ONE text, the DARK
  // case that a citation both grammars already agreed on keeps its verdict, the
  // over-firing refusal on this ledger's own colon-then-digit neighbours, and
  // the live reading with its control.
  [BATTERY_LINE_CITATION_BINDING]: 9,
  // 40 → 42 at #18107, and the SHAPE of the battery changed under it: the 25
  // detector/resolver cases that pinned this file's own forked grammar moved
  // into `scripts/symbol-anchors.mjs`'s battery (93 → 122 there) and 27 took
  // their place — the registration, the ONE-vocabulary pin, the live `runs/`
  // exclusion in both directions, and every re-judged #16898 case, which
  // ⛔ survives the transplant unchanged in verdict.
  [BATTERY_SYMBOL_ANCHORS]: 42,
  // New with the `planned` status. Set at its landed count (headroom 0, the
  // convention every entry above uses). The load-bearing third of it is the
  // coverage direction: the live ledger carries ZERO planned items today, so
  // nothing but these fixtures can tell a working ratchet rule from a deleted
  // one — the unreferenced-recipe argument, applied to a rule whose subject
  // population is empty on purpose rather than by luck.
  [BATTERY_PLANNED_STATUS]: 28,
});
const SELF_TEST_BATTERY_FLOOR = 7;

/**
 * @param {Record<string, number>} ran battery name -> assertions it reported
 * @returns {string[]}
 */
function batteryRosterFailures(ran) {
  const failures = [];
  const declared = Object.keys(SELF_TEST_BATTERIES);
  if (declared.length < SELF_TEST_BATTERY_FLOOR) {
    failures.push(`the battery roster declares ${declared.length} batteries but the floor is ${SELF_TEST_BATTERY_FLOOR} — deleting an entry silences its floor exactly as effectively as zeroing it`);
  }
  for (const name of declared) {
    if (!(name in ran)) failures.push(`declared battery "${name}" did not run`);
  }
  for (const name of Object.keys(ran)) {
    if (!(name in SELF_TEST_BATTERIES)) failures.push(`battery "${name}" ran but is not declared in SELF_TEST_BATTERIES`);
  }
  for (const [name, floor] of Object.entries(SELF_TEST_BATTERIES)) {
    const n = ran[name];
    if (typeof n === 'number' && n < floor) {
      failures.push(`battery "${name}" reported ${n} assertions but its floor is ${floor} — cases stopped running; find what stopped registering (⛔ MAINTAINER-ONLY: lowering a floor is not the repair)`);
    }
  }
  return failures;
}


/**
 * One wording, ten call sites — five batteries across the two legs that run
 * them. The check, the message and the exit code are the landed ones; only the
 * duplication is factored out.
 */
function requireReachedVerdict(name, reached) {
  if (reached) return;
  console.error(
    `\n✗ check-platform-checklist self-test: ${name}() returned without reaching its verdict,\n`
      + 'so its assertions did not all run and no failure of theirs could be reported.\n'
      + 'Running the gate on top of a self-test that never finished would report an\n'
      + 'unverified gate as a verified one.\n',
  );
  process.exit(1);
}

/**
 * The positive control. Proves the extractor reads a good table AND refuses an
 * empty / renamed / reshaped one, and that the item-side checker catches both
 * drift shapes. Zero I/O — every subject is a literal fixture.
 */
function selfTestTrapVocabulary() {
  const failures = [];
  let checked = 0;
  const t = (what, ok) => {
    checked++;
    if (!ok) failures.push(what);
  };

  const table = (...rows) => ['prose above', '', `${TRAP_HEADING} (\`traps\` field)`, '', '| trap | what it fakes | counter |', '|---|---|---|', ...rows, '', '## Next section', '| not | a | trap |'].join('\n');

  const good = extractTrapVocabulary(table('| `hydration-race` | empty nav | settle, then read |', '| `stale-dist` | src edits with no effect | rebuild |'));
  t('P1 a well-formed table yields exactly its rows', good.refusal === null && good.traps.join(',') === 'hydration-race,stale-dist');
  t('P2 the row scan stops at the table, not at the next table in the file', !good.traps.includes('not'));
  t('P3 a clean parse reports no duplicates', good.duplicates.length === 0);

  const dup = extractTrapVocabulary(table('| `stale-dist` | a | b |', '| `stale-dist` | c | d |'));
  t('P4 a trap documented twice is reported', dup.refusal === null && dup.duplicates.join(',') === 'stale-dist' && dup.traps.length === 1);

  // ── the refusals: each of these, returning an empty vocabulary quietly, is
  //    the fail-open this whole block exists to make impossible ──────────────
  const refusals = [
    ['R1 a table with a header and ZERO rows', table()],
    ['R2 the heading renamed away', table('| `stale-dist` | a | b |').replace(TRAP_HEADING, '### Traps you may hit')],
    ['R3 no table under the heading (prose, then the next heading)', ['', TRAP_HEADING, '', 'See the skill for the list.', '', '## Next section', ''].join('\n')],
    ['R4 a row that lost its backticks', table('| `hydration-race` | a | b |', '| stale-dist | c | d |')],
    ['R5 a different table sitting under the heading', table('| `stale-dist` | a | b |').replace('| trap | what it fakes | counter |', '| oracle | when | why |')],
    ['R6 an empty file', ''],
    ['R7 the separator row missing', ['', TRAP_HEADING, '', '| trap | what it fakes | counter |', '| `stale-dist` | a | b |', ''].join('\n')],
    ['R8 the heading present but the file ends', ['', TRAP_HEADING, ''].join('\n')],
  ];
  for (const [what, md] of refusals) {
    const r = extractTrapVocabulary(md);
    t(`${what} is REFUSED, not read as an empty vocabulary`, typeof r.refusal === 'string' && r.refusal.length > 0 && r.traps.length === 0);
  }

  // The invariant behind every refusal above, asserted as an invariant rather
  // than case by case: no input may yield "nothing to check" without saying so.
  const allInputs = [...refusals.map(([, md]) => md), table('| `x` | a | b |'), '| trap |\n|---|\n| `y` |'];
  t(
    'R9 no input yields an empty vocabulary with no refusal',
    allInputs.every((md) => {
      const r = extractTrapVocabulary(md);
      return r.traps.length > 0 || (typeof r.refusal === 'string' && r.refusal.length > 0);
    }),
  );

  // ── the item side: both drift shapes the card names ───────────────────────
  const vocab = new Set(['hydration-race', 'stale-dist', 'wrong-persona']);
  t('C1 a documented trap passes', trapProblems({ traps: ['hydration-race'] }, vocab).length === 0);
  t('C2 an item with no traps is fine (optional field)', trapProblems({}, vocab).length === 0);
  const invented = trapProblems({ traps: ['totally-invented-trap'] }, vocab);
  t('C3 drift shape 1 — an undocumented trap is flagged', invented.length === 1 && invented[0].includes('totally-invented-trap'));
  const typo = trapProblems({ traps: ['hydration-races'] }, vocab);
  t('C4 drift shape 2 — a TYPO of a documented trap is flagged', typo.length === 1 && typo[0].includes('hydration-races'));
  t('C5 the typo message names the trap that was meant', typo.length === 1 && typo[0].includes('did you mean `hydration-race`'));
  const padded = trapProblems({ traps: ['wrong-persona '] }, vocab);
  t('C6 a trailing-space spelling is flagged, not trimmed away', padded.some((m) => m.includes('whitespace')));
  t('C7 a non-array "traps" is flagged', trapProblems({ traps: 'hydration-race' }, vocab).length === 1);
  t('C8 an empty-string trap is flagged', trapProblems({ traps: [''] }, vocab).length === 1);
  t('C9 a trap listed twice on one item is flagged', trapProblems({ traps: ['stale-dist', 'stale-dist'] }, vocab).some((m) => m.includes('twice')));

  trapReachedVerdict = true;
  return { checked, failures };
}

/**
 * The positive control for the provisioning resolve — same shape and the same
 * reason as the trap battery above. This check's entire value is that it
 * FIRES, and the failure it prevents is invisible from the outside: measured
 * on `main` at 112a8c6731, a typo'd `use` (`qa-media-constraint` for
 * `qa-media-constraints`) and a cross-area `use` each validated clean, exit 0,
 * printing the same OK line as an untouched tree. A check that quietly stopped
 * firing would restore exactly that green. Zero I/O — every subject literal.
 *
 * The qualified half (Q…) carries the same burden twice over, because a
 * two-level lookup has a failure mode the one-level one did not: resolving too
 * MUCH. A widening bug that let any recipe answer any reference would pass
 * every "it resolves" assertion, so each of the three failure shapes — real
 * area / missing key, missing area, malformed reference — is pinned firing,
 * and pinned saying which of the three it is.
 */
function selfTestProvisioningUse() {
  const failures = [];
  let checked = 0;
  const t = (what, ok) => {
    checked++;
    if (!ok) failures.push(what);
  };

  // A miniature of the real ledger: the area that owns the recipes under test,
  // a second area that owns the one every cross-area reference wants, and a
  // third that defines no recipes at all (the shape 12 of 15 area files have).
  const keys = areaRecipeKeys({ fixtures: { $comment: 'what this block is, and the replay rule', 'qa-scratch-authz': {}, 'qa-media-constraints': {} } });
  const byArea = new Map([
    ['attachments-storage', keys],
    ['search', areaRecipeKeys({ fixtures: { $comment: 'x', 'qa-contributor-bound-member': {} } })],
    ['records-forms', areaRecipeKeys({ area: 'records-forms', items: [] })],
  ]);
  const HERE = 'attachments-storage';
  const item = (use) => ({ fixtures: { app: 'showcase', provisioning: { use, why: 'which clauses it unblocks' } } });
  const check = (use, from = HERE) => provisioningProblems(item(use), from, byArea);

  // ── The unqualified spelling — every one of these predates the qualifier and
  // must behave identically after it (the ruling's "existing spellings stay valid").
  t('U1 a `use` naming a recipe of this area passes', check('qa-scratch-authz').length === 0);
  t('U2 an item whose fixtures carry no provisioning is fine (optional field)', provisioningProblems({ fixtures: { app: 'showcase' } }, HERE, byArea).length === 0);
  t('U3 an item with no fixtures block at all is fine', provisioningProblems({}, HERE, byArea).length === 0);

  const dangling = check('qa-recipe-nobody-wrote');
  t('U4 a `use` no recipe answers to is flagged', dangling.length === 1 && dangling[0].includes('qa-recipe-nobody-wrote'));

  const typo = check('qa-media-constraint');
  t('U5 a TYPO of a real recipe is flagged — the drift shape review is worst at', typo.length === 1);
  t('U6 the typo message names the recipe that was meant', typo.length === 1 && typo[0].includes('did you mean `qa-media-constraints`'));
  t('U7 the message lists the recipes this area does offer', typo.length === 1 && typo[0].includes('`qa-scratch-authz`'));

  t('U8 an UNQUALIFIED key another area owns still does not resolve — the qualifier is required, not optional', check('qa-contributor-bound-member').length === 1);
  t('U9 `$comment` is an annotation, not a recipe', !keys.includes('$comment') && check('$comment').length === 1);
  t('U10 a whitespace-padded spelling does not resolve', check('qa-scratch-authz ').length === 1);
  t('U11 a provisioning block with no "use" is flagged', provisioningProblems({ fixtures: { provisioning: { why: 'because' } } }, HERE, byArea).length === 1);
  t('U12 a non-string "use" is flagged', provisioningProblems({ fixtures: { provisioning: { use: 42 } } }, HERE, byArea).length === 1);

  const noBlock = check('qa-scratch-authz', 'records-forms');
  t('U13 an area with NO fixtures block says so, rather than offering an empty list', noBlock.length === 1 && noBlock[0].includes('no area-level "fixtures" block'));
  t('U14 a fixtures block holding only annotations exposes zero recipes', areaRecipeKeys({ fixtures: { $comment: 'x' } }).length === 0);

  // ── The qualified spelling `<area>:<recipe>` (#10593 gap 2, ruled 2026-08-22).
  // This half is the whole point of the widening, so every limb is observed
  // both resolving and failing — a two-level lookup that only ever passes has
  // exactly the same signature as one that resolves everything it is handed.
  t('Q1 a qualified `use` resolves against the area it names — the ruled spelling, from the area that needs it', check('search:qa-contributor-bound-member', 'records-forms').length === 0);
  t('Q2 the same reference resolves from ANY area, not just the one worked example', check('search:qa-contributor-bound-member').length === 0);
  t('Q3 a qualified `use` may name the item\'s OWN area — one lookup, no special case', check('attachments-storage:qa-scratch-authz').length === 0);

  const badKey = check('search:qa-recipe-nobody-wrote', 'records-forms');
  t('Q4 FAILURE SHAPE 1 — a real area, a key it does not define, is flagged', badKey.length === 1);
  t('Q5 that message names the area whose block was searched, not the item\'s own', badKey.length === 1 && badKey[0].includes('area "search"'));
  t('Q6 and lists what that area does offer', badKey.length === 1 && badKey[0].includes('`qa-contributor-bound-member`'));

  const keyTypo = check('search:qa-contributor-bound-membr', 'records-forms');
  t('Q7 a typo in the RECIPE half gets a did-you-mean from the named area\'s keys', keyTypo.length === 1 && keyTypo[0].includes('did you mean `qa-contributor-bound-member`'));

  const badArea = check('serch:qa-contributor-bound-member', 'records-forms');
  t('Q8 FAILURE SHAPE 2 — an area half naming no area file is flagged', badArea.length === 1);
  t('Q9 that message says the AREA is missing, not that the recipe is', badArea.length === 1 && badArea[0].includes('no such area file') && !badArea[0].includes('is not a recipe'));
  t('Q10 and offers the area that was meant', badArea.length === 1 && badArea[0].includes('did you mean `search`'));
  t('Q11 it also names the areas that do define recipes', badArea.length === 1 && badArea[0].includes('`attachments-storage`'));

  const emptyArea = check('records-forms:qa-anything', HERE);
  t('Q12 a qualified `use` into a real area with NO recipe block says so', emptyArea.length === 1 && emptyArea[0].includes('no area-level "fixtures" block'));
  t('Q13 a qualified `use` cannot reach an annotation key either', check('search:$comment', 'records-forms').length === 1);

  // FAILURE SHAPE 3 — the reference is malformed, and says so rather than
  // sending the author to hunt for a recipe named `search:` or ``.
  const malformed = (use) => check(use, 'records-forms');
  t('Q14 two separators is a malformed reference, not a missing recipe', malformed('a:b:c').length === 1 && malformed('a:b:c')[0].includes('not a usable reference'));
  t('Q15 an empty area half is malformed', malformed(':qa-contributor-bound-member').length === 1 && malformed(':qa-contributor-bound-member')[0].includes('area half is empty'));
  t('Q16 an empty recipe half is malformed', malformed('search:').length === 1 && malformed('search:')[0].includes('recipe half is empty'));
  t('Q17 whitespace around a half is malformed — a padded name is a different string', malformed('search: qa-contributor-bound-member').length === 1 && malformed('search: qa-contributor-bound-member')[0].includes('whitespace'));

  // The upgrade that makes the drift self-correcting: an author who copied an
  // unqualified key across areas is told the exact spelling that works. Before
  // the ruling this same message said no cross-area spelling existed.
  const hinted = check('qa-contributor-bound-member');
  t('Q18 an unqualified key another area owns is told the qualified spelling to write', hinted.length === 1 && hinted[0].includes('`search:qa-contributor-bound-member`'));
  t('Q19 and is told not to fork a second copy', hinted.length === 1 && hinted[0].includes('do NOT fork a second copy'));
  const hintedEmpty = check('qa-contributor-bound-member', 'records-forms');
  t('Q20 the same hint reaches an area that has no recipe block of its own', hintedEmpty.length === 1 && hintedEmpty[0].includes('`search:qa-contributor-bound-member`'));

  provisioningReachedVerdict = true;
  return { checked, failures };
}

/**
 * The positive control for the unreferenced-recipe direction — and the one in
 * this file that carries the most weight, because its subject population on
 * the real ledger is ZERO and is expected to stay that way.
 *
 * Every other check here is exercised by the tree it validates: 207 items
 * carry ids, revisions and traps, so a checker that stopped firing would be
 * caught by the next real defect. This direction validates FOUR recipes, all
 * of them referenced, and a healthy ledger keeps them referenced — so the real
 * data can never distinguish "this direction is working" from "this direction
 * was deleted". Its green is informative only because the battery below fires
 * it on every invocation, on fixtures that are unreferenced on purpose.
 *
 * That is the same silent-success argument the trap-vocabulary block above
 * makes (#4690), sharpened: there, a broken parse needed a renamed heading to
 * go quiet; here, zero output is the CORRECT output, permanently.
 */
function selfTestUnreferencedRecipes() {
  const failures = [];
  let checked = 0;
  const t = (what, ok) => {
    checked++;
    if (!ok) failures.push(what);
  };

  // The same miniature ledger the resolve battery uses: two areas that own
  // recipes, and one that owns none (the shape 12 of 15 area files have).
  const byArea = new Map([
    ['attachments-storage', areaRecipeKeys({ fixtures: { $comment: 'the block purpose and replay rule', 'qa-scratch-authz': {}, 'qa-media-constraints': {} } })],
    ['search', areaRecipeKeys({ fixtures: { $comment: 'x', 'qa-contributor-bound-member': {} } })],
    ['records-forms', areaRecipeKeys({ area: 'records-forms', items: [] })],
  ]);
  const item = (use, extra = {}) => ({ ...extra, fixtures: { app: 'showcase', provisioning: { use, why: 'which clauses it unblocks' } } });

  // Compose the real pipeline rather than hand-building the referenced map:
  // collection and verdict are two halves of one direction, and a battery that
  // tested only the verdict would pass while collection dropped every
  // cross-area reference on the floor.
  const flag = (consumers, dangling = 0) => {
    const referenced = new Map();
    for (const [it, from] of consumers) {
      const r = referencedRecipe(it, from);
      if (!r) continue;
      if (!referenced.has(r.area)) referenced.set(r.area, new Set());
      referenced.get(r.area).add(r.recipe);
    }
    return unreferencedRecipes(byArea, referenced, dangling);
  };
  const ALL = [
    [item('qa-scratch-authz'), 'attachments-storage'],
    [item('qa-media-constraints'), 'attachments-storage'],
    [item('qa-contributor-bound-member'), 'search'],
  ];

  // ── The direction fires. This is the assertion the whole change exists for.
  const none = flag([]);
  t('R1 a recipe NO item references is flagged — the direction is not vacuous', none.length === 3);
  t('R2 every unreferenced recipe is named with the area that owns it', none.some((r) => r.area === 'search' && r.recipe === 'qa-contributor-bound-member'));

  const msg = unreferencedRecipeMessage('search', 'qa-contributor-bound-member');
  t('R3 the message names the recipe', msg.includes('"qa-contributor-bound-member"'));
  t('R4 it offers the own-area remedy', msg.includes('`"use": "qa-contributor-bound-member"`'));
  t('R5 it offers the cross-area remedy in the ruled spelling', msg.includes('`"use": "search:qa-contributor-bound-member"`'));
  t('R6 and it offers deletion — the other legitimate answer, so the fix is not read as "always add a consumer"', msg.includes('delete the recipe'));

  // ── It stays green on a healthy ledger. The other half of non-vacuity: a
  // direction that flagged a referenced recipe would red a correct tree.
  t('R7 a fully referenced ledger is clean', flag(ALL).length === 0);
  t('R8 several items sharing one recipe is not a problem — that is what a recipe is for', flag([...ALL, [item('qa-scratch-authz'), 'attachments-storage']]).length === 0);

  // ── The case the deferral was made for, now the case that proves it expired.
  // Before the qualified spelling this reference could only be prose, so this
  // recipe would have read as unreferenced and the flag would have been WRONG.
  const crossOnly = flag([[item('search:qa-contributor-bound-member'), 'records-forms'], [item('qa-scratch-authz'), 'attachments-storage'], [item('qa-media-constraints'), 'attachments-storage']]);
  t('R9 a recipe referenced ONLY from another area is not flagged — the deferral\'s reason, discharged', crossOnly.length === 0);
  t('R10 a qualified reference is credited to the area that OWNS the recipe, not the one that wrote it', flag([[item('search:qa-contributor-bound-member'), 'records-forms']]).every((r) => r.area !== 'search'));

  // ── Edge 2: retired items count. Pinned because the opposite reading is
  // superficially attractive ("a retired item is not run") and would make this
  // direction and the resolve above mutually unsatisfiable.
  const retiredConsumer = flag([[item('qa-scratch-authz', { status: 'retired' }), 'attachments-storage'], [item('qa-media-constraints'), 'attachments-storage'], [item('qa-contributor-bound-member'), 'search']]);
  t('R11 a reference from a RETIRED item still counts — its `use` must still resolve, so its recipe must still exist', retiredConsumer.length === 0);

  // ── Edge 3: suppression while the graph is broken.
  t('R12 the direction is suppressed while any `use` dangles — a typo must not also accuse the recipe it meant', flag([], 1).length === 0);
  t('R13 and it speaks again once nothing dangles', flag([], 0).length === 3);

  // ── Things that are not references.
  t('R14 an item with no provisioning block references nothing', flag([[{ fixtures: { app: 'showcase' } }, 'search']]).length === 3);
  t('R15 an item with no fixtures at all references nothing', referencedRecipe({}, 'search') === null);
  t('R16 a malformed `use` references nothing — it cannot keep a recipe alive', referencedRecipe(item('a:b:c'), 'search') === null);
  t('R17 a non-string `use` references nothing', referencedRecipe(item(42), 'search') === null);

  // ── `$`-annotations are not recipes, so they are never flagged as unreferenced.
  // Every real area block opens with one, so the opposite would red all 15 files.
  t('R18 a `$comment` is never reported unreferenced', flag(ALL).length === 0 && none.every((r) => !r.recipe.startsWith('$')));
  t('R19 an area that defines no recipes contributes nothing to flag', !none.some((r) => r.area === 'records-forms'));

  unreferencedReachedVerdict = true;
  return { checked, failures };
}

/**
 * The positive control for the `/meta` call-spelling refusal.
 *
 * This direction carries the trap-vocabulary block's silent-success burden and
 * the unreferenced-recipe block's empty-subject burden AT ONCE, which is why
 * its battery is the longest here:
 *
 *  - its authority is parsed out of another package's generated source, so a
 *    reshaped literal reads as "no plural spellings exist" and every `call`
 *    then validates clean (#4690, the direction this tree treats as worse than
 *    no check at all);
 *  - and once the ledger is repaired its subject population is ZERO and is
 *    meant to stay zero, so the real data can never again distinguish "this
 *    fires" from "this was deleted".
 *
 * The FALSE-POSITIVE half is pinned just as hard as the firing half, and
 * deliberately so: the fields beside `call` narrate the fold in plural, the
 * ledger's own canonical steps read `/meta/object/…`, and its `requires` prose
 * names the parameterized `/meta/:type/:name`. A guard that reds any of those
 * costs more than the defect it catches, so each shape is observed staying
 * silent — against the REAL corpus at the bottom, not only fixtures.
 */
function selfTestMetaCallSpelling() {
  const failures = [];
  let checked = 0;
  const t = (what, ok, detail = '') => {
    checked++;
    if (!ok) failures.push(detail ? `${what} [${detail}]` : what);
  };

  // ── The extractor reads a good literal ────────────────────────────────────
  // A miniature of the generated file, in its real shape (frozen object, typed
  // declaration, a docblock that quotes spellings in prose).
  const good = `
/** The map. Prose here says "objects" and "widgets" and must mint nothing. */
export const META_URL_TO_SINGULAR: Readonly<Record<string, string>> = Object.freeze({
  "objects": "object",
  "apps": "app",
  "sharingRules": "sharing_rule",
  "email_templates": "email_template",
${Array.from({ length: 20 }, (_, i) => `  "kind${i}s": "kind${i}",`).join('\n')}
});
export const NEIGHBOURING_MAP: Readonly<Record<string, string>> = Object.freeze({ "leaked": "leak" });
`;
  const okRead = extractMetaUrlSpellings(good);
  t('M1 a well-formed map is read without refusal', okRead.refusal === null);
  t('M2 the plural keys are what it returns', okRead.folded.includes('objects') && okRead.folded.includes('apps'));
  t('M3 camelCase spellings are read too — they fold just as much as the -s ones', okRead.folded.includes('sharingRules'));
  t('M4 snake_case spellings are read too', okRead.folded.includes('email_templates'));
  t('M5 the canonical singulars come back alongside, so the message can name the fix', okRead.canonical.includes('object') && okRead.canonical.includes('sharing_rule'));
  t('M6 prose in the docblock mints no vocabulary — comments are masked before the read', !okRead.folded.includes('widgets'));
  t('M7 a NEIGHBOURING map in the same file is not swept in — the read is bounded by the literal, not by the file', !okRead.folded.includes('leaked'));

  // Unquoted keys are the shape a generator change would most plausibly take,
  // and the one that would silently halve a quote-only regex.
  const unquoted = good.replace(/"(objects|apps)":/g, '$1:');
  const unquotedRead = extractMetaUrlSpellings(unquoted);
  t('M8 unquoted keys read identically — a quoting migration reshapes the file, it does not shrink the vocabulary', unquotedRead.refusal === null && unquotedRead.folded.includes('objects') && unquotedRead.folded.includes('apps'));

  // ── ...and REFUSES every way it can fail ──────────────────────────────────
  const refusalOf = (src) => extractMetaUrlSpellings(src).refusal;
  t('M9 a missing declaration is a refusal, not an empty vocabulary', typeof refusalOf('export const SOMETHING_ELSE = 1;') === 'string');
  t('M10 that refusal names the export it could not find', String(refusalOf('export const SOMETHING_ELSE = 1;')).includes('META_URL_TO_SINGULAR'));
  t('M11 a declaration with no object literal is a refusal', typeof refusalOf('export const META_URL_TO_SINGULAR: Readonly<Record<string, string>> = derive();') === 'string');
  t('M12 an unclosed literal is a refusal, not a partial read', typeof refusalOf('export const META_URL_TO_SINGULAR = Object.freeze({ "objects": "object",') === 'string');
  t('M13 a literal that parses to ZERO pairs is a refusal — the #4690 direction', typeof refusalOf('export const META_URL_TO_SINGULAR = Object.freeze({});') === 'string');
  t('M14 a PARTIAL parse is a refusal — the floor speaks before a shrunken authority can', typeof refusalOf('export const META_URL_TO_SINGULAR = Object.freeze({ "objects": "object", "apps": "app" });') === 'string');
  t('M15 that refusal says fix the extractor, not lower the floor', String(refusalOf('export const META_URL_TO_SINGULAR = Object.freeze({ "objects": "object" });')).includes('rather than lowering the floor'));
  const anchorless = good.replace(/"objects": "object",/, '"widgets": "widget",');
  t('M16 losing the `objects` anchor is a refusal even when the count is healthy', typeof extractMetaUrlSpellings(anchorless).refusal === 'string');
  t('M17 the anchor refusal says the extractor is reading the wrong thing', String(extractMetaUrlSpellings(anchorless).refusal).includes('anchor'));

  // ── The predicate FIRES on the class ──────────────────────────────────────
  const folded = new Set(['objects', 'apps', 'sharingRules', 'docs', 'positions']);
  const hits = (call) => foldedSpellingsInCall(call, folded);
  t('M18 the measured site is flagged — the assertion this whole block exists for',
    hits('PUT /api/v1/meta/objects/qa_nofeeds?package=com.objectstack.qa.feeds').join() === 'objects');
  t('M19 a query string is not part of the segment', hits('PUT /api/v1/meta/objects/x?package=a.b.c&overwrite=true').length === 1);
  t('M20 a plural with NO trailing path segment is still an instruction', hits('GET /api/v1/meta/objects').join() === 'objects');
  t('M21 a camelCase fold is caught — the half a trailing-`s` heuristic would miss', hits('PUT /api/v1/meta/sharingRules/x').join() === 'sharingRules');
  t('M22 the `/metadata` prefix is the same door', hits('GET /api/v1/metadata/objects/lead').join() === 'objects');
  t('M23 an address wrapped in prose is still an address — `call` is not always a bare URL',
    hits('provision the parent first: PUT /api/v1/meta/objects/qa_thing, then read it back').join() === 'objects');
  t('M24 two folded spellings in one string are both reported', hits('PUT /api/v1/meta/objects/a then PUT /api/v1/meta/apps/b').length === 2);
  t('M25 the same spelling twice is reported once', hits('PUT /api/v1/meta/objects/a then /api/v1/meta/objects/b').length === 1);

  // ── ...and stays SILENT on everything correct ─────────────────────────────
  t('M26 the canonical singular is clean — the shape the fix produces', hits('PUT /api/v1/meta/object/qa_vault?package=com.objectstack.qa.attachments').length === 0);
  t('M27 `:type` is a parameter, not a plural — the `requires` prose shape', hits('PUT /api/v1/meta/:type/:name').length === 0);
  t('M28 `{type}` is not a plural either', hits('PUT /api/v1/meta/{type}/{name}').length === 0);
  t('M29 `<type>` is not a plural either', hits('PUT /api/v1/meta/<type>/<name>').length === 0);
  t('M30 a segment that merely RESEMBLES a plural is not one — membership of the closed set decides, never a trailing `s`',
    hits('PUT /api/v1/meta/widgets/x').length === 0 && hits('GET /api/v1/meta/status').length === 0);
  t('M31 a plural OUTSIDE the /meta door is not this gate\'s business', hits('GET /api/v1/data/showcase_invoice/<id of INV-1003>').length === 0 && hits('POST /api/v1/packages').length === 0);
  t('M32 a folded word that is not a path segment is not an instruction', hits('confirm the objects list renders').length === 0);
  t('M33 `/meta` with no type segment matches nothing', hits('GET /api/v1/meta').length === 0);
  t('M34 a non-string `call` is not a crash and not a finding', foldedSpellingsInCall(undefined, folded).length === 0 && foldedSpellingsInCall(42, folded).length === 0);

  // ── The walk reads `call` and NOTHING else (ruling: `call` only) ──────────
  const doc = {
    area: 'demo',
    fixtures: {
      $comment: 'a plural here is narration: PUT /api/v1/meta/objects/x',
      'qa-recipe': {
        requires: ['PUT /api/v1/meta/:type/:name is capability-gated'],
        why: 'the plural door /api/v1/meta/objects/x was a hole around the singular lock',
        sequence: [
          { step: 1, call: 'POST /api/v1/packages' },
          {
            step: 2,
            call: 'PUT /api/v1/meta/objects/qa_thing?package=a.b',
            expect: 'the old /api/v1/meta/objects/x spelling answered 200',
            source: 'retired in #9180: /api/v1/meta/objects/:name/state/:field',
          },
        ],
      },
    },
    items: [{ id: 'demo.probe', steps: ['x'], verify: { call: 'GET /api/v1/meta/apps/showcase' } }],
  };
  const found = collectCalls(doc);
  t('M35 every `call` is collected, at any depth', found.length === 3);
  t('M36 an AREA-LEVEL recipe step is reached — where every call on the real ledger lives today', found.some((c) => c.path === 'fixtures.qa-recipe.sequence[0].call'));
  t('M37 an ITEM-level `call` is reached too — the path a curated list would miss tomorrow', found.some((c) => c.call === 'GET /api/v1/meta/apps/showcase'));
  t('M38 an item renders by its id, not its ordinal', found.some((c) => c.path === 'items[demo.probe].verify.call'));

  const docHits = found.flatMap((c) => foldedSpellingsInCall(c.call, folded).map((s) => ({ ...c, s })));
  t('M39 the document\'s two folded calls are both flagged', docHits.length === 2);
  // The ruling, asserted where it is decided — at COLLECTION. Each of these
  // fields carries a plural spelling in the fixture above, on purpose; a walk
  // that read them would have flagged all four, and every one would be wrong.
  const read = found.map((c) => c.call);
  t('M40 only `call` is ever collected', found.every((c) => c.path.endsWith('.call')));
  t('M41 `why` narrating the plural door is never read', !read.some((c) => c.includes('was a hole')));
  t('M42 `expect` narrating what the old spelling answered is never read', !read.some((c) => c.includes('answered 200')));
  t('M43 `source` citing a retired plural registration is never read', !read.some((c) => c.includes('#9180')));
  t('M44 `requires` prose naming the parameterized `/meta/:type/:name` is never read', !read.some((c) => c.includes('capability-gated')));
  t('M44b a `$comment` annotation is never read', !read.some((c) => c.includes('narration')));

  // ── The message a reader actually gets ────────────────────────────────────
  const msg = foldedCallMessage('fixtures.qa-recipe.sequence[1].call', 'PUT /api/v1/meta/objects/x', 'objects', 'object');
  t('M45 the message names where the string lives', msg.includes('fixtures.qa-recipe.sequence[1].call'));
  t('M46 it names the canonical spelling to write, not just the offence', msg.includes('/meta/object/'));
  t('M47 it says the step answers 200 today — why nothing else catches this', msg.includes('200'));
  t('M48 it carries the fence: the fold is not being narrowed', msg.includes('NOT the defect'));

  // ── The LIVE contract, not a fixture ──────────────────────────────────────
  // Everything above proves the machinery. These prove it is pointed at the
  // real thing — the seam the fixtures cannot see, and the one that rots.
  const live = existsSync(META_URL_DATA_FILE) ? extractMetaUrlSpellings(readFileSync(META_URL_DATA_FILE, 'utf8')) : { refusal: 'the generated spec module is missing', folded: [], canonical: [] };
  t('M49 the LIVE generated module is readable — this gate is pointed at the real contract', live.refusal === null, live.refusal ?? '');
  t('M50 the live vocabulary is non-trivial', live.refusal === null && live.folded.length >= META_URL_SPELLING_FLOOR, live.refusal === null ? `${live.folded.length} spellings` : '');
  t('M51 the live vocabulary carries the anchor', live.folded.includes(META_URL_ANCHOR));
  t('M52 the live map is a bijection-free lookup: no folded spelling is ALSO a canonical singular — so the refusal can never fire on a canonical `/meta/<type>` segment',
    live.refusal === null && !live.folded.some((f) => live.canonical.includes(f)));

  metaCallReachedVerdict = true;
  return { checked, failures };
}

// ── Line citations ─ ONE grammar, reached by the SAME registration ─────────
//
// An item's `source` (and the prose beside it) is the evidence pointer a later
// runner uses to decide whether the item still describes reality. This ledger
// used to pin those pointers at `file:line` — and a line number is the ONE part
// of a citation that rots on an edit the citation has nothing to do with: two
// TSDoc blocks widening in the cited file shift every symbol below them, and
// every pinned line silently starts naming something else. Nothing resolved a
// citation, so the rot was exit-0 by construction: the pointer keeps reading as
// "verified against source" while pointing somewhere else, which is strictly
// worse than no pointer at all. The whole class was stripped (#13482 → #13786),
// and what remains is keeping it from coming back.
//
// ⛔ THERE IS NO DETECTOR HERE ANY MORE, and its absence is the deliverable
// (#18592). It used to be `SOURCE_LINE_CITATION` / `findSourceLineCitations`
// plus a family-file loop of their own — a SECOND grammar for the same rule,
// beside the shared one the symbol-anchor limb had already moved to at #18107.
// The two had drifted in BOTH directions, each recognising spellings the other
// did not, and neither could see it: two graders, two greens, one rule.
//
// ⭐ The direction is the 2026-09-01 ruling written in the shared core's own
// header, verbatim: 「⛔ Do not fork this file for a second corpus; if a corpus
// needs behaviour this core lacks, **widen the core**」and「Two copies of that
// rule drift, and they drift **SILENTLY**」. So the core was widened, and the
// five spelling classes that were this file's alone went with it:
//
//   the bare colon continuation      `ManifestSchema id :140 and version :202`
//   the parenthesised bare form      `holds ONLY auditor (:395)`
//   the `~:` approximation           `computeAuthGate ~:5084-5160`
//   the `L` line pin                 `registerRecordShareEndpoints ~L7246-7331`
//   the `html` extension             a citation into a template page
//
// The first four are the corpus declaration `pathlessLineCitations` and the
// approximation tilde now admitted inside the colon form; the fifth is a row in
// the shared anchorable vocabulary. The verdict a citation gets is unchanged in
// every case — this is a FOLD, not a re-grading — and the direction the fold
// moved in the OTHER sense is a strict gain: the shared grammar already caught
// the tilde bare-number form, the comma continuation and five extensions this
// file's grammar was blind to, and those now reach this corpus too.
//
// What this limb owes now is exactly what the symbol-anchor limb owes: that
// THIS corpus reaches that one grammar, declares what it needs from it, and
// carries none of its own. `selfTestLineCitationBinding` below is that, driven
// live in both directions on a synthetic corpus — the citation is a finding
// with the declaration, and is not one without it.

/**
 * ⛔ NOT a grammar, and not a detector — the two things this limb used to be.
 * Every spelling case that lived here moved into
 * `scripts/symbol-anchors.mjs`'s own battery, firing rows and silent
 * neighbours alike. ⭐ A case is not deleted by moving; it is deleted by
 * stopping. What is owed here is the BINDING: that this corpus reaches the one
 * grammar, declares from it what its data shape needs, and carries none of its
 * own — driven in BOTH directions, because a case that only ever says "found"
 * cannot tell a working declaration from a text that would have matched
 * anyway.
 */
function selfTestLineCitationBinding() {
  const failures = [];
  let checked = 0;
  const t = (what, ok, note = '') => {
    checked++;
    if (!ok) failures.push(`${what}${note ? ` — ${note}` : ''}`);
  };
  const OWN_SOURCE = readFileSync(new URL(import.meta.url).pathname, 'utf8');

  // ── the DECLARATION, and no grammar behind it ────────────────────────────
  t('D1 the corpus DECLARES its path-less citations — this ledger continues a filename it has already named, and without the declaration the shared grammar requires a path',
    CORPUS.pathlessLineCitations === true);
  /* ⚠️ NAME-BASED and PREFIX-matched, exactly as V2 below: a fork under a
   * nearby name is a fork. The residual gap is the same one and is stated
   * rather than papered over — a grammar under a name sharing none of these
   * tokens is invisible here, which is why D3 keeps the READ honest. */
  const noLocal = (name) => !new RegExp(`\\b(?:const|let|var)\\s+${name}\\w*\\s*=`).test(OWN_SOURCE);
  t('D2 this gate defines NO line-citation grammar of its own — no citation regex, no detector, no family loop of its own',
    noLocal('SOURCE_LINE_CITATION') && noLocal('LINE_CITATION') && noLocal('LINE_ANCHOR')
      && !/\bfunction\s+findSourceLineCitations\w*\b/.test(OWN_SOURCE)
      && !/\bfunction\s+findLineCitations\w*\b/.test(OWN_SOURCE));
  t('D3 CONTROL for D2 — the same source read DOES find the declaration, so a green above is "no fork" and not "the read returned nothing"',
    /pathlessLineCitations:\s*true/.test(OWN_SOURCE) && /sweepCorpus\(CORPUS, ROOT\)/.test(OWN_SOURCE));

  // ── the binding, BOTH DIRECTIONS on the SAME text ────────────────────────
  //
  // ⭐ The declaration is read off `CORPUS` rather than written as a literal,
  // so deleting it from the registration fails B1 instead of leaving a case
  // that passes on a flag nothing reads.
  const declared = { unspannedAnchors: CORPUS.unspannedAnchors, pathlessLineCitations: CORPUS.pathlessLineCitations };
  const cited = 'ManifestSchema id :140 and the leg ~L7246-7331';
  t('B1 ON — a path-less citation in THIS ledger’s shape is read as a line anchor by the shared grammar, through the declarations this corpus makes',
    extractAnchors(cited, declared).lineAnchors.length === 2,
    JSON.stringify(extractAnchors(cited, declared).lineAnchors.map((l) => l.raw)));
  t('B2 OFF — the SAME text is not read without the declaration, so B1 is the declaration doing the work and not a text that would have matched anyway',
    extractAnchors(cited, { unspannedAnchors: CORPUS.unspannedAnchors }).lineAnchors.length === 0);
  t('B3 DARK — a citation BOTH grammars already agreed on keeps its verdict, with the declaration and without it: the fold re-grades nothing that was already judged',
    extractAnchors('a pin at packages/spec/src/kernel/x.zod.ts:158 here', declared).lineAnchors.length === 1
      && extractAnchors('a pin at packages/spec/src/kernel/x.zod.ts:158 here', {}).lineAnchors.length === 1);
  /* ⛔ The over-firing direction, which is the whole risk of admitting a
   * citation that carries no path: THIS ledger is dense with colon-then-digit
   * text that is not a pin. One case, not a battery — every one of these is
   * pinned by name beside the grammar, and repeating them here would be the
   * second copy this card exists to delete. */
  t('B4 the neighbours this ledger is full of stay silent under the declaration — an HTTP status, a config literal, a URL port, a clock time and JSON quoted in prose',
    extractAnchors('status:409 {maxRetries:3} http://localhost:3000/_console/ 08:00 {"scannedTypes":1}', declared).lineAnchors.length === 0);

  // ── the LIVE reading, so the zero above the console line prints is a
  //    reading and not an instrument that stopped ──────────────────────────
  const liveSweep = sweepCorpus(CORPUS, ROOT);
  const liveLineAnchors = liveSweep.findings.filter((f) => f.kind === 'line-anchor');
  t('B5 the live family carries NO line citation — the class the migration deleted has not come back',
    liveLineAnchors.length === 0,
    liveLineAnchors.map((f) => `${f.doc}:${f.line} ${f.raw}`).join(', '));
  t('B6 CONTROL for B5 — the same sweep over the same family DID read anchors, so the zero above is a reading and not a sweep that reached nothing',
    liveSweep.counts.anchors > 0, `${liveSweep.counts.anchors} anchor(s)`);

  lineCitationsReachedVerdict = true;
  return { failures, checked };
}

// ── Symbol anchors ──────────────────────────────────────────────────────────
//
// The other half of the citation story, and the half the `:NNN` strip
// deliberately deferred (#13482 → step (1) PR #13786 → this, #13788).
//
// After step (1) a citation is `file` plus the symbol it lands in — a pointer
// that does not rot on an unrelated edit. But nothing RESOLVED it: a symbol
// renamed or deleted out of the cited file left the citation reading exactly
// as it did the day it was verified. That is the same exit-0-by-construction
// shape the line numbers had, one level up — a pointer that says "verified
// against source" while naming something the source no longer contains.
//
// The mechanism is the one already in this gate. `enumSource {file, export,
// expect}` resolves a structured pin against real source (file exists, export
// present, member count current). A symbol anchor is that pin's cheap sibling,
// spelled INLINE so it can live where the citations already live:
//
//     packages/core/src/security/platform-admin.ts#parsePlatformAdminEmails
//
// i.e. a repo-relative path, `#`, and the symbol. The prose around it is
// untouched — a citation carries its reason, and a rewrite into a bare object
// per citation would have thrown that away across the whole ledger.
//
// ## What "the symbol is there" means here — NOT THIS FILE'S CALL (#16898)
//
// It is `scripts/symbol-anchors.mjs#symbolResolutionClass`'s call, and that is
// the whole point. This gate used to answer the question itself, with a token
// match: mask comments, then ask whether the bare token appears anywhere in the
// file. That was a SECOND implementation of the resolution rule, in the place
// the #13556 ruling this module's header quotes says there is to be exactly
// one — and it was the LOOSER of the two, which is the dangerous direction: a
// second resolver that is greener than the shared one is never the resolver
// anybody points at, so the drift only ever gets discovered by census.
//
// Measured on the ledger at the moment of binding: of 633 anchor occurrences
// the permissive rule resolved all 633, and the shared resolver resolves 577
// (516 `declaration`, 61 `literal`). The 56 it refuses are the coverage this
// checklist was reporting and did not have; they are enumerated, one per
// (family file, anchor), in `SHARED_RESOLVER_RESIDUAL` below.
//
// The shared rule, restated only so far as a reader here needs it — the
// authority is that module's own `## THE RESOLUTION RULE` block, ⛔ never this
// paragraph:
//
//   - comments are stripped before anything is matched, so a symbol surviving
//     only in a COMMENT is ABSENT. Prose about a symbol is not a symbol. (That
//     half is unchanged; it is the only half the old rule had right.)
//   - `declaration` — a declaration site in the target's own language, which
//     for a `.json` target means a KEY and never a value.
//   - `literal` — a COMPLETE quoted string token (`'sys_metadata'`). This is
//     what keeps the ledger's DATA identifiers (capability names, error codes,
//     `sys_*` machine names) anchorable. ⚠️ COMPLETE: a symbol that is only a
//     SUBSTRING of a longer string — `saveItem` inside `'meta.saveItem'`,
//     `:shareId` inside a route pattern — does not resolve, and that refusal
//     is most of the 56.
//   - a CALL SITE, an IMPORT and a LOCAL PARAMETER are none of those, so they
//     do not resolve. A citation whose symbol survives only that way is naming
//     a file that uses the symbol, not the file that declares it.
//
// ⛔ Do NOT answer any of this locally again, and ⛔ do not widen the shared
// core to make a checklist citation green: the core is shared with the ADR,
// `scripts/**`, `packages/spec/src/**` and system-context corpora, and widening
// it here would export this defect to all four. An anchor the core refuses is
// either a bad citation (re-point it) or a case for widening the core, and the
// second is its own card against `scripts/symbol-anchors.mjs`.
//
// ## Why anchors are not authored on every citation
//
// Citations that name a sibling repo, a document, or a file with no symbol
// worth naming stay BARE — a bare citation is honest, and this check is not
// the place to force one into a shape it does not have. The floor below is what
// keeps that door from swinging the other way.
//
// ⭐ THE CORPUS REGISTRATION (#18107) — and why this file now holds no
// grammar of its own.
//
// #16898 (PR #18100) bound the VERDICT to the shared resolver. It left the
// DETECTOR forked, and the 2026-09-01 ruling this gate's resolver reproduces is
// explicit that the two halves travel together: a corpus joins by REGISTRATION,
// and 「if a corpus needs behaviour this core lacks, **widen the core**」.
//
// The fork was not inert. Measured on `main` at `4bd2c60e81`, two constants
// named `ANCHORABLE_EXTENSIONS` existed in this tree, one module importing the
// other, with different contents: the shared one carried 23 extensions and the
// private one 8 — a strict subset. And an extension outside the private set was
// not SKIPPED here, it was a hard ERROR, so the same anchor spelling was a
// resolved anchor in one governed corpus and a refusal in another. That is
// precisely 「each gate stays green on its own corpus while meaning something
// different by "resolves"」. The detector had drifted a second way too: the
// shared extractor skips code fences and honours `anchor-exempt` markers, and
// the private `matchAll` did neither.
//
// ⚠️ Registering needed the core widened, which is the ruling's own exit and
// ⛔ NOT a widening of the RESOLUTION RULE — the thing #18100's error text
// forbids widening, and still forbids. Two different surfaces:
//
//   * what counts as the symbol being PRESENT in the cited file — unchanged,
//     and ⛔ nothing here may loosen it to clear a red;
//   * how a citation is WRITTEN and which documents are swept — corpus data,
//     and that is what was widened.
//
// Three declarations this corpus needed and the core did not have:
//
//   `unspannedAnchors: true`  Every citation here lives inside a JSON string
//       value, where a backtick is payload rather than a code span. Measured
//       before registration: the private detector found 634 anchors where the
//       spanned grammar found 8. That 626-anchor gap — not the `runs/` walker —
//       is what had kept this corpus forked.
//   `excludeDirs: ['runs']`   `docPattern` is a regex on the BASENAME and
//       cannot see a directory, so "the family MINUS `runs/`" had no spelling.
//       Run records are outputs; see `familyFiles` above.
//   `pathlessLineCitations: true`  (#18592) This ledger writes a second pointer
//       into a file it has already named — `ManifestSchema id :140 and version
//       :202` — and an `L` pin beside it. Both carry NO path of their own, and
//       both were the last thing this file still detected with a grammar of its
//       own. ⛔ Default OFF everywhere else, and that is a measurement rather
//       than caution: in PROSE a colon before digits is punctuation, so the two
//       spellings turned on there admit ports, scenario labels and docblock
//       back-references, and in the PROJECTED corpora that population was
//       re-measured to buy unjudged residual and NOT ONE finding an author
//       could act on. In DATA, beside the filename they continue, they are
//       line pins.
//
//       ⛔ That measurement is CITED from here and no longer RESTATED here
//       (#18913). The corpus-wide tally this entry used to carry was a
//       RAW-REGEX count, and the re-take named it void: it subtracted neither
//       the fenced blocks the extractor skips nor the citations the
//       path-anchored passes had already recorded, so it overstated what the
//       option admits by about a half. ⭐ Retyping the corrected figure here
//       would rot the same way, because a reading is a count plus the tree it
//       was taken against and this entry never carried a tree — so the reading
//       stays with the grammar that admits the two spellings,
//       `scripts/symbol-anchors.mjs#PATHLESS_COLON_CITATION`, where the re-take
//       names its own tree. That anchor is resolved on every PR by
//       `check:scripts-symbol-anchors`; a digit is gated by nothing. Re-take it
//       THERE.
//
//       ⭐ And what makes THIS declaration legal is not a cost reading at all:
//       `scripts/symbol-anchors.mjs#defineCorpus` REFUSES the option to any
//       corpus declaring a `docProjection` (#18845), at registration. A
//       projection is a corpus saying its judged text is authored PROSE; this
//       one declares none and sweeps its documents raw. That test is
//       mechanical, and this registration passes it.
//
// The dotted `#Outer.member` form this ledger's grammar carried is now the
// shared grammar's, and `sweepCorpus` requires EVERY segment to resolve — the
// capability moved into the core rather than being dropped with the fork.
/* ⛔ NOT exported, and that is `scripts/check-entry-guard.mjs`'s rule rather
 * than a style choice: this file's top level RUNS the gate, so a single export
 * would make it importable for that binding and run the whole gate — including
 * its `process.exit` — inside the importer. The sibling corpus gates export
 * their `CORPUS` because their dispatch sits behind `isEntrypoint`; this one's
 * does not, and nothing outside reads this corpus. */
const CORPUS = defineCorpus({
  id: 'platform-checklist',
  label: 'the standing platform test checklist (docs/qa/platform-checklist)',
  docRoots: [CHECKLIST_REL],
  docPattern: /\.(json|md)$/,
  excludeDirs: ['runs'],
  unspannedAnchors: true,
  pathlessLineCitations: true,
});

// ── The residual the binding measured (#16898) ────────────────────────
//
// Binding this corpus to the shared resolver withdrew a permissive match, and
// withdrawing it is the DELIVERABLE, not a regression: 56 of 633 anchor
// occurrences stopped resolving. That population was coverage this checklist
// reported and did not have, and it is carried here — named, one row per
// (family file, anchor) — rather than absorbed by a rule or by a lowered floor.
//
// ⚠️ Read what this list IS before adding to it. It is a CLOSED LEDGER, not a
// rule and not an allow-list with a shape:
//
//   - every row must FIRE. A row whose anchor resolves again (repaired) or has
//     gone (re-authored) is a RED that names the row and asks for its deletion,
//     so the ledger cannot outlive the defect it records and cannot quietly
//     accumulate dead weight that would excuse a future anchor by accident.
//   - an anchor that fails to resolve and is NOT on this list is an ordinary
//     ABSENT SYMBOL red. New bad citations cannot join silently; joining is a
//     visible diff in a reviewed file.
//   - so the ledger is SHRINK-ONLY in practice and exact in principle, and
//     `SHARED_RESOLVER_RESIDUAL_CEILING` beside it pins the other direction.
//   - ⛔ it is NOT a place to route an inconvenient red. Rows leave by repair.
//
// `shape` records HOW the withdrawn rule used to resolve the anchor — the
// reading, so the repair does not have to be re-derived:
//
//   string-substring   the symbol survives only INSIDE a longer string token:
//                      `saveItem` in `client: 'meta.saveItem'`, `:shareId` in a
//                      route pattern, a name inside an `it(...)` title or a
//                      `.describe(...)` sentence. 29 rows, the largest class.
//   import-only        the cited file IMPORTS the symbol; the declaration is in
//                      another file. 9 rows.
//   member-access      the symbol survives only as `x.symbol` on some other
//                      object — `manifest.objectExtensions`. 3 rows.
//   json-value-not-key the `.json` target carries the symbol as a VALUE; the
//                      shared rule reads JSON KEYS. 3 rows.
//   regex-literal      the symbol survives only inside a regex literal. 1 row.
//   local-binding      a parameter name, plus a hyphenated string that shares
//                      the token. 1 row.
//   detector-artifact  ⭐ not a citation at all: THIS gate's own anchor detector
//                      truncated an item-id reference at its first hyphen and
//                      produced a phantom `#access`, which the permissive rule
//                      then resolved against the spelling `access-security`.
//                      1 row — the sharpest single illustration of what a
//                      looser second resolver buys.
//
// `verdict` is the classification #16898's acceptance asks for, and there are
// exactly two:
//
//   bad-citation  (47 rows) the anchor names a symbol the cited file does not
//                 declare. The repair is in the LEDGER: re-point the anchor at
//                 what the file carries, or drop to a bare citation. ⚠️ Dropping
//                 costs the file an anchor and most floors have no headroom, so
//                 re-pointing is the route and the sizing is its own card.
//   accept-set    (8 rows) the anchor names something real that the SHARED
//                 resolver's accept set does not reach — an object-literal key
//                 written INLINE rather than at the start of a line (6), and a
//                 DATA identifier that is the head segment of a dotted string
//                 token, `sys_user` in `'sys_user.actions.invite_user'` (2).
//                 ⛔ THAT IS A DIFFERENT CARD, against
//                 `scripts/symbol-anchors.mjs`, and ⛔ nothing here may widen
//                 the core to reach them: it is shared with four other corpora
//                 and widening it would export this defect to all of them.
const SHARED_RESOLVER_RESIDUAL = Object.freeze([
  { doc: 'areas/access-security.json', anchor: 'packages/rest/src/rest-route-ledger.ts#saveItem', shape: 'string-substring', verdict: 'bad-citation' },
  { doc: 'areas/access-security.json', anchor: 'packages/rest/src/rest-route-ledger.ts#shareId', shape: 'string-substring', verdict: 'bad-citation' },
  { doc: 'areas/ai.json', anchor: 'packages/mcp/src/plugin.ts#OS_MCP_SERVER_ENABLED', shape: 'string-substring', verdict: 'bad-citation' },
  { doc: 'areas/ai.json', anchor: 'packages/runtime/src/domains/ai.ts#capabilityUnavailable', shape: 'import-only', verdict: 'bad-citation' },
  { doc: 'areas/api-backend.json', anchor: 'packages/rest/src/rest-route-ledger.ts#REST', shape: 'string-substring', verdict: 'bad-citation' },
  { doc: 'areas/api-backend.json', anchor: 'packages/runtime/src/route-ledger.ts#getLegalNextStates', shape: 'string-substring', verdict: 'bad-citation' },
  { doc: 'areas/api-backend.json', anchor: 'packages/triggers/trigger-api/src/trigger-api-route-ledger.ts#flowName', shape: 'string-substring', verdict: 'bad-citation' },
  { doc: 'areas/approvals.json', anchor: 'examples/app-showcase/src/security/seed-approval-demo.ts#AUDITOR_DEMO_USER', shape: 'import-only', verdict: 'bad-citation' },
  { doc: 'areas/attachments-storage.json', anchor: 'packages/spec/liveness/field.json#live', shape: 'json-value-not-key', verdict: 'bad-citation' },
  { doc: 'areas/automation.json', anchor: 'examples/app-showcase/objectstack.config.ts#ConnectorRestPlugin', shape: 'import-only', verdict: 'bad-citation' },
  { doc: 'areas/automation.json', anchor: 'packages/runtime/src/route-ledger.ts#getRuntimeStatus', shape: 'string-substring', verdict: 'bad-citation' },
  { doc: 'areas/automation.json', anchor: 'packages/runtime/src/route-ledger.ts#getScreen', shape: 'string-substring', verdict: 'bad-citation' },
  { doc: 'areas/automation.json', anchor: 'packages/runtime/src/route-ledger.ts#runId', shape: 'string-substring', verdict: 'bad-citation' },
  { doc: 'areas/cli.json', anchor: 'packages/cli/src/commands/compile.ts#emitJson', shape: 'import-only', verdict: 'bad-citation' },
  { doc: 'areas/cli.json', anchor: 'packages/cli/src/commands/doctor-deprecation-hint-commands.test.ts#Doctor', shape: 'import-only', verdict: 'bad-citation' },
  { doc: 'areas/cli.json', anchor: 'packages/cli/src/utils/format.exit-code.test.ts#emitJson', shape: 'import-only', verdict: 'bad-citation' },
  { doc: 'areas/cli.json', anchor: 'packages/create-objectstack/src/templates/blank/package.json#objectstack', shape: 'json-value-not-key', verdict: 'bad-citation' },
  { doc: 'areas/cli.json', anchor: 'packages/verify/src/verify.ts#VALIDATION_FAILED', shape: 'regex-literal', verdict: 'bad-citation' },
  { doc: 'areas/dashboards.json', anchor: 'examples/app-showcase/src/data/seed/index.ts#sales_region', shape: 'inline-key', verdict: 'accept-set' },
  { doc: 'areas/dashboards.json', anchor: 'examples/app-showcase/src/data/seed/index.ts#signed_on', shape: 'inline-key', verdict: 'accept-set' },
  { doc: 'areas/identity-auth.json', anchor: 'docs/qa/platform-checklist/areas/access-security.json#access', shape: 'detector-artifact', verdict: 'bad-citation' },
  { doc: 'areas/identity-auth.json', anchor: 'examples/app-showcase/src/security/seed-approval-demo.ts#PHONE_DEMO_USER', shape: 'import-only', verdict: 'bad-citation' },
  { doc: 'areas/identity-auth.json', anchor: 'packages/platform-objects/src/identity/sys-member.object.ts#BUILTIN_MEMBERSHIP_ROLE_OPTIONS', shape: 'import-only', verdict: 'bad-citation' },
  { doc: 'areas/identity-auth.json', anchor: 'packages/platform-objects/src/identity/sys-oauth-application.object.ts#OAuth', shape: 'string-substring', verdict: 'bad-citation' },
  { doc: 'areas/identity-auth.json', anchor: 'packages/plugins/plugin-auth/src/auth-route-ledger.ts#bootstrapStatus', shape: 'string-substring', verdict: 'bad-citation' },
  { doc: 'areas/identity-auth.json', anchor: 'packages/plugins/plugin-auth/src/auth-route-ledger.ts#linkSocial', shape: 'string-substring', verdict: 'bad-citation' },
  { doc: 'areas/identity-auth.json', anchor: 'packages/plugins/plugin-auth/src/auth-route-ledger.ts#revokeOthers', shape: 'string-substring', verdict: 'bad-citation' },
  { doc: 'areas/identity-auth.json', anchor: 'packages/plugins/plugin-auth/src/auth-route-ledger.ts#sendVerificationEmail', shape: 'string-substring', verdict: 'bad-citation' },
  { doc: 'areas/identity-auth.json', anchor: 'packages/plugins/plugin-auth/src/auth-route-ledger.ts#setActive', shape: 'string-substring', verdict: 'bad-citation' },
  { doc: 'areas/identity-auth.json', anchor: 'packages/plugins/plugin-auth/src/auth-route-ledger.ts#updateUser', shape: 'string-substring', verdict: 'bad-citation' },
  { doc: 'areas/identity-auth.json', anchor: 'packages/plugins/plugin-security/src/security-plugin.ts#__referentialFieldClear', shape: 'member-access', verdict: 'bad-citation' },
  { doc: 'areas/identity-auth.json', anchor: 'packages/qa/dogfood/test/membership-role-vocabulary.dogfood.test.ts#PermissionSet', shape: 'string-substring', verdict: 'bad-citation' },
  { doc: 'areas/identity-auth.json', anchor: 'packages/rest/src/rest-route-ledger.ts#describeDelegableScope', shape: 'string-substring', verdict: 'bad-citation' },
  { doc: 'areas/identity-auth.json', anchor: 'packages/spec/src/kernel/public-auth-features.ts#sys_invitation', shape: 'dotted-string-head', verdict: 'accept-set' },
  { doc: 'areas/identity-auth.json', anchor: 'packages/spec/src/kernel/public-auth-features.ts#sys_user', shape: 'dotted-string-head', verdict: 'accept-set' },
  { doc: 'areas/integration-system.json', anchor: 'examples/app-showcase/objectstack.config.ts#declarativeStdio', shape: 'inline-key', verdict: 'accept-set' },
  { doc: 'areas/integration-system.json', anchor: 'examples/app-showcase/src/system/datasources/showcase-external.datasource.ts#onMismatch', shape: 'inline-key', verdict: 'accept-set' },
  { doc: 'areas/integration-system.json', anchor: 'packages/services/service-messaging/src/messaging-service.ts#PreferenceResolver', shape: 'import-only', verdict: 'bad-citation' },
  { doc: 'areas/integration-system.json', anchor: 'packages/spec/liveness/email_template.json#requireVars', shape: 'json-value-not-key', verdict: 'bad-citation' },
  { doc: 'areas/platform-core.json', anchor: 'packages/objectql/src/engine.ts#objectExtensions', shape: 'member-access', verdict: 'bad-citation' },
  { doc: 'areas/platform-core.json', anchor: 'packages/plugins/plugin-auth/src/auth-plugin.ts#Providers', shape: 'string-substring', verdict: 'bad-citation' },
  { doc: 'areas/platform-core.json', anchor: 'packages/qa/dogfood/test/package-first-authoring.dogfood.test.ts#writable_package_required', shape: 'string-substring', verdict: 'bad-citation' },
  { doc: 'areas/platform-core.json', anchor: 'packages/runtime/src/domains/notifications.ts#markRead', shape: 'member-access', verdict: 'bad-citation' },
  { doc: 'areas/platform-core.json', anchor: 'packages/runtime/src/route-ledger.ts#commitId', shape: 'string-substring', verdict: 'bad-citation' },
  { doc: 'areas/records-forms.json', anchor: 'examples/app-showcase/src/data/objects/business-unit.object.ts#allowCreate', shape: 'inline-key', verdict: 'accept-set' },
  { doc: 'areas/records-forms.json', anchor: 'examples/app-showcase/src/data/seed/index.ts#Specimen', shape: 'string-substring', verdict: 'bad-citation' },
  { doc: 'areas/records-forms.json', anchor: 'examples/app-showcase/src/ui/actions/index.ts#maxSize', shape: 'inline-key', verdict: 'accept-set' },
  { doc: 'areas/records-forms.json', anchor: 'packages/lint/src/validate-action-locations.ts#action', shape: 'local-binding', verdict: 'bad-citation' },
  { doc: 'areas/records-forms.json', anchor: 'packages/rest/src/rest-route-ledger.ts#jobId', shape: 'string-substring', verdict: 'bad-citation' },
  { doc: 'areas/records-forms.json', anchor: 'packages/spec/src/data/object.zod.ts#FEEDS_DISABLED', shape: 'string-substring', verdict: 'bad-citation' },
  { doc: 'areas/records-forms.json', anchor: 'packages/spec/src/data/object.zod.ts#query', shape: 'string-substring', verdict: 'bad-citation' },
  { doc: 'areas/studio-authoring.json', anchor: 'packages/objectql/src/overlay-precedence.test.ts#not_overridable', shape: 'string-substring', verdict: 'bad-citation' },
  { doc: 'areas/studio-authoring.json', anchor: 'packages/rest/src/meta-write-actor-identity.test.ts#Actor', shape: 'string-substring', verdict: 'bad-citation' },
  { doc: 'areas/studio-authoring.json', anchor: 'packages/rest/src/rest-route-ledger.ts#getHistory', shape: 'string-substring', verdict: 'bad-citation' },
  { doc: 'areas/studio-authoring.json', anchor: 'packages/rest/src/rest-route-ledger.ts#REST', shape: 'string-substring', verdict: 'bad-citation' },
]);

// Grow-never. The ledger above is exact (every row fires, nothing else may
// fail), so this is the belt on the braces: a silent append — the one edit that
// would turn a closed ledger back into a permissive rule, one row at a time —
// refuses here rather than validating.
const SHARED_RESOLVER_RESIDUAL_CEILING = 55;

const residualKey = (doc, anchor) => `${doc}::${anchor}`;
const SHARED_RESOLVER_RESIDUAL_INDEX = new Map(
  SHARED_RESOLVER_RESIDUAL.map((r) => [residualKey(r.doc, r.anchor), r]),
);

// ── The anchor floor ────────────────────────────────────────────────────────
//
// A resolver nobody can dodge is a resolver whose subject population cannot be
// emptied. Every red this check prints has a second, silent remedy: delete the
// `#symbol` half and the citation drops back to prose this gate does not read.
// The floor closes that door — per family file, the count of anchors that
// RESOLVED, shrink-never. Adding anchors is ordinary work and must not red.
//
// It is also the answer to the failure this whole file is built around: a
// check whose population reaches zero prints the same green it printed before
// it existed. The floor makes the green say a number.
const ANCHOR_FLOOR_FILE = join(ROOT, 'scripts/checklist-symbol-anchor-baseline.json');

// DELETING a floor entry silences that file exactly as effectively as zeroing
// it, so the roster's own size is pinned too — the `SELF_TEST_BATTERY_FLOOR`
// reasoning, applied to the other registry in this gate.
const ANCHOR_FLOOR_ROSTER_FLOOR = 15;

/**
 * @param {Map<string, number>} counts family file -> anchors that resolved
 * @param {Record<string, number>} floors the baseline's `floors` block
 * @returns {Array<{file: string, message: string}>}
 */
function anchorFloorProblems(counts, floors) {
  const problems = [];
  for (const [rel, n] of counts) {
    if (n === 0) continue;
    if (!(rel in floors)) {
      problems.push({
        file: rel,
        message:
          `${n} symbol anchor(s) resolve here but scripts/checklist-symbol-anchor-baseline.json declares no floor for this file.`
          + ' Add the entry at the count measured now — an undeclared file can be emptied of anchors without this gate noticing, which is the dodge the floor exists to close.',
      });
    }
  }
  for (const [rel, floor] of Object.entries(floors)) {
    const n = counts.get(rel);
    if (n === undefined) {
      problems.push({
        file: rel,
        message:
          `scripts/checklist-symbol-anchor-baseline.json declares a floor of ${floor} for this file, but it is not in the checklist family any more.`
          + ' A floor on a file nobody reads is a floor nothing can breach — drop the entry in the same edit that removed the file.',
      });
      continue;
    }
    if (n < floor) {
      problems.push({
        file: rel,
        message:
          `SYMBOL ANCHORS LOST — ${n} anchor(s) resolve here but the floor is ${floor}.`
          + ' A citation that gives up its `#symbol` half stops being resolvable by anything, so the count is shrink-never: restore the anchor, or re-author the citation with a symbol this gate can resolve.'
          + ' ⛔ MAINTAINER-ONLY: lowering a floor in scripts/checklist-symbol-anchor-baseline.json is a maintainer\'s call, never the author\'s way past a red.',
      });
    }
  }
  return problems;
}

/**
 * Both directions for all three limbs — the detector, the resolver and the
 * floor. The detector's whole value is the boundary (this ledger is dense with
 * `#`-shaped text that is NOT an anchor), and the resolver's whole value is
 * that it can still fire once the ledger is clean, which is precisely when its
 * live output goes empty and its green stops meaning anything by itself.
 */
function selfTestSymbolAnchors() {
  const failures = [];
  let checked = 0;
  const t = (what, ok, note = '') => {
    checked++;
    if (!ok) failures.push(`${what}${note ? ` — ${note}` : ''}`);
  };
  const OWN_SOURCE = readFileSync(new URL(import.meta.url).pathname, 'utf8');

  // ── the REGISTRATION is what this gate claims it is (#18107) ─────────────
  //
  // ⛔ The detector cases that used to live here are GONE, and their absence is
  // the deliverable: they pinned a second implementation of a grammar the
  // 2026-09-01 ruling says has exactly one. Every one of them was transplanted
  // into `scripts/symbol-anchors.mjs`'s own battery — the unspanned form and
  // each `#`-shaped neighbour it must refuse (an issue reference, a JSON-pointer
  // fragment, a scoped package specifier, a hyphenated word with a tail, a bare
  // filename with no directory), the dotted segments, the trailing punctuation.
  // ⭐ A case is not deleted by moving; it is deleted by stopping. What this
  // battery owes now is that THIS corpus reaches that one grammar and carries
  // none of its own.
  t('G1 the corpus sweeps this family and nothing else',
    CORPUS.docRoots.length === 1 && CORPUS.docRoots[0] === CHECKLIST_REL,
    JSON.stringify(CORPUS.docRoots));
  t('G2 the corpus reads both authored shapes of this family and no third one',
    CORPUS.docPattern.test('areas/x.json'.split('/').pop()) && CORPUS.docPattern.test('README.md')
      && !CORPUS.docPattern.test('page.mdx') && !CORPUS.docPattern.test('notes.txt'));
  t('G3 the corpus EXCLUDES `runs/` — run records are outputs, and holding a past record to today’s authoring rules would make the rule unfixable',
    CORPUS.excludeDirs.length === 1 && CORPUS.excludeDirs[0] === 'runs');
  t('G4 the corpus declares its citations UNSPANNED — every one of them lives inside a JSON string value, where a backtick is payload and not a code span',
    CORPUS.unspannedAnchors === true);
  t('G5 the corpus does NOT check bare paths — a citation with no `#symbol` is honest here, and turning them into reds is a corpus-wide cleanup nobody ruled on',
    CORPUS.checkBarePaths === false);
  t('G6 the corpus sweeps its documents RAW — these files ARE the citations, so a comment projection (which a `scripts/**` corpus needs) would blank the whole ledger away',
    CORPUS.docProjection === null);

  // ── ONE extension vocabulary, and one grammar (#18107) ───────────────────
  //
  // Before registration two constants named `ANCHORABLE_EXTENSIONS` existed in
  // this tree, one module importing the other, with different contents — 23
  // shared against 8 private, a strict subset — and NOTHING asserted they were
  // the same. That is the whole reason the drift was invisible. V1 holds the
  // name this file uses to the shared OBJECT (identity, not a value compare: a
  // copied array would satisfy an equality and drift again the next day), and
  // V2 reads this file's own source to say it defines no vocabulary and no
  // matcher of its own.
  t('V1 the anchorable-extension vocabulary this gate names IS the shared object — a second definition is the drift this card closes',
    ANCHORABLE_EXTENSIONS === symbolAnchorsModule.ANCHORABLE_EXTENSIONS && ANCHORABLE_EXTENSIONS.length > 8,
    `${ANCHORABLE_EXTENSIONS?.length} extension(s)`);
  /* ⚠️ NAME-BASED, and the names are matched as a PREFIX with any suffix
   * allowed — not as an equality, which is what this pin was first written as
   * and what let a `…_SHADOW` redefinition of the same vocabulary straight
   * through when it was ablated. A fork under a nearby name is a fork.
   *
   * ⛔ The residual gap is stated rather than papered over: a fork under a name
   * sharing none of these tokens is invisible here, and no regex over a
   * source file will close that. V3 beside it is what keeps the READ honest
   * (a read that returned nothing would pass V2 forever), and the pin claims
   * exactly this much and no more. */
  const noLocal = (name) => !new RegExp(`\\b(?:const|let|var)\\s+${name}\\w*\\s*=`).test(OWN_SOURCE);
  t('V2 this gate defines NO anchor grammar of its own — no local extension set, no anchor regex, no detector',
    noLocal('ANCHORABLE_EXTENSIONS') && noLocal('SYMBOL_ANCHOR')
      && !/\bfunction\s+findSymbolAnchors\w*\b/.test(OWN_SOURCE)
      && !/\bfunction\s+absentAnchorSegments\w*\b/.test(OWN_SOURCE));
  t('V3 CONTROL for V2 — the same source read DOES find the registration, so a green above is "no fork" and not "the read returned nothing"',
    /defineCorpus\(\{/.test(OWN_SOURCE) && /sweepCorpus\(CORPUS, ROOT\)/.test(OWN_SOURCE));

  // ── the `runs/` exclusion, BOTH DIRECTIONS on the LIVE corpus ────────────
  //
  // The core's own battery proves the mechanism on a synthetic fixture, with
  // the SAME unresolvable anchor in an excluded and an included subtree. This
  // pair proves it HERE, against the real tree, which is the half a fixture
  // cannot cover: that this corpus's declaration actually lands on this
  // corpus's `runs/`. X1 is worthless without X0 — an exclusion that excludes
  // nothing would pass X1 forever.
  const runsDir = join(CHECKLIST_DIR, 'runs');
  const runsFiles = existsSync(runsDir)
    ? readdirSync(runsDir).filter((n) => n.endsWith('.json') || n.endsWith('.md'))
    : [];
  t('X0 PRECONDITION — `runs/` really holds authored-shaped files, so excluding it is a reading and not a no-op',
    runsFiles.length > 0, `${runsFiles.length} file(s)`);
  /* ⛔ ITS OWN SWEEP, deliberately. This battery is also the positive control
   * that runs before the module-level sweep is trusted, so it cannot read that
   * sweep's result — and a case that silently skipped because a binding was not
   * initialised yet is the "green that never ran" this file is built around. */
  const liveSweep = sweepCorpus(CORPUS, ROOT);
  const sweptDocs = [...liveSweep.byDoc.keys()];
  t('X1 no document under `runs/` is swept',
    sweptDocs.every((d) => !relative(CHECKLIST_REL, d).startsWith('runs/')),
    sweptDocs.filter((d) => relative(CHECKLIST_REL, d).startsWith('runs/')).join(', '));
  t('X2 CONTROL — the SAME sweeper does reach the areas beside it, so X1 is an exclusion and not an empty walk',
    sweptDocs.filter((d) => relative(CHECKLIST_REL, d).startsWith('areas/')).length > 0,
    `${sweptDocs.length} document(s) swept`);
  const unexcluded = sweepCorpus(
    defineCorpus({ ...CORPUS, id: 'platform-checklist-unexcluded', excludeDirs: [] }),
    ROOT,
  );
  t('X3 CONTROL — dropping `excludeDirs` puts those same `runs/` documents back, which is what makes X1 a measurement of the exclusion itself',
    unexcluded.counts.docs === liveSweep.counts.docs + runsFiles.length,
    `${unexcluded.counts.docs} unexcluded vs ${liveSweep.counts.docs} excluded, ${runsFiles.length} under runs/`);

  // ── the sweep is BOUND to the shared verdict, both directions ────────────
  //
  // #16898's N-block, re-taken through the registered path. The four shapes the
  // withdrawn permissive rule accepted must still read ABSENT, and N4 is the
  // positive control without which a green here cannot tell "bound correctly"
  // from "nothing resolves any more".
  /* ⭐ THE RE-JUDGED CASES, carried through the registration UNCHANGED in
   * verdict and only re-spelled in call. #16898 wrote the rule for them and it
   * still binds: 「keeping the case with its verdict inverted is what pins the
   * narrowing, where deleting it would leave the tree unable to say the
   * narrowing ever happened」. Deleting the FORKED DETECTOR is this card's
   * deliverable; deleting the record of a previous card's narrowing is not, so
   * every one of these survives the transplant. `absentAnchorSegments` was this
   * file's per-segment split and is gone with the fork — the split is the
   * GRAMMAR's, and it now lives beside the grammar as
   * `scripts/symbol-anchors.mjs#symbolSegmentResolution`. */
  const src = [
    '// parsePlatformAdminEmails used to live here; renamed in #9999.',
    "export const RESOLVED = { mode: 'strict' };",
    "const ROUTE = '/api/v1/meta/object';",
    'export function hasPlatformAdminStanding(x) { return RESOLVED.mode === x; }',
  ].join('\n');
  /* The same shape with the member at the START OF A LINE, which is where the
   * shared rule reads one. Kept as a second fixture rather than folded into
   * `src`, because `src`'s inline member is exactly what P3 pins. */
  const blockSrc = ['export const PolicyShape = {', "  mode: 'strict',", '};'].join('\n');
  const absent = (source, path, sym) => symbolSegmentResolution(source, path, sym).absent;
  t('R1 a symbol that is gone from the file is reported absent',
    absent(src, 'x.ts', 'parsePlatformAdminEmails').length === 1);
  t('R2 a symbol surviving ONLY in a comment is ABSENT — prose about a symbol is not a symbol',
    absent(src, 'x.ts', 'renamed').length === 1);
  t('R3 a dotted anchor whose SECOND segment is gone is reported, not passed on the first',
    absent(src, 'x.ts', 'RESOLVED.strictness').join(',') === 'strictness');
  t('R4 a substring of a present identifier does not count as present',
    absent(src, 'x.ts', 'PlatformAdmin').length === 1);
  t('P1 a declared export resolves', absent(src, 'x.ts', 'hasPlatformAdminStanding').length === 0);
  t('P2 a const resolves', absent(src, 'x.ts', 'RESOLVED').length === 0);
  t('P3 a dotted anchor whose member is written INLINE is ABSENT — the shared rule takes a member key at the start of a line (re-judged, #16898; the shape #18101 owns)',
    absent(src, 'x.ts', 'RESOLVED.mode').join(',') === 'mode');
  t('P3b both segments of a live dotted anchor resolve when the member IS at the start of a line',
    absent(blockSrc, 'x.ts', 'PolicyShape.mode').length === 0);
  t('P4 a symbol that is a COMPLETE quoted token counts as present — this ledger cites machine names, not only exports',
    absent(src, 'x.ts', 'strict').length === 0);

  const bindSrc = [
    "import { importedOnly } from './elsewhere.js';",
    'export function declaredHere(paramOnly) { return importedOnly(paramOnly); }',
    "export const HOST = { list: ['whole_token', 'dotted_head.actions.go'] };",
  ].join('\n');
  t('N1 a CALL SITE / IMPORT only is ABSENT — the file uses the symbol, it does not declare it',
    absent(bindSrc, 'x.ts', 'importedOnly').length === 1);
  t('N2 a LOCAL PARAMETER only is ABSENT', absent(bindSrc, 'x.ts', 'paramOnly').length === 1);
  t('N3 a SUBSTRING of a longer string token is ABSENT — `literal` is a COMPLETE quoted token',
    absent(bindSrc, 'x.ts', 'dotted_head').length === 1);
  t('N4 POSITIVE CONTROL — a declaration and a complete quoted token BOTH still resolve, so a green above is a narrowing and not a dead resolver',
    absent(bindSrc, 'x.ts', 'declaredHere').length === 0 && absent(bindSrc, 'x.ts', 'whole_token').length === 0);
  t('N5 a `.json` VALUE is ABSENT where a `.json` KEY resolves (re-judged, #16898) — the shared rule reads JSON keys',
    absent('{ "route": "https://x/y", "kind": "live" }', 'x.json', 'live').join(',') === 'live'
      && absent('{ "route": "https://x/y", "live": true }', 'x.json', 'live').length === 0);
  t('N6 a dotted anchor whose SECOND segment is gone names that segment — ⛔ it is not passed on the first',
    absent('export const PolicyShape = {\n  mode: 1,\n};', 'x.ts', 'PolicyShape.strictness').join(',') === 'strictness');

  // ── the live sweep actually ran ──────────────────────────────────────────
  //
  // A registration that reached nothing reports zero problems, which is the
  // same green a clean corpus prints. L1/L2 make the console line's numbers
  // load-bearing rather than decorative.
  const liveResolved = liveSweep.counts.declaration + liveSweep.counts.literal;
  t('L1 the live sweep resolved anchors through the shared resolver — a registration that reached nothing prints the same green a clean corpus does',
    liveResolved > 0 && liveSweep.counts.symbol >= liveResolved,
    `${liveResolved}/${liveSweep.counts.symbol}`);
  t('L2 the sweep and `familyFiles` agree on the population — two walkers over one corpus is the drift this card closes one level up',
    liveSweep.counts.docs === familyFiles(CHECKLIST_DIR).length,
    `${liveSweep.counts.docs} swept vs ${familyFiles(CHECKLIST_DIR).length} walked`);
  t('X4 every residual row names a document the sweep actually reaches — a row filed against a doc outside the registered corpus could never fire, and would read as a standing excuse rather than the STALE RESIDUAL ROW red it is',
    SHARED_RESOLVER_RESIDUAL.every((r) => sweptDocs.includes(join(CHECKLIST_REL, r.doc))),
    SHARED_RESOLVER_RESIDUAL.filter((r) => !sweptDocs.includes(join(CHECKLIST_REL, r.doc))).map((r) => r.doc).join(', '));
  t('L3 the per-document counts sum to the corpus-wide ones — a per-file floor read off a total could never see one file emptied while another grew',
    [...liveSweep.byDoc.values()].reduce((n, c) => n + c.symbol, 0) === liveSweep.counts.symbol
      && [...liveSweep.byDoc.values()].reduce((n, c) => n + c.declaration + c.literal, 0) === liveResolved);

  // ── the residual ledger, both directions ─────────────────────────────────
  t('D1 the residual is a CLOSED ledger — every row carries a doc, an anchor, a shape and one of exactly two verdicts',
    SHARED_RESOLVER_RESIDUAL.length > 0
      && SHARED_RESOLVER_RESIDUAL.every((r) => r.doc && r.anchor.includes('#') && r.shape
        && (r.verdict === 'bad-citation' || r.verdict === 'accept-set')));
  t('D2 no row is written twice — a duplicate would let one repair leave a live excuse behind',
    SHARED_RESOLVER_RESIDUAL_INDEX.size === SHARED_RESOLVER_RESIDUAL.length);
  t('D3 the ledger is inside its grow-never ceiling — a residual that can grow is the permissive rule coming back a row at a time',
    SHARED_RESOLVER_RESIDUAL.length <= SHARED_RESOLVER_RESIDUAL_CEILING);
  t('D4 the `accept-set` rows are the minority and are named as a DIFFERENT card — ⛔ nothing here widens the shared core',
    SHARED_RESOLVER_RESIDUAL.filter((r) => r.verdict === 'accept-set').length
      < SHARED_RESOLVER_RESIDUAL.filter((r) => r.verdict === 'bad-citation').length);

  // ── the floor, both directions ────────────────────────────────────────────
  const floors = { 'areas/a.json': 10, 'areas/b.json': 4 };
  t('B1 a file below its floor is reported',
    anchorFloorProblems(new Map([['areas/a.json', 9], ['areas/b.json', 4]]), floors).length === 1);
  t('B2 the report names the shrink-never rule and the authority for lowering a floor',
    anchorFloorProblems(new Map([['areas/a.json', 0], ['areas/b.json', 4]]), floors)[0]?.message.includes('⛔ MAINTAINER-ONLY'));
  t('B3 a file carrying anchors with no floor entry is reported — an undeclared file could be emptied silently',
    anchorFloorProblems(new Map([['areas/a.json', 10], ['areas/b.json', 4], ['areas/c.json', 3]]), floors).length === 1);
  t('B4 a floor whose file left the family is reported',
    anchorFloorProblems(new Map([['areas/a.json', 10]]), floors).length === 1);
  t('B5 counts ABOVE the floor are silent — adding anchors is ordinary work',
    anchorFloorProblems(new Map([['areas/a.json', 99], ['areas/b.json', 4]]), floors).length === 0);
  t('B6 a family file with zero anchors needs no entry — a document that cites nothing is not a regression',
    anchorFloorProblems(new Map([['areas/a.json', 10], ['areas/b.json', 4], ['RUNNER.md', 0]]), floors).length === 0);

  symbolAnchorsReachedVerdict = true;
  return { checked, failures };
}

/**
 * The `planned` status, both of its halves, and the ratchet direction that is
 * the whole point of it.
 *
 * ## Why this battery exists at all
 *
 * `planned` RELAXES an authored surface: an area JSON carrying it is refused by
 * the landed gate and accepted by this one. Every relaxation buys a way to be
 * wrong, and here the dangerous one is not the schema — it is the coverage
 * ratchet. If a planned item ever counted as coverage, "凡是有的能力, 都要测试"
 * would become "凡是有的能力, 都要打算测试", and the ratchet would go green on
 * a kind nothing runs against. So the ratchet direction is pinned BOTH ways,
 * on fixtures, not on the tree: the live ledger carries zero planned items and
 * is expected to for a while, which means the real data cannot tell "this rule
 * works" from "this rule was deleted" — the same silent-success argument the
 * unreferenced-recipe battery above makes.
 */
function selfTestPlannedStatus() {
  const failures = [];
  let checked = 0;
  const t = (what, ok, note = '') => {
    checked++;
    if (!ok) failures.push(`${what}${note ? ` — ${note}` : ''}`);
  };

  // ── the accept set ────────────────────────────────────────────────────────
  t('S1 `planned` is an accepted status — the widening this rule is', STATUSES.has('planned'));
  t('S2 the statuses that were accepted before still are — a widening that narrowed something else is a different change',
    ['active', 'draft', 'retired'].every((s) => STATUSES.has(s)));
  t('S3 the set is still CLOSED — a typo like `planed` is refused, not read as a fourth status', !STATUSES.has('planed'));

  // ── the field rules `planned` relaxes, and the one it adds ────────────────
  const planned = (over = {}) => statusFieldProblems({ status: 'planned', since: null, personas: ['admin'], ...over });
  const active = (over = {}) => statusFieldProblems({ status: 'active', since: 'v16', steps: ['do a thing'], ...over });

  t('F1 a planned item with `since: null`, no steps and personas is clean', planned().length === 0, planned().join('; '));
  t('F2 `since` may instead name the TARGET release', planned({ since: 'v18' }).length === 0);
  t('F3 a `since` that is neither null nor a release is refused', planned({ since: 'someday' }).length === 1);
  t('F4 and that message names the two legal spellings rather than only the release one',
    planned({ since: 'someday' })[0]?.includes('null') && planned({ since: 'someday' })[0]?.includes('TARGET release'));
  t('F5 steps on a planned item are refused — nothing is implemented to drive', planned({ steps: ['open the page'] }).length === 1);
  t('F6 and that message sends them to the promotion edit, not to a workaround',
    planned({ steps: ['open the page'] })[0]?.includes('promotes it to "active"'));
  t('F7 an empty steps array is not steps — a planned item may carry the key', planned({ steps: [] }).length === 0);
  t('F8 a planned item with no personas is refused — the gap must say who it is for', planned({ personas: undefined }).length === 1);
  t('F9 an empty personas array is refused the same way', planned({ personas: [] }).length === 1);

  t('F10 an ACTIVE item is judged exactly as before — release `since`, non-empty steps', active().length === 0, active().join('; '));
  t('F11 an active item may NOT use `since: null` — the relaxation is scoped to planned', active({ since: null }).length === 1);
  t('F12 an active item still owes steps', active({ steps: [] }).length === 1);
  t('F13 an active item owes NO personas — this battery did not widen a requirement onto the 264 live items',
    active({ personas: undefined }).length === 0);
  t('F14 a planned item is never asked for steps AND a release at once — the two relaxations compose',
    planned({ since: null, steps: undefined }).length === 0);

  // ── the coverage ratchet, both directions ────────────────────────────────
  // A miniature ledger: one kind's worth of ids, each with a status.
  const LEDGER = new Map([
    ['area.runs', 'active'],
    ['area.drafted', 'draft'],
    ['area.promised', 'planned'],
    ['area.promised-two', 'planned'],
    ['area.gone', 'retired'],
  ]);
  const cov = (ids) => coverageEntryProblems(ids, (id) => LEDGER.get(id));

  const activeOnly = cov(['area.runs']);
  t('C1 DIRECTION A — a kind mapped to an active item is covered, silently', activeOnly.problems.length === 0 && activeOnly.bearing === 1,
    activeOnly.problems.join('; '));
  const mixed = cov(['area.runs', 'area.promised']);
  t('C2 a planned item listed BESIDE an active one changes nothing — that is where a capability-gap card points, and it must not red a covered kind',
    mixed.problems.length === 0 && mixed.bearing === 1, mixed.problems.join('; '));

  const plannedOnly = cov(['area.promised']);
  t('C3 DIRECTION B — a kind whose ONLY item is planned is UNMAPPED', plannedOnly.problems.length === 1 && plannedOnly.bearing === 0);
  t('C4 and it is reported as UNMAPPED, in the vocabulary the unclassified-kind message already uses',
    plannedOnly.problems[0]?.startsWith('UNMAPPED'));
  t('C5 the message says WHY, so the cheap fix (promote it) is visibly not the fix',
    plannedOnly.problems[0]?.includes('promise, not a test'));
  const plannedTwo = cov(['area.promised', 'area.promised-two']);
  t('C6 two planned items are not one active item — coverage does not accumulate from promises',
    plannedTwo.problems.length === 1 && plannedTwo.bearing === 0);

  t('C7 a draft item still carries coverage — this change moved ONE status, not the ratchet\'s meaning',
    cov(['area.drafted']).problems.length === 0 && cov(['area.drafted']).bearing === 1);
  const retiredOnly = cov(['area.gone']);
  t('C8 a retired-only mapping keeps its own message AND is now also reported as uncovered',
    retiredOnly.problems.length === 2 && retiredOnly.problems.some((p) => p.includes('retired item')) && retiredOnly.bearing === 0);
  const unknown = cov(['area.never-existed']);
  t('C9 an unresolvable id is still named as unknown', unknown.problems.some((p) => p.includes('unknown item id')) && unknown.bearing === 0);
  t('C10 ⛔ the bearing set does not contain `planned` — folding it in is the ONE edit that turns this ratchet into a way to green an untested kind',
    !COVERAGE_BEARING_STATUSES.has('planned') && !COVERAGE_BEARING_STATUSES.has('retired'));

  // ── the live control ──────────────────────────────────────────────────────
  // The fixtures above prove the rule; this reads the ledger the gate actually
  // validates and proves the rule is pointed at IT. Every assertion above would
  // pass just as well against a `planned` no area file could ever carry.
  // ⛔ Read here rather than from the item walk below: this battery runs before
  // that walk on every invocation, and behind `--self-test` the walk never runs.
  const liveStatuses = new Set();
  let liveItems = 0;
  for (const f of readdirSync(AREAS_DIR).filter((n) => n.endsWith('.json'))) {
    for (const it of JSON.parse(readFileSync(join(AREAS_DIR, f), 'utf8')).items ?? []) {
      liveItems += 1;
      liveStatuses.add(it.status);
    }
  }
  t('L1 every status on the live ledger is one this gate accepts — the control that says the assertions above are about THIS ledger',
    liveItems > 0 && [...liveStatuses].every((s) => STATUSES.has(s)),
    `${liveItems} items, statuses: ${[...liveStatuses].sort().join(', ')}`);

  plannedStatusReachedVerdict = true;
  return { checked, failures };
}

if (process.argv.slice(2).includes('--self-test')) {
  const trap = selfTestTrapVocabulary();
  const prov = selfTestProvisioningUse();
  const unref = selfTestUnreferencedRecipes();
  const metaCall = selfTestMetaCallSpelling();
  const cites = selfTestLineCitationBinding();
  const anchors = selfTestSymbolAnchors();
  const plannedStatus = selfTestPlannedStatus();
  requireReachedVerdict('selfTestTrapVocabulary', trapReachedVerdict);
  requireReachedVerdict('selfTestProvisioningUse', provisioningReachedVerdict);
  requireReachedVerdict('selfTestUnreferencedRecipes', unreferencedReachedVerdict);
  requireReachedVerdict('selfTestMetaCallSpelling', metaCallReachedVerdict);
  requireReachedVerdict('selfTestLineCitationBinding', lineCitationsReachedVerdict);
  requireReachedVerdict('selfTestSymbolAnchors', symbolAnchorsReachedVerdict);
  requireReachedVerdict('selfTestPlannedStatus', plannedStatusReachedVerdict);
  const rosterFailures = batteryRosterFailures({
    [BATTERY_TRAP_VOCABULARY]: trap.checked,
    [BATTERY_PROVISIONING_USE]: prov.checked,
    [BATTERY_UNREFERENCED_RECIPES]: unref.checked,
    [BATTERY_META_CALL_SPELLING]: metaCall.checked,
    [BATTERY_LINE_CITATION_BINDING]: cites.checked,
    [BATTERY_SYMBOL_ANCHORS]: anchors.checked,
    [BATTERY_PLANNED_STATUS]: plannedStatus.checked,
  });
  const failures = [...trap.failures, ...prov.failures, ...unref.failures, ...metaCall.failures, ...cites.failures, ...anchors.failures, ...plannedStatus.failures, ...rosterFailures];
  if (failures.length === 0) {
    console.log(
      `✓ check-platform-checklist --self-test: ${trap.checked + prov.checked + unref.checked + metaCall.checked + cites.checked + anchors.checked + plannedStatus.checked} assertions — the trap-table extractor reads a good table and REFUSES an empty/renamed/reshaped one;` +
        ' `fixtures.provisioning.use` resolves both spellings (own-area key and `<area>:<recipe>`) and fires on all three dangling shapes;' +
        ' the unreferenced-recipe direction fires on a recipe nobody uses while leaving a cross-area consumer, a retired consumer and a `$`-annotation alone;' +
        ' and the `/meta` call-spelling refusal reads its vocabulary out of the live generated contract, fires on every folded spelling a `call` can instruct, and stays silent on the canonical singular, on parameter placeholders, and on the `why`/`expect`/`source`/`requires` prose that narrates the fold;' +
        ' and the line-citation limb DETECTS NOTHING ITSELF EITHER: the last forked grammar in this file went into the shared core at #18592, so what is pinned here is the BINDING — the corpus declaring `pathlessLineCitations`, a source read finding no citation regex and no detector while the same read DOES find the declaration, the binding driven ON and OFF against ONE text so the green is the declaration working rather than a text that would have matched anyway, the DARK case that a citation both grammars already agreed on keeps its verdict either way, the refusal to over-fire on this ledger\'s own HTTP statuses, config literals, URL ports, clock times and quoted JSON, and the live zero with the control that says it is a reading;' +
        ' and the symbol-anchor limb DETECTS NOTHING AND RESOLVES NOTHING ITSELF: it is a registered corpus (#18107), so the grammar, the walk and the verdict are all `scripts/symbol-anchors.mjs`\'s, pinned here by a source read that finds no local extension set, no anchor regex and no detector while the same read DOES find the registration, by the anchorable-extension vocabulary being the shared OBJECT rather than a copy of it, by the `runs/` exclusion driven three ways on the live corpus (the subtree holds files, none is swept, the areas beside it still are, and dropping the exclusion puts them back), and by the #16898 binding re-taken through the registration — a call site / import / local parameter / string-substring all reading ABSENT, the positive control that a declaration and a complete quoted token still resolve, a `.json` key resolving where a `.json` value does not, an INLINE object-literal key reading absent where one at the start of a line resolves — with the closed, grow-never residual and the per-file anchor floor held in both directions beside it;' +
        ' and the `planned` status is driven on fixtures rather than on a ledger that carries none of it — the accept set widened without losing its closure, `since: null`/no-steps/personas relaxed for planned alone while the 264 live items are judged exactly as before, and the coverage ratchet held BOTH ways: a planned item beside an active one is silent, a kind whose only items are planned is UNMAPPED, and the bearing set is pinned NOT to contain `planned`.',
    );
    process.exit(0);
  }
  console.error(`✗ check-platform-checklist --self-test — ${failures.length} failure(s)\n`);
  for (const f of failures) console.error(`  • ${f}`);
  process.exit(1);
}

// The extractor's own positive control, before it is trusted with anything.
const trapControl = selfTestTrapVocabulary();
requireReachedVerdict('selfTestTrapVocabulary', trapReachedVerdict);
if (trapControl.failures.length) {
  console.error("check-platform-checklist: the trap-vocabulary extractor's own positive control FAILED — this check cannot be trusted, and a green from it would mean nothing.\n");
  for (const f of trapControl.failures) console.error(`  ✗ ${f}`);
  process.exit(1);
}

// Same, for the provisioning resolve: a green from a check that cannot fire is
// indistinguishable from the green this gate printed before it existed.
const provisioningControl = selfTestProvisioningUse();
requireReachedVerdict('selfTestProvisioningUse', provisioningReachedVerdict);
if (provisioningControl.failures.length) {
  console.error("check-platform-checklist: the provisioning-resolve check's own positive control FAILED — a `use` that resolves to nothing would pass, which is the exact defect this check was added to close.\n");
  for (const f of provisioningControl.failures) console.error(`  ✗ ${f}`);
  process.exit(1);
}

// Same again for the reverse direction, and here the control is not a
// safeguard on top of the real subject — it IS the only subject. All four
// recipes on the real ledger are referenced, so this direction's output is
// permanently empty and its green says nothing on its own.
const unreferencedControl = selfTestUnreferencedRecipes();
requireReachedVerdict('selfTestUnreferencedRecipes', unreferencedReachedVerdict);
if (unreferencedControl.failures.length) {
  console.error('check-platform-checklist: the unreferenced-recipe direction\'s own positive control FAILED — a recipe no item references would pass unreported, and because every real recipe IS referenced, nothing else in this gate would ever notice.\n');
  for (const f of unreferencedControl.failures) console.error(`  ✗ ${f}`);
  process.exit(1);
}

// And for the `/meta` call-spelling refusal. Two burdens at once here: the
// authority is parsed out of another package's source (a reshaped literal
// reads as "no plural spellings exist"), and once the ledger is repaired the
// subject population is zero — so nothing but this battery can tell a working
// direction from a deleted one.
const metaCallControl = selfTestMetaCallSpelling();
requireReachedVerdict('selfTestMetaCallSpelling', metaCallReachedVerdict);
if (metaCallControl.failures.length) {
  console.error("check-platform-checklist: the `/meta` call-spelling refusal's own positive control FAILED — an executable step instructing a folded plural spelling would pass unreported, which is the exact defect this check was added to close.\n");
  for (const f of metaCallControl.failures) console.error(`  ✗ ${f}`);
  process.exit(1);
}

// And for the line-citation binding. The control matters more here than
// anywhere else in this file: the ledger is CLEAN of line citations, so this
// limb's real output is permanently empty and its green says nothing on its
// own. A binding that silently stopped reaching the grammar would be
// indistinguishable from the ledger staying clean — which is precisely the
// exit-0-by-construction shape this check was added to end.
const citationControl = selfTestLineCitationBinding();
requireReachedVerdict('selfTestLineCitationBinding', lineCitationsReachedVerdict);
if (citationControl.failures.length) {
  console.error('check-platform-checklist: the line-citation binding\'s own positive control FAILED — a rotting `file:line` pointer would pass unreported, and because the ledger is clean nothing else here would ever notice.\n');
  for (const f of citationControl.failures) console.error(`  ✗ ${f}`);
  process.exit(1);
}

// And for the symbol-anchor resolver. Same reasoning as the two above, plus
// one this file has not had before: this check's subject population is
// AUTHORED, so it can be emptied. Its control proves the detector still finds
// anchors and the resolver still refuses an absent symbol; the floor beside it
// proves the ledger still carries anchors for them to be found in.
const symbolAnchorControl = selfTestSymbolAnchors();
requireReachedVerdict('selfTestSymbolAnchors', symbolAnchorsReachedVerdict);
if (symbolAnchorControl.failures.length) {
  console.error("check-platform-checklist: the symbol-anchor resolver's own positive control FAILED — an anchor naming a symbol its file no longer contains would pass unreported, which is the rot this resolver was added to end.\n");
  for (const f of symbolAnchorControl.failures) console.error(`  ✗ ${f}`);
  process.exit(1);
}
// And for the `planned` status. Its schema half is exercised by the tree the
// moment anyone authors a planned item; its COVERAGE half is not, and will not
// be for as long as the ledger's planned count is the 0 this gate prints. A
// deleted ratchet rule and an honest ledger print the same green, so the
// fixtures below it are the only thing that can tell them apart.
const plannedStatusControl = selfTestPlannedStatus();
requireReachedVerdict('selfTestPlannedStatus', plannedStatusReachedVerdict);
if (plannedStatusControl.failures.length) {
  console.error("check-platform-checklist: the `planned` status check's own positive control FAILED — a metadata kind whose only checklist items are PLANNED would report as covered, which turns this ratchet from 'the platform tests what it has' into 'the platform intends to'.\n");
  for (const f of plannedStatusControl.failures) console.error(`  ✗ ${f}`);
  process.exit(1);
}
const inlineRosterFailures = batteryRosterFailures({
  [BATTERY_TRAP_VOCABULARY]: trapControl.checked,
  [BATTERY_PROVISIONING_USE]: provisioningControl.checked,
  [BATTERY_UNREFERENCED_RECIPES]: unreferencedControl.checked,
  [BATTERY_META_CALL_SPELLING]: metaCallControl.checked,
  [BATTERY_LINE_CITATION_BINDING]: citationControl.checked,
  [BATTERY_SYMBOL_ANCHORS]: symbolAnchorControl.checked,
  [BATTERY_PLANNED_STATUS]: plannedStatusControl.checked,
});
if (inlineRosterFailures.length) {
  console.error('check-platform-checklist: the self-test battery roster FAILED — assertions stopped running, and every leg below would read the smaller count as a pass.\n');
  for (const f of inlineRosterFailures) console.error(`  ✗ ${f}`);
  process.exit(1);
}

// The folded-spelling vocabulary, read from the contract before anything is
// judged against it. Refused rather than defaulted: with no vocabulary every
// `call` validates against an empty set and this gate prints the same green it
// printed before the refusal existed.
const metaSpellingRead = existsSync(META_URL_DATA_FILE)
  ? extractMetaUrlSpellings(readFileSync(META_URL_DATA_FILE, 'utf8'))
  : { folded: [], canonical: [], refusal: 'packages/spec/src/meta-spelling/meta-url-data.generated.ts is not in the tree — run `pnpm --filter @objectstack/spec gen:meta-url-spelling`.' };
if (metaSpellingRead.refusal) {
  console.error(`check-platform-checklist: cannot read \`${META_URL_EXPORT}\` — ${metaSpellingRead.refusal}`);
  console.error('\nThis is a REFUSAL, not a pass: with no folded-spelling vocabulary, every `call` string would validate against an empty set and report zero problems.');
  process.exit(1);
}
const FOLDED_META_SPELLINGS = new Set(metaSpellingRead.folded);
const CANONICAL_META_SINGULAR = new Map(metaSpellingRead.folded.map((f, i) => [f, metaSpellingRead.canonical[i]]));

if (!existsSync(RUNNER_FILE)) {
  console.error(`check-platform-checklist: missing ${RUNNER_FILE} — the trap vocabulary lives in its "${TRAP_HEADING}" table and \`traps\` has nothing to validate against.`);
  process.exit(1);
}
const trapTable = extractTrapVocabulary(readFileSync(RUNNER_FILE, 'utf8'));
if (trapTable.refusal) {
  console.error(`check-platform-checklist: cannot read the trap vocabulary out of docs/qa/platform-checklist/RUNNER.md — ${trapTable.refusal}`);
  console.error('\nThis is a REFUSAL, not a pass: with no vocabulary, every item\'s `traps` would validate against an empty set and report zero problems.');
  process.exit(1);
}
const TRAPS = new Set(trapTable.traps);
for (const d of trapTable.duplicates) {
  err('RUNNER.md', null, `\`${TRAP_HEADING}\` lists \`${d}\` twice — one trap, one row, one definition`);
}

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
let recipeRefs = 0; // item references that resolved to one
let qualifiedRefs = 0; // ...of which named another area explicitly
let danglingRefs = 0; // ...and those that resolved to nothing (suppresses the reverse direction)
const referencedByArea = new Map(); // owning area -> the set of ITS recipe keys some item addressed

// Pass 1 — parse every area file. A qualified `use` resolves against ANOTHER
// area's block, so the recipe universe has to be complete before any item is
// judged: a single walk would test each item against a half-built map, and
// whether a cross-area reference resolved would depend on readdir order. That
// is the kind of green that holds right up until someone renames a file.
const parsed = [];
for (const file of files) {
  try {
    parsed.push({ file, stem: basename(file, '.json'), doc: JSON.parse(readFileSync(join(AREAS_DIR, file), 'utf8')) });
  } catch (e) {
    err(file, null, `does not parse as JSON: ${e.message}`);
  }
}

// Keyed by FILENAME stem, deliberately not by `doc.area`. The two must agree
// (checked per file below), and the stem is the half a `use` qualifier
// actually names — `search:…` means `areas/search.json`. Keying by a
// mismatched `doc.area` would let a qualified reference resolve THROUGH the
// very inconsistency this gate reports one line down.
const recipesByArea = new Map(parsed.map(({ stem, doc }) => [stem, areaRecipeKeys(doc)]));
const recipeTotal = [...recipesByArea.values()].reduce((n, keys) => n + keys.length, 0);

for (const { file, stem, doc } of parsed) {
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
    for (const msg of statusFieldProblems(item)) where(msg);

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

    for (const msg of trapProblems(item, TRAPS)) where(msg);

    const useProblems = provisioningProblems(item, stem, recipesByArea);
    for (const msg of useProblems) where(msg);
    if (useProblems.length) danglingRefs++;
    if (item.fixtures?.provisioning !== undefined && useProblems.length === 0) {
      recipeRefs++;
      if (parseUse(item.fixtures.provisioning.use).qualified) qualifiedRefs++;
      // The reverse direction's input. Credited to the area that OWNS the
      // recipe, which for a qualified `use` is not the area writing it.
      const ref = referencedRecipe(item, stem);
      if (ref) {
        if (!referencedByArea.has(ref.area)) referencedByArea.set(ref.area, new Set());
        referencedByArea.get(ref.area).add(ref.recipe);
      }
    }

    if (item.status === 'retired') {
      if (typeof item.retiredReason !== 'string' || !item.retiredReason) where('retired items must carry "retiredReason"');
    } else {
      if (!Array.isArray(item.acceptance) || item.acceptance.length === 0) {
        // A planned item has no oracle to consult yet — that is what `planned`
        // MEANS. Requiring a clause here would buy one written against a
        // capability nobody has implemented, which is the ticking-on-vibes this
        // ledger exists to refuse. Clauses it DOES carry are still validated
        // below, so an early draft of the acceptance cannot rot unchecked.
        if (item.status !== 'planned') where('active/draft items must have at least one acceptance clause');
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

// ── `/meta` call spelling, over every area document ────────────────────────
// A separate pass rather than a limb of the item walk above: `call` strings
// live in the AREA-LEVEL `fixtures` block today, which that loop never
// descends into, and an item-shaped check would have been blind to all 19 of
// them. Reported against the file with no item id — the path names the string.
let metaCallsScanned = 0;
for (const { file, doc } of parsed) {
  for (const { path, call } of collectCalls(doc)) {
    metaCallsScanned++;
    for (const spelling of foldedSpellingsInCall(call, FOLDED_META_SPELLINGS)) {
      err(file, null, foldedCallMessage(path, call, spelling, CANONICAL_META_SINGULAR.get(spelling)));
    }
  }
}

// The reverse direction, once every area has been walked — a recipe may be
// referenced from any area, so like the resolve above it cannot be judged
// until the whole ledger has been read. Reported against the file that OWNS
// the recipe, with no item id: an unreferenced recipe is an area-level fact,
// and the item that would fix it does not exist yet.
for (const { area, recipe } of unreferencedRecipes(recipesByArea, referencedByArea, danglingRefs)) {
  err(`${area}.json`, null, unreferencedRecipeMessage(area, recipe));
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

// Trap vocabulary, the other direction. Bidirectional on purpose, mirroring
// the coverage ratchet's UNCLASSIFIED/ORPHAN pair: a documented trap nobody
// lists is a definition the runner is never asked to rule out, and the usual
// reason for one is that the item carrying it was retyped or retired.
const usedTraps = new Set();
for (const { item } of allItems) {
  if (!Array.isArray(item.traps)) continue;
  for (const t of item.traps) if (typeof t === 'string' && t.trim()) usedTraps.add(t.trim());
}
for (const t of TRAPS) {
  if (!usedTraps.has(t)) {
    err(
      'RUNNER.md',
      null,
      `\`${TRAP_HEADING}\` documents \`${t}\` but no checklist item lists it — put it on the items it protects, or drop the row; a definition nothing points at is one no run will ever rule out`,
    );
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
        const statusOf = (id) => allItems.find((r) => r.item.id === id)?.item.status;
        const { problems, bearing } = coverageEntryProblems(entry.items, statusOf);
        for (const msg of problems) err('coverage.json', kind, msg);
        if (bearing > 0) mappedCount++;
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

// ── The symbol-anchor sweep ─ ONE call into the registered corpus ───────
//
// ⛔ There is no loop over family files here any more, and no detector: the
// walk, the extraction and the verdict are all `scripts/symbol-anchors.mjs`'s,
// reached through the `CORPUS` registration above. What stays local is what is
// genuinely this corpus's own — the closed #16898 residual, and the per-file
// shrink-never floor — and both are keyed off what the sweep reports.
//
// ⭐ ONE call, and it now carries BOTH limbs. The line-citation loop that used
// to stand beside this one is gone with its grammar (#18592): a surviving
// `file:line`, a bare `:NNN` continuation and an `L` pin all arrive here as
// `line-anchor` findings from the same sweep, reported below with every other
// finding kind. Two walkers over one corpus became one.
const sweep = sweepCorpus(CORPUS, ROOT);

// The population the sweep walked, held against the one `familyFiles` walks.
// ⚠️ The second walker is no longer a second GRADER — the line-citation limb
// that owned one went into the registration at #18592 — but `familyFiles` is
// still walked for the ledger's own structural checks, and two walkers that
// silently disagree about the POPULATION is drift of its own. So they are
// compared on every run rather than assumed equal: a `docPattern` or an
// `excludeDirs` that stops matching shows up here as a number, not as a
// quietly smaller sweep.
const familyPopulation = familyFiles(CHECKLIST_DIR);
if (sweep.counts.docs !== familyPopulation.length) {
  err(
    'docs/qa/platform-checklist',
    null,
    `CORPUS POPULATION DISAGREES — the registered corpus swept ${sweep.counts.docs} document(s) but \`familyFiles\` walks ${familyPopulation.length}.`
      + ' One of the two stopped reaching part of the family, and a sweep that reads fewer files than it did yesterday reports fewer problems for exactly the wrong reason.'
      + ' Reconcile `CORPUS` (`docRoots` / `docPattern` / `excludeDirs`) with `familyFiles`.',
  );
}

const anchorCounts = new Map();
let anchorsScanned = 0;
let anchorsResolved = 0;
let anchorsResidual = 0;
const residualFired = new Set();
const relToChecklist = (doc) => relative(CHECKLIST_REL, doc);

// Resolved, per family file, straight out of the sweep's per-document counts.
for (const [doc, c] of sweep.byDoc) {
  const rel = relToChecklist(doc);
  anchorsScanned += c.symbol;
  anchorsResolved += c.declaration + c.literal;
  anchorCounts.set(rel, c.declaration + c.literal);
}

for (const f of sweep.findings) {
  const rel = relToChecklist(f.doc);
  if (f.kind === 'unresolved-symbol') {
    const anchor = `${f.path}#${f.symbol}`;
    // On the measured residual? Then this is one of the 56 the binding
    // withdrew (#16898) — recorded, counted apart from `resolved`, and NOT a
    // red. Anything else that fails to resolve is an ordinary red, which is
    // what keeps the ledger closed instead of permissive.
    if (SHARED_RESOLVER_RESIDUAL_INDEX.has(residualKey(rel, anchor))) {
      residualFired.add(residualKey(rel, anchor));
      anchorsResidual += 1;
      // The floor's population is every anchor this gate holds BOUND — resolved
      // plus the named residual. ⛔ That is deliberately not the same number as
      // `resolved`, and the console line prints both so the coverage claim stays
      // honest: folding the residual in silently is the exact move this card
      // exists to undo, and no floor in the maintainer-only baseline is touched.
      anchorCounts.set(rel, (anchorCounts.get(rel) ?? 0) + 1);
      continue;
    }
    err(rel, null, `ABSENT SYMBOL — \`${anchor}\`: ${(f.absent ?? []).map((x) => `\`${x}\``).join(' and ')} ${(f.absent ?? []).length > 1 ? 'are' : 'is'} not declared in ${f.path} by \`scripts/symbol-anchors.mjs#symbolResolutionClass\` — no declaration site and no complete quoted string token, comments stripped. A call site, an import, a member access or a substring of a longer string is NOT resolution. Re-point the anchor at what the file declares now, or drop the \`#symbol\` half and cite the file bare. ⛔ Do not widen the RESOLUTION RULE in \`scripts/symbol-anchors.mjs\` to make this green: it is shared with four other corpora.`);
    continue;
  }
  if (f.kind === 'unresolved-path') {
    err(rel, null, `ANCHOR FILE NOT FOUND — \`${f.raw}\`: ${f.path} is not a tracked file in this repo. A path this gate cannot open is not an anchor; a sibling-repo citation stays BARE or carries its \`<repo>:\` prefix, and a moved file needs the pin re-pointed.`);
    continue;
  }
  if (f.kind === 'line-anchor' || f.kind === 'bad-exemption') {
    err(rel, null, `${f.kind === 'bad-exemption' ? 'BAD ANCHOR EXEMPTION' : 'LINE ANCHOR'} — \`${f.raw}\` at line ${f.line}: ${f.detail}`);
    continue;
  }
  if (f.soft) continue; // cross-repo with no checkout — reported by the sweep, never red
  err(rel, null, `${f.kind} — \`${f.raw}\` at line ${f.line}: ${f.detail}`);
}

// A residual row that did not fire has been repaired, re-authored or removed —
// and a ledger that outlives its defect is a standing excuse for whatever
// anchor next happens to match it. Deleting the row is the remedy.
for (const r of SHARED_RESOLVER_RESIDUAL) {
  if (residualFired.has(residualKey(r.doc, r.anchor))) continue;
  err(r.doc, null, `STALE RESIDUAL ROW — \`${r.anchor}\` no longer fails to resolve here (repaired, re-authored, or gone). Delete its row from \`SHARED_RESOLVER_RESIDUAL\` in this file, in the same edit; the ledger is shrink-only and every row must fire.`);
}
if (SHARED_RESOLVER_RESIDUAL.length > SHARED_RESOLVER_RESIDUAL_CEILING) {
  console.error(`check-platform-checklist: SHARED_RESOLVER_RESIDUAL carries ${SHARED_RESOLVER_RESIDUAL.length} rows but the grow-never ceiling is ${SHARED_RESOLVER_RESIDUAL_CEILING}.`);
  console.error('\nThis is a REFUSAL, not a pass: a residual that can grow is the permissive rule coming back one row at a time. Rows leave by repairing the citation, never by raising this number.');
  process.exit(1);
}

// The census mode: how the baseline beside this gate is authored, and the one
// answer to "what would the floor be if I measured it now". Read-only and
// explicitly NOT a verdict — a gate that regenerated its own ratchet would
// edit the tree and report nothing (the house rule the spec wrapper states).
if (process.argv.slice(2).includes('--anchor-census')) {
  const census = {};
  for (const [rel, n] of [...anchorCounts].sort(([a], [b]) => a.localeCompare(b))) if (n > 0) census[rel] = n;
  console.log(JSON.stringify(census, null, 2));
  console.error(`\ncheck-platform-checklist --anchor-census: ${anchorsResolved}/${anchorsScanned} anchors resolved through \`scripts/symbol-anchors.mjs#symbolResolutionClass\`, plus ${anchorsResidual} on the named residual, across ${Object.keys(census).length} family files. ⚠️ The per-file counts printed above are the FLOOR population (resolved + residual), which is what the baseline beside this gate pins; they are NOT a coverage figure on their own. This is a CENSUS, not a verdict — run the gate with no flags for that.`);
  process.exit(0);
}

// The floor. Read as a REFUSAL when it is missing: with no baseline every
// count validates against nothing and this limb prints the same green it
// printed before it existed.
if (!existsSync(ANCHOR_FLOOR_FILE)) {
  console.error('check-platform-checklist: missing scripts/checklist-symbol-anchor-baseline.json — the per-file symbol-anchor floor.');
  console.error('\nThis is a REFUSAL, not a pass: with no floor, a ledger emptied of every anchor would validate against nothing and report zero problems.');
  process.exit(1);
}
let anchorFloors;
try {
  const baseline = JSON.parse(readFileSync(ANCHOR_FLOOR_FILE, 'utf8'));
  anchorFloors = baseline?.floors;
  if (!anchorFloors || typeof anchorFloors !== 'object' || Array.isArray(anchorFloors)) throw new Error('no "floors" object');
  if (Object.keys(anchorFloors).length < ANCHOR_FLOOR_ROSTER_FLOOR) {
    throw new Error(`"floors" declares ${Object.keys(anchorFloors).length} files but the roster floor is ${ANCHOR_FLOOR_ROSTER_FLOOR}`);
  }
} catch (e) {
  console.error(`check-platform-checklist: cannot read the symbol-anchor floor — ${e.message}`);
  console.error('\nThis is a REFUSAL, not a pass: an unreadable or gutted floor is indistinguishable from a ledger that legitimately shrank.');
  process.exit(1);
}
for (const problem of anchorFloorProblems(anchorCounts, anchorFloors)) err(problem.file, null, problem.message);

if (errors.length) {
  console.error(`check-platform-checklist: ${errors.length} problem(s)\n`);
  for (const e of errors) console.error(`  ✗ ${e}`);
  console.error('\nContract: docs/qa/platform-checklist/README.md (authoring) · RUNNER.md (execution).');
  process.exit(1);
}

const total = allItems.length;
const active = allItems.filter(({ item }) => item.status === 'active').length;
// Printed beside `active` so the ledger's implementation status is visible from
// the gate itself, not only from `pnpm gen:checklist-status`. A planned count
// that climbs while `active` stands still is the ledger doing its job; one that
// climbs while coverage stays green would be this gate failing at its.
const planned = allItems.filter(({ item }) => item.status === 'planned').length;
// Counted, not inferred. On this path it necessarily equals `recipeTotal` —
// an unreferenced recipe would have exited above — but a line that RESTATES a
// constant reports nothing, and this direction's whole risk is a green that
// looks the same whether it ran or not.
const recipesReferenced = [...recipesByArea].reduce((n, [area, keys]) => n + keys.filter((k) => referencedByArea.get(area)?.has(k)).length, 0);
console.log(
  `check-platform-checklist: OK — ${files.length} areas, ${total} items (${active} active, ${planned} planned); coverage: ${mappedCount} kinds mapped, ${waivedCount} waived;` +
    ` traps: ${TRAPS.size} documented, ${usedTraps.size} in use;` +
    ` provisioning: ${recipeTotal} area recipes, ${recipeRefs} item references resolved (${qualifiedRefs} area-qualified), ${recipesReferenced}/${recipeTotal} recipes referenced;` +
    ` meta-URL spelling: ${metaCallsScanned} \`call\` strings scanned against ${FOLDED_META_SPELLINGS.size} folded spellings;` +
    ` line citations: 0 survive across ${sweep.counts.docs} swept documents — \`file:line\`, a bare \`:NNN\` continuation and an \`L\` pin are all judged by \`symbol-anchors.mjs\`, through the same registration;` +
    ` symbol anchors: ${anchorsResolved}/${anchorsScanned} resolved by \`symbol-anchors.mjs\` (the ONE resolver, reached as a REGISTERED corpus) across ${sweep.counts.docs} swept documents against ${sweep.counts.citedSources} cited sources` +
    `, ${anchorsResidual} on the named #16898 residual, ${Object.keys(anchorFloors).length} file floors held;` +
    ` (self-checks: ${trapControl.checked} trap-vocabulary + ${provisioningControl.checked} provisioning-resolve + ${unreferencedControl.checked} unreferenced-recipe + ${metaCallControl.checked} meta-call-spelling + ${citationControl.checked} line-citation-binding + ${symbolAnchorControl.checked} symbol-anchor + ${plannedStatusControl.checked} planned-status assertions).`,
);
