// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { SchemaRegistry } from './registry.js';
import { MetadataFacade } from './metadata-facade.js';

/**
 * #7221 — `unregisterItemsByPackage`, the package-addressed removal verb for
 * the GENERIC metadata map.
 *
 * A package writes into two stores, and only one of them had a
 * package-addressed removal verb. `unregisterObjectsByPackage` walks
 * `objectContributors`; every non-object item a package ships — `page`,
 * `view`, `flow`, `app`, `api` … — lives in the generic `metadata` map under
 * the composite `${packageId}:${name}` key `registerItem` builds, and nothing
 * removed those. So "unregister all metadata from a package" left the
 * package's UI and API metadata fully resolvable, and left the generic-map
 * half of its objects behind as a genuine orphan.
 *
 * Both callers had the gap — measured, not assumed, which is why the verb sits
 * on the registry rather than privately on the facade:
 *
 *   - `MetadataFacade.unregisterPackage` (the published `IMetadataService`
 *     member whose contract reads "Unregister all metadata items from a
 *     specific package")
 *   - `SchemaRegistry.uninstallPackage` — registry-direct, same one-verb call
 *
 * The bare-key half is deliberately NOT taken: a bare key is the ADR-0005
 * runtime/DB overlay slot, a tenant's own customization with no package
 * provenance, and an uninstall does not get to delete tenant data. The
 * consequence — an overlay that now layers over nothing — is made LOUD, the
 * same house pattern as ADR-0029 D9.5's orphan-overlay violation and as
 * `unregisterObjectsByPackage`'s refusal, rather than silently deleted or
 * silently kept.
 */

const quiet = () => {
  const r = new SchemaRegistry({ multiTenant: false });
  (r as any).logLevel = 'silent';
  return r;
};

const objectBody = (name: string, field = 'name') =>
  ({
    name,
    label: name,
    fields: { [field]: { name: field, type: 'text', label: field } },
  }) as any;

afterEach(() => {
  vi.restoreAllMocks();
});

