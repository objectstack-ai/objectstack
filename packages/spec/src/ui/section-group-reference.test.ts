// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #13855 — a layout section may REFERENCE a declared field group instead of
 * enumerating its members (maintainer ruling 2026-08-31: 「直接处理b」).
 *
 * ## What is being pinned
 *
 * The delta form, on both layout escape hatches, through their real doors:
 * `ComponentPropsMap['record:details']` for a custom record page's sections,
 * and `FormViewSchema` for a view-level `form.sections`. Both take
 * `{ group: '<key>' }` in place of `fields`, and both refuse the combinations
 * the mixing rule makes meaningless.
 *
 * ## Why the refusals assert MESSAGES, not just failure
 *
 * Same rule as `view-form-features-root.test.ts`: a bare
 * `expect(success).toBe(false)` carries one bit, and each of these refusals has
 * two — *that* the shape is refused, and *what the author is told to write
 * instead*. The prescription is the whole point of refusing at the authoring
 * door rather than letting the section render empty, so it is pinned.
 *
 * ## Acceptance is pinned as hard as refusal
 *
 * Three accept pins carry the weight the refusals cannot:
 *
 * 1. the reference form parses, and the KEY SURVIVES the parse (a section that
 *    accepted `group` and dropped it on the floor would satisfy every refusal
 *    pin below while delivering nothing — and on the form surface the value has
 *    to survive a `.transform()` and an `.overwrite()` fold to get out);
 * 2. the enumerated form is untouched — `fields` going optional is a widening
 *    for `group`'s sake and must not have loosened anything else;
 * 3. the surface keys the group does NOT declare still ride beside `group`
 *    (`columns`, `pane`, `hideEmpty`, `showBorder`, `headerColor`). A refusal
 *    list written one key too wide is indistinguishable from a correct one
 *    until exactly this parses.
 *
 * Plus the control every accept widening owes: an unknown sibling key is still
 * refused, so the shape did not go strict-less on the way through.
 */

import { describe, it, expect } from 'vitest';

import { ComponentPropsMap } from './component.zod';
import { FormViewSchema } from './view.zod';

type Issue = { code: string; path: Array<string | number>; message: string };

const RecordDetails = ComponentPropsMap['record:details'];

function detailsIssues(value: unknown): Issue[] {
  const r = RecordDetails.safeParse(value);
  expect(r.success, `expected REJECTION, got a successful parse of ${JSON.stringify(value)}`).toBe(false);
  return (r.error?.issues ?? []) as Issue[];
}

function detailsAccept(value: unknown): Record<string, unknown> {
  const r = RecordDetails.safeParse(value);
  expect(r.success, `expected ACCEPTANCE, got ${JSON.stringify(r.error?.issues ?? '')}`).toBe(true);
  return r.data as Record<string, unknown>;
}

/** A minimal form view carrying `sections`, so only the section shape varies. */
function formWith(sections: unknown[], extra: Record<string, unknown> = {}): unknown {
  return { type: 'simple', sections, ...extra };
}

function formIssues(value: unknown): Issue[] {
  const r = FormViewSchema.safeParse(value);
  expect(r.success, `expected REJECTION, got a successful parse of ${JSON.stringify(value)}`).toBe(false);
  return (r.error?.issues ?? []) as Issue[];
}

function formAccept(value: unknown): Record<string, unknown> {
  const r = FormViewSchema.safeParse(value);
  expect(r.success, `expected ACCEPTANCE, got ${JSON.stringify(r.error?.issues ?? '')}`).toBe(true);
  return r.data as Record<string, unknown>;
}

function at(issues: Issue[], path: Array<string | number>): Issue {
  const issue = issues.find(i => JSON.stringify(i.path) === JSON.stringify(path));
  expect(issue, `expected an issue at ${JSON.stringify(path)}, got ${JSON.stringify(issues)}`).toBeDefined();
  return issue!;
}

