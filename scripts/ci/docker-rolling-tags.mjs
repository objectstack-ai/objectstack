#!/usr/bin/env node
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// docker-rolling-tags -- which rolling image tags (`latest`, `X.Y`, `X`) a
// build of @objectstack/cli VERSION may move. The body of docker-publish.yml's
// "Decide which rolling tags this version may move" step (#26961).
//
//   node scripts/ci/docker-rolling-tags.mjs --version 18.2.0 --lane dispatch|release
//   node scripts/ci/docker-rolling-tags.mjs --self-test
//
// ## The defect this closes
//
// docker-publish.yml has two entry points. `workflow_call` is the release lane
// (release.yml, right after a publish or as its image backfill). The other,
// `workflow_dispatch`, is a manual rebuild of an already-published version,
// for example to pick up base-image CVE patches. The "Compute image tags" step
// used to derive `X.Y`, `X` and `latest` from VERSION alone. A dispatch
// rebuild of 17.7.0 while 18.2.0 is current would therefore re-point `latest`
// at the 17.7.0 image, and everyone pulling `:latest` would roll back a major
// version.
//
// ## The rule
//
// A rolling tag moves only when no stable @objectstack/cli version on npm in
// that tag's range is newer than VERSION:
//
//   latest   no stable version on npm is newer
//   X.Y      no stable X.Y.* version is newer
//   X        no stable X.*.* version is newer
//
// A prerelease VERSION moves none of them, as before. Prereleases on npm never
// hold a rolling tag, so they are ignored when looking for a newer version.
// The image tag equals the CLI version baked into it, so npm's version list is
// the record of what has been published.
//
// ## When npm's list cannot be read: the two lanes fail in opposite directions
//
//   dispatch  only the exact version tag is pushed, and the step says so. A
//             rebuild is a repair of an old image. Leaving a rolling tag where
//             it is costs nothing, while moving it wrongly rolls users back.
//             The same applies when the list does not contain VERSION itself:
//             the input must already be on npm, so a list without it is stale
//             and cannot rule out a newer version either.
//   release   every rolling tag moves, as it did before this step existed. On
//             a real release VERSION is the newest, and a registry hiccup must
//             not leave `latest` behind it. A list without VERSION is expected
//             here (npm's version list can lag the publish), so VERSION is
//             compared as if it were in the list.
//
// The workflow passes the lane. It cannot use `github.event_name`: in a
// `workflow_call` run the `github` context belongs to the CALLER, and
// release.yml's repair lane is itself a `workflow_dispatch`, so a real
// release can arrive here with `event_name == 'workflow_dispatch'`. The
// workflow reads `github.workflow_ref` instead, which names docker-publish.yml
// only when this file was dispatched directly.
//
// ## Outputs
//
// `latest`, `minor` and `major` are each `true` or `false`, and `reason` is one
// line. They go to $GITHUB_OUTPUT (or stdout when it is unset), and a summary
// goes to $GITHUB_STEP_SUMMARY when that is set. docker/metadata-action throws
// on an `enable=` or `flavor: latest=` value that is neither `true` nor
// `false`, so if this step writes nothing, "Compute image tags" fails loudly
// instead of guessing.
//
// Dependency-free: the publish job runs no `pnpm install`. The registry read
// is `npm view @objectstack/cli versions --json`, so the self-test can put a
// fake `npm` first on PATH and drive the whole CLI, I/O included.

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { isEntrypoint } from '../invoked-as.mjs';

const PACKAGE = '@objectstack/cli';
const NPM_ARGS = ['view', PACKAGE, 'versions', '--json'];
const NPM_TIMEOUT_MS = 120_000;
const LANES = ['dispatch', 'release'];

const STABLE = /^(\d+)\.(\d+)\.(\d+)$/;
const PRERELEASE = /^\d+\.\d+\.\d+-[0-9A-Za-z.-]+$/;

