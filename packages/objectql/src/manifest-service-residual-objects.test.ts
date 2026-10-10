// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * ADR-0130 D4 — the engine's `manifest` service registers the OBJECTS of a
 * multi-package stack's residual: top-level objects no package body declares,
 * under the id the residual rule names (`unclaimedTopLevel`,
 * `@objectstack/metadata`).
 *
 * ## The defect these pin
 *
 * The metadata door registers a stack's residual under the stack's own
 * `manifest.id` and the boot warns that every door will report that id as
 * the items' owner. The `manifest` service read the package BODIES only
 * (`resolveArtifactPackageOrder` answers `packages[]` when the key is
 * present), so a residual object never reached the SchemaRegistry: listed by
 * `GET /meta/object`, `404` on `/data/<name>`, through both boot doors. The
 * two-boot reading is `packages/cli/test/serve-config-boot-residual.integration.test.ts`
 * (row 4); these pins hold the engine half on a kernel.
 *
 * ## What the shape of each pin is for
 *
 *  - The residual object is RESOLVED by the registry and OWNED by the stack's
 *    manifest id — what the data door reads.
 *  - CONTROL: the bodies' objects keep their own owners, and no package record
 *    appears for the residual's id. The residual is not a package; when its id
 *    names a body (a composed stack keeps one member's manifest) that body's
 *    record must stay the body's.
 *  - A late artifact (after `start()`) reaches the metadata service too, and is
 *    judged against the sealed picklist vocabulary like a body.
 *
 * Payloads are handed over the way `AppPlugin` hands them:
 * `{ ...bundle.manifest, ...bundle }`.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { ObjectKernel } from '@objectstack/core';
import type { IMetadataService } from '@objectstack/spec/contracts';
import { ObjectQLPlugin } from './plugin.js';
import type { ObjectQL } from './engine.js';

type ManifestService = { register(m: unknown): void | Promise<void> };

const engineOf = (kernel: ObjectKernel): ObjectQL => kernel.getService<ObjectQL>('objectql');

const APP_ID = 'com.example.acme';
const SERVICE_ID = 'com.example.acme.service';
const RELEASE_ID = 'com.example.acme.release';

const caseObj = () => ({ name: 'acme_case', label: 'Case', sharingModel: 'private', fields: { subject: { type: 'text', label: 'Subject' } } });
const accountObj = () => ({ name: 'acme_account', label: 'Account', sharingModel: 'private', fields: { name: { type: 'text', label: 'Name' } } });
const noteObj = (fields: Record<string, unknown> = { title: { type: 'text', label: 'Title' } }) =>
  ({ name: 'acme_note', label: 'Note', sharingModel: 'private', fields });
const svc = { id: SERVICE_ID, name: 'service', namespace: 'acme', version: '2.4.0', type: 'module' };
const app = { id: APP_ID, name: 'acme', namespace: 'acme', version: '1.0.0', type: 'app' };

/** What `AppPlugin.init` hands the `manifest` service. */
const payload = (bundle: Record<string, unknown>) => ({ ...(bundle.manifest as object), ...bundle });

/** Two packages, a `manifest.id` naming neither, and a top-level `acme_note` no body declares. */
const residualStack = (note = noteObj()) => payload({
  manifest: { ...app, id: RELEASE_ID },
  objects: [caseObj(), accountObj(), note],
  packages: [
    { manifest: { ...svc, objects: [caseObj()] } },
    { manifest: { ...app, objects: [accountObj()] } },
  ],
});

const owners = (ql: ObjectQL): Record<string, string | undefined> =>
  Object.fromEntries(
    ['acme_account', 'acme_case', 'acme_note'].map((name) => [name, ql.registry.getObjectOwner(name)?.packageId]),
  );

const acmePackageIds = (ql: ObjectQL): string[] =>
  ql.registry
    .getAllPackages()
    .map((p) => p.manifest?.id)
    .filter((id: unknown): id is string => typeof id === 'string' && id.startsWith('com.example.'));

let kernel: ObjectKernel | undefined;

async function bootKernel(): Promise<ObjectKernel> {
  kernel = new ObjectKernel({ logger: { level: 'silent' }, gracefulShutdown: false });
  await kernel.use(new ObjectQLPlugin());
  await kernel.bootstrap();
  return kernel;
}

afterEach(async () => {
  if (kernel && kernel.getState() === 'running') await kernel.shutdown();
  kernel = undefined;
});

describe('ADR-0130 D4 — the manifest service registers the residual\'s objects', () => {
  it('registers a residual object under the stack\'s manifest id, beside the bodies\' own', async () => {
    const k = await bootKernel();
    await (k.getService('manifest') as ManifestService).register(residualStack());
    const ql = engineOf(k);

    // Before: `acme_note` resolved to nothing — the data door's 404.
    expect(ql.registry.resolveObject('acme_note')?.fields?.title).toBeDefined();
    expect(owners(ql)).toEqual({
      acme_account: APP_ID,
      acme_case: SERVICE_ID,
      acme_note: RELEASE_ID,
    });
    expect((ql.registry.resolveObject('acme_note') as { _packageId?: string } | undefined)?._packageId).toBe(RELEASE_ID);
  });

  it('installs no package record for the residual\'s id — the residual is not a package', async () => {
    const k = await bootKernel();
    await (k.getService('manifest') as ManifestService).register(residualStack());
    expect(acmePackageIds(engineOf(k)).sort()).toEqual([APP_ID, SERVICE_ID]);
  });

  it('a composed stack whose manifest names a body: the residual takes that id, and the body keeps its own record', async () => {
    const k = await bootKernel();
    await (k.getService('manifest') as ManifestService).register(payload({
      manifest: app,
      objects: [caseObj(), accountObj(), noteObj()],
      packages: [
        { manifest: { ...svc, objects: [caseObj()] } },
        { manifest: { ...app, objects: [accountObj()] } },
      ],
    }));
    const ql = engineOf(k);

    expect(owners(ql)).toEqual({ acme_account: APP_ID, acme_case: SERVICE_ID, acme_note: APP_ID });
    // The app body's record is the app body, not the residual: its own
    // objects, still exactly one.
    const record = ql.registry.getAllPackages().find((p) => p.manifest?.id === APP_ID);
    expect((record?.manifest as { objects?: Array<{ name?: string }> } | undefined)?.objects?.map((o) => o.name))
      .toEqual(['acme_account']);
  });

  it('CONTROL: a normally composed stack (the top level repeats every body) registers nothing beyond the bodies', async () => {
    const k = await bootKernel();
    await (k.getService('manifest') as ManifestService).register(payload({
      manifest: { ...app, id: RELEASE_ID },
      objects: [caseObj(), accountObj()],
      packages: [
        { manifest: { ...svc, objects: [caseObj()] } },
        { manifest: { ...app, objects: [accountObj()] } },
      ],
    }));
    const ql = engineOf(k);
    expect(owners(ql)).toEqual({ acme_account: APP_ID, acme_case: SERVICE_ID, acme_note: undefined });
    expect(acmePackageIds(ql).sort()).toEqual([APP_ID, SERVICE_ID]);
  });

  it('`packages: []` beside a top-level object registers the object under the manifest id', async () => {
    const k = await bootKernel();
    await (k.getService('manifest') as ManifestService).register(payload({
      manifest: { ...app, id: RELEASE_ID },
      objects: [noteObj()],
      packages: [],
    }));
    const ql = engineOf(k);
    expect(ql.registry.getObjectOwner('acme_note')?.packageId).toBe(RELEASE_ID);
    expect(acmePackageIds(ql)).toEqual([]);
  });
});

describe('ADR-0130 D4 — a residual arriving after start()', () => {
  it('reaches the metadata service under the stack\'s manifest id, as a body\'s objects do', async () => {
    const k = await bootKernel();
    await (k.getService('manifest') as ManifestService).register(residualStack());

    const metadata = k.getService<IMetadataService>('metadata');
    const bridged = await metadata.getObject('acme_note') as { _packageId?: string } | undefined;
    expect(bridged?._packageId).toBe(RELEASE_ID);
  });

  it('is judged against the sealed picklist vocabulary like a body, and a refusal registers nothing', async () => {
    const k = await bootKernel();
    const note = noteObj({ status: { type: 'select', label: 'Status', picklist: 'acme_no_such_list' } });

    let caught: (Error & { code?: string; status?: number }) | undefined;
    try {
      await (k.getService('manifest') as ManifestService).register(residualStack(note));
    } catch (e) {
      caught = e as Error & { code?: string; status?: number };
    }

    expect(caught?.code).toBe('INVALID_METADATA');
    expect(caught?.status).toBe(422);
    expect(caught?.message).toContain('acme_no_such_list');
    const ql = engineOf(k);
    expect(owners(ql)).toEqual({ acme_account: undefined, acme_case: undefined, acme_note: undefined });
  });
});
