// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#8219 item 3, end to end — selecting a labelled item in the
 * Interfaces pillar makes the copilot dock's "discussing" chip read that
 * item's LABEL, with the internal `type · name` pair on the chip's tooltip.
 *
 * objectui#7254's ruling: what is READ is the label; the internal identity
 * stays REACHABLE on a tooltip. The label exists only in the Interfaces
 * pillar's open leaf, while the dock is mounted by the outer surface — so this
 * pin mounts the real `StudioDesignSurface`, the real dock and the real
 * `ChatPane`, and replaces only `ChatbotEnhanced` (a prop recorder: its props
 * ARE the chip) and the chat transport (`useObjectChat`, a recorder of the
 * request body the agent would receive).
 *
 * The fetch stub answers the REST reads the surface makes; everything it does
 * not recognise answers an empty list.
 *
 * objectui#11196 re-judged the unlabelled-leaf case. It pinned the chip's
 * `type · name` fallback, which the chip reached because a label-less leaf's
 * Surface carried no label. A label-less entry now shows what it inherits —
 * its target's current label, the runtime's rule — on every designer surface,
 * the chip included; `type · name` stays reachable on the chip's tooltip
 * (objectui#7254's reachable half). The host's metadata cache therefore
 * labels the object, so the inherited text differs from the machine name.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { I18nProvider } from '@object-ui/i18n';

const PACKAGE_ID = 'com.acme.app';

/** Props of the last `ChatbotEnhanced` render — the chip under assertion. */
let chip: Record<string, unknown> = {};
/** Options of the last `useObjectChat` call — carries the agent-bound body. */
let chatOptions: Record<string, unknown> = {};

vi.mock('@object-ui/plugin-chatbot', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    ChatbotEnhanced: (props: Record<string, unknown>) => {
      chip = props;
      return null;
    },
    useObjectChat: (options: Record<string, unknown>) => {
      chatOptions = options;
      return {
        messages: [],
        isLoading: false,
        error: undefined,
        sendMessage: vi.fn(),
        stop: vi.fn(),
        reload: vi.fn(),
        clear: vi.fn(),
        setMessages: vi.fn(),
      };
    },
    useAiModels: () => ({ models: [], defaultModelId: undefined }),
  };
});
vi.mock('@object-ui/plugin-chatbot/core', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@object-ui/plugin-chatbot/core')>()),
  useAgents: () => ({
    agents: [{ name: 'metadata_assistant', label: 'Build', capabilities: ['build'] }],
    isLoading: false,
    loading: false,
    error: undefined,
    refetch: vi.fn(),
  }),
}));
vi.mock('@object-ui/auth', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, useAuth: () => ({ user: { id: 'u1' } }) };
});
vi.mock('./packages-io', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    fetchPackages: vi.fn(async () => [{ id: PACKAGE_ID, name: '客户管理', writable: true }]),
  };
});
vi.mock('@object-ui/react', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, useAdapter: () => ({}) };
});
// ChatPane reads `apps` for the bound-package chip and the adapter for the
// Excel→App bar; neither is part of this pin. `objects` is what the console's
// nav-target resolver reads for what a label-less leaf inherits
// (objectui#11196). One module-level value, so its identity is stable.
const metadataCache = vi.hoisted(() => ({
  apps: [] as unknown[],
  objects: [{ name: 'b2r4_customer', label: '客户' }],
}));
vi.mock('../../providers/MetadataProvider', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, useMetadata: () => metadataCache };
});
vi.mock('../../providers/AdapterProvider', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, useAdapter: () => null };
});
vi.mock('../../components/SuggestedBindingsPanel', () => ({ SuggestedBindingsPanel: () => null }));
vi.mock('../metadata-admin/AccessExplainPanel', () => ({ AccessExplainPanel: () => null }));

import { StudioDesignSurface } from './StudioDesignSurface';

