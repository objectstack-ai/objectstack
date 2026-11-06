// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * An organization's access policy at its save door, on a real
 * `SettingsService` (`organization-access-policy-binding.ts`):
 *
 *  1. an organization's MFA requirement never strands its members
 *     (ADR-0069 D3, `organization-mfa-enrollment-guard.ts`): a requirement is
 *     refused while two-factor enrollment is off, and admitted once it is on;
 *  2. an organization cannot save a value below the deployment's floor, in
 *     the settings service's own refusal envelope;
 *  3. the toggle-era values move onto the three levels once, at boot: a
 *     stored `auth.mfa_required` toggle, and an organization's
 *     `sys_organization.require_mfa`.
 */

import { describe, it, expect, vi } from 'vitest';
import type { SettingsManifest } from '@objectstack/spec/system';
import { SettingsService, SettingsValidationError, builtinSettingsManifests } from '@objectstack/service-settings';
import { AuthManager } from './auth-manager';
import {
  bindOrganizationAccessPolicy,
  migrateLegacyMfaRequiredSetting,
  migrateLegacyOrganizationRequireMfa,
} from './organization-access-policy-binding.js';
import { ORGANIZATION_MFA_REFUSAL_COPY, organizationMfaEnrollmentPredicate } from './organization-mfa-enrollment-guard.js';

const SECRET = 'test-secret-at-least-32-chars-long';
const ORG = 'org_alpha';

const manifest = (namespace: string) => builtinSettingsManifests.find((m) => m.namespace === namespace)!;

function settingsService(): SettingsService {
  const settings = new SettingsService({ env: {} });
  settings.registerManifest(manifest('auth'));
  settings.registerManifest(manifest('access_policy'));
  return settings;
}

const logger = () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() });

function authManager(extra: Record<string, unknown> = {}): AuthManager {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  const m = new AuthManager({ secret: SECRET, baseUrl: 'http://localhost:3000', ...extra } as any);
  warn.mockRestore();
  return m;
}

async function refusalOf(write: Promise<unknown>): Promise<SettingsValidationError> {
  const outcome = await write.then(() => undefined, (err: unknown) => err);
  expect(outcome, 'the save went through').toBeInstanceOf(SettingsValidationError);
  return outcome as SettingsValidationError;
}

async function bound(extra: Record<string, unknown> = {}) {
  const settings = settingsService();
  const manager = authManager(extra);
  await bindOrganizationAccessPolicy({
    settings: settings as any,
    manager,
    engine: () => undefined,
    security: () => undefined,
    logger: logger(),
  });
  return { settings, manager };
}

describe('an organization MFA requirement needs two-factor enrollment', () => {
  it('the predicate judges a requirement only, and only while enrollment is off', () => {
    const off = organizationMfaEnrollmentPredicate(() => false);
    expect(off({ next: 'everyone' })?.message).toBe(ORGANIZATION_MFA_REFUSAL_COPY.en);
    expect(off({ next: 'administrators', locale: 'zh-CN' })?.message).toBe(ORGANIZATION_MFA_REFUSAL_COPY['zh-CN']);
    expect(off({ next: 'off' })).toBeUndefined();
    expect(off({ next: null })).toBeUndefined();
    expect(organizationMfaEnrollmentPredicate(() => true)({ next: 'everyone' })).toBeUndefined();
  });

  it('refuses the save at the settings door while two-factor is off, and admits it once on', async () => {
    const { settings } = await bound({ plugins: {} });
    const refusal = await refusalOf(settings.setMany('access_policy', { mfa_required: 'everyone' }, { tenantId: ORG }));
    expect(refusal.fields?.[0]).toMatchObject({ field: 'mfa_required', code: 'invalid_value' });
    expect((await settings.get('access_policy', 'mfa_required', { tenantId: ORG })).value).toBe('off');

    const on = await bound({ plugins: { twoFactor: true } });
    await on.settings.setMany('access_policy', { mfa_required: 'everyone' }, { tenantId: ORG });
    expect((await on.settings.get('access_policy', 'mfa_required', { tenantId: ORG })).value).toBe('everyone');
    // Each organization's row is its own.
    expect((await on.settings.get('access_policy', 'mfa_required', { tenantId: 'org_beta' })).value).toBe('off');
  });
});

