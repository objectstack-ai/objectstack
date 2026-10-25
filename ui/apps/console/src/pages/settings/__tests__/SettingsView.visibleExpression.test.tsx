/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * SettingsView — a setting's `visible` predicate is judged by the renderer's
 * expression interpreter (`ExpressionEvaluator` from `@object-ui/core`), with
 * the manifest values bound as `data`, and a predicate that does not evaluate
 * HIDES the setting.
 *
 * The server judges the same string with its own closed grammar and refuses a
 * save whose `visible` it cannot parse, so the console must not show a field
 * the server would treat as broken, and must never run the string as code.
 */

import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { I18nProvider } from '@object-ui/i18n';

const getSettingsNamespace = vi.fn();

vi.mock('../api', async () => {
  const actual = await vi.importActual<typeof import('../api')>('../api');
  return {
    ...actual,
    getSettingsNamespace: (...a: unknown[]) => getSettingsNamespace(...a),
    saveSettingsNamespace: vi.fn(),
    runSettingsAction: vi.fn(),
  };
});

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

import { SettingsView } from '../SettingsView';

const PROBE = '__settingsVisibleProbe';

/** One always-visible anchor field, plus a field gated by `visible`. */
function payload(visible: string, values: Record<string, unknown>) {
  return {
    manifest: {
      namespace: 'ai',
      label: 'AI',
      specifiers: [
        { type: 'text', key: 'provider', label: 'Provider anchor' },
        { type: 'text', key: 'gated', label: 'Gated field', visible },
      ],
    },
    values: Object.fromEntries(
      Object.entries({ provider: '', gated: '', ...values }).map(([k, v]) => [k, { value: v, source: 'default' }]),
    ),
  };
}

async function gatedFieldShown(visible: string, values: Record<string, unknown> = {}): Promise<boolean> {
  getSettingsNamespace.mockResolvedValue(payload(visible, values));
  render(
    <I18nProvider config={{ defaultLanguage: 'en', detectBrowserLanguage: false }}>
      <MemoryRouter initialEntries={['/settings/ai']}>
        <Routes>
          <Route path="/settings/:namespace" element={<SettingsView />} />
        </Routes>
      </MemoryRouter>
    </I18nProvider>,
  );
  await screen.findByText('Provider anchor');
  return screen.queryByText('Gated field') !== null;
}

beforeEach(() => {
  vi.clearAllMocks();
  delete (globalThis as Record<string, unknown>)[PROBE];
});
afterEach(() => {
  cleanup();
  delete (globalThis as Record<string, unknown>)[PROBE];
});

describe('SettingsView — a setting\'s `visible` predicate', () => {
  it('shows the setting when the predicate holds and hides it when it does not', async () => {
    expect(await gatedFieldShown("${data.provider === 'cloudflare'}", { provider: 'cloudflare' })).toBe(true);
    cleanup();
    expect(await gatedFieldShown("${data.provider === 'cloudflare'}", { provider: 'openai' })).toBe(false);
  });

  it('reads the relational and logical operators the shipped manifests use', async () => {
    expect(await gatedFieldShown('${data.provider > 0 && data.provider !== 3}', { provider: 5 })).toBe(true);
    cleanup();
    expect(await gatedFieldShown('${data.provider > 0}', { provider: 0 })).toBe(false);
  });

  it('hides the setting when the predicate does not parse', async () => {
    expect(await gatedFieldShown('${data.provider ===}')).toBe(false);
  });

  it('never runs the predicate as code, and hides a setting whose predicate it cannot evaluate', async () => {
    expect(await gatedFieldShown(`\${(globalThis.${PROBE} = 1) && true}`)).toBe(false);
    expect((globalThis as Record<string, unknown>)[PROBE]).toBeUndefined();
  });
});
