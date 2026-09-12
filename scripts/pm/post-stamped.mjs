#!/usr/bin/env node
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * post-stamped — write a seat artefact to GitHub with a stamp this act read (#17314).
 *
 *   node scripts/pm/post-stamped.mjs --comment=17314 --file=body.md
 *   node scripts/pm/post-stamped.mjs --comment=17314          # body on stdin
 *   node scripts/pm/post-stamped.mjs --body=17314 --file=seat-post.md
 *   node scripts/pm/post-stamped.mjs --dry-run --comment=17314 --file=body.md
 *   node scripts/pm/post-stamped.mjs --self-test              # offline, no network at all
 *
 * ## The invariant, and the spelling this removes
 *
 * Every timestamp a seat writes into a GitHub comment or body — the reading
 * time in a subscript line, the `YYYY-MM-DDThh:mmZ` on claims, dispatches,
 * verdicts, round reports and seat-post edits — must come from a clock read by
 * the same act that writes the text, never from the seat's sense of elapsed
 * time. The protocol has required the stamp for a while; what it could not
 * remove is that an ESTIMATED stamp had a spelling. A seat typed the digits.
 *
 * Filed as MECHANICAL because the discipline remedy is spent: the triage seat
 * post records the same failure twice — R+164 (「轮次计时全靠感觉,错了约 4
 * 倍」), then R+165, ~70 minutes off with roughly fifteen audit comments
 * carrying the estimate — with a "measure it next time" note written BETWEEN
 * them that did not hold.
 *
 * So the seat writes a TOKEN and this tool writes the time:
 *
 *   `{{NOW}}`                    the clock read in THIS invocation.
 *   `{{WAS:2026-09-08T14:00Z}}`  a stamp that is a reading of something ELSE,
 *                                declared as such and rendered verbatim.
 *
 * There is no third spelling, and no flag that turns the contract off.
 *
 * ## What it refuses, and why the refusal is positional
 *
 * `check-half-states.mjs`'s H56 reads two POSITIONS as belonging to the writing
 * act: the artefact's OPENING line, and a subscript reading-time line. This
 * tool imports that same reader, so the write side refuses exactly what the
 * read-side patrol would file:
 *
 *   POSITIONAL  a bare stamp sits in one of those two positions. That is the
 *               act's own stamp typed by hand, which is the whole defect. Write
 *               `{{NOW}}`, or `{{WAS:…}}` if it really is a quoted reading.
 *   MIXED       the body uses `{{NOW}}` AND carries a bare stamp somewhere
 *               else. The author knows the token and typed a time anyway; that
 *               typed one is the estimate. This is the case the filing card
 *               names by hand.
 *   QUOTED      a `{{WAS:…}}` value is not one stamp and nothing else, or names
 *               an instant LATER than the clock this act holds. See the
 *               direction section below.
 *   UNKNOWN     a `{{…}}` token survives substitution. A mistyped `{{now}}`
 *               would otherwise post literally AND leave the artefact
 *               unstamped, which is the quiet direction.
 *
 * ⛔ The positional refusal is NOT the mixed one widened for tidiness. Mixed
 * alone leaves the estimated stamp fully spellable — a seat that never types
 * `{{NOW}}` is never refused — so mixed alone would not have caught the
 * recorded failure, whose comments carried no token at all.
 *
 * ## The quoted route has a DIRECTION, not only a shape (#17763)
 *
 * Checking that a `{{WAS:…}}` value is shaped like a stamp leaves the estimate
 * spellable through the one escape this tool offers by name: a seat whose sense
 * of elapsed time runs AHEAD types its guess, is refused positionally, and the
 * refusal's own second option takes that same guess unchanged. The recorded
 * failures were forward-skewed, which is exactly the half a shape check cannot
 * see. So a quoted value is judged against the clock this act holds as well:
 * the quoted route renders a reading of something ELSE, and an instant that has
 * not happened yet is provably not a reading of anything.
 *
 * The boundary, because the format is minute-grained: a stamp names the SPAN of
 * its own grain (`stampSpan`, imported — the same widening H56 makes before it
 * measures drift), and the value is a possible reading exactly while that span
 * has STARTED. So a stamp equal to the act's own minute is ACCEPTED — a reading
 * taken at any instant inside this minute is spelled exactly that way — and the
 * refusal begins at the first minute whose start the clock has not reached.
 *
 * ⛔ There is no skew tolerance, and `H56_STAMP_TOLERANCE_MIN` is not one.
 * That number measures how far a WRITE may land after the read it carries — a
 * backward gap on the read side. Spending it forward here would reopen a
 * quarter-hour window on the very direction the recorded failures took.
 *
 * The same judgement corrects what the OTHER refusals offer: the positional and
 * mixed texts hand the seat `{{WAS:<the typed stamp>}}` with the stamp filled
 * in, so when that stamp is in the future they must stop offering a route that
 * will refuse it — a refusal text prescribing a refused remedy is a tool
 * arguing with itself.
 *
 * A bare stamp OUTSIDE those two positions is passed through with a note on
 * stderr rather than refused: prose quoting a ruling's date is a reading of
 * something else, and refusing it would push seats back onto the channel this
 * tool exists to replace.
 *
 * ## ⚖️ Why this ACTS by default, where `sweep-closed-cards.mjs` dry-runs
 *
 * Its sibling next door defaults to a dry run and needs `--write`, because it
 * is a machine deciding BY ITSELF which of thousands of archived cards to
 * write to: the blast radius is the board and the operator sees the list only
 * afterwards. This tool writes ONE artefact, to a target the caller named on
 * the command line, from a body the caller wrote. Demanding a second flag on
 * top of `--comment=17314` is a second spelling of one decision, and a helper
 * with friction gets bypassed for the channel that has none — which is the
 * failure this card exists to close. `--dry-run` prints the substituted body
 * and writes nothing.
 *
 * ## The read-back, which is what makes the transcript proof
 *
 * After the write the artefact is fetched again and three things are printed:
 * the id and URL, the platform's own `created_at` (`updated_at` for a body
 * edit, which is when that write happened), and the DRIFT between the stamp
 * this run substituted and that instant — the same measurement H56 makes on
 * the corpus, taken at write time, against the same imported tolerance. The
 * stored bytes are compared with the bytes sent, so a body the platform's
 * sanitizer mutated is reported instead of assumed.
 */

