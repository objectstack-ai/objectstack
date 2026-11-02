#!/usr/bin/env node
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * mailbox-open — open (or close) a seat's mailbox PR (#25417; keyed by the seat, not the login, since #27637).
 *
 *   node scripts/pm/mailbox-open.mjs --repo owner/name --seat <seat> --login <login> [--base main] [--dry-run] [--json]
 *   node scripts/pm/mailbox-open.mjs --repo owner/name --seat <seat> --login <login> --head <branch> [--dry-run]
 *   node scripts/pm/mailbox-open.mjs --repo owner/name --close <n> [--dry-run]
 *   node scripts/pm/mailbox-open.mjs --self-test          # offline, no network, no git
 *
 * ## What a mailbox PR is, and why it is a PR
 *
 * A Claude Code project is single-account, and the only bus every account
 * shares is GitHub. A comment on a pull request wakes the session subscribed
 * to it — measured on #25392: a relay comment woke the subscribed thread in
 * ~70 s, a comment from a second account in 4 s. An issue comment wakes
 * nothing. So each SEAT — a lane seat, the triage seat, the director seat —
 * keeps ONE draft PR as its mailbox: labelled `pm:mailbox` and `pinned`, on
 * the branch `mailbox/<login>/<seat-slug>` (`mailbox/os-bill/ui-4` for the
 * seat `domain:ui#4` held by `os-bill`; an epic seat opens one like any seat),
 * its body's first line
 * `Mailbox-of: <seat> · <login>`, opened at seating and subscribed by the
 * seated session, ⛔ never merged, closed at hand-over or account switch (the
 * successor opens its own). A message on it is ONE comment: the line
 * `To: <seat>`, then ONE line opening with one of the doorbell keys
 * (`Request:` / `Notify:`), read by `record-recognisers.mjs`. The protocol
 * text — the keys, who sends what to whom — is the pm-dispatch skill's
 * `references/project-forms.md` 〈信箱 PR〉; this file is only the tooling.
 *
 * ## The key is the seat, never the login
 *
 * One account routinely holds several seats — on 2026-10-29 one login held two
 * `domain:server` seats and `domain:ui#1` behind ONE mailbox, and another held
 * three `domain:ui` seats and none — while the platform delivers a PR's events
 * to one subscribed session at a time: a second session's subscription
 * succeeds and then hears nothing while the first holds the PR. A mailbox keyed
 * by login therefore wakes one of its account's seats, the others never hear,
 * and nothing tells the sender or the recipient. An earlier version of this
 * header argued that a login holds one seat at a time, so a per-login refusal
 * was a per-seat one; the board falsified that premise, and nothing here reads
 * a login as a seat any more.
 *
 * A seat is spelled `LANE#N` — `domain:ui#4`, `repo:cloud#1`, `triage`,
 * `epic:#27293#1` — its lane one of the four a seat post's title names
 * (`domain:<x>`, `repo:<x>`, `triage`, `director`) or the epic lane
 * `epic:#<parent>`, the seat signature's spelling for the PM delegated a
 * `pm:epic` parent card (pm-dispatch `seat-lifecycle.md` 〈Epic 子树车道〉), so a
 * login never reads as a seat, and an absent number read as seat 1
 * (`seatKey`). It is compared lower-cased and written canonically with its
 * number (`triage#1`, `epic:#12#1`). Its SLUG is that key as one ref segment,
 * because a ref cannot carry `:` or `#`: the default `domain:` kind dropped,
 * every other `:` (with the epic lane's `#` after it) and the seat's `#` turned
 * into `-` (`ui-4`, `repo-cloud-1`, `triage-1`, `epic-27293-1`). No `domain:`
 * lane may be named `triage`, `director`, `repo-…` or `epic-…` — `seatKey`
 * refuses one — which keeps the slug one-to-one.
 *
 * ## What it does, in order (open)
 *
 *   ① READ the open pulls and REFUSE (exit 4) when one already carries
 *      `pm:mailbox` for this SEAT, whichever login holds it — by the seat on
 *      the body's `Mailbox-of:` line or by a head `mailbox/<login>/<slug>`
 *      (`mailboxOwner`). A second seat under the same login opens freely. A
 *      legacy per-login mailbox (head `mailbox/<login>`, or a body opening
 *      `To: <login>`) names no seat, so it blocks nothing; the open prints it,
 *      so that the account closes it once each of its seats holds its own.
 *   ② the BRANCH. Default: one empty commit on `origin/<base>` (`git
 *      commit-tree` of the base's own tree — no checkout, no index, no working
 *      tree touched), pushed as `mailbox/<login>/<slug>` through `with-fleet.sh
 *      --kind 'git push'`, the write gate every push goes through. ⚠️ A legacy
 *      branch `mailbox/<login>` blocks that push: git refuses a ref nested
 *      under an existing ref (measured 2026-10-30 on a local bare repository:
 *      `failed to update ref`), so the legacy branch is deleted after its
 *      mailbox closes. The relay has no ref-creating op, so a cloud seat
 *      container cannot do this step: with-fleet refuses there (exit 3) and
 *      nothing else is sent. `--head <branch>` names a branch that already
 *      exists instead (a thread's own pushed branch, as #25392 used) and skips
 *      the push; it must be ahead of `<base>`, because GitHub refuses a pull
 *      with no commits.
 *   ③ ONE relay stroke: `pr_create` (draft is forced by the relay) with labels
 *      `pm:mailbox`, `pinned` and `skip-changeset`, sent through
 *      `fleet-write/dispatch.mjs` as `objectstack-fleet[bot]`. `pinned` is
 *      `stale.yml`'s `exempt-pr-labels` entry (`pm:mailbox` is not one), so
 *      without it a quiet mailbox is marked stale after 30 days and closed 7
 *      days later. ⚠️ Measured 2026-10-28: the `pinned` label does not EXIST
 *      on objectstack-ai/objectstack (`GET /labels/pinned` → 404, as does
 *      `work-in-progress`; only `security` of the three exists), so the first
 *      open reads its label set back — the labels leg POSTs the name, and
 *      whether the platform creates a missing label there is a reading that
 *      open takes, not one this header asserts. `ensure-pm-labels.sh` is where
 *      a label the fleet relies on is created.
 *   ④ READ the new pull's number back off its head and print it — the number
 *      `subscribe_pr_activity` takes.
 *
 * `--close <n>` reads the pull first and REFUSES (exit 4) unless it is open
 * and carries `pm:mailbox`, so a mistyped number can never close a real PR;
 * then one stroke: the closing `comment` and `issue_patch state: closed`.
 *
 * ## CI on an empty diff — exempt where a label can exempt it, red by design elsewhere
 *
 * `Check Changeset` is the one check measured red on #25392's empty diff, and
 * the `changeset-check` job already skips WHOLESALE on `skip-changeset` (the
 * label for a diff that publishes nothing — which an empty commit is). Any
 * other check that reddens on a mailbox is RED BY DESIGN, and the body this
 * file writes says so, so a subscribed thread under drive-to-green rules
 * reads the exemption on the PR itself.
 *
 * ## Ledgers exclude it
 *
 * A mailbox is an open `head:`-filtered PR that will never land, so every
 * query that enumerates open PRs for LANDING appends `LEDGER_EXCLUSION`
 * (exported below for the readers to import, never retyped). Measured
 * 2026-10-23: no script under `scripts/pm/` enumerates open PRs for landing
 * today; `board-snapshot.mjs` counts every open pull for its archive
 * arithmetic, where a mailbox MUST be counted, so it is deliberately not one.
 *
 * ## `--dry-run`
 *
 * Offline: no read, no git, no dispatch. It prints the plan and the actions
 * file exactly as the relay would receive it, judged by the relay's own
 * validator first, so a refused stroke is refused here too (exit 2).
 *
 * ## Exit codes
 *
 *   0   done (or a dry run printed); the PR number is printed.
 *   2   usage, or the validator refused the stroke. Nothing was sent.
 *   3   prerequisite: a read failed, `git` failed, or with-fleet refused the push.
 *   4   refused on the board's state: a mailbox already open (open), or the
 *       pull is not an open `pm:mailbox` PR (close). Nothing was sent.
 *   5+  the relay's own exit (`fleet-write/dispatch.mjs` ladder), passed through.
 */

import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { isEntrypoint } from '../invoked-as.mjs';
import { validateStroke } from './fleet-write/validate.mjs';
import { ghApi, PER_PAGE, readAllPages } from './gh-pages.mjs';

const SELF_PATH = fileURLToPath(import.meta.url);
const PM_DIR = dirname(SELF_PATH);
const REPO_ROOT = join(PM_DIR, '..', '..');

export const EXIT_OK = 0;
export const EXIT_USAGE = 2;
export const EXIT_PREREQUISITE = 3;
export const EXIT_REFUSED = 4;

export const MAILBOX_LABEL = 'pm:mailbox';
/** Appended to every search query that enumerates open PRs for landing. */
export const LEDGER_EXCLUSION = `-label:${MAILBOX_LABEL}`;
export const MAILBOX_BRANCH_PREFIX = 'mailbox/';
/** The stale sweep's exemption label (`.github/workflows/stale.yml` `exempt-pr-labels`); a mailbox is quiet by design. */
export const STALE_EXEMPT_LABEL = 'pinned';
const PR_LABELS = Object.freeze([MAILBOX_LABEL, STALE_EXEMPT_LABEL, 'skip-changeset']);

const REPO_SHAPE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
// GitHub's own login rule: alphanumerics and single inner hyphens, ≤ 39.
const LOGIN_SHAPE = /^[A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38}$/;
const BRANCH_SHAPE = /^(?!\/|.*\/\/|.*\.\.|.*[\s~^:?*[\\]|.*\.lock$|.*\/$)[A-Za-z0-9._/-]+$/;
const SESSION_SHAPE = /^(?:session|cse)_[A-Za-z0-9]+$/;
// A seat: its lane — `domain:<x>`, `repo:<x>`, `triage`, `director`, the four a seat post's title names, or the
// epic lane `epic:#<parent>` — then `#N`; absent = seat 1. Read lower-cased. The bare lanes are a closed pair, so a
// login is never read as a seat. The lists below are the ONE spelling of those lane words: the shape is built from
// them, and so is the reserved set a `domain:` lane may not be named after (`seatKey`).
/** The lane kinds that carry a name after the colon: `domain:<x>`, `repo:<x>`. `domain` is the default kind the slug drops. */
export const SEAT_LANE_KINDS = Object.freeze(['domain', 'repo']);
/** The bare lanes, a closed pair: `triage`, `director`. */
export const SEAT_BARE_LANES = Object.freeze(['triage', 'director']);
/** The epic lane's kind: `epic:#<parent>` names the `pm:epic` parent card's number, never a word (`epic:#27293#1`). */
export const SEAT_EPIC_KIND = 'epic';
const SEAT_SHAPE = new RegExp(`^((?:${SEAT_LANE_KINDS.join('|')}):[a-z0-9._-]+|${SEAT_EPIC_KIND}:#[1-9][0-9]*|${SEAT_BARE_LANES.join('|')})(?:#([1-9][0-9]*))?$`);
// What a `domain:` lane may NOT be named, so the slug stays one-to-one (header): a bare lane word (`domain:triage`
// would slug to `triage-1`, the triage seat's), or another kind's name with its colon turned into the hyphen the slug
// uses (`domain:repo-cloud` would slug to `repo-cloud-1`, `repo:cloud#1`'s; `domain:epic-12` to `epic-12-1`, `epic:#12#1`'s).
const RESERVED_DOMAIN_LANE = new RegExp(`^(?:(?:${SEAT_BARE_LANES.join('|')})$|(?:${[...SEAT_LANE_KINDS.filter((k) => k !== 'domain'), SEAT_EPIC_KIND].join('|')})-)`);
/** A per-seat mailbox body's first line, `Mailbox-of: <seat> · <login>`. */
const MAILBOX_OF_LINE = /^Mailbox-of:[ \t]*(\S+)[ \t]*·[ \t]*(\S+)$/;
/** The first lines a legacy per-login mailbox opened with: `To: <login>` (this file's), `Mailbox-of: <login>`. */
const LEGACY_OWNER_LINE = /^(?:To|Mailbox-of):[ \t]*(\S+)$/;

/**
 * A seat spelled `LANE#N` → `{ key, slug }`, or null when it is not one. `key` is canonical — lower case, the
 * number always spelled (`triage` → `triage#1`); `slug` is the key as one ref segment (header). A `domain:` lane
 * named after a reserved lane word (`domain:triage`, `domain:repo-cloud`) is not a seat either: its slug would be
 * another seat's, and the header's one-to-one promise is kept here, not assumed. This is the fleet's ONE seat
 * grammar — the mailbox `To:` line and the doorbell keys' `LANE#N` fields read with it, never a second shape. Pure.
 */
export function seatKey(text) {
  const m = SEAT_SHAPE.exec(String(text ?? '').trim().toLowerCase());
  if (!m) return null;
  if (m[1].startsWith('domain:') && RESERVED_DOMAIN_LANE.test(m[1].slice('domain:'.length))) return null;
  const n = m[2] ?? '1';
  return { key: `${m[1]}#${n}`, slug: `${m[1].replace(/^domain:/, '').replace(/:#?/g, '-')}-${n}` };
}

/** `mailbox/<login>/<seat-slug>`; `seat` is a `seatKey` reading. */
export const mailboxBranch = (login, seat) => `${MAILBOX_BRANCH_PREFIX}${login}/${seat.slug}`;

// ---------------------------------------------------------------------------
// The pure core
// ---------------------------------------------------------------------------

export function parseArgs(argv) {
  const opts = { repo: null, seat: null, login: null, head: null, base: 'main', close: null, dryRun: false, json: false, selfTest: false, help: false, errors: [] };
  const args = [...argv];
  const value = (flag) => {
    const v = args.shift();
    if (v === undefined || v.startsWith('--')) {
      opts.errors.push(`${flag} needs a value`);
      return null;
    }
    return v;
  };
  while (args.length) {
    const a = args.shift();
    if (a === '--help' || a === '-h') opts.help = true;
    else if (a === '--self-test') opts.selfTest = true;
    else if (a === '--dry-run') opts.dryRun = true;
    else if (a === '--json') opts.json = true;
    else if (a === '--repo') opts.repo = value(a);
    else if (a === '--seat') opts.seat = value(a);
    else if (a === '--login') opts.login = value(a);
    else if (a === '--head') opts.head = value(a);
    else if (a === '--base') opts.base = value(a);
    else if (a === '--close') {
      const v = value(a);
      if (v !== null) opts.close = /^[1-9][0-9]*$/.test(v) ? Number(v) : NaN;
    } else opts.errors.push(`unrecognised argument \`${a}\``);
  }
  if (opts.help || opts.selfTest) return opts;
  if (!opts.repo) opts.errors.push('--repo owner/name is required');
  else if (!REPO_SHAPE.test(opts.repo)) opts.errors.push(`--repo ${JSON.stringify(opts.repo)} is not shaped owner/name`);
  if (opts.close !== null) {
    if (Number.isNaN(opts.close)) opts.errors.push('--close takes a pull number');
    if (opts.head !== null) opts.errors.push('--close takes no --head');
    if (opts.seat !== null) opts.errors.push('--close takes no --seat');
  } else {
    const seat = opts.seat === null ? null : seatKey(opts.seat);
    if (!opts.seat) opts.errors.push('--seat <seat> is required to open a mailbox — the mailbox is the seat\'s, never the login\'s');
    else if (!seat) opts.errors.push(`--seat ${JSON.stringify(opts.seat)} is not a seat — spell it LANE#N, e.g. domain:ui#4 or epic:#27293#1`);
    if (!opts.login) opts.errors.push('--login <login> is required to open a mailbox');
    else if (!LOGIN_SHAPE.test(opts.login)) opts.errors.push(`--login ${JSON.stringify(opts.login)} is not a GitHub login`);
    else if (seat && opts.head === null && !BRANCH_SHAPE.test(mailboxBranch(opts.login, seat))) opts.errors.push(`the seat's branch ${JSON.stringify(mailboxBranch(opts.login, seat))} is not a legal ref`);
    if (opts.head !== null && !BRANCH_SHAPE.test(opts.head)) opts.errors.push(`--head ${JSON.stringify(opts.head)} is not a branch name`);
    if (opts.base !== null && !BRANCH_SHAPE.test(opts.base)) opts.errors.push(`--base ${JSON.stringify(opts.base)} is not a branch name`);
  }
  return opts;
}

/** The footer in the form a PR BODY keeps (AGENTS.md): session-URL when the session is known. */
export function bodyFooter(session) {
  const id = typeof session === 'string' && SESSION_SHAPE.test(session) ? session.replace(/^cse_/, 'session_') : null;
  return `\n\n---\n_Generated by [Claude Code](https://claude.ai/code${id ? `/${id}` : ''})_`;
}

/** `seat` is the canonical key (`seatKey(...).key`). */
export function mailboxBody({ seat, login, session = null }) {
  return [
    `Mailbox-of: ${seat} · ${login}`,
    '',
    `The mailbox of the seat \`${seat}\`, held by \`${login}\` (\`${MAILBOX_LABEL}\`): one per seat, opened at seating, subscribed by the seated session.`,
    '',
    '- ⛔ Never merged, never readied. Closed at hand-over or account switch: `node scripts/pm/mailbox-open.mjs --close N` (N = this number); the successor opens its own.',
    `- A message is ONE comment: the line \`To: ${seat}\`, then ONE line opening with one of the doorbell keys (\`Request:\` / \`Notify:\`; pm-dispatch \`references/project-forms.md\` 〈信箱 PR〉; full spellings: \`node scripts/pm/record-recognisers.mjs --mailbox-keys\`): one event, keys and numbers only. Nothing else is allowed here — no acknowledgements, no re-sends.`,
    `- **CI: owes none.** \`skip-changeset\` exempts Check Changeset; any other check red on this empty diff is RED BY DESIGN — never fix, rerun or report it. \`${STALE_EXEMPT_LABEL}\` keeps the stale sweep off it.`,
    `- Excluded from every landing ledger: queries add \`${LEDGER_EXCLUSION}\`.`,
  ].join('\n') + bodyFooter(session);
}

export function planOpen({ repo, seat, login, head = null, base = 'main', session = null }) {
  const s = seatKey(seat);
  if (!s) return { kind: 'open', repo, seat: null, login, branch: head, base, push: false, actions: [], errors: [`${JSON.stringify(seat)} is not a seat`] };
  const branch = head ?? mailboxBranch(login, s);
  const actions = [
    { op: 'pr_create', title: `pm:mailbox — ${s.key} · ${login}`, head: branch, base, body: mailboxBody({ seat: s.key, login, session }), labels: [...PR_LABELS] },
  ];
  return { kind: 'open', repo, seat: s, login, branch, base, push: head === null, actions, errors: validateStroke(repo, actions) };
}

export function planClose({ repo, pull }) {
  const actions = [
    { op: 'comment', issue: pull, body: 'Mailbox closed: the seat handed over or switched account. The successor opens its own with `scripts/pm/mailbox-open.mjs`.\n\n---\n_Generated by [Claude Code](https://claude.ai/code)_' },
    { op: 'issue_patch', issue: pull, state: 'closed' },
  ];
  return { kind: 'close', repo, pull, actions, errors: validateStroke(repo, actions) };
}

const labelNames = (pr) => (Array.isArray(pr?.labels) ? pr.labels.map((l) => (typeof l === 'string' ? l : l?.name)) : []);
const firstLine = (text) => String(text ?? '').split(/\r?\n/).find((l) => l.trim() !== '')?.trim() ?? '';

/**
 * Whose mailbox a pull is — `{ seat, slug, login }` — or null when it carries no `pm:mailbox`. A per-seat mailbox
 * names its seat on the body's first line `Mailbox-of: <seat> · <login>` (`seat` is then the canonical key), or
 * only by its head `mailbox/<login>/<slug>` (`seat` null, `slug` set). A legacy per-login mailbox — head
 * `mailbox/<login>`, or a first line `To: <login>` / `Mailbox-of: <login>` — names a login and NO seat, so its
 * `slug` is null: unassigned to a seat, ⛔ never attributed to the login's seats. A `pm:mailbox` pull that names
 * neither reads `{ seat: null, slug: null, login: null }`. The body outranks the head. The one reading of a
 * mailbox's owner: `fleet-roster.mjs` imports it, never re-spells it. Pure.
 */
export function mailboxOwner(pr) {
  if (!labelNames(pr).includes(MAILBOX_LABEL)) return null;
  const first = firstLine(pr?.body);
  const perSeat = MAILBOX_OF_LINE.exec(first);
  const seat = perSeat && LOGIN_SHAPE.test(perSeat[2]) ? seatKey(perSeat[1]) : null;
  if (seat) return { seat: seat.key, slug: seat.slug, login: perSeat[2] };
  const ref = String(pr?.head?.ref ?? '');
  const parts = ref.startsWith(MAILBOX_BRANCH_PREFIX) ? ref.slice(MAILBOX_BRANCH_PREFIX.length).split('/') : [];
  if (parts.length === 2 && LOGIN_SHAPE.test(parts[0]) && parts[1] !== '') return { seat: null, slug: parts[1].toLowerCase(), login: parts[0] };
  const legacy = LEGACY_OWNER_LINE.exec(first)?.[1] ?? (parts.length === 1 ? parts[0] : null);
  return { seat: null, slug: null, login: legacy !== null && LOGIN_SHAPE.test(legacy) ? legacy : null };
}

const openMailboxes = (pulls) =>
  (Array.isArray(pulls) ? pulls : []).filter((pr) => pr?.state === 'open').map((pr) => ({ pr, owner: mailboxOwner(pr) })).filter((m) => m.owner !== null);

/** The open mailboxes of `seat` (a `seatKey` reading), whichever login holds them — matched by slug. Pure. */
export function openMailboxesOf(pulls, seat) {
  return openMailboxes(pulls).filter((m) => m.owner.slug === seat.slug).map((m) => m.pr);
}

/** The open legacy per-login mailboxes of `login`: they name no seat, so they block nothing — the open names them. Pure. */
export function legacyMailboxesOf(pulls, login) {
  const want = String(login).toLowerCase();
  return openMailboxes(pulls).filter((m) => m.owner.slug === null && String(m.owner.login ?? '').toLowerCase() === want).map((m) => m.pr);
}

/** Why `pr` may not be closed as a mailbox, or null when it may. Pure. */
export function closeRefusal(pr, pull) {
  if (!pr || typeof pr !== 'object') return `#${pull} could not be read`;
  if (pr.state !== 'open') return `#${pull} is ${pr.state}, not open`;
  if (!labelNames(pr).includes(MAILBOX_LABEL)) return `#${pull} does not carry ${MAILBOX_LABEL} — this tool closes mailboxes only`;
  return null;
}

export function planText(plan) {
  const lines = [`mailbox-open: DRY RUN — nothing read, nothing pushed, nothing sent (${plan.repo}).`];
  if (plan.kind === 'open') {
    lines.push(`  ① read open pulls; refuse if a ${MAILBOX_LABEL} PR for the seat ${plan.seat.key} is open, whoever holds it; name ${plan.login}'s legacy per-login one`);
    lines.push(
      plan.push
        ? `  ② git commit-tree origin/${plan.base}^{tree} -p origin/${plan.base} (empty commit) → with-fleet.sh --kind 'git push' → refs/heads/${plan.branch}`
        : `  ② use the existing branch ${plan.branch} (no push); refuse unless it is ahead of ${plan.base}`,
    );
    lines.push('  ③ one relay stroke (fleet-write/dispatch.mjs), the actions file below');
    lines.push(`  ④ read back the open pull on ${plan.branch} and print its number`);
  } else {
    lines.push(`  ① read #${plan.pull}; refuse unless it is open and carries ${MAILBOX_LABEL}`);
    lines.push('  ② one relay stroke (fleet-write/dispatch.mjs), the actions file below');
  }
  lines.push('--- actions file ---', JSON.stringify(plan.actions, null, 2));
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// The live edges — `gh api` reads (paged by `gh-pages.mjs`), `git`, with-fleet, the relay
// ---------------------------------------------------------------------------

function ghJson(path, { paginate = false } = {}) {
  return paginate ? readAllPages(path) : ghApi(path);
}

function run(cmd, args) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', cwd: REPO_ROOT, stdio: ['ignore', 'pipe', 'inherit'] });
  return { ok: r.status === 0, status: r.status, out: (r.stdout ?? '').trim() };
}

function sendStroke(plan, { json }) {
  const dir = mkdtempSync(join(tmpdir(), 'mailbox-open-'));
  try {
    const file = join(dir, 'actions.json');
    writeFileSync(file, `${JSON.stringify(plan.actions, null, 2)}\n`);
    const r = spawnSync(process.execPath, [join(PM_DIR, 'fleet-write', 'dispatch.mjs'), '--repo', plan.repo, '--actions-file', file, ...(json ? ['--json'] : [])], { stdio: 'inherit', cwd: REPO_ROOT });
    return typeof r.status === 'number' ? r.status : EXIT_PREREQUISITE;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

async function openLive(plan, opts) {
  const pulls = ghJson(`/repos/${plan.repo}/pulls?state=open&per_page=100`, { paginate: true });
  if (!pulls.ok) {
    console.error(`✗ mailbox-open: could not read the open pulls — ${pulls.error}. Nothing was sent.`);
    return EXIT_PREREQUISITE;
  }
  const existing = openMailboxesOf(pulls.value, plan.seat);
  if (existing.length) {
    const held = existing.map((p) => `#${p.number}${mailboxOwner(p).login ? ` (held by ${mailboxOwner(p).login})` : ''}`).join(', ');
    console.error(`✗ mailbox-open: the seat ${plan.seat.key} already has an open mailbox on ${plan.repo}: ${held}. Nothing was sent.`);
    return EXIT_REFUSED;
  }
  const legacy = legacyMailboxesOf(pulls.value, plan.login);
  if (legacy.length) {
    console.error(`⚠️  mailbox-open: ${plan.login} still holds a legacy per-login mailbox on ${plan.repo}: ${legacy.map((p) => `#${p.number}`).join(', ')}. It names no seat, so it blocks nothing here; close it (--close N) once each of this account's seats holds its own.`);
  }
  if (plan.push) {
    const fetched = run('git', ['fetch', '--quiet', 'origin', plan.base]);
    const sha = fetched.ok ? run('git', ['commit-tree', `origin/${plan.base}^{tree}`, '-p', `origin/${plan.base}`, '-m', `chore(pm): mailbox of ${plan.seat.key} · ${plan.login}`]) : fetched;
    if (!sha.ok || !/^[0-9a-f]{40}$/.test(sha.out)) {
      console.error(`✗ mailbox-open: could not build the empty commit on origin/${plan.base}. Nothing was sent.`);
      return EXIT_PREREQUISITE;
    }
    const pushed = run('bash', [join(PM_DIR, 'with-fleet.sh'), '--kind', 'git push', '--', 'git', 'push', 'origin', `${sha.out}:refs/heads/${plan.branch}`]);
    if (!pushed.ok) {
      console.error(`✗ mailbox-open: the push of ${plan.branch} was refused (with-fleet exit ${pushed.status}). A cloud seat cannot push it — pass --head <a branch this session pushed>. A legacy branch ${MAILBOX_BRANCH_PREFIX}${plan.login} refuses it too: git nests no ref under an existing one, so delete that branch once its mailbox is closed. No PR was opened.`);
      return EXIT_PREREQUISITE;
    }
  } else {
    const cmp = ghJson(`/repos/${plan.repo}/compare/${encodeURIComponent(plan.base)}...${encodeURIComponent(plan.branch)}`);
    if (!cmp.ok || !(cmp.value?.ahead_by >= 1)) {
      console.error(`✗ mailbox-open: ${plan.branch} is not ahead of ${plan.base}${cmp.ok ? '' : ` (${cmp.error})`} — GitHub refuses a pull with no commits. Nothing was sent.`);
      return cmp.ok ? EXIT_REFUSED : EXIT_PREREQUISITE;
    }
  }
  const code = sendStroke(plan, opts);
  if (code !== EXIT_OK) return code;
  const owner = plan.repo.split('/')[0];
  const back = ghJson(`/repos/${plan.repo}/pulls?state=open&head=${encodeURIComponent(`${owner}:${plan.branch}`)}`);
  const pr = back.ok ? back.value.find((p) => labelNames(p).includes(MAILBOX_LABEL)) ?? back.value[0] : null;
  if (!pr) {
    console.error(`⚠️  mailbox-open: the stroke completed but no open pull on ${plan.branch} was read back — read the board before re-running.`);
    return EXIT_PREREQUISITE;
  }
  console.log(`✓ mailbox #${pr.number} of ${plan.seat.key} ${pr.html_url} — subscribe_pr_activity ${plan.repo} ${pr.number}`);
  if (opts.json) console.log(JSON.stringify({ number: pr.number, html_url: pr.html_url, repo: plan.repo, seat: plan.seat.key, branch: plan.branch }));
  return EXIT_OK;
}

async function closeLive(plan, opts) {
  const read = ghJson(`/repos/${plan.repo}/pulls/${plan.pull}`);
  const refusal = read.ok ? closeRefusal(read.value, plan.pull) : null;
  if (!read.ok) {
    console.error(`✗ mailbox-open: could not read #${plan.pull} — ${read.error}. Nothing was sent.`);
    return EXIT_PREREQUISITE;
  }
  if (refusal) {
    console.error(`✗ mailbox-open: ${refusal}. Nothing was sent.`);
    return EXIT_REFUSED;
  }
  const code = sendStroke(plan, opts);
  if (code === EXIT_OK) console.log(`✓ mailbox #${plan.pull} closed on ${plan.repo}.`);
  return code;
}

const USAGE = [
  'usage:',
  '  node scripts/pm/mailbox-open.mjs --repo owner/name --seat <LANE#N> --login <login> [--head <branch>] [--base main] [--dry-run] [--json]',
  '  node scripts/pm/mailbox-open.mjs --repo owner/name --close <n> [--dry-run]',
  '  node scripts/pm/mailbox-open.mjs --self-test',
  `  Exits: ${EXIT_OK} done · ${EXIT_USAGE} usage or refused stroke · ${EXIT_PREREQUISITE} prerequisite · ${EXIT_REFUSED} refused on board state · 5+ the relay's own exit`,
].join('\n');

export async function main(argv, { env = process.env } = {}) {
  const opts = parseArgs(argv);
  if (opts.help) {
    console.log(USAGE);
    return EXIT_OK;
  }
  if (opts.selfTest) return selfTest();
  if (opts.errors.length) {
    for (const e of opts.errors) console.error(`mailbox-open: ${e}`);
    console.error(`\n${USAGE}`);
    return EXIT_USAGE;
  }
  const session = env.OS_FLEET_SESSION || env.CLAUDE_CODE_REMOTE_SESSION_ID || null;
  const plan = opts.close !== null ? planClose({ repo: opts.repo, pull: opts.close }) : planOpen({ repo: opts.repo, seat: opts.seat, login: opts.login, head: opts.head, base: opts.base, session });
  if (plan.errors.length) {
    for (const e of plan.errors) console.error(`✗ mailbox-open: REFUSED by the relay validator — ${e}`);
    console.error('  Nothing was sent.');
    return EXIT_USAGE;
  }
  if (opts.dryRun) {
    console.log(planText(plan));
    return EXIT_OK;
  }
  return plan.kind === 'open' ? openLive(plan, opts) : closeLive(plan, opts);
}

// ---------------------------------------------------------------------------
// Self-test — battery roster, floor and handshake (AGENTS.md § Writing a `--self-test`)
// ---------------------------------------------------------------------------

let selfTestReachedVerdict = false;

const SELF_TEST_BATTERIES = Object.freeze({
  'arguments: the two modes and every refusal': 14,
  'the seat: canonical key, ref slug, and the per-seat branch': 11,
  'the open plan: branch, labels, body, and the relay validator': 11,
  'the close plan: comment then close, judged by the validator': 3,
  'whose mailbox a pull is: the seat on the body line or the head, a legacy login, neither': 8,
  "finding a seat's open mailbox: by seat, never by login": 10,
  'refusing to close what is not an open mailbox': 4,
  'the ledger exclusion and the footer': 4,
  'the CLI: dry run prints the actions file and sends nothing': 7,
  'paging: a three-page read through the loop equals the slurped array': 4,
});
const SELF_TEST_BATTERY_FLOOR = 10;

async function selfTest() {
  let failed = 0;
  let current = null;
  const seen = new Map();
  const battery = (name) => {
    current = name;
  };
  const t = (name, got, want) => {
    seen.set(current, (seen.get(current) ?? 0) + 1);
    const ok = JSON.stringify(got) === JSON.stringify(want);
    if (!ok) {
      failed += 1;
      console.error(`✗ [${current}] ${name}\n    got  ${JSON.stringify(got)}\n    want ${JSON.stringify(want)}`);
    }
  };

  battery('arguments: the two modes and every refusal');
  const OPEN = ['--repo', 'o/r', '--seat', 'domain:ui#4', '--login', 'os-bill'];
  const open = parseArgs(OPEN);
  t('open: repo, seat, login, default base main, no head', [open.errors, open.repo, open.seat, open.login, open.base, open.head], [[], 'o/r', 'domain:ui#4', 'os-bill', 'main', null]);
  const close = parseArgs(['--repo', 'o/r', '--close', '12']);
  t('close: a number, no seat and no login needed', [close.errors, close.close], [[], 12]);
  t('no --repo is refused', parseArgs(['--seat', 'triage', '--login', 'a']).errors.some((e) => e.includes('--repo')), true);
  t('a repo not shaped owner/name is refused', parseArgs(['--repo', 'nope', '--seat', 'triage', '--login', 'a']).errors.some((e) => e.includes('owner/name')), true);
  t('⭐ open without --seat is refused, naming why — the mailbox is the seat\'s, never the login\'s', parseArgs(['--repo', 'o/r', '--login', 'os-bill']).errors.some((e) => e.includes('--seat <seat> is required') && e.includes('never the login')), true);
  t('a --seat that is not LANE#N is refused, a login and a malformed epic among them', ['ui 4', 'domain:ui#0', '#4', 'domain:', 'domain:ui#4#5', 'os-bill', 'marchtian', 'epic:27293', 'epic:#27293#0'].every((s) => parseArgs(['--repo', 'o/r', '--seat', s, '--login', 'a']).errors.some((e) => e.includes('is not a seat'))), true);
  t('⭐ an epic seat opens like any seat: --seat epic:#N#K parses, its branch a legal ref', parseArgs(['--repo', 'o/r', '--seat', 'epic:#27293#1', '--login', 'sunhaolin']).errors, []);
  t('open without --login is refused', parseArgs(['--repo', 'o/r', '--seat', 'triage']).errors.some((e) => e.includes('--login')), true);
  t('a login GitHub would refuse is refused', parseArgs(['--repo', 'o/r', '--seat', 'triage', '--login', '-bad--']).errors.some((e) => e.includes('not a GitHub login')), true);
  t('a seat whose branch is no legal ref is refused', parseArgs(['--repo', 'o/r', '--seat', 'repo:a..b#1', '--login', 'a']).errors.some((e) => e.includes('not a legal ref')), true);
  t('--close with a non-number is refused', parseArgs(['--repo', 'o/r', '--close', '1x']).errors.some((e) => e.includes('pull number')), true);
  t('--close with --head or --seat is refused', [parseArgs(['--repo', 'o/r', '--close', '3', '--head', 'x']).errors.some((e) => e.includes('no --head')), parseArgs(['--repo', 'o/r', '--close', '3', '--seat', 'triage']).errors.some((e) => e.includes('no --seat'))], [true, true]);
  t('an unknown flag is refused, never ignored', parseArgs([...OPEN, '--bogus']).errors.some((e) => e.includes('--bogus')), true);
  t('a --head with a space or .. is refused', [parseArgs([...OPEN, '--head', 'a b']).errors.length > 0, parseArgs([...OPEN, '--head', 'a..b']).errors.length > 0], [true, true]);

  battery('the seat: canonical key, ref slug, and the per-seat branch');
  t('domain:ui#4 → key domain:ui#4, slug ui-4 (the default kind dropped)', seatKey('domain:ui#4'), { key: 'domain:ui#4', slug: 'ui-4' });
  t('an absent number is seat 1, spelled', [seatKey('triage'), seatKey('domain:skills')], [{ key: 'triage#1', slug: 'triage-1' }, { key: 'domain:skills#1', slug: 'skills-1' }]);
  t('another kind keeps its name, its colon turned into a hyphen', [seatKey('repo:cloud#1').slug, seatKey('repo:www.objectos.ai#2').slug], ['repo-cloud-1', 'repo-www.objectos.ai-2']);
  t('read lower-cased, so one seat has one key', [seatKey('Domain:UI#4').key, seatKey(' domain:ui#4 ').key], ['domain:ui#4', 'domain:ui#4']);
  t('not a seat ⇒ null — ⛔ a login above all, the confusion a per-login mailbox made', ['', 'ui 4', 'domain:ui#0', '#4', 'domain:', null, 'os-bill', 'marchtian'].map(seatKey), [null, null, null, null, null, null, null, null]);
  t('⭐ an epic seat reads: `epic:#N#K` keeps its spelling, slugs to epic-N-K; `epic:#N` is seat 1; read lower-cased', [seatKey('epic:#27293#1'), seatKey('epic:#12'), seatKey(' Epic:#12#2 ').key], [{ key: 'epic:#27293#1', slug: 'epic-27293-1' }, { key: 'epic:#12#1', slug: 'epic-12-1' }, 'epic:#12#2']);
  t('⛔ a malformed epic spelling is not a seat — no `#`, no number, a zero or leading zero, a word, a third number', ['epic', 'epic:', 'epic:#', 'epic:12', 'epic#12', 'epic:#0', 'epic:#012', 'epic:#12#0', 'epic:#12#', 'epic:#12#1#2', 'epic:#abc', 'epic:#12-1', 'epic:skills#1'].map(seatKey).filter((k) => k !== null), []);
  t('⛔ a `domain:` lane named `epic-…` is refused — its slug would be an epic seat\'s — while `domain:epic` and `domain:epics` read', [seatKey('domain:epic-12#1'), seatKey('domain:epic-tools'), seatKey('domain:epic').slug, seatKey('domain:epics').slug], [null, null, 'epic-1', 'epics-1']);
  t('⭐ the epic slug collides with no lane slug: one key per slug across every lane kind', (() => { const keys = ['epic:#12#1', 'domain:epic#12', 'domain:epic-12#1', 'repo:epic-12#1', 'domain:12#1', 'triage#12', 'epic:#1#21', 'epic:#12#1'].map(seatKey).filter(Boolean); return new Set(keys.map((k) => k.slug)).size === new Set(keys.map((k) => k.key)).size; })(), true);
  t('⛔ a short form is not a seat — `skills#2` names no lane, so it is refused as a login is', ['skills#2', 'ui#4', 'server', 'skills'].map(seatKey), [null, null, null, null]);
  t('⛔ a `domain:` lane named after a reserved lane word is refused — its slug would be another seat\'s', ['domain:triage', 'domain:director#2', 'domain:repo-cloud#1', 'Domain:Triage#1'].map(seatKey), [null, null, null, null]);
  t('…while a `domain:` lane that merely CONTAINS a reserved word, and the reserved words as their own lanes, still read', [seatKey('domain:triage-tools#1').slug, seatKey('domain:directory').slug, seatKey('domain:repository').slug, seatKey('triage#2').slug, seatKey('repo:cloud').slug], ['triage-tools-1', 'directory-1', 'repository-1', 'triage-2', 'repo-cloud-1']);
  t('the shape and the reserved set are built from the ONE set of lane-word lists', SEAT_LANE_KINDS.join() === 'domain,repo' && SEAT_BARE_LANES.join() === 'triage,director' && SEAT_EPIC_KIND === 'epic' && SEAT_BARE_LANES.every((w) => seatKey(w)?.key === `${w}#1` && seatKey(`domain:${w}`) === null) && seatKey(`${SEAT_EPIC_KIND}:#7`)?.key === 'epic:#7#1' && seatKey(`domain:${SEAT_EPIC_KIND}-7`) === null, true);
  t('the branch is mailbox/<login>/<slug> — no `:` and no `#` in a ref', mailboxBranch('os-bill', seatKey('domain:ui#4')), 'mailbox/os-bill/ui-4');
  t('an epic seat\'s branch is mailbox/<login>/epic-N-K', mailboxBranch('sunhaolin', seatKey('epic:#27293#1')), 'mailbox/sunhaolin/epic-27293-1');
  t('⭐ two seats under ONE login get two branches', [mailboxBranch('os-sales', seatKey('domain:server#1')), mailboxBranch('os-sales', seatKey('domain:ui#1'))], ['mailbox/os-sales/server-1', 'mailbox/os-sales/ui-1']);

  battery('the open plan: branch, labels, body, and the relay validator');
  const p = planOpen({ repo: 'objectstack-ai/objectstack', seat: 'domain:ui#4', login: 'os-bill', session: 'cse_01ABC' });
  t('the default branch is mailbox/<login>/<slug> and it is pushed', [p.branch, p.push], ['mailbox/os-bill/ui-4', true]);
  t('one pr_create action, base main, titled by seat and login', [p.actions.length, p.actions[0].op, p.actions[0].base, p.actions[0].head, p.actions[0].title], [1, 'pr_create', 'main', 'mailbox/os-bill/ui-4', 'pm:mailbox — domain:ui#4 · os-bill']);
  t('labels: pm:mailbox, pinned (the stale-sweep exemption) and skip-changeset (the changeset-check exemption)', p.actions[0].labels, ['pm:mailbox', 'pinned', 'skip-changeset']);
  t('⭐ pinned IS stale.yml\'s exemption, read off the workflow — and pm:mailbox is not one', (() => { const y = readFileSync(join(REPO_ROOT, '.github', 'workflows', 'stale.yml'), 'utf8'); const m = /exempt-pr-labels:\s*'([^']*)'/.exec(y); const names = m ? m[1].split(',').map((s) => s.trim()) : []; return [names.includes(STALE_EXEMPT_LABEL), names.includes(MAILBOX_LABEL)]; })(), [true, false]);
  t('⭐ the body opens with Mailbox-of: <seat> · <login> — the seat is the key, the login only who holds it', p.actions[0].body.split('\n')[0], 'Mailbox-of: domain:ui#4 · os-bill');
  t('the body tells a sender to open with To: <seat>', p.actions[0].body.includes('the line `To: domain:ui#4`, then ONE line'), true);
  t('the body states the CI posture, the never-merged rule and the closed vocabulary', [/RED BY DESIGN/.test(p.actions[0].body), /Never merged/.test(p.actions[0].body), /one of the doorbell keys/.test(p.actions[0].body) && /--mailbox-keys/.test(p.actions[0].body) && /no acknowledgements/.test(p.actions[0].body)], [true, true, true]);
  t('the relay validator accepts the stroke', p.errors, []);
  const ph = planOpen({ repo: 'o/r', seat: 'triage', login: 'os-bill', head: 'claude/project-thread-x' });
  t('--head names the branch and skips the push; the body still names the seat', [ph.branch, ph.push, ph.actions[0].head, ph.actions[0].body.split('\n')[0]], ['claude/project-thread-x', false, 'claude/project-thread-x', 'Mailbox-of: triage#1 · os-bill']);
  t('no draft key is sent — the relay forces draft itself', 'draft' in p.actions[0], false);
  const pe = planOpen({ repo: 'objectstack-ai/objectstack', seat: 'Epic:#27293#1', login: 'sunhaolin' });
  t('⭐ an epic seat\'s plan: its branch, its Mailbox-of line, its To: line, and the validator accepts it', [pe.branch, pe.actions[0].title, pe.actions[0].body.split('\n')[0], pe.actions[0].body.includes('the line `To: epic:#27293#1`'), pe.errors], ['mailbox/sunhaolin/epic-27293-1', 'pm:mailbox — epic:#27293#1 · sunhaolin', 'Mailbox-of: epic:#27293#1 · sunhaolin', true, []]);

  battery('the close plan: comment then close, judged by the validator');
  const c = planClose({ repo: 'o/r', pull: 25392 });
  t('comment first, then issue_patch closed', c.actions.map((a) => [a.op, a.issue, a.state ?? null]), [['comment', 25392, null], ['issue_patch', 25392, 'closed']]);
  t('the relay validator accepts the stroke', c.errors, []);
  t('the comment carries the bare footer under its rule line', c.actions[0].body.endsWith('\n\n---\n_Generated by [Claude Code](https://claude.ai/code)_'), true);

  battery('whose mailbox a pull is: the seat on the body line or the head, a legacy login, neither');
  const pr = (o) => ({ state: 'open', number: 1, labels: [{ name: 'pm:mailbox' }], head: { ref: 'x' }, body: '', ...o });
  t('⭐ the body this file writes reads back as its seat — writer and reader are one spelling', mailboxOwner(pr({ head: { ref: 'claude/project-thread-x' }, body: ph.actions[0].body })), { seat: 'triage#1', slug: 'triage-1', login: 'os-bill' });
  t('a head mailbox/<login>/<slug> with no body line reads the slug and the login', mailboxOwner(pr({ head: { ref: 'mailbox/os-bill/ui-4' } })), { seat: null, slug: 'ui-4', login: 'os-bill' });
  t('the body outranks the head', mailboxOwner(pr({ head: { ref: 'mailbox/os-bill/ui-4' }, body: 'Mailbox-of: domain:ui#2 · os-bill' })).slug, 'ui-2');
  t('⛔ a legacy per-login mailbox names a login and NO seat — head mailbox/<login>, a To: <login> or a Mailbox-of: <login> first line', [mailboxOwner(pr({ head: { ref: 'mailbox/os-justin' } })), mailboxOwner(pr({ head: { ref: 'claude/x' }, body: 'To: os-sales\n\nThe mailbox' })), mailboxOwner(pr({ body: 'Mailbox-of: os-elon-musk\n' }))], [{ seat: null, slug: null, login: 'os-justin' }, { seat: null, slug: null, login: 'os-sales' }, { seat: null, slug: null, login: 'os-elon-musk' }]);
  t('⭐ an epic seat\'s body reads back as its seat, and its default head as its slug', [mailboxOwner(pr({ head: { ref: 'claude/x' }, body: pe.actions[0].body })), mailboxOwner(pr({ head: { ref: pe.branch } }))], [{ seat: 'epic:#27293#1', slug: 'epic-27293-1', login: 'sunhaolin' }, { seat: null, slug: 'epic-27293-1', login: 'sunhaolin' }]);
  t('a pm:mailbox pull naming neither is a mailbox of nobody, never a non-mailbox', mailboxOwner(pr({ body: 'hello' })), { seat: null, slug: null, login: null });
  t('a malformed seat or login on the body line names no seat', [mailboxOwner(pr({ body: 'Mailbox-of: ui 4 · os-bill' })).slug, mailboxOwner(pr({ body: 'Mailbox-of: domain:ui#4 · -bad-' })).slug], [null, null]);
  t('without the label it is not a mailbox', mailboxOwner(pr({ labels: [], head: { ref: 'mailbox/os-bill/ui-4' } })), null);

  battery("finding a seat's open mailbox: by seat, never by login");
  const UI4 = seatKey('domain:ui#4');
  const opened = (seat, login, number) => pr({ number, head: { ref: `claude/project-thread-${number}` }, body: planOpen({ repo: 'o/r', seat, login, head: `claude/project-thread-${number}` }).actions[0].body });
  t('found by the body line on a --head branch', openMailboxesOf([opened('domain:ui#4', 'os-bill', 7)], UI4).map((x) => x.number), [7]);
  t('found by the head slug on the default branch', openMailboxesOf([pr({ head: { ref: planOpen({ repo: 'o/r', seat: 'domain:ui#4', login: 'os-bill' }).branch } })], UI4).length, 1);
  t('⭐ two seats under ONE login both open: with seat 3\'s mailbox open seat 4 finds none, then each finds exactly its own', (() => {
    const s3 = seatKey('domain:server#3');
    const s4 = seatKey('domain:server#4');
    const one = [opened('domain:server#3', 'os-elon-musk', 3)];
    const both = [...one, opened('domain:server#4', 'os-elon-musk', 4)];
    return [openMailboxesOf(one, s4).length, openMailboxesOf(both, s3).map((x) => x.number), openMailboxesOf(both, s4).map((x) => x.number)];
  })(), [0, [3], [4]]);
  t('⭐ the same seat held by ANOTHER login is still that seat\'s mailbox — the refusal is per seat', openMailboxesOf([opened('domain:ui#4', 'os-sales', 9)], UI4).map((x) => x.number), [9]);
  t('the seat match is case- and spelling-insensitive (domain:skills ≡ domain:skills#1)', [openMailboxesOf([opened('domain:skills', 'a', 1)], seatKey('Domain:Skills#1')).length, openMailboxesOf([pr({ head: { ref: 'mailbox/a/UI-4' } })], UI4).length], [1, 1]);
  t('⛔ a legacy per-login mailbox blocks no seat of its login', [openMailboxesOf([pr({ head: { ref: 'mailbox/os-bill' } }), pr({ body: 'To: os-bill' })], UI4).length], [0]);
  t('…and is named for its login, case-insensitively, never for another', [legacyMailboxesOf([pr({ number: 5, head: { ref: 'mailbox/OS-Bill' } }), pr({ number: 6, body: 'To: os-bill' }), pr({ number: 8, body: 'To: os-sales' }), opened('domain:ui#4', 'os-bill', 7)], 'os-bill').map((x) => x.number)], [[5, 6]]);
  t('⭐ an epic seat\'s open mailbox refuses a second for that seat only — never for another epic, nor for a domain:epic lane', (() => { const box = [opened('epic:#27293#1', 'sunhaolin', 11)]; return [openMailboxesOf(box, seatKey('epic:#27293')).map((x) => x.number), openMailboxesOf(box, seatKey('epic:#27293#2')).length, openMailboxesOf(box, seatKey('epic:#2729#31')).length, openMailboxesOf(box, seatKey('domain:epic')).length]; })(), [[11], 0, 0, 0]);
  t('without the label it is not a mailbox', openMailboxesOf([pr({ labels: [], head: { ref: 'mailbox/os-bill/ui-4' } })], UI4).length, 0);
  t('a closed one does not block a new one', openMailboxesOf([pr({ state: 'closed', head: { ref: 'mailbox/os-bill/ui-4' } })], UI4).length, 0);

  battery('refusing to close what is not an open mailbox');
  t('an open pm:mailbox PR may be closed', closeRefusal(pr({}), 1), null);
  t('a PR without the label is refused', /does not carry pm:mailbox/.test(closeRefusal(pr({ labels: [{ name: 'bug' }] }), 1)), true);
  t('a closed PR is refused', /is closed/.test(closeRefusal(pr({ state: 'closed' }), 1)), true);
  t('an unreadable answer is refused', /could not be read/.test(closeRefusal(null, 1)), true);

  battery('the ledger exclusion and the footer');
  t('LEDGER_EXCLUSION is the search qualifier', LEDGER_EXCLUSION, '-label:pm:mailbox');
  t('a cse_ id becomes the session URL', bodyFooter('cse_01ABC'), '\n\n---\n_Generated by [Claude Code](https://claude.ai/code/session_01ABC)_');
  t('a session_ id is kept', bodyFooter('session_01XYZ').includes('/code/session_01XYZ)'), true);
  t('no or a malformed session falls back to the bare footer', [bodyFooter(null), bodyFooter('cse_')].every((f) => f.endsWith('(https://claude.ai/code)_')), true);

  battery('paging: a three-page read through the loop equals the slurped array');
  {
    const slurped = [0, 1, 2].map((n) => Array.from({ length: n < 2 ? PER_PAGE : 37 }, (_, i) => ({ number: n * PER_PAGE + i + 1 })));
    const asked = [];
    const get = (path) => {
      asked.push(path);
      const page = Number(new URLSearchParams(path.split('?')[1]).get('page'));
      return { ok: true, value: slurped[page - 1] ?? [] };
    };
    const read = readAllPages('/repos/o/r/issues?state=open&labels=pm%3Aseat&per_page=100', { get });
    t('three pages read = the --slurp array, flattened', [read.ok, read.value], [true, slurped.flat()]);
    t('pages 1..3 asked, per_page kept once, other keys kept, stop at the short page', asked, [1, 2, 3].map((n) => `/repos/o/r/issues?state=open&labels=pm%3Aseat&per_page=100&page=${n}`));
    const exact = [];
    t('an exact multiple of per_page reads one empty page and stops', [readAllPages('/x', { get: (p) => (exact.push(p), { ok: true, value: exact.length === 1 ? slurped[0] : [] }) }).value.length, exact.length], [PER_PAGE, 2]);
    t('a failed page or a non-list page is an error, never a partial list', [readAllPages('/x', { get: () => ({ ok: false, error: 'boom' }) }), readAllPages('/x', { get: () => ({ ok: true, value: { message: 'x' } }) }).ok], [{ ok: false, error: 'boom' }, false]);
  }

  battery('the CLI: dry run prints the actions file and sends nothing');
  const cli = (args) => spawnSync(process.execPath, [SELF_PATH, ...args], { encoding: 'utf8', env: { ...process.env, PATH: '/nonexistent', OS_FLEET_SESSION: '', CLAUDE_CODE_REMOTE_SESSION_ID: '' } });
  const dry = cli(['--repo', 'objectstack-ai/objectstack', '--seat', 'domain:ui#4', '--login', 'os-bill', '--dry-run']);
  t('open dry run exits 0 with no gh/git on PATH (nothing reached for)', dry.status, EXIT_OK);
  const printed = dry.stdout.split('--- actions file ---\n')[1] ?? '';
  let parsed = null;
  try {
    parsed = JSON.parse(printed);
  } catch {}
  t('the printed actions file parses and is the plan', parsed?.[0]?.op === 'pr_create' && parsed?.[0]?.head === 'mailbox/os-bill/ui-4', true);
  t('the printed plan names the seat it refuses on', /refuse if a pm:mailbox PR for the seat domain:ui#4 is open/.test(dry.stdout), true);
  t('close dry run exits 0 and prints both actions', [cli(['--repo', 'o/r', '--close', '7', '--dry-run']).status, (cli(['--repo', 'o/r', '--close', '7', '--dry-run']).stdout.match(/"op":/g) ?? []).length], [EXIT_OK, 2]);
  t('a usage error is exit 2 — an open with no --seat among them', [cli(['--repo', 'o/r']).status, cli(['--repo', 'o/r', '--login', 'os-bill', '--dry-run']).status], [EXIT_USAGE, EXIT_USAGE]);
  t('--help is exit 0', cli(['--help']).status, EXIT_OK);
  t('an epic seat\'s dry run exits 0 and pushes its own branch; a malformed epic is exit 2', (() => { const e = cli(['--repo', 'o/r', '--seat', 'epic:#27293#1', '--login', 'sunhaolin', '--dry-run']); return [e.status, e.stdout.includes('refs/heads/mailbox/sunhaolin/epic-27293-1'), cli(['--repo', 'o/r', '--seat', 'epic:27293', '--login', 'sunhaolin', '--dry-run']).status]; })(), [EXIT_OK, true, EXIT_USAGE]);

  const floor = [];
  const declared = Object.keys(SELF_TEST_BATTERIES);
  if (declared.length < SELF_TEST_BATTERY_FLOOR) floor.push(`SELF_TEST_BATTERIES declares ${declared.length} batteries, below the pinned ${SELF_TEST_BATTERY_FLOOR}.`);
  for (const [name, count] of seen) if (!declared.includes(name)) floor.push(`battery "${name}" registered ${count} case(s) but is not declared in SELF_TEST_BATTERIES.`);
  for (const name of declared) {
    const count = seen.get(name) ?? 0;
    if (count < SELF_TEST_BATTERIES[name]) floor.push(count === 0 ? `battery "${name}" DID NOT RUN — 0 cases, ${SELF_TEST_BATTERIES[name]} pinned.` : `battery "${name}" registered ${count} case(s), below its floor of ${SELF_TEST_BATTERIES[name]}.`);
  }
  for (const f of floor) console.error(`✗ self-test floor: ${f}`);
  failed += floor.length;
  if (failed > 0) {
    console.error(`\n✗ mailbox-open self-test: ${failed} failure(s) (cases and floor).`);
    return 1;
  }
  const total = [...seen.values()].reduce((a, b) => a + b, 0);
  console.log(`✓ mailbox-open self-test: ${total} cases in ${declared.length} batteries pass.`);
  selfTestReachedVerdict = true;
  return EXIT_OK;
}

if (isEntrypoint(import.meta.url)) {
  const code = await main(process.argv.slice(2));
  if (process.argv.includes('--self-test') && !selfTestReachedVerdict) {
    console.error(
      '\n✗ mailbox-open self-test: selfTest() returned without reaching its verdict, so no success line was\n' +
        'printed. Exiting 0 here would report a self-test that never finished as one that passed.\n',
    );
    process.exit(1);
  }
  process.exit(code);
}
