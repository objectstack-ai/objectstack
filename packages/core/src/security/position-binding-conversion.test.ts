// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0131 D3/D4/D10] The pin of `convertPositionBindingRows` — the function
 * the upgrade ceremony applies to turn junction rows into each position
 * definition's `permissionSets`.
 */

import { describe, expect, it } from 'vitest';
import { convertPositionBindingRows } from './position-binding-conversion.js';

const sets = [
  { id: 'ps_read', name: 'read_all' },
  { id: 'ps_write', name: 'write_all' },
  { id: 'ps_base', name: 'member_default' },
];

describe('convertPositionBindingRows', () => {
  it('names each position\'s bound sets by NAME, in row order', () => {
    const out = convertPositionBindingRows({
      positions: [{ id: 'p_auditor', name: 'auditor' }, { id: 'p_contrib', name: 'contributor' }],
      permissionSets: sets,
      bindings: [
        { id: 'b1', position_id: 'p_contrib', permission_set_id: 'ps_write' },
        { id: 'b2', position_id: 'p_auditor', permission_set_id: 'ps_read' },
        { id: 'b3', position_id: 'p_contrib', permission_set_id: 'ps_read' },
      ],
    });
    expect(out).toEqual({
      positions: [
        { name: 'contributor', fate: 'converted', permissionSets: ['write_all', 'read_all'] },
        { name: 'auditor', fate: 'converted', permissionSets: ['read_all'] },
      ],
      dangling: [],
    });
  });

  it('keeps what the definition already names, and adds only what the rows bind beyond it', () => {
    const out = convertPositionBindingRows({
      positions: [{ id: 'p_contrib', name: 'contributor' }, { id: 'p_auditor', name: 'auditor' }],
      permissionSets: sets,
      bindings: [
        { position_id: 'p_contrib', permission_set_id: 'ps_write' },
        { position_id: 'p_contrib', permission_set_id: 'ps_read' },
        { position_id: 'p_auditor', permission_set_id: 'ps_read' },
      ],
      declared: new Map([
        ['contributor', ['member_default', 'write_all']],
        ['auditor', ['read_all']],
      ]),
    });
    expect(out.positions).toEqual([
      { name: 'contributor', fate: 'converted', permissionSets: ['member_default', 'write_all', 'read_all'] },
      { name: 'auditor', fate: 'declared', permissionSets: ['read_all'] },
    ]);
  });

  it('one name materialized per organization with the SAME bindings converts once', () => {
    const out = convertPositionBindingRows({
      positions: [
        { id: 'e_a', name: 'everyone', organization_id: 'org_a' },
        { id: 'e_b', name: 'everyone', organization_id: 'org_b' },
      ],
      permissionSets: [
        { id: 'base_a', name: 'member_default', organization_id: 'org_a' },
        { id: 'base_b', name: 'member_default', organization_id: 'org_b' },
      ],
      bindings: [
        { position_id: 'e_a', permission_set_id: 'base_a' },
        { position_id: 'e_b', permission_set_id: 'base_b' },
      ],
    });
    expect(out.positions).toEqual([{ name: 'everyone', fate: 'converted', permissionSets: ['member_default'] }]);
  });

  it('organizations that bind DIFFERENT sets to one name are conflicting — never merged (D10 fate 4)', () => {
    const out = convertPositionBindingRows({
      positions: [
        { id: 'm_a', name: 'manager', organization_id: 'org_a' },
        { id: 'm_b', name: 'manager', organization_id: 'org_b' },
        { id: 'm_c', name: 'manager', organization_id: 'org_c' },
      ],
      permissionSets: sets,
      bindings: [
        { position_id: 'm_a', permission_set_id: 'ps_write' },
        { position_id: 'm_b', permission_set_id: 'ps_read' },
      ],
    });
    expect(out.positions).toEqual([
      {
        name: 'manager',
        fate: 'conflicting',
        // org_c holds a row of the name and binds nothing: merging would hand it org_a's and org_b's sets.
        byOrganization: { org_a: ['write_all'], org_b: ['read_all'], org_c: [] },
      },
    ]);
  });

  it('a binding to a missing position or set row is dangling and converted nowhere', () => {
    const out = convertPositionBindingRows({
      positions: [{ id: 'p_auditor', name: 'auditor' }],
      permissionSets: sets,
      bindings: [
        { id: 'b_gone_position', position_id: 'p_gone', permission_set_id: 'ps_read' },
        { id: 'b_gone_set', position_id: 'p_auditor', permission_set_id: 'ps_gone' },
      ],
    });
    expect(out).toEqual({
      positions: [],
      dangling: [
        { id: 'b_gone_position', reason: 'position-missing' },
        { id: 'b_gone_set', reason: 'permission-set-missing' },
      ],
    });
  });
});
