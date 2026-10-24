/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Dashboard header: action dispatch, and when the header wrapper exists at all.
 *
 * 1. Header actions must reach the ActionRunner, whatever their type. The click
 *    handler used to allow-list `modal` / `script` only: a `url` action
 *    navigated, those two dispatched, and EVERY other declared type — `flow`,
 *    `api`, `form`, `navigation` — fell through to a `console.warn` and did
 *    nothing at all. A screen flow could not even be launched from a dashboard
 *    (framework#3528). The runner owns the type registry, so the renderer no
 *    longer second-guesses it. Since objectui#12275 that includes `url`, which
 *    kept a url grammar of its own here until then; its navigation pins are in
 *    `DashboardRenderer.headerActionUrl-12275.test.tsx`.
 *
 * 2. The header wrapper must cost zero pixels when every child is suppressed.
 *    It used to render whenever `header` was merely declared, while each child
 *    was additionally gated on `!hideHeaderText` — the flag the console page
 *    chrome sets because it already renders the dashboard's title and
 *    description. Chrome present + no `header.actions` therefore emitted
 *    `<div class="col-span-full mb-4"></div>`: zero children, but a full grid
 *    row (measured 64px) plus `mb-4` above the filter bar, on every console
 *    dashboard page (objectui#5812).
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { DashboardComponentSchema } from '@object-ui/types';
import { ActionProvider } from '@object-ui/react';
import { I18nProvider } from '@object-ui/i18n';
import { DashboardRenderer } from '../DashboardRenderer';

afterEach(cleanup);

function dashboardWith(actionType: string): DashboardComponentSchema {
  return {
    type: 'dashboard',
    // `label`, not the retired root `title` (objectui#7509) — the header's name
    // source. Nothing here asserts it; renamed so this file's fixtures spell
    // the one live key, alongside `textHeaderDashboard` below whose assertions
    // DO read it.
    label: 'Ops',
    widgets: [],
    header: {
      actions: [{ label: 'Convert Lead', actionUrl: 'convert_lead_wizard', actionType }],
    },
  } as unknown as DashboardComponentSchema;
}

describe('DashboardRenderer header actions', () => {
  it.each(['flow', 'api', 'form', 'url'])('dispatches a %s header action to its handler', async (actionType) => {
    const handler = vi.fn().mockResolvedValue({ success: true });
    render(
      <ActionProvider handlers={{ [actionType]: handler }}>
        <DashboardRenderer schema={dashboardWith(actionType)} />
      </ActionProvider>,
    );

    await userEvent.setup().click(screen.getByRole('button', { name: /Convert Lead/i }));

    await waitFor(() => expect(handler).toHaveBeenCalledTimes(1));
    // The runner resolves the flow/endpoint from the action's own target.
    expect(handler.mock.calls[0][0]).toMatchObject({ type: actionType, target: 'convert_lead_wizard' });
  });

});

/**
 * A header action's `label` is the spec's `I18nLabel` — a plain string OR an
 * inline per-locale map (`DashboardHeaderActionSchema.label`), and the zod
 * mirror has always admitted the map because it takes the spec's `header` by
 * reference. The TypeScript twin restated it as `string` until objectui#7759
 * group A, so this read site handed the authored value straight to React: an
 * unnamed dashboard rendered the map as a button child, a named one passed it
 * as the bundle lookup's `fallback`. Both render the resolved string now.
 */
function localizedActionDashboard(name?: string): DashboardComponentSchema {
  return {
    type: 'dashboard',
    ...(name ? { name } : {}),
    label: 'Ops',
    widgets: [],
    header: {
      actions: [{
        label: { en: 'Convert Lead', 'zh-CN': '转换线索' },
        actionUrl: 'convert_lead_wizard',
        actionType: 'flow',
      }],
    },
  } satisfies DashboardComponentSchema;
}

describe('DashboardRenderer header actions — inline per-locale label (objectui#7759)', () => {
  it.each([
    ['an unnamed dashboard', undefined],
    ['a named dashboard with no bundle entry', 'ops_board'],
  ])('renders the active-language string for %s, and dispatches by actionUrl', async (_what, name) => {
    const handler = vi.fn().mockResolvedValue({ success: true });
    render(
      <I18nProvider config={{ defaultLanguage: 'zh', detectBrowserLanguage: false, resources: {} }}>
        <ActionProvider handlers={{ flow: handler }}>
          <DashboardRenderer schema={localizedActionDashboard(name)} />
        </ActionProvider>
      </I18nProvider>,
    );

    const button = screen.getByRole('button', { name: '转换线索' });
    expect(button.textContent).not.toContain('[object Object]');
    await userEvent.setup().click(button);
    await waitFor(() => expect(handler).toHaveBeenCalledTimes(1));
    expect(handler.mock.calls[0][0]).toMatchObject({ type: 'flow', target: 'convert_lead_wizard' });
  });
});

/**
 * A dashboard authored the way the flagship exemplar authors them: `header`
 * declared with both text flags ON, because a standalone embed genuinely does
 * render the title and description. The console page chrome then suppresses
 * that text with `hideHeaderText` — it renders it itself.
 */
function textHeaderDashboard(
  header: Record<string, unknown> = { showTitle: true, showDescription: true },
): DashboardComponentSchema {
  return {
    type: 'dashboard',
    // `label` is the header's ONE name source since the root `title` arm
    // retired (objectui#7509, ADR-0049). This fixture pins the header WRAPPER's
    // geometry, not the spelling of the name — so the key moves and every
    // assertion below stands unchanged, which is what makes it a rename rather
    // than a rewrite.
    label: 'Executive Dashboard',
    description: 'Pipeline and revenue at a glance',
    widgets: [],
    header,
  } as unknown as DashboardComponentSchema;
}

/** The header wrapper's own signature — `mb-2` belongs to the filter bar. */
const HEADER_WRAPPER = '.col-span-full.mb-4';

describe('DashboardRenderer header wrapper', () => {
  it('emits no wrapper when the console chrome suppresses the text and no actions are declared', () => {
    const { container } = render(
      <DashboardRenderer schema={textHeaderDashboard()} hideHeaderText />,
    );

    expect(container.querySelector(HEADER_WRAPPER)).toBeNull();
    expect(screen.queryByText('Executive Dashboard')).toBeNull();
    expect(screen.queryByText('Pipeline and revenue at a glance')).toBeNull();

    // Zero pixels, not merely zero text. With no filters, no `onRefresh` and no
    // widgets, a collapsed header leaves the dashboard root with no children at
    // all; the empty node used to sit here and claim a whole grid row.
    const root = container.firstElementChild;
    expect(root).not.toBeNull();
    expect(root!.children.length).toBe(0);
  });

  it('still renders title and description for a standalone embed', () => {
    const { container } = render(<DashboardRenderer schema={textHeaderDashboard()} />);

    const wrapper = container.querySelector(HEADER_WRAPPER);
    expect(wrapper).not.toBeNull();
    expect(screen.getByText('Executive Dashboard')).toBeTruthy();
    expect(screen.getByText('Pipeline and revenue at a glance')).toBeTruthy();
  });

  it('keeps the wrapper for declared header actions even under the console chrome', () => {
    const schema = textHeaderDashboard({
      showTitle: true,
      showDescription: true,
      actions: [{ label: 'New Report', actionUrl: '/reports/new', actionType: 'url' }],
    });

    const { container } = render(<DashboardRenderer schema={schema} hideHeaderText />);

    // The chrome renders the dashboard's text, never its actions — so the
    // wrapper survives, carrying the buttons and nothing else.
    expect(container.querySelector(HEADER_WRAPPER)).not.toBeNull();
    expect(screen.getByRole('button', { name: /New Report/i })).toBeTruthy();
    expect(screen.queryByText('Executive Dashboard')).toBeNull();
  });

  it('emits no wrapper for a standalone embed that authored both text flags off', () => {
    const { container } = render(
      <DashboardRenderer schema={textHeaderDashboard({ showTitle: false, showDescription: false })} />,
    );

    expect(container.querySelector(HEADER_WRAPPER)).toBeNull();
    expect(screen.queryByText('Executive Dashboard')).toBeNull();
  });
});
