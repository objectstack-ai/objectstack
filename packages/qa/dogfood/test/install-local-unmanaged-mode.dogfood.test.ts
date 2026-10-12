// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// GOLDEN REGRESSION — the `unmanaged` install mode end to end, on the real
// showcase composition with the install-local door mounted (ADR-0131 D6; the
// D6 execution card's stage-0 pins P1–P3, read with the spelling `unmanaged`
// the maintainer ruled, on the fixture the stage-0 ACCEPT named: the CRM
// example, `com.example.crm`).
//
// The package installed is the CRM example's built artifact, its manifest
// declaring `installModes: ['managed', 'unmanaged']` — exactly what
// `os package install ./dist/objectstack.json --install-mode unmanaged` sends.
//
// ## What each block pins
//
//   P1 (`single`, one database file across a restart)
//     - the install answers 200: the copy, its new base and `installedFrom`;
//     - every copied item is served by `GET /meta` and saved by `PUT` (its own
//       served body sent back) — editable shown by a write, the three items
//       the fixture LOCKS included, in both ADR-0010 spellings: a `_lock:
//       'full'` with a reason and a docs link, a `_lock: 'no-delete'` without
//       a reason, and a `protection` block on a type that declares one;
//     - the package's locks are not copied: no copied row carries a key of
//       either spelling (`_lock`, `_lockReason`, `_lockSource`, `_lockDocsUrl`,
//       `protection`), each copied item is served unlocked, and the answer's
//       `strippedLocks` names all three, in write order, each reason verbatim
//       (the ruling on the D6 lock fork, record 6119681934);
//     - every copied row is owned by the new base, `organization_id` NULL;
//     - nothing under the source id: no install-ledger entry, no registry
//       package; the translation bundles arrive as `translation` items;
//     - after a restart on the same database every item is still served, and
//       the package is still not registered under its own id.
//   P3 (the same boot, after the restart)
//     - a managed install of a bumped version is refused before any write,
//       naming the copy base — the copied rows' checksums byte-identical;
//     - a second unmanaged install is refused on collision;
//     - the import's three registry reads, measured on the REAL registry: an
//       existing target, a target that is a booted code package, an owned
//       namespace.
//   P2 (`isolated`, its own boot)
//     - the unmanaged install is refused with the ADR-0112 code and status,
//       naming the posture, and writes nothing; positive control: the managed
//       install of the same artifact on the same boot answers 200;
//     - the lock control: that MANAGED install keeps the package's locks, in
//       both spellings — the dashboard is served `full` with its reason, and
//       the dataset is served locked with the reason its `protection` gave.
//
// Boots fixture stacks of its own, so it stays out of `SHARED_SHOWCASE`.

import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import crmStack from '@objectstack/example-crm';
import { type VerifyStack } from '@objectstack/verify';
import { MarketplaceInstallLocalPlugin } from '@objectstack/cloud-connection';
import type { IObjectQLEngine } from '@objectstack/spec/contracts';
import type { ExecutionContext } from '@objectstack/spec/kernel';
import { bootShowcase } from './showcase-boot.js';
import { buildShapedArtifact } from './build-shaped-artifact.js';

const SYS = { isSystem: true } as ExecutionContext;
const CRM = 'com.example.crm';
const BASE_ID = 'com.example.crm-copy';
const ROUTE = '/marketplace/install-local';
const BOTH = ['managed', 'unmanaged'];

type Answer = { status: number; body: any }; // eslint-disable-line @typescript-eslint/no-explicit-any

type Item = { type: string; name: string };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const rowsOf = (r: any): any[] => (Array.isArray(r) ? r : Array.isArray(r?.records) ? r.records : []);

async function json(res: Response): Promise<Answer> {
  return { status: res.status, body: await res.json().catch(() => null) };
}

/** The three items the fixture locks (ADR-0010) — the CRM ships no lock of its own. */
const LOCKED_DASHBOARD = 'pipeline_dashboard';
const LOCKED_APP = 'crm_app';
const LOCKED_DATASET = 'opportunity_metrics';
const DASHBOARD_LOCK_REASON = 'The pipeline figures feed the board pack — edit the source package instead.';
const DATASET_LOCK_REASON = 'Forecast reports read these measures; change them in the source package.';

