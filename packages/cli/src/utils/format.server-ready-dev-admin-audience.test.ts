// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, expect, it, vi } from 'vitest';
import { ADMIN_FULL_ACCESS_CAPABILITIES } from '@objectstack/spec/identity';
import { PLATFORM_CAPABILITY_NAMES } from '@objectstack/spec/security';
import { SETUP_APP, SETUP_NAV_CONTRIBUTIONS } from '@objectstack/platform-objects/apps';
import { SysUserDetailPage } from '@objectstack/platform-objects/pages';
import { printServerReady, type ServerReadyOptions } from './format.js';

/**
 * #17081 — the `🔑 Dev admin` line must say what that account SEES.
 *
 * ## The defect this pins shut
 *
 * `--seed-admin` (on by default in `os dev`) prints one credential, and it is
 * the ONLY one a first-run operator is given. It is also, by construction, the
 * account with every PLATFORM capability and no APP-declared one. In an app
 * that gates its apps/tabs/nav on `requiredPermissions` — a first-class
 * platform feature — that account resolves to an EMPTY navigation. A downstream
 * maintainer ran `pnpm dev`, signed in with the printed credential, and read the
 * empty shell as a broken product: 「我刚管理员登录进去,看不到 ATS 的左侧菜单」.
 * The app was correct; the banner had pointed them at the one account that sees
 * nothing, and said nothing about it.
 *
 * ## Why a wording pin is the right instrument here, unusually
 *
 * The repo's default is ⛔ don't pin prose. This file pins it because the words
 * ARE the deliverable: the change adds no branch, no key and no behaviour — the
 * only thing that can regress is the sentence. `DEV_ADMIN_BLOCK` below is
 * transcribed from a real render (see the PR body's before/after), not
 * regenerated from the implementation.
 *
 * ## The leg that stops the fix from becoming the defect
 *
 * ADR-0115's `:93` amendment is about a guard that branded a state where the
 * operator could not act on it. A banner that confidently names a route that
 * does not exist is the same defect wearing the fix's clothes. So the route the
 * sentence names — `Setup → Users`, then grant a permission set — is asserted
 * against the DECLARATIONS that make it reachable, from the packages that own
 * them, rather than re-spelled here:
 *
 *   1. `SETUP_APP.requiredPermissions` ⊆ the capabilities this very account
 *      holds — so the account we hand over can open the place we send it;
 *   2. the `Users` entry exists in the Setup nav and is itself ungated;
 *   3. the `sys_user` detail page carries the grant surface the sentence
 *      promises.
 *
 * Rename any of those and this file reddens, instead of the banner quietly
 * starting to lie.
 */

/** Strip SGR so assertions hold whether or not chalk colours this run. */
const SGR = new RegExp(String.fromCharCode(27) + '\\[[0-9;]*m', 'g');

function render(opts: Partial<ServerReadyOptions>): string[] {
  const lines: string[] = [];
  const spy = vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
    lines.push(args.join(' ').replace(SGR, ''));
  });
  try {
    printServerReady({
      externalBaseOrigin: 'http://localhost:4721',
      uiEnabled: true,
      consolePath: '/_console',
      isDev: true,
      pluginCount: 12,
      ...opts,
    } as ServerReadyOptions);
  } finally {
    spy.mockRestore();
  }
  return lines;
}

const SEEDED = { email: 'admin@objectos.ai', password: 'admin123' };

/**
 * The credential block, verbatim, as a real render emits it under NO_COLOR.
 *
 * ⛔ Do not regenerate this from `format.ts`. The first three entries are
 * byte-identical to what shipped before #17081 — the change APPENDS, it does
 * not restate — and that identity is asserted separately below.
 */
const DEV_ADMIN_BLOCK = [
  '',
  '  🔑  Dev admin: admin@objectos.ai / admin123',
  '      seeded on empty DB · dev only — do not use in production',
  '      platform admin — Setup, Studio and every record, but NO app-declared capability, so',
  '      an app that gates navigation on requiredPermissions may show it an empty menu; grant',
  '      it a permission set under Setup → Users, or sign in as an account your app seeds',
];