import process from 'node:process';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { isEntrypoint } from '../invoked-as.mjs';
import {
  EXIT_PREREQUISITE_NOT_MET,
  H56_STAMP_TOLERANCE_MIN,
  PROXY_FLAG,
  h56StampedReadings,
  protocolStamps,
  proxyRearmPlan,
  resolveSweepRepo,
  stampDriftMinutes,
  stampSpan,
} from './check-half-states.mjs';

const SELF_PATH = fileURLToPath(import.meta.url);
const API = 'https://api.github.com';
const TOKEN = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN ?? '';

export const EXIT_OK = 0;
export const EXIT_USAGE = 1;
export const EXIT_REFUSED = 2;

/**
 * The re-exec guard, per script rather than shared with its neighbours: two
 * scripts sharing one guard name means the first one's re-exec silently
 * disarms the second's when they run in the same process tree.
 */
const PROXY_REARM_GUARD = 'OS_POST_STAMPED_PROXY_REARMED';

// ---------------------------------------------------------------------------
// Pure core — every function below is offline and is what `--self-test` pins.
// ---------------------------------------------------------------------------

/** The token a seat writes where the act's own stamp goes. */
export const STAMP_TOKEN = '{{NOW}}';

/**
 * The declared QUOTED stamp — a reading of something else, rendered verbatim.
 *
 * ⛔ NOT global, for `PROTOCOL_STAMP_RE`'s reason: an exported `g`-flagged
 * regex carries `lastIndex` between callers. Every use below builds its own.
 */
export const QUOTED_TOKEN_RE = /\{\{WAS:([^{}]*)\}\}/;

/** Any `{{…}}` token, used to catch the ones substitution did not consume. */
export const ANY_TOKEN_RE = /\{\{[^{}]*\}\}/;

const globalOf = (re) => new RegExp(re.source, 'g');

/** The clock, in the protocol's own spelling. */
export function stampNow(ms = Date.now()) {
  return `${new Date(ms).toISOString().slice(0, 16)}Z`;
}

/**
 * The text with every declared quoted stamp blanked to spaces of equal length,
 * so a scan for BARE stamps sees only the ones nobody declared — and so line
 * numbers, columns and the opening line are all still where they were.
 */
export function maskQuotedStamps(text) {
  return String(text ?? '').replace(globalOf(QUOTED_TOKEN_RE), (m) => ' '.repeat(m.length));
}

/** The values inside every `{{WAS:…}}` in this text. */
export function quotedStampValues(text) {
  const re = globalOf(QUOTED_TOKEN_RE);
  const out = [];
  let m;
  while ((m = re.exec(String(text ?? '')))) out.push(m[1]);
  return out;
}

/**
 * Whether `stamp` names an instant the clock this act holds has NOT reached.
 *
 * The stamp is widened to its own grain first (`stampSpan`, imported rather
 * than re-derived — H56 measures drift against the same span, and two spellings
 * of "which minute is this" would let the write side and the read side disagree
 * about the boundary). A value is a possible reading exactly while its span has
 * started, so the current minute is accepted and the next one is not.
 *
 * An unparseable value is NOT future — it is the shape refusal's business, and
 * answering `true` here would file one typo under two kinds.
 */
export function stampIsFuture(stamp, nowMs = Date.now()) {
  const span = stampSpan(String(stamp ?? '').trim());
  return span !== null && span.from > nowMs;
}

/**
 * Every reason this body may not be posted, in the order a reader should fix
 * them. An empty array is a body that may be written.
 *
 * `nowMs` is the clock the WRITING act holds — the same one `renderBody`
 * substitutes, passed through so the direction check judges against the instant
 * this body is being written at, never a second read taken later.
 */
export function stampRefusals(text, nowMs = Date.now()) {
  const raw = String(text ?? '');
  const masked = maskQuotedStamps(raw);
  const refusals = [];
  const now = stampNow(nowMs);

  for (const value of quotedStampValues(raw)) {
    if (protocolStamps(value).length !== 1 || protocolStamps(value)[0] !== value.trim()) {
      refusals.push({
        kind: 'quoted-not-a-stamp',
        detail:
          `\`{{WAS:${value}}}\` does not declare a stamp. The quoted route renders a reading of ` +
          'something else VERBATIM, so its contents must be one `YYYY-MM-DDThh:mmZ` and nothing else — ' +
          'it is a declaration, not a free-text escape from the contract.',
      });
      continue;
    }
    if (!stampIsFuture(value, nowMs)) continue;
    refusals.push({
      kind: 'quoted-in-the-future',
      detail:
        `\`{{WAS:${value}}}\` declares an instant LATER than the clock this act holds (\`${now}\`). The ` +
        'quoted route renders a reading of something ELSE verbatim, and a time that has not happened yet ' +
        'is provably not a reading of anything — it is an estimate with a declaration wrapped round it, ' +
        `which is the defect this tool exists to make unspellable. Write \`${STAMP_TOKEN}\` if it is this ` +
        'act\'s own clock, or correct the value to the instant that was actually read. There is no skew ' +
        'tolerance here, forward: a stamp the clock has not reached is not nearly a reading.',
    });
  }

  const positional = h56StampedReadings(masked);
  for (const hit of positional) {
    const opener =
      `${hit.where} carries the bare stamp \`${hit.stamp}\`. That position belongs to the writing ` +
      'act, so a stamp typed there is the act\'s own time written from memory — the defect this tool ' +
      'exists to make unspellable. ';
    refusals.push({
      kind: 'positional',
      detail: stampIsFuture(hit.stamp, nowMs)
        ? `${opener}Write \`${STAMP_TOKEN}\` there. The quoted route is NOT open to this one: ` +
          `\`${hit.stamp}\` is later than the clock this act holds (\`${now}\`), so it cannot be a reading ` +
          'of something else either.'
        : `${opener}Write \`${STAMP_TOKEN}\` there, or \`{{WAS:${hit.stamp}}}\` if it ` +
          'is genuinely a reading of something else.',
    });
  }

  if (raw.includes(STAMP_TOKEN)) {
    const seen = new Set(positional.map((hit) => hit.stamp));
    for (const stamp of protocolStamps(masked)) {
      if (seen.has(stamp)) continue;
      seen.add(stamp);
      const opener =
        `this body uses \`${STAMP_TOKEN}\` and also carries the bare stamp \`${stamp}\`. One of the ` +
        'two clocks was read by this act and the other was typed; a reader cannot tell which. ';
      refusals.push({
        kind: 'mixed',
        detail: stampIsFuture(stamp, nowMs)
          ? `${opener}Make it \`${STAMP_TOKEN}\` if it is this act's own. The quoted route is NOT open to ` +
            `it: \`${stamp}\` is later than the clock this act holds (\`${now}\`), so it cannot be a ` +
            'reading of something else either.'
          : `${opener}Declare ` +
            `it with \`{{WAS:${stamp}}}\` if it is a quoted reading, or make it \`${STAMP_TOKEN}\` if it ` +
            'is this act\'s own.',
      });
    }
  }

  return refusals;
}

