/**
 * objectui#11811 — a `page:header` action greyed out by its declared
 * `disabled` predicate says why.
 *
 * The card's reproduction is the showcase Task page, whose header lists
 * *Archive* (`disabled: 'has(record.done) && record.done != true'`). Before the
 * fix the greyed-out button carried no tooltip, no `title` and no
 * `aria-describedby`, and a natively disabled button (with the Button
 * primitive's `disabled:pointer-events-none`) never fires the hover or focus a
 * tooltip needs.
 *
 * Inline, the reason rides a focusable wrapper span (the tooltip trigger) and
 * a persistent `sr-only` description that the button and the span both point
 * at. In the ⋯ overflow it is a visible second line and the item's description,
 * because a disabled menu item is skipped by arrow-key focus and the menu traps
 * Tab, so a tooltip there would be out of keyboard reach.
 *
 * Only an AUTHORED action's declared `disabled` earns the reason. The host's
 * Edit / Delete (`RecordContext.headerSystemActions`) carry a boolean the host
 * computed, and stay as they were; the controls below pin that.
 *
 * The predicate is the served shape: the spec normalizes the authored CEL
 * string to a `{ dialect: 'cel', source }` envelope. Nothing is stubbed — the
 * real header, the real Radix tooltip and menu, and the real zh pack.
 */

import * as React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom';
import { ComponentRegistry } from '@object-ui/core';
import { ActionProvider, RecordContextProvider } from '@object-ui/react';
import { I18nProvider } from '@object-ui/i18n';
// Registers `page:header` at module scope, NOT inside a `beforeAll` — there the
// cold transform is billed to `hookTimeout`
// (object-ui/no-dynamic-import-in-test-hook, objectui#3010).
import '../renderers';

const REASON_EN = 'Not available for this record';
const REASON_ZH = '对此记录不可用';
const DONE_GATE = { dialect: 'cel', source: 'has(record.done) && record.done != true' };

const ARCHIVE = {
  name: 'showcase_archive_task',
  label: 'Archive',
  type: 'script',
  locations: ['record_header'],
  disabled: DONE_GATE,
};
/** A `record_more`-only action: always drawn in the ⋯ overflow. */
const ARCHIVE_MORE = { ...ARCHIVE, name: 'showcase_archive_more', label: 'Archive later', locations: ['record_more'] };

/** The host's chrome, as `RecordDetailView` injects it: a host-computed boolean `disabled`. */
const HOST_EDIT = { name: 'sys_edit', label: 'Edit', type: 'script', locations: ['record_header'], disabled: true, onClick: () => {} };
const HOST_DELETE = {
  name: 'sys_delete', label: 'Delete', type: 'script', locations: ['record_header'],
  component: 'action:menu', disabled: true, onClick: () => {},
};

function PageHeader({ schema }: { schema: any }) {
  const Component = ComponentRegistry.get('page:header');
  if (!Component) throw new Error('page:header not registered');
  // eslint-disable-next-line react-hooks/static-components -- ComponentRegistry.get returns a registered component (stable), not one created during render
  return <Component schema={schema} />;
}

function mount(
  actions: Record<string, unknown>[],
  record: Record<string, unknown>,
  opts: { host?: Record<string, unknown>[]; wrap?: (node: React.ReactElement) => React.ReactElement } = {},
) {
  const node = (
    <ActionProvider>
      <RecordContextProvider
        objectName="showcase_task"
        recordId="t-1"
        data={{ id: 't-1', ...record }}
        objectSchema={{ name: 'showcase_task', label: 'Task' }}
        headerSystemActions={opts.host}
      >
        <PageHeader schema={{ type: 'page:header', title: 'Task', actions }} />
      </RecordContextProvider>
    </ActionProvider>
  );
  return render(opts.wrap ? opts.wrap(node) : node);
}

const describedBy = (el: Element) => {
  const id = el.getAttribute('aria-describedby');
  return id ? document.getElementById(id) : null;
};

