// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#12451 — the form designer's section and field cards: a section
 * header that counts its fields and keeps the settings trigger, a field card
 * whose selection draws a primary border and soft ring with the type tag in
 * primary, and a dashed "add" footer under the last section.
 *
 * Column steps are not pinned here: they follow the runtime form's rule and
 * stay pinned by `ObjectFormDesigner.test.tsx`.
 */

import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type * as React from 'react';
import { ObjectFormDesigner } from './ObjectFormDesigner';
import { t, tFormat } from '../metadata-admin/i18n';

afterEach(cleanup);

const draft = {
  name: 'crm_account',
  fields: [
    { name: 'name', type: 'text', label: 'Account Name', required: true, group: 'basic' },
    { name: 'industry', type: 'select', label: 'Industry', group: 'basic' },
    { name: 'description', type: 'textarea', label: 'Description', group: 'basic' },
  ],
  fieldGroups: [{ key: 'basic', label: 'Basic Information' }],
};

function renderDesigner(props: Partial<React.ComponentProps<typeof ObjectFormDesigner>> = {}) {
  const onChange = vi.fn();
  render(
    <ObjectFormDesigner
      draft={draft}
      systemFieldNames={new Set()}
      onChange={onChange}
      onSelectField={() => {}}
      onSelectGroup={() => {}}
      {...props}
    />,
  );
  return { onChange };
}

const card = (label: string) => screen.getByText(label, { exact: true }).closest('[aria-roledescription]') as HTMLElement;

describe('ObjectFormDesigner — section and field cards (objectui#12451)', () => {
  it('the section header counts its fields and keeps the settings trigger', () => {
    renderDesigner();
    expect(screen.getByText(tFormat('engine.studio.data.fieldCount', 'en-US', { count: 3 }))).toBeInTheDocument();
    expect(screen.getByLabelText(t('engine.studio.designer.group.settings', 'en-US'))).toBeInTheDocument();
  });

  it('a selected field draws the primary border and ring, and its type tag turns primary', () => {
    renderDesigner({ selectedField: 'name' });
    const selected = card('Account Name');
    expect(selected).toHaveClass('border-primary', 'ring-[3px]');
    // The tag reads the type's display name (objectui#13148), not the spec id.
    expect(
      screen.getAllByText(t('engine.fieldType.text', 'en-US')).find((el) => selected.contains(el)),
    ).toHaveClass('text-primary');

    const other = card('Industry');
    expect(other).toHaveClass('border-transparent');
    expect(other).not.toHaveClass('ring-[3px]');
  });

  it('a required field carries the asterisk; a picker shows a select skeleton; a textarea is the tall one', () => {
    renderDesigner();
    expect(card('Account Name')).toHaveTextContent('*');
    expect(card('Industry')).toHaveTextContent(t('engine.studio.designer.select', 'en-US'));
    expect(card('Description').querySelector('.h-14')).not.toBeNull();
  });

  it('the dashed footer adds a section', () => {
    const { onChange } = renderDesigner();
    fireEvent.click(screen.getByTestId('form-designer-add-section-footer'));
    expect(onChange).toHaveBeenCalledTimes(1);
    const groups = onChange.mock.calls[0][0].fieldGroups as Array<{ label: string }>;
    expect(groups).toHaveLength(2);
  });

  it('CONTROL — read-only: no footer and no toolbar actions', () => {
    renderDesigner({ readOnly: true, onAddField: () => {} });
    expect(screen.queryByTestId('form-designer-add-section-footer')).toBeNull();
    expect(screen.queryByRole('button', { name: t('engine.studio.data.addField', 'en-US') })).toBeNull();
  });
});
