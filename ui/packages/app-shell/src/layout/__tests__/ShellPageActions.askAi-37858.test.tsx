// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#37858 — where the Ask AI entry sits, and how a header makes room.
 *
 * - The page's button group ends with it: comments, help, then Ask AI.
 * - A route whose page draws no group gets it at the content's top end
 *   corner (`ShellAssistantFallback`; top-right, top-left right to left),
 *   never beside a group, never on a phone (its top bar carries the entry),
 *   never where the runtime serves no AI.
 * - The console `PageHeader` hides the entry's words first: before the title
 *   is cut, and before the page's own actions fold; once there is room again
 *   the fold opens first and the words come back last. A page that offers no
 *   fold keeps the words while only its description is cut, as it did before.
 *
 * Real subjects: `ShellPageActionsScope`, `ShellAssistantFallback`,
 * `PageHeader`, `AssistantTopBarButton`. The AI surface's answer and the help
 * menu are stand-ins (each pinned in its own file); `t` echoes the inline
 * English default. Layout is a stand-in too: jsdom lays nothing out, so the
 * header's measured widths come from a small model of the row (see `LAYOUT`).
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const ai = vi.hoisted(() => ({ enabled: true }));
vi.mock('../../hooks/useAiSurface', () => ({
  useAiSurfaceEnabled: () => ({ enabled: ai.enabled, loading: false }),
  resolveAiApiBase: () => '/api/v1/ai',
}));
vi.mock('../HelpMenu', () => ({
  HelpMenu: ({ triggerTestId }: { triggerTestId?: string }) => (
    <button type="button" data-testid={triggerTestId ?? 'help'}>
      ?
    </button>
  ),
}));
vi.mock('@object-ui/i18n', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useObjectTranslation: () => ({
    t: (k: string, o?: Record<string, unknown>) => String(o?.defaultValue ?? k),
    language: 'en',
  }),
}));
vi.mock('../../providers/MetadataProvider', () => ({
  useMetadata: () => ({ apps: [{ name: 'crm', label: 'CRM' }], objects: [], pages: [] }),
}));

import { ShellAssistantFallback, ShellPageActions, ShellPageActionsScope } from '../ShellPageActions';
import { PageHeader } from '../PageHeader';
import { useShellPageActionsSlot } from '../shellPageActionsSlot';
import { ChatDockControlProvider, type ChatDockControl } from '../chatDockControl';

const CONTROL: ChatDockControl = { expanded: false, fullWindow: false, toggle: () => {}, open: () => {} };
const setWidth = (value: number) => Object.defineProperty(window, 'innerWidth', { configurable: true, value });

function inShell(node: React.ReactNode, { on = true } = {}) {
  return (
    <MemoryRouter initialEntries={['/apps/crm/crm_account']}>
      <ChatDockControlProvider value={CONTROL}>
        <ShellPageActionsScope on={on}>
          <ShellAssistantFallback />
          {node}
        </ShellPageActionsScope>
      </ChatDockControlProvider>
    </MemoryRouter>
  );
}

beforeEach(() => {
  ai.enabled = true;
  setWidth(1280);
});

afterEach(() => {
  cleanup();
  setWidth(1024);
});

describe('the group ends with Ask AI (objectstack#37858)', () => {
  it('comments, help, then Ask AI — the last button of the row', () => {
    render(inShell(<ShellPageActions comments={<span data-testid="comments-slot" />} />));
    const group = screen.getByTestId('shell-page-actions');
    const ids = Array.from(group.children).map((c) => c.getAttribute('data-testid'));
    expect(ids).toEqual(['comments-slot', 'shell-page-actions-help', 'topbar-ai-assistant']);
    expect(within(group).getByTestId('topbar-ai-assistant')).toHaveAccessibleName('Ask AI');
  });

  it('a header that asks for it gets the icon alone', () => {
    render(inShell(<ShellPageActionsAsHeader />));
    expect(screen.getByTestId('topbar-ai-assistant')).toHaveAttribute('data-icon-only', 'true');
    expect(screen.getByTestId('topbar-ai-assistant')).toHaveAttribute('aria-label', 'Ask AI');
  });
});

