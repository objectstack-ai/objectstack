// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';

import {
  IMPORT_TARGET_ALWAYS_ADDRESSABLE_COLUMNS,
  importMappingEntryTargets,
  indexImportMappingTargets,
  judgeImportMappingTarget,
  unknownImportMappingTargets,
} from './import-mapping-target';
import { FieldType } from './field.zod';
import { AddressSchema, LocationValueSchema } from './field-value.zod';
import * as dataBarrel from './index';

// ---------------------------------------------------------------------------
// [#20150] The ONE verdict on what an import mapping's `target` may name. The
// import door (`@objectstack/rest`) and the author-time check
// (`@objectstack/lint`) both call it; their own suites pin each door end to
// end. This file pins the verdict itself.
// ---------------------------------------------------------------------------

const contact = {
  name: 'crm_contact',
  fields: {
    full_name: { type: 'text' },
    email: { type: 'email' },
    mailing_address: { type: 'address' },
    geo: { type: 'location' },
    account: { type: 'lookup', reference: 'crm_account' },
  },
};

/** The seven parts `AddressSchema` declares, read from the schema itself. */
const ADDRESS_PARTS = Object.keys(AddressSchema.shape);

describe('indexImportMappingTargets', () => {
  it('addresses the declared fields plus the columns the platform provisions on this object', () => {
    const index = indexImportMappingTargets(contact);
    expect(index).not.toBeNull();
    expect([...index!.names].sort()).toEqual([
      'account', 'created_at', 'created_by', 'email', 'full_name', 'geo', 'id', 'mailing_address',
      'organization_id', 'owner_id', 'owning_business_unit_id', 'updated_at', 'updated_by',
    ]);
    // Only the DECLARED definitions are carried: the compound-part arm reads a head's type here.
    expect([...index!.fields.keys()].sort()).toEqual(['account', 'email', 'full_name', 'geo', 'mailing_address']);
  });

  it('reads the array form of `fields` the same way as the map form', () => {
    const index = indexImportMappingTargets({
      name: 'crm_contact',
      fields: [{ name: 'full_name', type: 'text' }, { name: 'email', type: 'email' }],
    });
    expect(index?.names.has('full_name')).toBe(true);
    expect(index?.names.has('email')).toBe(true);
    expect(index?.names.has('nope')).toBe(false);
  });

  it('follows the per-object injection plan, so a column the object does not carry is not addressable', () => {
    // `ownership: 'none'` provisions no owner anchor; a target naming one names nothing.
    const unowned = indexImportMappingTargets({ ...contact, ownership: 'none' });
    expect(unowned?.names.has('owner_id')).toBe(false);
    expect(unowned?.names.has('owning_business_unit_id')).toBe(false);
    expect(unowned?.names.has('organization_id')).toBe(true);
  });

  it('keeps id / created_at / updated_at addressable even under systemFields: false (the write door admits them)', () => {
    const optedOut = indexImportMappingTargets({ ...contact, systemFields: false });
    for (const name of IMPORT_TARGET_ALWAYS_ADDRESSABLE_COLUMNS) {
      expect(optedOut?.names.has(name), name).toBe(true);
    }
    expect([...IMPORT_TARGET_ALWAYS_ADDRESSABLE_COLUMNS]).toEqual(['id', 'created_at', 'updated_at']);
    // …and nothing else rides in with them: the rest of the audit family is gone.
    expect(optedOut?.names.has('created_by')).toBe(false);
    expect(optedOut?.names.has('owner_id')).toBe(false);
  });

  it('has no opinion on an object with no readable, non-empty field map', () => {
    expect(indexImportMappingTargets(undefined)).toBeNull();
    expect(indexImportMappingTargets({ name: 'ext_orders' })).toBeNull();
    expect(indexImportMappingTargets({ name: 'ext_orders', fields: {} })).toBeNull();
    expect(indexImportMappingTargets({ name: 'ext_orders', fields: [] })).toBeNull();
    expect(indexImportMappingTargets({ name: 'ext_orders', fields: 'junk' })).toBeNull();
  });
});

