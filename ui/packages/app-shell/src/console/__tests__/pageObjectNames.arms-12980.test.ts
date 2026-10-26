// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#12980 — `pageObjectNames` collects every object arm a block's
 * renderer reads, so an object a page binds through one of them is in the
 * page route's scope read rather than read by name on demand.
 *
 * The arms, each measured against its renderer:
 *
 *   - `data: { provider: 'object', object }` — the `ViewDataSchema` object arm,
 *     the record source the `object-*` blocks resolve first
 *     (`resolveRecordSourceObjectName` in `@object-ui/core`).
 *   - `element:metadata_viewer`'s `object` — read by the state-machine view
 *     only (`useMetadataItem('object', object)`).
 *   - `record:line_items`'s `childObject` and `parentObject`.
 *   - `parentDataSource.object` — `record:related_list`'s parent binding,
 *     read by `ParentRecordBinding`.
 *
 * And what is NOT collected: an arm no renderer reads while the page renders
 * (`add.picker.object`, read on picker open), a metadata viewer whose view
 * does not read `object`, a `data` array of pre-fetched records, and any value
 * that is not a string (an expression envelope included).
 */

import { describe, it, expect } from 'vitest';
import { pageObjectNames } from '../appObjectScope';

const page = (components: unknown[]) => ({
  name: 'p',
  type: 'app',
  regions: [{ name: 'main', components }],
});

describe('pageObjectNames collects the object arms a block renderer reads (objectui#12980)', () => {
  it('collects data.object on the ViewDataSchema object arm', () => {
    expect(
      pageObjectNames(page([{ type: 'object-grid', properties: { data: { provider: 'object', object: 'crm_case' } } }])),
    ).toEqual(['crm_case']);
    expect(
      pageObjectNames(page([{ type: 'object-map', properties: { data: { provider: 'object', object: 'crm_site' } } }])),
    ).toEqual(['crm_site']);
  });

  it("collects element:metadata_viewer's object for the state-machine view only", () => {
    expect(
      pageObjectNames(
        page([{ type: 'element:metadata_viewer', properties: { type: 'state_machine', name: 'lifecycle', object: 'crm_ticket' } }]),
      ),
    ).toEqual(['crm_ticket']);
    expect(
      pageObjectNames(page([{ type: 'element:metadata_viewer', properties: { type: 'flow', name: 'f', object: 'crm_ticket' } }])),
    ).toEqual([]);
  });

  it("collects record:line_items' childObject and parentObject", () => {
    expect(
      pageObjectNames(
        page([{ type: 'record:line_items', properties: { childObject: 'crm_order_line', parentObject: 'crm_order' } }]),
      ).sort(),
    ).toEqual(['crm_order', 'crm_order_line']);
  });

  it("collects record:related_list's parentDataSource.object", () => {
    expect(
      pageObjectNames(
        page([
          {
            type: 'record:related_list',
            properties: { objectName: 'crm_contact', relationshipField: 'account', parentDataSource: { object: 'crm_account' } },
          },
        ]),
      ).sort(),
    ).toEqual(['crm_account', 'crm_contact']);
  });

  it('does not collect add.picker.object, which the related list reads only on picker open', () => {
    expect(
      pageObjectNames(
        page([
          {
            type: 'record:related_list',
            properties: { objectName: 'crm_contact', relationshipField: 'account', add: { picker: { object: 'crm_tag' } } },
          },
        ]),
      ),
    ).toEqual(['crm_contact']);
  });

  it('reads only strings: no expression envelope, no non-string, no other data arm, no array of records', () => {
    expect(
      pageObjectNames(
        page([
          { type: 'object-grid', properties: { data: { provider: 'object', object: { $expr: 'params.object' } } } },
          { type: 'object-grid', properties: { data: { provider: 'object', object: 42 } } },
          { type: 'object-grid', properties: { data: { provider: 'value', items: [] } } },
          { type: 'object-calendar', properties: { data: [{ provider: 'object', object: 'crm_record_field' }] } },
          { type: 'element:metadata_viewer', properties: { type: 'state_machine', object: { $expr: 'x' } } },
          { type: 'record:line_items', properties: { childObject: ['crm_order_line'], parentObject: '' } },
          { type: 'toString', properties: { type: 'state_machine', object: 'crm_ticket' } },
        ]),
      ),
    ).toEqual([]);
  });
});
