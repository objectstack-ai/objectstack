// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import { ObjectSchema, ObjectExtensionSchema, materializeTreeSelfReferences } from './object.zod';
import { FieldSchema } from './field.zod';
import { referenceTargetOf } from './field-value.zod';
import { defineStack } from '../stack.zod';
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

describe('a `tree` field\'s `reference` must name the declaring object', () => {
  it('accepts a self-reference through the object schema, and through create()', () => {
    const parsed = ObjectSchema.safeParse(zoo('showcase_field_zoo'));
    expect(parsed.success, parsed.success ? '' : JSON.stringify(parsed.error.issues)).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.fields.f_tree.reference).toBe('showcase_field_zoo');
    // The relational family's delete semantics: a self-referential hierarchy
    // is a relation and its cascade default is exactly the intended meaning.
    expect(parsed.data.fields.f_tree.deleteBehavior).toBe('set_null');

    // The authoring door, spelled as an author spells it (the literal keeps
    // `create()`'s generic inferable, so `fields.f_tree` is typed).
    const created = ObjectSchema.create({
      name: 'showcase_field_zoo',
      fields: {
        name: { type: 'text', label: 'Name' },
        f_tree: { type: 'tree', label: 'Tree', reference: 'showcase_field_zoo' },
      },
    });
    expect(created.fields.f_tree.reference).toBe('showcase_field_zoo');
  });

  it('accepts an ABSENT reference — a redundant self-annotation may be omitted — and it is still a relation', () => {
    const parsed = ObjectSchema.safeParse(zoo());
    expect(parsed.success, parsed.success ? '' : JSON.stringify(parsed.error.issues)).toBe(true);
    if (!parsed.success) return;
    // [#23065] Omitted is accepted, and the parse writes the self-reference the
    // omission means (the block below pins that reading in full).
    expect(parsed.data.fields.f_tree.reference).toBe('showcase_field_zoo');
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
    expect(() => ObjectSchema.create({
      name: 'showcase_field_zoo',
      fields: {
        name: { type: 'text', label: 'Name' },
        f_tree: { type: 'tree', label: 'Tree', reference: 'showcase_category' },
      },
    })).toThrow(/showcase_category/);
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

// ---------------------------------------------------------------------------
// [#23065] A `tree` field that names no `reference` references the object that
// declares it, and the doors that know that object WRITE it down. The contract
// already read the omission as a self-reference (the refusal above tells
// authors to drop the key, and `FieldSchema` materializes `set_null` on the
// field), but nothing could read the target off a field alone, so every reader
// answered "no target": the delete walk never reached the field, and a parent
// delete left its children holding the deleted id. The engine's registry runs
// the same helper for the doors this parse does not cover (its own pins).
// ---------------------------------------------------------------------------

describe('a referenceless `tree` is written as a self-reference by the doors that know the object', () => {
  it('the object parse writes the own name, byte-identical to a field that wrote it, and a re-parse is a no-op', () => {
    const omitted = ObjectSchema.parse(zoo());
    const written = ObjectSchema.parse(zoo('showcase_field_zoo'));
    expect(omitted.fields.f_tree.reference).toBe('showcase_field_zoo');
    // The same bytes, key order included: the key lands at its shape position.
    expect(JSON.stringify(omitted)).toBe(JSON.stringify(written));
    expect(JSON.stringify(ObjectSchema.parse(omitted))).toBe(JSON.stringify(omitted));
    // The reader of one field now answers the target, as for any self-reference.
    expect(referenceTargetOf(omitted.fields.f_tree)).toBe('showcase_field_zoo');
  });

  it('the authoring door (create()) and the stack door (defineStack) write it too', () => {
    const created = ObjectSchema.create({
      name: 'category',
      fields: { name: { type: 'text', label: 'Name' }, parent: { type: 'tree', label: 'Parent' } },
    });
    // `create()` is typed off the authored literal, so the written key is read
    // through the field's declared shape.
    expect((created.fields.parent as { reference?: string }).reference).toBe('category');

    const stack = defineStack({
      manifest: { id: 'com.example.tree', namespace: 'tre', version: '0.0.1', type: 'app', name: 'Tree' },
      objects: [{ name: 'tre_node', fields: { name: { type: 'text' }, parent: { type: 'tree', deleteBehavior: 'cascade' } } }],
    });
    const parent = (stack.objects?.[0]?.fields as Record<string, { reference?: string; deleteBehavior?: string }>).parent;
    expect(parent).toMatchObject({ reference: 'tre_node', deleteBehavior: 'cascade' });
  });

  it('the extension door writes the object it extends', () => {
    const ext = ObjectExtensionSchema.parse({
      extend: 'contact',
      fields: { parent_contact: { type: 'tree', label: 'Parent' } },
    });
    expect(ext.fields?.parent_contact.reference).toBe('contact');
  });

  it('the refusal\'s own remedy now holds: dropping a foreign `reference` yields the self-reference', () => {
    const refused = ObjectSchema.safeParse(zoo('showcase_category'));
    expect(refused.success).toBe(false);
    if (refused.success) return;
    expect(refused.error.issues[0].message).toContain('Drop `reference`');
    expect(ObjectSchema.parse(zoo()).fields.f_tree.reference).toBe('showcase_field_zoo');
  });

  it('CONTROL: a written self-reference, a lookup and a master_detail parse exactly as before', () => {
    // Each field, parsed inside the object, is exactly what `FieldSchema` alone
    // makes of it: the object door wrote nothing onto any of them.
    const fields = {
      f_tree: { type: 'tree', label: 'Tree', reference: 'showcase_field_zoo' },
      f_lookup: { type: 'lookup', label: 'Account', reference: 'showcase_account' },
      f_master_detail: { type: 'master_detail', label: 'Project', reference: 'showcase_project' },
      f_text: { type: 'text', label: 'Text' },
    } as const;
    const parsed = ObjectSchema.parse({ name: 'showcase_field_zoo', fields });
    for (const [name, def] of Object.entries(fields)) {
      expect(JSON.stringify(parsed.fields[name]), name).toBe(JSON.stringify(FieldSchema.parse(def)));
    }
    expect(parsed.fields.f_text).not.toHaveProperty('reference');
  });

  it('the helper: absence is `undefined` or `null`, every other value is untouched, nothing to write allocates nothing', () => {
    const untouched = { name: { type: 'text' }, parent: { type: 'tree', reference: 'node' } };
    expect(materializeTreeSelfReferences('node', untouched)).toBe(untouched);

    const fields = {
      a: { type: 'tree' },
      b: { type: 'tree', reference: null },
      c: { type: 'tree', reference: '' },
      d: { type: 'tree', reference: { object: 'node' } },
      e: { type: 'lookup' },
    };
    const out = materializeTreeSelfReferences('node', fields) as Record<string, { reference?: unknown }>;
    expect(out).not.toBe(fields);
    expect([out.a.reference, out.b.reference]).toEqual(['node', 'node']);
    // `''` is not absence here: the parse refuses it on a tree (the pin below),
    // so the helper leaves it as written instead of repairing it unparsed.
    expect(out.c).toBe(fields.c);
    // A non-string carrier is the carrier reader's to refuse, loudly — never
    // overwritten here, where it would read as a valid self-reference.
    expect(out.d).toBe(fields.d);
    expect(out.e).toBe(fields.e);
    // The input is not mutated.
    expect(fields.a).toEqual({ type: 'tree' });
    // Only an empty string to look at: nothing is written, nothing allocated.
    const onlyEmpty = { parent: { type: 'tree', reference: '' } };
    expect(materializeTreeSelfReferences('node', onlyEmpty)).toBe(onlyEmpty);

    // No name, or no field map, is nothing to write against.
    expect(materializeTreeSelfReferences(undefined, fields)).toBe(fields);
    expect(materializeTreeSelfReferences('', fields)).toBe(fields);
    const list = [{ name: 'parent', type: 'tree' }];
    expect(materializeTreeSelfReferences('node', list)).toBe(list);
  });

  it('`reference: \'\'` on a tree has one reading: the parse refuses it, and nothing writes over it', () => {
    const parsed = ObjectSchema.safeParse(zoo(''));
    expect(parsed.success).toBe(false);
    if (parsed.success) return;
    expect(parsed.error.issues.map((i) => i.path)).toEqual([['fields', 'f_tree', 'reference']]);
  });
});
