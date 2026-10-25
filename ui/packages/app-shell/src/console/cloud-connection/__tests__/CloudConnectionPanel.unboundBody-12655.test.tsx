/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The "Not connected" card says the state and what Connect does; it does not
 * repeat the page subtitle (objectui#12655).
 *
 * The page that hosts this panel already carries a header subtitle, served by
 * the cloud-connection plugin's page metadata. The unbound card's body used to
 * open with that same sentence word for word, so an admin read it twice. The
 * body now says the runtime is not connected and what the Connect button does,
 * and names no control plane: nothing the panel is served says which one
 * Connect binds to.
 */

import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { I18nProvider } from '@object-ui/i18n';

import { CloudConnectionPanel } from '../CloudConnectionPanel';

/** The page header subtitle, as the cloud-connection plugin serves it in English. */
const PAGE_SUBTITLE =
  "Connect this runtime to an ObjectStack control plane to browse your organization's private packages and install them here.";

const UNBOUND_BODY =
  'This runtime is not connected to a control plane. Connect opens your cloud account in a new window, where one click approves the link — no ids or credentials are typed into this page.';

const reply = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: unknown) => {
      const url = String(input);
      if (url.endsWith('/status')) {
        return reply(200, { success: true, data: { environmentId: null, bound: false, connection: null } });
      }
      throw new Error(`unexpected fetch: ${url}`);
    }),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('CloudConnectionPanel — the unbound body says the state and what Connect does (objectui#12655)', () => {
  it('renders the new body under the Not connected title, beside the Connect button', async () => {
    render(
      <I18nProvider config={{ defaultLanguage: 'en', detectBrowserLanguage: false }} persistLanguage={false}>
        <CloudConnectionPanel />
      </I18nProvider>,
    );

    const title = await screen.findByText('Not connected');
    const card = title.closest('div.rounded-lg') as HTMLElement;
    expect(card).not.toBeNull();

    const body = screen.getByText(UNBOUND_BODY);
    expect(card).toContainElement(body);
    expect(card).toContainElement(screen.getByRole('button', { name: 'Connect' }));

    const text = body.textContent ?? '';
    expect(text).not.toContain(PAGE_SUBTITLE);
    expect(text.startsWith('Connect this runtime')).toBe(false);
  });
});
