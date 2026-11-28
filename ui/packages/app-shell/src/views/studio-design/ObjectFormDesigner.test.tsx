/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import React from 'react';
import '@testing-library/jest-dom/vitest';
import userEvent from '@testing-library/user-event';
import { I18nProvider, createI18n } from '@object-ui/i18n';
import { ObjectFormDesigner } from './ObjectFormDesigner';
import { toFormFieldType } from './formFieldType';
import { t } from '../metadata-admin/i18n';

/** Build an array-shape `draft.fields` with `n` plain text fields. */
function textFields(n: number): Array<Record<string, unknown>> {
  return Array.from({ length: n }, (_, i) => ({
    name: `field_${i + 1}`,
    type: 'text',
    label: `Field ${i + 1}`,
  }));
}

const noop = () => {};

/** All descendant <div>s whose class list contains `cls` (raw substring match
 *  — Tailwind's `@`/`:` make CSS-selector escaping fiddly, so match strings). */
function divsWithClass(container: HTMLElement, cls: string): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>('div')).filter((d) =>
    d.className.split(/\s+/).includes(cls),
  );
}

describe('ObjectFormDesigner — responsive field grid (parity with the runtime form)', () => {
  it('spreads to 4 columns on wide screens for a field-heavy object', () => {
    // 16 editable fields → inferColumns() caps at 4, exactly like the real
    // ObjectForm. The section grid must carry the same container-query class,
    // so a wide container renders 4 fields per row.
    const { container } = render(
      <ObjectFormDesigner
        draft={{ fields: textFields(16) }}
        systemFieldNames={new Set()}
        onChange={noop}
        onSelectField={noop}
      />,
    );
    expect(divsWithClass(container, '@4xl:grid-cols-4').length).toBeGreaterThan(0);
    expect(divsWithClass(container, '@md:grid-cols-2').length).toBeGreaterThan(0);
    // Never a hard-coded 2-column grid anymore (the old fixed `grid-cols-2`).
    expect(divsWithClass(container, 'grid-cols-2')).toHaveLength(0);
  });

  it('stays single-column for a light object (no thin multi-column spread)', () => {
    // inferColumns(3) === 1 → containerGridColsFor(1) falls back to a plain
    // single-column grid, matching the runtime form's behaviour for tiny forms.
    const { container } = render(
      <ObjectFormDesigner
        draft={{ fields: textFields(3) }}
        systemFieldNames={new Set()}
        onChange={noop}
        onSelectField={noop}
      />,
    );
    expect(divsWithClass(container, '@4xl:grid-cols-4')).toHaveLength(0);
    expect(divsWithClass(container, '@2xl:grid-cols-3')).toHaveLength(0);
  });

  it('excludes system fields from the density count (parity with the form)', () => {
    // 16 declared fields but 14 are system/audit → only 2 editable, so the
    // designer must infer 1 column (inferColumns(2) === 1), not 4.
    const systemNames = Array.from({ length: 14 }, (_, i) => `field_${i + 1}`);
    const { container } = render(
      <ObjectFormDesigner
        draft={{ fields: textFields(16) }}
        systemFieldNames={new Set(systemNames)}
        onChange={noop}
        onSelectField={noop}
      />,
    );
    expect(divsWithClass(container, '@4xl:grid-cols-4')).toHaveLength(0);
  });

  it('lays wide widgets (textarea/markdown/…) across the full row like the runtime form', () => {
    render(
      <ObjectFormDesigner
        draft={{ fields: [...textFields(15), { name: 'notes', type: 'textarea', label: 'Notes' }] }}
        systemFieldNames={new Set()}
        onChange={noop}
        onSelectField={noop}
      />,
    );
    const notesCard = screen.getByText('Notes').closest('.cursor-grab') as HTMLElement;
    expect(notesCard).toBeTruthy();
    expect(notesCard.className).toContain('col-span-full');

    // A normal field occupies a single cell (no full-row span).
    const plainCard = screen.getByText('Field 1').closest('.cursor-grab') as HTMLElement;
    expect(plainCard.className).not.toContain('col-span-full');
  });
});

