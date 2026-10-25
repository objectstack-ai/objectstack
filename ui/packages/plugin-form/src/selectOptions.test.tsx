/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Regression: option propagation for `select` fields in the create/edit form.
 *
 * Origin (ObjectOS "create record" form renders no select options): a `select`
 * field whose object-schema metadata had no `options` rendered a silently-empty
 * Radix dropdown, which read as a broken widget and was mis-attributed to the
 * form's option-propagation code. In fact the form propagates options correctly
 * end-to-end; the real defect was upstream metadata that carried the field
 * without an `options` array.
 *
 * These tests pin BOTH directions of the contract, portal-free (no need to open
 * the Radix popover, which is flaky under happy-dom):
 *
 *   1. options present  → the field renders as a usable dropdown (trigger shown,
 *      no empty state). If a future change drops options (e.g. `options || []`
 *      reduced to `[]`), the empty state appears and this test fails — catching
 *      the regression.
 *   2. options absent    → a legible "No options available" empty state renders
 *      instead of a silently-empty dropdown, so the real cause (metadata has no
 *      options) is visible rather than hidden.
 *
 * The grid masks missing options via a humanize+hash fallback in
 * `SelectCellRenderer`, so a correct-looking list does NOT prove options reach
 * the client — which is what made the original bug hard to localize.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { registerAllFields } from '@object-ui/fields';
import { ModalForm } from './ModalForm';

registerAllFields();

const GENRE_OPTIONS = [
  { value: 'fiction', label: 'Fiction' },
  { value: 'non_fiction', label: 'Non-Fiction' },
  { value: 'self_help', label: 'Self-Help' },
];

const makeDataSource = (genreOptions?: Array<{ value: string; label: string }>): any => ({
  getObjectSchema: vi.fn().mockResolvedValue({
    name: 'book',
    fields: {
      title: { type: 'text', label: 'Title', required: true },
      // `options` mirrors the shape the live schema (`GET /meta/object`) returns
      // for a select field. When omitted, this reproduces the metadata state
      // that produced the empty dropdown in the field report.
      genre: { type: 'select', label: 'Genre', required: true, ...(genreOptions ? { options: genreOptions } : {}) },
    },
  }),
  create: vi.fn().mockResolvedValue({ id: '1' }),
  findOne: vi.fn(),
});

const renderForm = (ds: any) =>
  render(
    <ModalForm
      schema={{
        objectName: 'book',
        mode: 'create',
        title: 'New Book',
        open: true,
        onOpenChange: vi.fn(),
        fields: ['title', 'genre'],
      } as any}
      dataSource={ds}
    />,
  );

beforeEach(() => vi.clearAllMocks());

describe('ModalForm select option propagation', () => {
  it('renders a usable dropdown (no empty state) when the schema field has options', async () => {
    renderForm(makeDataSource(GENRE_OPTIONS));

    // The select trigger is rendered — options propagated from the object
    // schema through the form's field-building path to the SelectField widget.
    await waitFor(() => expect(screen.getByTestId('select-trigger-genre')).toBeTruthy());
    // And the "no options" empty state is NOT shown. If options were dropped on
    // the way to the widget, the widget would render the empty state instead —
    // so this assertion is what fails on a propagation regression.
    expect(screen.queryByTestId('select-empty-genre')).toBeNull();
  });

  it('renders a legible empty state (not a silent dropdown) when the field has no options', async () => {
    renderForm(makeDataSource(undefined));

    // Reproduces the reported scenario: select metadata with no `options`. The
    // widget surfaces the cause instead of rendering an empty, unusable dropdown.
    const empty = await waitFor(() => screen.getByTestId('select-empty-genre'));
    expect(empty.textContent).toContain('No options available');
    expect(screen.queryByTestId('select-trigger-genre')).toBeNull();
  });
});
