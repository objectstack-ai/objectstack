// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';

import {
  MAPPING_TARGET_FIELD_UNKNOWN,
  validateMappingTargetFields,
} from './validate-mapping-target-fields.js';

// [#20150] The author-time half of the import door's refusal: a mapping target
// that names no field of its object is red at `os validate`, and a mapping
// whose targets resolve (declared fields and provisioned columns alike) is
// green. The verdict is the spec's; this pins the rule's reading of a stack.

const contact = {
  name: 'crm_contact',
  fields: {
    full_name: { type: 'text' },
    email: { type: 'email' },
    mailing_address: { type: 'address' },
  },
};

const mapping = (fieldMapping: unknown[], extra: Record<string, unknown> = {}) => ({
  name: 'contact_import',
  targetObject: 'crm_contact',
  fieldMapping,
  ...extra,
});

describe('validateMappingTargetFields', () => {
  it('reports a target that names no field of the object, located at the mapping (the card\'s shape)', () => {
    const findings = validateMappingTargetFields({
      objects: [contact],
      mappings: [mapping([
        { source: 'Name', target: 'full_name' },
        { source: 'Street', target: 'mailing_address.street' },
      ])],
    });
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      severity: 'error',
      rule: MAPPING_TARGET_FIELD_UNKNOWN,
      where: 'mapping "contact_import" · object "crm_contact"',
      path: 'mappings[0].fieldMapping[1].target',
    });
    // Names the target and the object, and says why a dotted path is not one.
    expect(findings[0].message).toContain('"mailing_address.street"');
    expect(findings[0].message).toContain('"crm_contact"');
    expect(findings[0].message).toContain('"mailing_address" is a field of "crm_contact"');
  });

  it('is green on the control mapping — declared fields only', () => {
    expect(validateMappingTargetFields({
      objects: [contact],
      mappings: [mapping([
        { source: 'Name', target: 'full_name' },
        { source: 'Mail', target: 'email', transform: 'map', params: { valueMap: {} } },
      ])],
    })).toEqual([]);
  });

  it('is green on a target naming a column the platform provisions on this object', () => {
    // The import door accepts these (the registry injects them, the write door
    // admits them); the author-time check must never refuse what the door accepts.
    expect(validateMappingTargetFields({
      objects: [contact],
      mappings: [mapping([
        { source: 'Owner', target: 'owner_id', transform: 'lookup' },
        { source: 'Created', target: 'created_at' },
        { source: 'Id', target: 'id' },
      ])],
    })).toEqual([]);
  });

  it('refuses a provisioned column the object does NOT carry (ownership: none has no owner_id)', () => {
    const findings = validateMappingTargetFields({
      objects: [{ ...contact, ownership: 'none' }],
      mappings: [mapping([{ source: 'Owner', target: 'owner_id' }])],
    });
    expect(findings.map((f) => f.path)).toEqual(['mappings[0].fieldMapping[0].target']);
  });

  it('judges every element of an array target', () => {
    const findings = validateMappingTargetFields({
      objects: [contact],
      mappings: [mapping([{ source: 'Full', target: ['full_name', 'nick_name'], transform: 'split' }])],
    });
    expect(findings.map((f) => f.path)).toEqual(['mappings[0].fieldMapping[0].target[1]']);
    expect(findings[0].message).toContain('"nick_name"');
  });

  it('folds fields an objectExtensions entry merges into the object — from the stack and from a sibling package', () => {
    const stack = {
      objects: [contact],
      objectExtensions: [{ extend: 'crm_contact', fields: { sla_tier: { type: 'text' } } }],
      packages: [{ manifest: { objectExtensions: [{ extend: 'crm_contact', fields: { region: { type: 'text' } } }] } }],
      mappings: [mapping([
        { source: 'Tier', target: 'sla_tier' },
        { source: 'Region', target: 'region' },
      ])],
    };
    expect(validateMappingTargetFields(stack)).toEqual([]);
  });

  // [#20206, ruling A on #15293 `5634034754`] This reader was added by #20208
  // after the ruling's own site census (`origin/main` `1c8b320`) — a fifth
  // copy of the same `recordsOf(stack.packages)` fall-through the ruling
  // closes elsewhere in this package. A PRESENT non-array `packages` is
  // malformed, not absent; only `undefined` stays silent. `null` joins this
  // set in rework round 1 (ruling A on #19926, `5805260775`): it is present,
  // not absent.
  it('refuses a PRESENT non-array `packages` instead of silently ignoring it', () => {
    for (const packages of [{}, 0, 'x', null]) {
      expect(() => validateMappingTargetFields({
        objects: [contact],
        packages,
        mappings: [mapping([{ source: 'Tier', target: 'sla_tier' }])],
      })).toThrow(expect.objectContaining({ code: 'INVALID_ARTIFACT_PACKAGES', status: 422 }));
    }
  });

  it('stays silent on a mapping whose object this stack does not define (skip 1)', () => {
    expect(validateMappingTargetFields({
      objects: [contact],
      mappings: [{ name: 'user_import', targetObject: 'sys_user', fieldMapping: [{ source: 'x', target: 'zzz' }] }],
    })).toEqual([]);
  });

  it('stays silent on an object with no readable field map (skip 2)', () => {
    expect(validateMappingTargetFields({
      objects: [{ name: 'ext_orders', external: true }],
      mappings: [{ name: 'orders', targetObject: 'ext_orders', fieldMapping: [{ source: 'x', target: 'zzz' }] }],
    })).toEqual([]);
  });

  it('returns nothing for a stack without mappings, and survives junk entries', () => {
    expect(validateMappingTargetFields({ objects: [contact] })).toEqual([]);
    expect(() => validateMappingTargetFields({ objects: [null, contact], mappings: [null, 7] } as never)).not.toThrow();
  });
});
