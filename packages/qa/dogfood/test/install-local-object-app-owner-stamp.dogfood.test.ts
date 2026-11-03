// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// GOLDEN REGRESSION — an installed package's `apps[]` and `objects[]` entries
// never keep a `_packageId` they wrote about themselves (#28697).
//
// ## What was measured before the fix
//
// Installed into the showcase through `POST /api/v1/marketplace/install-local`,
// an inline manifest whose `apps[0]` and `objects[0]` both carried the host's
// own `_packageId` answered 200 and hot-loaded. Its app was filed under the
// host: `GET /meta/app?package=<host>` listed it beside the showcase's own app
// and `?package=<installed>` listed nothing. The engine's body seam refused a
// foreign stamp in 28 collections (#28534) and not on these two, which file
// through verbs of their own, and `applyProtection` stamps an unset key only.
//
// ## What this file pins, on one boot
//
//   1. an install whose `apps[0]` wears the host's id is refused 422
//      `PLUGIN_REGISTER_FAILED` in the one judge's words, and nothing of it is
//      registered: not its app, not its (unstamped) object, no ledger entry;
//   2. the same for an install whose `objects[0]` wears the host's id;
//   3. controls: an install whose app and object stamp their OWN package, or
//      nothing, installs 200, its app listed under its own package and not
//      under the host's; the host's own apps list as they did at boot; and the
//      uninstall stays keyed on the registering package, taking app and object.
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
/** The showcase's own package id — a `code` row. */
const HOST_PACKAGE_ID = 'com.example.showcase';

const APP_STAMPED_ID = 'com.dogfood.appstamp';
const OBJECT_STAMPED_ID = 'com.dogfood.objstamp';
const CONTROL_ID = 'com.dogfood.ownstamp';

const object = (name: string, stamp?: string) => ({
  name,
  label: name,
  fields: { title: { type: 'text', label: 'Title' } },
  ...(stamp === undefined ? {} : { _packageId: stamp }),
});
const app = (name: string, objectName: string, stamp?: string) => ({
  name,
  label: name,
  navigation: [{ id: `nav_${objectName}`, type: 'object', label: objectName, objectName }],
  ...(stamp === undefined ? {} : { _packageId: stamp }),
});
const manifest = (id: string, namespace: string, extra: Record<string, unknown>) => ({
  manifest: { id, namespace, name: `Owner stamp ${namespace}`, version: '1.0.0', type: 'app', ...extra },
});

/** 1: the app names the host as its owner; its object names nothing. */
const APP_STAMPED = manifest(APP_STAMPED_ID, 'appstamp', {
  objects: [object('appstamp_thing')],
  apps: [app('appstamp_app', 'appstamp_thing', HOST_PACKAGE_ID)],
});
/** 2: the object names the host as its owner; its app names nothing. */
const OBJECT_STAMPED = manifest(OBJECT_STAMPED_ID, 'objstamp', {
  objects: [object('objstamp_thing', HOST_PACKAGE_ID)],
  apps: [app('objstamp_app', 'objstamp_thing')],
});
/** 3: one app and one object stamping their own package; one of each stamping nothing. */
const CONTROL = manifest(CONTROL_ID, 'ownstamp', {
  objects: [object('ownstamp_thing', CONTROL_ID), object('ownstamp_plain')],
  apps: [app('ownstamp_app', 'ownstamp_thing', CONTROL_ID), app('ownstamp_plain_app', 'ownstamp_plain')],
});

type Answer = { status: number; body: any };

async function json(res: Response): Promise<Answer> {
  return { status: res.status, body: await res.json().catch(() => null) };
}

/** The names a `/meta/app` list answers, whatever envelope it wraps them in. */
function appNames(answer: Answer): string[] {
  const body = answer.body;
  const items: any[] = Array.isArray(body) ? body
    : Array.isArray(body?.items) ? body.items
      : Array.isArray(body?.data) ? body.data
        : Array.isArray(body?.data?.items) ? body.data.items
          : [];
  return items.map((i: any) => i?.name ?? i?.item?.name).filter((n: unknown): n is string => typeof n === 'string').sort();
}