/** `[major, minor, patch]` for a stable version, `null` for anything else. */
function stableParts(v) {
  const m = STABLE.exec(v);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

function compare(a, b) {
  for (let i = 0; i < 3; i += 1) if (a[i] !== b[i]) return a[i] - b[i];
  return 0;
}

/**
 * Read npm's version list. Returns `{ ok: true, versions }` or
 * `{ ok: false, why }`. It never throws: every failure is a value that the
 * caller turns into the lane's fail direction.
 */
export function readPublishedVersions(env = process.env) {
  const r = spawnSync('npm', NPM_ARGS, { encoding: 'utf8', env, timeout: NPM_TIMEOUT_MS });
  if (r.error) return { ok: false, why: `\`npm ${NPM_ARGS.join(' ')}\` did not run (${r.error.code ?? r.error.message})` };
  if (r.status !== 0) return { ok: false, why: `\`npm ${NPM_ARGS.join(' ')}\` exited ${r.status ?? `on ${r.signal}`}` };
  let parsed;
  try {
    parsed = JSON.parse(r.stdout);
  } catch {
    return { ok: false, why: `\`npm ${NPM_ARGS.join(' ')}\` printed something that is not JSON` };
  }
  // npm prints a bare string, not an array, for a package with one version.
  const versions = typeof parsed === 'string' ? [parsed] : parsed;
  if (!Array.isArray(versions) || versions.length === 0 || !versions.every((v) => typeof v === 'string')) {
    return { ok: false, why: `\`npm ${NPM_ARGS.join(' ')}\` did not answer with a list of versions` };
  }
  return { ok: true, versions };
}

/**
 * The decision, as a pure function of its inputs.
 *
 * @param {{ version: string, lane: 'dispatch'|'release', registry: {ok: true, versions: string[]} | {ok: false, why: string} | null }} input
 *   `registry` is `null` when it was not read (a prerelease needs no read).
 * @returns {{ latest: boolean, minor: boolean, major: boolean, reason: string, failDirection: boolean }}
 */
export function decide({ version, lane, registry }) {
  const none = (reason, failDirection = false) => ({ latest: false, minor: false, major: false, reason, failDirection });
  const v = stableParts(version);
  if (!v) return none(`${version} is a prerelease, so it gets only its exact tag`);

  const [X, Y] = v;
  if (!registry?.ok) {
    const why = registry?.why ?? 'npm was not read';
    if (lane === 'release') {
      return {
        latest: true, minor: true, major: true, failDirection: true,
        reason: `${why}; release lane, so every rolling tag moves as it did before this check existed`,
      };
    }
    return none(`${why}; dispatch lane, so only the exact tag ${version} is pushed and no rolling tag moves`, true);
  }

  const stable = registry.versions.map((s) => [s, stableParts(s)]).filter(([, p]) => p !== null);
  if (lane === 'dispatch' && !stable.some(([, p]) => compare(p, v) === 0)) {
    return none(
      `npm's version list (${registry.versions.length} versions) does not contain ${version}, so it may be stale ` +
        `and cannot rule out a newer version; dispatch lane, so only the exact tag ${version} is pushed`,
      true,
    );
  }

  const newest = (inRange) => {
    let best = null;
    for (const [s, p] of stable) if (inRange(p) && compare(p, v) > 0 && (!best || compare(p, best[1]) > 0)) best = [s, p];
    return best ? best[0] : null;
  };
  const overall = newest(() => true);
  const inMajor = newest((p) => p[0] === X);
  const inMinor = newest((p) => p[0] === X && p[1] === Y);

  const moves = [];
  const stays = [];
  (overall ? stays : moves).push(overall ? `latest (${overall} is newer)` : 'latest');
  (inMinor ? stays : moves).push(inMinor ? `${X}.${Y} (${inMinor} is newer)` : `${X}.${Y}`);
  (inMajor ? stays : moves).push(inMajor ? `${X} (${inMajor} is newer)` : `${X}`);
  const reason =
    `read ${registry.versions.length} versions from npm; ` +
    `${moves.length ? `moves ${moves.join(', ')}` : 'moves no rolling tag'}` +
    `${stays.length ? `; stays: ${stays.join(', ')}` : ''}`;
  return { latest: !overall, minor: !inMinor, major: !inMajor, reason, failDirection: false };
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--version' || a === '--lane') {
      out[a.slice(2)] = argv[i + 1];
      i += 1;
    } else {
      return { error: `unknown argument ${JSON.stringify(a)}` };
    }
  }
  if (!out.version) return { error: '--version is required' };
  if (!STABLE.test(out.version) && !PRERELEASE.test(out.version)) {
    return { error: `--version ${JSON.stringify(out.version)} is not a semver version` };
  }
  if (!LANES.includes(out.lane)) return { error: `--lane must be one of ${LANES.join(', ')}` };
  return out;
}

