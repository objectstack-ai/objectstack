/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * BulkActionDialog param widgets.
 *
 * #2185/#2204 pinned the multi-value path (empty-array required-gating → pick
 * many → array patch → label preview) and the date widget. Since the ADR-0059
 * migration (#3064) params render through the SHARED form field widgets
 * (`@object-ui/fields` via `bulkParamToField`), so these tests now assert the
 * form-widget DOM (multiselect toggle chips, the platform date picker) — and the new
 * lookup suite pins the #3064 contract itself: no eager candidate prefetch,
 * fetch errors surfaced with a Retry affordance, and no failure caching
 * (reopening the picker refetches).
 *
 * objectui#3967 added the a11y suite at the bottom: the required STATE reaches
 * the control and the visual-only `*` stays out of its accessible name.
 */
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';

import { BulkActionDialog } from '../components/BulkActionDialog';

beforeAll(() => {
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = vi.fn() as any;
  }
  // Radix Popover/cmdk probe pointer capture APIs that jsdom lacks.
  if (!(Element.prototype as any).hasPointerCapture) {
    (Element.prototype as any).hasPointerCapture = () => false;
  }
  if (!(Element.prototype as any).setPointerCapture) {
    (Element.prototype as any).setPointerCapture = () => {};
  }
});

beforeEach(() => {
  // happy-dom lacks matchMedia; the lookup widgets' useIsMobile needs it.
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as any;
});

function makeDataSource() {
  const update = vi.fn(async () => ({}));
  const del = vi.fn(async () => ({}));
  return { update, delete: del } as any;
}

describe('BulkActionDialog — multi-select param produces an array patch', () => {
  it('gates required until a value is picked, sends an array, and previews labels', async () => {
    const ds = makeDataSource();
    const def: any = {
      name: 'set_tags',
      label: 'Set tags',
      operation: 'update',
      params: [
        {
          name: 'tags',
          label: 'Tags',
          type: 'select',
          multiple: true,
          required: true,
          options: [
            { label: 'Red', value: 'red' },
            { label: 'Blue', value: 'blue' },
          ],
        },
      ],
    };
    render(
      <BulkActionDialog
        def={def}
        rows={[{ id: 'r1' }, { id: 'r2' }]}
        resource="thing"
        dataSource={ds}
        open
        onClose={() => {}}
      />,
    );

    // Required multi-select with no selection → Next is disabled (empty array
    // must count as "not filled").
    const next = screen.getByRole('button', { name: 'Next' });
    expect(next).toBeDisabled();

    // The shared MultiSelectField renders toggle chips (same as the form) —
    // await them through the lazy-widget Suspense boundary, then pick both.
    fireEvent.click(await screen.findByTestId('multiselect-option-red'));
    fireEvent.click(await screen.findByTestId('multiselect-option-blue'));

    // Now valid → advance to confirm.
    await waitFor(() => expect(next).toBeEnabled());
    fireEvent.click(next);

    // Confirm step shows the human labels (not the raw ids) for the array value.
    const confirmRun = await screen.findByRole('button', { name: 'Run' });
    expect(screen.getByText(/Red, Blue/)).toBeInTheDocument();

    fireEvent.click(confirmRun);

    // Per-row update fires with the multi-value array intact.
    await waitFor(() => expect(ds.update).toHaveBeenCalledTimes(2));
    expect(ds.update).toHaveBeenCalledWith('thing', 'r1', { tags: ['red', 'blue'] });
    expect(ds.update).toHaveBeenCalledWith('thing', 'r2', { tags: ['red', 'blue'] });
  });
});

