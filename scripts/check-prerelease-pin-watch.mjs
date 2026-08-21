#!/usr/bin/env node
// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.
//
// check:prerelease-pins — has upstream shipped a STABLE release that retires one
// of our prerelease `overrides` pins? (#5024)
//
//   node scripts/check-prerelease-pin-watch.mjs              # the probe (needs network)
//   node scripts/check-prerelease-pin-watch.mjs --verbose    # one line per watched pin
//   node scripts/check-prerelease-pin-watch.mjs --json
//   node scripts/check-prerelease-pin-watch.mjs --strict     # an unreadable registry exits 1
//   node scripts/check-prerelease-pin-watch.mjs --self-test  # offline; proves all three states
//
// WHY THIS EXISTS (#5024)
// ----------------------
// `pnpm-workspace.yaml` pins the whole better-auth family to `1.7.0-rc.2`
// (scim deliberately one rc behind, at `1.7.0-rc.1`), and the comment above
// those pins promises:
//
//     revert to a stable `^1.7.x` line the moment one ships.
//
// Two issues were gated on exactly that event — #3002 (revert the family to a
// stable `^1.7.x`, done: the family is on `^1.7.1` and only `@better-auth/scim`
// is still pinned to a prerelease) and #3653 (the SCIM migration, which #3653
// explicitly defers until `@better-auth/scim` ships a non-rc release — it has,
// and it ships the rc.2 rewrite, so #3653 is now the live card). Neither had a
// PRODUCER:
// nothing anywhere watched npm, so redeeming the promise depended on somebody
// remembering to look. That is the repo's standard `declared != enforced` shape,
// applied to a promise in a comment — and every extra day on a prerelease is
// another day the auth surface runs on a version carrying no stability
// commitment.
//
// This is the producer. It is a WATCHER, not a fixer: it never edits a pin. Its
// entire job is to make the trigger condition of those cards arrive as an
// automatic signal within a day of the release, instead of as a memory.
//
// THE WATCH LIST IS DERIVED, NOT DECLARED
// ---------------------------------------
// The packages watched are not a hardcoded list — they are read out of
// `pnpm-workspace.yaml` `overrides`: every pin whose TARGET is a prerelease
// version. So the probe polices the very declaration it is derived from, and it
// cannot drift from it:
//
//   * a new prerelease pin is watched the day it lands, with no edit here;
//   * a pin reverted to a stable range leaves the watch list by itself;
//   * when the last prerelease pin is gone the probe reports "nothing to watch"
//     and exits 0 — it retires itself rather than needing to be deleted.
//
// A hardcoded list of three package names would have gone stale against the
// eleven pins that are actually in the file, in whichever direction the file
// moved first.
//
// THE CRITERION IS SEMVER, NOT THE `latest` TAG
// ---------------------------------------------
// A version triggers when it has NO prerelease segment and is at or above the
// pinned target's base version — NOT when npm's `latest` tag moves. The two are
// genuinely different facts today: as of 2026-08-05 better-auth's `latest` is
// `1.6.26` (the old line) while `rc` is `1.7.0-rc.4`, so upstream can publish a
// stable `1.7.0` and leave `latest` on 1.6 for days. A `latest`-watching probe
// would sleep straight through the event it exists to catch. `dist-tags` are
// printed in the report as context and never consulted for the verdict.
//
// Two shapes of hit are reported apart, because the remedy differs:
//
//   in-line   a stable release inside the pinned line (`1.7.x`) — the exact
//             trigger those cards wrote down. Mechanical: move the pin.
//   later     a stable release only in a HIGHER line (`1.8.0`+) while the
//             pinned line never stabilized. Also gets us off the prerelease,
//             but crossing a minor is a decision, not a bump. Reported as its
//             own case so it cannot hide: without it, upstream stabilizing
//             1.8 and abandoning 1.7 would leave this probe silent forever —
//             #5024's defect one line over.
//
// NETWORK FAILURE IS NOT A GREEN — AND NOT A RED EITHER (the trade-off)
// ---------------------------------------------------------------------
// Three verdicts, three exit codes, because "npm was unreachable" and "no
// stable release yet" are different facts and a probe that blurs them is the
// thing it was built to replace:
//
//   0  WAITING    every watched pin was read; no stable release yet. Quiet.
//   1  AVAILABLE  a stable release exists. Loud; names the follow-up card.
//   2  UNKNOWN    at least one registry read failed; no hit among the rest.
//
// Exit 2 is deliberately NOT exit 1. Unlike a blocking release gate that reads a
// remote, where an unreadable remote must block because the alternative is
// shipping the thing the gate exists to catch (`check:objectui-pin-fresh` was
// this repo's example until #10134 deleted it) — this is an unattended nightly,
// and its failure mode is asymmetric: a transient npm 5xx that turns the nightly
// red teaches everyone to skim it, and a nightly nobody reads is precisely the
// "no producer" state #5024 is about. Missing one night costs at most a day,
// because the next run re-probes from scratch and the event it watches for is
// permanent — a published version is never unpublished back into silence.
// So the workflow surfaces exit 2 as a `::warning::` plus a step-summary line
// (visible, non-blocking) and keeps red meaning exactly one thing: a stable
// release is out. `--strict` promotes UNKNOWN to exit 1 for whoever needs the
// harder line (e.g. if the registry becomes persistently unreadable and the
// warnings are being missed) — the knob exists so escalating is a flag, not a
// rewrite.
//
// (Behind an HTTPS proxy, node's `fetch` ignores HTTPS_PROXY unless node runs
// with NODE_USE_ENV_PROXY=1. GitHub Actions needs no such thing.)
//
// WHERE IT RUNS
// -------------
// `.github/workflows/prerelease-pin-watch.yml`, nightly at 06:00 UTC, plus
// `--self-test` on any PR touching the probe, the workflow, or the pins
// ("a change to the guard runs the guard"). It is NOT wired into `lint.yml`:
// the probe needs the network, and no PR gate in this repo may depend on a
// third-party registry being up.
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isEntrypoint } from './invoked-as.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_WORKSPACE = join(REPO_ROOT, 'pnpm-workspace.yaml');
const DEFAULT_REGISTRY = 'https://registry.npmjs.org';
const USER_AGENT = 'objectstack-check-prerelease-pin-watch';

