#!/usr/bin/env node
// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.
//
// check:objectui-pin-fresh — is `.objectui-sha` still CURRENT? (#3340 P0)
//
//   node scripts/check-objectui-pin-fresh.mjs            # enforcing: red when the pin lags
//   node scripts/check-objectui-pin-fresh.mjs --advisory  # report only, never blocks
//   node scripts/check-objectui-pin-fresh.mjs --ref v17.0.0   # judge against a tag
//   node scripts/check-objectui-pin-fresh.mjs --json
//   node scripts/check-objectui-pin-fresh.mjs --self-test
//
// ⚠️ NOT the same gate as ci.yml's "Console Pin Gate" (#4290). The names are
// close and the questions are opposite ends of the same fact:
//
//   Console Pin Gate (#4290)      "does the PINNED SHA still BUILD?"
//                                  → clones objectui AT the pin, builds the SPA.
//                                  Green means the pin is usable.
//   Console Pin Freshness (this)  "is the PIN still CURRENT?"
//                                  → compares the pin against objectui's `main`.
//                                  Green means the pin has nothing left behind.
//
// Either can be green while the other is red: a two-month-old pin builds
// perfectly (Pin Gate green) while hiding two months of frontend releases from
// the release record (this gate red). Neither substitutes for the other; do not
// delete one because the other exists.
//
// WHY THIS EXISTS (#3340)
// ----------------------
// The platform ships as one version-locked train, and the frontend enters the
// changesets pipeline exactly once: when `.objectui-sha` moves and
// `bump-objectui.sh` writes the `@objectstack/console` changeset for the range
// it crossed. Everything objectui merged AFTER the pin is, by construction,
// outside that range — it is in no changeset, no CHANGELOG, and no release page.
//
// Cutting v16 that way lost four frontend changes, two of them `minor` features
// (objectui#2701 / #2708 / #2707 / #2706): objectui `main` was 4 commits and 21
// pending changesets ahead of the pin at release time, and nothing anywhere
// said so. #4731 and #4843 made the two consumers read what objectui DECLARED
// instead of guessing from commit titles — but a correct reader of a range that
// STOPS TOO EARLY still reports a complete-looking, incomplete list. That
// blind spot (a lagging pin at release time) is what this gate closes.
//
// WHERE IT RUNS
// -------------
// On the **Version Packages / release PR**, as a required check — see
// `.github/workflows/objectui-pin-freshness.yml`. Deliberately NOT blocking on
// ordinary code PRs: between pin bumps the pin lags almost always, and that is
// normal, not a defect. The workflow still RUNS the gate on every PR (so the
// check context always reports and can therefore be *required* in branch
// protection) and passes `--advisory` outside the release lane.
//
// HOW IT READS objectui (no checkout required)
// --------------------------------------------
//   1. `git ls-remote` resolves the judging ref (default `main`) → head SHA.
//      THIS ALONE IS THE VERDICT: head === pin is fresh, head !== pin is stale.
//      A fresh pin therefore costs zero API calls.
//   2. Three lightweight GitHub API calls ITEMIZE an already-established lag:
//      `compare/<pin>...<head>` for the relationship + the commits ahead, and
//      the `.changeset` directory listing at each end to name what is
//      declared-but-unbundled. Because they only itemize, an API that is
//      rate-limited or unreachable degrades the report — loudly — and can never
//      turn a red into a green.
// A local `../objectui` checkout is used only to ENRICH the report further (the
// complete log-walk via `classifyRange`, the shared #4731/#4843 criterion).
// It never decides the verdict either, and its absence is stated out loud
// rather than skipped in silence.
//
// (Behind an HTTPS proxy, node's `fetch` ignores HTTPS_PROXY unless node runs
// with NODE_USE_ENV_PROXY=1. GitHub Actions needs no such thing.)
//
// NETWORK FAILURE IS NEVER GREEN
// ------------------------------
// An unreachable remote yields verdict `unreadable`, which exits 1 in enforcing
// mode and prints a `::warning::` in advisory mode. A freshness gate that goes
// green because the network hiccupped is worth exactly as much as no gate — it
// would have passed the v16 cut too.
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { classifyRange } from './objectui-changeset-digest.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PIN_FILE = join(REPO_ROOT, '.objectui-sha');
const USER_AGENT = 'objectstack-check-objectui-pin-fresh';