describe('#7221 — SchemaRegistry.unregisterItemsByPackage', () => {
  it('takes every generic item the package shipped, across types', () => {
    const reg = quiet();
    reg.registerItem('page', { name: 'home' }, 'name', 'crm');
    reg.registerItem('view', { name: 'list' }, 'name', 'crm');
    reg.registerItem('flow', { name: 'onboard' }, 'name', 'crm');
    reg.registerItem('api', { name: 'sync' }, 'name', 'crm');

    const { removed, orphanedOverlays } = reg.unregisterItemsByPackage('crm');

    expect(reg.getItem('page', 'home')).toBeUndefined();
    expect(reg.getItem('view', 'list')).toBeUndefined();
    expect(reg.getItem('flow', 'onboard')).toBeUndefined();
    expect(reg.getItem('api', 'sync')).toBeUndefined();
    expect(removed.sort()).toEqual([
      'api/crm:sync',
      'flow/crm:onboard',
      'page/crm:home',
      'view/crm:list',
    ]);
    expect(orphanedOverlays).toEqual([]);
  });

  it('leaves a DIFFERENT package’s same-named items alone', () => {
    const reg = quiet();
    reg.registerItem('page', { name: 'home' }, 'name', 'crm');
    reg.registerItem('page', { name: 'home' }, 'name', 'helpdesk');

    reg.unregisterItemsByPackage('crm');

    // The surviving package still resolves its own copy, package-scoped.
    expect(reg.getItem('page', 'home', 'helpdesk')).toMatchObject({ name: 'home' });
    expect([...(reg as any).metadata.get('page').keys()]).toEqual(['helpdesk:home']);
  });

  it('is not fooled by a package id that PREFIXES another', () => {
    const reg = quiet();
    reg.registerItem('page', { name: 'home' }, 'name', 'crm');
    reg.registerItem('page', { name: 'home' }, 'name', 'crm-pro');

    reg.unregisterItemsByPackage('crm');

    // `crm-pro:home` does not start with `crm:` — the separator is part of the
    // prefix, so a package id that is a string prefix of another is unaffected.
    expect([...(reg as any).metadata.get('page').keys()]).toEqual(['crm-pro:home']);
  });

  it('takes a scoped package id’s items (the id contains @ and /)', () => {
    const reg = quiet();
    reg.registerItem('page', { name: 'home' }, 'name', '@acme/crm');

    const { removed } = reg.unregisterItemsByPackage('@acme/crm');

    expect(removed).toEqual(['page/@acme/crm:home']);
    expect((reg as any).metadata.get('page').size).toBe(0);
  });

  it('takes a discriminated type’s whole bundle (#7730 i18n keys)', () => {
    const reg = quiet();
    reg.registerItem('email_template', { name: 'auth.welcome', locale: 'en-US' }, 'name', 'crm');
    reg.registerItem('email_template', { name: 'auth.welcome', locale: 'zh-CN' }, 'name', 'crm');

    const { removed } = reg.unregisterItemsByPackage('crm');

    // The discriminator rides at the end of the composite key, so every member
    // leaves with the package that shipped the bundle.
    expect(removed.sort()).toEqual([
      'email_template/crm:auth.welcome@en-US',
      'email_template/crm:auth.welcome@zh-CN',
    ]);
    expect((reg as any).metadata.get('email_template').size).toBe(0);
  });

  it('is idempotent and silent for a package that shipped nothing', () => {
    const reg = quiet();
    reg.registerItem('page', { name: 'home' }, 'name', 'crm');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    expect(reg.unregisterItemsByPackage('nobody')).toEqual({
      removed: [],
      orphanedOverlays: [],
    });
    expect(reg.getItem('page', 'home')).toMatchObject({ name: 'home' });
    expect(warn).not.toHaveBeenCalled();
  });

  describe('the bare-key ruling — tenant overlays are kept, and said out loud', () => {
    it('KEEPS the ADR-0005 bare-key overlay and reports it as orphaned', () => {
      const reg = quiet();
      // The packaged item, and a tenant's runtime/DB row overlaying it.
      reg.registerItem('page', { name: 'home', title: 'Packaged' }, 'name', 'crm');
      reg.registerItem('page', { name: 'home', title: 'Tenant edit' }, 'name');

      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const { removed, orphanedOverlays } = reg.unregisterItemsByPackage('crm');

      // The package's own copy went.
      expect(removed).toEqual(['page/crm:home']);
      // The tenant's did NOT — an uninstall does not delete tenant-authored data.
      expect(reg.getItem('page', 'home')).toMatchObject({ title: 'Tenant edit' });
      // …and the consequence is LOUD rather than silent, naming the offender.
      expect(orphanedOverlays).toEqual(['page/home']);
      expect(warn).toHaveBeenCalledTimes(1);
      const message = warn.mock.calls[0][0] as string;
      expect(message).toContain('page/home');
      expect(message).toContain('crm');
      expect(message).toMatch(/re-install the package that owns it, or delete the\s+sys_metadata row/);
    });

    it('says nothing when the package’s items had no overlay under them', () => {
      const reg = quiet();
      reg.registerItem('page', { name: 'home' }, 'name', 'crm');
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const { orphanedOverlays } = reg.unregisterItemsByPackage('crm');

      expect(orphanedOverlays).toEqual([]);
      expect(warn).not.toHaveBeenCalled();
    });

    it('matches the overlay slot by discriminator, not by bare name', () => {
      const reg = quiet();
      reg.registerItem('email_template', { name: 'auth.welcome', locale: 'zh-CN' }, 'name', 'crm');
      // A tenant row for a DIFFERENT locale of the same bundle is not the slot
      // the package's `zh-CN` member was layered under.
      reg.registerItem('email_template', { name: 'auth.welcome', locale: 'en-US' }, 'name');
      vi.spyOn(console, 'warn').mockImplementation(() => {});

      expect(reg.unregisterItemsByPackage('crm').orphanedOverlays).toEqual([]);

      reg.registerItem('email_template', { name: 'auth.welcome', locale: 'en-US' }, 'name', 'crm');
      expect(reg.unregisterItemsByPackage('crm').orphanedOverlays).toEqual([
        'email_template/auth.welcome@en-US',
      ]);
    });
  });
});

