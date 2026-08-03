// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// ADR-0104 D1 — contract ⇔ oracle interlock.
//
// The field-zoo MATRIX is the executable oracle of what each FieldType stores
// (driven over real HTTP by field-zoo-roundtrip.dogfood.test.ts). The spec's
// `valueSchemaFor` is the declared value-shape contract. This test pins them
// together: every MATRIX write vector must parse under the contract's stored
// form. A contract change that would break the wire — or a MATRIX change the
// contract doesn't admit — fails here instead of shipping silently.
//
// No stack boot: this is a pure unit-level assertion, cheap enough for every
// CI run (the HTTP round-trip stays in the dogfood tier).

import { describe, it, expect } from 'vitest';
import { valueSchemaFor } from '@objectstack/spec/data';
import { MATRIX } from './field-zoo.matrix.js';

describe('ADR-0104: field-zoo MATRIX write vectors parse under valueSchemaFor(stored)', () => {
  const writable = MATRIX.filter(
    (c) => c.check.kind === 'equal' || c.check.kind === 'setEqual' || c.check.kind === 'masked',
  );

  it('covers a meaningful slice of the matrix', () => {
    expect(writable.length).toBeGreaterThanOrEqual(40);
  });

  for (const c of writable) {
    it(`${c.field} (${c.type})`, () => {
      const write = (c.check as { write: unknown }).write;
      const result = valueSchemaFor({ type: c.type }, 'stored').safeParse(write);
      expect(
        result.success,
        result.success ? undefined : `${c.type} write ${JSON.stringify(write)} rejected: ${result.error.issues[0]?.message}`,
      ).toBe(true);
    });
  }
});
