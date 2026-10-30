// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#27837 — the formula editor's three authoring aids, on the shared
 * CEL editor:
 *
 *  1. a CEL syntax fault (`invalid-cel`, the real engine's verdict) leads with
 *     a plain sentence, and the engine's fault with its source excerpt follows
 *     as written, in monospace; a refusal with its own prescription keeps its
 *     message, and the producer's `message` is unchanged for every caller;
 *  2. "Insert field" lists the fields by label and inserts the CEL reference
 *     at the caret — `record.<name>` in `record` scope, the bare name otherwise;
 *  3. a finding that appears while the author types is scrolled into view.
 */

import * as React from 'react';
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CelPredicateField } from './CelPredicateField';
import { lintCelPredicate, __setCelFormulaLoader } from './celAuthoring';

// jsdom draws no layout and has no `scrollIntoView`; the scroll tests stub it
// on the prototype and this puts back whatever was there.
const ORIGINAL_SCROLL = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollIntoView');
function stubScrollIntoView() {
  const spy = vi.fn();
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { value: spy, configurable: true, writable: true });
  return spy;
}

afterEach(() => {
  cleanup();
  __setCelFormulaLoader(undefined);
  if (ORIGINAL_SCROLL) Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', ORIGINAL_SCROLL);
  else delete (HTMLElement.prototype as { scrollIntoView?: unknown }).scrollIntoView;
});

const t = (k: string) => k;

const FIELDS = [
  { name: 'estimated_hours', label: 'Estimated Hours' },
  { name: 'hourly_rate', label: 'Hourly Rate' },
];

function Formula({ initial = '', ...rest }: { initial?: string } & Record<string, unknown>) {
  const [v, setV] = React.useState(initial);
  return (
    <>
      <CelPredicateField
        id="f"
        value={v}
        onChange={setV}
        label="Formula"
        objectName="project_task"
        fieldNames={FIELDS.map((f) => f.name)}
        fieldOptions={FIELDS}
        scope="record"
        roots={['record']}
        role="value"
        t={t}
        {...rest}
      />
      <output data-testid="value">{v}</output>
    </>
  );
}

describe('a CEL syntax fault reads in plain words, with where it is (objectstack#27837)', () => {
  it('the lint keeps the producer message and adds the plain key and the engine detail', async () => {
    const issues = await lintCelPredicate('record.estimated_hours *', {
      fields: ['estimated_hours'],
      scope: 'record',
      role: 'value',
    });
    const err = issues.find((i) => i.severity === 'error');
    expect(err?.plain?.key).toBe('engine.celLint.invalidCel');
    // The detail is the engine's, with its source excerpt; the message is the
    // producer's whole sentence, which still carries that detail.
    expect(err?.plain?.detail).toContain('record.estimated_hours *');
    expect(err?.message).toContain(err!.plain!.detail);
  });

  it('a refusal that carries its own prescription keeps its message and gets no plain lead', async () => {
    const issues = await lintCelPredicate('record.estimated_hour * 2', {
      fields: ['estimated_hours'],
      scope: 'record',
      role: 'value',
    });
    const err = issues.find((i) => i.severity === 'error');
    expect(err?.message).toContain('estimated_hours');
    expect(err?.plain).toBeUndefined();
  });

  it('only a code the table names is led: an inherited property name is not one', async () => {
    __setCelFormulaLoader(async () => ({
      validateExpression: () => ({
        ok: false,
        errors: [{ message: 'm', code: 'constructor', params: { detail: 'd' } }],
        warnings: [],
      }),
    }));
    const [err] = await lintCelPredicate('x', { scope: 'record', role: 'value' });
    expect(err).toEqual({ severity: 'error', message: 'm' });
  });

  it('the editor shows the plain sentence, then the engine excerpt in monospace', async () => {
    render(<Formula initial="record.estimated_hours *" />);
    const plain = await screen.findByTestId('cel-plain-error');
    expect(plain.textContent).toContain('engine.celLint.invalidCel');
    const excerpt = plain.querySelector('pre');
    expect(excerpt?.textContent).toContain('record.estimated_hours *');
    expect(excerpt?.textContent).toContain('^');
    // The technical lead-in of the producer sentence is not what the author reads first.
    expect(plain.textContent?.startsWith('engine.celLint.invalidCel')).toBe(true);
  });
});

describe('Insert field: by label, inserting the CEL name (objectstack#27837)', () => {
  it('lists the fields by label and inserts record.<name> at the caret', async () => {
    const user = userEvent.setup();
    render(<Formula initial=" * 2" />);
    const ta = screen.getByRole('combobox', { name: 'Formula' }) as HTMLTextAreaElement;
    ta.focus();
    ta.setSelectionRange(0, 0);
    await user.click(screen.getByTestId('cel-insert-field'));
    const option = await screen.findByRole('option', { name: /Estimated Hours/ });
    expect(option.textContent).toContain('estimated_hours');
    await user.click(option);
    expect(screen.getByTestId('value').textContent).toBe('record.estimated_hours * 2');
    await waitFor(() => expect(document.activeElement).toBe(ta));
    expect(ta.selectionStart).toBe('record.estimated_hours'.length);
  });

  it('replaces the selected text, and the search matches the label', async () => {
    const user = userEvent.setup();
    render(<Formula initial="record.x * 2" />);
    const ta = screen.getByRole('combobox', { name: 'Formula' }) as HTMLTextAreaElement;
    ta.focus();
    ta.setSelectionRange(0, 'record.x'.length);
    await user.click(screen.getByTestId('cel-insert-field'));
    await user.type(await screen.findByPlaceholderText('perm.cel.searchFields'), 'rate');
    expect(screen.queryByRole('option', { name: /Estimated Hours/ })).toBeNull();
    await user.click(screen.getByRole('option', { name: /Hourly Rate/ }));
    expect(screen.getByTestId('value').textContent).toBe('record.hourly_rate * 2');
  });

  it('in flattened scope the bare name goes in', async () => {
    const user = userEvent.setup();
    render(<Formula scope="flattened" role="predicate" />);
    await user.click(screen.getByTestId('cel-insert-field'));
    await user.click(await screen.findByRole('option', { name: /Hourly Rate/ }));
    expect(screen.getByTestId('value').textContent).toBe('hourly_rate');
  });

  it('no picker without fieldOptions, and none while read-only', () => {
    const { rerender } = render(<Formula fieldOptions={undefined} />);
    expect(screen.queryByTestId('cel-insert-field')).toBeNull();
    rerender(<Formula disabled />);
    expect(screen.queryByTestId('cel-insert-field')).toBeNull();
  });
});

describe('a new finding is brought into view while typing (objectstack#27837)', () => {
  it('scrolls the findings into view once they appear under a focused editor', async () => {
    const spy = stubScrollIntoView();
    render(<Formula />);
    const ta = screen.getByRole('combobox', { name: 'Formula' });
    ta.focus();
    fireEvent.change(ta, { target: { value: 'record.estimated_hours *' } });
    await screen.findByTestId('cel-plain-error');
    await waitFor(() => expect(spy).toHaveBeenCalledWith({ block: 'nearest' }));
  });

  it('does not scroll for a finding read on mount (the editor not focused)', async () => {
    const spy = stubScrollIntoView();
    render(<Formula initial="record.estimated_hours *" />);
    await screen.findByTestId('cel-plain-error');
    expect(spy).not.toHaveBeenCalled();
  });
});
