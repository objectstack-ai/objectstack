// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#32686] The binding a file uploaded before its record carries, judged on
 * its own: which write may put it in a field, and who may read it while no
 * record holds it. The doors that ask it are pinned end to end in
 * `record-file-access.integration.test.ts`; there, another user's write is
 * refused twice over (the read check denies first), so each arm of the rule
 * is pinned here alone.
 */

import { describe, it, expect } from 'vitest';
import {
  PRE_RECORD_UPLOAD_KIND,
  isUploaderOnlyFile,
  preRecordBindingMetadata,
  preRecordBindingOf,
  preRecordReferenceRefusal,
} from './pre-record-upload.js';

const NOW = Date.parse('2026-11-13T12:00:00.000Z');
const LATER = '2026-11-13T13:00:00.000Z';
const EARLIER = '2026-11-13T11:00:00.000Z';

function bound(over: Partial<Record<string, unknown>> = {}, claimUntil = LATER): Record<string, unknown> {
  return {
    id: 'f1',
    owner_id: 'u1',
    status: 'committed',
    ref_object: null,
    ref_id: null,
    ref_field: null,
    metadata: preRecordBindingMetadata({
      kind: PRE_RECORD_UPLOAD_KIND,
      object: 'expense_line',
      field: 'invoice',
      user_id: 'u1',
      organization_id: 'o1',
      claim_until: claimUntil,
    }),
    ...over,
  };
}

const SLOT = { object: 'expense_line', field: 'invoice', heldHere: false };

describe('preRecordReferenceRefusal — a file no record holds yet', () => {
  it('admits its uploader\'s write into its slot within the window', () => {
    expect(preRecordReferenceRefusal(bound(), SLOT, 'u1', NOW)).toBeNull();
  });

  it('refuses another user, answered as a file they cannot open', () => {
    expect(preRecordReferenceRefusal(bound(), SLOT, 'u2', NOW)).toEqual({ kind: 'not_yours' });
  });

  it('refuses a system or context-less write: it names no user whose upload this is', () => {
    expect(preRecordReferenceRefusal(bound(), SLOT, null, NOW)).toEqual({ kind: 'not_yours' });
  });

  it('refuses the uploader\'s write into another field or object, naming the slot it was uploaded for', () => {
    const slot = { kind: 'other_slot', object: 'expense_line', field: 'invoice' };
    expect(preRecordReferenceRefusal(bound(), { ...SLOT, field: 'receipt' }, 'u1', NOW)).toEqual(slot);
    expect(preRecordReferenceRefusal(bound(), { ...SLOT, object: 'claim' }, 'u1', NOW)).toEqual(slot);
  });

  it('refuses the uploader\'s write after the window', () => {
    expect(preRecordReferenceRefusal(bound({}, EARLIER), SLOT, 'u1', NOW)).toEqual({ kind: 'expired' });
    // The deadline itself is past.
    expect(preRecordReferenceRefusal(bound(), SLOT, 'u1', Date.parse(LATER))).toEqual({ kind: 'expired' });
  });

  it('a damaged binding is bound to nobody: every write is refused', () => {
    const damaged = bound({ metadata: JSON.stringify({ kind: PRE_RECORD_UPLOAD_KIND, object: 'expense_line' }) });
    expect(preRecordBindingOf(damaged)).toMatchObject({ user_id: '', field: '', claim_until: '' });
    expect(preRecordReferenceRefusal(damaged, SLOT, 'u1', NOW)).toEqual({ kind: 'not_yours' });
  });
});

describe('preRecordReferenceRefusal — a file a record holds', () => {
  const held = bound({ ref_object: 'expense_line', ref_id: 'r1', ref_field: 'invoice' });

  it('within the window, no user\'s write puts it in a second record', () => {
    expect(preRecordReferenceRefusal(held, SLOT, 'u1', NOW)).toEqual({ kind: 'spent' });
    expect(preRecordReferenceRefusal(held, SLOT, 'u2', NOW)).toEqual({ kind: 'not_yours' });
  });

  it('the slot that holds it rewriting its own value takes nothing, and is admitted', () => {
    expect(preRecordReferenceRefusal(held, { ...SLOT, heldHere: true }, 'u1', NOW)).toBeNull();
  });

  it('a system write, or any write after the window, is judged as for any file a record holds', () => {
    expect(preRecordReferenceRefusal(held, SLOT, null, NOW)).toBeNull();
    expect(preRecordReferenceRefusal(held, SLOT, 'u2', Date.parse(LATER) + 1)).toBeNull();
  });
});

describe('a file with no binding', () => {
  it('is judged as before, by every write and door', () => {
    const plain = { id: 'f2', owner_id: 'u1', status: 'committed', ref_id: null, metadata: null };
    expect(preRecordBindingOf(plain)).toBeNull();
    expect(preRecordReferenceRefusal(plain, SLOT, 'u2', NOW)).toBeNull();
    expect(isUploaderOnlyFile(plain)).toBe(false);
    // Metadata of another kind, even naming the word, is no binding.
    const other = { ...plain, metadata: JSON.stringify({ note: PRE_RECORD_UPLOAD_KIND }) };
    expect(preRecordBindingOf(other)).toBeNull();
    expect(isUploaderOnlyFile(other)).toBe(false);
  });
});

describe('isUploaderOnlyFile — read only by its uploader while no record holds it', () => {
  it('a bound file no record holds', () => {
    expect(isUploaderOnlyFile(bound())).toBe(true);
  });

  it('the pending row a link with no record reserved as its file', () => {
    const link = { id: 'f1', ref_id: null, metadata: JSON.stringify({ kind: 'upload_link', target: 'field', object: 'expense_line', field: 'invoice' }) };
    expect(isUploaderOnlyFile(link)).toBe(true);
  });

  it('not a link for a record, nor a bound file once a record holds it', () => {
    const recordLink = { id: 'l1', ref_id: null, metadata: JSON.stringify({ kind: 'upload_link', target: 'field', record_id: 'r1', field: 'invoice' }) };
    expect(isUploaderOnlyFile(recordLink)).toBe(false);
    expect(isUploaderOnlyFile(bound({ ref_object: 'expense_line', ref_id: 'r1', ref_field: 'invoice' }))).toBe(false);
  });
});
