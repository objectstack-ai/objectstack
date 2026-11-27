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
 * router. `useIsMobile` is a stand-in with the real hook's timing: `false` on
 * a host's first render, the window's width from its mount effect on, and
 * again on every resize. The sheet and the rail are stand-ins that show
 * whether the host mounts them open: which chrome is open is the subject, not
 * the chat inside. The chip is a stand-in that navigates the way the chat's
 * record-citation door does (a PUSH to the record route with fresh router
 * state).
 */

import '@testing-library/jest-dom/vitest';
// AiChatPage reads a dropped spreadsheet through `import('@object-ui/plugin-grid')`; load it
// here so collection pays that transform, not a clocked case (check-test-source-alias).
import '@object-ui/plugin-grid';
import { describe, it, expect, vi, afterEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation, useNavigate, useParams } from 'react-router-dom';

// `settleLate` holds a newly mounted host's first measurement back one task,
// so a REPLACE its page makes on mount lands while the flag still reads
// `false`: the order the console can take, pinned here deterministically.
let settleLate = false;
vi.mock('@object-ui/components', async (importOriginal) => {
  const R = await import('react');
  return {
    ...(await importOriginal<Record<string, unknown>>()),
    useIsMobile: () => {
      const [mobile, setMobile] = R.useState<boolean | undefined>(undefined);
      R.useEffect(() => {
        const measure = () => setMobile(window.innerWidth < 768);
        const late = settleLate ? setTimeout(measure, 0) : undefined;
        if (!settleLate) measure();
        window.addEventListener('resize', measure);
        return () => {
          clearTimeout(late);
          window.removeEventListener('resize', measure);
        };
      }, []);
      return !!mobile;
    },
  };
});

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
import { isAppAskPagePath } from '../consoleRoutePaths';
import { ChatDockControlProvider } from '../chatDockControl';
import { AssistantTopBarButton } from '../AssistantTopBarButton';

const HOME = '/home';
const CITED = '/apps/crm/account/record/a1?section=pricing';
// The app named by an alias: the app shell moves it to the package address on
// mount, with a REPLACE (`AppContent`'s alias redirect).
const CITED_BY_ALIAS = '/apps/crm-alias/account/record/a1?section=pricing';

function setWidth(width: number) {
  Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: width });
}

function resize(width: number) {
  setWidth(width);
  act(() => {
    window.dispatchEvent(new Event('resize'));
  });
}

function Host({ children }: { children?: React.ReactNode }) {
  const { control, rail, sheet } = useConsoleChatDock({ enabled: true, appPackageId: 'crm' });
  const navigate = useNavigate();
  const location = useLocation();
  return (
    <>
      <button data-testid="open-dock" onClick={() => control?.open({ conversationId: 'conv-1' })} />
      {/* The robot: opens the drawer on whatever it shows, naming no target. */}
      <button data-testid="reopen-dock" onClick={() => control?.open()} />
      <button data-testid="chip" onClick={() => navigate(CITED, { state: { opened: Math.random() } })} />
      <button
        data-testid="chip-by-alias"
        onClick={() => navigate(CITED_BY_ALIAS, { state: { opened: Math.random() } })}
      />
      <button data-testid="back" onClick={() => navigate(-1)} />
      <button
        data-testid="replace-same-page"
        onClick={() =>
          navigate({ pathname: location.pathname, search: location.search }, { replace: true, state: null })
        }
      />
      <output data-testid="location">{`${location.pathname}${location.search}`}</output>
      {rail}
      {sheet}
      {children}
    </>
  );
}

/**
 * `AppContent`'s alias redirect: on mount, an alias app segment is replaced by
 * the package's. Like `AppContent`, it is the PARENT of the layout that hosts
 * the drawer, so its mount effect runs after the host's first one.
 */
function AliasRedirect({ children }: { children: React.ReactNode }) {
  const { app } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  React.useEffect(() => {
    if (app !== 'crm-alias') return;
    navigate(
      { pathname: location.pathname.replace('/apps/crm-alias/', '/apps/crm/'), search: location.search },
      { replace: true, state: location.state },
    );
  }, [app, location, navigate]);
  return <>{children}</>;
}

function mount(entries: string[] = [HOME]) {
  return render(
    <MemoryRouter initialEntries={entries} initialIndex={entries.length - 1}>
      <Host />
    </MemoryRouter>,
  );
}

