// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * ADR-0069 D3 on the better-auth `admin` plugin's lane: every route the
 * installed plugin registers is classified for a held caller, none forgotten.
 *
 * `VENDOR_ROLE_SCALAR_ADMIN_PATHS` (`admin-impersonate-endpoint.ts`) is the set
 * the global before-hook holds: the routes the vendor serves itself and
 * authorizes on a session plus the legacy `role` scalar. Every OTHER route the
 * plugin registers must be accounted for below, with the reason it is not in
 * that set. A vendor bump that adds a route turns this file red until someone
 * decides whether a held caller may reach it — the decision is never made by
 * omission, which is how a held platform admin kept reaching impersonation.
 *
 * The behaviour itself — each door refusing a held caller with the session
 * gate's code, and the unheld controls — is pinned on a real boot in
 * `@objectstack/verify` (`held-session-vendor-admin-doors.pin.test.ts`).
 */

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import { admin } from 'better-auth/plugins/admin';
import { buildAdminPluginSchema } from './auth-schema-config.js';
import { VENDOR_ROLE_SCALAR_ADMIN_PATHS } from './admin-impersonate-endpoint.js';
import { IMPERSONATE_USER_PATH, STOP_IMPERSONATING_PATH } from './impersonation-bearer-rotation.js';

const HERE = dirname(fileURLToPath(import.meta.url));

/**
 * Paths an ObjectStack raw mount serves ahead of the vendor, after
 * `judgePlatformAdmin` (which refuses a held session). Proven below by the
 * mount's own registration line in `auth-plugin.ts`.
 */
const JUDGED_BY_AN_OBJECTSTACK_MOUNT: readonly string[] = [
  '/admin/create-user',
  '/admin/set-user-password',
  '/admin/ban-user',
  '/admin/unban-user',
  '/admin/remove-user',
];

/** Every other path, with the reason a held caller is not refused at the hook. */
const NOT_HELD_AT_THE_HOOK: Readonly<Record<string, string>> = {
  [IMPERSONATE_USER_PATH]: 'its own door: the re-authorized endpoint refuses a held caller in its handler',
  [STOP_IMPERSONATING_PATH]: 'the exit from an impersonation, carried by the impersonated session (like sign-out)',
  '/admin/has-permission': 'a question that changes nothing and refuses no one',
};

const installedAdminPaths = (): string[] => {
  const plugin: any = admin({ schema: buildAdminPluginSchema() } as any);
  return Object.values(plugin.endpoints as Record<string, { path: string }>).map((e) => e.path).sort();
};

describe('ADR-0069 D3 — the admin plugin lane, classified for a held caller', () => {
  it('classifies every path the installed admin plugin registers, exactly once', () => {
    const classified = [
      ...VENDOR_ROLE_SCALAR_ADMIN_PATHS,
      ...JUDGED_BY_AN_OBJECTSTACK_MOUNT,
      ...Object.keys(NOT_HELD_AT_THE_HOOK),
    ];
    // Disjoint: a path in two classes is a decision made twice.
    expect(new Set(classified).size).toBe(classified.length);
    const unclassified = installedAdminPaths().filter((p) => !classified.includes(p));
    expect(
      unclassified,
      'an admin-plugin route nobody decided for: hold it (VENDOR_ROLE_SCALAR_ADMIN_PATHS) or classify it here with its reason',
    ).toEqual([]);
  });

  it('names no path the installed plugin does not serve (a stale entry holds nothing)', () => {
    const installed = installedAdminPaths();
    const stale = [...VENDOR_ROLE_SCALAR_ADMIN_PATHS, ...JUDGED_BY_AN_OBJECTSTACK_MOUNT].filter(
      (p) => !installed.includes(p),
    );
    expect(stale).toEqual([]);
  });

  it('holds the vendor role-scalar actions the boot measured admitting a held caller', () => {
    expect([...VENDOR_ROLE_SCALAR_ADMIN_PATHS].sort()).toEqual([
      '/admin/get-user',
      '/admin/list-user-sessions',
      '/admin/list-users',
      '/admin/revoke-user-session',
      '/admin/revoke-user-sessions',
      '/admin/set-role',
      '/admin/update-user',
    ]);
  });

  it('every mount-judged path really is an ObjectStack mount that runs the judge first', () => {
    const source = readFileSync(resolve(HERE, 'auth-plugin.ts'), 'utf8');
    for (const path of JUDGED_BY_AN_OBJECTSTACK_MOUNT) {
      const mount = source.indexOf(`rawApp.post(\`\${basePath}${path}\``);
      expect(mount, `no raw mount for ${path} in auth-plugin.ts`).toBeGreaterThan(-1);
      // The judge is the mount's first act (within its opening lines).
      expect(source.slice(mount, mount + 400), `${path}'s mount does not open with gateAdmin`).toMatch(
        /await gateAdmin\(c\)/,
      );
    }
  });
});