/** A registry read failed. Never a green verdict, never a red one — see the header. */
export class RegistryUnreadable extends Error {}

// ---------------------------------------------------------------------------
// The follow-up ledger — what a hit must TELL you to do.
//
// A probe that only says "a stable release exists" hands its reader a research
// task at the exact moment they have the least context (a nightly, out of
// band). Each watched package therefore declares the issues carrying its
// action list, so the signal arrives pointing at the work.
//
// Unmapped is legal and is itself reported: a prerelease pin with no recorded
// revert plan is the #5024 shape again, and saying so is cheaper than
// discovering it later.
// ---------------------------------------------------------------------------

/** @type {Array<{ match: RegExp, issues: string[], note: string }>} */
const FOLLOW_UPS = [
  {
    // Held one prerelease BEHIND the rest of the family on purpose, and its
    // stable release triggers a migration rather than a bump — rc.2 replaced the
    // whole SCIM model set, so #3653 defers the work to the stable release.
    match: /^@better-auth\/scim$/,
    issues: ['#3653'],
    note:
      'SCIM is a MIGRATION, not a bump (#3653): rc.2 replaced the model set and moved ' +
      'connections from runtime rows to boot config, and the STABLE 1.7 releases ship that ' +
      'same rewrite (measured on the 1.7.1 tarball: no scimProvider model, no generate-token ' +
      'endpoint, all six new models present). Do the migration against the stable models — ' +
      'do not "align" this pin with the family first. #3002 moved the REST of the family to ' +
      'stable ^1.7.1 and left this pin behind deliberately, so #3653 is the only card left.',
  },
  {
    match: /^(better-auth|@better-auth\/.+)$/,
    issues: ['#3653'],
    note:
      'The family moves together (mixing a 1.7 plugin with 1.6 core throws during init and ' +
      "500s every auth endpoint). plugin-auth's own declarations must move in the SAME PR — " +
      '`check:override-consistency` holds them to it. The family is on stable `^1.7.1` since ' +
      '#3002, so a family member showing up here again means a NEW prerelease pin was added; ' +
      'read the pin\'s own comment in pnpm-workspace.yaml for why, and file a card for it.',
  },
];

/** @returns {{ issues: string[], note: string } | null} */
export function followUpFor(pkg) {
  return FOLLOW_UPS.find((f) => f.match.test(pkg)) ?? null;
}

// ---------------------------------------------------------------------------
// Reading the pins
// ---------------------------------------------------------------------------

/**
 * Minimal `overrides:` reader — the same block-scanning approach as
 * `check-override-consistency.mjs` (this file only ever uses `key: value`
 * scalars, so a YAML dependency is avoided and the probe stays runnable with
 * no `pnpm install`).
 *
 * @returns {Array<{ name: string, selector: string | null, target: string }>}
 */
