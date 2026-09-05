// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import { ObjectSchema, ObjectExtensionSchema } from './object.zod';
import { FieldSchema } from './field.zod';
import { classifyDottedFilterHead } from './filter-dotted-head';

// ---------------------------------------------------------------------------
// [#14892] A `tree` field's `reference`, when present, must name the declaring
// object — maintainer ruling 2026-09-05, option A. Four surfaces used to answer
// "what does a tree's `reference` mean" four different ways and nothing read or
// refused any of them; this file pins the ONE answer at the door that can judge
// it (the object schema, where the own name is known) and the shape it leaves
// alone (the field schema, which never sees a name).
//
// The pins bear weight in three directions: the two accepted shapes (self, and
// absent — absent stays `relation` and still materialises `deleteBehavior`, the
// fifth reading the ruling folds in), the refused shape with its located issue,
// and the field-level door that deliberately does NOT refuse.
// ---------------------------------------------------------------------------

const zoo = (reference?: string) => ({
  name: 'showcase_field_zoo',
  fields: {
    name: { type: 'text', label: 'Name' },
    f_tree: { type: 'tree', label: 'Tree', ...(reference === undefined ? {} : { reference }) },
  },
});

const firstSentence = (message: string): string => message.split(/\.\s/)[0];

describe('[#14892] a `tree` field\'s `reference` must name the declaring object', () => {
  it('accepts a self-reference through the object schema, and through create()', () => {
    const parsed = ObjectSchema.safeParse(zoo('showcase_field_zoo'));
    expect(parsed.success, parsed.success ? '' : JSON.stringify(parsed.error.issues)).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.fields.f_tree.reference).toBe('showcase_field_zoo');
    // The relational family's delete semantics: a self-referential hierarchy
    // is a relation and its cascade default is exactly the intended meaning.
    expect(parsed.data.fields.f_tree.deleteBehavior).toBe('set_null');

    const created = ObjectSchema.create(zoo('showcase_field_zoo') as never);
    expect(created.fields.f_tree.reference).toBe('showcase_field_zoo');
  });

  it('accepts an ABSENT reference — a redundant self-annotation may be omitted — and it is still a relation', () => {
    const parsed = ObjectSchema.safeParse(zoo());
    expect(parsed.success, parsed.success ? '' : JSON.stringify(parsed.error.issues)).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.fields.f_tree.reference).toBeUndefined();
    // The fifth reading (folded from #13928): a reference-less `tree` is
    // classified `relation` and still materialises `deleteBehavior` beside
    // `lookup` — coherent under this rule, because the hierarchy it declares
    // is self-referential by definition.
    expect(parsed.data.fields.f_tree.deleteBehavior).toBe('set_null');
    expect(classifyDottedFilterHead({ type: 'tree' })).toBe('relation');
  });

  it('refuses a `tree` naming ANOTHER object, at the field\'s `reference`, naming both objects', () => {
    const parsed = ObjectSchema.safeParse(zoo('showcase_category'));
    expect(parsed.success).toBe(false);
    if (parsed.success) return;
    expect(parsed.error.issues).toHaveLength(1);
    const [issue] = parsed.error.issues;
    expect(issue.code).toBe('custom');
    expect(issue.path).toEqual(['fields', 'f_tree', 'reference']);
    // The message's first sentence names the declaring object AND the object
    // the field wrongly points at — the envelope an author greps for.
    const first = firstSentence(issue.message);
    expect(first).toContain('`showcase_field_zoo`');
    expect(first).toContain('`showcase_category`');
    expect(first).toContain('`f_tree`');
    // The remedy travels with the refusal: drop it, self-reference, or lookup.
    expect(issue.message).toContain("'showcase_field_zoo'");
    expect(issue.message).toContain('`lookup`');

    // The authoring door throws the same located issue.
    expect(() => ObjectSchema.create(zoo('showcase_category') as never)).toThrow(/showcase_category/);
  });

  it('judges each `tree` field on its own: one foreign pointer beside a self-reference is one issue', () => {
    const parsed = ObjectSchema.safeParse({
      name: 'category',
      fields: {
        name: { type: 'text', label: 'Name' },
        parent: { type: 'tree', label: 'Parent', reference: 'category' },
        stray: { type: 'tree', label: 'Stray', reference: 'department' },
      },
    });
    expect(parsed.success).toBe(false);
    if (parsed.success) return;
    expect(parsed.error.issues.map((i) => i.path)).toEqual([['fields', 'stray', 'reference']]);
  });

  it('is scoped to `tree`: a lookup / master_detail to another object is untouched (control)', () => {
    const parsed = ObjectSchema.safeParse({
      name: 'showcase_field_zoo',
      fields: {
        name: { type: 'text', label: 'Name' },
        f_lookup: { type: 'lookup', label: 'Account', reference: 'showcase_account' },
        f_master_detail: { type: 'master_detail', label: 'Project', reference: 'showcase_project' },
      },
    });
    expect(parsed.success, parsed.success ? '' : JSON.stringify(parsed.error.issues)).toBe(true);
  });

  it('the field schema alone does NOT refuse — it never learns the declaring object\'s name', () => {
    // Where the rule lives is part of the contract: `FieldSchema` cannot judge
    // a foreign target, so `field.test.ts`'s field-level tree fixtures keep
    // parsing and the refusal is the object door's alone.
    const parsed = FieldSchema.safeParse({ name: 'parent_id', label: 'Parent', type: 'tree', reference: 'category' });
    expect(parsed.success).toBe(true);
  });

  it('the extension door judges against the object it extends', () => {
    const self = ObjectExtensionSchema.safeParse({
      extend: 'contact',
      fields: { parent_contact: { type: 'tree', label: 'Parent', reference: 'contact' } },
    });
    expect(self.success, self.success ? '' : JSON.stringify(self.error.issues)).toBe(true);

    const foreign = ObjectExtensionSchema.safeParse({
      extend: 'contact',
      fields: { parent_contact: { type: 'tree', label: 'Parent', reference: 'company' } },
    });
    expect(foreign.success).toBe(false);
    if (foreign.success) return;
    expect(foreign.error.issues.map((i) => i.path)).toEqual([['fields', 'parent_contact', 'reference']]);
    expect(firstSentence(foreign.error.issues[0].message)).toContain('`contact`');
    expect(firstSentence(foreign.error.issues[0].message)).toContain('`company`');
  });
});
