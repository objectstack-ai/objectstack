// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The option editor authors an option's lifecycle `kind` (objectstack#26729).
 *
 * The spec publishes `SelectOption.kind` (`open` / `won` / `lost`,
 * objectstack#23809), and `ObjectSchema` refuses an object whose `stageField`
 * names a field with an option that declares none. The editor used to own only
 * `value` / `label` / `color` and carry `kind` through its `rest` bag: an
 * existing kind survived, but nothing in Studio could write one, so a select
 * built in Studio could never be chosen as the Lifecycle field — the save came
 * back 422 naming a key the author had no control for.
 *
 * Every case ends at the spec (`ObjectSchema` / `FieldSchema`) or at the
 * written document's own keys, never at "it rendered".
 */

import * as React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FieldSchema, ObjectSchema } from '@objectstack/spec/data';
import { loadStudioCatalogue } from '@object-ui/i18n/namespaces/studio';

vi.mock('../useMetadata', () => ({
  useMetadataClient: () => ({
    list: vi.fn().mockResolvedValue([]),
    listDrafts: vi.fn().mockResolvedValue([]),
  }),
}));

vi.mock('../previews/useObjectFields', () => ({
  useObjectFields: () => ({ fields: [], loading: false, error: null }),
}));

import { ObjectFieldInspector } from './ObjectFieldInspector';
import { t, type SupportedLocale } from '../i18n';

// The zh case below reads the lazy `studio` catalogue; load it at import so no
// assertion races the loader.
await loadStudioCatalogue('zh');

afterEach(cleanup);

type Def = Record<string, unknown>;

function renderField(
  fields: Record<string, Def>,
  opts: { stageField?: string; locale?: SupportedLocale } = {},
) {
  const onPatch = vi.fn();
  const initial: Record<string, unknown> = { name: 'probe_widget', fields };
  if (opts.stageField !== undefined) initial.stageField = opts.stageField;
  // A host that feeds each patch back, as Studio's draft does, so what the
  // inspector derives from the draft (the lifecycle hint) sees the edits.
  function Host() {
    const [draft, setDraft] = React.useState(initial);
    return (
      <ObjectFieldInspector
        type="object"
        name="probe_widget"
        draft={draft}
        selection={{ kind: 'field', id: 'status' }}
        onPatch={(patch: Record<string, unknown>) => {
          onPatch(patch);
          setDraft((d) => ({ ...d, ...patch }));
        }}
        onClearSelection={vi.fn()}
        onSelectionChange={vi.fn()}
        readOnly={false}
        locale={opts.locale ?? 'en-US'}
      />
    );
  }
  const utils = render(<Host />);
  /** The fields map the host's Save would persist after the last edit. */
  const savedFields = () => onPatch.mock.calls.at(-1)![0].fields as Record<string, Def>;
  return { ...utils, onPatch, savedFields };
}

const savedOptions = (fields: Record<string, Def>): Def[] =>
  (fields.status as { options?: Def[] }).options ?? [];

const has = (o: object, key: string) => Object.prototype.hasOwnProperty.call(o, key);

type SpecIssue = { code: string; path: ReadonlyArray<PropertyKey> };
type SpecSchema = {
  safeParse: (value: unknown) => { success: boolean; error?: { issues: SpecIssue[] } };
};
const rejectionsOf = (schema: SpecSchema, doc: unknown): string[] => {
  const r = schema.safeParse(doc);
  return r.success ? [] : (r.error?.issues ?? []).map((i) => `${i.code}@[${i.path.join('.')}]`);
};

/** The object the host saves: the inspector's fields, with `status` as the lifecycle field. */
const stageObject = (fields: Record<string, Def>) => ({
  name: 'probe_widget',
  label: 'Probe widget',
  fields,
  stageField: 'status',
});

const STATUS_OPTIONS: Def[] = [
  { value: 'new', label: 'New' },
  { value: 'won', label: 'Won' },
  { value: 'lost', label: 'Lost' },
];

const field = (type: string, options: Def[], extra: Def = {}): Record<string, Def> => ({
  status: { type, label: 'Status', options, ...extra },
});

