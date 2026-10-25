import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { childVitestEnv } from './helpers/child-vitest-env';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

/**
 * objectui#8274 — the `DIST_PINS_ENABLED` guard in `vitest.config.mts` refuses
 * `vitest --project dist` when `OBJECTUI_DIST_PINS` is not `1`, and it used to
 * justify that refusal with a sentence about vitest that was FALSE:
 *
 *   "`dist` project is NOT declared and this run would collect ZERO files and
 *    exit GREEN."
 *
 * Vitest does not exit green on an unresolvable `--project`. Its project
 * resolution throws `No projects matched the filter "..."` and the process
 * exits 1 — measured on vitest 4.1.10, and measured again by this file on
 * whatever vitest the repo installs today.
 *
 * ## Why a spawn and not a grep
 *
 * The sentence was wrong about vitest, so a pin that only greps the sentence
 * pins the WORDS and not the fact: it stays green in the one direction that
 * actually matters (vitest changing to swallow the bad filter and exit 0),
 * which is the direction that would silently make the guard load-bearing again
 * for a reason the comment no longer states. Worse, a grep-only pin invites the
 * fix of editing the sentence until the grep passes.
 *
 * So the fact is measured: `unresolvableProjectIsLoud` runs a real vitest with
 * a project name nothing declares. If vitest ever answers 0 there, this file
 * goes red and whoever sees it knows the guard's justification — and the
 * `--no-passWithNoTests` reasoning in `app-test-entry-8240.test.ts`, which
 * rests on the same behaviour — needs rereading.
 *
 * The price is two vitest spawns. Both fail during project resolution, before
 * any test graph is built: measured ~1.7s each on this tree, which is what
 * makes the strong form of this pin affordable.
 *
 * The third case is the cheap static half, and it is the one that would have
 * caught the original defect: the throw's text must not go back to claiming a
 * silent green.
 */
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const configPath = path.join(repoRoot, 'vitest.config.mts');

/** The vitest CLI entry, resolved rather than assumed at a `node_modules` path. */
const vitestCli = (() => {
  const require = createRequire(path.join(repoRoot, 'noop.js'));
  const pkgPath = require.resolve('vitest/package.json');
  const bin = (JSON.parse(fs.readFileSync(pkgPath, 'utf8')).bin as { vitest: string }).vitest;
  return path.resolve(path.dirname(pkgPath), bin);
})();

/**
 * Run the real vitest CLI from the repo root with a deliberately clean env:
 * `OBJECTUI_DIST_PINS` deleted so the guard's precondition is the one under
 * test, and `childVitestEnv()` for the rest — the `VITEST*` markers this
 * process runs under deleted so the child is a fresh CLI rather than a nested
 * worker, and the agent markers deleted so what the assertions below read is
 * the stream CI produces rather than the uncoloured one an agent container
 * talks vitest into (objectui#8616).
 */
function runVitest(args: string[]): { status: number | null; output: string } {
  const env = childVitestEnv();
  delete env.OBJECTUI_DIST_PINS;

  const result = spawnSync(process.execPath, [vitestCli, ...args], {
    cwd: repoRoot,
    encoding: 'utf8',
    env,
    timeout: 120_000,
  });

  return { status: result.status, output: `${result.stdout ?? ''}${result.stderr ?? ''}` };
}

describe('objectui#8274 — what vitest actually does with an unresolvable --project', () => {
  it('refuses the filter and exits NON-ZERO (it does not collect zero files and exit green)', () => {
    const { status, output } = runVitest([
      'run',
      '--project',
      '__objectui_no_such_project_8274__',
    ]);

    expect(output).toContain('No projects matched the filter');
    expect(output).toContain('__objectui_no_such_project_8274__');
    expect(status).not.toBe(0);
  }, 180_000);

  it('says nothing about the remedy — which is the whole reason the guard exists', () => {
    // The other half of the justification the guard now states. Vitest's own
    // refusal is loud but unhelpful: it names neither the env var that declares
    // the project nor the task that sets it. If vitest ever started naming
    // them, the guard's remaining value would need re-arguing.
    const { output } = runVitest(['run', '--project', '__objectui_no_such_project_8274__']);

    expect(output).not.toContain('OBJECTUI_DIST_PINS');
    expect(output).not.toContain('test:dist');
  }, 180_000);
});

describe('the guard itself', () => {
  it('fires for --project dist without the env var, and reaches the reader first', () => {
    const { status, output } = runVitest(['run', '--project', 'dist']);

    // The guard throws from the config's module scope, so the run dies at
    // config load and the reader gets THIS message. (Not asserted: the absence
    // of vitest's own refusal. A config-load failure makes vitest echo the
    // config SOURCE back, and that source now quotes the refusal verbatim, so
    // the string is present for a reason that has nothing to do with vitest
    // having reached project resolution.)
    expect(output).toContain('OBJECTUI_DIST_PINS is not "1"');
    expect(output).toContain('pnpm test:dist');
    expect(status).not.toBe(0);
  }, 180_000);
});

describe('the guard message stays honest about vitest', () => {
  /**
   * The THROWN text only — the lines between `throw new Error(` and the
   * `.join`. Deliberately not the whole file: the surrounding comment quotes
   * the retracted claim on purpose, as the record of what was corrected, and a
   * whole-file scan would forbid keeping that history.
   */
  function guardMessage(): string {
    const text = fs.readFileSync(configPath, 'utf8');
    const start = text.indexOf('vitest --project dist was requested');
    const end = text.indexOf("].join('\\n')", start);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    return text.slice(start, end);
  }

  it('does not claim the un-opted run exits green or collects zero files', () => {
    const message = guardMessage();

    expect(message).not.toMatch(/exit GREEN/i);
    expect(message).not.toMatch(/collect ZERO files/i);
  });

  it('control — the slice really is the guard message, not an empty string', () => {
    // Non-vacuity: without this, a moved guard or a changed delimiter would
    // hand the negative assertions above an empty slice to pass against.
    const message = guardMessage();

    expect(message).toContain('OBJECTUI_DIST_PINS');
    expect(message).toContain('pnpm test:dist');
    expect(message.length).toBeGreaterThan(200);
  });
});