/** Draws the group through the slot with the icon-only request, as a measuring header does. */
function ShellPageActionsAsHeader() {
  const renderGroup = useShellPageActionsSlot();
  return <>{renderGroup?.({ assistantIconOnly: true })}</>;
}

describe('a route with no group gets the entry at its corner (objectstack#37858)', () => {
  it('drawn where no page draws the group, at the top end corner', () => {
    render(inShell(<div data-testid="search-results" />));
    const fallback = screen.getByTestId('shell-assistant-fallback');
    const button = within(fallback).getByTestId('topbar-ai-assistant');
    expect(button).toHaveAccessibleName('Ask AI');
    expect(button.className.split(/\s+/)).toEqual(expect.arrayContaining(['absolute', 'end-2', 'top-2']));
    expect(screen.getAllByTestId('topbar-ai-assistant')).toHaveLength(1);
  });

  it('gone as soon as the page draws a group, so there is never a second entry', () => {
    render(inShell(<PageHeader title="Accounts" />));
    expect(screen.queryByTestId('shell-assistant-fallback')).toBeNull();
    expect(screen.getAllByTestId('topbar-ai-assistant')).toHaveLength(1);
    expect(within(screen.getByTestId('page-header')).getByTestId('topbar-ai-assistant')).toBeInTheDocument();
  });

  it('not on a phone, not with the group turned off, not where the runtime serves no AI', () => {
    setWidth(375);
    render(inShell(<div />));
    expect(screen.queryByTestId('shell-assistant-fallback')).toBeNull();
    cleanup();

    setWidth(1280);
    render(inShell(<div />, { on: false }));
    expect(screen.queryByTestId('shell-assistant-fallback')).toBeNull();
    cleanup();

    ai.enabled = false;
    render(inShell(<div />));
    expect(screen.queryByTestId('shell-assistant-fallback')).toBeNull();
  });
});

/**
 * The row's layout model: the header row is `row` px wide; the action cluster
 * is the page's actions (`actions`, or `folded` once folded) plus the group
 * (help and the Ask AI icon) plus the entry's words while drawn; the text block
 * gets the rest. The title's content is `title` px, the description's `desc`.
 */
const LAYOUT = { row: 1000, title: 100, desc: 0, actions: 200, folded: 80, group: 64, words: 60 };

function clusterWidth(cluster: Element): number {
  const folded = cluster.querySelector('[data-testid="folded-actions"]') !== null;
  const own = cluster.querySelector('[data-testid="own-actions"]') !== null;
  const words = cluster.querySelector('[data-testid="topbar-ai-assistant-text"]') !== null;
  return (folded ? LAYOUT.folded : own ? LAYOUT.actions : 0) + LAYOUT.group + (words ? LAYOUT.words : 0);
}

function textRoom(text: Element): number {
  const header = text.closest('[data-testid="page-header"]');
  const cluster = header?.querySelector('[data-testid="page-header-actions"]');
  return LAYOUT.row - (cluster ? clusterWidth(cluster) : 0);
}

