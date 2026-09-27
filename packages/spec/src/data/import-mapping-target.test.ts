// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';

import {
  IMPORT_TARGET_ALWAYS_ADDRESSABLE_COLUMNS,
  importMappingEntryTargets,
  indexImportMappingTargets,
  judgeImportMappingTarget,
  unknownImportMappingTargets,
} from './import-mapping-target';
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
  },
};

describe('indexImportMappingTargets', () => {
  it('addresses the declared fields plus the columns the platform provisions on this object', () => {
    const index = indexImportMappingTargets(contact);
    expect(index).not.toBeNull();
    expect([...index!.names].sort()).toEqual([
      'created_at', 'created_by', 'email', 'full_name', 'id', 'mailing_address',
      'organization_id', 'owner_id', 'owning_business_unit_id', 'updated_at', 'updated_by',
    ]);
    // Only the DECLARED definitions are carried: the compound-part arm reads a head's type here.
    expect([...index!.fields.keys()].sort()).toEqual(['email', 'full_name', 'mailing_address']);
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

  it('answers `unknown` for a dotted path into a declared compound field (no part targets yet)', () => {
    // The card's measured shape. A later ruling extends the verdict with a
    // `part` arm; until then the dotted name is not a field of the object.
    expect(judgeImportMappingTarget(index, 'mailing_address.street').kind).toBe('unknown');
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
        { source: 'Street', target: 'mailing_address.street' },
        { source: 'Full', target: ['full_name', 'nick_name'], transform: 'split' },
        { source: 'Owner', target: 'owner_id', transform: 'lookup' },
        { source: 'x', target: 'zzz', transform: 'constant', params: { value: 1 } },
      ],
      contact,
    );
    expect(misses).toEqual([
      { entry: 1, path: 'fieldMapping[1].target', target: 'mailing_address.street' },
      { entry: 2, path: 'fieldMapping[2].target[1]', target: 'nick_name' },
      { entry: 4, path: 'fieldMapping[4].target', target: 'zzz' },
    ]);
  });

  it('is empty for a mapping whose every target resolves (the control)', () => {
    expect(unknownImportMappingTargets(
      [{ source: 'Name', target: 'full_name' }, { source: 'Created', target: 'created_at' }],
      contact,
    )).toEqual([]);
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
