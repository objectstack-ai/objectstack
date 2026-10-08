// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// Real-engine door pins for #22090 — `POST /packages/:id/revert` on a
// Studio-authored package answered 404 "No metadata items found" while the
// package held a published item and a pending draft.

import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { MetadataManager } from '@objectstack/metadata';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
import {
  SysMetadataObject,
  SysMetadataHistoryObject,
  SysMetadataAuditObject,
  SysMetadataCommitObject,
} from '@objectstack/metadata-core';
import { DEFAULT_METADATA_TYPE_REGISTRY } from '@objectstack/spec/kernel';
import { HttpDispatcher } from './http-dispatcher.js';
import {
  captureExpectedReadRefusals,
  type ExpectedReadRefusalCapture,
} from './expected-read-refusal-noise.js';

/**
 * ## The defect, measured at the door
 *
 * On a `objectstack dev` boot of `examples/app-showcase` at the base of this
 * change, a package created through `POST /api/v1/packages`, with one view
 * draft-saved under `?package=`, published through `publish-drafts`, and then
 * draft-edited once, answered `POST /api/v1/packages/:id/revert` with
 * `404 RESOURCE_NOT_FOUND "No metadata items found for package '…'"`, and the
 * draft stayed. The same package, published and with no draft, answered the
 * same 404.
 *
 * The route asked only the metadata service, and `MetadataManager.revertPackage`
 * collects members from its in-memory registry by an item's own `packageId` /
 * `package` key. A Studio package is `sys_metadata` rows bound by `package_id`,
 * which that registry never holds. The route now asks the protocol first
 * (`revertStoredPackage`), and the metadata service only for a package with no
 * stored row.
 *
 * ## Why a REAL engine, a REAL driver and a REAL metadata service
 *
 * The answer is a composition of two services and two storage models: the
 * stored half depends on what `sys_metadata` really holds after a real
 * draft-save and a real `publishPackageDrafts`, and the code-shipped control
 * depends on what the real `MetadataManager` does with its own registry. A
 * double of either would pin the double. It lives in `packages/runtime`
 * because the door does, and because `metadata-protocol` cannot import
 * `objectql` (dependency cycle) — the same reason its sibling
 * `package-revert-commit-org-scope.integration.test.ts` lives here.
 */

/** A Studio-authored, writable package. */
const STUDIO_PKG = 'com.example.repairs';
/** A Studio package that was never published. */
const DRAFT_ONLY_PKG = 'com.example.repairs_draft_only';
/**
 * The code-shipped control. `examples/app-showcase` ships this package id, and
 * its two capabilities (`src/security/capabilities.ts`) are authored with
 * `packageId: 'com.example.showcase'`. [#22113] A live boot of the showcase now
 * answers its revert with `422 WRITABLE_PACKAGE_REQUIRED` (ADR-0070 D2: a
 * booted package is read-only); the cases below boot it the same way. The two
 * items are restated here as a literal, not imported: importing the example
 * would make this test read outside its package.
 */
const SHOWCASE_PKG = 'com.example.showcase';
const SHOWCASE_CAPABILITIES = [
  { name: 'showcase.export_data', label: 'Export Showcase Data', scope: 'org', packageId: SHOWCASE_PKG },
  { name: 'showcase.restricted_ops', label: 'Restricted Showcase Operations', scope: 'org', packageId: SHOWCASE_PKG },
];
const PLATFORM_PKG = '@objectstack/platform-objects';
const ACTIVE_ORG = 'org_active';
const OTHER_ORG = 'org_other';

/**
 * Every publish this fixture makes runs the metadata-protocol build probes, and
 * the views it publishes are bound to the placeholder object `anything`, which
 * nothing here creates — the sibling suite's arrangement and its reason
 * (`package-revert-commit-org-scope.integration.test.ts`). The engine refuses a
 * name its registry does not hold before any driver, so nothing is withheld;
 * the capture stays declared and asserts that.
 */
const UNBOUND_PROBE_OBJECT = 'anything';

let cleanup: Array<() => void> = [];
let noise: ExpectedReadRefusalCapture | null = null;
afterEach(() => {
  for (const c of cleanup) c();
  cleanup = [];
  expect(noise?.tablesSeen() ?? ['no capture was installed']).toEqual([]);
  noise = null;
});

