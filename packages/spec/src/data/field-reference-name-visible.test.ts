// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#29171] `FieldSchema.referenceNameVisible` — declared name exposure on the
 * referencing field (director ruling 6574398310, letter B).
 *
 * TRUE declares that a principal who can read the record carrying the field
 * may see the referenced record's display name (the target's `nameField`) and
 * id even when it cannot read the target; nothing else of the target. Absent
 * or false keeps the restricted-reference posture. The key lives on the
 * referencing field only: the ruling refuses a target-object switch.
 *
 * Served on `$expand` (ADR-0049: declared = served): objectql answers a
 * refused target as `{ id, name, readRefused: true }`. The server change that
 * served it dropped the describe's `[PLANNED — not yet served]` marker and
 * flipped the pin in section 3; the liveness ledger's row cites the runtime
 * and its real-driver test.
 *
 * The accepted types are HARDCODED below on purpose (not read off the schema),
 * so these pins are an independent measurement rather than a tautology.
 */

import { describe, it, expect } from 'vitest';
import { z } from 'zod';

import { FieldSchema } from './field.zod';
import { ObjectSchema } from './object.zod';

const KEY = 'referenceNameVisible';

// =========================================================================
// 1. The accepted shape — full parse green, the authored value kept
// =========================================================================

describe('FieldSchema accepts referenceNameVisible on a lookup or user field', () => {
  it('accepts true on a lookup, keeping it through parse', () => {
    const result = FieldSchema.safeParse({
      name: 'material', label: 'Material', type: 'lookup', reference: 'srm_material', referenceNameVisible: true,
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.referenceNameVisible).toBe(true);
  });

  it('accepts true on a multi-value lookup (each referenced record is named alike)', () => {
    const result = FieldSchema.safeParse({
      name: 'categories', label: 'Categories', type: 'lookup', reference: 'srm_category', multiple: true,
      referenceNameVisible: true,
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.referenceNameVisible).toBe(true);
  });

  it('accepts true on a lookup to sys_user and on a user field (the ruling covers sys_user names)', () => {
    const lookup = FieldSchema.safeParse({
      name: 'buyer', label: 'Buyer', type: 'lookup', reference: 'sys_user', referenceNameVisible: true,
    });
    expect(lookup.success).toBe(true);
    const user = FieldSchema.safeParse({ name: 'reviewer', label: 'Reviewer', type: 'user', referenceNameVisible: true });
    expect(user.success).toBe(true);
    if (user.success) expect(user.data.referenceNameVisible).toBe(true);
  });

  it('accepts an explicit false on a lookup (the default posture, authored)', () => {
    const result = FieldSchema.safeParse({
      name: 'material', label: 'Material', type: 'lookup', reference: 'srm_material', referenceNameVisible: false,
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.referenceNameVisible).toBe(false);
  });

  it('control: a lookup without the key parses, and no default materializes (absent = off)', () => {
    const result = FieldSchema.safeParse({ name: 'material', label: 'Material', type: 'lookup', reference: 'srm_material' });
    expect(result.success).toBe(true);
    if (result.success) expect(KEY in result.data).toBe(false);
  });

  it('refuses a non-boolean value (the key is a flag)', () => {
    const result = FieldSchema.safeParse({
      name: 'material', label: 'Material', type: 'lookup', reference: 'srm_material', referenceNameVisible: 'yes',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const issue = result.error.issues.find((i) => i.path[0] === KEY);
      expect(issue?.code).toBe('invalid_type');
    }
  });

  it('rides through ObjectSchema on a field of an object (the authoring door an app uses)', () => {
    const result = ObjectSchema.safeParse({
      name: 'srm_corrective_action',
      label: 'Corrective Action',
      fields: {
        title: { type: 'text', label: 'Title' },
        material: { type: 'lookup', label: 'Material', reference: 'srm_material', referenceNameVisible: true },
      },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect((result.data.fields.material as { referenceNameVisible?: boolean }).referenceNameVisible).toBe(true);
    }
  });
});

// =========================================================================
// 2. The refusal — every other type, one custom issue at [referenceNameVisible]
// =========================================================================

const issuesAt = (input: Record<string, unknown>) => {
  const result = FieldSchema.safeParse(input);
  expect(result.success).toBe(false);
  return result.success ? [] : result.error.issues.filter((i) => i.path[0] === KEY);
};

describe('referenceNameVisible is refused off lookup and user', () => {
  // `master_detail` is the near miss: a relationship, but the ruling places
  // the key on the referencing lookup. `tree` is a self-reference; `text` is
  // the polymorphic pointer's id half (`referenceVia`), with no fixed target.
  const wrongTypes = ['master_detail', 'tree', 'text', 'select', 'formula', 'number'] as const;
  for (const type of wrongTypes) {
    it(`refuses it on type: '${type}' with one custom issue at [${KEY}] naming the type`, () => {
      const input: Record<string, unknown> = { name: 'material', label: 'Material', type, referenceNameVisible: true };
      if (type === 'master_detail') input.reference = 'srm_material';
      if (type === 'select') input.options = [{ label: 'A', value: 'a' }];
      if (type === 'formula') input.expression = 'record.title';
      const issues = issuesAt(input);
      expect(issues).toHaveLength(1);
      expect(issues[0]!.code).toBe('custom');
      expect(issues[0]!.path).toEqual([KEY]);
      // Named subjects: the legal types and the offending one.
      expect(issues[0]!.message).toContain("`type: 'lookup'`");
      expect(issues[0]!.message).toContain("`type: 'user'`");
      expect(issues[0]!.message).toContain(`\`${type}\``);
    });
  }

  it('refuses an authored false off-type too — a value on a type it describes nothing on', () => {
    const issues = issuesAt({ name: 'notes', label: 'Notes', type: 'text', referenceNameVisible: false });
    expect(issues).toHaveLength(1);
    expect(issues[0]!.code).toBe('custom');
  });

  it('the refusal is the only issue on an otherwise valid master_detail field', () => {
    const input = { name: 'parent', label: 'Parent', type: 'master_detail', reference: 'srm_order' };
    const result = FieldSchema.safeParse({ ...input, referenceNameVisible: true });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues.map((i) => i.path.join('.'))).toEqual([KEY]);
    // POSITIVE CONTROL — the same field without the key parses.
    expect(FieldSchema.safeParse(input).success).toBe(true);
  });

  it('the refusal message carries no tracker number (runtime prose, check:doc-authoring)', () => {
    const issues = issuesAt({ name: 'notes', label: 'Notes', type: 'text', referenceNameVisible: true });
    expect(issues[0]!.message).not.toMatch(/#\d{3,}/);
  });
});

// =========================================================================
// 3. Served — no planned marker, and the projection
// =========================================================================

describe('the JSON-schema projection of FieldSchema carries referenceNameVisible as served', () => {
  const js = z.toJSONSchema(FieldSchema as unknown as z.ZodType, {
    unrepresentable: 'any',
    io: 'input',
  }) as { properties?: Record<string, { type?: string; description?: string }>; required?: string[] };
  const prop = js.properties?.[KEY];

  it('declares an optional boolean property', () => {
    expect(prop).toBeDefined();
    expect(prop!.type).toBe('boolean');
    expect(js.required ?? []).not.toContain(KEY);
  });

  it('carries no planned marker now that $expand serves it, and names the served value', () => {
    // The server change that serves the key dropped the marker and flipped
    // this pin (ADR-0049: declared = served).
    expect(prop!.description).not.toMatch(/\[PLANNED/);
    expect(prop!.description).toContain('`{ id, name, readRefused: true }`');
    expect(prop!.description).not.toMatch(/#\d{3,}/);
  });

  it('states the ruling\'s bounds: name and id only, no link, the referencing field only', () => {
    const d = prop!.description!;
    expect(d).toContain('`lookup` and `user` fields only');
    expect(d).toContain('`nameField`');
    expect(d).toContain('same name and id only');
    expect(d).toContain('no link to the target');
    expect(d).toContain('no target-object switch');
  });
});
