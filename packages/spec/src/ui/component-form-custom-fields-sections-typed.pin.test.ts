// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#21464, the S-forms stage] `object-form` `customFields` and the `sections` of
 * `object-form` and `object-master-detail-form`, typed in the shapes the
 * maintainer ruled on the decision card #21704 — fork 2, letter B (a closed
 * runtime form field of the members the form draws, in camelCase, keyed by
 * `name`) and fork 3, letter B (a page-block section shape of its own: the form
 * view's section keys plus the three entry arms the form reads, canonical
 * spellings only, the stored form view unchanged).
 *
 * ## The defect this file closes
 *
 * Both members were `z.unknown()` (a section was `z.array(z.unknown())`), so
 * a member with no `name`, a misspelled member or section key, a section
 * `visibleOn` and a string `columns` all passed the component-props gate — and
 * the form drew the field or the section without the key, since a page
 * block's `properties` is never parsed on the way to the form and the form
 * reads only `visibleWhen` and a NUMBER `columns` off a section.
 *
 * ## What is pinned, and why each half
 *
 * - §1 THE MEASURED WRITERS PARSE: every shape a census writer authors (the
 *   read points and the census are in the schemas' docblocks and the PR),
 *   plus lit controls for the members no writer uses yet. A refusal pin with no
 *   lit control passes just as well when the door refuses everything.
 * - §2 THE REFUSALS: by `code` AND `path`, so a refusal for the wrong reason
 *   reds — the deprecated spellings and the measured-but-refused keys with
 *   their prescriptions, and a closed shape at every level.
 * - §3 ONE DECLARATION: the runtime field declares exactly the draw set; the
 *   section declares exactly the form view's section keys minus `visibleOn`;
 *   the `{ field }` arm's members are the form view's entry's own, def by def;
 *   both rows share one section instance, and the section's inline arm is the
 *   one runtime field `customFields` takes.
 * - §4 THE REGISTRATION: the ADR-0087 D3 entries step 18 carries.
 * - §5 THE GRID WIDGET'S CAMELCASE KEYS (#21768): objectstack-ai/objectui#11610
 *   renamed the `grid` widget's eight field-level keys to camelCase, and the
 *   `.objectui-sha` pin `9dfaca654311` carries it, so the runtime field declares
 *   `minRows`, `maxRows`, `allowAdd`, `allowDelete`, `allowReorder`,
 *   `totalField`, `addLabel` and `sortField` with the widget's value types. The
 *   writer shape parses (§1); each snake_case spelling is refused by name with
 *   its own camelCase key; and `totalField`'s describe says it is the grid's
 *   CHILD column — the opposite of the same spelling on `record:line_items` and
 *   a master-detail detail entry, which names the PARENT field the sum is saved
 *   to. A widening: nothing that parsed before is refused now.
 *
 * The enumeration pin (`component-props-unknown-members.pin.test.ts`) holds the
 * other half: the `customFields` and both `sections[]` fork lines left its
 * ledger, so a member reverted to `z.unknown()` reds there.
 */

import { describe, it, expect } from 'vitest';
import type { z } from 'zod';

import {
  ComponentPropsMap,
  ObjectFormPropsSchema,
  ObjectMasterDetailFormPropsSchema,
  RecordLineItemsProps,
} from './component.zod';
import { FormFieldSchema, FormSectionSchema, FormSelectOptionSchema } from './view.zod';
import { SelectOptionSchema } from '../data/field.zod';
import { MIGRATIONS_BY_MAJOR } from '../migrations/registry';

type Row = 'object-form' | 'object-master-detail-form';
const ROWS: readonly Row[] = ['object-form', 'object-master-detail-form'];
const BASE: Record<Row, Record<string, unknown>> = {
  'object-form': { objectName: 'account' },
  'object-master-detail-form': { objectName: 'invoice' },
};
const parse = (row: Row, props: Record<string, unknown>) =>
  ComponentPropsMap[row].safeParse({ ...BASE[row], ...props });

/** The issue codes and paths a refusal carries, so a refusal for the WRONG reason reds. */
function issues(result: z.ZodSafeParseResult<unknown>): { code: string; path: string }[] {
  if (result.success) return [];
  return result.error.issues.map((i) => ({ code: i.code, path: i.path.join('.') }));
}
const firstMessage = (result: z.ZodSafeParseResult<unknown>): string =>
  (result.success ? '' : result.error.issues[0]!.message);

/** Every message in the issue tree, union arms included. */
function messages(result: z.ZodSafeParseResult<unknown>): string {
  const walk = (list: readonly z.core.$ZodIssue[]): string[] =>
    list.flatMap((i) => [i.message, ...((i as { errors?: z.core.$ZodIssue[][] }).errors ?? []).flatMap(walk)]);
  return result.success ? '' : walk(result.error.issues).join('\n');
}

/** The object behind a member: through `.optional()` and an array's element. */
function objectOf(member: unknown): { shape: Record<string, unknown> } {
  let s = member as { unwrap?: () => unknown; element?: unknown; shape?: Record<string, unknown> };
  for (;;) {
    if (typeof s.unwrap === 'function') s = s.unwrap() as typeof s;
    else if (s.element) s = s.element as typeof s;
    else break;
  }
  return s as { shape: Record<string, unknown> };
}

const runtimeField = () => objectOf(ObjectFormPropsSchema.shape.customFields);
/** The element of the runtime field's `options`. */
const runtimeOption = () => objectOf(runtimeField().shape.options);
const section = () => objectOf(ObjectFormPropsSchema.shape.sections);
/** The section `fields` entry union's three arms: name, `{ field }` entry, inline field. */
const entryArms = () => {
  const union = objectOf(section().shape.fields) as unknown as { options: unknown[] };
  return union.options;
};

// ───────────────────────────────────────────────────────────────────────────
// §1 the measured writers parse
// ───────────────────────────────────────────────────────────────────────────

describe('§1 each member accepts every shape a measured writer authors', () => {
  // Byte-identical: no default, and no predicate in these values.
  const IDENTICAL: ReadonlyArray<readonly [label: string, row: Row, props: Record<string, unknown>]> = [
    // objectui `plugin-form/src/__tests__/drawerModalCustomFieldsMerge-10073.test.tsx:112`.
    ['an inline field overriding a declared one', 'object-form', { customFields: [{ name: 'note', label: 'INLINE NOTE', type: 'text' }] }],
    // `drawerModalCustomFieldsMerge-10073.test.tsx:160` — placed in its field group.
    ['an inline field with its field group', 'object-form', { customFields: [{ name: 'channel', label: 'INLINE CHANNEL', type: 'text', group: 'tracking' }] }],
    // `sectionsCustomFields-10254.test.tsx:148`.
    ['a required textarea', 'object-form', { customFields: [{ name: 'note', label: 'INLINE NOTE', type: 'textarea', required: true }] }],
    // `ObjectForm.mobileFullscreen.test.tsx:173`.
    ['a widget field with rows and a placeholder', 'object-form', {
      customFields: [{ name: 'body', label: 'Body', type: 'field:textarea', rows: 9, placeholder: 'Say more' }],
    }],
    // `types/src/__tests__/p1-spec-alignment.test.ts:348`, its first member.
    ['a field with a widget override', 'object-form', {
      customFields: [{ name: 'industry', label: 'Industry', type: 'select', widget: 'industry-picker' }],
    }],
    // objectui `content/docs/guide/public-forms.md:33`.
    ['the public-form guide\'s three fields', 'object-form', {
      customFields: [
        { name: 'name', label: 'Full name', type: 'text', required: true },
        { name: 'email', label: 'Email', type: 'email', required: true },
        { name: 'message', label: 'Message', type: 'textarea', rows: 4 },
      ],
    }],
    // `objectFormCustomFieldsMembers-8071.test.tsx:174`.
    ['no inline fields', 'object-form', { customFields: [] }],
    // Lit controls: drawn members no measured writer uses yet.
    ['a select with options and a cascade', 'object-form', {
      customFields: [{
        name: 'state', label: 'State', type: 'select', dependsOn: 'country',
        options: [{ label: 'Open', value: 'open' }, { label: 'Closed', value: 'closed' }],
      }],
    }],
    // An inline option's value is a RUNTIME value, not a stored field's identifier: the option
    // widgets compare it by identity and stringify it only at the control (`matchOptionValue` maps
    // the pick back), so a capitalised string, a number and a boolean each round-trip as written.
    ['runtime option values: a capitalised string, a number and a boolean', 'object-form', {
      customFields: [
        { name: 'icon', label: 'Icon', type: 'select', options: [{ label: 'Box', value: 'Box' }, { label: 'Shopping cart', value: 'ShoppingCart' }] },
        { name: 'size', label: 'Size', type: 'radio', options: [{ label: 'One', value: 1 }, { label: 'Two', value: 2 }] },
        { name: 'agree', label: 'Agree', type: 'select', options: [{ label: 'Yes', value: true }, { label: 'No', value: false }] },
      ],
    }],
    // The other two keys an option reader draws: a lookup's typeahead searches `description`
    // (`LookupField.tsx`), and the cascade offers an option only while its `visibleWhen` holds.
    ['an option\'s description and its visibility predicate', 'object-form', {
      customFields: [{
        name: 'region', type: 'lookup', dependsOn: 'country',
        options: [
          { label: 'Shanghai', value: 'sh', description: 'East China', visibleWhen: { dialect: 'cel', source: "record.country == 'cn'" } },
          { label: 'Ohio', value: 'oh' },
        ],
      }],
    }],
    ['validation rules and native bounds', 'object-form', {
      customFields: [{
        name: 'code', type: 'input', inputType: 'text', minLength: 2, maxLength: 8, pattern: '^[A-Z]+$', min: 1, max: 9,
        validation: { required: 'Code is required', minLength: { value: 2, message: 'Too short' } },
        required: true, disabled: false, readonly: false, hidden: false, colSpan: 2, span: 'full', description: 'Two to eight letters',
      }],
    }],
    ['the widget metadata members', 'object-form', {
      customFields: [
        { name: 'files', type: 'file', multiple: true, accept: ['image/*', '.pdf'] },
        { name: 'owner', type: 'lookup', reference: 'sys_user' },
        { name: 'embedding', type: 'vector', dimensions: 768 },
        { name: 'margin', type: 'formula', returnType: 'number' },
        { name: 'lines', type: 'summary', summaryOperations: { object: 'line', field: 'amount', function: 'sum' } },
        { name: 'items', type: 'grid', columns: [{ name: 'product', type: 'text' }, { name: 'qty', type: 'number' }] },
      ],
    }],
    // objectstack `examples/app-showcase/src/ui/pages/new-project-wizard.page.ts` (its `object-form` node).
    ['the showcase wizard\'s sections', 'object-form', {
      sections: [
        { label: 'Basics', description: 'Name the project and bind its account.', fields: ['name', 'account', 'owner'] },
        { label: 'Health', description: 'Set the status and the budget.', fields: ['status', 'budget'] },
      ],
    }],
    // objectui `plugin-form/README.md:776` — the data-source-free wizard's inline fields ("shape 3").
    ['inline fields in a section', 'object-form', {
      sections: [{
        name: 'contact', label: 'Contact',
        fields: [
          { name: 'firstName', type: 'input', label: 'First Name', required: true },
          { name: 'email', type: 'input', inputType: 'email', label: 'Email', required: true },
          { name: 'phone', type: 'input', inputType: 'tel', label: 'Phone' },
        ],
      }],
    }],
    // objectui `cli/src/__tests__/spec-vocabulary-hint.test.ts:54` — the form view's `{ field }` entry.
    ['the form view\'s `{ field }` entry', 'object-form', { sections: [{ label: 'Owner', fields: ['name', { field: 'owner', required: true }] }] }],
    // `__tests__/formSectionGroupReference-7051.test.tsx` — the group-reference form, with its layout keys.
    ['a group section', 'object-form', { sections: [{ group: 'contact_info', columns: 2 }, { label: 'Other', fields: ['note'] }] }],
    // `__tests__/collapseResolution-9849.test.tsx`, `sectionColumns.test.tsx`, the split form's `pane`.
    ['the collapse pair, columns and pane', 'object-form', {
      sections: [
        { name: 'money', label: 'Money', collapsible: true, collapsed: true, columns: 2, pane: 'primary', fields: ['amount'] },
        { name: 'rest', label: 'Rest', columns: 1, pane: 'secondary', fields: ['note'] },
      ],
    }],
    // §5 — objectui `examples/schema-catalog/src/schemas/fields-grid/line-items-grid.json` at the
    // `.objectui-sha` pin `9dfaca654311`: the one `fields[]` entry, a `grid` field carrying all eight
    // camelCase keys, the shape objectui's grid-field guide (`content/docs/fields/grid.mdx`) teaches.
    ['the grid widget\'s camelCase keys on an inline grid field', 'object-form', {
      customFields: [{
        name: 'line_items', label: 'Line Items', type: 'grid',
        columns: [
          { name: 'product', label: 'Product', type: 'text' },
          { name: 'quantity', label: 'Qty', type: 'number' },
          { name: 'amount', label: 'Amount', type: 'currency' },
        ],
        minRows: 1, maxRows: 10, allowAdd: true, allowDelete: true, allowReorder: true,
        totalField: 'amount', addLabel: 'Add line item', sortField: 'position',
      }],
    }],
    // Lit control: the same keys on a section's inline entry (the one runtime field), the three
    // switches off, on both rows that take the section.
    ['the grid widget\'s camelCase keys on a section\'s inline entry', 'object-form', {
      sections: [{ label: 'Lines', fields: [{ name: 'lines', type: 'grid', columns: [{ name: 'qty', type: 'number' }], minRows: 0, maxRows: 3, allowAdd: false, allowDelete: false, allowReorder: false, addLabel: 'Add', sortField: 'line_no' }] }],
    }],
    ['the grid widget\'s camelCase keys on a master-detail section\'s inline entry', 'object-master-detail-form', {
      sections: [{ label: 'Lines', fields: [{ name: 'lines', type: 'grid', columns: [{ name: 'amount', type: 'currency' }], totalField: 'amount' }] }],
    }],
    ['no sections', 'object-form', { sections: [] }],
    // objectui `plugin-form/src/masterDetailFormTypeVocabulary.test.tsx:109` — the parent half's sections.
    ['the parent half\'s sections', 'object-master-detail-form', {
      sections: [{ name: 's1', label: 'Sec One', fields: ['ref'] }, { name: 's2', label: 'Sec Two', fields: ['memo'] }],
    }],
  ];
  for (const [label, row, props] of IDENTICAL) {
    it(`${row}: parses ${label} byte-identical`, () => {
      const r = parse(row, props);
      expect(issues(r)).toEqual([]);
      expect(r.success && r.data).toStrictEqual({ ...BASE[row], ...props });
    });
  }

  // objectui `plugin-designer/src/ObjectManager.tsx` (about `:239`-`:247` at the `.objectui-sha` pin):
  // the registered `object-manager` component's create / edit dialog, a `formType: 'modal'` block.
  // Its two select members build their options from the file's own constants, each entry
  // `{ label: v, value: v }`; the labels it draws through `t(...)` are written out as strings here.
  it('object-form: parses the shipped object-manager dialog\'s inline fields byte-identical', () => {
    const OBJECT_GROUPS = ['Custom Objects', 'System Objects', 'Integration', 'Analytics'];
    const ICON_OPTIONS = [
      'Box', 'Database', 'Users', 'FileText', 'Settings',
      'ShoppingCart', 'Calendar', 'Mail', 'Briefcase', 'Building',
      'Globe', 'Heart', 'Star', 'Tag', 'Bookmark',
      'Folder', 'Archive', 'Package', 'Truck', 'CreditCard',
    ];
    const readOnly = false;
    const props = {
      objectName: 'object_definition',
      formType: 'modal',
      mode: 'create',
      modalSize: 'lg',
      readOnly,
      customFields: [
        { name: 'name', label: 'Object name', type: 'text', required: true, placeholder: 'api_name', disabled: readOnly },
        { name: 'label', label: 'Object label', type: 'text', required: true, placeholder: 'Display Name', disabled: readOnly },
        { name: 'pluralLabel', label: 'Plural label', type: 'text', placeholder: 'Display Names', disabled: readOnly },
        { name: 'description', label: 'Description', type: 'textarea', disabled: readOnly },
        { name: 'icon', label: 'Icon', type: 'select', options: ICON_OPTIONS.map((i) => ({ label: i, value: i })), disabled: readOnly },
        { name: 'group', label: 'Group', type: 'select', options: OBJECT_GROUPS.map((g) => ({ label: g, value: g })), disabled: readOnly },
        { name: 'sortOrder', label: 'Sort order', type: 'number', disabled: readOnly },
      ],
    };
    const r = parse('object-form', props);
    expect(issues(r)).toEqual([]);
    expect(r.success && r.data).toStrictEqual(props);
  });

  it('a bare CEL predicate parses to its envelope, as on every evaluated slot — and the envelope is kept', () => {
    const r = parse('object-form', {
      sections: [{ fields: ['a', { field: 'b', visibleWhen: 'record.x == 1' }], visibleWhen: 'record.y == 2' }],
      customFields: [{
        name: 'c', visibleWhen: { dialect: 'cel', source: 'record.z == 3' }, requiredWhen: 'record.y == 2',
        options: [{ label: 'Shanghai', value: 'sh', visibleWhen: "record.country == 'cn'" }],
      }],
    });
    expect(issues(r)).toEqual([]);
    const data = r.success ? (r.data as Record<string, any>) : {};
    expect(data.sections[0].visibleWhen).toEqual({ dialect: 'cel', source: 'record.y == 2' });
    expect(data.sections[0].fields[1].visibleWhen).toEqual({ dialect: 'cel', source: 'record.x == 1' });
    expect(data.customFields[0].visibleWhen).toEqual({ dialect: 'cel', source: 'record.z == 3' });
    expect(data.customFields[0].requiredWhen).toEqual({ dialect: 'cel', source: 'record.y == 2' });
    expect(data.customFields[0].options[0].visibleWhen).toEqual({ dialect: 'cel', source: "record.country == 'cn'" });
  });

  it('absent members stay absent', () => {
    for (const row of ROWS) {
      const r = parse(row, {});
      expect(issues(r), row).toEqual([]);
      expect(r.success && r.data, row).not.toHaveProperty('sections');
      expect(r.success && r.data, row).not.toHaveProperty('customFields');
    }
  });
});

// ───────────────────────────────────────────────────────────────────────────
// §2 the refusals
// ───────────────────────────────────────────────────────────────────────────

describe('§2 off-shape values are refused with the code and the path', () => {
  const REFUSED: ReadonlyArray<readonly [label: string, row: Row, props: Record<string, unknown>, found: ReadonlyArray<{ code: string; path: string }>]> = [
    ['a number for `customFields`', 'object-form', { customFields: 42 }, [{ code: 'invalid_type', path: 'customFields' }]],
    ['an inline field with no name', 'object-form', { customFields: [{ label: 'X' }] }, [{ code: 'invalid_type', path: 'customFields.0.name' }]],
    ['an empty name', 'object-form', { customFields: [{ name: '' }] }, [{ code: 'too_small', path: 'customFields.0.name' }]],
    ['a misspelled member', 'object-form', { customFields: [{ name: 'a', lable: 'A' }] }, [{ code: 'unrecognized_keys', path: 'customFields.0' }]],
    // objectui `types/src/__tests__/p1-spec-alignment.test.ts:348` — a type-level test, never drawn.
    ['an inline `visibleOn`', 'object-form', { customFields: [{ name: 'a', visibleOn: "record.b != ''" }] }, [{ code: 'unrecognized_keys', path: 'customFields.0' }]],
    ['the legacy `condition`', 'object-form', { customFields: [{ name: 'a', condition: { field: 'b', equals: 'x' } }] }, [{ code: 'unrecognized_keys', path: 'customFields.0' }]],
    // objectui `__tests__/initialRecordMerge-9760.test.tsx:236` — row 7 pins that it seeds nothing.
    ['an inline `defaultValue`', 'object-form', { customFields: [{ name: 'memo', defaultValue: 'X' }] }, [{ code: 'unrecognized_keys', path: 'customFields.0' }]],
    ['an `id`', 'object-form', { customFields: [{ name: 'a', id: 'a1' }] }, [{ code: 'unrecognized_keys', path: 'customFields.0' }]],
    ['a divider\'s member claim', 'object-form', { customFields: [{ name: 'a', fields: ['b'] }] }, [{ code: 'unrecognized_keys', path: 'customFields.0' }]],
    ['a grid widget snake_case key', 'object-form', { customFields: [{ name: 'items', type: 'grid', min_rows: 1 }] }, [{ code: 'unrecognized_keys', path: 'customFields.0' }]],
    ['a locale-map label on an inline field', 'object-form', { customFields: [{ name: 'a', label: { en: 'A' } }] }, [{ code: 'invalid_type', path: 'customFields.0.label' }]],
    ['a `validation.required` switch', 'object-form', { customFields: [{ name: 'a', validation: { required: true } }] }, [{ code: 'invalid_type', path: 'customFields.0.validation.required' }]],
    ['a `validation.pattern` rule', 'object-form', { customFields: [{ name: 'a', validation: { pattern: { value: '^a', message: 'x' } } }] }, [{ code: 'unrecognized_keys', path: 'customFields.0.validation' }]],
    ['a bare `validation.minLength`', 'object-form', { customFields: [{ name: 'a', validation: { minLength: 2 } }] }, [{ code: 'invalid_type', path: 'customFields.0.validation.minLength' }]],
    ['a column span past the grid', 'object-form', { customFields: [{ name: 'a', colSpan: 5 }] }, [{ code: 'too_big', path: 'customFields.0.colSpan' }]],
    ['a malformed field group key', 'object-form', { customFields: [{ name: 'a', group: 'Contact Info' }] }, [{ code: 'invalid_format', path: 'customFields.0.group' }]],
    // The option element is closed too: a key no option reader draws is refused, not carried.
    ['an undeclared option key', 'object-form', { customFields: [{ name: 'a', type: 'select', options: [{ label: 'A', value: 'a', bogus: 1 }] }] }, [{ code: 'unrecognized_keys', path: 'customFields.0.options.0' }]],
    ['an option colour, which no option control draws', 'object-form', { customFields: [{ name: 'a', type: 'select', options: [{ label: 'A', value: 'a', color: '#f00' }] }] }, [{ code: 'unrecognized_keys', path: 'customFields.0.options.0' }]],
    ['an option `default`, which seeds nothing', 'object-form', { customFields: [{ name: 'a', type: 'select', options: [{ label: 'A', value: 'a', default: true }] }] }, [{ code: 'unrecognized_keys', path: 'customFields.0.options.0' }]],
    ['an option with no label', 'object-form', { customFields: [{ name: 'a', type: 'select', options: [{ value: 'a' }] }] }, [{ code: 'invalid_type', path: 'customFields.0.options.0.label' }]],
    ['an object option value', 'object-form', { customFields: [{ name: 'a', type: 'select', options: [{ label: 'A', value: { id: 1 } }] }] }, [{ code: 'invalid_union', path: 'customFields.0.options.0.value' }]],
    ['a number for `sections`', 'object-form', { sections: 42 }, [{ code: 'invalid_type', path: 'sections' }]],
    ['a section `visibleOn`', 'object-form', { sections: [{ fields: ['a'], visibleOn: 'record.b == 1' }] }, [{ code: 'unrecognized_keys', path: 'sections.0' }]],
    ['a string `columns`', 'object-form', { sections: [{ fields: ['a'], columns: '2' }] }, [{ code: 'invalid_type', path: 'sections.0.columns' }]],
    ['five columns', 'object-form', { sections: [{ fields: ['a'], columns: 5 }] }, [{ code: 'too_big', path: 'sections.0.columns' }]],
    ['a locale-map section label', 'object-form', { sections: [{ fields: ['a'], label: { en: 'A' } }] }, [{ code: 'invalid_type', path: 'sections.0.label' }]],
    // objectui `__tests__/sectionStyleKeysRetired-13626.test.tsx` — the retired style keys reach nothing.
    ['a section style key', 'object-form', { sections: [{ fields: ['a'], className: 'p-4' }] }, [{ code: 'unrecognized_keys', path: 'sections.0' }]],
    // objectui `plugin-form/src/__tests__/formSectionGroupReference-7051.test.tsx:270` and `:307` — the
    // renderer's own probes of two shapes that test says this door refuses at parse.
    ['a section with neither `fields` nor `group`', 'object-form', { sections: [{ label: 'Memberless' }] }, [{ code: 'custom', path: 'sections.0.fields' }]],
    ['`group` beside `fields`', 'object-form', { sections: [{ group: 'contact_info', fields: ['a'] }] }, [{ code: 'custom', path: 'sections.0.group' }]],
    ['group-owned keys beside `group`', 'object-form', { sections: [{ group: 'contact_info', label: 'My Own Label', collapsible: true }] }, [
      { code: 'custom', path: 'sections.0.label' },
      { code: 'custom', path: 'sections.0.collapsible' },
    ]],
    ['an unknown pane', 'object-form', { sections: [{ fields: ['a'], pane: 'left' }] }, [{ code: 'invalid_value', path: 'sections.0.pane' }]],
    ['a numeric entry', 'object-form', { sections: [{ fields: [5] }] }, [{ code: 'invalid_union', path: 'sections.0.fields.0' }]],
    ['a `{ field }` entry\'s `visibleOn`', 'object-form', { sections: [{ fields: [{ field: 'a', visibleOn: 'record.b == 1' }] }] }, [{ code: 'invalid_union', path: 'sections.0.fields.0' }]],
    ['an inline entry\'s unknown key', 'object-form', { sections: [{ fields: [{ name: 'a', bogus: 1 }] }] }, [{ code: 'invalid_union', path: 'sections.0.fields.0' }]],
    ['a master-detail section `visibleOn`', 'object-master-detail-form', { sections: [{ fields: ['a'], visibleOn: 'record.b == 1' }] }, [{ code: 'unrecognized_keys', path: 'sections.0' }]],
  ];
  for (const [label, row, props, found] of REFUSED) {
    it(`${row}: refuses ${label}`, () => {
      const r = parse(row, props);
      expect(r.success).toBe(false);
      expect(issues(r)).toEqual(found);
    });
  }

  it('each refused inline key carries its prescription', () => {
    const say = (member: Record<string, unknown>) => firstMessage(parse('object-form', { customFields: [{ name: 'a', ...member }] }));
    expect(say({ visibleOn: 'record.b == 1' })).toMatch(/write the predicate as `visibleWhen`/i);
    expect(say({ condition: { field: 'b', equals: 'x' } })).toMatch(/`visibleWhen: "record\.status == 'open'"`/);
    expect(say({ defaultValue: 'X' })).toMatch(/block's\s+`initialValues`/);
    expect(say({ id: 'a1' })).toMatch(/identified by its `name`/);
    expect(say({ fields: ['b'] })).toMatch(/Group fields with the block's `sections`/);
    expect(say({ min_rows: 1 })).toMatch(/^ {2}• .*`min_rows`.*`minRows`/m);
    expect(say({ helpText: 'x' })).toMatch(/`helpText` → `description`/);
    expect(say({ validation: { required: true } })).toMatch(/the MESSAGE a required field shows/);
    expect(say({ validation: { pattern: { value: '^a', message: 'x' } } })).toMatch(/field's own `pattern` string/);
  });

  it('each refused option key carries its prescription, and an option alias names its key', () => {
    const say = (option: Record<string, unknown>) =>
      firstMessage(parse('object-form', { customFields: [{ name: 'a', type: 'select', options: [{ label: 'A', value: 'a', ...option }] }] }));
    expect(say({ color: '#f00' })).toMatch(/object field's own option/);
    expect(say({ default: true })).toMatch(/block's\s+`initialValues`/);
    expect(say({ disabled: true })).toMatch(/`visibleWhen`/);
    expect(say({ icon: 'star' })).toMatch(/drawn as its `label`/);
    expect(say({ text: 'A' })).toMatch(/`text` → `label`/);
  });

  it('each refused section spelling carries the canonical one', () => {
    expect(firstMessage(parse('object-form', { sections: [{ fields: ['a'], visibleOn: 'record.b == 1' }] })))
      .toMatch(/gated nothing\. Write it as `visibleWhen`/);
    expect(firstMessage(parse('object-form', { sections: [{ fields: ['a'], columns: '2' }] })))
      .toMatch(/write `2`, not `'2'`/);
    expect(messages(parse('object-form', { sections: [{ fields: [{ field: 'a', visibleOn: 'record.b == 1' }] }] })))
      .toMatch(/takes the\s+canonical spelling only: write `visibleWhen`/);
    expect(messages(parse('object-form', { sections: [{ fields: [{ field: 'a', name: 'a' }] }] })))
      .toMatch(/keyed by `field`, or an inline form field keyed by `name` — not both/);
  });

  it('a non-numeric string `columns` carries no prescription — only the four spellings a form view converts', () => {
    expect(firstMessage(parse('object-form', { sections: [{ fields: ['a'], columns: 'wide' }] }))).not.toMatch(/write `/);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// §3 one declaration
// ───────────────────────────────────────────────────────────────────────────

describe('§3 the declared members, and one shape for both rows', () => {
  it('the runtime form field declares exactly the members the form draws', () => {
    expect(Object.keys(runtimeField().shape).sort()).toEqual([
      'accept', 'addLabel', 'allowAdd', 'allowDelete', 'allowReorder', 'colSpan', 'columns', 'dependsOn',
      'description', 'dimensions', 'disabled', 'group', 'hidden', 'inputType', 'label', 'max', 'maxLength',
      'maxRows', 'min', 'minLength', 'minRows', 'multiple', 'name', 'options', 'pattern', 'placeholder',
      'readonly', 'readonlyWhen', 'reference', 'required', 'requiredWhen', 'returnType', 'rows', 'sortField',
      'span', 'summaryOperations', 'totalField', 'type', 'validation', 'visibleWhen', 'widget',
    ]);
  });

  it('its option declares exactly the keys the form\'s option readers draw, with a runtime `value`', () => {
    const option = runtimeOption();
    expect(Object.keys(option.shape).sort()).toEqual(['description', 'label', 'value', 'visibleWhen']);
    // Not the stored field's option: that one's `value` is a lowercase identifier.
    expect(option).not.toBe(objectOf(FormSelectOptionSchema));
    // `label` and `description` are the object field's option's own, by reference. (`visibleWhen` is
    // declared on the option itself: the object field's option is re-checked on write, this one never is.)
    const own = SelectOptionSchema.shape as unknown as Record<string, { _zod: { def: unknown } }>;
    const shape = option.shape as unknown as Record<string, { _zod: { def: unknown } }>;
    for (const key of ['label', 'description']) {
      expect(shape[key]!._zod.def, key).toBe(own[key]!._zod.def);
    }
    const value = option.shape.value as z.ZodType;
    for (const ok of ['Box', 'open', 2, 0, true, false]) expect(value.safeParse(ok).success, String(ok)).toBe(true);
    for (const bad of [null, undefined, {}, ['a']]) expect(value.safeParse(bad).success, String(bad)).toBe(false);
  });

  it('no member of it is spelled snake_case', () => {
    expect(Object.keys(runtimeField().shape).filter((k) => /_/.test(k))).toEqual([]);
  });

  it('a section declares exactly the form view\'s section keys, without the deprecated `visibleOn`', () => {
    // `FormSectionSchema` is its object piped into the `visibleOn` fold; read the object half.
    const viewKeys = Object.keys((FormSectionSchema as unknown as { in: { shape: Record<string, unknown> } }).in.shape);
    expect(viewKeys).toContain('visibleOn');
    expect(Object.keys(section().shape).sort()).toEqual(viewKeys.filter((k) => k !== 'visibleOn').sort());
  });

  it('the `{ field }` arm\'s members are the form view\'s entry\'s own, def by def, but for the four the page block reads differently', () => {
    const view = (FormFieldSchema as unknown as { in: { shape: Record<string, { _zod: { def: unknown } }> } }).in.shape;
    const arm = (entryArms()[1] as { shape: Record<string, { _zod: { def: unknown } }> }).shape;
    const own = ['label', 'placeholder', 'helpText', 'span', 'fields'];
    expect(Object.keys(arm).sort()).toEqual(Object.keys(view).filter((k) => k !== 'visibleOn').sort());
    for (const key of Object.keys(arm)) {
      if (own.includes(key)) continue;
      expect(arm[key]!._zod.def, key).toBe(view[key]!._zod.def);
    }
    // `span` keeps the view's enum, without the default the form view fills.
    const span = arm.span as unknown as { unwrap: () => { _zod: { def: unknown } } };
    const viewSpan = view.span as unknown as { unwrap: () => { _zod: { def: unknown } } };
    expect(span.unwrap()._zod.def).toBe(viewSpan.unwrap()._zod.def);
  });

  it('a section\'s inline arm is the one runtime field `customFields` takes', () => {
    expect(entryArms()[2]).toBe(runtimeField());
  });

  it('both rows take the one section instance', () => {
    expect(objectOf(ObjectMasterDetailFormPropsSchema.shape.sections)).toBe(section());
  });
});

// ───────────────────────────────────────────────────────────────────────────
// §4 the registration
// ───────────────────────────────────────────────────────────────────────────

describe('§4 each narrowing is registered as the ADR-0087 D3 entry step 18 carries', () => {
  const ids = MIGRATIONS_BY_MAJOR[18]!.semantic.map((s) => s.id);
  it.each([
    'ui-object-form-custom-fields-typed',
    'ui-object-form-sections-typed',
  ])('%s', (id) => {
    expect(ids).toContain(id);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// §5 the grid widget's camelCase keys (#21768)
// ───────────────────────────────────────────────────────────────────────────

describe('§5 the grid widget\'s eight field-level keys, camelCase since objectui renamed them', () => {
  // The rename, as objectui's `GRID_FIELD_RETIRED_KEYS` pairs it (`types/src/field-types.ts:1159` at the
  // `.objectui-sha` pin `9dfaca654311`), with each key's value type as `GridFieldMetadata` declares it.
  const GRID_KEYS = [
    ['min_rows', 'minRows', 1, 'one'],
    ['max_rows', 'maxRows', 10, '10'],
    ['allow_add', 'allowAdd', false, 'no'],
    ['allow_delete', 'allowDelete', false, 0],
    ['allow_reorder', 'allowReorder', true, 'true'],
    ['total_field', 'totalField', 'amount', 5],
    ['add_label', 'addLabel', 'Add line', { en: 'Add line' }],
    ['sort_field', 'sortField', 'position', ['position']],
  ] as const;
  const field = (member: Record<string, unknown>) =>
    parse('object-form', { customFields: [{ name: 'items', type: 'grid', ...member }] });

  /** The prescription bullets of a refusal (`strictUnknownKeyError` renders each as one `  • ` line). */
  const bullets = (message: string): string[] => message.split('\n').filter((line) => line.startsWith('  • '));

  it.each(GRID_KEYS)('`%s` is refused by name, its prescription naming `%s`', (snake, camel, value) => {
    const r = field({ [snake]: value });
    expect(issues(r)).toEqual([{ code: 'unrecognized_keys', path: 'customFields.0' }]);
    const message = firstMessage(r);
    // Named subjects, not copy: the first line names the written key, and the one bullet names it and its
    // camelCase replacement.
    expect(message.split('\n')[0]).toContain(`\`${snake}\``);
    const [bullet, ...rest] = bullets(message);
    expect(rest).toEqual([]);
    expect(bullet).toContain(`\`${snake}\``);
    expect(bullet).toContain(`\`${camel}\``);
    // The key the prescription names is one the field accepts, with the very value written.
    const renamed = field({ [camel]: value });
    expect(issues(renamed)).toEqual([]);
    expect(renamed.success && (renamed.data as { customFields: Record<string, unknown>[] }).customFields[0]![camel]).toBe(value);
  });

  it('two retired spellings on one field get one bullet each, each naming its own camelCase key', () => {
    const lines = bullets(firstMessage(field({ allow_add: false, sort_field: 'position' })));
    expect(lines).toHaveLength(2);
    expect(lines.filter((l) => l.includes('`allow_add`') && l.includes('`allowAdd`'))).toHaveLength(1);
    expect(lines.filter((l) => l.includes('`sort_field`') && l.includes('`sortField`'))).toHaveLength(1);
  });

  it('a section\'s inline entry refuses a retired spelling with the same prescription', () => {
    const r = parse('object-form', { sections: [{ fields: [{ name: 'items', type: 'grid', total_field: 'amount' }] }] });
    expect(issues(r)).toEqual([{ code: 'invalid_union', path: 'sections.0.fields.0' }]);
    expect(messages(r)).toMatch(/^ {2}• .*`total_field`.*`totalField`/m);
  });

  it.each(GRID_KEYS)('`%s` → `%s` takes the widget\'s value type and refuses another', (_snake, camel, _value, wrong) => {
    expect(issues(field({ [camel]: wrong }))).toEqual([{ code: 'invalid_type', path: `customFields.0.${camel}` }]);
  });

  it('each of the eight describes names the one reader', () => {
    for (const [, camel] of GRID_KEYS) {
      const member = runtimeField().shape[camel] as { description?: string };
      expect(member.description, camel).toMatch(/Read only by the `grid` widget$/);
    }
  });

  // Two keys spelled alike across siblings with opposite meanings is how a writer goes wrong: the grid's
  // `totalField` names the CHILD column it sums, the child-collection blocks' names the PARENT field the
  // sum is saved to (their child column is `amountField`, which their renderers hand the grid AS its
  // `totalField` — `LineItemsPanel.tsx:710`, `MasterDetailForm.tsx:876` at the pin).
  it('`totalField` on the inline grid field is the CHILD column summed, the opposite of the same spelling on the child-collection blocks', () => {
    const description = (schema: unknown) => (schema as { description?: string }).description ?? '';
    const grid = description(runtimeField().shape.totalField);
    // The first sentence is the contract: the CHILD column, summed into the footer.
    expect(grid).toMatch(/^The CHILD column [^.]*\bfooter\b/);
    // And it names the homonym it is not, and the sibling key that IS this value.
    expect(grid).toMatch(/\bNot the PARENT field\b/);
    expect(grid).toContain('`amountField`');

    const lineItems = description((RecordLineItemsProps as unknown as { shape: Record<string, unknown> }).shape.totalField);
    const detailEntry = description(objectOf(ObjectMasterDetailFormPropsSchema.shape.details).shape.totalField);
    for (const [label, sibling] of [['record:line_items', lineItems], ['master-detail detail entry', detailEntry]] as const) {
      expect(sibling, label).toMatch(/^Parent field to receive the rolled-up sum/);
      expect(sibling, label).not.toMatch(/CHILD|footer/);
    }
    expect(grid).not.toMatch(/^Parent field/);
  });
});
