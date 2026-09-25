// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#18783] `buildEffectiveObjectPermissions` — the ONE function behind the
 * `/auth/me/permissions` `objects` slot and `ISecurityService.getEffectiveObjectPermissions`.
 *
 * The four folds it composes keep their own pin batteries where they were
 * written (plugin-hono-server's `fold-wildcard-superuser.test.ts` and
 * `effective-api-operations.test.ts`, which exercise them through that
 * package's unchanged re-exports). What is pinned HERE is the composition:
 * the merge rule, the order, the guards, and that the result aliases nothing.
 */

import { describe, it, expect } from 'vitest';
import { buildEffectiveObjectPermissions } from './effective-object-permissions.js';

describe('buildEffectiveObjectPermissions', () => {
  it('merges most-permissively: `true` wins, otherwise the first defined value stands', () => {
    const map: any = buildEffectiveObjectPermissions([
      { objects: { deal: { allowRead: true, allowEdit: false } } },
      { objects: { deal: { allowEdit: true, allowDelete: false } } },
      { objects: { deal: { allowDelete: true, allowCreate: false } } },
      { objects: undefined },
      null,
    ]);
    expect(map.deal).toEqual({ allowRead: true, allowEdit: true, allowDelete: true, allowCreate: false });
  });

  it('builds FRESH entries — nothing in the map aliases an input set', () => {
    const entry = { allowRead: true };
    const sets = [{ objects: { deal: entry } }];
    const map: any = buildEffectiveObjectPermissions(sets);
    expect(map.deal).toEqual(entry);
    expect(map.deal).not.toBe(entry);
    map.deal.allowEdit = true;
    expect(entry).toEqual({ allowRead: true });
  });

  it('seeds, then folds, then clamps, then annotates — in that order', () => {
    const schemas: Record<string, any> = {
      report: { name: 'report', enable: { apiMethods: ['get', 'list'] } },
      sys_member: { name: 'sys_member', managedBy: 'better-auth' },
    };
    const map: any = buildEffectiveObjectPermissions(
      [{ objects: { '*': { viewAllRecords: true, modifyAllRecords: true }, sys_member: { allowRead: true } } }],
      { allSchemas: () => Object.values(schemas), schemaOf: (n) => schemas[n] },
    );
    // Seed → fold: an entry nobody named, pulled true by the super-user bits.
    expect(map.report).toMatchObject({ allowRead: true, allowEdit: true, allowCreate: true, allowDelete: true });
    // Fold → clamp: the guard has the last word on a managed object's writes.
    expect(map.sys_member).toMatchObject({ allowRead: true, allowEdit: false, allowCreate: false, allowDelete: false });
    // Annotate runs last, over the final entries.
    expect(Array.isArray(map.report.apiOperations)).toBe(true);
  });

  it('a throwing schema source degrades the annotations, never the map', () => {
    const warns: string[] = [];
    const map: any = buildEffectiveObjectPermissions(
      [{ objects: { deal: { allowRead: true } } }],
      {
        allSchemas: () => { throw new Error('registry down'); },
        schemaOf: () => { throw new Error('registry down'); },
        logger: { warn: (m) => warns.push(m) },
      },
    );
    expect(map).toEqual({ deal: { allowRead: true } });
  });

  it('with no schema source at all it is the bare merge plus the fold', () => {
    const map: any = buildEffectiveObjectPermissions([
      { objects: { '*': { modifyAllRecords: true }, deal: { allowRead: false } } },
    ]);
    expect(map.deal).toMatchObject({ allowRead: true, allowEdit: true, allowCreate: true, allowDelete: true });
    expect(map.deal.apiOperations).toBeUndefined();
  });
});