// Home and an app are two layouts, each hosting its own drawer: a chip on Home
// that opens an app's record unmounts one host and mounts another.
function mountTwoLayouts() {
  return render(
    <MemoryRouter initialEntries={[HOME]}>
      <Routes>
        <Route path="/home" element={<Host key="home-layout" />} />
        <Route
          path="/apps/:app/*"
          element={
            <AliasRedirect key="app-layout">
              <Host />
            </AliasRedirect>
          }
        />
      </Routes>
    </MemoryRouter>,
  );
}

const click = (id: string) => act(() => fireEvent.click(screen.getByTestId(id)));
const sheet = () => screen.getByTestId('chat-dock-mobile-sheet');

const realSessionStorage = Object.getOwnPropertyDescriptor(window, 'sessionStorage')!;

afterEach(() => {
  cleanup();
  settleLate = false;
  Object.defineProperty(window, 'sessionStorage', realSessionStorage);
  window.sessionStorage.clear();
  setWidth(1024);
});

describe('a chat navigation closes the phone sheet, not the desktop rail (objectstack#37556)', () => {
  it('a chip click on a phone closes the sheet, and reopening shows the same conversation', () => {
    setWidth(375);
    mount();
    click('open-dock');
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
    setWidth(375);
    mount([CITED]);
    click('open-dock');
    expect(sheet()).toHaveAttribute('data-open', 'true');

    click('chip');
    expect(screen.getByTestId('location')).toHaveTextContent(CITED);
    expect(sheet()).toHaveAttribute('data-open', 'false');
  });

  it('Back (a POP) away from the page the sheet was shown on closes it', () => {
    setWidth(375);
    mount([HOME, CITED]);
    click('open-dock');
    expect(sheet()).toHaveAttribute('data-open', 'true');

    click('back');
    expect(screen.getByTestId('location')).toHaveTextContent(HOME);
    expect(sheet()).toHaveAttribute('data-open', 'false');
  });

  it('a chip that leaves Home for an app (another layout, another host) closes the sheet too', () => {
    setWidth(375);
    mountTwoLayouts();
    click('open-dock');
    expect(sheet()).toHaveAttribute('data-open', 'true');

    click('chip');
    expect(screen.getByTestId('location')).toHaveTextContent(CITED);
    expect(sheet()).toHaveAttribute('data-open', 'false');

    click('reopen-dock');
    expect(sheet()).toHaveAttribute('data-open', 'true');
    expect(sheet()).toHaveAttribute('data-conversation', 'conv-1');
  });

  it("…and so does one naming the app by an alias, whose landing REPLACEs its address while the new host's phone flag is unsettled", async () => {
    setWidth(375);
    mountTwoLayouts();
    click('open-dock');
    expect(sheet()).toHaveAttribute('data-open', 'true');

    settleLate = true;
    click('chip-by-alias');
    expect(screen.getByTestId('location')).toHaveTextContent(CITED);
    // The REPLACE has landed and the new host still reads "not a phone".
    expect(screen.queryByTestId('chat-dock-mobile-sheet')).not.toBeInTheDocument();
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(sheet()).toHaveAttribute('data-open', 'false');
  });

  // Across layouts the drawer's own open state does not survive without
  // storage either, so the case that pins the in-memory copy is the same host.
  it('with sessionStorage throwing, a chip click still closes the sheet', () => {
    // Private mode in some browsers: reading `window.sessionStorage` throws.
    Object.defineProperty(window, 'sessionStorage', {
      configurable: true,
      get() {
        throw new DOMException('denied', 'SecurityError');
      },
    });
    setWidth(375);
    mount();
    click('open-dock');
    expect(sheet()).toHaveAttribute('data-open', 'true');

    click('chip');
    expect(screen.getByTestId('location')).toHaveTextContent(CITED);
    expect(sheet()).toHaveAttribute('data-open', 'false');
  });

  it('a REPLACE that keeps the page (the handoff hand-over) leaves the sheet open', () => {
    setWidth(375);
    mount();
    click('open-dock');
    click('replace-same-page');
    expect(sheet()).toHaveAttribute('data-open', 'true');
  });

  it('turning a tablet to landscape and back does not close the drawer on the turn', () => {
    setWidth(375);
    mount();
    click('open-dock');
    expect(sheet()).toHaveAttribute('data-open', 'true');

    resize(1024);
    expect(screen.getByTestId('chat-dock-panel')).toBeInTheDocument();
    click('chip');
    expect(screen.getByTestId('chat-dock-panel')).toBeInTheDocument();

    resize(375);
    expect(sheet()).toHaveAttribute('data-open', 'true');
  });

  it('control: on a desktop the rail stays open after the same chip click', () => {
    setWidth(1024);
    mount();
    click('open-dock');
    expect(screen.getByTestId('chat-dock-panel')).toBeInTheDocument();

    click('chip');
    expect(screen.getByTestId('location')).toHaveTextContent(CITED);
    expect(screen.getByTestId('chat-dock-panel')).toBeInTheDocument();
    expect(screen.queryByTestId('chat-dock-mobile-sheet')).not.toBeInTheDocument();
  });
});