/**
 * The CRM stack with three protection locks authored on it, BEFORE the build,
 * so the build's own parse judges them, in both ADR-0010 spellings: the
 * pipeline dashboard through the `_lock` envelope (`full`, a reason, a docs
 * link), the app through `_lock` alone (`no-delete`), and the opportunity
 * dataset through the author-facing `protection` block (`no-overlay`).
 */
function lockedCrmStack(): Record<string, unknown> {
  const stack = crmStack as unknown as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  const lockOne = (items: any[], name: string, lock: Record<string, unknown>) => { // eslint-disable-line @typescript-eslint/no-explicit-any
    if (!items.some((item) => item?.name === name)) throw new Error(`fixture: the CRM ships no '${name}' to lock`);
    return items.map((item) => (item?.name === name ? { ...item, ...lock } : item));
  };
  return {
    ...stack,
    dashboards: lockOne(stack.dashboards, LOCKED_DASHBOARD, {
      _lock: 'full', _lockReason: DASHBOARD_LOCK_REASON, _lockDocsUrl: 'https://example.com/crm/pipeline-lock',
    }),
    apps: lockOne(stack.apps, LOCKED_APP, { _lock: 'no-delete' }),
    datasets: lockOne(stack.datasets, LOCKED_DATASET, {
      protection: { lock: 'no-overlay', reason: DATASET_LOCK_REASON, docsUrl: 'https://example.com/crm/forecast-lock' },
    }),
  };
}

/**
 * The install body `os package install <artifact>.json [--install-mode …]`
 * sends: the CRM example's built artifact — two of its items locked — its
 * manifest declaring both modes, `id` / `version` hoisted beside it.
 */
function installBody(opts: { installMode?: 'managed' | 'unmanaged'; version?: string } = {}): Record<string, unknown> {
  const { artifact } = buildShapedArtifact(lockedCrmStack());
  const manifest: Record<string, unknown> = {
    ...(artifact.manifest as Record<string, unknown>),
    installModes: BOTH,
    ...(opts.version ? { version: opts.version } : {}),
  };
  return {
    manifest: { ...artifact, manifest, id: manifest.id, version: manifest.version },
    ...(opts.installMode ? { installMode: opts.installMode } : {}),
  };
}

/** A served `/meta` document, unwrapped from its envelope. */
function servedItem(answer: Answer): Record<string, unknown> | undefined {
  const doc = answer.body?.data ?? answer.body;
  return (doc?.item ?? doc) as Record<string, unknown> | undefined;
}

/** The body a Studio editor sends back: the served document minus the read decorations. */
function editableBody(item: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(item)) if (!k.startsWith('_')) out[k] = v;
  return out;
}

/** The active `sys_metadata` rows of the copied items, as `type/name` → row. */
async function copiedRows(ql: IObjectQLEngine, items: readonly Item[]): Promise<Map<string, any>> { // eslint-disable-line @typescript-eslint/no-explicit-any
  const names = [...new Set(items.map((i) => i.name))];
  const rows = rowsOf(await ql.find('sys_metadata', {
    where: { name: { $in: names }, state: 'active' },
    context: SYS,
  }));
  const wanted = new Set(items.map((i) => `${i.type}/${i.name}`));
  const out = new Map<string, any>(); // eslint-disable-line @typescript-eslint/no-explicit-any
  for (const row of rows) {
    const key = `${row.type}/${row.name}`;
    if (wanted.has(key)) out.set(key, row);
  }
  return out;
}