describe('judgeImportMappingTarget', () => {
  const index = indexImportMappingTargets(contact)!;

  it('answers `field` for a declared field and for a provisioned column', () => {
    expect(judgeImportMappingTarget(index, 'email')).toEqual({ kind: 'field', target: 'email' });
    expect(judgeImportMappingTarget(index, 'owner_id')).toEqual({ kind: 'field', target: 'owner_id' });
  });

  it('answers `unknown` for a name the object does not have', () => {
    expect(judgeImportMappingTarget(index, 'emial')).toEqual({ kind: 'unknown', target: 'emial' });
  });

  // [#20149] The pin #20150 left here (`mailing_address.street` → unknown)
  // flips: a declared part of a compound field is a target.
  it('answers `part` for every part the address value schema declares', () => {
    expect(ADDRESS_PARTS).toEqual(['street', 'city', 'state', 'postalCode', 'country', 'countryCode', 'formatted']);
    for (const part of ADDRESS_PARTS) {
      expect(judgeImportMappingTarget(index, `mailing_address.${part}`)).toEqual({
        kind: 'part', target: `mailing_address.${part}`, field: 'mailing_address', part,
      });
    }
  });

  it('refuses a part the value does not declare, carrying the declared parts for the refusal to name', () => {
    expect(judgeImportMappingTarget(index, 'mailing_address.stret')).toEqual({
      kind: 'unknown',
      target: 'mailing_address.stret',
      head: { name: 'mailing_address', field: true, type: 'address', parts: ADDRESS_PARTS },
    });
    // The parts are the value schema's keys, spelled its way — not a synonym of one.
    expect(judgeImportMappingTarget(index, 'mailing_address.postal_code').kind).toBe('unknown');
    expect(judgeImportMappingTarget(index, 'mailing_address.').kind).toBe('unknown');
    expect(judgeImportMappingTarget(index, 'mailing_address.street.line1').kind).toBe('unknown');
  });

  it('refuses a dotted path on a field that is not compound — a lookup is never traversed', () => {
    expect(judgeImportMappingTarget(index, 'full_name.first')).toEqual({
      kind: 'unknown', target: 'full_name.first', head: { name: 'full_name', field: true, type: 'text' },
    });
    expect(judgeImportMappingTarget(index, 'account.name')).toEqual({
      kind: 'unknown', target: 'account.name', head: { name: 'account', field: true, type: 'lookup' },
    });
    // A provisioned column carries no compound value either.
    expect(judgeImportMappingTarget(index, 'owner_id.name')).toEqual({
      kind: 'unknown', target: 'owner_id.name', head: { name: 'owner_id', field: true },
    });
    // …and a head that names nothing at all.
    expect(judgeImportMappingTarget(index, 'billing_address.street')).toEqual({
      kind: 'unknown', target: 'billing_address.street', head: { name: 'billing_address', field: false },
    });
  });

  it('refuses a `location` part: its declared parts are required numbers, which text cells cannot assemble', () => {
    // The one other closed-object value schema. Measured: a value assembled
    // from text cells fails it (a string `lat`), and so does one missing `lng`.
    expect(Object.keys(LocationValueSchema.shape)).toEqual(['lat', 'lng', 'altitude', 'accuracy']);
    expect(LocationValueSchema.safeParse({ lat: '37.7', lng: '-122.4' }).success).toBe(false);
    expect(LocationValueSchema.safeParse({ lat: 37.7 }).success).toBe(false);
    expect(judgeImportMappingTarget(index, 'geo.lat')).toEqual({
      kind: 'unknown', target: 'geo.lat', head: { name: 'geo', field: true, type: 'location' },
    });
  });
});

describe('the compound-field census — which field types take a part target', () => {
  it('is exactly the field types whose stored value is a closed object of optional strings: address', () => {
    const fields: Record<string, { type: string }> = {};
    for (const type of FieldType.options) fields[`f_${type}`] = { type };
    const index = indexImportMappingTargets({ name: 'zoo', fields })!;
    expect([...index.parts.keys()]).toEqual(['f_address']);
    expect(index.parts.get('f_address')).toEqual(ADDRESS_PARTS);
  });

  it('reads the parts from the value schema, so an address field authored as `multiple` changes nothing', () => {
    const index = indexImportMappingTargets({ name: 'o', fields: [{ name: 'home', type: 'address', multiple: true }] })!;
    expect(index.parts.get('home')).toEqual(ADDRESS_PARTS);
  });
});

