// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * A `type: 'file'` screen field is a VALUE domain on resume (#25801).
 *
 * The console renders the platform upload widget for it, the upload lands as a
 * `sys_file` no record owns yet, and the resume carries that file's id —
 * ADR-0104 D3's stored form — so a later node can write it into an object's
 * `file` field and that write claims the file. A caller that skips the console
 * and posts anything else (a URL, the expanded read form, a number) is refused
 * with `invalid_type`, ⛔ never reduced to an id: the reduction is the
 * console's, done before it posts.
 *
 * The id is judged by the spec's `isFileIdToken`, the predicate the claim path
 * reads, so the pairing below asserts the door and the claimer agree.
 */

import { describe, expect, it } from 'vitest';

import type { ScreenFieldSpec } from '@objectstack/spec/contracts';
import { isFileIdToken } from '@objectstack/spec/data';

import { validateScreenInputs } from './screen-input-contract.js';

const ALWAYS_VISIBLE = () => true;

const contract: ScreenFieldSpec = { name: 'contract_file', label: 'Contract', type: 'file', required: true };

/** Ids shaped as the storage service mints them: a uuid and a nanoid. */
const MINTED = ['3f1c2a9e-7b4d-4e0a-9c3f-2d8b6a1e5f70', 'V1StGXR8_Z5jdHi6B-myT'];

describe('validateScreenInputs — a `type: \'file\'` field takes the uploaded file\'s id (#25801)', () => {
  it('accepts a minted `sys_file` id', () => {
    for (const id of MINTED) {
      expect(validateScreenInputs([contract], { contract_file: id }, ALWAYS_VISIBLE), id).toEqual([]);
    }
  });

  it('refuses every other shape with `invalid_type`, naming what it expected', () => {
    const shapes: Array<[string, unknown]> = [
      ['the download URL', '/api/v1/storage/files/V1StGXR8_Z5jdHi6B-myT'],
      ['an absolute URL', 'https://cdn.example.com/nda.pdf'],
      ['the expanded read form', { id: MINTED[1], name: 'nda.pdf', size: 12, mimeType: 'application/pdf', url: '/x' }],
      ['a legacy inline blob', { file_id: MINTED[1], name: 'nda.pdf', url: 'blob:abc' }],
      ['a list of ids', [MINTED[0]]],
      ['a number', 42],
    ];
    for (const [label, value] of shapes) {
      const issues = validateScreenInputs([contract], { contract_file: value }, ALWAYS_VISIBLE);
      expect(issues.map((i) => i.code), label).toEqual(['invalid_type']);
      expect(issues[0]!.field, label).toBe('contract_file');
      expect(issues[0]!.message, label).toBe('Screen field "contract_file" must be the id of an uploaded file');
    }
  });

  it('agrees with the claim path\'s predicate on every shape above', () => {
    // The door admits exactly what `isFileIdToken` calls a reference — the
    // predicate the record write's claim path reads — so a value admitted here
    // is one a later write can claim, and nothing it refuses could be.
    const values: unknown[] = [...MINTED, '/api/v1/storage/files/abc', 'https://x.test/a.pdf', 'has space', 42, {}];
    for (const value of values) {
      const admitted = validateScreenInputs([contract], { contract_file: value }, ALWAYS_VISIBLE).length === 0;
      expect(admitted, JSON.stringify(value)).toBe(isFileIdToken(value));
    }
  });

  it('leaves absence to `required`, and an optional empty field alone', () => {
    expect(validateScreenInputs([contract], {}, ALWAYS_VISIBLE).map((i) => i.code)).toEqual(['required']);
    expect(validateScreenInputs([contract], { contract_file: null }, ALWAYS_VISIBLE).map((i) => i.code))
      .toEqual(['required']);
    const optional: ScreenFieldSpec = { ...contract, required: false };
    expect(validateScreenInputs([optional], {}, ALWAYS_VISIBLE)).toEqual([]);
    expect(validateScreenInputs([optional], { contract_file: '' }, ALWAYS_VISIBLE)).toEqual([]);
  });

  it('does not judge a field the user was never shown', () => {
    const conditional: ScreenFieldSpec = { ...contract, required: false, visibleWhen: 'has_template == false' };
    expect(validateScreenInputs([conditional], { contract_file: 'https://x.test/a.pdf' }, () => false)).toEqual([]);
    expect(validateScreenInputs([conditional], { contract_file: 'https://x.test/a.pdf' }, () => undefined))
      .toEqual([]);
    // …and the control, or the two readings above prove nothing.
    expect(validateScreenInputs([conditional], { contract_file: 'https://x.test/a.pdf' }, () => true))
      .toHaveLength(1);
  });

  it('reads `file` alone — the other media hints stay open widget hints', () => {
    // The set is closed and grows by ruling: `image`, `avatar`, `video` and
    // `audio` share the stored form but are not screen value domains.
    for (const type of ['image', 'avatar', 'video', 'audio']) {
      const field: ScreenFieldSpec = { name: 'media', type };
      expect(validateScreenInputs([field], { media: 'https://x.test/a.png' }, ALWAYS_VISIBLE), type).toEqual([]);
    }
  });
});
