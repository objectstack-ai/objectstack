/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * objectstack#27480 — a plan whose `decision` is `iterate_or_new` overlaps an
 * app the user already has. The card drew it as an ordinary plan with a
 * "Build it" button, so one click could build a duplicate of that app. It now
 * asks the extend-or-new question in place of the plan's actions: the question
 * names the existing app, and each of its two choices sends its answer.
 *
 * Every case feeds the wire shape through the real mapper, so what is pinned is
 * the envelope the producer sends, not a hand-built `proposedPlan`. The plain
 * proposal is the control: its "Build it" gate is untouched.
 */
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { I18nProvider } from '@object-ui/i18n';
import { ChatbotEnhanced } from '../ChatbotEnhanced';
import { uiMessagesToChatMessages } from '../mapMessages';

type WireMessage = Parameters<typeof uiMessagesToChatMessages>[0][number];

const PLAIN = {
  status: 'blueprint_proposed',
  summary: 'A reading-list app',
  blueprint: {
    objects: [{ name: 'book', label: 'Book', fields: [{ name: 'title' }, { name: 'author' }] }],
  },
  counts: { objects: 1, views: 0, dashboards: 0, seedData: 0 },
  questions: [],
};

const ITERATE_OR_NEW = {
  ...PLAIN,
  decision: 'iterate_or_new',
  existingAppOverlap: { name: 'library', label: '图书馆' },
};

function proposal(result: unknown): WireMessage[] {
  return [
    { id: 'u1', role: 'user', parts: [{ type: 'text', text: 'Build me a library app' }] },
    {
      id: 'a1',
      role: 'assistant',
      parts: [
        {
          type: 'tool-propose_blueprint',
          toolCallId: 'plan-1',
          state: 'output-available',
          output: { type: 'text', value: JSON.stringify(result) },
        },
      ],
    },
  ] as WireMessage[];
}

const messagesOf = (wire: WireMessage[]) => uiMessagesToChatMessages(wire, { isStreaming: false });

afterEach(cleanup);