describe('ObjectFormDesigner — group selection', () => {
  const draft = {
    fields: [{ name: 'email', type: 'text', label: 'Email', group: 'contact' }],
    fieldGroups: [{ key: 'contact', label: 'Contact' }],
  };

  it('exposes a group-settings affordance that selects the group by key', () => {
    const onSelectGroup = vi.fn();
    render(
      <ObjectFormDesigner
        draft={draft}
        systemFieldNames={new Set()}
        onChange={noop}
        onSelectField={noop}
        onSelectGroup={onSelectGroup}
      />,
    );
    fireEvent.click(screen.getByLabelText('Group settings'));
    expect(onSelectGroup).toHaveBeenCalledWith('contact');
  });

  it('hides the group-settings affordance when no handler is provided', () => {
    render(
      <ObjectFormDesigner
        draft={draft}
        systemFieldNames={new Set()}
        onChange={noop}
        onSelectField={noop}
      />,
    );
    expect(screen.queryByLabelText('Group settings')).toBeNull();
  });
});

/**
 * Regression for objectui#3134.
 *
 * The layout canvas is a preview of the end-user form, so it has to resolve
 * labels the way `ObjectForm` / `RecordDetailView` do — through the project's
 * object translations. It used to read `entry.def.label` and `group.label`
 * straight off the draft metadata, so a fully translated object still rendered
 * its English source labels in the designer while every other surface in the
 * same locale showed the translation.
 *
 * The runtime bundle shape below is what `transformSpecTranslations` produces
 * from authored `objects.<obj>.fields.<f>.label` / `objects.<obj>._sections.
 * <key>.label` entries: field labels are flattened to `fields.<obj>.<field>`,
 * while `_sections` is preserved verbatim under the object scope.
 */
describe('ObjectFormDesigner — object translations (objectui#3134)', () => {
  const draft = {
    name: 'crm_opportunity',
    fields: [
      { name: 'name', type: 'text', label: 'Opportunity Name', group: 'basic' },
      { name: 'amount', type: 'number', label: 'Amount', group: 'basic' },
    ],
    fieldGroups: [{ key: 'basic', label: 'Basic Information' }],
  };

  const renderTranslated = (props: Record<string, unknown> = {}) => {
    const instance = createI18n({
      defaultLanguage: 'zh',
      detectBrowserLanguage: false,
      resources: {
        zh: {
          app: {
            objects: {
              crm_opportunity: {
                label: '商机',
                _sections: { basic: { label: '基本信息' } },
              },
            },
            fields: { crm_opportunity: { name: '商机名称' } },
          },
        },
      },
    });
    return render(
      <I18nProvider instance={instance}>
        <ObjectFormDesigner
          draft={draft}
          systemFieldNames={new Set()}
          onChange={noop}
          onSelectField={noop}
          {...props}
        />
      </I18nProvider>,
    );
  };

  it('renders the translated field label instead of the raw metadata label', () => {
    renderTranslated();
    expect(screen.getByText('商机名称')).toBeTruthy();
    expect(screen.queryByText('Opportunity Name')).toBeNull();
  });

  it('renders the translated section label instead of the raw group label', () => {
    const { container } = renderTranslated();
    const heading = container.querySelector<HTMLInputElement>('input[type="text"], input:not([type])');
    expect(heading?.value ?? '').toBe('基本信息');
    expect(screen.queryByText('Basic Information')).toBeNull();
  });

  it('falls back to the metadata label when the object has no translation for a field', () => {
    // `amount` is untranslated — the designer must show the authored label, not
    // a blank cell or the raw field name.
    renderTranslated();
    expect(screen.getByText('Amount')).toBeTruthy();
  });

  it('prefers the explicit objectName prop over draft.name as the lookup root', () => {
    // A draft whose body has not been (re)named yet still resolves, because the
    // Studio surface passes the object it is editing.
    const { container } = render(
      <I18nProvider
        instance={createI18n({
          defaultLanguage: 'zh',
          detectBrowserLanguage: false,
          resources: {
            zh: {
              app: {
                objects: { crm_opportunity: { _sections: { basic: { label: '基本信息' } } } },
                fields: { crm_opportunity: { name: '商机名称' } },
              },
            },
          },
        })}
      >
        <ObjectFormDesigner
          draft={{ ...draft, name: undefined }}
          objectName="crm_opportunity"
          systemFieldNames={new Set()}
          onChange={noop}
          onSelectField={noop}
        />
      </I18nProvider>,
    );
    expect(screen.getByText('商机名称')).toBeTruthy();
    const heading = container.querySelector<HTMLInputElement>('input[type="text"], input:not([type])');
    expect(heading?.value ?? '').toBe('基本信息');
  });
});

