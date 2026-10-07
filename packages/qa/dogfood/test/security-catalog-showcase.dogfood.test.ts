// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// ADR-0131 D2–D4 — the security catalog read (`createSecurityCatalogReader`,
// `@objectstack/core`) over a booted showcase, in three postures: `single`,
// `single` with the Default Organization, and walled.
//
// What it pins: per catalog type, the names the read lists are EXACTLY the
// names the declarations declare — the showcase stack's `positions`,
// `permissions` and `capabilities`, plus the platform's own bootstrap
// permission sets that `plugin-security` ships — and exactly the names the
// metadata door lists (`GET /api/v1/meta/:type`). Every listed name resolves,
// by name, to the entry the list gave for it.
//
// Why both halves. The expected sets are derived from the PRODUCERS (the stack
// object and `securityDefaultPermissionSets`), never from a registry, so a
// reader that stops seeing one source goes red here even when the door loses
// the same source alongside it. The door half says the read serves the
// catalog a metadata author sees, no more and no less.
//
// What it does NOT pin: which in-process reader holds which name (the engine
// registry holds the permission sets, the metadata service the stack-declared
// positions, both the capabilities — see the module doc). That is today's
// distribution, not the read's contract; a position reaching the engine
// registry one day must not turn this file red.
//
// The walled arm boots `multiTenant: 'posture-only'`: a real, non-degraded
// `isolated` posture with no organization wall. The catalog is
// environment-level (ADR-0131 D3), so the wall is not this read's subject; the
// same sets were measured on a boot with the real organizations package
// declared by its host root.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { bootStack, type VerifyStack } from '@objectstack/verify';
import showcaseStack from '@objectstack/example-showcase';
import { securityDefaultPermissionSets } from '@objectstack/plugin-security';
import { createSecurityCatalogReader, type SecurityCatalogType } from '@objectstack/core';

type Named = { name?: unknown };
const namesOf = (items: unknown): string[] =>
  (Array.isArray(items) ? (items as Named[]) : [])
    .map((i) => i?.name)
    .filter((n): n is string => typeof n === 'string')
    .sort();

const stack = showcaseStack as unknown as {
  positions?: Named[];
  permissions?: Named[];
  capabilities?: Named[];
};

/** The declared catalog, read off the producers — never off a registry. */
const DECLARED: Record<SecurityCatalogType, string[]> = {
  position: namesOf(stack.positions),
  permission: [...new Set([...namesOf(stack.permissions), ...namesOf(securityDefaultPermissionSets)])].sort(),
  capability: namesOf(stack.capabilities),
};

const TYPES: SecurityCatalogType[] = ['position', 'permission', 'capability'];

const POSTURES = [
  { label: 'single', opts: {}, posture: 'single' },
  { label: 'single with the Default Organization', opts: { orgContext: true }, posture: 'single' },
  { label: 'walled', opts: { multiTenant: 'posture-only' as const }, posture: 'isolated' },
] as const;

it('PRECONDITION: the declarations name a catalog in every type, the platform administrator set among them', () => {
  for (const type of TYPES) expect(DECLARED[type].length, type).toBeGreaterThan(0);
  expect(DECLARED.permission).toContain('admin_full_access');
});

describe.each(POSTURES)('showcase, $label: the security catalog read', ({ opts, posture }) => {
  let booted: VerifyStack;
  let admin: string;
  let reader: ReturnType<typeof createSecurityCatalogReader>;

  beforeAll(async () => {
    booted = await bootStack(showcaseStack as Parameters<typeof bootStack>[0], opts);
    admin = await booted.signIn();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ql: any = await booted.kernel.getServiceAsync('objectql');
    reader = createSecurityCatalogReader({ registry: ql.registry, metadata: booted.kernel.getService('metadata') });
  }, 180_000);

  afterAll(async () => {
    await booted?.stop();
  });

  it('PRECONDITION: the boot runs the posture this arm names', () => {
    expect(booted.tenancy().requestedPosture).toBe(posture);
  });

  it.each(TYPES)('%s: lists exactly the declared names', async (type) => {
    const listed = (await reader.list(type)).map((e) => e.name).sort();
    expect(listed).toEqual(DECLARED[type]);
  });

  it.each(TYPES)('%s: lists exactly the names the metadata door lists', async (type) => {
    const res = await booted.apiAs(admin, 'GET', `/meta/${type}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items?: unknown } | unknown[];
    const door = namesOf(Array.isArray(body) ? body : body.items);
    expect((await reader.list(type)).map((e) => e.name).sort()).toEqual(door);
  });

  it.each(TYPES)('%s: every listed name resolves by name to the entry the list gave', async (type) => {
    for (const entry of await reader.list(type)) {
      expect(await reader.resolve(type, entry.name)).toEqual(entry);
    }
  });
});
