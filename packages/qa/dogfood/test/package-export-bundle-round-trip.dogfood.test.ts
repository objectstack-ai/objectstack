// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#28914] The whole-deployment export, `GET /packages/export`, round-trips
// onto a fresh runtime: a deployment holding a base package, the base's
// `.custom` pair with a published override, and a third package that extends
// the base exports three installable packages, and installing them, in the
// order served, through the door `os package install FILE` posts to
// (`POST /api/v1/marketplace/install-local`, `{ manifest }`) yields the same
// metadata names and counts, base and pair alike.
//
// And nothing secret leaves: the base ships a connector whose `auth` names its
// secret with `credentialRef`. The bundle carries the reference, and the value
// the reference resolves to on the source runtime appears nowhere in it.
//
// ## What this file pins, over two showcase boots
//
//   1. source: the bundle answers exactly the three non-`code` packages,
//      dependencies first (the base ahead of its pair and of the package that
//      extends it), the pair carrying its namespace, its base edge and its
//      override; the showcase's own `code` package is not in it;
//   2. source: the connector is exported with its `credentialRef` and without
//      the secret it resolves to;
//   3. target: each entry installs 200, in the order served;
//   4. target: the target's own bundle answers the same packages, in the same
//      order, with the same namespace, dependencies, and the same item names
//      and counts per collection.
//
// [#29903] …and the pair's object extension travels once: the pair publishes an
// extension of the base's object (a `__c` field and a relabelled base field).
// The base's entry carries the object as the base declares it, the pair's
// entry carries the extension as its `objectExtensions`, and on the target the
// served object has the field once, from the pair, with the pair's label.
//
// [#29871] A second describe pins the bundle's "enabled or not" for a
// DISABLED package: a runtime-authored package (`POST /packages`, an object
// drafted into it and published) is disabled before the export; the bundle
// and its per-package export still carry the object, and a fresh runtime that
// installs the entry serves it (`GET /meta/object/<name>` 200), where before
// the entry was an empty package and the object came back 404.
//
// Boots fixture stacks of its own (the install-local plugin mounted on both),
// so it stays out of `SHARED_SHOWCASE`. Every credential below is an
// obviously-fake placeholder, and every assertion on one is its absence.

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { type VerifyStack } from '@objectstack/verify';
import { MarketplaceInstallLocalPlugin } from '@objectstack/cloud-connection';
import { PackageExportBundleSchema } from '@objectstack/spec/api';
import { bootShowcase } from './showcase-boot.js';
import { declaredOverride, ensurePair, inPair, pairOf } from './customization-pair.js';

const ROUTE = '/marketplace/install-local';
const HOST = 'com.example.showcase';
const BASE = 'com.dogfood.exportbase';
const PAIR = pairOf(BASE);
const EXT = 'com.dogfood.exportext';
const OBJECT = 'exportbase_account';
const DASHBOARD = 'exportbase_pulse';
const EDITED = 'Pulse (customized)';
const CONNECTOR = 'exportbase_erp';
/** [#29903] The pair's extension of the base's object, as Studio's Customize writes it. */
const REGION = 'region__c';
const TITLE_EDITED = 'Title (customized)';
const EXTENSION = { extend: OBJECT, fields: { [REGION]: { type: 'text', label: 'Region' } }, fieldPatches: { title: { label: TITLE_EDITED } } };
/** The reference the connector names, and the fake secret it resolves to on the source runtime. */
const CREDENTIAL_REF = 'EXPORTBASE_ERP_TOKEN';
const SECRET = 'TEST_PLACEHOLDER_EXPORT_BUNDLE_SECRET';

