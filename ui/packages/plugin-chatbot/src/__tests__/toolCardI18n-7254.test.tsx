/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * objectui#7254 — the copilot's tool cards, in the user's language.
 *
 * `humanizeToolName` grew a translator seam when the tool titles were found
 * untranslatable (cloud#1658), and then nothing used it: no locale pack
 * carried a `chatbot.tool.*` key and no call site passed a translator, so a
 * fully Chinese conversation still read "Propose blueprint · Awaiting
 * Approval". A dormant mechanism reads exactly like a working one from the
 * code, which is why this pin drives the RENDERED card through a real
 * `I18nProvider` rather than asserting the helper in isolation
 * (`tool-display-i18n.test.ts` already owns the helper).
 */
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { I18nProvider } from '@object-ui/i18n';
import { ChatbotEnhanced, type ChatbotEnhancedMessage } from '../ChatbotEnhanced';

function renderZh(ui: React.ReactElement) {
  return render(
    <I18nProvider config={{ defaultLanguage: 'zh', detectBrowserLanguage: false }}>
      {ui}
    </I18nProvider>,
  );
}

const proposal: ChatbotEnhancedMessage = {
  id: 'a1',
  role: 'assistant',
  content: '',
  toolInvocations: [
    {
      toolCallId: 't1',
      toolName: 'apply_edit',
      state: 'output-available',
      result: { status: 'changes_proposed', changes: [{ verb: 'add_field' }] },
      proposedChanges: { changes: [{ verb: 'add_field', object: 'task', field: 'priority' }] },
    },
  ],
};

const plan: ChatbotEnhancedMessage = {
  id: 'a2',
  role: 'assistant',
  content: '',
  toolInvocations: [
    {
      toolCallId: 't2',
      toolName: 'propose_blueprint',
      state: 'output-available',
      result: { status: 'blueprint_proposed', blueprint: {} },
      proposedPlan: {
        summary: '',
        objects: [],
        questions: [],
        assumptions: [],
        counts: { objects: 1, views: 1, dashboards: 1, seedData: 0 },
      },
    },
  ],
};

describe('tool cards under a zh console (objectui#7254)', () => {
  it('names the tool in Chinese instead of title-casing its internal name', () => {
    renderZh(<ChatbotEnhanced messages={[proposal]} onSendMessage={vi.fn()} />);
    expect(screen.getByText('应用这次修改')).toBeInTheDocument();
    expect(screen.queryByText('Apply edit')).not.toBeInTheDocument();
  });

  it('localizes the header status badge, which carried its own English table', () => {
    renderZh(<ChatbotEnhanced messages={[proposal]} onSendMessage={vi.fn()} />);
    expect(screen.getByText('待确认')).toBeInTheDocument();
    expect(screen.queryByText(/Awaiting/i)).not.toBeInTheDocument();
  });

  it('localizes the plan count strip, which was concatenated with an English "+ s" plural', () => {
    renderZh(<ChatbotEnhanced messages={[plan]} onSendMessage={vi.fn()} />);
    expect(screen.getByText('拟定应用方案')).toBeInTheDocument();
    expect(screen.getByText('1 个对象 · 1 个视图 · 1 个仪表板')).toBeInTheDocument();
  });

  it('an unknown / third-party tool still degrades to the English title-caser', () => {
    renderZh(
      <ChatbotEnhanced
        messages={[
          {
            id: 'a3',
            role: 'assistant',
            content: '',
            toolInvocations: [
              { toolCallId: 't3', toolName: 'forecast_revenue', state: 'output-available', result: {} },
            ],
          },
        ]}
        onSendMessage={vi.fn()}
      />,
    );
    expect(screen.getByText(/Forecast revenue/)).toBeInTheDocument();
  });
});