describe('record:details section — the field-group reference form (#13855)', () => {
  it('accepts a group reference and CARRIES THE KEY THROUGH the parse', () => {
    const parsed = detailsAccept({ sections: [{ group: 'contact_info' }] });
    const sections = parsed.sections as Array<Record<string, unknown>>;
    expect(sections[0].group).toBe('contact_info');
    // The other half of "carried": nothing invented a member list for it.
    expect(sections[0].fields).toBeUndefined();
  });

  it('keeps the enumerated form working unchanged', () => {
    const parsed = detailsAccept({
      sections: [{ name: 'billing', label: 'Billing', fields: ['amount', 'due_at'], columns: 2 }],
    });
    const sections = parsed.sections as Array<Record<string, unknown>>;
    expect(sections[0].fields).toEqual(['amount', 'due_at']);
    // `fields: []` parsed before `group` existed and must keep parsing — the
    // mixing rule tests PRESENCE, never non-emptiness.
    expect(RecordDetails.safeParse({ sections: [{ fields: [] }] }).success).toBe(true);
  });

  it('lets both kinds of section coexist, in declared order', () => {
    const parsed = detailsAccept({
      sections: [{ group: 'contact_info' }, { label: 'Notes', fields: ['note'] }, { group: 'billing' }],
    });
    const sections = parsed.sections as Array<Record<string, unknown>>;
    expect(sections.map(s => s.group ?? s.label)).toEqual(['contact_info', 'Notes', 'billing']);
  });

  it('accepts the surface keys the group does NOT declare beside `group`', () => {
    const parsed = detailsAccept({
      sections: [{
        group: 'contact_info',
        columns: 2,
        hideEmpty: false,
        showBorder: true,
        headerColor: 'muted',
      }],
    });
    const section = (parsed.sections as Array<Record<string, unknown>>)[0];
    expect(section.columns).toBe(2);
    expect(section.hideEmpty).toBe(false);
    expect(section.showBorder).toBe(true);
    expect(section.headerColor).toBe('muted');
  });

  it('refuses `group` beside `fields` — two sources for one fact', () => {
    const issue = at(detailsIssues({ sections: [{ group: 'contact_info', fields: ['email'] }] }), [
      'sections', 0, 'group',
    ]);
    expect(issue.code).toBe('custom');
    expect(issue.message).toContain('`group` and `fields` are mutually exclusive');
    // The prescription: which one to keep, and why the pair is wrong.
    expect(issue.message).toContain('deriveFieldGroupLayout');
    expect(issue.message).toContain("Keep `group: 'contact_info'`");
  });

  it('refuses a section that declares NEITHER — it would render nothing', () => {
    const issue = at(detailsIssues({ sections: [{ label: 'Orphan' }] }), ['sections', 0, 'fields']);
    expect(issue.code).toBe('custom');
    expect(issue.message).toContain('must declare its members exactly one way');
    expect(issue.message).toContain('renders nothing');
  });

  it.each([
    ['name', 'contact'],
    ['label', 'Contact'],
    ['icon', 'user'],
    ['description', 'How to reach them'],
    ['collapsible', true],
    ['defaultCollapsed', true],
  ])('refuses `%s` beside `group` — the group owns it', (key, value) => {
    const issue = at(detailsIssues({ sections: [{ group: 'contact_info', [key]: value }] }), [
      'sections', 0, key,
    ]);
    expect(issue.code).toBe('custom');
    expect(issue.message).toContain(`\`${key}\` cannot be combined with \`group\``);
    // Points at the entry that owns the key, not merely at the refusal.
    expect(issue.message).toContain('`fieldGroups` entry for `contact_info`');
    expect(issue.message).toContain('ADR-0085 §5');
  });

  it('still refuses an unknown sibling key (the widening did not go strict-less)', () => {
    const issues = detailsIssues({ sections: [{ group: 'contact_info', collapsedByDefault: true }] });
    const messages = issues.map(i => i.message).join('\n');
    expect(messages).toContain('collapsedByDefault');
  });

  it('points a near-miss spelling of the new key at `group`', () => {
    const messages = detailsIssues({ sections: [{ fieldGroup: 'contact_info' }] })
      .map(i => i.message).join('\n');
    expect(messages).toContain('fieldGroup');
    expect(messages).toContain('group');
  });
});