describe('ObjectFormDesigner — emits the one legal `FormField.type` spelling (objectui#4838)', () => {
  // Maintainer ruling 2026-08-19: a bare spec-type name is NOT a legal
  // `FormField.type`. The canvas is a PRODUCER of that vocabulary (it hands a
  // type to `resolveColSpan`, once `isWideFieldType`), so it is the producer that was fixed — the
  // tolerant `field:`-prefix fallback in `renderFieldComponent` and the
  // dual-spelling `WIDE_FIELD_TYPES` set are deliberately untouched.

  it('emits the namespaced widget id for the three bare spellings the card measured', () => {
    // The same string `mapFieldTypeToFormType` gives `ObjectForm` for these
    // fields — one widget, one spelling.
    expect(toFormFieldType('markdown')).toBe('field:markdown');
    expect(toFormFieldType('html')).toBe('field:html');
    expect(toFormFieldType('richtext')).toBe('field:richtext');
  });

  it('names the SAME widget the tolerant fallback resolved the bare spelling to', () => {
    // `renderFieldComponent`'s namespaced fallback resolves a bare spelling by
    // computing `field:${type}` and looking THAT key up in the registry. Our
    // emitted spelling is pinned against the identical expression, which is
    // what makes this a spelling change and not a widget change: the author
    // keeps getting RichTextField, reached by one legal name instead of two.
    for (const bare of ['markdown', 'html', 'richtext']) {
      expect(toFormFieldType(bare)).toBe(`field:${bare}`);
    }
  });

  it('NEGATIVE CONTROL — an already-namespaced type is emitted unchanged', () => {
    // Never double-prefixed…
    expect(toFormFieldType('field:markdown')).toBe('field:markdown');
    expect(toFormFieldType('field:markdown')).not.toBe('field:field:markdown');
    expect(toFormFieldType('field:grid')).toBe('field:grid');
    // …and never dropped onto `mapFieldTypeToFormType`'s `|| 'field:text'`
    // tail, which is what an unguarded call would do to it — a silent
    // downgrade to a plain text input, worse than the bug being fixed.
    expect(toFormFieldType('field:markdown')).not.toBe('field:text');
  });

  it('lays a `repeater` field out the way the runtime form resolves it', () => {
    // The canvas asks the width question through the runtime form's own
    // `span: 'auto'` default (`resolveColSpan`), so the two cannot drift.
    // `repeater` is an untyped JSON array in the spec and resolves to the JSON
    // editor (`field:object`) beside `composite` and `record`; that widget is
    // not wide, but the spec `span` docblock lists repeater as wide, and the
    // form widens it by its declared type (objectstack#37677). So the canvas
    // gives it the whole row, as the record form and `/forms/NAME` do.
    expect(toFormFieldType('repeater')).toBe('field:object');
    render(
      <ObjectFormDesigner
        draft={{ fields: [...textFields(15), { name: 'line_items', type: 'repeater', label: 'Line Items' }] }}
        systemFieldNames={new Set()}
        onChange={noop}
        onSelectField={noop}
      />,
    );
    const card = screen.getByText('Line Items').closest('.cursor-grab') as HTMLElement;
    expect(card).toBeTruthy();
    expect(card.className).toContain('col-span-full');
  });

  it('CONTROL — a `json` field, on the same JSON editor, stays one cell on the canvas', () => {
    expect(toFormFieldType('json')).toBe('field:object');
    render(
      <ObjectFormDesigner
        draft={{ fields: [...textFields(15), { name: 'payload', type: 'json', label: 'Payload' }] }}
        systemFieldNames={new Set()}
        onChange={noop}
        onSelectField={noop}
      />,
    );
    const card = screen.getByText('Payload').closest('.cursor-grab') as HTMLElement;
    expect(card).toBeTruthy();
    expect(card.className).not.toContain('col-span-full');
  });

  it('keeps a bare rich-text field wide, and never shows the admin the widget id', () => {
    render(
      <ObjectFormDesigner
        draft={{ fields: [...textFields(15), { name: 'body', type: 'markdown', label: 'Body' }] }}
        systemFieldNames={new Set()}
        onChange={noop}
        onSelectField={noop}
      />,
    );
    const card = screen.getByText('Body').closest('.cursor-grab') as HTMLElement;
    expect(card.className).toContain('col-span-full');
    // The normalization is for FORM vocabulary only: the widget id never
    // reaches the card. Its type tag names the type the way the type picker
    // does (objectui#13148), read through the catalog's row.
    expect(card.textContent).toContain(t('engine.fieldType.markdown', 'en-US'));
    expect(card.textContent).not.toContain('field:markdown');
  });
});

