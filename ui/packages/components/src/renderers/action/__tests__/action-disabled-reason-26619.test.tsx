/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#26619 — an `action:*` control greyed out by its declared
 * `disabled` predicate says the reason its author DECLARED, `disabledReason`,
 * where objectui#11839 made it say the generic one. "Not available for this
 * record" stays the answer when the action declares none, or a blank one.
 *
 * The four renderers read the action as authored, so the translation they
 * honour is the inline locale map, collapsed to the active language. The
 * sibling suite (`action-disabled-reason-11839.test.tsx`) pins the mechanics
 * (wrapper, tooltip, keyboard reach, the controls that give no reason); this
 * one pins the text.
 */

import * as React from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom';
import { ComponentRegistry } from '@object-ui/core';
import type { ActionResult } from '@object-ui/core';
import { ActionProvider } from '@object-ui/react';
import { I18nProvider } from '@object-ui/i18n';
// Module-scope side-effect imports (object-ui/no-dynamic-import-in-test-hook).
import '../action-button';
import '../action-icon';
import '../action-group';
import '../action-menu';

const DEFAULT_EN = 'Not available for this record';
const DEFAULT_ZH = '对此记录不可用';
const DECLARED_EN = 'Finish the checklist before archiving.';
const DECLARED_ZH = '请先完成检查清单再归档。';
const DONE_GATE = { dialect: 'cel', source: 'has(record.done) && record.done != true' };
const OPEN_TASK = { id: 't-1', done: false };
const DONE_TASK = { id: 't-1', done: true };

const ARCHIVE = { name: 'archive', label: 'Archive', icon: 'archive', type: 'script', disabled: DONE_GATE };
const VIEW = { name: 'view', label: 'View', type: 'script' };

afterEach(() => cleanup());

function getRenderer(type: string) {
  const R = ComponentRegistry.get(type);
  if (!R) throw new Error(`${type} is not registered`);
  return R;
}

function mount(node: React.ReactElement, opts: { zh?: boolean } = {}) {
  const tree = (
    <ActionProvider handlers={{ script: () => new Promise<ActionResult>(() => {}) }}>{node}</ActionProvider>
  );
  return render(
    opts.zh ? (
      <I18nProvider config={{ defaultLanguage: 'zh', detectBrowserLanguage: false }} persistLanguage={false}>
        {tree}
      </I18nProvider>
    ) : (
      tree
    ),
  );
}

/** The text of every element the control's `aria-describedby` names. */
const description = (el: Element) =>
  (el.getAttribute('aria-describedby') ?? '')
    .split(/\s+/)
    .filter(Boolean)
    .map((id) => document.getElementById(id)?.textContent ?? `(missing #${id})`)
    .join(' | ');

type Node = (action: Record<string, unknown>, record: Record<string, unknown>) => React.ReactElement;

const BUTTON_SITES: { id: string; node: Node }[] = [
  {
    id: 'action:button',
    node: (action, record) => {
      const R = getRenderer('action:button');
      return <R schema={{ ...action, type: 'action:button', actionType: 'script' }} data={record} />;
    },
  },
  {
    id: 'action:icon',
    node: (action, record) => {
      const R = getRenderer('action:icon');
      return <R schema={{ ...action, type: 'action:icon', actionType: 'script' }} data={record} />;
    },
  },
  {
    id: 'action:group inline member',
    node: (action, record) => {
      const R = getRenderer('action:group');
      return <R schema={{ type: 'action:group', display: 'inline', actions: [action, VIEW] }} data={record} />;
    },
  },
];

const MENU_SITES: { id: string; trigger: RegExp; node: Node }[] = [
  {
    id: 'action:menu item',
    trigger: /More/,
    node: (action, record) => {
      const R = getRenderer('action:menu');
      return <R schema={{ type: 'action:menu', label: 'More', actions: [VIEW, action] }} data={record} />;
    },
  },
  {
    id: 'action:group dropdown member',
    trigger: /Group menu/,
    node: (action, record) => {
      const R = getRenderer('action:group');
      return (
        <R schema={{ type: 'action:group', display: 'dropdown', label: 'Group menu', actions: [VIEW, action] }} data={record} />
      );
    },
  },
];

