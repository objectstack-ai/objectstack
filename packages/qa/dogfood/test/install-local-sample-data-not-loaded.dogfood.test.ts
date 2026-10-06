// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// GOLDEN REGRESSION — after a restart whose `kernel:ready` rehydrate refused a
// protocol-incompatible package, `reseed-sample-data` and `purge-sample-data`
// refuse it with the install route's `422 OS_PROTOCOL_INCOMPATIBLE` before any
// side effect, and a compatible re-install gets the operator out (#21834).
//
// ## What was measured before the fix
//
// On a real boot whose install-local ledger held `com.example.crm` declaring the
// previous protocol major, the rehydrate refused it (0 of its 5 objects
// registered). Then, as the admin:
//
//   POST …/com.example.crm/reseed-sample-data
//     -> 400 RESEED_SKIPPED "Reseed did not run: seed-error: Object 'crm_account' not found",
//        AFTER loading the package's translations into the i18n service and
//        merging its 5 seed datasets into the kernel's shared `seed-datasets` list
//   POST …/com.example.crm/purge-sample-data
//     -> 200 { deleted: 0, skipped: 0, errors: 28, withSampleData: false },
//        rewriting the ledger's `withSampleData` from true to false
//
// ## What this file pins, on two real boots over one database file and one ledger
//
//   1. PRECONDITIONS: boot 1 installed the CRM package with its 28 seed rows,
//      and a reseed there (the package loadable) loaded its translations, so the
//      i18n probe is shown to see the door's loads; boot 2's rehydrate refused
//      the package once its ledger entry declared the previous major.
//   2. On boot 2 both doors answer 422 `OS_PROTOCOL_INCOMPATIBLE`, byte-identical
//      to the install route's answer for the same manifest, and leave the i18n
//      service, the `seed-datasets` list and the ledger exactly as they were.
//   3. A compatible version installed over the refused entry answers 200; on it
//      the reseed answers 200 (the 28 rows intact) and loads translations
//      through the same probe, and the purge answers 200 deleting the 28 rows.
//      DELETE then removes it. (DELETE on a still-refused entry at real boot is
//      `install-local-listing-not-loaded.dogfood.test.ts`.)
//
// Boots its own showcase stack, twice, so it stays out of `SHARED_SHOWCASE`.

import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import showcaseStack from '@objectstack/example-showcase';
import crmStack from '@objectstack/example-crm';
import { bootStack, type VerifyStack } from '@objectstack/verify';
import { LocalManifestSource, MarketplaceInstallLocalPlugin } from '@objectstack/cloud-connection';
import { PROTOCOL_MAJOR, type ExecutionContext } from '@objectstack/spec/kernel';
import type { IObjectQLEngine } from '@objectstack/spec/contracts';
import { buildShapedArtifact } from './build-shaped-artifact.js';

const SYS = { isSystem: true } as ExecutionContext;
const CRM = 'com.example.crm';
const BASE = '/marketplace/install-local';
const OLD_RANGE = `^${PROTOCOL_MAJOR - 1}`;
/** The CRM example's seeded objects and their seed-row counts (3 + 3 + 12 + 5 + 5). */
const SEEDED: Record<string, number> = {
  crm_account: 3, crm_contact: 3, crm_opportunity: 12, crm_lead: 5, crm_activity: 5,
};
const SEED_TOTAL = Object.values(SEEDED).reduce((a, b) => a + b, 0);
/** One seed dataset per seeded object. */
const CRM_DATASETS = Object.keys(SEEDED).length;

type Answer = { status: number; body: any }; // eslint-disable-line @typescript-eslint/no-explicit-any

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const rowsOf = (r: any): any[] => (Array.isArray(r) ? r : Array.isArray(r?.records) ? r.records : []);

/** The install body `os package install <artifact>.json` sends. */
function crmInstallBody(): { manifest: Record<string, unknown> } {
  const { artifact } = buildShapedArtifact(crmStack as unknown as Record<string, unknown>);
  const manifest = artifact.manifest as { id?: string; version?: string };
  return { manifest: { ...artifact, id: manifest.id, version: manifest.version } };
}

async function json(res: Response): Promise<Answer> {
  return { status: res.status, body: await res.json().catch(() => null) };
}

async function countSeeded(ql: IObjectQLEngine): Promise<number> {
  let n = 0;
  for (const object of Object.keys(SEEDED)) n += rowsOf(await ql.find(object, { context: SYS })).length;
  return n;
}

/** Every line the process writes while `run` is in flight — the kernel logger writes to the streams. */
async function captureOutput<T>(run: () => Promise<T>): Promise<{ value: T; lines: string[] }> {
  const lines: string[] = [];
  const stdout = process.stdout.write.bind(process.stdout);
  const stderr = process.stderr.write.bind(process.stderr);
  (process.stdout as any).write = (chunk: unknown, ...rest: any[]) => { lines.push(String(chunk)); return stdout(chunk as any, ...rest); }; // eslint-disable-line @typescript-eslint/no-explicit-any
  (process.stderr as any).write = (chunk: unknown, ...rest: any[]) => { lines.push(String(chunk)); return stderr(chunk as any, ...rest); }; // eslint-disable-line @typescript-eslint/no-explicit-any
  try {
    return { value: await run(), lines };
  } finally {
    (process.stdout as any).write = stdout; // eslint-disable-line @typescript-eslint/no-explicit-any
    (process.stderr as any).write = stderr; // eslint-disable-line @typescript-eslint/no-explicit-any
  }
}

