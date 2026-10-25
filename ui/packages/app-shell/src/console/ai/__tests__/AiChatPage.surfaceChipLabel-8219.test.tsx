// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#8219 item 3 — the "discussing" chip reads the artifact's display
 * label, and the internal `type · name` pair moves to its tooltip.
 *
 * objectui#7254's ruling: what is READ is the label; the internal identity
 * stays REACHABLE on a tooltip. Before this, ChatPane built the chip from the
 * `context.surface` artifact alone, so the chip printed
 * `Discussing: dashboard · customer_dashboard` at the reader.
 *
 * The display label reaches ChatPane as its OWN optional prop
 * (`surfaceArtifactLabel`), never inside `surfaceContext` — that object is the
 * `context.surface` data the agent receives (cloud#1610), and it must not
 * change. The last case pins that: the request body the pane hands the chat
 * transport serializes to the same bytes with and without a label.
 *
 * The pane is rendered for real with `ChatbotEnhanced` and `useObjectChat`
 * replaced by prop recorders, because the props ChatPane hands down are the
 * contract under assertion.
 */

import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import React from 'react';

/** Props of the last `ChatbotEnhanced` render. */
let captured: Record<string, unknown> = {};
/** Options of the last `useObjectChat` call — carries the request `body`. */
let chatOptions: Record<string, unknown> = {};

vi.mock('@object-ui/plugin-chatbot', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    ChatbotEnhanced: (props: Record<string, unknown>) => {
      captured = props;
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

vi.mock('../../../providers/MetadataProvider', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, useMetadata: () => ({ apps: [] }) };
});
vi.mock('../../../providers/AdapterProvider', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, useAdapter: () => null };
});

import { I18nProvider } from '@object-ui/i18n';
import type { AgentDescriptor } from '@object-ui/plugin-chatbot';
import { ChatPane } from '../AiChatPage';

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

const SURFACE = {
  pillar: 'interfaces',
  artifact: { type: 'dashboard', name: 'customer_dashboard' },
};

function renderPane(extra: { surfaceArtifactLabel?: string; surfaceContext?: typeof SURFACE }) {
  cleanup();
  captured = {};
  chatOptions = {};
  // `surfaceArtifactLabel` is spread in so this file also compiles and runs
  // against a ChatPane that does not declare it yet (the red half).
  const labelProp = (
    extra.surfaceArtifactLabel === undefined ? {} : { surfaceArtifactLabel: extra.surfaceArtifactLabel }
  ) as Record<string, never>;
  render(
    <I18nProvider config={{ defaultLanguage: 'en', detectBrowserLanguage: false }}>
      <MemoryRouter initialEntries={['/studio/app.k9/interfaces']}>
        <ChatPane
          agents={[{ name: 'build', label: 'Builder' } as unknown as AgentDescriptor]}
          agentsLoading={false}
          agentsError={undefined}
          activeAgent="build"
          chatApi="/api/v1/ai/agents/build/chat"
          apiBase="/api/v1/ai"
          conversationId="conv-1"
          surfaceContext={extra.surfaceContext}
          initialMessages={[]}
          pendingFirstMessageRef={{ current: null }}
          onSent={vi.fn()}
          onShare={vi.fn()}
          {...labelProp}
        />
      </MemoryRouter>
    </I18nProvider>,
  );
  return { props: captured, options: chatOptions };
}

beforeEach(() => window.localStorage.clear());
afterEach(() => cleanup());

describe('AI chat "discussing" chip — label read, internal id on the tooltip (objectui#8219)', () => {
  it('with a display label: the chip reads the label and its title is the type · name pair', () => {
    const { props } = renderPane({ surfaceContext: SURFACE, surfaceArtifactLabel: 'Customer dashboard' });
    expect(props.surfaceContextLabel).toBe('Discussing: Customer dashboard');
    expect(props.surfaceContextTitle).toBe('dashboard · customer_dashboard');
  });

  it('with no display label: the chip falls back to the type · name pair, still reachable as its title', () => {
    const { props } = renderPane({ surfaceContext: SURFACE });
    expect(props.surfaceContextLabel).toBe('Discussing: dashboard · customer_dashboard');
    expect(props.surfaceContextTitle).toBe('dashboard · customer_dashboard');
  });

  it('no artifact in the surface context: no chip and no title, label or not', () => {
    const { props } = renderPane({
      surfaceContext: { pillar: 'data' } as unknown as typeof SURFACE,
      surfaceArtifactLabel: 'Stray label',
    });
    expect(props.surfaceContextLabel).toBeUndefined();
    expect(props.surfaceContextTitle).toBeUndefined();
  });

  it('the context.surface data sent to the agent is byte-identical with and without the label', () => {
    const without = renderPane({ surfaceContext: SURFACE }).options;
    const withLabel = renderPane({ surfaceContext: SURFACE, surfaceArtifactLabel: 'Customer dashboard' }).options;
    const bodyOf = (o: Record<string, unknown>) => o.body as { context: Record<string, unknown> };
    // The surface half, and then the whole request body around it.
    expect(JSON.stringify(bodyOf(withLabel).context.surface)).toBe(JSON.stringify(SURFACE));
    expect(JSON.stringify(bodyOf(withLabel).context.surface)).toBe(
      JSON.stringify(bodyOf(without).context.surface),
    );
    expect(JSON.stringify(bodyOf(withLabel))).toBe(JSON.stringify(bodyOf(without)));
    // The label never travels to the agent under any key.
    expect(JSON.stringify(bodyOf(withLabel))).not.toContain('Customer dashboard');
  });
});
