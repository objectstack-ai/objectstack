import { describe, it, expect } from 'vitest';
import { deriveFieldGroupSections } from './fieldGroups';
import type { FormField } from '@object-ui/types';

const field = (name: string, group?: string): FormField =>
  ({ name, label: name, ...(group ? { group } : {}) }) as FormField;

describe('deriveFieldGroupSections', () => {
  const groups = [
    { key: 'contact', label: 'Contact Info' },
    { key: 'billing', label: 'Billing' },
  ];

  it('returns null when no groups are declared', () => {
    expect(deriveFieldGroupSections([field('a', 'contact')], undefined)).toBeNull();
    expect(deriveFieldGroupSections([field('a', 'contact')], [])).toBeNull();
  });

  it('returns null when no field opts into a declared group', () => {
    expect(deriveFieldGroupSections([field('a'), field('b')], groups)).toBeNull();
    // group references an undeclared key → treated as ungrouped → null
    expect(deriveFieldGroupSections([field('a', 'unknown')], groups)).toBeNull();
  });

  it('drops malformed group entries but keeps the valid ones', () => {
    const sections = deriveFieldGroupSections(
      [field('email', 'contact')],
      [{ key: 'contact', label: 'Contact Info' }, { label: 'no key' }, { key: 42 }, null, 'nope'],
    );
    expect(sections).toEqual([
      { name: 'contact', label: 'Contact Info', fields: ['email'] },
    ]);
  });

  it('groups fields in declared order using field names', () => {
    const sections = deriveFieldGroupSections(
      [field('email', 'contact'), field('amount', 'billing'), field('phone', 'contact')],
      groups,
    );
    expect(sections).toEqual([
      { name: 'contact', label: 'Contact Info', fields: ['email', 'phone'] },
      { name: 'billing', label: 'Billing', fields: ['amount'] },
    ]);
  });

  it('drops empty declared groups', () => {
    const sections = deriveFieldGroupSections([field('email', 'contact')], groups);
    expect(sections).toEqual([
      { name: 'contact', label: 'Contact Info', fields: ['email'] },
    ]);
  });

  it('collects ungrouped fields into a trailing untitled section', () => {
    const sections = deriveFieldGroupSections(
      [field('name'), field('email', 'contact'), field('notes', 'unknown')],
      groups,
    );
    expect(sections).toEqual([
      { name: 'contact', label: 'Contact Info', fields: ['email'] },
      { fields: ['name', 'notes'] },
    ]);
    // The trailing bucket carries no name/label so it renders flat (no header).
    expect(sections?.[1]).not.toHaveProperty('name');
    expect(sections?.[1]).not.toHaveProperty('label');
  });

  it('keeps rendered audit/system fields by re-appending them to the trailing bucket', () => {
    // The shared derivation excludes audit fields from DEFAULT buckets, but a
    // field the form already renders must never be silently dropped.
    const sections = deriveFieldGroupSections(
      [field('email', 'contact'), field('created_at')],
      groups,
    );
    expect(sections).toEqual([
      { name: 'contact', label: 'Contact Info', fields: ['email'] },
      { fields: ['created_at'] },
    ]);
  });

  it('falls back to a group key when no label is given', () => {
    const sections = deriveFieldGroupSections(
      [field('email', 'contact')],
      [{ key: 'contact' }],
    );
    expect(sections).toEqual([{ name: 'contact', label: 'contact', fields: ['email'] }]);
  });

  it('maps the canonical collapse enum onto the renderer flags (ADR-0085)', () => {
    const sections = deriveFieldGroupSections(
      [field('email', 'contact'), field('amount', 'billing'), field('note', 'plain')],
      [
        { key: 'contact', label: 'Contact Info', collapse: 'collapsed' },
        { key: 'billing', label: 'Billing', collapse: 'expanded' },
        { key: 'plain', label: 'Plain', collapse: 'none' },
      ],
    );
    expect(sections).toEqual([
      { name: 'contact', label: 'Contact Info', fields: ['email'], collapsible: true, collapsed: true },
      { name: 'billing', label: 'Billing', fields: ['amount'], collapsible: true },
      { name: 'plain', label: 'Plain', fields: ['note'] },
    ]);
  });

  it('still honours the deprecated collapsible/collapsed pair (pre-ADR-0085 metadata)', () => {
    const sections = deriveFieldGroupSections(
      [field('email', 'contact'), field('amount', 'billing')],
      [
        { key: 'contact', label: 'Contact Info', collapsible: true, collapsed: true },
        { key: 'billing', label: 'Billing', collapsible: true },
      ],
    );
    expect(sections).toEqual([
      { name: 'contact', label: 'Contact Info', fields: ['email'], collapsible: true, collapsed: true },
      { name: 'billing', label: 'Billing', fields: ['amount'], collapsible: true },
    ]);
  });

  it('still honours the deprecated defaultExpanded spec flag', () => {
    const sections = deriveFieldGroupSections(
      [field('email', 'contact')],
      [{ key: 'contact', label: 'Contact Info', defaultExpanded: false }],
    );
    expect(sections).toEqual([
      { name: 'contact', label: 'Contact Info', fields: ['email'], collapsible: true, collapsed: true },
    ]);
  });

  it('omits collapse flags entirely when a group does not declare them', () => {
    const [section] = deriveFieldGroupSections([field('email', 'contact')], groups)!;
    expect(section).not.toHaveProperty('collapsible');
    expect(section).not.toHaveProperty('collapsed');
  });
});
