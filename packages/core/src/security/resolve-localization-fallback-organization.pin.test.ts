// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0131 D8/D9] `resolveLocalizationContext`'s DIRECT `sys_setting`
 * fallback — the read taken when the settings service is absent or throws —
 * draws on the caller's organization's rows only, the reach the settings
 * service itself reads with:
 *
 *  - a caller that names organization X reads X's rows, under every posture;
 *  - a caller that names none reads the organization D9 derives under
 *    `single`, and nothing behind a wall, at zero or several organizations, or
 *    when the derivation cannot be asked;
 *  - a row with no organization answers only a composition that registers no
 *    `sys_organization` (the lean embedding).
 *
 * Before this, the fallback read every organization's tenant rows and took the
 * first per key: a user of one organization was answered with another's
 * timezone / locale / currency whenever the settings service failed.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { resolveLocalizationContext } from './resolve-authz-context.js';
import { AuthzStoreUnavailableError } from './authz-store-unavailable.js';

type Row = Record<string, unknown>;

function matches(row: Row, where: Record<string, unknown> | undefined): boolean {
  if (!where) return true;
  return Object.entries(where).every(([field, cond]) => {
    if (field.startsWith('$')) throw new Error(`this double does not implement the where combinator ${field}`);
    const value = row[field] ?? null;
    if (cond !== null && typeof cond === 'object') {
      const operators = Object.keys(cond);
      if (operators.length !== 1 || operators[0] !== '$in') {
        throw new Error(`this double does not implement the where operator(s) ${operators.join(', ')} on ${field}`);
      }
      return (cond as any).$in.includes(value);
    }
    return value === (cond ?? null);
  });
}

/**
 * An engine double that applies the `where` it is handed (`null` matching an
 * absent column, as SQL `IS NULL`), records every `sys_setting` query, and
 * reports `sys_organization` registered unless told otherwise.
 */
function makeQl(
  tables: Record<string, Row[]>,
  opts: { organizationObject?: boolean } = {},
) {
  const settingQueries: Array<Record<string, unknown> | undefined> = [];
  const ql = {
    settingQueries,
    registry: {
      getObject: (name: string) =>
        name === 'sys_organization' && opts.organizationObject === false ? undefined : { name },
    },
    find: async (object: string, options: any) => {
      if (object === 'sys_setting') settingQueries.push(options?.where);
      const rows = (tables[object] ?? []).filter((r) => matches(r, options?.where));
      return typeof options?.limit === 'number' ? rows.slice(0, options.limit) : rows;
    },
  };
  return ql;
}

const tz = (organization_id: string | null, value: string): Row => ({
  namespace: 'localization',
  key: 'timezone',
  scope: 'tenant',
  value,
  ...(organization_id === null ? {} : { organization_id }),
});

/** Two organizations, each holding its own tenant row — the OTHER one first. */
const TWO_ORGS = {
  sys_organization: [{ id: 'org_a' }, { id: 'org_b' }],
  sys_setting: [tz('org_b', 'Asia/Tokyo'), tz('org_a', 'Europe/Paris')],
};

