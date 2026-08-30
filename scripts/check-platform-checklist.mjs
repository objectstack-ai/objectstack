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
//   - and no `call` string — the one field in this ledger a runner REPLAYS —
//     instructs a `/meta/<plural>` URL spelling the boundary merely folds.
//     `call` ONLY: the fields beside it legitimately quote plural spellings to
//     narrate the fold (see the meta-URL block below, which also explains why
//     the fold itself is not this gate's to narrow).
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
// on a PR would ever reach a `--self-test` leg. NOT because its `pnpm` alias is
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

  return { checked, failures };
}

if (process.argv.slice(2).includes('--self-test')) {
  const trap = selfTestTrapVocabulary();
  const prov = selfTestProvisioningUse();
  const unref = selfTestUnreferencedRecipes();
  const metaCall = selfTestMetaCallSpelling();
  const failures = [...trap.failures, ...prov.failures, ...unref.failures, ...metaCall.failures];
  if (failures.length === 0) {
    console.log(
      `✓ check-platform-checklist --self-test: ${trap.checked + prov.checked + unref.checked + metaCall.checked} assertions — the trap-table extractor reads a good table and REFUSES an empty/renamed/reshaped one;` +
        ' `fixtures.provisioning.use` resolves both spellings (own-area key and `<area>:<recipe>`) and fires on all three dangling shapes;' +
        ' the unreferenced-recipe direction fires on a recipe nobody uses while leaving a cross-area consumer, a retired consumer and a `$`-annotation alone;' +
        ' and the `/meta` call-spelling refusal reads its vocabulary out of the live generated contract, fires on every folded spelling a `call` can instruct, and stays silent on the canonical singular, on parameter placeholders, and on the `why`/`expect`/`source`/`requires` prose that narrates the fold.',
    );
    process.exit(0);
  }
  console.error(`✗ check-platform-checklist --self-test — ${failures.length} failure(s)\n`);
  for (const f of failures) console.error(`  • ${f}`);
  process.exit(1);
}

// The extractor's own positive control, before it is trusted with anything.
const trapControl = selfTestTrapVocabulary();
if (trapControl.failures.length) {
  console.error("check-platform-checklist: the trap-vocabulary extractor's own positive control FAILED — this check cannot be trusted, and a green from it would mean nothing.\n");
  for (const f of trapControl.failures) console.error(`  ✗ ${f}`);
  process.exit(1);
}

// Same, for the provisioning resolve: a green from a check that cannot fire is
// indistinguishable from the green this gate printed before it existed.
const provisioningControl = selfTestProvisioningUse();
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
if (metaCallControl.failures.length) {
  console.error("check-platform-checklist: the `/meta` call-spelling refusal's own positive control FAILED — an executable step instructing a folded plural spelling would pass unreported, which is the exact defect this check was added to close.\n");
  for (const f of metaCallControl.failures) console.error(`  ✗ ${f}`);
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
// Counted, not inferred. On this path it necessarily equals `recipeTotal` —
// an unreferenced recipe would have exited above — but a line that RESTATES a
// constant reports nothing, and this direction's whole risk is a green that
// looks the same whether it ran or not.
const recipesReferenced = [...recipesByArea].reduce((n, [area, keys]) => n + keys.filter((k) => referencedByArea.get(area)?.has(k)).length, 0);
console.log(
  `check-platform-checklist: OK — ${files.length} areas, ${total} items (${active} active); coverage: ${mappedCount} kinds mapped, ${waivedCount} waived;` +
    ` traps: ${TRAPS.size} documented, ${usedTraps.size} in use;` +
    ` provisioning: ${recipeTotal} area recipes, ${recipeRefs} item references resolved (${qualifiedRefs} area-qualified), ${recipesReferenced}/${recipeTotal} recipes referenced;` +
    ` meta-URL spelling: ${metaCallsScanned} \`call\` strings scanned against ${FOLDED_META_SPELLINGS.size} folded spellings;` +
    ` (self-checks: ${trapControl.checked} trap-vocabulary + ${provisioningControl.checked} provisioning-resolve + ${unreferencedControl.checked} unreferenced-recipe + ${metaCallControl.checked} meta-call-spelling assertions).`,
);
