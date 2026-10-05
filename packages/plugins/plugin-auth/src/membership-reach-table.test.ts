// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The spec's membership reach table (`MEMBERSHIP_REACH`,
 * `@objectstack/spec/identity`) pinned EQUAL to the door it describes.
 *
 * The table says which membership grades reach which better-auth organization
 * endpoint, and the `requiresMembershipReach` action sugar lowers it into the
 * `visible` predicate the console evaluates. A row that disagrees with the
 * server fails one of two ways, both silent: a button offered to a grade the
 * endpoint refuses (the 403 the table exists to stop offering), or a button
 * hidden from a grade the endpoint admits. So the table is not trusted — it is
 * recomputed here, per row, from the two things the door actually reads:
 *
 *  1. THE ROLES MAP plugin-auth hands better-auth — read off the organization
 *     plugin's real constructor options, not rebuilt in this file. It is
 *     better-auth's own `defaultRoles` plus the `delegated_admin` registration
 *     (`customOrgRoles` in auth-manager.ts). Each grade's statements are asked
 *     through the vendor's own `authorize`, the call `hasPermission` makes.
 *  2. THE STATEMENT each endpoint checks — read off the installed vendor route
 *     source, so a vendor bump that changes which statement an endpoint's
 *     `hasPermission` call names turns this red instead of leaving a row stale.
 *     The creator-role rule (better-auth refuses to SET the creator role unless
 *     the caller holds it; default `owner`) is read the same way.
 *
 * Only `better-auth` itself and the organization plugin's factory are mocked,
 * exactly as auth-manager.test.ts does; the access-control module is the real
 * one, so the roles compared here are the objects the vendor would evaluate.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  BUILTIN_MEMBERSHIP_ROLES,
  MEMBERSHIP_REACH,
  type MembershipReachName,
} from '@objectstack/spec/identity';
import { AuthManager } from './auth-manager';

vi.mock('better-auth', () => ({
  betterAuth: vi.fn(() => ({ handler: vi.fn(), api: {} })),
}));
vi.mock('better-auth/plugins/organization', () => ({
  organization: vi.fn((opts: any) => ({ id: 'organization', _opts: opts })),
}));
vi.mock('better-auth/plugins/two-factor', () => ({
  twoFactor: vi.fn((opts: any) => ({ id: 'two-factor', _opts: opts })),
}));
vi.mock('better-auth/plugins/magic-link', () => ({
  magicLink: vi.fn(() => ({ id: 'magic-link' })),
}));
vi.mock('better-auth/plugins/custom-session', () => ({
  customSession: vi.fn((fn: any) => ({ id: 'custom-session', _fn: fn })),
}));
vi.mock('better-auth/plugins/haveibeenpwned', () => ({
  haveIBeenPwned: vi.fn((opts: any) => ({ id: 'have-i-been-pwned', _opts: opts })),
}));

import { betterAuth } from 'better-auth';

type Role = { authorize: (request: Record<string, string[]>) => { success: boolean }; statements: Record<string, string[]> };

/** The installed vendor's organization route sources, one text per route file. */
function vendorRouteSources(): string[] {
  const accessEntry = createRequire(import.meta.url).resolve('better-auth/plugins/organization/access');
  const routesDir = join(dirname(accessEntry), '..', 'routes');
  return readdirSync(routesDir)
    .filter((f) => f.endsWith('.mjs'))
    .map((f) => readFileSync(join(routesDir, f), 'utf8'));
}

/**
 * Each pathed endpoint's handler slice — from its `createAuthEndpoint("<path>"`
 * to the next endpoint declaration in the same file. A server-only endpoint
 * (declared with no path) has no slice, which is exactly right: it is no HTTP
 * door.
 */