/**
 * objectstack#32103 — a group's boundary arrows ("Move group up" on the first
 * group, "Move group down" on the last) were natively disabled with no reason:
 * no tooltip on hover, Tab skipped them, nothing in the accessibility tree.
 * Each now takes the header Publish's treatment (`DisabledControlReason`): a
 * focusable wrapper opening a tooltip, and the wrapper and the button both
 * described by an `sr-only` copy of the reason, the button keeping its name.
 */
describe('ObjectFormDesigner — a disabled group arrow says why (objectstack#32103)', () => {
  const describedBy = (el: HTMLElement) =>
    document.getElementById(el.getAttribute('aria-describedby') ?? '') as HTMLElement | null;

  const oneGroup = {
    fields: [{ name: 'email', type: 'text', label: 'Email', group: 'contact' }],
    fieldGroups: [{ key: 'contact', label: 'Contact' }],
  };

  it('Tab from the group name reaches each disabled arrow; it shows the reason and keeps its name', async () => {
    const user = userEvent.setup();
    render(
      <ObjectFormDesigner draft={oneGroup} systemFieldNames={new Set()} onChange={noop} onSelectField={noop} />,
    );
    const up = screen.getByRole('button', { name: 'Move group up' });
    const down = screen.getByRole('button', { name: 'Move group down' });
    expect(up).toBeDisabled();
    expect(down).toBeDisabled();
    expect(describedBy(up)).toHaveTextContent('Already the first group');
    expect(describedBy(down)).toHaveTextContent('Already the last group');

    screen.getByRole('textbox', { name: 'Group name' }).focus();
    await user.tab();
    expect(up.parentElement).toHaveFocus();
    expect(up.parentElement).toHaveAttribute('data-disabled-reason');
    expect(describedBy(up.parentElement as HTMLElement)).toHaveTextContent('Already the first group');
    expect(await screen.findByRole('tooltip')).toHaveTextContent('Already the first group');

    await user.tab();
    expect(down.parentElement).toHaveFocus();
    expect(describedBy(down.parentElement as HTMLElement)).toHaveTextContent('Already the last group');
  });

  it('hovering a disabled arrow opens the tooltip with the reason', async () => {
    const user = userEvent.setup();
    render(
      <ObjectFormDesigner draft={oneGroup} systemFieldNames={new Set()} onChange={noop} onSelectField={noop} />,
    );
    await user.hover(screen.getByRole('button', { name: 'Move group down' }).parentElement as HTMLElement);
    expect(await screen.findByRole('tooltip')).toHaveTextContent('Already the last group');
  });

  it('CONTROL — an arrow that can move is a plain enabled button with no reason, and still moves', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <ObjectFormDesigner
        draft={{
          fields: [
            { name: 'email', type: 'text', label: 'Email', group: 'contact' },
            { name: 'notes', type: 'text', label: 'Notes', group: 'extra' },
          ],
          fieldGroups: [
            { key: 'contact', label: 'Contact' },
            { key: 'extra', label: 'Extra' },
          ],
        }}
        systemFieldNames={new Set()}
        onChange={onChange}
        onSelectField={noop}
      />,
    );
    const firstDown = screen.getAllByRole('button', { name: 'Move group down' })[0];
    expect(firstDown).toBeEnabled();
    expect(firstDown).not.toHaveAttribute('aria-describedby');
    expect(firstDown.parentElement).not.toHaveAttribute('data-disabled-reason');
    await user.click(firstDown);
    expect(onChange).toHaveBeenCalledTimes(1);
  });
});

