/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack-ai/objectstack#34604 — the form dialog's header carries the
 * record drawer's maximize / restore switch, in both of its arms (the flat
 * form and the `subforms` master-detail form).
 *
 * Maximized, the dialog is `full` (`sm:max-w-[95vw]`) and fills `95dvh`
 * instead of growing to its `90vh` cap; restored, it is what it was. Only the
 * content element's classes change: the same content node, the same inputs,
 * the typed values, the dirty state that arms the close guard and the added
 * lines all survive the switch. The choice is remembered per object.
 *
 * jsdom evaluates no container query, so the column count is read from the
 * grid classes the form renderer draws (the `dialogContainerColumns-34607`
 * reading).
 */

import React from 'react';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { registerAllFields } from '@object-ui/fields';
import { ModalForm } from '../ModalForm';
import { modalFormMaximizedStorageKey } from '../modalMaximize';

registerAllFields();

beforeEach(() => window.localStorage.clear());
afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

const DEAL = {
  name: 'deal',
  fields: {
    name: { type: 'text', label: 'Name' },
    amount: { type: 'number', label: 'Amount' },
  },
};

const ACCOUNT = { name: 'account', fields: { name: { type: 'text', label: 'Name' } } };

function flatDs(defs: Record<string, unknown>): any {
  return {
    getObjectSchema: vi.fn(async (name: string) => defs[name]),
    find: vi.fn().mockResolvedValue({ data: [] }),
    findOne: vi.fn(),
    create: vi.fn().mockResolvedValue({ id: '1' }),
    update: vi.fn(),
  };
}

function renderFlat(objectName: string, extra: Record<string, unknown> = {}) {
  const onOpenChange = vi.fn();
  const utils = render(
    <ModalForm
      schema={{ type: 'object-form', formType: 'modal', objectName, mode: 'create', title: 'New', open: true, onOpenChange, ...extra } as any}
      dataSource={flatDs({ deal: DEAL, account: ACCOUNT })}
    />,
  );
  return { ...utils, onOpenChange };
}

const dialog = () => screen.getByRole('dialog') as HTMLElement;
const maximizeButton = () => screen.getByTestId('modal-form-maximize');

async function nameInput(): Promise<HTMLInputElement> {
  return waitFor(() => {
    const el = document.querySelector('input[name="name"]') as HTMLInputElement | null;
    if (!el) throw new Error('form not ready');
    return el;
  });
}

function expectRestored(el: HTMLElement) {
  expect(el.hasAttribute('data-maximized')).toBe(false);
  expect(el.className).toContain('sm:max-h-[90vh]');
  expect(el.className).toContain('sm:h-auto');
  expect(el.className).not.toContain('sm:max-w-[95vw]');
}

function expectMaximized(el: HTMLElement) {
  expect(el.hasAttribute('data-maximized')).toBe(true);
  expect(el.className).toContain('sm:max-w-[95vw]');
  expect(el.className).toContain('sm:h-[95dvh]');
  expect(el.className).toContain('sm:max-h-[95dvh]');
  expect(el.className).not.toContain('sm:max-h-[90vh]');
  expect(el.className).not.toContain('sm:h-auto');
}

