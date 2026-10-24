import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { repoRoot } from './helpers/turbo-inputs';

/**
 * The completeness statement of the `turbo.json` inputs-guard family
 * (objectui#3514 → objectui#4178 → objectui#4184 / objectui#4185).
 *
 * Four instances of one defect were found one at a time, each by someone
 * noticing the previous one and asking "where else?". Three of the four were
 * found that way; the fourth was found by a sweep the third asked for. That is
 * a discovery process with a hole in it — it depends on the next reader
 * repeating the question — and the answer to "where else" is mechanical:
 *
 *   a task turbo CACHES has a verdict that can be replayed, so it needs a guard
 *   deriving what it reads; a task turbo never caches has no verdict to replay,
 *   so it needs nothing.
 *
 * Turbo caches by default — a task with no `cache` key is cacheable — so the
 * exemption has to be spelled out in `turbo.json` rather than inferred. This
 * test enumerates the tasks and asserts the partition holds, which means the
 * next cacheable task added to this repo cannot arrive without a guard: it goes
 * red here, naming itself.
 *
 * As of this test, the partition is:
 *
 *     build       cached   guarded by turbo-build-inputs.test.ts       (#4185)
 *     test        cached   guarded by turbo-test-inputs.test.ts        (#4178)
 *     lint        cached   guarded by turbo-lint-inputs.test.ts        (#4184)
 *     type-check  cached   guarded by turbo-type-check-inputs.test.ts  (#3514)
 *     test:dist   cache: false               nothing to replay
 *     test:watch  cache: false, persistent   nothing to replay
 *     clean       cache: false               nothing to replay
 *     dev         cache: false, persistent   nothing to replay
 *     //#lint:root        cache: false       nothing to replay
 *     //#type-check:e2e   cache: false       nothing to replay
 *
 * `//#lint:root` (objectui#4456) is the root task that lints everything OUTSIDE
 * the workspace packages — `e2e/`, `scripts/`, `eslint-rules/`, the root config
 * files — which no package's `lint` script reaches. It is deliberately on the
 * uncached side of this partition rather than guarded: the files it reads are
 * "the repo minus the workspaces", so any inputs list enumerating them would go
 * stale the moment a new root-level directory is added, and a stale inputs list
 * on a CACHED task replays a green verdict over a directory nothing linted —
 * which is objectui#4456 itself, one level up. It runs in about four seconds.
 * It has declared `inputs` since objectui#12276, and that does not move it
 * across the partition: uncached, its inputs decide no verdict of its own,
 * only the hash every package's `lint` inherits through `dependsOn` — with
 * none, that hash covered every file in the repository and no package's lint
 * could replay. They are derived from the `lint:root` script's ignore
 * patterns rather than listed by directory, and
 * `turbo-lint-inputs.test.ts` pins them against ESLint's own walk.
 *
 * `//#type-check:e2e` (objectui#4471) is the same move for the TYPE gate: `e2e/`
 * is not a workspace package, so `turbo run type-check` could not reach it and
 * the 30 Playwright specs were compiled by nothing. It runs
 * `tsc -p tsconfig.e2e.json`, and `type-check` `dependsOn` it, so `pnpm
 * type-check` now covers `e2e/`. Uncached for two reasons, one structural and
 * one substantive. Structural: `guardFor` below derives a guard NAME from the
 * task name, and `turbo-//#type-check:e2e-inputs.test.ts` is not a legal path —
 * a cacheable root task cannot be expressed in this family at all. Substantive:
 * a tsc program's real read set is its IMPORT CLOSURE (`@playwright/test`'s
 * declarations, `@types/node`), while the four derived guards deliberately
 * narrow to config root files — a narrowing that is sound for a composite
 * package project, which must list its own files, and unsound here. A cached
 * verdict over a set nobody derives is objectui#3514 with a type gate attached.
 * Measured cost of not caching it: 2.3s (three consecutive cold runs, 2.29 /
 * 2.41 / 2.37). `scripts/__tests__/e2e-type-check.test.ts`
 * restates the `cache: false` half from the other side, so removing it goes red
 * in two places rather than quietly demanding a guard that cannot be written.
 */

interface TurboTask {
  readonly cache?: boolean;
  readonly inputs?: string[];
}

const turbo = JSON.parse(fs.readFileSync(path.join(repoRoot, 'turbo.json'), 'utf8')) as {
  tasks: Record<string, TurboTask>;
};

/** Turbo caches unless a task opts out, so a missing `cache` key means cached. */
const CACHEABLE = Object.entries(turbo.tasks).filter(([, task]) => task.cache !== false);
const UNCACHED = Object.entries(turbo.tasks).filter(([, task]) => task.cache === false);

/** The guard each cacheable task's out-of-package reads are derived by. */
const guardFor = (task: string): string => `turbo-${task}-inputs.test.ts`;

describe('every cacheable turbo task has a derived inputs guard', () => {
  it('finds both a cached and an uncached task, so neither branch is vacuous', () => {
    expect(CACHEABLE.map(([name]) => name)).not.toHaveLength(0);
    expect(UNCACHED.map(([name]) => name)).not.toHaveLength(0);
  });

  it.each(CACHEABLE.map(([name]) => [name] as const))('`%s` is guarded', (task) => {
    const guard = path.join(repoRoot, 'scripts/__tests__', guardFor(task));
    expect(
      fs.existsSync(guard),
      `turbo.json caches the \`${task}\` task, so turbo can REPLAY its verdict instead of ` +
        `re-running it — and every file that task reads from outside the package directory is ` +
        `invisible to the cache key unless a "$TURBO_ROOT$" input covers it. There is no ` +
        `scripts/__tests__/${guardFor(task)} deriving what \`${task}\` reads. Write one (the ` +
        `four existing guards share ./helpers/turbo-inputs.ts and ./helpers/config-program.ts), ` +
        `or set "cache": false on the task if it should never be cached.`,
    ).toBe(true);
  });

  it.each(CACHEABLE.map(([name, task]) => [name, task] as const))(
    '`%s` declares explicit inputs',
    (name, task) => {
      expect(
        task.inputs ?? [],
        `turbo.json \`${name}\` declares no \`inputs\`, so it runs on turbo's default — which ` +
          `covers only files inside the package directory. That is the objectui#3514 defect ` +
          `itself: the task's out-of-package program files are unhashed and its verdict gets ` +
          `replayed. Declare an inputs list starting with "$TURBO_DEFAULT$".`,
      ).toContain('$TURBO_DEFAULT$');
    },
  );

  /**
   * The other half of the partition. An uncached task is exempt because there
   * is no stored verdict to replay — not because nobody got round to it. If a
   * task ever loses its `cache: false`, the assertion above starts requiring a
   * guard for it, which is the intended coupling.
   */
  it.each(UNCACHED.map(([name, task]) => [name, task] as const))(
    '`%s` is exempt because turbo never caches it',
    (_name, task) => {
      expect(task.cache).toBe(false);
    },
  );
});