/** Open row `i`'s kind picker from the keyboard and pick the item labelled `label`. */
async function pickKind(i: number, label: string): Promise<void> {
  fireEvent.keyDown(screen.getAllByTestId('option-kind')[i], { key: 'ArrowDown' });
  const listbox = await screen.findByRole('listbox');
  const items = within(listbox).getAllByRole('option');
  const item = items.find((o) => o.textContent === label);
  if (!item) throw new Error(`kind picker lists no "${label}": ${items.map((o) => o.textContent).join(' | ')}`);
  fireEvent.click(item);
}

const editLabel = (i: number, to: string) =>
  fireEvent.change(screen.getAllByPlaceholderText('Label')[i], { target: { value: to } });

describe('ObjectFieldInspector · the option editor authors `kind` (objectstack#26729)', () => {
  it('CONTROL — the Studio-built select is refused as the stage field before any kind is set', () => {
    expect(rejectionsOf(ObjectSchema, stageObject(field('select', STATUS_OPTIONS)))).toEqual([
      'custom@[fields.status.options.0.kind]',
      'custom@[fields.status.options.1.kind]',
      'custom@[fields.status.options.2.kind]',
    ]);
  });

  it('picking a kind on each option writes it, and the object then saves with the field as `stageField`', async () => {
    const { savedFields } = renderField(field('select', STATUS_OPTIONS), { stageField: 'status' });

    expect(screen.getAllByTestId('option-kind')).toHaveLength(3);
    await pickKind(0, 'Open');
    await pickKind(1, 'Won');
    await pickKind(2, 'Lost');

    const fields = savedFields();
    const options = savedOptions(fields);
    expect(options).toHaveLength(3);
    expect(options.map((o) => o.kind)).toEqual(['open', 'won', 'lost']);
    expect(rejectionsOf(FieldSchema, { name: 'status', ...fields.status })).toEqual([]);
    expect(rejectionsOf(ObjectSchema, stageObject(fields))).toEqual([]);
  });

  it('an option still without a kind keeps the object refused at that option, and only there', async () => {
    const { savedFields } = renderField(field('select', STATUS_OPTIONS), { stageField: 'status' });

    await pickKind(0, 'Open');
    await pickKind(1, 'Won');

    const fields = savedFields();
    expect(has(savedOptions(fields)[2], 'kind')).toBe(false);
    expect(rejectionsOf(ObjectSchema, stageObject(fields))).toEqual(['custom@[fields.status.options.2.kind]']);
  });

  it('"No kind" removes the key outright', async () => {
    const { savedFields } = renderField(
      field('select', [
        { value: 'new', label: 'New', kind: 'open' },
        { value: 'won', label: 'Won', kind: 'won' },
      ]),
    );

    await pickKind(1, 'No kind');

    const options = savedOptions(savedFields());
    expect(options).toHaveLength(2);
    expect(options[0].kind).toBe('open');
    expect(has(options[1], 'kind')).toBe(false);
    expect(options[1]).toEqual({ value: 'won', label: 'Won' });
  });

  it('an existing kind round-trips through an edit of its own row and of another row', () => {
    const { savedFields } = renderField(
      field('radio', [
        { value: 'new', label: 'New', kind: 'open' },
        { value: 'done', label: 'Done', kind: 'won' },
      ]),
    );

    editLabel(1, 'Done!');

    const options = savedOptions(savedFields());
    expect(options).toEqual([
      { value: 'new', label: 'New', kind: 'open' },
      { value: 'done', label: 'Done!', kind: 'won' },
    ]);
  });

  it('the picker shows the stored kind', () => {
    renderField(field('select', [{ value: 'done', label: 'Done', kind: 'lost' }]));
    expect(screen.getByTestId('option-kind').textContent).toBe('Lost');
  });

  it.each([
    ['multiselect', {}],
    ['checkboxes', {}],
    ['select with multiple: true', { multiple: true }],
  ] as const)('a %s field draws no kind picker and writes no kind', (label, extra) => {
    const type = label.startsWith('select') ? 'select' : label;
    const { savedFields } = renderField(field(type, STATUS_OPTIONS, extra));

    expect(screen.queryByTestId('option-kind')).toBeNull();
    // POSITIVE CONTROL for the query above: the rows themselves are drawn.
    expect(screen.getAllByPlaceholderText('Label')).toHaveLength(3);

    editLabel(0, 'Fresh');

    const fields = savedFields();
    const options = savedOptions(fields);
    expect(options).toHaveLength(3);
    expect(options[0].label).toBe('Fresh');
    expect(options.some((o) => has(o, 'kind'))).toBe(false);
    expect(rejectionsOf(FieldSchema, { name: 'status', ...fields.status })).toEqual([]);
  });

  it('a kind authored on a multi-value field is not written back — the spec refuses it there', () => {
    const fields0 = field('multiselect', [{ value: 'alpha', label: 'Alpha', kind: 'won' }]);
    expect(rejectionsOf(FieldSchema, { name: 'status', ...fields0.status })).toEqual([
      'custom@[options.0.kind]',
    ]);
    const { savedFields } = renderField(fields0);

    editLabel(0, 'Alpha II');

    const fields = savedFields();
    expect(savedOptions(fields)).toEqual([{ value: 'alpha', label: 'Alpha II' }]);
    expect(rejectionsOf(FieldSchema, { name: 'status', ...fields.status })).toEqual([]);
  });

  it('a kind outside open / won / lost is reported on its own row and kept verbatim', () => {
    const bogus = { value: 'beta', label: 'Beta', kind: 'closed' };
    const { savedFields } = renderField(field('select', [{ value: 'alpha', label: 'Alpha' }, bogus]));

    expect(screen.getAllByTestId('option-malformed')).toHaveLength(1);
    expect(screen.getAllByTestId('option-kind')).toHaveLength(1);

    editLabel(0, 'Alpha II');

    expect(savedOptions(savedFields())[1]).toBe(bogus);
  });

  it.each([
    ['Multi-Select', 'multiselect', false],
    ['Radio', 'radio', true],
  ] as const)('a retype to %s %s the option kinds', async (typeLabel, nextType, keeps) => {
    const kinded = [
      { value: 'new', label: 'New', kind: 'open' },
      { value: 'won', label: 'Won', kind: 'won' },
    ];
    const { savedFields } = renderField(field('select', kinded));

    await userEvent.click(screen.getByRole('combobox', { name: t('designer.field.type', 'en-US') }));
    const list = await screen.findByRole('listbox', { name: t('designer.field.type', 'en-US') });
    await userEvent.click(within(list).getByRole('option', { name: typeLabel }));

    const fields = savedFields();
    expect(fields.status.type).toBe(nextType);
    const options = savedOptions(fields);
    expect(options).toHaveLength(2);
    expect(options).toEqual(keeps ? kinded : kinded.map(({ kind: _k, ...o }) => o));
    expect(rejectionsOf(FieldSchema, { name: 'status', ...fields.status })).toEqual([]);
  });

  it('the inspector says what the lifecycle field needs while an option lacks a kind', async () => {
    renderField(field('select', STATUS_OPTIONS), { stageField: 'status' });
    expect(screen.getByTestId('field-held-hint').textContent).toMatch(/lifecycle field/);

    await pickKind(0, 'Open');
    await pickKind(1, 'Won');
    await pickKind(2, 'Lost');
    expect(screen.queryByTestId('field-held-hint')).toBeNull();
  });

  it('CONTROL — no lifecycle hint on a select the object does not name as its stage field', () => {
    renderField(field('select', STATUS_OPTIONS), { stageField: 'other' });
    expect(screen.queryByTestId('field-held-hint')).toBeNull();
  });

  it('zh: the picker and its kinds are labelled from the studio catalogue', async () => {
    renderField(field('select', [{ value: 'done', label: 'Done', kind: 'won' }]), { locale: 'zh-CN' });
    const trigger = screen.getByTestId('option-kind');
    expect(trigger.getAttribute('aria-label')).toBe('生命周期类别');
    expect(trigger.textContent).toBe('成功结束');
  });
});