describe('dogfood: an installed package\'s apps and objects never keep a `_packageId` they wrote about themselves', () => {
  let stack: VerifyStack;
  let storageDir: string;
  let hostAppsAtBoot: Answer;
  let appStamped: Answer;
  let objectStamped: Answer;
  let control: Answer;
  const reads: Record<string, Answer> = {};
  let ledger: Answer;
  let uninstall: Answer;
  const afterUninstall: Record<string, Answer> = {};

  beforeAll(async () => {
    storageDir = mkdtempSync(join(tmpdir(), 'dogfood-object-app-owner-stamp-'));
    stack = await bootShowcase({
      extraPlugins: [new MarketplaceInstallLocalPlugin({ controlPlaneUrl: 'off', storageDir })],
    });
    const token = await stack.signIn();
    const get = async (path: string) => json(await stack.apiAs(token, 'GET', path));

    hostAppsAtBoot = await get(`/meta/app?package=${HOST_PACKAGE_ID}`);
    appStamped = await json(await stack.apiAs(token, 'POST', ROUTE, APP_STAMPED));
    objectStamped = await json(await stack.apiAs(token, 'POST', ROUTE, OBJECT_STAMPED));
    control = await json(await stack.apiAs(token, 'POST', ROUTE, CONTROL));

    reads.hostApps = await get(`/meta/app?package=${HOST_PACKAGE_ID}`);
    reads.controlApps = await get(`/meta/app?package=${CONTROL_ID}`);
    for (const name of ['appstamp_app', 'objstamp_app', 'ownstamp_app']) reads[`app:${name}`] = await get(`/meta/app/${name}`);
    for (const name of ['appstamp_thing', 'objstamp_thing', 'ownstamp_thing']) reads[`object:${name}`] = await get(`/meta/object/${name}`);
    ledger = await get(ROUTE);

    uninstall = await json(await stack.apiAs(token, 'DELETE', `${ROUTE}/${CONTROL_ID}`));
    afterUninstall.app = await get('/meta/app/ownstamp_app');
    afterUninstall.object = await get('/meta/object/ownstamp_thing');
    afterUninstall.hostApps = await get(`/meta/app?package=${HOST_PACKAGE_ID}`);
  }, 300_000);

  afterAll(async () => {
    await stack?.stop?.();
    if (storageDir) rmSync(storageDir, { recursive: true, force: true });
  });

  const ledgerIds = (): string[] => (ledger.body?.data?.items ?? []).map((i: any) => i.manifestId);

  it('1: an app stamping the host\'s package id is refused at the install, nothing of the package registered', () => {
    expect(appStamped.status, JSON.stringify(appStamped.body)).toBe(422);
    expect(appStamped.body?.error?.code).toBe('PLUGIN_REGISTER_FAILED');
    expect(appStamped.body?.error?.message).toContain('Drop `_packageId` from app \'appstamp_app\'');
    expect(appStamped.body?.error?.message).toContain(`"${HOST_PACKAGE_ID}"`);
    expect(appStamped.body?.error?.message).toContain(`under package '${APP_STAMPED_ID}'`);
    expect(reads['app:appstamp_app'].status, JSON.stringify(reads['app:appstamp_app'].body)).toBe(404);
    expect(reads['object:appstamp_thing'].status, 'the unstamped object beside it is not registered either').toBe(404);
    expect(appNames(reads.hostApps)).not.toContain('appstamp_app');
    expect(ledgerIds(), 'a refused inline install persists no ledger entry').not.toContain(APP_STAMPED_ID);
  });

  it('2: an object stamping the host\'s package id is refused at the install, nothing of the package registered', () => {
    expect(objectStamped.status, JSON.stringify(objectStamped.body)).toBe(422);
    expect(objectStamped.body?.error?.code).toBe('PLUGIN_REGISTER_FAILED');
    expect(objectStamped.body?.error?.message).toContain('Drop `_packageId` from object \'objstamp_thing\'');
    expect(objectStamped.body?.error?.message).toContain(`under package '${OBJECT_STAMPED_ID}'`);
    expect(reads['object:objstamp_thing'].status, JSON.stringify(reads['object:objstamp_thing'].body)).toBe(404);
    expect(reads['app:objstamp_app'].status, 'the unstamped app beside it is not registered either').toBe(404);
    expect(ledgerIds()).not.toContain(OBJECT_STAMPED_ID);
  });

  it('CONTROL: an app and object stamping their own package, or nothing, install; the apps list under their own package', () => {
    expect(control.status, JSON.stringify(control.body)).toBe(200);
    expect(control.body?.data?.hotLoaded).toBe(true);
    expect(reads['app:ownstamp_app'].status).toBe(200);
    expect(reads['object:ownstamp_thing'].status).toBe(200);
    expect(appNames(reads.controlApps)).toEqual(['ownstamp_app', 'ownstamp_plain_app']);
    expect(appNames(reads.hostApps)).not.toContain('ownstamp_app');
    expect(ledgerIds()).toContain(CONTROL_ID);
  });

  it('CONTROL: the host\'s own apps list as they did at boot, before and after the installs', () => {
    expect(hostAppsAtBoot.status).toBe(200);
    expect(appNames(hostAppsAtBoot).length, JSON.stringify(hostAppsAtBoot.body).slice(0, 400)).toBeGreaterThan(0);
    expect(appNames(reads.hostApps)).toEqual(appNames(hostAppsAtBoot));
    expect(appNames(afterUninstall.hostApps)).toEqual(appNames(hostAppsAtBoot));
  });

  it('CONTROL: the uninstall is keyed on the registering package, and takes its app and object', () => {
    expect(uninstall.status, JSON.stringify(uninstall.body)).toBe(200);
    expect(afterUninstall.app.status).toBe(404);
    expect(afterUninstall.object.status).toBe(404);
  });
});
