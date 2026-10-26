/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * objectui#13038 — the phase line names the steps the user asked for, not the
 * agent's plumbing. The build agent's `load_tools` (it attaches a deferred tool
 * family) read as 「加载更多工具」 among the steps and was counted with them.
 *
 * Rendered through a real `I18nProvider`, so the zh strings are the shipped
 * pack's, not this file's.
 */
import '@testing-library/jest-dom/vitest';
import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { I18nProvider } from '@object-ui/i18n';
import { ChatbotEnhanced, type ChatbotEnhancedMessage } from '../ChatbotEnhanced';

function inZh(ui: React.ReactElement) {
  return (
    <I18nProvider config={{ defaultLanguage: 'zh', detectBrowserLanguage: false }}>{ui}</I18nProvider>
  );
}

const done = (toolCallId: string, toolName: string) => ({
  toolCallId,
  toolName,
  state: 'output-available' as const,
  result: { ok: true },
});

/** The card's data question on the build agent, with or without its `load_tools` step. */
const dataTurn = (id: string, withPlumbing: boolean): ChatbotEnhancedMessage => ({
  id,
  role: 'assistant',
  content: '',
  toolInvocations: [
    done('a', 'list_objects'),
    done('b', 'list_objects'),
    done('c', 'describe_object'),
    done('d', 'describe_object'),
    ...(withPlumbing ? [done('e', 'load_tools')] : []),
    done('f', 'aggregate_data'),
    done('g', 'query_records'),
    done('h', 'query_records'),
    done('i', 'query_records'),
  ],
});

describe('objectui#13038 — the plumbing step is neither shown nor counted', () => {
  it('a phase that called load_tools names no tool-loading step, and its count leaves it out', () => {
    render(inZh(<ChatbotEnhanced messages={[dataTurn('plumbing-a', true)]} />));
    expect(screen.getByTestId('tool-phase-headline')).toHaveTextContent(/^4 步$/);
    const steps = screen.getByTestId('tool-phase-steps');
    expect(steps).toHaveTextContent(/^列出已有对象 ×2 · 查看对象的结构 ×2 · 汇总相关数据 · 查找相关记录 ×3$/);
    expect(steps).not.toHaveTextContent('加载更多工具');

    // Nor among the expanded rows.
    fireEvent.click(screen.getByTestId('tool-phase-toggle'));
    expect(screen.getByTestId('tool-phase-steps-expanded')).not.toHaveTextContent('加载更多工具');
  });

  it('CONTROL: every other step reads exactly as the same turn without load_tools', () => {
    const { unmount } = render(inZh(<ChatbotEnhanced messages={[dataTurn('plumbing-b', false)]} />));
    const headline = screen.getByTestId('tool-phase-headline').textContent;
    const steps = screen.getByTestId('tool-phase-steps').textContent;
    fireEvent.click(screen.getByTestId('tool-phase-toggle'));
    const rows = screen.getByTestId('tool-phase-steps-expanded').textContent;
    unmount();

    render(inZh(<ChatbotEnhanced messages={[dataTurn('plumbing-c', true)]} />));
    expect(screen.getByTestId('tool-phase-headline').textContent).toBe(headline);
    expect(screen.getByTestId('tool-phase-steps').textContent).toBe(steps);
    fireEvent.click(screen.getByTestId('tool-phase-toggle'));
    expect(screen.getByTestId('tool-phase-steps-expanded').textContent).toBe(rows);
  });

  it('a phase of only plumbing draws no line — no 「0 步」 over an empty step list', () => {
    const settled: ChatbotEnhancedMessage = {
      id: 'plumbing-d',
      role: 'assistant',
      content: '',
      toolInvocations: [done('a', 'load_tools')],
    };
    const running: ChatbotEnhancedMessage = {
      id: 'plumbing-e',
      role: 'assistant',
      content: '',
      streaming: true,
      toolInvocations: [{ toolCallId: 'a', toolName: 'load_tools', state: 'input-available', args: {} }],
    };
    render(inZh(<ChatbotEnhanced messages={[settled, running]} isLoading />));
    expect(screen.queryByTestId('tool-phase')).not.toBeInTheDocument();
    expect(screen.queryByText(/0 步/)).not.toBeInTheDocument();
    expect(screen.queryByText('加载更多工具')).not.toBeInTheDocument();
  });
});
