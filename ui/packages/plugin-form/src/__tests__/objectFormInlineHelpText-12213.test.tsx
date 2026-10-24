/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#12213 — the record form draws a field's `inlineHelpText` under its
 * control.
 *
 * `@objectstack/spec`'s `FieldSchema` declares `inlineHelpText` ("Help text
 * displayed below the field in forms"), and Studio's object field inspector
 * writes it. Both of the form's field builders (`ObjectForm`'s own and
 * `fromObjectSchema`) read `field.help || field.description` and never that
 * key, so help text an admin typed in Studio never showed on the record form.
 * They now share one read, `fieldHelpText` from `@object-ui/fields`.
 *
 * Pinned through the public `ObjectForm` entry, with the real registered field
 * widgets, on three layouts that reach the two builders:
 *
 *   - flat: no sections, `ObjectForm`'s own builder;
 *   - sectioned: `sections` on the default layout, members resolved from the
 *     pool that builder fills;
 *   - tabbed: `formType: 'tabbed'`, whose members resolve through
 *     `fromObjectSchema`.
 *
 * On each one:
 *
 *   1. `inlineHelpText` is the control's accessible description, drawn AFTER
 *      the control (the place flow screens draw it), and it wins over
 *      `description`;
 *   2. CONTROL: a field with only `description` still draws it;
 *   3. `inlineHelpText: ''` reads as absent, so the description is drawn (`||`,
 *      not `??`: the spec declares no setting that hides the help line);
 *   4. a served `help` key is ignored (ruled on objectui#12213: only an
 *      objectstack server older than spec 17.7.0 serves one, and 17.7.0 serves
 *      the translated text on `description`). A field carrying `help` draws its
 *      `description`; one whose only help is `help` draws no help line; and
 *      `inlineHelpText` still wins over it;
 *   5. CONTROL: a field with none of the three draws no description.
 *
 * Plus, on the flat layout only (the one that appends it): a file field's size
 * hint follows its `inlineHelpText`.
 */

import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import { registerAllFields } from '@object-ui/fields';
import { ObjectForm } from '../ObjectForm';

registerAllFields();

const MB = 1024 * 1024;

const OBJECT_SCHEMA = {
  name: 'ticket',
  fields: {
    note: {
      type: 'text',
      label: 'Note',
      inlineHelpText: 'Shown under the note',
      description: 'The note description',
    },
    summary: { type: 'text', label: 'Summary', description: 'The summary description' },
    blank: { type: 'text', label: 'Blank', inlineHelpText: '', description: 'The blank description' },
    served: { type: 'text', label: 'Served', help: 'Served translated help', description: 'Served source description' },
    helpOnly: { type: 'text', label: 'Help only', help: 'Served help alone' },
    both: { type: 'text', label: 'Both', inlineHelpText: 'Declared help wins', help: 'Served help loses' },
    plain: { type: 'text', label: 'Plain' },
    contract: { type: 'file', label: 'Contract', inlineHelpText: 'PDF only', maxSize: 10 * MB },
  },
};

const TEXT_FIELDS = ['note', 'summary', 'blank', 'served', 'helpOnly', 'both', 'plain'] as const;

const makeDS = () =>
  ({
    getObjectSchema: vi.fn().mockResolvedValue(OBJECT_SCHEMA),
    create: vi.fn().mockResolvedValue({ id: 't1' }),
    update: vi.fn().mockResolvedValue({ id: 't1' }),
    findOne: vi.fn().mockResolvedValue({ id: 't1' }),
    find: vi.fn().mockResolvedValue({ data: [], total: 0 }),
  }) as any;

type Layout = 'flat' | 'sectioned' | 'tabbed';

const schemaFor = (layout: Layout) => {
  const base = { type: 'object-form', objectName: 'ticket', mode: 'create' };
  if (layout === 'flat') return base;
  const sections = [{ label: 'Main', fields: [...TEXT_FIELDS] }];
  return layout === 'sectioned' ? { ...base, sections } : { ...base, formType: 'tabbed', sections };
};

const renderForm = async (layout: Layout) => {
  render(<ObjectForm schema={schemaFor(layout) as any} dataSource={makeDS()} />);
  await waitFor(() => {
    for (const name of TEXT_FIELDS) {
      const label = OBJECT_SCHEMA.fields[name].label;
      screen.getByRole('textbox', { name: label });
    }
  });
};

const control = (label: string) => screen.getByRole('textbox', { name: label });

afterEach(() => cleanup());

describe.each<Layout>(['flat', 'sectioned', 'tabbed'])(
  'ObjectForm (%s) — the help line under a field reads `inlineHelpText` (objectui#12213)',
  (layout) => {
    it('draws `inlineHelpText` as the control’s description, after the control, over `description`', async () => {
      await renderForm(layout);
      const input = control('Note');
      expect(input).toHaveAccessibleDescription('Shown under the note');

      const help = screen.getByText('Shown under the note');
      // BELOW: the help element follows the control in document order, as on
      // a flow screen.
      expect(input.compareDocumentPosition(help) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      expect(screen.queryByText('The note description')).toBeNull();
    });

    it('CONTROL: a field with only `description` still draws it', async () => {
      await renderForm(layout);
      expect(control('Summary')).toHaveAccessibleDescription('The summary description');
    });

    it('an empty `inlineHelpText` reads as absent: the description is drawn', async () => {
      await renderForm(layout);
      expect(control('Blank')).toHaveAccessibleDescription('The blank description');
    });

    it('a served `help` key is ignored: `description` is drawn, and `help` alone draws no help line', async () => {
      await renderForm(layout);
      expect(control('Served')).toHaveAccessibleDescription('Served source description');
      expect(screen.queryByText('Served translated help')).toBeNull();
      expect(control('Help only')).toHaveAccessibleDescription('');
      expect(screen.queryByText('Served help alone')).toBeNull();
      expect(control('Both')).toHaveAccessibleDescription('Declared help wins');
      expect(screen.queryByText('Served help loses')).toBeNull();
    });

    it('CONTROL: a field with no help text has no description', async () => {
      await renderForm(layout);
      expect(control('Plain')).toHaveAccessibleDescription('');
    });
  },
);

describe('ObjectForm (flat) — a file field’s size hint follows its `inlineHelpText` (objectui#12213)', () => {
  it('appends the size hint after the declared help text', async () => {
    render(<ObjectForm schema={schemaFor('flat') as any} dataSource={makeDS()} />);
    await waitFor(() => {
      const row = document.body.querySelector<HTMLElement>('[data-field="contract"]');
      expect(row?.textContent).toContain('PDF only (Max size: 10.0 MB)');
    });
  });
});