// objectui#12642: a `date` / `datetime` param draws the platform date picker
// the record form draws (one face per field type), not the browser's native
// input, whose placeholder and digit order are the machine's. The patch each
// row receives is unchanged: `YYYY-MM-DD` for `date`, an ISO instant for
// `datetime`.
describe('BulkActionDialog — date params render the platform date picker', () => {
  async function runWith(param: Record<string, unknown>, typed: string) {
    const ds = makeDataSource();
    const def: any = { name: 'set_it', label: 'Set it', operation: 'update', params: [param] };
    render(
      <BulkActionDialog
        def={def}
        rows={[{ id: 'r1' }]}
        resource="thing"
        dataSource={ds}
        open
        onClose={() => {}}
      />,
    );
    // Radix Dialog portals to document.body, and the widget loads lazily.
    const input = await waitFor(() => {
      const el = document.querySelector('[data-slot="date-picker"] input');
      if (!el) throw new Error('date picker not rendered');
      return el as HTMLInputElement;
    });
    expect(input.type).toBe('text');
    expect(input.placeholder).toMatch(/^MM\/DD\/YYYY/);
    expect(document.querySelector('input[type="date"], input[type="datetime-local"]')).toBeNull();
    fireEvent.change(input, { target: { value: typed } });
    fireEvent.blur(input);
    const next = screen.getByRole('button', { name: 'Next' });
    await waitFor(() => expect(next).toBeEnabled());
    fireEvent.click(next);
    fireEvent.click(await screen.findByRole('button', { name: 'Run' }));
    await waitFor(() => expect(ds.update).toHaveBeenCalledTimes(1));
    return ds.update.mock.calls[0];
  }

  it('a `date` param writes the YYYY-MM-DD day', async () => {
    const call = await runWith({ name: 'due', label: 'Due', type: 'date', required: true }, '10/20/2026');
    expect(call).toEqual(['thing', 'r1', { due: '2026-10-20' }]);
  });

  it('a `datetime` param writes the ISO instant of the typed local wall clock', async () => {
    const call = await runWith({ name: 'at', label: 'At', type: 'datetime', required: true }, '10/20/2026 14:30');
    expect(call).toEqual(['thing', 'r1', { at: new Date(2026, 9, 20, 14, 30).toISOString() }]);
  });
});

describe('BulkActionDialog — lookup param uses the shared record picker (#3064)', () => {
  const lookupDef: any = {
    name: 'assign_queue',
    label: 'Assign queue',
    operation: 'update',
    params: [
      { name: 'queue', label: 'Queue', type: 'lookup', object: 'queues', required: true },
    ],
  };

  it('does not prefetch candidates when the dialog opens', async () => {
    const ds = makeDataSource();
    ds.find = vi.fn(async () => ({ data: [], total: 0 }));
    render(
      <BulkActionDialog
        def={lookupDef}
        rows={[{ id: 'r1' }]}
        resource="thing"
        dataSource={ds}
        open
        onClose={() => {}}
      />,
    );
    // The picker trigger renders (lazy widget) with no candidate query issued —
    // the old dialog fired find(object, {$top: 200}) on open.
    await screen.findByTestId('lookup-trigger-queue');
    expect(ds.find).not.toHaveBeenCalled();
  });

  it('surfaces a failed candidate fetch and retries instead of caching the failure', async () => {
    const ds = makeDataSource();
    ds.find = vi
      .fn()
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValue({ data: [{ id: 'q1', name: 'Support queue' }], total: 1 });
    render(
      <BulkActionDialog
        def={lookupDef}
        rows={[{ id: 'r1' }]}
        resource="thing"
        dataSource={ds}
        open
        onClose={() => {}}
      />,
    );

    // Open the picker → the fetch fails → an error state with a Retry
    // affordance renders (previously: a permanent "Loading…" placeholder).
    fireEvent.click(await screen.findByTestId('lookup-trigger-queue'));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('boom');
    expect(ds.find).toHaveBeenCalledTimes(1);

    // Retry refetches (previously: the failure was cached per param name and
    // no further request was ever issued) and the candidates render.
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await screen.findByText('Support queue');
    expect(ds.find).toHaveBeenCalledTimes(2);
  });
});