/** The install body `os package install` sends for an inline manifest. */
const BASE_INSTALL = {
  manifest: {
    id: BASE,
    namespace: 'exportbase',
    name: 'Export bundle base',
    version: '1.0.0',
    type: 'app',
    objects: [{ name: OBJECT, label: 'Account', fields: { title: { type: 'text', label: 'Title' } } }],
    apps: [{ name: 'exportbase_app', label: 'Export base', navigation: [{ id: 'nav_account', type: 'object', label: 'Accounts', objectName: OBJECT }] }],
    dashboards: [{ name: DASHBOARD, label: 'Pulse', columns: 12, widgets: [] }],
    flows: [{
      name: 'exportbase_probe',
      label: 'Export base probe',
      type: 'autolaunched',
      status: 'active',
      nodes: [{ id: 'start', type: 'start', label: 'Start' }, { id: 'end', type: 'end', label: 'End' }],
      edges: [{ id: 'e1', source: 'start', target: 'end' }],
    }],
    permissions: [{ name: 'exportbase_reader', label: 'Export base reader', objects: { [OBJECT]: { allowRead: true } } }],
    connectors: [{
      name: CONNECTOR,
      label: 'ERP',
      type: 'api',
      provider: 'rest',
      providerConfig: { baseUrl: 'http://127.0.0.1:9/' },
      auth: { type: 'bearer', credentialRef: CREDENTIAL_REF },
    }],
  },
};

/** A third package that depends on the base and extends its object. */
const EXT_INSTALL = {
  manifest: {
    id: EXT,
    namespace: 'exportext',
    name: 'Export bundle extension',
    version: '1.0.0',
    type: 'app',
    dependencies: { [BASE]: '^1' },
    objectExtensions: [{ extend: OBJECT, fields: { exportext_code: { type: 'text', label: 'Billing code' } } }],
    flows: [{
      name: 'exportext_probe',
      label: 'Export extension probe',
      type: 'autolaunched',
      status: 'active',
      nodes: [{ id: 'start', type: 'start', label: 'Start' }, { id: 'end', type: 'end', label: 'End' }],
      edges: [{ id: 'e1', source: 'start', target: 'end' }],
    }],
  },
};

type Answer = { status: number; body: any };

async function call(stack: VerifyStack, token: string, method: string, path: string, body?: unknown): Promise<Answer> {
  const res = await stack.apiAs(token, method, path, body);
  return { status: res.status, body: await res.json().catch(() => null) };
}

/** One entry's identity and, per collection, its item names (sorted): what "the same names and counts" compares. */
function inventory(entry: Record<string, any>): Record<string, unknown> {
  const out: Record<string, unknown> = { id: entry.id, namespace: entry.namespace, dependencies: entry.dependencies ?? null };
  for (const [key, value] of Object.entries(entry)) {
    if (!Array.isArray(value)) continue;
    out[key] = value.map((item: any) => String(item?.name ?? item?.extend ?? '?')).sort();
  }
  return out;
}

const ids = (bundle: any): string[] => (bundle?.packages ?? []).map((p: any) => p.id);

