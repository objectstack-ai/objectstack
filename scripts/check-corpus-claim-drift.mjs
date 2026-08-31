#!/usr/bin/env node
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// check-corpus-claim-drift — a shrink-only LEXICAL anti-drift ratchet over the
// teaching corpus (#13582).
//
//   node scripts/check-corpus-claim-drift.mjs
//   node scripts/check-corpus-claim-drift.mjs --list        # every claim site it can see
//   node scripts/check-corpus-claim-drift.mjs --update      # ⛔ MAINTAINER-ONLY, see below
//   node scripts/check-corpus-claim-drift.mjs --self-test   # verify the checker's own rules
//
// ## The defect class, and the half of it that IS mechanical
//
// #13539 taught that `$exists` is a key-presence test. It is not: it asks
// whether the field HAS A VALUE. The claim was false in `content/docs` and in
// two `skills/**` files, it shipped to customers, and it was found by a person
// reading it.
//
// #13539 recorded that no gate could have caught it, "because the teaching
// corpus does not execute". #13582 tested that rather than accepting it, and it
// splits in two:
//
//   TRUE AS STATED. The one gate that reads the offending block —
//   `packages/spec/scripts/check-skill-examples.ts`, via `os:check` — type-checks
//   the TypeScript inside a fenced example against the live spec. The false line
//   was a `//` COMMENT INSIDE an `os:check` block: the gate ran on that exact
//   block, reported it green, and was structurally blind to the sentence beside
//   the code. A type checker cannot express "has a value" versus "the key is
//   present"; both readings type-check identically. The markdown table rows that
//   carried the same claim are not code at all.
//
//   FALSE AS A LIMIT. The recurring failure is narrower than "prose disagrees
//   with behaviour", and the narrow version is mechanical: the CO-OCCURRENCE of
//   an operator's spelling with phrasing naming a semantic the platform does not
//   implement. That is a lexical property, and this gate is it.
//
// ## Why CO-OCCURRENCE, and not a phrase ban
//
// Measured on the corpus this gate walks. "field exists", "existence check" and
// "key exists" are ordinary, correct English in this repo — metadata field
// existence (`content/docs/automation/hooks.mdx`), a cache `has()` probe
// (`content/docs/kernel/contracts/cache-service.mdx`), a uniqueness rule
// (`skills/objectstack-data/rules/validation.md`), and the formula gotcha the
// dispatch named: `has(record.x)` in `skills/objectstack-formula/SKILL.md` and
// `content/docs/data-modeling/formulas.mdx` IS a genuine key-existence check and
// must stay green.
//
// A phrase ban reddens every one of those on day one. Requiring the operator's
// spelling WITHIN A WINDOW keeps them green STRUCTURALLY — none of those files
// mentions `$exists` at all, so none of them needs a baseline row to survive.
// That is a better outcome than baselining them: a baselined file carries a
// budget forever, and a file that never enters the ledger cannot have its budget
// silently spent by a later edit.
//
// ## The WINDOW, and why it is not one line
//
// The measured defect had the false sentence and the operator on ADJACENT lines:
//
//     // Field exists (NoSQL)
//     where: { metadata: { $exists: true } }
//
// so a line-scoped rule would have missed the very site this gate exists for.
// The window is per-row and defaults to 4 lines, which covers a wrapped
// sentence-pair. Swept over today's corpus at 1, 2, 4, 6, 8, 12, 20 and 40
// lines: every width from 1 to 20 yields the IDENTICAL ledger (2 files, 4 claim
// sites) and the first extra site appears only at 40, where a `$exists` in a
// troubleshooting page reaches an unrelated sentence. So 4 sits with ~5x margin
// below the nearest measured noise, and the number is a decision with evidence
// rather than a guess.
//
// ## Table-driven, and deliberately NOT filled
//
// Triage ruling on #13582: build a TABLE, not a second hardcoded regex — the
// same shape must later be able to catch the retired `$regex` spelling and
// #13532's `visibleWhen` assertions. `scripts/check-role-word.mjs` is this
// gate's shape precedent in every other respect, and its one shortcoming is
// exactly this: its `WORD` is a module-level single regex, so a second term
// there is a change to its shape rather than a row in a table.
//
// ⛔ The same ruling bounds it: ship the `$exists` family ONLY. Each further
// word pays its own baseline on its own card, because a row is only as good as
// the legitimate usages someone measured before adding it. `VOCABULARY` holds
// exactly one row and a self-test assertion pins that, so filling the table is a
// deliberate, reviewable edit and never a drive-by.
//
// The genericity is proven WITHOUT shipping a second word: every engine function
// takes the table as a parameter, and `--self-test` drives a SYNTHETIC second
// row through all of them. A table nothing but one row ever reached would be a
// single regex wearing a table's clothes.
//
// ## Not restricted to prose
//
// This gate reads whole files, code fences included, because the site `os:check`
// ran green over was a comment INSIDE a fence. There is deliberately no fenced
// exemption here — the fence is where the miss happened.
//
// ## Roots
//
// `content/docs` and `skills` — the corpus an AI author reads the contract from.
// Generated `references/` is skipped: the spec source is the fix site there, so
// a finding in a generated file names the wrong file. ⚠️ One of these roots is
// `skills/**`, a `domain:skills` surface; ownership of THIS gate stays
// `domain:devx` per the #13582 triage ruling, because its subject is the factual
// correctness of teaching text, not the governance of an agent instruction face.

import { spawnSync } from 'node:child_process';
import {
  readdirSync, readFileSync, writeFileSync, statSync, existsSync,
  mkdirSync, mkdtempSync, rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOTS = ['content/docs', 'skills'];
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'references']);
const EXTENSIONS = new Set(['.mdx', '.md']);
const BASELINE_PATH = 'scripts/corpus-claim-drift-baseline.json';

