#!/usr/bin/env node
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * verify-review-tier — was a contract-review sub-agent SERVED at `CONTRACT_REVIEW_TIER`?
 *
 * A `## Contract review` record names its tier as the constant's NAME (`Served-tier: CONTRACT_REVIEW_TIER`),
 * because no model identifier may land in a comment. The name is a declaration the seat writes; nothing in the
 * record proves which model served the review. A sub-agent launched without its tier's model parameter, or one
 * the harness switched to another model mid-run, writes a record that reads exactly like an at-tier one. This
 * script reads the reviewer's own transcript — the evidence that never leaves the seat's container — and answers
 * whether every turn of it was served at the tier.
 *
 * ## Usage — from the repo root
 *
 *   node scripts/pm/verify-review-tier.mjs PATH      # the Agent tool's output file for the review sub-agent
 *   node scripts/pm/verify-review-tier.mjs --self-test
 *
 * `post-stamped.mjs --tier-evidence=PATH` runs the same check before it writes a record that names the tier.
 *
 * ## The transcript it reads (measured on this harness's Agent tool output files)
 *
 * JSON Lines, one entry per line. An entry with `type: 'assistant'` is one model turn: `message.model` is the
 * model that SERVED it and `requestedModel` the one the harness asked for. An entry with `type: 'attachment'`
 * whose `attachment.type` is `model` carries `attachment.identity.modelId`, the model the run was told it is.
 * The model-fallback notice ("switched to … because its earlier model could not be used") was seen only in the
 * parent's completion notification, never in the sub-agent's file; a mid-run switch shows in the file as a turn
 * served by another model, which refuses on its own. The notice is still refused if a harness-written `system`
 * entry carries it. ⛔ The notice is NOT searched in tool results, assistant text or attachments: a review that
 * reads this file, the rulebook or a memory note quoting the notice would refuse itself.
 *
 * ## Verdict — passes ONLY when all of these hold
 *
 *   - the file reads, is non-empty, and every non-blank line parses as a JSON object;
 *   - at least one assistant turn exists, and every one names a served model equal to `CONTRACT_REVIEW_TIER`
 *     (a turn with no model field refuses: a turn nobody can attribute is not a turn at the tier);
 *   - every `requestedModel` and every `model` attachment present names the same value;
 *   - no `system` entry carries the fallback notice.
 *
 * ⛔ Output carries no model identifier and no transcript content: a seat may quote it, and AGENTS.md keeps model
 * identifiers out of every GitHub artefact. A turn served elsewhere is named by its line number only.
 *
 * Boundary: this catches honest failure (a missing model parameter, a mid-run fallback). It does not stop a seat
 * writing a false record or passing another run's transcript; that is the post-merge audit's job.
 *
 * Exit: 0 served at the tier · 1 refused (the reason is printed) · 2 usage.
 */

import { readFileSync } from 'node:fs';
import process from 'node:process';
import { isEntrypoint } from '../invoked-as.mjs';
import { CONTRACT_REVIEW_TIER, CONTRACT_REVIEW_TIER_NAME } from './dispatch-gates.mjs';

export const EXIT_OK = 0;
export const EXIT_REFUSED = 1;
export const EXIT_USAGE = 2;

/** The harness's model-fallback notice, as the completion notification words it. */
export const FALLBACK_NOTICE = /\bswitched to\b[^\n]*\bbecause its earlier model could not be used\b/i;

/** Every string inside a value, flattened — for the notice scan of a harness `system` entry. */
function stringsOf(value, out = []) {
  if (typeof value === 'string') out.push(value);
  else if (Array.isArray(value)) for (const v of value) stringsOf(v, out);
  else if (value !== null && typeof value === 'object') for (const v of Object.values(value)) stringsOf(v, out);
  return out;
}

/**
 * Judge one transcript's text. Pure.
 * @param {string} text the transcript file's contents
 * @param {string} tier the model value every turn must equal; defaults to `CONTRACT_REVIEW_TIER`
 * @returns {{ ok: true, turns: number } | { ok: false, reason: string }}
 */
