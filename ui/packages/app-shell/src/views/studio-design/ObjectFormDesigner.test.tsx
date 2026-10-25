/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
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
  // type to `isWideFieldType`), so it is the producer that was fixed — the
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

  it('spans a `repeater` field full-row — the drift the raw pass hid', () => {
    // `repeater` is a spec `FieldType` that resolves to the WIDE `field:grid`
    // widget, but bare `repeater` is not one of `WIDE_FIELD_TYPES`' bare
    // members. Passing the raw object type in therefore matched nothing: the
    // canvas laid a repeater out at normal width while the runtime form —
    // which reaches the set through `mapFieldTypeToFormType` — spanned it.
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
