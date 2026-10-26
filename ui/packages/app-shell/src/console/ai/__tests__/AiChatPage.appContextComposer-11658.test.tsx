// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#11658 — what ChatPane hands the composer inside an app.
 *
 * Item 2: the build agent scoped to a package (`editPackageId` — the console
 * dock in a running app, the Studio dock, `/ai/build?package=`) used the
 * generic "Ask {agent}…" placeholder, which a zh-CN user read as「向 构建 提问…」:
 * the agent's name, not the task. Inside an app the placeholder names what the
 * user can do there. objectui#12724 extends that to the cold-start build
 * surface (no package): it reads「描述你想搭建的应用，或要改的地方…」, and the
 * composer footer gains the newline half of its key hint. The ask agent and
 * an agent that is neither build nor ask keep their placeholders — they are
 * the controls.
 *
 * Item 5 (host half): the plan card's extend-mode chip names the existing app
 * by its label. ChatPane hands ChatbotEnhanced a resolver over the apps the
 * console's metadata already holds; the chip half is pinned in
 * `ChatbotEnhanced.extendChip-11658.test.tsx`.
 *
 * Same harness as `AiChatPage.planCardLocale.test.tsx`: the real pane under a
 * real `I18nProvider`, with `ChatbotEnhanced` replaced by a prop recorder.
 */

import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import React from 'react';

let captured: Record<string, unknown> = {};

vi.mock('@object-ui/plugin-chatbot', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    ChatbotEnhanced: (props: Record<string, unknown>) => {
      captured = props;
      return null;
    },
    useObjectChat: () => ({
      messages: [],
      isLoading: false,
      error: undefined,
      sendMessage: vi.fn(),
      stop: vi.fn(),
      reload: vi.fn(),
      clear: vi.fn(),
      setMessages: vi.fn(),
    }),
    useAiModels: () => ({ models: [], defaultModelId: undefined }),
  };
});

const APPS = [{ name: 'customer_management', label: '客户管理', _packageId: 'app.crm' }];
vi.mock('../../../providers/MetadataProvider', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, useMetadata: () => ({ apps: APPS }) };
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

const AGENTS = [
  { name: 'build', label: 'Build' },
  { name: 'ask', label: 'Ask' },
  { name: 'analyst', label: 'Analyst' },
] as unknown as AgentDescriptor[];

function renderPane(uiLocale: string, opts: { agent: 'build' | 'ask' | 'analyst'; editPackageId?: string }) {
  cleanup();
  captured = {};
  render(
    <I18nProvider config={{ defaultLanguage: uiLocale, detectBrowserLanguage: false }}>
      <MemoryRouter initialEntries={[`/ai/${opts.agent}/conv-1`]}>
        <ChatPane
          agents={AGENTS}
          agentsLoading={false}
          agentsError={undefined}
          activeAgent={opts.agent}
          chatApi={`/api/v1/ai/agents/${opts.agent}/chat`}
          apiBase="/api/v1/ai"
          conversationId="conv-1"
          editPackageId={opts.editPackageId}
          initialMessages={[]}
          pendingFirstMessageRef={{ current: null }}
          onSent={vi.fn()}
          onShare={vi.fn()}
        />
      </MemoryRouter>
    </I18nProvider>,
  );
  return captured;
}

beforeEach(() => {
  window.localStorage.clear();
  // An app-scoped pane asks for that package's pending drafts; serve the probe
  // from a double, never the network (objectui#6640).
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      new Response(JSON.stringify({ success: true, data: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    ),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('objectui#11658 item 2 — the in-app composer names the task, not the agent', () => {
  it('zh: the build agent inside an app reads「问问数据，或让我改改这个应用…」', () => {
    const props = renderPane('zh', { agent: 'build', editPackageId: 'app.crm' });
    expect(props.placeholder).toBe('问问数据，或让我改改这个应用…');
    expect(String(props.placeholder)).not.toContain('构建');
  });

  it('en: the build agent inside an app reads "Ask about your data, or ask me to change this app…"', () => {
    const props = renderPane('en', { agent: 'build', editPackageId: 'app.crm' });
    expect(props.placeholder).toBe('Ask about your data, or ask me to change this app…');
  });

  // objectui#12724 retired the old control here ("the cold-start build surface
  // keeps 'Ask Build…'"): outside an app the build agent's composer names the
  // task too. The third agent below is the control that keeps the template.
  it('objectui#12724 zh: the build agent outside an app reads「描述你想搭建的应用，或要改的地方…」', () => {
    const props = renderPane('zh', { agent: 'build' });
    expect(props.placeholder).toBe('描述你想搭建的应用，或要改的地方…');
    expect(String(props.placeholder)).not.toContain('构建');
  });

  it('objectui#12724 en: the build agent outside an app reads "Describe the app you want to build, or what to change…"', () => {
    const props = renderPane('en', { agent: 'build' });
    expect(props.placeholder).toBe('Describe the app you want to build, or what to change…');
    expect(String(props.placeholder)).not.toContain('Build…');
  });

  it('control: an agent that is neither build nor ask keeps the "Ask {agent}…" template', () => {
    expect(renderPane('en', { agent: 'analyst' }).placeholder).toBe('Ask Analyst…');
  });

  it('objectui#12724: the composer footer reads「↵ 发送 · Shift+↵ 换行」', () => {
    const labels = renderPane('zh', { agent: 'build' }).labels as Record<string, unknown>;
    expect(labels.sendHint).toBe('发送');
    expect(labels.newlineHint).toBe('换行');
  });

  it('control: the ask agent keeps its own placeholder, app or not', () => {
    expect(renderPane('en', { agent: 'ask', editPackageId: 'app.crm' }).placeholder).toBe('Ask anything…');
  });
});

describe('objectui#11658 item 5 — the host resolves the scope chip\'s app label', () => {
  it('a known app resolves to its label in the UI locale; an unknown one to undefined', () => {
    const props = renderPane('zh', { agent: 'build', editPackageId: 'app.crm' });
    const resolve = props.resolveAppLabel as (name: string) => string | undefined;
    expect(typeof resolve).toBe('function');
    expect(resolve('customer_management')).toBe('客户管理');
    expect(resolve('no_such_app')).toBeUndefined();
  });
});