describe('page:header — a predicate-disabled authored action says why (objectui#11811)', () => {
  it('inline: the disabled button carries the reason as its accessible description', () => {
    mount([ARCHIVE], { done: false });
    const button = screen.getByRole('button', { name: 'Archive' });
    expect(button).toBeDisabled();
    expect(describedBy(button)).toHaveTextContent(REASON_EN);
  });

  it('inline: hovering the disabled action opens a tooltip with the reason', async () => {
    const user = userEvent.setup();
    mount([ARCHIVE], { done: false });
    const trigger = screen.getByRole('button', { name: 'Archive' }).parentElement as HTMLElement;
    expect(trigger).toHaveAttribute('data-disabled-reason');
    await user.hover(trigger);
    expect(await screen.findByRole('tooltip')).toHaveTextContent(REASON_EN);
  });

  it('inline: a keyboard user reaches the reason — Tab lands on the trigger, which opens the tooltip', async () => {
    const user = userEvent.setup();
    mount([ARCHIVE], { done: false });
    const trigger = screen.getByRole('button', { name: 'Archive' }).parentElement as HTMLElement;
    // The header draws other tab stops (the record chip's copy / star); walk
    // the real tab order to the trigger rather than assume its position.
    for (let i = 0; i < 10 && document.activeElement !== trigger; i += 1) await user.tab();
    expect(trigger).toHaveFocus();
    expect(describedBy(trigger)).toHaveTextContent(REASON_EN);
    expect(await screen.findByRole('tooltip')).toHaveTextContent(REASON_EN);
  });

  it('overflow: the disabled item shows the reason and is described by it, its name stays the label', async () => {
    const user = userEvent.setup();
    mount([ARCHIVE_MORE], { done: false });
    await user.click(screen.getByRole('button', { name: /More actions/i }));
    const item = await screen.findByRole('menuitem', { name: 'Archive later' });
    expect(item).toHaveAttribute('data-disabled');
    expect(describedBy(item)).toHaveTextContent(REASON_EN);
    expect(describedBy(item)).toBeVisible();
  });

  it('control — the predicate does not hold: inline and overflow are live and say nothing', async () => {
    const user = userEvent.setup();
    mount([ARCHIVE, ARCHIVE_MORE], { done: true });
    const button = screen.getByRole('button', { name: 'Archive' });
    expect(button).not.toBeDisabled();
    expect(button).not.toHaveAttribute('aria-describedby');
    expect(button.parentElement).not.toHaveAttribute('data-disabled-reason');
    await user.click(screen.getByRole('button', { name: /More actions/i }));
    const item = await screen.findByRole('menuitem', { name: 'Archive later' });
    expect(item).not.toHaveAttribute('data-disabled');
    expect(item).not.toHaveAttribute('aria-describedby');
    expect(screen.queryByText(REASON_EN)).toBeNull();
  });

  it("control — the host's Edit and Delete keep their host-computed `disabled` and give no reason", async () => {
    const user = userEvent.setup();
    mount([ARCHIVE], { done: true }, { host: [HOST_EDIT, HOST_DELETE] });
    const edit = screen.getByRole('button', { name: 'Edit' });
    expect(edit).toBeDisabled();
    expect(edit).not.toHaveAttribute('aria-describedby');
    expect(edit.parentElement).not.toHaveAttribute('data-disabled-reason');
    await user.click(screen.getByRole('button', { name: /More actions/i }));
    const del = await screen.findByRole('menuitem', { name: 'Delete' });
    expect(del).toHaveAttribute('data-disabled');
    expect(del).not.toHaveAttribute('aria-describedby');
    expect(screen.queryByText(REASON_EN)).toBeNull();
  });

  it('the reason comes from the language pack — zh', async () => {
    mount([ARCHIVE], { done: false }, {
      wrap: (node) => (
        <I18nProvider config={{ defaultLanguage: 'zh', detectBrowserLanguage: false }} persistLanguage={false}>
          {node}
        </I18nProvider>
      ),
    });
    const reason = await screen.findByText(REASON_ZH);
    const button = screen.getByRole('button', { name: 'Archive' });
    expect(button).toBeDisabled();
    expect(describedBy(button)).toBe(reason);
    expect(screen.queryByText(REASON_EN)).toBeNull();
  });
});
