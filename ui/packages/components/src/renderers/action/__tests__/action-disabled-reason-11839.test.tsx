/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#11839 — an `action:*` control greyed out by its declared `disabled`
 * predicate says why, the way objectui#11811 made `page:header`,
 * `record:quick_actions` and `DeclaredActionsBar` say it.
 *
 * Before the fix all four renderers drew the control disabled with no tooltip,
 * no `title` and no `aria-describedby`. A natively disabled button (with the
 * Button primitive's `disabled:pointer-events-none`) never fires the hover or
 * focus a tooltip needs, and a disabled menu item takes no pointer events and is
 * skipped by the menu's roving focus.
 *
 * - A button (`action:button`, `action:icon`, `action:group` inline) gets a
 *   focusable wrapper span as the tooltip trigger, and a persistent `sr-only`
 *   description the button and the span both point at.
 * - A menu item (`action:menu`, `action:group` dropdown) shows the reason as a
 *   visible second line that is its description; its name stays the label.
 *
 * Only the DECLARED `disabled` predicate, evaluated true, earns the reason. The
 * controls pin the rest: a predicate that does not hold, an action in flight,
 * the host's forwarded `disabled`, and the legacy non-spec `enabled` leg each
 * leave the control as it was.
 *
 * The predicate is the served shape, the `{ dialect: 'cel', source }` envelope
 * the spec normalizes an authored CEL string to: the bare string goes to the
 * legacy evaluator, where `has()` faults. Nothing is stubbed: the real
 * renderers, the real Radix tooltip and menu, and the real zh pack.
 */

import * as React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom';
import { ComponentRegistry } from '@object-ui/core';
import type { ActionResult } from '@object-ui/core';
import { ActionProvider } from '@object-ui/react';
import { I18nProvider } from '@object-ui/i18n';
// Module-scope side-effect imports so the four renderers are registered before
// the first render — the light `dom` project does not load the
// `@object-ui/components` graph. Module scope, not a `beforeAll`
// (object-ui/no-dynamic-import-in-test-hook, objectui#3010).
import '../action-button';
import '../action-icon';
import '../action-group';
import '../action-menu';

const REASON_EN = 'Not available for this record';
const REASON_ZH = '对此记录不可用';
const DONE_GATE = { dialect: 'cel', source: 'has(record.done) && record.done != true' };
/** The predicate holds: the task is not done, so Archive is unavailable. */
const OPEN_TASK = { id: 't-1', done: false };
/** The predicate does not hold. */
const DONE_TASK = { id: 't-1', done: true };

const ARCHIVE = { name: 'archive', label: 'Archive', icon: 'archive', type: 'script', disabled: DONE_GATE };
const VIEW = { name: 'view', label: 'View', type: 'script' };
/** No `disabled`: the legacy non-spec `enabled` leg alone disables it. */
const LEGACY_DISABLED = { name: 'archive', label: 'Archive', icon: 'archive', type: 'script', enabled: false };
/** No gate at all: the control a click puts in flight. */
const UNGATED = { name: 'archive', label: 'Archive', icon: 'archive', type: 'script' };

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function getRenderer(type: string) {
  const R = ComponentRegistry.get(type);
  if (!R) throw new Error(`${type} is not registered`);
  return R;
}

/** A `script` handler that stays in flight, so a click leaves its control loading. */
const pendingScript = () => vi.fn(() => new Promise<ActionResult>(() => {}));

function mount(
  node: React.ReactElement,
  opts: { script?: ReturnType<typeof pendingScript>; zh?: boolean } = {},
) {
  const tree = <ActionProvider handlers={{ script: opts.script ?? pendingScript() }}>{node}</ActionProvider>;
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

// ---------------------------------------------------------------------------
// The three BUTTON renderings
// ---------------------------------------------------------------------------

interface ButtonSite {
  id: string;
  /** Mounts `action` over `record`; `hostDisabled` is the host's forwarded verdict. */
  node: (action: Record<string, unknown>, record: Record<string, unknown>, hostDisabled?: boolean) => React.ReactElement;
  /** The accessible name of the drawn control. */
  name: string;
}

const BUTTON_SITES: ButtonSite[] = [
  {
    id: 'action:button',
    name: 'Archive',
    node: (action, record, hostDisabled) => {
      const R = getRenderer('action:button');
      return <R schema={{ ...action, type: 'action:button', actionType: 'script' }} data={record} disabled={hostDisabled} />;
    },
  },
  {
    // An icon has no visible label: its name is its `aria-label`, which stays.
    id: 'action:icon',
    name: 'Archive',
    node: (action, record, hostDisabled) => {
      const R = getRenderer('action:icon');
      return <R schema={{ ...action, type: 'action:icon', actionType: 'script' }} data={record} disabled={hostDisabled} />;
    },
  },
  {
    // The group's host verdict reaches every member it draws (objectui#11182).
    id: 'action:group inline member',
    name: 'Archive',
    node: (action, record, hostDisabled) => {
      const R = getRenderer('action:group');
      return (
        <R
          schema={{ type: 'action:group', display: 'inline', actions: [action, VIEW] }}
          data={record}
          disabled={hostDisabled}
        />
      );
    },
  },
];

const control = (name: string) => screen.getByRole('button', { name }) as HTMLButtonElement;

/** The control drew no reason: no description, no wrapper, no reason text. */
function expectNoReason(button: HTMLElement) {
  expect(button).not.toHaveAttribute('aria-describedby');
  expect(button.parentElement).not.toHaveAttribute('data-disabled-reason');
  expect(screen.queryByText(REASON_EN)).toBeNull();
}

describe.each(BUTTON_SITES)('$id — a predicate-disabled button says why (objectui#11839)', (site) => {
  it('the disabled button carries the reason as its accessible description', () => {
    mount(site.node(ARCHIVE, OPEN_TASK));
    const button = control(site.name);
    expect(button).toBeDisabled();
    expect(description(button)).toBe(REASON_EN);
  });

  it('hovering it opens a tooltip with the reason', async () => {
    const user = userEvent.setup();
    mount(site.node(ARCHIVE, OPEN_TASK));
    const trigger = control(site.name).parentElement as HTMLElement;
    expect(trigger).toHaveAttribute('data-disabled-reason');
    await user.hover(trigger);
    expect(await screen.findByRole('tooltip')).toHaveTextContent(REASON_EN);
  });

  it('a keyboard user reaches it: Tab lands on the trigger, which is described by the reason and opens the tooltip', async () => {
    const user = userEvent.setup();
    mount(site.node(ARCHIVE, OPEN_TASK));
    const trigger = control(site.name).parentElement as HTMLElement;
    for (let i = 0; i < 6 && document.activeElement !== trigger; i += 1) await user.tab();
    expect(trigger).toHaveFocus();
    expect(description(trigger)).toBe(REASON_EN);
    expect(await screen.findByRole('tooltip')).toHaveTextContent(REASON_EN);
  });

  it('control — the predicate does not hold: the button is live and says nothing', () => {
    mount(site.node(ARCHIVE, DONE_TASK));
    const button = control(site.name);
    expect(button).not.toBeDisabled();
    expectNoReason(button);
  });

  it('control — an action in flight: the loading button gives no reason', async () => {
    const user = userEvent.setup();
    const script = pendingScript();
    mount(site.node(UNGATED, OPEN_TASK), { script });
    await user.click(control(site.name));
    await waitFor(() => expect(script).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(control(site.name)).toBeDisabled());
    expect(control(site.name).querySelector('.animate-spin')).not.toBeNull();
    expectNoReason(control(site.name));
  });

  it("control — the host's forwarded `disabled`: disabled, with no reason", () => {
    mount(site.node(UNGATED, OPEN_TASK, true));
    const button = control(site.name);
    expect(button).toBeDisabled();
    expectNoReason(button);
  });

  it('control — the legacy `enabled: false` leg: disabled, with no reason', () => {
    mount(site.node(LEGACY_DISABLED, OPEN_TASK));
    const button = control(site.name);
    expect(button).toBeDisabled();
    expectNoReason(button);
  });
});

describe('action:icon — the reason is the description, the label stays the name (objectui#11839)', () => {
  it('the tooltip names the action above the reason, since the icon has no visible label', async () => {
    const user = userEvent.setup();
    mount(BUTTON_SITES[1].node(ARCHIVE, OPEN_TASK));
    const button = control('Archive');
    expect(button).toHaveAttribute('aria-label', 'Archive');
    await user.hover(button.parentElement as HTMLElement);
    const tooltip = await screen.findByRole('tooltip');
    expect(tooltip).toHaveTextContent('Archive');
    expect(tooltip).toHaveTextContent(REASON_EN);
  });
});

describe('action:button — an authored description is kept beside the reason (objectui#11839)', () => {
  it('`aria-describedby` from the DOM pass-through and the reason are both on the button', () => {
    const R = getRenderer('action:button');
    mount(
      <>
        <p id="authored-note">Archiving hides the task</p>
        <R
          schema={{ ...ARCHIVE, type: 'action:button', actionType: 'script' }}
          data={OPEN_TASK}
          aria-describedby="authored-note"
        />
      </>,
    );
    expect(description(control('Archive'))).toBe(`Archiving hides the task | ${REASON_EN}`);
  });
});

// ---------------------------------------------------------------------------
// The two MENU-ITEM renderings
// ---------------------------------------------------------------------------

interface MenuSite {
  id: string;
  node: (action: Record<string, unknown>, record: Record<string, unknown>) => React.ReactElement;
  /** The accessible name of the menu's trigger. */
  trigger: RegExp;
}

const MENU_SITES: MenuSite[] = [
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
        <R
          schema={{ type: 'action:group', display: 'dropdown', label: 'Group menu', actions: [VIEW, action] }}
          data={record}
        />
      );
    },
  },
];

