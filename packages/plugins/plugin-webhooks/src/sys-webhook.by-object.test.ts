// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import { SysWebhook } from './sys-webhook.object.js';

/**
 * [#24701] No `sys_webhook` list view groups on a field whose stored value is
 * an object's API name.
 *
 * The console (objectui at this repository's `.objectui-sha`) heads each group
 * with the grouping value as text: its group formatter turns a select value
 * into its option label and a boolean into Yes / No, and draws anything else
 * as stored. `object_name` declares the `object-ref` widget, so its CELL draws
 * the object's icon and label, but its group header drew the API name
 * (`crm_account`), so `by_object` read one machine name per group.
 *
 * A field stores an object's API name when it declares the `object-ref`
 * widget (the object picker) or when it is the `referenceVia` sibling of a
 * pointer pair. Enumerated over every view the object declares, so a view
 * added later is judged without anyone listing it here.
 */
describe('sys_webhook list views — no grouping on a field that stores an object API name (#24701)', () => {
  type ViewDef = {
    columns?: ReadonlyArray<string | { field: string }>;
    sort?: ReadonlyArray<{ field: string; order?: string }>;
    grouping?: { fields?: ReadonlyArray<{ field: string }> };
  };

  const fields = SysWebhook.fields as Record<string, { widget?: unknown; referenceVia?: unknown } | undefined>;
  const views = (SysWebhook.listViews ?? {}) as Record<string, ViewDef>;

  /** The fields whose stored value is an object's API name. */
  function apiNameFields(): string[] {
    const names = new Set<string>();
    for (const [name, def] of Object.entries(fields)) {
      if (def?.widget === 'object-ref') names.add(name);
      if (typeof def?.referenceVia === 'string') names.add(def.referenceVia);
    }
    return [...names].sort();
  }

  it('finds the API-name field, so the case below cannot pass on an empty set', () => {
    expect(apiNameFields()).toEqual(['object_name']);
  });

  it('no list view groups on a field that stores an object API name', () => {
    const apiNames = new Set(apiNameFields());
    const hits = Object.entries(views).flatMap(([view, def]) =>
      (def.grouping?.fields ?? [])
        .filter((g) => apiNames.has(g.field))
        .map((g) => `sys_webhook.${view}: ${g.field}`));
    expect(hits).toEqual([]);
  });

  it('control: by_object still keeps one object\'s webhooks together and shows the Object column', () => {
    expect(views.by_object?.sort?.[0]).toEqual({ field: 'object_name', order: 'asc' });
    expect(views.by_object?.columns?.[0]).toBe('object_name');
  });
});
