/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The designer forms pick with the shared `Select` (objectui#11865).
 *
 * Four plugin-designer controls were browser-native selects beside the shared
 * Radix `Select` the rest of the console picks with: `FieldDesigner`'s type
 * filter, `DataModelDesigner`'s field-type picker on each field row,
 * `BrandingEditor`'s font family and `AppCreationWizard`'s template. The card
 * asks for one control for one kind of choice, surface by surface.
 *
 * What is pinned, per control:
 *   - it IS the primitive (a Radix combobox trigger) and shows the value;
 *   - it lists the options, in the native control's order (and, for the type
 *     filter, under the native control's category headings);
 *   - every option writes what the native control wrote, compared as JSON
 *     text, the `''` options ("All Types", "Default (System)", "None")
 *     included; re-picking the current option writes nothing;
 *   - a value no option carries is what the trigger shows;
 *   - the font and template pickers keep the name their `<label htmlFor>`
 *     gave the native control, and show read-only as disabled;
 *   - the keyboard alone opens a picker and selects.
 *
 * The type filter and the field-type picker have no name: the native controls
 * had none either (no label, no `aria-label`), so there is no name to keep.
 * The field-type picker also keeps two things the native control did: a click
 * on it does not select the entity card, and Delete or Escape on it does not
 * act on the canvas.
 *
 * DIRECTION, observed against the native controls: the pins that read a
 * control as the primitive's trigger are red there. Green there too, by
 * design, are the pins of what the conversion kept: the two names, the three
 * read-only states, the read-only data model's type text, and the
 * field-type picker's own keys (the native control was a `SELECT`, which the
 * canvas shortcuts already skipped). That last pin goes red when the canvas
 * guard's combobox line is removed, and the card pin goes red when either
 * click stop is removed. What makes the write pins guards of "the conversion
 * changed nothing the forms write" is the literal each compares against: a
 * `change` event on the pre-conversion native control wrote that same JSON,
 * read once on those components with these fixtures. The names were read
 * there the same way. That probe's `change` event fired for the current option
 * too, which a browser's native select does not do, so the re-pick rows pin
 * the primitive.
 */

import '@testing-library/jest-dom/vitest';
import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, within, act } from '@testing-library/react';
import type { BrandingConfig, DataModelEntity, DesignerFieldDefinition, DesignerFieldType } from '@object-ui/types';

vi.mock('@object-ui/plugin-grid', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  ...(await import('./__mocks__/plugin-grid')),
}));
vi.mock('@object-ui/plugin-form', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  ...(await import('./__mocks__/plugin-form')),
}));

import { FieldDesigner } from '../FieldDesigner';
import { DataModelDesigner } from '../DataModelDesigner';
import { BrandingEditor } from '../BrandingEditor';
import { AppCreationWizard } from '../AppCreationWizard';

afterEach(() => cleanup());

/** Open a picker from the keyboard and return the options it lists, in order. */
async function openPicker(trigger: HTMLElement): Promise<HTMLElement[]> {
  fireEvent.keyDown(trigger, { key: 'ArrowDown' });
  const listbox = await screen.findByRole('listbox');
  return within(listbox).getAllByRole('option');
}

async function pick(trigger: HTMLElement, label: string): Promise<void> {
  const options = await openPicker(trigger);
  const option = options.find((o) => o.textContent === label);
  if (!option) throw new Error(`the picker lists no "${label}": ${options.map((o) => o.textContent).join(' | ')}`);
  fireEvent.click(option);
}

function expectPrimitive(trigger: HTMLElement, shown: string): void {
  expect(trigger.tagName).toBe('BUTTON');
  expect(trigger).toHaveAttribute('role', 'combobox');
  expect(trigger.textContent).toBe(shown);
}

// ---------------------------------------------------------------------------
// FieldDesigner — the type filter
// ---------------------------------------------------------------------------

