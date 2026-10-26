/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Retirement pin — the dashboard-ROOT `title` read arm (objectui#7509).
 *
 * Maintainer ruling 2026-09-04 (decision batch #29, option C): the five root
 * `title` read arms retire together under ADR-0049, `label` is the only name
 * source. This file pins THIS surface's arm — the preview panel's `<h4>`, which
 * used to read `schema.title || t('appDesigner.dashboardPreview')` and now
 * reads `pickLocalized(schema.label, language) || …`.
 *
 * ⛔ This file's subject has NINE `.title` occurrences and EIGHT of them are the
 * widget-level `DashboardWidget.title` — the spec's `I18nLabel`, a different
 * DECLARED key with its own display/authoring split (`resolveWidgetTitle` /
 * `writeWidgetTitle`, objectui#4169 / #5301). Root and widget arms are told
 * apart by RECEIVER, never by grep: the last two cases here are the control
 * that the widget half survived intact, on BOTH its read and its write side.
 *
 * Shaped like the #5830 / #5852 retirements: what a document carrying the
 * retired key RENDERS, not that it compiles.
 */

import * as React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react';
import type { DashboardComponentSchema } from '@object-ui/types';
import { DashboardEditor } from '../DashboardEditor';

vi.mock('@object-ui/plugin-grid', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  ...(await import('./__mocks__/plugin-grid')),
}));
vi.mock('@object-ui/plugin-form', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  ...(await import('./__mocks__/plugin-form')),
}));

afterEach(cleanup);

const LEGACY_TITLE = 'Legacy Title From A Stored Document';
const CANONICAL_LABEL = 'Sales Overview';
/** The generic heading `useDesignerTranslation` resolves without a provider. */
const GENERIC_HEADING = 'Dashboard Preview';

const dash = (root: Record<string, unknown>): DashboardComponentSchema =>
  ({
    type: 'dashboard',
    name: 'sales',
    widgets: [{ id: 'w1', type: 'metric', title: 'Revenue' }],
    ...root,
  }) as unknown as DashboardComponentSchema;

/** Mount the editor and switch it into preview mode, where the panel lives. */
function renderPreview(schema: DashboardComponentSchema) {
  render(<DashboardEditor schema={schema} onChange={() => {}} />);
  fireEvent.click(screen.getByTestId('dashboard-preview-toggle'));
  return screen.getByTestId('dashboard-preview');
}

describe('DashboardEditor — the root `title` read arm is retired (objectui#7509)', () => {
  it('heads the preview with `label` for a document carrying BOTH, never with the `title`', () => {
    const panel = renderPreview(dash({ label: CANONICAL_LABEL, title: LEGACY_TITLE }));

    expect(within(panel).getByRole('heading', { level: 4 }).textContent).toBe(CANONICAL_LABEL);
    expect(screen.queryByText(LEGACY_TITLE)).toBeNull();
  });

  it('falls through to the generic heading for a document carrying ONLY the retired key', () => {
    // `label` is REQUIRED on DashboardSchema, so this document was already
    // invalid; it is pinned because a designer cannot refuse stored metadata.
    const panel = renderPreview(dash({ title: LEGACY_TITLE }));

    expect(within(panel).getByRole('heading', { level: 4 }).textContent).toBe(GENERIC_HEADING);
    expect(screen.queryByText(LEGACY_TITLE)).toBeNull();
  });

  it('CONTROL — a document with only `label` heads the preview with it, so the above is not vacuous', () => {
    const panel = renderPreview(dash({ label: CANONICAL_LABEL }));

    expect(within(panel).getByRole('heading', { level: 4 }).textContent).toBe(CANONICAL_LABEL);
  });

  it('CONTROL — an inline per-locale `label` resolves, rather than stringifying', () => {
    // `label` is the spec's `I18nLabel`, so the arm that replaced `title` must
    // go through `pickLocalized` — the resolver this component already uses for
    // widget titles, kept as ONE locale channel.
    const panel = renderPreview(dash({ label: { en: 'Pipeline', 'zh-CN': '销售漏斗' } }));

    expect(within(panel).getByRole('heading', { level: 4 }).textContent).toBe('Pipeline');
    expect(panel.innerHTML).not.toContain('[object Object]');
  });

  it('CONTROL — widget-level `title` still DISPLAYS on the widget card', () => {
    render(<DashboardEditor schema={dash({ label: CANONICAL_LABEL, title: LEGACY_TITLE })} onChange={() => {}} />);

    expect(screen.getByTestId('dashboard-widget-w1').textContent).toContain('Revenue');
  });

  it('CONTROL — widget-level `title` still AUTHORS through the inspector input', () => {
    // The write half of the widget key (`writeWidgetTitle`). A sweep that took
    // the widget arm with the root arm would have removed the only way to name
    // a widget in the designer.
    const onChange = vi.fn();
    render(<DashboardEditor schema={dash({ label: CANONICAL_LABEL, title: LEGACY_TITLE })} onChange={onChange} />);

    fireEvent.click(screen.getByTestId('dashboard-widget-w1'));
    const input = screen.getByTestId('widget-prop-title') as HTMLInputElement;
    expect(input.value).toBe('Revenue');

    fireEvent.change(input, { target: { value: 'Net Revenue' } });
    expect(onChange).toHaveBeenCalled();
    // Index arithmetic, not `.at(-1)`: whether `Array.prototype.at` (ES2022)
    // type-checks here is decided by this package's `tsconfig.test.json` `lib`
    // level, and that moves — read it off `pnpm census:tsconfig-test-parity`
    // rather than restating it, which is how the sentence this replaces went
    // false (objectui#9513).
    const calls = onChange.mock.calls;
    const next = calls[calls.length - 1][0] as DashboardComponentSchema;
    // Read through the slot's element type (objectui#11514): both arms of the
    // `widgets[]` union declare `title`.
    const widgets: DashboardComponentSchema['widgets'] = next.widgets ?? [];
    expect(widgets[0].title).toBe('Net Revenue');
  });
});
