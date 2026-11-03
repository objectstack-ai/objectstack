// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0146 D10, second rule] The field-patch target check: the one judge the
 * marketplace install door, `os validate` and the registry fold's boot log ask.
 */

import { describe, it, expect } from 'vitest';
import {
  fieldPatchTargetMisses,
  fieldPatchTargetRefusals,
  fieldPatchTargetRefusalMessage,
} from './extension-field-patch-targets.js';

const ACCOUNT = {
  name: 'crm_account',
  fields: {
    industry: {
      type: 'select',
      label: 'Industry',
      options: [{ value: 'tech', label: 'Tech' }, { value: 'retail', label: 'Retail' }],
    },
    segment: { type: 'select', label: 'Segment', picklist: 'crm_segments' },
    notes: { type: 'textarea', label: 'Notes' },
  },
};

describe('fieldPatchTargetMisses', () => {
  it('finds nothing to say about a patch whose fields and option values the target has', () => {
    expect(fieldPatchTargetMisses('crm_account', {
      industry: { label: 'Sector', options: { tech: { label: 'Technology' } } },
      notes: { placeholder: 'Anything else' },
    }, ACCOUNT)).toEqual([]);
  });

  it('names a field the target does not have', () => {
    const [miss, ...rest] = fieldPatchTargetMisses('crm_account', { sector: { label: 'Sector' } }, ACCOUNT);
    expect(rest).toEqual([]);
    expect(miss).toMatchObject({ object: 'crm_account', field: 'sector', reason: 'field' });
    expect(miss!.option).toBeUndefined();
  });

  it('names an option value the field does not have, and lists the values it does', () => {
    const misses = fieldPatchTargetMisses('crm_account', { industry: { options: { finance: { label: 'Finance' } } } }, ACCOUNT);
    expect(misses).toMatchObject([{ field: 'industry', option: 'finance', reason: 'option' }]);
    expect(misses[0]!.message).toContain('`tech`, `retail`');
  });

  it('names an option patch on a field without options, and on a picklist-bound field', () => {
    expect(fieldPatchTargetMisses('crm_account', { notes: { options: { a: { label: 'A' } } } }, ACCOUNT))
      .toMatchObject([{ field: 'notes', option: 'a', reason: 'option' }]);
    expect(fieldPatchTargetMisses('crm_account', { segment: { options: { smb: { label: 'SMB' } } } }, ACCOUNT))
      .toMatchObject([{ field: 'segment', option: 'smb', reason: 'picklist-option' }]);
  });

  it('reads a target whose fields are a name-bearing array', () => {
    const arrayTarget = { name: 'crm_account', fields: [{ name: 'industry', type: 'text', label: 'Industry' }] };
    expect(fieldPatchTargetMisses('crm_account', { industry: { label: 'Sector' } }, arrayTarget)).toEqual([]);
    expect(fieldPatchTargetMisses('crm_account', { sector: { label: 'Sector' } }, arrayTarget)).toHaveLength(1);
  });

  it('does not read an inherited name as a field', () => {
    expect(fieldPatchTargetMisses('crm_account', { toString: { label: 'X' } }, ACCOUNT)).toHaveLength(1);
  });

  it('judges nothing when the patch is absent or malformed', () => {
    expect(fieldPatchTargetMisses('crm_account', undefined, ACCOUNT)).toEqual([]);
    expect(fieldPatchTargetMisses('crm_account', ['industry'], ACCOUNT)).toEqual([]);
  });
});

describe('fieldPatchTargetRefusals', () => {
  const extensions = [
    { extend: 'crm_account', fieldPatches: { industry: { label: 'Sector' } } },
    { extend: 'crm_account', fieldPatches: { sector: { label: 'X' }, industry: { options: { finance: { label: 'F' } } } } },
    { extend: 'crm_lead', fieldPatches: { anything: { label: 'Y' } } },
    { extend: 'crm_account', fields: { tier: { type: 'text' } } },
  ];
  const getTarget = (name: string) => (name === 'crm_account' ? ACCOUNT : undefined);

  it('locates each miss under its entry, and skips a target the reader does not know', () => {
    expect(fieldPatchTargetRefusals(extensions, getTarget, 'packages[1].manifest.').map((r) => r.path)).toEqual([
      'packages[1].manifest.objectExtensions[1].fieldPatches.sector',
      'packages[1].manifest.objectExtensions[1].fieldPatches.industry.options.finance',
    ]);
  });

  it('answers [] for a manifest with no objectExtensions', () => {
    expect(fieldPatchTargetRefusals(undefined, getTarget)).toEqual([]);
  });

  it('the install sentence names the package and locates the first refusal', () => {
    const refusals = fieldPatchTargetRefusals(extensions, getTarget);
    const message = fieldPatchTargetRefusalMessage('com.acme.display', refusals);
    expect(message).toContain('com.acme.display');
    expect(message).toContain('objectExtensions[1].fieldPatches.sector');
  });
});