/** The refusal a caller reads, from `stampRefusals`' rows. */
export function refusalText(refusals) {
  const rows = (refusals ?? []).map((r, i) => `  ${i + 1}. [${r.kind}] ${r.detail}`);
  return (
    `post-stamped: REFUSED — ${rows.length} stamp-contract problem(s) in the body. Nothing was written.\n` +
    `${rows.join('\n')}\n\n` +
    `  The contract has exactly two spellings: \`${STAMP_TOKEN}\` for the clock this act reads, and\n` +
    '  `{{WAS:YYYY-MM-DDThh:mmZ}}` for a stamp that is a reading of something else — an instant the\n' +
    '  clock has already reached, since nothing can be read out of the future. There is no flag that\n' +
    '  turns it off — a stamp typed from memory is the defect, not a formatting preference.'
  );
}

/**
 * The body as it will be written, or the refusal. Pure, so every branch that
 * decides whether a write happens at all is pinned offline.
 */
export function renderBody(text, nowMs = Date.now()) {
  const raw = String(text ?? '');
  if (raw.trim().length === 0) {
    return {
      ok: false,
      kind: 'empty',
      error:
        'post-stamped: REFUSED — the body is empty. An empty artefact posted to a card is noise a\n' +
        '  reader has to judge; supply a body with --file=PATH or on stdin.',
    };
  }
  const refusals = stampRefusals(raw, nowMs);
  if (refusals.length > 0) return { ok: false, kind: 'stamp-contract', refusals, error: refusalText(refusals) };

  const stamp = stampNow(nowMs);
  let quoted = 0;
  let body = raw.replace(globalOf(QUOTED_TOKEN_RE), (_m, inner) => {
    quoted += 1;
    return inner;
  });
  const substituted = body.split(STAMP_TOKEN).length - 1;
  body = body.split(STAMP_TOKEN).join(stamp);

  const leftover = body.match(globalOf(ANY_TOKEN_RE));
  if (leftover) {
    return {
      ok: false,
      kind: 'unknown-token',
      error:
        `post-stamped: REFUSED — ${leftover.length} token(s) survived substitution: ${leftover.join(', ')}.\n` +
        `  Posting them would put the literal text on the card AND leave the artefact unstamped, which is\n` +
        `  the quiet direction. The tokens this tool knows are \`${STAMP_TOKEN}\` and \`{{WAS:…}}\`; a\n` +
        '  mistyped one is a typo, and a typo must never decide whether a stamp was read.',
    };
  }

  return { ok: true, body, stamp, substituted, quoted };
}

/**
 * What the read-back proves, as lines a transcript carries. `writtenAt` is the
 * platform's own clock for the write — `created_at` for a comment, `updated_at`
 * for a body edit, which is when that write actually happened.
 */
export function readBackVerdict({ stamp, writtenAt, sent, stored, substituted = 0 }) {
  const lines = [];
  const drift = substituted > 0 ? stampDriftMinutes(stamp, writtenAt, writtenAt) : null;
  if (substituted === 0) {
    lines.push(`  stamp: none substituted — this body carried no ${STAMP_TOKEN}, so there is no clock to check`);
  } else if (drift === null) {
    lines.push(`  ⚠️ stamp: \`${stamp}\` substituted, but the platform returned no readable write time — NOT MEASURED`);
  } else if (drift === 0) {
    lines.push(`  stamp: \`${stamp}\` · platform wrote it at ${writtenAt} · drift 0 — one clock, one act`);
  } else {
    lines.push(
      `  ⚠️ stamp: \`${stamp}\` · platform wrote it at ${writtenAt} · drift ${drift} min` +
        (drift > H56_STAMP_TOLERANCE_MIN
          ? ` — BEYOND the ${H56_STAMP_TOLERANCE_MIN}-minute tolerance; H56 will file this artefact`
          : ` — within the ${H56_STAMP_TOLERANCE_MIN}-minute tolerance`),
    );
  }
  const sentBytes = Buffer.byteLength(String(sent ?? ''), 'utf8');
  if (typeof stored !== 'string') {
    lines.push('  ⚠️ read-back: the stored body could not be read — the write is UNVERIFIED, not verified');
  } else if (stored === sent) {
    lines.push(`  read-back: ${sentBytes} byte(s) stored, IDENTICAL to what was sent`);
  } else {
    lines.push(
      `  ⚠️ read-back: sent ${sentBytes} byte(s), stored ${Buffer.byteLength(stored, 'utf8')} — the platform ` +
        'MUTATED the body. Read the artefact before trusting it: the sanitizer eats tag-shaped fragments.',
    );
  }
  return { lines, drift, mutated: typeof stored === 'string' && stored !== sent };
}

/** The flags this tool takes. An argument outside this set is a typo, and a typo is refused. */
export const KNOWN_FLAGS = Object.freeze(['--dry-run', '--json', '--self-test', '--help', '-h']);
export const KNOWN_OPTIONS = Object.freeze(['comment', 'body', 'file', 'repo']);

export function readOption(argv, name) {
  const prefix = `--${name}=`;
  const hit = (argv ?? []).find((a) => a.startsWith(prefix));
  return hit === undefined ? null : hit.slice(prefix.length);
}