/** [category heading, option label, type] in the native control's order. */
const FILTER_OPTIONS: ReadonlyArray<readonly [string, string, DesignerFieldType]> = [
  ['Text', 'Text', 'text'],
  ['Text', 'Text Area', 'textarea'],
  ['Text', 'Email', 'email'],
  ['Text', 'Phone', 'phone'],
  ['Text', 'URL', 'url'],
  ['Text', 'Password', 'password'],
  ['Text', 'Markdown', 'markdown'],
  ['Text', 'Rich Text', 'html'],
  ['Number', 'Number', 'number'],
  ['Number', 'Currency', 'currency'],
  ['Number', 'Percent', 'percent'],
  ['Number', 'Auto Number', 'autonumber'],
  ['Number', 'Rating', 'rating'],
  ['Number', 'Slider', 'slider'],
  ['Date & Time', 'Date', 'date'],
  ['Date & Time', 'Date/Time', 'datetime'],
  ['Date & Time', 'Time', 'time'],
  ['Choice', 'Checkbox', 'boolean'],
  ['Choice', 'Picklist', 'select'],
  ['Relation', 'Lookup', 'lookup'],
  ['Advanced', 'Formula', 'formula'],
  ['Advanced', 'File', 'file'],
  ['Advanced', 'Image', 'image'],
  ['Advanced', 'Color', 'color'],
  ['Advanced', 'Code', 'code'],
  ['Advanced', 'Location', 'location'],
  ['Advanced', 'Address', 'address'],
];

/** One field of every type, so each type option shows exactly one row. */
const ONE_FIELD_PER_TYPE: DesignerFieldDefinition[] = FILTER_OPTIONS.map(([, label, type]) => ({
  id: `f_${type}`,
  name: `f_${type}`,
  label,
  type,
}));

const ALL_ROWS = FILTER_OPTIONS.map(([, , type]) => `grid-row-f_${type}`);

async function shownRows(): Promise<string[]> {
  await act(async () => {});
  return screen.queryAllByTestId(/^grid-row-f_/).map((r) => r.getAttribute('data-testid') ?? '');
}

function renderFieldDesigner(readOnly = false) {
  render(<FieldDesigner objectName="deal" fields={ONE_FIELD_PER_TYPE} onFieldsChange={() => {}} readOnly={readOnly} />);
  return screen.getByTestId('field-designer-type-filter');
}

describe('FieldDesigner — the type filter is the shared Select (objectui#11865)', () => {
  it('is the Radix combobox trigger, showing "All Types", with no native select left', async () => {
    const trigger = renderFieldDesigner();
    expect(screen.getByTestId('field-designer').querySelector('select')).toBeNull();
    expectPrimitive(trigger, 'All Types');
    expect(await shownRows()).toEqual(ALL_ROWS);
  });

  it('lists "All Types", then every type under its category heading, in the native order', async () => {
    const trigger = renderFieldDesigner();
    const options = await openPicker(trigger);
    expect(options.map((o) => o.textContent)).toEqual(['All Types', ...FILTER_OPTIONS.map(([, label]) => label)]);
    // Each category is a group named by its heading, where the native control had an `<optgroup label>`.
    const listbox = screen.getByRole('listbox');
    const byHeading = new Map<string, string[]>();
    for (const [heading, label] of FILTER_OPTIONS) byHeading.set(heading, [...(byHeading.get(heading) ?? []), label]);
    expect(within(listbox).getAllByRole('group')).toHaveLength(byHeading.size);
    for (const [heading, labels] of byHeading) {
      const group = within(listbox).getByRole('group', { name: heading });
      expect(within(group).getAllByRole('option').map((o) => o.textContent), heading).toEqual(labels);
    }
  });

  it.each(FILTER_OPTIONS.map(([, label, type]) => [label, type] as const))(
    'picking "%s" shows the %s field alone',
    async (label, type) => {
      const trigger = renderFieldDesigner();
      await pick(trigger, label);
      expect(await shownRows()).toEqual([`grid-row-f_${type}`]);
      expect(trigger.textContent).toBe(label);
    },
  );

  it('picking "All Types" after a type shows every field again', async () => {
    const trigger = renderFieldDesigner();
    await pick(trigger, 'Lookup');
    expect(await shownRows()).toEqual(['grid-row-f_lookup']);
    await pick(trigger, 'All Types');
    expect(await shownRows()).toEqual(ALL_ROWS);
    expect(trigger.textContent).toBe('All Types');
  });

  it('stays enabled in read-only mode, as the native control did: it filters and writes nothing', () => {
    expect(renderFieldDesigner(true)).toBeEnabled();
  });
});

// ---------------------------------------------------------------------------
// DataModelDesigner — a field row's type picker
// ---------------------------------------------------------------------------

/** The types the picker offers, in the native control's order. */
const DATA_MODEL_TYPES = [
  'text', 'number', 'boolean', 'date', 'datetime', 'uuid',
  'email', 'url', 'phone', 'json', 'integer', 'float',
  'decimal', 'currency', 'percent', 'textarea', 'select',
  'multiselect', 'lookup', 'attachment', 'formula', 'autonumber',
];

