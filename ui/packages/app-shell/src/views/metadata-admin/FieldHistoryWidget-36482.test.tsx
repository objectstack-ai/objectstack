// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#36482: the `fieldHistory` rows of the field form, the object
 * form's field repeater and the object's `enable` block were a plain switch.
 * Unset (follow the platform) drew as off, and once toggled the form could not
 * return to unset. The rows now name `field-history`: Default (naming what it
 * resolves to for the row), On, Off; Default removes the key.
 */

// The source under test reaches these through dynamic imports: their first load is paid at collection.
import '@objectstack/formula';
import '@objectstack/lint';
import { describe, it, expect, vi, afterEach, beforeAll } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { fieldForm, objectForm } from '@objectstack/spec/data';
import { WIDGETS, WIDGET_LABELLING } from './widgets';

afterEach(cleanup);

beforeAll(() => {
  // Radix Select reads pointer capture and scrolls the open item into view; jsdom has neither.
  for (const m of ['hasPointerCapture', 'setPointerCapture', 'releasePointerCapture'] as const) {
    if (!(m in Element.prototype)) {
      (Element.prototype as unknown as Record<string, unknown>)[m] = m === 'hasPointerCapture' ? () => false : () => {};
    }
  }
  if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => {};
});

const FieldHistory = WIDGETS['field-history'];

type Row = { field?: string; widget?: string; type?: string; helpText?: string; fields?: unknown[] };

/** Every row of a form, nested composite / repeater sub-rows included, with its parent's field name. */
function rows(form: unknown): Array<{ parent?: string; row: Row }> {
  const out: Array<{ parent?: string; row: Row }> = [];
  const walk = (list: unknown[] | undefined, parent?: string) => {
    for (const f of list ?? []) {
      if (!f || typeof f !== 'object') continue;
      const row = f as Row;
      out.push({ parent, row });
      walk(row.fields, row.field);
    }
  };
  for (const section of (form as { sections?: Array<{ fields?: unknown[] }> }).sections ?? []) walk(section.fields);
  return out;
}

function open() {
  fireEvent.pointerDown(screen.getByTestId('field-history-choice'), { button: 0, ctrlKey: false, pointerType: 'mouse' });
}

describe('the published fieldHistory rows (objectstack#36482)', () => {
  it('the field form, the field repeater and the enable block all name the three-way widget', () => {
    const all = [...rows(fieldForm), ...rows(objectForm)].filter((r) => r.row.field === 'fieldHistory');
    expect(all.map((r) => r.parent ?? '(top)').sort()).toEqual(['(top)', 'enable', 'fields']);
    for (const { row } of all) {
      expect(row.widget).toBe('field-history');
      expect(row.type).toBeUndefined();
      // The two-state caveat is gone with the switch.
      expect(row.helpText).not.toContain('though the switch shows off');
      expect(row.helpText).toContain('Default');
    }
  });

  it('declares control labelling, so the host label names the trigger', () => {
    expect(WIDGET_LABELLING['field-history']).toBe('control');
  });
});

describe('field-history widget (objectstack#36482)', () => {
  it('draws unset as Default, naming what it resolves to for a one-line type', () => {
    render(<FieldHistory value={undefined} onChange={() => {}} schema={{}} formData={{ type: 'text' }} />);
    expect(screen.getByTestId('field-history-choice')).toHaveTextContent('Default (On)');
  });

  it('names Default (Off) for a media, JSON or credential type', () => {
    for (const type of ['image', 'json', 'secret']) {
      render(<FieldHistory value={undefined} onChange={() => {}} schema={{}} formData={{ type }} />);
      expect(screen.getByTestId('field-history-choice'), type).toHaveTextContent('Default (Off)');
      cleanup();
    }
  });

  it("follows the field's trackHistory: true opt-in for a no-line type", () => {
    render(<FieldHistory value={undefined} onChange={() => {}} schema={{}} formData={{ type: 'json', trackHistory: true }} />);
    expect(screen.getByTestId('field-history-choice')).toHaveTextContent('Default (On)');
  });

  it("resolves the object's enable block (no type) to on", () => {
    render(<FieldHistory value={undefined} onChange={() => {}} schema={{}} formData={{ trackHistory: false }} />);
    expect(screen.getByTestId('field-history-choice')).toHaveTextContent('Default (On)');
  });

  it('draws a stored true as On and a stored false as Off, not as Default', () => {
    render(<FieldHistory value={true} onChange={() => {}} schema={{}} formData={{ type: 'text' }} />);
    expect(screen.getByTestId('field-history-choice')).toHaveTextContent(/^On$/);
    cleanup();
    render(<FieldHistory value={false} onChange={() => {}} schema={{}} formData={{ type: 'text' }} />);
    expect(screen.getByTestId('field-history-choice')).toHaveTextContent(/^Off$/);
  });

  it('a stored false goes back to unset: choosing Default removes the key', async () => {
    const onChange = vi.fn();
    render(<FieldHistory value={false} onChange={onChange} schema={{}} formData={{ type: 'text' }} />);
    open();
    fireEvent.click(await screen.findByRole('option', { name: 'Default (On)' }));
    expect(onChange).toHaveBeenLastCalledWith(undefined);
  });

  it('On writes true and Off writes false', async () => {
    const onChange = vi.fn();
    render(<FieldHistory value={undefined} onChange={onChange} schema={{}} formData={{ type: 'json' }} />);
    open();
    fireEvent.click(await screen.findByRole('option', { name: 'On' }));
    expect(onChange).toHaveBeenLastCalledWith(true);
    cleanup();
    render(<FieldHistory value={undefined} onChange={onChange} schema={{}} formData={{ type: 'text' }} />);
    open();
    fireEvent.click(await screen.findByRole('option', { name: 'Off' }));
    expect(onChange).toHaveBeenLastCalledWith(false);
  });

  it('is disabled read-only', () => {
    render(<FieldHistory value={undefined} onChange={() => {}} schema={{}} readOnly formData={{ type: 'text' }} />);
    expect(screen.getByTestId('field-history-choice')).toBeDisabled();
  });
});
