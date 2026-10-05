// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// GOLDEN REGRESSION — after a restart whose `kernel:ready` rehydrate refused a
// protocol-incompatible package, `GET /api/v1/marketplace/install-local` lists
// it with a not-loaded marker carrying the refusal's code and the declared
// range, reads none of its seed rows, and DELETE still removes it (#21822).
//
// ## What was measured before the fix
//
// On an unwalled real boot (showcase + this plugin, `databaseFile`), after a
// restart whose rehydrate refused `com.example.crm` (its ledger entry declared
// the previous protocol major): `200`, the entry listed with the same fields as
// a loaded package, nothing saying it was not loaded — only the boot's `error`
// line did — and each GET logged one `warn` that the listing could not read the
// package's seed rows (`Object 'crm_account' not found`).
//
// ## What this file pins, on two real boots over one database file and one ledger
//
//   1. PRECONDITIONS: boot 1 installed the CRM package with its 28 seed rows
//      and a small loadable package; between the boots the CRM ledger entry is
//      made to declare the previous protocol major — an install made for an
//      older runtime — and boot 2's rehydrate refuses it.
//   2. The listing on boot 2 serves the CRM entry with
//      `notLoaded: { code: 'OS_PROTOCOL_INCOMPATIBLE', requiredRange }` in place
//      of `withSampleData`; the loadable package's item is byte-identical to its
//      boot-1 item.
//   3. That GET logs no seed-row warning. Control: an unreadable ledger file
//      planted before boot 2 makes the same GET log its own `warn` through the
//      same logger, so the capture is shown to see that level in that window.
//   4. DELETE on the marked entry answers 200, and the listing then serves the
//      loadable package alone.
//
// Boots its own showcase stack, twice, so it stays out of `SHARED_SHOWCASE`.

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import showcaseStack from '@objectstack/example-showcase';
import crmStack from '@objectstack/example-crm';
import { bootStack, type VerifyStack } from '@objectstack/verify';
import { LocalManifestSource, MarketplaceInstallLocalPlugin } from '@objectstack/cloud-connection';
import { PROTOCOL_MAJOR } from '@objectstack/spec/kernel';
import { buildShapedArtifact } from './build-shaped-artifact.js';

const CRM = 'com.example.crm';
/** A package with nothing to refuse: built for this protocol, no objects, no seed data. */
const LOADABLE = 'com.example.qa21822';
const BASE = '/marketplace/install-local';
const OLD_RANGE = `^${PROTOCOL_MAJOR - 1}`;
const SEED_WARNING = 'the installed-apps listing could not read this package\'s seed rows';
const UNREADABLE_FILE = 'qa-21822-unreadable.json';

/** The install body `os package install <artifact>.json` sends. */
function crmInstallBody(): { manifest: Record<string, unknown> } {
  const { artifact } = buildShapedArtifact(crmStack as unknown as Record<string, unknown>);
  const manifest = artifact.manifest as { id?: string; version?: string };
  return { manifest: { ...artifact, id: manifest.id, version: manifest.version } };
}

const loadableInstallBody = {
  manifest: { id: LOADABLE, name: 'qa_21822', version: '1.0.0', type: 'app', scope: 'project', engines: { protocol: `^${PROTOCOL_MAJOR}` } },
};

async function json(res: Response): Promise<{ status: number; body: any }> { // eslint-disable-line @typescript-eslint/no-explicit-any
  return { status: res.status, body: await res.json().catch(() => null) };
}

