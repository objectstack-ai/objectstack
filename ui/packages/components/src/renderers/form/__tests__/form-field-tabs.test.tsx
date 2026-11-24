/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * #2959: `FormSchema.fieldTabs` — a tabbed field layout inside ONE form.
 *
 * The contract these pin:
 *  - one `<form>` / react-hook-form instance for every tab;
 *  - panels are force-mounted (only CSS-hidden), so a tab the user leaves keeps
 *    its values AND its validation — react-hook-form skips *unmounted* fields,
 *    which is how a required field on an unopened tab used to reach the server;
 *  - a failed submit activates the tab holding the first offending field and
 *    marks every tab that has one;
 *  - a field no tab claims is still rendered (never silently dropped).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { ComponentRegistry } from '@object-ui/core';
import { toast } from '../../../ui/sonner';
// Registers the renderers at module scope, NOT inside a `beforeAll` — there the
// cold transform is billed to `hookTimeout`, which is why this carried a raised
// timeout. See object-ui/no-dynamic-import-in-test-hook (objectui#3010/#3021).
import '../../../renderers';
// The renderer barrel reaches `react-page.tsx`, which loads this dynamically: pay the load at collection.
import '@object-ui/react-runtime';

beforeEach(() => {
  vi.spyOn(toast, 'error').mockImplementation(() => 'id' as any);
  if (!(Element.prototype as any).scrollIntoView) {
    (Element.prototype as any).scrollIntoView = () => {};
  }
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const FIELDS = [
  { name: 'subject', label: 'Subject', type: 'input', required: true },
  { name: 'status', label: 'Status', type: 'input' },
  { name: 'description', label: 'Description', type: 'input', required: true },
];

const TABS = [
  { key: 'basics', label: 'Basics', fields: ['subject', 'status'] },
  { key: 'detail', label: 'Detail', description: 'Anything else', fields: ['description'] },
];

function renderTabbedForm(overrides: Record<string, unknown> = {}) {
  const onSubmit = vi.fn();
  const Form = ComponentRegistry.get('form')!;
  const utils = render(
    <Form
      schema={{
        type: 'form',
        mode: 'create',
        showSubmit: true,
        showCancel: false,
        submitLabel: 'Create',
        fields: FIELDS,
        fieldTabs: TABS,
        onSubmit,
        ...overrides,
      }}
    />,
  );
  return { ...utils, onSubmit };
}

const submit = () => fireEvent.click(screen.getByRole('button', { name: /create/i }));
const fill = (name: string, value: string) => {
  const input = document.body.querySelector<HTMLInputElement>(`[data-field="${name}"] input`)!;
  fireEvent.change(input, { target: { value } });
};
const tab = (name: RegExp) => screen.getByRole('tab', { name });

describe('form renderer — fieldTabs (#2959)', () => {
  it('renders one form and one panel per tab, with every field mounted', () => {
    const { container } = renderTabbedForm();

    expect(container.querySelectorAll('form')).toHaveLength(1);
    expect(screen.getAllByRole('tab')).toHaveLength(2);
    // Both panels exist up front — the inactive one is hidden by CSS, not
    // unmounted, so its fields are present and registered.
    expect(screen.getByTestId('form-tab-panel:basics')).toBeTruthy();
    expect(screen.getByTestId('form-tab-panel:detail')).toBeTruthy();
    for (const name of ['subject', 'status', 'description']) {
      expect(container.querySelector(`[data-field="${name}"]`)).toBeTruthy();
    }
    // The tab's blurb rides along with its panel.
    expect(screen.getByText('Anything else')).toBeTruthy();
  });

  it('marks the inactive panel with data-state=inactive (CSS-hidden, still mounted)', () => {
    renderTabbedForm();
    expect(screen.getByTestId('form-tab-panel:basics')).toHaveAttribute('data-state', 'active');
    expect(screen.getByTestId('form-tab-panel:detail')).toHaveAttribute('data-state', 'inactive');
    expect(screen.getByTestId('form-tab-panel:detail').className).toContain(
      'data-[state=inactive]:hidden',
    );
  });

  it('submits values entered across different tabs', async () => {
    const { onSubmit } = renderTabbedForm();

    fill('subject', 'From tab 1');
    fireEvent.click(tab(/Detail/));
    fill('description', 'From tab 2');
    submit();

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0][0]).toMatchObject({
      subject: 'From tab 1',
      description: 'From tab 2',
    });
  });

  it('validates fields on tabs the user never opened, and jumps to the offender', async () => {
    const { onSubmit } = renderTabbedForm();

    fill('subject', 'Only tab 1 filled');
    submit();

    // `description` is required and lives on a tab that was never opened.
    await waitFor(() => expect(tab(/Detail/)).toHaveAttribute('data-state', 'active'));
    expect(onSubmit).not.toHaveBeenCalled();
    expect(tab(/Detail/)).toHaveAttribute('data-error', 'true');
    expect(tab(/Basics/)).not.toHaveAttribute('data-error');
  });

  it('honors defaultFieldTab', () => {
    renderTabbedForm({ defaultFieldTab: 'detail' });
    expect(screen.getByTestId('form-tab-panel:detail')).toHaveAttribute('data-state', 'active');
  });

  it('keeps the tab schema keys off the <form> DOM element', () => {
    // Callers/the SDUI dispatch spread the whole form node at the top level too,
    // so a FormSchema key that isn't consumed leaks onto the DOM and React logs
    // "does not recognize the `fieldTabs` prop on a DOM element".
    const Form = ComponentRegistry.get('form')!;
    const { container } = render(
      <Form
        schema={{ type: 'form', fields: FIELDS, fieldTabs: TABS }}
        // The top-level spread that reproduces the leak.
        fields={FIELDS}
        fieldTabs={TABS}
        defaultFieldTab="detail"
        fieldTabsPosition="top"
      />,
    );
    const form = container.querySelector('form')!;
    for (const attr of ['fieldtabs', 'defaultfieldtab', 'fieldtabsposition']) {
      expect(form.hasAttribute(attr)).toBe(false);
    }
  });

  it('renders fields no tab claims instead of dropping them', () => {
    const { container } = renderTabbedForm({
      fieldTabs: [
        { key: 'basics', label: 'Basics', fields: ['subject'] },
        { key: 'detail', label: 'Detail', fields: ['description'] },
      ],
    });
    // `status` belongs to no tab — it must still be in the DOM, outside the panels.
    const status = container.querySelector('[data-field="status"]')!;
    expect(status).toBeTruthy();
    expect(status.closest('[role="tabpanel"]')).toBeNull();
  });

  it('falls back to a plain field list for a single tab', () => {
    renderTabbedForm({ fieldTabs: [{ key: 'only', label: 'Only', fields: ['subject'] }] });
    expect(screen.queryAllByRole('tab')).toHaveLength(0);
    // …and every field still renders, not just the one the lone tab claimed.
    expect(document.body.querySelector('[data-field="description"]')).toBeTruthy();
  });
});