/** REAL ObjectQL over on-disk better-sqlite3, the REAL protocol, the REAL metadata service, one door. */
async function boot() {
  const dir = mkdtempSync(join(tmpdir(), 'os-22090-'));
  cleanup.push(() => rmSync(dir, { recursive: true, force: true }));

  const driver = new SqlDriver({
    client: 'better-sqlite3',
    connection: { filename: join(dir, 'data.sqlite') },
    useNullAsDefault: true,
  });
  const objects = [
    SysMetadataObject,
    SysMetadataHistoryObject,
    SysMetadataAuditObject,
    SysMetadataCommitObject,
  ] as any[];
  noise = captureExpectedReadRefusals([UNBOUND_PROBE_OBJECT]);
  noise.captureDriver(driver);
  await driver.initObjects(objects);

  const engine = new ObjectQL();
  noise.captureEngine(engine);
  engine.registerDriver(driver as any, true);
  await engine.init();
  for (const o of objects) engine.registry.registerObject(o, PLATFORM_PKG);
  cleanup.push(() => { void engine.destroy(); });

  // `'package-author'` — the control-plane channel, as the sibling suite: the
  // runtime authoring gate would otherwise refuse the seeding saves.
  const protocol = new ObjectStackProtocolImplementation(
    engine as any, undefined, undefined, 'package-author',
  );

  const metadata = new MetadataManager({ formats: ['json'] });
  metadata.setTypeRegistry(DEFAULT_METADATA_TYPE_REGISTRY);

  const services: Record<string, unknown> = { protocol, objectql: engine, metadata };
  const get = (name: string) => services[name] ?? null;
  const kernel: any = { context: { getService: get }, getService: get, getServiceAsync: async (n: string) => get(n) };
  const dispatcher = new HttpDispatcher(kernel);

  /** `POST /packages/:id/revert`, as a caller holding `manage_metadata`. */
  const revert = async (packageId: string, organizationId?: string) => {
    const context = {
      request: {},
      executionContext: {
        userId: 'u_pkg_admin',
        systemPermissions: ['manage_metadata', 'studio.access'],
        ...(organizationId ? { tenantId: organizationId } : {}),
      },
    } as any;
    const result = await dispatcher.handlePackages(`/${encodeURIComponent(packageId)}/revert`, 'POST', {}, {}, context);
    expect(result.handled).toBe(true);
    return { status: result.response?.status, body: result.response?.body };
  };

  return { engine, protocol: protocol as any, metadata, revert };
}

const viewBody = (name: string, label: string) => ({
  name,
  label,
  type: 'grid',
  object: 'anything', // the inline arm requires the object binding pair
  viewKind: 'list',
  data: { provider: 'object', object: 'anything' },
  columns: ['id'],
});

async function draftSave(
  protocol: any,
  args: { view: string; label: string; packageId: string; organizationId?: string },
): Promise<void> {
  await protocol.saveMetaItem({
    type: 'view',
    name: args.view,
    item: viewBody(args.view, args.label),
    packageId: args.packageId,
    mode: 'draft',
    ...(args.organizationId ? { organizationId: args.organizationId } : {}),
  });
}

async function publish(protocol: any, packageId: string): Promise<void> {
  const res = await protocol.publishPackageDrafts({ packageId });
  expect(res.success).toBe(true);
}

async function draftNames(protocol: any, packageId: string, organizationId?: string): Promise<string[]> {
  const { drafts } = await protocol.listDrafts({ packageId, ...(organizationId ? { organizationId } : {}) });
  return drafts.map((d: any) => `${d.type}/${d.name}`).sort();
}

async function servedLabel(protocol: any, view: string): Promise<unknown> {
  const res = await protocol.getMetaItem({ type: 'view', name: view });
  return (res?.item as any)?.label;
}

