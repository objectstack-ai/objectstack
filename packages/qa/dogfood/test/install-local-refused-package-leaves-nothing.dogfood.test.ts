// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// GOLDEN REGRESSION — a package the install refuses part-way through
// registering leaves nothing of itself in the running system (#28697).
//
// ## What was measured before the fix
//
// Installed into the showcase through `POST /api/v1/marketplace/install-local`,
// an inline manifest whose object and app were clean and whose connector wore
// the showcase's own `_packageId` answered 422 `PLUGIN_REGISTER_FAILED`, with
// no ledger entry; but the package, its object and its app had already
// registered, and stayed readable until restart.
//
// ## What this file pins, on one boot
//
//   1. that install is refused as before, and afterwards neither the package,
//      its object nor its app reads; the same id then installs clean, 200;
//   2. an install the registry refuses part-way (its second object is one the
//      showcase owns) is refused 422 `PLUGIN_REGISTER_FAILED`, and afterwards
//      neither the package nor its first object reads; the showcase's object
//      still reads;
//   3. a refused upgrade of an installed package (v2's connector wears the
//      showcase's id) leaves v1 serving: its object, its app and the package at
//      version 1.0.0 read, and v2's new object does not.
//
// Boots a fixture stack of its own (the install-local plugin mounted), so it
// stays out of `SHARED_SHOWCASE`.

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { type VerifyStack } from '@objectstack/verify';
import { MarketplaceInstallLocalPlugin } from '@objectstack/cloud-connection';
import { bootShowcase } from './showcase-boot.js';

const ROUTE = '/marketplace/install-local';
/** The showcase's own package id, and an object it owns. */
const HOST_PACKAGE_ID = 'com.example.showcase';
const HOST_OBJECT = 'showcase_product';

const FRESH_ID = 'com.dogfood.refusedfresh';
const MIDWAY_ID = 'com.dogfood.refusedmidway';
const UPGRADE_ID = 'com.dogfood.refusedupgrade';

const object = (name: string) => ({ name, label: name, fields: { title: { type: 'text', label: 'Title' } } });
const app = (name: string, objectName: string) => ({
  name,
  label: name,
  navigation: [{ id: `nav_${objectName}`, type: 'object', label: objectName, objectName }],
});
/** A connector naming the showcase as its owner: refused from the body alone. */
const stampedConnector = (name: string) => ({
  name,
  label: 'Claims the host as its owner',
  type: 'api',
  provider: 'openapi',
  providerConfig: { spec: { openapi: '3.0.0', info: { title: 't', version: '1' }, paths: {} } },
  _packageId: HOST_PACKAGE_ID,
});
const install = (id: string, namespace: string, version: string, extra: Record<string, unknown>) => ({
  manifest: { id, namespace, name: `Refused ${namespace}`, version, type: 'app', ...extra },
});

const FRESH = install(FRESH_ID, 'refusedfresh', '1.0.0', {
  objects: [object('refusedfresh_thing')],
  apps: [app('refusedfresh_app', 'refusedfresh_thing')],
  connectors: [stampedConnector('refusedfresh_conn')],
});
const FRESH_CLEAN = install(FRESH_ID, 'refusedfresh', '1.0.0', {
  objects: [object('refusedfresh_thing')],
  apps: [app('refusedfresh_app', 'refusedfresh_thing')],
});
const MIDWAY = install(MIDWAY_ID, 'refusedmidway', '1.0.0', {
  objects: [object('refusedmidway_thing'), object(HOST_OBJECT)],
});
const UPGRADE_V1 = install(UPGRADE_ID, 'refusedupgrade', '1.0.0', {
  objects: [object('refusedupgrade_thing')],
  apps: [app('refusedupgrade_app', 'refusedupgrade_thing')],
});
const UPGRADE_V2 = install(UPGRADE_ID, 'refusedupgrade', '2.0.0', {
  objects: [object('refusedupgrade_thing'), object('refusedupgrade_new')],
  apps: [app('refusedupgrade_app', 'refusedupgrade_thing')],
  connectors: [stampedConnector('refusedupgrade_conn')],
});

type Answer = { status: number; body: any };

async function json(res: Response): Promise<Answer> {
  return { status: res.status, body: await res.json().catch(() => null) };
}

