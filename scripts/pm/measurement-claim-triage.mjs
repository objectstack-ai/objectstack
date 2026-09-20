#!/usr/bin/env node
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Tree-measurement claims under `scripts/**` — the CLASSIFIER (#17797).
 *
 *   node scripts/pm/measurement-claim-triage.mjs              the population + every verdict
 *   node scripts/pm/measurement-claim-triage.mjs --review     the kind-3 residue alone
 *   node scripts/pm/measurement-claim-triage.mjs --self-test  the controls, both directions
 *
 * ## Why a tool and not a sentence
 *
 * The card that asked for this states its own population as a count. That count
 * was taken once and then decayed — which is the very defect the card is about,
 * reproduced by the card. ⛔ So no number describing this population is written
 * down here. The scope line this tool prints IS the number, re-derived on the
 * tree it is run against, and a reader who wants the population runs the tool.
 * ⭐ The figures are deliberately absent from this docblock; ⛔ do not helpfully
 * restore one.
 *
 * ## The three kinds, and why one phrase carries all of them
 *
 * A sentence that reports a measurement of this repository is one of three
 * things, and they take DIFFERENT repairs:
 *
 *   KIND 1  a citation of a past measurement. It is scoped to a moment — by a
 *           revision, a date, or a named event ("before this gate was written",
 *           "at the commit that took it") or a counterfactual condition ("with
 *           the reservation removed"). It reads as history, so it stays true
 *           forever. ⇒ NEEDS NOTHING.
 *
 *   KIND 2  a claim whose failure direction is NAMED, and which something in
 *           the tree announces when it moves — a zero whose falsifier is
 *           spelled out, a figure a gate reprints, a figure a pin reds on.
 *           It does not decay SILENTLY, which is the whole harm. ⇒ NEEDS
 *           NOTHING.
 *
 *   KIND 3  a bare magnitude in the present tense: no moment, no named
 *           direction, nothing that speaks when it moves. It reads as current
 *           state and goes false in silence. ⇒ THIS IS THE DEFECT.
 *
 * ⛔ The phrase alone separates none of them, which is why the population below
 * is an UPPER BOUND on a population and NOT a count of defects. Treating the
 * sweep's size as a finding count is the error this tool exists to prevent.
 *
 * ## What is mechanical here, and what is not
 *
 * Tests T0–T3 run over source text and are recall filters: each one can only
 * move a hit OUT of the review residue, and each prints the cue that moved it,
 * so a verdict is always auditable against the sentence. What no regex decides
 * is T4 — whether a reader acts on the magnitude's LEVEL or on a relation the
 * level's drift survives. T4 is a judgement, so it is recorded per site in
 * `TRIAGE` below, with its reason, exactly as the bare-root worklist records
 * its own. A review hit with no `TRIAGE` row prints as UNTRIAGED and reds the
 * self-test: a new claim of this shape has to be judged by someone.
 *
 * ## Scope, and the two files deliberately outside it
 *
 * `scripts/pm/dispatch-gates.mjs` and `scripts/pm/check-widening-tells.mjs` are
 * EXCLUDED, with their reasons carried as data in `EXCLUDED` and printed on
 * every run rather than left in prose. The residue they hold is therefore
 * un-swept, and the scope line says so instead of reading as complete.
 *
 * ## ⚠️ This tool is not wired into CI
 *
 * Wiring a `--self-test` needs a `package.json` script and a workflow step, and
 * both sit outside the file surface this card was dispatched with. Until that
 * lands, `--self-test` is run by hand and its controls are not watching
 * anything on their own. ⛔ Do not read a green run here as CI coverage.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isEntrypoint } from '../invoked-as.mjs';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const REPO_ROOT = join(HERE, '..', '..');
const SCAN_ROOT = join(REPO_ROOT, 'scripts');

/** This file's own path, relative to the repo root, in the spelling verdicts use. */
const SELF = 'scripts/pm/measurement-claim-triage.mjs';

/**
 * FORM A — the phrase the card names, in every spelling it actually occurs in
 * on this tree. ⚠️ The card's own probe was case-sensitive and lower-case only;
 * on this tree that spelling reaches strictly fewer sites than the sentence
 * does, and the gap is not a rounding error. The count either way is printed,
 * never written down.
 */
const FORM_A = /(?:\bre-)?measured\s+(?:on|against)\s+this\s+tree/gi;

/**
 * FORM B — sites FORM A cannot reach, declared per file with the reason.
 *
 * ⭐ That this list is non-empty is the finding: a phrase probe is not a
 * population. The card's own named instance carries no phrase at all — it is a
 * bare corpus size in the present tense — so a sweep defined by the phrase
 * would have reported the tree clean at the one site everybody agreed was
 * broken.
 */
const FORM_B = [
  {
    file: 'scripts/docs-audit/README.md',
    // The hand-written docs corpus size. `pnpm check:docs-audit-scope` prints
    // today's; every literal of the older figure left in this file is a claim
    // about the corpus that the gate can contradict.
    pattern: /\b178\b/g,
    // `#11178` is a card number, not a corpus size.
    reject: /#\d*178\b/,
    why: 'the hand-written docs corpus size, which `check:docs-audit-scope` prints live',
  },
];

/** Excluded files, with the reason carried as data so every run prints it. */
const EXCLUDED = [
  {
    file: 'scripts/pm/dispatch-gates.mjs',
    why: 'edited by open PRs #19162 and #19024, and its `--self-test` exceeds the agent '
      + 'container foreground cap (#17765), so a change here could not be verified from a seat',
  },
  {
    file: 'scripts/pm/check-widening-tells.mjs',
    why: 'edited by open PRs #19153 and #19024',
  },
];

/* ─────────────────────────── the tests ─────────────────────────────────── */

/**
 * T0 — is there a magnitude at all? Applied LAST, as the weakest escape hatch:
 * a sentence that is already anchored or already loud is settled before the
 * question is asked, so T0 only ever speaks about the residue.
 *
 * Nothing decays if nothing is counted. A ZERO is a magnitude — kind 2 is
 * defined on one — so the word counts even where no digit does. Revisions, dates, card numbers, tool
 * versions and exit codes are struck first: each is an identifier that happens
 * to be spelled in digits, and counting them as magnitudes would classify every
 * anchored citation as the thing an anchor exists to prevent.
 */
const strikeNonMagnitudes = (text) => text
  .replace(/`[0-9a-f]{7,40}`/g, ' ')
  .replace(/\b20\d{2}-\d{2}-\d{2}\b/g, ' ')
  .replace(/#\d+/g, ' ')
  .replace(/\bv?\d+\.\d+(?:\.\d+)?\b/g, ' ')
  .replace(/\bexit \d+\b/gi, ' ')
  .replace(/\bADR-\d+\b/g, ' ')
  .replace(/\bbash \d\.\d\b/gi, ' ');

const MAGNITUDE = /(?<![\w.#-])\d[\d,]*(?:\.\d+)?(?:%|\s?(?:ms|s|KB|MB|GB)\b)?(?![\w.-])|\bzero\b/i;

/**
 * T1 — FRAME. Is the magnitude scoped to a moment that has passed, or to a
 * counterfactual condition? Each cue below is spelled from a real sentence in
 * this population; ⛔ none is invented, and a cue that stops matching anything
 * is caught by the self-test rather than left as decoration.
 */
const FRAME_CUES = [
  [/\bbefore\b[^.]{0,80}?\b(?:landed|existed|was written|were written|was changed|joined|ran|chose|choosing)\b/i, 'before-event'],
  [/\bbefore choosing\b/i, 'before-event'],
  [/\bbefore anything was changed\b/i, 'before-event'],
  [/\bat the commit that\b/i, 'at-commit'],
  [/\bsame commit\b/i, 'at-commit'],
  [/\bwhile #\d+ was implemented\b/i, 'during-card'],
  [/\bthe first (?:time|build)\b/i, 'first-run'],
  [/\ban earlier revision\b/i, 'earlier-revision'],
  [/\bused to\b/i, 'used-to'],
  [/\bwith\b[^.]{0,60}?\b(?:removed|ablated|masked out|untouched|replicated)\b/i, 'ablation'],
  [/\bpointed at (?:two )?non-existent\b/i, 'ablation'],
  [/\bone line changed\b/i, 'ablation'],
  [/\bplus six mutations\b/i, 'ablation'],
  [/\bwhen (?:this|it|the)\b[^.]{0,30}?\blanded\b/i, 'when-written'],
  [/\bheld constant\b|\bnothing else varied\b/i, 'controlled'],
  [/\bwould have\b/i, 'counterfactual'],
  [/\bmeasurement behind\b/i, 'decision-record'],
  // `scripts/docs-audit/README.md` — "A run ... WAS AUDITING 130 of 178 docs":
  // a past progressive is a state the tree has left, whoever left it.
  [/\bwas [a-z]+ing\b/i, 'past-progressive'],
];

/**
 * T2 — ANCHOR. A revision or a date fixes WHEN the reading was true, which is
 * the whole of what kind 1 is. ⛔ A bare card number is deliberately NOT an
 * anchor here: `#NNNN` appears in every kind of sentence in this tree, and
 * admitting it would clear the residue by matching everything.
 */
const ANCHOR_CUES = [
  [/`[0-9a-f]{7,40}`/, 'revision'],
  [/\bat [0-9a-f]{7,40}\b/, 'revision'],
  [/\b20\d{2}-\d{2}-\d{2}\b/, 'date'],
  [/\bpnpm \d+\.\d+\.\d+\b/i, 'tool-version'],
];

/**
 * T3 — LOUDNESS. Would the drift announce itself? Three ways, and a zero whose
 * falsifier is spelled out is only the commonest of them.
 */
const LOUD_CUES = [
  [/\bfailure direction\b/i, 'named-direction'],
  [/\bif that ever changes\b/i, 'named-direction'],
  [/\bfails? CLOSED\b/i, 'named-direction'],
  [/\bstill lands here\b/i, 'named-direction'],
  [/\bempty by construction\b/i, 'named-direction'],
  [/\bmakes visible\b/i, 'named-direction'],
  [/\breds? (?:until|when|the moment|at the moment|these)\b/i, 'named-direction'],
  [/\bmeets an assertion\b/i, 'named-direction'],
  [/\bpinned in the self-test\b/i, 'pinned'],
  [/\breproduces every number\b/i, 'instrument'],
  [/--census\b/, 'instrument'],
  [/\brun\s+`[^`]+`\s+for\b/i, 'instrument'],
  [/\bfor (?:today's|the current) (?:number|value|count)\b/i, 'instrument'],
  // ⚠️ The apostrophe here is typographic in the sentence this cue is spelled
  // from; an ASCII-only class matches nothing and the cue reads as dead.
  [/\bwith this file['’]?s own `[^`]+`/i, 'instrument'],
  [/\bdon'?t trust a count written down here\b/i, 'instrument'],
  [/\$\{/, 'interpolated'],
  [/\bdeliberately (?:not written down|absent|not refreshed)\b/i, 'figure-absent'],
  [/\bmagnitude is deliberately not\b/i, 'figure-absent'],
];

/**
 * ⛔ Every cue is matched against WHITESPACE-FLATTENED text. A docblock wraps
 * its prose, so "was auditing" arrives as "was\nauditing" and a cue written
 * with a literal space matches nothing — a dead cue that reads, from the
 * verdict alone, exactly like a cue that correctly declined.
 */
const firstCue = (cues, text) => {
  const flat = text.replace(/\s+/g, ' ');
  for (const [re, name] of cues) if (re.test(flat)) return name;
  return null;
};

/* ───────────────────── population derivation ───────────────────────────── */

const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'coverage', '.turbo']);

function* walk(dir) {
  for (const entry of readdirSync(dir).sort()) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) yield* walk(full);
    else if (st.isFile()) yield full;
  }
}

/**
 * ## The window a verdict is read over, and why it is a SENTENCE
 *
 * The first build of this tool read a fixed ±6-line block. It cleared the one
 * site everybody had already agreed was broken (`scripts/docs-audit/README.md`,
 * the present-tense corpus size): six lines above it an UNRELATED sentence
 * cites a revision, and a block window handed that anchor to a claim that has
 * none. ⛔ An anchor belongs to the sentence that carries the figure and to no
 * other, so T2 and T3 read the SENTENCE.
 *
 * T1 and T3 are the exceptions, and deliberately. A narrative frame is
 * routinely set one sentence earlier — the dispatcher-vocabulary gate opens
 * with "An earlier revision of this paragraph counted DIRECTORIES …" and only
 * then reports the reading — so T1 also sees the sentence before. A named failure direction is routinely set one
 * sentence LATER — the card's own kind-2 exemplar spells the zero in one
 * sentence and names what would falsify it in the next — so T3 sees both
 * neighbours. ⛔ T2 sees neither: an anchor belongs to its own sentence, and
 * widening T2 is precisely the bug this window replaced.
 *
 * ⚠️ Neither test sees further than one sentence, and a frame or a direction
 * set further back than that lands in the review residue — the safe direction,
 * where a person judges it and records the judgement in `TRIAGE`.
 */
const SENTENCE_BREAK = /(?<=[.!?])[ \n]+(?=[A-Z⛔⭐⚠️`*#·•])/;

/** Comment furniture, so a sentence reads as prose rather than as a comment. */
function deComment(line, isMarkdown) {
  let out = line.replace(/^\s*(?:\/\/+|\*)\s?/, '');
  if (!isMarkdown) out = out.replace(/^\s*#+\s?/, '');
  return out;
}

/**
 * Split a file into sentences, each carrying the 1-based line it starts on.
 * The line map is built from the ORIGINAL line count, so a reported line is a
 * line in the file a reader will open and not an offset into a derived string.
 */
function sentencesOf(text, isMarkdown) {
  const lines = text.split('\n');
  const prose = lines.map((l) => deComment(l, isMarkdown));
  const out = [];
  let buffer = [];
  let bufferStart = 1;
  const flush = () => {
    if (!buffer.length) return;
    const joined = buffer.join('\n');
    let offset = 0;
    for (const piece of joined.split(SENTENCE_BREAK)) {
      const before = joined.slice(0, offset);
      out.push({ text: piece, line: bufferStart + (before.match(/\n/g) ?? []).length });
      offset += piece.length + 1;
    }
    buffer = [];
  };
  prose.forEach((line, i) => {
    if (line.trim() === '') {
      // ⛔ A blank comment line does NOT end a sentence that was introducing a
      // data block. A docblock here routinely ends its lead-in on a colon and
      // then sets the table off with an empty ` *` line; flushing at that blank
      // strands every figure in a fragment carrying no cue, and the sweep reads
      // a docblock full of magnitudes as carrying none.
      if (buffer.length && /:\s*$/.test(buffer[buffer.length - 1])) return;
      flush();
      return;
    }
    if (!buffer.length) bufferStart = i + 1;
    buffer.push(line);
  });
  flush();
  return out;
}

function hitsIn(relPath, text) {
  const isMarkdown = relPath.endsWith('.md');
  const sentences = sentencesOf(text, isMarkdown);
  const found = [];
  sentences.forEach((s, i) => {
    const lead = i > 0 ? sentences[i - 1].text : '';
    const next = i + 1 < sentences.length ? sentences[i + 1].text : '';
    FORM_A.lastIndex = 0;
    if (FORM_A.test(s.text)) {
      found.push({ file: relPath, line: s.line, form: 'A', sentence: s.text, lead, next });
    }
    for (const form of FORM_B) {
      if (form.file !== relPath) continue;
      form.pattern.lastIndex = 0;
      if (!form.pattern.test(s.text)) continue;
      if (form.reject && form.reject.test(s.text)) continue;
      found.push({ file: relPath, line: s.line, form: 'B', sentence: s.text, lead, next, why: form.why });
    }
  });
  return found;
}

export function collectPopulation() {
  const excluded = new Set(EXCLUDED.map((e) => e.file));
  const hits = [];
  for (const full of walk(SCAN_ROOT)) {
    const rel = relative(REPO_ROOT, full).split(sep).join('/');
    if (excluded.has(rel) || rel === SELF) continue;
    let text;
    try { text = readFileSync(full, 'utf8'); } catch { continue; }
    hits.push(...hitsIn(rel, text));
  }
  return hits;
}

/**
 * The classifier proper: T1–T3 then T0, over one sentence (plus the sentence
 * before it, for T1 only). T4 — level or relation — is a judgement and lives in
 * `TRIAGE`.
 */
export function classify(sentence, lead = '', next = '') {
  const frame = firstCue(FRAME_CUES, `${lead}\n${sentence}`);
  if (frame) return { kind: 'KIND-1', cue: frame };
  const anchor = firstCue(ANCHOR_CUES, sentence);
  if (anchor) return { kind: 'KIND-1', cue: anchor };
  const loud = firstCue(LOUD_CUES, `${lead}\n${sentence}\n${next}`);
  if (loud) return { kind: 'KIND-2', cue: loud };
  if (!MAGNITUDE.test(strikeNonMagnitudes(sentence.replace(/\s+/g, ' ')))) {
    return { kind: 'NO-FIGURE', cue: 'no magnitude survives T0' };
  }
  return { kind: 'REVIEW', cue: 'present-tense magnitude, no frame, no anchor, nothing loud' };
}

/* ─────────────────────────── T4, recorded ───────────────────────────────── */

/**
 * T4 — LEVEL or RELATION, the half no regex decides.
 *
 * With T1–T3 all declining, one question is left: does a reader act on the
 * magnitude's **level**, or on a **relation** (a ratio, an ordering, an
 * existence claim, a set equality) that the level's drift survives? A level is
 * kind 3. A relation is an ILLUSTRATION — the figure sizes an argument that
 * stays correct when the figure moves, and rewriting it buys nothing while
 * costing a reviewer a diff.
 *
 * ⛔ Every row is keyed by an EXCERPT and never by a line number. The card that
 * asked for this cited its own known instance by line, and the line had moved
 * before anyone read the card — a ledger keyed on line numbers decays exactly
 * the way its subject does.
 *
 * `verdict`:
 *   ILLUSTRATION — judged a relation; stays as written.
 *   REPAIRED     — judged kind 3 and repaired in #17797. The self-test holds
 *                  the excerpt ABSENT: if it comes back, so has the defect.
 */
const TRIAGE = [
  { file: 'scripts/check-bash32-floor.mjs', match: '8 findings, every one of them a false positive',
    verdict: 'ILLUSTRATION', why: 'a counterfactual reading of the rule this gate replaced — the SIGN (all false positives) carries it, and the rule it measured is gone from this tree' },
  { file: 'scripts/check-cross-package-test-inputs.mjs', match: '6 exist only inside comments',
    verdict: 'ILLUSTRATION', why: 'the load-bearing claim is the zero that follows it — none of the six escapes its package — and the corpus sizes only scale it' },
  { file: 'scripts/check-cross-package-test-inputs.mjs', match: '15 extensionless',
    verdict: 'ILLUSTRATION', why: 'three spellings EXIST, which is why three branches exist; no branch is chosen by how many files carry it' },
  { file: 'scripts/check-cross-package-test-inputs.mjs', match: 'test files importing a workspace sibling by BARE specifier',
    verdict: 'ILLUSTRATION', why: 'the ORDERING decides the design (bare specifiers dwarf relative ones), and no plausible drift reverses it' },
  { file: 'scripts/check-cross-package-test-inputs.mjs', match: '6 of the 60 declared globs are held by exactly such reads',
    verdict: 'ILLUSTRATION', why: 'a non-emptiness claim — the blind spot is real — with a named specimen; nobody acts on how many' },
  { file: 'scripts/check-dispatcher-error-vocabulary.mjs', match: 'the naive `[{,]` anchor alone reports 19',
    verdict: 'ILLUSTRATION', why: 'two recognisers compared at one moment; 19-against-13 is a relation, and the six extras are named individually' },
  { file: 'scripts/check-driver-conformance.mjs', match: "105 files under `driver-sql/src` carry a literal",
    verdict: 'ILLUSTRATION', why: 'the claim is that those files are NOT defects — a class judgement; the count only says the class is large' },
  { file: 'scripts/check-examples-live-imports.mjs', match: '76 coupled files across 3 packages',
    verdict: 'ILLUSTRATION', why: 'the refusal rests on the SHARE (a tiny coupled set inside a huge root), which no ordinary churn moves' },
  { file: 'scripts/check-logger-receiver-detach.mjs', match: 'over the property reads whose NAME is a log channel',
    verdict: 'ILLUSTRATION', why: 'the section head one paragraph up names `--census` as reproducing every number in it — instrument-backed, one sentence further than T3 reaches' },
  { file: 'scripts/check-parse-guard.mjs', match: '9 of the 28 sites live in',
    verdict: 'ILLUSTRATION', why: 'the finding is that the printed remedy is false for a subset that EXISTS; the subset is then described by kind, not by size' },
  { file: 'scripts/check-pnpm-filter-targets.mjs', match: 'Measured on this tree, the declaration names 235 tracked files',
    verdict: 'REPAIRED', why: 'kind 3 — a declaration-honesty ratio over a root that grows with every script added, read as current state, reprinted by nothing' },
  { file: 'scripts/check-published-files.mjs', match: 'Measured on this tree: the declaration names 5263 tracked files',
    verdict: 'REPAIRED', why: 'kind 3 — same shape over the whole publishable workspace, which moves on every package add or removal' },
  { file: 'scripts/check-release-section-coverage.mjs', match: 'assertion 1 fires on 24 minors',
    verdict: 'ILLUSTRATION', why: 'the figures justify shipping WITH a baseline, and the ruling that fixes them is dated in the sentence before' },
  { file: 'scripts/check-sdui-lockstep.mjs', match: 'measured on this tree at 96 hint literals',
    verdict: 'ILLUSTRATION', why: '"at 96 hint literals" is the CONDITION of the reading, not its subject: the claim is about which leading-dot literals the allowlist admits' },
  { file: 'scripts/check-skill-compatibility-version.mjs', match: 'both were measured on this tree',
    verdict: 'REPAIRED', why: 'kind 3 — four precision ratios deciding which roots are declared, all moving with the tree and none reprinted' },
  { file: 'scripts/check-slot-lookup-ratchet.mjs', match: 'Measured on this tree: 46s',
    verdict: 'REPAIRED', why: 'kind 3, and the worst-ageing kind: a duration is a reading of one BOX as much as of one tree, so it decays without the tree changing at all' },
  { file: 'scripts/check-test-source-alias.mjs', match: '1832 of the 4844 tracked files',
    verdict: 'ILLUSTRATION', why: 'it records the state the fix REMOVED — the derivation no longer decides this gate by where a package sits — in a past-tense narrative T1 does not reach' },
  { file: 'scripts/check-where-matcher-conformance.mjs', match: '2889 of the 2889 files',
    verdict: 'ILLUSTRATION', why: 'a set EQUALITY held in both directions by this gate own liveness-and-precision pin: it reds on drift rather than decaying' },
  { file: 'scripts/check-widget-option-census.mjs', match: 'inheritable literals: 0',
    verdict: 'ILLUSTRATION', why: 'a table of zeros making an inheritance claim; the zeros are the claim' },
  { file: 'scripts/docs-audit/README.md', match: 'matched 82, 113, 43, 13 and 10 of 178 pages',
    verdict: 'ILLUSTRATION', why: 'past-tense narrative of the first build guards — the words arrived as real declarations and matched; it describes a tree that is gone' },
  { file: 'scripts/docs-audit/README.md', match: 'named by 59 of 178 pages',
    verdict: 'ILLUSTRATION', why: 'the argument is the 15% corpus SHARE rule stated two lines up; this is the share that condemned one term when the rule was written' },
  { file: 'scripts/docs-audit/README.md', match: 'reads the same 178-page corpus',
    verdict: 'REPAIRED', why: 'kind 3, and the instance the card names: a present-tense corpus size that `check:docs-audit-scope` contradicts today' },
  { file: 'scripts/eslint-stack-headroom.mjs', match: 'the narrow scope is the worst case',
    verdict: 'ILLUSTRATION', why: 'worst-case against intermittent — a comparison between two arms, and the gate is built on the comparison, not on either rate' },
  { file: 'scripts/git-merge-regen.mjs', match: 'measured on this tree: 18 rows',
    verdict: 'ILLUSTRATION', why: 'the claim is that reverting #13585 loosening would turn the reconciliation RED; the row split only shows both branches are populated' },
  { file: 'scripts/pm/bare-root-worklist.mjs', match: 'reaches 2755 of ',
    verdict: 'ILLUSTRATION', why: 'a set equality this file own --self-test re-derives and reds on, which is the whole point of a worklist that runs' },
  { file: 'scripts/pm/bare-root-worklist.mjs', match: 'numerator from the instrument own printed scan ',
    verdict: 'ILLUSTRATION', why: 'the sentence names both instruments the two terms came from and refuses to carry either from the row above' },
  { file: 'scripts/pm/bare-root-worklist.mjs', match: 'the ratio does not change the verdict either direction',
    verdict: 'ILLUSTRATION', why: 'the sentence says in its own words that the level is not acted on — a relation by declaration' },
];

/* ──────────────────────────── the controls ─────────────────────────────── */

/**
 * ⭐ BOTH DIRECTIONS, and neither one alone. A classifier only ever seen to
 * fire proves nothing; one only ever seen to stay quiet proves less.
 *
 * Each control carries a `liveness` substring that must still be present in the
 * file it was taken from. ⛔ A control quoting a sentence the tree no longer
 * holds is a control that has stopped controlling anything, and it would pass
 * in silence — the exact failure this whole file is about.
 */
const CONTROLS = [
  {
    name: 'kind 1 — a citation carrying its revision, left alone',
    file: 'scripts/check-tier-file-adoption.mjs',
    liveness: 'Measured on this tree at d03c3c96d6',
    sentence: 'Measured on this tree at d03c3c96d6, on the ONE package that owns tier files: '
      + '`packages/cli/vitest.config.ts` names `OS_TEST_TIERS` 5 times and `packages/cli/vitest-tiers.ts` 4 times.',
    lead: '', next: '',
    expect: 'KIND-1',
  },
  {
    name: 'kind 2 — a zero whose failure direction is named, left alone',
    file: 'scripts/docs-audit/affected-docs.mjs',
    liveness: 'zero commands declare `static topic`',
    sentence: 'Measured on this tree: zero commands declare `static topic`, and the one `static id` '
      + "(`init.ts` -> `'init'`) agrees with its path, so nothing is mis-derived today.",
    lead: '',
    next: 'The failure direction if that ever changes is a phrase matching NO page — a recall miss the '
      + 'anchor list makes visible, not a false positive that pollutes the work list.',
    expect: 'KIND-2',
  },
  {
    name: 'kind 3 — the card own named instance, CAUGHT (pre-repair text)',
    file: 'scripts/docs-audit/README.md',
    // ⛔ No liveness key: this is the sentence as it read BEFORE the repair, so
    // the tree is required NOT to hold it. `absent` is checked instead.
    absent: 'reads the same 178-page corpus',
    sentence: '**Cost** (the card open question): the anchor derivation reads the same 178-page corpus '
      + 'the old one did, plus the 18 route-source/ledger files (~875 KB) and one `git show` per changed file per side.',
    lead: 'How often it renders, re-derived over the 40 first-parent commits ending at `e43b18fd9`: '
      + '3 of the 17 package-touching runs (18%).',
    next: 'Measured end-to-end on the ten PRs above, `node affected-docs.mjs` went from 85-195 ms to 114-582 ms.',
    expect: 'REVIEW',
  },
  {
    name: 'kind 3 repaired — the SAME site now points at the gate that prints the value',
    file: 'scripts/docs-audit/README.md',
    liveness: 'check:docs-audit-scope',
    sentence: '**Cost** (the card open question): the anchor derivation reads the same hand-written corpus '
      + 'the old one did — run `check-audit-scope.mjs` for today\'s page count rather than trusting one written '
      + 'down here — plus the 18 route-source/ledger files and one `git show` per changed file per side.',
    lead: '', next: '',
    expect: 'KIND-2',
  },
  {
    name: 'kind 2 — a refusal a live assertion holds, left alone',
    file: 'scripts/check-skill-compatibility-version.mjs',
    liveness: 'the refusal is pinned in the self-test',
    sentence: 'So the manifest side stays undeclared, deliberately, and the refusal is pinned in the '
      + 'self-test rather than left in this paragraph — a later author who adds `packages/**` meets an assertion.',
    lead: '', next: '',
    expect: 'KIND-2',
  },
  {
    name: '⛔ the one-sentence anchor rule — a neighbour revision does NOT clear a bare magnitude',
    file: 'scripts/pm/measurement-claim-triage.mjs',
    sentence: 'The declaration names 235 tracked files under scripts/ and this gate reads 228 of them.',
    lead: 'Re-derived over the 40 first-parent commits ending at `e43b18fd9`.',
    next: '',
    expect: 'REVIEW',
  },
];

/* ──────────────────────────────── report ───────────────────────────────── */

const KINDS = ['KIND-1', 'KIND-2', 'NO-FIGURE', 'REVIEW'];

export function triageOf(hit) {
  const flat = hit.sentence.replace(/\s+/g, ' ');
  return TRIAGE.find((row) => row.file === hit.file && row.verdict !== 'REPAIRED' && flat.includes(row.match))
    ?? null;
}

function verdicts() {
  return collectPopulation().map((hit) => ({ hit, ...classify(hit.sentence, hit.lead, hit.next) }));
}

export function report({ reviewOnly = false } = {}) {
  const rows = verdicts();
  const counts = Object.fromEntries(KINDS.map((k) => [k, rows.filter((r) => r.kind === k).length]));

  console.log(
    `measurement-claim triage: ${rows.length} claim(s) over `
    + `${new Set(rows.map((r) => r.hit.file)).size} file(s) under scripts/ — `
    + KINDS.map((k) => `${k} ${counts[k]}`).join(' · '),
  );
  console.log(
    '  ⛔ REVIEW is a CANDIDATE bucket, not a defect count — T4 (level or relation) is a judgement,\n'
    + '     recorded per site in TRIAGE. ⛔ Reading any number above as a finding count is the error\n'
    + '     this tool exists to prevent.',
  );
  for (const e of EXCLUDED) console.log(`  ⚠️ NOT SWEPT  ${e.file} — ${e.why}`);
  console.log('');

  for (const row of rows) {
    if (reviewOnly && row.kind !== 'REVIEW') continue;
    const t = row.kind === 'REVIEW' ? triageOf(row.hit) : null;
    const tag = row.kind === 'REVIEW' ? (t ? `T4 ${t.verdict}` : 'T4 UNTRIAGED') : row.kind;
    console.log(`  ${tag.padEnd(18)} ${row.hit.file}:${row.hit.line}  [${row.cue}]`);
    if (t) console.log(`  ${' '.repeat(18)} ↳ ${t.why}`);
  }
  return rows;
}

/* ─────────────────────────────── self-test ─────────────────────────────── */

const SELF_TEST_VERDICT = 'measurement-claim-triage self-test: controls hold in BOTH directions';

export function selfTest() {
  const problems = [];
  const rows = verdicts();

  // #4690: an empty population refuses rather than printing a confident zero.
  if (rows.length === 0) problems.push('PREREQUISITE NOT MET: the sweep found no claims at all under scripts/.');

  for (const control of CONTROLS) {
    const got = classify(control.sentence, control.lead, control.next).kind;
    if (got !== control.expect) problems.push(`CONTROL "${control.name}": expected ${control.expect}, got ${got}.`);
    let text = '';
    try { text = readFileSync(join(REPO_ROOT, control.file), 'utf8'); } catch {
      problems.push(`CONTROL "${control.name}": ${control.file} is gone, so the control quotes nothing.`);
      continue;
    }
    if (control.liveness && !text.includes(control.liveness)) {
      problems.push(
        `CONTROL "${control.name}": ${control.file} no longer carries \`${control.liveness}\`. `
        + 'A control quoting a sentence the tree has lost passes in silence — re-point it at a live one.',
      );
    }
    if (control.absent && text.includes(control.absent)) {
      problems.push(
        `CONTROL "${control.name}": ${control.file} carries \`${control.absent}\` again. `
        + 'That is the repaired kind-3 sentence restored — the defect is back.',
      );
    }
  }

  // Every REVIEW hit is judged by somebody.
  for (const row of rows) {
    if (row.kind !== 'REVIEW') continue;
    if (!triageOf(row.hit)) {
      problems.push(
        `UNTRIAGED ${row.hit.file}:${row.hit.line} — a present-tense magnitude with no frame, no anchor `
        + 'and nothing loud, and no TRIAGE row judging it. Judge it (level or relation) and record why.',
      );
    }
  }

  // A TRIAGE row that matches nothing is a judgement about a tree that is gone.
  for (const row of TRIAGE) {
    const live = rows.some((r) => r.hit.file === row.file && r.hit.sentence.replace(/\s+/g, ' ').includes(row.match));
    if (row.verdict === 'ILLUSTRATION' && !live) {
      problems.push(`STALE TRIAGE row ${row.file} "${row.match}" matches nothing in the population any more.`);
    }
    if (row.verdict === 'REPAIRED' && live) {
      problems.push(`REGRESSED ${row.file} "${row.match}" is back in the population — the repair was undone.`);
    }
  }

  // ⛔ Every cue must still match something, or it is decoration.
  for (const [cues, label] of [[FRAME_CUES, 'FRAME'], [ANCHOR_CUES, 'ANCHOR'], [LOUD_CUES, 'LOUD']]) {
    for (const [re, name] of cues) {
      const corpus = rows.map((r) => `${r.hit.lead}\n${r.hit.sentence}\n${r.hit.next}`.replace(/\s+/g, ' '));
      const controls = CONTROLS.map((c) => `${c.lead}\n${c.sentence}\n${c.next}`.replace(/\s+/g, ' '));
      if (![...corpus, ...controls].some((t) => re.test(t))) {
        problems.push(`DEAD CUE ${label}/${name} ${re} matches nothing in the population or the controls.`);
      }
    }
  }

  // This file's own prose must make no claim the sweep would have to judge.
  const own = readFileSync(join(REPO_ROOT, SELF), 'utf8');
  const prose = own.slice(0, own.indexOf('const TRIAGE'));
  FORM_A.lastIndex = 0;
  if (FORM_A.test(prose)) {
    problems.push('This file own prose now carries the swept phrase outside CONTROLS, and it excludes itself from the sweep.');
  }

  if (problems.length) {
    console.error(`\n✗ measurement-claim-triage self-test: ${problems.length} problem(s)\n`);
    for (const p of problems) console.error(`  - ${p}`);
    console.error('');
    process.exit(1);
  }
  console.log(`✓ ${SELF_TEST_VERDICT} (${CONTROLS.length} controls, ${TRIAGE.length} recorded judgements).`);
  return SELF_TEST_VERDICT;
}

if (isEntrypoint(import.meta.url)) {
  if (process.argv.includes('--self-test')) {
    if (selfTest() !== SELF_TEST_VERDICT) {
      console.error('\n✗ measurement-claim-triage: selfTest() returned without reaching its verdict.\n');
      process.exit(1);
    }
  } else report({ reviewOnly: process.argv.includes('--review') });
}
