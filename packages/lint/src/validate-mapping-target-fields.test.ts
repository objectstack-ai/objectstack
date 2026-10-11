// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';

import {
  MAPPING_TARGET_FIELD_UNKNOWN,
  validateMappingTargetFields as validateMappingTargetFieldsUnrecorded,
} from './validate-mapping-target-fields.js';
import { explainRule } from './rule-explanations.js';

// [#22161] Each finding is one verdict sentence; the reasoning it used to
// carry is `os explain mapping-target-field-unknown`. Every direct call below
// records what it fired, and the last cases in this file hold each recorded
// verdict to one line of at most 200 characters — every firing variant this
// suite exercises, not a chosen few. Run the whole file: those cases read what
// the cases above fired.
const fired: Array<{ rule: string; message: string }> = [];
const validateMappingTargetFields: typeof validateMappingTargetFieldsUnrecorded = (...args) => {
  const findings = validateMappingTargetFieldsUnrecorded(...args);
  fired.push(...findings);
  return findings;
};

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

  it('refuses a part the address value does not declare, naming every part it does on the fix line', () => {
    const findings = validateMappingTargetFields({
      objects: [contact],
      mappings: [mapping([{ source: 'Street', target: 'mailing_address.stret' }])],
    });
    expect(findings.map((f) => f.path)).toEqual(['mappings[0].fieldMapping[0].target']);
    expect(findings[0].rule).toBe(MAPPING_TARGET_FIELD_UNKNOWN);
    expect(findings[0].message).toBe(
      'Target "mailing_address.stret" names no part of the address field "mailing_address", so the import '
      + 'endpoint refuses this mapping (INVALID_FIELD). Did you mean "street"?',
    );
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
    expect(findings[0].message).toContain('but the text field "full_name" has no parts');
    expect(findings[1].message).toContain('cannot traverse the lookup field "account"');
    expect(findings[1].message).toContain('map the column to "account" with transform "lookup"');
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
      'The compound field "mailing_address" is mapped both whole (fieldMapping[0].target) '
      + 'and by its part "street"',
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

describe('[#22161] one-line verdicts — mapping-target-field-unknown', () => {
  it('every verdict the cases above fired is one line of at most 200 characters', () => {
    const converted = fired.filter((f) => f.rule === MAPPING_TARGET_FIELD_UNKNOWN);
    // The coverage control first: every arm fired — a name that is no field,
    // an undeclared part, a dotted target on a scalar field and on a reference
    // field, and a part colliding with the whole field.
    const arms = ['names no field of', 'names no part of', 'has no parts (only', 'cannot traverse', 'mapped both whole'];
    for (const arm of arms) expect(converted.some((f) => f.message.includes(arm)), arm).toBe(true);
    for (const f of converted) {
      expect(f.message, f.rule).not.toContain('\n');
      expect(f.message.length, `${f.rule}: ${f.message}`).toBeLessThanOrEqual(200);
    }
  });

  it('reads as one sentence per arm', () => {
    const findings = validateMappingTargetFields({
      objects: [{ ...contact, fields: { ...contact.fields, account: { type: 'lookup', reference: 'crm_account' } } }],
      mappings: [mapping([
        { source: 'Mail', target: 'emial' },
        { source: 'First', target: 'full_name.first' },
        { source: 'Account', target: 'account.name' },
        { source: 'Address JSON', target: 'mailing_address' },
        { source: 'Street', target: 'mailing_address.street' },
      ])],
    });
    expect(findings.map((f) => f.message)).toEqual([
      'Target "emial" names no field of "crm_contact", so the import endpoint refuses this mapping '
        + '(INVALID_FIELD) and it imports nothing. Did you mean "email"?',
      'Target "full_name.first" is dotted, but the text field "full_name" has no parts (only a compound '
        + 'field does), so the import endpoint refuses this mapping (INVALID_FIELD).',
      'Target "account.name" cannot traverse the lookup field "account", so the import endpoint refuses '
        + 'this mapping (INVALID_FIELD); map the column to "account" with transform "lookup".',
      'The compound field "mailing_address" is mapped both whole (fieldMapping[3].target) and by its part '
        + '"street", so the two collide and the import endpoint refuses this mapping (INVALID_FIELD).',
    ]);
  });

  it('`os explain` carries what the verdicts no longer say', () => {
    const entry = explainRule(MAPPING_TARGET_FIELD_UNKNOWN);
    expect(entry, 'no `os explain mapping-target-field-unknown` entry').toBeDefined();
    const text = entry!.paragraphs.join('\n');
    for (const fact of [
      'before any row, on the dry run and the commit alike',
      '`unknownImportMappingTargets`',
      '`objectExtensions`',
      '`owner_id`, `organization_id`',
      'declared PART of a compound field',
      'transform `lookup`',
      'one row carries one value',
      'does not define',
    ]) {
      expect(text, `explanation names ${fact}`).toContain(fact);
    }
  });

  it('the provisioned columns the explanation names are ones the rule accepts', () => {
    // The explanation module imports nothing, so its list is held to the rule
    // by running the rule: each provisioned column it names is a legal target.
    expect(validateMappingTargetFieldsUnrecorded({
      objects: [contact],
      mappings: [mapping(['id', 'owner_id', 'organization_id'].map((target) => ({ source: target, target })))],
    })).toEqual([]);
  });
});
