// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// GOLDEN REGRESSION — a package the install refuses part-way through
// registering leaves nothing of itself in the running system (#28697).
//
// ## What this file pins, on one boot
//
//   1. an install whose connector wears the showcase's id is refused as
//      before (422 `PLUGIN_REGISTER_FAILED`), and afterwards neither the
//      package, its object nor its app reads; the same id then installs
//      clean, 200;
//   2. an install the registry refuses part-way (its second object is one the
//      showcase owns) is refused 422 `PLUGIN_REGISTER_FAILED`, and afterwards
//      neither the package nor its first object reads; the showcase's object
//      still reads;
//   3. a refused upgrade of an installed package (v2's connector wears the
//      showcase's id) leaves v1 serving: its object, its app and the package at
//      version 1.0.0 read, and v2's new object does not;
//   4. an upgrade the registry refuses part-way (v2's third object is one the
//      showcase owns) is refused 422 `PLUGIN_REGISTER_FAILED`, and v1 keeps
//      serving whole: the package at 1.0.0, its object with v1's label and the
//      field another installed package extends it with, its app; v2's new
//      object does not read.
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
const MIDUP_ID = 'com.dogfood.refusedmidup';
const MIDUP_EXTENDER_ID = 'com.dogfood.refusedmidupext';

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

const MIDUP_V1 = install(MIDUP_ID, 'refusedmidup', '1.0.0', {
  objects: [{ ...object('refusedmidup_thing'), label: 'Midup v1' }],
  apps: [app('refusedmidup_app', 'refusedmidup_thing')],
});
const MIDUP_EXTENDER = install(MIDUP_EXTENDER_ID, 'refusedmidupext', '1.0.0', {
  objectExtensions: [{ extend: 'refusedmidup_thing', fields: { ext_note: { type: 'text', label: 'Extender note' } } }],
});
const MIDUP_V2 = install(MIDUP_ID, 'refusedmidup', '2.0.0', {
  objects: [{ ...object('refusedmidup_thing'), label: 'Midup v2' }, object('refusedmidup_new'), object(HOST_OBJECT)],
  apps: [app('refusedmidup_app', 'refusedmidup_thing')],
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

    // 4
    answers.midupV1 = await post(MIDUP_V1);
    answers.midupExtender = await post(MIDUP_EXTENDER);
    answers.midupV2 = await post(MIDUP_V2);
    answers.midupPackage = await get(`/packages/${MIDUP_ID}`);
    answers.midupObject = await get('/meta/object/refusedmidup_thing');
    answers.midupApp = await get('/meta/app/refusedmidup_app');
    answers.midupNew = await get('/meta/object/refusedmidup_new');
    answers.midupHostObject = await get(`/meta/object/${HOST_OBJECT}`);
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

  it('4: an upgrade the registry refuses part-way leaves the installed version serving whole', () => {
    expect(answers.midupV1.status, shown(answers.midupV1)).toBe(200);
    expect(answers.midupExtender.status, shown(answers.midupExtender)).toBe(200);
    expect(answers.midupV2.status, shown(answers.midupV2)).toBe(422);
    expect(answers.midupV2.body?.error?.code).toBe('PLUGIN_REGISTER_FAILED');
    expect(answers.midupV2.body?.error?.message).toContain(`already owned by package "${HOST_PACKAGE_ID}"`);
    expect(answers.midupPackage.status, shown(answers.midupPackage)).toBe(200);
    expect(JSON.stringify(answers.midupPackage.body)).toContain('"version":"1.0.0"');
    expect(JSON.stringify(answers.midupPackage.body)).not.toContain('"version":"2.0.0"');
    expect(answers.midupObject.status, shown(answers.midupObject)).toBe(200);
    expect(answers.midupObject.body?.item?.label).toBe('Midup v1');
    expect(Object.keys(answers.midupObject.body?.item?.fields ?? {})).toContain('ext_note');
    expect(answers.midupApp.status).toBe(200);
    expect(answers.midupNew.status, shown(answers.midupNew)).toBe(404);
    expect(answers.midupHostObject.status).toBe(200);
  });
});
