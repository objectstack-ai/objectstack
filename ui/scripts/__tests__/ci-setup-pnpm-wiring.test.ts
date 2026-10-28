import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { jobBlock, rootCi, UI_JOBS, withoutComments } from './helpers/root-ci';

const ROOT = path.resolve(fileURLToPath(import.meta.url), '../../..');
const SETUP = 'scripts/ci-setup-pnpm.sh';

/**
 * objectui#8099: the toolchain download is one thing, so it lives in one place —
 * and this file is what keeps the fourteenth workflow from being written without
 * it.
 *
 * ## What happened
 *
 * A Corepack fetch of the pinned pnpm tarball died inside undici ten seconds into
 * a job, reddening the REQUIRED check `README Export Check` on a one-file prose
 * diff. `rerun_failed_jobs` on the same head turned it green with no code change.
 * `scripts/dependabot-merge-gate.mjs` classifies that check as a required
 * context, and since objectui#6160 the `merge_group` floor derives from that
 * list — so on the queue leg this is a 60-minute stall, not one re-run.
 *
 * ## Why a WIRING pin and not just the fix
 *
 * The fix itself is exercised by `bash scripts/ci-setup-pnpm.sh --self-test`,
 * which stubs the registry read and drives the real retry loop. ⛔ This file
 * deliberately restates none of that.
 *
 * What it pins is the property the card was actually about: BREADTH. Thirteen
 * workflows ran `corepack enable` when this landed and any one of them could be
 * reddened by the same blip. A one-workflow fix would have left twelve exposed
 * AND made the next occurrence harder to recognise, because the obvious
 * precedent would look already-handled. A sweep is a one-time act; nothing stops
 * a fourteenth workflow being typed with a bare `corepack enable` tomorrow, and
 * that workflow would be silently back on the unprotected path.
 *
 * ## The four properties, and the direction each can fail quietly
 *
 *   1. The script exists and is executable — a workflow calling a missing file
 *      fails loudly, but only once someone opens a PR.
 *   2. No `run:` step spells `corepack` directly. This is the breadth rule, and
 *      it reads `run:` BODIES only: two workflows (`changelog.yml`,
 *      `dependabot-auto-merge.yml`) mention `corepack enable` in COMMENTS, one of
 *      them recording the objectui#6392 ruling that removed the step because
 *      nothing in that job calls pnpm. ⛔ Those comments are not violations and
 *      an anchored or whole-file scan would call them one.
 *   3. Every workflow that invokes `pnpm` in a `run:` step also calls the setup
 *      script. This is the direction a NEW workflow fails: it needs pnpm, copies
 *      a setup from somewhere, and misses this line.
 *   4. Every job calling the script checks the repository out first. The script
 *      is a repo file; a job that runs it before `actions/checkout` fails at
 *      `No such file or directory`, and that ordering is invisible to a reader
 *      scanning for the step's presence.
 *
 * ## Anti-vacuity
 *
 * Each population is asserted non-empty in the same run that judges it. A
 * renamed directory, a changed step spelling or a regex that stops matching
 * would otherwise turn every assertion here into a green taken over nothing —
 * which is the failure mode this repository has recorded more than once.
 */

/**
 * Every `run:` step body in a piece of workflow YAML — single-line and block
 * scalar alike, and nothing else.
 *
 * Comments are excluded by construction rather than by a filter: a `#` line is
 * never the value of a `run:` key. That is the whole reason this reads steps
 * instead of the raw file, and it is what lets `changelog.yml`'s and
 * `dependabot-auto-merge.yml`'s explanatory comments say the word `corepack`
 * without being read as a step that runs it.
 *
 * Ported deliberately from objectui's CI-guide pin test (deleted by objectstack#26058), which
 * established the shape for the same reason.
 */
function runSteps(yaml: string): string[] {
  const lines = yaml.split('\n');
  const steps: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const at = lines[i].indexOf('run:');
    if (at === -1 || !/^[\s-]*$/.test(lines[i].slice(0, at))) continue;
    const value = lines[i].slice(at + 'run:'.length).trim();
    if (!/^[|>][-+]?$/.test(value)) {
      steps.push(value);
      continue;
    }
    const body: string[] = [];
    for (let j = i + 1; j < lines.length; j++) {
      if (lines[j].trim() === '') continue;
      if (lines[j].search(/\S/) <= at) break;
      body.push(lines[j].trim());
    }
    steps.push(body.join('\n'));
  }
  return steps;
}

describe('the shared CI pnpm setup is wired everywhere pnpm is used', () => {
  it('ships an executable script at the path the workflows name', () => {
    const abs = path.join(ROOT, SETUP);
    expect(fs.existsSync(abs), `${SETUP} must exist — 18 workflow steps call it by this path`).toBe(true);
    expect((fs.statSync(abs).mode & 0o111) !== 0, `${SETUP} must be executable`).toBe(true);
  });

  it('its own self-test passes, so the retry loop is exercised and not merely present', () => {
    const run = spawnSync('bash', [SETUP, '--self-test'], { cwd: ROOT, encoding: 'utf8' });
    expect(run.status, `${SETUP} --self-test failed:\n${run.stdout}\n${run.stderr}`).toBe(0);
    expect(run.stdout).toContain('self-test OK');
  });

  // `no workflow runs corepack outside the shared script`, `every workflow that
  // invokes pnpm also runs the shared setup` and `every job that calls the
  // setup script checks the repository out first` retired with
  // objectstack#25712. They swept objectui's workflows under
  // `ui/.github/workflows/` for calls to this script, and those run nowhere
  // under the monorepo: GitHub runs the root `.github/workflows/` alone. What
  // objectui's CI became is the four root `* UI` jobs (objectstack#25697),
  // which set pnpm up through the root composite action
  // `./.github/actions/setup-pnpm`, objectstack's answer to the same Corepack
  // fetch. The describe below asks the same three questions of those jobs, by
  // path. This script and its self-test stay; no root job calls it.
});

describe('the root ui jobs set pnpm up through the root shared setup', () => {
  const SHARED = 'uses: ./.github/actions/setup-pnpm';
  const jobs = Object.values(UI_JOBS).map((key) => ({ key, block: withoutComments(jobBlock(rootCi(), key)) }));

  it.each(jobs)('$key runs no corepack outside the shared setup', ({ block }) => {
    expect(runSteps(block).filter((s) => /\bcorepack\b/.test(s))).toEqual([]);
  });

  it.each(jobs)('$key checks the repository out, then sets pnpm up, before its first pnpm', ({ block }) => {
    const checkoutAt = block.search(/uses:\s*actions\/checkout@/);
    const setupAt = block.indexOf(SHARED);
    expect(checkoutAt, 'the job checks nothing out').toBeGreaterThan(-1);
    expect(setupAt, `the job has no \`${SHARED}\` step after its checkout`).toBeGreaterThan(checkoutAt);

    const firstPnpm = runSteps(block).find((s) => /\bpnpm\b/.test(s));
    expect(firstPnpm, 'the job runs no pnpm at all, so this reading has drifted').toBeDefined();
    expect(
      block.indexOf(firstPnpm!.split('\n')[0]),
      'the job runs pnpm before the shared setup has put it on the runner',
    ).toBeGreaterThan(setupAt);
  });
});