export function readOverrides(text) {
  const overrides = [];
  let inOverrides = false;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/\s+$/, '');
    if (!line.trim() || /^\s*#/.test(line)) continue;
    if (/^overrides\s*:\s*$/.test(line)) {
      inOverrides = true;
      continue;
    }
    if (!inOverrides) continue;
    if (/^\S/.test(line)) {
      inOverrides = false;
      continue;
    }
    const m = /^\s+["']?([^"':]+?)["']?\s*:\s*["']?([^"'#]+?)["']?\s*(#.*)?$/.exec(line);
    if (!m) continue;
    const key = m[1].trim();
    const target = m[2].trim();
    // Split `pkg@selector` on the LAST `@` so scoped names survive.
    const at = key.lastIndexOf('@');
    if (at > 0) overrides.push({ name: key.slice(0, at), selector: key.slice(at + 1), target });
    else overrides.push({ name: key, selector: null, target });
  }
  return overrides;
}

// ---------------------------------------------------------------------------
// Semver, the two questions this probe actually asks
// ---------------------------------------------------------------------------

const VERSION_RE = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/;

/**
 * @returns {{ major: number, minor: number, patch: number, prerelease: string | null } | null}
 *   `null` when the string is not a single exact version (a RANGE like `^8.5.10`
 *   or `>=0.28.1` is not a prerelease pin and must not be watched).
 */
export function parseVersion(v) {
  const m = VERSION_RE.exec(String(v).trim());
  if (!m) return null;
  return {
    major: Number(m[1]),
    minor: Number(m[2]),
    patch: Number(m[3]),
    prerelease: m[4] ?? null,
  };
}

/** Numeric release-triple comparison. Prerelease segments are NOT ordered here: the
 *  probe only ever asks "is this stable, and is it at or above the base", and the
 *  base is always a `.0`-patch release triple. */
function compareRelease(a, b) {
  return a.major - b.major || a.minor - b.minor || a.patch - b.patch;
}

/**
 * The pins worth watching: every override whose TARGET is an exact prerelease
 * version. Everything else — stable exact pins, ranges, selectors — is not a
 * promise waiting to be redeemed.
 *
 * @returns {Array<{ name: string, target: string, base: string, line: string, followUp: object|null }>}
 */
export function buildWatchList(overrides) {
  const seen = new Map();
  for (const o of overrides) {
    const v = parseVersion(o.target);
    if (!v || !v.prerelease) continue;
    // The base release the prerelease is a candidate FOR: `1.7.0-rc.2` -> `1.7.0`.
    const base = `${v.major}.${v.minor}.${v.patch}`;
    const entry = {
      name: o.name,
      target: o.target,
      base,
      line: `${v.major}.${v.minor}`,
      followUp: followUpFor(o.name),
    };
    // The same package can be pinned by more than one selector; the LOWEST base
    // is the one whose promise is outstanding first.
    const prev = seen.get(o.name);
    if (!prev || compareRelease(parseVersion(base), parseVersion(prev.base)) < 0) {
      seen.set(o.name, entry);
    }
  }
  return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
}

// ---------------------------------------------------------------------------
// Reading the registry
// ---------------------------------------------------------------------------

/**
 * The abbreviated packument (`application/vnd.npm.install-v1+json`) — orders of
 * magnitude smaller than the full document and it still carries every published
 * version key plus `dist-tags`.
 */
export async function readPackument(name, { registry = DEFAULT_REGISTRY } = {}) {
  const url = `${registry.replace(/\/$/, '')}/${name.replace('/', '%2F')}`;
  let res;
  try {
    res = await fetch(url, {
      headers: {
        Accept: 'application/vnd.npm.install-v1+json',
        'User-Agent': USER_AGENT,
      },
    });
  } catch (err) {
    throw new RegistryUnreadable(`GET ${url} — ${err.message}`);
  }
  if (!res.ok) throw new RegistryUnreadable(`GET ${url} → HTTP ${res.status}`);
  let body;
  try {
    body = await res.json();
  } catch (err) {
    throw new RegistryUnreadable(`GET ${url} → response was not JSON (${err.message})`);
  }
  if (!body || typeof body !== 'object' || typeof body.versions !== 'object') {
    throw new RegistryUnreadable(`GET ${url} → no 'versions' map in the response`);
  }
  return { versions: Object.keys(body.versions), distTags: body['dist-tags'] ?? {} };
}

// ---------------------------------------------------------------------------
// The verdict
// ---------------------------------------------------------------------------

/**
 * Judge one watched pin against what the registry published.
 *
 * @param {{ name: string, base: string, line: string }} entry
 * @param {{ versions: string[], distTags: object } | { error: string }} read
 */
