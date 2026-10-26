/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The runner's header chrome reads nothing off the app's `actions` array
 * (objectui#7469, maintainer ruling C: retire the `actions` member of
 * `AppComponentSchema`, `AppAction` and `AppActionSchema`, and the runner's
 * rendering of them).
 *
 * Before the ruling `LayoutRenderer` drew three things off that array: a
 * toolbar button per `'button'` entry, an avatar dropdown per `'user'` entry,
 * and — the rule that made the chrome depend on metadata at all — the hardcoded
 * Bell ONLY when no `'button'` entry was authored. The array is now refused by
 * name on both faces of `@object-ui/types`, so the chrome keeps one rule: the
 * Bell is always drawn, exactly as it was for an app with no `'button'` action.
 *
 * The documents below carry the retired array anyway, cast past the type —
 * what a stale `app.json` handed straight to the runner would hold, since the
 * runner loads its document without the validator. Each assertion compares
 * against the SAME app without the array, so a row cannot pass by the header
 * rendering nothing at all.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup, within } from '@testing-library/react';
import type { AppComponentSchema } from '@object-ui/types';

// Static, module-scope import: `LayoutRenderer` pulls `@object-ui/components`
// in, and that cost must not land inside a test's timeout budget (AGENTS.md
// 测试纪律).
import { LayoutRenderer } from '../LayoutRenderer';

afterEach(() => cleanup());

const BASE_APP: AppComponentSchema = {
  type: 'app',
  name: 'pin_app',
  title: 'Pin App',
  layout: 'header',
};

/** Every arm the retired renderer honoured: a `'button'` (which also used to
 *  suppress the Bell) and a `'user'` avatar menu with items. */
const RETIRED_ACTIONS = [
  { type: 'button', label: 'Quick Actions', icon: 'zap', variant: 'outline' },
  {
    type: 'user',
    label: 'Ada Lovelace',
    description: 'ada@example.com',
    items: [{ type: 'item', label: 'Profile', path: '/profile' }],
  },
];

const withRetiredActions = (): AppComponentSchema =>
  ({ ...BASE_APP, actions: RETIRED_ACTIONS }) as unknown as AppComponentSchema;

function header(app: AppComponentSchema): HTMLElement {
  const { container } = render(
    <LayoutRenderer app={app}>
      <div>page body</div>
    </LayoutRenderer>,
  );
  const el = container.querySelector('header');
  if (!el) throw new Error('LayoutRenderer drew no <header> for a `header` layout');
  return el;
}

const bellsIn = (el: HTMLElement) => el.querySelectorAll('svg.lucide-bell').length;

describe('LayoutRenderer chrome keeps one rule: the Bell is unconditional (objectui#7469)', () => {
  it('CONTROL — an app with no `actions` draws the header and exactly one Bell', () => {
    const el = header(BASE_APP);
    // The theme toggle is the header's own control: it proves the header
    // rendered, so a zero below cannot be an empty render.
    expect(within(el).getByTitle('Switch to dark mode')).toBeTruthy();
    expect(bellsIn(el)).toBe(1);
  });

  it('an authored `\'button\'` action no longer suppresses the Bell', () => {
    expect(bellsIn(header(withRetiredActions()))).toBe(1);
  });

  it('no retired `\'button\'` entry is drawn as a toolbar button', () => {
    const el = header(withRetiredActions());
    expect(within(el).queryByTitle('Quick Actions')).toBeNull();
    expect(el.textContent).not.toContain('Quick Actions');
  });

  it('no retired `\'user\'` entry is drawn as an avatar menu', () => {
    const el = header(withRetiredActions());
    // The old trigger's accessible name was the label's initials.
    expect(within(el).queryByRole('button', { name: 'AD' })).toBeNull();
    expect(el.textContent).not.toContain('Ada Lovelace');
  });

  it('the header with the retired array is button-for-button the header without it', () => {
    const without = within(header(BASE_APP)).getAllByRole('button').length;
    cleanup();
    const withArray = within(header(withRetiredActions())).getAllByRole('button').length;
    expect(without).toBeGreaterThan(0);
    expect(withArray).toBe(without);
  });

  it('the page body still renders beside the chrome', () => {
    header(withRetiredActions());
    expect(screen.getByText('page body')).toBeTruthy();
  });
});