/** The CLI, with its environment and output sinks injectable. Returns the exit code. */
export function run(argv, env = process.env, out = (s) => process.stdout.write(s), err = (s) => process.stderr.write(s)) {
  const args = parseArgs(argv);
  if (args.error) {
    err(`docker-rolling-tags: ${args.error}\nusage: node scripts/ci/docker-rolling-tags.mjs --version VERSION --lane dispatch|release\n`);
    return 2;
  }
  const registry = stableParts(args.version) ? readPublishedVersions(env) : null;
  const d = decide({ version: args.version, lane: args.lane, registry });

  const lines = [`latest=${d.latest}`, `minor=${d.minor}`, `major=${d.major}`, `reason=${d.reason}`];
  if (env.GITHUB_OUTPUT) fs.appendFileSync(env.GITHUB_OUTPUT, `${lines.join('\n')}\n`);
  else out(`${lines.join('\n')}\n`);

  if (env.GITHUB_STEP_SUMMARY) {
    const [majorTag, minorPart] = args.version.split('.');
    const minorTag = `${majorTag}.${minorPart}`;
    fs.appendFileSync(
      env.GITHUB_STEP_SUMMARY,
      `### Rolling image tags for ${args.version} (${args.lane} lane)\n\n` +
        '| rolling tag | moves |\n|---|---|\n' +
        `| \`latest\` | ${d.latest} |\n| \`${minorTag}\` | ${d.minor} |\n| \`${majorTag}\` | ${d.major} |\n\n${d.reason}\n`,
    );
  }
  // A fail direction is the one outcome a reader must not miss in the log.
  out(`${d.failDirection ? '::warning::' : ''}rolling tags for ${args.version} (${args.lane} lane): ${d.reason}\n`);
  return 0;
}

// ---------------------------------------------------------------------------
// Self-test. Every row drives the real CLI in a child process, with a fake
// `npm` first on PATH and throwaway $GITHUB_OUTPUT / $GITHUB_STEP_SUMMARY files,
// so the npm call, the parse, the decision and the output format are all
// covered. The fake npm also records its argv, so a change to the registry
// query shows up as a failed row.
// ---------------------------------------------------------------------------

const LIST = ['17.6.0', '17.6.1', '17.7.0', '18.0.0', '18.1.2', '18.1.3', '18.2.0', '19.0.0-rc.1'];
const json = (v) => JSON.stringify(v);