export function judge(entry, read) {
  if (read && read.error) {
    return { ...entry, verdict: 'unknown', error: read.error, stableInLine: [], stableLater: [] };
  }
  const base = parseVersion(entry.base);
  const stableInLine = [];
  const stableLater = [];
  for (const raw of read.versions) {
    const v = parseVersion(raw);
    if (!v || v.prerelease) continue; // prerelease -> not the trigger, by definition
    if (compareRelease(v, base) < 0) continue; // below the pin: reverting there undoes the fix
    if (v.major === base.major && v.minor === base.minor) stableInLine.push(raw);
    else stableLater.push(raw);
  }
  const byRelease = (a, b) => compareRelease(parseVersion(a), parseVersion(b));
  stableInLine.sort(byRelease);
  stableLater.sort(byRelease);
  return {
    ...entry,
    verdict: stableInLine.length || stableLater.length ? 'available' : 'waiting',
    trigger: stableInLine.length ? 'in-line' : stableLater.length ? 'later' : null,
    stableInLine,
    stableLater,
    distTags: read.distTags ?? {},
    error: null,
  };
}

/**
 * @param {Array<object>} judged
 * @returns {{ verdict: 'available'|'unknown'|'waiting'|'nothing-to-watch', packages: object[], issues: string[] }}
 */
