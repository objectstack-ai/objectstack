// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, vi } from 'vitest';
import {
  PublicFormSwitchRefusal,
  baseShipsFormOff,
  markShippedOff,
  overrideHoldsOnlySwitch,
  publicFormRowOf,
  publicFormRowsOf,
  switchPublicForm,
} from './publicForms';

/**
 * objectstack#36444 — Setup → Public forms: which forms are listed and on, and
 * where a switch is saved (a writable package, or an installed app's
 * customization package, ADR-0146).
 */

const sharing = (enabled: boolean, extra: Record<string, unknown> = {}) => ({
  enabled,
  allowAnonymous: true,
  publicLink: 'contact-us',
  ...extra,
});

const formItem = (overrides: Record<string, unknown> = {}, enabled = true) => ({
  name: 'web_to_lead',
  object: 'crm_lead',
  viewKind: 'form',
  label: 'Contact us',
  _packageId: 'crm',
  config: { title: 'Contact us', data: { object: 'crm_lead' }, sharing: sharing(enabled), sections: [] },
  ...overrides,
});

describe('publicFormRowOf', () => {
  it('lists a form open to anonymous intake as on', () => {
    expect(publicFormRowOf(formItem())).toEqual({
      name: 'web_to_lead',
      title: 'Contact us',
      object: 'crm_lead',
      slug: 'contact-us',
      on: true,
      packageId: 'crm',
    });
  });

  it('keeps a switched-off form listed, as off', () => {
    expect(publicFormRowOf(formItem({}, false))).toMatchObject({ name: 'web_to_lead', on: false, slug: 'contact-us' });
  });

  it('does not list an internal form: not anonymous, or no address', () => {
    const notAnonymous = formItem({ config: { title: 'x', sharing: { enabled: true, allowAnonymous: false, publicLink: 'x' } } });
    const noLink = formItem({ config: { title: 'x', sharing: { enabled: true, allowAnonymous: true } } });
    const noSharing = formItem({ config: { title: 'x' } });
    expect(publicFormRowOf(notAnonymous)).toBeNull();
    expect(publicFormRowOf(noLink)).toBeNull();
    expect(publicFormRowOf(noSharing)).toBeNull();
  });

  it('does not list a view that is not a form, or one with no config', () => {
    expect(publicFormRowOf(formItem({ viewKind: 'list' }))).toBeNull();
    expect(publicFormRowOf(formItem({ config: null }))).toBeNull();
    expect(publicFormRowOf(null)).toBeNull();
  });

  it('names a form by its served label, else its title, else its first section, else its name; a package-less item has none', () => {
    expect(publicFormRowOf(formItem({ label: undefined }))?.title).toBe('Contact us');
    const sectioned = { sharing: sharing(true), sections: [{ name: 'contact_us', label: 'Get in touch', fields: [] }] };
    expect(publicFormRowOf(formItem({ label: undefined, config: sectioned }))?.title).toBe('Get in touch');
    expect(publicFormRowOf(formItem({ label: '', config: { sharing: sharing(true) } }))?.title).toBe('web_to_lead');
    expect(publicFormRowOf(formItem({ name: 'crm_lead.web_to_lead', label: '', config: { sharing: sharing(true) } }))?.title).toBe(
      'web_to_lead',
    );
    expect(publicFormRowOf(formItem({ _packageId: undefined }))?.packageId).toBeNull();
  });
});

describe('publicFormRowsOf', () => {
  it('reads `{ items }` or a bare array, drops internal forms and sorts by the name shown', () => {
    const b = formItem({ name: 'b_form', label: 'Beta' });
    const a = formItem({ name: 'a_form', label: 'Alpha' });
    const list = formItem({ name: 'all', viewKind: 'list' });
    expect(publicFormRowsOf({ items: [b, list, a] }).map((r) => r.name)).toEqual(['a_form', 'b_form']);
    expect(publicFormRowsOf([b, a]).map((r) => r.name)).toEqual(['a_form', 'b_form']);
    expect(publicFormRowsOf(undefined)).toEqual([]);
  });
});

