// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
// test-budget: 30 — spawns the real producer once per single-cause fixture: two `os verify` spawns in one beforeAll, one per fixture (a seed that needs the project's `.env`, a seed that drops a record); local reading 17.13 s (vitest tests time) on a shared 4-vCPU container, no CI reading yet, x 1.25, rounded up

/**
 * PIN — `os verify` boots with the project's `.env*` files loaded and fails a
 * run whose boot drops a seed record (#32141).
 *
 * ## The defect
 *
 * `os dev`, `os serve`, `os start` and `os migrate` load the project's `.env*`
 * files before anything reads the environment; `os verify` did not. The
 * showcase pins its home currency in `.env` (`OS_LOCALIZATION_CURRENCY=USD`),
 * so verify's boot had none: every seeded invoice was refused
 * (`ERR_HOME_CURRENCY_UNSET`), 26 seed records dropped in all — and the run
 * still printed `✓ verify passed` and exited 0, because nothing read the seed.
 *
 * ## What each fixture pins
 *
 *  - **env** — an app whose seed records carry an amount converted into the
 *    home currency, with the home currency pinned in the app's own `.env`, the
 *    showcase's shape. The run reads the `.env`, lands both records, reports
 *    the seed `loaded` with nothing dropped under `--json`'s `seed`, and passes.
 *    Without the load the seed drops both records and the run fails.
 *  - **drop** — an app whose seed declares one record the engine refuses (its
 *    required field is missing). The run fails, exit 1, naming the dropped
 *    count on its seed line and counting it in the verdict.
 *
 * The showcase itself is pinned in the dogfood suite, the package that holds
 * both the CLI and the showcase
 * (`packages/qa/dogfood/test/showcase-verify-seed.dogfood.test.ts`).
 *
 * Spawned rather than run in-process: the exit status is the contract a CI
 * gate reads, and the `.env` load is the process's own.
 */

import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CLI, childEnv } from './helpers/serve-process.js';
import { defineStackSource, linkSpec } from './helpers/define-stack-fixture.js';

const manifest = (id: string, namespace: string, name: string) => ({
  id,
  namespace,
  version: '1.0.0',
  name,
  type: 'app',
  engines: { protocol: '^18' },
});

/** The showcase invoice's shape, reduced: an amount the engine converts into the home currency at write. */
const ENV_STACK = {
  manifest: manifest('com.example.verify-seed-env', 'vse', 'Verify Seed Env'),
  objects: [
    {
      name: 'vse_charge',
      label: 'Charge',
      pluralLabel: 'Charges',
      sharingModel: 'private',
      fields: {
        name: { type: 'text', label: 'Name', required: true },
        currency_code: { type: 'text', label: 'Currency', maxLength: 3, valueDomain: 'iso_4217_currency' },
        charge_date: { type: 'date', label: 'Charge Date', required: true },
        amount: {
          type: 'currency',
          label: 'Amount',
          currencyConfig: {
            currencyMode: 'record',
            currencyField: 'currency_code',
            homeAmount: { field: 'amount_home', rateDate: 'charge_date', rateField: 'amount_rate' },
          },
        },
        amount_home: { type: 'currency', label: 'Amount (Home)', readonly: true },
        amount_rate: { type: 'number', label: 'Rate', readonly: true },
      },
    },
  ],
  data: [
    {
      object: 'vse_charge',
      externalId: 'name',
      records: [
        // In the home currency, so the conversion needs no exchange rate: the
        // one thing either record needs from the boot is the home currency.
        { name: 'C-1', currency_code: 'USD', charge_date: '2026-01-05', amount: 10 },
        { name: 'C-2', currency_code: 'USD', charge_date: '2026-01-06', amount: 25.5 },
      ],
    },
  ],
};

/** What `.env` pins for {@link ENV_STACK}: the showcase's own line. */
const ENV_FILE = 'OS_LOCALIZATION_CURRENCY=USD\n';

/** One record the engine refuses at seed time: its required `title` is missing. */
const DROP_STACK = {
  manifest: manifest('com.example.verify-seed-drop', 'vsd', 'Verify Seed Drop'),
  objects: [
    {
      name: 'vsd_note',
      label: 'Note',
      pluralLabel: 'Notes',
      sharingModel: 'private',
      fields: {
        code: { type: 'text', label: 'Code', required: true },
        title: { type: 'text', label: 'Title', required: true },
      },
    },
  ],
  data: [
    {
      object: 'vsd_note',
      externalId: 'code',
      records: [
        { code: 'N-1', title: 'Lands' },
        { code: 'N-2', title: 'Lands too' },
        { code: 'N-3' },
      ],
    },
  ],
};

type Run = { status: number | null; stdout: string; stderr: string };

function verify(appDir: string, extra: string[]): Run {
  // `bin/run-dev.js` runs this checkout's `src/` (see verify-json-stdout.test.ts).
  // The home currency is taken out of the child's environment so the only
  // place it can come from is the fixture's `.env`.
  const r = spawnSync(process.execPath, [CLI, 'verify', '--app', join(appDir, 'objectstack.config.mjs'), ...extra], {
    cwd: appDir,
    encoding: 'utf8',
    env: childEnv({ NO_COLOR: '1', OS_LOCALIZATION_CURRENCY: undefined }),
    maxBuffer: 64 * 1024 * 1024,
  });
  return { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

describe('os verify reads the project .env and fails on a dropped seed record (#32141)', () => {
  const dirs: string[] = [];
  let envRun: Run;
  let dropRun: Run;

  beforeAll(() => {
    const envApp = mkdtempSync(join(tmpdir(), 'os-verify-seed-env-'));
    const dropApp = mkdtempSync(join(tmpdir(), 'os-verify-seed-drop-'));
    dirs.push(envApp, dropApp);
    writeFileSync(join(envApp, 'objectstack.config.mjs'), defineStackSource(ENV_STACK));
    writeFileSync(join(envApp, '.env'), ENV_FILE);
    writeFileSync(join(dropApp, 'objectstack.config.mjs'), defineStackSource(DROP_STACK));
    for (const dir of dirs) linkSpec(dir);

    envRun = verify(envApp, ['--json']);
    dropRun = verify(dropApp, []);
  }, 360_000);

  afterAll(() => {
    for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
  });

  it('env: the seed that needs the .env home currency lands whole, and the run passes', () => {
    expect(envRun.status, `os verify --json failed:\n${envRun.stdout}\n${envRun.stderr}`).toBe(0);
    const doc = JSON.parse(envRun.stdout);
    expect(doc.seed).toMatchObject({
      status: 'loaded',
      totals: { inserted: 2, rejected: 0, droppedRefs: 0 },
      hardFailures: 0,
    });
    expect(doc.hardFailures).toBe(0);
  });

  it('drop: a dropped seed record fails the run, and the seed line names the count', () => {
    expect(dropRun.status, `os verify passed over a dropped seed record:\n${dropRun.stdout}`).toBe(1);
    expect(dropRun.stdout).toContain('✗ seed: 1 record DROPPED; 2 records landed');
    expect(dropRun.stdout).toContain('✗ verify FAILED');
    expect(dropRun.stdout).not.toContain('verify passed');
  });
});