/**
 * THE TABLE. One row per spelling whose neighbouring claims are pinned.
 *
 * Every field is read by the engine and by the diagnostics, so a new row gets a
 * correct message for free — which is the whole point of the shape. Fields:
 *
 *   id       stable ledger key. Never renamed without an `--update`.
 *   subject  the spelling, for humans.
 *   spelling the operator/key regex. A site needs this WITHIN `window` lines.
 *   claims   the phrasings that contradict `truth`. Joined into ONE alternation
 *            so overlapping members ("field existence" inside "existence")
 *            consume one span and count ONE site, not three.
 *   window   max line distance between a claim and the nearest spelling.
 *   truth    what the platform actually does. Printed in every diagnostic, so an
 *            author meeting this gate is told the correct semantic, not just
 *            that a word is banned.
 *   refs     where the truth was established.
 *
 * ⛔ Adding a row here is a card of its own (#13582's triage ruling). A row
 * costs a measured survey of the LEGITIMATE usages of its claims, and a row
 * added without one turns this into a noise gate.
 */
const VOCABULARY = [
  {
    id: 'exists-key-presence',
    subject: '`$exists`',
    spelling: /\$exists\b/,
    claims: [
      /\bexistence\b/,
      /\b(?:field|key|property|attribute)s?\s+exists?\b/,
      /\bkey[-\s]presence\b/,
      /\bpresence\s+of\s+the\s+keys?\b/,
      /\bmongo(?:db)?(?:'s)?[^\n]{0,24}\$exists/,
    ],
    window: 4,
    truth:
      '`$exists` asks whether the field HAS A VALUE, never whether the key is present. '
      + '`{ $exists: true }` compiles to `IS NOT NULL` and `{ $exists: false }` to `IS NULL` — '
      + 'the exact inverse of `$null`, and portable rather than NoSQL-only. On MongoDB the '
      + 'driver lowers it to `{ $ne: null }` / `{ $eq: null }` and never emits MongoDB\'s own '
      + '`$exists`, which WOULD have been key presence and would have kept a null-valued field.',
    refs: '#13539 (the repair) · #13582 (this gate)',
  },
];

/**
 * The half of ROOTS that `scripts/pm/dispatch-gates.mjs` cannot see, written in
 * the subtree spelling that tool compares in. Provenance ONLY: nothing in this
 * gate reads this list.
 *
 * That tool builds a dispatch's gate list by scanning each gate's source for the
 * path literals it operates on, and "looks like a path" there means "carries a
 * separator". `content/docs` has one; `skills` does not, so without this
 * declaration a skills-only card would never be told this gate reads its files —
 * `check-role-word.mjs` paid one repair round for exactly that (PR #10038) and
 * carries the identical declaration for the identical reason.
 *
 * Spelled as a LITERAL array, never computed from ROOTS: the extractor reads
 * SOURCE TEXT, so `ROOTS.map((r) => ...)` contributes nothing while every
 * runtime assertion about the value stays green. `check-watch-hint-literal`
 * enforces that; the self-test below pins the coupling in both directions.
 */
const ROOT_DIR_WATCH_HINTS = ['skills/**'];

/** Kept identical to the other gates' token so the convention is greppable. */
const RATCHET_AUTHORITY_MARKER = '⛔ MAINTAINER-ONLY';

const update = process.argv.includes('--update');
const list = process.argv.includes('--list');

function walk(dir, out) {
  for (const e of readdirSync(dir)) {
    if (SKIP_DIRS.has(e)) continue;
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else if ([...EXTENSIONS].some((x) => e.endsWith(x))) out.push(p);
  }
}

/**
 * One alternation per row, built from `claims`.
 *
 * Joined rather than iterated because the members deliberately overlap:
 * "Field existence check" contains BOTH `existence` and, to a reader, the
 * "existence check" phrase. Iterating would count that one claim two or three
 * times and write an inflated number into a shrink-only ledger — a debt the tree
 * can never pay off, because paying it means removing text that is not there.
 * An alternation consumes each span once.
 *
 * @param {{claims: RegExp[]}} rule
 * @returns {RegExp} global, case-insensitive
 */
function claimRegex(rule) {
  return new RegExp(rule.claims.map((c) => c.source).join('|'), 'gi');
}

/**
 * Every claim site in one file, per rule.
 *
 * A SITE is one match of the claim alternation whose line is within
 * `rule.window` lines of a line carrying `rule.spelling`. Counting sites rather
 * than lines keeps the ledger additive: two false claims on one row of a
 * markdown table are two debts, and paying one has to move the number.
 *
 * The table is a PARAMETER, not the module constant, so the self-test can drive
 * a synthetic row through the real engine.
 *
 * @param {string} text
 * @param {typeof VOCABULARY} rules
 * @returns {{hits: Record<string, number>, sites: {ruleId: string, line: number, text: string}[]}}
 */
function analyzeFile(text, rules) {
  const lines = text.split('\n');
  const hits = {};
  const sites = [];
  for (const rule of rules) {
    const spelling = new RegExp(rule.spelling.source, 'gi');
    const spellingLines = [];
    for (let i = 0; i < lines.length; i++) {
      spelling.lastIndex = 0;
      if (spelling.test(lines[i])) spellingLines.push(i);
    }
    if (spellingLines.length === 0) continue;
    const claim = claimRegex(rule);
    for (let i = 0; i < lines.length; i++) {
      claim.lastIndex = 0;
      let m;
      while ((m = claim.exec(lines[i])) !== null) {
        // A zero-width match would spin forever. `refuseZeroWidthClaims` makes
        // that unreachable from the table; this is the belt to its braces, and
        // it is here because the failure mode is a hang, not a wrong answer.
        if (m[0] === '') { claim.lastIndex += 1; continue; }
        if (spellingLines.some((t) => Math.abs(t - i) <= rule.window)) {
          hits[rule.id] = (hits[rule.id] ?? 0) + 1;
          sites.push({ ruleId: rule.id, line: i + 1, text: m[0] });
        }
      }
    }
  }
  return { hits, sites };
}

/**
 * Rows whose claim alternation can match the empty string.
 *
 * Table hygiene, checked before anything is scanned: such a row matches at every
 * position of every line and reports the whole corpus. Refused rather than
 * survived, because the ledger it would write is unrecoverable under a
 * shrink-only rule.
 *
 * @param {typeof VOCABULARY} rules
 * @returns {string[]} offending row ids
 */
function zeroWidthClaimRows(rules) {
  return rules.filter((r) => new RegExp(`^(?:${r.claims.map((c) => c.source).join('|')})$`)
    .test('')).map((r) => r.id);
}

/**
 * Rows whose SPELLING appears nowhere in the corpus that was read.
 *
 * A row that cannot fire is a declaration that silently self-cancels: if
 * `$exists` were renamed or retired, this row would report green forever while
 * checking nothing, and no run would say so. That is the #4690 shape — "the scan
 * found nothing wrong" standing in for "the scan reads nothing" — and it is
 * refused here for the same reason a missing ROOT is.
 *
 * Retiring a spelling is therefore a deliberate edit to `VOCABULARY`, which is
 * the correct place for that decision to be visible.
 *
 * @param {typeof VOCABULARY} rules
 * @param {{text: string}[]} corpus
 * @returns {string[]} row ids with no reachable subject
 */
function unreachableRows(rules, corpus) {
  return rules.filter((rule) => {
    const spelling = new RegExp(rule.spelling.source, 'i');
    return !corpus.some((f) => spelling.test(f.text));
  }).map((r) => r.id);
}

/** Which configured roots are absent, in ROOTS order. `exists` is injected for the self-test. */
function missingRoots(roots, exists = existsSync) {
  return roots.filter((r) => !exists(r));
}

function missingRootsMessage(missing) {
  return (
    `check-corpus-claim-drift: configured root(s) not found — ${missing.join(', ')}. REFUSING to `
    + 'reach a verdict. A directory named in ROOTS is a declaration that it is in scope, so a scan '
    + 'that could not read it has not checked what this gate says it checks, and any verdict over '
    + 'the roots that DID resolve — OK included — would be about a population nobody configured. '
    + 'Every ROOT resolves against the CURRENT WORKING DIRECTORY, so the usual cause is running '
    + 'this from somewhere other than the repository root: run `pnpm check:corpus-claim-drift` '
    + 'from there. The same refusal covers `--update`, where the stake is higher: it rewrites the '
    + 'baseline from the tree it just read, so over a dead scan it would write an empty one and '
    + 'report it exactly like a debt fully paid.'
  );
}

function unreachableRowsMessage(ids) {
  return (
    `check-corpus-claim-drift: VOCABULARY row(s) whose subject appears nowhere in the corpus — `
    + `${ids.join(', ')}. REFUSING to reach a verdict. A row whose spelling cannot be found checks `
    + 'nothing, and would report green forever while doing so. If the spelling was retired or '
    + 'renamed, retire or rename the row in scripts/check-corpus-claim-drift.mjs — that decision '
    + 'belongs in the table, where review can see it, not in a silent green.'
  );
}

function zeroWidthClaimsMessage(ids) {
  return (
    `check-corpus-claim-drift: VOCABULARY row(s) whose claims can match the EMPTY STRING — `
    + `${ids.join(', ')}. REFUSING to reach a verdict. Such a row matches at every position of `
    + 'every line, so it would report the whole corpus as debt and write that into a shrink-only '
    + 'ledger. Anchor the claim on real text.'
  );
}

/**
 * The NEW-claim verdict, named and pure so the self-test can assert on the exact
 * string an author reads.
 */
function newClaimMessage(file, rule, count) {
  return (
    `${file}: NEW claim site(s) beside ${rule.subject} — ${count}, rule "${rule.id}". `
    + `${rule.truth} (${rule.refs}). Reword the sentence so it states what the operator does. `
    + 'That is the fix, and it is yours to take. '
    + `${RATCHET_AUTHORITY_MARKER}, NOT a co-equal second option: if the wording is genuinely `
    + 'correct beside this spelling, add it to '
    + `${BASELINE_PATH} by running \`node scripts/check-corpus-claim-drift.mjs --update\`. The `
    + 'gated thing is that ACT, not the file — `--update` rewrites the whole baseline from the '
    + 'current tree, so it admits your site and re-baselines every other file in one stroke. The '
    + 'baseline is shrink-only, so this weakens a ratchet and needs a maintainer to agree the '
    + 'wording is true first — do not take this path to get CI green.'
  );
}

/**
 * The count-GREW verdict. Deliberately offers NO baseline path: the author has a
 * real remedy of their own (reword), so dragging the maintainer-only label onto
 * this message would teach that the ledger is the normal answer.
 */
function grewMessage(file, rule, allowed, count) {
  return (
    `${file}: claim sites beside ${rule.subject} grew ${allowed} → ${count} (rule "${rule.id}"). `
    + `New ones are banned. ${rule.truth} (${rule.refs}). Reword the new sentence so it states `
    + 'what the operator does; the baselined sites are pre-existing wording, not budget.'
  );
}

/** The improvement verdict. Ratcheting DOWN is squarely the author's job. */
function improvedMessage(file, rule, allowed, count) {
  return (
    `${file}: claim sites beside ${rule.subject} improved ${allowed} → ${count} (rule `
    + `"${rule.id}") — ratchet DOWN: run \`node scripts/check-corpus-claim-drift.mjs --update\` `
    + 'and commit the baseline.'
  );
}

/**
 * The input volume, PER ROOT. A number derived from the ledger cannot tell a
 * reader whether the population moved underneath it, and a root that exists and
 * contributes nothing is invisible in a bare total.
 */
function scanClause(scanned) {
  const total = scanned.reduce((n, r) => n + r.files, 0);
  const kinds = [...EXTENSIONS].sort().join('/');
  const perRoot = scanned.map((r) => `${r.root} ${r.files}`).join(', ');
  return `${total} ${kinds} file(s) read across ${scanned.length} root(s) — ${perRoot}`;
}

/**
 * What the TABLE reached, per row. A green run over a row that matched nothing
 * reads identically to a green run over a row that matched and was clean, and
 * those are different facts.
 */
function rulesClause(rules, ledger) {
  return rules.map((r) => {
    const n = Object.values(ledger).reduce((s, per) => s + (per[r.id] ?? 0), 0);
    return `${r.id} ${n}`;
  }).join(', ');
}

function successSummary(scanned, ledger, rules) {
  const fileCount = Object.keys(ledger).length;
  return (
    'check-corpus-claim-drift: OK, no new claim sites beside a pinned spelling.\n'
    + `  Scanned: ${scanClause(scanned)}.\n`
    + `  Rules:   ${rules.length} row(s) — ${rulesClause(rules, ledger)}.\n`
    + `  Ledger:  ${fileCount} baselined file(s) in ${BASELINE_PATH}.`
  );
}

function updateSummary(scanned, ledger, rules) {
  return (
    `corpus-claim-drift baseline updated: ${Object.keys(ledger).length} file(s) baselined from `
    + `${scanClause(scanned)}, over ${rules.length} rule row(s) — ${rulesClause(rules, ledger)}.`
  );
}

// ── The ratchet-remedy authority convention (#8435) ──────────────────────────
//
// This gate's second remedy is `--update`, which rewrites the baseline from the
// current tree. That is a shrink-only ratchet, so taking that path WEAKENS the
// gate, and the convention is that such an offer must say in the same breath
// whose path it is. The farm-wide detector
// (`scripts/check-ratchet-remedy-authority.mjs`) asserts the token is PRESENT;
// PLACEMENT is pinned here, against this gate's own message text, because a
// text sweep cannot be sharper than the gate's own assertions.

/**
 * How this gate OFFERS the privileged path, as a detector rather than a string
 * compare, so the self-test can prove it still reaches its subject: a reworded
 * offer that stopped matching would make the placement check pass vacuously.
 *
 * Keyed on the baseline-EXPANDING phrasing, not on `--update` alone: the
 * improvement message also names `--update`, and ratcheting DOWN is squarely the
 * author's job — a detector that caught it would force the maintainer-only
 * marker onto a message where it is actively wrong.
 */
const RATCHET_EXPANSION_OFFER = new RegExp(
  `add it to\\s+${BASELINE_PATH.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`,
);

/** A message handing out the expanding path must name whose path it is. */
function ratchetRemedyCarriesAuthority(message) {
  if (!RATCHET_EXPANSION_OFFER.test(message)) return true;
  return message.includes(RATCHET_AUTHORITY_MARKER);
}

function selfTest() {
  const failures = [];
  const expect = (label, cond) => {
    if (!cond) failures.push(label);
  };
  const RULE = VOCABULARY[0];
  const count = (text, rules = VOCABULARY) => {
    const { hits } = analyzeFile(text, rules);
    return Object.values(hits).reduce((n, c) => n + c, 0);
  };

  // ── The table is a table, and it ships exactly one row (#13582 ruling) ─────
  //
  // Both halves are load-bearing and they pull in opposite directions, which is
  // why they are two assertions and not one. The ruling said BUILD A TABLE (so
  // the next word is a row, not a reshaping) and, in the same breath, ⛔ DO NOT
  // FILL IT (so each word pays its own baseline on its own card). A gate that
  // honoured only the first would grow words by drive-by; one that honoured only
  // the second is a hardcoded regex again.
  expect('#13582 — VOCABULARY ships exactly ONE row, the `$exists` family. Adding a word is a '
    + 'CARD, not an edit: a row is only as good as the survey of legitimate usages someone did '
    + 'before adding it, and this assertion is where that cost is collected',
    VOCABULARY.length === 1 && VOCABULARY[0].id === 'exists-key-presence');
  expect('#13582 — every row carries every field the diagnostics interpolate (a row missing '
    + '`truth` or `refs` renders a message that names a rule and teaches nothing)',
    VOCABULARY.every((r) => r.id && r.subject && r.spelling instanceof RegExp
      && Array.isArray(r.claims) && r.claims.length > 0
      && Number.isInteger(r.window) && r.window >= 0 && r.truth && r.refs));

  // ── Table hygiene: a claim that matches the empty string ───────────────────
  expect('a shipped row cannot match the EMPTY STRING', zeroWidthClaimRows(VOCABULARY).length === 0);
  expect('and the predicate DISCRIMINATES — a row whose claims CAN match empty is caught (without '
    + 'this, the assertion above passes on a predicate that approves everything)',
    zeroWidthClaimRows([{ id: 'zw', claims: [/x?/] }]).join(',') === 'zw');

  // ── THE genericity proof, without shipping a second word ───────────────────
  //
  // The ruling's ⭐ constraint is that the same SHAPE must later take the retired
  // `$regex` spelling and #13532's `visibleWhen` assertions. A table only one row
  // ever reaches is a single regex wearing a table's clothes, and nothing about
  // the shipped row can distinguish the two. So a SYNTHETIC row is driven through
  // the real engine — the same `analyzeFile` the production path calls.
  const SYNTHETIC = {
    id: 'synthetic-probe',
    subject: '`$probeop`',
    spelling: /\$probeop\b/,
    claims: [/\bwidely believed\b/],
    window: 2,
    truth: 'Synthetic. Exists only inside this self-test.',
    refs: '#13582',
  };
  const TWO_ROW = [
    '| `$exists` | Field exists |',
    '',
    'The `$probeop` operator is widely believed to do something.',
    '',
  ].join('\n');
  const twoRow = analyzeFile(TWO_ROW, [RULE, SYNTHETIC]);
  expect('#13582 — the engine reaches a SECOND row it has never seen: both the shipped rule and a '
    + 'synthetic one report their own sites from one pass (this is the assertion that separates a '
    + 'table from a hardcoded regex, and it is why the next word is a row rather than a reshaping)',
    twoRow.hits['exists-key-presence'] === 1 && twoRow.hits['synthetic-probe'] === 1);
  expect('#13582 — and the ledger keys BY ROW, so two rows in one file are two separable debts '
    + '(a single total would make one row\'s repair look like the other\'s regression)',
    Object.keys(twoRow.hits).length === 2);
  // Per-row windows, driven independently on ONE text. A shared module-level
  // window would satisfy every assertion above and fail this one.
  const SPREAD = ['`$probeop` here', '', '', 'a widely believed thing', ''].join('\n');
  expect('#13582 — `window` is read PER ROW: the same text is a site at window 3 and not at '
    + 'window 1',
    count(SPREAD, [{ ...SYNTHETIC, window: 3 }]) === 1
      && count(SPREAD, [{ ...SYNTHETIC, window: 1 }]) === 0);

  // ── The REAL defect, quoted verbatim from the pre-repair tree ──────────────
  //
  // These are the exact lines #13539 repaired (PRs #13577 / #13581), read out of
  // git at `75b3bdc86^` and `e51c78f0c^`. They are the gate's reason to exist, so
  // they are pinned as fixtures rather than described: a rule that stopped
  // catching them would still pass every abstract assertion above.
  const WAS_TABLE_ROW = '| `$exists` | Field exists (NoSQL) | `{ metadata: { $exists: true } }` |';
  const WAS_OSCHECK = [
    '{/* os:check */}',
    '```typescript',
    '// Field exists (NoSQL)',
    'where: { metadata: { $exists: true } }',
    '```',
  ].join('\n');
  const WAS_HTTP = '- `$exists` - Field existence check';
  const WAS_SKILL = '| `$exists` | Field exists (NoSQL) | MongoDB `$exists` |';
  const WAS_FILTERS = '| Existence | `$exists` | (NoSQL) `$exists` | `{ metadata: { $exists: true } }` |';

  // Positive control FIRST: without it a zero from any leg below could be an
  // empty fixture rather than a working rule, which is the shape of green this
  // gate exists to refuse.
  expect('positive control — every pre-repair fixture really does carry the spelling, so a count '
    + 'from it is the rule working and not an empty string',
    [WAS_TABLE_ROW, WAS_OSCHECK, WAS_HTTP, WAS_SKILL, WAS_FILTERS]
      .every((t) => /\$exists\b/i.test(t)));

  expect('#13539 — the markdown table row that taught the false semantic is a site',
    count(WAS_TABLE_ROW) === 1);
  expect('#13539 — THE site os:check ran green over: a `//` comment on the line ABOVE the code. '
    + 'A line-scoped rule would miss exactly this one, which is the reason `window` exists',
    count(WAS_OSCHECK) === 1);
  expect('#13539 — the HTTP protocol bullet ("Field existence check") is ONE site, not two or '
    + 'three: the claim members overlap and the alternation consumes the span once',
    count(WAS_HTTP) === 1);
  expect('#13539 — the shipped skills row is TWO sites: the false gloss and the MongoDB '
    + 'attribution are separate claims, and repairing one must move the number',
    count(WAS_SKILL) === 2);
  expect('#13539 — the `| Existence |` axis label is a site too. The card\'s literal word-face '
    + 'does not name a bare "Existence"; it was added after measuring that it costs ZERO baseline '
    + 'entries on today\'s corpus and catches this fourth false site',
    count(WAS_FILTERS) === 1);

  // The repaired text must be GREEN where it says the true thing without naming
  // the false one, or the gate punishes the repair.
  expect('the repaired table row — the true gloss — is NOT a site',
    count('| `$exists` | Field has a value — the inverse of `$null` | `{ a: { $exists: true } }` |')
      === 0);
  expect('the repaired skills row is NOT a site',
    count('| `$exists` | Has a value | `IS NOT NULL` / `IS NULL` |') === 0);

  // ── The LEGITIMATE usages, measured on the corpus this gate walks ──────────
  //
  // The dispatch named one and warned not to stop there. These are all of them
  // found by sweeping the claim phrases across both roots. Every one is green
  // STRUCTURALLY — none of these files mentions `$exists` — which is a stronger
  // outcome than baselining them: a baselined file carries a budget forever.
  const LEGITIMATE = [
    ['objectstack-formula `has()` — a genuine key-existence check (the one the dispatch named)',
      '`has(record.x)` is **true whenever the key exists**, even when its value is null.'],
    ['content/docs/data-modeling/formulas.mdx — the same gotcha in prose',
      '> **`has()` gotcha:** `has(record.x)` is true whenever the key exists, even'],
    ['kernel/contracts/cache-service.mdx — a cache `has()` probe',
      'Checks if a key exists without retrieving the value.'],
    ['automation/hooks.mdx — metadata field existence, checked on two surfaces',
      '  Field existence is checked on both surfaces, at different strengths: a hook'],
    ['objectstack-data/rules/validation.md — uniqueness is an index concern',
      'with the scope stated, never a script-based existence check'],
    ['api/error-catalog.mdx — a sortable-field remedy',
      '**Fix:** Ensure the field exists and has `sortable: true`.'],
    ['deployment/troubleshooting.mdx — a triage step',
      '1. Verify the field exists on the object'],
    ['protocol/objectui/actions.mdx — an inline column declaration',
      '2. **Inline** — declare `name`, `label`, `type`, etc. directly when no matching field exists.'],
  ];
  for (const [label, text] of LEGITIMATE) {
    expect(`legitimate usage stays GREEN — ${label}`, count(text) === 0);
  }

  // Discrimination. Every green above would also be produced by a rule that
  // never fires, so the SAME formula text with the spelling moved next to it
  // must go red — that is what proves the greens come from the window.
  expect('and the greens come from the WINDOW, not from an inert rule: the very same `has()` '
    + 'sentence goes RED once `$exists` is written beside it',
    count(`${LEGITIMATE[0][1]}\nSee also \`$exists\`.`) === 1);

  // ── Window behaviour, at the boundary ──────────────────────────────────────
  const at = (gap) => ['`$exists`', ...Array(gap).fill(''), 'the field exists'].join('\n');
  expect(`a claim ${RULE.window} lines away is a site, and one ${RULE.window + 1} lines away is `
    + 'not (the boundary is inclusive and it is the shipped row\'s own number)',
    count(at(RULE.window - 1)) === 1 && count(at(RULE.window)) === 0);

  // ── Overlapping claim members are ONE site ────────────────────────────────
  expect('"Field existence check" beside the spelling is ONE site: `existence`, the '
    + '`field exists` shape and the phrase overlap, and counting each would write an inflated '
    + 'number into a ledger that is only allowed to shrink',
    count('`$exists` — Field existence check for a key') === 1);

  // ── A row whose subject is unreachable is REFUSED, not silently green ──────
  const CORPUS_WITH = [{ text: 'uses `$exists` somewhere' }];
  const CORPUS_WITHOUT = [{ text: 'no operator here at all' }];
  expect('a row whose SPELLING appears nowhere in the corpus is reported (a row that cannot fire '
    + 'reports green forever while checking nothing)',
    unreachableRows(VOCABULARY, CORPUS_WITHOUT).join(',') === 'exists-key-presence');
  expect('and the probe DISCRIMINATES — a corpus that does carry the spelling reports nothing '
    + '(without this, the assertion above passes on a probe that reports everything)',
    unreachableRows(VOCABULARY, CORPUS_WITH).length === 0);
  expect('the refusal names the row', unreachableRowsMessage(['exists-key-presence'])
    .includes('exists-key-presence'));

  // ── The green body reports what was READ, not what the ledger holds ────────
  //
  // Synthetic fixtures, closed over by every assertion, so they stay correct
  // however the real corpus moves. ⛔ Do not "refresh" them against a live scan.
  const SCANNED = [{ root: 'content/docs', files: 189 }, { root: 'skills', files: 36 }];
  const DEAD_SCAN = [{ root: 'content/docs', files: 0 }, { root: 'skills', files: 0 }];
  const PAID_OFF = {};
  const greenPaid = successSummary(SCANNED, PAID_OFF, VOCABULARY);
  const greenDead = successSummary(DEAD_SCAN, PAID_OFF, VOCABULARY);
  expect('#9910 — with the ledger EMPTY (the state this ratchet is BUILT to reach), a scanned '
    + 'tree and an unscanned one do not print the same success',
    greenPaid !== greenDead);
  expect('#9910 — an unscanned tree prints a ZERO input volume a reader can act on',
    /\b0 [^\n]*file\(s\) read\b/.test(greenDead));
  expect('#9910 — a scanned tree prints its real input volume, not a ledger-derived count',
    /\b225 [^\n]*file\(s\) read\b/.test(greenPaid));
  const oneRootGone = successSummary(
    [{ root: 'content/docs', files: 189 }, { root: 'skills', files: 0 }], PAID_OFF, VOCABULARY);
  expect('#9910 — a root that contributed NOTHING is still named, with its zero',
    /\bskills 0\b/.test(oneRootGone) && oneRootGone !== greenPaid);
  expect('#9910 — the --update confirmation states its input volume too, so re-baselining over a '
    + 'dead scan cannot read like a debt fully paid',
    updateSummary(DEAD_SCAN, PAID_OFF, VOCABULARY) !== updateSummary(SCANNED, PAID_OFF, VOCABULARY));
  // The per-ROW tally: a row that matched nothing and a row that matched and was
  // clean are different facts, and a bare total tells them apart in neither
  // direction.
  const LEDGER_ONE = { 'a.mdx': { 'exists-key-presence': 3 } };
  expect('the green body publishes a PER-ROW tally, so a row sitting at zero is visible rather '
    + 'than hidden inside a total',
    successSummary(SCANNED, PAID_OFF, VOCABULARY)
      !== successSummary(SCANNED, LEDGER_ONE, VOCABULARY));

  // ── The #8435 authority convention, PLACEMENT ─────────────────────────────
  const newClaim = newClaimMessage('content/docs/example.mdx', RULE, 2);
  const grew = grewMessage('content/docs/example.mdx', RULE, 4, 5);
  const improved = improvedMessage('content/docs/example.mdx', RULE, 4, 2);
  expect('#8435 — the ratchet-offer DETECTOR still matches the NEW-claim message (else the check '
    + 'below is vacuous)', RATCHET_EXPANSION_OFFER.test(newClaim));
  expect(`#8435 — the NEW-claim message marks the baseline path ${RATCHET_AUTHORITY_MARKER}`,
    ratchetRemedyCarriesAuthority(newClaim));
  const unmarkedOffer = `example.mdx: NEW claim. add it to ${BASELINE_PATH} with --update.`;
  if (!RATCHET_EXPANSION_OFFER.test(unmarkedOffer)) {
    expect('#8435 — the synthetic unmarked-offer fixture is no longer recognised as an offer, so '
      + 'it cannot test discrimination at all. Re-spell it to match RATCHET_EXPANSION_OFFER', false);
  } else {
    expect('#8435 — ratchetRemedyCarriesAuthority() REJECTS an offer carrying no marker (proves '
      + 'the predicate discriminates rather than approving everything)',
      !ratchetRemedyCarriesAuthority(unmarkedOffer));
  }
  expect('#8435 — the count-GREW message offers no baseline expansion, so it needs no '
    + 'maintainer-only marker (the remedy it names — reword — is the author\'s own)',
    !RATCHET_EXPANSION_OFFER.test(grew) && ratchetRemedyCarriesAuthority(grew));
  expect('#8435 — the improvement message names --update and is NOT marked maintainer-only '
    + '(ratcheting DOWN is the author\'s job; marking it would teach the opposite of the rule)',
    !RATCHET_EXPANSION_OFFER.test(improved) && ratchetRemedyCarriesAuthority(improved));
  expect('every verdict TEACHES the truth rather than only naming a banned spelling',
    [newClaim, grew].every((m) => m.includes('HAS A VALUE') && m.includes(RULE.refs)));

  // ── A missing ROOT is REFUSED, per root (#9932) ───────────────────────────
  const PRESENT_ROOT = 'alpha/one';
  const ABSENT_ROOT = 'bravo-two';
  expect('#9932 — with NO root present, every one of them is reported',
    missingRoots([PRESENT_ROOT, ABSENT_ROOT], () => false).join(',')
      === `${PRESENT_ROOT},${ABSENT_ROOT}`);
  expect('#9932 — a PARTIALLY present tree is still refused, naming only the absent root',
    missingRoots([PRESENT_ROOT, ABSENT_ROOT], (r) => r === PRESENT_ROOT).join(',') === ABSENT_ROOT);
  expect('#9932 — a fully present tree is NOT refused (proves the probe discriminates)',
    missingRoots([PRESENT_ROOT, ABSENT_ROOT], () => true).length === 0);
  const refusal = missingRootsMessage([ABSENT_ROOT]);
  expect('#9932 — the refusal names the missing root and not the present one',
    refusal.includes(ABSENT_ROOT) && !refusal.includes(PRESENT_ROOT));

  // ── The dispatch-gates declaration (#9964's pattern) ──────────────────────
  //
  // Enforcement cannot hold these: the declaration is read by another tool, so a
  // wrong or stale one runs green here forever and pays itself out as a dev
  // dispatched on a skills card with this gate missing from the brief. Derived
  // from ROOTS on both sides, so renaming a root cannot leave the declaration
  // describing the old population.
  const separatorless = ROOTS.filter((r) => !r.includes('/'));
  expect('every ROOT the hint extractor cannot see (no path separator) declares the subtree '
    + 'spelling', separatorless.every((r) => ROOT_DIR_WATCH_HINTS.includes(`${r}/**`)));
  expect('and it declares no root this gate does not walk (a declaration that can drift from the '
    + 'scan replaces a silent gate with a lying one)',
    ROOT_DIR_WATCH_HINTS.every((h) => ROOTS.includes(h.replace(/\/\*+$/, ''))));
  expect('skills is the root it declares (the half PR #10038 met as red CI on the sibling gate)',
    ROOT_DIR_WATCH_HINTS.includes('skills/**'));
  expect('the declared form is NOT a ROOTS entry (it would send the scan at a directory that '
    + 'does not exist)', !ROOTS.some((r) => ROOT_DIR_WATCH_HINTS.includes(r)));

  // ── At the PROGRAM level ──────────────────────────────────────────────────
  //
  // Everything above drives predicates. A predicate the program never consults
  // would satisfy all of it, so these build real trees and read a child
  // process's real exit status — never a pipe's.
  const SELF = fileURLToPath(import.meta.url);
  const runIn = (cwd, args = []) => {
    const r = spawnSync(process.execPath, [SELF, ...args], { cwd, encoding: 'utf8' });
    return { status: r.status, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
  };
  const REFUSAL_MARK = 'REFUSING to reach a verdict';
  const sandbox = mkdtempSync(join(tmpdir(), 'check-corpus-claim-drift-selftest-'));
  try {
    if (ROOTS.length < 2) {
      expect('the partial-tree leg needs one root present and one absent; with fewer than two '
        + 'ROOTS it cannot test the chosen shape at all. Re-express it before shrinking ROOTS',
        false);
    } else {
      const [firstRoot, ...restRoots] = ROOTS;
      const buildTree = (name, files) => {
        const dir = join(sandbox, name);
        for (const r of ROOTS) mkdirSync(join(dir, r), { recursive: true });
        for (const [rel, body] of Object.entries(files)) writeFileSync(join(dir, rel), body);
        return dir;
      };
      const CLEAN = `${firstRoot}/clean.mdx`;

      // (1) No root at all.
      const noneDir = join(sandbox, 'none');
      mkdirSync(noneDir, { recursive: true });
      const none = runIn(noneDir);
      expect('#9932 (program) — a tree where NO configured root exists is REFUSED (exit 1) and '
        + 'names them all', none.status === 1 && none.out.includes(REFUSAL_MARK)
        && ROOTS.every((r) => none.out.includes(r)));

      // (2) The partial tree — the leg that separates per-root refusal from
      // refuse-only-when-all-are-missing, and the only leg that can see whether
      // the main path consults the probe at all.
      const partialDir = join(sandbox, 'partial');
      mkdirSync(join(partialDir, firstRoot), { recursive: true });
      const partial = runIn(partialDir);
      expect('#9932 (program) — a tree missing ONE configured root is REFUSED, names it, and does '
        + 'not name the root that resolved', partial.status === 1
        && partial.out.includes(REFUSAL_MARK)
        && restRoots.every((r) => partial.out.includes(r))
        && !partial.out.includes(firstRoot));

      // (3) Roots present but the SUBJECT absent. This is where this gate is
      // deliberately stricter than check-role-word.mjs: an empty corpus there is
      // green, here it is a refusal, because a word ratchet over a corpus that
      // never says the word is measuring nothing.
      const emptyDir = buildTree('empty', {});
      const empty = runIn(emptyDir);
      expect('a tree whose roots all EXIST but hold no occurrence of the subject is REFUSED, not '
        + 'green — the #4690 shape, and the reason `unreachableRows` is consulted before any '
        + 'verdict', empty.status === 1 && empty.out.includes(REFUSAL_MARK)
        && empty.out.includes('exists-key-presence'));

      // (4) Discrimination at the program level: (1)-(3) would all pass on a
      // gate that refused unconditionally.
      const passing = runIn(buildTree('pass', {
        [CLEAN]: '| `$exists` | Field has a value — the inverse of `$null` |\n',
      }));
      expect('a tree carrying the subject with only TRUE prose beside it is GREEN, with no '
        + 'baseline entry (a gate that refused unconditionally would satisfy every leg above and '
        + 'no healthy checkout)', passing.status === 0);
      expect('and the green run publishes its input volume and its per-row tally',
        passing.out.includes('file(s) read across') && passing.out.includes('exists-key-presence'));

      // (5) The real defect, end to end, with no baseline in the tree.
      const failing = runIn(buildTree('fail', { [CLEAN]: `${WAS_TABLE_ROW}\n` }));
      expect('the pre-repair table row fails at the PROGRAM level and is reported as a NEW claim '
        + 'site', failing.status === 1 && failing.out.includes('NEW claim site'));
      expect('and the program-level failure TEACHES the truth, not just the ban',
        failing.out.includes('HAS A VALUE'));

      // (6) Both refusals precede the `--update` write. Pinned as byte-identity,
      // not as an exit code: the claim is that the refusal happens BEFORE the
      // write, and re-baselining from counts nobody could take freezes that into
      // a ledger which is only allowed to shrink.
      for (const [label, dir] of [['a missing root', partialDir], ['an unreachable row', emptyDir]]) {
        mkdirSync(join(dir, dirname(BASELINE_PATH)), { recursive: true });
        const ledgerPath = join(dir, BASELINE_PATH);
        const before = '{\n  "pinned": 7\n}\n';
        writeFileSync(ledgerPath, before);
        const updated = runIn(dir, ['--update']);
        expect(`\`--update\` over a tree with ${label} refuses BEFORE writing, leaving the `
          + 'baseline byte-identical', updated.status === 1
          && updated.out.includes(REFUSAL_MARK)
          && readFileSync(ledgerPath, 'utf8') === before);
      }
    }
  } finally {
    rmSync(sandbox, { recursive: true, force: true });
  }

  if (failures.length) {
    for (const f of failures) console.error(`  x self-test: ${f}`);
    console.error(`\ncheck-corpus-claim-drift --self-test: ${failures.length} failure(s).\n`);
    process.exit(1);
  }
  console.log(
    'OK  self-test: the vocabulary is a TABLE — a synthetic second row is driven through the real '
    + 'engine, keyed separately in the ledger and honouring its own window — while the shipped '
    + 'table holds exactly one row, so the next word is a card rather than a drive-by. Every '
    + 'false site #13539 repaired is caught from its verbatim pre-repair text, including the `//` '
    + 'comment INSIDE the os:check block that a line-scoped rule would miss and that the type '
    + 'checker ran green over, and the repaired wording is green. Every legitimate usage measured '
    + 'across both roots — the formula `has()` gotcha in two places, a cache `has()` probe, '
    + 'metadata field existence, a uniqueness rule, a sortable-field remedy, a triage step and an '
    + 'inline column — stays green STRUCTURALLY, with a discrimination leg proving that comes '
    + 'from the window and not from an inert rule. Overlapping claim members count ONE site, a '
    + 'configured ROOT that does not exist is REFUSED per root, a row whose subject appears '
    + 'nowhere is REFUSED rather than silently green, both refusals precede the `--update` write '
    + '(pinned as byte-identity), the baseline-expanding remedy is marked maintainer-only while '
    + 'the ratchet-DOWN one is not, and the success body reports what was READ per root and what '
    + 'each ROW reached — all of it also driven through a real child process.',
  );
  process.exit(0);
}

if (process.argv.includes('--self-test')) selfTest();

/* Table hygiene precedes everything: a row that matches the empty string would
 * report the whole corpus, and over `--update` would write that into a ledger
 * that is only allowed to shrink. */
const zeroWidth = zeroWidthClaimRows(VOCABULARY);
if (zeroWidth.length) {
  console.error(zeroWidthClaimsMessage(zeroWidth));
  process.exit(1);
}

/* Probed for ALL roots first, so one message names every missing one — and
 * probed ahead of both the scan and the `--update` write, because both are
 * unsound over a population the gate could not read. */
const absentRoots = missingRoots(ROOTS);
if (absentRoots.length) {
  console.error(missingRootsMessage(absentRoots));
  process.exit(1);
}

const files = [];
/* The input volume, per root, recorded as the scan runs — the same pass, not a
 * second one. A root that vanishes between the probe and here throws, loudly,
 * which is the right direction: the failure this guards is a silent PASS. */
const scanned = [];
for (const root of ROOTS) {
  const before = files.length;
  walk(root, files);
  scanned.push({ root, files: files.length - before });
}

const corpus = files.sort().map((f) => ({
  rel: relative('.', f).replace(/\\/g, '/'),
  text: readFileSync(f, 'utf8'),
}));

/* A row whose subject is nowhere in the corpus checks nothing. Refused here —
 * after the read, because the question is about what was actually read, and
 * before `--update`, because re-baselining under a dead row is how the silence
 * would become permanent. */
const unreachable = unreachableRows(VOCABULARY, corpus);
if (unreachable.length) {
  console.error(unreachableRowsMessage(unreachable));
  process.exit(1);
}

const current = {};
const allSites = [];
for (const { rel, text } of corpus) {
  const { hits, sites } = analyzeFile(text, VOCABULARY);
  if (Object.keys(hits).length) current[rel] = hits;
  for (const s of sites) allSites.push({ file: rel, ...s });
}

if (list) {
  for (const s of allSites) {
    console.log(`${s.file}:${s.line}\t${s.ruleId}\t${JSON.stringify(s.text)}`);
  }
  console.log(`\n${allSites.length} claim site(s) over ${scanClause(scanned)}.`);
  process.exit(0);
}

if (update) {
  writeFileSync(BASELINE_PATH, `${JSON.stringify(current, null, 2)}\n`);
  console.log(updateSummary(scanned, current, VOCABULARY));
  process.exit(0);
}

const baseline = existsSync(BASELINE_PATH)
  ? JSON.parse(readFileSync(BASELINE_PATH, 'utf8'))
  : {};
const byId = new Map(VOCABULARY.map((r) => [r.id, r]));

const errors = [];
for (const [file, perRule] of Object.entries(current)) {
  for (const [ruleId, n] of Object.entries(perRule)) {
    const allowed = baseline[file]?.[ruleId];
    const rule = byId.get(ruleId);
    if (allowed === undefined) errors.push(newClaimMessage(file, rule, n));
    else if (n > allowed) errors.push(grewMessage(file, rule, allowed, n));
  }
}
/* The improvement direction. A ledger that only ever shrinks has to be TOLD
 * when the tree shrank, or the debt it reports is the debt of some earlier
 * tree. */
for (const [file, perRule] of Object.entries(baseline)) {
  for (const [ruleId, allowed] of Object.entries(perRule)) {
    const rule = byId.get(ruleId);
    if (!rule) {
      errors.push(`${BASELINE_PATH}: entry ${file} names rule "${ruleId}", which VOCABULARY no `
        + 'longer holds. Retiring a row is a deliberate edit; finish it by running '
        + '`node scripts/check-corpus-claim-drift.mjs --update` and committing the baseline.');
      continue;
    }
    const n = current[file]?.[ruleId] ?? 0;
    if (n < allowed) errors.push(improvedMessage(file, rule, allowed, n));
  }
}

if (errors.length) {
  console.error(`check-corpus-claim-drift: ${errors.length} problem(s)\n`);
  for (const e of errors) console.error(`  • ${e}`);
  process.exit(1);
}

console.log(successSummary(scanned, current, VOCABULARY));