/**
 * objectstack#36505 — an object still written with the older per-field
 * `group` shows its groups as the record page does, and the first write the
 * designer makes converts it to the `fieldGroups[].fields` spelling with no
 * visible change.
 */
describe('ObjectFormDesigner — a legacy `fields[].group` object converts on its first save (objectstack#36505)', () => {
  const legacy = {
    name: 'crm_quote',
    fields: {
      name: { type: 'text', label: 'Name', group: 'basic' },
      account: { type: 'text', label: 'Account', group: 'basic' },
      fee: { type: 'currency', label: 'Fee', group: 'money' },
      terms: { type: 'textarea', label: 'Terms' },
    },
    fieldGroups: [
      { key: 'basic', label: 'Basic' },
      { key: 'money', label: 'Money' },
    ],
  };
  /** Each section's title and the labels of the cards under it, in canvas order. */
  const canvas = (container: HTMLElement) =>
    Array.from(container.querySelectorAll<HTMLElement>('.\\@container')).map((section) => {
      const input = section.querySelector('input');
      const title = input ? input.value : (section.querySelector('span')?.textContent ?? '');
      const cards = Array.from(section.querySelectorAll<HTMLElement>('.touch-none')).map(
        (card) => card.querySelector('.truncate')?.textContent ?? '',
      );
      return [title, cards];
    });

  it('shows the legacy groups, and a rename saves every group\'s list and drops each field\'s `group`', async () => {
    const onChange = vi.fn();
    const { container, rerender } = render(
      <ObjectFormDesigner draft={legacy} systemFieldNames={new Set()} onChange={onChange} onSelectField={noop} />,
    );
    const before = canvas(container);
    expect(before).toEqual([
      ['Basic', ['Name', 'Account']],
      ['Money', ['Fee']],
      [t('engine.studio.designer.ungrouped', 'en'), ['Terms']],
    ]);

    const money = screen.getByDisplayValue('Money');
    await userEvent.clear(money);
    await userEvent.type(money, 'Pricing');
    fireEvent.blur(money);

    expect(onChange).toHaveBeenCalledTimes(1);
    const patch = onChange.mock.calls[0][0] as { fields: Record<string, Record<string, unknown>>; fieldGroups: unknown };
    expect(patch.fieldGroups).toEqual([
      { key: 'basic', label: 'Basic', fields: ['name', 'account'] },
      { key: 'money', label: 'Pricing', fields: ['fee'] },
    ]);
    expect(Object.values(patch.fields).map((def) => def.group)).toEqual([undefined, undefined, undefined, undefined]);

    // The saved body draws the same canvas, the rename aside.
    rerender(
      <ObjectFormDesigner draft={{ ...legacy, ...patch }} systemFieldNames={new Set()} onChange={onChange} onSelectField={noop} />,
    );
    expect(canvas(container)).toEqual([
      ['Basic', ['Name', 'Account']],
      ['Pricing', ['Fee']],
      [t('engine.studio.designer.ungrouped', 'en'), ['Terms']],
    ]);
  });

  it('CONTROL: an object already in the list spelling saves only what the edit changed', async () => {
    const onChange = vi.fn();
    const listed = {
      name: 'crm_quote',
      fields: { name: { type: 'text', label: 'Name' }, fee: { type: 'currency', label: 'Fee' } },
      fieldGroups: [{ key: 'basic', label: 'Basic', fields: ['name'] }, { key: 'money', label: 'Money', fields: ['fee'] }],
    };
    render(<ObjectFormDesigner draft={listed} systemFieldNames={new Set()} onChange={onChange} onSelectField={noop} />);
    const money = screen.getByDisplayValue('Money');
    await userEvent.clear(money);
    await userEvent.type(money, 'Pricing');
    fireEvent.blur(money);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(Object.keys(onChange.mock.calls[0][0])).toEqual(['fieldGroups']);
  });
});