describe('dogfood: the whole-deployment export round-trips onto a fresh runtime, and carries no secret', () => {
  let previousRef: string | undefined;
  const dirs: string[] = [];
  const answers: Record<string, Answer> = {};
  let sourceBundle: any;
  let sourceText = '';
  const installs: Array<{ id: string; answer: Answer }> = [];
  let targetBundle: any;

  beforeAll(async () => {
    previousRef = process.env[CREDENTIAL_REF];
    process.env[CREDENTIAL_REF] = SECRET;

    const sourceDir = mkdtempSync(join(tmpdir(), 'dogfood-export-bundle-source-'));
    dirs.push(sourceDir);
    const source = await bootShowcase({
      extraPlugins: [new MarketplaceInstallLocalPlugin({ controlPlaneUrl: 'off', storageDir: sourceDir })],
    });
    try {
      const token = await source.signIn();
      answers.base = await call(source, token, 'POST', ROUTE, BASE_INSTALL);
      answers.ext = await call(source, token, 'POST', ROUTE, EXT_INSTALL);
      await ensurePair(source, token, BASE);
      answers.saved = await call(source, token, 'PUT', inPair(`/meta/dashboard/${DASHBOARD}?mode=draft`, BASE),
        declaredOverride({ name: DASHBOARD, label: EDITED, columns: 12, widgets: [] }, BASE, '1.0.0'));
      answers.extended = await call(source, token, 'PUT', inPair(`/meta/object_extension/${OBJECT}?mode=draft`, BASE), EXTENSION);
      answers.published = await call(source, token, 'POST', `/packages/${PAIR}/publish-drafts`, {});
      answers.sourceServed = await call(source, token, 'GET', `/meta/object/${OBJECT}`);
      const res = await source.apiAs(token, 'GET', '/packages/export');
      sourceText = await res.text();
      answers.sourceExport = { status: res.status, body: JSON.parse(sourceText) };
      sourceBundle = answers.sourceExport.body?.data;
    } finally {
      await source.stop();
    }

    const targetDir = mkdtempSync(join(tmpdir(), 'dogfood-export-bundle-target-'));
    dirs.push(targetDir);
    const target = await bootShowcase({
      extraPlugins: [new MarketplaceInstallLocalPlugin({ controlPlaneUrl: 'off', storageDir: targetDir })],
    });
    try {
      const token = await target.signIn();
      for (const entry of sourceBundle?.packages ?? []) {
        installs.push({ id: entry.id, answer: await call(target, token, 'POST', ROUTE, { manifest: entry }) });
      }
      answers.targetServed = await call(target, token, 'GET', `/meta/object/${OBJECT}`);
      answers.targetExport = await call(target, token, 'GET', '/packages/export');
      targetBundle = answers.targetExport.body?.data;
    } finally {
      await target.stop();
    }
  }, 900_000);

  afterAll(() => {
    if (previousRef === undefined) delete process.env[CREDENTIAL_REF];
    else process.env[CREDENTIAL_REF] = previousRef;
    for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
  });

  it('source: the three packages install and the pair\'s override publishes (preconditions)', () => {
    for (const key of ['base', 'ext', 'saved', 'extended', 'published'] as const) {
      expect(answers[key]?.status, `${key}: ${JSON.stringify(answers[key]?.body)}`).toBe(200);
    }
  });

  it('source: the bundle is exactly the three non-`code` packages, dependencies first, and parses as declared', () => {
    expect(answers.sourceExport.status, sourceText.slice(0, 400)).toBe(200);
    expect(PackageExportBundleSchema.safeParse(sourceBundle).success).toBe(true);
    const order = ids(sourceBundle);
    expect([...order].sort()).toEqual([BASE, PAIR, EXT].sort());
    expect(order).not.toContain(HOST);
    expect(order[0]).toBe(BASE);
    const pair = sourceBundle.packages.find((p: any) => p.id === PAIR);
    expect(pair?.namespace).toBe('exportbase_custom');
    expect(Object.keys(pair?.dependencies ?? {})).toEqual([BASE]);
    expect((pair?.dashboards ?? []).map((d: any) => [d.name, d.label, d.overrides?.package])).toEqual([[DASHBOARD, EDITED, BASE]]);
    const base = sourceBundle.packages.find((p: any) => p.id === BASE);
    expect((base?.dashboards ?? []).map((d: any) => [d.name, d.label])).toEqual([[DASHBOARD, 'Pulse']]);
  });

  it('[#29903] source: the base\'s entry carries its object without the pair\'s extension, the pair\'s entry carries the extension', () => {
    // CONTROL: the served object folds the extension in.
    const served = answers.sourceServed.body?.data?.item ?? answers.sourceServed.body?.data;
    expect(answers.sourceServed.status, JSON.stringify(answers.sourceServed.body)).toBe(200);
    expect(Object.keys(served?.fields ?? {})).toContain(REGION);
    expect(served?.fields?.title?.label).toBe(TITLE_EDITED);

    const base = sourceBundle.packages.find((p: any) => p.id === BASE);
    const object = (base?.objects ?? []).find((o: any) => o?.name === OBJECT);
    expect(Object.keys(object?.fields ?? {}), JSON.stringify(object)).not.toContain(REGION);
    expect(object?.fields?.title?.label).toBe('Title');
    expect(base?.objectExtensions).toBeUndefined();
    const pair = sourceBundle.packages.find((p: any) => p.id === PAIR);
    expect(pair?.objects).toBeUndefined();
    expect(pair?.objectExtensions).toEqual([EXTENSION]);
  });

  it('source: the connector travels with its `credentialRef`, and the secret it resolves to appears nowhere', () => {
    const base = sourceBundle.packages.find((p: any) => p.id === BASE);
    const connector = (base?.connectors ?? []).find((c: any) => c?.name === CONNECTOR);
    expect(connector, JSON.stringify(base?.connectors)).toBeDefined();
    expect(connector.auth?.credentialRef).toBe(CREDENTIAL_REF);
    // CONTROL: the reference resolves to the secret on the source runtime.
    expect(process.env[CREDENTIAL_REF]).toBe(SECRET);
    expect(sourceText.includes(SECRET)).toBe(false);
  });

  it('target: every entry installs, in the order served', () => {
    expect(installs.map((i) => i.id)).toEqual(ids(sourceBundle));
    for (const { id, answer } of installs) {
      expect(answer.status, `${id}: ${JSON.stringify(answer.body)}`).toBe(200);
      expect(answer.body?.data?.manifestId).toBe(id);
    }
  });

  it('target: the same packages come back, in the same order, with the same names and counts', () => {
    expect(answers.targetExport.status, JSON.stringify(answers.targetExport.body)).toBe(200);
    expect(ids(targetBundle)).toEqual(ids(sourceBundle));
    expect(targetBundle.packages.map(inventory)).toEqual(sourceBundle.packages.map(inventory));
    const pair = targetBundle.packages.find((p: any) => p.id === PAIR);
    expect((pair?.dashboards ?? []).map((d: any) => [d.name, d.label, d.overrides?.package])).toEqual([[DASHBOARD, EDITED, BASE]]);
  });

  it('[#29903] target: the field is declared once, by the pair, and the served object carries it with the pair\'s label', () => {
    expect(answers.targetServed.status, JSON.stringify(answers.targetServed.body)).toBe(200);
    const served = answers.targetServed.body?.data?.item ?? answers.targetServed.body?.data;
    expect(Object.keys(served?.fields ?? {})).toContain(REGION);
    expect(served?.fields?.title?.label).toBe(TITLE_EDITED);
    const declaring = (targetBundle?.packages ?? []).flatMap((p: any) => [
      ...(p.objects ?? []).filter((o: any) => o?.fields?.[REGION]).map(() => `${p.id}:objects`),
      ...(p.objectExtensions ?? []).filter((e: any) => e?.fields?.[REGION]).map(() => `${p.id}:objectExtensions`),
    ]);
    expect(declaring).toEqual([`${PAIR}:objectExtensions`]);
  });
});