const archiveButton = () => screen.getByRole('button', { name: 'Archive' });

describe.each(BUTTON_SITES)('$id — the declared reason is the one it gives (objectstack#26619)', (site) => {
  it('a declared string is the accessible description and the tooltip', async () => {
    const user = userEvent.setup();
    mount(site.node({ ...ARCHIVE, disabledReason: DECLARED_EN }, OPEN_TASK));
    const button = archiveButton();
    expect(button).toBeDisabled();
    expect(description(button)).toBe(DECLARED_EN);
    await user.hover(button.parentElement as HTMLElement);
    const tooltip = await screen.findByRole('tooltip');
    expect(tooltip).toHaveTextContent(DECLARED_EN);
    expect(tooltip).not.toHaveTextContent(DEFAULT_EN);
  });

  it('an inline locale map collapses to the active language — zh', () => {
    mount(site.node({ ...ARCHIVE, disabledReason: { en: DECLARED_EN, 'zh-CN': DECLARED_ZH } }, OPEN_TASK), { zh: true });
    expect(description(archiveButton())).toBe(DECLARED_ZH);
  });

  it('no declared reason: the default stays — en and zh', () => {
    mount(site.node(ARCHIVE, OPEN_TASK));
    expect(description(archiveButton())).toBe(DEFAULT_EN);
    cleanup();
    mount(site.node(ARCHIVE, OPEN_TASK), { zh: true });
    expect(description(archiveButton())).toBe(DEFAULT_ZH);
  });

  it('a map whose entry for the language is blank falls back to the default', () => {
    mount(site.node({ ...ARCHIVE, disabledReason: { en: '  ' } }, OPEN_TASK));
    expect(description(archiveButton())).toBe(DEFAULT_EN);
  });

  it('a map with no entry for the language shows an authored entry (the `pickLocalized` chain), not the default', () => {
    mount(site.node({ ...ARCHIVE, disabledReason: { en: DECLARED_EN } }, OPEN_TASK), { zh: true });
    expect(description(archiveButton())).toBe(DECLARED_EN);
  });

  it('control — the predicate does not hold: the declared reason is not shown', () => {
    mount(site.node({ ...ARCHIVE, disabledReason: DECLARED_EN }, DONE_TASK));
    const button = archiveButton();
    expect(button).not.toBeDisabled();
    expect(button).not.toHaveAttribute('aria-describedby');
    expect(screen.queryByText(DECLARED_EN)).toBeNull();
  });
});

describe.each(MENU_SITES)('$id — the declared reason is the item\'s second line (objectstack#26619)', (site) => {
  async function openItem(user: ReturnType<typeof userEvent.setup>) {
    await user.click(screen.getByRole('button', { name: site.trigger }));
    return screen.findByRole('menuitem', { name: 'Archive' });
  }

  it('a declared string is the visible second line and the description; the name stays the label', async () => {
    const user = userEvent.setup();
    mount(site.node({ ...ARCHIVE, disabledReason: DECLARED_EN }, OPEN_TASK));
    const item = await openItem(user);
    expect(item).toHaveAttribute('data-disabled');
    expect(item).toHaveAccessibleName('Archive');
    expect(description(item)).toBe(DECLARED_EN);
    expect(screen.getByText(DECLARED_EN)).toBeVisible();
  });

  it('no declared reason: the default stays', async () => {
    const user = userEvent.setup();
    mount(site.node(ARCHIVE, OPEN_TASK));
    expect(description(await openItem(user))).toBe(DEFAULT_EN);
  });

  it('control — the predicate does not hold: the declared reason is not shown', async () => {
    const user = userEvent.setup();
    mount(site.node({ ...ARCHIVE, disabledReason: DECLARED_EN }, DONE_TASK));
    const item = await openItem(user);
    expect(item).not.toHaveAttribute('data-disabled');
    expect(screen.queryByText(DECLARED_EN)).toBeNull();
  });
});
