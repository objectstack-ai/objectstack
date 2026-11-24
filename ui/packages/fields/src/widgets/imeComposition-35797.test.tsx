/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * A key the input method owns does only what the input method does with it
 * (objectstack#35797): `TagsField`, and the search boxes of `LookupField` and
 * `PeoplePicker`, read Enter (and the tag field the comma) themselves, and a
 * pinyin user's Enter that picks a word used to add the half-typed draft as a
 * tag or pick the highlighted entry.
 *
 * Every widget is driven through the two sequences browsers really send:
 *
 *  - Chromium / Firefox: `compositionstart`, the candidate-picking keydown
 *    with `isComposing: true` and keyCode 229, `compositionend`.
 *  - Safari: `compositionstart`, `compositionend`, THEN the candidate-picking
 *    keydown, with `isComposing` already false and keyCode 229.
 *
 * and each case ends with the control: the next Enter (keyCode 13, no
 * composition) does what the widget always did, so a guard that swallowed
 * every Enter would go red here too.
 */

import * as React from 'react';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup, waitFor, act, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';

import { isImeKey } from './imeKey';
import { TagsField } from './TagsField';
import { LookupField } from './LookupField';
import { PeoplePicker } from './PeoplePicker';

/** The keydown that picks a candidate while the composition is open. */
const COMPOSING_ENTER = { key: 'Enter', code: 'Enter', keyCode: 229, which: 229, isComposing: true } as const;
/** Safari's candidate-picking Enter, raised after `compositionend`. */
const SAFARI_POST_COMPOSITION_ENTER = { key: 'Enter', code: 'Enter', keyCode: 229, which: 229, isComposing: false } as const;
/** An Enter the input method does not own. */
const PLAIN_ENTER = { key: 'Enter', code: 'Enter', keyCode: 13, which: 13 } as const;

type Composer = (el: HTMLElement, text?: string, onType?: (el: HTMLElement, text: string) => void) => void;

/** Chromium / Firefox: the picking keydown arrives inside the composition. */
const composeChromium: Composer = (el, text, onType) => {
  fireEvent.compositionStart(el, { data: '' });
  if (text && onType) onType(el, text);
  fireEvent.keyDown(el, COMPOSING_ENTER);
  fireEvent.compositionEnd(el, { data: text ?? '' });
};

/** Safari: the composition has ended when the picking keydown arrives. */
const composeSafari: Composer = (el, text, onType) => {
  fireEvent.compositionStart(el, { data: '' });
  if (text && onType) onType(el, text);
  fireEvent.compositionEnd(el, { data: text ?? '' });
  fireEvent.keyDown(el, SAFARI_POST_COMPOSITION_ENTER);
};

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  try {
    localStorage.clear();
  } catch {
    /* no storage in this environment */
  }
});

describe('isImeKey — the one predicate the three widgets ask (objectstack#35797)', () => {
  const keyEvent = (init: KeyboardEventInit & { keyCode?: number }) => {
    const nativeEvent = new KeyboardEvent('keydown', init);
    return { nativeEvent, keyCode: nativeEvent.keyCode };
  };

  it('owns a key pressed inside a composition, and Safari\'s 229 after it', () => {
    expect(isImeKey(keyEvent(COMPOSING_ENTER))).toBe(true);
    expect(isImeKey(keyEvent(SAFARI_POST_COMPOSITION_ENTER))).toBe(true);
    // A synthetic event whose keyCode alone says 229.
    expect(isImeKey({ nativeEvent: new KeyboardEvent('keydown', { key: 'Enter' }), keyCode: 229 })).toBe(true);
  });

  it('does not own an Enter or a comma typed outside a composition', () => {
    expect(isImeKey(keyEvent(PLAIN_ENTER))).toBe(false);
    expect(isImeKey(keyEvent({ key: ',', keyCode: 188 }))).toBe(false);
  });
});