/**
 * Parse argv into the run's options, or refuse. Pure, so the refusals are
 * pinned offline — this is the layer that decides WHERE a write lands, and a
 * misread target is an artefact posted onto somebody else's card.
 */
export function parseOptions(argv) {
  const args = argv ?? [];
  for (const arg of args) {
    if (KNOWN_FLAGS.includes(arg)) continue;
    const named = /^--([a-z-]+)=/.exec(arg);
    if (named && KNOWN_OPTIONS.includes(named[1])) continue;
    return {
      ok: false,
      error: `\`${arg}\` is not an argument this tool takes. Flags: ${KNOWN_FLAGS.join(' ')}; options: ${KNOWN_OPTIONS.map((o) => `--${o}=…`).join(' ')}.`,
    };
  }
  const comment = readOption(args, 'comment');
  const body = readOption(args, 'body');
  if (comment !== null && body !== null) {
    return { ok: false, error: '--comment and --body name two different acts. Pass one: --comment=N posts a new comment, --body=N rewrites the card body.' };
  }
  if (comment === null && body === null) {
    return { ok: false, error: 'no target. Pass --comment=N to post a comment, or --body=N to rewrite a card body.' };
  }
  const raw = comment ?? body;
  const number = Number(raw);
  if (!Number.isInteger(number) || number <= 0) {
    return { ok: false, error: `\`${raw}\` is not a card number. --${comment === null ? 'body' : 'comment'}=N takes the issue number.` };
  }
  return {
    ok: true,
    options: {
      mode: comment === null ? 'body' : 'comment',
      number,
      file: readOption(args, 'file'),
      repo: readOption(args, 'repo'),
      dryRun: args.includes('--dry-run'),
      json: args.includes('--json'),
    },
  };
}

// ---------------------------------------------------------------------------
// Live layer
// ---------------------------------------------------------------------------

async function rest(path, { method = 'GET', body = null } = {}) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      accept: 'application/vnd.github+json',
      ...(TOKEN ? { authorization: `Bearer ${TOKEN}` } : {}),
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (!res.ok) {
    const err = new Error(`${method} ${path} -> HTTP ${res.status}`);
    err.status = res.status;
    throw err;
  }
  if (res.status === 204) return null;
  return res.json();
}

async function writeArtefact(repo, options, body) {
  if (options.mode === 'comment') {
    const created = await rest(`/repos/${repo}/issues/${options.number}/comments`, { method: 'POST', body: { body } });
    const back = await rest(`/repos/${repo}/issues/comments/${created?.id}`);
    return { id: created?.id ?? null, url: back?.html_url ?? created?.html_url ?? null, writtenAt: back?.created_at ?? created?.created_at ?? null, stored: back?.body };
  }
  const patched = await rest(`/repos/${repo}/issues/${options.number}`, { method: 'PATCH', body: { body } });
  const back = await rest(`/repos/${repo}/issues/${options.number}`);
  return { id: options.number, url: back?.html_url ?? patched?.html_url ?? null, writtenAt: back?.updated_at ?? patched?.updated_at ?? null, stored: back?.body };
}

function reportPrerequisiteNotMet(err) {
  console.error(
    `\npost-stamped: PREREQUISITE NOT MET — ${err.message}\n\n` +
      `  Fix:  run this where node's fetch reaches api.github.com with a token that can write issues\n` +
      `        (a GitHub Actions runner, or an agent container with ${PROXY_FLAG} — this script re-execs\n` +
      '        itself with that flag when HTTPS_PROXY is set).\n\n' +
      '  NOTHING WAS WRITTEN, and nothing was read back. This is not a failed post and not a successful\n' +
      '  one — it is no act at all.\n' +
      `\n  (Exit code ${EXIT_PREREQUISITE_NOT_MET}, distinct from ${EXIT_REFUSED}'s "the body broke the stamp\n` +
      '  contract". Capture it BEFORE any pipe: `node scripts/pm/post-stamped.mjs … > /tmp/p.log 2>&1; echo "EXIT=$?"`.)',
  );
  return EXIT_PREREQUISITE_NOT_MET;
}

function readInput(file) {
  if (file) return readFileSync(file, 'utf8');
  return readFileSync(0, 'utf8');
}

function rearmThroughProxy(args) {
  const plan = proxyRearmPlan({
    env: process.env,
    execArgv: process.execArgv,
    flagSupported: process.allowedNodeEnvironmentFlags.has(PROXY_FLAG),
  });
  if (plan.hint) {
    console.error(`ℹ️  ${plan.reason}. A refusal below may be about the route, not this container.`);
    return null;
  }
  if (!plan.rearm) return null;
  if (process.env[PROXY_REARM_GUARD] === '1') return null;
  console.error(`ℹ️  re-exec with ${plan.flag}: ${plan.reason}.`);
  const quiet = process.allowedNodeEnvironmentFlags.has('--disable-warning') ? ['--disable-warning=UNDICI-EHPA'] : [];
  const child = spawnSync(process.execPath, [plan.flag, ...quiet, SELF_PATH, ...args], {
    stdio: 'inherit',
    env: { ...process.env, [PROXY_REARM_GUARD]: '1' },
  });
  if (typeof child.status === 'number') return child.status;
  console.error(`⚠️  could not re-exec with ${plan.flag} (${child.error?.message ?? 'no exit status'}); continuing in-process — every request will bypass the proxy.`);
  return null;
}

const USAGE = [
  'post-stamped — write a seat artefact to GitHub with a stamp this act read, never one typed from memory.',
  '',
  '  node scripts/pm/post-stamped.mjs --comment=N [--file=PATH] [--repo=OWNER/NAME] [--dry-run] [--json]',
  '  node scripts/pm/post-stamped.mjs --body=N    [--file=PATH] [--repo=OWNER/NAME] [--dry-run] [--json]',
  '  node scripts/pm/post-stamped.mjs --self-test',
  '',
  '  With no --file the body is read from stdin.',
  `  In the body: \`${STAMP_TOKEN}\` is the clock this run reads; \`{{WAS:YYYY-MM-DDThh:mmZ}}\` declares a`,
  '  stamp that is a reading of something else. A bare stamp on the opening line, or on a subscript',
  '  reading-time line, is REFUSED — that position belongs to the writing act. A quoted stamp LATER',
  '  than the clock this run reads is REFUSED too — the future is not a thing anyone read.',
  '  The attribution footer is the caller\'s: its form differs by channel and act, so this tool adds none.',
].join('\n');

