/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `EmptyStateLink`, the one piece that draws an empty state's declared link
 * (objectui#12270).
 *
 * The spec's `EmptyStateSchema.link` is `{ label, url }`. The three doors that
 * draw an empty state (`ListView`, a list page through `ListView`, and
 * `ObjectGrid`) each draw the link through this component; their own pins
 * mount the real door. This file pins the component's own contract with the
 * real ActionRunner, under an `ActionProvider` wired as the console wires it
 * (`onNavigate` + `onToast`), and with no provider at all:
 *
 * - an in-app path goes through the host router, in place;
 * - an `https://` address goes out as the runner sends any external target;
 * - `mailto:` opens in place, never through the router or a new tab;
 * - a value the runner refuses navigates nowhere, and the refusal shown is the
 *   one a bare runner answers for the same target, read off the runner rather
 *   than restated here;
 * - nothing is judged at render: a `${…}` template, which the spec judges at
 *   the click, is drawn;
 * - the label resolves an inline locale map, and a link with no label text
 *   draws nothing.
 */

import { describe, it, expect, vi, beforeEach, afterEach, type Mock, type MockInstance } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { ActionRunner } from '@object-ui/core';
import { ActionProvider } from '@object-ui/react';
import { EmptyStateLink, type EmptyStateLinkSpec } from '../custom/empty-state-link';

const LABEL = 'Read the guide';

/** What a bare runner answers for a `url` action with this target. */
async function runnerAnswer(target: string) {
  return new ActionRunner({}).execute({ type: 'url', target });
}

let originalLocation: Location;
let hrefSet: Mock<(url: string) => void>;
let assignSpy: Mock<(url: string) => void>;
let openSpy: MockInstance<typeof window.open>;
let warnSpy: MockInstance<typeof console.warn>;

beforeEach(() => {
  originalLocation = window.location;
  hrefSet = vi.fn();
  assignSpy = vi.fn();
  Object.defineProperty(window, 'location', {
    writable: true,
    // The runner opens `mailto:` by assigning `window.location.href`; this
    // component follows a provider-less redirect with `location.assign`.
    value: {
      ...originalLocation,
      assign: assignSpy,
      set href(v: string) { hrefSet(v); },
    } as unknown as Location,
  });
  openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);
  warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  openSpy.mockRestore();
  warnSpy.mockRestore();
  Object.defineProperty(window, 'location', { writable: true, value: originalLocation });
});

function renderUnderProvider(link: EmptyStateLinkSpec | undefined, displayLocale = 'en') {
  const onNavigate = vi.fn();
  const onToast = vi.fn();
  render(
    <ActionProvider onNavigate={onNavigate} onToast={onToast}>
      <EmptyStateLink link={link} displayLocale={displayLocale} />
    </ActionProvider>,
  );
  return { onNavigate, onToast };
}

const click = () => fireEvent.click(screen.getByRole('button', { name: LABEL }));

/** No sink the link could navigate through was touched. */
function expectNoNavigation(onNavigate?: Mock) {
  if (onNavigate) expect(onNavigate).not.toHaveBeenCalled();
  expect(hrefSet).not.toHaveBeenCalled();
  expect(assignSpy).not.toHaveBeenCalled();
  expect(openSpy).not.toHaveBeenCalled();
}

const REFUSED: Array<[string, string]> = [
  ['a protocol-relative //host', '//cdn.example.com/x'],
  ['a bare relative value', 'thanks'],
  ['a javascript: target', 'javascript:alert(1)'],
];