/**
 * objectstack#36505 — on an installed object the canvas names where each
 * field comes from, and a field another package contributes is arranged like
 * any other once the `.custom` arrangement takes it.
 */
describe('ObjectFormDesigner — an installed object\'s field sources (objectstack#36505)', () => {
  const draft = {
    name: 'crm_lead',
    fields: {
      name: { type: 'text', label: 'Name' },
      region__c: { type: 'text', label: 'Region' },
      visit_count: { type: 'number', label: 'Visits' },
    },
  };
  const contributed = new Map([
    ['visit_count', { kind: 'field' as const, object: 'crm_lead', name: 'visit_count', packageId: 'com.acme.visits', packageName: 'Visits' }],
  ]);
  const sources = new Map([['name', 'base' as const], ['region__c', 'environment' as const]]);
  const card = (label: string) => screen.getByText(label).closest('[aria-label]') as HTMLElement;

  it('marks the original package\'s field and this environment\'s, and the contributed one with its package', () => {
    render(
      <ObjectFormDesigner
        draft={draft}
        systemFieldNames={new Set()}
        onChange={noop}
        onSelectField={noop}
        contributedFields={contributed}
        fieldSources={sources}
        arrangeContributed
      />,
    );
    expect(within(card('Name')).getByTestId('field-source-mark')).toHaveAttribute('data-source', 'base');
    expect(within(card('Name')).getByTestId('field-source-mark')).toHaveTextContent(t('engine.studio.designer.source.base', 'en'));
    expect(within(card('Region')).getByTestId('field-source-mark')).toHaveAttribute('data-source', 'environment');
    expect(within(card('Visits')).queryByTestId('field-source-mark')).toBeNull();
    expect(within(card('Visits')).getByTestId('contribution-mark')).toHaveAttribute('data-package', 'com.acme.visits');
    // Arranged: the contributed card is a drag source like the others.
    expect(card('Visits')).toHaveAttribute('aria-roledescription', t('engine.studio.designer.fieldRole', 'en'));
  });

  it('CONTROL: without the arrangement a contributed card is not dragged, and a writable package draws no source', () => {
    render(
      <ObjectFormDesigner draft={draft} systemFieldNames={new Set()} onChange={noop} onSelectField={noop} contributedFields={contributed} />,
    );
    expect(screen.queryAllByTestId('field-source-mark')).toHaveLength(0);
    expect(card('Visits').getAttribute('aria-roledescription') ?? '').toBe('');
  });
});
