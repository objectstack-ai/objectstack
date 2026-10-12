// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#22870] `FieldSchema.mailAssociation` — the inbound-mail association seam
 * as a declared field-level key (ruling 6116489638, Q1 → A).
 *
 * TRUE marks an email field as identifying a message correspondent: the
 * mailbox service's ingest associates a message with every record whose value
 * in a flagged field equals one of the message's participant addresses. The
 * platform learns which fields carry a correspondent's address and never what
 * a contact is.
 *
 * Declared = enforced (ADR-0049) at the parse seam: the key is refused on
 * every type but `email`, in the `referenceVia` refusal's shape. Its runtime
 * reader lands with the ingest card; until then the liveness ledger row is
 * `planned` with `authorWarn` (pinned in `@objectstack/lint`'s
 * `lint-liveness-properties.test.ts`).
 *
 * The accepted type is HARDCODED below on purpose (not read off the schema),
 * so these pins are an independent measurement rather than a tautology — the
 * #11949 discipline.
 */

import { describe, it, expect } from 'vitest';
import { z } from 'zod';

import { FieldSchema } from './field.zod';
import { fieldForm } from './field.form';

// =========================================================================
// 1. The accepted shape — full parse green, the authored value kept
// =========================================================================

describe('FieldSchema accepts mailAssociation on an email field', () => {
  it('accepts mailAssociation: true on type email, keeping it through parse', () => {
    const result = FieldSchema.safeParse({ name: 'email', label: 'Email', type: 'email', mailAssociation: true });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.mailAssociation).toBe(true);
  });

  it('accepts mailAssociation: false on type email — an explicit "not a correspondent address"', () => {
    const result = FieldSchema.safeParse({ name: 'billing_email', label: 'Billing Email', type: 'email', mailAssociation: false });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.mailAssociation).toBe(false);
  });

  it('control: an email field without the key parses, and no default materializes', () => {
    const result = FieldSchema.safeParse({ name: 'email', label: 'Email', type: 'email' });
    expect(result.success).toBe(true);
    if (result.success) expect('mailAssociation' in result.data).toBe(false);
  });

  it('refuses a non-boolean value on an email field (the key is a flag)', () => {
    const result = FieldSchema.safeParse({ name: 'email', label: 'Email', type: 'email', mailAssociation: 'yes' });
    expect(result.success).toBe(false);
    if (!result.success) {
      const issue = result.error.issues.find((i) => i.path[0] === 'mailAssociation');
      expect(issue?.code).toBe('invalid_type');
    }
  });
});

// =========================================================================
// 2. The refusal — every other type, one custom issue at [mailAssociation]
// =========================================================================

const issuesAt = (input: Record<string, unknown>) => {
  const result = FieldSchema.safeParse(input);
  expect(result.success).toBe(false);
  return result.success ? [] : result.error.issues.filter((i) => i.path[0] === 'mailAssociation');
};

describe('mailAssociation is refused off type email', () => {
  // `text` is the near miss an author reaches for (an address kept in a plain
  // string column); `url` and `phone` are the sibling contact-string types;
  // `lookup` points at a record that may HOLD an address, but is not one;
  // `formula` may compute an address per read, with nothing stored to match.
  const wrongTypes = ['text', 'url', 'phone', 'textarea', 'lookup', 'formula', 'number', 'boolean'] as const;
  for (const type of wrongTypes) {
    it(`refuses mailAssociation on type: '${type}' with one custom issue at [mailAssociation] naming the type`, () => {
      const input: Record<string, unknown> = { name: 'contact_address', label: 'Contact Address', type, mailAssociation: true };
      if (type === 'lookup') input.reference = 'crm_contact';
      if (type === 'formula') input.expression = "record.first_name + '@example.com'";
      const issues = issuesAt(input);
      expect(issues).toHaveLength(1);
      expect(issues[0]!.code).toBe('custom');
      expect(issues[0]!.path).toEqual(['mailAssociation']);
      // Named subjects: the legal type and the offending one.
      expect(issues[0]!.message).toContain("`type: 'email'`");
      expect(issues[0]!.message).toContain(`\`${type}\``);
    });
  }

  it('refuses mailAssociation: false off-type too — an authored value on a type it describes nothing on', () => {
    const issues = issuesAt({ name: 'notes', label: 'Notes', type: 'text', mailAssociation: false });
    expect(issues).toHaveLength(1);
    expect(issues[0]!.code).toBe('custom');
  });

  it('the refusal is the only issue on an otherwise valid text field — the fixture is not malformed some other way', () => {
    const result = FieldSchema.safeParse({ name: 'contact_address', label: 'Contact Address', type: 'text', mailAssociation: true });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.map((i) => i.path.join('.'))).toEqual(['mailAssociation']);
    }
    // POSITIVE CONTROL — the same field without the key parses.
    expect(FieldSchema.safeParse({ name: 'contact_address', label: 'Contact Address', type: 'text' }).success).toBe(true);
  });
});

// =========================================================================
// 3. The JSON-schema projection carries the key
// =========================================================================

describe('the JSON-schema projection of FieldSchema carries mailAssociation', () => {
  it('declares an optional boolean property whose description names its one legal type', () => {
    const js = z.toJSONSchema(FieldSchema as unknown as z.ZodType, {
      unrepresentable: 'any',
      io: 'input',
    }) as { properties?: Record<string, { type?: string; description?: string }>; required?: string[] };
    const prop = js.properties?.mailAssociation;
    expect(prop).toBeDefined();
    expect(prop!.type).toBe('boolean');
    expect(prop!.description).toContain('`email` fields only');
    expect(js.required ?? []).not.toContain('mailAssociation');
  });
});

// =========================================================================
// 4. The offer side — the field form shows the key exactly where it parses
// =========================================================================

describe('field.form offers mailAssociation on exactly the type the door accepts', () => {
  const rows = (fieldForm.sections ?? []).flatMap((s) => s.fields ?? []) as Array<{ field?: string; visibleWhen?: unknown }>;
  // `defineForm` normalizes a bare predicate string to its `{ dialect, source }`
  // envelope, so the gate is read off `source`.
  const gateOf = (row: { visibleWhen?: unknown }) => {
    const v = row.visibleWhen as string | { source?: string } | undefined;
    return typeof v === 'string' ? v : String(v?.source);
  };

  it('offers one mailAssociation row, gated on the email type', () => {
    const matching = rows.filter((r) => r.field === 'mailAssociation');
    expect(matching).toHaveLength(1);
    expect(gateOf(matching[0]!)).toBe("data.type == 'email'");
  });
});