async function main(argv) {
  if (argv.includes('--help') || argv.includes('-h')) {
    console.log(USAGE);
    return EXIT_OK;
  }
  const parsed = parseOptions(argv);
  if (!parsed.ok) {
    console.error(`post-stamped: ${parsed.error}`);
    return EXIT_USAGE;
  }
  const options = parsed.options;

  const repoRes = options.repo ? { repo: options.repo, source: '--repo', valid: /^[^/\s]+\/[^/\s]+$/.test(options.repo) } : resolveSweepRepo(process.env);
  if (!repoRes.valid) {
    console.error(
      `post-stamped: ${repoRes.source}=${JSON.stringify(repoRes.repo)} is not a repository in \`owner\`/\`name\` ` +
        'form. Refusing to fall back to a different board — an artefact posted onto the wrong repo is worse ' +
        'than one not posted.',
    );
    return EXIT_USAGE;
  }

  let input;
  try {
    input = readInput(options.file);
  } catch (err) {
    console.error(`post-stamped: could not read the body (${err.message}).`);
    return EXIT_USAGE;
  }

  const rendered = renderBody(input);
  if (!rendered.ok) {
    console.error(rendered.error);
    return EXIT_REFUSED;
  }

  if (options.dryRun) {
    console.error(
      `post-stamped: DRY RUN — nothing was written. ${rendered.substituted} token(s) substituted with ` +
        `\`${rendered.stamp}\`, ${rendered.quoted} quoted stamp(s) rendered verbatim. Target would be ` +
        `${repoRes.repo}#${options.number} (${options.mode}).`,
    );
    console.log(rendered.body);
    return EXIT_OK;
  }

  let written;
  try {
    written = await writeArtefact(repoRes.repo, options, rendered.body);
  } catch (err) {
    return reportPrerequisiteNotMet(err);
  }

  const verdict = readBackVerdict({
    stamp: rendered.stamp,
    writtenAt: written.writtenAt,
    sent: rendered.body,
    stored: written.stored,
    substituted: rendered.substituted,
  });

  if (options.json) {
    console.log(
      JSON.stringify(
        {
          repo: repoRes.repo,
          target: options.number,
          mode: options.mode,
          id: written.id,
          url: written.url,
          stamp: rendered.stamp,
          substituted: rendered.substituted,
          quoted: rendered.quoted,
          written_at: written.writtenAt,
          drift_minutes: verdict.drift,
          body_mutated: verdict.mutated,
        },
        null,
        2,
      ),
    );
    return EXIT_OK;
  }

  console.log(
    [
      `post-stamped: ${options.mode === 'comment' ? 'comment posted on' : 'body rewritten on'} ${repoRes.repo}#${options.number}`,
      `  ${options.mode === 'comment' ? 'comment' : 'card'}: ${written.id} ${written.url ?? '(no url returned)'}`,
      ...verdict.lines,
      `  substitutions: ${rendered.substituted} ${STAMP_TOKEN}, ${rendered.quoted} quoted`,
    ].join('\n'),
  );
  return EXIT_OK;
}

// ---------------------------------------------------------------------------
// --self-test — offline, no network, every branch above driven by fixtures.
//
// The battery ledger this self-test's floor is evaluated against: `battery()`
// opens one, every assertion is attributed to the one most recently opened, and
// a section that stops running names ITSELF at the floor rather than going
// quiet. The counts are a FLOOR, never an equality — adding cases is ordinary
// work and must not go red.
// ---------------------------------------------------------------------------

const SELF_TEST_BATTERIES = Object.freeze({
  'the token contract: the two spellings, and nothing else': 9,
  'the refusals: every route that must not reach the board': 20,
  'the direction check: a stamp no act can have read': 22,
  'the substitution: one clock, read once, written everywhere': 9,
  'the read-back: what the transcript can actually prove': 11,
  'the CLI: the one decision a typo must never make': 12,
  'the shared rule: this tool and H56 cannot come to disagree': 6,
});
const SELF_TEST_BATTERY_FLOOR = 7;
const UNATTRIBUTED_BATTERY = '(unattributed)';

let selfTestReachedVerdict = false;