export function evaluate(judged) {
  const hits = judged.filter((j) => j.verdict === 'available');
  const unknown = judged.filter((j) => j.verdict === 'unknown');
  const issues = [
    ...new Set(hits.flatMap((h) => h.followUp?.issues ?? [])),
  ].sort();
  let verdict;
  if (!judged.length) verdict = 'nothing-to-watch';
  else if (hits.length) verdict = 'available';
  else if (unknown.length) verdict = 'unknown';
  else verdict = 'waiting';
  return { verdict, packages: judged, hits, unknown, issues };
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

export function render(result, { verbose = false } = {}) {
  const out = [];
  const { verdict, packages, hits, unknown } = result;

  if (verdict === 'nothing-to-watch') {
    out.push(
      '✓ No prerelease pin left in pnpm-workspace.yaml `overrides` — nothing to watch.',
      '',
      '  This probe derives its watch list from the pins themselves (#5024), so an empty',
      '  list is the SUCCESS state, not a misconfiguration: every prerelease promise in the',
      '  file has been redeemed. When the last pin went stable this probe retired itself.',
    );
    return out.join('\n');
  }

  if (verdict === 'available') {
    out.push(
      `⛔ A STABLE release is available for ${hits.length} prerelease pin(s) — the trigger ` +
        `condition of ${result.issues.join(' / ') || 'the follow-up work'} has ARRIVED.`,
      '',
    );
    for (const h of hits) {
      out.push(`  ${h.name}`);
      out.push(`      pinned:  ${h.target}   (prerelease; watched line ${h.line}.x)`);
      if (h.stableInLine.length) {
        out.push(
          `      STABLE in the pinned line: ${h.stableInLine.join(', ')}` +
            `  → revert the pin to \`^${h.line}.x\`.`,
        );
      }
      if (h.stableLater.length) {
        out.push(
          `      STABLE only in a LATER line: ${h.stableLater.join(', ')}`,
          h.stableInLine.length
            ? '      (also available above the pinned line.)'
            : `      → the pinned ${h.line} line never stabilized. Getting off the prerelease means ` +
              `crossing a minor, which is a DECISION, not a bump — read the action list first.`,
        );
      }
      if (h.followUp) {
        out.push(`      action list: ${h.followUp.issues.join(', ')}`);
        out.push(`      ${h.followUp.note}`);
      } else {
        out.push(
          '      ⚠ NO follow-up issue is declared for this pin. Whoever added it recorded no',
          '        revert plan, which is the #5024 defect shape again — file the follow-up issue',
          '        and add it to FOLLOW_UPS in this script.',
        );
      }
      // Context only. The verdict above was decided by semver, never by a tag.
      const tags = Object.entries(h.distTags ?? {})
        .filter(([t]) => ['latest', 'rc', 'beta', 'next'].includes(t))
        .map(([t, v]) => `${t}=${v}`);
      if (tags.length) out.push(`      dist-tags (context only, NOT the criterion): ${tags.join(' ')}`);
      out.push('');
    }
    out.push(
      '  Why this is loud: the pins in `pnpm-workspace.yaml` carry a promise in their comment —',
      '  "revert to a stable `^1.7.x` line the moment one ships" — and until this probe existed',
      '  nothing watched for that moment: redeeming it depended on somebody remembering to check',
      '  npm (#5024). Every extra day on a prerelease is another day the auth surface runs on a',
      '  version with no stability commitment behind it.',
      '',
      '  This probe does NOT move any pin. Do the work on the issues above; the red goes away',
      '  when the pins do.',
    );
    if (unknown.length) {
      out.push(
        '',
        `  ⚠ ${unknown.length} further pin(s) could not be read, so this list may be INCOMPLETE:`,
        ...unknown.map((u) => `      ${u.name} — ${u.error}`),
      );
    }
    return out.join('\n');
  }

  if (verdict === 'unknown') {
    out.push(
      `⚠ Prerelease pin watch is INCONCLUSIVE — ${unknown.length} of ${packages.length} ` +
        `registry read(s) failed.`,
      '',
      ...unknown.map((u) => `    ${u.name} — ${u.error}`),
      '',
      '  This is NOT "no stable release yet" and it is NOT reported as one. It is also not a',
      '  red: the next run re-probes from scratch and a published version is never unpublished',
      '  back into silence, so a missed night costs at most a day — while a nightly that goes',
      '  red on a transient registry error is a nightly everyone learns to skim, which is the',
      '  "nobody is watching" state this probe exists to end (#5024).',
      '',
      '  Persistently inconclusive? Run with `--strict` (exit 1) to make it block.',
      '  Behind an HTTPS proxy, node ignores HTTPS_PROXY unless run with NODE_USE_ENV_PROXY=1.',
    );
    const readable = packages.filter((p) => p.verdict === 'waiting');
    if (readable.length) {
      out.push(
        '',
        `  The ${readable.length} pin(s) that WERE readable have no stable release yet:`,
        ...readable.map((p) => `      ${p.name} — pinned ${p.target}, no stable ${p.line}.x`),
      );
    }
    return out.join('\n');
  }

  // WAITING — the quiet path. One line, by design: a nightly that prints a
  // report every night trains its reader to skip the night it matters.
  out.push(
    `✓ No stable release yet for ${packages.length} prerelease pin(s) ` +
      `(${[...new Set(packages.map((p) => `${p.line}.x`))].join(', ')}) — nothing to do.`,
  );
  if (verbose) {
    for (const p of packages) {
      const tags = p.distTags?.latest ? `  [latest=${p.distTags.latest}]` : '';
      out.push(`    ${p.name.padEnd(32)} pinned ${p.target}  → no stable ${p.line}.x${tags}`);
    }
  }
  return out.join('\n');
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

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

  const strict = has('--strict');
  const asJson = has('--json');
  const verbose = has('--verbose');
  const registry = val('--registry', DEFAULT_REGISTRY);
  const workspace = val('--workspace', DEFAULT_WORKSPACE);
  // Self-test only: registry responses come from a JSON file instead of the
  // network, so the real CLI (exit codes included) is what gets exercised.
  // Every fixture run SAYS SO — it can never be mistaken for a real verdict.
  const fixture = val('--fixture', '');

  const watch = buildWatchList(readOverrides(readFileSync(workspace, 'utf8')));

  const reads = fixture ? JSON.parse(readFileSync(fixture, 'utf8')) : null;
  const judged = [];
  for (const entry of watch) {
    if (reads) {
      const r = reads[entry.name];
      if (!r) judged.push(judge(entry, { error: `no fixture entry for ${entry.name}` }));
      else if (r.__throw) judged.push(judge(entry, { error: r.__throw }));
      else judged.push(judge(entry, { versions: r.versions ?? [], distTags: r.distTags ?? {} }));
      continue;
    }
    try {
      judged.push(judge(entry, await readPackument(entry.name, { registry })));
    } catch (err) {
      if (!(err instanceof RegistryUnreadable)) throw err;
      judged.push(judge(entry, { error: err.message }));
    }
  }

  const result = evaluate(judged);

  if (fixture) {
    console.error(
      `⚠ REGISTRY READ FROM FIXTURE ${fixture} — self-test output, not a real verdict.`,
    );
  }

  if (asJson) console.log(JSON.stringify({ ...result, registry, strict }, null, 2));
  else console.log(render(result, { verbose }));

  if (result.verdict === 'available') {
    console.error(
      `\n::error::A stable release retires a prerelease pin — act on ` +
        `${result.issues.join(' / ') || 'the follow-up issues'} (#5024 probe).`,
    );
    return 1;
  }
  if (result.verdict === 'unknown') {
    console.error(
      `\n::warning::Prerelease pin watch could not read ${result.unknown.length} package(s) — ` +
        `INCONCLUSIVE, not "no release yet". Re-runs tomorrow; --strict to make it block (#5024).`,
    );
    return strict ? 1 : 2;
  }
  return 0;
}

// ---------------------------------------------------------------------------
// Self-test — the repo idiom for a scripts/ gate: drive the real code and the
// real CLI (exit codes included) over fabricated registry responses. Fully
// offline, so it is safe as a PR gate where the probe itself is not.
// ---------------------------------------------------------------------------

function selfTest() {
  const failures = [];
  const check = (name, cond, detail = '') => {
    if (cond) console.log(`  ✓ ${name}`);
    else {
      failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
      console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`);
    }
  };

  console.log('check-prerelease-pin-watch --self-test');

  // --- 1. the watch list is derived from the pins ---------------------------
  const YAML = [
    'packages:',
    '  - packages/*',
    'overrides:',
    "  esbuild: '>=0.28.1'",
    "  'minimatch@<10.2.3': '10.2.3'",
    "  # a comment line that must not parse",
    "  'better-auth@<1.7.0-rc.2': '1.7.0-rc.2'",
    "  '@better-auth/core@<1.7.0-rc.2': '1.7.0-rc.2'",
    "  '@better-auth/scim@<1.7.0-rc.1': '1.7.0-rc.1'",
    "  'postcss@<8.5.10': '^8.5.10'",
    "  svelte: '^5.55.7'",
    'onlyBuiltDependencies:',
    '  - esbuild',
  ].join('\n');

  const watch = buildWatchList(readOverrides(YAML));
  check(
    'only the prerelease pins are watched (stable exacts and ranges are not)',
    watch.map((w) => w.name).join(',') === '@better-auth/core,@better-auth/scim,better-auth',
    watch.map((w) => w.name).join(','),
  );
  check(
    'an exact STABLE pin is not watched (minimatch 10.2.3)',
    !watch.some((w) => w.name === 'minimatch'),
  );
  check(
    'a RANGE target is not watched (^8.5.10, >=0.28.1)',
    !watch.some((w) => w.name === 'postcss' || w.name === 'esbuild'),
  );
  check(
    'the watched line comes from the pin, not from a constant',
    watch.find((w) => w.name === 'better-auth')?.line === '1.7' &&
      watch.find((w) => w.name === 'better-auth')?.base === '1.7.0',
  );
  check(
    'scim carries the migration card (#3653) and names it a MIGRATION',
    watch.find((w) => w.name === '@better-auth/scim').followUp.issues.join() === '#3653' &&
      watch.find((w) => w.name === '@better-auth/scim').followUp.note.includes('MIGRATION'),
  );
  check(
    'the rest of the family carries a follow-up card too',
    watch.find((w) => w.name === 'better-auth').followUp.issues.join() === '#3653',
  );
  check(
    'a prerelease pin with no declared follow-up is watched anyway (unmapped is legal)',
    buildWatchList(readOverrides("overrides:\n  'nobody@<2.0.0-rc.1': '2.0.0-rc.1'\n")).length === 1,
  );

  // --- 2. the three registry states ----------------------------------------
  const entry = watch.find((w) => w.name === 'better-auth');

  const onlyPre = judge(entry, {
    versions: ['1.6.26', '1.7.0-beta.10', '1.7.0-rc.2', '1.7.0-rc.4'],
    distTags: { latest: '1.6.26', rc: '1.7.0-rc.4' },
  });
  check('only prereleases in the line → WAITING', onlyPre.verdict === 'waiting', onlyPre.verdict);
  check(
    'a newer prerelease (rc.4 vs the pinned rc.2) does NOT trigger',
    onlyPre.stableInLine.length === 0,
  );

  const stable = judge(entry, {
    versions: ['1.6.26', '1.7.0-rc.4', '1.7.0', '1.7.1'],
    distTags: { latest: '1.6.26', rc: '1.7.0-rc.4' },
  });
  check('a stable release in the line → AVAILABLE', stable.verdict === 'available', stable.verdict);
  check('and it is classified in-line', stable.trigger === 'in-line', String(stable.trigger));
  check(
    'every stable version in the line is listed, in order',
    stable.stableInLine.join(',') === '1.7.0,1.7.1',
    stable.stableInLine.join(','),
  );

  const unreadable = judge(entry, { error: 'getaddrinfo ENOTFOUND registry.npmjs.org' });
  check('a failed read → UNKNOWN', unreadable.verdict === 'unknown', unreadable.verdict);
  check(
    'UNKNOWN never reports stable versions it did not see',
    unreadable.stableInLine.length === 0 && unreadable.stableLater.length === 0,
  );

  // --- 3. the criterion is semver, NOT the `latest` tag --------------------
  // The live shape on 2026-08-05: `latest` sits on the OLD line while the new
  // line is published. A `latest`-watching probe sleeps through this.
  const latestStillOld = judge(entry, {
    versions: ['1.6.26', '1.7.0'],
    distTags: { latest: '1.6.26', rc: '1.7.0-rc.4' },
  });
  check(
    'a stable 1.7.0 triggers even while dist-tag `latest` is still 1.6.26',
    latestStillOld.verdict === 'available' && latestStillOld.trigger === 'in-line',
    JSON.stringify({ v: latestStillOld.verdict, t: latestStillOld.trigger }),
  );
  check(
    'a stable release BELOW the pinned base never triggers (reverting there undoes the fix)',
    judge(entry, { versions: ['1.6.26', '1.5.9'], distTags: {} }).verdict === 'waiting',
  );
  check(
    'build metadata does not make a version a prerelease',
    parseVersion('1.7.0+build.5')?.prerelease === null,
  );

  // --- 4. a stable release only in a LATER line is its own case -----------
  const later = judge(entry, { versions: ['1.7.0-rc.4', '1.8.0', '2.0.0'], distTags: {} });
  check('stable only above the pinned line → AVAILABLE', later.verdict === 'available');
  check('…classified `later`, not `in-line`', later.trigger === 'later', String(later.trigger));
  const laterText = render(evaluate([later]));
  check(
    'and the report says crossing a minor is a DECISION',
    laterText.includes('DECISION') && laterText.includes('never stabilized'),
    laterText,
  );

  // --- 5. the reports say what they must ----------------------------------
  const hitText = render(evaluate([judge(entry, { versions: ['1.7.0'], distTags: {} })]));
  check('the AVAILABLE report names its follow-up card', hitText.includes('#3653'), hitText);
  check(
    'the AVAILABLE report names the remedy (revert to ^1.7.x)',
    hitText.includes('^1.7.x'),
    hitText,
  );
  // Printed only when the packument carried tags, so it is asserted on the
  // `latest`-still-old case — the report that shows `latest=1.6.26` next to a
  // stable 1.7.0 is exactly the one that must disclaim the tag.
  const latestStillOldText = render(evaluate([latestStillOld]));
  check(
    'the AVAILABLE report prints dist-tags as context and states they are NOT the criterion',
    latestStillOldText.includes('latest=1.6.26') &&
      latestStillOldText.includes('NOT the criterion'),
    latestStillOldText,
  );
  const scimHit = render(
    evaluate([judge(watch.find((w) => w.name === '@better-auth/scim'), { versions: ['1.7.0'], distTags: {} })]),
  );
  check('a scim hit names #3653 and calls it a migration', scimHit.includes('#3653') && scimHit.includes('MIGRATION'), scimHit);
  const unmappedHit = render(
    evaluate([
      judge(buildWatchList(readOverrides("overrides:\n  'nobody@<2.0.0-rc.1': '2.0.0-rc.1'\n"))[0], {
        versions: ['2.0.0'],
        distTags: {},
      }),
    ]),
  );
  check(
    'an unmapped pin hit says so instead of pointing nowhere',
    unmappedHit.includes('NO follow-up issue is declared'),
    unmappedHit,
  );
  const waitingText = render(evaluate([onlyPre]));
  check(
    'the WAITING report is ONE line (zero noise when nothing shipped)',
    waitingText.trim().split('\n').length === 1,
    waitingText,
  );
  check(
    'the UNKNOWN report refuses to read as "no release yet"',
    render(evaluate([unreadable])).includes('INCONCLUSIVE'),
  );
  check(
    'an empty watch list is the SUCCESS state and says why',
    render(evaluate([])).includes('nothing to watch') &&
      render(evaluate([])).includes('retired itself'),
  );

  // --- 6. a hit alongside an unreadable pin stays a hit, and says it may be
  //        incomplete (the itemization lesson from check:objectui-pin-fresh) --
  const mixed = evaluate([judge(entry, { versions: ['1.7.0'], distTags: {} }), unreadable]);
  check('a hit is not diluted by a sibling read failure', mixed.verdict === 'available');
  check(
    'and the report admits the hit list may be incomplete',
    render(mixed).includes('INCOMPLETE'),
    render(mixed),
  );

  // --- 7. end-to-end through the real CLI, exit codes included -------------
  const tmp = mkdtempSync(join(tmpdir(), 'prerelease-pin-watch-selftest-'));
  try {
    const cli = fileURLToPath(import.meta.url);
    const file = (name, obj) => {
      const p = join(tmp, name);
      writeFileSync(p, typeof obj === 'string' ? obj : JSON.stringify(obj));
      return p;
    };
    const ws = file('pnpm-workspace.yaml', YAML);
    const run = (args) => {
      const r = spawnSync('node', [cli, ...args], { encoding: 'utf8' });
      return { code: r.status ?? 1, stdout: r.stdout || '', out: `${r.stdout || ''}${r.stderr || ''}` };
    };

    const pre = { versions: ['1.6.26', '1.7.0-rc.2', '1.7.0-rc.4'], distTags: { latest: '1.6.26' } };
    const waitingRun = run([
      '--workspace',
      ws,
      '--fixture',
      file('waiting.json', {
        'better-auth': pre,
        '@better-auth/core': pre,
        '@better-auth/scim': pre,
      }),
    ]);
    check('CLI exits 0 while only prereleases exist', waitingRun.code === 0, `code ${waitingRun.code}`);
    check(
      'the quiet run emits no ::error:: and no ::warning::',
      !waitingRun.out.includes('::error::') && !waitingRun.out.includes('::warning::'),
      waitingRun.out,
    );
    check('a fixture run announces itself as a fixture run', waitingRun.out.includes('FIXTURE'));

    const hitRun = run([
      '--workspace',
      ws,
      '--fixture',
      file('hit.json', {
        'better-auth': { versions: ['1.7.0'], distTags: { latest: '1.6.26' } },
        '@better-auth/core': pre,
        '@better-auth/scim': pre,
      }),
    ]);
    check('CLI exits 1 when a stable release exists', hitRun.code === 1, `code ${hitRun.code}`);
    check(
      'the hit run emits ::error:: naming the follow-up issue',
      hitRun.out.includes('::error::') && hitRun.out.includes('#3653'),
      hitRun.out,
    );

    const netFixture = file('net.json', {
      'better-auth': { __throw: 'getaddrinfo ENOTFOUND registry.npmjs.org' },
      '@better-auth/core': { __throw: 'HTTP 503' },
      '@better-auth/scim': pre,
    });
    const netRun = run(['--workspace', ws, '--fixture', netFixture]);
    check('CLI exits 2 (not 0, not 1) when reads fail', netRun.code === 2, `code ${netRun.code}`);
    check(
      'a read failure never renders as "no stable release yet"',
      netRun.out.includes('INCONCLUSIVE') && !netRun.out.includes('nothing to do'),
      netRun.out,
    );
    check('the failure reason is printed verbatim', netRun.out.includes('ENOTFOUND'), netRun.out);
    check('and it warns rather than passing silently', netRun.out.includes('::warning::'));

    const strictRun = run(['--workspace', ws, '--strict', '--fixture', netFixture]);
    check('--strict promotes an unreadable registry to exit 1', strictRun.code === 1, `code ${strictRun.code}`);

    const emptyRun = run([
      '--workspace',
      file('empty-workspace.yaml', "overrides:\n  'minimatch@<10.2.3': '10.2.3'\n"),
      '--fixture',
      file('empty.json', {}),
    ]);
    check('CLI exits 0 with no prerelease pins left', emptyRun.code === 0, `code ${emptyRun.code}`);
    check(
      '…and says that is the success state, not a misconfiguration',
      emptyRun.out.includes('nothing to watch'),
      emptyRun.out,
    );

    const jsonRun = run([
      '--workspace',
      ws,
      '--json',
      '--fixture',
      file('hit2.json', {
        'better-auth': { versions: ['1.7.0', '1.7.1'], distTags: {} },
        '@better-auth/core': pre,
        '@better-auth/scim': { versions: ['1.7.0'], distTags: {} },
      }),
    ]);
    const parsed = JSON.parse(jsonRun.stdout);
    check(
      'JSON carries the verdict, the per-package rows and the issue list',
      parsed.verdict === 'available' &&
        parsed.packages.length === 3 &&
        parsed.issues.join(',') === '#3653',
      jsonRun.stdout,
    );
    check(
      'JSON reports each package separately (per-package conclusions)',
      parsed.packages.filter((p) => p.verdict === 'available').length === 2 &&
        parsed.packages.filter((p) => p.verdict === 'waiting').length === 1,
      jsonRun.stdout,
    );

    // The REAL pins must parse — a self-test that only ever reads its own
    // fixture would pass while the file it polices had moved out from under it.
    const realWatch = buildWatchList(readOverrides(readFileSync(DEFAULT_WORKSPACE, 'utf8')));
    check(
      `the repo's own pnpm-workspace.yaml parses to a non-empty watch list (${realWatch.length} pin(s))`,
      realWatch.length > 0,
      'no prerelease pin found — if that is genuinely true, this probe has retired itself',
    );
    check(
      'every watched pin from the real file has a base version and a line',
      realWatch.every((w) => /^\d+\.\d+\.\d+$/.test(w.base) && /^\d+\.\d+$/.test(w.line)),
      JSON.stringify(realWatch.map((w) => [w.name, w.base])),
    );
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }

  if (failures.length) {
    console.error(`\n⛔ check-prerelease-pin-watch --self-test: ${failures.length} failure(s)`);
    for (const f of failures) console.error(`   - ${f}`);
    return 1;
  }
  console.log('✓ check-prerelease-pin-watch --self-test: all checks passed');
  return 0;
}

if (isEntrypoint(import.meta.url)) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (err) => {
      console.error(`✗ check:prerelease-pins — ${err.message}`);
      process.exit(1);
    },
  );
}
