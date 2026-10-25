/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { describe, it, expect } from 'vitest';
import { resolveLegacyRowActions } from '../resolveLegacyRowActions';

const CONVERT_LEAD = {
  name: 'convert_lead',
  label: 'Convert Lead',
  type: 'api',
  target: '/leads/convert',
  locations: ['record_header'],
};

describe('resolveLegacyRowActions', () => {
  it('promotes a legacy name to the object action it names', () => {
    const { defs, unresolved } = resolveLegacyRowActions({
      rowActions: ['convert_lead'],
      rowActionDefs: [],
      objectActions: [CONVERT_LEAD],
    });

    // The dead `{ type: 'convert_lead' }` dispatch is gone: the row now
    // carries the real def, so it routes through the api branch (objectui#2960).
    expect(defs).toEqual([CONVERT_LEAD]);
    expect(unresolved).toEqual([]);
  });

  it('drops a legacy name that duplicates an existing list_item def', () => {
    const listItemDef = { ...CONVERT_LEAD, locations: ['list_item'], label: '转换线索' };
    const { defs, unresolved } = resolveLegacyRowActions({
      rowActions: ['convert_lead'],
      rowActionDefs: [listItemDef],
      objectActions: [listItemDef],
    });

    // One working entry, not a working entry plus a dead twin — and the
    // already-localized def wins over the raw object action.
    expect(defs).toEqual([listItemDef]);
    expect(unresolved).toEqual([]);
  });

  it('keeps a name that matches no declared action for by-name dispatch', () => {
    // Consumers may register a runner handler under exactly this name; that
    // path stays intact.
    const { defs, unresolved } = resolveLegacyRowActions({
      rowActions: ['crm_only_handler'],
      rowActionDefs: [],
      objectActions: [CONVERT_LEAD],
    });

    expect(defs).toEqual([]);
    expect(unresolved).toEqual(['crm_only_handler']);
  });

  it('appends promotions after the declared defs and preserves order', () => {
    const archive = { name: 'archive', locations: ['list_item'] };
    const merge = { name: 'merge', locations: ['record_header'] };
    const { defs, unresolved } = resolveLegacyRowActions({
      rowActions: ['merge', 'unknown_one', 'convert_lead'],
      rowActionDefs: [archive],
      objectActions: [CONVERT_LEAD, merge],
    });

    expect(defs).toEqual([archive, merge, CONVERT_LEAD]);
    expect(unresolved).toEqual(['unknown_one']);
  });

  it('promotes a repeated legacy name only once', () => {
    const { defs } = resolveLegacyRowActions({
      rowActions: ['convert_lead', 'convert_lead'],
      rowActionDefs: [],
      objectActions: [CONVERT_LEAD],
    });

    expect(defs).toEqual([CONVERT_LEAD]);
  });

  it('returns the defs array by reference when nothing is promoted', () => {
    const rowActionDefs = [{ name: 'archive' }];

    // No legacy names at all — the common case; the row menu memoizes over
    // this list, so a fresh array here would bust it on every render.
    expect(
      resolveLegacyRowActions({ rowActions: [], rowActionDefs }).defs,
    ).toBe(rowActionDefs);

    // Legacy names present but none resolvable — still no new defs array.
    expect(
      resolveLegacyRowActions({ rowActions: ['nope'], rowActionDefs, objectActions: [] }).defs,
    ).toBe(rowActionDefs);
  });

  it('tolerates a missing object schema and malformed entries', () => {
    // `objectSchema` is fetched async, so the first paint has no actions.
    const { defs, unresolved } = resolveLegacyRowActions({
      rowActions: ['convert_lead', '', null as unknown as string],
      rowActionDefs: null,
      objectActions: undefined,
    });

    expect(defs).toEqual([]);
    expect(unresolved).toEqual(['convert_lead']);
  });
});