const ACCOUNT: DataModelEntity = {
  id: 'account',
  name: 'account',
  label: 'Account',
  position: { x: 40, y: 40 },
  fields: [
    { name: 'id', type: 'uuid', primaryKey: true },
    { name: 'name', type: 'text' },
    { name: 'legacy', type: 'geo_point' },
  ],
};

/** The JSON text of the entities the designer writes once `name` is `type`, as the native control wrote it. */
const entitiesWith = (type: string) =>
  `[{"id":"account","name":"account","label":"Account","position":{"x":40,"y":40},"fields":[{"name":"id","type":"uuid","primaryKey":true},{"name":"name","type":"${type}"},{"name":"legacy","type":"geo_point"}]}]`;

function renderDataModel(readOnly = false) {
  const onEntitiesChange = vi.fn();
  render(<DataModelDesigner entities={[ACCOUNT]} onEntitiesChange={onEntitiesChange} readOnly={readOnly} />);
  return { onEntitiesChange };
}

function expectWrote(fn: ReturnType<typeof vi.fn>, json: string | null): void {
  if (json === null) {
    expect(fn).not.toHaveBeenCalled();
    return;
  }
  expect(fn).toHaveBeenCalledTimes(1);
  expect(JSON.stringify(fn.mock.calls[0][0])).toBe(json);
}

