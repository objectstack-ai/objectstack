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

// The stand-ins report the conversation they show, as the real body does
// (`onShownConversationChange`), and offer the user's two closes: the rail's
// × (`dock.collapse`) and dismissing the sheet (`onOpenChange(false)`).
interface StandInTarget {
  conversationId?: string;
  agent?: string;
  fresh?: boolean;
}
interface StandInShown {
  onShownConversationChange?: (shown: { conversationId?: string; agent?: string }) => void;
}
// A closed sheet's body is unmounted, so it reports nothing.
function useReportShown(target: StandInTarget | undefined, { onShownConversationChange }: StandInShown, shown = true) {
  React.useEffect(() => {
    if (!shown) return;
    onShownConversationChange?.({ conversationId: target?.conversationId, agent: target?.agent ?? 'ask' });
  }, [onShownConversationChange, target?.conversationId, target?.agent, shown]);
}
const shownAttrs = (target: StandInTarget | undefined) => ({
  'data-conversation': target?.conversationId ?? '',
  'data-fresh': String(Boolean(target?.fresh)),
  'data-agent': target?.agent ?? '',
});
vi.mock('../ChatDock', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  ChatDockPanel: (props: { target?: StandInTarget; dock: { collapse: () => void } } & StandInShown) => {
    useReportShown(props.target, props);
    return (
      <aside data-testid="chat-dock-panel" {...shownAttrs(props.target)}>
        <button data-testid="dock-close" onClick={props.dock.collapse} />
      </aside>
    );
  },
  ChatDockMobileSheet: (
    props: { open: boolean; onOpenChange: (open: boolean) => void; target?: StandInTarget } & StandInShown,
  ) => {
    useReportShown(props.target, props, props.open);
    return (
      <div data-testid="chat-dock-mobile-sheet" data-open={String(props.open)} {...shownAttrs(props.target)}>
        <button data-testid="sheet-dismiss" onClick={() => props.onOpenChange(false)} />
      </div>
    );
  },
}));

import { useConsoleChatDock } from '../useConsoleChatDock';
import { isAppAskPagePath } from '../consoleRoutePaths';
import { ChatDockControlProvider } from '../chatDockControl';
import { AssistantTopBarButton, useAskAiEntry } from '../AssistantTopBarButton';
import { publishPlanApprovalPending, requestAssistantOpen } from '../../assistant/assistantBus';

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

// ui ADR-0057 Amendment A5 (objectstack#37860) — what an opening from the
// assistant's entry shows, row by row of A5's table. The entry's three doors
// are the top-bar 「Ask AI」 button, the keyboard toggle and Home's 「Ask AI」
// (`useAskAiEntry` with the `ask` agent); the host is the real
// `useConsoleChatDock`, and the stand-ins above report the conversation shown
// and offer the user's closes.
function EntryHost({ defaultAgent }: { defaultAgent?: string }) {
  const navigate = useNavigate();
  const { control, rail, sheet } = useConsoleChatDock({
    enabled: true,
    userId: 'u1',
    appPackageId: 'crm',
    defaultAgent,
  });
  return (
    <ChatDockControlProvider value={control}>
      <AssistantTopBarButton />
      <HomeAskAi />
      <button data-testid="open-dock" onClick={() => control?.open({ conversationId: 'conv-1' })} />
      <button data-testid="open-build-pkg" onClick={() => control?.open({ agent: 'build', packageId: 'crm' })} />
      <button data-testid="chip" onClick={() => navigate(CITED, { state: { opened: Math.random() } })} />
      {rail}
      {sheet}
    </ChatDockControlProvider>
  );
}

/** Home's 「Ask AI」, as `HomePage` wires it. */
function HomeAskAi() {
  const askAi = useAskAiEntry();
  return <button data-testid="home-ask-ai" onClick={() => askAi({ agent: 'ask' })} />;
}

function mountEntryHost(props: { defaultAgent?: string } = {}) {
  return render(
    <MemoryRouter initialEntries={[LIST_PAGE]}>
      <EntryHost {...props} />
    </MemoryRouter>,
  );
}

const entry = () => click('topbar-ai-assistant');
const shown = () => screen.queryByTestId('chat-dock-panel');