describe('#7221 — SchemaRegistry.uninstallPackage closes the same gap', () => {
  it('removes the package’s generic items, not just its objects and record', () => {
    const reg = quiet();
    reg.installPackage({ id: 'crm', name: 'CRM', version: '1.0.0' } as any);
    reg.registerItem('page', { name: 'home' }, 'name', 'crm');
    reg.registerItem('flow', { name: 'onboard' }, 'name', 'crm');
    reg.registerObject(objectBody('contact'), 'crm');

    expect(reg.uninstallPackage('crm')).toBe(true);

    // The measurement that placed the verb on the registry: before this, the
    // package record was gone while `getItem` kept serving the package's page.
    expect(reg.getItem('page', 'home')).toBeUndefined();
    expect(reg.getItem('flow', 'onboard')).toBeUndefined();
    expect(reg.getPackage('crm')).toBeUndefined();
    expect(reg.getObject('contact')).toBeUndefined();
  });

  it('removes NOTHING when the object half refuses (ADR-0029 extenders)', () => {
    const reg = quiet();
    reg.installPackage({ id: 'crm', name: 'CRM', version: '1.0.0' } as any);
    reg.registerItem('page', { name: 'home' }, 'name', 'crm');
    reg.registerObject(objectBody('contact'), 'crm');
    reg.registerObject(objectBody('contact', 'extra'), 'analytics', undefined, 'extend');

    expect(() => reg.uninstallPackage('crm')).toThrow(/extended by analytics/);

    // The item sweep runs AFTER the verb that can refuse, so a refused
    // uninstall leaves the generic half intact rather than half-removing.
    expect(reg.getItem('page', 'home')).toMatchObject({ name: 'home' });
    expect(reg.getPackage('crm')).toBeDefined();
  });

  it('keeps the package’s own `package` record addressable by its bare id', () => {
    const reg = quiet();
    reg.installPackage({ id: 'crm', name: 'CRM', version: '1.0.0' } as any);
    // The sweep is prefix-scoped to `crm:`, so the bare-keyed package record is
    // not collateral — `uninstallPackage` still owns removing it, and reports
    // `true` because it found it.
    expect(reg.uninstallPackage('crm')).toBe(true);
    expect(reg.getPackage('crm')).toBeUndefined();
  });
});

describe('#7221 — MetadataFacade.unregisterPackage', () => {
  const facadeOf = () => {
    const reg = quiet();
    return { reg, facade: new MetadataFacade(reg) };
  };

  it('a package’s page/view/flow no longer resolve through the facade', async () => {
    const { facade } = facadeOf();
    await facade.register('page', 'home', { name: 'home', _packageId: 'crm' });
    await facade.register('view', 'list', { name: 'list', _packageId: 'crm' });
    await facade.register('flow', 'onboard', { name: 'onboard', _packageId: 'crm' });

    await facade.unregisterPackage('crm');

    // Every read surface the contract names — this is the load-bearing half of
    // the defect: uninstall leaving the package's UI metadata installed.
    expect(await facade.get('page', 'home')).toBeUndefined();
    expect(await facade.get('view', 'list')).toBeUndefined();
    expect(await facade.get('flow', 'onboard')).toBeUndefined();
    expect(await facade.exists('page', 'home')).toBe(false);
    expect(await facade.listNames('page')).toEqual([]);
    expect(await facade.list('view')).toEqual([]);
  });

  it('takes BOTH halves of a facade-registered object', async () => {
    const { reg, facade } = facadeOf();
    await facade.register('object', 'contact', {
      ...objectBody('contact'),
      _packageId: 'crm',
    });

    await facade.unregisterPackage('crm');

    // The contributor half (what every object read resolves)…
    expect(await facade.getObject('contact')).toBeUndefined();
    expect(await facade.exists('object', 'contact')).toBe(false);
    // …and the generic-map half `registerObjectBothPlaces` wrote, which the
    // object verb alone never reached.
    expect([...(reg as any).metadata.get('object').keys()]).toEqual([]);
  });

  it('leaves another package’s items registered', async () => {
    const { facade } = facadeOf();
    await facade.register('page', 'home', { name: 'home', _packageId: 'crm' });
    await facade.register('page', 'dash', { name: 'dash', _packageId: 'helpdesk' });

    await facade.unregisterPackage('crm');

    expect(await facade.get('page', 'home')).toBeUndefined();
    expect(await facade.get('page', 'dash')).toMatchObject({ name: 'dash' });
  });

  it('keeps a tenant’s runtime-authored item, which has no package to leave with', async () => {
    const { facade } = facadeOf();
    await facade.register('page', 'home', { name: 'home', _packageId: 'crm' });
    // No `_packageId` — runtime-authored, stored under the bare key.
    await facade.register('page', 'custom', { name: 'custom' });
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    await facade.unregisterPackage('crm');

    expect(await facade.get('page', 'home')).toBeUndefined();
    expect(await facade.get('page', 'custom')).toMatchObject({ name: 'custom' });
  });

  it('keeps a tenant’s OVERLAY of a packaged item — the bare-key ruling, at this seam', async () => {
    const { facade } = facadeOf();
    await facade.register('page', 'home', { name: 'home', title: 'Packaged', _packageId: 'crm' });
    // Same name, no `_packageId`: the ADR-0005 overlay slot, not an unrelated
    // item. This is the case a destructive sweep would silently take, so the
    // facade pins it too and not only the registry verb.
    await facade.register('page', 'home', { name: 'home', title: 'Tenant edit' });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await facade.unregisterPackage('crm');

    expect(await facade.get('page', 'home')).toMatchObject({ title: 'Tenant edit' });
    expect(warn.mock.calls.some(([m]) => String(m).includes('page/home'))).toBe(true);
  });
});
