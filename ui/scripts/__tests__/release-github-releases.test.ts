/**
 * objectui#11596 — the publish lane pushes the version's git tags and creates its
 * GitHub Releases itself, because `changesets/action@v1` no longer does.
 *
 * v1 pushes a tag and creates a Release only for the packages whose
 * `New tag: <pkg>@<version>` line it parses from the publish script's stdout, and
 * `@changesets/cli` v3 prints none. 17.6.0 and 17.7.0 reached npm with no tag and
 * no Release while the run stayed green. Two steps of
 * `.github/workflows/changeset-release.yml` now do that half of the action's
 * `runPublish`, after the npm check: "Push the release tags" and "Create GitHub
 * Releases", the second running `scripts/release-github-releases.mjs` (ported from
 * objectstack).
 *
 * What this file pins, and why each half lives here:
 *
 *   1. The script's own logic — body truncation, idempotency, race convergence,
 *      the release set and the tag list — is its `--self-test`, which carries a
 *      battery floor of its own. This file runs it, so `pnpm test` fails when it
 *      does; nothing else in CI runs it.
 *   2. The two steps' LANE SCOPING. A publish-lane step reachable from the
 *      `schedule` refresh lane, a Release step that runs `--dry-run` (exit 0,
 *      released nothing), or a Release step ahead of the tag push (the API then
 *      creates every tag itself, lightweight) are each a green run that is
 *      wrong. Workflow files are read by nothing else in this repository, so
 *      each property is asserted here, and each assertion is shown able to fail
 *      by a mutation that is itself asserted to have applied.
 *
 * ⛔ Nothing here calls the GitHub API or creates a tag. `--dry-run` is exercised
 * with no token and an unreachable API URL, so a regression that made it write
 * would fail rather than write.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse as parseYaml } from 'yaml';

import { repoRoot, workflowDir } from './workflow-checks';

const SCRIPT = path.join(repoRoot, 'scripts/release-github-releases.mjs');
const workflowSource = fs.readFileSync(path.join(workflowDir, 'changeset-release.yml'), 'utf8');

const PUBLISH = 'Publish to npm';
const VERIFY = 'Verify the release reached npm';
const PUSH_TAGS = 'Push the release tags';
const CREATE_RELEASES = 'Create GitHub Releases (bodies truncated to the API limit)';

const RELEASE_VERSION_SOURCE = '${{ needs.lane.outputs.manifest_version }}';

interface Step {
  name?: string;
  id?: string;
  if?: string;
  run?: string;
  uses?: string;
  env?: Record<string, string>;
}

interface Workflow {
  permissions?: Record<string, string>;
  jobs: Record<string, { if?: string; permissions?: Record<string, string>; steps?: Step[] }>;
}

/** The `if:` text with the `${{ }}` wrapper and runs of whitespace normalised away. */
function condition(step: Step | undefined): string {
  return String(step?.if ?? '')
    .replace(/^\s*\$\{\{\s*/, '')
    .replace(/\s*\}\}\s*$/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Every way the two steps can stop meaning "push this version's tags and create its
 * Releases, on the publish lane only". Empty means the wiring holds.
 */
function wiringProblems(source: string): string[] {
  const workflow = parseYaml(source) as Workflow;
  const job = workflow.jobs?.release;
  const steps = job?.steps ?? [];
  const problems: string[] = [];
  const indexOf = (name: string) => steps.findIndex((s) => s.name === name);
  const stepNamed = (name: string) => steps.find((s) => s.name === name);

  for (const name of [PUBLISH, VERIFY, PUSH_TAGS, CREATE_RELEASES]) {
    const count = steps.filter((s) => s.name === name).length;
    if (count !== 1) problems.push(`the release job has ${count} step(s) named "${name}", not exactly one`);
  }
  if (problems.length) return problems;

  const order = [PUBLISH, VERIFY, PUSH_TAGS, CREATE_RELEASES].map(indexOf);
  if (!order.every((at, i) => i === 0 || at > order[i - 1])) {
    problems.push(
      `steps run out of order (${[PUBLISH, VERIFY, PUSH_TAGS, CREATE_RELEASES].join(' -> ')} expected, ` +
        `got positions ${order.join(', ')}): the tags must be pushed after the npm check and BEFORE the ` +
        'Releases, or the API creates each tag itself as a lightweight tag',
    );
  }

  const publishId = stepNamed(PUBLISH)?.id;
  const verifyId = stepNamed(VERIFY)?.id;
  if (!publishId || !verifyId) {
    problems.push(`the publish and npm-check steps need ids for the conditions to read (got ${publishId} / ${verifyId})`);
    return problems;
  }

  for (const name of [PUSH_TAGS, CREATE_RELEASES]) {
    const step = stepNamed(name);
    const cond = condition(step);
    const required = [
      "github.event_name == 'push'",
      '!cancelled()',
      `steps.${publishId}.outcome == 'success'`,
      `steps.${verifyId}.outcome == 'success'`,
    ];
    for (const clause of required) {
      if (!cond.includes(clause)) problems.push(`"${name}" if: is missing \`${clause}\` (got \`${cond}\`)`);
    }
    // Every clause is ANDed. An `||` — or a lane named at all — opens a second way in.
    for (const forbidden of ['||', 'schedule', 'workflow_dispatch', 'always()']) {
      if (cond.includes(forbidden)) {
        problems.push(`"${name}" if: contains \`${forbidden}\`, which can reach it from outside the publish lane`);
      }
    }
    if (step?.env?.RELEASE_VERSION !== RELEASE_VERSION_SOURCE) {
      problems.push(
        `"${name}" must take RELEASE_VERSION from ${RELEASE_VERSION_SOURCE} — the version the npm check ` +
          `confirmed (got ${step?.env?.RELEASE_VERSION})`,
      );
    }
  }

  const pushRun = String(stepNamed(PUSH_TAGS)?.run ?? '');
  if (!pushRun.includes('node scripts/release-github-releases.mjs --print-tags')) {
    problems.push('"Push the release tags" no longer reads the tag list from `release-github-releases.mjs --print-tags`');
  }
  const pushes = pushRun.split('\n').filter((l) => /\bgit\s+push\b/.test(l));
  if (pushes.length !== 1) problems.push(`"Push the release tags" should push exactly once (found ${pushes.length})`);
  for (const line of pushes) {
    if (/--force|\s-f\b|--delete|\s-d\b|\bHEAD\b|--tags|--mirror|--all/.test(line)) {
      problems.push(`"Push the release tags" pushes more than this version's tag refs: \`${line.trim()}\``);
    }
  }

  const releases = stepNamed(CREATE_RELEASES);
  if (String(releases?.run ?? '').trim() !== 'node scripts/release-github-releases.mjs') {
    problems.push(
      `"Create GitHub Releases" must run the script bare — \`--dry-run\` and \`--self-test\` both exit 0 having ` +
        `released nothing (got \`${releases?.run}\`)`,
    );
  }
  if (releases?.env?.GITHUB_TOKEN !== '${{ secrets.GITHUB_TOKEN }}') {
    problems.push(`"Create GitHub Releases" needs GITHUB_TOKEN from secrets (got ${releases?.env?.GITHUB_TOKEN})`);
  }

  // A tag push and a Release create are both `contents: write`.
  const contents = job?.permissions ? job.permissions.contents : workflow.permissions?.contents;
  if (contents !== 'write') {
    problems.push(`the release job's effective \`contents\` permission is ${contents}, not write`);
  }

  // The job guard is what keeps a version that is ALREADY on npm from reaching these steps.
  const jobIf = String(job?.if ?? '').replace(/\s+/g, ' ');
  if (!jobIf.includes("(github.event_name == 'push' && needs.lane.outputs.version_on_npm == 'false')")) {
    problems.push('the release job no longer limits `push` to a version that is not on npm yet');
  }

  return problems;
}

describe('the ported script passes its own self-test', () => {
  it('reaches its verdict with every battery at or above its floor', () => {
    const out = execFileSync(process.execPath, [SCRIPT, '--self-test'], { encoding: 'utf8' });
    expect(out).toMatch(/^✓ release-github-releases --self-test: \d+ assertions/m);
  }, 60_000);
});

describe('--dry-run plans without calling the API', () => {
  it('plans a Release for every tag the version owes, with no token and an unreachable API', () => {
    // The anchor's manifest version: the release `main` currently declares, whose
    // CHANGELOG entries `changeset version` wrote for every package of the group.
    const version = JSON.parse(fs.readFileSync(path.join(repoRoot, 'packages/core/package.json'), 'utf8')).version;
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      RELEASE_VERSION: version,
      GITHUB_REPOSITORY: 'objectstack-ai/objectui',
      GITHUB_SHA: 'deadbeef',
      GITHUB_API_URL: 'http://127.0.0.1:9',
    };
    delete env.GITHUB_TOKEN;
    delete env.GH_TOKEN;
    delete env.PUBLISHED;

    const tags = execFileSync(process.execPath, [SCRIPT, '--print-tags'], { encoding: 'utf8', env })
      .trim()
      .split('\n');
    const out = execFileSync(process.execPath, [SCRIPT, '--dry-run'], { encoding: 'utf8', env });

    expect(tags.length, 'the tag list is empty, so the comparison below would compare nothing').toBeGreaterThan(0);
    expect(tags.every((t) => t.endsWith(`@${version}`))).toBe(true);
    const planned = out
      .split('\n')
      .filter((l) => l.includes('\t'))
      .map((l) => l.split('\t')[0]);
    // A public package that ships no CHANGELOG.md yet (a new one, before its first
    // release) is tagged but gets no Release; the script says so on a `skipped` line.
    const skipped = [...out.matchAll(/^skipped {2}(\S+) ships no CHANGELOG\.md$/gm)].map((m) => `${m[1]}@${version}`);
    expect([...planned, ...skipped].sort()).toEqual([...tags].sort());
    expect(out).toMatch(new RegExp(`^${tags.length} release\\(s\\) planned .*, 0 failed to plan\\.$`, 'm'));
    expect(out).not.toMatch(/^(created|updated) /m);
  }, 60_000);
});

describe('changeset-release.yml pushes the tags and creates the Releases on the publish lane only', () => {
  it('holds every wiring property on the real workflow', () => {
    expect(wiringProblems(workflowSource)).toEqual([]);
  });
});

describe('the wiring pin can fail (non-vacuity)', () => {
  // Each mutation is asserted to have APPLIED before its result is read — a no-op
  // edit would leave the real workflow under test and report a green that means
  // nothing.
  function mutate(from: string, to: string, source = workflowSource): string {
    const mutated = source.replace(from, to);
    expect(mutated, `mutation did not apply: ${from}`).not.toBe(source);
    return mutated;
  }

  const PUSH_IF =
    "      - name: Push the release tags\n        if: >-\n          ${{ !cancelled() && github.event_name == 'push'";
  const RELEASE_IF =
    "      - name: Create GitHub Releases (bodies truncated to the API limit)\n        if: >-\n          ${{ !cancelled() && github.event_name == 'push'";

  it('goes red when a step loses its event test', () => {
    const mutated = mutate(PUSH_IF, PUSH_IF.replace(" && github.event_name == 'push'", ''));
    expect(wiringProblems(mutated).join('\n')).toContain(`"${PUSH_TAGS}" if: is missing \`github.event_name == 'push'\``);
  });

  it('goes red when a step is opened to the refresh lane with an `||`', () => {
    const mutated = mutate(
      RELEASE_IF,
      RELEASE_IF.replace("github.event_name == 'push'", "(github.event_name == 'push' || github.event_name == 'schedule')"),
    );
    const problems = wiringProblems(mutated).join('\n');
    expect(problems).toContain(`"${CREATE_RELEASES}" if: contains \`||\``);
    expect(problems).toContain(`"${CREATE_RELEASES}" if: contains \`schedule\``);
  });

  it('goes red when `!cancelled()` is weakened to `always()`', () => {
    const mutated = mutate(RELEASE_IF, RELEASE_IF.replace('!cancelled()', 'always()'));
    const problems = wiringProblems(mutated).join('\n');
    expect(problems).toContain(`"${CREATE_RELEASES}" if: is missing \`!cancelled()\``);
    expect(problems).toContain(`"${CREATE_RELEASES}" if: contains \`always()\``);
  });

  it('goes red when the Release step runs --dry-run', () => {
    const mutated = mutate(
      '        run: node scripts/release-github-releases.mjs\n',
      '        run: node scripts/release-github-releases.mjs --dry-run\n',
    );
    expect(wiringProblems(mutated).join('\n')).toContain('must run the script bare');
  });

  it('goes red when the version comes from anywhere but the lane output', () => {
    const at = workflowSource.indexOf(`      - name: ${CREATE_RELEASES}`);
    const tail = mutate(
      `RELEASE_VERSION: ${RELEASE_VERSION_SOURCE}`,
      'RELEASE_VERSION: ${{ github.ref_name }}',
      workflowSource.slice(at),
    );
    expect(wiringProblems(workflowSource.slice(0, at) + tail).join('\n')).toContain(
      `"${CREATE_RELEASES}" must take RELEASE_VERSION from`,
    );
  });

  it('goes red when the Releases are created before the tags are pushed', () => {
    const workflow = parseYaml(workflowSource) as Workflow;
    const steps = workflow.jobs.release.steps ?? [];
    const push = steps.findIndex((s) => s.name === PUSH_TAGS);
    const releases = steps.findIndex((s) => s.name === CREATE_RELEASES);
    expect(push, 'fixture: both steps exist').toBeGreaterThan(-1);
    expect(releases).toBe(push + 1);
    [steps[push], steps[releases]] = [steps[releases], steps[push]];
    const swapped = JSON.stringify(workflow);
    expect(swapped).not.toBe(JSON.stringify(parseYaml(workflowSource)));
    expect(wiringProblems(swapped).join('\n')).toContain('steps run out of order');
  });

  it('goes red when the tag push widens to every local tag', () => {
    const mutated = mutate('git push origin "${refs[@]}"', 'git push origin --tags');
    expect(wiringProblems(mutated).join('\n')).toContain('pushes more than this version\'s tag refs');
  });
});