export function selfTest() {
  const batterySeen = new Map();
  let openBattery = null;
  const battery = (name) => {
    openBattery = name;
  };
  const cases = [];
  const t = (name, ok, detail) => {
    const b = openBattery ?? UNATTRIBUTED_BATTERY;
    batterySeen.set(b, (batterySeen.get(b) ?? 0) + 1);
    cases.push({ name, ok: Boolean(ok), detail });
  };

  const NOW_MS = Date.parse('2026-09-10T06:37:48Z');
  const kinds = (text, ms) => stampRefusals(text, ms).map((r) => r.kind);

  battery('the token contract: the two spellings, and nothing else');
  t('the act-clock token is `{{NOW}}`', STAMP_TOKEN === '{{NOW}}');
  t('the clock renders in the protocol spelling — minutes, Z, no seconds', stampNow(NOW_MS) === '2026-09-10T06:37Z');
  t('…truncated, never rounded: 06:37:48 is still 06:37', stampNow(Date.parse('2026-09-10T06:37:48Z')) === stampNow(Date.parse('2026-09-10T06:37:02Z')));
  t('⛔ the quoted-token regex is NOT global — an exported `g` regex carries a cursor between callers', QUOTED_TOKEN_RE.global === false);
  t('⛔ …and neither is the leftover-token one', ANY_TOKEN_RE.global === false);
  t('masking a quoted stamp preserves the body length, so positions do not move', maskQuotedStamps('a {{WAS:2026-09-08T14:00Z}} b').length === 'a {{WAS:2026-09-08T14:00Z}} b'.length);
  t('…and leaves no stamp behind for the bare scan to find', protocolStamps(maskQuotedStamps('{{WAS:2026-09-08T14:00Z}}')).length === 0);
  t('the quoted values are readable on their own', quotedStampValues('x {{WAS:2026-09-08T14:00Z}} y')[0] === '2026-09-08T14:00Z');
  t('…and two of them are both read, not just the first', quotedStampValues('{{WAS:2026-09-08T14:00Z}} {{WAS:2026-09-09T01:00Z}}').length === 2);

  battery('the refusals: every route that must not reach the board');
  const OPENING = 'Claim: skills seat, session `session_x`, 2026-09-10T06:37Z — dispatched.';
  t('⭐ a bare stamp on the OPENING line is refused', kinds(OPENING).includes('positional'));
  t('…and the refusal names the position rather than guessing at meaning', stampRefusals(OPENING)[0].detail.includes('the opening line'));
  t('…and offers both legal spellings by name', stampRefusals(OPENING)[0].detail.includes('{{NOW}}') && stampRefusals(OPENING)[0].detail.includes('{{WAS:2026-09-10T06:37Z}}'));
  t('a bare stamp on a subscript reading-time line is refused', kinds('Seat post\n\n<sub>read 2026-09-10T06:37Z</sub>').includes('positional'));
  t('⭐ the same body with the token instead is ACCEPTED', stampRefusals('Claim: skills seat, {{NOW}} — dispatched.').length === 0);
  t('⭐ MIXED — the token plus a bare stamp elsewhere is refused', kinds('Claim: {{NOW}}\n\nThe board was read at 2026-09-08T14:00Z.').includes('mixed'));
  t('…and the mixed refusal says a reader cannot tell the two clocks apart', stampRefusals('Claim: {{NOW}}\n\nread 2026-09-08T14:00Z').find((r) => r.kind === 'mixed').detail.includes('a reader cannot tell which'));
  t('⛔ a bare stamp in PROSE with no token is NOT refused — quoting a ruling is a reading of something else', stampRefusals('Title\n\nThe 2026-09-08T14:00Z ruling stands.').length === 0);
  t('a DECLARED quoted stamp is accepted even in the opening position', stampRefusals('The {{WAS:2026-09-08T14:00Z}} ruling stands.').length === 0);
  t('…and beside a token, which is the whole point of the declaration', stampRefusals('Verdict {{NOW}} — on the board read {{WAS:2026-09-08T14:00Z}}.').length === 0);
  t('⛔ the quoted route is not a free-text escape: a non-stamp value is refused', kinds('{{WAS:yesterday}}').includes('quoted-not-a-stamp'));
  t('⛔ …nor a smuggling route: a stamp with prose glued on is refused', kinds('{{WAS:2026-09-08T14:00Z ruling}}').includes('quoted-not-a-stamp'));
  t('surrounding whitespace inside the declaration is tolerated', stampRefusals('{{WAS: 2026-09-08T14:00Z }}').length === 0);
  t('a mistyped token is refused rather than posted literally', renderBody('Claim: {{now}} — dispatched.', NOW_MS).kind === 'unknown-token');
  t('…and the refusal names the survivor so the typo is findable', renderBody('Claim: {{now}}', NOW_MS).error.includes('{{now}}'));
  t('…and says why the quiet direction is the dangerous one', renderBody('Claim: {{now}}', NOW_MS).error.includes('leave the artefact unstamped'));
  t('an EMPTY body is refused — an empty artefact is noise a reader must judge', renderBody('   \n\n', NOW_MS).kind === 'empty');
  t('every refusal reaches the caller as text naming the two spellings', refusalText(stampRefusals(OPENING)).includes('{{WAS:YYYY-MM-DDThh:mmZ}}'));
  t('…and states that no flag turns the contract off', refusalText(stampRefusals(OPENING)).includes('There is no flag'));
  t('…and that nothing was written', refusalText(stampRefusals(OPENING)).includes('Nothing was written'));

  // The clock this act holds is 06:37:48 — so 06:37Z is the minute it is IN,
  // 06:38Z the first minute it has not reached, and 06:51Z sits 14 minutes
  // ahead, inside H56's drift tolerance and still not a thing anyone read.
  battery('the direction check: a stamp no act can have read');
  const CARD_REPRO = 'Verdict {{NOW}} — on the board read {{WAS:2099-01-01T00:00Z}}.';
  t('⭐ the filed repro: a 2099 quoted stamp is REFUSED, not rendered verbatim', kinds(CARD_REPRO, NOW_MS).includes('quoted-in-the-future'));
  t('…and the refusal names the clock it was judged against', stampRefusals(CARD_REPRO, NOW_MS)[0]?.detail?.includes('2026-09-10T06:37Z') === true);
  t('…and says a time that has not happened is not a reading of anything', stampRefusals(CARD_REPRO, NOW_MS)[0]?.detail?.includes('provably not a reading of anything') === true);
  t('⭐ …so the whole body is refused and NOTHING is rendered', renderBody(CARD_REPRO, NOW_MS).ok === false && renderBody(CARD_REPRO, NOW_MS).body === undefined);
  t('⛔ a PAST quoted stamp is untouched — the route this closes is one direction only', renderBody('Verdict {{NOW}} — on the board read {{WAS:2026-09-08T14:00Z}}.', NOW_MS).body?.includes('board read 2026-09-08T14:00Z.') === true);
  t('⭐ BOUNDARY: a stamp equal to the act\'s OWN minute is ACCEPTED — a reading taken inside 06:37 is spelled 06:37Z', stampRefusals('read {{WAS:2026-09-10T06:37Z}}', NOW_MS).length === 0);
  t('⭐ …and the first minute the clock has NOT reached is refused', kinds('read {{WAS:2026-09-10T06:38Z}}', NOW_MS).includes('quoted-in-the-future'));
  t('…the acceptance opens ON the tick: a clock standing exactly at 06:37:00 accepts 06:37Z', stampRefusals('read {{WAS:2026-09-10T06:37Z}}', Date.parse('2026-09-10T06:37:00Z')).length === 0);
  t('…and one millisecond before it does not — the span must have STARTED, not be about to', kinds('read {{WAS:2026-09-10T06:37Z}}', Date.parse('2026-09-10T06:37:00Z') - 1).includes('quoted-in-the-future'));
  t('⛔ no forward skew window: 14 minutes ahead is refused though H56 tolerates 14 minutes of DRIFT', kinds('read {{WAS:2026-09-10T06:51Z}}', NOW_MS).includes('quoted-in-the-future') && H56_STAMP_TOLERANCE_MIN === 15);
  t('the grain is the stamp\'s own: 06:37:49Z is one second ahead of 06:37:48 and is refused', kinds('read {{WAS:2026-09-10T06:37:49Z}}', NOW_MS).includes('quoted-in-the-future'));
  t('…while the same instant spelled to the minute is not', stampRefusals('read {{WAS:2026-09-10T06:37Z}}', NOW_MS).length === 0);
  t('⛔ a shape failure is NOT also filed as a direction one — one typo, one refusal', kinds('{{WAS:2099-01-01T00:00Z ruling}}', NOW_MS).join() === 'quoted-not-a-stamp');
  t('…and the shape refusals still fire, unchanged', kinds('{{WAS:yesterday}}', NOW_MS).includes('quoted-not-a-stamp'));
  t('an unreadable value is nobody\'s idea of the future', stampIsFuture('yesterday', NOW_MS) === false);
  t('⭐ the `{{NOW}}` route is untouched: a token-only body still renders on this act\'s clock', renderBody('Claim: {{NOW}} — dispatched.', NOW_MS).body === 'Claim: 2026-09-10T06:37Z — dispatched.');
  const POSITIONAL_FUTURE = 'Claim: skills seat, 2099-01-01T00:00Z — dispatched.';
  t('⭐ the POSITIONAL refusal stops handing a future estimate back through the quoted route', stampRefusals(POSITIONAL_FUTURE, NOW_MS)[0]?.detail?.includes('{{WAS:2099-01-01T00:00Z}}') === false);
  t('…and says instead that the stamp is later than the clock this act holds', stampRefusals(POSITIONAL_FUTURE, NOW_MS)[0]?.detail?.includes('later than the clock this act holds') === true);
  t('…while a PAST typed stamp is still offered the quoted route, which is the whole control', stampRefusals(OPENING, NOW_MS)[0]?.detail?.includes('{{WAS:2026-09-10T06:37Z}}') === true);
  const MIXED_FUTURE = 'Claim: {{NOW}}\n\nThe board was read at 2099-01-01T00:00Z.';
  t('the MIXED refusal likewise stops offering a route that would refuse it', stampRefusals(MIXED_FUTURE, NOW_MS).find((r) => r.kind === 'mixed')?.detail?.includes('{{WAS:2099-01-01T00:00Z}}') === false);
  t('…and a past bare stamp keeps the declaration on offer', stampRefusals('Claim: {{NOW}}\n\nread 2026-09-08T14:00Z', NOW_MS).find((r) => r.kind === 'mixed')?.detail?.includes('{{WAS:2026-09-08T14:00Z}}') === true);
  t('⛔ the clock defaults to Date.now() rather than to "no judgement" when a caller omits it', stampRefusals('read {{WAS:2099-01-01T00:00Z}}').map((r) => r.kind).includes('quoted-in-the-future'));

  battery('the substitution: one clock, read once, written everywhere');
  const TWO = renderBody('Claim: {{NOW}}\n\nRound opened {{NOW}}.', NOW_MS);
  t('a body that clears the contract renders', TWO.ok === true);
  t('⭐ two tokens get the SAME stamp — one clock, read once', TWO.body.split('2026-09-10T06:37Z').length - 1 === 2);
  t('…counted for the transcript', TWO.substituted === 2);
  t('…and the stamp is the clock handed in, never a second read', TWO.stamp === '2026-09-10T06:37Z');
  const QUOTED = renderBody('Verdict {{NOW}} on the board read {{WAS:2026-09-08T14:00Z}}.', NOW_MS);
  t('a quoted stamp renders VERBATIM', QUOTED.body.includes('board read 2026-09-08T14:00Z.'));
  t('…counted apart from the substituted ones', QUOTED.quoted === 1 && QUOTED.substituted === 1);
  t('nothing else in the body moves', renderBody('# Title\n\n- a\n- b\n', NOW_MS).body === '# Title\n\n- a\n- b\n');
  t('a body with no token at all is still postable', renderBody('os-dev-report\n\n{"issue": 17314}', NOW_MS).ok === true);
  t('…and reports zero substitutions rather than pretending to a clock', renderBody('os-dev-report', NOW_MS).substituted === 0);

  battery('the read-back: what the transcript can actually prove');
  const SENT = 'Claim: 2026-09-10T06:37Z';
  const ON_TIME = readBackVerdict({ stamp: '2026-09-10T06:37Z', writtenAt: '2026-09-10T06:37:48Z', sent: SENT, stored: SENT, substituted: 1 });
  t('⭐ a stamp inside the minute the platform stored it reads as ZERO drift', ON_TIME.drift === 0);
  t('…said in one line a transcript carries', ON_TIME.lines[0].includes('one clock, one act'));
  t('…and the bytes are compared, not assumed', ON_TIME.lines[1].includes('IDENTICAL to what was sent'));
  const LATE = readBackVerdict({ stamp: '2026-09-10T05:27Z', writtenAt: '2026-09-10T06:37:48Z', sent: SENT, stored: SENT, substituted: 1 });
  t('⭐ a stamp 70 minutes from its own write is loud', LATE.drift === 70);
  t('…and names the patrol that will file it', LATE.lines[0].includes('H56 will file this artefact'));
  t('a drift inside the tolerance says so instead', readBackVerdict({ stamp: '2026-09-10T06:30Z', writtenAt: '2026-09-10T06:37:48Z', sent: SENT, stored: SENT, substituted: 1 }).lines[0].includes('within the'));
  t('an unreadable write time is NOT MEASURED, never zero drift', readBackVerdict({ stamp: '2026-09-10T06:37Z', writtenAt: null, sent: SENT, stored: SENT, substituted: 1 }).lines[0].includes('NOT MEASURED'));
  t('…and its drift is null rather than a number', readBackVerdict({ stamp: '2026-09-10T06:37Z', writtenAt: null, sent: SENT, stored: SENT, substituted: 1 }).drift === null);
  t('a body with no substitution claims no clock', readBackVerdict({ stamp: '2026-09-10T06:37Z', writtenAt: '2026-09-10T06:37:48Z', sent: SENT, stored: SENT, substituted: 0 }).lines[0].includes('no clock to check'));
  t('⭐ a body the platform MUTATED is reported, not assumed identical', readBackVerdict({ stamp: '2026-09-10T06:37Z', writtenAt: '2026-09-10T06:37:48Z', sent: SENT, stored: `${SENT} x`, substituted: 1 }).mutated === true);
  t('…and the sanitizer is named as the thing to go read about', readBackVerdict({ stamp: '2026-09-10T06:37Z', writtenAt: '2026-09-10T06:37:48Z', sent: SENT, stored: `${SENT} x`, substituted: 1 }).lines[1].includes('sanitizer'));
  t('an unreadable stored body is UNVERIFIED, never verified', readBackVerdict({ stamp: '2026-09-10T06:37Z', writtenAt: '2026-09-10T06:37:48Z', sent: SENT, stored: undefined, substituted: 1 }).lines[1].includes('UNVERIFIED'));

  battery('the CLI: the one decision a typo must never make');
  t('a comment target parses', parseOptions(['--comment=17314']).options.mode === 'comment');
  t('…with the number read as a number', parseOptions(['--comment=17314']).options.number === 17314);
  t('a body target parses', parseOptions(['--body=17314']).options.mode === 'body');
  t('⛔ both targets at once is refused — they are two different acts', parseOptions(['--comment=1', '--body=2']).ok === false);
  t('⛔ no target at all is refused, never defaulted', parseOptions([]).ok === false);
  t('⛔ a non-numeric target is refused rather than coerced', parseOptions(['--comment=seventeen']).ok === false);
  t('⛔ a zero or negative target is refused', parseOptions(['--comment=0']).ok === false);
  t('⛔ an unknown flag is a typo and is refused', parseOptions(['--comment=1', '--wrte']).ok === false);
  t('…and the refusal lists what the tool does take', parseOptions(['--comment=1', '--wrte']).error.includes('--dry-run'));
  t('--dry-run is carried through', parseOptions(['--comment=1', '--dry-run']).options.dryRun === true);
  t('--json is carried through', parseOptions(['--comment=1', '--json']).options.json === true);
  t('--repo and --file are read as values, not flags', parseOptions(['--comment=1', '--repo=o/n', '--file=b.md']).options.repo === 'o/n');

  battery('the shared rule: this tool and H56 cannot come to disagree');
  t('⭐ the positions this tool refuses are the ones H56 reads — one imported reader, never two', h56StampedReadings(maskQuotedStamps(OPENING)).length === 1);
  t('⭐ …so a body this tool accepts leaves H56 nothing in those positions', h56StampedReadings(maskQuotedStamps(TWO.body.replace(/2026-09-10T06:37Z/g, '{{NOW}}'))).length === 0);
  t('the tolerance is the imported constant, never a second number', H56_STAMP_TOLERANCE_MIN === 15);
  t('a stamp this tool substitutes is zero-drift against its own write instant', stampDriftMinutes(stampNow(NOW_MS), '2026-09-10T06:37:48Z') === 0);
  t('…and an estimate is beyond the tolerance by the same arithmetic', stampDriftMinutes('2026-09-10T05:27Z', '2026-09-10T06:37:48Z') > H56_STAMP_TOLERANCE_MIN);
  t('the exit register keeps a contract refusal apart from a transport failure', EXIT_REFUSED !== EXIT_PREREQUISITE_NOT_MET);

  // The floor, evaluated last: a battery that stops running names itself here.
  const failed = cases.filter((c) => !c.ok);
  for (const c of cases) console.log(`  ${c.ok ? '✓' : '✗'} ${c.name}`);
  const declared = Object.keys(SELF_TEST_BATTERIES);
  const floorFailures = [];
  const floorFailure = (text) => floorFailures.push(text);
  if (declared.length < SELF_TEST_BATTERY_FLOOR) {
    floorFailure(`the battery ledger declares ${declared.length} batteries, below its floor of ${SELF_TEST_BATTERY_FLOOR} — a section that stopped being declared is a section nothing floors.`);
  }
  for (const [name, count] of batterySeen) {
    if (!(name in SELF_TEST_BATTERIES)) {
      floorFailure(`self-test battery "${name}" registered ${count} case(s) but is not declared in SELF_TEST_BATTERIES — an assertion attributed to no declared battery is one nothing floors.`);
    }
  }
  for (const name of declared) {
    const count = batterySeen.get(name) ?? 0;
    if (count >= SELF_TEST_BATTERIES[name]) continue;
    floorFailure(
      count === 0
        ? `self-test battery "${name}" DID NOT RUN — 0 cases registered, ${SELF_TEST_BATTERIES[name]} pinned. The verdict below would have claimed those cases hold.`
        : `self-test battery "${name}" registered ${count} case(s), below its pinned floor of ${SELF_TEST_BATTERIES[name]} — cases that used to run no longer do.`,
    );
  }
  for (const text of floorFailures) console.error(`  ✗ ${text}`);
  if (failed.length > 0 || floorFailures.length > 0) {
    for (const c of failed) console.error(`  ✗ ${c.name}${c.detail ? ` (${c.detail})` : ''}`);
    console.error(`✗ post-stamped self-test: ${failed.length} of ${cases.length} case(s) failed, ${floorFailures.length} floor problem(s).`);
    selfTestReachedVerdict = true;
    return 1;
  }
  console.log(`✓ post-stamped self-test: ${cases.length} cases pass across ${declared.length} batteries — offline, no network, no token.`);
  selfTestReachedVerdict = true;
  return 0;
}

if (isEntrypoint(import.meta.url)) {
  if (process.argv.includes('--self-test')) {
    const code = selfTest();
    if (!selfTestReachedVerdict) {
      console.error(
        '\n✗ post-stamped self-test: selfTest() returned without reaching its verdict, so no success\n' +
          'line was printed. Exiting 0 here would report a self-test that never finished as a self-test\n' +
          'that passed.\n',
      );
      process.exit(1);
    }
    process.exit(code);
  } else {
    // ⛔ Not on a dry run: that path makes no request, so re-execing it would
    // spawn a second process to prove a route nothing is about to use.
    const rearmed = process.argv.includes('--dry-run') ? null : rearmThroughProxy(process.argv.slice(2));
    if (rearmed !== null) process.exit(rearmed);
    main(process.argv.slice(2)).then((code) => process.exit(code));
  }
}
