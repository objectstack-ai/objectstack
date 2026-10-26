import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { childVitestEnv } from './helpers/child-vitest-env';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

/**
 * objectui#8366 — the suite's ambient timezone is UTC, pinned.
 *
 * ## What this guards
 *
 * `vitest.config.mts` sets `process.env.TZ = 'UTC'` in its module scope. A
 * family of date pins asserts LITERAL local-date faces (`Jul 4, 2024`,
 * `7/4/2024 7:00 am`) built from fixed UTC instants through LOCAL date parts,
 * so without that line the face they render is a property of the
 * contributor's laptop. Measured on `76573a184`, over the six files that carry
 * the family, BEFORE the pin:
 *
 *   TZ=UTC              184 passed          TZ=Europe/Paris      7 failed
 *   TZ=Asia/Shanghai      7 failed          TZ=America/New_York 31 failed
 *   TZ=Etc/GMT+8         33 failed
 *
 * Green at exactly one offset — not merely "west of somewhere". A `07:00 AM`
 * face pinned off an `07:00Z` instant is true at UTC+00:00 and nowhere else.
 *
 * ## Why a spawn and not just an in-process assertion
 *
 * CI runs in UTC. So `getTimezoneOffset() === 0`, asserted in this process, is
 * green on CI whether or not the config still pins anything — it would catch a
 * deleted pin only for the contributor it was written to protect, and stay
 * silent in the one place that gates merges. That is the exact shape of the
 * original defect, one level up.
 *
 * So the fact is measured where it can fail: a real vitest is spawned with
 * `TZ=Etc/GMT+8` in its environment and asked to run the ambient-zone case
 * below. It can only pass if the config overrode the inherited zone. Delete the
 * line in `vitest.config.mts` and this case reds on CI.
 *
 * `Etc/GMT+8` is UTC-08:00 — POSIX inverts the sign — chosen because it is the
 * zone the reporting contributor measured in.
 *
 * ## The live control
 *
 * A spawn-based pin has one silent failure: if `TZ` never reached the child at
 * all, the child would read UTC for a reason that has nothing to do with the
 * config, and the assertion would pass forever. `the child environment really
 * carries TZ` measures that hand-off against a plain `node -e`, so a green
 * spawn case is attributable.
 *
 * ## Recursion
 *
 * The child runs THIS file, filtered by `--testNamePattern` to the ambient-zone
 * case, so the spawn cases are skipped there. `OBJECTUI_TZ_PIN_CHILD` is a
 * second, independent belt: even an unfiltered child cannot spawn a grandchild.
 */

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const configPath = path.join(repoRoot, 'vitest.config.mts');
const selfPath = path.relative(repoRoot, fileURLToPath(import.meta.url));

/** UTC-08:00. POSIX `Etc/GMT+N` zones invert the sign; this is deliberate. */
const WEST = 'Etc/GMT+8';
const WEST_OFFSET_MINUTES = 480;

/** The name the spawned child is filtered down to. Kept as one constant so the
 *  filter and the `it()` title cannot drift apart. */
const AMBIENT_CASE = 'the suite runs in UTC, whatever zone the contributor is in';

const IS_CHILD = process.env.OBJECTUI_TZ_PIN_CHILD === '1';

/** The vitest CLI entry, resolved rather than assumed at a `node_modules` path. */
const vitestCli = (() => {
  const require = createRequire(path.join(repoRoot, 'noop.js'));
  const pkgPath = require.resolve('vitest/package.json');
  const bin = (JSON.parse(fs.readFileSync(pkgPath, 'utf8')).bin as { vitest: string }).vitest;
  return path.resolve(path.dirname(pkgPath), bin);
})();

describe('objectui#8366 — the runner pins the timezone', () => {
  it(AMBIENT_CASE, () => {
    // Read two independent surfaces: `Date`'s own offset, and the zone ICU
    // resolves for a bare formatter — which is what every `toLocaleDateString`
    // in the date-face family actually consults.
    expect(new Date('2024-07-04T07:00:00.000Z').getTimezoneOffset()).toBe(0);
    expect(new Intl.DateTimeFormat().resolvedOptions().timeZone).toBe('UTC');
  });

  it.skipIf(IS_CHILD)('control — the child environment really carries TZ', () => {
    // Non-vacuity for the case below. Without this, a `TZ` that never reached
    // the child would make the spawned run read UTC for a reason that has
    // nothing to do with `vitest.config.mts`, and the pin would be inert.
    const probe = spawnSync(
      process.execPath,
      ['-e', 'process.stdout.write(String(new Date("2024-07-04T07:00:00.000Z").getTimezoneOffset()))'],
      { cwd: repoRoot, encoding: 'utf8', env: { ...process.env, TZ: WEST }, timeout: 60_000 },
    );

    expect(probe.status).toBe(0);
    expect(probe.stdout.trim()).toBe(String(WEST_OFFSET_MINUTES));
  });

  it.skipIf(IS_CHILD)(
    'a real vitest spawned under a non-UTC TZ still runs in UTC',
    () => {
      // A fresh CLI, not a nested worker of this run — and one configured the
      // way CI configures it, so `1 passed` below is read off the same reporter
      // and the same byte stream CI produces (objectui#8616).
      const env = childVitestEnv({ TZ: WEST, OBJECTUI_TZ_PIN_CHILD: '1' });

      const child = spawnSync(
        process.execPath,
        [vitestCli, 'run', selfPath, '--testNamePattern', AMBIENT_CASE],
        { cwd: repoRoot, encoding: 'utf8', env, timeout: 300_000 },
      );
      const output = `${child.stdout ?? ''}${child.stderr ?? ''}`;

      expect(output).toContain('1 passed');
      expect(child.status).toBe(0);
    },
    360_000,
  );

  it.skipIf(IS_CHILD)('the pin is where the spawn says it is', () => {
    // The cheap static half. It cannot replace the spawn — a line can be
    // present and no longer take effect, which is the direction vitest could
    // move under us — but it names the file and the spelling for whoever
    // arrives here from a red spawn.
    const source = fs.readFileSync(configPath, 'utf8');

    expect(source).toContain("process.env.TZ = 'UTC'");
    // Not `??=` / `||=`: a contributor's zone usually comes from
    // `/etc/localtime`, not from `TZ`, so a conditional assignment would leave
    // the reported population unfixed. See the comment at the assignment.
    expect(source).not.toMatch(/process\.env\.TZ\s*(\?\?|\|\|)=/);
  });
});
