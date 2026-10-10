// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The registry load path serves the declared `_packageVersion`, as the artifact
 * loader path already did.
 *
 * `MetadataPlugin`'s artifact door stamps every item with its package's
 * `(packageId, packageVersion)` through `applyProtection`. The registry door —
 * `ObjectQL.registerApp(manifest)` into `SchemaRegistry.registerItem` /
 * `registerObject` — stamped the id alone, so `GET /meta/app` served a
 * registry-registered app with `_packageId` and no version, and a console
 * could not tell an upgrade's new app from the old one a stale kernel still
 * serves. `registerApp` now stamps `(id, manifest.version)` on every item before
 * handing it over — the artifact loader's own call — and the registry's id-only
 * stamp keeps the version it finds; the registry's signatures are unchanged.
 *
 * "Served" is read through the real list door (`getMetaItems`) over the real
 * registry; its engine is a `find`-only stand-in that answers "no stored rows".
 */

import { describe, it, expect, vi } from 'vitest';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
import { MetadataPlugin } from '@objectstack/metadata';
import { ObjectQL } from './engine';

const PKG = 'com.acme.hotcrm';

const manifest = (version: string) => ({
  id: PKG,
  name: 'hotcrm',
  namespace: 'hotcrm',
  version,
  type: 'app',
  objects: [{ name: 'hc_lead', label: 'Lead', sharingModel: 'private', fields: { name: { name: 'name', type: 'text', label: 'Name' } } }],
  apps: [{ name: 'hotcrm', label: 'HotCRM', navigation: [] }],
});

const envelope = (item: any) => ({
  _packageId: item?._packageId,
  _packageVersion: item?._packageVersion,
  _provenance: item?._provenance,
});

async function served(ql: ObjectQL, type: string, name: string): Promise<any> {
  const protocol = new ObjectStackProtocolImplementation({ registry: ql.registry, find: async () => [] } as never);
  const { items } = await protocol.getMetaItems({ type });
  return (items as any[]).find((i) => i.name === name);
}

describe('registry path stamps the package version it is handed', () => {
  it('an app and an object registered through ObjectQL.registerApp are served with _packageVersion', async () => {
    const ql = new ObjectQL();
    ql.registerApp(manifest('2.0.0'));

    expect(envelope(await served(ql, 'app', 'hotcrm')))
      .toEqual({ _packageId: PKG, _packageVersion: '2.0.0', _provenance: 'package' });
    expect((await served(ql, 'object', 'hc_lead'))?._packageVersion).toBe('2.0.0');
  });

  it('an upgrade re-registered through the same door is served with the NEW version', async () => {
    const ql = new ObjectQL();
    ql.registerApp(manifest('1.0.0'));
    expect((await served(ql, 'app', 'hotcrm'))?._packageVersion).toBe('1.0.0');

    ql.registerApp(manifest('1.1.0'));
    expect((await served(ql, 'app', 'hotcrm'))?._packageVersion).toBe('1.1.0');
  });

  it('a nested plugin and a collection item carry the owning package version', () => {
    const ql = new ObjectQL();
    ql.registerApp({
      ...manifest('2.0.0'),
      actions: [{ name: 'hc_convert', label: 'Convert', type: 'script' }],
      plugins: [{ name: 'hc_notes', objects: [{ name: 'hc_note', label: 'Note', sharingModel: 'private', fields: { body: { name: 'body', type: 'text', label: 'Body' } } }] }],
    });

    expect(envelope(ql.registry.getItem('action', 'hc_convert')))
      .toEqual({ _packageId: PKG, _packageVersion: '2.0.0', _provenance: 'package' });
    expect((ql.registry.getObject('hc_note') as any)?._packageVersion).toBe('2.0.0');
  });

  it('a caller that knows only a package id stamps the id alone', () => {
    const ql = new ObjectQL();
    ql.registry.registerItem('app', { name: 'bare_app', label: 'Bare' }, 'name', PKG);

    const item: any = ql.registry.getItem('app', 'bare_app');
    expect(item._packageId).toBe(PKG);
    expect(item).not.toHaveProperty('_packageVersion');
  });

  it('CONTROL: the artifact loader door stamps the same envelope for the same manifest', async () => {
    const plugin = new MetadataPlugin({ watch: false, config: { bootstrap: 'lazy' } }) as any;
    const ctx = {
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
      registerService: vi.fn(),
      getService: vi.fn(() => undefined),
      trigger: vi.fn(),
    };
    const { id, name, namespace, version, type, apps } = manifest('2.0.0');
    await plugin._parseAndRegisterArtifact(ctx, { manifest: { id, name, namespace, version, type }, apps }, 'fixture-22689');
    const viaArtifact = await plugin.manager.get('app', 'hotcrm');

    const ql = new ObjectQL();
    ql.registerApp(manifest('2.0.0'));

    expect(envelope(viaArtifact)).toEqual({ _packageId: PKG, _packageVersion: '2.0.0', _provenance: 'package' });
    expect(envelope(await served(ql, 'app', 'hotcrm'))).toEqual(envelope(viaArtifact));
  });
});
