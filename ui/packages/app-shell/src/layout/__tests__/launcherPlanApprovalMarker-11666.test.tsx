/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * objectui#11666 — both chat launchers (the console FAB and the ChatDock edge
 * launcher Studio uses) carry a marker while a proposed plan awaits the user's
 * approval, with a translated accessible name, and nothing otherwise.
 *
 * The launchers read the assistant bus, which a mounted chat publishes to
 * (`publishPlanApprovalPending`; the ChatPane → bus → FAB path is pinned in
 * `AiChatPage.planApprovalReachesLaunchers-11666.test.tsx`). The marker text is
 * exposed as the button's accessible DESCRIPTION: a button's children are
 * presentational, so a name on the dot itself would reach no assistive tech.
 */
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import React from 'react';
import { I18nProvider } from '@object-ui/i18n';
import { builtInLocales } from '@object-ui/i18n/locales';
import { ConsoleChatbotFab } from '../ConsoleChatbotFab';
import { ChatDockLauncher } from '../ChatDock';
import { publishPlanApprovalPending } from '../../assistant/assistantBus';

// The ChatDock module's default body drags in the whole chat graph — irrelevant
// to the launcher, which is all this file renders from it.
vi.mock('../../console/ai/AiChatPage', () => ({
  ChatPane: () => null,
  resolveApiBase: (explicit?: string) => explicit ?? '/api/v1/ai',
}));

const EN_MARKER = 'A proposed plan is waiting for your approval';

// No AuthProvider here: `useAuth` answers its signed-out default, whose user id
// the bus reads as '' — the owner every reading below is published for.
const ME = undefined;

const LAUNCHERS = [
  {
    name: 'console FAB',
    testId: 'console-chatbot-fab',
    markerTestId: 'console-chatbot-fab-plan-pending',
    element: <ConsoleChatbotFab appLabel="Workspace" onOpenDock={() => {}} />,
  },
  {
    name: 'ChatDock launcher',
    testId: 'chat-dock-launcher',
    markerTestId: 'chat-dock-launcher-plan-pending',
    element: <ChatDockLauncher onExpand={() => {}} />,
  },
] as const;

function renderIn(locale: string, element: React.ReactElement) {
  return render(
    <I18nProvider config={{ defaultLanguage: locale, detectBrowserLanguage: false }}>{element}</I18nProvider>,
  );
}

function publish(conversationId: string, pending: boolean, userId: string | undefined = ME) {
  act(() => publishPlanApprovalPending({ userId, conversationId, pending }));
}

afterEach(() => {
  // The bus is a module singleton: drop every reading a case left behind.
  for (const id of ['conv-a', 'conv-b']) {
    for (const userId of [ME, 'someone-else']) {
      act(() => publishPlanApprovalPending({ userId, conversationId: id, pending: false }));
    }
  }
  cleanup();
  window.localStorage.clear();
});

describe.each(LAUNCHERS)('$name — the plan-awaiting-approval marker (objectui#11666)', (launcher) => {
  it('shows nothing while no plan awaits approval', () => {
    renderIn('en', launcher.element);
    expect(screen.queryByTestId(launcher.markerTestId)).not.toBeInTheDocument();
    expect(screen.getByTestId(launcher.testId)).not.toHaveAttribute('aria-describedby');
  });

  it('shows the marker, with its translated accessible name, while one does', () => {
    renderIn('en', launcher.element);
    publish('conv-a', true);

    expect(screen.getByTestId(launcher.markerTestId)).toBeInTheDocument();
    expect(screen.getByTestId(launcher.testId)).toHaveAccessibleDescription(EN_MARKER);
  });

  it('names the marker in the UI locale, not in hard-coded English', async () => {
    renderIn('zh', launcher.element);
    publish('conv-a', true);

    const zh = (builtInLocales.zh as unknown as { console: { ai: { dock: { planAwaitingApproval: string } } } })
      .console.ai.dock.planAwaitingApproval;
    expect(zh).not.toBe(EN_MARKER);
    await vi.waitFor(() =>
      expect(screen.getByTestId(launcher.testId)).toHaveAccessibleDescription(zh),
    );
  });

  it('clears when the plan stops awaiting (approved, built or superseded), not before', () => {
    renderIn('en', launcher.element);
    publish('conv-a', true);
    expect(screen.getByTestId(launcher.markerTestId)).toBeInTheDocument();

    publish('conv-a', false);
    expect(screen.queryByTestId(launcher.markerTestId)).not.toBeInTheDocument();
    expect(screen.getByTestId(launcher.testId)).not.toHaveAttribute('aria-describedby');
  });

  it('a chat opened on ANOTHER thread clears nothing — the waiting plan still shows', () => {
    renderIn('en', launcher.element);
    publish('conv-a', true);
    publish('conv-b', false);
    expect(screen.getByTestId(launcher.markerTestId)).toBeInTheDocument();
  });

  it("never shows another user's reading (the SPA outlives a sign-out)", () => {
    renderIn('en', launcher.element);
    publish('conv-a', true, 'someone-else');
    expect(screen.queryByTestId(launcher.markerTestId)).not.toBeInTheDocument();
  });
});

describe('every locale pack names the marker (objectui#11666)', () => {
  it.each(Object.keys(builtInLocales))('%s', (code) => {
    const pack = builtInLocales[code as keyof typeof builtInLocales] as unknown as {
      console: { ai: { dock: { planAwaitingApproval?: unknown } } };
    };
    const text = pack.console.ai.dock.planAwaitingApproval;
    expect(typeof text).toBe('string');
    expect((text as string).trim()).not.toBe('');
    if (code !== 'en') expect(text).not.toBe(EN_MARKER);
  });
});