/**
 * Required params announce STATE, not the decoration (objectui#3967).
 *
 * `ParamField` renders one row per param through a SINGLE code path (unlike
 * app-shell's `ActionParamDialog`, which forks a boolean branch), so both
 * defects landed on every param type at once:
 *
 * 1. The visible `*` sat inside `<Label htmlFor={id}>` with no `aria-hidden`.
 *    Accname §2D folds a referencing label's text into the control's name, so
 *    a required bulk param announced as "Notify owner asterisk" — a decorative
 *    glyph read aloud as if it were part of the label.
 * 2. `aria-required` was never passed. `param.required` IS live — the dialog's
 *    own pre-submit gate reads it to disable Next — but nothing carried the
 *    state to the control, and no widget derives it from `field.required`
 *    (`toDomProps` forwards `aria-*` by prefix; it invents nothing). So the
 *    only channel that could announce "required" was empty while the only
 *    thing present was the glyph now hidden.
 *
 * Both halves have to be pinned together, because either one alone is
 * satisfiable the wrong way: hiding the `*` without `aria-required` announces
 * NOTHING about requiredness, and `aria-required` without hiding the `*`
 * announces it twice, once as noise. The visible-marker assertions exist for
 * the same reason — deleting the `*` outright would also produce a clean name.
 */
describe('BulkActionDialog — required params announce state, not the asterisk (objectui#3967)', () => {
  function renderParams(params: any[]) {
    const ds = makeDataSource();
    const def: any = { name: 'set_it', label: 'Set it', operation: 'update', params };
    render(
      <BulkActionDialog
        def={def}
        rows={[{ id: 'r1' }]}
        resource="thing"
        dataSource={ds}
        open
        onClose={() => {}}
      />,
    );
    return ds;
  }

  /**
   * Query by the host-owned id rather than by role or label text: the id is
   * what `<Label htmlFor>` names, it is stable across widget types (switch,
   * textbox, …), and — unlike `*ByLabelText`, which matches on the label's raw
   * `textContent` — it does not quietly depend on the very `aria-hidden` these
   * tests are asserting.
   */
  async function control(paramName: string): Promise<HTMLElement> {
    return await waitFor(() => {
      const el = document.getElementById(`bulk-param-${paramName}`);
      expect(el).not.toBeNull();
      return el as HTMLElement;
    });
  }

  function labelFor(paramName: string): HTMLLabelElement {
    const el = document.querySelector(`label[for="bulk-param-${paramName}"]`);
    expect(el).not.toBeNull();
    return el as HTMLLabelElement;
  }

  it('gives a required boolean param aria-required and an asterisk-free name', async () => {
    renderParams([{ name: 'notify', label: 'Notify owner', type: 'boolean', required: true }]);

    const el = await control('notify');
    // The state channel of #3299/#3290 — deliberately not the native
    // `required` attribute, which would arm a second validator (#3290).
    expect(el).toHaveAttribute('aria-required', 'true');
    expect(el).not.toHaveAttribute('required');
    // The name is exactly what the author declared: no trailing glyph.
    expect(el).toHaveAccessibleName('Notify owner');

    // …and the marker is still SHOWN, just excluded from the name.
    const label = labelFor('notify');
    expect(label.textContent).toContain('*');
    expect(label.querySelector('[aria-hidden="true"]')?.textContent).toBe('*');
  });

  it('leaves an optional boolean param with no aria-required attribute at all', async () => {
    renderParams([{ name: 'notify', label: 'Notify owner', type: 'boolean' }]);

    const el = await control('notify');
    // Absent, not `aria-required="false"` — an optional control should not
    // appear in the a11y tree as one whose requiredness was considered.
    expect(el).not.toHaveAttribute('aria-required');
    expect(el).toHaveAccessibleName('Notify owner');
    expect(labelFor('notify').textContent).not.toContain('*');
  });

  it('applies the same shape to a non-boolean param — one ParamField path, not a per-type one', async () => {
    // The unchanged-direction half: `ParamField` has no type branches, so a
    // text param must come out with the identical treatment. A future refactor
    // that forks a boolean-only branch (as app-shell's dialog has) and fixes
    // only that fork fails here.
    renderParams([
      { name: 'note', label: 'Note', type: 'text', required: true },
      { name: 'memo', label: 'Memo', type: 'text' },
    ]);

    const required = await control('note');
    expect(required).toHaveAttribute('aria-required', 'true');
    expect(required).toHaveAccessibleName('Note');
    expect(labelFor('note').querySelector('[aria-hidden="true"]')?.textContent).toBe('*');

    const optional = await control('memo');
    expect(optional).not.toHaveAttribute('aria-required');
    expect(optional).toHaveAccessibleName('Memo');
  });
});
