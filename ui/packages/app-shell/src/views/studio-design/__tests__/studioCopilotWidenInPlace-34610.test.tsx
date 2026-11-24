/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * objectstack#34610 (ui ADR-0057 Amendment A3) — the Studio copilot's expand
 * control widens its slot IN PLACE and the same control narrows it again; the
 * Studio page stays where it is. objectstack#34725 moved the control into the
 * slot's one header row, so the pin mounts the slot around the copilot.
 *
 * It used to open `/ai/build?package=PKG` (objectui#12842). After
 * objectstack#34608 that address opens the console's drawer full window over
 * Home, so pressing it lost the Studio page.
 */
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';

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
import { StudioRightSlot } from '../StudioRightSlot';

function Where() {
  const location = useLocation();
  return <div data-testid="where">{`${location.pathname}${location.search}`}</div>;
}

function Slot() {
  const [wide, setWide] = useState(false);
  return (
    <>
      <div data-testid="slot-wide">{String(wide)}</div>
      <StudioRightSlot
        open
        mode="copilot"
        onModeChange={() => {}}
        hasProps={false}
        copilotAvailable
        planPendingCount={0}
        propsTargetRef={() => {}}
        wideWidth={wide ? 900 : undefined}
        wide={wide}
        onWideChange={setWide}
        locale="en"
        copilot={<StudioChatDock packageId="app.crm" />}
      />
      <Where />
    </>
  );
}

beforeEach(() => {
  window.sessionStorage.clear();
});

describe("the Studio copilot's expand control (objectstack#34610)", () => {
  it('widens the slot in place and narrows it again, never leaving the Studio page', () => {
    render(
      <MemoryRouter initialEntries={['/studio/app.crm/interfaces?surface=nav_dash']}>
        <Routes>
          <Route path="/studio/*" element={<Slot />} />
          <Route path="/ai/*" element={<div data-testid="left-studio" />} />
        </Routes>
      </MemoryRouter>,
    );
    const button = screen.getByTestId('studio-copilot-maximize');
    expect(button).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(button);
    expect(screen.getByTestId('slot-wide')).toHaveTextContent('true');
    expect(screen.getByTestId('studio-right-slot')).toHaveStyle({ width: '900px' });
    expect(screen.getByTestId('studio-copilot-maximize')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('where')).toHaveTextContent('/studio/app.crm/interfaces?surface=nav_dash');
    expect(screen.queryByTestId('left-studio')).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId('studio-copilot-maximize'));
    expect(screen.getByTestId('slot-wide')).toHaveTextContent('false');
  });
});
