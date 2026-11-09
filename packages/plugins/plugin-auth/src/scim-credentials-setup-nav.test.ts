// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#31123] The Setup entry that reaches `sys_scim_connection_credential`, the
 * object the console's Mint / Revoke Credential actions live on.
 *
 * plugin-auth contributes it (owning-plugin-contributes, ADR-0029 K2) beside
 * the SSO Providers entry, and ONLY while SCIM is wired: the one decision
 * `authManager.isScimWired()` makes, which is also what keeps the
 * `/admin/scim/mint-credential` door from answering 503. With SCIM off the
 * entry would open a list whose Mint button can only fail, so it is absent.
 *
 * Read off the manifest `init()` registers, the same object the Setup app
 * merges contributions from.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PluginContext } from '@objectstack/core';
import { AuthPlugin } from './auth-plugin';
import type { AuthPluginOptions } from './auth-plugin';

const SECRET = 'test-secret-at-least-32-chars-long!!';
const ENV_KEYS = ['OS_SCIM_ENABLED', 'OS_SSO_ENABLED'] as const;

type NavItem = { id: string; type: string; label: string; objectName?: string; requiredPermissions?: string[] };
type NavContribution = { app: string; group: string; priority?: number; items: NavItem[] };

/** Boot `init()` and hand back the `navigationContributions` it registered. */
async function contributionsFor(plugins: AuthPluginOptions['plugins']): Promise<NavContribution[] | undefined> {
  const register = vi.fn();
  const ctx = {
    registerService: vi.fn(),
    getService: vi.fn((name: string) => (name === 'manifest' ? { register } : undefined)),
    getServices: vi.fn(() => new Map()),
    hook: vi.fn(),
    trigger: vi.fn(),
    logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
    getKernel: vi.fn(),
  } as unknown as PluginContext;
  await new AuthPlugin({ secret: SECRET, plugins: { oidcProvider: false, ...plugins } }).init(ctx);
  expect(register).toHaveBeenCalledTimes(1);
  return register.mock.calls[0][0].navigationContributions;
}

const navItems = (contributions: NavContribution[] | undefined): NavItem[] =>
  (contributions ?? []).flatMap((c) => c.items);

describe('[#31123] the SCIM Credentials Setup entry follows isScimWired()', () => {
  const saved: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>> = {};
  beforeEach(() => {
    for (const key of ENV_KEYS) {
      saved[key] = process.env[key];
      delete process.env[key];
    }
  });
  afterEach(() => {
    for (const key of ENV_KEYS) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  });

  it('is contributed to Setup > Access Control, platform-admin gated, when SCIM is wired', async () => {
    const contributions = await contributionsFor({ scim: true });
    const entry = navItems(contributions).find((item) => item.id === 'nav_scim_credentials');
    expect(entry).toEqual({
      id: 'nav_scim_credentials',
      type: 'object',
      label: 'SCIM Credentials',
      objectName: 'sys_scim_connection_credential',
      icon: 'key-round',
      // The SSO Providers entry's gate; the mint and revoke doors keep their own.
      requiredPermissions: ['manage_platform_settings'],
    });
    const owner = contributions!.find((c) => c.items.some((item) => item.id === 'nav_scim_credentials'))!;
    expect(owner).toMatchObject({ app: 'setup', group: 'group_access_control' });
  });

  it('is contributed when OS_SCIM_ENABLED wires SCIM and the config leaves it unset', async () => {
    process.env.OS_SCIM_ENABLED = 'true';
    expect(navItems(await contributionsFor({})).map((item) => item.id)).toContain('nav_scim_credentials');
  });

  it('is absent when SCIM is not wired, and no other Setup entry is contributed in its place', async () => {
    expect(navItems(await contributionsFor({})).map((item) => item.id)).not.toContain('nav_scim_credentials');
    expect(navItems(await contributionsFor({ scim: false })).map((item) => item.id)).toEqual([]);
  });

  it('asks the manager the same question the mint door asks', async () => {
    const { AuthManager } = await import('./auth-manager');
    const wired = vi.spyOn(AuthManager.prototype, 'isScimWired').mockReturnValue(false);
    try {
      // The config says on; the manager's one answer says off, and that answer wins.
      expect(navItems(await contributionsFor({ scim: true })).map((item) => item.id)).not.toContain(
        'nav_scim_credentials',
      );
      expect(wired).toHaveBeenCalled();
    } finally {
      wired.mockRestore();
    }
  });

  it('sits after SSO Providers when both are wired, and leaves the SSO entry as it was', async () => {
    const contributions = await contributionsFor({ scim: true, sso: true });
    const ids = navItems(contributions).map((item) => item.id);
    expect(ids).toEqual(['nav_sso_providers', 'nav_scim_credentials']);
    expect(navItems(contributions)[0]).toEqual({
      id: 'nav_sso_providers',
      type: 'object',
      label: 'SSO Providers',
      objectName: 'sys_sso_provider',
      icon: 'log-in',
      requiredPermissions: ['manage_platform_settings'],
    });
  });

  it('SSO alone still contributes only SSO Providers', async () => {
    expect(navItems(await contributionsFor({ sso: true })).map((item) => item.id)).toEqual(['nav_sso_providers']);
  });
});
