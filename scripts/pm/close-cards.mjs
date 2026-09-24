#!/usr/bin/env node
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * close-cards — the three-step card closure (comment · label · close), as ONE
 * NAMED command (#19469), and — under the fleet-write relay — as ONE WRITE per
 * card (#19824).
 *
 * ## Usage — from the REPO ROOT, as one command, with no `cd … &&` in front
 *
 *   node scripts/pm/close-cards.mjs --repo owner/name --plan plan.txt --dry-run
 *   node scripts/pm/close-cards.mjs --repo owner/name --plan plan.txt
 *   node scripts/pm/close-cards.mjs --self-test          # offline, no network at all
 *
 * ## The plan file — one card, one reason, one comment file of its own
 *
 * One row per card, `N|REASON|COMMENT-FILE` (`#N` or `N`; blank lines allowed;
 * a relative COMMENT-FILE resolves against the plan file's own directory):
 *
 *   19440|not_planned|19440.md
 *   #19408|completed|19408.md
 *
 * ⛔ There is no batch-wide comment and no batch-wide reason. The maintainer's
 * standing rule is never to post the same comment text on many cards in a
 * burst, and each card's closing comment is its own ruling anyway — so the
 * plan is REFUSED, before any card is read, when two rows name one comment
 * file, or when two comment files carry the same text once whitespace is
 * collapsed and every digit run is masked (a card number is not what makes a
 * comment a different comment). A card named twice is refused too: two rows
 * are two decisions about one card. The retired `--list` / `--comment` /
 * `--reason` flags are refused by name, with this spelling.
 *
 * ⛔ The leading `cd /path/to/objectstack && ` a seat habitually types is what
 * this tool exists to remove. A session's allow rule is a PREFIX match against
 * the command AS TYPED, so `cd … && node scripts/pm/close-cards.mjs …` matches
 * no rule naming this script and falls to the write classifier — the coin flip
 * this card was filed for. Run it from the repo root, or name the script with
 * an absolute path and nothing before it.
 *
 * ## The measured defect this closes
 *
 * Two seats, one wall, one day. A 90-card closing sweep spelled as a bash loop
 * over `post-stamped.mjs` → `label-write.mjs` → `PATCH /issues/{n}` was refused
 * by the session runtime's write classifier before any request. The second seat
 * took the same order: 90 cards passed its live gate, 77 were actionable, ONE
 * closed, and then a batch script, an inline three-card loop and a single
 * `post-stamped --comment=…` were each refused — the identical command shape
 * that had just succeeded twice. It stopped rather than grind a coin-flip
 * channel across 76 three-step acts, because a comment that lands without its
 * label write is a HALF-STATE on the board.
 *
 * The two seat-write rules that existed are spelled with the `--use-env-proxy`
 * flag inside the prefix (`Bash(node --use-env-proxy scripts/pm/post-stamped.mjs *)`),
 * and seats invoke `node scripts/pm/post-stamped.mjs …` — the tool re-execs
 * ITSELF with that flag. So neither rule matched, and no rule named a batch
 * shape at all. One named script is one prefix to allow.
 *
 * ## What this file does NOT contain
 *
 * ⛔ No stamping and ⛔ no four-step label write. Both already exist, both are
 * self-tested, and a second copy of either is a second answer to a question
 * this repo has settled:
 *
 *   - the comment: its stamp and its refusals are post-stamped's exported
 *     pure half (`renderBody`, `claimKeyedLineRefusals`), run by the pre-flight
 *     below ONCE per plan row before card one, and again on the act's own
 *     clock when the card is packed. On the DIRECT transport the write itself
 *     is `scripts/pm/post-stamped.mjs` driven as a CHILD PROCESS (its write
 *     path is module-private) with its documented flags — `--repo=`,
 *     `--comment=N`, `--file=`, `--json` — its exit code read BEFORE any pipe.
 *     On the RELAY the comment is post-stamped's own `relayAction`, and its
 *     read-back is post-stamped's `pickRelayComment` + `readBackVerdict`.
 *   - the labels: on the DIRECT transport the write goes through
 *     `runLabelWrite` from `scripts/pm/label-write.mjs`, in-process, with its
 *     own `parseOptions` building the options — the four steps, the
 *     additive-verb order, the `PATCH` fallback and the read-back are the same
 *     program the CLI runs. On the RELAY, `runLabelWrite` binds step ③ and
 *     step ④ into one call (its ③ sends its own dispatch), so the pack reuses
 *     its exported halves instead: ① is this tool's live card read, ② is
 *     `computeLabelTarget`, ③ is `relayActions` inside the card's one
 *     dispatch, ④ is `readBackVerdict` + `verdictIsClean` against the ②
 *     target after the run — and ⛔ ④ is never skipped for being packed.
 *     What the pack does NOT borrow is ④'s re-add of a label stripped
 *     underneath: that is a write, and under the relay a second one; a strip
 *     is REPORTED as a read-back mismatch (exit 4) and the run stops.
 *   - the pm-state vocabulary (`PM_EXCLUSIVE_STATE_LABELS`, `PM_STATE_CLAIM`,
 *     `PM_RESIDUE_LABELS`) is imported from `check-half-states.mjs`. ⛔ Never
 *     restate a label set.
 *
 * ## The skip matrix — the card is RE-READ live first, always
 *
 * Any list snapshot is void by the time a batch reaches card 40, so every card
 * is read at the moment it is acted on. It is SKIPPED and logged when:
 *
 *   1. it is not open;
 *   2. it carries an assignee — somebody owns it;
 *   3. it carries `pm:retriage` — a summons is outstanding;
 *   4. its pm-state is not EXACTLY the expected label (default `pm:queue`):
 *      no state, a different state, or two states all skip;
 *   5. an OPEN pull request references it (`--skip-pr-referenced`, default on).
 *
 * ### Which PR reading, and why
 *
 * `GET /repos/{o}/{r}/issues/{n}/timeline`, `cross-referenced` events whose
 * `source.issue` carries a `pull_request` object, counted as a hit only when
 * that source issue's `state` is `open`. That endpoint is the one this tree
 * already declares reachable for cross-references
 * (`.claude/skills/pm-dispatch/references/rest-channel.md`, 读侧). ⛔ Not
 * `/search/issues`: the egress proxy refuses `/search/*` by design, so a search
 * reading would make the default skip unavailable on exactly the seats this
 * tool is for. ⛔ Not `closed_by_pull_requests_references`: it answers "which PR
 * would CLOSE this", which is narrower than "an open PR references it" and
 * would silently pass a card an open PR merely mentions.
 *
 * A timeline read that FAILS is not a "no": it stops the run (exit 3), because
 * skipping a card on an unread signal and closing a card on an unread signal
 * are both verdicts taken from nothing.
 *
 * ⛔ And ONE page is not the timeline. Measured on this tree while this script
 * was being written: of the 90 cards in the first batch it was built for, one
 * (#13799) carries more than 100 timeline events, so a single
 * `?per_page=100` read returns a truncated history at HTTP 200 with nothing
 * saying so — and a cross-reference on page 2 reads exactly like no
 * cross-reference at all. The walk below therefore pages by NUMBER until a
 * short page (the spelling `references/rest-channel.md` prescribes, cursor
 * exhaustion having been measured to stop early on this platform), and a card
 * whose timeline is still not exhausted at `TIMELINE_PAGE_CAP` pages STOPS the
 * run rather than deciding on what it managed to read.
 *
 * ## The three steps, in order, and the one state that must never be left
 *
 * Per actionable card, in this order:
 *
 *   ① comment  — the card's own comment file, stamped on the act's clock;
 *   ② label    — remove the card's pm-state (`--expect-state`) and any other
 *                label `PM_RESIDUE_LABELS` names that it carries — the claims
 *                of work in flight a closed card must not keep. Identity
 *                stickers (`pm:seat`, `pm:epic`) are not residue and stay;
 *   ③ close    — `state: closed` with the row's `state_reason`, then READ IT
 *                BACK: an answer that does not say `closed` is not a close.
 *
 * A card whose ① landed and whose ② or ③ did not is a HALF-WRITE: a closing
 * comment under a card that is still open and still claims `pm:queue`. The run
 * STOPS at the first one — ⛔ it does not continue to the next card, and ⛔ it
 * does not retry — and exits 4 naming the card and exactly which steps landed.
 * Continuing would turn one half-state into a page of them.
 *
 * ## The transport — `OS_FLEET_TRANSPORT` direct | dispatch | auto
 *
 * ONE route is resolved per run and serves every write in it. `auto` (the
 * default) takes `dispatch` in a cloud seat container and `direct` elsewhere,
 * and says which.
 *
 * DISPATCH — ONE card, ONE write. The three steps are packed into ONE
 * `repository_dispatch` carrying exactly `[comment, labels_remove,
 * issue_patch]`, in that order, and `write-pace.mjs` counts that dispatch as
 * the card's one write (the throttle's hourly cap is unchanged; a card costs a
 * third of what it did). The relay executor stops at its FIRST failing action,
 * so the order alone keeps the invariant the three separate writes kept: no
 * label strip and no close without the comment. ⛔ One card per dispatch,
 * never two: a failure then only ever stops its own card. The packed payload
 * is judged by the relay's own validator (the platform's 64KB `client_payload`
 * ceiling, the body cap, the op table) — for every plan row BEFORE card one is
 * read, and again for the card itself before anything is sent — so an
 * oversized comment is refused with zero writes, never discovered on card 40.
 * After the run, step ④ reads the BOARD back — the card (state, reason,
 * labels) and the comments since the dispatch — and only a card whose three
 * effects all read back, with the labels MATCHING the ② target, counts as
 * closed. A run that FAILED is read back the same way to say which steps
 * landed. A run that did not appear or did not complete is UNCONFIRMED (exit
 * 6), ⛔ never retried and ⛔ never fallen back from — not even under `auto`:
 * the pack's first action is a comment, so a direct replay of a dispatch that
 * may still run is a second closing comment, written as the seat's own user.
 *
 * DIRECT — three writes, each by the tool that owns it: post-stamped as a
 * child (handed `OS_FLEET_TRANSPORT=direct`, so it cannot pick a route of its
 * own), `runLabelWrite` handed THIS run's route, then the `PATCH`.
 *
 * ## Exit codes — capture them BEFORE any pipe
 *
 *   0  every non-skipped card landed all three steps and read them back (a run
 *      of all-skips too).
 *   2  usage, or a REFUSAL before any write — the plan, a comment the
 *      pre-flight refuses, a packed payload the relay's validator refuses.
 *      ⛔ ZERO writes on the card it names, and on every card after it.
 *   3  PREREQUISITE NOT MET — no token, no route, or a read that failed. ⛔ NOT
 *      MEASURED for every card after the one that could not be read.
 *   4  HALF-WRITE or READ-BACK MISMATCH — a card is on the board in a state
 *      nobody asked for. The message names the card and the steps that
 *      landed. Go look at that card.
 *   5  the platform REFUSED a write outright and nothing landed for that card.
 *   6  UNCONFIRMED — the card's dispatch was accepted and its run did not
 *      appear, or did not complete, within the ceiling. Go READ the card and
 *      the run; ⛔ never re-run blind — a second dispatch is a second write.
 *
 *   `node scripts/pm/close-cards.mjs … > /tmp/cc.log 2>&1; EXIT=$?; tail -40 /tmp/cc.log`
 */

import process from 'node:process';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { isEntrypoint } from '../invoked-as.mjs';
import {
  EXIT_PREREQUISITE_NOT_MET,
  PM_EXCLUSIVE_STATE_LABELS,
  PM_RESIDUE_LABELS,
  PM_STATE_CLAIM,
  PROXY_FLAG,
  protocolStamps,
  proxyRearmPlan,
  proxyRoute,
  resolveSweepRepo,
} from './check-half-states.mjs';
import { EXIT_UNCONFIRMED as DISPATCH_EXIT_UNCONFIRMED, exitForResult, packRequest, resolveRoute, sendFleetWrite, unconfirmedText } from './fleet-write/dispatch.mjs';
import { CLIENT_PAYLOAD_MAX_BYTES, TRANSPORT_ENV } from './fleet-write/ops.mjs';
import { refusalText as relayRefusalText } from './fleet-write/validate.mjs';
import {
  classifyHttp,
  computeLabelTarget,
  readBackVerdict as labelReadBackVerdict,
  parseOptions as parseLabelWriteOptions,
  relayActions,
  runLabelWrite,
  verdictIsClean,
} from './label-write.mjs';
import { isWriteMethod, noteResponse, paceWrite, releaseWriteLease } from './write-pace.mjs';
import {
  EXIT_NOT_STORED as POST_STAMPED_EXIT_NOT_STORED,
  PLATFORM_COMMENT_FOOTER,
  STAMP_TOKEN,
  claimKeyedLineRefusals,
  readBackVerdict as commentReadBackVerdict,
  keyedLineRefusalText,
  pickRelayComment,
  relayAction,
  renderBody,
} from './post-stamped.mjs';

const SELF_PATH = fileURLToPath(import.meta.url);
const POST_STAMPED_PATH = fileURLToPath(new URL('./post-stamped.mjs', import.meta.url));
const API = 'https://api.github.com';
const TOKEN = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN ?? '';

/** ⛔ THIS tool's own re-exec guard name (#18939): a sibling's inherited guard must never silence it. */
const PROXY_REARM_GUARD = 'OS_CLOSE_CARDS_PROXY_REARMED';

export const EXIT_OK = 0;
export const EXIT_USAGE = 2;
export const EXIT_PREREQUISITE = EXIT_PREREQUISITE_NOT_MET;
export const EXIT_HALF_WRITE = 4;
export const EXIT_PLATFORM_REFUSAL = 5;
/** Dispatched, outcome not confirmed — the relay's one shared exit, imported rather than restated. */
export const EXIT_UNCONFIRMED = DISPATCH_EXIT_UNCONFIRMED;

/** The `state_reason` values GitHub accepts on a close. ⛔ Never a free string: a typo closes 90 cards as the wrong kind. */
export const CLOSE_REASONS = Object.freeze(['not_planned', 'completed', 'duplicate']);

/** The annotation that says a summons is outstanding — a card carrying it is never swept. */
export const RETRIAGE_LABEL = 'pm:retriage';

/** The three steps, in the order they are spent. Named once so the log, the refusal and the self-test read one list. */
export const STEPS = Object.freeze(['comment', 'label', 'close']);

/**
 * The relay ops ONE card's dispatch carries, in the only order it may carry
 * them. The executor stops at its first failure, so this order IS the
 * invariant "no strip and no close without the comment".
 */
export const PACK_ORDER = Object.freeze(['comment', 'labels_remove', 'issue_patch']);

/** The flags the plan file retired — each is refused BY NAME with the spelling that replaced it. */
export const RETIRED_FLAGS = Object.freeze(['--list', '--comment', '--reason']);

const DEFAULT_EXPECT_STATE = 'pm:queue';

/**
 * How many 100-event timeline pages one card may take before the walk refuses.
 * ⛔ Not a paging convenience: it is the point at which "I have not finished
 * reading" must stop being reported as "I read it all and found nothing".
 */
export const TIMELINE_PAGE_CAP = 30;

const render = (values) => (values.length ? values.map((v) => `\`${v}\``).join(', ') : 'none');

// ---------------------------------------------------------------------------
// The plan file — pure, because a misread plan is the whole act pointed at the
// wrong cards, with the wrong reasons, under the wrong comments.
// ---------------------------------------------------------------------------

/**
 * Rows out of a plan file: `N|REASON|COMMENT-FILE` per line, `#N` or `N`, blank
 * lines skipped. A relative COMMENT-FILE resolves against `baseDir` — the plan
 * file's own directory — so a plan and its comments travel together.
 *
 * ⛔ A `#` cannot introduce a comment here — `#19440` IS the ordinary spelling
 * of a card, and a parser that dropped those lines would silently close
 * nothing and report a clean run. So every non-blank line must BE a row:
 * anything else is refused by line number rather than skipped.
 *
 * ⛔ A card named twice is REFUSED, never collapsed: two rows are two decisions
 * (two reasons, two comments) about one card, and picking one is a ruling this
 * tool does not get to make. ⛔ Two rows naming one comment file are refused
 * too — that is the batch-wide comment this plan replaced, spelled twice.
 */
export function parsePlan(raw, { baseDir = process.cwd() } = {}) {
  const lines = String(raw ?? '').split(/\r?\n/);
  const rows = [];
  const errors = [];
  lines.forEach((line, i) => {
    const text = line.trim();
    if (text.length === 0) return;
    const at = `line ${i + 1} (\`${text.length > 80 ? `${text.slice(0, 77)}…` : text}\`)`;
    const fields = text.split('|').map((f) => f.trim());
    if (fields.length !== 3) {
      errors.push(`${at} has ${fields.length} field(s); a row is exactly \`N|REASON|COMMENT-FILE\`. ⛔ Nothing here is a comment: \`#\` opens a card number.`);
      return;
    }
    const [num, reason, file] = fields;
    if (!/^#?\d+$/.test(num) || Number(num.replace(/^#/, '')) <= 0) {
      errors.push(`${at}: \`${num}\` is not a card number (\`#19440\` or \`19440\`).`);
      return;
    }
    if (!CLOSE_REASONS.includes(reason)) {
      errors.push(`${at}: \`${reason}\` is not a close reason. GitHub takes ${render(CLOSE_REASONS)}, and nothing else.`);
      return;
    }
    if (file.length === 0) {
      errors.push(`${at} names no comment file — every card gets a closing comment of its own.`);
      return;
    }
    rows.push({ line: i + 1, issue: Number(num.replace(/^#/, '')), reason, commentFile: isAbsolute(file) ? file : resolve(baseDir, file) });
  });
  if (errors.length > 0) {
    return { ok: false, error: `the --plan file carries ${errors.length} line(s) that are not rows:\n${errors.map((e) => `  - ${e}`).join('\n')}` };
  }
  if (rows.length === 0) return { ok: false, error: 'the --plan file names no cards at all. ⛔ An empty plan is refused, never read as "nothing to do".' };

  const twice = (key) => {
    const seen = new Map();
    for (const row of rows) seen.set(row[key], [...(seen.get(row[key]) ?? []), row]);
    return [...seen.values()].filter((group) => group.length > 1);
  };
  const cards = twice('issue');
  if (cards.length > 0) {
    return {
      ok: false,
      error:
        `the --plan file names ${cards.map((g) => `#${g[0].issue} on lines ${g.map((r) => r.line).join(', ')}`).join('; ')}. ` +
        'Two rows are two decisions about one card — ⛔ refused, never collapsed: keep the row that is the ruling.',
    };
  }
  const files = twice('commentFile');
  if (files.length > 0) {
    return {
      ok: false,
      error:
        `the --plan file hands one comment file to more than one card: ${files.map((g) => `\`${g[0].commentFile}\` → ${g.map((r) => `#${r.issue}`).join(', ')}`).join('; ')}. ` +
        '⛔ Never the same comment text on many cards in a burst — each card gets a comment file of its own.',
    };
  }
  return { ok: true, rows };
}

/**
 * The text a burst comparison reads: whitespace collapsed and every digit run
 * masked. A template whose only difference is the card number it names is the
 * same comment text posted on many cards — the thing the rule forbids.
 */
export function burstKey(text) {
  return String(text ?? '')
    .replace(/\d+/g, '0')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Judge every row's comment before card one is read: post-stamped's refusals
 * (through `preflightComment`), and the burst rule across rows. Pure. Every
 * refusal is collected, so one run names every row to fix rather than the
 * first.
 *
 * @param {{issue:number, commentFile:string, text:string}[]} rows
 */
export function judgePlanComments(rows, nowMs = Date.now()) {
  const refused = [];
  for (const row of rows ?? []) {
    const pre = preflightComment(row.text, nowMs);
    if (!pre.ok) refused.push({ issue: row.issue, commentFile: row.commentFile, kind: pre.kind, error: pre.error });
  }
  const groups = new Map();
  for (const row of rows ?? []) {
    const key = burstKey(row.text);
    groups.set(key, [...(groups.get(key) ?? []), row.issue]);
  }
  const repeated = [...groups.values()].filter((issues) => issues.length > 1);
  return { ok: refused.length === 0 && repeated.length === 0, refused, repeated };
}

/** The refusal `judgePlanComments` produces, as the lines a seat reads. */
export function planCommentRefusalText({ refused = [], repeated = [] } = {}) {
  const lines = [`close-cards: REFUSED — the plan's comments fail the pre-flight on ${refused.length + repeated.length} count(s):`];
  for (const r of refused) lines.push(`  - #${r.issue} (${r.commentFile}) [${r.kind}]:`, ...String(r.error).split('\n').map((l) => `      ${l}`));
  for (const issues of repeated) {
    lines.push(
      `  - ${issues.map((n) => `#${n}`).join(', ')} carry the SAME comment text (identical once whitespace is collapsed and every number masked). ` +
        '⛔ The maintainer\'s standing rule: never the same comment text on many cards in a burst — write each card its own.',
    );
  }
  lines.push('close-cards: ⛔ NOTHING was read and NOTHING was written — every card in the plan has zero writes.');
  return lines.join('\n');
}

/**
 * The labels ONE card's close strips: its pm-state, plus every label
 * `PM_RESIDUE_LABELS` names that it carries — the claims of work in flight
 * the closed-card sweep would otherwise have to clear with writes of its own.
 * Identity stickers (`pm:seat`, `pm:epic`) are not residue, so they stay.
 * Imported, never restated. Pure.
 *
 * Under `--stateless` there is no expected state (`expectState` is null) and
 * the list is the residue alone — usually empty, which is what makes the
 * strip a step the card does not owe rather than a step that failed.
 */
export function stripLabels(card, expectState) {
  const labels = labelNamesOf(card?.labels);
  const out = expectState ? [expectState] : [];
  for (const l of labels) if (PM_RESIDUE_LABELS.includes(l) && !out.includes(l)) out.push(l);
  return out;
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

/**
 * Parse argv, or refuse. Pure — this is the layer that decides WHICH board and
 * WHICH cards, and every refusal here is one the self-test pins offline.
 *
 * `--expect-state` is validated against the IMPORTED state vocabulary rather
 * than accepted as a free string: a typo (`pm:queued`) would match no card,
 * skip all 90, and print a confident run that did nothing — the #4690 shape.
 */
export function parseCliOptions(argv) {
  const opts = {
    repo: null,
    plan: null,
    expectState: DEFAULT_EXPECT_STATE,
    stateless: false,
    skipPrReferenced: true,
    dryRun: false,
  };
  let expectStateGiven = false;
  const args = argv ?? [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const eq = arg.indexOf('=');
    const flag = eq === -1 ? arg : arg.slice(0, eq);
    const inline = eq === -1 ? null : arg.slice(eq + 1);
    const value = () => (inline === null ? args[++i] : inline);

    if (flag === '--repo') opts.repo = value();
    else if (flag === '--plan') opts.plan = value();
    else if (flag === '--expect-state') {
      opts.expectState = value();
      expectStateGiven = true;
    } else if (flag === '--stateless') {
      if (inline !== null) {
        return {
          ok: false,
          error:
            `\`--stateless\` takes no value, got \`${arg}\`. It is a mode, not a setting: \`--stateless=false\` read as ON ` +
            'would close stateless cards on a run that asked not to. Pass the bare flag, or leave it out.',
        };
      }
      opts.stateless = true;
    } else if (flag === '--skip-pr-referenced') opts.skipPrReferenced = true;
    else if (flag === '--no-skip-pr-referenced') opts.skipPrReferenced = false;
    else if (flag === '--dry-run') opts.dryRun = true;
    else if (RETIRED_FLAGS.includes(flag)) {
      return {
        ok: false,
        error:
          `\`${flag}\` is retired: a batch-wide comment and a batch-wide reason are gone. Pass \`--plan FILE\`, one row per card — ` +
          '`N|REASON|COMMENT-FILE` — so every card carries its own reason and its own comment file. ⛔ Never the same comment text ' +
          'on many cards in a burst.',
      };
    } else return { ok: false, error: `unrecognised option \`${flag}\`` };
  }

  if (!opts.plan) return { ok: false, error: '--plan FILE is required — one row per card, `N|REASON|COMMENT-FILE`' };
  if (opts.stateless) {
    // ⛔ Two modes, never both: `--expect-state` names the ONE state a card
    // must carry, `--stateless` acts only on a card carrying none. Given
    // together, one of them is a mistake, and picking which is a ruling.
    if (expectStateGiven) {
      return {
        ok: false,
        error:
          '`--stateless` and `--expect-state` are two modes, and a run takes ONE: `--stateless` acts only on a card carrying NO ' +
          'pm-state label, `--expect-state L` only on a card carrying exactly `L`. Split the plan into two runs.',
      };
    }
    // The default `pm:queue` means nothing here, so it is CLEARED rather than
    // left beside the flag for some later line to read as a state to strip.
    opts.expectState = null;
  } else if (typeof opts.expectState !== 'string' || opts.expectState.length === 0) {
    return { ok: false, error: '--expect-state takes the pm-state label a card must carry, e.g. `pm:queue`' };
  } else if (!PM_EXCLUSIVE_STATE_LABELS.includes(opts.expectState)) {
    // ⛔ And no `none` spelling joins the vocabulary: the accepted set is the
    // imported state list and nothing else, so a typo can never come to mean
    // "no state" — the card that carries none is `--stateless`'s, by name.
    return {
      ok: false,
      error:
        `\`${opts.expectState}\` is not a pm-state label. The states are ${render(PM_EXCLUSIVE_STATE_LABELS)}. ` +
        'A typo here matches no card, skips every one of them, and prints a confident run that closed nothing. ' +
        'A card carrying NO pm-state is closed by `--stateless`, never by an `--expect-state` value.',
    };
  }

  if (!opts.repo) opts.repo = resolveSweepRepo(process.env).repo;
  if (!/^[\w.-]+\/[\w.-]+$/.test(String(opts.repo))) {
    return { ok: false, error: `--repo must be owner/name, got \`${opts.repo}\`. ⛔ Refusing to fall back to another board.` };
  }

  return { ok: true, options: opts };
}

const USAGE = [
  'close-cards — the three-step card closure (comment · label · close) as ONE named command,',
  'and under the fleet-write relay as ONE dispatch — ONE write — per card.',
  '',
  '  node scripts/pm/close-cards.mjs --repo OWNER/NAME --plan FILE',
  '                                  [--expect-state pm:queue | --stateless] [--no-skip-pr-referenced] [--dry-run]',
  '  node scripts/pm/close-cards.mjs --self-test',
  '',
  '  ⛔ Invoke it from the REPO ROOT with nothing in front of `node` — no `cd … &&` compound. A session',
  '  allow rule is a PREFIX match against the command as typed, so a leading `cd` matches no rule and',
  '  drops the whole act onto the write classifier, which is the defect this script was written for.',
  '',
  '  --plan FILE      one row per card: `N|REASON|COMMENT-FILE` (`#N` or `N`; a relative COMMENT-FILE',
  `                   resolves against the plan's directory). REASON is ${CLOSE_REASONS.join(' | ')}.`,
  `                   Each comment file must carry \`${STAMP_TOKEN}\` — the clock each posting act reads.`,
  '                   ⛔ Never the same comment text on many cards: a shared file, or two files whose text',
  '                   is identical once whitespace is collapsed and numbers masked, refuses the whole plan.',
  '  --expect-state L the pm-state label a card must carry, EXACTLY and alone (default `pm:queue`).',
  '  --stateless      act ONLY on a card carrying NO pm-state label; a card carrying any is skipped. Takes',
  '                   no value, and ⛔ is refused beside --expect-state: a run is one mode or the other.',
  '  --no-skip-pr-referenced  act on a card an open PR references (the skip is ON by default).',
  '  --dry-run        re-read every card and its thread and print what would be sent — under the relay,',
  '                   each card\'s ONE payload: the steps still owed, in the order comment → labels_remove →',
  '                   issue_patch. Writes NOTHING, on any card.',
  '',
  '  Per card, re-read live first, then SKIP + log on: not open · has an assignee · carries',
  `  \`${RETRIAGE_LABEL}\` · pm-state is not exactly the expected label (under --stateless: carries any) ·`,
  '  an open PR references it. Otherwise read the card\'s thread and send only what the BOARD still owes:',
  '  the comment unless this row\'s closing comment is already there (a RESUME — ⛔ never a second one),',
  '  the strip of the pm-state and its residue labels unless nothing is left to strip, and the close with',
  '  the row\'s reason — then read all three back. Under the relay: ONE dispatch per card, never two cards.',
  '',
  `  Exits: ${EXIT_OK} every non-skipped card landed and read back · ${EXIT_USAGE} usage, or refused before any write ·`,
  `         ${EXIT_PREREQUISITE} PREREQUISITE NOT MET, nothing measured · ${EXIT_HALF_WRITE} HALF-WRITE / read-back mismatch, a card is`,
  `         in a state nobody asked for — it is NAMED · ${EXIT_PLATFORM_REFUSAL} the platform refused a write, nothing landed ·`,
  `         ${EXIT_UNCONFIRMED} UNCONFIRMED relay run, go read it. Capture the code BEFORE any pipe.`,
].join('\n');

// ---------------------------------------------------------------------------
// Pre-flight — every card's closing comment is judged before card one, by the
// tool that owns the stamp, rather than one card at a time mid-run.
// ---------------------------------------------------------------------------

/**
 * Would post-stamped accept this body, and does it carry a stamp of the posting
 * act's own? Pure: it drives post-stamped's exported `renderBody` and its
 * keyed-line refusals, so this gate and that tool cannot come to disagree.
 *
 * The one requirement this adds on top: `substituted >= 1`. post-stamped
 * accepts a body that spells no token at all (`no-token`), which is right for a
 * one-off artefact and wrong for a batch closure — an unstamped closing comment
 * records no closing time, and a batch is exactly where nobody recovers one.
 */
export function preflightComment(text, nowMs = Date.now()) {
  const rendered = renderBody(text, nowMs);
  if (!rendered.ok) return { ok: false, error: rendered.error, kind: rendered.kind };
  if (rendered.substituted < 1) {
    return {
      ok: false,
      kind: 'unstamped-batch',
      error:
        `close-cards: REFUSED — the comment file spells no \`${STAMP_TOKEN}\` outside a quotation, so its card ` +
        'would receive a closing comment carrying no closing time. A batch closure is exactly the act ' +
        `whose stamp cannot be recovered afterwards. Put \`${STAMP_TOKEN}\` where the closing time belongs.`,
    };
  }
  const keyed = claimKeyedLineRefusals(rendered.body);
  if (keyed.length > 0) return { ok: false, kind: 'keyed-line', error: keyedLineRefusalText(keyed) };
  return { ok: true, rendered };
}

// ---------------------------------------------------------------------------
// The skip matrix — pure, so every row is driven offline.
// ---------------------------------------------------------------------------

const labelNamesOf = (raw) => (Array.isArray(raw) ? raw : []).map((l) => (typeof l === 'string' ? l : l?.name)).filter(Boolean);
const loginsOf = (raw) => (Array.isArray(raw) ? raw : []).map((a) => (typeof a === 'string' ? a : a?.login)).filter(Boolean);

/**
 * Does an OPEN pull request reference this card, read off the timeline?
 *
 * A `cross-referenced` event's `source.issue` is a full issue object; the
 * `pull_request` member is what makes it a PR rather than a card, and `state`
 * is that PR's. ⛔ An event with no `source.issue` is not a silent no — it is
 * simply not a cross-reference, and every other event type is ignored here.
 */
export function openPrReferences(timeline) {
  const hits = [];
  for (const event of Array.isArray(timeline) ? timeline : []) {
    if (event?.event !== 'cross-referenced') continue;
    const source = event?.source?.issue;
    if (!source?.pull_request) continue;
    if (source?.state !== 'open') continue;
    hits.push(source.number);
  }
  return hits;
}

/**
 * Every timeline event on a card, walked by PAGE NUMBER until a short page.
 *
 * ⛔ The completeness of this read is the whole value of the open-PR skip: a
 * truncated timeline answers "no open PR references it" for a card that has
 * one, at HTTP 200, with no header or field distinguishing it from a complete
 * read. So the walk has exactly three outcomes and no fourth — exhausted,
 * refused by the transport, or NOT FINISHED — and the third is reported rather
 * than rounded down to the second page it did manage to read.
 *
 * ⛔ Page NUMBERS, not the `Link: rel="next"` cursor: cursor exhaustion has
 * been measured on this platform to stop short of the real total, and this
 * repo's channel table prescribes the page walk for that reason.
 */
export async function readTimeline(call, base, { pageSize = 100, cap = TIMELINE_PAGE_CAP } = {}) {
  return walkPages(call, (page) => `${base}/timeline?per_page=${pageSize}&page=${page}`, { pageSize, cap });
}

/**
 * The page walk both paged reads share — the three outcomes above (exhausted,
 * refused by the transport, NOT FINISHED) and no fourth. `pathFor(page)` is
 * the only thing a caller supplies.
 */
export async function walkPages(call, pathFor, { pageSize = 100, cap = TIMELINE_PAGE_CAP } = {}) {
  const events = [];
  for (let page = 1; page <= cap; page++) {
    const res = await call(pathFor(page), {});
    const verdict = classifyHttp({ status: res.status, op: 'card-read', rateRemaining: res.rateRemaining });
    if (verdict !== 'ok') return { ok: false, reason: 'transport', verdict, res, pages: page };
    const rows = Array.isArray(res.json) ? res.json : [];
    events.push(...rows);
    if (rows.length < pageSize) return { ok: true, events, pages: page };
  }
  return { ok: false, reason: 'not-exhausted', verdict: 'prerequisite', events, pages: cap };
}

/**
 * Every comment on a card updated at or after `sinceMs` — the population the
 * relay's comment read-back picks from (REST `since` filters on `updated_at`,
 * a superset of the `created_at` window `pickRelayComment` judges). Paged by
 * number like the timeline, for the same reason.
 */
export async function readCommentsSince(call, base, sinceMs, opts = {}) {
  const since = encodeURIComponent(new Date(sinceMs).toISOString());
  const pageSize = opts.pageSize ?? 100;
  return walkPages(call, (page) => `${base}/comments?per_page=${pageSize}&page=${page}&since=${since}`, { pageSize, cap: opts.cap ?? TIMELINE_PAGE_CAP });
}

/**
 * Why this card is left alone, or `null` when it is actionable. The order is
 * the order the order was written in, and the FIRST reason is the one reported:
 * a closed card with an assignee is reported as closed, which is what a reader
 * needs to know.
 *
 * The state row is the only one the mode moves. An ordinary run acts on a card
 * carrying EXACTLY `expectState`; a `--stateless` run (`stateless: true`) acts
 * only on a card carrying NO pm-state and skips one carrying any — one state or
 * two. Every other row stands in both modes.
 */
export function skipReason(card, { expectState, stateless = false, openPrs = [] } = {}) {
  if (card?.state !== 'open') return `not open (state ${card?.state ?? 'unknown'}${card?.state_reason ? `/${card.state_reason}` : ''})`;
  const assignees = loginsOf(card?.assignees).concat(card?.assignee?.login ? [card.assignee.login] : []);
  if (assignees.length > 0) return `has an assignee (${render([...new Set(assignees)])}) — somebody owns it`;
  const labels = labelNamesOf(card?.labels);
  if (labels.includes(RETRIAGE_LABEL)) return `carries \`${RETRIAGE_LABEL}\` — a summons is outstanding`;
  const states = labels.filter((l) => PM_EXCLUSIVE_STATE_LABELS.includes(l));
  if (stateless) {
    if (states.length > 0) {
      return (
        `carries ${states.length === 1 ? 'the pm-state' : `${states.length} pm-state labels`} ${render(states)} — a \`--stateless\` run acts only ` +
        'on a card carrying NONE; a stateful card is closed under `--expect-state`, where its state is stripped'
      );
    }
  } else {
    if (states.length === 0) return `carries no pm-state label, and this run acts only on \`${expectState}\` (a card carrying none closes under \`--stateless\`)`;
    if (states.length > 1) return `carries ${states.length} pm-state labels (${render(states)}) — two claims, and this run acts only on exactly \`${expectState}\``;
    if (states[0] !== expectState) {
      return `pm-state is \`${states[0]}\` (${PM_STATE_CLAIM[states[0]] ?? 'a state this run does not act on'}), not \`${expectState}\``;
    }
  }
  if (openPrs.length > 0) return `an open PR references it (${openPrs.map((n) => `#${n}`).join(', ')})`;
  return null;
}

/**
 * Every comment on a card — the whole thread, paged by number like the
 * timeline. What the resume reading below judges, bought only for a card that
 * would otherwise be acted on.
 */
export async function readThread(call, base, opts = {}) {
  const pageSize = opts.pageSize ?? 100;
  return walkPages(call, (page) => `${base}/comments?per_page=${pageSize}&page=${page}`, { pageSize, cap: opts.cap ?? TIMELINE_PAGE_CAP });
}

/**
 * Is THIS row's closing comment already on the card — left there by an
 * earlier act on the same row whose strip or close did not land (a
 * half-written close)? Returns `{ comment, body, rendered }` for the newest
 * such comment, or `null`. Pure.
 *
 * "This row's closing comment" is judged by the readings that already own the
 * question, ⛔ never a similarity of this file's own: the row's text is
 * RE-RENDERED by post-stamped's `renderBody` on the clock of every stamp the
 * stored comment spells (`protocolStamps` — the earlier act substituted ITS
 * clock, so the stored body can only equal a render on that clock), and each
 * render is judged against the stored bytes by post-stamped's
 * `pickRelayComment` — the same footer and newline tolerance the relay's own
 * read-back grants, and nothing wider. A comment that differs in one byte
 * outside a measured normalisation is not this row's comment, and the run
 * posts the row's comment as usual.
 *
 * ⛔ Not `burstKey`: masking every digit run would read "folded into #100"
 * and "folded into #101" as one comment, and a resume taken on that reading
 * leaves a card closed under a comment that is not its ruling.
 */
export function priorClosingComment(comments, text) {
  const list = Array.isArray(comments) ? comments : [];
  for (let i = list.length - 1; i >= 0; i--) {
    const comment = list[i];
    for (const stamp of new Set(protocolStamps(comment?.body))) {
      const at = Date.parse(stamp);
      if (!Number.isFinite(at)) continue;
      const rendered = renderBody(text, at);
      // A seconds-grained stamp is not one `renderBody` writes, and a render
      // whose stamp is not the one tried was not the earlier act's.
      if (!rendered.ok || rendered.stamp !== stamp) continue;
      if (pickRelayComment([comment], rendered.body, Number.NEGATIVE_INFINITY)) return { comment, body: rendered.body, rendered };
    }
  }
  return null;
}

/**
 * The relay ops ONE card still owes, read off the board: `PACK_ORDER` minus
 * the effects already there. Pure.
 *
 *   comment        — owed unless this row's closing comment is on the card
 *                    (`priorClosingComment`) — ⛔ never a second one;
 *   labels_remove  — owed while any label the close strips is still on the
 *                    card (`removeCalls` is label-write's own arithmetic over
 *                    the live read, so a label already gone is no call);
 *   issue_patch    — always: a closed card is skipped before it gets here.
 */
export function residualOps({ commentOnBoard = false, removeCalls = [] } = {}) {
  return PACK_ORDER.filter((op) => (op === 'comment' ? !commentOnBoard : op === 'labels_remove' ? removeCalls.length > 0 : true));
}

// ---------------------------------------------------------------------------
// Transport — one shape for every call, so `classifyHttp` (imported, never
// re-derived) sees the same fields whatever went wrong. ⛔ Nothing here throws
// on an HTTP status: a refusal is an observation this tool routes on.
// ---------------------------------------------------------------------------

async function rest(path, { method = 'GET', body = null } = {}) {
  // ⏱ The throttle (#19572), on the write verbs only — the `PATCH` that
  // closes a card. The comment this tool posts goes through `post-stamped.mjs`
  // as a child process, which is paced by its own transport.
  const paced = isWriteMethod(method);
  if (paced) await paceWrite({ token: TOKEN, kind: `close-cards ${method}` });
  let res;
  try {
    res = await fetch(`${API}${path}`, {
      method,
      headers: {
        accept: 'application/vnd.github+json',
        ...(TOKEN ? { authorization: `Bearer ${TOKEN}` } : {}),
        ...(body ? { 'content-type': 'application/json' } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  } catch (e) {
    if (paced) releaseWriteLease(); // ⏱ rule ④: no response will come, so the fleet's turn ends here
    return { status: 0, rateRemaining: null, json: null, detail: e?.message ?? 'fetch threw', call: `${method} ${path}` };
  }
  const rateRemaining = res.headers.get('x-ratelimit-remaining');
  let json = null;
  if (res.status !== 204) {
    try {
      json = await res.json();
    } catch {
      json = null;
    }
  }
  // ⏱ …and the other half, with the verdict `classifyHttp` already reached.
  if (paced) {
    noteResponse({
      token: TOKEN,
      status: res.status,
      headers: res.headers,
      body: json,
      verdict: classifyHttp({ status: res.status, rateRemaining: rateRemaining === null ? null : Number(rateRemaining) }),
    });
  }
  return {
    status: res.status,
    rateRemaining: rateRemaining === null ? null : Number(rateRemaining),
    json,
    detail: typeof json?.message === 'string' ? json.message : '',
    call: `${method} ${path}`,
  };
}

/**
 * The node flags a freshly spawned sibling tool needs to reach GitHub from
 * here. Pure.
 *
 * A child spawned as `node <script>` carries an EMPTY `execArgv`, so it is
 * never "already routed" however this process was started — the only question
 * is whether a proxy is configured at all and whether this node accepts the
 * flag. ⛔ This deliberately does NOT read a re-exec guard: the guard belongs to
 * the process that SET it (#18939), and reading this process's own guard here
 * would answer "already re-armed" about a child that has never run.
 */
export function childNodeFlags({ env = {}, flagSupported = true } = {}) {
  const { proxy } = proxyRoute({ env, execArgv: [] });
  return proxy && flagSupported ? [PROXY_FLAG] : [];
}

/** The `--json` document post-stamped prints on stdout, or `null` when it printed none. */
export function parsePostStampedJson(stdout) {
  const text = String(stdout ?? '').trim();
  if (!text) return null;
  const start = text.indexOf('{');
  if (start === -1) return null;
  try {
    return JSON.parse(text.slice(start));
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// The run
// ---------------------------------------------------------------------------

/**
 * The half-write refusal: the card, and exactly which of the three steps are
 * on the board. `already` names the steps that were there BEFORE this run (a
 * resume) — landed, but not by this run, and the line says so.
 */
export function halfWriteText({ issue, repo, landed = [], already = [], failedStep, detail = '' }) {
  const outstanding = STEPS.filter((s) => !landed.includes(s));
  const said = (s) => `\`${s}\`${already.includes(s) ? ' (on the board before this run)' : ''}`;
  return (
    `⛔ HALF-WRITE on ${repo}#${issue} — the \`${failedStep}\` step did not land${detail ? ` (${detail})` : ''}.\n` +
    `  LANDED: ${landed.length ? landed.map(said).join(', ') : 'nothing'} · ` +
    `OUTSTANDING: ${outstanding.map((s) => `\`${s}\``).join(', ')}.\n` +
    '  This card is now in a state nobody asked for: go READ it and finish or undo the steps above by hand.\n' +
    '  ⛔ The run STOPS here and does not touch the remaining cards — continuing would turn one half-state\n' +
    '  into a page of them. ⛔ Not retried here. A later run of the same row reads the thread and RESUMES —\n' +
    '  only the steps still owed, never a second closing comment; once the pm-state is gone, under `--stateless`.'
  );
}

/**
 * ONE card's ONE dispatch: post-stamped's own comment action, label-write's
 * `relayActions` for the ② target, and the close — the steps the card still
 * OWES (`residualOps`), in `PACK_ORDER` and in no other shape, judged by the
 * relay's own validator (the op table, the body cap, the platform's 64KB
 * `client_payload` ceiling). Pure but for the request id.
 *
 *   commentOnBoard — this row's closing comment is already on the card (a
 *                    RESUME): the pack carries no comment, ⛔ never a second;
 *   expectState    — the state an ordinary run acts on: the strip MUST take
 *                    it, because the skip matrix let the card through only
 *                    while it carried it. Null under `--stateless`, where a
 *                    card with nothing to strip packs no strip at all.
 *
 * ⛔ One card per payload, never two: the executor stops at its first failure,
 * and a second card in the same payload would be stopped by the first one's.
 * A residual pack is still ONE dispatch — fewer actions, the same one write.
 */
export function packCard({ repo, session, issue, body, labels, reason, commentOnBoard = false, expectState = null, requestId = null, now = Date.now } = {}) {
  const actions = [
    ...(commentOnBoard ? [] : [relayAction({ mode: 'comment', number: issue }, body)]),
    ...relayActions({ issue, labels }),
    { op: 'issue_patch', issue, state: 'closed', state_reason: reason },
  ];
  const ops = actions.map((a) => a.op);
  const owed = residualOps({ commentOnBoard, removeCalls: labels?.removeCalls ?? [] });
  const refuse = (why) => ({ ok: false, payload: null, actions, errors: [`card #${issue} packs ${render(ops)}; ONE card's dispatch is exactly the steps it still owes, ${render(owed)}, in the order ${render(PACK_ORDER)} — ${why}`] });
  if (ops.join(',') !== owed.join(',')) return refuse(labels?.addCalls?.length ? 'the label plan ADDS labels, which a close never does' : 'the actions are not the residue of that order');
  if (expectState && !(labels?.removeCalls ?? []).includes(expectState)) {
    return refuse(`the label plan does not strip \`${expectState}\`, so the pm-state this run acts on is not on the card`);
  }
  const packed = packRequest({ repo, session, actions, requestId, now });
  return { ...packed, actions };
}

/**
 * Which of the three steps the BOARD shows after a run — never what the run
 * said. Pure.
 *
 *   comment — a comment created since the dispatch stores the body sent
 *             (post-stamped's `pickRelayComment`: the platform's footer and
 *             newline handling tolerated, anything else not); on a RESUME
 *             (`prior`, from `priorClosingComment`), that SAME comment, by id,
 *             still storing the body its own act sent;
 *   label   — no label the ② plan removed is still on the card;
 *   close   — the card reads `closed` under the row's reason.
 *
 * `matches` is step ④'s verdict: all three landed AND label-write's
 * `verdictIsClean` over its own `readBackVerdict` of the ② target. A residual
 * pack is read back on all three exactly the same way: a step the run did not
 * send is still a step the card must SHOW.
 */
export function landedFromBoard({ card, comments, body, dispatchedAt, labels, reason, prior = null } = {}) {
  const hit = prior
    ? pickRelayComment((Array.isArray(comments) ? comments : []).filter((c) => c?.id === prior.comment?.id), prior.body, Number.NEGATIVE_INFINITY)
    : pickRelayComment(comments, body, dispatchedAt);
  const backLabels = labelNamesOf(card?.labels);
  const labelVerdict = labelReadBackVerdict({ target: labels?.target ?? [], removeCalls: labels?.removeCalls ?? [], readBack: backLabels });
  const closed = card?.state === 'closed' && card?.state_reason === reason;
  const landed = STEPS.filter((s) => (s === 'comment' ? hit !== null : s === 'label' ? labelVerdict.survivedRemoval.length === 0 : closed));
  return { hit, backLabels, labelVerdict, closed, landed, matches: landed.length === STEPS.length && verdictIsClean(labelVerdict) };
}

/**
 * Sweep the plan. `deps` is how `--self-test` drives every branch — including
 * the ones a live board cannot be made to produce on demand (a comment that
 * lands whose label write is then refused, a relay run that fails half-way).
 *
 * @param {{repo:string, rows:{issue:number, reason:string, commentFile:string, text:string}[], expectState:string|null, stateless?:boolean, skipPrReferenced:boolean, dryRun:boolean}} options
 * @param {{call?:Function, postComment?:Function, labelWrite?:Function, send?:Function, route?:object, now?:Function, log?:Function}} [deps]
 */
export async function runCloseCards(options, deps = {}) {
  const call = deps.call ?? rest;
  const emit = deps.log ?? ((line) => console.log(line));
  const now = deps.now ?? (() => Date.now());
  const lines = [];
  const record = (line) => {
    lines.push(line);
    emit(line);
  };

  const { repo, rows, expectState, skipPrReferenced, dryRun } = options;
  const stateless = options.stateless === true;
  const stripOf = (state) => (state ? [state] : []);
  const route = deps.route ?? (await resolveRoute(process.env));
  const send = deps.send ?? sendFleetWrite;

  const postComment =
    deps.postComment ??
    (async ({ issue, file }) => {
      const flags = childNodeFlags({ env: process.env, flagSupported: process.allowedNodeEnvironmentFlags.has(PROXY_FLAG) });
      const argv = [...flags, POST_STAMPED_PATH, `--repo=${repo}`, `--comment=${issue}`, `--file=${file}`, '--json'];
      // ⛔ The child is handed THIS run's route. Left to resolve its own, it could take the relay while the label
      // write and the close go direct — one card written under two identities.
      const child = spawnSync(process.execPath, argv, { encoding: 'utf8', env: { ...process.env, [TRANSPORT_ENV]: 'direct' } });
      const exit = typeof child.status === 'number' ? child.status : 1;
      const doc = parsePostStampedJson(child.stdout);
      return {
        exit,
        id: doc?.id ?? null,
        url: doc?.url ?? null,
        stored: doc?.body_landed ?? null,
        detail: (child.stderr ?? '').trim().split('\n').slice(-3).join(' | ') || (child.error?.message ?? ''),
      };
    });

  const labelWrite =
    deps.labelWrite ??
    (async ({ issue, remove }) => {
      const parsed = parseLabelWriteOptions(['--repo', repo, '--issue', String(issue), '--remove', remove.join(',')]);
      if (!parsed.ok) return { exit: EXIT_USAGE, detail: parsed.error };
      const res = await runLabelWrite(parsed.options, { log: (line) => record(`      ${line}`), route, send: deps.send });
      return { exit: res.exit, detail: '' };
    });

  const counts = { read: 0, skipped: 0, actionable: 0, resumed: 0, closed: 0, dispatched: 0 };
  const skips = [];
  const closed = [];
  const payloads = [];
  const result = (exit, extra = {}) => ({ exit, repo, lines, counts, skips, closed, payloads, transport: route.transport ?? null, ...extra });
  const stopNote = () => `${counts.closed} card(s) closed so far, ${rows.length - counts.read} not reached — ⛔ NOT MEASURED for those, and nothing was written to them.`;

  record(
    `close-cards: ${dryRun ? 'DRY RUN — nothing will be written. ' : ''}${repo} · ${rows.length} card(s) · ` +
      `reasons ${render([...new Set(rows.map((r) => r.reason))])} · ` +
      `${stateless ? 'STATELESS — acts only on a card carrying NO pm-state' : `expect-state \`${expectState}\``} · open-PR skip ${skipPrReferenced ? 'ON' : 'OFF'}` +
      `${skipPrReferenced ? '' : ' (⛔ declared off: a card an open PR references will be closed under it)'}`,
  );
  if (route.error) {
    record(`close-cards: PREREQUISITE NOT MET — ${route.error}`);
    record('⛔ NOTHING was read and nothing was written.');
    return result(EXIT_PREREQUISITE);
  }
  record(`close-cards: transport ${route.transport} — ${route.reason}`);

  // ── the pack's own pre-flight: every row packed ONCE, before card one is read ──
  // A payload the relay's validator refuses (the 64KB ceiling, the body cap) is
  // refused here with ZERO writes on every card, never discovered on card 40.
  if (route.transport === 'dispatch') {
    record(
      'close-cards: ONE dispatch per card — the steps it still owes, in the order comment → labels_remove → issue_patch — so each card is ONE write on the throttle.',
    );
    const refused = [];
    for (const row of rows) {
      const pre = preflightComment(row.text, now());
      if (!pre.ok) {
        refused.push(`#${row.issue} (${row.commentFile}) [${pre.kind}]: ${pre.error}`);
        continue;
      }
      const preview = packCard({
        repo,
        session: route.session,
        issue: row.issue,
        body: pre.rendered.body,
        labels: computeLabelTarget({ current: stripOf(expectState), remove: stripOf(expectState) }),
        reason: row.reason,
        expectState,
        now,
      });
      if (!preview.ok) refused.push(`#${row.issue} (${row.commentFile}): ${preview.errors.join(' · ')}`);
    }
    if (refused.length > 0) {
      record(`close-cards: REFUSED before card one — ${refused.length} row(s) cannot be packed into a dispatch the relay would accept:`);
      for (const r of refused) record(`  - ${r}`);
      record('⛔ NOTHING was read and NOTHING was written — every card in the plan has zero writes. Shrink or fix the comment(s) named above.');
      return result(EXIT_USAGE, { refusedBeforeRun: refused });
    }
  }

  for (const row of rows) {
    const { issue, reason } = row;
    const base = `/repos/${repo}/issues/${issue}`;

    // ① Re-read live. ⛔ Any list snapshot is void — the seat that built the
    // plan is not the act that closes the card. This read is also label-write's
    // step ① (取现集) for the pack: the set the ② target is computed from.
    const read = await call(base, {});
    const readVerdict = classifyHttp({ status: read.status, op: 'card-read', rateRemaining: read.rateRemaining });
    if (readVerdict !== 'ok') {
      record(`#${issue} COULD NOT READ — ${read.call} -> HTTP ${read.status}${read.detail ? ` (${read.detail})` : ''}`);
      record(`⛔ STOPPING at #${issue}. ${counts.skipped} skipped. ${stopNote()}`);
      return result(readVerdict === 'refusal' ? EXIT_PLATFORM_REFUSAL : EXIT_PREREQUISITE, { stoppedAt: issue });
    }
    counts.read += 1;
    const card = read.json ?? {};

    // The cheap rows first: the timeline is bought ONLY for a card that would
    // otherwise be acted on, so a plan of 90 mostly-skipped cards costs 90
    // requests rather than 180.
    let why = skipReason(card, { expectState, stateless, openPrs: [] });
    if (!why && skipPrReferenced) {
      const timeline = await readTimeline(call, base);
      if (!timeline.ok) {
        record(
          timeline.reason === 'not-exhausted'
            ? `#${issue} TIMELINE NOT EXHAUSTED — still full pages at the ${timeline.pages}-page cap (${timeline.events.length} events read).`
            : `#${issue} COULD NOT READ THE TIMELINE — ${timeline.res.call} -> HTTP ${timeline.res.status}${timeline.res.detail ? ` (${timeline.res.detail})` : ''}`,
        );
        record(
          '⛔ STOPPING. The open-PR skip is ON, so this card cannot be judged — and closing it on an unread\n' +
            '  signal is the same act as skipping it on one. A page of a timeline is not the timeline: a\n' +
            '  cross-reference on the page nobody read is indistinguishable from none. Re-run when the route\n' +
            '  is back, or declare `--no-skip-pr-referenced` if the reading is genuinely not wanted.',
        );
        return result(timeline.verdict === 'refusal' ? EXIT_PLATFORM_REFUSAL : EXIT_PREREQUISITE, { stoppedAt: issue });
      }
      why = skipReason(card, { expectState, stateless, openPrs: openPrReferences(timeline.events) });
    }

    if (why) {
      counts.skipped += 1;
      skips.push({ issue, why });
      record(`#${issue} SKIP ${why}`);
      continue;
    }

    counts.actionable += 1;

    // The comment on THIS act's clock — post-stamped's rules asked again now,
    // because a stamp rule reads the clock. A refusal here is ZERO writes.
    const pre = preflightComment(row.text, now());
    if (!pre.ok) {
      record(`#${issue} comment REFUSED before any write [${pre.kind}]:`);
      for (const l of String(pre.error).split('\n')) record(`      ${l}`);
      record(`⛔ ZERO writes on #${issue}. Stopping — ${stopNote()}`);
      return result(EXIT_USAGE, { stoppedAt: issue, landed: [] });
    }
    const body = pre.rendered.body;

    // The THREAD, read before anything is sent: is this row's closing comment
    // already on the card — an earlier act's, whose strip or close did not
    // land? ⛔ An unread thread is not an empty one: sending the comment on it
    // may post a SECOND closing comment, and not sending it may close the card
    // under none — so a thread that cannot be read STOPS the run, exactly as
    // an unread timeline does, with zero writes on this card.
    const thread = await readThread(call, base);
    if (!thread.ok) {
      record(
        thread.reason === 'not-exhausted'
          ? `#${issue} THREAD NOT EXHAUSTED — still full pages at the ${thread.pages}-page cap (${thread.events.length} comments read).`
          : `#${issue} COULD NOT READ THE THREAD — ${thread.res.call} -> HTTP ${thread.res.status}${thread.res.detail ? ` (${thread.res.detail})` : ''}`,
      );
      record(
        '⛔ STOPPING. Whether this row\'s closing comment is already on the card cannot be told from a thread\n' +
          '  nobody finished reading: sending the comment on it may post a SECOND closing comment, and leaving it\n' +
          `  out may close the card under none. ⛔ ZERO writes on #${issue}. ${stopNote()}`,
      );
      return result(thread.verdict === 'refusal' ? EXIT_PLATFORM_REFUSAL : EXIT_PREREQUISITE, { stoppedAt: issue, landed: [] });
    }
    const prior = priorClosingComment(thread.events, row.text);

    // ② label-write's own arithmetic: target = current − (pm-state + residue).
    const current = labelNamesOf(card.labels);
    const labels = computeLabelTarget({ current, remove: stripLabels(card, expectState) });
    // The steps the BOARD already shows: this row's comment an earlier act
    // left, and a strip with nothing left to take. What remains is owed.
    const already = STEPS.filter((st) => (st === 'comment' ? prior !== null : st === 'label' ? labels.removeCalls.length === 0 : false));
    const owed = residualOps({ commentOnBoard: prior !== null, removeCalls: labels.removeCalls });
    record(`#${issue} ① 取现集 ${render(current)} → ② target ${render(labels.target)} · strip ${render(labels.removeCalls)}`);
    if (prior) {
      counts.resumed += 1;
      record(
        `#${issue} RESUME — this row's closing comment is already on the board: comment ${prior.comment.id} ` +
          `(posted ${prior.comment.created_at}, stamped ${prior.rendered.stamp} by its own act)` +
          `${labels.removeCalls.length === 0 ? ', and nothing is left to strip' : ''}. ` +
          `Still owed: ${owed.join(' → ')}. ⛔ No second closing comment.`,
      );
    }
    const resumeTag = prior ? ` (RESUME — comment ${prior.comment.id} already on the board)` : '';

    if (route.transport === 'dispatch') {
      // ③ ONE card, ONE dispatch, ONE write — carrying only the steps owed.
      const packed = packCard({ repo, session: route.session, issue, body, labels, reason, commentOnBoard: prior !== null, expectState, now });
      if (!packed.ok) {
        record(relayRefusalText(packed.errors));
        record(`⛔ ZERO writes on #${issue} — the payload was refused before it was sent. Stopping — ${stopNote()}`);
        return result(EXIT_USAGE, { stoppedAt: issue, landed: [] });
      }
      const size = Buffer.byteLength(JSON.stringify(packed.payload), 'utf8');
      record(`#${issue} ③ ONE dispatch, request ${packed.payload.request_id}: ${packed.actions.map((a) => a.op).join(' → ')} (${packed.actions.length} actions · ${size} of ${CLIENT_PAYLOAD_MAX_BYTES} payload bytes)`);
      payloads.push(packed.payload);
      if (dryRun) {
        record(`#${issue} payload ${JSON.stringify(packed.payload)}`);
        record(`#${issue} → WOULD CLOSE \`${reason}\`${resumeTag} — ⛔ nothing sent`);
        continue;
      }

      const sentAt = now();
      counts.dispatched += 1;
      const sent = await send(packed.payload, { token: TOKEN, log: (line) => record(`      ${line}`) });
      const runRef = sent.run?.url ?? sent.run?.id ?? '(no run)';
      if (sent.state === 'refused') {
        record(`#${issue} the relay REFUSED the dispatch — HTTP ${sent.status}${sent.detail ? ` (${sent.detail})` : ''}. Nothing ran.`);
        record(`⛔ NOTHING was written to #${issue}. Stopping — ${stopNote()}`);
        return result(exitForResult(sent), { stoppedAt: issue, landed: [], relay: sent });
      }
      if (sent.state === 'no-run' || sent.state === 'timeout') {
        record(unconfirmedText(sent, 'close-cards'));
        record(
          `⛔ #${issue} is UNCONFIRMED. ⛔ Not retried, and ⛔ not fallen back to direct under any ${TRANSPORT_ENV}: the pack's first ` +
            `action is a comment, so replaying a dispatch that may still run is a second closing comment. Stopping — ${stopNote()}`,
        );
        return result(EXIT_UNCONFIRMED, { stoppedAt: issue, relay: sent });
      }

      // ④ 回读 — the BOARD, after a run that completed either way. On a
      // RESUME the window reaches back to the earlier act's comment, so the
      // comment leg is read off the board too rather than taken from ①.
      const dispatchedAt = Number.isFinite(sent.dispatchedAt) ? sent.dispatchedAt : sentAt;
      const back = await call(base, {});
      const backVerdict = classifyHttp({ status: back.status, op: 'card-read', rateRemaining: back.rateRemaining });
      const sinceMs = prior ? Math.min(dispatchedAt - 60_000, Date.parse(prior.comment.created_at)) : dispatchedAt - 60_000;
      const tail = backVerdict === 'ok' ? await readCommentsSince(call, base, sinceMs) : null;
      if (backVerdict !== 'ok' || !tail.ok) {
        const what =
          backVerdict !== 'ok'
            ? `${back.call} -> HTTP ${back.status}`
            : tail.reason === 'not-exhausted'
              ? `the comments since the dispatch are still full pages at the ${tail.pages}-page cap`
              : `${tail.res.call} -> HTTP ${tail.res.status}`;
        if (sent.ok) {
          record(
            `#${issue} ④ read-back — COULD NOT READ (${what}). The relay run ${runRef} completed with success, and ⛔ that is NOT a ` +
              'read-back: the three effects are NOT MEASURED. Go READ the card; ⛔ do not re-run blind.',
          );
          return result(EXIT_PREREQUISITE, { stoppedAt: issue, relay: sent });
        }
        const failedStep = STEPS.find((st) => !already.includes(st));
        record(halfWriteText({ issue, repo, landed: already, already, failedStep, detail: `relay run FAILED ${runRef}, and the card could not be read back (${what}) — which steps landed is NOT MEASURED; treat it as a half-write until read` }));
        return result(EXIT_HALF_WRITE, { stoppedAt: issue, relay: sent });
      }
      const board = landedFromBoard({ card: back.json, comments: tail.events, body, dispatchedAt, labels, reason, prior });
      record(
        `#${issue} ④ 回读 — ${back.json?.state ?? '?'}${back.json?.state_reason ? `/${back.json.state_reason}` : ''} · ${board.backLabels.length} label(s): ${render(board.backLabels)} · ` +
          `comment ${board.hit ? `${board.hit.id}${prior ? ' (on the board before this run)' : ''}` : `NOT FOUND storing the body ${prior ? 'its own act' : 'this run'} sent`}`,
      );

      if (!sent.ok) {
        // "Nothing landed" is judged on the steps THIS pack carried: a step
        // that was on the board before the run is not something it wrote.
        const landedNow = board.landed.filter((st) => !already.includes(st));
        if (landedNow.length === 0) {
          record(
            `#${issue} the relay run FAILED (${runRef}) at its first action, and the board shows NONE of the ${packed.actions.length === PACK_ORDER.length ? 'three steps' : 'steps it carried'}` +
              `${already.length ? ` — the card is as the run found it (${already.map((st) => `\`${st}\``).join(', ')} on the board before this run)` : ''}.`,
          );
          record(`⛔ NOTHING landed on #${issue}. Stopping — ${stopNote()}`);
          return result(EXIT_PLATFORM_REFUSAL, { stoppedAt: issue, landed: [], relay: sent });
        }
        record(halfWriteText({ issue, repo, landed: board.landed, already, failedStep: STEPS.find((st) => !board.landed.includes(st)), detail: `relay run FAILED ${runRef}; the steps above are what the BOARD shows` }));
        return result(EXIT_HALF_WRITE, { stoppedAt: issue, landed: board.landed, relay: sent });
      }

      if (board.labelVerdict.concurrentAdds.length) {
        record(`#${issue} ④ note — ${render(board.labelVerdict.concurrentAdds)} is on the card and was never in the target. ⛔ NOT a mismatch: another seat's additive write.`);
      }
      if (!board.matches) {
        if (board.landed.length < STEPS.length) {
          record(halfWriteText({ issue, repo, landed: board.landed, already, failedStep: STEPS.find((st) => !board.landed.includes(st)), detail: `the relay run ${runRef} reported success and the BOARD does not show it` }));
        } else {
          record(
            `⛔ READ-BACK MISMATCH on ${repo}#${issue} — labels missing ${render(board.labelVerdict.missing)} (in the ② target, gone from the card: ` +
              'STRIPPED UNDERNEATH inside the run window) · labels that survived removal ' +
              `${render(board.labelVerdict.survivedRemoval)}. The comment and the close landed. ⛔ Not re-added here: the re-add is a write, ` +
              'and under the relay a second one. Go READ the card and fix it deliberately.',
          );
        }
        return result(EXIT_HALF_WRITE, { stoppedAt: issue, landed: board.landed, relay: sent });
      }
      if (prior) {
        // The stamp verdict describes the act that WROTE the comment, which
        // was not this one — so it is not re-judged against this run's clock.
        record(`    comment ${board.hit.id} was on the board before this run, stamped ${prior.rendered.stamp} by its own act — ⛔ not re-sent.`);
      } else {
        const said = commentReadBackVerdict({
          stamp: pre.rendered.stamp,
          writtenAt: board.hit.created_at,
          sent: body,
          stored: board.hit.body,
          substituted: pre.rendered.substituted,
          quoted: pre.rendered.quoted,
          verbatim: pre.rendered.verbatim,
          verbatimTokens: pre.rendered.verbatimTokens,
        });
        for (const l of said.lines) record(`    ${l.trim()}`);
      }
      record(`#${issue} ④ MATCHES — closed \`${reason}\` · labels ${render(board.backLabels)} · comment ${board.hit.id}${prior ? ' (on the board before this run)' : ''} (via the relay run ${runRef})`);
      counts.closed += 1;
      closed.push({ issue, reason, comment: board.hit.id, resumed: prior !== null });
      record(`#${issue} → closed ${reason} ${board.hit.id}${prior ? ' (RESUME)' : ''}`);
      continue;
    }

    // ── DIRECT: the steps still owed, each by the tool that owns it ──────
    if (dryRun) {
      const steps = [...(prior ? [] : ['comment']), ...(labels.removeCalls.length ? [`strip ${render(labels.removeCalls)}`] : []), 'close'];
      record(`#${issue} → WOULD CLOSE \`${reason}\`${resumeTag} — direct: ${steps.join(' · ')} — ⛔ nothing written`);
      continue;
    }

    // ② comment — unless this row's is already on the board. ⛔ Never a second.
    let commentId = prior?.comment.id ?? null;
    if (!prior) {
      const posted = await postComment({ repo, issue, file: row.commentFile });
      if (posted.exit === POST_STAMPED_EXIT_NOT_STORED) {
        record(halfWriteText({ issue, repo, landed: ['comment'], failedStep: 'comment', detail: 'post-stamped exit 4 — WRITTEN BUT NOT STORED as sent' }));
        return result(EXIT_HALF_WRITE, { stoppedAt: issue, landed: ['comment'] });
      }
      if (posted.exit !== 0) {
        record(`#${issue} comment REFUSED — post-stamped exit ${posted.exit}${posted.detail ? ` — ${posted.detail}` : ''}`);
        record(`⛔ NOTHING was written to #${issue}: post-stamped refuses BEFORE the write on every exit but 4. Stopping — ${stopNote()}`);
        return result(posted.exit === EXIT_PREREQUISITE ? EXIT_PREREQUISITE : EXIT_PLATFORM_REFUSAL, { stoppedAt: issue, landed: [] });
      }
      commentId = posted.id;
    }

    // ③ label — the four-step write, read back by the tool that owns it;
    // unless nothing is left to strip, when there is no write to make.
    if (labels.removeCalls.length > 0) {
      const wrote = await labelWrite({ repo, issue, remove: labels.removeCalls });
      if (wrote.exit !== 0) {
        record(halfWriteText({ issue, repo, landed: ['comment'], already, failedStep: 'label', detail: `label-write exit ${wrote.exit}${wrote.detail ? ` — ${wrote.detail}` : ''}` }));
        return result(EXIT_HALF_WRITE, { stoppedAt: issue, landed: ['comment'] });
      }
    }

    // ④ close — and READ THE ANSWER BACK. A 200 whose body does not say
    // `closed` is not a close, and a close recorded under another reason is a
    // wrong record rather than a near miss.
    const patched = await call(base, { method: 'PATCH', body: { state: 'closed', state_reason: reason } });
    const patchVerdict = classifyHttp({ status: patched.status, op: 'card-patch', rateRemaining: patched.rateRemaining });
    if (patchVerdict !== 'ok' || patched.json?.state !== 'closed' || patched.json?.state_reason !== reason) {
      record(
        halfWriteText({
          issue,
          repo,
          landed: ['comment', 'label'],
          already,
          failedStep: 'close',
          detail:
            patchVerdict === 'ok'
              ? `HTTP ${patched.status} but the card reads back state \`${patched.json?.state}\` / reason \`${patched.json?.state_reason}\``
              : `${patched.call} -> HTTP ${patched.status}${patched.detail ? ` (${patched.detail})` : ''}`,
        }),
      );
      return result(EXIT_HALF_WRITE, { stoppedAt: issue, landed: ['comment', 'label'] });
    }

    counts.closed += 1;
    closed.push({ issue, reason, comment: commentId, resumed: prior !== null });
    record(`#${issue} → closed ${reason} ${commentId ?? '(no comment id returned)'}${prior ? ' (RESUME)' : ''}`);
  }

  const byReason = closed.reduce((acc, c) => ({ ...acc, [c.reason]: (acc[c.reason] ?? 0) + 1 }), {});
  record(
    `close-cards: ${dryRun ? 'DRY RUN — nothing was written. ' : ''}${counts.read} read · ` +
      `${counts.actionable} actionable${counts.resumed ? ` (${counts.resumed} RESUMED — closing comment already on the board)` : ''} · ${counts.skipped} skipped` +
      `${dryRun ? '' : ` · ${counts.closed} closed${counts.closed ? ` (${Object.entries(byReason).map(([r, n]) => `${r} ${n}`).join(', ')})` : ''}`}` +
      `${route.transport === 'dispatch' ? ` · ${dryRun ? `${payloads.length} payload(s) packed, 0 sent` : `${counts.dispatched} dispatch(es) sent — ${counts.dispatched} write(s) on the throttle`}` : ''}`,
  );
  return result(EXIT_OK);
}

// ---------------------------------------------------------------------------
// --self-test — offline, no network, every branch above driven by a STUBBED
// API rather than a model of one.
//
// The fake serves the reads and the one direct write this tool makes, with the
// semantics that matter: a `PATCH` really mutates the card it answers, and the
// fake relay EXECUTES a pack against the same board (in order, stopping where
// told), so every read-back is a read of what the write did rather than an
// echo of what it asked for. A fake that echoed would pass every assertion
// below while the read-back this tool exists for went untested.
//
// The battery ledger this self-test's floor is evaluated against: `battery()`
// opens one, every assertion is attributed to the one most recently opened, and
// a section that stops running names ITSELF at the floor rather than going
// quiet. The counts are a FLOOR, never an equality.
// ---------------------------------------------------------------------------

const SELF_TEST_BATTERIES = Object.freeze({
  'the CLI: what a typo must never be allowed to mean': 14,
  'the plan file: one card, one reason, one comment file of its own': 12,
  'the burst rule: the same comment text on many cards is structurally impossible': 6,
  'the pre-flight: a closing comment no card should receive': 7,
  'the pre-flight refusal: a comment refused before the pack is ZERO writes on its card': 7,
  'the skip matrix: every reason a card is left alone': 14,
  'the skip log: a skipped card gets no payload, and the output names why': 8,
  'the open-PR reading: a cross-reference that is a PR, and open': 7,
  'the timeline walk: one page is not the timeline': 8,
  'the happy path: three writes per card, in order': 10,
  'the half-write refusal: stop at the first card left in a state nobody asked for': 12,
  'the unreadable card: a verdict taken from nothing is not taken': 7,
  'the dry run: a plan that proves it wrote nothing': 7,
  'the sibling tools: driven, never re-implemented': 10,
  'the relay pack: ONE card, ONE dispatch — comment → labels_remove → issue_patch — ONE write on the throttle': 12,
  'the size ceiling: a payload over 64KB is refused before it is packed, zero writes': 6,
  'the read-back: step ④ reads the BOARD — comment, labels and close — and must MATCH': 9,
  'the relay miss: a refused, failed or unconfirmed run is read back, never retried, never fallen back from': 8,
});
const SELF_TEST_BATTERY_FLOOR = 18;
const UNATTRIBUTED_BATTERY = '(unattributed)';

const batteryCases = new Map();
let openBattery = null;
const battery = (name) => {
  openBattery = name;
};
let selfTestReachedVerdict = false;

/** The self-test's one clock: every stamp, request id and comment time reads it, so the assertions can spell them. */
const SELF_TEST_NOW = Date.UTC(2026, 8, 23, 12, 0, 0);
const SELF_TEST_SESSION = 'session_01ABCDEFGHJKMNPQRSTVWXYZ';

const cardJson = (card) => ({
  number: card.number,
  state: card.state ?? 'open',
  state_reason: card.state_reason ?? null,
  labels: (card.labels ?? []).map((name) => ({ name })),
  assignees: (card.assignees ?? []).map((login) => ({ login })),
});

/**
 * A board with the semantics this tool depends on — the `PATCH` mutates, so
 * the read-back reads the write; the timeline and the comments are paged for
 * real, and the comments honour `since`.
 */
export function fakeApi(initial = {}) {
  const cards = new Map();
  for (const [number, card] of Object.entries(initial.cards ?? {})) cards.set(Number(number), { comments: [], ...card, number: Number(number) });
  const calls = [];
  const hooks = new Map(Object.entries(initial.hooks ?? {}).map(([k, v]) => [k, [...v]]));

  const wrap = (status, json = null, rateRemaining = 5000) => ({
    status,
    json,
    rateRemaining,
    detail: typeof json?.message === 'string' ? json.message : '',
    call: `fake ${status}`,
  });

  const call = async (path, init = {}) => {
    const method = init.method ?? 'GET';
    const match = /\/repos\/[^/]+\/[^/]+\/issues\/(\d+)(\/timeline|\/comments)?/.exec(path);
    const number = Number(match?.[1]);
    const kind = match?.[2] === '/timeline' ? 'timeline' : match?.[2] === '/comments' ? 'comments' : method === 'PATCH' ? 'patch' : 'read';
    calls.push({ kind, number, method, path, body: init.body ?? null });

    // A `null` in a hook queue is a PASS-THROUGH: that call is served by the
    // board, so a case can aim its canned answer at the SECOND read of a kind
    // (the read-back's comments, not the thread read before the pack).
    const queued = hooks.get(`${kind}:${number}`) ?? hooks.get(kind);
    if (queued?.length) {
      const canned = queued.shift();
      if (canned !== null) return wrap(canned.status, canned.json ?? { message: 'canned' }, canned.rateRemaining ?? 5000);
    }

    const card = cards.get(number);
    if (!card) return wrap(404, { message: 'Not Found' });
    if (kind === 'timeline' || kind === 'comments') {
      // Paged for real: a fake that answered the whole list to every request
      // would pass the walk's assertions while the truncation the walk exists
      // for went untested.
      const query = new URLSearchParams(path.slice(path.indexOf('?') + 1));
      const size = Number(query.get('per_page') ?? 100);
      const page = Number(query.get('page') ?? 1);
      let all = kind === 'timeline' ? (card.timeline ?? []) : card.comments;
      if (kind === 'comments' && query.get('since')) {
        const since = Date.parse(query.get('since'));
        all = all.filter((c) => Date.parse(c.updated_at ?? c.created_at) >= since);
      }
      return wrap(200, all.slice((page - 1) * size, page * size));
    }
    if (kind === 'patch') {
      card.state = init.body?.state ?? card.state;
      card.state_reason = init.body?.state_reason ?? card.state_reason;
      return wrap(200, cardJson(card));
    }
    return wrap(200, cardJson(card));
  };

  return { cards, calls, call };
}

/** Drive the whole run offline: a fake board, a stubbed comment poster and a stubbed label write. */
const DIRECT_ROUTE = Object.freeze({ requested: 'direct', transport: 'direct', reason: 'self-test: direct', error: null, session: null });
const dispatchRoute = (requested = 'dispatch') => ({ requested, transport: 'dispatch', reason: 'self-test: dispatch', error: null, session: SELF_TEST_SESSION });

/**
 * A fake relay that EXECUTES the pack against the fake board the run reads
 * back from, the way the executor would on the real one: in order, stopping
 * at `failure@N` with the actions before N applied. The other outcomes:
 * `success`, `no-run`, `timeout`, `refused`, `lie` (success, nothing applied),
 * `mutate` (the comment stored not as sent), `strip:L` (a concurrent writer
 * strips L inside the run window), `add:L` (a concurrent writer adds L).
 */
function fakeRelay(api, outcome, sent, clock) {
  const RUN = { id: 42, url: 'https://github.test/run/42', status: 'completed', conclusion: 'success' };
  let commentId = 5000;
  const apply = (a) => {
    const card = api.cards.get(a.issue);
    if (!card) return;
    const at = new Date(clock()).toISOString();
    if (a.op === 'comment') {
      const stored = outcome === 'mutate' ? `X${a.body.slice(1)}` : `${a.body}${PLATFORM_COMMENT_FOOTER}`;
      card.comments.push({ id: ++commentId, body: stored, created_at: at, updated_at: at });
    }
    if (a.op === 'labels_remove') card.labels = card.labels.filter((l) => !a.labels.includes(l));
    if (a.op === 'issue_patch') {
      if ('state' in a) card.state = a.state;
      if ('state_reason' in a) card.state_reason = a.state_reason;
    }
  };
  return async (payload) => {
    sent.push(payload);
    const base = { requestId: payload.request_id, startMs: 1, ceilingMs: 2, status: 204, verdict: 'ok', detail: '', dispatchedAt: clock() };
    if (outcome === 'no-run') return { ...base, state: 'no-run', ok: false, run: null, detail: 'no run appeared' };
    if (outcome === 'timeout') return { ...base, state: 'timeout', ok: false, run: { ...RUN, status: 'in_progress', conclusion: null } };
    if (outcome === 'refused') return { ...base, state: 'refused', ok: false, status: 422, verdict: 'refusal', run: null, detail: 'Unprocessable Entity' };
    const failAt = /^failure@(\d+)$/.exec(outcome ?? '');
    const stop = failAt ? Number(failAt[1]) : outcome === 'lie' ? 0 : payload.actions.length;
    payload.actions.slice(0, stop).forEach(apply);
    const card = api.cards.get(payload.actions[0]?.issue);
    if (card && outcome?.startsWith('strip:')) card.labels = card.labels.filter((l) => l !== outcome.slice('strip:'.length));
    if (card && outcome?.startsWith('add:')) card.labels = [...card.labels, outcome.slice('add:'.length)];
    if (failAt) return { ...base, state: 'failure', ok: false, run: { ...RUN, conclusion: 'failure' }, detail: 'conclusion failure' };
    return { ...base, state: 'success', ok: true, run: RUN, detail: 'conclusion success' };
  };
}

/** The comment a self-test row carries unless the case names its own — distinct words per card, stamped. */
const ROW_TEXT = (issue) => `Closed #${issue} ${STAMP_TOKEN} — ruling for this card.`;
const ROW = (issue, extra = {}) => ({ issue, reason: 'not_planned', commentFile: `/tmp/plan/${issue}.md`, text: ROW_TEXT(issue), ...extra });

async function driveOffline(options, initial = {}, stubs = {}) {
  const api = fakeApi(initial);
  const posted = [];
  const labelled = [];
  const out = [];
  const sent = [];
  const clock = stubs.now ?? (() => SELF_TEST_NOW);
  const commentExits = [...(stubs.commentExits ?? [])];
  const labelExits = [...(stubs.labelExits ?? [])];
  const { numbers = [], reason = 'not_planned', rows = null, ...rest } = options;
  const res = await runCloseCards(
    {
      repo: 'objectstack-ai/objectstack',
      rows: rows ?? numbers.map((issue) => ROW(issue, { reason })),
      expectState: 'pm:queue',
      skipPrReferenced: true,
      dryRun: false,
      ...rest,
    },
    {
      call: api.call,
      log: (line) => out.push(line),
      now: clock,
      route: stubs.route ?? DIRECT_ROUTE,
      send: stubs.relay ? fakeRelay(api, stubs.relay, sent, clock) : undefined,
      postComment: async ({ issue, file }) => {
        const exit = commentExits.length ? commentExits.shift() : 0;
        posted.push({ issue, file, exit });
        return { exit, id: 900 + issue, url: null, stored: exit === 0, detail: exit === 0 ? '' : 'stubbed refusal' };
      },
      labelWrite: async ({ issue, remove }) => {
        const exit = labelExits.length ? labelExits.shift() : 0;
        labelled.push({ issue, remove, exit });
        return { exit, detail: exit === 0 ? '' : 'stubbed label refusal' };
      },
    },
  );
  return { res, api, posted, labelled, out, sent, text: out.join('\n') };
}

/** An in-memory file tree for `preparePlan`: a missing path throws the way `readFileSync` does. */
const memoryFiles = (tree) => (path) => {
  if (Object.hasOwn(tree, path)) return tree[path];
  throw new Error(`ENOENT: no such file, open '${path}'`);
};

const QUEUED = (number, extra = {}) => ({ [number]: { state: 'open', labels: ['pm:queue', 'tooling'], assignees: [], timeline: [], comments: [], ...extra } });
const CROSS_REF = (prNumber, state) => ({ event: 'cross-referenced', source: { type: 'issue', issue: { number: prNumber, state, pull_request: { url: 'x' } } } });

export async function selfTest() {
  const cases = [];
  const t = (name, actual, expected = true, detail) => {
    const key = openBattery ?? UNATTRIBUTED_BATTERY;
    batteryCases.set(key, (batteryCases.get(key) ?? 0) + 1);
    const ok = JSON.stringify(actual) === JSON.stringify(expected);
    cases.push({ name, ok, detail: ok ? '' : `${detail ? `${detail} — ` : ''}got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}` });
  };
  const REPO = ['--repo', 'objectstack-ai/objectstack'];
  const MIN = [...REPO, '--plan', 'plan.txt'];

  // ── the CLI ───────────────────────────────────────────────────────────────
  battery('the CLI: what a typo must never be allowed to mean');
  t('the minimal invocation parses', parseCliOptions(MIN).ok);
  t('…and defaults the expected state to `pm:queue`', parseCliOptions(MIN).options?.expectState, 'pm:queue');
  t('…and the open-PR skip is ON by default', parseCliOptions(MIN).options?.skipPrReferenced, true);
  t('…and a dry run is OFF by default', parseCliOptions(MIN).options?.dryRun, false);
  t('`--no-skip-pr-referenced` turns the skip off', parseCliOptions([...MIN, '--no-skip-pr-referenced']).options?.skipPrReferenced, false);
  t('`--skip-pr-referenced` turns it back on', parseCliOptions([...MIN, '--no-skip-pr-referenced', '--skip-pr-referenced']).options?.skipPrReferenced, true);
  t('the `--flag=value` spelling is the same option', parseCliOptions([...REPO, '--plan=p.txt']).options?.plan, 'p.txt');
  t('⛔ a missing --plan is refused, never defaulted', parseCliOptions(REPO).ok, false);
  for (const flag of RETIRED_FLAGS) {
    const r = parseCliOptions([...MIN, flag, 'x']);
    t(`⛔ the retired \`${flag}\` is refused BY NAME, pointing at --plan — never read as a batch-wide value`, !r.ok && (r.error ?? '').includes(flag) && (r.error ?? '').includes('--plan'));
  }
  t('…and the refusal says why: never the same comment text on many cards', /same comment text/.test(parseCliOptions([...MIN, '--comment', 'c.md']).error ?? ''));
  t('⛔ an --expect-state that is not a pm state is refused, never silently matched against nothing', parseCliOptions([...MIN, '--expect-state', 'pm:queued']).ok, false);
  t('…and the refusal names the states there are', /pm:dispatched/.test(parseCliOptions([...MIN, '--expect-state', 'pm:queued']).error ?? ''));
  t('⛔ an unrecognised option is refused rather than ignored', parseCliOptions([...MIN, '--force']).ok, false);
  t('…and a run is NOT stateless unless it says so', parseCliOptions(MIN).options?.stateless, false);
  t('`--stateless` parses, and CLEARS the default expected state rather than leaving `pm:queue` beside it', [parseCliOptions([...MIN, '--stateless']).options?.stateless, parseCliOptions([...MIN, '--stateless']).options?.expectState], [true, null]);
  t('⛔ `--stateless` beside `--expect-state` is refused — two modes, one run', parseCliOptions([...MIN, '--stateless', '--expect-state', 'pm:queue']).ok, false);
  t('…in either order, naming both flags', ((r) => [r.ok, /--stateless/.test(r.error ?? '') && /--expect-state/.test(r.error ?? '')])(parseCliOptions([...MIN, '--expect-state=pm:queue', '--stateless'])), [false, true]);
  t('⛔ `--stateless=false` is refused, never read as ON', parseCliOptions([...MIN, '--stateless=false']).ok, false);
  t('⛔ there is no `none` state: `--expect-state none` is refused and points at `--stateless`', ((r) => [r.ok, /--stateless/.test(r.error ?? '')])(parseCliOptions([...MIN, '--expect-state', 'none'])), [false, true]);
  {
    // The whole door, not the parser alone: `main` answers the mode clash with
    // the usage exit before any plan is read or any request is made.
    const errors = [];
    const saved = console.error;
    console.error = (...a) => errors.push(a.join(' '));
    let code;
    try {
      code = await main([...REPO, '--plan', '/nonexistent/plan.txt', '--stateless', '--expect-state', 'pm:queue']);
    } finally {
      console.error = saved;
    }
    t('`main` answers `--stateless` + `--expect-state` with the USAGE exit (2), before reading the plan', [code, errors.some((e) => /two modes/.test(e)), errors.some((e) => /could not read --plan/.test(e))], [EXIT_USAGE, true, false]);
  }

  // ── the plan file ─────────────────────────────────────────────────────────
  battery('the plan file: one card, one reason, one comment file of its own');
  const P = (raw) => parsePlan(raw, { baseDir: '/plans' });
  t('one row per line, `#N` or `N`, a relative comment file resolved against the plan`s directory', P('19440|not_planned|a.md\n#19408|completed|b.md\n').rows?.map((r) => [r.issue, r.reason, r.commentFile]), [[19440, 'not_planned', '/plans/a.md'], [19408, 'completed', '/plans/b.md']]);
  t('blank lines and padding around fields are fine, and the row keeps its line number', P('\n  19440 | duplicate | a.md  \n\n').rows?.[0], { line: 2, issue: 19440, reason: 'duplicate', commentFile: '/plans/a.md' });
  t('an absolute comment path is kept as written', P('1|completed|/abs/c.md').rows?.[0].commentFile, '/abs/c.md');
  t('⛔ a `#` line is a ROW, never a comment — a lone card number is refused, not skipped', P('#19440').ok, false);
  t('…and the refusal names the line and the row shape', /line 1 .*N\|REASON\|COMMENT-FILE/.test(P('#19440').error ?? ''));
  t('⛔ a reason GitHub does not take is refused by name', [P('1|wontfix|a.md').ok, /`wontfix`/.test(P('1|wontfix|a.md').error ?? '')], [false, true]);
  t('⛔ a row naming no comment file is refused', P('1|completed|').ok, false);
  t('⛔ a token that is not a card number is refused', P('abc|completed|a.md').ok, false);
  t('⛔ card 0 is not a card', P('0|completed|a.md').ok, false);
  t('⛔ an empty plan is refused, never read as "nothing to do"', P('  \n\n').ok, false);
  t('⛔ a card named twice is REFUSED, never collapsed — two rows are two decisions', [P('7|completed|a.md\n7|not_planned|b.md').ok, /#7 on lines 1, 2/.test(P('7|completed|a.md\n7|not_planned|b.md').error ?? '')], [false, true]);
  t('⛔ one comment file handed to two cards is refused — the batch-wide comment, spelled twice', [P('1|completed|a.md\n2|completed|./a.md').ok, /#1, #2/.test(P('1|completed|a.md\n2|completed|./a.md').error ?? '')], [false, true]);
  t('every bad line is named, not only the first', (P('x|completed|a.md\n1|wontfix|b.md').error ?? '').match(/line \d/g)?.length, 2);

  // ── the burst rule ────────────────────────────────────────────────────────
  battery('the burst rule: the same comment text on many cards is structurally impossible');
  const JNOW = Date.UTC(2026, 8, 23, 12, 0, 0);
  const stamped = (s) => `${s} ${STAMP_TOKEN}`;
  const rowsOf = (...texts) => texts.map((text, i) => ({ issue: 100 + i, commentFile: `/p/${i}.md`, text }));
  t('distinct comments pass', judgePlanComments(rowsOf(stamped('Closed: superseded by the new plan.'), stamped('Closed: the ruling declined this.')), JNOW).ok);
  t('⛔ the same text on two cards is refused, naming both', judgePlanComments(rowsOf(stamped('Closed per ruling.'), stamped('Closed per ruling.')), JNOW).repeated, [[100, 101]]);
  t('⛔ …even when only whitespace differs', judgePlanComments(rowsOf(stamped('Closed  per\nruling.'), stamped('Closed per ruling. ')), JNOW).ok, false);
  t('⛔ …and when only a NUMBER differs — a card number is not what makes a comment a different comment', judgePlanComments(rowsOf(stamped('Closing #19440 per ruling.'), stamped('Closing #19441 per ruling.')), JNOW).ok, false);
  t('the refusal names the cards, the rule, and that every card has zero writes', ((txt) => /#100, #101/.test(txt) && /never the same comment text/.test(txt) && /zero writes/.test(txt))(planCommentRefusalText(judgePlanComments(rowsOf(stamped('x'), stamped('x')), JNOW))));
  const twinFiles = memoryFiles({ '/p/plan.txt': '1|completed|a.md\n2|completed|b.md\n', '/p/a.md': stamped('Same words.'), '/p/b.md': stamped('Same words.') });
  t('end to end: a plan whose two files carry one text is refused before any request is made', preparePlan('/p/plan.txt', { readFile: twinFiles, nowMs: JNOW }).ok, false);

  // ── the pre-flight ────────────────────────────────────────────────────────
  battery('the pre-flight: a closing comment no card should receive');
  const NOW = Date.UTC(2026, 8, 21, 2, 0, 0);
  t('a body carrying the token passes', preflightComment(`Closed ${STAMP_TOKEN} under the ruling.`, NOW).ok);
  t('…and the rendered body carries the clock, not the token', /2026-09-21T02:00Z/.test(preflightComment(`Closed ${STAMP_TOKEN}.`, NOW).rendered?.body ?? ''));
  t('⛔ a body with NO token is refused — ninety cards would record no closing time', preflightComment('Closed under the ruling.', NOW).ok, false);
  t('…and it is refused by THIS rule, not post-stamped\'s', preflightComment('Closed under the ruling.', NOW).kind, 'unstamped-batch');
  t('⛔ an empty body is refused', preflightComment('   ', NOW).ok, false);
  t('⛔ an opener post-stamped cannot render is refused HERE, once, not ninety times', preflightComment(`Closed {{WHEN}} ${STAMP_TOKEN}`, NOW).ok, false);
  t('…which proves the pre-flight routes through post-stamped rather than re-deriving it', preflightComment(`Closed {{WHEN}} ${STAMP_TOKEN}`, NOW).kind, 'unknown-token');

  // ── the pre-flight refusal ────────────────────────────────────────────────
  battery('the pre-flight refusal: a comment refused before the pack is ZERO writes on its card');
  {
    const tree = memoryFiles({ '/p/plan.txt': '1|completed|a.md\n2|completed|b.md\n', '/p/a.md': `Card one ruling ${STAMP_TOKEN}.`, '/p/b.md': 'Card two ruling, and no stamp anywhere.' });
    const prep = preparePlan('/p/plan.txt', { readFile: tree, nowMs: NOW });
    t('a plan whose second comment carries no stamp is refused before card one is read', prep.ok, false);
    t('…naming the card and the rule that refused it', /#2/.test(prep.error ?? '') && /unstamped-batch/.test(prep.error ?? ''));
    t('…and saying every card in the plan has zero writes', /zero writes/.test(prep.error ?? ''));
    t('a comment file that cannot be read refuses the plan too, naming the card', ((r) => [r.ok, /#2: could not read/.test(r.error ?? '')])(preparePlan('/p/plan.txt', { readFile: memoryFiles({ '/p/plan.txt': '1|completed|a.md\n2|completed|b.md\n', '/p/a.md': `x ${STAMP_TOKEN}` }), nowMs: NOW })), [false, true]);
    const relayed = await driveOffline({ rows: [ROW(301, { text: 'No stamp at all.' })] }, { cards: QUEUED(301) }, { route: dispatchRoute(), relay: 'success' });
    t('under the relay the same refusal sends NO dispatch and reads no card — exit 2', [relayed.res.exit, relayed.sent.length, relayed.api.calls.length], [EXIT_USAGE, 0, 0]);
    t('…and the card is untouched: open, its labels, no comment', [relayed.api.cards.get(301).state, relayed.api.cards.get(301).labels, relayed.api.cards.get(301).comments.length], ['open', ['pm:queue', 'tooling'], 0]);
    const direct = await driveOffline({ rows: [ROW(302, { text: 'No stamp at all.' })] }, { cards: QUEUED(302) });
    t('on the direct transport it is ZERO writes as well: no comment, no label write, no PATCH', [direct.res.exit, direct.posted.length, direct.labelled.length, direct.api.calls.some((c) => c.kind === 'patch')], [EXIT_USAGE, 0, 0, false]);
  }

  // ── the skip matrix ───────────────────────────────────────────────────────
  battery('the skip matrix: every reason a card is left alone');
  const EXPECT = { expectState: 'pm:queue' };
  t('a queued, unassigned, un-cross-referenced card is ACTIONABLE', skipReason(cardJson({ number: 1, labels: ['pm:queue'] }), EXPECT), null);
  t('⛔ a closed card is skipped', /not open/.test(skipReason(cardJson({ number: 1, state: 'closed', labels: ['pm:queue'] }), EXPECT) ?? ''));
  t('…and the reason names the state it is in', /closed/.test(skipReason(cardJson({ number: 1, state: 'closed', state_reason: 'completed', labels: ['pm:queue'] }), EXPECT) ?? ''));
  t('⛔ an assigned card is skipped', /assignee/.test(skipReason(cardJson({ number: 1, labels: ['pm:queue'], assignees: ['os-project-manager'] }), EXPECT) ?? ''));
  t('…and the reason names who', /os-project-manager/.test(skipReason(cardJson({ number: 1, labels: ['pm:queue'], assignees: ['os-project-manager'] }), EXPECT) ?? ''));
  t('⛔ `pm:retriage` is skipped even on a perfectly queued card', /pm:retriage/.test(skipReason(cardJson({ number: 1, labels: ['pm:queue', 'pm:retriage'] }), EXPECT) ?? ''));
  t('⛔ a card with no pm-state at all is skipped', /no pm-state/.test(skipReason(cardJson({ number: 1, labels: ['tooling'] }), EXPECT) ?? ''));
  t('⛔ a card in another pm-state is skipped', /pm:dispatched/.test(skipReason(cardJson({ number: 1, labels: ['pm:dispatched'] }), EXPECT) ?? ''));
  t('…and the reason quotes what that state CLAIMS, from the imported vocabulary', /live claim/.test(skipReason(cardJson({ number: 1, labels: ['pm:dispatched'] }), EXPECT) ?? ''));
  t('⛔ a card carrying TWO pm-states is skipped — "exactly" is not "contains"', /2 pm-state labels/.test(skipReason(cardJson({ number: 1, labels: ['pm:queue', 'pm:blocked'] }), EXPECT) ?? ''));
  t('⛔ an open PR referencing it is skipped', /open PR/.test(skipReason(cardJson({ number: 1, labels: ['pm:queue'] }), { ...EXPECT, openPrs: [123] }) ?? ''));
  t('…and the reason names the PR', /#123/.test(skipReason(cardJson({ number: 1, labels: ['pm:queue'] }), { ...EXPECT, openPrs: [123] }) ?? ''));
  t('the FIRST reason wins — a closed, assigned card reads as closed', /not open/.test(skipReason(cardJson({ number: 1, state: 'closed', labels: ['pm:queue'], assignees: ['x'] }), EXPECT) ?? ''));
  t('a different --expect-state moves the whole matrix with it', skipReason(cardJson({ number: 1, labels: ['pm:on-hold'] }), { expectState: 'pm:on-hold' }), null);
  t('…and the no-state skip of an ordinary run names the mode that closes such a card', /--stateless/.test(skipReason(cardJson({ number: 1, labels: ['tooling'] }), EXPECT) ?? ''));
  const STATELESS_RUN = { expectState: null, stateless: true };
  t('under `--stateless` a card carrying NO pm-state is ACTIONABLE', skipReason(cardJson({ number: 1, labels: ['tracking', 'domain:spec'] }), STATELESS_RUN), null);
  t('⛔ under `--stateless` a card carrying a pm-state is skipped, naming it', /the pm-state `pm:queue`.*--stateless/.test(skipReason(cardJson({ number: 1, labels: ['pm:queue'] }), STATELESS_RUN) ?? ''));
  t('⛔ …and one carrying TWO is skipped too, naming both', /2 pm-state labels `pm:queue`, `pm:blocked`/.test(skipReason(cardJson({ number: 1, labels: ['pm:queue', 'pm:blocked'] }), STATELESS_RUN) ?? ''));
  t('⛔ …and `needs-user-decision` IS a state: a card owed a ruling is never closed stateless', /needs-user-decision/.test(skipReason(cardJson({ number: 1, labels: ['needs-user-decision'] }), STATELESS_RUN) ?? ''));
  t('⛔ under `--stateless` an assignee still skips', /assignee/.test(skipReason(cardJson({ number: 1, labels: ['tracking'], assignees: ['os-zhuang'] }), STATELESS_RUN) ?? ''));
  t('⛔ …and so do `pm:retriage`, a closed card and an open PR', [
    /pm:retriage/.test(skipReason(cardJson({ number: 1, labels: ['pm:retriage'] }), STATELESS_RUN) ?? ''),
    /not open/.test(skipReason(cardJson({ number: 1, state: 'closed', labels: [] }), STATELESS_RUN) ?? ''),
    /open PR/.test(skipReason(cardJson({ number: 1, labels: [] }), { ...STATELESS_RUN, openPrs: [5] }) ?? ''),
  ], [true, true, true]);

  // ── the skip log ──────────────────────────────────────────────────────────
  battery('the skip log: a skipped card gets no payload, and the output names why');
  {
    const matrix = await driveOffline(
      { numbers: [501, 502, 503, 504, 505] },
      {
        cards: {
          ...QUEUED(501, { assignees: ['os-zhuang'] }),
          ...QUEUED(502, { labels: ['pm:queue', 'pm:retriage'] }),
          ...QUEUED(503, { labels: ['pm:dispatched'] }),
          ...QUEUED(504, { timeline: [CROSS_REF(9001, 'open')] }),
          ...QUEUED(505),
        },
      },
      { route: dispatchRoute(), relay: 'success' },
    );
    t('four skips and one close, exit 0', [matrix.res.exit, matrix.res.counts.skipped, matrix.res.counts.closed], [EXIT_OK, 4, 1]);
    t('ONE payload was sent, for the one actionable card', matrix.sent.map((p) => p.actions[0].issue), [505]);
    t('the assigned card is skipped naming who owns it', /#501 SKIP has an assignee \(`os-zhuang`\)/.test(matrix.text));
    t('the summoned card is skipped naming `pm:retriage`', /#502 SKIP carries `pm:retriage`/.test(matrix.text));
    t('the card in another state is skipped naming that state and the one this run acts on', /#503 SKIP pm-state is `pm:dispatched`.*not `pm:queue`/.test(matrix.text));
    t('the card an open PR references is skipped naming the PR', /#504 SKIP an open PR references it \(#9001\)/.test(matrix.text));
    t('⛔ the four skipped cards are untouched on the board', [501, 502, 503, 504].map((n) => [matrix.api.cards.get(n).state, matrix.api.cards.get(n).comments.length]), [['open', 0], ['open', 0], ['open', 0], ['open', 0]]);
    t('the skips reach a caller that reads the result, with their reasons', matrix.res.skips.map((s) => [s.issue, typeof s.why]), [[501, 'string'], [502, 'string'], [503, 'string'], [504, 'string']]);
  }

  // ── the open-PR reading ───────────────────────────────────────────────────
  battery('the open-PR reading: a cross-reference that is a PR, and open');
  t('an open PR cross-reference is a hit', openPrReferences([CROSS_REF(4242, 'open')]), [4242]);
  t('⛔ a CLOSED PR cross-reference is not', openPrReferences([CROSS_REF(4242, 'closed')]), []);
  t('⛔ a cross-reference from an ISSUE is not a PR reference', openPrReferences([{ event: 'cross-referenced', source: { issue: { number: 7, state: 'open' } } }]), []);
  t('⛔ another event type is ignored', openPrReferences([{ event: 'labeled', label: { name: 'pm:queue' } }]), []);
  t('⛔ a malformed event does not throw', openPrReferences([{ event: 'cross-referenced' }, null]), []);
  t('⛔ a non-array timeline reads as no references, never as a crash', openPrReferences(null), []);
  t('several open PRs are all reported', openPrReferences([CROSS_REF(1, 'open'), CROSS_REF(2, 'closed'), CROSS_REF(3, 'open')]), [1, 3]);

  // ── the timeline walk ─────────────────────────────────────────────────────
  battery('the timeline walk: one page is not the timeline');
  const BASE = '/repos/objectstack-ai/objectstack/issues/1';
  const noise = (n) => Array.from({ length: n }, () => ({ event: 'labeled', label: { name: 'tooling' } }));
  const oneShort = fakeApi({ cards: { 1: { state: 'open', timeline: noise(3) } } });
  const short = await readTimeline(oneShort.call, BASE, { pageSize: 100 });
  t('a short first page ends the walk in one request', [short.ok, short.pages], [true, 1]);
  t('…and returns every event on it', short.events.length, 3);
  const twoPages = fakeApi({ cards: { 1: { state: 'open', timeline: [...noise(100), CROSS_REF(777, 'open')] } } });
  const walked = await readTimeline(twoPages.call, BASE, { pageSize: 100 });
  t('a FULL page is followed by the next one', [walked.ok, walked.pages], [true, 2]);
  t('…and a cross-reference on page 2 is SEEN — the measured truncation this walk closes', openPrReferences(walked.events), [777]);
  const dead = fakeApi({ cards: { 1: { state: 'open', timeline: noise(300) } }, hooks: { timeline: [{ status: 200, json: noise(100) }, { status: 502, json: { message: 'Bad gateway' } }] } });
  const broke = await readTimeline(dead.call, BASE, { pageSize: 100 });
  t('⛔ a transport failure mid-walk is a refusal, never a short page', [broke.ok, broke.reason], [false, 'transport']);
  const huge = fakeApi({ cards: { 1: { state: 'open', timeline: noise(50) } } });
  const capped = await readTimeline(huge.call, BASE, { pageSize: 1, cap: 4 });
  t('⛔ a timeline still full at the cap is NOT EXHAUSTED, not "nothing found"', [capped.ok, capped.reason], [false, 'not-exhausted']);
  t('…and it reports how far it got, so the refusal can say so', [capped.pages, capped.events.length], [4, 4]);
  const buried = await driveOffline({ numbers: [91] }, { cards: { 91: { state: 'open', labels: ['pm:queue'], assignees: [], timeline: [...noise(100), CROSS_REF(778, 'open')] } } });
  t('a card whose only open-PR reference sits on page 2 is SKIPPED, not closed', buried.res.counts.skipped, 1);

  // ── the happy path ────────────────────────────────────────────────────────
  battery('the happy path: three writes per card, in order');
  const happy = await driveOffline({ numbers: [11, 12] }, { cards: { ...QUEUED(11), ...QUEUED(12) } });
  t('every card landed all three writes', happy.res.exit, EXIT_OK);
  t('…both cards closed', happy.res.counts.closed, 2);
  t('…and the board really says so, because the fake PATCH mutates', [happy.api.cards.get(11).state, happy.api.cards.get(12).state], ['closed', 'closed']);
  t('…with the reason the run was given', happy.api.cards.get(11).state_reason, 'not_planned');
  t('the comment is posted before the label write', happy.posted.length === 2 && happy.labelled.length === 2);
  t('…and the label write removes the EXPECTED state, never a guessed one', happy.labelled[0].remove, ['pm:queue']);
  t('…and each card`s comment comes from ITS OWN file', happy.posted.map((p) => p.file), ['/tmp/plan/11.md', '/tmp/plan/12.md']);
  t('the log carries one line per card, naming the comment id', /#11 → closed not_planned 911/.test(happy.text));
  t('…and a summary that counts what happened', /2 read · 2 actionable · 0 skipped · 2 closed/.test(happy.text));
  t('each card is RE-READ live before it is acted on', happy.api.calls.filter((c) => c.kind === 'read').length >= 2);
  t('an all-skips run is still a clean exit', (await driveOffline({ numbers: [11] }, { cards: QUEUED(11, { assignees: ['someone'] }) })).res.exit, EXIT_OK);

  // ── the half-write refusal ────────────────────────────────────────────────
  battery('the half-write refusal: stop at the first card left in a state nobody asked for');
  const labelRefused = await driveOffline({ numbers: [21, 22] }, { cards: { ...QUEUED(21), ...QUEUED(22) } }, { labelExits: [4] });
  t('a comment that lands whose label write fails is a HALF-WRITE', labelRefused.res.exit, EXIT_HALF_WRITE);
  t('…it names the card', /#21/.test(labelRefused.text));
  t('…it names which step landed', /LANDED: `comment`/.test(labelRefused.text));
  t('…and which are outstanding', /OUTSTANDING: `label`, `close`/.test(labelRefused.text));
  t('⛔ the run STOPS — the second card is never touched', labelRefused.posted.length, 1);
  t('⛔ and the second card is still open', labelRefused.api.cards.get(22).state, 'open');
  const closeRefused = await driveOffline({ numbers: [31] }, { cards: QUEUED(31), hooks: { patch: [{ status: 403, json: { message: 'Resource not accessible' } }] } });
  t('a close that the platform refuses is a HALF-WRITE with two steps landed', closeRefused.res.exit, EXIT_HALF_WRITE);
  t('…naming both', /LANDED: `comment`, `label`/.test(closeRefused.text));
  const closeLied = await driveOffline({ numbers: [32] }, { cards: QUEUED(32), hooks: { patch: [{ status: 200, json: { state: 'open', state_reason: null } }] } });
  t('⛔ a 200 whose body does not say `closed` is NOT a close', closeLied.res.exit, EXIT_HALF_WRITE);
  const wrongReason = await driveOffline({ numbers: [33] }, { cards: QUEUED(33), hooks: { patch: [{ status: 200, json: { state: 'closed', state_reason: 'completed' } }] } });
  t('⛔ a close recorded under another reason is a wrong record, not a near miss', wrongReason.res.exit, EXIT_HALF_WRITE);
  const commentRefused = await driveOffline({ numbers: [41, 42] }, { cards: { ...QUEUED(41), ...QUEUED(42) } }, { commentExits: [2] });
  t('a comment REFUSED before the write is not a half-write — nothing landed', commentRefused.res.exit, EXIT_PLATFORM_REFUSAL);
  t('…and no label write was attempted on that card', commentRefused.labelled.length, 0);

  // ── the unreadable card ───────────────────────────────────────────────────
  battery('the unreadable card: a verdict taken from nothing is not taken');
  const unread = await driveOffline({ numbers: [51, 52] }, { cards: { ...QUEUED(51), ...QUEUED(52) }, hooks: { 'read:51': [{ status: 401, json: { message: 'Bad credentials' } }] } });
  t('a 401 on the card read is PREREQUISITE NOT MET', unread.res.exit, EXIT_PREREQUISITE);
  t('…and the run stops rather than guessing', unread.res.counts.closed, 0);
  t('…saying how many cards were never reached', /not reached/.test(unread.text));
  const gone = await driveOffline({ numbers: [61] }, { cards: {}, hooks: {} });
  t('a 404 on the card read is a platform refusal, not a skip', gone.res.exit, EXIT_PLATFORM_REFUSAL);
  const tlDead = await driveOffline({ numbers: [71] }, { cards: QUEUED(71), hooks: { timeline: [{ status: 502, json: { message: 'Bad gateway' } }] } });
  t('⛔ a timeline that cannot be read STOPS the run — it is not read as "no open PR"', tlDead.res.exit !== EXIT_OK);
  t('…and the card is left open and untouched', tlDead.api.cards.get(71).state, 'open');
  const tlOff = await driveOffline({ numbers: [71], skipPrReferenced: false }, { cards: QUEUED(71), hooks: { timeline: [{ status: 502, json: { message: 'Bad gateway' } }] } });
  t('…while `--no-skip-pr-referenced` never buys the timeline at all', tlOff.api.calls.some((c) => c.kind === 'timeline'), false);

  // ── the dry run ───────────────────────────────────────────────────────────
  battery('the dry run: a plan that proves it wrote nothing');
  const dry = await driveOffline({ numbers: [81, 82, 83], dryRun: true }, { cards: { ...QUEUED(81), ...QUEUED(82, { assignees: ['x'] }), ...QUEUED(83, { timeline: [CROSS_REF(99, 'open')] }) } });
  t('a dry run exits clean', dry.res.exit, EXIT_OK);
  t('…counting the actionable cards', dry.res.counts.actionable, 1);
  t('…and the skipped ones', dry.res.counts.skipped, 2);
  t('⛔ it posts no comment', dry.posted.length, 0);
  t('⛔ it writes no label', dry.labelled.length, 0);
  t('⛔ and it PATCHes nothing', dry.api.calls.some((c) => c.kind === 'patch'), false);
  t('…while still READING every card live, which is what makes the count worth anything', dry.res.counts.read, 3);

  // ── the sibling tools ─────────────────────────────────────────────────────
  battery('the sibling tools: driven, never re-implemented');
  t('a child spawned with no proxy configured takes no node flag', childNodeFlags({ env: {} }), []);
  t('…and with one it takes the routing flag, because a child`s execArgv is empty', childNodeFlags({ env: { HTTPS_PROXY: 'http://127.0.0.1:40309' } }), [PROXY_FLAG]);
  t('⛔ a node that does not accept the flag gets none rather than a crash', childNodeFlags({ env: { HTTPS_PROXY: 'http://x' }, flagSupported: false }), []);
  t('⛔ this process`s own re-exec guard does not suppress a CHILD`s routing', childNodeFlags({ env: { HTTPS_PROXY: 'http://x', [PROXY_REARM_GUARD]: '1' } }), [PROXY_FLAG]);
  t('post-stamped`s --json document is read for the comment id', parsePostStampedJson('{"id":5754224796,"url":"u"}')?.id, 5754224796);
  t('⛔ output that carries no document reads as none, never as a crash', parsePostStampedJson('post-stamped: something went wrong'), null);
  const lw = parseLabelWriteOptions(['--repo', 'objectstack-ai/objectstack', '--issue', '19325', '--remove', 'pm:queue']);
  t('the label step builds options label-write`s own parser accepts', lw.ok && lw.options.remove, ['pm:queue']);
  t('…for the card the step is on', lw.options?.issue, 19325);
  const ownSource = readFileSync(SELF_PATH, 'utf8');
  t('structural: the label write is handed THIS run\'s route, so one decision serves the direct writes', ownSource.includes('runLabelWrite(parsed.options, { log: (line) => record(`      ${line}`), route, send: deps.send })'));
  t('structural: the direct comment child is handed THIS run\'s transport, never left to pick its own', ownSource.includes("env: { ...process.env, [TRANSPORT_ENV]: 'direct' }"));
  t('the pack`s comment is post-stamped`s own relay action, and its strip is label-write`s own relayActions', ((packed) => [packed.actions[0], packed.actions[1]])(packCard({ repo: 'objectstack-ai/objectstack', session: SELF_TEST_SESSION, issue: 9, body: 'b', labels: computeLabelTarget({ current: ['pm:queue'], remove: ['pm:queue'] }), reason: 'completed' })), [relayAction({ mode: 'comment', number: 9 }, 'b'), ...relayActions({ issue: 9, labels: computeLabelTarget({ current: ['pm:queue'], remove: ['pm:queue'] }) })]);

  // ── the relay pack ────────────────────────────────────────────────────────
  battery('the relay pack: ONE card, ONE dispatch — comment → labels_remove → issue_patch — ONE write on the throttle');
  const ok = await driveOffline({ numbers: [61] }, { cards: QUEUED(61) }, { route: dispatchRoute(), relay: 'success' });
  {
    t('under dispatch a card closes through ONE dispatch, exit 0', [ok.res.exit, ok.res.counts.closed, ok.sent.length, ok.res.counts.dispatched], [EXIT_OK, 1, 1, 1]);
    t('…carrying EXACTLY three actions, in the order comment → labels_remove → issue_patch', ok.sent[0].actions.map((a) => a.op), [...PACK_ORDER]);
    t('…the comment is the card`s own text, stamped on the act`s clock', ok.sent[0].actions[0], { op: 'comment', issue: 61, body: 'Closed #61 2026-09-23T12:00Z — ruling for this card.' });
    t('…the strip is the pm-state, the close carries the row`s reason', [ok.sent[0].actions[1], ok.sent[0].actions[2]], [{ op: 'labels_remove', issue: 61, labels: ['pm:queue'] }, { op: 'issue_patch', issue: 61, state: 'closed', state_reason: 'not_planned' }]);
    t('…the envelope carries the session and the target', [ok.sent[0].session, ok.sent[0].repo], [SELF_TEST_SESSION, 'objectstack-ai/objectstack']);
    t('⛔ no write verb left this process — the reads (card, timeline, thread), then the read-back reads', ok.api.calls.map((c) => c.kind), ['read', 'timeline', 'comments', 'read', 'comments']);
    t('the summary counts one dispatch — one throttle write — per closed card', /1 closed \(not_planned 1\) · 1 dispatch\(es\) sent — 1 write\(s\) on the throttle/.test(ok.text));
    const two = await driveOffline({ rows: [ROW(62), ROW(63, { reason: 'completed' })] }, { cards: { ...QUEUED(62), ...QUEUED(63) } }, { route: dispatchRoute(), relay: 'success' });
    t('⛔ never two cards in one dispatch: two cards are two payloads, one card each', two.sent.map((p) => [...new Set(p.actions.map((a) => a.issue))]), [[62], [63]]);
    t('…each closed under ITS OWN row`s reason', [two.api.cards.get(62).state_reason, two.api.cards.get(63).state_reason], ['not_planned', 'completed']);
    const residue = await driveOffline({ numbers: [64] }, { cards: QUEUED(64, { labels: ['pm:queue', 'pm:blocking', 'pm:epic', 'tooling'] }) }, { route: dispatchRoute(), relay: 'success' });
    t('the strip takes the pm-state AND its residue (`pm:blocking`), never an identity sticker (`pm:epic`)', [residue.sent[0].actions[1].labels, residue.api.cards.get(64).labels, residue.res.exit], [['pm:queue', 'pm:blocking'], ['pm:epic', 'tooling'], EXIT_OK]);
    const dryRelay = await driveOffline({ numbers: [65, 66], dryRun: true }, { cards: { ...QUEUED(65), ...QUEUED(66, { assignees: ['x'] }) } }, { route: dispatchRoute(), relay: 'success' });
    t('a DRY RUN packs ONE payload per actionable card, exactly three actions, and SENDS none', [dryRelay.res.exit, dryRelay.sent.length, dryRelay.res.payloads.length, dryRelay.res.payloads[0]?.actions.map((a) => a.op)], [EXIT_OK, 0, 1, [...PACK_ORDER]]);
    t('…printing that payload as the JSON that would be sent', dryRelay.text.includes(`#65 payload ${JSON.stringify(dryRelay.res.payloads[0])}`));
    t('…and the board is untouched', [dryRelay.api.cards.get(65).state, dryRelay.api.cards.get(65).labels, dryRelay.api.cards.get(65).comments.length], ['open', ['pm:queue', 'tooling'], 0]);
    t('the transport is printed on every run, direct included', ok.text.includes('transport dispatch') && (await driveOffline({ numbers: [61] }, { cards: QUEUED(61) })).text.includes('transport direct'));
    const badRoute = await driveOffline({ numbers: [66] }, { cards: QUEUED(66) }, { route: { requested: 'dispatch', transport: 'dispatch', reason: '', error: 'OS_FLEET_SESSION is absent', session: null } });
    t('a route with an error is exit 3 before the first card is read', [badRoute.res.exit, badRoute.api.calls.length], [EXIT_PREREQUISITE, 0]);
    t('packCard refuses a label plan that ADDS — a close never adds a label, so the pack is not three actions', packCard({ repo: 'objectstack-ai/objectstack', session: SELF_TEST_SESSION, issue: 1, body: 'b', labels: computeLabelTarget({ current: ['pm:queue'], add: ['x'], remove: ['pm:queue'] }), reason: 'completed' }).ok, false);
  }

  // ── the size ceiling ──────────────────────────────────────────────────────
  battery('the size ceiling: a payload over 64KB is refused before it is packed, zero writes');
  {
    // Under the relay's 60,000-byte body cap, and over the platform's 64KB
    // `client_payload` ceiling once JSON escapes every double quote to two
    // bytes. (Not a run of blank lines: `CLAIM_COMMENT_MARKER`'s two `\s*`
    // backtrack cubically across newlines, so post-stamped's keyed-line check
    // would take minutes on the fixture before the size rule ever ran.)
    const HUGE = `Closing ruling ${STAMP_TOKEN}\n${'"'.repeat(40_000)}\nend.`;
    const rendered = renderBody(HUGE, SELF_TEST_NOW);
    t('the fixture is under the relay body cap and over the payload ceiling once serialised', [Buffer.byteLength(rendered.body, 'utf8') <= 60_000, Buffer.byteLength(JSON.stringify(rendered.body), 'utf8') > CLIENT_PAYLOAD_MAX_BYTES], [true, true]);
    const big = await driveOffline({ rows: [ROW(401), ROW(402, { text: HUGE })] }, { cards: { ...QUEUED(401), ...QUEUED(402) } }, { route: dispatchRoute(), relay: 'success' });
    t('a plan with one over-64KB row is refused BEFORE card one: exit 2, no dispatch, not one read', [big.res.exit, big.sent.length, big.api.calls.length], [EXIT_USAGE, 0, 0]);
    t('…the refusal names the row and the platform ceiling', /#402/.test(big.text) && new RegExp(String(CLIENT_PAYLOAD_MAX_BYTES)).test(big.text));
    t('…and every card is untouched — the small one too', [big.api.cards.get(401).state, big.api.cards.get(401).comments.length, big.api.cards.get(402).state], ['open', 0, 'open']);
    const labels = computeLabelTarget({ current: ['pm:queue'], remove: ['pm:queue'] });
    t('packCard itself refuses it through the relay`s validator, packing nothing', ((r) => [r.ok, r.payload])(packCard({ repo: 'objectstack-ai/objectstack', session: SELF_TEST_SESSION, issue: 402, body: rendered.body, labels, reason: 'completed' })), [false, null]);
    t('…and a body over the relay`s body cap is refused the same way', packCard({ repo: 'objectstack-ai/objectstack', session: SELF_TEST_SESSION, issue: 402, body: 'x'.repeat(60_001), labels, reason: 'completed' }).ok, false);
  }

  // ── the read-back ─────────────────────────────────────────────────────────
  battery('the read-back: step ④ reads the BOARD — comment, labels and close — and must MATCH');
  {
    t('④ reads the card back AND the comments since the dispatch', [ok.api.calls.filter((c) => c.kind === 'comments' && /since=/.test(c.path)).length, /since=2026-09-23T11%3A59%3A00/.test(ok.api.calls.find((c) => c.kind === 'comments' && /since=/.test(c.path))?.path ?? '')], [1, true]);
    t('④ MATCHES is printed only once all three effects read back from the board', /#61 ④ MATCHES — closed `not_planned`/.test(ok.text));
    t('…the comment is FOUND on the board through the platform`s footer, and its id is what the run reports', ok.res.closed[0]?.comment, 5001);
    t('…with post-stamped`s own stamp verdict: drift 0, one clock', /drift 0/.test(ok.text));
    const lied = await driveOffline({ numbers: [71] }, { cards: QUEUED(71) }, { route: dispatchRoute(), relay: 'lie' });
    t('⛔ a run that SAYS success while the board shows nothing is a HALF-WRITE alarm, never a close', [lied.res.exit, lied.res.counts.closed], [EXIT_HALF_WRITE, 0]);
    const mutated = await driveOffline({ numbers: [72] }, { cards: QUEUED(72) }, { route: dispatchRoute(), relay: 'mutate' });
    t('⛔ a comment the platform did not store as sent is NOT landed — exit 4, naming what did land', [mutated.res.exit, /LANDED: `label`, `close` · OUTSTANDING: `comment`/.test(mutated.text)], [EXIT_HALF_WRITE, true]);
    const stripped = await driveOffline({ numbers: [73, 74] }, { cards: { ...QUEUED(73), ...QUEUED(74) } }, { route: dispatchRoute(), relay: 'strip:tooling' });
    t('⛔ a label stripped underneath inside the run window is a READ-BACK MISMATCH (exit 4), the next card never read', [stripped.res.exit, /READ-BACK MISMATCH/.test(stripped.text), /labels missing `tooling`/.test(stripped.text), stripped.res.counts.read], [EXIT_HALF_WRITE, true, true, 1]);
    t('…and ⛔ it is NOT re-added: no write of any kind left for it — the one dispatch was the only one', [stripped.sent.length, stripped.api.calls.some((c) => c.method !== 'GET')], [1, false]);
    const added = await driveOffline({ numbers: [75] }, { cards: QUEUED(75) }, { route: dispatchRoute(), relay: 'add:hotfix' });
    t('another seat`s additive label is a NOTE, never a mismatch — the card still closes', [added.res.exit, /④ note — `hotfix`/.test(added.text)], [EXIT_OK, true]);
    // The first comments read is the THREAD (served), the second the read-back (refused).
    const unread = await driveOffline({ numbers: [76] }, { cards: QUEUED(76), hooks: { 'comments:76': [null, { status: 502, json: { message: 'Bad gateway' } }] } }, { route: dispatchRoute(), relay: 'success' });
    t('⛔ a read-back that cannot be read after a successful run is NOT MEASURED (exit 3), never counted as a close', [unread.res.exit, unread.res.counts.closed, unread.sent.length, /④ read-back — COULD NOT READ/.test(unread.text)], [EXIT_PREREQUISITE, 0, 1, true]);
  }

  // ── the relay miss ────────────────────────────────────────────────────────
  battery('the relay miss: a refused, failed or unconfirmed run is read back, never retried, never fallen back from');
  {
    const refused = await driveOffline({ numbers: [81, 82] }, { cards: { ...QUEUED(81), ...QUEUED(82) } }, { route: dispatchRoute(), relay: 'refused' });
    t('a dispatch the platform refuses is NOTHING written: exit 5, the next card never read', [refused.res.exit, refused.res.counts.read, refused.api.cards.get(81).state, refused.api.cards.get(81).comments.length], [EXIT_PLATFORM_REFUSAL, 1, 'open', 0]);
    const fail0 = await driveOffline({ numbers: [83] }, { cards: QUEUED(83) }, { route: dispatchRoute(), relay: 'failure@0' });
    t('a run that FAILED at its first action (the comment) is read back: nothing landed, exit 5', [fail0.res.exit, /NOTHING landed/.test(fail0.text)], [EXIT_PLATFORM_REFUSAL, true]);
    const fail1 = await driveOffline({ numbers: [84] }, { cards: QUEUED(84) }, { route: dispatchRoute(), relay: 'failure@1' });
    t('a run that failed at the strip is a HALF-WRITE, the comment named as landed FROM THE BOARD', [fail1.res.exit, /LANDED: `comment` · OUTSTANDING: `label`, `close`/.test(fail1.text)], [EXIT_HALF_WRITE, true]);
    const fail2 = await driveOffline({ numbers: [85] }, { cards: QUEUED(85) }, { route: dispatchRoute(), relay: 'failure@2' });
    t('…and at the close, naming the comment and the strip', [fail2.res.exit, /LANDED: `comment`, `label` · OUTSTANDING: `close`/.test(fail2.text)], [EXIT_HALF_WRITE, true]);
    const timedOut = await driveOffline({ numbers: [86, 87] }, { cards: { ...QUEUED(86), ...QUEUED(87) } }, { route: dispatchRoute(), relay: 'timeout' });
    t('a run that did not complete is UNCONFIRMED: exit 6 naming the run, the next card never read', [timedOut.res.exit, timedOut.text.includes('UNCONFIRMED') && timedOut.text.includes('https://github.test/run/42'), timedOut.res.counts.read], [EXIT_UNCONFIRMED, true, 1]);
    const noRunAuto = await driveOffline({ numbers: [88] }, { cards: QUEUED(88) }, { route: dispatchRoute('auto'), relay: 'no-run' });
    t('⛔ under AUTO a run that never appeared is UNCONFIRMED too — no direct fall-back: no comment, no label, no PATCH', [noRunAuto.res.exit, noRunAuto.posted.length, noRunAuto.labelled.length, noRunAuto.api.calls.some((c) => c.kind === 'patch')], [EXIT_UNCONFIRMED, 0, 0, false]);
    t('…and it says why it will not fall back', /not fallen back to direct/.test(noRunAuto.text));
    t('⛔ nothing is ever re-sent: one card, one dispatch, whatever the outcome', [refused, fail0, fail1, fail2, timedOut, noRunAuto].map((r) => r.sent.length), [1, 1, 1, 1, 1, 1]);
  }

  // The floor runs BEFORE the verdict, so a success line can only be printed by
  // a run in which every declared battery registered its cases.
  const floorProblems = [];
  const declared = Object.keys(SELF_TEST_BATTERIES);
  if (declared.length < SELF_TEST_BATTERY_FLOOR) {
    floorProblems.push(`SELF_TEST_BATTERIES declares ${declared.length} batteries, below the pinned ${SELF_TEST_BATTERY_FLOOR} — a battery deleted from the roster takes its own floor with it.`);
  }
  for (const [name, count] of batteryCases) {
    if (declared.includes(name)) continue;
    floorProblems.push(`self-test battery "${name}" registered ${count} case(s) but is not declared in SELF_TEST_BATTERIES — an assertion attributed to no declared battery is one nothing floors.`);
  }
  for (const name of declared) {
    const count = batteryCases.get(name) ?? 0;
    if (count >= SELF_TEST_BATTERIES[name]) continue;
    floorProblems.push(
      count === 0
        ? `self-test battery "${name}" DID NOT RUN — 0 cases registered, ${SELF_TEST_BATTERIES[name]} pinned. The verdict below would have claimed those cases hold.`
        : `self-test battery "${name}" registered ${count} case(s), below its pinned floor of ${SELF_TEST_BATTERIES[name]} — cases that used to run no longer do.`,
    );
  }

  const failed = cases.filter((c) => !c.ok);
  for (const c of failed) console.error(`  x ${c.name}${c.detail ? ` (${c.detail})` : ''}`);
  for (const text of floorProblems) console.error(`  x ${text}`);
  if (failed.length > 0 || floorProblems.length > 0) {
    console.error(`FAIL close-cards self-test: ${failed.length} of ${cases.length} case(s) failed, ${floorProblems.length} floor problem(s).`);
    selfTestReachedVerdict = true;
    return 1;
  }
  console.log(`OK close-cards self-test: ${cases.length} cases pass across ${declared.length} batteries — offline, no network, no token.`);
  selfTestReachedVerdict = true;
  return 0;
}

// ---------------------------------------------------------------------------
// Dispatch
// ---------------------------------------------------------------------------

/**
 * Route node's `fetch` through the session proxy before the first request. It
 * has to be a re-exec: the flag is read at process START, and a bypassed route
 * answers 401 authenticated, which reads exactly like a credential problem and
 * is not one.
 *
 * ⛔ Unlike post-stamped's, this re-exec is NOT skipped on `--dry-run`: a dry
 * run here RE-READS every card, so it makes real requests and needs the real
 * route. A dry run that silently bypassed the proxy would report "could not
 * read" for a board that was reachable all along.
 */
function rearmThroughProxy(args) {
  const plan = proxyRearmPlan({
    env: process.env,
    execArgv: process.execArgv,
    flagSupported: process.allowedNodeEnvironmentFlags.has(PROXY_FLAG),
    guard: PROXY_REARM_GUARD,
  });
  if (plan.hint) {
    console.error(`close-cards: ${plan.reason}. A refusal below may be about the route, not this container.`);
    return null;
  }
  if (!plan.rearm) return null;
  console.error(`close-cards: re-exec with ${plan.flag}: ${plan.reason}.`);
  const quiet = process.allowedNodeEnvironmentFlags.has('--disable-warning') ? ['--disable-warning=UNDICI-EHPA'] : [];
  const child = spawnSync(process.execPath, [plan.flag, ...quiet, SELF_PATH, ...args], {
    stdio: 'inherit',
    env: { ...process.env, [PROXY_REARM_GUARD]: '1' },
  });
  if (typeof child.status === 'number') return child.status;
  console.error(`close-cards: could not re-exec with ${plan.flag} (${child.error?.message ?? 'no exit status'}); continuing in-process — every request will bypass the proxy.`);
  return null;
}

/**
 * The plan, read and judged before any request: the rows (`parsePlan`), each
 * row's comment file read ONCE (the text judged is the text packed), and the
 * comments judged together (`judgePlanComments`). `readFile` is injected so the
 * self-test drives every refusal offline. Returns `{ ok, rows }` or
 * `{ ok: false, error }` — and a refusal here means ZERO writes on every card.
 */
export function preparePlan(planPath, { readFile = (p) => readFileSync(p, 'utf8'), nowMs = Date.now() } = {}) {
  let raw;
  try {
    raw = readFile(planPath);
  } catch (err) {
    return { ok: false, error: `close-cards: could not read --plan ${planPath} (${err.message}).` };
  }
  const parsed = parsePlan(raw, { baseDir: dirname(resolve(planPath)) });
  if (!parsed.ok) return { ok: false, error: `close-cards: ${parsed.error}` };
  const rows = [];
  const unread = [];
  for (const row of parsed.rows) {
    try {
      rows.push({ ...row, text: readFile(row.commentFile) });
    } catch (err) {
      unread.push(`#${row.issue}: could not read ${row.commentFile} (${err.message})`);
    }
  }
  if (unread.length > 0) {
    return { ok: false, error: `close-cards: ${unread.length} comment file(s) could not be read:\n${unread.map((u) => `  - ${u}`).join('\n')}\nclose-cards: ⛔ NOTHING was read and NOTHING was written.` };
  }
  const judged = judgePlanComments(rows, nowMs);
  if (!judged.ok) return { ok: false, error: planCommentRefusalText(judged), judged };
  return { ok: true, rows };
}

export async function main(argv) {
  if (argv.includes('--help') || argv.includes('-h')) {
    console.log(USAGE);
    return EXIT_OK;
  }
  if (argv.includes('--self-test')) return selfTest();

  const parsed = parseCliOptions(argv);
  if (!parsed.ok) {
    console.error(`close-cards: ${parsed.error}\n`);
    console.error(USAGE);
    return EXIT_USAGE;
  }
  const options = parsed.options;

  // ⛔ Judged ONCE, before card one: a plan row or a comment post-stamped would
  // refuse must not be discovered on card 40, with 39 closing comments already
  // on the board.
  const plan = preparePlan(options.plan);
  if (!plan.ok) {
    console.error(plan.error);
    return EXIT_USAGE;
  }

  // A dry run reads the board too, so the token is required on both paths.
  if (!TOKEN) {
    console.error(
      'close-cards: PREREQUISITE NOT MET — no GITHUB_TOKEN / GH_TOKEN in the environment.\n' +
        '  ⛔ NOT MEASURED: nothing was read and nothing was written.',
    );
    return EXIT_PREREQUISITE;
  }

  const relayed = rearmThroughProxy(argv);
  if (relayed !== null) return relayed;

  const result = await runCloseCards(
    {
      repo: options.repo,
      rows: plan.rows,
      expectState: options.expectState,
      stateless: options.stateless,
      skipPrReferenced: options.skipPrReferenced,
      dryRun: options.dryRun,
    },
    {},
  );
  return result.exit;
}

if (isEntrypoint(import.meta.url)) {
  const code = await main(process.argv.slice(2));
  if (process.argv.includes('--self-test') && !selfTestReachedVerdict) {
    console.error(
      '\nFAIL close-cards self-test: selfTest() returned without reaching its verdict, so no success line\n' +
        'was printed. Exiting 0 here would report a self-test that never finished as one that passed.\n',
    );
    process.exit(1);
  }
  process.exit(code);
}