describe('#17081 — the dev-admin banner says what the account will and will not see', () => {
  it('renders the credential block verbatim, audience sentence included', () => {
    const lines = render({ seededAdmin: SEEDED });
    const start = lines.findIndex((l) => l.includes('Dev admin:'));
    expect(start).toBeGreaterThan(-1);
    expect(lines.slice(start - 1, start - 1 + DEV_ADMIN_BLOCK.length)).toEqual(DEV_ADMIN_BLOCK);
  });

  it('says what the account WILL see, what it will NOT, and where to get a scoped one', () => {
    const block = render({ seededAdmin: SEEDED }).join('\n');
    // WILL: the platform surfaces `admin_full_access` actually carries.
    expect(block).toContain('Setup, Studio and every record');
    // WILL NOT: the mechanism, named by the field an app author writes.
    expect(block).toContain('NO app-declared capability');
    expect(block).toContain('requiredPermissions');
    expect(block).toContain('empty menu');
    // The two routes out.
    expect(block).toContain('permission set under Setup → Users');
    expect(block).toContain('an account your app seeds');
  });

  it('appends only — the three pre-existing credential lines are unmoved', () => {
    const lines = render({ seededAdmin: SEEDED });
    const start = lines.findIndex((l) => l.includes('Dev admin:'));
    expect(lines.slice(start - 1, start + 2)).toEqual(DEV_ADMIN_BLOCK.slice(0, 3));
  });

  it('is silent when nothing was seeded — the qualification belongs to the event', () => {
    // ADR-0115 `:93`: "a warning about a non-event spends the attention the
    // real ones need". No seed ⇒ no credential ⇒ nothing to qualify.
    const lines = render({});
    expect(lines.some((l) => l.includes('Dev admin:'))).toBe(false);
    expect(lines.some((l) => l.includes('app-declared capability'))).toBe(false);
    expect(lines.some((l) => l.includes('Setup → Users'))).toBe(false);
  });
});

describe('#17081 — the claim and the route are the platform\'s own declarations', () => {
  const held = new Set<string>(ADMIN_FULL_ACCESS_CAPABILITIES.systemPermissions ?? []);

  it('"Setup, Studio" is what the seeded admin\'s permission set actually grants', () => {
    // Positive control first: the set is non-empty, so the membership
    // assertions below are reading something.
    expect(held.size).toBeGreaterThan(0);
    expect(held.has('setup.access')).toBe(true);
    expect(held.has('studio.access')).toBe(true);
    // "every record" — the `'*'` super-user bits on the same declaration.
    expect(ADMIN_FULL_ACCESS_CAPABILITIES.objects?.['*']?.viewAllRecords).toBe(true);
    expect(ADMIN_FULL_ACCESS_CAPABILITIES.objects?.['*']?.modifyAllRecords).toBe(true);
  });

  it('"NO app-declared capability" — every capability it holds is a platform built-in', () => {
    const notPlatform = [...held].filter((name) => !PLATFORM_CAPABILITY_NAMES.has(name));
    expect(notPlatform).toEqual([]);
    // Fabricated control: an app-declared capability is NOT a platform
    // built-in, so the filter above is capable of returning a name.
    expect(PLATFORM_CAPABILITY_NAMES.has('someapp.export_data')).toBe(false);
  });

  it('the route is reachable BY THIS ACCOUNT — Setup gates on a capability it holds', () => {
    expect(SETUP_APP.name).toBe('setup');
    const gate = SETUP_APP.requiredPermissions ?? [];
    expect(gate.length).toBeGreaterThan(0);
    expect(gate.filter((p) => !held.has(p))).toEqual([]);
  });

  it('"→ Users" is a real, ungated Setup entry on the object that carries the grant', () => {
    const entries = SETUP_NAV_CONTRIBUTIONS
      .filter((c) => c.app === 'setup')
      .flatMap((c) => c.items ?? []);
    const users = entries.find((i) => (i as { objectName?: string }).objectName === 'sys_user') as
      | { label?: unknown; requiredPermissions?: string[] }
      | undefined;
    expect(users).toBeDefined();
    expect(users!.label).toBe('Users');
    // Ungated: an operator holding only `setup.access` still sees the entry.
    expect(users!.requiredPermissions ?? []).toEqual([]);
    // …and the group anchor it lands in is ungated too.
    const group = (SETUP_APP.navigation ?? []).find((g) => g.id === 'group_people_org');
    expect(group).toBeDefined();
    expect((group as { requiredPermissions?: string[] }).requiredPermissions ?? []).toEqual([]);
  });

  it('"grant it a permission set" is a surface the sys_user page really offers', () => {
    const page = JSON.stringify(SysUserDetailPage);
    expect(page).toContain('sys_user_permission_set');
    expect(page).toContain('Grant permission set');
    // Fabricated control: the same haystack does not answer to an invented name.
    expect(page).not.toContain('Grant fabricated permission set');
  });
});
