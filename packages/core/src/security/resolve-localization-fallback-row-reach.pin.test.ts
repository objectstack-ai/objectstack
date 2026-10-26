// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0131 D8] The direct localization fallback compares every row it is
 * handed against the caller's reach — core security's row predicate
 * (`organizationReachAdmits`), the one `SettingsService` judges its rows with —
 * so an engine that drops the organization condition can hand it neither
 * another organization's row nor a row written with no organization.
 *
 * `resolve-localization-fallback-organization.pin.test.ts` pins the reach the
 * fallback reads with; this file pins the second comparison against the row
 * shape that file's filter-dropping case does not carry: the row with no
 * organization, stored FIRST, where a first-row pick would take it.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { resolveLocalizationContext } from './resolve-authz-context.js';

type Row = Record<string, unknown>;

const tz = (organization_id: string | null, value: string): Row => ({
  namespace: 'localization',
  key: 'timezone',
  scope: 'tenant',
  value,
  ...(organization_id === null ? {} : { organization_id }),
});

/** An engine that ignores every `where` it is handed and answers the whole table. */
function filterDroppingQl(tables: Record<string, Row[]>, opts: { organizationObject?: boolean } = {}) {
  return {
    registry: {
      getObject: (name: string) =>
        name === 'sys_organization' && opts.organizationObject === false ? undefined : { name },
    },
    find: async (object: string, options: any) => {
      const rows = tables[object] ?? [];
      return typeof options?.limit === 'number' ? rows.slice(0, options.limit) : rows;
    },
  };
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('[ADR-0131 D8] the fallback judges each row it is handed, not only the query', () => {
  it('a caller naming its organization never takes the row with no organization, stored first', async () => {
    const ql = filterDroppingQl({
      sys_organization: [{ id: 'org_a' }, { id: 'org_b' }],
      sys_setting: [tz(null, 'America/New_York'), tz('org_b', 'Asia/Tokyo'), tz('org_a', 'Europe/Paris')],
    });
    expect((await resolveLocalizationContext({ ql, organizationId: 'org_a' })).timezone).toBe('Europe/Paris');
  });

  it('with no row of its own, that caller gets the built-in default — neither foreign row', async () => {
    const ql = filterDroppingQl({
      sys_organization: [{ id: 'org_a' }, { id: 'org_c' }],
      sys_setting: [tz(null, 'America/New_York'), tz('org_a', 'Europe/Paris')],
    });
    expect((await resolveLocalizationContext({ ql, organizationId: 'org_c' })).timezone).toBe('UTC');
  });

  it('the lean embedding takes only the row with no organization, behind another organization\'s', async () => {
    vi.stubEnv('OS_TENANCY_POSTURE', 'single');
    const ql = filterDroppingQl(
      { sys_setting: [tz('org_a', 'Europe/Paris'), tz(null, 'America/New_York')] },
      { organizationObject: false },
    );
    expect((await resolveLocalizationContext({ ql })).timezone).toBe('America/New_York');
  });
});