/** Every line the process writes while `run` is in flight — the kernel logger writes to the streams. */
async function captureOutput<T>(run: () => Promise<T>): Promise<{ value: T; lines: string[] }> {
  const lines: string[] = [];
  const stdout = process.stdout.write.bind(process.stdout);
  const stderr = process.stderr.write.bind(process.stderr);
  const warn = console.warn;
  const error = console.error;
  (process.stdout as any).write = (chunk: unknown, ...rest: any[]) => { lines.push(String(chunk)); return stdout(chunk as any, ...rest); }; // eslint-disable-line @typescript-eslint/no-explicit-any
  (process.stderr as any).write = (chunk: unknown, ...rest: any[]) => { lines.push(String(chunk)); return stderr(chunk as any, ...rest); }; // eslint-disable-line @typescript-eslint/no-explicit-any
  console.warn = (...args: unknown[]) => { lines.push(args.map(String).join(' ')); warn(...args); };
  console.error = (...args: unknown[]) => { lines.push(args.map(String).join(' ')); error(...args); };
  try {
    return { value: await run(), lines };
  } finally {
    (process.stdout as any).write = stdout; // eslint-disable-line @typescript-eslint/no-explicit-any
    (process.stderr as any).write = stderr; // eslint-disable-line @typescript-eslint/no-explicit-any
    console.warn = warn;
    console.error = error;
  }
}

type Item = Record<string, unknown> & { manifestId: string };
const itemsOf = (listing: { body: any }): Item[] => listing.body?.data?.items ?? []; // eslint-disable-line @typescript-eslint/no-explicit-any
const itemOf = (listing: { body: any }, manifestId: string): Item | undefined => itemsOf(listing).find((i) => i.manifestId === manifestId); // eslint-disable-line @typescript-eslint/no-explicit-any