describe('form.sections — the field-group reference form (#13855)', () => {
  it('accepts a group reference and carries the key through transform AND fold', () => {
    // The value has to survive `FormSectionSchema`'s `.transform`, the form
    // view's `.superRefine`, and the `groups → sections` `.overwrite()` fold.
    const parsed = formAccept(formWith([{ group: 'contact_info' }]));
    const sections = parsed.sections as Array<Record<string, unknown>>;
    expect(sections[0].group).toBe('contact_info');
    expect(sections[0].fields).toBeUndefined();
  });

  it('carries the key through the LEGACY `groups` bucket too', () => {
    const parsed = formAccept({ type: 'simple', groups: [{ group: 'contact_info' }] });
    const sections = parsed.sections as Array<Record<string, unknown>>;
    expect(sections[0].group).toBe('contact_info');
    expect(parsed.groups).toBeUndefined();
  });

  it('keeps the enumerated form working unchanged', () => {
    const parsed = formAccept(formWith([{ label: 'Billing', fields: ['amount', { field: 'due_at' }] }]));
    const sections = parsed.sections as Array<Record<string, unknown>>;
    expect((sections[0].fields as unknown[]).length).toBe(2);
    expect(FormViewSchema.safeParse(formWith([{ fields: [] }])).success).toBe(true);
  });

  it('accepts `columns` and `pane` beside `group` — the group declares neither', () => {
    const parsed = formAccept(formWith([{ group: 'contact_info', columns: 2, pane: 'secondary' }], {
      type: 'split',
    }));
    const section = (parsed.sections as Array<Record<string, unknown>>)[0];
    expect(section.columns).toBe(2);
    expect(section.pane).toBe('secondary');
  });

  it('refuses `group` beside `fields`', () => {
    const issue = at(formIssues(formWith([{ group: 'contact_info', fields: ['email'] }])), [
      'sections', 0, 'group',
    ]);
    expect(issue.message).toContain('`group` and `fields` are mutually exclusive');
    expect(issue.message).toContain('this form section');
  });

  it('refuses a section that declares NEITHER', () => {
    const issue = at(formIssues(formWith([{ label: 'Orphan' }])), ['sections', 0, 'fields']);
    expect(issue.message).toContain('must declare its members exactly one way');
  });

  it.each([
    ['name', 'contact'],
    ['label', 'Contact'],
    ['description', 'How to reach them'],
    ['visibleWhen', "record.type == 'person'"],
    ['visibleOn', "record.type == 'person'"],
    ['collapsible', true],
    ['collapsed', true],
  ])('refuses `%s` beside `group` — the group owns it', (key, value) => {
    const issue = at(formIssues(formWith([{ group: 'contact_info', [key]: value }])), [
      'sections', 0, key,
    ]);
    expect(issue.message).toContain(`\`${key}\` cannot be combined with \`group\``);
    expect(issue.message).toContain('`fieldGroups` entry for `contact_info`');
  });

  it('refuses `visibleOn` beside `group` at ITS OWN path, before the fold renames it', () => {
    // The deprecated spelling folds onto `visibleWhen` in a `.transform` that
    // runs AFTER this refinement. Naming only the canonical key would leave
    // `visibleOn` as the one way to smuggle a section predicate past the rule.
    const paths = formIssues(formWith([{ group: 'contact_info', visibleOn: 'true' }])).map(i => i.path);
    expect(paths).toContainEqual(['sections', 0, 'visibleOn']);
  });

  it('accepts an authored `collapsible: false` beside `group` — indistinguishable from the default', () => {
    // Not leniency: `collapsible`/`collapsed` carry `.default(false)`, so by the
    // time an object-level refinement runs, an authored `false` and an absent
    // key are the same value — the same asymmetry #13704 records for the wizard
    // step keys. `false` also declares exactly what `collapse: 'none'` delivers.
    expect(FormViewSchema.safeParse(
      formWith([{ group: 'contact_info', collapsible: false, collapsed: false }]),
    ).success).toBe(true);
  });

  it('refuses `group` on a WIZARD step', () => {
    const issue = at(formIssues(formWith([{ group: 'contact_info' }], { type: 'wizard' })), [
      'sections', 0, 'group',
    ]);
    expect(issue.code).toBe('custom');
    expect(issue.message).toContain('`group` on a wizard step is refused');
    // The reason, and the two ways out.
    expect(issue.message).toContain('deriveFieldGroupLayout');
    expect(issue.message).toContain('Enumerate the step with `fields: [...]`');
  });

  it('still accepts an enumerated wizard step (the refusal is scoped to `group`)', () => {
    expect(FormViewSchema.safeParse(
      formWith([{ label: 'Step 1', fields: ['name'] }], { type: 'wizard' }),
    ).success).toBe(true);
  });

  it('still refuses an unknown sibling key', () => {
    const messages = formIssues(formWith([{ group: 'contact_info', collapsedByDefault: true }]))
      .map(i => i.message).join('\n');
    expect(messages).toContain('collapsedByDefault');
  });

  it('points a near-miss spelling of the new key at `group`', () => {
    const messages = formIssues(formWith([{ groupKey: 'contact_info' }])).map(i => i.message).join('\n');
    expect(messages).toContain('groupKey');
    expect(messages).toContain('group');
  });

  it('refuses a key the group grammar rejects, at the `group` path', () => {
    // The reference surface reads the SAME pattern the declaring
    // `ObjectFieldGroupSchema.key` enforces (`FIELD_GROUP_KEY_PATTERN`), so a
    // key one surface refuses can never be written on the other.
    const paths = formIssues(formWith([{ group: 'Contact Info' }])).map(i => i.path);
    expect(paths).toContainEqual(['sections', 0, 'group']);
  });
});
