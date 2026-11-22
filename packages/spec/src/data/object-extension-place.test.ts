// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#35901] `ObjectExtensionSchema.place` — an extension says where the
 * fields, groups and child lists it brings go. The shape is judged here; an
 * extension places only what it brings, so a placement naming a field outside
 * its own `fields` is refused at the entry, naming whose the field is. Every
 * refusal row differs from its control by one key alone.
 */
import { describe, it, expect } from 'vitest';
import { ObjectExtensionSchema } from './object.zod';

const extension = (extra: Record<string, unknown> = {}) => ({
  extend: 'account',
  fields: {
    tax_id: { type: 'text', label: 'Tax ID' },
    tax_region: { type: 'text', label: 'Tax region' },
  },
  ...extra,
});

const issuesAt = (input: unknown, path: string) => {
  const parsed = ObjectExtensionSchema.safeParse(input);
  if (parsed.success) return [];
  return parsed.error.issues.filter((issue) => issue.path.join('.') === path).map((issue) => issue.message);
};

describe('ObjectExtensionSchema.place — the three entry forms', () => {
  it('accepts a field, a group and a list placement (control)', () => {
    const parsed = ObjectExtensionSchema.safeParse(extension({
      place: [
        { field: 'tax_id', group: 'basic', after: 'industry' },
        { group: { key: 'tax', label: 'Tax', fields: ['tax_region'] }, after: 'basic' },
        { list: 'contract', before: 'sys_activity', label: 'Contracts', columns: ['name', 'amount'] },
      ],
    }));
    expect(parsed.success).toBe(true);
  });

  it('accepts an entry with no anchor (the end)', () => {
    expect(ObjectExtensionSchema.safeParse(extension({ place: [{ field: 'tax_id', group: 'basic' }] })).success).toBe(true);
    expect(ObjectExtensionSchema.safeParse(extension({ place: [{ list: 'contract.account_id' }] })).success).toBe(true);
  });

  it.each([
    ['an unknown key on a field placement', { field: 'tax_id', group: 'basic', afer: 'industry' }],
    ['a field placement with no group', { field: 'tax_id', after: 'industry' }],
    ['a list placement naming a built-in tab', { list: 'sys_attachment' }],
    ['a list placement whose name is no entry name', { list: 'Contract' }],
    ['a group placement whose group has no label', { group: { key: 'tax' } }],
  ])('refuses %s', (_label, entry) => {
    expect(ObjectExtensionSchema.safeParse(extension({ place: [entry] })).success).toBe(false);
  });
});

describe('ObjectExtensionSchema.place — an extension places only what it brings', () => {
  it('refuses a field of the extended object, at the entry, saying whose it is', () => {
    const messages = issuesAt(extension({ place: [{ field: 'industry', group: 'other' }] }), 'place.0.field');
    expect(messages).toHaveLength(1);
    expect(messages[0]).toContain('`industry` is not a field this extension adds');
    expect(messages[0]).toContain('A field of the extended object, or of another package\'s extension, is arranged by its owner');
  });

  it('refuses a group whose fields name a field the extension does not add', () => {
    const messages = issuesAt(
      extension({ place: [{ group: { key: 'tax', label: 'Tax', fields: ['tax_id', 'industry'] } }] }),
      'place.0.group.fields.1',
    );
    expect(messages).toHaveLength(1);
    expect(messages[0]).toContain('`industry` is not a field this extension adds');
  });

  it('refuses an entry that writes both after and before', () => {
    const messages = issuesAt(
      extension({ place: [{ field: 'tax_id', group: 'basic', after: 'industry', before: 'phone' }] }),
      'place.0.before',
    );
    expect(messages).toEqual(['A placement writes `after` or `before`, not both: name the one item it sits next to.']);
  });

  it('refuses a field placed twice, by two entries or by an entry and its group\'s fields', () => {
    expect(issuesAt(
      extension({ place: [{ field: 'tax_id', group: 'basic' }, { field: 'tax_id', group: 'other' }] }),
      'place.1.field',
    )).toHaveLength(1);
    expect(issuesAt(
      extension({ place: [{ field: 'tax_id', group: 'basic' }, { group: { key: 'tax', label: 'Tax', fields: ['tax_id'] } }] }),
      'place.1.group.fields.0',
    )).toHaveLength(1);
  });

  it('refuses a list or a group placed twice, and an item anchored at itself', () => {
    expect(issuesAt(extension({ place: [{ list: 'contract' }, { list: 'contract' }] }), 'place.1.list')).toHaveLength(1);
    expect(issuesAt(
      extension({ place: [{ group: { key: 'tax', label: 'Tax' } }, { group: { key: 'tax', label: 'Tax 2' } }] }),
      'place.1.group.key',
    )).toHaveLength(1);
    expect(issuesAt(extension({ place: [{ list: 'contract', after: 'contract' }] }), 'place.0.after')).toHaveLength(1);
  });

  it('refuses a field whose own group names another group than its placement', () => {
    const input = extension({
      fields: { tax_id: { type: 'text', label: 'Tax ID', group: 'finance' } },
      place: [{ field: 'tax_id', group: 'basic' }],
    });
    const messages = issuesAt(input, 'place.0.group');
    expect(messages).toHaveLength(1);
    expect(messages[0]).toContain("declares `group: 'finance'` and this placement puts it in `basic`");
    // Control: the same group on both sides is one answer.
    const agreeing = extension({
      fields: { tax_id: { type: 'text', label: 'Tax ID', group: 'basic' } },
      place: [{ field: 'tax_id', group: 'basic' }],
    });
    expect(ObjectExtensionSchema.safeParse(agreeing).success).toBe(true);
  });
});

describe('ObjectExtensionSchema.place — the guide\'s example', () => {
  it('control: `content/docs/data-modeling/object-extensions.mdx`, "Placing what you bring", parses whole', () => {
    const parsed = ObjectExtensionSchema.safeParse({
      extend: 'crm_account',
      fields: { tax_id: { type: 'text', label: 'Tax ID' } },
      place: [
        { field: 'tax_id', group: 'basic', after: 'industry' },
        { group: { key: 'tax', label: 'Tax' }, after: 'basic' },
        { list: 'acme_contract', after: 'crm_opportunity', label: 'Contracts', columns: ['name', 'amount'] },
      ],
    });
    expect(parsed.success).toBe(true);
  });
});

describe('ObjectExtensionSchema — the arrangement keys are the paired `.custom` package\'s', () => {
  // [ADR-0146 D10] `fieldGroups` and `relatedLists` are keys of the shape, written by the
  // paired `.custom` package's extension (`object-extension-arrangement.test.ts`). Which
  // package an extension belongs to is not in its body, so this parse cannot refuse another
  // writer: the server does, prescribing `place` (`judgeExtensionArrangement`,
  // `@objectstack/metadata-protocol`), at publish, `os validate` / `os build` and install.
  it.each([
    ['fieldGroups', [{ key: 'tax', label: 'Tax' }]],
    ['relatedLists', ['contract']],
  ])('`%s` parses: the shape carries it, the server judges who wrote it', (key, value) => {
    expect(ObjectExtensionSchema.safeParse(extension({ [key]: value })).success).toBe(true);
  });
});