describe('#34604 — the flat arm: maximize, restore, nothing lost', () => {
  it('draws the switch with the drawer label and icon, before the close button, and toggles in place', async () => {
    renderFlat('deal');
    await nameInput();
    const btn = maximizeButton();
    expect(btn.getAttribute('aria-label')).toBe('Maximize');
    expect(btn.querySelector('svg.lucide-maximize2, svg.lucide-maximize-2')).not.toBeNull();
    // Just before the X in document (and tab) order, as the drawer orders them.
    const close = screen.getByRole('button', { name: 'Close' });
    expect(btn.compareDocumentPosition(close) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // The phone sheet already fills the screen: the switch is drawn from `sm` up.
    expect(btn.className).toContain('hidden');
    expect(btn.className).toContain('sm:inline-flex');

    const content = dialog();
    expectRestored(content);
    const restoredWidth = content.className.match(/sm:max-w-\S+/)?.[0];

    fireEvent.click(btn);
    expect(dialog()).toBe(content);
    expectMaximized(content);
    expect(maximizeButton().getAttribute('aria-label')).toBe('Restore size');
    expect(maximizeButton().querySelector('svg.lucide-minimize2, svg.lucide-minimize-2')).not.toBeNull();

    fireEvent.click(maximizeButton());
    expect(dialog()).toBe(content);
    expectRestored(content);
    expect(content.className.match(/sm:max-w-\S+/)?.[0]).toBe(restoredWidth);
  });

  it('keeps the typed value and the same input across two toggles, and the close guard still fires', async () => {
    const { onOpenChange } = renderFlat('deal');
    const input = await nameInput();
    fireEvent.change(input, { target: { value: 'Big deal' } });

    fireEvent.click(maximizeButton());
    expect(await nameInput()).toBe(input);
    expect(input.value).toBe('Big deal');
    fireEvent.click(maximizeButton());
    fireEvent.click(maximizeButton());
    expect(await nameInput()).toBe(input);
    expect(input.value).toBe('Big deal');
    expectMaximized(dialog());

    // Dirty survived: the accidental close (the X) asks first, maximized.
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(screen.getByText('Discard changes?')).toBeTruthy());
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it('draws the switch with the close button hidden too', async () => {
    renderFlat('deal', { modalCloseButton: false });
    await nameInput();
    expect(screen.queryByRole('button', { name: 'Close' })).toBeNull();
    fireEvent.click(maximizeButton());
    expectMaximized(dialog());
  });
});

describe('#34604 — the choice is remembered per object', () => {
  it('reopens maximized for the same object; another object opens at its own size', async () => {
    renderFlat('deal');
    await nameInput();
    fireEvent.click(maximizeButton());
    expect(window.localStorage.getItem(modalFormMaximizedStorageKey('deal'))).toBe('1');
    cleanup();

    renderFlat('deal');
    await nameInput();
    expectMaximized(dialog());
    expect(maximizeButton().getAttribute('aria-label')).toBe('Restore size');
    cleanup();

    renderFlat('account');
    await nameInput();
    expectRestored(dialog());
    expect(window.localStorage.getItem(modalFormMaximizedStorageKey('account'))).toBeNull();
  });

  it('restoring forgets the choice', async () => {
    window.localStorage.setItem(modalFormMaximizedStorageKey('deal'), '1');
    renderFlat('deal');
    await nameInput();
    expectMaximized(dialog());
    fireEvent.click(maximizeButton());
    expectRestored(dialog());
    expect(window.localStorage.getItem(modalFormMaximizedStorageKey('deal'))).toBeNull();
  });

  it('switches to the other object’s choice when a mounted dialog is handed another object', async () => {
    window.localStorage.setItem(modalFormMaximizedStorageKey('deal'), '1');
    const ds = flatDs({ deal: DEAL, account: ACCOUNT });
    const schema = (objectName: string) =>
      ({ type: 'object-form', formType: 'modal', objectName, mode: 'create', title: 'New', open: true }) as any;
    const { rerender } = render(<ModalForm schema={schema('deal')} dataSource={ds} />);
    await nameInput();
    expectMaximized(dialog());
    rerender(<ModalForm schema={schema('account')} dataSource={ds} />);
    expectRestored(dialog());
  });

  it('a blocked store leaves the switch working', async () => {
    const getItem = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    try {
      renderFlat('deal');
      await nameInput();
      expectRestored(dialog());
      fireEvent.click(maximizeButton());
      expectMaximized(dialog());
    } finally {
      getItem.mockRestore();
      setItem.mockRestore();
    }
  });
});

describe('#34604 — the undeclared column count reads the maximized size', () => {
  const PLAIN = Array.from({ length: 16 }, (_, i) => `f${i}`);
  const SIXTEEN = {
    name: 'thing',
    fields: Object.fromEntries(PLAIN.map((n) => [n, { type: 'text', label: `Field ${n}` }])),
  };

  /** Fields per row at `@4xl`: the grid tracks in force over the field's span in force. */
  function perRowAt4xl(name: string): number {
    const cell = document.body.querySelector(`[data-field="${name}"]`);
    if (!cell) throw new Error(`field not rendered: ${name}`);
    const tokens = (el: Element | null) => (el?.getAttribute('class') || '').split(/\s+/);
    const inForce = (list: string[], stem: string) => {
      let v: number | undefined;
      for (const tier of ['@md', '@2xl', '@4xl']) {
        const hit = list.find((c) => c.startsWith(`${tier}:${stem}`));
        if (hit) v = Number(hit.split('-').pop());
      }
      return v;
    };
    return (inForce(tokens(cell.parentElement), 'grid-cols-') ?? 1) / (inForce(tokens(cell), 'col-span-') ?? 1);
  }

  it('sixteen undeclared fields: three per row in the inferred xl, four maximized, three again restored', async () => {
    render(
      <ModalForm
        schema={{ type: 'object-form', formType: 'modal', objectName: 'thing', mode: 'create', fields: PLAIN, open: true } as any}
        dataSource={flatDs({ thing: SIXTEEN })}
      />,
    );
    await waitFor(() => expect(document.body.querySelector('[data-field="f0"]')).not.toBeNull());
    expect(dialog().className).toContain('sm:max-w-5xl');
    expect(perRowAt4xl('f0')).toBe(3);

    const input = document.querySelector('input[name="f0"]') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'kept' } });
    fireEvent.click(maximizeButton());
    expect(dialog().className).toContain('sm:max-w-[95vw]');
    expect(perRowAt4xl('f0')).toBe(4);
    expect((document.querySelector('input[name="f0"]') as HTMLInputElement).value).toBe('kept');

    fireEvent.click(maximizeButton());
    expect(dialog().className).toContain('sm:max-w-5xl');
    expect(perRowAt4xl('f0')).toBe(3);
  });
});

