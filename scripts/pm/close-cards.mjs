#!/usr/bin/env node
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * close-cards — the three-step card closure (comment · label · close), as ONE
 * NAMED command (#19469).
 *
 * ## Usage — from the REPO ROOT, as one command, with no `cd … &&` in front
 *
 *   node scripts/pm/close-cards.mjs --repo owner/name --list cards.txt --comment closing.md --reason not_planned --dry-run
 *   node scripts/pm/close-cards.mjs --repo owner/name --list cards.txt --comment closing.md --reason not_planned
 *   node scripts/pm/close-cards.mjs --self-test          # offline, no network at all
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
 *   - the comment goes through `scripts/pm/post-stamped.mjs`. Its write path is
 *     not exported (`writeArtefact` and `main` are module-private), so it is
 *     driven as a CHILD PROCESS with its documented flags — `--repo=`,
 *     `--comment=N`, `--file=`, `--json` — and its exit code is read BEFORE any
 *     pipe. Its pure half (`renderBody`, `claimKeyedLineRefusals`) IS exported,
 *     and the pre-flight below imports it so a body that tool would refuse is
 *     refused ONCE, here, rather than 90 times, one card at a time.
 *   - the label write goes through `runLabelWrite` from
 *     `scripts/pm/label-write.mjs`, in-process, with its own `parseOptions`
 *     building the options — so the four steps, the additive-verb order, the
 *     `PATCH` fallback and the read-back are the same program the CLI runs.
 *   - the pm-state vocabulary (`PM_EXCLUSIVE_STATE_LABELS`, `PM_STATE_CLAIM`)
 *     is imported from `check-half-states.mjs`. ⛔ Never restate a label set.
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
 * ## The three writes, in order, and the one state that must never be left
 *
 * Per actionable card, in this order:
 *
 *   ① comment  — post-stamped, read-back its own;
 *   ② label    — label-write `--remove <the expected state>`, four steps, read-back;
 *   ③ close    — `PATCH /repos/{o}/{r}/issues/{n}` with `state: closed` and the
 *                `state_reason`, then READ THE RESPONSE BACK: a 200 whose body
 *                does not say `closed` is not a close.
 *
 * A card whose ① landed and whose ② or ③ did not is a HALF-WRITE: a closing
 * comment under a card that is still open and still claims `pm:queue`. The run
 * STOPS at the first one — ⛔ it does not continue to the next card, and ⛔ it
 * does not retry — and exits 4 naming the card and exactly which steps landed.
 * Continuing would turn one half-state into a page of them.
 *
 * ## The transport — `OS_FLEET_TRANSPORT` direct | dispatch | auto
 *
 * A cloud seat container cannot write as the fleet directly, so each of the
 * three writes takes the fleet-write relay there: the comment through
 * `post-stamped.mjs` (the child resolves its own transport from the same
 * environment), the label write through `runLabelWrite` (handed THIS run's
 * route, so one decision serves both), and the close as ONE dispatch carrying
 * `issue_patch` — then the card is READ BACK, which is the same check the
 * direct `PATCH` answer gets. `auto` (the default) takes `dispatch` in a cloud
 * seat container and `direct` elsewhere, and says which. A relay outcome that
 * is not success on the close is a HALF-WRITE (the comment and the label
 * landed): the run stops there, exit 4, naming the run.
 *
 * ## Exit codes — capture them BEFORE any pipe
 *
 *   0  every non-skipped card landed all three writes (a run of all-skips too).
 *   2  usage. Nothing was read and nothing was written.
 *   3  PREREQUISITE NOT MET — no token, no route, or a read that failed. ⛔ NOT
 *      MEASURED for every card after the one that could not be read.
 *   4  HALF-WRITE — a card is on the board in a state nobody asked for. The
 *      message names the card and the steps that landed. Go look at that card.
 *   5  the platform REFUSED a write outright and nothing landed for that card.
 *
 *   `node scripts/pm/close-cards.mjs … > /tmp/cc.log 2>&1; EXIT=$?; tail -40 /tmp/cc.log`
 */

import process from 'node:process';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { isEntrypoint } from '../invoked-as.mjs';
import {
  EXIT_PREREQUISITE_NOT_MET,
  PM_EXCLUSIVE_STATE_LABELS,
  PM_STATE_CLAIM,
  PROXY_FLAG,
  proxyRearmPlan,
  proxyRoute,
  resolveSweepRepo,
} from './check-half-states.mjs';
import { fallbackText, packRequest, resolveRoute, sendFleetWrite, unconfirmedText } from './fleet-write/dispatch.mjs';
import { refusalText as relayRefusalText } from './fleet-write/validate.mjs';
import { classifyHttp, parseOptions as parseLabelWriteOptions, runLabelWrite } from './label-write.mjs';
import { isWriteMethod, noteResponse, paceWrite, releaseWriteLease } from './write-pace.mjs';
import {
  EXIT_NOT_STORED as POST_STAMPED_EXIT_NOT_STORED,
  STAMP_TOKEN,
  claimKeyedLineRefusals,
  keyedLineRefusalText,
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

/** The `state_reason` values GitHub accepts on a close. ⛔ Never a free string: a typo closes 90 cards as the wrong kind. */
export const CLOSE_REASONS = Object.freeze(['not_planned', 'completed', 'duplicate']);

/** The annotation that says a summons is outstanding — a card carrying it is never swept. */
export const RETRIAGE_LABEL = 'pm:retriage';

/** The three writes, in the order they are spent. Named once so the log, the refusal and the self-test read one list. */
export const STEPS = Object.freeze(['comment', 'label', 'close']);

const DEFAULT_EXPECT_STATE = 'pm:queue';

/**
 * How many 100-event timeline pages one card may take before the walk refuses.
 * ⛔ Not a paging convenience: it is the point at which "I have not finished
 * reading" must stop being reported as "I read it all and found nothing".
 */
export const TIMELINE_PAGE_CAP = 30;

const render = (values) => (values.length ? values.map((v) => `\`${v}\``).join(', ') : 'none');

// ---------------------------------------------------------------------------
// The list file — pure, because a misread list is the whole act pointed at the
// wrong cards.
// ---------------------------------------------------------------------------

/**
 * Card numbers out of a list file: one per line, space-separated, or both, with
 * or without the `#`.
 *
 * ⛔ A `#` cannot introduce a comment here — `#19440` IS the ordinary spelling
 * of a card, and a parser that dropped those lines would silently close nothing
 * and report a clean run. So every token must BE a card number: anything else
 * is refused by name rather than skipped.
 *
 * Duplicates are collapsed (a card cannot be closed twice) and REPORTED, since
 * a list carrying one is a list somebody built by hand from two sources.
 */
export function parseCardList(raw) {
  const tokens = String(raw ?? '')
    .split(/\s+/)
    .filter((t) => t.length > 0);
  if (tokens.length === 0) return { ok: false, error: 'the --list file names no cards at all. ⛔ An empty list is refused, never read as "nothing to do".' };
  const bad = tokens.filter((t) => !/^#?\d+$/.test(t));
  if (bad.length > 0) {
    return {
      ok: false,
      error:
        `the --list file carries ${bad.length} token(s) that are not card numbers: ${render(bad.slice(0, 5))}` +
        `${bad.length > 5 ? ` (and ${bad.length - 5} more)` : ''}. A list is card numbers only — one per line or ` +
        'space-separated, `#19440` or `19440`. ⛔ Nothing here is treated as a comment: `#` opens a card number.',
    };
  }
  const numbers = [];
  const duplicates = [];
  for (const token of tokens) {
    const n = Number(token.replace(/^#/, ''));
    if (!Number.isInteger(n) || n <= 0) return { ok: false, error: `\`${token}\` is not a card number.` };
    if (numbers.includes(n)) duplicates.push(n);
    else numbers.push(n);
  }
  return { ok: true, numbers, duplicates };
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
    list: null,
    comment: null,
    reason: null,
    expectState: DEFAULT_EXPECT_STATE,
    skipPrReferenced: true,
    dryRun: false,
  };
  const args = argv ?? [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const eq = arg.indexOf('=');
    const flag = eq === -1 ? arg : arg.slice(0, eq);
    const inline = eq === -1 ? null : arg.slice(eq + 1);
    const value = () => (inline === null ? args[++i] : inline);

    if (flag === '--repo') opts.repo = value();
    else if (flag === '--list') opts.list = value();
    else if (flag === '--comment') opts.comment = value();
    else if (flag === '--reason') opts.reason = value();
    else if (flag === '--expect-state') opts.expectState = value();
    else if (flag === '--skip-pr-referenced') opts.skipPrReferenced = true;
    else if (flag === '--no-skip-pr-referenced') opts.skipPrReferenced = false;
    else if (flag === '--dry-run') opts.dryRun = true;
    else return { ok: false, error: `unrecognised option \`${flag}\`` };
  }

  if (!opts.list) return { ok: false, error: '--list FILE is required — the card numbers to sweep, one per line or space-separated' };
  if (!opts.comment) return { ok: false, error: '--comment FILE is required — the closing comment posted onto every card this run closes' };
  if (!opts.reason) return { ok: false, error: `--reason is required — one of ${render(CLOSE_REASONS)}` };
  if (!CLOSE_REASONS.includes(opts.reason)) {
    return { ok: false, error: `\`${opts.reason}\` is not a close reason. GitHub takes ${render(CLOSE_REASONS)}, and nothing else.` };
  }
  if (typeof opts.expectState !== 'string' || opts.expectState.length === 0) {
    return { ok: false, error: '--expect-state takes the pm-state label a card must carry, e.g. `pm:queue`' };
  }
  if (!PM_EXCLUSIVE_STATE_LABELS.includes(opts.expectState)) {
    return {
      ok: false,
      error:
        `\`${opts.expectState}\` is not a pm-state label. The states are ${render(PM_EXCLUSIVE_STATE_LABELS)}. ` +
        'A typo here matches no card, skips every one of them, and prints a confident run that closed nothing.',
    };
  }

  if (!opts.repo) opts.repo = resolveSweepRepo(process.env).repo;
  if (!/^[\w.-]+\/[\w.-]+$/.test(String(opts.repo))) {
    return { ok: false, error: `--repo must be owner/name, got \`${opts.repo}\`. ⛔ Refusing to fall back to another board.` };
  }

  return { ok: true, options: opts };
}

const USAGE = [
  'close-cards — the three-step card closure (comment · label · close) as ONE named command.',
  '',
  '  node scripts/pm/close-cards.mjs --repo OWNER/NAME --list FILE --comment FILE --reason REASON',
  '                                  [--expect-state pm:queue] [--no-skip-pr-referenced] [--dry-run]',
  '  node scripts/pm/close-cards.mjs --self-test',
  '',
  '  ⛔ Invoke it from the REPO ROOT with nothing in front of `node` — no `cd … &&` compound. A session',
  '  allow rule is a PREFIX match against the command as typed, so a leading `cd` matches no rule and',
  '  drops the whole act onto the write classifier, which is the defect this script was written for.',
  '',
  `  --list FILE      card numbers, one per line or space-separated, \`#19440\` or \`19440\`.`,
  '  --comment FILE   the closing comment, posted through post-stamped onto every card this run closes.',
  `                   It must carry \`${STAMP_TOKEN}\` — the clock each posting act reads.`,
  `  --reason R       ${CLOSE_REASONS.join(' | ')}.`,
  '  --expect-state L the pm-state label a card must carry, EXACTLY and alone (default `pm:queue`).',
  '  --no-skip-pr-referenced  act on a card an open PR references (the skip is ON by default).',
  '  --dry-run        re-read every card and print the plan. Writes NOTHING, on any card.',
  '',
  '  Per card, re-read live first, then SKIP + log on: not open · has an assignee · carries',
  `  \`${RETRIAGE_LABEL}\` · pm-state is not exactly the expected label · an open PR references it.`,
  '  Otherwise: post the comment, remove the state label (four-step, read back), close with the reason.',
  '',
  `  Exits: ${EXIT_OK} every non-skipped card landed all three writes · ${EXIT_USAGE} usage ·`,
  `         ${EXIT_PREREQUISITE} PREREQUISITE NOT MET, nothing measured · ${EXIT_HALF_WRITE} HALF-WRITE, a card is in a state`,
  `         nobody asked for — it is NAMED · ${EXIT_PLATFORM_REFUSAL} the platform refused a write. Capture the code BEFORE any pipe.`,
].join('\n');

// ---------------------------------------------------------------------------
// Pre-flight — the closing comment is judged ONCE, here, by the tool that will
// post it, rather than ninety times one card at a time.
// ---------------------------------------------------------------------------

/**
 * Would post-stamped accept this body, and does it carry a stamp of the posting
 * act's own? Pure: it drives post-stamped's exported `renderBody` and its
 * keyed-line refusals, so this gate and that tool cannot come to disagree.
 *
 * The one requirement this adds on top: `substituted >= 1`. post-stamped
 * accepts a body that spells no token at all (`no-token`), which is right for a
 * one-off artefact and wrong for a batch closure — an unstamped closing comment
 * repeated across ninety cards records none of their closing times.
 */
export function preflightComment(text, nowMs = Date.now()) {
  const rendered = renderBody(text, nowMs);
  if (!rendered.ok) return { ok: false, error: rendered.error, kind: rendered.kind };
  if (rendered.substituted < 1) {
    return {
      ok: false,
      kind: 'unstamped-batch',
      error:
        `close-cards: REFUSED — the --comment file spells no \`${STAMP_TOKEN}\` outside a quotation, so every card ` +
        'in this run would receive a closing comment carrying no closing time. A batch closure is exactly the act ' +
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
  const events = [];
  for (let page = 1; page <= cap; page++) {
    const res = await call(`${base}/timeline?per_page=${pageSize}&page=${page}`, {});
    const verdict = classifyHttp({ status: res.status, op: 'card-read', rateRemaining: res.rateRemaining });
    if (verdict !== 'ok') return { ok: false, reason: 'transport', verdict, res, pages: page };
    const rows = Array.isArray(res.json) ? res.json : [];
    events.push(...rows);
    if (rows.length < pageSize) return { ok: true, events, pages: page };
  }
  return { ok: false, reason: 'not-exhausted', verdict: 'prerequisite', events, pages: cap };
}

/**
 * Why this card is left alone, or `null` when it is actionable. The order is
 * the order the order was written in, and the FIRST reason is the one reported:
 * a closed card with an assignee is reported as closed, which is what a reader
 * needs to know.
 */
export function skipReason(card, { expectState, openPrs = [] } = {}) {
  if (card?.state !== 'open') return `not open (state ${card?.state ?? 'unknown'}${card?.state_reason ? `/${card.state_reason}` : ''})`;
  const assignees = loginsOf(card?.assignees).concat(card?.assignee?.login ? [card.assignee.login] : []);
  if (assignees.length > 0) return `has an assignee (${render([...new Set(assignees)])}) — somebody owns it`;
  const labels = labelNamesOf(card?.labels);
  if (labels.includes(RETRIAGE_LABEL)) return `carries \`${RETRIAGE_LABEL}\` — a summons is outstanding`;
  const states = labels.filter((l) => PM_EXCLUSIVE_STATE_LABELS.includes(l));
  if (states.length === 0) return `carries no pm-state label, and this run acts only on \`${expectState}\``;
  if (states.length > 1) return `carries ${states.length} pm-state labels (${render(states)}) — two claims, and this run acts only on exactly \`${expectState}\``;
  if (states[0] !== expectState) {
    return `pm-state is \`${states[0]}\` (${PM_STATE_CLAIM[states[0]] ?? 'a state this run does not act on'}), not \`${expectState}\``;
  }
  if (openPrs.length > 0) return `an open PR references it (${openPrs.map((n) => `#${n}`).join(', ')})`;
  return null;
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

/** The half-write refusal: the card, and exactly which of the three writes landed. */
export function halfWriteText({ issue, repo, landed = [], failedStep, detail = '' }) {
  const outstanding = STEPS.filter((s) => !landed.includes(s));
  return (
    `⛔ HALF-WRITE on ${repo}#${issue} — the \`${failedStep}\` step did not land${detail ? ` (${detail})` : ''}.\n` +
    `  LANDED: ${landed.length ? landed.map((s) => `\`${s}\``).join(', ') : 'nothing'} · ` +
    `OUTSTANDING: ${outstanding.map((s) => `\`${s}\``).join(', ')}.\n` +
    '  This card is now in a state nobody asked for: go READ it and finish or undo the steps above by hand.\n' +
    '  ⛔ The run STOPS here and does not touch the remaining cards — continuing would turn one half-state\n' +
    '  into a page of them, and ⛔ re-running blind would post the closing comment a second time.'
  );
}

/**
 * Sweep the list. `deps` is how `--self-test` drives every branch — including
 * the ones a live board cannot be made to produce on demand (a comment that
 * lands whose label write is then refused).
 *
 * @param {{repo:string, numbers:number[], commentFile:string, reason:string, expectState:string, skipPrReferenced:boolean, dryRun:boolean}} options
 * @param {{call?:Function, postComment?:Function, labelWrite?:Function, log?:Function}} [deps]
 */
export async function runCloseCards(options, deps = {}) {
  const call = deps.call ?? rest;
  const emit = deps.log ?? ((line) => console.log(line));
  const lines = [];
  const record = (line) => {
    lines.push(line);
    emit(line);
  };

  const { repo, numbers, commentFile, reason, expectState, skipPrReferenced, dryRun } = options;
  const route = deps.route ?? resolveRoute(process.env);
  const send = deps.send ?? sendFleetWrite;

  const postComment =
    deps.postComment ??
    (async ({ issue }) => {
      const flags = childNodeFlags({ env: process.env, flagSupported: process.allowedNodeEnvironmentFlags.has(PROXY_FLAG) });
      const argv = [...flags, POST_STAMPED_PATH, `--repo=${repo}`, `--comment=${issue}`, `--file=${commentFile}`, '--json'];
      const child = spawnSync(process.execPath, argv, { encoding: 'utf8', env: process.env });
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
      const parsed = parseLabelWriteOptions(['--repo', repo, '--issue', String(issue), '--remove', remove]);
      if (!parsed.ok) return { exit: EXIT_USAGE, detail: parsed.error };
      const res = await runLabelWrite(parsed.options, { log: (line) => record(`      ${line}`), route, send: deps.send });
      return { exit: res.exit, detail: '' };
    });

  const counts = { read: 0, skipped: 0, actionable: 0, closed: 0 };
  const skips = [];
  const closed = [];
  const result = (exit, extra = {}) => ({ exit, repo, lines, counts, skips, closed, ...extra });

  record(
    `close-cards: ${dryRun ? 'DRY RUN — nothing will be written. ' : ''}${repo} · ${numbers.length} card(s) · ` +
      `reason \`${reason}\` · expect-state \`${expectState}\` · open-PR skip ${skipPrReferenced ? 'ON' : 'OFF'}` +
      `${skipPrReferenced ? '' : ' (⛔ declared off: a card an open PR references will be closed under it)'}`,
  );
  if (route.error) {
    record(`close-cards: PREREQUISITE NOT MET — ${route.error}`);
    record('⛔ NOTHING was read and nothing was written.');
    return result(EXIT_PREREQUISITE, { transport: route.transport });
  }
  record(`close-cards: transport ${route.transport} — ${route.reason}`);

  for (const issue of numbers) {
    const base = `/repos/${repo}/issues/${issue}`;

    // ① Re-read live. ⛔ Any list snapshot is void — the seat that built the
    // list is not the act that closes the card.
    const read = await call(base, {});
    const readVerdict = classifyHttp({ status: read.status, op: 'card-read', rateRemaining: read.rateRemaining });
    if (readVerdict !== 'ok') {
      record(`#${issue} COULD NOT READ — ${read.call} -> HTTP ${read.status}${read.detail ? ` (${read.detail})` : ''}`);
      record(
        `⛔ STOPPING at #${issue}. ${counts.closed} card(s) closed, ${counts.skipped} skipped, ` +
          `${numbers.length - counts.read} not reached. ⛔ NOT MEASURED for those — nothing was written to them.`,
      );
      return result(readVerdict === 'refusal' ? EXIT_PLATFORM_REFUSAL : EXIT_PREREQUISITE, { stoppedAt: issue });
    }
    counts.read += 1;
    const card = read.json ?? {};

    // The cheap rows first: the timeline is bought ONLY for a card that would
    // otherwise be acted on, so a list of 90 mostly-skipped cards costs 90
    // requests rather than 180.
    let why = skipReason(card, { expectState, openPrs: [] });
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
      why = skipReason(card, { expectState, openPrs: openPrReferences(timeline.events) });
    }

    if (why) {
      counts.skipped += 1;
      skips.push({ issue, why });
      record(`#${issue} SKIP ${why}`);
      continue;
    }

    counts.actionable += 1;

    if (dryRun) {
      record(`#${issue} → WOULD CLOSE \`${reason}\` (comment · remove \`${expectState}\` · close) — ⛔ nothing written`);
      continue;
    }

    // ② comment
    const posted = await postComment({ repo, issue, file: commentFile });
    if (posted.exit === POST_STAMPED_EXIT_NOT_STORED) {
      record(halfWriteText({ issue, repo, landed: ['comment'], failedStep: 'comment', detail: 'post-stamped exit 4 — WRITTEN BUT NOT STORED as sent' }));
      return result(EXIT_HALF_WRITE, { stoppedAt: issue, landed: ['comment'] });
    }
    if (posted.exit !== 0) {
      record(`#${issue} comment REFUSED — post-stamped exit ${posted.exit}${posted.detail ? ` — ${posted.detail}` : ''}`);
      record(`⛔ NOTHING was written to #${issue}: post-stamped refuses BEFORE the write on every exit but 4. Stopping — ${counts.closed} card(s) closed so far.`);
      return result(posted.exit === EXIT_PREREQUISITE ? EXIT_PREREQUISITE : EXIT_PLATFORM_REFUSAL, { stoppedAt: issue, landed: [] });
    }

    // ③ label — the four-step write, read back by the tool that owns it.
    const wrote = await labelWrite({ repo, issue, remove: expectState });
    if (wrote.exit !== 0) {
      record(halfWriteText({ issue, repo, landed: ['comment'], failedStep: 'label', detail: `label-write exit ${wrote.exit}${wrote.detail ? ` — ${wrote.detail}` : ''}` }));
      return result(EXIT_HALF_WRITE, { stoppedAt: issue, landed: ['comment'] });
    }

    // ④ close — and READ THE ANSWER BACK. A 200 whose body does not say
    // `closed` is not a close, and a close recorded under another reason is a
    // wrong record rather than a near miss. Under the relay the close is ONE
    // dispatch and the answer read back is the card itself.
    let patched = null;
    if (route.transport === 'dispatch') {
      const packed = packRequest({ repo, session: route.session, actions: [{ op: 'issue_patch', issue, state: 'closed', state_reason: reason }] });
      if (!packed.ok) {
        record(relayRefusalText(packed.errors));
        record(halfWriteText({ issue, repo, landed: ['comment', 'label'], failedStep: 'close', detail: 'the relay payload was refused before any dispatch' }));
        return result(EXIT_HALF_WRITE, { stoppedAt: issue, landed: ['comment', 'label'], transport: route.transport });
      }
      record(`#${issue} close (relay) — ONE dispatch, request ${packed.payload.request_id}: issue_patch closed \`${reason}\``);
      const sent = await send(packed.payload, { token: TOKEN, log: (line) => record(`      ${line}`) });
      if (sent.ok) {
        const back = await call(base, {});
        patched = { ...back, call: `${back.call} (read back after relay run ${sent.run?.url ?? sent.run?.id ?? ''})` };
      } else if (route.requested === 'auto' && sent.state === 'no-run') {
        record(`      ${fallbackText(sent, 'close-cards')}`);
      } else {
        if (sent.state === 'no-run' || sent.state === 'timeout') record(unconfirmedText(sent, 'close-cards'));
        record(
          halfWriteText({
            issue,
            repo,
            landed: ['comment', 'label'],
            failedStep: 'close',
            detail: `relay ${sent.state}${sent.run?.url ? ` ${sent.run.url}` : ''}${sent.detail ? ` — ${sent.detail}` : ''}`,
          }),
        );
        return result(EXIT_HALF_WRITE, { stoppedAt: issue, landed: ['comment', 'label'], transport: route.transport, relay: sent });
      }
    }
    if (patched === null) patched = await call(base, { method: 'PATCH', body: { state: 'closed', state_reason: reason } });
    const patchVerdict = classifyHttp({ status: patched.status, op: 'card-patch', rateRemaining: patched.rateRemaining });
    if (patchVerdict !== 'ok' || patched.json?.state !== 'closed' || patched.json?.state_reason !== reason) {
      record(
        halfWriteText({
          issue,
          repo,
          landed: ['comment', 'label'],
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
    closed.push({ issue, reason, comment: posted.id });
    record(`#${issue} → closed ${reason} ${posted.id ?? '(no comment id returned)'}`);
  }

  record(
    `close-cards: ${dryRun ? 'DRY RUN — nothing was written. ' : ''}${counts.read} read · ` +
      `${counts.actionable} actionable · ${counts.skipped} skipped${dryRun ? '' : ` · ${counts.closed} closed \`${reason}\``}`,
  );
  return result(EXIT_OK);
}

// ---------------------------------------------------------------------------
// --self-test — offline, no network, every branch above driven by a STUBBED
// API rather than a model of one.
//
// The fake serves the three reads and the one write this tool makes, with the
// semantics that matter: a `PATCH` really mutates the card it answers, so the
// close read-back is a read of what the write did rather than an echo of what
// it asked for. A fake that echoed would pass every assertion below while the
// read-back this tool exists for went untested.
//
// The battery ledger this self-test's floor is evaluated against: `battery()`
// opens one, every assertion is attributed to the one most recently opened, and
// a section that stops running names ITSELF at the floor rather than going
// quiet. The counts are a FLOOR, never an equality.
// ---------------------------------------------------------------------------

const SELF_TEST_BATTERIES = Object.freeze({
  'the CLI: what a typo must never be allowed to mean': 14,
  'the list file: `#` opens a card number, never a comment': 8,
  'the pre-flight: a closing comment no card should receive': 7,
  'the skip matrix: every reason a card is left alone': 14,
  'the open-PR reading: a cross-reference that is a PR, and open': 7,
  'the timeline walk: one page is not the timeline': 8,
  'the happy path: three writes per card, in order': 10,
  'the half-write refusal: stop at the first card left in a state nobody asked for': 12,
  'the unreadable card: a verdict taken from nothing is not taken': 7,
  'the dry run: a plan that proves it wrote nothing': 7,
  'the sibling tools: driven, never re-implemented': 8,
  'the relay transport: the close as ONE dispatch read back from the card, the label write on the same route, a relay miss is a half-write': 8,
});
const SELF_TEST_BATTERY_FLOOR = 12;
const UNATTRIBUTED_BATTERY = '(unattributed)';

const batteryCases = new Map();
let openBattery = null;
const battery = (name) => {
  openBattery = name;
};
let selfTestReachedVerdict = false;

const cardJson = (card) => ({
  number: card.number,
  state: card.state ?? 'open',
  state_reason: card.state_reason ?? null,
  labels: (card.labels ?? []).map((name) => ({ name })),
  assignees: (card.assignees ?? []).map((login) => ({ login })),
});

/** A board with the semantics this tool depends on — the `PATCH` mutates, so the read-back reads the write. */
export function fakeApi(initial = {}) {
  const cards = new Map();
  for (const [number, card] of Object.entries(initial.cards ?? {})) cards.set(Number(number), { ...card, number: Number(number) });
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
    const match = /\/repos\/[^/]+\/[^/]+\/issues\/(\d+)(\/timeline)?/.exec(path);
    const number = Number(match?.[1]);
    const kind = match?.[2] ? 'timeline' : method === 'PATCH' ? 'patch' : 'read';
    calls.push({ kind, number, method, path, body: init.body ?? null });

    const queued = hooks.get(`${kind}:${number}`) ?? hooks.get(kind);
    if (queued?.length) {
      const canned = queued.shift();
      return wrap(canned.status, canned.json ?? { message: 'canned' }, canned.rateRemaining ?? 5000);
    }

    const card = cards.get(number);
    if (!card) return wrap(404, { message: 'Not Found' });
    if (kind === 'timeline') {
      // Paged for real: a fake that answered the whole timeline to every
      // request would pass the walk's assertions while the truncation the walk
      // exists for went untested.
      const query = new URLSearchParams(path.slice(path.indexOf('?') + 1));
      const size = Number(query.get('per_page') ?? 100);
      const page = Number(query.get('page') ?? 1);
      const all = card.timeline ?? [];
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

/** A fake relay: `success` applies the `issue_patch` to the fake card the run reads back; the other outcomes answer `sendFleetWrite`'s shapes. */
function fakeRelay(api, outcome, sent) {
  const RUN = { id: 42, url: 'https://github.test/run/42', status: 'completed', conclusion: 'success' };
  return async (payload) => {
    sent.push(payload);
    const base = { requestId: payload.request_id, startMs: 1, ceilingMs: 2, status: 204, verdict: 'ok', detail: '' };
    if (outcome === 'no-run') return { ...base, state: 'no-run', ok: false, run: null, detail: 'no run appeared' };
    if (outcome === 'timeout') return { ...base, state: 'timeout', ok: false, run: { ...RUN, status: 'in_progress', conclusion: null } };
    if (outcome === 'failure') return { ...base, state: 'failure', ok: false, run: { ...RUN, conclusion: 'failure' }, detail: 'conclusion failure' };
    for (const a of payload.actions) {
      const card = api.cards.get(a.issue);
      if (card && a.op === 'issue_patch') {
        if ('state' in a) card.state = a.state;
        if ('state_reason' in a) card.state_reason = a.state_reason;
      }
    }
    return { ...base, state: 'success', ok: true, run: RUN, detail: 'conclusion success' };
  };
}

async function driveOffline(options, initial = {}, stubs = {}) {
  const api = fakeApi(initial);
  const posted = [];
  const labelled = [];
  const out = [];
  const sent = [];
  const commentExits = [...(stubs.commentExits ?? [])];
  const labelExits = [...(stubs.labelExits ?? [])];
  const res = await runCloseCards(
    {
      repo: 'objectstack-ai/objectstack',
      commentFile: '/tmp/closing.md',
      reason: 'not_planned',
      expectState: 'pm:queue',
      skipPrReferenced: true,
      dryRun: false,
      ...options,
    },
    {
      call: api.call,
      log: (line) => out.push(line),
      route: stubs.route ?? DIRECT_ROUTE,
      send: stubs.relay ? fakeRelay(api, stubs.relay, sent) : undefined,
      postComment: async ({ issue }) => {
        const exit = commentExits.length ? commentExits.shift() : 0;
        posted.push({ issue, exit });
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

const QUEUED = (number, extra = {}) => ({ [number]: { state: 'open', labels: ['pm:queue', 'tooling'], assignees: [], timeline: [], ...extra } });
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
  const MIN = [...REPO, '--list', 'l.txt', '--comment', 'c.md', '--reason', 'not_planned'];

  // ── the CLI ───────────────────────────────────────────────────────────────
  battery('the CLI: what a typo must never be allowed to mean');
  t('the minimal invocation parses', parseCliOptions(MIN).ok);
  t('…and defaults the expected state to `pm:queue`', parseCliOptions(MIN).options?.expectState, 'pm:queue');
  t('…and the open-PR skip is ON by default', parseCliOptions(MIN).options?.skipPrReferenced, true);
  t('…and a dry run is OFF by default', parseCliOptions(MIN).options?.dryRun, false);
  t('`--no-skip-pr-referenced` turns the skip off', parseCliOptions([...MIN, '--no-skip-pr-referenced']).options?.skipPrReferenced, false);
  t('`--skip-pr-referenced` turns it back on', parseCliOptions([...MIN, '--no-skip-pr-referenced', '--skip-pr-referenced']).options?.skipPrReferenced, true);
  t('the `--flag=value` spelling is the same option', parseCliOptions([...REPO, '--list=l.txt', '--comment=c.md', '--reason=completed']).options?.reason, 'completed');
  t('⛔ a missing --list is refused, never defaulted', parseCliOptions([...REPO, '--comment', 'c.md', '--reason', 'not_planned']).ok, false);
  t('⛔ a missing --comment is refused', parseCliOptions([...REPO, '--list', 'l.txt', '--reason', 'not_planned']).ok, false);
  t('⛔ a missing --reason is refused — a close with no reason is a record with none', parseCliOptions([...REPO, '--list', 'l.txt', '--comment', 'c.md']).ok, false);
  t('⛔ a reason GitHub does not take is refused by name', parseCliOptions([...REPO, '--list', 'l.txt', '--comment', 'c.md', '--reason', 'wontfix']).ok, false);
  t('⛔ an --expect-state that is not a pm state is refused, never silently matched against nothing', parseCliOptions([...MIN, '--expect-state', 'pm:queued']).ok, false);
  t('…and the refusal names the states there are', /pm:dispatched/.test(parseCliOptions([...MIN, '--expect-state', 'pm:queued']).error ?? ''));
  t('⛔ an unrecognised option is refused rather than ignored', parseCliOptions([...MIN, '--force']).ok, false);

  // ── the list file ─────────────────────────────────────────────────────────
  battery('the list file: `#` opens a card number, never a comment');
  t('one per line', parseCardList('19440\n19408\n').numbers, [19440, 19408]);
  t('space-separated on one line', parseCardList('#19440 #19408 #19404').numbers, [19440, 19408, 19404]);
  t('both spellings mixed, with blank lines', parseCardList('#19440\n\n19408 #19404\n').numbers, [19440, 19408, 19404]);
  t('⛔ a `#` line is a CARD, not a comment — the whole list is not silently dropped', parseCardList('#19440').numbers, [19440]);
  t('⛔ a token that is not a card number is refused by name', parseCardList('19440 not-a-card').ok, false);
  t('…and the refusal quotes it', /not-a-card/.test(parseCardList('19440 not-a-card').error ?? ''));
  t('⛔ an empty list is refused, never read as "nothing to do"', parseCardList('   \n').ok, false);
  t('a duplicate is collapsed and REPORTED', parseCardList('#19440 19440').duplicates, [19440]);

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
  t('…and the label write removes the EXPECTED state, never a guessed one', happy.labelled[0].remove, 'pm:queue');
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

  // The floor runs BEFORE the verdict, so a success line can only be printed by
  // a run in which every declared battery registered its cases.
  const floorProblems = [];
  // ── the relay transport ──────────────────────────────────────────────────
  battery('the relay transport: the close as ONE dispatch read back from the card, the label write on the same route, a relay miss is a half-write');
  {
    const SESSION = 'session_01ABCDEFGHJKMNPQRSTVWXYZ';
    const dispatchRoute = (requested = 'dispatch') => ({ requested, transport: 'dispatch', reason: 'self-test: dispatch', error: null, session: SESSION });
    const ok = await driveOffline({ numbers: [61] }, { cards: QUEUED(61) }, { route: dispatchRoute(), relay: 'success' });
    t('under dispatch the close lands through ONE relay dispatch and the card reads back closed, exit 0', [ok.res.exit, ok.res.counts.closed, ok.api.cards.get(61).state, ok.api.cards.get(61).state_reason], [EXIT_OK, 1, 'closed', 'not_planned']);
    t('…the payload carries issue_patch closed with the reason, the session and the target', [ok.sent.length, ok.sent[0].session, ok.sent[0].repo, ok.sent[0].actions], [1, SESSION, 'objectstack-ai/objectstack', [{ op: 'issue_patch', issue: 61, state: 'closed', state_reason: 'not_planned' }]]);
    t('…and no PATCH left this process — the reads and a read-back only', ok.api.calls.map((c) => c.kind), ['read', 'timeline', 'read']);
    t('the transport is printed on every run, direct included', ok.text.includes('transport dispatch') && (await driveOffline({ numbers: [61] }, { cards: QUEUED(61) })).text.includes('transport direct'));
    const timedOut = await driveOffline({ numbers: [62, 63] }, { cards: { ...QUEUED(62), ...QUEUED(63) } }, { route: dispatchRoute(), relay: 'timeout' });
    t('a close whose run did not complete is UNCONFIRMED and a HALF-WRITE: exit 4 naming the run, the next card never read', [timedOut.res.exit, timedOut.text.includes('UNCONFIRMED') && timedOut.text.includes('https://github.test/run/42'), timedOut.res.counts.read], [EXIT_HALF_WRITE, true, 1]);
    const noRunAuto = await driveOffline({ numbers: [64] }, { cards: QUEUED(64) }, { route: dispatchRoute('auto'), relay: 'no-run' });
    t('under AUTO, no run falls back to the direct PATCH — said out loud — and the card closes', [noRunAuto.res.exit, noRunAuto.text.includes('Falling back to DIRECT'), noRunAuto.api.calls.some((c) => c.kind === 'patch'), noRunAuto.api.cards.get(64).state], [EXIT_OK, true, true, 'closed']);
    const failed = await driveOffline({ numbers: [65] }, { cards: QUEUED(65) }, { route: dispatchRoute('auto'), relay: 'failure' });
    t('⛔ a run that FAILED is never fallen back from, even under auto: half-write, no PATCH', [failed.res.exit, failed.api.calls.some((c) => c.kind === 'patch')], [EXIT_HALF_WRITE, false]);
    const badRoute = await driveOffline({ numbers: [66] }, { cards: QUEUED(66) }, { route: { requested: 'dispatch', transport: 'dispatch', reason: '', error: 'OS_FLEET_SESSION is absent', session: null } });
    t('a route with an error is exit 3 before the first card is read', [badRoute.res.exit, badRoute.api.calls.length], [EXIT_PREREQUISITE, 0]);
    t('structural: the label write is handed THIS run\'s route, so one decision serves both writes', readFileSync(SELF_PATH, 'utf8').includes('runLabelWrite(parsed.options, { log: (line) => record(`      ${line}`), route, send: deps.send })'));
  }

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

  let listRaw;
  try {
    listRaw = readFileSync(options.list, 'utf8');
  } catch (err) {
    console.error(`close-cards: could not read --list ${options.list} (${err.message}).`);
    return EXIT_USAGE;
  }
  const list = parseCardList(listRaw);
  if (!list.ok) {
    console.error(`close-cards: ${list.error}`);
    return EXIT_USAGE;
  }
  if (list.duplicates.length > 0) {
    console.error(`close-cards: note — the --list names ${list.duplicates.map((n) => `#${n}`).join(', ')} more than once; each card is swept exactly once.`);
  }

  let commentRaw;
  try {
    commentRaw = readFileSync(options.comment, 'utf8');
  } catch (err) {
    console.error(`close-cards: could not read --comment ${options.comment} (${err.message}).`);
    return EXIT_USAGE;
  }
  // ⛔ Judged ONCE, before card one: a body post-stamped would refuse must not
  // be discovered on card 40, with 39 closing comments already on the board.
  const pre = preflightComment(commentRaw);
  if (!pre.ok) {
    console.error(pre.error);
    console.error('close-cards: ⛔ NOTHING was written — the closing comment is refused before the first card is read.');
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
      numbers: list.numbers,
      commentFile: options.comment,
      reason: options.reason,
      expectState: options.expectState,
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