describe('TagsField — an Enter or comma the input method owns adds no tag (objectstack#35797)', () => {
  function mountTags() {
    const onChange = vi.fn();
    const Host = () => {
      const [value, setValue] = React.useState<string[]>([]);
      return (
        <TagsField
          value={value}
          onChange={(v: string[]) => {
            onChange(v);
            setValue(v);
          }}
          field={{ name: 'tags', type: 'tags' } as never}
        />
      );
    };
    render(<Host />);
    return { input: screen.getByRole('textbox') as HTMLInputElement, onChange };
  }
  const type = (el: HTMLElement, text: string) => fireEvent.change(el, { target: { value: text } });

  for (const [browser, compose] of [['Chromium', composeChromium], ['Safari', composeSafari]] as const) {
    it(`${browser}: the candidate-picking Enter keeps the draft; the next Enter adds it`, () => {
      const { input, onChange } = mountTags();
      compose(input, '你好', type);
      expect(onChange).not.toHaveBeenCalled();
      expect(input.value).toBe('你好');

      fireEvent.keyDown(input, PLAIN_ENTER);
      expect(onChange).toHaveBeenLastCalledWith(['你好']);
      expect(input.value).toBe('');
    });
  }

  it('a comma typed inside a composition adds no tag; a comma after it does', () => {
    const { input, onChange } = mountTags();
    fireEvent.compositionStart(input, { data: '' });
    type(input, 'ni');
    fireEvent.keyDown(input, { key: ',', code: 'Comma', keyCode: 229, which: 229, isComposing: true });
    fireEvent.compositionEnd(input, { data: 'ni' });
    expect(onChange).not.toHaveBeenCalled();

    fireEvent.keyDown(input, { key: ',', code: 'Comma', keyCode: 188, which: 188 });
    expect(onChange).toHaveBeenLastCalledWith(['ni']);
  });
});

describe('LookupField — the search box\'s IME Enter picks no row (objectstack#35797)', () => {
  const ROWS: Record<string, unknown>[] = [
    { id: 'u1', name: 'Dev Admin' },
    { id: 'u2', name: 'Marta Quinn' },
    { id: 'u3', name: 'Priya Raman' },
  ];
  function makeDs() {
    const find = vi.fn(async (_objectName: string, params?: { $search?: string; $filter?: { id?: { $in?: unknown[] } } }) => {
      const wanted: unknown[] | undefined = params?.$filter?.id?.$in;
      const term = params?.$search;
      const rows = wanted
        ? ROWS.filter((r) => wanted.includes(r.id))
        : term
          ? ROWS.filter((r) => String(r.name).toLowerCase().includes(term.toLowerCase()))
          : ROWS;
      return { data: rows.map((r) => ({ ...r })), total: rows.length };
    });
    const findOne = vi.fn(async (_objectName: string, id: string) => {
      const row = ROWS.find((r) => r.id === id);
      return row ? { ...row } : null;
    });
    return { find, findOne };
  }
  function Host({ ds }: { ds: ReturnType<typeof makeDs> }) {
    const [value, setValue] = React.useState<unknown>(null);
    return (
      <>
        <LookupField
          value={value}
          onChange={(v: unknown) => setValue(v)}
          dataSource={ds as never}
          field={{ name: 'managerId', reference: 'sys_user', label: 'Manager' } as never}
        />
        <output data-testid="host-value">{JSON.stringify(value)}</output>
      </>
    );
  }
  async function settle(ms = 0): Promise<void> {
    for (let i = 0; i < 6; i++) {
      await act(async () => {
        await new Promise((r) => setTimeout(r, ms));
      });
    }
  }
  const hostValue = () => JSON.parse(screen.getByTestId('host-value').textContent || 'null');

  /** Open the quick picker and search, so the one match is the active row Enter takes. */
  async function openAndSearch(): Promise<HTMLElement> {
    render(<Host ds={makeDs()} />);
    await settle();
    await act(async () => {
      fireEvent.click(screen.getByTestId('lookup-trigger-managerId'));
    });
    await waitFor(() => expect(screen.getAllByRole('option').length).toBe(ROWS.length));
    await settle();
    await act(async () => {
      fireEvent.change(screen.getByRole('combobox'), { target: { value: 'mar' } });
    });
    await settle(70);
    expect(screen.getAllByRole('option').map((o) => o.getAttribute('title'))).toEqual(['Marta Quinn']);
    expect(screen.getByRole('combobox')).toHaveAttribute('aria-activedescendant');
    return screen.getByRole('combobox');
  }

  for (const [browser, compose] of [['Chromium', composeChromium], ['Safari', composeSafari]] as const) {
    it(`${browser}: the candidate-picking Enter leaves the field empty and the list open; the next Enter takes the row`, async () => {
      const search = await openAndSearch();
      await act(async () => {
        compose(search);
      });
      await settle();
      expect(hostValue()).toBeNull();
      expect(screen.getAllByRole('option')).toHaveLength(1);

      await act(async () => {
        fireEvent.keyDown(screen.getByRole('combobox'), PLAIN_ENTER);
      });
      await settle();
      expect(hostValue()).toBe('u2');
    });
  }
});