const throwingSettings = (error: unknown) => ({
  get: async () => { throw error; },
  getMany: async () => { throw error; },
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('the direct localization fallback reads the caller organization only (ADR-0131 D8)', () => {
  it('settings service absent: each organization reads its own row, never the first row of another', async () => {
    const ql = makeQl(TWO_ORGS);
    expect((await resolveLocalizationContext({ ql, tenantId: 'org_a' })).timezone).toBe('Europe/Paris');
    expect((await resolveLocalizationContext({ ql, tenantId: 'org_b' })).timezone).toBe('Asia/Tokyo');
    // The organization is in the query itself, not only compared afterwards.
    expect(ql.settingQueries.map((w) => w?.organization_id)).toEqual(['org_a', 'org_b']);
  });

  it('settings service throwing (the organization source\'s AuthzStoreUnavailableError) reads the same way', async () => {
    const settings = throwingSettings(new AuthzStoreUnavailableError('sys_organization', new Error('down')));
    const ql = makeQl(TWO_ORGS);
    expect((await resolveLocalizationContext({ ql, settings, tenantId: 'org_a' })).timezone).toBe('Europe/Paris');
  });

  it('an organization with no row of its own gets the built-in default, not another organization\'s row', async () => {
    const ql = makeQl({ sys_organization: [{ id: 'org_a' }, { id: 'org_c' }], sys_setting: [tz('org_a', 'Europe/Paris')] });
    expect((await resolveLocalizationContext({ ql, tenantId: 'org_c' })).timezone).toBe('UTC');
  });

  it('the organization is compared in memory too — an engine that drops the filter still cannot leak', async () => {
    const base = makeQl(TWO_ORGS);
    // Drops the organization condition, as an engine that ignored it would.
    const ql = { ...base, find: async (object: string, options: any) => {
      const { organization_id: _dropped, ...where } = options?.where ?? {};
      return base.find(object, { ...options, where });
    } };
    expect((await resolveLocalizationContext({ ql, tenantId: 'org_a' })).timezone).toBe('Europe/Paris');
  });

  it('a row with no organization is not an organization\'s fallback', async () => {
    const ql = makeQl({ sys_organization: [{ id: 'org_a' }], sys_setting: [tz(null, 'America/New_York')] });
    expect((await resolveLocalizationContext({ ql, tenantId: 'org_a' })).timezone).toBe('UTC');
  });
});

describe('a caller that names no organization (ADR-0131 D9)', () => {
  it('under `single` with one organization, reads the organization D9 derives', async () => {
    vi.stubEnv('OS_TENANCY_POSTURE', 'single');
    const ql = makeQl({
      sys_organization: [{ id: 'org_a' }],
      sys_setting: [tz(null, 'America/New_York'), tz('org_a', 'Europe/Paris')],
    });
    expect((await resolveLocalizationContext({ ql })).timezone).toBe('Europe/Paris');
  });

  it('under `single` with several organizations, reads nothing', async () => {
    vi.stubEnv('OS_TENANCY_POSTURE', 'single');
    const ql = makeQl({ ...TWO_ORGS, sys_setting: [...TWO_ORGS.sys_setting, tz(null, 'America/New_York')] });
    expect((await resolveLocalizationContext({ ql })).timezone).toBe('UTC');
    expect(ql.settingQueries).toEqual([]);
  });

  it('under `single` with no organization yet, reads nothing', async () => {
    vi.stubEnv('OS_TENANCY_POSTURE', 'single');
    const ql = makeQl({ sys_organization: [], sys_setting: [tz(null, 'America/New_York')] });
    expect((await resolveLocalizationContext({ ql })).timezone).toBe('UTC');
    expect(ql.settingQueries).toEqual([]);
  });

  for (const posture of ['isolated', 'group'] as const) {
    it(`behind a wall (\`${posture}\`), reads nothing — not even with one organization`, async () => {
      vi.stubEnv('OS_TENANCY_POSTURE', posture);
      const ql = makeQl({ sys_organization: [{ id: 'org_a' }], sys_setting: [tz('org_a', 'Europe/Paris'), tz(null, 'America/New_York')] });
      expect((await resolveLocalizationContext({ ql })).timezone).toBe('UTC');
      expect(ql.settingQueries).toEqual([]);
    });

    it(`behind a wall (\`${posture}\`), a caller that names its organization still reads its own row`, async () => {
      vi.stubEnv('OS_TENANCY_POSTURE', posture);
      const ql = makeQl(TWO_ORGS);
      expect((await resolveLocalizationContext({ ql, tenantId: 'org_b' })).timezone).toBe('Asia/Tokyo');
    });
  }

  it('an organization read that fails derives nothing and reads nothing — never a guess', async () => {
    vi.stubEnv('OS_TENANCY_POSTURE', 'single');
    const base = makeQl({ sys_organization: [{ id: 'org_a' }], sys_setting: [tz('org_a', 'Europe/Paris')] });
    const ql = { ...base, find: async (object: string, options: any) => {
      if (object === 'sys_organization') throw new Error('connection reset');
      return base.find(object, options);
    } };
    const settings = throwingSettings(new Error('settings down'));
    expect((await resolveLocalizationContext({ ql, settings })).timezone).toBe('UTC');
    expect(base.settingQueries).toEqual([]);
  });
});

describe('the lean embedding — no `sys_organization` registered (#25133 letter A)', () => {
  it('reads the rows written with no organization, and only those', async () => {
    const ql = makeQl(
      { sys_setting: [tz('org_a', 'Europe/Paris'), tz(null, 'America/New_York')] },
      { organizationObject: false },
    );
    expect((await resolveLocalizationContext({ ql })).timezone).toBe('America/New_York');
    expect(ql.settingQueries.map((w) => w?.organization_id)).toEqual([null]);
  });
});