describe('DataModelDesigner — the field-type picker is the shared Select (objectui#11865)', () => {
  it('is the Radix combobox trigger on every field row, showing the field’s type, with no native select left', () => {
    renderDataModel();
    expect(screen.getByTestId('data-model-canvas').querySelector('select')).toBeNull();
    expectPrimitive(screen.getByTestId('field-type-account-0'), 'uuid');
    expectPrimitive(screen.getByTestId('field-type-account-1'), 'text');
  });

  it('lists the types in the native control’s order', async () => {
    renderDataModel();
    const options = await openPicker(screen.getByTestId('field-type-account-1'));
    expect(options.map((o) => o.textContent)).toEqual(DATA_MODEL_TYPES);
  });

  it.each(DATA_MODEL_TYPES.map((type) => [type, type === 'text' ? null : entitiesWith(type)] as const))(
    'a text field picked as "%s" writes what the native control wrote',
    async (type, json) => {
      const { onEntitiesChange } = renderDataModel();
      await pick(screen.getByTestId('field-type-account-1'), type);
      expectWrote(onEntitiesChange, json);
    },
  );

  it('a type no option carries is shown, listed first, and re-picking it writes nothing', async () => {
    const { onEntitiesChange } = renderDataModel();
    const trigger = screen.getByTestId('field-type-account-2');
    // The native control showed its first option, "text", here.
    expect(trigger.textContent).toBe('geo_point');
    expect((await openPicker(trigger)).map((o) => o.textContent)).toEqual(['geo_point', ...DATA_MODEL_TYPES]);
    fireEvent.click(screen.getAllByRole('option')[0]);
    expect(onEntitiesChange).not.toHaveBeenCalled();
  });

  it('a click on the picker, and a pick in its list, do not select the entity card', async () => {
    const { onEntitiesChange } = renderDataModel();
    const trigger = screen.getByTestId('field-type-account-1');
    fireEvent.click(trigger);
    await pick(trigger, 'number');
    expectWrote(onEntitiesChange, entitiesWith('number'));
    // The properties panel is titled by the selected entity; it still reads "Properties".
    expect(screen.getByRole('region', { name: 'Properties' })).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Account' })).toBeNull();
    // Control: a click on the card itself selects it.
    fireEvent.click(screen.getByRole('group', { name: 'Account' }));
    expect(screen.getByRole('region', { name: 'Account' })).toBeInTheDocument();
  });

  it('Delete and Escape on the picker are its own keys, not the canvas shortcuts', async () => {
    renderDataModel();
    const card = screen.getByRole('group', { name: 'Account' });
    fireEvent.click(card);
    expect(screen.getByRole('region', { name: 'Account' })).toBeInTheDocument();
    const trigger = screen.getByTestId('field-type-account-1');
    trigger.focus();
    fireEvent.keyDown(trigger, { key: 'Delete' });
    fireEvent.keyDown(trigger, { key: 'Escape' });
    await act(async () => {});
    expect(screen.queryByText('Delete Entities')).toBeNull();
    expect(screen.getByRole('region', { name: 'Account' })).toBeInTheDocument();
    // Control: Delete on the card asks to delete the selected entity.
    fireEvent.keyDown(card, { key: 'Delete' });
    expect(await screen.findByText('Delete Entities')).toBeInTheDocument();
  });

  it('Enter opens the picker and Enter on a type selects it', async () => {
    const { onEntitiesChange } = renderDataModel();
    fireEvent.keyDown(screen.getByTestId('field-type-account-1'), { key: 'Enter' });
    const listbox = await screen.findByRole('listbox');
    fireEvent.keyDown(within(listbox).getByRole('option', { name: 'json' }), { key: 'Enter' });
    expectWrote(onEntitiesChange, entitiesWith('json'));
  });

  it('read-only draws the type as text, with no picker, as it did', () => {
    renderDataModel(true);
    expect(screen.queryAllByRole('combobox')).toHaveLength(0);
    expect(within(screen.getByTestId('field-row-account-1')).getByText('text')).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// BrandingEditor — the font family
// ---------------------------------------------------------------------------

const FONTS = ['Inter', 'Roboto', 'Open Sans', 'Lato', 'Montserrat', 'Poppins', 'Source Sans Pro', 'Noto Sans', 'system-ui'];
const FONT_DEFAULT = 'Default (System)';

/** [start branding, option label, the JSON text of the branding `onChange` received]; `null`: nothing written. */
const FONT_WRITES: ReadonlyArray<readonly [BrandingConfig, string, string | null]> = [
  [{ primaryColor: '#3b82f6' }, FONT_DEFAULT, null],
  ...FONTS.map((font) => [{ primaryColor: '#3b82f6' }, font, `{"primaryColor":"#3b82f6","fontFamily":"${font}"}`] as const),
  [{ primaryColor: '#3b82f6', fontFamily: 'Roboto' }, FONT_DEFAULT, '{"primaryColor":"#3b82f6"}'],
  ...FONTS.map(
    (font) =>
      [
        { primaryColor: '#3b82f6', fontFamily: 'Roboto' },
        font,
        font === 'Roboto' ? null : `{"primaryColor":"#3b82f6","fontFamily":"${font}"}`,
      ] as const,
  ),
];

function renderBranding(branding: BrandingConfig, readOnly = false) {
  const onChange = vi.fn();
  render(<BrandingEditor branding={branding} onChange={onChange} readOnly={readOnly} />);
  return { onChange, trigger: screen.getByTestId('branding-font-select') };
}

describe('BrandingEditor — the font family is the shared Select (objectui#11865)', () => {
  it('is the Radix combobox trigger, showing the branding’s font, with no native select left', () => {
    const { trigger } = renderBranding({ primaryColor: '#3b82f6' });
    expect(screen.getByTestId('branding-editor').querySelector('select')).toBeNull();
    expectPrimitive(trigger, FONT_DEFAULT);
    cleanup();
    expectPrimitive(renderBranding({ fontFamily: 'Lato' }).trigger, 'Lato');
  });

  // Green against the native control too, by design: it pins what the conversion kept.
  it('keeps the name its label gave the native control', () => {
    const { trigger } = renderBranding({});
    expect(screen.getByRole('combobox', { name: 'Font Family' })).toBe(trigger);
  });

  it('lists the default, then the fonts, in the native control’s order', async () => {
    const { trigger } = renderBranding({});
    expect((await openPicker(trigger)).map((o) => o.textContent)).toEqual([FONT_DEFAULT, ...FONTS]);
  });

  it.each(FONT_WRITES.map((row) => [`${row[0].fontFamily ?? 'no font'} → ${row[1]}`, ...row] as const))(
    '%s',
    async (_name, branding, label, json) => {
      const { onChange, trigger } = renderBranding(branding);
      await pick(trigger, label);
      expectWrote(onChange, json);
    },
  );

  it('the default clears the font as the native control did: the key is written as undefined', async () => {
    const { onChange, trigger } = renderBranding({ primaryColor: '#3b82f6', fontFamily: 'Roboto' });
    await pick(trigger, FONT_DEFAULT);
    expect(onChange.mock.calls[0][0]).toStrictEqual({ primaryColor: '#3b82f6', fontFamily: undefined });
  });

  it('a font no option carries is shown, not "Default (System)", and re-picking it writes nothing', async () => {
    const { onChange, trigger } = renderBranding({ fontFamily: 'Georgia' });
    expect(trigger.textContent).toBe('Georgia');
    expect((await openPicker(trigger)).map((o) => o.textContent)).toEqual(['Georgia', FONT_DEFAULT, ...FONTS]);
    fireEvent.click(screen.getAllByRole('option')[0]);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('read-only shows the trigger disabled, through the primitive', () => {
    expect(renderBranding({}, true).trigger).toBeDisabled();
  });
});

// ---------------------------------------------------------------------------
// AppCreationWizard — the template
// ---------------------------------------------------------------------------

const TEMPLATES = [
  { id: 'crm', label: 'CRM' },
  { id: 'blank', label: 'Blank', description: 'Start empty' },
];

/** [the draft's template, option label, the JSON text of the template the saved draft carries]. */
const TEMPLATE_WRITES: ReadonlyArray<readonly [string | undefined, string, string]> = [
  [undefined, 'None', '{"template":""}'],
  [undefined, 'CRM', '{"template":"crm"}'],
  [undefined, 'Blank', '{"template":"blank"}'],
  ['crm', 'None', '{"template":""}'],
  ['crm', 'CRM', '{"template":"crm"}'],
  ['crm', 'Blank', '{"template":"blank"}'],
];

function renderWizard(template?: string, readOnly = false) {
  const onSaveDraft = vi.fn();
  render(
    <AppCreationWizard
      templates={TEMPLATES}
      onSaveDraft={onSaveDraft}
      initialDraft={template === undefined ? undefined : { template }}
      readOnly={readOnly}
    />,
  );
  return { onSaveDraft, trigger: document.getElementById('app-template') as HTMLElement };
}

function savedTemplate(onSaveDraft: ReturnType<typeof vi.fn>): string {
  fireEvent.click(screen.getByTestId('wizard-save-draft'));
  expect(onSaveDraft).toHaveBeenCalledTimes(1);
  return JSON.stringify({ template: onSaveDraft.mock.calls[0][0].template });
}

describe('AppCreationWizard — the template is the shared Select (objectui#11865)', () => {
  it('is the Radix combobox trigger, showing the draft’s template, with no native select left', () => {
    const { trigger } = renderWizard();
    expect(screen.getByTestId('wizard-step-basic-content').querySelector('select')).toBeNull();
    expectPrimitive(trigger, 'None');
    cleanup();
    expectPrimitive(renderWizard('blank').trigger, 'Blank');
  });

  // Green against the native control too, by design: it pins what the conversion kept.
  it('keeps the name its label gave the native control', () => {
    const { trigger } = renderWizard();
    expect(screen.getByRole('combobox', { name: 'Template' })).toBe(trigger);
  });

  it('lists "None", then the templates, in the native control’s order', async () => {
    const { trigger } = renderWizard();
    expect((await openPicker(trigger)).map((o) => o.textContent)).toEqual(['None', 'CRM', 'Blank']);
  });

  it.each(TEMPLATE_WRITES.map((row) => [`${row[0] ?? 'no template'} → ${row[1]}`, ...row] as const))(
    '%s',
    async (_name, template, label, json) => {
      const { onSaveDraft, trigger } = renderWizard(template);
      await pick(trigger, label);
      expect(savedTemplate(onSaveDraft)).toBe(json);
    },
  );

  it('a template no option carries is shown, not "None", and re-picking it keeps it', async () => {
    const { onSaveDraft, trigger } = renderWizard('ghost');
    expect(trigger.textContent).toBe('ghost');
    expect((await openPicker(trigger)).map((o) => o.textContent)).toEqual(['ghost', 'None', 'CRM', 'Blank']);
    fireEvent.click(screen.getAllByRole('option')[0]);
    expect(savedTemplate(onSaveDraft)).toBe('{"template":"ghost"}');
  });

  it('Enter opens the picker and Enter on a template selects it', async () => {
    const { onSaveDraft, trigger } = renderWizard();
    fireEvent.keyDown(trigger, { key: 'Enter' });
    const listbox = await screen.findByRole('listbox');
    fireEvent.keyDown(within(listbox).getByRole('option', { name: 'CRM' }), { key: 'Enter' });
    expect(savedTemplate(onSaveDraft)).toBe('{"template":"crm"}');
  });

  it('read-only shows the trigger disabled, through the primitive', () => {
    expect(renderWizard(undefined, true).trigger).toBeDisabled();
  });
});
