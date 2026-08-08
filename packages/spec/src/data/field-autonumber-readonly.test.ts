// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #5628 — `Field.autonumber` declares the field `readonly: true`.
 *
 * `FieldSchema.readonly` is a TWO-part contract: "never editable in forms" AND
 * server-enforced on both write paths. #5503 / PR #5627 closed the server half
 * for `autonumber` BY TYPE ({@link RUNTIME_OWNED_FIELD_TYPES}) — a
 * caller-supplied record number is stripped before any driver sees it, flag or
 * no flag. The FORM half is keyed on the FLAG, and the builder did not set it,
 * so an authoring/rendering layer deciding editability from `field.readonly`
 * drew an editable "record number" input whose value the server was already
 * guaranteed to discard: the user types one, the create succeeds, and the
 * record comes back carrying the number the sequence issued instead (#4632's
 * "second-class" shape — the write path reports the drop in `droppedFields`,
 * but a renderer need not surface that).
 *
 * These cases pin the flag on the builder's output, and the AUTHORING-TIME
 * verdict on the one config that contradicts it. `readonly: false` on an
 * autonumber field is not a preference the runtime can honour — the value is
 * issued by the engine or the driver's persistent sequence, so an "editable
 * record number" cannot exist. It is rejected at the authoring site by `tsc`
 * (a loud compile error where the metadata is written) rather than accepted and
 * silently coerced, which is the lenient-consumer shape ADR-aligned authoring
 * exists to avoid.
 */

import { describe, it, expect } from 'vitest';
import { Field, FieldSchema, RUNTIME_OWNED_FIELD_TYPES } from './field.zod';

describe('#5628 — Field.autonumber injects readonly: true', () => {
  it('declares the field read-only', () => {
    const f = Field.autonumber({ label: 'Auto Number' });
    expect(f.type).toBe('autonumber');
    expect(f.readonly).toBe(true);
  });

  it('keeps every other config key the author wrote', () => {
    const f = Field.autonumber({ label: 'Invoice No.', autonumberFormat: 'INV-{0000}', required: true });
    expect(f).toMatchObject({
      type: 'autonumber',
      label: 'Invoice No.',
      autonumberFormat: 'INV-{0000}',
      required: true,
      readonly: true,
    });
  });

  it('sets the flag with no config at all', () => {
    expect(Field.autonumber().readonly).toBe(true);
  });

  it('restating `readonly: true` is allowed and changes nothing', () => {
    expect(Field.autonumber({ readonly: true, label: 'No.' }).readonly).toBe(true);
  });

  it('rejects `readonly: false` at the authoring site (compile error), not at runtime', () => {
    // The pin: this line must NOT compile. `tsconfig.test.json` puts this file
    // in front of `tsc` (#5286), so the directive is a real check — delete the
    // injection's type narrowing and `pnpm --filter @objectstack/spec typecheck`
    // fails on an unused @ts-expect-error.
    // @ts-expect-error an autonumber field is runtime-owned: `readonly` is always true
    const f = Field.autonumber({ readonly: false });
    // And a caller that reaches the builder from untyped JS (or through a cast)
    // still gets the flag: the injection is applied AFTER `config`, so it cannot
    // be spread away. Silent coercion is acceptable ONLY because the authoring
    // surface above rejects the same input loudly.
    expect(f.readonly).toBe(true);
  });

  it('the builder output parses as a valid field (the flag is a real authoring key)', () => {
    const parsed = FieldSchema.safeParse({
      name: 'invoice_number',
      label: 'Invoice No.',
      ...Field.autonumber({ autonumberFormat: 'INV-{0000}' }),
    });
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.readonly).toBe(true);
  });
});

describe('#5628 / #5503 — RUNTIME_OWNED_FIELD_TYPES is the protocol vocabulary', () => {
  it('names `autonumber`', () => {
    expect(RUNTIME_OWNED_FIELD_TYPES.has('autonumber')).toBe(true);
  });

  it('does NOT name the other calculated types, nor ordinary ones', () => {
    // `formula` is computed on read (no stored caller value to strip);
    // `summary` is a stored roll-up a caller MAY legitimately seed (#6014).
    for (const t of ['formula', 'summary', 'text', 'number']) {
      expect(RUNTIME_OWNED_FIELD_TYPES.has(t)).toBe(false);
    }
  });
});