describe('dogfood: the install-local listing marks a package the restart refused to load as not loaded (#21822)', () => {
  let stack: VerifyStack | undefined;
  let storageDir: string;
  let dbDir: string;
  let crmInstall: { status: number; body: any }; // eslint-disable-line @typescript-eslint/no-explicit-any
  let loadableInstall: { status: number; body: any }; // eslint-disable-line @typescript-eslint/no-explicit-any
  let crmVersion: string;
  let beforeRestart: { status: number; body: any }; // eslint-disable-line @typescript-eslint/no-explicit-any
  let bootLines: string[];
  let afterRestart: { status: number; body: any }; // eslint-disable-line @typescript-eslint/no-explicit-any
  let listLines: string[];
  let uninstall: { status: number; body: any }; // eslint-disable-line @typescript-eslint/no-explicit-any
  let afterUninstall: { status: number; body: any }; // eslint-disable-line @typescript-eslint/no-explicit-any

  const boot = (databaseFile: string) => bootStack(showcaseStack, {
    databaseFile,
    extraPlugins: [new MarketplaceInstallLocalPlugin({ controlPlaneUrl: 'off', storageDir })],
  });

  beforeAll(async () => {
    storageDir = mkdtempSync(join(tmpdir(), 'dogfood-install-local-not-loaded-ledger-'));
    dbDir = mkdtempSync(join(tmpdir(), 'dogfood-install-local-not-loaded-db-'));
    const databaseFile = join(dbDir, 'verify.db');

    // ── boot 1: install the CRM package and a loadable one ─────────────────
    stack = await boot(databaseFile);
    let token = await stack.signIn();
    crmInstall = await json(await stack.apiAs(token, 'POST', BASE, crmInstallBody()));
    loadableInstall = await json(await stack.apiAs(token, 'POST', BASE, loadableInstallBody));
    beforeRestart = await json(await stack.apiAs(token, 'GET', BASE));
    await stack.stop();
    stack = undefined;

    // ── between the boots: the CRM install now declares the previous major ─
    // (an install made for an older runtime), and the ledger holds one file
    // that does not parse — the capture control for the listing's warn line.
    const ledger = new LocalManifestSource(storageDir);
    const crm = ledger.read(CRM).entry!;
    crmVersion = crm.version;
    ledger.write({ ...crm, manifest: { ...crm.manifest, engines: { ...(crm.manifest?.engines ?? {}), protocol: OLD_RANGE } } });
    writeFileSync(join(storageDir, UNREADABLE_FILE), '{');

    // ── boot 2: the same database file and ledger ──────────────────────────
    const booted = await captureOutput(() => boot(databaseFile));
    stack = booted.value;
    bootLines = booted.lines;
    token = await stack.signIn();
    const listed = await captureOutput(async () => json(await stack!.apiAs(token, 'GET', BASE)));
    afterRestart = listed.value;
    listLines = listed.lines;
    uninstall = await json(await stack.apiAs(token, 'DELETE', `${BASE}/${CRM}`));
    afterUninstall = await json(await stack.apiAs(token, 'GET', BASE));
  }, 300_000);

  afterAll(async () => {
    await stack?.stop?.();
    if (storageDir) rmSync(storageDir, { recursive: true, force: true });
    if (dbDir) rmSync(dbDir, { recursive: true, force: true });
  });

  it('PRECONDITION: boot 1 installed the CRM package with its seed rows, and the loadable package', () => {
    expect(crmInstall.status, JSON.stringify(crmInstall.body)).toBe(200);
    expect(crmInstall.body?.data?.seeded).toMatchObject({ mode: 'inline', inserted: 28 });
    expect(loadableInstall.status, JSON.stringify(loadableInstall.body)).toBe(200);
    expect(beforeRestart.status).toBe(200);
    expect(itemOf(beforeRestart, CRM)).toMatchObject({ withSampleData: true });
    expect(itemOf(beforeRestart, CRM)).not.toHaveProperty('notLoaded');
  });

  it('PRECONDITION: boot 2\'s rehydrate refused the CRM package', () => {
    const refused = bootLines.filter((l) => l.includes(`OS_PROTOCOL_INCOMPATIBLE: ${CRM}@${crmVersion} is NOT loaded`));
    expect(refused, 'the rehydrate\'s refusal line').toHaveLength(1);
  });

  it('lists the refused package with the marker and the code, in place of withSampleData', () => {
    expect(afterRestart.status, JSON.stringify(afterRestart.body)).toBe(200);
    expect(afterRestart.body?.data?.total).toBe(2);
    const crm = itemOf(afterRestart, CRM);
    expect(crm?.notLoaded).toEqual({ code: 'OS_PROTOCOL_INCOMPATIBLE', requiredRange: OLD_RANGE });
    expect(crm).not.toHaveProperty('withSampleData');
    const { withSampleData: _was, ...unchangedFields } = itemOf(beforeRestart, CRM)!;
    expect(crm).toEqual({ ...unchangedFields, notLoaded: { code: 'OS_PROTOCOL_INCOMPATIBLE', requiredRange: OLD_RANGE } });
  });

  it('a loadable entry is unchanged: its item is byte-identical to the one boot 1 served', () => {
    expect(JSON.stringify(itemOf(afterRestart, LOADABLE))).toBe(JSON.stringify(itemOf(beforeRestart, LOADABLE)));
    expect(itemOf(afterRestart, LOADABLE)).toMatchObject({ withSampleData: false });
  });

  it('control: the GET\'s capture holds the listing\'s own warn for the unreadable ledger file', () => {
    expect(listLines.some((l) => l.includes(`unreadable ledger entry ${UNREADABLE_FILE}`))).toBe(true);
  });

  it('the GET logs no seed-row warning for the refused package', () => {
    expect(listLines.filter((l) => l.includes(SEED_WARNING))).toEqual([]);
  });

  it('DELETE on the marked entry still works, and the listing then serves the loadable package alone', () => {
    expect(uninstall.status, JSON.stringify(uninstall.body)).toBe(200);
    expect(uninstall.body?.data?.manifestId).toBe(CRM);
    expect(afterUninstall.status).toBe(200);
    expect(itemsOf(afterUninstall).map((i) => i.manifestId)).toEqual([LOADABLE]);
    expect(new LocalManifestSource(storageDir).has(CRM)).toBe(false);
  });
});