describe('importMappingEntryTargets', () => {
  it('returns one target for a string and one per element for an array', () => {
    expect(importMappingEntryTargets({ source: 'a', target: 'email' })).toEqual([{ target: 'email', path: 'target' }]);
    expect(importMappingEntryTargets({ source: 'a', target: ['first', 'last'], transform: 'split' })).toEqual([
      { target: 'first', path: 'target[0]' },
      { target: 'last', path: 'target[1]' },
    ]);
  });

  it('leaves a malformed target to the schema', () => {
    expect(importMappingEntryTargets(null)).toEqual([]);
    expect(importMappingEntryTargets({ source: 'a' })).toEqual([]);
    expect(importMappingEntryTargets({ source: 'a', target: [7, 'email'] })).toEqual([{ target: 'email', path: 'target[1]' }]);
  });
});

describe('unknownImportMappingTargets', () => {
  it('lists every target of every entry that names no field, located, in entry order', () => {
    const misses = unknownImportMappingTargets(
      [
        { source: 'Name', target: 'full_name' },
        { source: 'Street', target: 'mailing_address.stret' },
        { source: 'Full', target: ['full_name', 'nick_name'], transform: 'split' },
        { source: 'Owner', target: 'owner_id', transform: 'lookup' },
        { source: 'x', target: 'zzz', transform: 'constant', params: { value: 1 } },
      ],
      contact,
    );
    expect(misses).toEqual([
      {
        entry: 1, path: 'fieldMapping[1].target', target: 'mailing_address.stret', reason: 'unknown',
        head: { name: 'mailing_address', field: true, type: 'address', parts: ADDRESS_PARTS },
      },
      { entry: 2, path: 'fieldMapping[2].target[1]', target: 'nick_name', reason: 'unknown' },
      { entry: 4, path: 'fieldMapping[4].target', target: 'zzz', reason: 'unknown' },
    ]);
  });

  it('is empty for a mapping whose every target resolves (the control)', () => {
    expect(unknownImportMappingTargets(
      [{ source: 'Name', target: 'full_name' }, { source: 'Created', target: 'created_at' }],
      contact,
    )).toEqual([]);
  });

  it('is empty for a mapping that writes an address by its declared parts — every transform, split elements too', () => {
    expect(unknownImportMappingTargets(
      [
        { source: 'Name', target: 'full_name' },
        { source: 'Street', target: 'mailing_address.street' },
        { source: 'City/State', target: ['mailing_address.city', 'mailing_address.state'], transform: 'split', params: { separator: '/' } },
        { source: 'x', target: 'mailing_address.countryCode', transform: 'constant', params: { value: 'US' } },
        { source: ['Line 1', 'Line 2'], target: 'mailing_address.formatted', transform: 'join' },
      ],
      contact,
    )).toEqual([]);
  });

  it('refuses a part of a field the same mapping also writes whole, naming where the whole value is written', () => {
    const misses = unknownImportMappingTargets(
      [
        { source: 'Street', target: 'mailing_address.street' },
        { source: 'Address JSON', target: 'mailing_address' },
        { source: 'Both', target: ['mailing_address.city', 'full_name'], transform: 'split' },
      ],
      contact,
    );
    expect(misses).toEqual([
      { entry: 0, path: 'fieldMapping[0].target', target: 'mailing_address.street', reason: 'collides', wholeAt: 'fieldMapping[1].target' },
      { entry: 2, path: 'fieldMapping[2].target[0]', target: 'mailing_address.city', reason: 'collides', wholeAt: 'fieldMapping[1].target' },
    ]);
    // The whole-field target alone, or the parts alone, is fine.
    expect(unknownImportMappingTargets([{ source: 'A', target: 'mailing_address' }], contact)).toEqual([]);
  });

  it('is empty — no opinion, never a refusal — when the object has no field map', () => {
    expect(unknownImportMappingTargets([{ source: 'a', target: 'anything' }], { name: 'ext_orders' })).toEqual([]);
    expect(unknownImportMappingTargets([{ source: 'a', target: 'anything' }], undefined)).toEqual([]);
  });
});

describe('published beside the contract it judges', () => {
  it('is reachable from the data barrel, through mapping.zod', () => {
    expect(dataBarrel.unknownImportMappingTargets).toBe(unknownImportMappingTargets);
    expect(dataBarrel.judgeImportMappingTarget).toBe(judgeImportMappingTarget);
  });
});
