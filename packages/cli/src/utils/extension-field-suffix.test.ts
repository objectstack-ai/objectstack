// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0146 D10, #28564] `findExtensionFieldSuffixRefusals` — what `os
 * validate` hands the `__c` reservation's judge.
 *
 * The verdict is `@objectstack/metadata-protocol`'s `judgeExtensionFieldSuffix`,
 * the one the save and install doors ask; the protocol's own file pins its
 * sentences. What is pinned here is which packages the walk hands it and under
 * which id: each `packages[]` entry under its own, or the stack itself under
 * `manifest.id`, every row's message EQUAL to the judge's for the same subject.
 */

import { describe, expect, it } from 'vitest';
import { judgeExtensionFieldSuffix } from '@objectstack/metadata-protocol';
import { findExtensionFieldSuffixRefusals } from './extension-field-suffix.js';

const VENDOR = 'com.acme.crm';
const PAIR = 'com.acme.crm.custom';

const objects = [{ name: 'crm_account', label: 'Account', fields: { name: { type: 'text' }, region__c: { type: 'text' } } }];
const pairExtensions = [{ extend: 'crm_account', fields: { region: { type: 'text' }, tier__c: { type: 'text' } } }];

describe('#28564 — the walk os validate hands the `__c` judge', () => {
  it('(a) a stack under a plain id: its own `__c` field is refused under that id, located in the stack', () => {
    const rows = findExtensionFieldSuffixRefusals({ manifest: { id: VENDOR }, objects });
    expect(rows).toEqual([{
      path: 'objects[0].fields.region__c', code: 'VALIDATION_ERROR', rule: 'reserved_outside_pair', packageId: VENDOR,
      message: judgeExtensionFieldSuffix({ packageId: VENDOR, objects })[0]!.message,
    }]);
  });

  it('(b) a stack under its `.custom` id: an unsuffixed extension field is refused, the suffixed one admitted', () => {
    const rows = findExtensionFieldSuffixRefusals({ manifest: { id: PAIR }, objectExtensions: pairExtensions });
    expect(rows.map((r) => [r.path, r.rule, r.packageId])).toEqual([
      ['objectExtensions[0].fields.region', 'unsuffixed_in_pair', PAIR],
    ]);
    expect(rows[0]!.message).toBe(judgeExtensionFieldSuffix({ packageId: PAIR, objectExtensions: pairExtensions })[0]!.message);
  });

  it('an artifact\'s `packages[]`: each entry judged under its own id, the stack\'s top level not re-judged', () => {
    const rows = findExtensionFieldSuffixRefusals({
      manifest: { id: 'com.acme.bundle' },
      objects,
      packages: [
        { manifest: { id: VENDOR, objects } },
        { manifest: { id: PAIR, objectExtensions: pairExtensions } },
      ],
    });
    expect(rows.map((r) => [r.path, r.rule, r.packageId])).toEqual([
      ['packages[0].manifest.objects[0].fields.region__c', 'reserved_outside_pair', VENDOR],
      ['packages[1].manifest.objectExtensions[0].fields.region', 'unsuffixed_in_pair', PAIR],
    ]);
  });

  it('CONTROL: a stack naming no package id is not judged; a clean stack yields nothing', () => {
    expect(findExtensionFieldSuffixRefusals({ objects })).toEqual([]);
    expect(findExtensionFieldSuffixRefusals({
      manifest: { id: PAIR }, objects, objectExtensions: [{ extend: 'crm_account', fields: { region__c: { type: 'text' } } }],
    })).toEqual([]);
  });
});