describe('overrideHoldsOnlySwitch', () => {
  const base = formItem();
  it('is true when the override differs from the base only by the switch, its declaration and the decorations', () => {
    const override = { ...formItem({}, false), _layer: 'custom', overrides: { package: 'crm', basedOn: '3.0.0' } };
    expect(overrideHoldsOnlySwitch(override, base)).toBe(true);
  });
  it('is false when the override also changes the design', () => {
    const override = {
      ...formItem({ label: 'Talk to us' }, false),
      overrides: { package: 'crm', basedOn: '3.0.0' },
    };
    expect(overrideHoldsOnlySwitch(override, base)).toBe(false);
  });
});

const listed = (entries: Record<string, { writable: boolean; version?: string }>) => ({
  listPackages: vi.fn(async () =>
    new Map(Object.entries(entries).map(([id, e]) => [id, { writable: e.writable, manifest: { id, version: e.version } } as any])),
  ),
  ensureCustomization: vi.fn(async (base: string) => ({ packageId: `${base}.custom`, writable: true })),
});

const clientOf = (layered: (name: string, packageId?: string) => { code?: unknown; effective?: unknown; draft?: unknown }) => ({
  layered: vi.fn(async (_type: string, name: string, options?: { packageId?: string }) => layered(name, options?.packageId)),
  save: vi.fn(async () => ({})),
  publish: vi.fn(async () => ({})),
  reset: vi.fn(async () => ({})),
});

const row = { name: 'web_to_lead', packageId: 'crm', object: 'crm_lead' };
const stripped = (doc: Record<string, unknown>) =>
  Object.fromEntries(Object.entries(doc).filter(([k]) => !k.startsWith('_')));