async function openItem(user: ReturnType<typeof userEvent.setup>, site: MenuSite) {
  await user.click(screen.getByRole('button', { name: site.trigger }));
  return screen.findByRole('menuitem', { name: 'Archive' });
}

describe.each(MENU_SITES)('$id — a predicate-disabled menu item says why (objectui#11839)', (site) => {
  it('the disabled item shows the reason and is described by it; its name stays the label', async () => {
    const user = userEvent.setup();
    mount(site.node(ARCHIVE, OPEN_TASK));
    const item = await openItem(user, site);
    expect(item).toHaveAttribute('data-disabled');
    expect(item).toHaveAccessibleName('Archive');
    expect(description(item)).toBe(REASON_EN);
    expect(document.getElementById(item.getAttribute('aria-describedby') as string)).toBeVisible();
  });

  it('control — the predicate does not hold: the item is live and says nothing', async () => {
    const user = userEvent.setup();
    mount(site.node(ARCHIVE, DONE_TASK));
    const item = await openItem(user, site);
    expect(item).not.toHaveAttribute('data-disabled');
    expect(item).not.toHaveAttribute('aria-describedby');
    expect(screen.queryByText(REASON_EN)).toBeNull();
  });

  it('control — the legacy `enabled: false` leg: disabled, with no reason', async () => {
    const user = userEvent.setup();
    mount(site.node(LEGACY_DISABLED, OPEN_TASK));
    const item = await openItem(user, site);
    expect(item).toHaveAttribute('data-disabled');
    expect(item).not.toHaveAttribute('aria-describedby');
    expect(screen.queryByText(REASON_EN)).toBeNull();
  });
});

