// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * DeclaredActionsBar — a declared action greyed out by its `disabled`
 * predicate says why (objectui#11811).
 *
 * The bar evaluates the spec `disabled` predicate itself (`useCondition`), so
 * it knows a button is off BY DECLARATION. Before the fix it rendered that
 * button with no tooltip, no `title` and no `aria-describedby`, and a natively
 * disabled button (with the Button primitive's `disabled:pointer-events-none`)
 * never fires the hover or focus a tooltip would need. The generic reason now
 * rides a focusable wrapper span — the tooltip trigger — and a persistent
 * `sr-only` description both the button and the span point at. A button that
 * is disabled only while its own action runs is NOT "not available", and says
 * nothing.
 *
 * Only the action DISPATCH and the console runtime shell are doubled, as in
 * the sibling suites. The predicate entry, the Button, the Radix tooltip and
 * the language packs are the shipped ones — the zh case reads the real zh pack
 * through a real `I18nProvider`.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom';
import React from 'react';

const executeSpy = vi.fn().mockResolvedValue({ success: true });

vi.mock('@object-ui/react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@object-ui/react')>();
  return {
    ...actual,
    ActionProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
    useAction: () => ({ execute: executeSpy }),
  };
});
vi.mock('../../hooks/useConsoleActionRuntime', () => ({
  useConsoleActionRuntime: () => ({ actionProviderProps: {}, dialogs: null }),
}));
vi.mock('../../providers/AdapterProvider', () => ({ useAdapter: () => ({}) }));
vi.mock('../../utils/getIcon', () => ({ getIcon: () => () => null }));

import { I18nProvider } from '@object-ui/i18n';
import { DeclaredActionsBar } from '../DeclaredActionsBar';

const REASON_EN = 'Not available for this record';
const REASON_ZH = '对此记录不可用';

/**
 * The `disabled`-predicate specimen the card measured (showcase Archive), in
 * the shape the server SERVES it: the authored CEL string compiled into a
 * `{ dialect: 'cel', source }` envelope. The bare string would take the legacy
 * `${…}` evaluator, where `has()` faults — and a faulting `disabled` greys the
 * action out on both rows (fail-soft), so the "disabled" case would pass for
 * the wrong reason and the control below would go red. The envelope reaches a
 * real verdict both ways.
 */
const ARCHIVE = {
  name: 'showcase_archive_task',
  type: 'script',
  label: 'Archive',
  locations: ['record_section'],
  disabled: { dialect: 'cel', source: 'has(record.done) && record.done != true' },
};

function mount(
  record: Record<string, unknown>,
  actions: Record<string, unknown>[] = [ARCHIVE],
  wrap: (node: React.ReactElement) => React.ReactElement = (node) => node,
) {
  return render(
    wrap(
      <DeclaredActionsBar
        objectName="showcase_task"
        record={{ id: 't-1', ...record }}
        location="record_section"
        actions={actions as any}
      />,
    ),
  );
}

const archive = () => screen.getByTestId('declared-action-showcase_archive_task');
/** The element an `aria-describedby` names, or `null`. */
const describedBy = (el: HTMLElement) => {
  const id = el.getAttribute('aria-describedby');
  return id ? document.getElementById(id) : null;
};

beforeEach(() => executeSpy.mockReset().mockResolvedValue({ success: true }));

describe('DeclaredActionsBar — a predicate-disabled action says why (objectui#11811)', () => {
  it('disabled by its predicate: the button carries the reason as its accessible description', () => {
    mount({ done: false });
    const button = archive();
    expect(button).toBeDisabled();
    expect(describedBy(button)).toHaveTextContent(REASON_EN);
    // A DESCRIPTION, never folded into the accessible name.
    expect(button).toHaveAccessibleName('Archive');
  });

  it('hovering the disabled action opens a tooltip with the reason', async () => {
    const user = userEvent.setup();
    mount({ done: false });
    const trigger = archive().parentElement as HTMLElement;
    expect(trigger).toHaveAttribute('data-disabled-reason');
    await user.hover(trigger);
    const tooltip = await screen.findByRole('tooltip');
    expect(tooltip).toHaveTextContent(REASON_EN);
  });

  it('a keyboard user reaches the reason: Tab lands on the trigger, which opens the tooltip and is described by it', async () => {
    const user = userEvent.setup();
    mount({ done: false });
    const trigger = archive().parentElement as HTMLElement;
    await user.tab();
    expect(trigger).toHaveFocus();
    expect(describedBy(trigger)).toHaveTextContent(REASON_EN);
    const tooltip = await screen.findByRole('tooltip');
    expect(tooltip).toHaveTextContent(REASON_EN);
  });

  it('control — the predicate does not hold: the action is live and says nothing', () => {
    mount({ done: true });
    const button = archive();
    expect(button).not.toBeDisabled();
    expect(button).not.toHaveAttribute('aria-describedby');
    expect(button.parentElement).not.toHaveAttribute('data-disabled-reason');
    expect(screen.queryByText(REASON_EN)).toBeNull();
  });

  it('control — a button greyed out only while its own action runs gives no "not available" reason', async () => {
    let finish: (v: unknown) => void = () => {};
    executeSpy.mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
    const SLOW = { name: 'slow', type: 'script', label: 'Slow', locations: ['record_section'] };
    mount({}, [SLOW]);
    fireEvent.click(screen.getByTestId('declared-action-slow'));
    const slow = screen.getByTestId('declared-action-slow');
    expect(slow).toBeDisabled();
    expect(slow).not.toHaveAttribute('aria-describedby');
    expect(screen.queryByText(REASON_EN)).toBeNull();
    await act(async () => { finish({ success: true }); });
    expect(screen.getByTestId('declared-action-slow')).not.toBeDisabled();
  });

  it('the reason comes from the language pack — zh', async () => {
    mount({ done: false }, [ARCHIVE], (node) => (
      <I18nProvider config={{ defaultLanguage: 'zh', detectBrowserLanguage: false }} persistLanguage={false}>
        {node}
      </I18nProvider>
    ));
    const reason = await screen.findByText(REASON_ZH);
    expect(describedBy(archive())).toBe(reason);
    expect(screen.queryByText(REASON_EN)).toBeNull();
  });

  it('the reason comes from the language pack — en', async () => {
    mount({ done: false }, [ARCHIVE], (node) => (
      <I18nProvider config={{ defaultLanguage: 'en', detectBrowserLanguage: false }} persistLanguage={false}>
        {node}
      </I18nProvider>
    ));
    const reason = await screen.findByText(REASON_EN);
    expect(describedBy(archive())).toBe(reason);
  });
});