const SELF_TEST_CASES = [
  {
    label: 'the newest stable version moves latest, X.Y and X, in both lanes',
    version: '18.2.0', lanes: ['dispatch', 'release'], npm: { stdout: json(LIST) },
    expect: { latest: true, minor: true, major: true }, warns: false,
  },
  {
    label: 'an older major that is not the newest in its line moves nothing',
    version: '17.6.0', lanes: ['dispatch'], npm: { stdout: json(LIST) },
    expect: { latest: false, minor: false, major: false }, warns: false,
  },
  {
    label: 'the newest of an older major moves its own X.Y and X but never latest',
    version: '17.7.0', lanes: ['dispatch'], npm: { stdout: json(LIST) },
    expect: { latest: false, minor: true, major: true }, warns: false,
  },
  {
    label: 'the newest patch of an older minor moves X.Y only',
    version: '18.1.3', lanes: ['dispatch'], npm: { stdout: json(LIST) },
    expect: { latest: false, minor: true, major: false }, warns: false,
  },
  {
    label: 'an older patch of an older minor moves nothing',
    version: '18.1.2', lanes: ['dispatch'], npm: { stdout: json(LIST) },
    expect: { latest: false, minor: false, major: false }, warns: false,
  },
  {
    label: 'a prerelease moves nothing and does not read npm',
    version: '19.0.0-rc.1', lanes: ['dispatch', 'release'], npm: { stdout: json(LIST) },
    expect: { latest: false, minor: false, major: false }, warns: false, npmCalled: false,
  },
  {
    label: 'a newer prerelease on npm does not hold latest back',
    version: '18.2.0', lanes: ['dispatch'], npm: { stdout: json([...LIST, '18.3.0-rc.0', '18.2.1-beta.1']) },
    expect: { latest: true, minor: true, major: true }, warns: false,
  },
  {
    label: 'npm failing in the dispatch lane pushes only the exact tag and warns',
    version: '18.2.0', lanes: ['dispatch'], npm: { stdout: '{"error":{"code":"ETIMEDOUT"}}', exit: 1 },
    expect: { latest: false, minor: false, major: false }, warns: true,
  },
  {
    label: 'npm failing in the release lane moves every rolling tag as before, and warns',
    version: '18.2.0', lanes: ['release'], npm: { stdout: '{"error":{"code":"ETIMEDOUT"}}', exit: 1 },
    expect: { latest: true, minor: true, major: true }, warns: true,
  },
  {
    label: 'npm missing from PATH in the dispatch lane pushes only the exact tag',
    version: '17.7.0', lanes: ['dispatch'], npm: null,
    expect: { latest: false, minor: false, major: false }, warns: true, npmCalled: false,
  },
  {
    label: 'output that is not JSON is unreadable: exact tag in dispatch, everything in release',
    version: '18.2.0', lanes: ['dispatch', 'release'], npm: { stdout: 'npm WARN something\n' },
    expect: { dispatch: { latest: false, minor: false, major: false }, release: { latest: true, minor: true, major: true } },
    warns: true,
  },
  {
    label: 'a list without the version is stale in the dispatch lane and pushes only the exact tag',
    version: '18.2.0', lanes: ['dispatch'], npm: { stdout: json(['17.7.0', '18.1.3']) },
    expect: { latest: false, minor: false, major: false }, warns: true,
  },
  {
    label: 'a list lagging a fresh publish still moves every rolling tag in the release lane',
    version: '18.3.0', lanes: ['release'], npm: { stdout: json(LIST) },
    expect: { latest: true, minor: true, major: true }, warns: false,
  },
  {
    label: 'a single-version package answers with a bare string, which is still a list',
    version: '1.0.0', lanes: ['dispatch'], npm: { stdout: json('1.0.0') },
    expect: { latest: true, minor: true, major: true }, warns: false,
  },
  {
    label: 'an empty list is unreadable, not proof that nothing is newer',
    version: '18.2.0', lanes: ['dispatch'], npm: { stdout: '[]' },
    expect: { latest: false, minor: false, major: false }, warns: true,
  },
  {
    label: 'a malformed version or lane is refused with exit 2 and writes no output',
    version: '18.2', lanes: ['dispatch'], npm: { stdout: json(LIST) }, exitCode: 2,
  },
];

