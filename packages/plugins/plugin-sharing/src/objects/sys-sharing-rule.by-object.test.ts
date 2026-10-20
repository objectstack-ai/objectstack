// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import { SysSharingRule } from './sys-sharing-rule.object.js';
import * as SharingObjects from './index.js';

/**
 * [#24701] No sharing list view groups on a field whose stored value is an
 * object's API name.
 *
 * The console (objectui at this repository's `.objectui-sha`) heads each group
 * with the grouping value as text: its group formatter turns a select value
 * into its option label and a boolean into Yes / No, and draws anything else
 * as stored. An `object-ref` field's CELL draws the object's icon and label,
 * but its group header drew the API name (`crm_account`), so `by_object` read
 * one machine name per group. #24611 removed the same grouping from
 * `sys_record_share.by_object`, where the field is a pointer pair's type half.
 *
 * A field stores an object's API name when it declares the `object-ref`
 * widget (the object picker) or when it is the `referenceVia` sibling of a
 * pointer pair. Enumerated over every object this package ships
 * (`objects/index.ts`), so a view added later is judged without anyone
 * listing it here.
 */
describe('sharing list views — no grouping on a field that stores an object API name (#24701)', () => {
  type ViewDef = {
    columns?: ReadonlyArray<string | { field: string }>;
    sort?: ReadonlyArray<{ field: string; order?: string }>;
    grouping?: { fields?: ReadonlyArray<{ field: string }> };
  };
  type ObjectDef = {
    name: string;
    fields: Record<string, { widget?: unknown; referenceVia?: unknown } | undefined>;
    listViews?: Record<string, ViewDef>;
  };

  const objects = Object.values(SharingObjects) as unknown as ObjectDef[];

  /** The fields of `object` whose stored value is an object's API name. */
  function apiNameFields(object: ObjectDef): string[] {
    const names = new Set<string>();
    for (const [name, def] of Object.entries(object.fields)) {
      if (def?.widget === 'object-ref') names.add(name);
      if (typeof def?.referenceVia === 'string') names.add(def.referenceVia);
    }
    return [...names].sort();
  }

  it('finds the API-name field on every sharing object, so the case below cannot pass on an empty set', () => {
    const found = Object.fromEntries(objects.map((o) => [o.name, apiNameFields(o)]));
    expect(found).toEqual({
      sys_record_share: ['object_name'],
      sys_sharing_rule: ['object_name'],
      sys_share_link: ['object_name'],
    });
  });

  it('no list view groups on a field that stores an object API name', () => {
    const hits = objects.flatMap((o) => {
      const apiNames = new Set(apiNameFields(o));
      return Object.entries(o.listViews ?? {}).flatMap(([view, def]) =>
        (def.grouping?.fields ?? [])
          .filter((g) => apiNames.has(g.field))
          .map((g) => `${o.name}.${view}: ${g.field}`));
    });
    expect(hits).toEqual([]);
  });

  it('control: sys_sharing_rule.by_object still keeps one object\'s rules together and shows the Object column', () => {
    const view = (SysSharingRule.listViews as Record<string, ViewDef> | undefined)?.by_object;
    expect(view?.sort?.[0]).toEqual({ field: 'object_name', order: 'asc' });
    expect(view?.columns?.[0]).toBe('object_name');
    const fields = SysSharingRule.fields as Record<string, { widget?: unknown }>;
    expect(fields.object_name.widget).toBe('object-ref');
  });
});
