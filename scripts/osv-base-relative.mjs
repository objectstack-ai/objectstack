#!/usr/bin/env node
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * osv-base-relative -- the pull_request verdict of the OSV step in
 * .github/workflows/validate-deps.yml: judge the pull request's OSV findings
 * against the merge base's, not against an empty set.
 *
 *   node scripts/osv-base-relative.mjs \
 *     --base-results <json> --base-outcome <outcome> \
 *     --head-results <json> --head-outcome <outcome> [--base-sha <sha>]
 *   node scripts/osv-base-relative.mjs --self-test
 *
 * ## What it decides (the ruling recorded on the card that asked for it)
 *
 * The workflow scans two lockfiles with the same pinned OSV-Scanner action and
 * hands this script both JSON result files and both step outcomes:
 *
 *   - the merge base's `pnpm-lock.yaml`, judged by the merge base's own
 *     `osv-scanner.toml` -- exactly what `main`'s scheduled scan judges;
 *   - the pull request's `pnpm-lock.yaml`, judged by the pull request's own
 *     `osv-scanner.toml` -- exactly what the absolute scan judged before.
 *
 * An advisory matched by BOTH is INHERITED: it is reported in a notice that
 * names it and, when one exists, the open finding card that names it, and it
 * does not fail the step -- it is `main`'s to fix, and `main`'s daily scan is
 * the signal that files its card. An advisory matched ONLY by the pull
 * request's lockfile is INTRODUCED and fails the step, as the absolute scan
 * did. The unit is the advisory id; the package versions each side matched are
 * printed beside it, so a pull request that adds another vulnerable version of
 * an inherited advisory shows that in its notice.
 *
 * Each side is scanned with its OWN ledger. Scanning the base with the pull
 * request's ledger would let a pull request that deletes an exemption read the
 * advisory it re-exposes as inherited; scanning the head with the base's would
 * fail the pull request that adds one.
 *
 * ## Fail-closed, because the outcome alone cannot tell findings from errors
 *
 * The action is a container action, so the workflow sees only the step's
 * outcome, never the scanner's exit code. Measured against osv-scanner 2.5.0
 * (the binary the pinned action's image ships), with `--config` and
 * `--output-file` set as the workflow sets them:
 *
 *   exit 0    result file written, zero findings
 *   exit 1    result file written, one or more findings
 *   exit 127  NO result file (unreadable or unknown-key config, missing
 *             lockfile, or a failed database query)
 *   exit 128  NO result file (no packages found) -- and the action's wrapper
 *             rewrites 128 to 0, so this one arrives as a SUCCESS outcome
 *
 * So a side is read only when its result file parses AND its outcome agrees
 * with its finding count (success <=> zero, failure <=> some). Anything else
 * is a scan that did not reach a verdict, and the step fails naming the side.
 * The upstream `osv-reporter` was not used for this reason: it reads a missing
 * new-side result file as "no findings" and exits 0.
 *
 * Exit codes: 0 = nothing introduced; 1 = an advisory introduced, or a side
 * without a verdict; 2 = usage.
 */

import { existsSync, readFileSync } from 'node:fs';

import { isEntrypoint } from './invoked-as.mjs';

const OUTCOMES = new Set(['success', 'failure']);
const ANCHOR_PAGE_CAP = 10;

// ── Reading one side ────────────────────────────────────────────────────────

/**
 * Read one scan's result file against its step outcome.
 * Returns `{ findings: Map<id, Set<'name@version'>> }` or `{ error }`.
 */
export function readSide(label, text, outcome) {
  if (!OUTCOMES.has(outcome)) {
    return { error: `the OSV-Scanner step on the ${label} lockfile has outcome '${outcome}', not a verdict` };
  }
  if (text === null) {
    return {
      error:
        `the OSV-Scanner step on the ${label} lockfile wrote no result file (outcome '${outcome}'): ` +
        'the scanner errored before judging (unreadable ledger, missing lockfile, no packages, or a failed ' +
        'database query) -- read that step\'s log',
    };
  }
  let doc;
  try {
    doc = JSON.parse(text);
  } catch (e) {
    return { error: `the ${label} result file is not JSON (${e.message})` };
  }
  if (!doc || !Array.isArray(doc.results)) {
    return { error: `the ${label} result file has no 'results' array` };
  }
  const findings = new Map();
  let count = 0;
  for (const source of doc.results) {
    for (const pkg of source?.packages ?? []) {
      const name = pkg?.package?.name;
      const version = pkg?.package?.version;
      for (const vuln of pkg?.vulnerabilities ?? []) {
        if (typeof vuln?.id !== 'string' || vuln.id === '') {
          return { error: `the ${label} result file has a vulnerability without an id` };
        }
        count += 1;
        if (!findings.has(vuln.id)) findings.set(vuln.id, new Set());
        findings.get(vuln.id).add(`${name}@${version}`);
      }
    }
  }
  if (outcome === 'success' && count > 0) {
    return {
      error:
        `the ${label} scan reports ${count} finding(s) but its step succeeded -- the outcome and the result ` +
        'file disagree, so neither is read',
    };
  }
  if (outcome === 'failure' && count === 0) {
    return {
      error:
        `the OSV-Scanner step on the ${label} lockfile failed with zero findings in its result file: ` +
        'the scanner errored rather than judging -- read that step\'s log',
    };
  }
  return { findings };
}

// ── The comparison ──────────────────────────────────────────────────────────

const sorted = (set) => [...set].sort();

/** Split the head's findings into introduced and inherited; list the resolved. */
export function compare(base, head) {
  const introduced = [];
  const inherited = [];
  const resolved = [];
  for (const id of sorted(head.keys())) {
    const headPkgs = sorted(head.get(id));
    if (base.has(id)) inherited.push({ id, headPkgs, basePkgs: sorted(base.get(id)) });
    else introduced.push({ id, headPkgs });
  }
  for (const id of sorted(base.keys())) {
    if (!head.has(id)) resolved.push({ id, basePkgs: sorted(base.get(id)) });
  }
  return { introduced, inherited, resolved };
}

// ── Anchor finding cards (informational; never part of the verdict) ─────────

/**
 * Find the open issues whose title or body names each id. One repo-scoped
 * listing of the open issues serves every id: it has no search-index lag, so a
 * finding card filed minutes ago is found, and it does not depend on the card
 * carrying a label (the red-main cards have not all carried the same ones).
 * A seat's board post (label `pm:seat`) quotes advisories in passing and is
 * never a finding card, so it is skipped.
 * Returns Map<id, { cards: [{ number, title }] } | { error }>.
 */
const isBoardPost = (it) => (it?.labels ?? []).some((l) => (typeof l === 'string' ? l : l?.name) === 'pm:seat');

export async function findAnchors(ids, { repo, token, fetchImpl }) {
  const out = new Map();
  const failAll = (error) => {
    for (const id of ids) out.set(id, { error });
    return out;
  };
  if (ids.length === 0) return out;
  if (!repo) return failAll('not looked up (GITHUB_REPOSITORY unset)');
  const headers = {
    accept: 'application/vnd.github+json',
    'user-agent': 'objectstack-osv-base-relative',
    'x-github-api-version': '2022-11-28',
  };
  if (token) headers.authorization = `Bearer ${token}`;
  const issues = [];
  try {
    for (let page = 1; ; page += 1) {
      if (page > ANCHOR_PAGE_CAP) {
        return failAll(`lookup incomplete (more than ${ANCHOR_PAGE_CAP * 100} open issues and pull requests)`);
      }
      const url = `https://api.github.com/repos/${repo}/issues?state=open&per_page=100&page=${page}`;
      const res = await fetchImpl(url, { headers, signal: AbortSignal.timeout(15000) });
      if (!res.ok) return failAll(`lookup answered HTTP ${res.status}`);
      const batch = await res.json();
      if (!Array.isArray(batch)) return failAll('lookup answered something other than a list');
      issues.push(...batch.filter((it) => !it?.pull_request && !isBoardPost(it)));
      if (batch.length < 100) break;
    }
  } catch (e) {
    return failAll(`lookup failed (${e?.name ?? 'Error'}: ${e?.message ?? e})`);
  }
  for (const id of ids) {
    const cards = issues
      .filter((it) => `${it.title ?? ''}\n${it.body ?? ''}`.includes(id))
      .map((it) => ({ number: it.number, title: it.title ?? '' }))
      .sort((a, b) => a.number - b.number);
    out.set(id, { cards });
  }
  return out;
}

// ── Rendering ───────────────────────────────────────────────────────────────

// The runner's workflow-command escaping (the same rules as @actions/core).
export const escapeData = (s) => String(s).replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
export const escapeProperty = (s) => escapeData(s).replace(/:/g, '%3A').replace(/,/g, '%2C');
const command = (kind, title, message) => `::${kind} title=${escapeProperty(title)}::${escapeData(message)}`;

function anchorText(anchor) {
  if (!anchor) return 'anchor finding card: not looked up';
  if (anchor.error) return `anchor finding card: ${anchor.error}`;
  if (anchor.cards.length === 0) {
    return 'no open issue names it yet; main\'s daily scheduled scan is the signal that files its finding card';
  }
  return `anchor finding card: ${anchor.cards.slice(0, 3).map((c) => `#${c.number}`).join(', ')}`;
}

/** Every line the verdict prints, in order, and the exit code. Pure. */
export function render({ errors, verdict, anchors, baseSha }) {
  const lines = [];
  const at = baseSha ? ` (${baseSha.slice(0, 12)})` : '';
  if (errors.length > 0) {
    for (const e of errors) lines.push(command('error', 'OSV base-relative verdict unavailable', e));
    lines.push('OSV base-relative verdict: NONE -- a scan did not reach a verdict, so this step fails closed.');
    return { lines, code: 1 };
  }
  const { introduced, inherited, resolved } = verdict;
  for (const f of inherited) {
    lines.push(
      command(
        'notice',
        'OSV advisory inherited from the merge base',
        `${f.id} (here: ${f.headPkgs.join(', ')}; at the merge base: ${f.basePkgs.join(', ')}) is matched by ` +
          `the merge base's lockfile${at} too, so it is main's to fix and does not fail this pull request; ` +
          `${anchorText(anchors.get(f.id))}.`,
      ),
    );
  }
  for (const f of introduced) {
    lines.push(
      command(
        'error',
        'OSV advisory introduced by this pull request',
        `${f.id} (${f.headPkgs.join(', ')}) is matched by this pull request's lockfile and not by the merge base's${at}. ` +
          'Take the fixed version; an advisory with no fix goes through the osv-scanner.toml ledger in its own PR.',
      ),
    );
  }
  lines.push(
    `OSV base-relative verdict against the merge base${at}: ${introduced.length} introduced, ` +
      `${inherited.length} inherited, ${resolved.length} resolved.`,
  );
  for (const f of introduced) lines.push(`  introduced  ${f.id}  ${f.headPkgs.join(', ')}`);
  for (const f of inherited) lines.push(`  inherited   ${f.id}  ${f.headPkgs.join(', ')}`);
  for (const f of resolved) lines.push(`  resolved    ${f.id}  ${f.basePkgs.join(', ')}`);
  return { lines, code: introduced.length > 0 ? 1 : 0 };
}

// ── The whole run, with its I/O injected ────────────────────────────────────

export async function run({ base, head, baseSha, repo, token, fetchImpl }) {
  const errors = [];
  const b = readSide('merge base\'s', base.text, base.outcome);
  const h = readSide('pull request\'s', head.text, head.outcome);
  if (b.error) errors.push(b.error);
  if (h.error) errors.push(h.error);
  if (errors.length > 0) return render({ errors, verdict: null, anchors: new Map(), baseSha });
  const verdict = compare(b.findings, h.findings);
  const anchors = await findAnchors(
    verdict.inherited.map((f) => f.id),
    { repo, token, fetchImpl },
  );
  return render({ errors, verdict, anchors, baseSha });
}

// ── Self-test ───────────────────────────────────────────────────────────────

// The pinned minimum number of cases: a battery that silently shrinks below it
// fails, so "every case held" cannot be printed by a battery that never ran.
const SELF_TEST_MIN_CASES = 23;
let selfTestReachedVerdict = false;

const result = (rows) =>
  JSON.stringify({
    results: [
      {
        source: { path: '/github/workspace/.osv-compare/x/pnpm-lock.yaml', type: 'lockfile' },
        packages: rows.map(([name, version, ids]) => ({
          package: { name, version, ecosystem: 'npm' },
          vulnerabilities: ids.map((id) => ({ id })),
          groups: ids.map((id) => ({ ids: [id] })),
        })),
      },
    ].filter((r) => r.packages.length > 0),
  });

// A fake of the open-issues listing: `cards` is the open issues (and pull
// requests) the repository holds, served 100 to a page like the real endpoint.
const fakeFetch = (cards, { status = 200, throws = false } = {}) => async (url) => {
  if (throws) throw new Error('network down');
  const u = new URL(url);
  if (u.pathname !== '/repos/o/r/issues' || u.searchParams.get('state') !== 'open') {
    return { ok: false, status: 404, json: async () => ({}) };
  }
  const page = Number(u.searchParams.get('page'));
  return { ok: status === 200, status, json: async () => cards.slice((page - 1) * 100, page * 100) };
};

async function selfTest() {
  const SHARP = 'GHSA-wq5f-xc86-pv6w';
  const QUOTE = 'GHSA-pqg4-j6r4-53mv';
  const MINI = 'GHSA-xvch-5gv4-984h';
  const mainRed = result([
    ['sharp', '0.35.4', [SHARP]],
    ['shell-quote', '1.10.0', [QUOTE]],
  ]);
  const cards = [
    { number: 22013, title: `[finding] main's lockfile matches sharp 0.35.4 ${SHARP}`, body: 'measured' },
    { number: 22000, title: 'an unrelated open card', body: 'nothing to see' },
  ];
  const ok = (code) => (r) => r.code === code;
  const has = (re) => (r) => r.lines.some((l) => re.test(l));
  const hasNot = (re) => (r) => !r.lines.some((l) => re.test(l));
  const count = (re, n) => (r) => r.lines.filter((l) => re.test(l)).length === n;
  const side = (text, outcome) => ({ text, outcome });

  const cases = [
    {
      name: 'inherited only: passes, a notice per advisory naming it and its anchor card',
      args: { base: side(mainRed, 'failure'), head: side(mainRed, 'failure') },
      fetch: fakeFetch(cards),
      expect: [
        ok(0),
        count(/^::notice title=OSV advisory inherited/, 2),
        has(new RegExp(`^::notice .*::${SHARP} .*anchor finding card: #22013`)),
        has(new RegExp(`^::notice .*::${QUOTE} .*no open issue names it yet`)),
        hasNot(/^::error/),
      ],
    },
    {
      name: 'introduced: fails, the error names only the introduced advisory',
      args: {
        base: side(mainRed, 'failure'),
        head: side(
          result([
            ['sharp', '0.35.4', [SHARP]],
            ['shell-quote', '1.10.0', [QUOTE]],
            ['minimist', '1.2.5', [MINI]],
          ]),
          'failure',
        ),
      },
      fetch: fakeFetch(cards),
      expect: [
        ok(1),
        count(/^::error/, 1),
        has(new RegExp(`^::error title=OSV advisory introduced by this pull request::${MINI} \\(minimist@1.2.5\\)`)),
        count(/^::notice/, 2),
      ],
    },
    {
      name: 'introduced against a clean base: fails',
      args: { base: side(result([]), 'success'), head: side(result([['minimist', '1.2.5', [MINI]]]), 'failure') },
      fetch: fakeFetch([]),
      expect: [ok(1), has(new RegExp(`^::error .*::${MINI} `)), hasNot(/^::notice/)],
    },
    {
      name: 'clean on both sides: passes silently',
      args: { base: side(result([]), 'success'), head: side(result([]), 'success') },
      fetch: fakeFetch([]),
      expect: [ok(0), hasNot(/^::/), has(/0 introduced, 0 inherited, 0 resolved/)],
    },
    {
      name: 'resolved only (the pull request takes the fix): passes',
      args: { base: side(mainRed, 'failure'), head: side(result([]), 'success') },
      fetch: fakeFetch(cards),
      expect: [ok(0), hasNot(/^::/), has(/0 introduced, 0 inherited, 2 resolved/)],
    },
    {
      name: 'same advisory at another version on the head: inherited, both sides\' versions printed',
      args: {
        base: side(result([['sharp', '0.35.4', [SHARP]]]), 'failure'),
        head: side(result([['sharp', '0.35.4', [SHARP]], ['sharp', '0.34.0', [SHARP]]]), 'failure'),
      },
      fetch: fakeFetch(cards),
      expect: [ok(0), has(/here: sharp@0\.34\.0, sharp@0\.35\.4; at the merge base: sharp@0\.35\.4/)],
    },
    {
      name: 'head scan wrote no result file: fails closed, never reads as clean',
      args: { base: side(mainRed, 'failure'), head: side(null, 'failure') },
      fetch: fakeFetch(cards),
      expect: [ok(1), has(/^::error title=OSV base-relative verdict unavailable::.*pull request's lockfile wrote no result file/)],
    },
    {
      name: 'head scan answered success with no result file (the wrapper\'s 128 -> 0): fails closed',
      args: { base: side(result([]), 'success'), head: side(null, 'success') },
      fetch: fakeFetch([]),
      expect: [ok(1), has(/wrote no result file \(outcome 'success'\)/)],
    },
    {
      name: 'base scan wrote no result file: fails closed, never reads the head as all-introduced or all-clean',
      args: { base: side(null, 'failure'), head: side(mainRed, 'failure') },
      fetch: fakeFetch(cards),
      expect: [ok(1), has(/merge base's lockfile wrote no result file/), hasNot(/^::notice/)],
    },
    {
      name: 'failure outcome with zero findings: the scanner errored, fails closed',
      args: { base: side(result([]), 'success'), head: side(result([]), 'failure') },
      fetch: fakeFetch([]),
      expect: [ok(1), has(/failed with zero findings/)],
    },
    {
      name: 'success outcome with findings: outcome and file disagree, fails closed',
      args: { base: side(result([]), 'success'), head: side(mainRed, 'success') },
      fetch: fakeFetch(cards),
      expect: [ok(1), has(/outcome and the result file disagree/)],
    },
    {
      name: 'a skipped or cancelled scan step is not a verdict',
      args: { base: side(result([]), 'skipped'), head: side(result([]), 'cancelled') },
      fetch: fakeFetch([]),
      expect: [ok(1), count(/^::error title=OSV base-relative verdict unavailable/, 2)],
    },
    {
      name: 'a result file that is not JSON fails closed',
      args: { base: side('{', 'failure'), head: side(mainRed, 'failure') },
      fetch: fakeFetch(cards),
      expect: [ok(1), has(/is not JSON/)],
    },
    {
      name: 'the anchor lookup failing never changes the verdict',
      args: { base: side(mainRed, 'failure'), head: side(mainRed, 'failure') },
      fetch: fakeFetch(cards, { throws: true }),
      expect: [ok(0), count(/anchor finding card: lookup failed \(Error: network down\)/, 2)],
    },
    {
      name: 'an anchor lookup answering 403 is named, and the verdict holds',
      args: { base: side(mainRed, 'failure'), head: side(mainRed, 'failure') },
      fetch: fakeFetch(cards, { status: 403 }),
      expect: [ok(0), count(/anchor finding card: lookup answered HTTP 403/, 2)],
    },
    {
      name: 'a search hit that does not name the id is not an anchor',
      args: { base: side(mainRed, 'failure'), head: side(mainRed, 'failure') },
      fetch: fakeFetch([{ number: 1, title: 'sharp is slow', body: 'GHSA-wq5f is not the whole id' }]),
      expect: [ok(0), has(new RegExp(`::${SHARP} .*no open issue names it yet`))],
    },
    {
      name: 'the anchor is found on the second page, and in the body as well as the title',
      args: { base: side(mainRed, 'failure'), head: side(mainRed, 'failure') },
      fetch: fakeFetch([
        ...Array.from({ length: 100 }, (_, i) => ({ number: 100 + i, title: 'filler', body: '' })),
        { number: 21000, title: 'red main again', body: `the scan matches ${QUOTE} on shell-quote` },
      ]),
      expect: [ok(0), has(new RegExp(`::${QUOTE} .*anchor finding card: #21000`))],
    },
    {
      name: 'a seat board post that quotes the id is not a finding card',
      args: { base: side(mainRed, 'failure'), head: side(mainRed, 'failure') },
      fetch: fakeFetch([{ number: 6024, title: '[PM seat] domain:cli', body: `exempt ${SHARP}`, labels: [{ name: 'pm:seat' }] }]),
      expect: [ok(0), has(new RegExp(`::${SHARP} .*no open issue names it yet`))],
    },
    {
      name: 'a pull request that names the id is not a finding card',
      args: { base: side(mainRed, 'failure'), head: side(mainRed, 'failure') },
      fetch: fakeFetch([{ number: 5, title: `fix ${SHARP}`, body: '', pull_request: { url: 'x' } }]),
      expect: [ok(0), has(new RegExp(`::${SHARP} .*no open issue names it yet`))],
    },
    {
      name: 'a listing that is not a list is named, and the verdict holds',
      args: { base: side(mainRed, 'failure'), head: side(result([['minimist', '1.2.5', [MINI]]]), 'failure') },
      fetch: async () => ({ ok: true, status: 200, json: async () => ({ message: 'odd' }) }),
      expect: [ok(1), has(/^::error title=OSV advisory introduced/), hasNot(/^::notice/)],
    },
    {
      name: 'introduced and inherited together: one error, one notice per inherited advisory',
      args: {
        base: side(result([['sharp', '0.35.4', [SHARP]]]), 'failure'),
        head: side(result([['sharp', '0.35.4', [SHARP]], ['minimist', '1.2.5', [MINI]]]), 'failure'),
      },
      fetch: fakeFetch(cards),
      expect: [
        ok(1),
        count(/^::error/, 1),
        count(/^::notice/, 1),
        has(new RegExp(`^::notice .*::${SHARP} .*merge base's lockfile \\(abcdef012345\\) too.*#22013`)),
        has(/1 introduced, 1 inherited, 0 resolved/),
      ],
    },
  ];

  const escapeCases = [
    ['data escapes % CR LF', escapeData('a%b\r\nc') === 'a%25b%0D%0Ac'],
    ['property escapes : and ,', escapeProperty('a:b,c%') === 'a%3Ab%2Cc%25'],
  ];

  const failures = [];
  let ran = 0;
  for (const c of cases) {
    ran += 1;
    const r = await run({ ...c.args, baseSha: 'abcdef0123456789', repo: 'o/r', token: 't', fetchImpl: c.fetch });
    c.expect.forEach((check, i) => {
      if (!check(r)) failures.push(`${c.name} -- expectation ${i + 1} failed; output was:\n    ${r.lines.join('\n    ')}`);
    });
  }
  for (const [name, held] of escapeCases) {
    ran += 1;
    if (!held) failures.push(name);
  }
  if (ran < SELF_TEST_MIN_CASES) {
    failures.push(`only ${ran} case(s) ran, below the pinned floor of ${SELF_TEST_MIN_CASES}`);
  }

  // The verdict text is indented so no self-test line can start with a
  // workflow command, whatever a failing case's output contains.
  if (failures.length > 0) {
    console.error(`osv-base-relative self-test: ${failures.length} failure(s) over ${ran} case(s)`);
    for (const f of failures) console.error(`  - ${f.replace(/\n/g, '\n  ')}`);
    selfTestReachedVerdict = true;
    return 1;
  }
  console.log(`osv-base-relative self-test: ${ran} case(s), all held (floor ${SELF_TEST_MIN_CASES})`);
  selfTestReachedVerdict = true;
  return 0;
}

// ── Entry ───────────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const opts = {};
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (!a.startsWith('--')) return { usage: `unexpected argument '${a}'` };
    const key = a.slice(2);
    if (key === 'self-test') {
      opts.selfTest = true;
      continue;
    }
    if (!['base-results', 'base-outcome', 'head-results', 'head-outcome', 'base-sha'].includes(key)) {
      return { usage: `unknown flag '${a}'` };
    }
    if (i + 1 >= argv.length) return { usage: `flag '${a}' needs a value` };
    opts[key] = argv[(i += 1)];
  }
  if (!opts.selfTest) {
    for (const k of ['base-results', 'base-outcome', 'head-results', 'head-outcome']) {
      if (opts[k] === undefined) return { usage: `missing --${k}` };
    }
  }
  return opts;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.usage) {
    console.error(`osv-base-relative: ${opts.usage}`);
    console.error('usage: osv-base-relative.mjs --base-results F --base-outcome O --head-results F --head-outcome O [--base-sha S] | --self-test');
    process.exit(2);
  }
  if (opts.selfTest) {
    const code = await selfTest();
    if (!selfTestReachedVerdict) {
      console.error('osv-base-relative self-test: returned without reaching its verdict -- treated as a failure');
      process.exit(1);
    }
    process.exit(code);
  }
  const read = (p) => (existsSync(p) ? readFileSync(p, 'utf8') : null);
  const { lines, code } = await run({
    base: { text: read(opts['base-results']), outcome: opts['base-outcome'] },
    head: { text: read(opts['head-results']), outcome: opts['head-outcome'] },
    baseSha: opts['base-sha'],
    repo: process.env.GITHUB_REPOSITORY,
    token: process.env.GITHUB_TOKEN,
    fetchImpl: globalThis.fetch,
  });
  for (const l of lines) console.log(l);
  process.exit(code);
}

if (isEntrypoint(import.meta.url)) await main();