describe('#22090 POST /packages/:id/revert on a Studio-authored package', () => {
  it('(a) a published package with one draft: 200, the draft is gone, the published version serves (was: 404)', async () => {
    const { protocol, revert } = await boot();
    await draftSave(protocol, { view: 'repairs_board', label: 'Board v1', packageId: STUDIO_PKG });
    await publish(protocol, STUDIO_PKG);
    await draftSave(protocol, { view: 'repairs_board', label: 'Board v2 (draft)', packageId: STUDIO_PKG });
    expect(await draftNames(protocol, STUDIO_PKG)).toEqual(['view/repairs_board']);

    const answer = await revert(STUDIO_PKG);

    expect(answer.status).toBe(200);
    expect(answer.body).toMatchObject({ success: true, data: { success: true } });
    expect(await draftNames(protocol, STUDIO_PKG)).toEqual([]);
    expect(await servedLabel(protocol, 'repairs_board')).toBe('Board v1');
  });

  it('(a) an item created after the last publish is a draft with no published version, and the revert removes it', async () => {
    const { protocol, revert } = await boot();
    await draftSave(protocol, { view: 'repairs_board', label: 'Board v1', packageId: STUDIO_PKG });
    await publish(protocol, STUDIO_PKG);
    await draftSave(protocol, { view: 'repairs_new_board', label: 'New after publish', packageId: STUDIO_PKG });

    const answer = await revert(STUDIO_PKG);

    expect(answer.status).toBe(200);
    expect(await draftNames(protocol, STUDIO_PKG)).toEqual([]);
    expect(await servedLabel(protocol, 'repairs_board')).toBe('Board v1');
  });

  it('a published package with no draft is already at its published version: 200 (was: 404)', async () => {
    const { protocol, revert } = await boot();
    await draftSave(protocol, { view: 'repairs_board', label: 'Board v1', packageId: STUDIO_PKG });
    await publish(protocol, STUDIO_PKG);

    const answer = await revert(STUDIO_PKG);

    expect(answer.status).toBe(200);
    expect(await servedLabel(protocol, 'repairs_board')).toBe('Board v1');
  });

  it('(b) a never-published package: 409 RESOURCE_CONFLICT naming the package, and its draft is untouched', async () => {
    const { protocol, revert } = await boot();
    await draftSave(protocol, { view: 'draft_only_board', label: 'Never published', packageId: DRAFT_ONLY_PKG });

    const answer = await revert(DRAFT_ONLY_PKG);

    expect(answer.status).toBe(409);
    expect(answer.body?.error?.code).toBe('RESOURCE_CONFLICT');
    expect(String(answer.body?.error?.message)).toMatch(
      new RegExp(`^Package '${DRAFT_ONLY_PKG.replace(/\./g, '\\.')}' has never been published`),
    );
    expect(await draftNames(protocol, DRAFT_ONLY_PKG)).toEqual(['view/draft_only_board']);
  });

  it('an org-scoped caller reverts the env-wide draft a Studio save writes, in the scope the draft lives in', async () => {
    const { protocol, revert } = await boot();
    await draftSave(protocol, { view: 'repairs_board', label: 'Board v1', packageId: STUDIO_PKG });
    await publish(protocol, STUDIO_PKG);
    await draftSave(protocol, { view: 'repairs_board', label: 'Board v2 (draft)', packageId: STUDIO_PKG });

    const answer = await revert(STUDIO_PKG, ACTIVE_ORG);

    expect(answer.status).toBe(200);
    expect(await draftNames(protocol, STUDIO_PKG)).toEqual([]);
  });

  it('another organization’s draft of the package is neither read nor discarded', async () => {
    const { protocol, revert } = await boot();
    await draftSave(protocol, { view: 'repairs_board', label: 'Board v1', packageId: STUDIO_PKG });
    await publish(protocol, STUDIO_PKG);
    await draftSave(protocol, {
      view: 'repairs_board', label: 'Other org overlay (draft)', packageId: STUDIO_PKG, organizationId: OTHER_ORG,
    });

    const answer = await revert(STUDIO_PKG, ACTIVE_ORG);

    expect(answer.status).toBe(200);
    expect(await draftNames(protocol, STUDIO_PKG, OTHER_ORG)).toEqual(['view/repairs_board']);
  });
});

describe('#22090 controls — a package with no stored row is not the protocol’s', () => {
  it('(c) an unknown package id: 404 RESOURCE_NOT_FOUND, the metadata service’s own answer', async () => {
    const { revert } = await boot();

    const answer = await revert('com.example.no_such_package');

    expect(answer.status).toBe(404);
    expect(answer.body?.error?.code).toBe('RESOURCE_NOT_FOUND');
    expect(answer.body?.error?.message).toBe("No metadata items found for package 'com.example.no_such_package'");
  });

  // [#22113] FLIPPED. Both cases boot the showcase as the dev boot does (its
  // manifest in the engine), which makes it a read-only code package (ADR-0070
  // D2). With no stored row, the door now refuses it after the protocol's
  // answer, with `422 WRITABLE_PACKAGE_REQUIRED`, instead of handing it to the
  // metadata service (which answered 409 "has never been published", and 200
  // once a publish had snapshotted the capabilities). A writable package's
  // metadata-service revert is held in `package-revert-code-shipped-members.integration.test.ts`.
  it('(d) the code-shipped com.example.showcase, never published: 422 WRITABLE_PACKAGE_REQUIRED (was: 409)', async () => {
    const { engine, metadata, revert } = await boot();
    for (const cap of SHOWCASE_CAPABILITIES) await metadata.register('capability', cap.name, { ...cap });
    engine.registerApp({ id: SHOWCASE_PKG, name: SHOWCASE_PKG, version: '1.0.0' });

    const answer = await revert(SHOWCASE_PKG);

    expect(answer.status).toBe(422);
    expect(answer.body?.error?.code).toBe('WRITABLE_PACKAGE_REQUIRED');
  });

  it('(d) the code-shipped com.example.showcase, published then edited: 422 WRITABLE_PACKAGE_REQUIRED, and nothing is restored (was: 200)', async () => {
    const { engine, metadata, revert } = await boot();
    for (const cap of SHOWCASE_CAPABILITIES) await metadata.register('capability', cap.name, { ...cap });
    const published = await metadata.publishPackage(SHOWCASE_PKG, { validate: false });
    expect(published.success).toBe(true);
    const item = await metadata.get('capability', 'showcase.export_data') as any;
    await metadata.register('capability', 'showcase.export_data', {
      ...item, metadata: { ...item.publishedDefinition, label: 'Edited after publish' }, state: 'draft',
    });
    engine.registerApp({ id: SHOWCASE_PKG, name: SHOWCASE_PKG, version: '1.0.0' });

    const answer = await revert(SHOWCASE_PKG);

    expect(answer.status).toBe(422);
    expect(answer.body?.error?.code).toBe('WRITABLE_PACKAGE_REQUIRED');
    const after = await metadata.get('capability', 'showcase.export_data') as any;
    expect(after.state).toBe('draft');
    expect(after.metadata.label).toBe('Edited after publish');
  });
});
