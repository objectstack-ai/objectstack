// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The host fate supplement's declared shape (ADR-0131 D10): each fate admits
 * the fields that fate reads and no others, every shape refuses an unknown
 * key, and the file is an array of rows. The ceremony-side rules (a row naming
 * a platform object, two rows for one object) are the CLI's and are pinned
 * there, against the inventory they are judged by.
 */

import { describe, expect, it } from 'vitest';
import {
  OrganizationOwnershipFateSchema,
  OrganizationOwnershipSupplementEntrySchema,
  OrganizationOwnershipSupplementSchema,
} from './organization-ownership-supplement.zod';

const CITE = 'host record: fixture citation';

const codes = (input: unknown): string[] => {
  const result = OrganizationOwnershipSupplementEntrySchema.safeParse(input);
  return result.success ? [] : result.error.issues.map((issue) => issue.code);
};

describe('OrganizationOwnershipSupplementEntrySchema — one row per fate', () => {
  it('admits each of the four fates with the fields it reads', () => {
    const rows = [
      { object: 'sys_fixture_drop', fate: 'column-drop', citation: CITE, note: 'deployment-level state' },
      {
        object: 'sys_fixture_mirror',
        fate: 'mirror-deletion',
        citation: CITE,
        mirror: [{ column: 'managed_by', in: ['package'] }],
        categories: [{ id: 'authored', label: 'authored rows', citation: CITE, where: [{ column: 'managed_by', notIn: ['package'] }] }],
      },
      {
        object: 'sys_fixture_attr',
        fate: 'attribution',
        citation: CITE,
        anchors: [
          { kind: 'parent', childKey: 'account_id', parentObject: 'sys_fixture_account' },
          { kind: 'subject', objectColumn: 'ref_object', idColumn: 'ref_id' },
          { kind: 'holder', holderObject: 'sys_fixture_holder', holderKey: 'attr_id' },
        ],
        departures: [{ id: 'global-move', label: 'global rows move', citation: CITE, as: 'moved', where: [{ column: 'scope', equals: 'global' }] }],
      },
      {
        object: 'sys_fixture_report',
        fate: 'report',
        citation: CITE,
        notNullExempt: 'the column is a relation, not the tenancy anchor',
        categories: [{ id: 'conflicts', label: 'conflicting rows', citation: CITE, conflictBy: { groupBy: ['name'], distinct: 'organization_id' } }],
      },
    ];
    for (const row of rows) {
      expect(OrganizationOwnershipSupplementEntrySchema.safeParse(row).success, row.object).toBe(true);
    }
    expect(OrganizationOwnershipSupplementSchema.safeParse(rows).success).toBe(true);
  });

  it('a fate names its fields: anchors are required on fate 3, an empty list being the declared Default Organization', () => {
    expect(codes({ object: 'sys_fixture_attr', fate: 'attribution', citation: CITE, anchors: [] })).toEqual([]);
    // Control: the same row without `anchors` is refused, so the pass above is the list, not the fate.
    expect(codes({ object: 'sys_fixture_attr', fate: 'attribution', citation: CITE })).toEqual(['invalid_type']);
  });

  it('a key written on the wrong fate is refused, never read by nothing', () => {
    const anchors = [{ kind: 'parent', childKey: 'account_id', parentObject: 'sys_fixture_account' }];
    expect(codes({ object: 'sys_fixture_row', fate: 'report', citation: CITE, anchors })).toEqual(['unrecognized_keys']);
    expect(codes({ object: 'sys_fixture_row', fate: 'attribution', citation: CITE, anchors: [], mirror: [] })).toEqual(['unrecognized_keys']);
    expect(codes({ object: 'sys_fixture_row', fate: 'column-drop', citation: CITE, notNullExempt: 'x' })).toEqual(['unrecognized_keys']);
    expect(codes({ object: 'sys_fixture_row', fate: 'mirror-deletion', citation: CITE, departures: [] })).toEqual(['unrecognized_keys']);
    // Control: each key is admitted on its own fate.
    expect(codes({ object: 'sys_fixture_row', fate: 'attribution', citation: CITE, anchors })).toEqual([]);
    expect(codes({ object: 'sys_fixture_row', fate: 'mirror-deletion', citation: CITE, mirror: [] })).toEqual([]);
    expect(codes({ object: 'sys_fixture_row', fate: 'report', citation: CITE, notNullExempt: 'x' })).toEqual([]);
  });

  it('the platform-only markers are not authorable: the ceremony stamps the census itself', () => {
    for (const key of ['census', 'cloudCarried', 'external']) {
      expect(codes({ object: 'sys_fixture_row', fate: 'report', citation: CITE, [key]: true }), key).toEqual(['unrecognized_keys']);
    }
  });

  it('an unknown key is refused at every depth', () => {
    const base = { object: 'sys_fixture_row', fate: 'attribution', citation: CITE };
    expect(codes({ ...base, anchors: [{ kind: 'parent', childKey: 'a_id', parentObject: 'sys_a', parentOrgColumn: 'organization_id' }] })).toContain('unrecognized_keys');
    expect(codes({ ...base, anchors: [], categories: [{ id: 'c', label: 'l', citation: CITE, filter: [] }] })).toContain('unrecognized_keys');
    expect(codes({ ...base, anchors: [], departures: [{ id: 'd', label: 'l', citation: CITE, as: 'moved', where: [], why: 'x' }] })).toContain('unrecognized_keys');
    // A row condition is one of five closed shapes; a misspelled operator matches none.
    expect(codes({ ...base, anchors: [], departures: [{ id: 'd', label: 'l', citation: CITE, as: 'moved', where: [{ column: 'scope', equal: 'global' }] }] })).toEqual(['invalid_union']);
  });

  it('names are snake_case identifiers and prose is not blank', () => {
    expect(codes({ object: 'Sys-Fixture', fate: 'column-drop', citation: CITE })).toEqual(['invalid_format']);
    expect(codes({ object: 'sys_fixture_row', fate: 'column-drop', citation: '   ' })).toEqual(['invalid_format']);
    expect(codes({ object: 'sys_fixture_row', fate: 'report', citation: CITE, categories: [{ id: 'c', label: 'l', citation: CITE, where: [{ column: 'scope', in: [] }] }] })).toEqual(['too_small']);
    // Control.
    expect(codes({ object: 'sys_fixture_row', fate: 'column-drop', citation: CITE })).toEqual([]);
  });

  it('a fate outside the four is refused', () => {
    expect(OrganizationOwnershipFateSchema.options).toEqual(['column-drop', 'mirror-deletion', 'attribution', 'report']);
    expect(codes({ object: 'sys_fixture_row', fate: 'delete', citation: CITE })).toEqual(['invalid_union']);
  });
});

describe('OrganizationOwnershipSupplementSchema — the file', () => {
  it('is an array of rows; an object holding rows is not the file', () => {
    expect(OrganizationOwnershipSupplementSchema.safeParse([]).success).toBe(true);
    expect(OrganizationOwnershipSupplementSchema.safeParse({ rows: [] }).success).toBe(false);
  });
});