/**
 * objectstack#34615 — at phone width the horizontal tab strip never widens the
 * page: below `sm` it is capped at its container's width and the tabs that do
 * not fit scroll sideways inside it, with no scrollbar drawn, and the ACTIVE
 * tab is always scrolled into the strip's visible window — a tap, a
 * `defaultFieldTab`, or a failed submit jumping to the offending tab. Every
 * added class is `max-sm:`-gated, so the desktop strip is unchanged.
 *
 * jsdom has no layout engine: the strip's overflow (`scrollWidth >
 * clientWidth`) and the triggers' boxes are stubbed below, standing for a
 * 375 px phone with five tabs. The real geometry was measured once in Chromium
 * on the pull request.
 */
describe('form renderer — fieldTabs strip at phone width (objectstack#34615)', () => {
  const FIVE_FIELDS = ['name', 'forecast', 'qualification', 'notes', 'activity'].map((name) => ({
    name,
    label: name,
    type: 'input',
    required: name === 'activity',
  }));
  const FIVE_TABS = [
    { key: 'overview', label: 'Overview', fields: ['name'] },
    { key: 'forecast', label: 'Forecast', fields: ['forecast'] },
    { key: 'qualification', label: 'Qualification', fields: ['qualification'] },
    { key: 'notes', label: 'Description', fields: ['notes'] },
    { key: 'activity', label: 'Activity', fields: ['activity'] },
  ];
  // A 343 px strip (375 px less the gutters) holding 600 px of tabs, 120 px each.
  const STRIP = { left: 16, width: 343, content: 600 };

  /** Lay the strip and its triggers out as a phone would; returns the scrollLeft writes. */
  function layOutStrip(overflowing: boolean) {
    const strip = screen.getByTestId('form-tab-strip');
    let scrollLeft = 0;
    const writes: number[] = [];
    Object.defineProperty(strip, 'clientWidth', { configurable: true, value: STRIP.width });
    Object.defineProperty(strip, 'scrollWidth', { configurable: true, value: overflowing ? STRIP.content : STRIP.width });
    Object.defineProperty(strip, 'scrollLeft', {
      configurable: true,
      get: () => scrollLeft,
      set: (v: number) => { scrollLeft = v; writes.push(v); },
    });
    const rect = (left: number, width: number) =>
      ({ left, right: left + width, width, top: 0, bottom: 44, height: 44, x: left, y: 0, toJSON: () => ({}) }) as DOMRect;
    strip.getBoundingClientRect = () => rect(STRIP.left, STRIP.width);
    screen.getAllByRole('tab').forEach((trigger, i) => {
      trigger.getBoundingClientRect = () => rect(STRIP.left + 4 + i * 120 - scrollLeft, 120);
    });
    return writes;
  }

  const renderFive = (overrides: Record<string, unknown> = {}) =>
    renderTabbedForm({ fields: FIVE_FIELDS, fieldTabs: FIVE_TABS, ...overrides });

  it('caps the horizontal strip and scrolls it sideways below sm, with every added class phone-gated', () => {
    renderFive();
    const strip = screen.getByTestId('form-tab-strip');
    expect(strip).toHaveClass(
      'max-sm:max-w-full',
      'max-sm:overflow-x-auto',
      'max-sm:justify-start',
      'max-sm:[scrollbar-width:none]',
      'max-sm:[&::-webkit-scrollbar]:hidden',
    );
    const ungated = [...strip.classList].filter((c) => /^(max-w-|overflow-|justify-start|\[scrollbar|\[&::-webkit-scrollbar\])/.test(c));
    expect(ungated, 'the desktop strip keeps its look').toEqual([]);
  });

  it('leaves a vertical strip without the phone scroll classes', () => {
    renderFive({ fieldTabsPosition: 'left' });
    expect(screen.getByTestId('form-tab-strip').className).not.toContain('overflow-x-auto');
  });

  it('scrolls the fifth tab into the strip when it is tapped', () => {
    renderFive();
    const writes = layOutStrip(true);
    fireEvent.mouseDown(tab(/Activity/), { button: 0 });
    fireEvent.click(tab(/Activity/));
    expect(tab(/Activity/)).toHaveAttribute('data-state', 'active');
    // Its right edge (16 + 4 + 4·120 + 120 = 620) is brought to the strip's (359).
    expect(writes).toEqual([620 - 359]);
  });

  it('a failed submit that jumps to an off-screen tab scrolls it into view, error dot and all', async () => {
    renderFive();
    const writes = layOutStrip(true);
    // The jump is a non-discrete update (validation is async), so a scroll left
    // to a passive effect lands a task after the commit that activates the tab
    // — painted off-screen meanwhile, and racing this test's `waitFor`
    // (objectstack#34782). Read the strip at that commit: a mutation observer
    // runs in the microtask straight after it, before any later task.
    const trigger = tab(/Activity/);
    let writesAtActivation: number[] | undefined;
    const activation = new MutationObserver(() => {
      if (writesAtActivation === undefined && trigger.getAttribute('data-state') === 'active') {
        writesAtActivation = [...writes];
      }
    });
    activation.observe(trigger, { attributes: true, attributeFilter: ['data-state'] });
    submit();
    await waitFor(() => expect(tab(/Activity/)).toHaveAttribute('data-state', 'active'));
    activation.disconnect();
    expect(tab(/Activity/)).toHaveAttribute('data-error', 'true');
    expect(tab(/Activity/).querySelector('.bg-destructive'), 'the error dot rides on the trigger').not.toBeNull();
    expect(writesAtActivation, 'scrolled in the same commit that marks the tab active').toEqual([620 - 359]);
    expect(writes).toEqual([620 - 359]);
  });

  it('opens on an off-screen defaultFieldTab already scrolled to it', () => {
    // The strip must be laid out before the mount effect reads it, so the
    // stubs go on the prototypes for this one render and come off after.
    const writes: number[] = [];
    const isStrip = (el: Element) => (el as HTMLElement).dataset.testid === 'form-tab-strip';
    const saved = (['scrollWidth', 'clientWidth', 'scrollLeft'] as const).map(
      (key) => [key, Object.getOwnPropertyDescriptor(Element.prototype, key)] as const,
    );
    Object.defineProperty(Element.prototype, 'scrollWidth', {
      configurable: true,
      get(this: Element) { return isStrip(this) ? STRIP.content : 0; },
    });
    Object.defineProperty(Element.prototype, 'clientWidth', {
      configurable: true,
      get(this: Element) { return isStrip(this) ? STRIP.width : 0; },
    });
    Object.defineProperty(Element.prototype, 'scrollLeft', {
      configurable: true,
      get() { return 0; },
      set(this: Element, v: number) { if (isStrip(this)) writes.push(v); },
    });
    const rect = (left: number, width: number) =>
      ({ left, right: left + width, width, top: 0, bottom: 44, height: 44, x: left, y: 0, toJSON: () => ({}) }) as DOMRect;
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
      if (isStrip(this)) return rect(STRIP.left, STRIP.width);
      const i = FIVE_TABS.findIndex((t) => (this as HTMLElement).dataset.testid === `form-tab:${t.key}`);
      return i >= 0 ? rect(STRIP.left + 4 + i * 120, 120) : rect(0, 0);
    });
    try {
      renderFive({ defaultFieldTab: 'activity' });
      expect(tab(/Activity/)).toHaveAttribute('data-state', 'active');
      expect(writes).toEqual([620 - 359]);
    } finally {
      for (const [key, desc] of saved) {
        if (desc) Object.defineProperty(Element.prototype, key, desc);
        else delete (Element.prototype as unknown as Record<string, unknown>)[key];
      }
    }
  });

  it('CONTROL: a strip that fits (every desktop strip) is never scrolled', () => {
    renderFive();
    const writes = layOutStrip(false);
    fireEvent.mouseDown(tab(/Activity/), { button: 0 });
    fireEvent.click(tab(/Activity/));
    expect(tab(/Activity/)).toHaveAttribute('data-state', 'active');
    expect(writes).toEqual([]);
  });
});