describe('the iterate_or_new plan asks extend-or-new instead of offering Build it (objectstack#27480)', () => {
  it('renders the question naming the existing app, and no approve button', () => {
    render(<ChatbotEnhanced messages={messagesOf(proposal(ITERATE_OR_NEW))} onSendMessage={vi.fn()} />);
    expect(screen.getByTestId('proposed-plan-iterate-or-new-question').textContent).toContain('图书馆');
    expect(screen.queryByTestId('proposed-plan-approve')).toBeNull();
    expect(screen.queryByTestId('proposed-plan-adjust')).toBeNull();
    expect(screen.queryByTestId('proposed-plan-fallback')).toBeNull();
    expect(screen.queryByText('Build it')).toBeNull();
    // The plan's own rows stay, so the user sees what would be built either way.
    expect(screen.getByTestId('proposed-plan')).toBeInTheDocument();
  });

  it('a plain proposal is unchanged: Build it, Adjust, and no question (control)', () => {
    render(<ChatbotEnhanced messages={messagesOf(proposal(PLAIN))} onSendMessage={vi.fn()} />);
    expect(screen.getByTestId('proposed-plan-approve')).toBeInTheDocument();
    expect(screen.getByTestId('proposed-plan-adjust')).toBeInTheDocument();
    expect(screen.queryByTestId('proposed-plan-iterate-or-new')).toBeNull();
  });

  it('each choice sends its answer', () => {
    const onSendMessage = vi.fn();
    render(<ChatbotEnhanced messages={messagesOf(proposal(ITERATE_OR_NEW))} onSendMessage={onSendMessage} />);
    fireEvent.click(screen.getByTestId('proposed-plan-extend-existing'));
    expect(onSendMessage).toHaveBeenLastCalledWith('Keep improving "图书馆" instead of building a new app.');
    fireEvent.click(screen.getByTestId('proposed-plan-build-new'));
    expect(onSendMessage).toHaveBeenLastCalledWith('Build a separate, new app.');
    expect(onSendMessage).toHaveBeenCalledTimes(2);
  });

  it("sends the host's outbound text when the host supplies it", () => {
    const onSendMessage = vi.fn();
    render(
      <ChatbotEnhanced
        messages={messagesOf(proposal(ITERATE_OR_NEW))}
        onSendMessage={onSendMessage}
        planExtendExistingMessage={(app) => `在「${app}」上继续完善，不另建应用。`}
        planBuildNewAppMessage="另建一个独立应用。"
      />,
    );
    fireEvent.click(screen.getByTestId('proposed-plan-extend-existing'));
    expect(onSendMessage).toHaveBeenLastCalledWith('在「图书馆」上继续完善，不另建应用。');
    fireEvent.click(screen.getByTestId('proposed-plan-build-new'));
    expect(onSendMessage).toHaveBeenLastCalledWith('另建一个独立应用。');
  });

  it('zh: the question and both choices read in Chinese and name the app', () => {
    render(
      <I18nProvider config={{ defaultLanguage: 'zh', detectBrowserLanguage: false }}>
        <ChatbotEnhanced messages={messagesOf(proposal(ITERATE_OR_NEW))} onSendMessage={vi.fn()} />
      </I18nProvider>,
    );
    expect(screen.getByTestId('proposed-plan-iterate-or-new-question').textContent).toContain('「图书馆」');
    expect(screen.getByTestId('proposed-plan-extend-existing').textContent).toBe('在「图书馆」上继续完善');
    expect(screen.getByTestId('proposed-plan-build-new').textContent).toBe('另建一个独立应用');
  });

  it('still asks, and draws no fallback Build it, when the envelope names no object', () => {
    const noObjects = { ...ITERATE_OR_NEW, blueprint: { objects: [] } };
    render(<ChatbotEnhanced messages={messagesOf(proposal(noObjects))} onSendMessage={vi.fn()} />);
    expect(screen.getByTestId('proposed-plan-iterate-or-new')).toBeInTheDocument();
    expect(screen.queryByTestId('proposed-plan-fallback')).toBeNull();
    expect(screen.queryByTestId('proposed-plan-approve')).toBeNull();
  });

  it("names the app by the host's label when the envelope carries only its name", () => {
    const nameOnly = { ...ITERATE_OR_NEW, existingAppOverlap: { name: 'library' } };
    render(
      <ChatbotEnhanced
        messages={messagesOf(proposal(nameOnly))}
        onSendMessage={vi.fn()}
        resolveAppLabel={(name) => (name === 'library' ? 'Library' : undefined)}
      />,
    );
    expect(screen.getByTestId('proposed-plan-extend-existing').textContent).toBe('Keep improving "Library"');
  });

  it('an overlap that names no app asks without a name, with a reply hint and no one-click choice', () => {
    const unnamed = { ...ITERATE_OR_NEW, existingAppOverlap: {} };
    render(<ChatbotEnhanced messages={messagesOf(proposal(unnamed))} onSendMessage={vi.fn()} />);
    expect(screen.getByTestId('proposed-plan-iterate-or-new-question').textContent).toContain(
      'an app you already have',
    );
    expect(screen.getByTestId('proposed-plan-iterate-or-new-hint')).toBeInTheDocument();
    expect(screen.queryByTestId('proposed-plan-iterate-or-new-choices')).toBeNull();
    expect(screen.queryByTestId('proposed-plan-approve')).toBeNull();
  });

  it('a host that wires no message sending gets the question and a reply hint', () => {
    render(<ChatbotEnhanced messages={messagesOf(proposal(ITERATE_OR_NEW))} />);
    expect(screen.getByTestId('proposed-plan-iterate-or-new-hint')).toBeInTheDocument();
    expect(screen.queryByTestId('proposed-plan-iterate-or-new-choices')).toBeNull();
  });

  it('once a build has run after it, the question stays and its choices go', () => {
    const wire: WireMessage[] = [
      ...proposal(ITERATE_OR_NEW),
      { id: 'u2', role: 'user', parts: [{ type: 'text', text: 'Build a separate, new app.' }] },
      {
        id: 'a2',
        role: 'assistant',
        parts: [
          {
            type: 'tool-apply_blueprint',
            toolCallId: 'build-1',
            state: 'output-available',
            output: { status: 'drafted', drafted: [{ type: 'object', name: 'book' }] },
          },
        ],
      },
    ] as WireMessage[];
    render(<ChatbotEnhanced messages={messagesOf(wire)} onSendMessage={vi.fn()} />);
    expect(screen.getByTestId('proposed-plan-iterate-or-new-question')).toBeInTheDocument();
    expect(screen.queryByTestId('proposed-plan-iterate-or-new-choices')).toBeNull();
    expect(screen.queryByTestId('proposed-plan-iterate-or-new-hint')).toBeNull();
  });
});
