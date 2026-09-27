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
  it('reports a target that names no field of the object, located at the mapping', () => {
    const findings = validateMappingTargetFields({
      objects: [contact],
      mappings: [mapping([
        { source: 'Name', target: 'full_name' },
        { source: 'Mail', target: 'emial' },
      ])],
    });
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      severity: 'error',
      rule: MAPPING_TARGET_FIELD_UNKNOWN,
      where: 'mapping "contact_import" · object "crm_contact"',
      path: 'mappings[0].fieldMapping[1].target',
    });
    // Names the target and the object, and the closest name the object has.
    expect(findings[0].message).toContain('"emial"');
    expect(findings[0].message).toContain('"crm_contact"');
    expect(findings[0].message).toContain('Did you mean "email"?');
  });

  // [#20149] The card's shape, which #20150 pinned red here, is now a target:
  // a declared part of a compound field. The flip is load-bearing: the whole
  // address template is green, every part the value schema declares.
  it('is green on a mapping that writes an address by its declared parts (the card\'s five columns and more)', () => {
    expect(validateMappingTargetFields({
      objects: [contact],
      mappings: [mapping([
        { source: 'Name', target: 'full_name' },
        { source: 'Street', target: 'mailing_address.street' },
        { source: 'City', target: 'mailing_address.city' },
        { source: 'State', target: 'mailing_address.state' },
        { source: 'Zip', target: 'mailing_address.postalCode' },
        { source: 'Country', target: 'mailing_address.country' },
        { source: 'x', target: 'mailing_address.countryCode', transform: 'constant', params: { value: 'US' } },
        { source: ['Line 1', 'Line 2'], target: 'mailing_address.formatted', transform: 'join' },
      ])],
    })).toEqual([]);
  });

  it('refuses a part the address value does not declare, naming every part it does', () => {
    const findings = validateMappingTargetFields({
      objects: [contact],
      mappings: [mapping([{ source: 'Street', target: 'mailing_address.stret' }])],
    });
    expect(findings.map((f) => f.path)).toEqual(['mappings[0].fieldMapping[0].target']);
    expect(findings[0].rule).toBe(MAPPING_TARGET_FIELD_UNKNOWN);
    expect(findings[0].message).toContain(
      '"stret" is not a part of the address field "mailing_address": the parts a target may name on it are '
      + 'street, city, state, postalCode, country, countryCode, formatted.',
    );
    expect(findings[0].message).toContain('Did you mean "street"?');
    expect(findings[0].hint).toContain(
      'or at a declared part of a compound field as field.part (mailing_address: street, city, state, postalCode, country, countryCode, formatted)',
    );
  });

  it('refuses a dotted path on a field with no parts — and never reads it as a lookup traversal', () => {
    const findings = validateMappingTargetFields({
      objects: [{ ...contact, fields: { ...contact.fields, account: { type: 'lookup', reference: 'crm_account' } } }],
      mappings: [mapping([
        { source: 'First', target: 'full_name.first' },
        { source: 'Account', target: 'account.name' },
      ])],
    });
    expect(findings.map((f) => f.path)).toEqual([
      'mappings[0].fieldMapping[0].target',
      'mappings[0].fieldMapping[1].target',
    ]);
    expect(findings[0].message).toContain('The text field "full_name" is a field of "crm_contact" with no parts');
    expect(findings[1].message).toContain('The lookup field "account" is a field of "crm_contact" with no parts');
    expect(findings[1].message).toContain('Map the column to "account" with transform "lookup"');
    // The part list rides along either way, so the author sees what IS a part.
    expect(findings[0].hint).toContain('mailing_address: street, city');
  });

  it('refuses a part of a field the same mapping also writes whole — the two collide', () => {
    const findings = validateMappingTargetFields({
      objects: [contact],
      mappings: [mapping([
        { source: 'Address JSON', target: 'mailing_address' },
        { source: 'Street', target: 'mailing_address.street' },
      ])],
    });
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      rule: MAPPING_TARGET_FIELD_UNKNOWN,
      path: 'mappings[0].fieldMapping[1].target',
      // The collision names the field AND lists its legal parts, as every refusal does.
      hint: 'Map the field whole or by its parts, not both. A declared part of a compound field is written '
        + 'field.part (mailing_address: street, city, state, postalCode, country, countryCode, formatted).',
    });
    expect(findings[0].message).toContain(
      'writes the compound field "mailing_address" of object "crm_contact" both whole (fieldMapping[0].target) '
      + 'and by its part "street" (fieldMapping[1].target)',
    );
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

  it('CONTROL — `packages: undefined` (absent) stays silent — the only value this reader treats as absent', () => {
    // `full_name`, not `sla_tier`: `sla_tier` resolves via the STACK's own
    // top-level `objectExtensions` (the test above, :173) — `region` is the
    // one that needs a package (:174). Either way, with `packages` genuinely
    // absent this control needs a field `contact` declares on its own, so a
    // real finding can't masquerade as the reader silently accepting the
    // shape.
    expect(validateMappingTargetFields({
      objects: [contact],
      packages: undefined,
      mappings: [mapping([{ source: 'Name', target: 'full_name' }])],
    })).toEqual([]);
  });

  // [#20206, ruling A on #15293 `5634034754`] This reader was added by #20208
  // after the ruling's own site census (`origin/main` `1c8b320`) — a fifth
  // copy of the same `recordsOf(stack.packages)` fall-through the ruling
  // closes elsewhere in this package. A PRESENT non-array `packages` is
  // malformed, not absent; only `undefined` stays silent. `null` joins this
  // set in rework round 1 (ruling A on #19926, `5805260775`): it is present,
  // not absent. A keyed object (the shape `recordsOf` read as a map) joins in
  // rework round 3, alongside the explicit `undefined` control above, so this
  // validator pins the same shape classes the other two validators do.
  it('refuses a PRESENT non-array `packages` instead of silently ignoring it', () => {
    for (const packages of [{}, 0, 'x', null, { a: { manifest: {} } }]) {
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
