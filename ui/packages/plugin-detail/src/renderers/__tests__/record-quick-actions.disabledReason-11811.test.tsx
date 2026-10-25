/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#11811 — a `record:quick_actions` button greyed out by its declared
 * `disabled` predicate says why.
 *
 * The card's reproduction is the showcase Task page: its section bar is this
 * block, and *Archive* declares `disabled: 'has(record.done) && record.done
 * != true'`. Before the fix the greyed-out button carried no tooltip, no
 * `title` and no `aria-describedby`, and a natively disabled button (with the
 * Button primitive's `disabled:pointer-events-none`) never fires the hover or
 * focus a tooltip would need. The reason now rides a focusable wrapper span —
 * the tooltip trigger — and a persistent `sr-only` description both the
 * button and the span point at.
 *
 * Nothing is stubbed: the predicate runs through the real `useCondition`, the
 * tooltip is the real Radix one from `@object-ui/components`, and the zh case
 * reads the real zh pack through a real `I18nProvider`.
 */

import * as React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen, within, act, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom';
import { RecordContextProvider } from '@object-ui/react';
import { I18nProvider } from '@object-ui/i18n';
import { RecordQuickActionsRenderer } from '../record-quick-actions';

const REASON_EN = 'Not available for this record';
const REASON_ZH = '对此记录不可用';

/**
 * The showcase specimen, in the shape the server SERVES it: the authored CEL
 * string compiled into a `{ dialect: 'cel', source }` envelope. The bare
 * string would take the legacy `${…}` evaluator, where `has()` faults — and a
 * faulting `disabled` greys the action out on both rows (fail-soft), so the
 * "disabled" case would pass for the wrong reason and the control below would
 * go red. The envelope reaches a real verdict both ways.
 */
const ARCHIVE = {
  name: 'showcase_archive_task',
  label: 'Archive',
  type: 'script',
  locations: ['record_section'],
  disabled: { dialect: 'cel', source: 'has(record.done) && record.done != true' },
};

function mount(
  action: Record<string, unknown>,
  record: Record<string, unknown>,
  wrap: (node: React.ReactElement) => React.ReactElement = (node) => node,
) {
  return render(
    wrap(
      <RecordContextProvider objectName="showcase_task" recordId="t-1" data={{ id: 't-1', ...record }}>
        <RecordQuickActionsRenderer schema={{ actions: [action], location: 'record_section' } as any} />
      </RecordContextProvider>,
    ),
  );
}

const archive = () => screen.getByRole('button', { name: 'Archive' });
/** The element the button's `aria-describedby` names, or `null`. */
const describedBy = (el: HTMLElement) => {
  const id = el.getAttribute('aria-describedby');
  return id ? document.getElementById(id) : null;
};

describe('record:quick_actions — a predicate-disabled action says why (objectui#11811)', () => {
  it('disabled by its predicate: the button carries the reason as its accessible description', () => {
    mount(ARCHIVE, { done: false });
    const button = archive();
    expect(button).toBeDisabled();
    expect(describedBy(button)).toHaveTextContent(REASON_EN);
    // The reason is a DESCRIPTION, never folded into the accessible name.
    expect(button).toHaveAccessibleName('Archive');
  });

  it('hovering the disabled action opens a tooltip with the reason', async () => {
    const user = userEvent.setup();
    mount(ARCHIVE, { done: false });
    const trigger = archive().parentElement as HTMLElement;
    expect(trigger).toHaveAttribute('data-disabled-reason');
    await user.hover(trigger);
    const tooltip = await screen.findByRole('tooltip');
    expect(tooltip).toHaveTextContent(REASON_EN);
  });

  it('a keyboard user reaches the reason: Tab lands on the trigger, which opens the tooltip and is described by it', async () => {
    const user = userEvent.setup();
    mount(ARCHIVE, { done: false });
    const trigger = archive().parentElement as HTMLElement;
    await user.tab();
    expect(trigger).toHaveFocus();
    expect(describedBy(trigger)).toHaveTextContent(REASON_EN);
    const tooltip = await screen.findByRole('tooltip');
    expect(tooltip).toHaveTextContent(REASON_EN);
  });

  it('control — the predicate does not hold: the action is live and says nothing', () => {
    mount(ARCHIVE, { done: true });
    const button = archive();
    expect(button).not.toBeDisabled();
    expect(button).not.toHaveAttribute('aria-describedby');
    expect(button.parentElement).not.toHaveAttribute('data-disabled-reason');
    expect(screen.queryByText(REASON_EN)).toBeNull();
  });

  it('control — a button greyed out only while its own action runs gives no "not available" reason', async () => {
    let finish: () => void = () => {};
    const pending = new Promise<void>((resolve) => { finish = resolve; });
    // No `disabled` key: the running state is the ONLY reason it greys out.
    const SLOW = { name: 'slow', label: 'Slow', type: 'script', locations: ['record_section'], onClick: () => pending };
    mount(SLOW, {});
    const button = screen.getByRole('button', { name: 'Slow' });
    fireEvent.click(button);
    expect(screen.getByRole('button', { name: 'Slow' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Slow' })).not.toHaveAttribute('aria-describedby');
    expect(screen.queryByText(REASON_EN)).toBeNull();
    await act(async () => { finish(); await pending; });
    expect(screen.getByRole('button', { name: 'Slow' })).not.toBeDisabled();
  });

  it('the reason comes from the language pack — zh', async () => {
    mount(ARCHIVE, { done: false }, (node) => (
      <I18nProvider config={{ defaultLanguage: 'zh', detectBrowserLanguage: false }} persistLanguage={false}>
        {node}
      </I18nProvider>
    ));
    const reason = await screen.findByText(REASON_ZH);
    expect(describedBy(archive())).toBe(reason);
    expect(within(archive().parentElement as HTMLElement).queryByText(REASON_EN)).toBeNull();
  });

  it('the reason comes from the language pack — en', async () => {
    mount(ARCHIVE, { done: false }, (node) => (
      <I18nProvider config={{ defaultLanguage: 'en', detectBrowserLanguage: false }} persistLanguage={false}>
        {node}
      </I18nProvider>
    ));
    const reason = await screen.findByText(REASON_EN);
    expect(describedBy(archive())).toBe(reason);
  });
});