window.matchMedia = ((query: string) => ({
  matches: false,
  media: query,
  onchange: null,
  addEventListener: () => {},
  removeEventListener: () => {},
  addListener: () => {},
  removeListener: () => {},
  dispatchEvent: () => false,
})) as unknown as typeof window.matchMedia;
(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver =
  (globalThis as unknown as { ResizeObserver?: unknown }).ResizeObserver ??
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };

const NAV = [
  { id: 'nav_dash', type: 'dashboard', label: '客户仪表盘', dashboardName: 'b2r4_customer_dashboard' },
  // A leaf the author never labelled.
  { id: 'nav_obj', type: 'object', objectName: 'b2r4_customer' },
];

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

beforeEach(() => {
  chip = {};
  chatOptions = {};
  window.localStorage.clear();
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: unknown) => {
      const raw =
        input && typeof input === 'object' && 'url' in input ? (input as { url: unknown }).url : input;
      const path = new URL(String(raw), 'http://localhost').pathname;
      if (path === '/api/v1/ai/conversations') return json({ id: 'conv_8219', messages: [] });
      if (path.startsWith('/api/v1/ai/conversations/')) return json({ id: 'conv_8219', messages: [] });
      if (path === '/api/v1/meta/_drafts') return json([]);
      if (path === '/api/v1/meta/app') return json([{ name: 'acme_app', label: '客户管理' }]);
      if (path === '/api/v1/meta/app/acme_app/layers') {
        return json({
          code: null,
          overlay: null,
          overlayScope: null,
          effective: { name: 'acme_app', label: '客户管理', navigation: NAV },
        });
      }
      if (path.endsWith('/layers')) return json({ code: null, overlay: null, overlayScope: null, effective: null });
      if (/^\/api\/v1\/meta\/[^/]+\/[^/]+$/.test(path)) return json({}, 404);
      return json([]);
    }) as unknown as typeof fetch,
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function renderStudio() {
  return render(
    <I18nProvider config={{ defaultLanguage: 'zh', detectBrowserLanguage: false }}>
      <MemoryRouter initialEntries={[`/studio/${PACKAGE_ID}/interfaces`]}>
        <Routes>
          <Route path="/studio/:packageId/:tab" element={<StudioDesignSurface />} />
        </Routes>
      </MemoryRouter>
    </I18nProvider>,
  );
}

const agentSurface = () =>
  (chatOptions.body as { context: { surface?: unknown } } | undefined)?.context.surface;

describe('Studio copilot chip reads the selected item label (objectui#8219 item 3)', () => {
  it('a labelled leaf: the chip reads the label, its title is type · name, and the agent data is unchanged', async () => {
    renderStudio();
    await screen.findByRole('button', { name: '客户仪表盘 仪表板' });
    await waitFor(() => expect(chip.surfaceContextLabel).toBe('正在讨论：客户仪表盘'), { timeout: 4000 });
    expect(chip.surfaceContextTitle).toBe('dashboard · b2r4_customer_dashboard');
    // The label is display-only: the agent still receives exactly the
    // URL-derived surface, and no label under any key.
    expect(JSON.stringify(agentSurface())).toBe(
      JSON.stringify({
        pillar: 'interfaces',
        artifact: { type: 'dashboard', name: 'b2r4_customer_dashboard' },
      }),
    );
    expect(JSON.stringify(chatOptions.body)).not.toContain('客户仪表盘');
  });

  it('an unlabelled leaf: the chip reads the label it inherits, with type · name on its tooltip (objectui#11196)', async () => {
    renderStudio();
    // The rail row and the chip read the same inherited text.
    fireEvent.click(await screen.findByRole('button', { name: '客户 对象' }));
    await waitFor(() => expect(chip.surfaceContextLabel).toBe('正在讨论：客户'), {
      timeout: 4000,
    });
    expect(chip.surfaceContextTitle).toBe('object · b2r4_customer');
    expect(JSON.stringify(agentSurface())).toBe(
      JSON.stringify({ pillar: 'interfaces', artifact: { type: 'object', name: 'b2r4_customer' } }),
    );
  });
});
