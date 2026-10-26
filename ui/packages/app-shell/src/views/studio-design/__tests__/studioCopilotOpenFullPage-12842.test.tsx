/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * objectui#12842 — the Studio copilot's 「在完整页面中打开」 button opens the
 * package's build surface and remembers where it was pressed, so the page's
 * collapse-to-dock comes back to this Studio surface.
 *
 * That is all the button does. It used to also leave a one-shot opt-out in
 * session storage for the built-moment transition; objectui#12724 removed that
 * transition, so nothing read the flag and the write went with it.
 */
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { readDockReturnLocation } from '../../../layout/chatDockState';

vi.mock('@object-ui/plugin-chatbot/core', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@object-ui/plugin-chatbot/core')>()),
  useAgents: () => ({ agents: [{ name: 'build' }], isLoading: false, error: null }),
}));
// Partial — the module also feeds the metadata client factory, which imports
// `createAuthenticatedFetch` from it at load time.
vi.mock('@object-ui/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAuth: () => ({ user: { id: 'u1' } }),
}));
// The usage probe reads the network; it is the console's, unchanged here.
vi.mock('../../../layout/AiUsageIndicator', () => ({ AiUsageIndicator: () => null }));
vi.mock('../../../console/ai/AiChatPage', () => ({
  ChatPane: () => null,
  resolveApiBase: () => '/api/v1',
}));
vi.mock('../../../hooks/useChatConversation', () => ({
  useChatConversation: () => ({ conversationId: 'c1', initialMessages: [] }),
}));

import { StudioChatDock } from '../StudioAiCopilot';

function Where() {
  const location = useLocation();
  return <div data-testid="where">{`${location.pathname}${location.search}`}</div>;
}

beforeEach(() => {
  window.sessionStorage.clear();
});

describe('the Studio copilot\'s full-page button (objectui#12842)', () => {
  it('opens /ai/build?package=PKG and remembers the Studio surface it left', () => {
    render(
      <MemoryRouter initialEntries={['/studio/app.crm/interfaces?surface=nav_dash']}>
        <Routes>
          <Route path="/studio/*" element={<StudioChatDock packageId="app.crm" />} />
          <Route path="/ai/*" element={<Where />} />
        </Routes>
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByTestId('studio-copilot-maximize'));
    expect(screen.getByTestId('where')).toHaveTextContent('/ai/build?package=app.crm');
    expect(readDockReturnLocation()).toBe('/studio/app.crm/interfaces?surface=nav_dash');
  });
});
