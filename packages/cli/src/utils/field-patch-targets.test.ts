// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0146 D10, second rule] `os validate`'s walk for the field-patch target
 * check: which objects the composed stack declares and which extensions each
 * package carries. The verdict is `@objectstack/metadata-core`'s own judge.
 */

import { describe, it, expect } from 'vitest';
import { findFieldPatchTargetRefusals } from './field-patch-targets.js';

const account = {
  name: 'fpt_account',
  fields: {
    industry: { type: 'select', label: 'Industry', options: [{ value: 'tech', label: 'Tech' }] },
  },
};

describe('findFieldPatchTargetRefusals', () => {
  it('judges an extension of an object the stack declares', () => {
    const refusals = findFieldPatchTargetRefusals({
      objects: [account],
      objectExtensions: [{ extend: 'fpt_account', fieldPatches: { sector: { label: 'Sector' }, industry: { options: { retail: { label: 'R' } } } } }],
    });
    expect(refusals.map((r) => r.path)).toEqual([
      'objectExtensions[0].fieldPatches.sector',
      'objectExtensions[0].fieldPatches.industry.options.retail',
    ]);
  });

  it('admits a patch whose field and option the target has', () => {
    expect(findFieldPatchTargetRefusals({
      objects: [account],
      objectExtensions: [{ extend: 'fpt_account', fieldPatches: { industry: { label: 'Sector', options: { tech: { label: 'Technology' } } } } }],
    })).toEqual([]);
  });

  it('leaves a target outside the composed stack to the install door', () => {
    expect(findFieldPatchTargetRefusals({
      objectExtensions: [{ extend: 'crm_account', fieldPatches: { anything: { label: 'X' } } }],
    })).toEqual([]);
  });

  it('reads a target another packages[] entry declares, and locates the refusal under its own entry', () => {
    const refusals = findFieldPatchTargetRefusals({
      packages: [
        { manifest: { id: 'com.acme.core', objects: [account] } },
        { manifest: { id: 'com.acme.wording', objectExtensions: [{ extend: 'fpt_account', fieldPatches: { sector: { label: 'Sector' } } }] } },
      ],
    });
    expect(refusals.map((r) => r.path)).toEqual(['packages[1].manifest.objectExtensions[0].fieldPatches.sector']);
  });

  it('reads a name-keyed objects map', () => {
    const { name: _name, ...body } = account;
    expect(findFieldPatchTargetRefusals({
      objects: { fpt_account: body },
      objectExtensions: [{ extend: 'fpt_account', fieldPatches: { sector: { label: 'Sector' } } }],
    })).toHaveLength(1);
  });
});
