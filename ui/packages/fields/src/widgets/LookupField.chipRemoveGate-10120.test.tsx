// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * A non-interactive lookup offers no way to clear its value (objectui#10120).
 *
 * ## What was measured
 *
 * `readonly` has always returned a display-only rendering, so it was never the
 * gap. `disabled` was: it disabled the picker trigger and the "Browse all
 * records" button and left the selected chip's ✕ fully live — one widget,
 * two opposite answers to "may this user change this value?", with the live
 * one being the only control that could actually change it. Measured on the
 * card's form: trigger `disabled=true`, browse `disabled=true`, chip remove
 * `disabled=false`.
 *
 * ## Why `disabled` is the case that matters here
 *
 * It is how BOTH of this card's refusals arrive at the widget. A field the
 * object declares `readonly` is folded into `disabled` by the form's section
 * builder, and a field the caller's permission set marks `editable: false` is
 * marked `readOnly` AND `disabled` by the form's field-permission pass. So the
 * reporter in the card could clear the master-detail parent 「所属填报单」 on a
 * sheet line — a write the server then refuses. ⭐ A refusal the UI invites is
 * worse than a refusal it prevents.
 *
 * The chips themselves stay: the value is readable, and hiding it would lose
 * information the user is entitled to. Only the affordance goes.
 */

import * as React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, waitFor, screen } from '@testing-library/react';
import { LookupField } from './LookupField';

afterEach(cleanup);

const SHEETS = [
  { id: 'SHEET1', name: 'Sheet One' },
  { id: 'SHEET2', name: 'Sheet Two' },
];

const makeDataSource = () => ({
  find: vi.fn(async (_obj: string, params: any) => {
    const wanted: any[] = params?.$filter?.id?.$in ?? [];
    return { data: wanted.length ? SHEETS.filter((s) => wanted.includes(s.id)) : SHEETS };
  }),
});

const removeButtons = (root: HTMLElement) =>
  Array.from(root.querySelectorAll('button[aria-label]'))
    .filter((b) => /^Remove /.test(b.getAttribute('aria-label') || ''));

describe('LookupField — the chip remove control follows the field\'s interactivity (objectui#10120)', () => {
  it('offers no remove control when the field is disabled, while still showing the value', async () => {
    const onChange = vi.fn();
    const { container } = render(
      <LookupField
        value={'SHEET1'}
        onChange={onChange}
        disabled
        dataSource={makeDataSource() as never}
        field={{ reference: 'kpi_entry_sheet', label: 'Sheet' } as never}
      />,
    );
    // The value is still READ — a disabled field is not a hidden one.
    await waitFor(() => expect(screen.getByText('Sheet One')).toBeTruthy());
    expect(removeButtons(container)).toHaveLength(0);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('offers no remove control on a disabled MULTI-value lookup either — one per chip is one per refusal', async () => {
    const { container } = render(
      <LookupField
        value={['SHEET1', 'SHEET2']}
        onChange={() => {}}
        disabled
        dataSource={makeDataSource() as never}
        field={{ reference: 'kpi_entry_sheet', label: 'Sheet', multiple: true } as never}
      />,
    );
    await waitFor(() => expect(screen.getByText('Sheet One')).toBeTruthy());
    expect(screen.getByText('Sheet Two')).toBeTruthy();
    expect(removeButtons(container)).toHaveLength(0);
  });

  it('CONTROL — an editable lookup keeps its remove control, one per selected chip', async () => {
    const { container } = render(
      <LookupField
        value={['SHEET1', 'SHEET2']}
        onChange={() => {}}
        dataSource={makeDataSource() as never}
        field={{ reference: 'kpi_entry_sheet', label: 'Sheet', multiple: true } as never}
      />,
    );
    await waitFor(() => expect(screen.getByText('Sheet One')).toBeTruthy());
    // Without this row the two assertions above would pass on a widget that had
    // stopped rendering chips at all.
    expect(removeButtons(container)).toHaveLength(2);
  });

  it('CONTROL — `readonly` was already display-only and is unchanged by this card', async () => {
    const { container } = render(
      <LookupField
        value={'SHEET1'}
        onChange={() => {}}
        readonly
        dataSource={makeDataSource() as never}
        field={{ reference: 'kpi_entry_sheet', label: 'Sheet' } as never}
      />,
    );
    await waitFor(() => expect(screen.getByText('Sheet One')).toBeTruthy());
    expect(container.querySelectorAll('button')).toHaveLength(0);
  });
});
