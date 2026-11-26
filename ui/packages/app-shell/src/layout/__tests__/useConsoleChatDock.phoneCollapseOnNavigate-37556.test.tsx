// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#37556 — on a phone the assistant drawer is a bottom sheet over
 * the page. A citation chip in it navigates to the cited record section, and
 * the sheet must get out of the way so the marked heading is visible; on a
 * desktop the drawer is a rail beside the page and stays open.
 *
 * ## Real subjects
 *
 * The real `useConsoleChatDock` host, the real `useChatDockState`, the real
 * router. The sheet and the rail are stand-ins that show whether the host
 * mounts them open: which chrome is open is the subject, not the chat inside.
 * The chip is a stand-in that navigates the way the chat's record-citation
 * door does (a PUSH to the record route with fresh router state).
 */

import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from 'react-router-dom';

let mobile = true;
vi.mock('@object-ui/components', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useIsMobile: () => mobile,
}));

vi.mock('../ChatDock', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  ChatDockPanel: () => <aside data-testid="chat-dock-panel" />,
  ChatDockMobileSheet: ({ open, target }: { open: boolean; target?: { conversationId?: string } }) => (
    <div
      data-testid="chat-dock-mobile-sheet"
      data-open={String(open)}
      data-conversation={target?.conversationId ?? ''}
    />
  ),
}));

import { useConsoleChatDock } from '../useConsoleChatDock';

const HOME = '/apps/crm';
const CITED = '/apps/crm/account/record/a1?section=pricing';

function Host() {
  const { control, rail, sheet } = useConsoleChatDock({ enabled: true, appPackageId: 'crm' });
  const navigate = useNavigate();
  const location = useLocation();
  return (
    <>
      <button
        data-testid="open-dock"
        onClick={() => control?.open({ conversationId: 'conv-1' })}
      />
      {/* The robot: opens the drawer on whatever it shows, naming no target. */}
      <button data-testid="reopen-dock" onClick={() => control?.open()} />
      <button
        data-testid="chip"
        onClick={() => navigate(CITED, { state: { opened: Math.random() } })}
      />
      <button
        data-testid="replace-same-page"
        onClick={() =>
          navigate({ pathname: location.pathname, search: location.search }, { replace: true, state: null })
        }
      />
      <output data-testid="location">{`${location.pathname}${location.search}`}</output>
      {rail}
      {sheet}
    </>
  );
}

function mount(at = HOME) {
  return render(
    <MemoryRouter initialEntries={[at]}>
      <Host />
    </MemoryRouter>,
  );
}

// Home and an app are two layouts, each hosting its own drawer: a chip on Home
// that opens an app's record unmounts one host and mounts another.
function mountTwoLayouts() {
  return render(
    <MemoryRouter initialEntries={['/home']}>
      <Routes>
        <Route path="/home" element={<Host key="home-layout" />} />
        <Route path="/apps/*" element={<Host key="app-layout" />} />
      </Routes>
    </MemoryRouter>,
  );
}

const click = (id: string) => act(() => fireEvent.click(screen.getByTestId(id)));

beforeEach(() => {
  mobile = true;
});

afterEach(() => {
  cleanup();
  window.sessionStorage.clear();
});

describe('a chat navigation closes the phone sheet, not the desktop rail (objectstack#37556)', () => {
  it('a chip click on a phone closes the sheet, and reopening shows the same conversation', () => {
    mount();
    click('open-dock');
    const sheet = () => screen.getByTestId('chat-dock-mobile-sheet');
    expect(sheet()).toHaveAttribute('data-open', 'true');
    expect(sheet()).toHaveAttribute('data-conversation', 'conv-1');

    click('chip');
    expect(screen.getByTestId('location')).toHaveTextContent(CITED);
    expect(sheet()).toHaveAttribute('data-open', 'false');

    click('reopen-dock');
    expect(sheet()).toHaveAttribute('data-open', 'true');
    expect(sheet()).toHaveAttribute('data-conversation', 'conv-1');
  });

  it('clicking the same chip again (same URL, a PUSH) closes the reopened sheet again', () => {
    mount(CITED);
    click('open-dock');
    expect(screen.getByTestId('chat-dock-mobile-sheet')).toHaveAttribute('data-open', 'true');

    click('chip');
    expect(screen.getByTestId('location')).toHaveTextContent(CITED);
    expect(screen.getByTestId('chat-dock-mobile-sheet')).toHaveAttribute('data-open', 'false');
  });

  it('a chip that leaves Home for an app (another layout, another host) closes the sheet too', () => {
    mountTwoLayouts();
    click('open-dock');
    expect(screen.getByTestId('chat-dock-mobile-sheet')).toHaveAttribute('data-open', 'true');

    click('chip');
    expect(screen.getByTestId('location')).toHaveTextContent(CITED);
    expect(screen.getByTestId('chat-dock-mobile-sheet')).toHaveAttribute('data-open', 'false');

    click('reopen-dock');
    expect(screen.getByTestId('chat-dock-mobile-sheet')).toHaveAttribute('data-open', 'true');
    expect(screen.getByTestId('chat-dock-mobile-sheet')).toHaveAttribute('data-conversation', 'conv-1');
  });

  it('a REPLACE that keeps the page (the handoff hand-over) leaves the sheet open', () => {
    mount();
    click('open-dock');
    click('replace-same-page');
    expect(screen.getByTestId('chat-dock-mobile-sheet')).toHaveAttribute('data-open', 'true');
  });

  it('control: on a desktop the rail stays open after the same chip click', () => {
    mobile = false;
    mount();
    click('open-dock');
    expect(screen.getByTestId('chat-dock-panel')).toBeInTheDocument();

    click('chip');
    expect(screen.getByTestId('location')).toHaveTextContent(CITED);
    expect(screen.getByTestId('chat-dock-panel')).toBeInTheDocument();
    expect(screen.queryByTestId('chat-dock-mobile-sheet')).not.toBeInTheDocument();
  });
});
