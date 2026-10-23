#!/usr/bin/env node
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * mailbox-open — open (or close) a project's cross-account mailbox PR (#25417).
 *
 *   node scripts/pm/mailbox-open.mjs --repo owner/name --login <login> [--base main] [--dry-run] [--json]
 *   node scripts/pm/mailbox-open.mjs --repo owner/name --login <login> --head <branch> [--dry-run]
 *   node scripts/pm/mailbox-open.mjs --repo owner/name --close <n> [--dry-run]
 *   node scripts/pm/mailbox-open.mjs --self-test          # offline, no network, no git
 *
 * ## What a mailbox PR is, and why it is a PR
 *
 * A Claude Code project is single-account, and the only bus every account
 * shares is GitHub. A comment on a pull request wakes the session subscribed
 * to it — measured on #25392: a relay comment woke the subscribed thread in
 * ~70 s, a comment from a second account in 4 s. An issue comment wakes
 * nothing. So each lane project keeps ONE draft PR as its mailbox: labelled
 * `pm:mailbox`, on the branch `mailbox/<login>` (the account that holds the
 * project), subscribed by a resident thread, ⛔ never merged, closed when the
 * account hands over. The protocol text (who writes `To: <login>`, who
 * subscribes) is the pm-dispatch skill's; this file is only the tooling.
 *
 * ## What it does, in order (open)
 *
 *   ① READ the open pulls and REFUSE (exit 4) when one already carries
 *      `pm:mailbox` for this login — by head `mailbox/<login>` or by the body's
 *      `Mailbox-of: <login>` line. One mailbox per account per repo.
 *   ② the BRANCH. Default: one empty commit on `origin/<base>` (`git
 *      commit-tree` of the base's own tree — no checkout, no index, no working
 *      tree touched), pushed as `mailbox/<login>` through `with-fleet.sh
 *      --kind 'git push'`, the write gate every push goes through. The relay
 *      has no ref-creating op, so a cloud seat container cannot do this step:
 *      with-fleet refuses there (exit 3) and nothing else is sent. `--head
 *      <branch>` names a branch that already exists instead (a thread's own
 *      pushed branch, as #25392 used) and skips the push; it must be ahead of
 *      `<base>`, because GitHub refuses a pull with no commits.
 *   ③ ONE relay stroke: `pr_create` (draft is forced by the relay) with labels
 *      `pm:mailbox` and `skip-changeset`, sent through
 *      `fleet-write/dispatch.mjs` as `objectstack-fleet[bot]`.
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
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { isEntrypoint } from '../invoked-as.mjs';
import { validateStroke } from './fleet-write/validate.mjs';

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
const PR_LABELS = Object.freeze([MAILBOX_LABEL, 'skip-changeset']);

const REPO_SHAPE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
// GitHub's own login rule: alphanumerics and single inner hyphens, ≤ 39.
const LOGIN_SHAPE = /^[A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38}$/;
const BRANCH_SHAPE = /^(?!\/|.*\/\/|.*\.\.|.*[\s~^:?*[\\]|.*\.lock$|.*\/$)[A-Za-z0-9._/-]+$/;
const SESSION_SHAPE = /^(?:session|cse)_[A-Za-z0-9]+$/;

export const mailboxBranch = (login) => `${MAILBOX_BRANCH_PREFIX}${login}`;

// ---------------------------------------------------------------------------
// The pure core
// ---------------------------------------------------------------------------

export function parseArgs(argv) {
  const opts = { repo: null, login: null, head: null, base: 'main', close: null, dryRun: false, json: false, selfTest: false, help: false, errors: [] };
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
  } else {
    if (!opts.login) opts.errors.push('--login <login> is required to open a mailbox');
    else if (!LOGIN_SHAPE.test(opts.login)) opts.errors.push(`--login ${JSON.stringify(opts.login)} is not a GitHub login`);
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

export function mailboxBody({ login, session = null }) {
  return [
    `Mailbox-of: ${login}`,
    '',
    `The cross-account mailbox of the Claude Code project held by \`${login}\` (\`${MAILBOX_LABEL}\`).`,
    '',
    '- ⛔ Never merged, never readied. Closed on account handover: `node scripts/pm/mailbox-open.mjs --close <this number>`.',
    `- A message is a comment whose first line is \`To: <login>\`; the resident thread subscribed to this PR reads it.`,
    '- **CI: owes none.** `skip-changeset` exempts Check Changeset; any other check red on this empty diff is RED BY DESIGN — never fix, rerun or report it.',
    `- Excluded from every landing ledger: queries add \`${LEDGER_EXCLUSION}\`.`,
  ].join('\n') + bodyFooter(session);
}

export function planOpen({ repo, login, head = null, base = 'main', session = null }) {
  const branch = head ?? mailboxBranch(login);
  const actions = [
    { op: 'pr_create', title: `pm:mailbox — ${login}`, head: branch, base, body: mailboxBody({ login, session }), labels: [...PR_LABELS] },
  ];
  return { kind: 'open', repo, login, branch, base, push: head === null, actions, errors: validateStroke(repo, actions) };
}

export function planClose({ repo, pull }) {
  const actions = [
    { op: 'comment', issue: pull, body: 'Mailbox closed: the account holding this project handed over. A successor opens its own with `scripts/pm/mailbox-open.mjs`.\n\n---\n_Generated by [Claude Code](https://claude.ai/code)_' },
    { op: 'issue_patch', issue: pull, state: 'closed' },
  ];
  return { kind: 'close', repo, pull, actions, errors: validateStroke(repo, actions) };
}

const labelNames = (pr) => (Array.isArray(pr?.labels) ? pr.labels.map((l) => (typeof l === 'string' ? l : l?.name)) : []);
const mailboxOf = (pr) => /^Mailbox-of: (\S+)/.exec(typeof pr?.body === 'string' ? pr.body : '')?.[1] ?? null;

/** The open `pm:mailbox` pulls that belong to `login`, by head branch or by the body's `Mailbox-of:` line. Pure. */
export function openMailboxesOf(pulls, login) {
  const want = String(login).toLowerCase();
  return (Array.isArray(pulls) ? pulls : []).filter((pr) => {
    if (pr?.state !== 'open' || !labelNames(pr).includes(MAILBOX_LABEL)) return false;
    return String(pr?.head?.ref ?? '').toLowerCase() === mailboxBranch(want) || String(mailboxOf(pr) ?? '').toLowerCase() === want;
  });
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
    lines.push(`  ① read open pulls; refuse if a ${MAILBOX_LABEL} PR for ${plan.login} is open`);
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
// The live edges — `gh api` reads, `git`, with-fleet, the relay
// ---------------------------------------------------------------------------

function ghJson(path, { paginate = false } = {}) {
  const r = spawnSync('gh', ['api', ...(paginate ? ['--paginate', '--slurp'] : []), path], { encoding: 'utf8' });
  if (r.status !== 0) return { ok: false, error: (r.stderr || r.error?.message || `gh exited ${r.status}`).trim() };
  try {
    const parsed = JSON.parse(r.stdout);
    return { ok: true, value: paginate ? parsed.flat() : parsed };
  } catch (e) {
    return { ok: false, error: `unparseable answer from GET ${path}: ${e.message}` };
  }
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
  const existing = openMailboxesOf(pulls.value, plan.login);
  if (existing.length) {
    console.error(`✗ mailbox-open: ${plan.login} already has an open mailbox on ${plan.repo}: ${existing.map((p) => `#${p.number}`).join(', ')}. Nothing was sent.`);
    return EXIT_REFUSED;
  }
  if (plan.push) {
    const fetched = run('git', ['fetch', '--quiet', 'origin', plan.base]);
    const sha = fetched.ok ? run('git', ['commit-tree', `origin/${plan.base}^{tree}`, '-p', `origin/${plan.base}`, '-m', `chore(pm): mailbox of ${plan.login}`]) : fetched;
    if (!sha.ok || !/^[0-9a-f]{40}$/.test(sha.out)) {
      console.error(`✗ mailbox-open: could not build the empty commit on origin/${plan.base}. Nothing was sent.`);
      return EXIT_PREREQUISITE;
    }
    const pushed = run('bash', [join(PM_DIR, 'with-fleet.sh'), '--kind', 'git push', '--', 'git', 'push', 'origin', `${sha.out}:refs/heads/${plan.branch}`]);
    if (!pushed.ok) {
      console.error(`✗ mailbox-open: the push of ${plan.branch} was refused (with-fleet exit ${pushed.status}). A cloud seat cannot push it — pass --head <a branch this session pushed>. No PR was opened.`);
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
  console.log(`✓ mailbox #${pr.number} ${pr.html_url} — subscribe_pr_activity ${plan.repo} ${pr.number}`);
  if (opts.json) console.log(JSON.stringify({ number: pr.number, html_url: pr.html_url, repo: plan.repo, branch: plan.branch }));
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
  '  node scripts/pm/mailbox-open.mjs --repo owner/name --login <login> [--head <branch>] [--base main] [--dry-run] [--json]',
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
  const plan = opts.close !== null ? planClose({ repo: opts.repo, pull: opts.close }) : planOpen({ repo: opts.repo, login: opts.login, head: opts.head, base: opts.base, session });
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
  'arguments: the two modes and every refusal': 10,
  'the open plan: branch, labels, body, and the relay validator': 8,
  'the close plan: comment then close, judged by the validator': 3,
  'finding an open mailbox: head, body line, label, state': 6,
  'refusing to close what is not an open mailbox': 4,
  'the ledger exclusion and the footer': 4,
  'the CLI: dry run prints the actions file and sends nothing': 5,
});
const SELF_TEST_BATTERY_FLOOR = 7;

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
  const open = parseArgs(['--repo', 'o/r', '--login', 'os-bill']);
  t('open: repo, login, default base main, no head', [open.errors, open.repo, open.login, open.base, open.head], [[], 'o/r', 'os-bill', 'main', null]);
  const close = parseArgs(['--repo', 'o/r', '--close', '12']);
  t('close: a number, no login needed', [close.errors, close.close], [[], 12]);
  t('no --repo is refused', parseArgs(['--login', 'a']).errors.some((e) => e.includes('--repo')), true);
  t('a repo not shaped owner/name is refused', parseArgs(['--repo', 'nope', '--login', 'a']).errors.some((e) => e.includes('owner/name')), true);
  t('open without --login is refused', parseArgs(['--repo', 'o/r']).errors.some((e) => e.includes('--login')), true);
  t('a login GitHub would refuse is refused', parseArgs(['--repo', 'o/r', '--login', '-bad--']).errors.some((e) => e.includes('not a GitHub login')), true);
  t('--close with a non-number is refused', parseArgs(['--repo', 'o/r', '--close', '1x']).errors.some((e) => e.includes('pull number')), true);
  t('--close with --head is refused', parseArgs(['--repo', 'o/r', '--close', '3', '--head', 'x']).errors.some((e) => e.includes('no --head')), true);
  t('an unknown flag is refused, never ignored', parseArgs(['--repo', 'o/r', '--login', 'a', '--bogus']).errors.some((e) => e.includes('--bogus')), true);
  t('a --head with a space or .. is refused', [parseArgs(['--repo', 'o/r', '--login', 'a', '--head', 'a b']).errors.length > 0, parseArgs(['--repo', 'o/r', '--login', 'a', '--head', 'a..b']).errors.length > 0], [true, true]);

  battery('the open plan: branch, labels, body, and the relay validator');
  const p = planOpen({ repo: 'objectstack-ai/objectstack', login: 'os-bill', session: 'cse_01ABC' });
  t('the default branch is mailbox/<login> and it is pushed', [p.branch, p.push], ['mailbox/os-bill', true]);
  t('one pr_create action, base main', [p.actions.length, p.actions[0].op, p.actions[0].base, p.actions[0].head], [1, 'pr_create', 'main', 'mailbox/os-bill']);
  t('labels: pm:mailbox and skip-changeset (the changeset-check exemption)', p.actions[0].labels, ['pm:mailbox', 'skip-changeset']);
  t('the body opens with Mailbox-of: <login>', p.actions[0].body.split('\n')[0], 'Mailbox-of: os-bill');
  t('the body states the CI posture and the never-merged rule', [/RED BY DESIGN/.test(p.actions[0].body), /Never merged/.test(p.actions[0].body)], [true, true]);
  t('the relay validator accepts the stroke', p.errors, []);
  const ph = planOpen({ repo: 'o/r', login: 'os-bill', head: 'claude/project-thread-x' });
  t('--head names the branch and skips the push', [ph.branch, ph.push, ph.actions[0].head], ['claude/project-thread-x', false, 'claude/project-thread-x']);
  t('no draft key is sent — the relay forces draft itself', 'draft' in p.actions[0], false);

  battery('the close plan: comment then close, judged by the validator');
  const c = planClose({ repo: 'o/r', pull: 25392 });
  t('comment first, then issue_patch closed', c.actions.map((a) => [a.op, a.issue, a.state ?? null]), [['comment', 25392, null], ['issue_patch', 25392, 'closed']]);
  t('the relay validator accepts the stroke', c.errors, []);
  t('the comment carries the bare footer under its rule line', c.actions[0].body.endsWith('\n\n---\n_Generated by [Claude Code](https://claude.ai/code)_'), true);

  battery('finding an open mailbox: head, body line, label, state');
  const pr = (o) => ({ state: 'open', number: 1, labels: [{ name: 'pm:mailbox' }], head: { ref: 'x' }, body: '', ...o });
  t('found by head mailbox/<login>', openMailboxesOf([pr({ head: { ref: 'mailbox/os-bill' } })], 'os-bill').length, 1);
  t('found by the body line on another head', openMailboxesOf([pr({ body: 'Mailbox-of: os-bill\n\nx' })], 'os-bill').length, 1);
  t('login match is case-insensitive', openMailboxesOf([pr({ head: { ref: 'mailbox/OS-Bill' } })], 'os-bill').length, 1);
  t('without the label it is not a mailbox', openMailboxesOf([pr({ labels: [], head: { ref: 'mailbox/os-bill' } })], 'os-bill').length, 0);
  t('another login’s mailbox is not ours', openMailboxesOf([pr({ head: { ref: 'mailbox/os-elon' } })], 'os-bill').length, 0);
  t('a closed one does not block a new one', openMailboxesOf([pr({ state: 'closed', head: { ref: 'mailbox/os-bill' } })], 'os-bill').length, 0);

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

  battery('the CLI: dry run prints the actions file and sends nothing');
  const cli = (args) => spawnSync(process.execPath, [SELF_PATH, ...args], { encoding: 'utf8', env: { ...process.env, PATH: '/nonexistent', OS_FLEET_SESSION: '', CLAUDE_CODE_REMOTE_SESSION_ID: '' } });
  const dry = cli(['--repo', 'objectstack-ai/objectstack', '--login', 'os-bill', '--dry-run']);
  t('open dry run exits 0 with no gh/git on PATH (nothing reached for)', dry.status, EXIT_OK);
  const printed = dry.stdout.split('--- actions file ---\n')[1] ?? '';
  let parsed = null;
  try {
    parsed = JSON.parse(printed);
  } catch {}
  t('the printed actions file parses and is the plan', parsed?.[0]?.op === 'pr_create' && parsed?.[0]?.head === 'mailbox/os-bill', true);
  t('close dry run exits 0 and prints both actions', [cli(['--repo', 'o/r', '--close', '7', '--dry-run']).status, (cli(['--repo', 'o/r', '--close', '7', '--dry-run']).stdout.match(/"op":/g) ?? []).length], [EXIT_OK, 2]);
  t('a usage error is exit 2', cli(['--repo', 'o/r']).status, EXIT_USAGE);
  t('--help is exit 0', cli(['--help']).status, EXIT_OK);

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