export function judgeReviewTranscript(text, tier = CONTRACT_REVIEW_TIER) {
  const name = CONTRACT_REVIEW_TIER_NAME;
  const raw = String(text ?? '');
  if (raw.trim() === '') return { ok: false, reason: 'the transcript is empty — no turn can be read, so none is at the tier' };
  let turns = 0;
  const lines = raw.split(/\r?\n/);
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i].trim();
    if (line === '') continue;
    const at = `line ${i + 1}`;
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      return { ok: false, reason: `${at} is not JSON — a transcript that does not parse whole cannot show every turn` };
    }
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
      return { ok: false, reason: `${at} is not a JSON object — not a transcript entry` };
    }
    if (entry.type === 'assistant') {
      turns += 1;
      const served = entry.message?.model;
      if (typeof served !== 'string' || served === '') {
        return { ok: false, reason: `${at} is an assistant turn with no served model — a turn nobody can attribute is not at ${name}` };
      }
      if (served !== tier) return { ok: false, reason: `${at} is an assistant turn served by a model other than ${name}` };
      if ('requestedModel' in entry && entry.requestedModel !== tier) {
        return { ok: false, reason: `${at} is an assistant turn whose requested model is not ${name}` };
      }
    } else if (entry.type === 'attachment' && entry.attachment?.type === 'model') {
      if (entry.attachment?.identity?.modelId !== tier) {
        return { ok: false, reason: `${at} tells the run it is a model other than ${name}` };
      }
    } else if (entry.type === 'system' && stringsOf(entry).some((s) => FALLBACK_NOTICE.test(s))) {
      return { ok: false, reason: `${at} carries the harness's model-fallback notice — the run left ${name}` };
    }
  }
  if (turns === 0) return { ok: false, reason: `no assistant turn names a served model — nothing shows the review ran at ${name}` };
  return { ok: true, turns };
}

/** Read a transcript file and judge it. Never throws: an unreadable file is a refusal. */
export function verifyReviewTranscriptFile(path, tier = CONTRACT_REVIEW_TIER) {
  if (typeof path !== 'string' || path === '') return { ok: false, reason: 'no transcript path was given' };
  let text;
  try {
    text = readFileSync(path, 'utf8');
  } catch (err) {
    return { ok: false, reason: `the transcript could not be read (${err.code ?? 'read error'})` };
  }
  return judgeReviewTranscript(text, tier);
}

/** The one-line verdict a caller prints. ⛔ No model identifier, no path. */
export function verdictText(verdict) {
  return verdict.ok
    ? `verify-review-tier: PASS — ${verdict.turns} assistant turn(s), every one served at ${CONTRACT_REVIEW_TIER_NAME}.`
    : `verify-review-tier: REFUSED — ${verdict.reason}.`;
}

// ---------------------------------------------------------------------------
// Self-test — pinned battery NAMES with floors, and a verdict handshake (AGENTS.md, Writing a `--self-test`).
// ---------------------------------------------------------------------------

let selfTestReachedVerdict = false;

const SELF_TEST_BATTERIES = Object.freeze({
  'passes: every turn at the tier': 3,
  'refuses: a turn, a request or an identity off the tier': 4,
  'refuses: the fallback notice in a harness entry, and only there': 3,
  'refuses: no model field, empty, unparseable or unreadable': 6,
  'output: no model identifier and no path in any verdict line': 2,
});
const SELF_TEST_BATTERY_FLOOR = 5;