describe('an organization cannot save below the deployment floor', () => {
  it('refuses a weaker value with the settings refusal envelope, and admits a tighter one', async () => {
    const { settings } = await bound({
      plugins: { twoFactor: true },
      sessionIdleTimeoutMinutes: 30,
      maxConcurrentSessions: 3,
      allowedIpRanges: ['10.0.0.0/8'],
      mfaRequirement: 'everyone',
    });
    const idle = await refusalOf(settings.setMany('access_policy', { session_idle_timeout_minutes: 45 }, { tenantId: ORG }));
    expect(idle.fields?.[0]).toMatchObject({ field: 'session_idle_timeout_minutes', code: 'invalid_value', constraint: { max: 30 } });
    const cap = await refusalOf(settings.setMany('access_policy', { max_concurrent_sessions_per_user: 9 }, { tenantId: ORG }));
    expect(cap.fields?.[0]).toMatchObject({ field: 'max_concurrent_sessions_per_user', constraint: { max: 3 } });
    const ranges = await refusalOf(settings.setMany('access_policy', { allowed_ip_ranges: '192.168.0.0/16' }, { tenantId: ORG }));
    expect(ranges.fields?.[0]).toMatchObject({ field: 'allowed_ip_ranges', constraint: { range: '192.168.0.0/16' } });
    const mfa = await refusalOf(settings.setMany('access_policy', { mfa_required: 'administrators' }, { tenantId: ORG }));
    expect(mfa.fields?.[0]).toMatchObject({ field: 'mfa_required', constraint: { minimum: 'everyone' } });

    await settings.setMany(
      'access_policy',
      { session_idle_timeout_minutes: 10, max_concurrent_sessions_per_user: 1, allowed_ip_ranges: '10.1.0.0/16' },
      { tenantId: ORG },
    );
    expect((await settings.get('access_policy', 'session_idle_timeout_minutes', { tenantId: ORG })).value).toBe(10);
  });

  it('the manager reads each organization\'s saved policy, and drops its cache on a change', async () => {
    const { settings, manager } = await bound({ plugins: { twoFactor: true } });
    await settings.setMany('access_policy', { session_idle_timeout_minutes: 10 }, { tenantId: ORG });
    expect((await manager.getOrganizationAccessPolicy(ORG)).sessionIdleTimeoutMinutes).toBe(10);
    expect((await manager.getOrganizationAccessPolicy('org_beta')).sessionIdleTimeoutMinutes).toBe(0);
    await settings.setMany('access_policy', { session_idle_timeout_minutes: 5 }, { tenantId: ORG });
    await vi.waitFor(async () => expect((await manager.getOrganizationAccessPolicy(ORG)).sessionIdleTimeoutMinutes).toBe(5));
  });
});

describe('the toggle-era values move onto the levels', () => {
  /** The `auth` manifest as it stood when `mfa_required` was a toggle. */
  const toggleEraAuth = (): SettingsManifest => {
    const current = manifest('auth') as any;
    return {
      ...current,
      specifiers: current.specifiers.map((s: any) =>
        s.key === 'mfa_required' ? { type: 'toggle', key: 'mfa_required', label: s.label, required: false, default: false } : s,
      ),
    } as SettingsManifest;
  };

  it('a stored auth.mfa_required toggle becomes a level, once', async () => {
    for (const [stored, level] of [[true, 'everyone'], [false, 'off']] as const) {
      const settings = new SettingsService({ env: {} });
      settings.registerManifest(toggleEraAuth());
      await settings.set('auth', 'mfa_required', stored, {});
      settings.registerManifest(manifest('auth'));
      const deps = { settings: settings as any, manager: authManager(), engine: () => undefined, security: () => undefined, logger: logger() };
      expect(await migrateLegacyMfaRequiredSetting(deps)).toBe('moved');
      expect((await settings.get('auth', 'mfa_required')).value).toBe(level);
      expect(await migrateLegacyMfaRequiredSetting(deps)).toBe('none');
    }
  });

  it('an organization that required MFA carries it as "everyone", and its column is cleared after the row lands', async () => {
    const settings = settingsService();
    const rows: any[] = [
      { id: ORG, require_mfa: true },
      { id: 'org_set', require_mfa: true },
      { id: 'org_off', require_mfa: false },
    ];
    const engine = {
      find: vi.fn(async (_obj: string, q: any) => rows.filter((r) => r.require_mfa === q.where.require_mfa)),
      update: vi.fn(async (_obj: string, patch: any) => Object.assign(rows.find((r) => r.id === patch.id), patch)),
    };
    // An organization that already chose a level keeps it.
    await settings.set('access_policy', 'mfa_required', 'administrators', { tenantId: 'org_set' });
    const deps = { settings: settings as any, manager: authManager(), engine: () => engine, security: () => undefined, logger: logger() };

    expect(await migrateLegacyOrganizationRequireMfa(deps)).toEqual({ moved: 2, failed: 0 });
    expect((await settings.get('access_policy', 'mfa_required', { tenantId: ORG })).value).toBe('everyone');
    expect((await settings.get('access_policy', 'mfa_required', { tenantId: 'org_set' })).value).toBe('administrators');
    expect((await settings.get('access_policy', 'mfa_required', { tenantId: 'org_off' })).value).toBe('off');
    expect(rows.map((r) => r.require_mfa)).toEqual([false, false, false]);
    // Convergent: a second boot finds nothing to move.
    expect(await migrateLegacyOrganizationRequireMfa(deps)).toEqual({ moved: 0, failed: 0 });
  });

  it('a move whose settings write fails leaves the column for the next boot and says so at error', async () => {
    const rows: any[] = [{ id: ORG, require_mfa: true }];
    const engine = { find: vi.fn(async () => rows), update: vi.fn() };
    const settings = {
      get: vi.fn(async () => ({ value: 'off', source: 'default' })),
      getNamespace: vi.fn(),
      set: vi.fn(async () => {
        throw new Error('store down');
      }),
    };
    const log = logger();
    expect(
      await migrateLegacyOrganizationRequireMfa({ settings, manager: authManager(), engine: () => engine, security: () => undefined, logger: log }),
    ).toEqual({ moved: 0, failed: 1 });
    expect(engine.update).not.toHaveBeenCalled();
    expect(rows[0].require_mfa).toBe(true);
    expect(log.error).toHaveBeenCalledTimes(1);
  });
});