const short = (sha) => (sha ? String(sha).slice(0, 12) : '<none>');

/** The remote could not be read. Never a green verdict — see the header. */
export class RemoteUnreadable extends Error {}

// ---------------------------------------------------------------------------
// Reading objectui's current state
// ---------------------------------------------------------------------------

function apiHeaders() {
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN || '';
  const headers = {
    Accept: 'application/vnd.github+json',
    'User-Agent': USER_AGENT,
    'X-GitHub-Api-Version': '2022-11-28',
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

async function apiJson(url, { allow404 = false } = {}) {
  let res;
  try {
    res = await fetch(url, { headers: apiHeaders() });
  } catch (err) {
    throw new RemoteUnreadable(`GET ${url} — ${err.message}`);
  }
  if (res.status === 404 && allow404) return null;
  if (!res.ok) {
    const exhausted = res.headers.get('x-ratelimit-remaining') === '0';
    throw new RemoteUnreadable(
      `GET ${url} → HTTP ${res.status}` +
        (exhausted ? ' (GitHub API rate limit exhausted — set GITHUB_TOKEN)' : ''),
    );
  }
  try {
    return await res.json();
  } catch (err) {
    throw new RemoteUnreadable(`GET ${url} → response was not JSON (${err.message})`);
  }
}

/** Resolve a branch or tag in the objectui remote to a commit SHA. */
export function resolveRemoteRef(repoUrl, ref) {
  let out;
  try {
    out = execFileSync('git', ['ls-remote', repoUrl, ref, `refs/heads/${ref}`, `refs/tags/${ref}`], {
      encoding: 'utf8',
      timeout: 120_000,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (err) {
    const detail = String(err.stderr || err.message || '').trim().split('\n').pop();
    throw new RemoteUnreadable(`git ls-remote ${repoUrl} ${ref} — ${detail || 'failed'}`);
  }
  const refs = out
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [sha, name] = line.split('\t');
      return { sha, name };
    });
  if (!refs.length) throw new RemoteUnreadable(`ref '${ref}' does not exist in ${repoUrl}`);
  // Annotated tags: the peeled `^{}` entry is the commit the tag points AT.
  const pick =
    refs.find((r) => r.name === `refs/tags/${ref}^{}`) ||
    refs.find((r) => r.name === `refs/heads/${ref}`) ||
    refs.find((r) => r.name === `refs/tags/${ref}`) ||
    refs[0];
  return pick.sha;
}

/** `.changeset/*.md` filenames in a listing, minus the non-changeset residents. */
function changesetNames(listing) {
  if (!Array.isArray(listing)) return new Set();
  return new Set(
    listing
      .filter((e) => e.type === 'file' && e.name.endsWith('.md') && e.name !== 'README.md')
      .map((e) => e.name),
  );
}

/**
 * objectui's current state relative to the pin.
 *
 * THE VERDICT NEVER DEPENDS ON THE API. `git ls-remote` alone decides it:
 * head === pin is fresh, head !== pin is stale. The three API calls only
 * ITEMIZE a lag that is already established — how far, which commits, which
 * changesets. So an API that is rate-limited, proxied away or down degrades the
 * report and never the judgement, and it can never flip a red to green. When
 * itemization fails, `itemizationError` carries the reason and the renderer
 * prints it — a degradation that does not announce itself is the failure mode
 * this whole gate exists to prevent.
 *
 * @returns {Promise<{ source: string, headSha: string, status: string, aheadBy: number, behindBy: number, commits: Array<{sha:string,subject:string}>, pendingChangesets: string[], itemized: boolean, itemizationError: string|null }>}
 */
export async function readRemoteState({ repo, repoUrl, ref, pin }) {
  const headSha = resolveRemoteRef(repoUrl, ref);

  // Happy path: the pin IS the judging ref. Nothing can be behind it, so the
  // verdict is settled without touching the API at all.
  if (headSha === pin) {
    return {
      source: 'remote',
      headSha,
      status: 'identical',
      aheadBy: 0,
      behindBy: 0,
      commits: [],
      pendingChangesets: [],
      itemized: true,
      itemizationError: null,
    };
  }

  const api = `https://api.github.com/repos/${repo}`;
  try {
    const cmp = await apiJson(`${api}/compare/${pin}...${headSha}`);
    const [headListing, pinListing] = await Promise.all([
      apiJson(`${api}/contents/.changeset?ref=${headSha}`, { allow404: true }),
      apiJson(`${api}/contents/.changeset?ref=${pin}`, { allow404: true }),
    ]);

    const atHead = changesetNames(headListing);
    const atPin = changesetNames(pinListing);

    return {
      source: 'remote',
      headSha,
      status: cmp.status || 'unknown',
      aheadBy: cmp.ahead_by ?? 0,
      behindBy: cmp.behind_by ?? 0,
      // compare returns oldest-first and caps at 250; `aheadBy` stays authoritative.
      commits: (cmp.commits || [])
        .map((c) => ({ sha: c.sha, subject: String(c.commit?.message || '').split('\n')[0] }))
        .reverse(),
      // Endpoint diff — a LOWER BOUND, see `localEnrichment`.
      pendingChangesets: [...atHead].filter((n) => !atPin.has(n)).sort(),
      itemized: true,
      itemizationError: null,
    };
  } catch (err) {
    if (!(err instanceof RemoteUnreadable)) throw err;
    return {
      source: 'remote',
      headSha,
      status: 'not-itemized',
      aheadBy: 0,
      behindBy: 0,
      commits: [],
      pendingChangesets: [],
      itemized: false,
      itemizationError: err.message,
    };
  }
}

// ---------------------------------------------------------------------------
// The verdict
// ---------------------------------------------------------------------------

/**
 * Judge a pin against the remote state. The two red conditions of #3340 P0:
 *   1. the judging ref is AHEAD of the pin (frontend commits are unbundled);
 *   2. changesets exist at the judging ref that do not exist at the pin
 *      (frontend changes DECLARED after the pin — named, one per line).
 *
 * (2) is normally implied by (1) and exists to itemize it, but it is judged
 * independently on purpose: the day the two disagree is the day one of them is
 * wrong, and a gate that only ever consulted (1) would not notice.
 */
export function evaluate({ pin, ref, remote }) {
  const reasons = [];

  if (remote.headSha !== pin) {
    if (remote.status === 'ahead') {
      reasons.push(
        `objectui \`${ref}\` is ${remote.aheadBy} commit(s) AHEAD of the pin — ` +
          `everything in that range is outside the @objectstack/console changeset range.`,
      );
    } else if (remote.status === 'diverged') {
      reasons.push(
        `the pin and objectui \`${ref}\` have DIVERGED (${remote.aheadBy} ahead, ` +
          `${remote.behindBy} behind) — the pin is not on \`${ref}\` at all.`,
      );
    } else if (remote.status === 'behind') {
      reasons.push(
        `the pin is ${remote.behindBy} commit(s) ahead of objectui \`${ref}\` — it points ` +
          `at something \`${ref}\` has not reached (an unmerged branch, or a rewritten history).`,
      );
    } else if (remote.status === 'not-itemized') {
      reasons.push(
        `objectui \`${ref}\` (objectui@${short(remote.headSha)}) is not the pinned commit — ` +
          `frontend changes exist that no @objectstack/console changeset covers. ` +
          `How many, and which, could not be itemized (see the warning below).`,
      );
    } else {
      reasons.push(
        `the pin does not equal objectui \`${ref}\` (compare status: ${remote.status}).`,
      );
    }
  }

  if (remote.pendingChangesets.length) {
    reasons.push(
      `${remote.pendingChangesets.length} changeset(s) declared in objectui after the pin are ` +
        `not bundled into @objectstack/console at this pin.`,
    );
  }

  return {
    verdict: reasons.length ? 'stale' : 'fresh',
    pin,
    ref,
    reasons,
    ...remote,
  };
}

/**
 * OPTIONAL enrichment from a local checkout — never the verdict.
 *
 * The remote pending list is an ENDPOINT DIFF, so it cannot see a changeset
 * that was added and then consumed by an objectui release inside the range. A
 * local checkout can walk the log, which is what `classifyRange` (the shared
 * #4731/#4843 criterion) does. When there is no usable checkout we say so —
 * an unstated omission here is the exact failure mode this gate exists for.
 */
export function localEnrichment({ pin, headSha, objectuiRoot }) {
  const root = objectuiRoot || process.env.OBJECTUI_ROOT || join(REPO_ROOT, '..', 'objectui');
  if (!existsSync(join(root, '.git'))) {
    return {
      available: false,
      reason:
        `no objectui checkout at ${root} — the pending list above is the endpoint-diff ` +
        `LOWER BOUND. Set OBJECTUI_ROOT (or clone objectui as a sibling) for the complete log-walk.`,
    };
  }
  for (const sha of [pin, headSha]) {
    try {
      execFileSync('git', ['-C', root, 'cat-file', '-e', `${sha}^{commit}`], { stdio: 'ignore' });
    } catch {
      return {
        available: false,
        reason:
          `objectui checkout at ${root} does not contain ${short(sha)} — the pending list above ` +
          `is the endpoint-diff LOWER BOUND. Refresh it: git -C ${root} fetch --all`,
      };
    }
  }
  try {
    const classified = classifyRange({ objectuiRoot: root, from: pin, to: headSha });
    return { available: true, root, ...classified };
  } catch (err) {
    return { available: false, reason: `cannot walk the range in ${root} — ${err.message}` };
  }
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

const COUSIN_NOTE =
  'This is NOT ci.yml\'s "Console Pin Gate" (#4290). That gate proves the pinned SHA still\n' +
  '  BUILDS; this one proves the pin is still CURRENT. Either can be green while the other is red.';

export function renderVerdict(result, { repo, enrichment, maxCommits = 10 } = {}) {
  const out = [];
  const { verdict, pin, ref, headSha } = result;

  if (verdict === 'fresh') {
    out.push(
      `✓ objectui pin is FRESH — .objectui-sha is objectui \`${ref}\` (objectui@${short(pin)}).`,
      '',
      `  Nothing objectui has merged is outside the @objectstack/console changeset range.`,
      `  ${COUSIN_NOTE}`,
    );
    return out.join('\n');
  }

  if (verdict === 'unreadable') {
    out.push(
      `✗ objectui pin freshness is UNKNOWN — could not read ${repo}.`,
      '',
      `    pinned (.objectui-sha):  objectui@${short(pin)}`,
      `    judging ref:             ${repo} ${ref}`,
      `    failure:                 ${result.error}`,
      '',
      `  Treated as a FAILURE, never as a pass: a freshness gate that goes green on a network`,
      `  error would have passed the v16 cut this gate exists to prevent (#3340).`,
      '',
      `  If GitHub is reachable but the API is rate-limited, export GITHUB_TOKEN and re-run.`,
    );
    return out.join('\n');
  }

  const label = (text) => `    ${text.padEnd(Math.max(26, `${repo} ${ref}`.length + 2))}`;
  out.push(
    `✗ objectui pin is STALE — .objectui-sha no longer describes objectui \`${ref}\`.`,
    '',
    `${label('pinned (.objectui-sha):')}objectui@${short(pin)}`,
    `${label(`${repo} ${ref}:`)}objectui@${short(headSha)}`,
    `${label('relationship:')}${result.status} (${result.aheadBy} ahead, ${result.behindBy} behind)`,
    '',
  );
  for (const reason of result.reasons) out.push(`  • ${reason}`);

  if (result.itemized === false) {
    out.push(
      '',
      `  ⚠ Itemization unavailable — the GitHub API could not be read:`,
      `      ${result.itemizationError}`,
      `    The VERDICT does not depend on it: \`git ls-remote\` already proved the pin is not`,
      `    ${ref}. Only the "how far / which changesets" detail is missing.`,
      `    (Behind an HTTPS proxy, node's fetch ignores HTTPS_PROXY unless you run it with`,
      `     NODE_USE_ENV_PROXY=1.)`,
    );
  }

  if (result.pendingChangesets.length) {
    out.push(
      '',
      `  Frontend changes DECLARED after the pin — ${result.pendingChangesets.length} changeset(s)`,
      `  present at ${ref} and absent at the pin:`,
      ...result.pendingChangesets.map((n) => `    - ${n}`),
    );
  } else if (result.headSha !== pin && result.itemized !== false) {
    out.push(
      '',
      `  No changeset file is present at ${ref} and absent at the pin. That is NOT proof the`,
      `  range ships nothing — see the lower-bound note below.`,
    );
  }

  if (result.commits.length) {
    const shown = result.commits.slice(0, maxCommits);
    out.push(
      '',
      `  Commits ahead of the pin (newest first, ${shown.length} of ${result.aheadBy}):`,
      ...shown.map((c) => `    - ${c.sha.slice(0, 9)} ${c.subject}`),
    );
  }

  if (enrichment?.available) {
    const levels = { major: 0, minor: 0, patch: 0 };
    for (const r of enrichment.releasing) levels[r.level] = (levels[r.level] || 0) + 1;
    out.push(
      '',
      `  Complete log-walk (local checkout at ${enrichment.root}, the shared #4731/#4843 criterion):`,
      `    ${enrichment.releasing.length} releasing changeset(s) — ` +
        `${levels.major} major / ${levels.minor} minor / ${levels.patch} patch — ` +
        `of ${enrichment.changesetsAdded} added across ${enrichment.totalCommits} non-merge commit(s);`,
      `    ${enrichment.releaseNothing} release-nothing, ${enrichment.noChangeset} commit(s) with no changeset.`,
      ...enrichment.releasing
        .slice(0, maxCommits)
        .map((r) => `    - [${r.level}] ${r.summary} (objectui \`${r.sha.slice(0, 9)}\`)`),
    );
  } else if (enrichment) {
    out.push('', `  ⚠ ${enrichment.reason}`);
  }

  out.push(
    '',
    `  Why this blocks the release PR: the @objectstack/console changeset only ever covers`,
    `  OLD_PIN..NEW_PIN. Everything above is outside that range, so it reaches no changeset, no`,
    `  CHANGELOG and no release page — and a complete-looking release record is indistinguishable`,
    `  from a complete one (#3340, the v16 cut).`,
    '',
    `  Fix — move the pin, then let the Version Packages PR rebuild:`,
    `      scripts/bump-objectui.sh                 # bump to objectui ${ref}, writes the changeset`,
    `      node scripts/objectui-range.mjs <old> <new>   # the Console section for the release page`,
    '',
    `  ${COUSIN_NOTE}`,
  );
  return out.join('\n');
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function readPin() {
  if (!existsSync(PIN_FILE)) {
    throw new Error(`.objectui-sha is missing at ${PIN_FILE} — cannot determine the pinned commit.`);
  }
  const pin = readFileSync(PIN_FILE, 'utf8').trim();
  if (!/^[0-9a-f]{40}$/i.test(pin)) {
    throw new Error(`.objectui-sha does not contain a full 40-char SHA (got '${pin}').`);
  }
  return pin;
}

async function main(argv) {
  const has = (f) => argv.includes(f);
  const val = (f, d) => {
    const i = argv.indexOf(f);
    return i >= 0 && argv[i + 1] !== undefined ? argv[i + 1] : d;
  };

  if (has('-h') || has('--help')) {
    console.log(
      readFileSync(fileURLToPath(import.meta.url), 'utf8')
        .split('\n')
        .filter((l) => l.startsWith('//'))
        .map((l) => l.slice(3))
        .join('\n'),
    );
    return 0;
  }
  if (has('--self-test')) return selfTest();

  const advisory = has('--advisory');
  const asJson = has('--json');
  const repo = val('--repo', process.env.OBJECTUI_REPO || 'objectstack-ai/objectui');
  const repoUrl = process.env.OBJECTUI_REPO_URL || `https://github.com/${repo}.git`;
  const ref = val('--ref', 'main');
  // Self-test only: read the remote state from a JSON file instead of the
  // network, so the real CLI (exit codes included) can be exercised. Every
  // fixture run SAYS SO in its output — it can never pass for a real verdict.
  const fixture = val('--fixture', '');

  const pin = readPin();

  let result;
  let enrichment;
  try {
    const remote = fixture
      ? JSON.parse(readFileSync(fixture, 'utf8'))
      : await readRemoteState({ repo, repoUrl, ref, pin });
    if (remote.__throw) throw new RemoteUnreadable(remote.__throw);
    result = evaluate({ pin, ref, remote });
    if (result.verdict === 'stale' && result.headSha && result.headSha !== pin && !fixture) {
      enrichment = localEnrichment({ pin, headSha: result.headSha });
    }
  } catch (err) {
    if (!(err instanceof RemoteUnreadable)) throw err;
    result = {
      verdict: 'unreadable',
      pin,
      ref,
      error: err.message,
      reasons: [err.message],
      headSha: null,
      status: 'unreadable',
      aheadBy: 0,
      behindBy: 0,
      commits: [],
      pendingChangesets: [],
      itemized: false,
      itemizationError: err.message,
    };
  }

  if (fixture) {
    console.error(`⚠ REMOTE STATE READ FROM FIXTURE ${fixture} — self-test output, not a real verdict.`);
  }

  if (asJson) {
    console.log(JSON.stringify({ ...result, repo, advisory, enrichment: enrichment ?? null }, null, 2));
  } else {
    console.log(renderVerdict(result, { repo, enrichment }));
  }

  if (result.verdict === 'fresh') return 0;

  if (advisory) {
    // Loud, and still not green-looking: the body above already printed the
    // full STALE/UNKNOWN report. Only the exit code is relaxed, because a
    // lagging pin between bumps is the normal state of an ordinary code PR.
    console.error(
      `\n::${result.verdict === 'unreadable' ? 'warning' : 'notice'}::objectui pin ` +
        `${result.verdict === 'unreadable' ? 'freshness is UNKNOWN' : 'is STALE'} — advisory here ` +
        `(this gate only blocks the Version Packages / release PR, where a lagging pin drops ` +
        `frontend changes from the release record). See #3340.`,
    );
    return 0;
  }
  console.error(
    `\n::error::objectui pin ${result.verdict === 'unreadable' ? 'freshness could not be verified' : 'is stale'} ` +
      `— refresh .objectui-sha before releasing (#3340).`,
  );
  return 1;
}

// ---------------------------------------------------------------------------
// Self-test — the repo idiom for a scripts/ gate: drive the real code (and the
// real CLI, exit codes included) over fabricated remote states.
// ---------------------------------------------------------------------------

function selfTest() {
  const failures = [];
  const check = (name, cond, detail = '') => {
    if (cond) {
      console.log(`  ✓ ${name}`);
    } else {
      failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
      console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`);
    }
  };

  console.log('check-objectui-pin-fresh --self-test');

  const PIN = 'a'.repeat(40);
  const HEAD = 'b'.repeat(40);
  const repo = 'objectstack-ai/objectui';

  const state = (over = {}) => ({
    source: 'remote',
    headSha: HEAD,
    status: 'ahead',
    aheadBy: 4,
    behindBy: 0,
    commits: [
      { sha: 'c'.repeat(40), subject: 'feat(import): auto policy for the import wizard (#2701)' },
      { sha: 'd'.repeat(40), subject: 'feat(schema): key-value field editor (#2708)' },
    ],
    pendingChangesets: [
      'import-wizard-auto-policy.md',
      'schema-fields-keyvalue.md',
      'action-param-upload-guard.md',
    ].sort(),
    itemized: true,
    itemizationError: null,
    ...over,
  });

  // --- 1. a lagging pin is RED, and names what it left behind ---------------
  const stale = evaluate({ pin: PIN, ref: 'main', remote: state() });
  const staleText = renderVerdict(stale, { repo });
  check('a pin behind objectui main is STALE', stale.verdict === 'stale', stale.verdict);
  check(
    'the report states the lag in commits',
    staleText.includes('4 commit(s) AHEAD of the pin'),
    staleText,
  );
  check(
    'every pending changeset is listed BY NAME, not just counted',
    ['import-wizard-auto-policy.md', 'schema-fields-keyvalue.md', 'action-param-upload-guard.md'].every(
      (n) => staleText.includes(`- ${n}`),
    ),
    staleText,
  );
  check(
    'the report names the remedy (bump-objectui.sh)',
    staleText.includes('scripts/bump-objectui.sh'),
    staleText,
  );
  check(
    'the report distinguishes itself from the #4290 Console Pin Gate',
    staleText.includes('#4290') && staleText.includes('BUILDS') && staleText.includes('CURRENT'),
    staleText,
  );

  // --- 2. a current pin is GREEN -------------------------------------------
  const fresh = evaluate({
    pin: PIN,
    ref: 'main',
    remote: state({ headSha: PIN, status: 'identical', aheadBy: 0, commits: [], pendingChangesets: [] }),
  });
  check('a pin equal to objectui main is FRESH', fresh.verdict === 'fresh', fresh.verdict);
  check(
    'the FRESH report still explains what it did NOT prove (#4290)',
    renderVerdict(fresh, { repo }).includes('#4290'),
  );

  // --- 3. pending changesets are judged on their own -----------------------
  // Contrived (a current pin cannot have unbundled changesets), and that is the
  // point: condition 2 must be a real condition, not decoration on condition 1.
  const pendingOnly = evaluate({
    pin: PIN,
    ref: 'main',
    remote: state({
      headSha: PIN,
      status: 'identical',
      aheadBy: 0,
      commits: [],
      pendingChangesets: ['landed-not-bundled.md'],
    }),
  });
  check(
    'pending unbundled changesets alone make the verdict STALE',
    pendingOnly.verdict === 'stale',
    pendingOnly.verdict,
  );
  check(
    'that verdict names the changeset',
    renderVerdict(pendingOnly, { repo }).includes('- landed-not-bundled.md'),
  );

  // --- 4. diverged / behind are red too ------------------------------------
  check(
    'a diverged pin is STALE',
    evaluate({ pin: PIN, ref: 'main', remote: state({ status: 'diverged', behindBy: 2 }) }).verdict ===
      'stale',
  );
  check(
    'a pin ahead of the judging ref is STALE (loudly, as its own case)',
    renderVerdict(
      evaluate({
        pin: PIN,
        ref: 'main',
        remote: state({ status: 'behind', aheadBy: 0, behindBy: 3, pendingChangesets: [] }),
      }),
      { repo },
    ).includes('has not reached'),
  );

  // --- 5. the API being unreadable degrades the REPORT, never the verdict --
  // `git ls-remote` succeeded, so the lag is already proved; only the "how far
  // / which changesets" detail is missing. This must stay RED — an itemizer
  // outage that turned a lagging pin green is the #3340 failure with extra
  // steps.
  const notItemized = evaluate({
    pin: PIN,
    ref: 'main',
    remote: state({
      status: 'not-itemized',
      aheadBy: 0,
      behindBy: 0,
      commits: [],
      pendingChangesets: [],
      itemized: false,
      itemizationError: 'GET https://api.github.com/… → HTTP 403 (rate limit)',
    }),
  });
  const notItemizedText = renderVerdict(notItemized, { repo });
  check(
    'an unreadable GitHub API still yields STALE when ls-remote proved the lag',
    notItemized.verdict === 'stale',
    notItemized.verdict,
  );
  check(
    'and the degraded itemization is announced with its reason',
    notItemizedText.includes('Itemization unavailable') && notItemizedText.includes('HTTP 403'),
    notItemizedText,
  );
  check(
    'while stating the verdict did not depend on it',
    notItemizedText.includes('The VERDICT does not depend on it'),
    notItemizedText,
  );

  // --- 6. the enrichment absence is STATED, never silent -------------------
  const missing = localEnrichment({
    pin: PIN,
    headSha: HEAD,
    objectuiRoot: join(tmpdir(), 'definitely-not-an-objectui-checkout'),
  });
  check('a missing local checkout is reported, not skipped', missing.available === false);
  check(
    'and it says the remote pending list is a LOWER BOUND',
    /LOWER BOUND/.test(missing.reason),
    missing.reason,
  );

  // --- 7. end-to-end through the real CLI, exit codes included -------------
  const tmp = mkdtempSync(join(tmpdir(), 'pin-fresh-selftest-'));
  try {
    const cli = fileURLToPath(import.meta.url);
    const fixtureFile = (name, obj) => {
      const p = join(tmp, `${name}.json`);
      mkdirSync(dirname(p), { recursive: true });
      writeFileSync(p, JSON.stringify(obj));
      return p;
    };
    const run = (args) => {
      const r = spawnSync('node', [cli, ...args], { encoding: 'utf8' });
      return { code: r.status ?? 1, stdout: r.stdout || '', out: `${r.stdout || ''}${r.stderr || ''}` };
    };

    // The CLI reads the REAL .objectui-sha; the fixture supplies only the
    // remote side, so `headSha: <the real pin>` is what "fresh" looks like.
    const realPin = readPin();

    const staleRun = run(['--fixture', fixtureFile('stale', state())]);
    check('CLI exits 1 on a stale pin', staleRun.code === 1, `code ${staleRun.code}`);
    check(
      'CLI output says STALE and names a pending changeset',
      staleRun.out.includes('STALE') && staleRun.out.includes('import-wizard-auto-policy.md'),
      staleRun.out,
    );
    check(
      'a fixture run announces itself as a fixture run',
      staleRun.out.includes('FIXTURE'),
      staleRun.out,
    );

    const freshRun = run([
      '--fixture',
      fixtureFile('fresh', {
        headSha: realPin,
        status: 'identical',
        aheadBy: 0,
        behindBy: 0,
        commits: [],
        pendingChangesets: [],
      }),
    ]);
    check('CLI exits 0 on a current pin', freshRun.code === 0, `code ${freshRun.code}`);
    check('CLI output says FRESH', freshRun.out.includes('FRESH'), freshRun.out);

    // --- the one that matters most: a network failure must never be green ---
    const netFixture = fixtureFile('net', { __throw: 'getaddrinfo ENOTFOUND github.com' });
    const netRun = run(['--fixture', netFixture]);
    check('CLI exits 1 when the remote cannot be read', netRun.code === 1, `code ${netRun.code}`);
    check(
      'a network failure never renders as FRESH',
      netRun.out.includes('UNKNOWN') && !netRun.out.includes('is FRESH'),
      netRun.out,
    );
    check(
      'the network failure reason is printed verbatim',
      netRun.out.includes('ENOTFOUND'),
      netRun.out,
    );

    const netAdvisory = run(['--advisory', '--fixture', netFixture]);
    check(
      'advisory mode does not block on an unreadable remote…',
      netAdvisory.code === 0,
      `code ${netAdvisory.code}`,
    );
    check(
      '…but WARNS, and still never claims freshness',
      netAdvisory.out.includes('::warning::') && !netAdvisory.out.includes('is FRESH'),
      netAdvisory.out,
    );

    const staleAdvisory = run(['--advisory', '--fixture', fixtureFile('stale2', state())]);
    check(
      'advisory mode does not block on a stale pin (ordinary code PRs)',
      staleAdvisory.code === 0,
      `code ${staleAdvisory.code}`,
    );
    check(
      '…while the body still reports STALE in full',
      staleAdvisory.out.includes('STALE') && staleAdvisory.out.includes('::notice::'),
      staleAdvisory.out,
    );

    const jsonRun = run(['--json', '--fixture', fixtureFile('stale3', state())]);
    const parsed = JSON.parse(jsonRun.stdout);
    check(
      'JSON output carries the verdict, the lag and the pending list',
      parsed.verdict === 'stale' && parsed.aheadBy === 4 && parsed.pendingChangesets.length === 3,
      jsonRun.out,
    );
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }

  if (failures.length) {
    console.error(`\n⛔ check-objectui-pin-fresh --self-test: ${failures.length} failure(s)`);
    for (const f of failures) console.error(`   - ${f}`);
    return 1;
  }
  console.log('✓ check-objectui-pin-fresh --self-test: all checks passed');
  return 0;
}

if (resolve(process.argv[1] ?? '') === resolve(fileURLToPath(import.meta.url))) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (err) => {
      console.error(`✗ check:objectui-pin-fresh — ${err.message}`);
      process.exit(1);
    },
  );
}