describe('dogfood: the unmanaged install mode on `single` — P1 and P3 (ADR-0131 D6)', () => {
  let stack: VerifyStack | undefined;
  let storageDir: string;
  let dbDir: string;

  let install: Answer;
  let copied: Item[] = [];
  let reads: Array<Item & { status: number; provenance: unknown; lock: unknown; editable: unknown }> = [];
  let saves: Array<Item & { status: number; body: unknown }> = [];
  let rowsAfterInstall = new Map<string, any>(); // eslint-disable-line @typescript-eslint/no-explicit-any
  let sourcePackageAfterInstall: unknown;
  let ledgerFilesAfterInstall: string[] = [];
  let translationServed: Answer;

  let readsAfterRestart: Array<Item & { status: number }> = [];
  let sourcePackageAfterRestart: unknown;
  let basePackageAfterRestart: unknown;
  let namespaceOwnersAfterRestart: unknown;

  let managedBumped: Answer;
  let checksumsBefore = new Map<string, string>();
  let checksumsAfter = new Map<string, string>();
  let ledgerFilesAfterManaged: string[] = [];
  let secondUnmanaged: Answer;
  let targetIsCodePackage: { code?: string; status?: number; message?: string } | null;
  let namespaceOwned: { code?: string; status?: number; message?: string; details?: unknown } | null;

  const boot = (databaseFile: string) => bootShowcase({
    databaseFile,
    extraPlugins: [new MarketplaceInstallLocalPlugin({ controlPlaneUrl: 'off', storageDir })],
  });
  const ledgerFiles = () => (existsSync(storageDir) ? readdirSync(storageDir).filter((f) => f.endsWith('.json')) : []);

  beforeAll(async () => {
    storageDir = mkdtempSync(join(tmpdir(), 'dogfood-unmanaged-ledger-'));
    dbDir = mkdtempSync(join(tmpdir(), 'dogfood-unmanaged-db-'));
    const databaseFile = join(dbDir, 'verify.db');

    // ── boot 1: P1 ─────────────────────────────────────────────────────────
    stack = await boot(databaseFile);
    let token = await stack.signIn();
    let ql = stack.kernel.getService<IObjectQLEngine>('objectql');

    install = await json(await stack.apiAs(token, 'POST', ROUTE, installBody({ installMode: 'unmanaged' })));
    copied = (install.body?.data?.copied ?? []) as Item[];
    for (const item of copied) {
      const read = await json(await stack.apiAs(token, 'GET', `/meta/${item.type}/${item.name}`));
      const served = servedItem(read);
      const envelope = read.body?.data ?? read.body;
      reads.push({
        ...item, status: read.status, provenance: served?._provenance, lock: envelope?.lock, editable: envelope?.editable,
      });
    }
    rowsAfterInstall = await copiedRows(ql, copied);
    // Editable, shown by a write: each item's own served body, sent back.
    for (const item of copied) {
      const read = await json(await stack.apiAs(token, 'GET', `/meta/${item.type}/${item.name}`));
      const served = servedItem(read);
      const put = await json(await stack.apiAs(token, 'PUT', `/meta/${item.type}/${item.name}`, editableBody(served ?? {})));
      saves.push({ ...item, status: put.status, body: put.status === 200 ? undefined : put.body });
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    sourcePackageAfterInstall = (ql as any).registry?.getPackage?.(CRM);
    ledgerFilesAfterInstall = ledgerFiles();
    translationServed = await json(await stack.apiAs(token, 'GET', '/meta/translation/crm_zh_cn'));
    await stack.stop();
    stack = undefined;

    // ── boot 2: the same database file and ledger directory ────────────────
    stack = await boot(databaseFile);
    token = await stack.signIn();
    ql = stack.kernel.getService<IObjectQLEngine>('objectql');
    for (const item of copied) {
      const read = await json(await stack.apiAs(token, 'GET', `/meta/${item.type}/${item.name}`));
      readsAfterRestart.push({ ...item, status: read.status });
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const registry = (ql as any).registry;
    sourcePackageAfterRestart = registry?.getPackage?.(CRM);
    basePackageAfterRestart = registry?.getPackage?.(BASE_ID);
    namespaceOwnersAfterRestart = registry?.getNamespaceOwners?.('crm');

    // ── P3 ──────────────────────────────────────────────────────────────────
    const before = await copiedRows(ql, copied);
    for (const [key, row] of before) checksumsBefore.set(key, `${row.checksum}|${row.metadata}`);
    managedBumped = await json(await stack.apiAs(token, 'POST', ROUTE, installBody({ version: '4.0.1' })));
    const after = await copiedRows(ql, copied);
    for (const [key, row] of after) checksumsAfter.set(key, `${row.checksum}|${row.metadata}`);
    ledgerFilesAfterManaged = ledgerFiles();
    secondUnmanaged = await json(await stack.apiAs(token, 'POST', ROUTE, installBody({ installMode: 'unmanaged' })));

    // The import's three registry reads, on the REAL registry (the verb
    // itself, through the protocol service — the door always names the
    // default target).
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const protocol: any = await stack.kernel.getServiceAsync('protocol');
    const flat = (() => {
      const body = installBody().manifest as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
      const { manifest: meta, ...sections } = body;
      return { ...meta, ...sections };
    })();
    const attempt = async (targetPackageId: string) => {
      try {
        await protocol.importUnmanagedPackage({ manifest: flat, targetPackageId });
        return null;
      } catch (e: any) { // eslint-disable-line @typescript-eslint/no-explicit-any
        return { code: e?.code, status: e?.status, message: e?.message, details: e?.details };
      }
    };
    targetIsCodePackage = await attempt('com.example.showcase');
    namespaceOwned = await attempt('com.example.crm-second');
  }, 600_000);

  afterAll(async () => {
    await stack?.stop?.();
    if (storageDir) rmSync(storageDir, { recursive: true, force: true });
    if (dbDir) rmSync(dbDir, { recursive: true, force: true });
  });

  // ── P1 ────────────────────────────────────────────────────────────────────

  it('P1: the unmanaged install answers 200 — the copy, its new base, and where it came from', () => {
    expect(install.status, JSON.stringify(install.body)).toBe(200);
    expect(install.body?.data).toMatchObject({
      manifestId: CRM,
      installMode: 'unmanaged',
      targetPackageId: BASE_ID,
      namespace: 'crm',
      installedFrom: { packageId: CRM, version: '4.0.0' },
    });
    expect(install.body.data.copiedCount).toBe(copied.length);
    // Every kind the CRM ships, and a `defineView` CONTAINER — copied under the
    // object it binds, its expansion judged and saved by the save door.
    expect([...new Set(copied.map((i) => i.type))]).toEqual(expect.arrayContaining([
      'object', 'view', 'app', 'page', 'dashboard', 'dataset', 'action', 'hook', 'flow', 'position', 'permission',
      'datasource', 'translation',
    ]));
    expect(copied).toContainEqual({ type: 'view', name: 'crm_lead' });
    // The CRM declares seed data, which an unmanaged install does not load — and says so.
    expect(install.body.data.seeded?.mode).toBe('skipped');
  });

  it('P1: every copied item is served by GET /meta, as environment-authored metadata', () => {
    const unserved = reads.filter((r) => r.status !== 200);
    expect(unserved, JSON.stringify(unserved)).toEqual([]);
    const notEnvironment = reads.filter((r) => r.provenance !== undefined && r.provenance !== 'org');
    expect(notEnvironment, JSON.stringify(notEnvironment)).toEqual([]);
  });

  it('P1: every copied item is saved by PUT — its own served body, sent back', () => {
    const refused = saves.filter((s) => s.status !== 200);
    expect(refused, JSON.stringify(refused, null, 1)).toEqual([]);
    // The three items the package locked are among them: the copy is editable.
    expect(saves.map((s) => `${s.type}/${s.name}`)).toEqual(expect.arrayContaining([
      `dashboard/${LOCKED_DASHBOARD}`, `app/${LOCKED_APP}`, `dataset/${LOCKED_DATASET}`,
    ]));
  });

  it('P1: the package\'s locks are not copied, in either spelling — no copied row carries one, and every copied item is served unlocked', () => {
    const lockedRows = [...rowsAfterInstall]
      .filter(([, row]) => {
        const body = typeof row.metadata === 'string' ? JSON.parse(row.metadata) : row.metadata;
        return ['_lock', '_lockReason', '_lockSource', '_lockDocsUrl', 'protection'].some((key) => body && key in body);
      })
      .map(([key]) => key);
    expect(lockedRows).toEqual([]);
    const servedLocked = reads.filter((r) => (r.lock !== undefined && r.lock !== 'none') || r.editable === false);
    expect(servedLocked, JSON.stringify(servedLocked)).toEqual([]);
  });

  it('P1: the answer names each lock it dropped, in write order, with the package\'s reason verbatim', () => {
    const position = (type: string, name: string) => copied.findIndex((i) => i.type === type && i.name === name);
    const expected = [
      { type: 'dashboard', name: LOCKED_DASHBOARD, lock: 'full', reason: DASHBOARD_LOCK_REASON },
      { type: 'app', name: LOCKED_APP, lock: 'no-delete' },
      { type: 'dataset', name: LOCKED_DATASET, lock: 'no-overlay', reason: DATASET_LOCK_REASON },
    ].sort((a, b) => position(a.type, a.name) - position(b.type, b.name));
    expect(install.body?.data?.strippedLocks).toEqual(expected);
  });

  it('P1: every copied row is owned by the NEW base, with organization_id NULL', () => {
    expect(rowsAfterInstall.size, 'one active row per copied item').toBe(copied.length);
    const misowned = [...rowsAfterInstall].filter(([, row]) => row.package_id !== BASE_ID || (row.organization_id ?? null) !== null);
    expect(misowned.map(([key, row]) => `${key}@${row.package_id}|${row.organization_id}`)).toEqual([]);
  });

  it('P1: nothing under the source id — no install-ledger entry, no registry package', () => {
    expect(ledgerFilesAfterInstall).toEqual([]);
    expect(sourcePackageAfterInstall).toBeUndefined();
  });

  it('P1: the translation bundles arrive as environment `translation` items', () => {
    expect(copied).toContainEqual({ type: 'translation', name: 'crm_zh_cn' });
    expect(translationServed.status, JSON.stringify(translationServed.body)).toBe(200);
    expect(servedItem(translationServed)).toMatchObject({ locale: 'zh-CN' });
  });

  it('P1: after a restart on the same database every item is still served, and the package is still not registered', () => {
    const unserved = readsAfterRestart.filter((r) => r.status !== 200);
    expect(unserved, JSON.stringify(unserved)).toEqual([]);
    expect(sourcePackageAfterRestart).toBeUndefined();
    expect(basePackageAfterRestart).toBeDefined();
  });

  // ── P3 ────────────────────────────────────────────────────────────────────

  it('P3: the copy base still holds the namespace after the restart — what the managed refusal reads', () => {
    expect(namespaceOwnersAfterRestart).toEqual([BASE_ID]);
  });

  it('P3: a managed install of a bumped version is refused before any write, naming the copy base', () => {
    expect(managedBumped.status, JSON.stringify(managedBumped.body)).toBe(409);
    expect(managedBumped.body?.error?.code).toBe('RESOURCE_CONFLICT');
    expect(managedBumped.body?.error?.details).toEqual({ namespace: 'crm', base: BASE_ID });
    expect(managedBumped.body?.error?.message).toContain(`'${BASE_ID}'`);
    expect(ledgerFilesAfterManaged, 'no ledger entry written').toEqual([]);
  });

  it('P3: the copied rows are byte-identical across the refused managed install', () => {
    expect(checksumsBefore.size).toBe(copied.length);
    expect([...checksumsAfter]).toEqual([...checksumsBefore]);
  });

  it('P3: a second unmanaged install is refused on collision — the copy base already exists', () => {
    expect(secondUnmanaged.status, JSON.stringify(secondUnmanaged.body)).toBe(409);
    expect(secondUnmanaged.body?.error?.code).toBe('RESOURCE_CONFLICT');
    expect(secondUnmanaged.body?.error?.message).toContain(`'${BASE_ID}' already exists`);
  });

  it('P3: the import\'s registry reads, on the real registry — a target that is a booted code package', () => {
    expect(targetIsCodePackage?.status).toBe(409);
    expect(targetIsCodePackage?.code).toBe('RESOURCE_CONFLICT');
    expect(targetIsCodePackage?.message).toContain("'com.example.showcase' already exists");
  });

  it('P3: the import\'s registry reads, on the real registry — a namespace the copy base owns', () => {
    expect(namespaceOwned?.status).toBe(409);
    expect(namespaceOwned?.code).toBe('RESOURCE_CONFLICT');
    expect(namespaceOwned?.details).toEqual({ namespace: 'crm', owners: [BASE_ID] });
  });
});

describe('dogfood: the unmanaged install mode on `isolated` — P2 (ADR-0131 D6)', () => {
  let stack: VerifyStack | undefined;
  let storageDir: string;
  let tenancy: { posture?: string } | undefined;
  let refused: Answer;
  let baseAfterRefusal: unknown;
  let baseRowsAfterRefusal: number;
  let ledgerAfterRefusal: string[];
  let managed: Answer;
  let managedLockedDashboard: Answer;
  let managedLockedDataset: Answer;

  beforeAll(async () => {
    storageDir = mkdtempSync(join(tmpdir(), 'dogfood-unmanaged-isolated-'));
    stack = await bootShowcase({
      multiTenant: 'posture-only',
      extraPlugins: [new MarketplaceInstallLocalPlugin({ controlPlaneUrl: 'off', storageDir })],
    });
    tenancy = await stack.kernel.getServiceAsync<{ posture: string }>('tenancy');
    const token = await stack.signIn();
    const ql = stack.kernel.getService<IObjectQLEngine>('objectql');

    refused = await json(await stack.apiAs(token, 'POST', ROUTE, installBody({ installMode: 'unmanaged' })));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    baseAfterRefusal = (ql as any).registry?.getPackage?.(BASE_ID);
    baseRowsAfterRefusal = rowsOf(await ql.find('sys_metadata', { where: { package_id: BASE_ID }, context: SYS })).length;
    ledgerAfterRefusal = readdirSync(storageDir).filter((f) => f.endsWith('.json'));

    // Positive control on the same boot: the managed install of the same artifact.
    managed = await json(await stack.apiAs(token, 'POST', ROUTE, installBody({ installMode: 'managed' })));
    managedLockedDashboard = await json(await stack.apiAs(token, 'GET', `/meta/dashboard/${LOCKED_DASHBOARD}`));
    managedLockedDataset = await json(await stack.apiAs(token, 'GET', `/meta/dataset/${LOCKED_DATASET}`));
  }, 300_000);

  afterAll(async () => {
    await stack?.stop?.();
    if (storageDir) rmSync(storageDir, { recursive: true, force: true });
  });

  it('PRECONDITION: the requested posture on this boot is `isolated`', () => {
    expect(tenancy?.posture).toBe('isolated');
  });

  it('P2: refused 409 UNMANAGED_INSTALL_WALLED_POSTURE, naming the posture', () => {
    expect(refused.status, JSON.stringify(refused.body)).toBe(409);
    expect(refused.body?.error?.code).toBe('UNMANAGED_INSTALL_WALLED_POSTURE');
    expect(refused.body?.error?.details).toEqual({ posture: 'isolated' });
    expect(refused.body?.error?.message).toContain("'isolated' tenancy posture");
  });

  it('P2: zero writes — no base, no row, no ledger entry', () => {
    expect(baseAfterRefusal).toBeUndefined();
    expect(baseRowsAfterRefusal).toBe(0);
    expect(ledgerAfterRefusal).toEqual([]);
  });

  it('P2 positive control: the managed install of the same artifact on the same boot answers 200', () => {
    expect(managed.status, JSON.stringify(managed.body)).toBe(200);
    expect(managed.body?.data?.manifestId).toBe(CRM);
    expect(managed.body?.data).not.toHaveProperty('installMode');
    expect(managed.body?.data).not.toHaveProperty('strippedLocks');
  });

  it('lock control: the MANAGED install keeps the package\'s locks, in both spellings — each served locked, with its reason', () => {
    expect(managedLockedDashboard.status, JSON.stringify(managedLockedDashboard.body)).toBe(200);
    expect(managedLockedDashboard.body?.data ?? managedLockedDashboard.body).toMatchObject({
      lock: 'full', lockReason: DASHBOARD_LOCK_REASON, editable: false, deletable: false,
    });
    expect(managedLockedDataset.status, JSON.stringify(managedLockedDataset.body)).toBe(200);
    // The envelope's `lock` reports the verdicts in force, and a managed item
    // is sealed besides; the package's reason on it is the block's lock binding.
    expect(managedLockedDataset.body?.data ?? managedLockedDataset.body).toMatchObject({
      lockReason: DATASET_LOCK_REASON, editable: false,
    });
  });
});
