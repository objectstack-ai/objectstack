/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * An action row has ONE label, and the button carries it (objectui#12610).
 *
 * The settings hub walk measured "Send test email" as a row label AND as the
 * button beside it on Mail Delivery, and the same pair on every
 * `action_button` of AI & Embedder, Knowledge and File Storage. The manifests
 * declare one `label` per `action_button`; drawing it twice was this renderer,
 * whose `action_button` branch printed the label on the left and again in the
 * button. That branch is the only place any settings page draws an action row,
 * so the pin is over the page, for every action row the renderer draws:
 *
 *   - no string a button carries is also drawn outside it, on any row;
 *   - the row's left side holds the manifest's `description` when it declares
 *     one, and nothing otherwise — the renderer never invents help text.
 *
 * The page cases render the REAL `SettingsView` over a stubbed `fetch`, with
 * the `action_button` specifiers the server's settings manifests declare today
 * (id, label, icon), so a label translated through the `actions.ID.label`
 * convention is judged the same way.
 */

import type { ReactElement } from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { I18nProvider } from '@object-ui/i18n';

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

import { SettingsView } from '../SettingsView';
import { SettingsField } from '../SettingsField';
import type { Specifier } from '../types';

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function ok(body: unknown): Response {
  return { ok: true, status: 200, statusText: 'OK', json: async () => body } as unknown as Response;
}

function withI18n(ui: ReactElement) {
  return <I18nProvider config={{ defaultLanguage: 'en', detectBrowserLanguage: false }}>{ui}</I18nProvider>;
}

function renderView(namespace: string, specifiers: Specifier[]) {
  fetchMock.mockResolvedValue(
    ok({
      success: true,
      data: {
        manifest: { namespace, version: 1, label: `Page ${namespace}`, specifiers },
        values: {},
      },
    }),
  );
  return render(
    withI18n(
      <MemoryRouter initialEntries={[`/settings/${namespace}`]}>
        <Routes>
          <Route path="/settings/:namespace" element={<SettingsView />} />
        </Routes>
      </MemoryRouter>,
    ),
  );
}

/**
 * Every element OUTSIDE `button` whose own text is `label`. Own text = the
 * element's direct text nodes, so a wrapper is not counted for its child's
 * words and the count is of places the string is drawn.
 */
function drawnOutside(label: string, button: HTMLElement): Element[] {
  return Array.from(document.body.querySelectorAll('*')).filter((el) => {
    if (button.contains(el)) return false;
    const own = Array.from(el.childNodes)
      .filter((n) => n.nodeType === Node.TEXT_NODE)
      .map((n) => n.textContent ?? '')
      .join('')
      .trim();
    return own === label;
  });
}

/**
 * The `action_button` specifiers objectstack's settings manifests declare
 * today, by page: Mail Delivery, SMS Delivery, AI & Embedder, Knowledge and
 * File Storage. None declares a `description`.
 */
const PAGES: Array<[string, Specifier[]]> = [
  ['mail', [{ type: 'action_button', id: 'test', label: 'Send test email', icon: 'Send' }]],
  ['sms', [{ type: 'action_button', id: 'test', label: 'Send test SMS', icon: 'Send' }]],
  [
    'ai',
    [
      { type: 'action_button', id: 'test', label: 'Test connection', icon: 'Plug' },
      { type: 'action_button', id: 'reset', label: 'Reset to environment defaults', icon: 'RotateCcw' },
      { type: 'action_button', id: 'test_embedder', label: 'Test embedder', icon: 'Plug' },
    ],
  ],
  ['knowledge', [{ type: 'action_button', id: 'test', label: 'Test connection', icon: 'Plug' }]],
  ['storage', [{ type: 'action_button', id: 'test', label: 'Test connection', icon: 'Plug' }]],
];

describe('a settings action row draws its label once, on the button (objectui#12610)', () => {
  it.each(PAGES)('the %s page: every action label is on its button and nowhere else', async (namespace, specs) => {
    renderView(namespace, specs);
    expect(await screen.findByText(`Page ${namespace}`)).toBeInTheDocument();

    for (const spec of specs) {
      const label = spec.label as string;
      const button = screen.getByRole('button', { name: label });
      expect(drawnOutside(label, button)).toEqual([]);
      // No description declared ⇒ the row holds the button and nothing else.
      expect(button.parentElement?.children).toHaveLength(1);
    }
    // Control: the walk above judged as many rows as the page declares.
    const buttons = specs.map((s) => screen.getByRole('button', { name: s.label as string }));
    expect(buttons).toHaveLength(specs.length);
  });

  it('a label translated through `actions.ID.label` is drawn once too, the translation on the button', async () => {
    // A bundle that translates the action through the convention the label
    // hook resolves (`NS.settings.NAMESPACE.actions.ID.label`).
    fetchMock.mockResolvedValue(
      ok({
        success: true,
        data: {
          manifest: {
            namespace: 'mail',
            version: 1,
            label: 'Page mail',
            specifiers: [{ type: 'action_button', id: 'test', label: 'Send test email', icon: 'Send' }],
          },
          values: {},
        },
      }),
    );
    render(
      <I18nProvider
        config={{
          defaultLanguage: 'en',
          detectBrowserLanguage: false,
          resources: {
            en: { probe12610: { settings: { mail: { actions: { test: { label: 'Mail a test' } } } } } },
          },
        }}
      >
        <MemoryRouter initialEntries={['/settings/mail']}>
          <Routes>
            <Route path="/settings/:namespace" element={<SettingsView />} />
          </Routes>
        </MemoryRouter>
      </I18nProvider>,
    );
    const button = await screen.findByRole('button', { name: 'Mail a test' });
    expect(drawnOutside('Mail a test', button)).toEqual([]);
    expect(screen.queryByText('Send test email')).toBeNull();
  });
});

describe('the action row\'s left side is the manifest\'s description or nothing (objectui#12610)', () => {
  it('a declared description is the left side, once, and the label stays on the button only', () => {
    const spec: Specifier = {
      type: 'action_button',
      id: 'test',
      label: 'Send test email',
      description: 'Sends a message to the from address',
    };
    render(<SettingsField spec={spec} value={undefined} onChange={() => {}} />);
    const button = screen.getByRole('button', { name: 'Send test email' });
    expect(drawnOutside('Send test email', button)).toEqual([]);
    const row = button.parentElement as HTMLElement;
    expect(row.children).toHaveLength(2);
    expect(within(row).getByText('Sends a message to the from address')).toBeInTheDocument();
    expect(button).not.toHaveTextContent('Sends a message');
  });

  it('no description ⇒ nothing beside the button', () => {
    render(
      <SettingsField
        spec={{ type: 'action_button', id: 'test', label: 'Test embedder' }}
        value={undefined}
        onChange={() => {}}
      />,
    );
    const button = screen.getByRole('button', { name: 'Test embedder' });
    expect(button.parentElement?.children).toHaveLength(1);
    expect(button.parentElement?.textContent).toBe('Test embedder');
  });
});