describe('an opening from the entry starts a new conversation (ui ADR-0057 A5, objectstack#37860)', () => {
  afterEach(() => {
    for (const conversationId of ['conv-1', 'conv-2']) {
      publishPlanApprovalPending({ userId: 'u1', conversationId, pending: false });
    }
  });

  it('row 1: the first opening in a tab is a new conversation (forceNew), on the ambient agent', () => {
    setWidth(1024);
    mountEntryHost();
    entry();
    expect(shown()).toHaveAttribute('data-fresh', 'true');
    expect(shown()).toHaveAttribute('data-conversation', '');
  });

  it("row 1: after the drawer's × the entry opens a new conversation, not the one closed", () => {
    setWidth(1024);
    mountEntryHost();
    click('open-dock');
    expect(shown()).toHaveAttribute('data-conversation', 'conv-1');
    click('dock-close');
    expect(shown()).not.toBeInTheDocument();
    entry();
    expect(shown()).toHaveAttribute('data-fresh', 'true');
    expect(shown()).toHaveAttribute('data-conversation', '');
  });

  it('row 1: closing with the entry or the keyboard toggle is the user\'s close too', () => {
    setWidth(1024);
    mountEntryHost();
    click('open-dock');
    entry();
    expect(shown()).not.toBeInTheDocument();
    entry();
    expect(shown()).toHaveAttribute('data-fresh', 'true');

    cleanup();
    window.sessionStorage.clear();
    mountEntryHost();
    click('open-dock');
    act(() => pressToggleChord());
    expect(shown()).not.toBeInTheDocument();
    act(() => pressToggleChord());
    expect(shown()).toHaveAttribute('data-fresh', 'true');
  });

  it("row 2: after the console collapsed the phone sheet (a chat link) the entry shows the same conversation", () => {
    setWidth(375);
    mountEntryHost();
    click('open-dock');
    expect(sheet()).toHaveAttribute('data-open', 'true');
    click('chip');
    expect(sheet()).toHaveAttribute('data-open', 'false');
    entry();
    expect(sheet()).toHaveAttribute('data-open', 'true');
    expect(sheet()).toHaveAttribute('data-conversation', 'conv-1');
    expect(sheet()).toHaveAttribute('data-fresh', 'false');
  });

  it('row 1: dismissing the phone sheet is the user\'s close: the entry opens a new conversation', () => {
    setWidth(375);
    mountEntryHost();
    click('open-dock');
    click('sheet-dismiss');
    expect(sheet()).toHaveAttribute('data-open', 'false');
    entry();
    expect(sheet()).toHaveAttribute('data-open', 'true');
    expect(sheet()).toHaveAttribute('data-fresh', 'true');
  });

  it('row 3: a write awaiting approval in the conversation shown at the close reopens that conversation', () => {
    setWidth(1024);
    mountEntryHost();
    click('open-dock');
    act(() => publishPlanApprovalPending({ userId: 'u1', conversationId: 'conv-1', pending: true }));
    click('dock-close');
    entry();
    expect(shown()).toHaveAttribute('data-conversation', 'conv-1');
    expect(shown()).toHaveAttribute('data-fresh', 'false');
  });

  it("row 3 control: a write pending in another conversation, or one read for another user, is no exception", () => {
    setWidth(1024);
    mountEntryHost();
    click('open-dock');
    act(() => publishPlanApprovalPending({ userId: 'u1', conversationId: 'conv-2', pending: true }));
    act(() => publishPlanApprovalPending({ userId: 'someone-else', conversationId: 'conv-1', pending: true }));
    click('dock-close');
    entry();
    expect(shown()).toHaveAttribute('data-fresh', 'true');
  });

  it('row 5: a named target after the close still opens what it names', () => {
    setWidth(1024);
    mountEntryHost();
    click('open-dock');
    click('dock-close');
    click('open-dock');
    expect(shown()).toHaveAttribute('data-conversation', 'conv-1');
  });

  it('row 6: a reload is not an opening; after a reload the entry still reads the last close', () => {
    setWidth(1024);
    const first = mountEntryHost();
    click('open-dock');
    first.unmount();
    mountEntryHost();
    expect(shown()).toHaveAttribute('data-conversation', 'conv-1');
    click('dock-close');

    cleanup();
    mountEntryHost();
    expect(shown()).not.toBeInTheDocument();
    entry();
    expect(shown()).toHaveAttribute('data-fresh', 'true');
  });

  it('row 7: the assistant bus opens on what the drawer shows, as before', () => {
    setWidth(1024);
    mountEntryHost();
    click('open-dock');
    click('dock-close');
    act(() => requestAssistantOpen());
    expect(shown()).toHaveAttribute('data-conversation', 'conv-1');
  });

  it("row 8: in an app whose defaultAgent is 'build' the entry resumes, as before", () => {
    setWidth(1024);
    mountEntryHost({ defaultAgent: 'build' });
    click('open-dock');
    click('dock-close');
    entry();
    expect(shown()).toHaveAttribute('data-conversation', 'conv-1');
    expect(shown()).toHaveAttribute('data-fresh', 'false');
  });

  it('row 8: a build target naming a package is resumed by the entry, as before', () => {
    setWidth(1024);
    mountEntryHost();
    click('open-build-pkg');
    click('dock-close');
    entry();
    expect(shown()).toHaveAttribute('data-agent', 'build');
    expect(shown()).toHaveAttribute('data-fresh', 'false');
  });

  it("Home's 「Ask AI」 is the entry: a new conversation on the ask agent, even after a build thread", () => {
    setWidth(1024);
    mountEntryHost();
    click('open-build-pkg');
    click('dock-close');
    click('home-ask-ai');
    expect(shown()).toHaveAttribute('data-fresh', 'true');
    expect(shown()).toHaveAttribute('data-agent', 'ask');
  });

  it("control: with the drawer open, Home's 「Ask AI」 is no opening and opens on its agent as before", () => {
    setWidth(1024);
    mountEntryHost();
    click('open-dock');
    click('home-ask-ai');
    expect(shown()).toHaveAttribute('data-agent', 'ask');
    expect(shown()).toHaveAttribute('data-fresh', 'false');
  });
});