describe("action:menu — the host's forwarded `disabled` on the trigger gives no reason (objectui#11839)", () => {
  it('the host-disabled trigger is disabled and undescribed', () => {
    const R = getRenderer('action:menu');
    mount(<R schema={{ type: 'action:menu', label: 'More', actions: [VIEW, ARCHIVE] }} data={OPEN_TASK} disabled />);
    const trigger = screen.getByRole('button', { name: 'More' });
    expect(trigger).toBeDisabled();
    expectNoReason(trigger);
  });
});

// ---------------------------------------------------------------------------
// The text comes from the language pack
// ---------------------------------------------------------------------------

describe('the reason comes from the language pack — zh (objectui#11839)', () => {
  it('action:button', async () => {
    mount(BUTTON_SITES[0].node(ARCHIVE, OPEN_TASK), { zh: true });
    const reason = await screen.findByText(REASON_ZH);
    const button = control('Archive');
    expect(button).toBeDisabled();
    expect(document.getElementById(button.getAttribute('aria-describedby') as string)).toBe(reason);
    expect(screen.queryByText(REASON_EN)).toBeNull();
  });

  it('action:menu item', async () => {
    const user = userEvent.setup();
    mount(MENU_SITES[0].node(ARCHIVE, OPEN_TASK), { zh: true });
    const item = await openItem(user, MENU_SITES[0]);
    await waitFor(() => expect(description(item)).toBe(REASON_ZH));
    expect(screen.queryByText(REASON_EN)).toBeNull();
  });
});