describe('switchPublicForm', () => {
  it('saves and publishes the switch in a writable package, changing nothing else', async () => {
    const doc = formItem();
    const client = clientOf(() => ({ code: doc, effective: doc }));
    const invalidateViewKeys = vi.fn();
    const out = await switchPublicForm(row, false, client, { dataSource: { invalidateViewKeys } as any }, listed({ crm: { writable: true } }));
    expect(out).toBe('published');
    expect(client.save).toHaveBeenCalledTimes(1);
    const [type, name, body, options] = client.save.mock.calls[0] as unknown as [string, string, any, any];
    expect([type, name]).toEqual(['view', 'web_to_lead']);
    expect(options).toMatchObject({ mode: 'draft', ifNoneMatch: '*', packageId: 'crm' });
    expect(body).toEqual({ ...stripped(doc), config: { ...doc.config, sharing: sharing(false) } });
    expect(client.publish).toHaveBeenCalledWith('view', 'web_to_lead', { packageId: 'crm' });
    expect(invalidateViewKeys).toHaveBeenCalledWith('crm_lead', 'web_to_lead');
  });

  it('switches an installed app\'s form off as an override in its customization package, never in the app', async () => {
    const doc = formItem();
    const client = clientOf((_n, pkg) => (pkg === 'crm' ? { code: doc, effective: doc } : { code: null, effective: null }));
    const doors = listed({ crm: { writable: false, version: '3.0.0' } });
    const out = await switchPublicForm(row, false, client, {}, doors);
    expect(out).toBe('published');
    expect(doors.ensureCustomization).toHaveBeenCalledWith('crm');
    const [, , body, options] = client.save.mock.calls[0] as unknown as [string, string, any, any];
    expect(options).toMatchObject({ packageId: 'crm.custom' });
    expect(body.overrides).toEqual({ package: 'crm', basedOn: '3.0.0' });
    expect(body.config.sharing).toEqual(sharing(false));
    expect(body._packageId).toBeUndefined();
    expect(client.publish).toHaveBeenCalledWith('view', 'web_to_lead', { packageId: 'crm.custom' });
    expect(client.reset).not.toHaveBeenCalled();
  });

  it('reads the base when the listed pair does not hold the form yet', async () => {
    const doc = formItem();
    const client = clientOf((_n, pkg) => (pkg === 'crm' ? { code: doc, effective: doc } : { code: null, effective: null }));
    const doors = listed({ crm: { writable: false, version: '3.0.0' }, 'crm.custom': { writable: true, version: '0.0.0' } });
    await switchPublicForm(row, false, client, {}, doors);
    expect(client.layered).toHaveBeenNthCalledWith(1, 'view', 'web_to_lead', { packageId: 'crm.custom' });
    expect(client.layered).toHaveBeenNthCalledWith(2, 'view', 'web_to_lead', { packageId: 'crm' });
    const [, , body] = client.save.mock.calls[0] as unknown as [string, string, any];
    expect(body.config.sharing).toEqual(sharing(false));
  });

  it('switching back on restores the app\'s own form when the override held nothing but the switch', async () => {
    const base = formItem();
    const override = { ...stripped(formItem({}, false)), overrides: { package: 'crm', basedOn: '3.0.0' }, _packageId: 'crm.custom' };
    const client = clientOf(() => ({ code: base, effective: override, draft: null }));
    const doors = listed({ crm: { writable: false, version: '3.0.0' }, 'crm.custom': { writable: true, version: '0.0.0' } });
    const invalidateViewKeys = vi.fn();
    const out = await switchPublicForm(row, true, client, { dataSource: { invalidateViewKeys } as any }, doors);
    expect(out).toBe('restored');
    expect(client.reset).toHaveBeenCalledTimes(1);
    expect(client.reset).toHaveBeenCalledWith('view', 'web_to_lead', { packageId: 'crm.custom' });
    expect(client.save).not.toHaveBeenCalled();
    expect(invalidateViewKeys).toHaveBeenCalledWith('crm_lead', 'web_to_lead');
  });

  it('switching back on keeps an override that also carries design changes, with the switch on', async () => {
    const base = formItem();
    const override = { ...stripped(formItem({ label: 'Talk to us' }, false)), overrides: { package: 'crm', basedOn: '3.0.0' } };
    const client = clientOf(() => ({ code: base, effective: override }));
    const doors = listed({ crm: { writable: false, version: '3.0.0' }, 'crm.custom': { writable: true, version: '0.0.0' } });
    const out = await switchPublicForm(row, true, client, {}, doors);
    expect(out).toBe('published');
    expect(client.reset).not.toHaveBeenCalled();
    const [, , body, options] = client.save.mock.calls[0] as unknown as [string, string, any, any];
    expect(options).toMatchObject({ packageId: 'crm.custom' });
    expect(body.label).toBe('Talk to us');
    expect(body.config.sharing).toEqual(sharing(true));
    expect(body.overrides).toEqual({ package: 'crm', basedOn: '3.0.0' });
  });

  it('after an app upgrade, switching back on says the form stays on the earlier version its override was taken from', async () => {
    // Switched off at 2.0.0 (a switch-only copy of the 2.0.0 form); the app is now 3.0.0 with a changed form.
    const base = formItem({ label: 'Contact sales' });
    const override = { ...stripped(formItem({}, false)), overrides: { package: 'crm', basedOn: '2.0.0' } };
    const client = clientOf(() => ({ code: base, effective: override }));
    const doors = listed({ crm: { writable: false, version: '3.0.0' }, 'crm.custom': { writable: true, version: '0.0.0' } });
    const out = await switchPublicForm(row, true, client, {}, doors);
    expect(out).toEqual({ kind: 'earlier-version', basedOn: '2.0.0' });
    expect(client.reset).not.toHaveBeenCalled();
    const [, , body] = client.save.mock.calls[0] as unknown as [string, string, any];
    expect(body.config.sharing).toEqual(sharing(true));
    // The override keeps the version it declared: re-basing is a person's call.
    expect(body.overrides).toEqual({ package: 'crm', basedOn: '2.0.0' });
  });

  it('after an app upgrade that left the form as it was, switching back on restores the app\'s own form', async () => {
    const base = formItem();
    const override = { ...stripped(formItem({}, false)), overrides: { package: 'crm', basedOn: '2.0.0' } };
    const client = clientOf(() => ({ code: base, effective: override, draft: null }));
    const doors = listed({ crm: { writable: false, version: '3.0.0' }, 'crm.custom': { writable: true, version: '0.0.0' } });
    await expect(switchPublicForm(row, true, client, {}, doors)).resolves.toBe('restored');
    expect(client.save).not.toHaveBeenCalled();
  });

  describe('a form the installed app ships switched off', () => {
    const shippedOff = {
      'enabled: false': formItem({}, false),
      'no enabled': formItem({ config: { title: 'Contact us', data: { object: 'crm_lead' }, sharing: { allowAnonymous: true, publicLink: 'contact-us' } } }),
    };
    const doors = () => listed({ crm: { writable: false, version: '3.0.0' }, 'crm.custom': { writable: true, version: '0.0.0' } });

    for (const [how, base] of Object.entries(shippedOff)) {
      it(`(${how}) is never switched on: nothing is written, and the refusal says the app ships it off`, async () => {
        expect(baseShipsFormOff(base, 'web_to_lead')).toBe(true);
        // No override yet: the list serves the app's own document.
        const fresh = clientOf(() => ({ code: base, effective: base }));
        const freshDoors = doors();
        await expect(switchPublicForm(row, true, fresh, {}, freshDoors)).rejects.toMatchObject({
          name: 'PublicFormSwitchRefusal',
          reason: 'shipped-off',
        });
        // An override that switches it on already (saved before this page knew better): still refused.
        const override = { ...stripped(formItem()), overrides: { package: 'crm', basedOn: '3.0.0' } };
        const overridden = clientOf(() => ({ code: base, effective: override }));
        await expect(switchPublicForm(row, true, overridden, {}, doors())).rejects.toMatchObject({ reason: 'shipped-off' });
        for (const c of [fresh, overridden]) {
          expect(c.save).not.toHaveBeenCalled();
          expect(c.reset).not.toHaveBeenCalled();
        }
        expect(freshDoors.ensureCustomization).not.toHaveBeenCalled();
      });

      it(`(${how}) is listed, never as on, even when an override switches it on`, async () => {
        const override = { ...stripped(formItem()), overrides: { package: 'crm', basedOn: '3.0.0' } };
        const client = clientOf(() => ({ code: base, effective: override }));
        const listedDoors = doors();
        const served = publicFormRowOf({ ...override, _packageId: 'crm' })!;
        expect(served.on).toBe(true);
        const [marked] = await markShippedOff([served], client, listedDoors);
        expect(marked).toMatchObject({ name: 'web_to_lead', on: false, shippedOff: true });
      });
    }

    it('(allowAnonymous: false) the routes\' own rule: an app that ships the form closed to anonymous visitors withdraws it, even once an override opens it', async () => {
      const base = formItem({ config: { title: 'Contact us', data: { object: 'crm_lead' }, sharing: sharing(true, { allowAnonymous: false }) } });
      const override = { ...stripped(formItem()), overrides: { package: 'crm', basedOn: '3.0.0' } };
      expect(baseShipsFormOff(base, 'web_to_lead', override)).toBe(true);
      // The served override reads on, by the candidates rule alone.
      const served = publicFormRowOf({ ...override, _packageId: 'crm' })!;
      expect(served.on).toBe(true);
      const client = clientOf(() => ({ code: base, effective: override }));
      const [marked] = await markShippedOff([served], client, doors());
      expect(marked).toMatchObject({ on: false, shippedOff: true });
      await expect(switchPublicForm(row, true, client, {}, doors())).rejects.toMatchObject({ reason: 'shipped-off' });
      expect(client.save).not.toHaveBeenCalled();
    });

    it('does not read a form whose app\'s document cannot be read as on', async () => {
      const client = clientOf(() => {
        throw new Error('503');
      });
      const served = publicFormRowOf(formItem())!;
      const [marked] = await markShippedOff([served], client, doors());
      expect(marked).toMatchObject({ on: false, unknown: true });
      expect(marked.shippedOff).toBeUndefined();
    });

    it('leaves a form the app ships on, a writable package\'s form and a form with no package as listed', async () => {
      const on = formItem();
      expect(baseShipsFormOff(on, 'web_to_lead')).toBe(false);
      const client = clientOf((name) => ({ code: name === 'own' ? formItem({}, false) : on, effective: on }));
      const listedDoors = listed({ crm: { writable: false, version: '3.0.0' }, mine: { writable: true } });
      const rows = [
        publicFormRowOf(on)!,
        { ...publicFormRowOf(formItem({}, false))!, name: 'own', packageId: 'mine' },
        { ...publicFormRowOf(on)!, name: 'loose', packageId: null },
      ];
      const marked = await markShippedOff(rows, client, listedDoors);
      expect(marked).toEqual(rows);
      // The package list is read once for the whole page, and only an installed app's form is read.
      expect(listedDoors.listPackages).toHaveBeenCalledTimes(1);
      expect(client.layered).toHaveBeenCalledTimes(1);
    });
  });

  it('writes nothing over a draft pending in the pair: neither the restore nor a save', async () => {
    const base = formItem();
    const override = { ...stripped(formItem({}, false)), overrides: { package: 'crm', basedOn: '3.0.0' } };
    const client = clientOf(() => ({ code: base, effective: override, draft: { ...override, label: 'WIP' } }));
    const doors = listed({ crm: { writable: false, version: '3.0.0' }, 'crm.custom': { writable: true, version: '0.0.0' } });
    await expect(switchPublicForm(row, true, client, {}, doors)).resolves.toBe('pending-draft');
    expect(client.reset).not.toHaveBeenCalled();
    expect(client.save).not.toHaveBeenCalled();
  });

  it('answers a pending draft the server refuses the save over, publishing nothing', async () => {
    const doc = formItem();
    const client = clientOf(() => ({ code: doc, effective: doc }));
    client.save.mockRejectedValueOnce(Object.assign(new Error('conflict'), { status: 409, code: 'METADATA_CONFLICT' }));
    await expect(switchPublicForm(row, false, client, {}, listed({ crm: { writable: true } }))).resolves.toBe('pending-draft');
    expect(client.publish).not.toHaveBeenCalled();
  });

  it('refuses, writing nothing, when the package is not listed, the form cannot be read, or no version can be declared', async () => {
    const doc = formItem();
    const ok = clientOf(() => ({ code: doc, effective: doc }));
    await expect(switchPublicForm(row, false, ok, {}, listed({}))).rejects.toMatchObject({
      name: 'PublicFormSwitchRefusal',
      reason: 'no-package',
    });

    const unreadable = clientOf(() => ({ code: null, effective: null }));
    await expect(switchPublicForm(row, false, unreadable, {}, listed({ crm: { writable: true } }))).rejects.toBeInstanceOf(
      PublicFormSwitchRefusal,
    );

    const noVersion = listed({ crm: { writable: false } });
    await expect(switchPublicForm(row, false, ok, {}, noVersion)).rejects.toMatchObject({ reason: 'no-version' });
    expect(noVersion.ensureCustomization).not.toHaveBeenCalled();
    for (const c of [ok, unreadable]) expect(c.save).not.toHaveBeenCalled();
  });

  it('saves a form that names no package where it lives', async () => {
    const doc = formItem({ _packageId: undefined });
    const client = clientOf(() => ({ code: doc, effective: doc }));
    const out = await switchPublicForm({ ...row, packageId: null }, false, client, {}, listed({}));
    expect(out).toBe('published');
    expect(client.layered).toHaveBeenCalledWith('view', 'web_to_lead', {});
    const [, , , options] = client.save.mock.calls[0] as unknown as [string, string, any, any];
    expect(options).toEqual({ mode: 'draft', ifNoneMatch: '*' });
  });
});
