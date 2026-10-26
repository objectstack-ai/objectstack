/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * A flat view overlay's top-level `columns` reach the switcher tab (objectui#8411).
 *
 * `ViewMetadataSchema` spells one view body three ways and recognises the
 * standalone ViewItem record by its NESTED `config`; a flattened runtime
 * overlay has no `config` and IS its own body. `MetadataProvider.isViewItem`
 * routed on `viewKind && object` instead — true for BOTH spellings — and the
 * branch it routed to read `view.config` unconditionally, falling back to `{}`.
 *
 * The failure was the quiet kind. Binding to an object is by `object` +
 * `viewKind` and has nothing to do with the body, so the overlay's TAB kept
 * rendering; only the author's `columns` / `type` / `data` vanished, with no
 * diagnostic anywhere. Someone reading that screen sees a working view and
 * concludes their columns are wrong, not that they were never read.
 *
 * What is pinned is the chain a stored row actually travels to the screen:
 *
 *   persisted `view` body
 *     -> ViewMetadataSchema        (it is a legitimate persisted shape)
 *     -> mergeViewsIntoObjects     (objectDef.listViews)
 *     -> buildViewTabs             (the entries ObjectView renders as tabs)
 *
 * BOTH spellings are asserted in ONE merge, each carrying its own distinct
 * columns. That is deliberate: a pin that only asserted the flat body would
 * also pass an implementation that collapsed the two shapes into one, and a
 * pin that only asserted the nested one could not tell "the columns are lost"
 * apart from "this harness never renders columns at all".
 *
 * REVERSE VERIFICATION (measured, not predicted): restoring the `{}` fallback
 * in `viewItemBody` turns the flat-overlay assertions RED
 * (`expected undefined to deeply equal [ { field: 'name' }, … ]`) while the
 * nested-record assertions stay GREEN — which is the point. The fix must give
 * the flat body a path, not move the nested one.
 */

import { describe, it, expect } from 'vitest';
import { ViewMetadataSchema } from '@objectstack/spec/ui';
import { mergeViewsIntoObjects } from '../providers/MetadataProvider';
import { buildViewTabs } from './ObjectView';

const OBJECT = { name: 'crm_lead', label: 'Lead', fields: { name: { type: 'text' } } };

/**
 * The flattened runtime overlay: `viewKind` + `object`, body inline, NO
 * `config`. Spec's own table recognises this member as "an inline view config;
 * no `config`, no container slot".
 */
const FLAT_OVERLAY = {
  name: 'crm_lead.compact',
  object: 'crm_lead',
  viewKind: 'list',
  label: 'Compact',
  type: 'grid',
  data: { provider: 'object', object: 'crm_lead' },
  columns: [{ field: 'name' }, { field: 'status' }],
};

/** The positive control: a standalone ViewItem record, body nested under `config`. */
const NESTED_RECORD = {
  name: 'crm_lead.full',
  object: 'crm_lead',
  viewKind: 'list',
  label: 'Full',
  config: {
    type: 'grid',
    data: { provider: 'object', object: 'crm_lead' },
    columns: [{ field: 'name' }, { field: 'owner' }],
  },
};

/** The chain from stored rows to the entries ObjectView renders as tabs. */
function tabsFor(views: unknown[]) {
  const [merged] = mergeViewsIntoObjects([{ ...OBJECT }], views as any[]) as any[];
  return buildViewTabs({
    definedViews: merged.listViews || {},
    primary: merged.list,
    savedViews: [],
    viewOverrides: {},
    fallbackTab: () => ({ id: '__no_view__' }),
  });
}

describe('flat view overlay keeps its top-level columns (objectui#8411)', () => {
  it('is a legitimate persisted `view` body, not an off-spec shape', () => {
    // If this ever fails the fix below is arguing for a shape the contract does
    // not admit, and the card would belong at the producer instead.
    expect(ViewMetadataSchema.safeParse(FLAT_OVERLAY).success).toBe(true);
    expect(ViewMetadataSchema.safeParse(NESTED_RECORD).success).toBe(true);
  });

  it('renders a tab for the flat overlay AND carries its authored columns', () => {
    const tabs = tabsFor([FLAT_OVERLAY]);

    // The tab was never the casualty — it rendered before the fix too. Asserted
    // so a future change cannot buy the columns back by dropping the tab.
    expect(tabs.map(t => t.id)).toEqual(['crm_lead.compact']);
    expect(tabs[0].label).toBe('Compact');

    // The casualty.
    expect(tabs[0].columns).toEqual([{ field: 'name' }, { field: 'status' }]);
    expect(tabs[0].type).toBe('grid');
    expect(tabs[0].data).toEqual({ provider: 'object', object: 'crm_lead' });
  });

  it('positive control: a nested-`config` ViewItem still renders its columns', () => {
    const tabs = tabsFor([NESTED_RECORD]);

    expect(tabs.map(t => t.id)).toEqual(['crm_lead.full']);
    expect(tabs[0].columns).toEqual([{ field: 'name' }, { field: 'owner' }]);
    expect(tabs[0].type).toBe('grid');
  });

  it('keeps the two spellings distinct in one merge', () => {
    // An implementation that collapsed both shapes onto one body would pass the
    // two cases above separately and fail here.
    const tabs = tabsFor([FLAT_OVERLAY, NESTED_RECORD]);
    const byId = Object.fromEntries(tabs.map(t => [t.id, t]));

    expect(Object.keys(byId).sort()).toEqual(['crm_lead.compact', 'crm_lead.full']);
    expect(byId['crm_lead.compact'].columns).toEqual([{ field: 'name' }, { field: 'status' }]);
    expect(byId['crm_lead.full'].columns).toEqual([{ field: 'name' }, { field: 'owner' }]);
  });
});