/**
 * What the ruling says the doors leave unchanged, read off the booted kernel:
 * the `i18n` service (which object it is, and every `loadTranslations` call it
 * receives from here on), the shared `seed-datasets` list, and the ledger's
 * bytes on disk.
 */
function probeKernel(stack: VerifyStack, storageDir: string) {
  const service = (name: string): unknown => {
    try { return stack.kernel.getService(name); } catch { return undefined; }
  };
  const i18n = service('i18n') as { loadTranslations?: (...args: unknown[]) => unknown } | undefined;
  let loads = 0;
  if (i18n && typeof i18n.loadTranslations === 'function') {
    const original = i18n.loadTranslations;
    i18n.loadTranslations = (...args: unknown[]) => { loads++; return original.apply(i18n, args); };
  }
  return {
    state: () => {
      const datasets = service('seed-datasets');
      const ledger: Record<string, string> = {};
      for (const f of readdirSync(storageDir).sort()) ledger[f] = readFileSync(join(storageDir, f), 'utf8');
      return {
        i18nService: service('i18n') === i18n ? 'same' : 'replaced',
        translationLoads: loads,
        seedDatasets: Array.isArray(datasets) ? datasets.length : 'absent',
        ledger,
      };
    },
  };
}

describe('dogfood: reseed and purge refuse a package the restart refused to load, before any side effect (#21834)', () => {
  let stack: VerifyStack | undefined;
  let storageDir: string;
  let dbDir: string;
  let crmInstall: Answer;
  let boot1Reseed: Answer;
  let boot1Loads: number;
  let crmVersion: string;
  let bootLines: string[];
  let before: ReturnType<ReturnType<typeof probeKernel>['state']>;
  let reseedRefused: Answer;
  let purgeRefused: Answer;
  let after: ReturnType<ReturnType<typeof probeKernel>['state']>;
  let recordedAfterRefusals: unknown;
  let installRefused: Answer;
  let reinstall: Answer;
  let rowsAfterReinstall: number;
  let beforeReseed: ReturnType<ReturnType<typeof probeKernel>['state']>;
  let reseedLoaded: Answer;
  let afterReseed: ReturnType<ReturnType<typeof probeKernel>['state']>;
  let purgeLoaded: Answer;
  let rowsAfterPurge: number;
  let recordedAfterPurge: unknown;
  let uninstall: Answer;

  const boot = (databaseFile: string) => bootStack(showcaseStack, {
    databaseFile,
    extraPlugins: [new MarketplaceInstallLocalPlugin({ controlPlaneUrl: 'off', storageDir })],
  });

  beforeAll(async () => {
    storageDir = mkdtempSync(join(tmpdir(), 'dogfood-install-local-sample-not-loaded-ledger-'));
    dbDir = mkdtempSync(join(tmpdir(), 'dogfood-install-local-sample-not-loaded-db-'));
    const databaseFile = join(dbDir, 'verify.db');

    // ── boot 1: install the CRM package; a reseed while it is loadable ─────
    stack = await boot(databaseFile);
    let token = await stack.signIn();
    crmInstall = await json(await stack.apiAs(token, 'POST', BASE, crmInstallBody()));
    const boot1 = probeKernel(stack, storageDir);
    boot1Reseed = await json(await stack.apiAs(token, 'POST', `${BASE}/${CRM}/reseed-sample-data`, {}));
    boot1Loads = boot1.state().translationLoads;
    await stack.stop();
    stack = undefined;

    // ── between the boots: the CRM install now declares the previous major ─
    const ledger = new LocalManifestSource(storageDir);
    const crm = ledger.read(CRM).entry!;
    crmVersion = crm.version;
    ledger.write({ ...crm, manifest: { ...crm.manifest, engines: { ...(crm.manifest?.engines ?? {}), protocol: OLD_RANGE } } });

    // ── boot 2: the same database file and ledger ──────────────────────────
    const booted = await captureOutput(() => boot(databaseFile));
    stack = booted.value;
    bootLines = booted.lines;
    token = await stack.signIn();
    const probe = probeKernel(stack, storageDir);

    before = probe.state();
    reseedRefused = await json(await stack.apiAs(token, 'POST', `${BASE}/${CRM}/reseed-sample-data`, {}));
    purgeRefused = await json(await stack.apiAs(token, 'POST', `${BASE}/${CRM}/purge-sample-data`, {}));
    after = probe.state();
    recordedAfterRefusals = new LocalManifestSource(storageDir).read(CRM).entry?.withSampleData;
    // The install route's answer for the very manifest the ledger holds.
    installRefused = await json(await stack.apiAs(token, 'POST', BASE, { manifest: new LocalManifestSource(storageDir).read(CRM).entry!.manifest }));

    // ── the way out: a compatible version installed over the refused entry ─
    reinstall = await json(await stack.apiAs(token, 'POST', BASE, crmInstallBody()));
    const ql = stack.kernel.getService<IObjectQLEngine>('objectql');
    rowsAfterReinstall = await countSeeded(ql);
    beforeReseed = probe.state();
    reseedLoaded = await json(await stack.apiAs(token, 'POST', `${BASE}/${CRM}/reseed-sample-data`, {}));
    afterReseed = probe.state();
    purgeLoaded = await json(await stack.apiAs(token, 'POST', `${BASE}/${CRM}/purge-sample-data`, {}));
    rowsAfterPurge = await countSeeded(ql);
    recordedAfterPurge = new LocalManifestSource(storageDir).read(CRM).entry?.withSampleData;
    uninstall = await json(await stack.apiAs(token, 'DELETE', `${BASE}/${CRM}`));
  }, 300_000);

  afterAll(async () => {
    await stack?.stop?.();
    if (storageDir) rmSync(storageDir, { recursive: true, force: true });
    if (dbDir) rmSync(dbDir, { recursive: true, force: true });
  });

  it('PRECONDITION: boot 1 installed the CRM package with its seed rows, and its reseed there loaded translations through the probe', () => {
    expect(crmInstall.status, JSON.stringify(crmInstall.body)).toBe(200);
    expect(crmInstall.body?.data?.seeded).toMatchObject({ mode: 'inline', inserted: SEED_TOTAL });
    expect(boot1Reseed.status, JSON.stringify(boot1Reseed.body)).toBe(200);
    expect(boot1Reseed.body?.data).toMatchObject({ inserted: 0, skipped: SEED_TOTAL, errors: 0 });
    expect(boot1Loads).toBeGreaterThan(0);
  });

  it('PRECONDITION: boot 2\'s rehydrate refused the CRM package', () => {
    const refused = bootLines.filter((l) => l.includes(`OS_PROTOCOL_INCOMPATIBLE: ${CRM}@${crmVersion} is NOT loaded`));
    expect(refused, 'the rehydrate\'s refusal line').toHaveLength(1);
  });

  it('reseed answers 422 OS_PROTOCOL_INCOMPATIBLE, the install route\'s answer for the same manifest', () => {
    expect(reseedRefused.status, JSON.stringify(reseedRefused.body)).toBe(422);
    expect(reseedRefused.body?.success).toBe(false);
    expect(reseedRefused.body?.error?.code).toBe('OS_PROTOCOL_INCOMPATIBLE');
    expect(reseedRefused.body?.error?.details).toMatchObject({ requiredRange: OLD_RANGE, rangeSource: 'engines.protocol' });
    expect(installRefused.status).toBe(422);
    expect(JSON.stringify(reseedRefused.body)).toBe(JSON.stringify(installRefused.body));
  });

  it('purge answers the same 422', () => {
    expect(purgeRefused.status, JSON.stringify(purgeRefused.body)).toBe(422);
    expect(JSON.stringify(purgeRefused.body)).toBe(JSON.stringify(installRefused.body));
  });

  it('the i18n service, the seed-datasets list and the ledger are exactly as they were before both doors', () => {
    expect(after).toEqual(before);
    expect(after.i18nService).toBe('same');
    expect(after.translationLoads).toBe(0);
    expect(recordedAfterRefusals).toBe(true);
  });

  it('a compatible version installed over the refused entry: reseed and purge act on it, and the probes see the reseed\'s side effects', () => {
    expect(reinstall.status, JSON.stringify(reinstall.body)).toBe(200);
    expect(rowsAfterReinstall).toBe(SEED_TOTAL);
    expect(reseedLoaded.status, JSON.stringify(reseedLoaded.body)).toBe(200);
    expect(reseedLoaded.body?.data).toMatchObject({ inserted: 0, skipped: SEED_TOTAL, errors: 0, withSampleData: true });
    // Control for the "unchanged" above: the same probes, on the same boot, move.
    expect(afterReseed.translationLoads - beforeReseed.translationLoads).toBe(boot1Loads);
    expect([typeof beforeReseed.seedDatasets, typeof afterReseed.seedDatasets]).toEqual(['number', 'number']);
    expect((afterReseed.seedDatasets as number) - (beforeReseed.seedDatasets as number)).toBe(CRM_DATASETS);
    expect(purgeLoaded.status, JSON.stringify(purgeLoaded.body)).toBe(200);
    expect(purgeLoaded.body?.data).toMatchObject({ deleted: SEED_TOTAL, skipped: 0, errors: 0, withSampleData: false });
    expect(rowsAfterPurge).toBe(0);
    expect(recordedAfterPurge).toBe(false);
  });

  it('DELETE then removes it', () => {
    expect(uninstall.status, JSON.stringify(uninstall.body)).toBe(200);
    expect(uninstall.body?.data?.manifestId).toBe(CRM);
    expect(new LocalManifestSource(storageDir).has(CRM)).toBe(false);
  });
});