const OFF = 'com.dogfood.exportoff';
const OFF_OBJECT = 'exportoff_note';

describe('dogfood: a disabled package exports its items, and a fresh runtime that installs the entry serves them', () => {
  const dirs: string[] = [];
  const answers: Record<string, Answer> = {};
  let offEntry: any;
  let previousHome: string | undefined;

  beforeAll(async () => {
    // Each runtime gets its own home: a disable is persisted there
    // (`package-state/`) and replayed at boot, so a shared home would carry
    // the source's disable onto the target, which no fresh runtime has.
    previousHome = process.env.OS_HOME;
    const sourceDir = mkdtempSync(join(tmpdir(), 'dogfood-export-disabled-source-'));
    dirs.push(sourceDir);
    process.env.OS_HOME = join(sourceDir, 'home');
    const source = await bootShowcase({
      extraPlugins: [new MarketplaceInstallLocalPlugin({ controlPlaneUrl: 'off', storageDir: sourceDir })],
    });
    try {
      const token = await source.signIn();
      answers.created = await call(source, token, 'POST', '/packages', {
        manifest: { id: OFF, name: 'Export disabled', version: '0.1.0', type: 'app', namespace: 'exportoff' },
      });
      answers.saved = await call(source, token, 'PUT', `/meta/object/${OFF_OBJECT}?mode=draft&package=${OFF}`, {
        name: OFF_OBJECT, label: 'Note', sharingModel: 'private', fields: { body: { type: 'text', label: 'Body' } },
      });
      answers.published = await call(source, token, 'POST', `/packages/${OFF}/publish-drafts`, {});
      answers.enabledExport = await call(source, token, 'GET', `/packages/${OFF}/export`);
      answers.disabled = await call(source, token, 'PATCH', `/packages/${OFF}/disable`);
      answers.servedAfterDisable = await call(source, token, 'GET', `/meta/object/${OFF_OBJECT}`);
      answers.disabledExport = await call(source, token, 'GET', `/packages/${OFF}/export`);
      answers.bundle = await call(source, token, 'GET', '/packages/export');
      offEntry = (answers.bundle.body?.data?.packages ?? []).find((p: any) => p?.id === OFF);
    } finally {
      await source.stop();
    }

    const targetDir = mkdtempSync(join(tmpdir(), 'dogfood-export-disabled-target-'));
    dirs.push(targetDir);
    process.env.OS_HOME = join(targetDir, 'home');
    const target = await bootShowcase({
      extraPlugins: [new MarketplaceInstallLocalPlugin({ controlPlaneUrl: 'off', storageDir: targetDir })],
    });
    try {
      const token = await target.signIn();
      answers.installed = await call(target, token, 'POST', ROUTE, { manifest: offEntry });
      answers.targetServed = await call(target, token, 'GET', `/meta/object/${OFF_OBJECT}`);
    } finally {
      await target.stop();
    }
  }, 900_000);

  afterAll(() => {
    if (previousHome === undefined) delete process.env.OS_HOME;
    else process.env.OS_HOME = previousHome;
    for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
  });

  const objectsOf = (manifest: any): string[] => (manifest?.objects ?? []).map((o: any) => o?.name);

  it('source: the package is created, its object published, and the disable lands (preconditions)', () => {
    for (const key of ['created', 'saved', 'published', 'disabled'] as const) {
      expect(answers[key]?.status, `${key}: ${JSON.stringify(answers[key]?.body)}`).toBeLessThan(300);
    }
    expect(answers.disabled.body?.data?.enabled).toBe(false);
    // CONTROL: enabled, the export carries the object; disabled, the served read hides it.
    expect(objectsOf(answers.enabledExport.body?.data)).toEqual([OFF_OBJECT]);
    expect(answers.servedAfterDisable.status).toBe(404);
  });

  it('source: the disabled package\'s export and its bundle entry still carry its object', () => {
    expect(answers.disabledExport.status, JSON.stringify(answers.disabledExport.body)).toBe(200);
    expect(answers.disabledExport.body?.data).toEqual(answers.enabledExport.body?.data);
    expect(answers.bundle.status, JSON.stringify(answers.bundle.body)).toBe(200);
    expect(PackageExportBundleSchema.safeParse(answers.bundle.body?.data).success).toBe(true);
    expect(objectsOf(offEntry), JSON.stringify(offEntry)).toEqual([OFF_OBJECT]);
  });

  it('target: the entry installs, and the object is served', () => {
    expect(answers.installed.status, JSON.stringify(answers.installed.body)).toBe(200);
    expect(answers.installed.body?.data?.manifestId).toBe(OFF);
    expect(answers.targetServed.status, JSON.stringify(answers.targetServed.body)).toBe(200);
  });
});
