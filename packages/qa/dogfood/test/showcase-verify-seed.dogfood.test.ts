// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
// test-budget: 20 — spawns the real producer once per single-cause fixture: one `os verify --json` spawn of the showcase, in its beforeAll; local reading 8.84 s (vitest tests time) on a shared 4-vCPU container, no CI reading yet, x 1.25, rounded up
//
// PIN (#32141) — `os verify` of the showcase seeds what `os dev` seeds: every
// record the showcase's seed declares lands at boot, and the run passes.
//
// The showcase pins its home currency in its own `.env`
// (`OS_LOCALIZATION_CURRENCY=USD`): its invoices convert every amount into the
// home currency at write, against seeded USD-relative rates. `os dev` loads
// that file; `os verify` did not, so its boot had no home currency, refused all
// 12 seeded invoices (`ERR_HOME_CURRENCY_UNSET`) and the 7 invoice lines under
// them — 26 records dropped — and still printed `✓ verify passed`.
//
// Through the real binary, as the `Dogfood Verify CLI` job runs it, with the
// home currency taken out of the child's environment: this suite's in-process
// boots set it by hand (`showcase-boot.ts`), and a value inherited from them
// would pass this pin without the `.env` load it exists to hold.
//
// The count is the showcase's own declaration, summed from its `data`, so a
// seed added to the showcase moves both sides at once.
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import showcaseStack from '@objectstack/example-showcase';

const requireFrom = createRequire(import.meta.url);
/** The showcase's `objectstack.config.ts`: the package's own entry. */
const SHOWCASE_CONFIG = requireFrom.resolve('@objectstack/example-showcase');
const CLI_BIN = join(dirname(requireFrom.resolve('@objectstack/cli/package.json')), 'bin', 'run.js');

/** Every record the showcase's seed declares. */
const DECLARED = ((showcaseStack as { data?: Array<{ records?: unknown[] }> }).data ?? []).reduce(
  (n, dataset) => n + (dataset.records?.length ?? 0),
  0,
);

describe('os verify of the showcase lands every seed record it declares (#32141)', () => {
  let run: { status: number | null; stdout: string; stderr: string };

  beforeAll(() => {
    const r = spawnSync(process.execPath, [CLI_BIN, 'verify', '--app', SHOWCASE_CONFIG, '--json'], {
      cwd: dirname(SHOWCASE_CONFIG),
      encoding: 'utf8',
      timeout: 300_000,
      maxBuffer: 64 * 1024 * 1024,
      env: { ...process.env, NO_COLOR: '1', OS_CLOUD_URL: 'off', OS_LOCALIZATION_CURRENCY: undefined },
    });
    run = { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
  }, 360_000);

  it('premise: the showcase pins its home currency in its .env, and declares a seed', () => {
    const envFile = join(dirname(SHOWCASE_CONFIG), '.env');
    expect(existsSync(envFile)).toBe(true);
    expect(readFileSync(envFile, 'utf8')).toMatch(/^OS_LOCALIZATION_CURRENCY=\S+/m);
    expect(DECLARED).toBeGreaterThan(0);
  });

  it('the boot lands every declared record, drops none, and the run passes', () => {
    expect(run.status, `os verify of the showcase failed:\n${run.stdout.slice(-4000)}\n${run.stderr.slice(-4000)}`).toBe(0);
    const doc = JSON.parse(run.stdout);
    expect(doc.seed.status).toBe('loaded');
    expect(doc.seed.totals.rejected).toBe(0);
    expect(doc.seed.totals.droppedRefs).toBe(0);
    const { inserted, updated, skipped } = doc.seed.totals;
    expect(inserted + updated + skipped).toBe(DECLARED);
    expect(doc.hardFailures).toBe(0);
  });
});
