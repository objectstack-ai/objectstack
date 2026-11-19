// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#35499 — an issue is drawn on the DEEPEST row the form renders
 * for a prefix of its path, one rule for every issue source:
 *
 *   1. a longer path lights the row its head names, its line led by the trail
 *      of the rest (`Label → not_a_locale: …`); an exact path is its message;
 *   2. a nested-form row hands down the issues whose next segment names a row
 *      the nested form renders, and keeps the rest; a collection face
 *      (repeater rows) does not descend, so the host row draws it with its trail;
 *   3. a hidden key mounts no row, so its issues are drawn nowhere here and the
 *      inline register never names it (the host's banner keeps them);
 *   4. the register names a head exactly while every issue under it is shown:
 *      in a create form a handed-down issue shows when its host row does.
 *
 * The page half (the banner, the refusal line, the Save tooltip) is pinned in
 * `ResourceEditPage.nestedRefusal-35499.test.tsx`.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { SchemaForm, type SchemaFormIssue } from './SchemaForm';

const schema = {
  type: 'object',
  properties: {
    label: { type: 'string', title: 'Label' },
    options: {
      type: 'object',
      title: 'Options',
      properties: {
        dialect: { type: 'string', title: 'Dialect' },
        source: { type: 'string', title: 'Source' },
      },
    },
    columns: {
      type: 'array',
      title: 'Columns',
      items: { type: 'object', properties: { field: { type: 'string' }, width: { type: 'number' } } },
    },
    fields: { type: 'object', title: 'Fields', additionalProperties: { type: 'object' } },
  },
};

const VALUE = {
  label: 'Tasks',
  options: { dialect: 'cel', source: 'true' },
  columns: [{ field: 'title', width: 120 }],
  fields: { title: { type: 'text' } },
};

function renderForm(
  issues: SchemaFormIssue[],
  opts: { hiddenFields?: string[]; createMode?: boolean; onInline?: (f: string[]) => void } = {},
) {
  return render(
    <SchemaForm
      schema={schema}
      value={VALUE}
      onChange={() => {}}
      issues={issues}
      hiddenFields={opts.hiddenFields}
      createMode={opts.createMode}
      onInlineIssueFieldsChange={(f) => opts.onInline?.([...f].sort())}
    />,
  );
}

const lines = () => screen.queryAllByTestId('schema-form-issue').map((el) => el.textContent);
/** The nested form's container for the host row labelled `label`. */
const nestedGroup = (label: string) => screen.getByRole('group', { name: label });

afterEach(() => cleanup());

describe('step 1 — a longer path lights the row its head names, led by its trail', () => {
  it('draws `label.not_a_locale` under Label as `Label → not_a_locale: …`, an exact path as its message', () => {
    renderForm([
      { path: 'label.not_a_locale', message: 'Unrecognized locale' },
      { path: 'label', message: 'Too long' },
    ]);
    expect(lines()).toEqual(['Label → not_a_locale: Unrecognized locale', 'Too long']);
  });
});

describe('step 2 — a nested form takes the issues it renders a row for; a collection does not descend', () => {
  it('hands `options.dialect` down to the nested Dialect row, drawn there as its message, once', () => {
    renderForm([{ path: 'options.dialect', message: 'Unknown dialect' }]);
    expect(lines()).toEqual(['Unknown dialect']);
    const issue = within(nestedGroup('Options')).getByTestId('schema-form-issue');
    expect(issue).toHaveTextContent('Unknown dialect');
  });

  it('keeps an issue whose next segment names no nested row on the host row, with its trail', () => {
    renderForm([{ path: 'options.not_a_key', message: 'Unrecognized key' }]);
    expect(lines()).toEqual(['Options → not_a_key: Unrecognized key']);
    expect(within(nestedGroup('Options')).queryByTestId('schema-form-issue')).toBeNull();
  });

  it('draws `columns.0.field` on the Columns row, with the item trail (no descent into repeater rows)', () => {
    renderForm([{ path: 'columns.0.field', message: 'Unknown field' }]);
    expect(lines()).toEqual(['Columns → #1 → field: Unknown field']);
  });
});

describe('step 3 — a hidden key mounts no row', () => {
  it('draws `fields.title.type` nowhere and the register never names `fields`', () => {
    const reports: string[][] = [];
    renderForm([{ path: 'fields.title.type', message: 'Unknown type' }], {
      hiddenFields: ['fields'],
      onInline: (f) => reports.push(f),
    });
    expect(lines()).toEqual([]);
    expect(reports.at(-1)).not.toContain('fields');
    expect(reports.at(-1)).toContain('options');
  });
});

describe('step 4 — the register names a head only while every issue under it is shown', () => {
  it('in a create form, a handed-down issue shows when its host row does, never later', () => {
    const reports: string[][] = [];
    renderForm([{ path: 'options.dialect', message: 'Unknown dialect' }], {
      createMode: true,
      onInline: (f) => reports.push(f),
    });
    // Untouched: deferred, and `options` is not reported as drawing its issues.
    expect(lines()).toEqual([]);
    expect(reports.at(-1) ?? []).not.toContain('options');
    // Touch the NESTED Source row only: its focusout reaches the host row, which
    // now draws its head — so the handed-down Dialect issue must show too.
    fireEvent.blur(within(nestedGroup('Options')).getByRole('textbox', { name: 'Source' }));
    expect(reports.at(-1)).toContain('options');
    expect(lines()).toEqual(['Unknown dialect']);
  });
});