function selfTest() {
  const TIER = CONTRACT_REVIEW_TIER;
  const OTHER = 'other-model-for-the-self-test';
  const seen = new Map();
  let current = null;
  let failed = 0;
  const battery = (name) => {
    current = name;
  };
  const t = (label, ok) => {
    seen.set(current, (seen.get(current) ?? 0) + 1);
    if (ok) console.log(`  ✓ ${label}`);
    else {
      failed += 1;
      console.error(`  ✗ ${label}`);
    }
  };
  const jl = (...entries) => entries.map((e) => (typeof e === 'string' ? e : JSON.stringify(e))).join('\n');
  const user = { type: 'user', message: { role: 'user', content: 'review this' } };
  const turn = (model, requested = model) => ({ type: 'assistant', requestedModel: requested, message: { role: 'assistant', model, content: [] } });
  const ident = (modelId) => ({ type: 'attachment', attachment: { type: 'model', identity: { modelId } } });
  const NOTICE = 'This agent switched to another model because its earlier model could not be used.';
  const toolResult = (text) => ({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', content: text }] } });

  battery('passes: every turn at the tier');
  const pass = judgeReviewTranscript(jl(user, ident(TIER), turn(TIER), turn(TIER)));
  t('all turns at the tier, with a matching identity attachment, pass and count the turns', pass.ok && pass.turns === 2);
  t('a turn with no requestedModel key still passes on its served model', judgeReviewTranscript(jl(user, { type: 'assistant', message: { model: TIER } })).ok);
  t('blank lines and a trailing newline are not entries', judgeReviewTranscript(`${jl(user, turn(TIER))}\n\n`).ok);

  battery('refuses: a turn, a request or an identity off the tier');
  t('one off-tier turn among at-tier turns refuses, naming its line', (() => {
    const v = judgeReviewTranscript(jl(user, turn(TIER), turn(OTHER), turn(TIER)));
    return !v.ok && v.reason.startsWith('line 3 ');
  })());
  t('a run served entirely off the tier refuses', !judgeReviewTranscript(jl(user, turn(OTHER), turn(OTHER))).ok);
  t('a turn served at the tier but requested as another model refuses', !judgeReviewTranscript(jl(user, turn(TIER, OTHER))).ok);
  t('a model attachment naming another model refuses', !judgeReviewTranscript(jl(user, ident(OTHER), turn(TIER))).ok);

  battery('refuses: the fallback notice in a harness entry, and only there');
  t('a system entry carrying the fallback notice refuses', !judgeReviewTranscript(jl(user, turn(TIER), { type: 'system', content: NOTICE })).ok);
  t('the notice nested in a system entry still refuses', !judgeReviewTranscript(jl(user, turn(TIER), { type: 'system', data: { lines: [NOTICE] } })).ok);
  t('⛔ the notice quoted in a tool result (a reviewer reading the rulebook) does NOT refuse', judgeReviewTranscript(jl(user, toolResult(NOTICE), turn(TIER))).ok);

  battery('refuses: no model field, empty, unparseable or unreadable');
  t('an assistant turn with no model field refuses', !judgeReviewTranscript(jl(user, { type: 'assistant', message: { role: 'assistant', content: [] } })).ok);
  t('a transcript with no assistant turn refuses', !judgeReviewTranscript(jl(user, ident(TIER))).ok);
  t('an empty transcript refuses', !judgeReviewTranscript('').ok && !judgeReviewTranscript('  \n\n').ok);
  t('a line that is not JSON refuses (a torn last line too)', !judgeReviewTranscript(`${jl(user, turn(TIER))}\n{"type":"assis`).ok);
  t('a JSON value that is not an object refuses', !judgeReviewTranscript(jl(user, '[1,2]', turn(TIER))).ok);
  t('a path that does not exist refuses with a reason, never throws', (() => {
    const v = verifyReviewTranscriptFile('/nonexistent/verify-review-tier-self-test.output');
    return !v.ok && v.reason.includes('could not be read') && !verifyReviewTranscriptFile('').ok;
  })());

  battery('output: no model identifier and no path in any verdict line');
  const lines = [
    verdictText(pass),
    verdictText(judgeReviewTranscript(jl(user, turn(OTHER)))),
    verdictText(judgeReviewTranscript(jl(user, ident(OTHER), turn(TIER)))),
    verdictText(judgeReviewTranscript(jl(user, turn(TIER, OTHER)))),
    verdictText(verifyReviewTranscriptFile('/nonexistent/verify-review-tier-self-test.output')),
  ];
  t('no verdict line carries the tier value or the other model', lines.every((l) => !l.includes(TIER) && !l.includes(OTHER)));
  t('no verdict line carries the path it read', lines.every((l) => !l.includes('/nonexistent/')));

  const floorFailure = (message) => {
    failed += 1;
    console.error(`✗ self-test floor: ${message}`);
  };
  const declared = Object.keys(SELF_TEST_BATTERIES);
  if (declared.length < SELF_TEST_BATTERY_FLOOR) {
    floorFailure(`SELF_TEST_BATTERIES declares ${declared.length} batteries, below the pinned ${SELF_TEST_BATTERY_FLOOR}.`);
  }
  for (const [name, count] of seen) {
    if (!(name in SELF_TEST_BATTERIES)) floorFailure(`battery "${name}" registered ${count} case(s) but is not declared.`);
  }
  for (const name of declared) {
    const count = seen.get(name) ?? 0;
    if (count < SELF_TEST_BATTERIES[name]) {
      floorFailure(
        count === 0
          ? `battery "${name}" DID NOT RUN — 0 cases registered, ${SELF_TEST_BATTERIES[name]} pinned.`
          : `battery "${name}" registered ${count} case(s), below its pinned floor of ${SELF_TEST_BATTERIES[name]}.`,
      );
    }
  }
  if (failed > 0) {
    console.error(`\n✗ verify-review-tier self-test: ${failed} failure(s) (cases and floor).`);
    process.exit(1);
  }
  console.log(`\n✓ verify-review-tier self-test: ${[...seen.values()].reduce((a, b) => a + b, 0)} cases pass across ${declared.length} batteries.`);
  selfTestReachedVerdict = true;
  return 0;
}

function main(argv) {
  const args = argv.filter((a) => a !== '');
  if (args.length !== 1 || args[0].startsWith('-')) {
    console.error('usage: node scripts/pm/verify-review-tier.mjs PATH   (the review sub-agent\'s output transcript) · --self-test');
    return EXIT_USAGE;
  }
  const verdict = verifyReviewTranscriptFile(args[0]);
  (verdict.ok ? console.log : console.error)(verdictText(verdict));
  return verdict.ok ? EXIT_OK : EXIT_REFUSED;
}

if (isEntrypoint(import.meta.url)) {
  if (process.argv.includes('--self-test')) {
    const code = selfTest();
    if (!selfTestReachedVerdict) {
      console.error('\n✗ verify-review-tier self-test: selfTest() returned without reaching its verdict, so no success line was printed.');
      process.exit(1);
    }
    process.exit(code);
  } else {
    process.exit(main(process.argv.slice(2)));
  }
}
