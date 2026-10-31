// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The settings write predicate (ADR-0144 D4): a rule over engine state that a
 * package registers on one manifest key, asked by `setMany` when a write
 * CHANGES that key. The home-currency lock is its first user
 * (`localization-currency-lock.test.ts`); this suite pins the mechanism.
 */

import { describe, expect, it, vi } from 'vitest';
import { SettingsService } from './settings-service.js';
import { localizationSettingsManifest } from './manifests/localization.manifest.js';
import {
  SettingsValidationError,
  UnknownKeyError,
  UnknownNamespaceError,
  type SettingsWritePredicate,
} from './settings-service.types.js';

const ORG = 'org_alpha';
const ctx = { tenantId: ORG, userId: 'usr_admin' };

function rig(predicate: SettingsWritePredicate) {
  const svc = new SettingsService({ env: {} });
  svc.registerManifest(localizationSettingsManifest);
  const spy = vi.fn(predicate);
  svc.registerWritePredicate('localization', 'currency', spy);
  return { svc, spy };
}

const refuseAll: SettingsWritePredicate = () => ({ message: 'No.', constraint: { why: 'test' } });

describe('SettingsService write predicate', () => {
  it('is asked with the value in force, the value to store and the organization the row lands in', async () => {
    const { svc, spy } = rig(() => undefined);
    await svc.set('localization', 'currency', 'USD', ctx);
    await svc.set('localization', 'currency', 'EUR', ctx);
    expect(spy).toHaveBeenCalledTimes(2);
    expect(spy.mock.calls[0][0]).toMatchObject({
      namespace: 'localization', key: 'currency', current: null, next: 'USD', organizationId: ORG,
    });
    expect(spy.mock.calls[1][0]).toMatchObject({ current: 'USD', next: 'EUR' });
    expect((await svc.get('localization', 'currency', ctx)).value).toBe('EUR');
  });

  it('is not asked when the write stores the value already in force', async () => {
    const { svc, spy } = rig(() => undefined);
    await svc.set('localization', 'currency', 'USD', ctx);
    spy.mockClear();
    await svc.set('localization', 'currency', 'USD', ctx);
    await svc.setMany('localization', { timezone: 'Europe/Paris' }, ctx);
    expect(spy).not.toHaveBeenCalled();
  });

  it('refuses the whole batch, before any write, with the refusal at the key', async () => {
    const { svc } = rig(refuseAll);
    const err = await svc
      .setMany('localization', { currency: 'EUR', timezone: 'Europe/Paris' }, ctx)
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SettingsValidationError);
    expect((err as SettingsValidationError).fields).toEqual([
      { field: 'currency', code: 'invalid_value', message: 'No.', label: 'Default currency', constraint: { why: 'test' } },
    ]);
    expect((await svc.get('localization', 'currency', ctx)).value ?? null).toBeNull();
    expect((await svc.get('localization', 'timezone', ctx)).value).toBe('UTC');
  });

  it('asks about a clear too: clearing a set value is a change', async () => {
    const { svc, spy } = rig(({ current }) => (current ? { message: 'Locked.' } : undefined));
    await svc.set('localization', 'currency', 'USD', ctx);
    await expect(svc.set('localization', 'currency', null, ctx)).rejects.toBeInstanceOf(SettingsValidationError);
    expect(spy.mock.calls.at(-1)![0]).toMatchObject({ current: 'USD', next: null });
    expect((await svc.get('localization', 'currency', ctx)).value).toBe('USD');
  });

  it('judges the declared constraints first: a malformed value is told about its own fault', async () => {
    const { svc, spy } = rig(refuseAll);
    const err = (await svc.set('localization', 'currency', 'ZZZ', ctx).catch((e: unknown) => e)) as SettingsValidationError;
    expect(err.fields[0].code).toBe('value_domain');
    expect(spy).not.toHaveBeenCalled();
  });

  it('fails the write when the predicate throws: the state it guards could not be read', async () => {
    const { svc } = rig(() => {
      throw new Error('rate table unreachable');
    });
    await expect(svc.set('localization', 'currency', 'USD', ctx)).rejects.toThrow('rate table unreachable');
    expect((await svc.get('localization', 'currency', ctx)).value ?? null).toBeNull();
  });

  it('refuses a predicate for an unregistered namespace or an undeclared key', () => {
    const { svc } = rig(() => undefined);
    expect(() => svc.registerWritePredicate('nope', 'currency', () => undefined)).toThrow(UnknownNamespaceError);
    expect(() => svc.registerWritePredicate('localization', 'nope', () => undefined)).toThrow(UnknownKeyError);
  });
});