describe('EmptyStateLink under an ActionProvider (objectui#12270)', () => {
  it('follows an in-app path through the host router, in place, with no toast', async () => {
    const url = '/apps/crm/docs/connect';
    const { onNavigate, onToast } = renderUnderProvider({ label: LABEL, url });
    click();

    await waitFor(() =>
      expect(onNavigate).toHaveBeenCalledWith(url, expect.objectContaining({ external: false, newTab: false })),
    );
    expect(onNavigate).toHaveBeenCalledTimes(1);
    expect(onToast).not.toHaveBeenCalled();
    expect(hrefSet).not.toHaveBeenCalled();
    expect(openSpy).not.toHaveBeenCalled();
  });

  it('sends an https:// address out as the runner sends an external target', async () => {
    const url = 'https://example.com/how-to';
    const { onNavigate, onToast } = renderUnderProvider({ label: LABEL, url });
    click();

    await waitFor(() =>
      expect(onNavigate).toHaveBeenCalledWith(url, expect.objectContaining({ external: true, newTab: true })),
    );
    expect(onToast).not.toHaveBeenCalled();
  });

  it('opens mailto: in place, not through the router and not in a new tab', async () => {
    const url = 'mailto:support@example.com';
    const { onNavigate, onToast } = renderUnderProvider({ label: LABEL, url });
    click();

    await waitFor(() => expect(hrefSet).toHaveBeenCalledWith(url));
    expect(hrefSet).toHaveBeenCalledTimes(1);
    expect(onNavigate).not.toHaveBeenCalled();
    expect(openSpy).not.toHaveBeenCalled();
    expect(onToast).not.toHaveBeenCalled();
  });

  it.each(REFUSED)('refuses %s at the click, with the runner\'s refusal, and navigates nowhere', async (_what, url) => {
    const expected = await runnerAnswer(url);
    expect(expected.success).toBe(false);
    expect(expected.error).toBeTruthy();

    const { onNavigate, onToast } = renderUnderProvider({ label: LABEL, url });
    click();

    await waitFor(() =>
      expect(onToast).toHaveBeenCalledWith(expected.error, expect.objectContaining({ type: 'error' })),
    );
    expectNoNavigation(onNavigate);
  });

  it('judges nothing at render: a ${…} template, which the spec judges at the click, is drawn', () => {
    renderUnderProvider({ label: LABEL, url: '${ctx.origin}/docs' });
    expect(screen.getByRole('button', { name: LABEL })).toBeTruthy();
  });

  it('resolves an inline label map against the display locale', () => {
    // `en` first, so a resolver that fell back to `en` or to the first entry
    // would paint English under `zh-CN` and fail the row.
    renderUnderProvider({ label: { en: 'Read the guide', 'zh-CN': '阅读指南' }, url: '/docs' }, 'zh-CN');
    expect(screen.getByRole('button', { name: '阅读指南' })).toBeTruthy();
  });

  it('draws nothing for an absent link, or a label with no text', () => {
    renderUnderProvider(undefined);
    expect(screen.queryByTestId('empty-state-link')).toBeNull();
    cleanup();
    renderUnderProvider({ label: {}, url: '/docs' });
    expect(screen.queryByTestId('empty-state-link')).toBeNull();
    cleanup();
    // CONTROL: the same mount with a label draws the link.
    renderUnderProvider({ label: LABEL, url: '/docs' });
    expect(screen.getByTestId('empty-state-link').textContent).toBe(LABEL);
  });
});

describe('EmptyStateLink with no ActionProvider (objectui#12270)', () => {
  it('follows the runner\'s redirect hand-off for an in-app path', async () => {
    const url = '/apps/crm/docs/connect';
    render(<EmptyStateLink link={{ label: LABEL, url }} displayLocale="en" />);
    click();

    await waitFor(() => expect(assignSpy).toHaveBeenCalledWith(url));
    expect(assignSpy).toHaveBeenCalledTimes(1);
    expect(hrefSet).not.toHaveBeenCalled();
    expect(openSpy).not.toHaveBeenCalled();
  });

  it('opens an https:// address as the bare runner opens it, in a new tab', async () => {
    const url = 'https://example.com/how-to';
    render(<EmptyStateLink link={{ label: LABEL, url }} displayLocale="en" />);
    click();

    await waitFor(() => expect(openSpy).toHaveBeenCalledWith(url, '_blank', 'noopener,noreferrer'));
    expect(assignSpy).not.toHaveBeenCalled();
    expect(hrefSet).not.toHaveBeenCalled();
  });

  it.each(REFUSED)('refuses %s at the click and logs the runner\'s refusal', async (_what, url) => {
    const expected = await runnerAnswer(url);
    expect(expected.success).toBe(false);

    render(<EmptyStateLink link={{ label: LABEL, url }} displayLocale="en" />);
    click();

    await waitFor(() =>
      expect(warnSpy).toHaveBeenCalledWith('[EmptyStateLink] link not followed', expected.error),
    );
    expectNoNavigation();
  });
});