// ui ADR-0057 Amendment A4 (objectstack#37788) — on an app's AI inquiry page
// the drawer is closed and its triggers are hidden or inert, so one screen
// never holds two ask conversations; a build hand-off still opens it, and on
// every other page the drawer is as the user left it. The host is the real
// `useConsoleChatDock`, told the route the way `ConsoleLayout` tells it.
const ASK_PAGE = '/apps/crm/component/ai/chat';
const LIST_PAGE = '/apps/crm/account';

function AskPageHost() {
  const location = useLocation();
  const navigate = useNavigate();
  const { control, rail, sheet } = useConsoleChatDock({
    enabled: true,
    appPackageId: 'crm',
    askPageActive: isAppAskPagePath(location.pathname),
  });
  return (
    <ChatDockControlProvider value={control}>
      <AssistantTopBarButton />
      <button data-testid="open-ask" onClick={() => control?.open()} />
      <button data-testid="open-ask-thread" onClick={() => control?.open({ agent: 'ask', conversationId: 'c-ask' })} />
      <button data-testid="open-build" onClick={() => control?.open({ agent: 'build' })} />
      <button data-testid="to-ask-page" onClick={() => navigate(ASK_PAGE)} />
      <button data-testid="to-list" onClick={() => navigate(LIST_PAGE)} />
      {rail}
      {sheet}
    </ChatDockControlProvider>
  );
}

function mountAskPageHost(entry: string) {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <AskPageHost />
    </MemoryRouter>,
  );
}

/** ⌘/Ctrl+Shift+I — the dock's own toggle, as a user presses it. */
const pressToggleChord = () => {
  fireEvent.keyDown(document, { key: 'I', metaKey: true, shiftKey: true });
};
const rail = () => screen.queryByTestId('chat-dock-panel');
const robot = () => screen.queryByTestId('topbar-ai-assistant');

describe('the AI inquiry page holds the one ask conversation on its screen (objectstack#37788)', () => {
  it('the drawer is closed on the page and comes back as it was on the next page', () => {
    setWidth(1024);
    mountAskPageHost(LIST_PAGE);
    click('open-ask');
    expect(rail()).toBeInTheDocument();

    click('to-ask-page');
    expect(rail()).not.toBeInTheDocument();

    click('to-list');
    expect(rail()).toBeInTheDocument();
  });

  it('the robot is hidden on the page only', () => {
    setWidth(1024);
    mountAskPageHost(ASK_PAGE);
    expect(robot()).not.toBeInTheDocument();
    click('to-list');
    expect(robot()).toBeInTheDocument();
  });

  it('the keyboard toggle and an ask open are inert on the page', () => {
    setWidth(1024);
    mountAskPageHost(ASK_PAGE);
    pressToggleChord();
    expect(rail()).not.toBeInTheDocument();
    click('open-ask');
    expect(rail()).not.toBeInTheDocument();
    click('open-ask-thread');
    expect(rail()).not.toBeInTheDocument();
  });

  it('control: off the page the keyboard toggle opens the drawer', () => {
    setWidth(1024);
    mountAskPageHost(LIST_PAGE);
    pressToggleChord();
    expect(rail()).toBeInTheDocument();
  });

  it('on a phone, a sheet open on arrival is closed by the page and stays closed on the next page (objectstack#37556 kept)', () => {
    setWidth(375);
    mountAskPageHost(LIST_PAGE);
    click('open-ask');
    expect(sheet()).toHaveAttribute('data-open', 'true');

    click('to-ask-page');
    expect(sheet()).toHaveAttribute('data-open', 'false');

    click('to-list');
    expect(sheet()).toHaveAttribute('data-open', 'false');
  });

  it('on a phone, a build hand-off from the page still opens the sheet', () => {
    setWidth(375);
    mountAskPageHost(ASK_PAGE);
    click('open-build');
    expect(sheet()).toHaveAttribute('data-open', 'true');
  });

  it('a build hand-off from the page still opens the drawer', () => {
    setWidth(1024);
    mountAskPageHost(ASK_PAGE);
    click('open-build');
    expect(rail()).toBeInTheDocument();
  });
});
