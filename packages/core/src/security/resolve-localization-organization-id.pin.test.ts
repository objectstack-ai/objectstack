// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `ResolveLocalizationInput` names the organization it localizes for
 * `organizationId`, and nothing else.
 *
 * The key used to be spelled `tenantId`. It always meant the ORGANIZATION id —
 * the tenant rung the settings service stores `localization` under (ADR-0131
 * D8) — but the name did not say so, and an integrator passed the ENVIRONMENT
 * id there from three AI entry points: every hosted environment then resolved
 * its organization's timezone as `UTC`, and nothing failed. The rename makes
 * the mistake unspellable: the old key is an excess-property error at every
 * object-literal call, and the resolver reads no alias for it at run time.
 *
 * Two halves, both needed:
 *
 *  1. the TYPE — `tenantId` is refused by the compiler (the `@ts-expect-error`
 *     below is read by `tsconfig.test.json`, which compiles this file);
 *  2. the RUNTIME — the organization's timezone resolves through
 *     `organizationId` on both legs (the settings service and the direct
 *     `sys_setting` fallback), and a `tenantId` smuggled past the compiler
 *     reaches neither.
 */
import { describe, expect, it } from 'vitest';
import { resolveLocalizationContext, type ResolveLocalizationInput } from './resolve-authz-context.js';

type Row = Record<string, unknown>;

/** A settings service double answering `localization.timezone` per organization, recording each scope. */
function makeSettings(timezoneByOrganization: Record<string, string>) {
  const scopes: Array<Record<string, unknown>> = [];
  return {
    scopes,
    get: async () => undefined,
    getMany: async (_namespace: string, _keys: string[], scope: Record<string, unknown>) => {
      scopes.push(scope);
      const tz = timezoneByOrganization[String(scope.tenantId)];
      return { timezone: tz ? { value: tz } : undefined, locale: undefined, currency: undefined };
    },
  };
}

/** An engine double holding one tenant `sys_setting` row per organization. */
function makeQl(timezoneByOrganization: Record<string, string>) {
  const rows: Row[] = Object.entries(timezoneByOrganization).map(([organization_id, value]) => ({
    namespace: 'localization',
    key: 'timezone',
    scope: 'tenant',
    organization_id,
    value,
  }));
  return {
    registry: { getObject: (name: string) => ({ name }) },
    find: async (object: string, options: any) => {
      if (object !== 'sys_setting') return [];
      const where = options?.where ?? {};
      return rows.filter((r) => r.organization_id === where.organization_id);
    },
  };
}

const ORGANIZATIONS = { org_sh: 'Asia/Shanghai', org_paris: 'Europe/Paris' };

describe('ResolveLocalizationInput.organizationId — the type', () => {
  it('refuses the retired `tenantId` key at compile time', () => {
    const input: ResolveLocalizationInput = {
      ql: undefined,
      // @ts-expect-error -- `tenantId` was renamed `organizationId`, with no alias.
      tenantId: 'org_sh',
    };
    expect(input).toBeDefined();
  });
});

describe('ResolveLocalizationInput.organizationId — the runtime', () => {
  it('resolves the organization timezone through the settings service, scoped by organizationId', async () => {
    const settings = makeSettings(ORGANIZATIONS);
    const loc = await resolveLocalizationContext({ ql: undefined, settings, organizationId: 'org_sh', userId: 'u1' });
    expect(loc.timezone).toBe('Asia/Shanghai');
    // The settings service's own scope keeps its `tenantId` spelling; the value is the organization id.
    expect(settings.scopes).toEqual([{ tenantId: 'org_sh', userId: 'u1' }]);
  });

  it('resolves the organization timezone through the direct sys_setting fallback, scoped by organizationId', async () => {
    const loc = await resolveLocalizationContext({ ql: makeQl(ORGANIZATIONS), organizationId: 'org_paris' });
    expect(loc.timezone).toBe('Europe/Paris');
  });

  it('reads no `tenantId` alias: a value smuggled past the compiler reaches neither leg', async () => {
    const settings = makeSettings(ORGANIZATIONS);
    const smuggled = { ql: undefined, settings, tenantId: 'org_sh', userId: 'u1' } as unknown as ResolveLocalizationInput;
    const loc = await resolveLocalizationContext(smuggled);
    expect(settings.scopes).toEqual([{ tenantId: undefined, userId: 'u1' }]);
    expect(loc.timezone).toBe('UTC');
  });
});