describe('dogfood: a package the install refuses part-way leaves nothing of itself registered', () => {
  let stack: VerifyStack;
  let storageDir: string;
  const answers: Record<string, Answer> = {};

  beforeAll(async () => {
    storageDir = mkdtempSync(join(tmpdir(), 'dogfood-refused-package-'));
    stack = await bootShowcase({
      extraPlugins: [new MarketplaceInstallLocalPlugin({ controlPlaneUrl: 'off', storageDir })],
    });
    const token = await stack.signIn();
    const get = async (path: string) => json(await stack.apiAs(token, 'GET', path));
    const post = async (body: unknown) => json(await stack.apiAs(token, 'POST', ROUTE, body));

    // 1
    answers.fresh = await post(FRESH);
    answers.freshPackage = await get(`/packages/${FRESH_ID}`);
    answers.freshObject = await get('/meta/object/refusedfresh_thing');
    answers.freshApp = await get('/meta/app/refusedfresh_app');
    answers.freshClean = await post(FRESH_CLEAN);
    answers.freshCleanApp = await get('/meta/app/refusedfresh_app');

    // 2
    answers.midway = await post(MIDWAY);
    answers.midwayPackage = await get(`/packages/${MIDWAY_ID}`);
    answers.midwayObject = await get('/meta/object/refusedmidway_thing');
    answers.hostObject = await get(`/meta/object/${HOST_OBJECT}`);

    // 3
    answers.v1 = await post(UPGRADE_V1);
    answers.v2 = await post(UPGRADE_V2);
    answers.upgradePackage = await get(`/packages/${UPGRADE_ID}`);
    answers.upgradeObject = await get('/meta/object/refusedupgrade_thing');
    answers.upgradeApp = await get('/meta/app/refusedupgrade_app');
    answers.upgradeNew = await get('/meta/object/refusedupgrade_new');
  }, 300_000);

  afterAll(async () => {
    await stack?.stop?.();
    if (storageDir) rmSync(storageDir, { recursive: true, force: true });
  });

  const shown = (a: Answer) => JSON.stringify(a.body).slice(0, 600);

  it('1: a body-only refusal leaves no package, object or app; the same id then installs clean', () => {
    expect(answers.fresh.status, shown(answers.fresh)).toBe(422);
    expect(answers.fresh.body?.error?.code).toBe('PLUGIN_REGISTER_FAILED');
    expect(answers.fresh.body?.error?.message).toContain('Drop `_packageId` from connector \'refusedfresh_conn\'');
    expect(answers.freshPackage.status, shown(answers.freshPackage)).toBe(404);
    expect(answers.freshObject.status, shown(answers.freshObject)).toBe(404);
    expect(answers.freshApp.status, shown(answers.freshApp)).toBe(404);
    expect(answers.freshClean.status, shown(answers.freshClean)).toBe(200);
    expect(answers.freshClean.body?.data?.hotLoaded).toBe(true);
    expect(answers.freshCleanApp.status).toBe(200);
  });

  it('2: a refusal the registry raises part-way leaves no package or object; the showcase\'s object still reads', () => {
    expect(answers.midway.status, shown(answers.midway)).toBe(422);
    expect(answers.midway.body?.error?.code).toBe('PLUGIN_REGISTER_FAILED');
    expect(answers.midway.body?.error?.message).toContain(`already owned by package "${HOST_PACKAGE_ID}"`);
    expect(answers.midwayPackage.status, shown(answers.midwayPackage)).toBe(404);
    expect(answers.midwayObject.status, shown(answers.midwayObject)).toBe(404);
    expect(answers.hostObject.status, shown(answers.hostObject)).toBe(200);
  });

  it('3: a refused upgrade leaves the installed version serving', () => {
    expect(answers.v1.status, shown(answers.v1)).toBe(200);
    expect(answers.v2.status, shown(answers.v2)).toBe(422);
    expect(answers.v2.body?.error?.code).toBe('PLUGIN_REGISTER_FAILED');
    expect(answers.upgradePackage.status, shown(answers.upgradePackage)).toBe(200);
    expect(JSON.stringify(answers.upgradePackage.body)).toContain('"version":"1.0.0"');
    expect(JSON.stringify(answers.upgradePackage.body)).not.toContain('"version":"2.0.0"');
    expect(answers.upgradeObject.status).toBe(200);
    expect(answers.upgradeApp.status).toBe(200);
    expect(answers.upgradeNew.status, shown(answers.upgradeNew)).toBe(404);
  });
});