const isText = (el: Element) => Array.from(el.children).some((child) => child.tagName === 'H1');
const rect = (width: number) => ({ width, height: 0, top: 0, left: 0, right: width, bottom: 0, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;

function installLayout() {
  const restore: Array<() => void> = [];
  const define = (proto: object, key: string, descriptor: PropertyDescriptor) => {
    const original = Object.getOwnPropertyDescriptor(proto, key);
    Object.defineProperty(proto, key, { configurable: true, ...descriptor });
    restore.push(() => (original ? Object.defineProperty(proto, key, original) : delete (proto as Record<string, unknown>)[key]));
  };
  define(HTMLElement.prototype, 'getBoundingClientRect', {
    value(this: HTMLElement) {
      if (this.dataset.testid === 'page-header-actions') return rect(clusterWidth(this));
      if (this.tagName === 'H1') {
        const text = this.parentElement;
        return rect(Math.min(LAYOUT.title, text ? textRoom(text) : LAYOUT.title));
      }
      return rect(0);
    },
  });
  define(HTMLElement.prototype, 'clientWidth', {
    get(this: HTMLElement) {
      return isText(this) ? textRoom(this) : 0;
    },
  });
  define(HTMLElement.prototype, 'scrollWidth', {
    get(this: HTMLElement) {
      return this.tagName === 'H1' ? LAYOUT.title : 0;
    },
  });
  define(Range.prototype, 'getBoundingClientRect', {
    value() {
      return rect(LAYOUT.desc);
    },
  });
  return () => restore.reverse().forEach((undo) => undo());
}

function Page({ fold }: { fold: boolean }) {
  return (
    <PageHeader
      title="Accounts"
      subtitle="Every account the team works"
      actions={<span data-testid="own-actions" />}
      foldedActions={fold ? <span data-testid="folded-actions" /> : undefined}
    />
  );
}

const words = () => screen.queryByTestId('topbar-ai-assistant-text');
const folded = () => screen.queryByTestId('folded-actions') !== null;

describe('the header hides the words first (objectstack#37858)', () => {
  let uninstall: () => void = () => {};
  beforeEach(() => {
    Object.assign(LAYOUT, { row: 1000, title: 100, desc: 300 });
    uninstall = installLayout();
  });
  afterEach(() => uninstall());

  it('a page that folds: the words go before the actions fold, and come back after they open', () => {
    const view = render(inShell(<Page fold />));
    // Room for everything: the words, and the page's actions unfolded.
    expect(words()).toBeInTheDocument();
    expect(folded()).toBe(false);

    // The description no longer fits: the words yield, the actions stay.
    LAYOUT.row = 700;
    view.rerender(inShell(<Page fold />));
    expect(words()).toBeNull();
    expect(screen.getByTestId('topbar-ai-assistant')).toHaveAccessibleName('Ask AI');
    expect(screen.getByTestId('own-actions')).toBeInTheDocument();
    expect(folded()).toBe(false);

    // Narrower still: only now do the page's own actions fold.
    LAYOUT.row = 600;
    view.rerender(inShell(<Page fold />));
    expect(folded()).toBe(true);
    expect(words()).toBeNull();

    // Room again: the fold opens, then the words come back.
    LAYOUT.row = 1000;
    view.rerender(inShell(<Page fold />));
    expect(folded()).toBe(false);
    expect(words()).toBeInTheDocument();
  });

  it('the words never flip back while they would not fit (no flip-flop)', () => {
    const view = render(inShell(<Page fold />));
    LAYOUT.row = 700;
    view.rerender(inShell(<Page fold />));
    expect(words()).toBeNull();
    // Re-measured at the same width: still hidden, though the text now has room.
    view.rerender(inShell(<Page fold />));
    view.rerender(inShell(<Page fold />));
    expect(words()).toBeNull();
  });

  it('a page that offers no fold keeps the words while only its description is cut', () => {
    LAYOUT.desc = 2000;
    const view = render(inShell(<Page fold={false} />));
    expect(words()).toBeInTheDocument();

    // The title itself would be cut: now the words yield.
    LAYOUT.title = 800;
    view.rerender(inShell(<Page fold={false} />));
    expect(words()).toBeNull();
    expect(screen.getByTestId('own-actions')).toBeInTheDocument();
  });

  it('with no layout at all (every width 0) the words stay', () => {
    uninstall();
    uninstall = () => {};
    render(inShell(<Page fold />));
    expect(words()).toBeInTheDocument();
  });
});
