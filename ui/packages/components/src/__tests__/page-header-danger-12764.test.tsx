/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#12764: `page:header` reads the spec's `variant: 'danger'` as
 * destructive.
 *
 * `@objectstack/spec`'s action `variant` enum is `primary | secondary | danger
 * | ghost | link` ("danger = destructive"). The header read destructive only
 * as Shadcn's `destructive` or the host's `sys_delete`, so a `danger` action
 * (a "Leave organization") placed first drew as the filled primary, had no
 * red row and no separator in the `⋯`. Now:
 *
 *   - a `danger` action is never the filled primary;
 *   - shown inline, it draws Shadcn's `destructive` button;
 *   - folded into the `⋯`, it is a red row in the destructive band, below a
 *     separator;
 *   - CONTROL: the host's `sys_delete` and the non-destructive actions keep
 *     their placement and style.
 *
 * Styles are read off the Button primitive's own variant classes
 * (`bg-primary` for `default`, `bg-destructive` for `destructive`,
 * `border-input` for `outline`).
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ComponentRegistry } from '@object-ui/core';
import { ActionProvider, RecordContextProvider } from '@object-ui/react';
// Registers `page:header` at module scope rather than in a hook
// (object-ui/no-dynamic-import-in-test-hook, objectui#3010).
import '../renderers';

function PageHeader({ schema }: { schema: any }) {
  const Component = ComponentRegistry.get('page:header');
  if (!Component) throw new Error('page:header not registered');
  // eslint-disable-next-line react-hooks/static-components -- ComponentRegistry.get returns a registered component (stable), not one created during render
  return <Component schema={schema} />;
}

const ORG = { id: 'org-1', name: 'Acme' };

// The record page's host actions, as `RecordDetailView` injects them.
const HOST_ACTIONS = [
  { name: 'sys_edit', label: 'Edit', icon: 'pencil', order: 100, onClick: vi.fn() },
  { name: 'sys_share', label: 'Share', order: 110, component: 'action:menu', onClick: vi.fn() },
  { name: 'sys_delete', label: 'Delete', order: 120, variant: 'destructive', component: 'action:menu', onClick: vi.fn() },
];

function renderHeader(actions: any[], extra: Record<string, unknown> = {}) {
  return render(
    <ActionProvider>
      <RecordContextProvider
        objectName="sys_organization"
        recordId={ORG.id}
        data={ORG}
        objectSchema={{ name: 'sys_organization', label: 'Organization' }}
        headerSystemActions={HOST_ACTIONS}
      >
        <PageHeader schema={{ type: 'page:header', actions, ...extra }} />
      </RecordContextProvider>
    </ActionProvider>,
  );
}

const act = (name: string, label: string, extra: Record<string, unknown> = {}) => ({
  name,
  label,
  type: 'url',
  target: `https://example.com/${name}`,
  locations: ['record_header'],
  ...extra,
});

function rowButtons(): HTMLElement[] {
  const bar = screen.getByRole('toolbar', { name: /Page header actions/i });
  return Array.from(bar.querySelectorAll('button')).filter(
    (b) => b.getAttribute('aria-label') !== 'More actions',
  );
}

const nameOf = (b: HTMLElement) => (b.textContent ?? '').trim();
const hasClass = (el: Element, c: string) => el.className.split(/\s+/).includes(c);
const isFilled = (b: HTMLElement) => hasClass(b, 'bg-primary');
const isDestructiveButton = (b: HTMLElement) => hasClass(b, 'bg-destructive');
const isOutline = (b: HTMLElement) => hasClass(b, 'border-input');

/** The open `⋯` menu as an ordered list of rows and separators. */
async function overflowEntries(): Promise<Array<{ label: string; red: boolean } | '---'>> {
  const trigger = screen.getByRole('button', { name: 'More actions' });
  fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: 'mouse' });
  await waitFor(() => expect(screen.getByRole('menu')).toBeTruthy());
  const menu = screen.getByRole('menu');
  return Array.from(menu.querySelectorAll('[role="menuitem"], [role="separator"]')).map((el) =>
    el.getAttribute('role') === 'separator'
      ? '---'
      : { label: (el.textContent ?? '').trim(), red: hasClass(el, 'text-destructive') },
  );
}

describe("page:header reads the spec's variant 'danger' as destructive (objectui#12764)", () => {
  it('a danger action placed first is not the filled primary; it draws the destructive style inline', () => {
    renderHeader([
      act('leave_organization', 'Leave Organization', { variant: 'danger' }),
      act('invite_member', 'Invite Member'),
    ]);
    const buttons = rowButtons();
    expect(buttons.map(nameOf)).toEqual(['Invite Member', 'Leave Organization', 'Edit']);
    const [invite, leave, edit] = buttons;
    expect(isFilled(invite)).toBe(true);
    expect(isFilled(leave)).toBe(false);
    expect(isDestructiveButton(leave)).toBe(true);
    expect(isOutline(edit)).toBe(true);
    expect(buttons.filter(isFilled)).toHaveLength(1);
  });

  it('with only a danger action, the host Edit is the primary and the danger action stays destructive', () => {
    renderHeader([act('leave_organization', 'Leave Organization', { variant: 'danger' })]);
    const buttons = rowButtons();
    expect(buttons.map(nameOf)).toEqual(['Edit', 'Leave Organization']);
    expect(isFilled(buttons[0])).toBe(true);
    expect(isFilled(buttons[1])).toBe(false);
    expect(isDestructiveButton(buttons[1])).toBe(true);
  });

  it('folded into the ⋯, a danger action is a red row in the destructive band, below the separator', async () => {
    renderHeader(
      [
        act('invite_member', 'Invite Member'),
        act('transfer_ownership', 'Transfer Ownership'),
        act('leave_organization', 'Leave Organization', { variant: 'danger' }),
      ],
      { maxVisible: 2 },
    );
    expect(rowButtons().map(nameOf)).toEqual(['Invite Member', 'Transfer Ownership', 'Edit']);
    expect(await overflowEntries()).toEqual([
      { label: 'Share', red: false },
      '---',
      { label: 'Leave Organization', red: true },
      { label: 'Delete', red: true },
    ]);
  });

  it('CONTROL: without a danger action, sys_delete and the non-destructive actions keep their placement', async () => {
    renderHeader([
      act('invite_member', 'Invite Member'),
      act('transfer_ownership', 'Transfer Ownership'),
      act('export_members', 'Export Members'),
      act('audit_log', 'Audit Log'),
    ]);
    const buttons = rowButtons();
    expect(buttons.map(nameOf)).toEqual(['Invite Member', 'Transfer Ownership', 'Export Members', 'Edit']);
    expect(buttons.map(isFilled)).toEqual([true, false, false, false]);
    expect(buttons.slice(1).every(isOutline)).toBe(true);
    expect(buttons.some(isDestructiveButton)).toBe(false);
    expect(await overflowEntries()).toEqual([
      { label: 'Audit Log', red: false },
      { label: 'Share', red: false },
      '---',
      { label: 'Delete', red: true },
    ]);
  });
});