// The roster is a LITERAL the table is checked against (the table-driven shape
// of scripts/check-agent-model-declared.mjs): each row label is a battery with
// a floor of 1, so a deleted or renamed row names itself at the floor.
const SELF_TEST_BATTERIES = Object.freeze({
  'the newest stable version moves latest, X.Y and X, in both lanes': 1,
  'an older major that is not the newest in its line moves nothing': 1,
  'the newest of an older major moves its own X.Y and X but never latest': 1,
  'the newest patch of an older minor moves X.Y only': 1,
  'an older patch of an older minor moves nothing': 1,
  'a prerelease moves nothing and does not read npm': 1,
  'a newer prerelease on npm does not hold latest back': 1,
  'npm failing in the dispatch lane pushes only the exact tag and warns': 1,
  'npm failing in the release lane moves every rolling tag as before, and warns': 1,
  'npm missing from PATH in the dispatch lane pushes only the exact tag': 1,
  'output that is not JSON is unreadable: exact tag in dispatch, everything in release': 1,
  'a list without the version is stale in the dispatch lane and pushes only the exact tag': 1,
  'a list lagging a fresh publish still moves every rolling tag in the release lane': 1,
  'a single-version package answers with a bare string, which is still a list': 1,
  'an empty list is unreadable, not proof that nothing is newer': 1,
  'a malformed version or lane is refused with exit 2 and writes no output': 1,
});
// Deleting a roster entry silences its floor as surely as zeroing it.
const SELF_TEST_BATTERY_FLOOR = 16;

let selfTestReachedVerdict = false;

function readOutputs(file) {
  const text = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  const o = {};
  for (const line of text.split('\n')) {
    const eq = line.indexOf('=');
    if (eq > 0) o[line.slice(0, eq)] = line.slice(eq + 1);
  }
  return { text, o };
}