function endpointSlices(sources: string[]): Map<string, string> {
  const slices = new Map<string, string>();
  for (const source of sources) {
    for (const m of source.matchAll(/createAuthEndpoint\(\s*"(\/organization\/[a-z-]+)"/g)) {
      const next = source.indexOf('createAuthEndpoint(', m.index! + m[0].length);
      slices.set(m[1], source.slice(m.index!, next === -1 ? source.length : next));
    }
  }
  return slices;
}

/** Every `permissions: { <resource>: ["<action>"] }` statement a slice checks. */
function checkedStatements(slice: string): string[] {
  return [...slice.matchAll(/permissions:\s*\{\s*([a-z]+):\s*\[\s*"([a-z]+)"\s*\]\s*\}/g)].map((m) => `${m[1]}:${m[2]}`);
}

describe('MEMBERSHIP_REACH equals the door plugin-auth configures', () => {
  const prevMcpEnv = process.env.OS_MCP_SERVER_ENABLED;
  let roles: Record<string, Role>;
  let creatorRoleOption: unknown;
  let slices: Map<string, string>;

  beforeAll(async () => {
    // The MCP surface is default-ON and would append jwt + oauth-provider;
    // pinned off as in auth-manager.test.ts — it has nothing to do with org roles.
    process.env.OS_MCP_SERVER_ENABLED = 'false';
    let captured: any;
    (betterAuth as any).mockImplementation((config: any) => {
      captured = config;
      return { handler: vi.fn(), api: {} };
    });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const manager = new AuthManager({
      secret: 'test-secret-at-least-32-chars-long',
      baseUrl: 'http://localhost:3000',
      plugins: { organization: true },
    });
    await manager.getAuthInstance();
    warn.mockRestore();
    const orgPlugin = captured.plugins.find((p: any) => p.id === 'organization');
    roles = orgPlugin._opts.roles;
    creatorRoleOption = orgPlugin._opts.creatorRole;
    slices = endpointSlices(vendorRouteSources());
  });

  afterAll(() => {
    if (prevMcpEnv === undefined) delete process.env.OS_MCP_SERVER_ENABLED;
    else process.env.OS_MCP_SERVER_ENABLED = prevMcpEnv;
  });

  it('the roles map registers exactly the closed membership vocabulary', () => {
    // Every grade the table can name is judged by a REAL registered role; a
    // grade missing from the map would authorize nothing and read as "no reach".
    expect(roles).toBeDefined();
    expect(Object.keys(roles).sort()).toEqual([...BUILTIN_MEMBERSHIP_ROLES].sort());
  });

  it('the route reader sees the vendor endpoints — guards the extraction itself', () => {
    // A reader gone blind would make every per-row statement check below fail
    // as "no slice" rather than pass, but pin the floor so the failure names
    // the reader, not the table.
    expect(slices.size).toBeGreaterThanOrEqual(20);
    expect(checkedStatements(slices.get('/organization/invite-member') ?? '')).toEqual(['invitation:create']);
  });

  it('plugin-auth leaves the creator role at the vendor default, and the vendor default is owner', () => {
    expect(creatorRoleOption).toBeUndefined();
    expect(slices.get('/organization/update-member-role') ?? '').toContain('creatorRole || "owner"');
  });

  const rows = Object.entries(MEMBERSHIP_REACH) as Array<[MembershipReachName, (typeof MEMBERSHIP_REACH)[MembershipReachName]]>;

  it.each(rows)('%s: the endpoint is a vendor HTTP door checking exactly the row’s statement', (_name, row) => {
    const slice = slices.get(row.endpoint);
    expect(slice, `${row.endpoint} is a pathed vendor endpoint`).toBeDefined();
    expect(checkedStatements(slice!)).toEqual([`${row.statement.resource}:${row.statement.action}`]);
  });

  it.each(rows)('%s: the grades equal the ones whose registered statements pass that check', (_name, row) => {
    const creatorRole = typeof creatorRoleOption === 'string' ? creatorRoleOption : 'owner';
    const admitted = BUILTIN_MEMBERSHIP_ROLES.filter((grade) => {
      const statementPasses = roles[grade].authorize({ [row.statement.resource]: [row.statement.action] }).success;
      const creatorRulePasses = !('creatorRoleOnly' in row && row.creatorRoleOnly) || grade === creatorRole;
      return statementPasses && creatorRulePasses;
    });
    const declared = BUILTIN_MEMBERSHIP_ROLES.filter((grade) => (row.grades as readonly string[]).includes(grade));
    expect(declared).toEqual(admitted);
    // The table lists no grade outside the vocabulary (the filter above would hide one).
    expect(row.grades.length).toBe(declared.length);
  });
});
