/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * What the form-field channel's keys DO, measured through the real
 * `SchemaRenderer`, the real `form` renderer and the real `@object-ui/fields`
 * registrations (objectui#12130).
 *
 * `form-field-channel-census-12130.test.tsx` beside this file records which
 * keys of a `fields[]` entry the runtime reads by name. A read is not yet an
 * effect, so this file renders each key the census finds read and undeclared
 * twice, without it and with it, and asserts the widget does something
 * different. Each case's first render is its control: it shows the observable
 * the case reads is there to change.
 *
 * It also measures the two keys objectui#12130 was filed for, `defaultChecked`
 * and `defaultValue`. The census records no read of either by name, and
 * neither becomes the field's VALUE: the box stays unchecked, and the
 * submitted payload carries no value, on every type measured here. Neither is
 * DRAWN either. Until objectui#12155 the built-in branches spread the entry's
 * leftover keys onto their control, so a `textarea` showed a field-level
 * `defaultValue` the form never submitted, and `defaultChecked` checked the
 * hidden input behind a box that stayed unchecked. They now forward an
 * allowlist, which `form-builtin-branch-dom-allowlist-12155.test.tsx`
 * measures branch by branch. A form's initial values are
 * `FormSchema.defaultValues`; each case's control seeds the same value
 * through it and reads it back from the same channels.
 * The registry without `@object-ui/fields` is measured by
 * `form-field-channel-components-only-12130.test.tsx`.
 *
 * Module-scope import of `@object-ui/fields`, not `beforeAll` (AGENTS.md
 * §测试纪律): the widgets sit behind `React.lazy`.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import React from 'react';
import { render, act, fireEvent, screen } from '@testing-library/react';
import '@object-ui/components';
import { FORM_FIELD_TYPES } from '@object-ui/fields';
import { SchemaRenderer, SchemaRendererProvider } from '@object-ui/react';

afterEach(() => {
  // The lookup widgets remember picked ids in `localStorage`; a remembered id
  // adds a query to the next case's log.
  try { localStorage.clear(); } catch { /* storage unavailable: nothing remembered */ }
});

const settle = async (rounds = 8) => {
  for (let i = 0; i < rounds; i++) await act(async () => { await new Promise((resolve) => setTimeout(resolve, 25)); });
};

type Row = Record<string, unknown>;
type Params = { $top?: number; $skip?: number; $filter?: unknown };

const ACCOUNTS: Row[] = [
  { id: 'r1', name: 'Name One', title: 'Title One', industry: 'Retail', code: 'C-1', email: 'one@x.co' },
  { id: 'r2', name: 'Name Two', title: 'Title Two', industry: 'Energy', code: 'C-2', email: 'two@x.co' },
];

/** A data source whose `find` answers `rows` and logs every query. */
function dataSourceOf(rows: Row[] = ACCOUNTS) {
  const find = vi.fn(async (_object: string, params?: Params) => ({
    data: rows.slice(params?.$skip ?? 0, (params?.$skip ?? 0) + (params?.$top ?? rows.length)),
    total: rows.length,
  }));
  const findOne = vi.fn(async (_object: string, id: unknown) => rows.find((r) => r.id === id) ?? null);
  return { find, findOne, create: vi.fn(async () => ({ id: 'new' })) };
}

/** Render a one-field form; `submit()` clicks its button and returns what the form submitted. */
async function mount(field: Row, opts: { dataSource?: unknown; defaultValues?: Row } = {}) {
  let submitted: Row | undefined;
  const node = {
    type: 'form',
    showSubmit: true,
    submitLabel: 'Go',
    ...(opts.defaultValues ? { defaultValues: opts.defaultValues } : {}),
    fields: [{ name: 'f', label: 'F', ...field }],
    onSubmit: (data: Row) => { submitted = data; },
  };
  const utils = render(
    <SchemaRendererProvider dataSource={(opts.dataSource ?? null) as never}>
      <SchemaRenderer schema={node as never} />
    </SchemaRendererProvider>,
  );
  await settle();
  const row = () => utils.container.querySelector('[data-field="f"]') as HTMLElement;
  const submit = async () => {
    fireEvent.click(utils.getByRole('button', { name: 'Go' }));
    await settle();
    return submitted;
  };
  return { ...utils, row, submit };
}

const click = async (el: Element | null) => {
  expect(el).toBeTruthy();
  await act(async () => { fireEvent.click(el as Element); });
  await settle();
};

const queriesOf = (ds: ReturnType<typeof dataSourceOf>) => ds.find.mock.calls.map((call) => (call[1] ?? {}) as Params);

/* ── the keys the census reads, each one changes what the widget does ──── */

describe('a read field key changes what its widget does (objectui#12130)', () => {
  it('`step` (number) sets the input step', async () => {
    const without = await mount({ type: 'number' });
    expect(without.row().querySelector('input')?.getAttribute('step')).toBe('any');
    without.unmount();
    const withKey = await mount({ type: 'number', step: 5 });
    expect(withKey.row().querySelector('input')?.getAttribute('step')).toBe('5');
  });

  it('`step` (built-in `input`, `inputType: \'number\'`) sets the input step, by the `number` widget\'s rule', async () => {
    // The form renderer's own number input derives its step where it draws
    // it: an explicit `step` wins, else `10^-scale`, else `any`. No producer
    // writes the step onto the entry for it.
    const stepOf = async (field: Row) => {
      const m = await mount({ type: 'input', inputType: 'number', ...field });
      const step = m.row().querySelector('input')?.getAttribute('step');
      m.unmount();
      return step;
    };
    expect(await stepOf({})).toBe('any');
    expect(await stepOf({ scale: 2 })).toBe('0.01');
    expect(await stepOf({ step: 5, scale: 2 })).toBe('5');
  });

  it('`language` (code) names the language the editor asks for', async () => {
    const without = await mount({ type: 'code' });
    expect(without.row().querySelector('[placeholder]')?.getAttribute('placeholder')).toContain('javascript');
    without.unmount();
    const withKey = await mount({ type: 'code', language: 'python' });
    expect(withKey.row().querySelector('[placeholder]')?.getAttribute('placeholder')).toContain('python');
  });

  it('`maxSize` (file) refuses a larger pick before any upload', async () => {
    const pick = async (m: Awaited<ReturnType<typeof mount>>) => {
      const input = m.row().querySelector('input[type=file]') as HTMLInputElement;
      await act(async () => { fireEvent.change(input, { target: { files: [new File(['0123456789'], 'ten.txt', { type: 'text/plain' })] } }); });
      await settle();
      return m.row().textContent ?? '';
    };
    const without = await mount({ type: 'file' });
    expect(await pick(without)).not.toContain('exceeds max size');
    without.unmount();
    const withKey = await mount({ type: 'file', maxSize: 4 });
    expect(await pick(withKey)).toContain('exceeds max size');
  });

  it('`capture` (file) adds a camera input in that capture mode', async () => {
    const without = await mount({ type: 'file' });
    expect(without.row().querySelector('input[capture]')).toBeNull();
    without.unmount();
    const withKey = await mount({ type: 'file', capture: 'user' });
    expect(withKey.row().querySelector('input[capture="user"]')).toBeTruthy();
  });

  it('`crop` (image) `false` removes the crop action from a drawn image', async () => {
    const value = { f: { name: 'cover.png', url: 'https://cdn.example/cover.png', mime_type: 'image/png' } };
    const without = await mount({ type: 'image' }, { defaultValues: value });
    expect(without.row().querySelector('[data-testid="image-field-crop-0"]')).toBeTruthy();
    without.unmount();
    const withKey = await mount({ type: 'image', crop: false }, { defaultValues: value });
    expect(withKey.row().querySelector('[data-testid="image-field-crop-0"]')).toBeNull();
  });

  it('`defaultName` (avatar) is the name the empty avatar draws initials from', async () => {
    const without = await mount({ type: 'avatar' });
    expect(without.row().textContent).not.toContain('ZQ');
    without.unmount();
    const withKey = await mount({ type: 'avatar', defaultName: 'Zed Quux' });
    expect(withKey.row().textContent).toContain('ZQ');
  });

  /** Open a lookup's quick-select popover; the offered options' text. */
  const openLookup = async (m: Awaited<ReturnType<typeof mount>>) => {
    await click(m.row().querySelector('[data-testid^="lookup-trigger"]'));
    return screen.queryAllByRole('option').map((o) => o.textContent ?? '');
  };

  it('`displayField` (lookup) is the record field each option is labelled by', async () => {
    const without = await mount({ type: 'lookup', reference: 'account' }, { dataSource: dataSourceOf() });
    expect(await openLookup(without)).toEqual(['Name One', 'Name Two']);
    without.unmount();
    const withKey = await mount({ type: 'lookup', reference: 'account', displayField: 'title' }, { dataSource: dataSourceOf() });
    expect(await openLookup(withKey)).toEqual(['Title One', 'Title Two']);
  });

  it('`descriptionField` (lookup) adds each record\'s field under its option', async () => {
    const without = await mount({ type: 'lookup', reference: 'account' }, { dataSource: dataSourceOf() });
    expect((await openLookup(without)).join(' ')).not.toContain('Retail');
    without.unmount();
    const withKey = await mount({ type: 'lookup', reference: 'account', descriptionField: 'industry' }, { dataSource: dataSourceOf() });
    expect((await openLookup(withKey)).join(' ')).toContain('Retail');
  });

  it('`idField` (lookup) is the record field a pick submits', async () => {
    const pick = async (m: Awaited<ReturnType<typeof mount>>) => {
      await openLookup(m);
      await click(screen.queryAllByRole('option')[0]);
      return (await m.submit())?.f;
    };
    const without = await mount({ type: 'lookup', reference: 'account' }, { dataSource: dataSourceOf() });
    expect(await pick(without)).toBe('r1');
    without.unmount();
    const withKey = await mount({ type: 'lookup', reference: 'account', idField: 'code' }, { dataSource: dataSourceOf() });
    expect(await pick(withKey)).toBe('C-1');
  });

  it('`lookupFilters` (lookup) scopes the candidate query', async () => {
    const hasStatusFilter = (ds: ReturnType<typeof dataSourceOf>) =>
      queriesOf(ds).some((q) => JSON.stringify(q.$filter ?? null).includes('status'));
    const dsWithout = dataSourceOf();
    const without = await mount({ type: 'lookup', reference: 'account' }, { dataSource: dsWithout });
    await openLookup(without);
    expect(hasStatusFilter(dsWithout)).toBe(false);
    without.unmount();
    const dsWith = dataSourceOf();
    const withKey = await mount(
      { type: 'lookup', reference: 'account', lookupFilters: [{ field: 'status', operator: 'eq', value: 'active' }] },
      { dataSource: dsWith },
    );
    await openLookup(withKey);
    expect(hasStatusFilter(dsWith)).toBe(true);
  });

  it('`allowCreate` (lookup) `false` withdraws the create offer from an empty result', async () => {
    const empty = () => {
      const ds = dataSourceOf([]);
      return ds;
    };
    const without = await mount({ type: 'lookup', reference: 'account' }, { dataSource: empty() });
    await openLookup(without);
    expect(document.body.textContent).toContain('Create new');
    without.unmount();
    const withKey = await mount({ type: 'lookup', reference: 'account', allowCreate: false }, { dataSource: empty() });
    await openLookup(withKey);
    expect(document.body.textContent).not.toContain('Create new');
  });

  it('`picker` (lookup) `search` replaces the quick-select and its browse-all dialog with the search picker', async () => {
    const without = await mount({ type: 'lookup', reference: 'account' }, { dataSource: dataSourceOf() });
    expect(without.row().querySelector('[data-testid="browse-all-records"]')).toBeTruthy();
    without.unmount();
    const withKey = await mount({ type: 'lookup', reference: 'account', picker: 'search' }, { dataSource: dataSourceOf() });
    expect(withKey.row().querySelector('[data-testid="browse-all-records"]')).toBeNull();
  });

  it('`subtitle` (user) adds the named record fields to each candidate of the search picker', async () => {
    const people = [{ id: 'u1', name: 'Ann', email: 'ann@x.co', dept: 'Opsdept' }];
    const open = async (field: Row) => {
      const m = await mount({ type: 'user', reference: 'sys_user', picker: 'search', ...field }, { dataSource: dataSourceOf(people) });
      await click(m.row().querySelector('[data-testid^="lookup-trigger"]'));
      const text = document.body.textContent ?? '';
      m.unmount();
      return text;
    };
    expect(await open({})).not.toContain('Opsdept');
    expect(await open({ subtitle: ['dept'] })).toContain('Opsdept');
  });

  /**
   * Reports every image as loaded. happy-dom never loads one, so Radix's
   * `AvatarImage` draws no `img` whether or not a URL reached it; with this in
   * place an `img` is drawn exactly when an avatar URL reached the Avatar (the
   * technique of `PeoplePicker.outputFls-10433.test.tsx` in `@object-ui/fields`).
   */
  class LoadedImage {
    complete = true;
    naturalWidth = 1;
    src = '';
    crossOrigin: string | null = null;
    referrerPolicy = '';
    addEventListener(): void {}
    removeEventListener(): void {}
  }

  it.each(['user', 'lookup'])('`avatarField` (%s) is the record field each search-picker candidate draws its avatar from', async (type) => {
    // Each candidate carries an avatar in the default field (`image`) and in
    // another one: both legs read a drawn `img`, so neither passes on a picker
    // that draws no avatar at all.
    const people = [{ id: 'u1', name: 'Ann', image: 'https://cdn.example/ann-image.png', photo: 'https://cdn.example/ann-photo.png' }];
    const drawn = async (field: Row) => {
      const m = await mount({ type, reference: 'sys_user', picker: 'search', ...field }, { dataSource: dataSourceOf(people) });
      await click(m.row().querySelector('[data-testid^="lookup-trigger"]'));
      const src = document.querySelector('[data-testid="person-row"] img')?.getAttribute('src') ?? null;
      m.unmount();
      return src;
    };
    const realImage = window.Image;
    (window as unknown as { Image: unknown }).Image = LoadedImage;
    try {
      expect(await drawn({})).toBe('https://cdn.example/ann-image.png');
      expect(await drawn({ avatarField: 'photo' })).toBe('https://cdn.example/ann-photo.png');
    } finally {
      window.Image = realImage;
    }
  });

  /** Open a lookup's browse-all dialog; its column headers and the queries it made. */
  const browseAll = async (field: Row) => {
    const ds = dataSourceOf();
    const m = await mount({ type: 'lookup', reference: 'account', ...field }, { dataSource: ds });
    await click(m.row().querySelector('[data-testid="browse-all-records"]'));
    const headers = [...document.querySelectorAll('[role=dialog] th')].map((h) => h.textContent ?? '');
    const pageSizes = queriesOf(ds).filter((q) => q.$skip === 0).map((q) => q.$top);
    m.unmount();
    return { headers, pageSizes };
  };

  it('`lookupPageSize` (lookup) is the browse-all dialog\'s page size', async () => {
    expect((await browseAll({})).pageSizes).toEqual([10]);
    expect((await browseAll({ lookupPageSize: 1 })).pageSizes).toEqual([1]);
  });

  it('`lookupColumns` (lookup) are the browse-all dialog\'s columns', async () => {
    expect((await browseAll({})).headers).toEqual(['Name']);
    expect((await browseAll({ lookupColumns: ['email'] })).headers).toEqual(['Email']);
  });
});

/* ── `className`: the element the type renders, merged, never the row ──── */

describe('`className` on a form field styles the element its type renders, beside that element\'s own classes (objectui#12130)', () => {
  const AUTHORED = 'authored-cls-12130';
  const hasClass = (el: Element | null | undefined, cls: string) =>
    (el?.getAttribute('class') ?? '').split(/\s+/).includes(cls);
  const CHOICES = [{ label: 'Alpha', value: 'a' }, { label: 'Beta', value: 'b' }];

  // label, entry, the control, and one class that control carries of its own.
  const CONTROLS: ReadonlyArray<readonly [string, Row, string, string]> = [
    ['built-in input', { type: 'input' }, 'input', 'min-h-[44px]'],
    ['built-in input, read-only', { type: 'input', readonly: true }, 'input', 'bg-muted/40'],
    ['built-in textarea', { type: 'textarea' }, 'textarea', 'min-h-[44px]'],
    ['built-in checkbox', { type: 'checkbox' }, '[role=checkbox]', 'min-w-[44px]'],
    ['built-in switch', { type: 'switch' }, '[role=switch]', 'min-w-[44px]'],
    ['built-in select', { type: 'select', options: CHOICES }, '[role=combobox]', 'min-h-[44px]'],
    ['registered `number` widget', { type: 'number' }, 'input', 'border-input'],
  ];

  it.each(CONTROLS)('%s: on the control, which keeps its own classes', async (_label, field, selector, own) => {
    const without = await mount(field);
    expect(hasClass(without.row().querySelector(selector), own)).toBe(true);
    expect(hasClass(without.row().querySelector(selector), AUTHORED)).toBe(false);
    without.unmount();

    const withKey = await mount({ ...field, className: AUTHORED });
    const control = withKey.row().querySelector(selector);
    expect(hasClass(control, AUTHORED)).toBe(true);
    expect(hasClass(control, own)).toBe(true);
    expect(hasClass(withKey.row(), AUTHORED)).toBe(false);
  });

  it('section-divider: on the divider, which keeps its own classes', async () => {
    const divider = (m: Awaited<ReturnType<typeof mount>>) =>
      [...m.container.querySelectorAll('div')].find((d) => hasClass(d, 'col-span-full') && d.textContent === 'Section S');
    const without = await mount({ type: 'section-divider', label: 'Section S' });
    expect(hasClass(divider(without), 'border-b')).toBe(true);
    expect(hasClass(divider(without), AUTHORED)).toBe(false);
    without.unmount();

    const withKey = await mount({ type: 'section-divider', label: 'Section S', className: AUTHORED });
    expect(hasClass(divider(withKey), AUTHORED)).toBe(true);
    expect(hasClass(divider(withKey), 'border-b')).toBe(true);
  });

  // Every type the form draws, editable and read-only: wherever a widget puts
  // the class, it is inside the field's own output. Never the field row, its
  // label, or the read-only group the host draws around a widget's display.
  // A widget that draws no class from it passes; the cases above pin the
  // ones that do.
  it.each(['input', 'textarea', 'checkbox', 'switch', 'select', ...FORM_FIELD_TYPES])(
    '`%s`: never on the field row, its label or a wrapper the host draws',
    async (type) => {
      const field: Row = { type, className: AUTHORED };
      if (['select', 'radio', 'multiselect', 'checkboxes'].includes(type)) field.options = CHOICES;
      if (type === 'grid') field.columns = [{ name: 'product', type: 'text' }];
      for (const readonly of [false, true]) {
        const m = await mount({ ...field, readonly }, { dataSource: dataSourceOf() });
        const row = m.row();
        const misplaced = [...m.container.querySelectorAll(`.${AUTHORED}`)].filter((el) =>
          el === row
          || !row.contains(el)
          || el.tagName === 'LABEL'
          || el.getAttribute('data-slot') === 'readonly-field-group');
        expect(misplaced.map((el) => el.outerHTML.slice(0, 120)), readonly ? 'read-only' : 'editable').toEqual([]);
        m.unmount();
      }
    },
  );
});

/* ── the two keys the card named: neither becomes the field's value ───── */

const toggle = (m: Awaited<ReturnType<typeof mount>>) => m.row().querySelector('[role=checkbox],[role=switch]');

/**
 * Whether any `<input>` in the row is checked, hidden ones included: Radix
 * draws its box as a `button` and keeps a hidden native input beside it, which
 * is where a stray `defaultChecked` landed (objectui#12155).
 */
const anyInputChecked = (m: Awaited<ReturnType<typeof mount>>) =>
  [...m.row().querySelectorAll('input')].some((input) => input.checked);

describe('`defaultChecked` on a form field is not honored: the box stays unchecked and submits false (objectui#12130)', () => {
  it.each(['checkbox', 'switch', 'boolean'])('%s', async (type) => {
    const control = await mount({ type }, { defaultValues: { f: true } });
    expect(toggle(control)?.getAttribute('aria-checked')).toBe('true');
    expect(anyInputChecked(control)).toBe(true);
    expect((await control.submit())?.f).toBe(true);
    control.unmount();

    const withKey = await mount({ type, defaultChecked: true });
    expect(toggle(withKey)?.getAttribute('aria-checked')).toBe('false');
    // Not drawn either, not even in the hidden input (objectui#12155).
    expect(anyInputChecked(withKey)).toBe(false);
    expect((await withKey.submit())?.f).toBe(false);
  });
});

describe('`defaultValue` on a form field is neither drawn nor submitted (objectui#12130, objectui#12155)', () => {
  const CASES: ReadonlyArray<readonly [string, unknown]> = [
    ['input', 'preset@x.co'],
    ['text', 'preset@x.co'],
    ['textarea', 'preset@x.co'],
    ['email', 'preset@x.co'],
    ['number', 42],
    ['select', 'b'],
    ['radio', 'b'],
  ];
  const OPTIONS = [{ label: 'Alpha', value: 'a' }, { label: 'Beta', value: 'b' }];

  /**
   * Whether the row shows `value`: as the value of one of its text controls,
   * or, for an option field, as the label its select trigger shows or the
   * label of its checked radio. Radix's hidden radio inputs are left out: each
   * carries its option's value whether or not it is chosen. The control leg of
   * each case reads `true` here, so a `false` is a reading and not a blind
   * spot.
   */
  const shows = (m: Awaited<ReturnType<typeof mount>>, value: unknown): boolean => {
    const row = m.row();
    const texts = [...row.querySelectorAll('input:not([type=radio]):not([type=checkbox]), textarea')]
      .map((el) => (el as HTMLInputElement).value);
    if (texts.includes(String(value))) return true;
    const label = OPTIONS.find((option) => option.value === value)?.label;
    if (!label) return false;
    if (row.querySelector('[role=combobox]')?.textContent?.includes(label)) return true;
    const radio = row.querySelector('[role=radio][aria-checked=true]');
    return !!radio && !!row.querySelector(`label[for="${radio.id}"]`)?.textContent?.includes(label);
  };

  it.each(CASES)('%s', async (type, value) => {
    const field = { type, ...(type === 'select' || type === 'radio' ? { options: OPTIONS } : {}) };
    const control = await mount(field, { defaultValues: { f: value } });
    expect(shows(control, value)).toBe(true);
    expect((await control.submit())?.f).toEqual(value);
    control.unmount();

    const withKey = await mount({ ...field, defaultValue: value });
    // The `textarea` branch drew it until objectui#12155: a value on screen
    // that the submit below does not carry.
    expect(shows(withKey, value)).toBe(false);
    expect((await withKey.submit())?.f).toBeUndefined();
  });
});