describe('PeoplePicker — the search box\'s IME Enter picks no person (objectstack#35797)', () => {
  const users = [
    { id: 'u1', name: 'Amy Lin', email: 'amy@x.io' },
    { id: 'u2', name: 'Bob Wu', email: 'bob@x.io' },
  ];
  function makeDs() {
    const find = vi.fn(async (_obj: string, params: { $filter?: { id?: { $in?: unknown[] } } }) => {
      const idIn = params?.$filter?.id?.$in;
      const data = idIn ? users.filter((u) => idIn.map(String).includes(u.id)) : users;
      return { data, total: data.length };
    });
    return { find } as never;
  }
  beforeEach(() => {
    // jsdom has no matchMedia; useIsMobile needs it. Desktop width.
    Object.defineProperty(window, 'innerWidth', { writable: true, configurable: true, value: 1280 });
    window.matchMedia = ((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    })) as never;
  });

  async function openWithActiveRow(onSelect: (id: string) => void): Promise<HTMLElement> {
    render(
      <PeoplePicker open objectName="sys_user" dataSource={makeDs()} onSelect={onSelect} onSelectRecords={vi.fn()} onOpenChange={vi.fn()} />,
    );
    await waitFor(() => expect(screen.getByText('Amy Lin')).toBeTruthy());
    const search = screen.getByTestId('people-picker-search');
    fireEvent.keyDown(search, { key: 'ArrowDown', keyCode: 40 });
    await waitFor(() => expect(screen.getAllByTestId('person-row')[0].getAttribute('data-active')).toBe('true'));
    return search;
  }

  for (const [browser, compose] of [['Chromium', composeChromium], ['Safari', composeSafari]] as const) {
    it(`${browser}: the candidate-picking Enter selects nobody; the next Enter takes the active row`, async () => {
      const onSelect = vi.fn();
      const search = await openWithActiveRow(onSelect);
      compose(search);
      expect(onSelect).not.toHaveBeenCalled();

      fireEvent.keyDown(search, PLAIN_ENTER);
      expect(onSelect).toHaveBeenCalledWith('u1');
    });
  }

  it('an arrow key the input method owns moves its candidate, not the active row', async () => {
    const search = await openWithActiveRow(vi.fn());
    fireEvent.compositionStart(search, { data: '' });
    fireEvent.keyDown(search, { key: 'ArrowDown', keyCode: 229, which: 229, isComposing: true });
    fireEvent.compositionEnd(search, { data: '' });
    const rows = screen.getAllByTestId('person-row');
    expect(rows[0].getAttribute('data-active')).toBe('true');
    expect(rows[1].getAttribute('data-active')).not.toBe('true');
  });
});
