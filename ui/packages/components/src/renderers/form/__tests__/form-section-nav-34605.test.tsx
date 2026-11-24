/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#34605 — the form renderer's half of the section navigation: the
 * section list it reports to a host through `FormSectionNavContext`.
 *
 * Pinned: each drawn heading row carries a stable DOM id and is reported with
 * it, in order; a heading its predicate hides is not reported; a headingless
 * section is not reported and its fields count for no heading; a refused
 * submit counts each section's errored fields; a tabbed form and a form
 * nested in another report nothing; unmounting reports `null`.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import { ComponentRegistry } from '@object-ui/core';
// Module-scope import (not `beforeAll`) — objectui#3010/#3021.
import '../../../renderers';
// The renderers reach `react-runtime` through a dynamic import: pay its load at collection.
import '@object-ui/react-runtime';
import { FormSectionNavContext, type FormSectionNavItem } from '../section-nav-context';

afterEach(cleanup);

const cel = (source: string) => ({ dialect: 'cel', source });

const divider = (name: string, label: string | undefined, fields: string[], extra: Record<string, unknown> = {}) => ({
  name,
  type: 'section-divider',
  label,
  fields,
  ...extra,
});

const SECTIONED = [
  divider('s_overview', 'Overview', ['name']),
  { name: 'name', label: 'Name', type: 'input' },
  divider('s_forecast', 'Forecast', ['forecast', 'quarter']),
  { name: 'forecast', label: 'Forecast Category', type: 'input', required: true },
  { name: 'quarter', label: 'Quarter', type: 'input', required: true },
  divider('s_hidden', 'Won Details', ['won_note'], { visibleWhen: cel("record.name == 'won'") }),
  { name: 'won_note', label: 'Won Note', type: 'input' },
  divider('s_untitled', undefined, ['loose']),
  { name: 'loose', label: 'Loose', type: 'input', required: true },
];

function renderWithSink(schema: Record<string, unknown>) {
  const reports: Array<FormSectionNavItem[] | null> = [];
  const sink = vi.fn((items: FormSectionNavItem[] | null) => {
    reports.push(items);
  });
  const Form = ComponentRegistry.get('form')!;
  const utils = render(
    <FormSectionNavContext.Provider value={sink}>
      <Form schema={{ type: 'form', showCancel: false, ...schema }} />
    </FormSectionNavContext.Provider>,
  );
  return { ...utils, reports, sink, last: () => reports[reports.length - 1] };
}

describe('form section list for the host navigation (objectstack#34605)', () => {
  it('stops at a labelled host slot between the headings around it, and skips an unlabelled one (objectstack#35889)', async () => {
    const { last } = renderWithSink({
      fields: [
        divider('s_header', 'Header', ['name']),
        { name: 'name', label: 'Name', type: 'input' },
        { name: '__form_slot__d0', label: 'Lines', type: 'form-slot' },
        { name: '__form_slot__d1', label: '', type: 'form-slot' },
        divider('s_totals', 'Totals', ['memo']),
        { name: 'memo', label: 'Memo', type: 'input' },
      ],
    });
    await waitFor(() => expect(last()).toBeTruthy());
    const items = last()!;
    expect(items.map((i) => [i.key, i.label])).toEqual([
      ['s_header', 'Header'],
      ['__form_slot__d0', 'Lines'],
      ['s_totals', 'Totals'],
    ]);
    expect(document.getElementById(items[1].anchorId)?.getAttribute('data-form-slot')).toBe('__form_slot__d0');
  });

  it('reports the drawn headings in order, each with the DOM id of its row', async () => {
    const { last } = renderWithSink({ fields: SECTIONED });
    await waitFor(() => expect(last()).toBeTruthy());

    const items = last()!;
    expect(items.map((i) => [i.key, i.label])).toEqual([
      ['s_overview', 'Overview'],
      ['s_forecast', 'Forecast'],
    ]);
    for (const item of items) {
      const row = document.getElementById(item.anchorId);
      expect(row).not.toBeNull();
      expect(row!.getAttribute('data-form-section')).toBe(item.key);
      expect(row!.textContent).toBe(item.label);
      expect(item.errorCount).toBe(0);
      expect(item.collapsed).toBe(false);
    }
  });

  it('adds a heading when its predicate admits it, by the verdict that draws the row', async () => {
    const { last } = renderWithSink({ fields: SECTIONED });
    await waitFor(() => expect(last()).toBeTruthy());
    fireEvent.change(document.querySelector('input[name="name"]')!, { target: { value: 'won' } });
    await waitFor(() => expect(last()!.map((i) => i.key)).toEqual(['s_overview', 's_forecast', 's_hidden']));
  });

  it('counts the errored fields of each section after a refused submit, and none for a headingless run', async () => {
    const { last } = renderWithSink({ fields: SECTIONED });
    await waitFor(() => expect(last()).toBeTruthy());

    fireEvent.submit(document.querySelector('form')!);

    await waitFor(() => expect(last()!.find((i) => i.key === 's_forecast')!.errorCount).toBe(2));
    expect(last()!.find((i) => i.key === 's_overview')!.errorCount).toBe(0);
    // `loose` holds an error too, but sits under no heading: no entry claims it.
    expect(last()!.reduce((n, i) => n + i.errorCount, 0)).toBe(2);

    fireEvent.change(document.querySelector('input[name="forecast"]')!, { target: { value: 'Commit' } });
    await waitFor(() => expect(last()!.find((i) => i.key === 's_forecast')!.errorCount).toBe(1));
  });

  it('reports a collapsed section, and its expand unfolds it through the row toggle', async () => {
    const onToggle = vi.fn();
    const { last } = renderWithSink({
      fields: [
        divider('s_a', 'A', ['a']),
        { name: 'a', label: 'A field', type: 'input' },
        divider('s_b', 'B', ['b'], { collapsible: true, collapsed: true, onToggle }),
        { name: 'b', label: 'B field', type: 'input', hidden: true },
      ],
    });
    await waitFor(() => expect(last()).toBeTruthy());
    const b = last()!.find((i) => i.key === 's_b')!;
    expect(b.collapsed).toBe(true);
    b.expand();
    expect(onToggle).toHaveBeenCalledTimes(1);
    last()!.find((i) => i.key === 's_a')!.expand();
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it('reports nothing for a tabbed form', async () => {
    const { reports } = renderWithSink({
      fields: [
        { name: 'a', label: 'A', type: 'input' },
        { name: 'b', label: 'B', type: 'input' },
      ],
      fieldTabs: [
        { key: 't1', label: 'One', fields: ['a'] },
        { key: 't2', label: 'Two', fields: ['b'] },
      ],
    });
    await waitFor(() => expect(document.querySelector('[data-testid="form-tab:t1"]')).not.toBeNull());
    expect(reports.every((r) => r === null)).toBe(true);
  });

  it('keeps a form nested in another out of the host sink', async () => {
    const { reports } = renderWithSink({
      children: [{ type: 'form', showSubmit: false, showCancel: false, fields: SECTIONED }],
    });
    await waitFor(() => expect(document.querySelectorAll('form').length).toBe(2));
    expect(document.querySelector('[data-form-section="s_forecast"]')).not.toBeNull();
    expect(reports.every((r) => r === null)).toBe(true);
  });

  it('reports null when the form unmounts', async () => {
    const { last, unmount } = renderWithSink({ fields: SECTIONED });
    await waitFor(() => expect(last()).toBeTruthy());
    unmount();
    expect(last()).toBeNull();
  });
});