function selfTest() {
  const failures = [];
  const seen = new Map();
  const fail = (label, message) => failures.push(`${label}: ${message}`);
  const self = fileURLToPath(import.meta.url);
  // Child output is indented before it is quoted, so a `::warning::` it printed
  // never starts a line of this self-test's own output.
  const quote = (s) => s.split('\n').map((l) => `      ${l}`).join('\n');
  let runs = 0;

  for (const c of SELF_TEST_CASES) {
    // Registered FIRST, before anything that can `continue`, so the floor
    // measures reach.
    seen.set(c.label, (seen.get(c.label) ?? 0) + 1);
    for (const lane of c.lanes) {
      const dir = fs.mkdtempSync(path.join(tmpdir(), 'docker-rolling-tags-'));
      try {
        const bin = path.join(dir, 'bin');
        fs.mkdirSync(bin);
        const argvLog = path.join(dir, 'npm-argv');
        if (c.npm) {
          fs.writeFileSync(path.join(dir, 'npm-stdout'), c.npm.stdout);
          fs.writeFileSync(
            path.join(bin, 'npm'),
            `#!/bin/sh\nPATH=/usr/bin:/bin\nprintf '%s\\n' "$*" >> '${argvLog}'\ncat '${path.join(dir, 'npm-stdout')}'\nexit ${c.npm.exit ?? 0}\n`,
            { mode: 0o755 },
          );
        }
        const env = {
          // Only the fake bin directory: a real npm further down PATH must not
          // answer a row that models npm as missing.
          PATH: bin,
          GITHUB_OUTPUT: path.join(dir, 'output'),
          GITHUB_STEP_SUMMARY: path.join(dir, 'summary'),
        };
        const r = spawnSync(process.execPath, [self, '--version', c.version, '--lane', lane], { encoding: 'utf8', env });
        runs += 1;
        const where = `${c.version} ${lane}`;
        const { text, o } = readOutputs(env.GITHUB_OUTPUT);

        if (c.exitCode !== undefined) {
          if (r.status !== c.exitCode) fail(c.label, `${where}: exit ${r.status}, expected ${c.exitCode}\n${quote(r.stderr)}`);
          if (text !== '') fail(c.label, `${where}: a refusal must write no output, wrote:\n${quote(text)}`);
          continue;
        }
        if (r.status !== 0) {
          fail(c.label, `${where}: exit ${r.status}\n${quote(r.stdout + r.stderr)}`);
          continue;
        }
        const want = c.expect[lane] ?? c.expect;
        for (const k of ['latest', 'minor', 'major']) {
          if (o[k] !== String(want[k])) fail(c.label, `${where}: ${k}=${o[k]}, expected ${want[k]}`);
        }
        if (!o.reason) fail(c.label, `${where}: no reason= output`);
        const warned = r.stdout.split('\n').some((l) => l.startsWith('::warning::'));
        if (warned !== c.warns) fail(c.label, `${where}: ${c.warns ? 'expected' : 'did not expect'} a ::warning:: line\n${quote(r.stdout)}`);
        const summary = fs.existsSync(env.GITHUB_STEP_SUMMARY) ? fs.readFileSync(env.GITHUB_STEP_SUMMARY, 'utf8') : '';
        if (!summary.includes(`Rolling image tags for ${c.version} (${lane} lane)`)) fail(c.label, `${where}: no step summary`);
        const npmArgv = fs.existsSync(argvLog) ? fs.readFileSync(argvLog, 'utf8').trim() : null;
        const expectCalled = c.npmCalled ?? true;
        if (expectCalled && npmArgv !== NPM_ARGS.join(' ')) {
          fail(c.label, `${where}: npm was called as ${json(npmArgv)}, expected ${json(NPM_ARGS.join(' '))}`);
        }
        if (!expectCalled && npmArgv !== null) fail(c.label, `${where}: npm was called (${json(npmArgv)}) but should not have been`);
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    }
  }

  // The lane argument's own refusal, beside the version's in the last row.
  {
    const r = spawnSync(process.execPath, [self, '--version', '18.2.0', '--lane', 'push'], {
      encoding: 'utf8', env: { PATH: '' },
    });
    runs += 1;
    if (r.status !== 2) failures.push(`an unknown lane must exit 2, got ${r.status}`);
  }

  const declared = Object.keys(SELF_TEST_BATTERIES);
  if (declared.length < SELF_TEST_BATTERY_FLOOR) {
    failures.push(`SELF_TEST_BATTERIES declares ${declared.length} batteries, below the pinned ${SELF_TEST_BATTERY_FLOOR}`);
  }
  for (const [name, count] of seen) {
    if (!declared.includes(name)) failures.push(`case "${name}" (${count}) is not declared in SELF_TEST_BATTERIES`);
  }
  for (const name of declared) {
    const count = seen.get(name) ?? 0;
    if (count < SELF_TEST_BATTERIES[name]) {
      failures.push(`self-test battery "${name}" registered ${count} case(s), below its floor of ${SELF_TEST_BATTERIES[name]} -- it DID NOT RUN`);
    }
  }

  if (failures.length > 0) {
    console.error(`✗ docker-rolling-tags --self-test: ${failures.length} failure(s)`);
    for (const f of failures) console.error(`  • ${f}`);
    process.exit(1);
  }
  console.log(`✓ docker-rolling-tags --self-test: ${SELF_TEST_CASES.length} cases, ${runs} CLI runs against a fake npm.`);
  selfTestReachedVerdict = true;
}

if (isEntrypoint(import.meta.url)) {
  if (process.argv.includes('--self-test')) {
    selfTest();
    if (!selfTestReachedVerdict) {
      console.error(
        '\n✗ docker-rolling-tags self-test: selfTest() returned without reaching its verdict,\n'
          + 'so no success line was printed. Exiting 0 here would report a self-test\n'
          + 'that never finished as a self-test that passed.\n',
      );
      process.exit(1);
    }
  } else {
    process.exit(run(process.argv.slice(2)));
  }
}