describe('#34604 — the master-detail (subforms) arm', () => {
  const mdDs = (): any => ({
    getObjectSchema: vi.fn(async (name: string) =>
      name === 'quote'
        ? { name: 'quote', fields: { title: { type: 'text', label: 'Title' } } }
        : { name: 'quote_line', fields: { qty: { type: 'number', label: 'Qty' } } },
    ),
    find: vi.fn().mockResolvedValue({ data: [] }),
    batchTransaction: vi.fn().mockResolvedValue({ results: [{ id: 'q1' }] }),
  });
  const subforms = [
    { childObject: 'quote_line', relationshipField: 'quote', title: 'Lines', columns: [{ name: 'qty', label: 'Qty', type: 'number' }] },
  ];

  function renderMd() {
    const onOpenChange = vi.fn();
    render(
      <ModalForm
        schema={{ type: 'object-form', formType: 'modal', objectName: 'quote', mode: 'create', title: 'New quote', open: true, onOpenChange, fields: ['title'], subforms } as any}
        dataSource={mdDs()}
      />,
    );
    return { onOpenChange };
  }

  async function headerInput(): Promise<HTMLInputElement> {
    await waitFor(() => expect(screen.getByTestId('md-form-submit')).toBeTruthy());
    return waitFor(() => {
      const el = document.querySelector('input[name="title"]') as HTMLInputElement | null;
      if (!el) throw new Error('header form not ready');
      return el;
    });
  }

  const qtyInputs = () => screen.queryAllByLabelText('Qty') as HTMLInputElement[];
  /** The same input ELEMENTS, in order — identity, not structural equality. */
  const expectSameLines = (lines: HTMLInputElement[]) => {
    const now = qtyInputs();
    expect(now.length).toBe(lines.length);
    now.forEach((el, i) => expect(el).toBe(lines[i]));
  };

  it('draws the switch and toggles the same content node in place', async () => {
    renderMd();
    await headerInput();
    const content = dialog();
    expect(maximizeButton().getAttribute('aria-label')).toBe('Maximize');
    expectRestored(content);
    fireEvent.click(maximizeButton());
    expect(dialog()).toBe(content);
    expectMaximized(content);
    expect(screen.getByTestId('md-form-submit')).toBeTruthy();
    fireEvent.click(maximizeButton());
    expectRestored(content);
  });

  it('keeps the header value and an added line across two toggles; the close guard still fires', async () => {
    const { onOpenChange } = renderMd();
    const title = await headerInput();
    fireEvent.change(title, { target: { value: 'Q-1' } });
    // The grid is drawn: its Add button (the grid draws no trailing entry row, objectstack#35507).
    await waitFor(() => expect(screen.getByTestId('line-items-add')).toBeTruthy());
    const before = qtyInputs().length;
    fireEvent.click(screen.getByRole('button', { name: /add/i }));
    await waitFor(() => expect(qtyInputs().length).toBe(before + 1));
    // Type into the first line, so the grid's own trailing-row behaviour on
    // its last line stays out of the count.
    const lines = qtyInputs();
    const line = lines[0];
    fireEvent.change(line, { target: { value: '7' } });
    expectSameLines(lines);

    fireEvent.click(maximizeButton());
    fireEvent.click(maximizeButton());
    fireEvent.click(maximizeButton());
    expectMaximized(dialog());
    // The same line inputs, element for element: nothing below remounted.
    expectSameLines(lines);
    expect(line.value).toBe('7');
    expect(await headerInput()).toBe(title);
    expect(title.value).toBe('Q-1');
    expect(screen.getByTestId('md-form-submit')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(screen.getByText('Discard changes?')).toBeTruthy());
    expect(onOpenChange).not.toHaveBeenCalled();
  });
});

describe('#34604 — beside the section nav strip of a sectioned flat form', () => {
  const SECTIONED = {
    name: 'deal',
    fields: {
      name: { type: 'text', label: 'Name' },
      amount: { type: 'number', label: 'Amount' },
    },
  };
  const sections = [
    { name: 'basics', label: 'Basics', fields: ['name'] },
    { name: 'money', label: 'Money', fields: ['amount'] },
  ];

  it('keeps the nav strip, the same node, across two toggles; the header hands its rule to the strip', async () => {
    render(
      <ModalForm
        schema={{ type: 'object-form', formType: 'modal', objectName: 'deal', mode: 'create', title: 'New', open: true, sections } as any}
        dataSource={flatDs({ deal: SECTIONED })}
      />,
    );
    await nameInput();
    const nav = await waitFor(() => screen.getByTestId('form-section-nav'));
    const header = screen.getByText('New').parentElement as HTMLElement;
    expect(header.className).toContain('sm:pr-20');
    expect(header.className.split(/\s+/)).not.toContain('border-b');

    fireEvent.click(maximizeButton());
    expectMaximized(dialog());
    expect(screen.getByTestId('form-section-nav')).toBe(nav);
    fireEvent.click(maximizeButton());
    expectRestored(dialog());
    expect(screen.getByTestId('form-section-nav')).toBe(nav);
  });
});
