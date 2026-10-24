import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(fileURLToPath(import.meta.url), '../../..');
const WORKFLOW_DIR = path.join(ROOT, '.github', 'workflows');
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

/** Every workflow file, as `{ file, yaml }`. */
function workflows(): { file: string; yaml: string }[] {
  return fs
    .readdirSync(WORKFLOW_DIR)
    .filter((f) => f.endsWith('.yml') || f.endsWith('.yaml'))
    .sort()
    .map((file) => ({ file, yaml: fs.readFileSync(path.join(WORKFLOW_DIR, file), 'utf8') }));
}

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
 * Ported deliberately from `ci-cd-pipeline-doc.test.ts`, which established the
 * shape for the same reason.
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

  it('no workflow runs corepack outside the shared script', () => {
    const files = workflows();
    expect(files.length, 'no workflow files found — this whole file would be vacuous').toBeGreaterThan(0);

    const offenders = files
      .filter(({ yaml }) => runSteps(yaml).some((s) => /\bcorepack\b/.test(s)))
      .map(({ file }) => file);

    expect(
      offenders,
      'these workflows invoke corepack directly instead of `bash ' +
        SETUP +
        '`. The download it performs is a registry read that has reddened a REQUIRED check ' +
        'before any gate logic ran (objectui#8099); route it through the shared script so the ' +
        'retry and the self-describing step name apply here too.',
    ).toEqual([]);

    // Anti-vacuity for the reader above: the comment-only mentions must still be
    // THERE, or this assertion is passing because the corpus emptied out.
    const commentOnly = files.filter(
      ({ yaml }) => /\bcorepack\b/.test(yaml) && !runSteps(yaml).some((s) => /\bcorepack\b/.test(s)),
    );
    expect(
      commentOnly.map((w) => w.file),
      'the two comment-only corepack mentions must stay visible to this scan and stay unjudged — ' +
        'if they are gone, re-derive whether this rule still reads what it claims to read',
    ).toEqual(['changelog.yml', 'dependabot-auto-merge.yml']);
  });

  it('every workflow that invokes pnpm also runs the shared setup', () => {
    const files = workflows();

    const usesPnpm = files.filter(({ yaml }) => runSteps(yaml).some((s) => /\bpnpm\b/.test(s)));
    expect(
      usesPnpm.length,
      'no workflow appears to invoke pnpm, which cannot be true — the step reader has drifted',
    ).toBeGreaterThan(0);

    const missing = usesPnpm
      .filter(({ yaml }) => !runSteps(yaml).some((s) => s.includes(SETUP)))
      .map(({ file }) => file);

    expect(
      missing,
      `these workflows run pnpm without calling \`bash ${SETUP}\` first. pnpm is not on the runner: ` +
        'the first invocation downloads it from registry.npmjs.org, and unrouted that download lands ' +
        "inside whichever step happens to touch pnpm first — including `actions/setup-node`'s own " +
        'cache probe, where a red is hardest to attribute (objectui#8099).',
    ).toEqual([]);
  });

  it('every job that calls the setup script checks the repository out first', () => {
    const files = workflows().filter(({ yaml }) => yaml.includes(SETUP));
    expect(files.length, `no workflow references ${SETUP} — the sweep was undone`).toBeGreaterThan(0);

    const bad: string[] = [];
    for (const { file, yaml } of files) {
      const lines = yaml.split('\n');
      // Job blocks: two-space keys inside the `jobs:` mapping.
      const jobsAt = lines.findIndex((l) => /^jobs:[ \t]*$/.test(l));
      expect(jobsAt, `${file} must have a top-level \`jobs:\` mapping`).toBeGreaterThan(-1);

      const starts: number[] = [];
      for (let i = jobsAt + 1; i < lines.length; i++) {
        if (/^ {2}[a-z0-9][a-z0-9-]*:[ \t]*$/.test(lines[i])) starts.push(i);
      }
      starts.push(lines.length);

      for (let s = 0; s + 1 < starts.length; s++) {
        const block = lines.slice(starts[s], starts[s + 1]);
        const setupAt = block.findIndex((l) => l.includes(SETUP));
        if (setupAt === -1) continue;
        const checkoutAt = block.findIndex((l) => /uses:\s*actions\/checkout@/.test(l));
        if (checkoutAt === -1 || checkoutAt > setupAt) {
          bad.push(`${file} :: ${block[0].trim()}`);
        }
      }
    }

    expect(
      bad,
      `${SETUP} is a file in this repository, so a job that runs it before \`actions/checkout\` ` +
        'dies with "No such file or directory" — a failure that reads nothing like a toolchain problem.',
    ).toEqual([]);
  });
});
