// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The keyboard-shortcuts dialog lists only shortcuts whose handler is mounted,
 * and every row it lists fires (objectui#11674).
 *
 * Measured on the 2026-10-06 console dogfood (showcase): the dialog was a
 * static list, and `N`, `⌘/Ctrl+E`, `⌘/Ctrl+/`, `⌘/Ctrl+D` and a bare `B`
 * did nothing. No handler for the first four existed anywhere, and the sidebar
 * toggles on `⌘B` / `Ctrl+B` (the Shadcn `SidebarProvider` listener), not `B`.
 * Its AI-assistant rows (`⌘⇧O`, `⌘⇧S`) were listed inside apps too, where the
 * only listener for them, `AiChatPage`'s, is never mounted.
 *
 * The dialog now lists what mounted handlers advertise beside themselves
 * (`advertisedShortcuts.ts`). This file pins it three ways:
 *
 *  1. THE PIN — the dialog is mounted where `AppContent` mounts it, inside the
 *     real `ConsoleLayout` (real `AppShell` → real `SidebarProvider`, real
 *     `CommandPaletteProvider`), opened by its `?shortcuts=1` deep link. Each
 *     row it lists is fired with the chord the row's own advertisement
 *     declares, with ⌘ and again with Ctrl, against a fresh mount, and the
 *     real handler's effect is asserted. A listed row with no probe below
 *     fails, and so does a probe for a row that is no longer listed: the two
 *     sets are equal, so the loop can never pass by running nothing.
 *  2. The list is derived, not kept: a row appears while its advertiser is
 *     mounted and leaves when it unmounts.
 *  3. The AI chat page's two advertisements carry chords its real matcher,
 *     `matchAiChatShortcut`, answers.
 *
 * Chrome this card does not touch (header, nav sidebar body, banners, preview
 * bars, the chat dock) is stubbed, as in `ConsoleLayout.fabYieldsToOpenDock-10899`.
 */

import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, afterEach } from 'vitest';
import React, { useState } from 'react';
import { render, screen, fireEvent, cleanup, waitFor, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { useSidebar } from '@object-ui/components';

vi.mock('@object-ui/i18n', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useObjectTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => String(options?.defaultValue ?? key),
    language: 'en',
  }),
}));

vi.mock('../layout/ChatDock', () => ({
  useChatDockState: () => ({
    expanded: false,
    width: 420,
    dragging: false,
    maximized: false,
    toggle: () => {},
    expand: () => {},
    collapse: () => {},
    maximize: () => {},
    restore: () => {},
    onResizePointerDown: () => {},
  }),
  ChatDockPanel: () => null,
  ChatDockMobileSheet: () => null,
}));
vi.mock('../hooks/useAiSurface', () => ({
  useAiSurfaceEnabled: () => ({ enabled: false, isLoading: false }),
}));
vi.mock('../layout/UnifiedSidebar', () => ({ UnifiedSidebar: () => null }));
vi.mock('../layout/AppHeader', () => ({ AppHeader: () => null }));
vi.mock('../layout/ConsoleNotificationBanners', () => ({ ConsoleNotificationBanners: () => null }));
vi.mock('../preview/DraftPreviewBar', () => ({ DraftPreviewBar: () => null }));
vi.mock('../preview/UnpublishedAppBar', () => ({ UnpublishedAppBar: () => null }));

import { KeyboardShortcutsDialog } from './KeyboardShortcutsDialog';
import {
  shortcutKeycaps,
  useAdvertiseShortcut,
  useAdvertisedShortcuts,
  type AdvertisedShortcut,
  type ShortcutChord,
  type ShortcutLabelTranslate,
} from './advertisedShortcuts';
import { ConsoleLayout } from '../layout/ConsoleLayout';
import { NavigationProvider } from '../context/NavigationContext';
import { useCommandPalette } from '../context/CommandPaletteProvider';
import {
  matchAiChatShortcut,
  NEW_CHAT_SHORTCUT,
  TOGGLE_CHATS_LIST_SHORTCUT,
} from '../console/ai/AiChatPage';

const APP = { name: 'crm', label: 'CRM', active: true, navigation: [] };

/** What the real handlers change, read from their own state. */
function Probe() {
  const sidebar = useSidebar();
  const palette = useCommandPalette();
  const sidebarOpen = sidebar.isMobile ? sidebar.openMobile : sidebar.open;
  return (
    <output
      data-testid="probe"
      data-sidebar-open={String(sidebarOpen)}
      data-palette-open={String(palette.open)}
    />
  );
}

/** The registry's own reading, beside the rows the dialog drew from it. */
function AdvertisedReading() {
  const advertised = useAdvertisedShortcuts();
  const reading = advertised.map(({ id, chord }) => ({ id, chord }));
  return <output data-testid="advertised" data-reading={JSON.stringify(reading)} />;
}

function readAdvertised(): Array<{ id: string; chord: ShortcutChord }> {
  return JSON.parse(screen.getByTestId('advertised').dataset.reading ?? '[]');
}

/** The console chrome as `AppContent` composes it, with the dialog inside. */
function mountConsole(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <NavigationProvider>
        <ConsoleLayout activeAppName="crm" activeApp={APP} onAppChange={vi.fn()} objects={[]}>
          <KeyboardShortcutsDialog />
          <Probe />
          <AdvertisedReading />
        </ConsoleLayout>
      </NavigationProvider>
    </MemoryRouter>,
  );
}

/** The keydowns a chord stands for: ⌘ and Ctrl both, when it has a modifier. */
function chordEvents(chord: ShortcutChord): KeyboardEventInit[] {
  const base = { key: chord.key, shiftKey: Boolean(chord.shift) };
  return chord.mod ? [{ ...base, metaKey: true }, { ...base, ctrlKey: true }] : [base];
}

const probe = () => screen.getByTestId('probe');
// `SidebarProvider` persists its state in this cookie and reads it on mount,
// so one toggle would decide the next mount's starting state.
const clearSidebarCookie = () => {
  document.cookie = 'sidebar_state=; path=/; max-age=0';
};
const dialogShown = () => screen.queryByTestId('overlay:keyboard-shortcuts') !== null;

/**
 * One probe per row the console dialog lists: mount, check the state the
 * handler starts from, fire `event`, check the handler changed it.
 */
const FIRES: Record<string, (event: KeyboardEventInit) => Promise<void>> = {
  'command-palette': async (event) => {
    mountConsole('/apps/crm');
    expect(probe()).toHaveAttribute('data-palette-open', 'false');
    fireEvent.keyDown(document.body, event);
    await waitFor(() => expect(probe()).toHaveAttribute('data-palette-open', 'true'));
  },
  'shortcuts-help': async (event) => {
    mountConsole('/apps/crm');
    expect(dialogShown()).toBe(false);
    fireEvent.keyDown(document.body, event);
    await waitFor(() => expect(dialogShown()).toBe(true));
  },
  'close-overlay': async (event) => {
    mountConsole('/apps/crm?shortcuts=1');
    expect(dialogShown()).toBe(true);
    fireEvent.keyDown(document.activeElement ?? document.body, event);
    await waitFor(() => expect(dialogShown()).toBe(false));
  },
  'toggle-sidebar': async (event) => {
    clearSidebarCookie();
    mountConsole('/apps/crm');
    expect(probe()).toHaveAttribute('data-sidebar-open', 'true');
    fireEvent.keyDown(document.body, event);
    await waitFor(() => expect(probe()).toHaveAttribute('data-sidebar-open', 'false'));
  },
};

afterEach(() => {
  cleanup();
  clearSidebarCookie();
});

describe('the keyboard-shortcuts dialog lists only wired shortcuts (objectui#11674)', () => {
  it('every row the console dialog lists fires its real handler, with ⌘ and with Ctrl', async () => {
    mountConsole('/apps/crm?shortcuts=1');
    const advertised = readAdvertised();
    const rows = Array.from(document.querySelectorAll<HTMLElement>('[data-shortcut-id]'));
    const listed = rows.map((row) => row.dataset.shortcutId as string);

    // Rows are the advertisements, keycaps included — nothing else.
    expect([...listed].sort()).toEqual(advertised.map((s) => s.id).sort());
    for (const row of rows) {
      const shortcut = advertised.find((s) => s.id === row.dataset.shortcutId)!;
      const caps = Array.from(row.querySelectorAll('kbd'), (kbd) => kbd.textContent);
      expect(caps, row.dataset.shortcutId).toEqual(shortcutKeycaps(shortcut.chord));
    }
    // Every listed row has a probe, and every probe still has a row.
    expect([...listed].sort()).toEqual(Object.keys(FIRES).sort());
    const chords = new Map(advertised.map((s) => [s.id, s.chord]));
    cleanup();

    for (const id of listed) {
      for (const event of chordEvents(chords.get(id)!)) {
        await FIRES[id](event);
        cleanup();
      }
    }
  });

  it('a listed row whose chord does nothing is caught: a bare B leaves the sidebar alone', async () => {
    // The defect's own shape, against the same probe: the old row said `B`.
    await expect(FIRES['toggle-sidebar']({ key: 'b' })).rejects.toThrow();
  });
});

const DEMO_SHORTCUT: AdvertisedShortcut = {
  id: 'demo-advertiser',
  group: 'navigation',
  chord: { key: 'g', mod: true, shift: true },
  label: (t: ShortcutLabelTranslate) => t('console.shortcuts.toggleSidebar'),
};

function DemoAdvertiser() {
  useAdvertiseShortcut(DEMO_SHORTCUT);
  return null;
}

function DialogWithOptionalAdvertiser() {
  const [mounted, setMounted] = useState(true);
  return (
    <>
      <button type="button" onClick={() => setMounted(false)}>unmount</button>
      {mounted ? <DemoAdvertiser /> : null}
      <KeyboardShortcutsDialog />
    </>
  );
}

describe('the list is derived from mounted advertisers (objectui#11674)', () => {
  it('a row is listed while its advertiser is mounted and leaves when it unmounts', async () => {
    render(
      <MemoryRouter initialEntries={['/apps/crm?shortcuts=1']}>
        <DialogWithOptionalAdvertiser />
      </MemoryRouter>,
    );
    const row = document.querySelector('[data-shortcut-id="demo-advertiser"]');
    expect(row).not.toBeNull();
    expect(Array.from(row!.querySelectorAll('kbd'), (kbd) => kbd.textContent)).toEqual(['⌘', '⇧', 'G']);

    act(() => {
      fireEvent.click(screen.getByText('unmount'));
    });
    await waitFor(() =>
      expect(document.querySelector('[data-shortcut-id="demo-advertiser"]')).toBeNull(),
    );
    // The dialog's own advertisements stay.
    expect(document.querySelector('[data-shortcut-id="shortcuts-help"]')).not.toBeNull();
  });
});

describe("the AI chat page's advertisements carry chords its matcher answers (objectui#11674)", () => {
  it.each([
    [NEW_CHAT_SHORTCUT.id, NEW_CHAT_SHORTCUT, 'new-chat'],
    [TOGGLE_CHATS_LIST_SHORTCUT.id, TOGGLE_CHATS_LIST_SHORTCUT, 'toggle-list'],
  ] as const)('%s', (_id, shortcut, action) => {
    for (const event of chordEvents(shortcut.chord)) {
      expect(
        matchAiChatShortcut({
          key: event.key!,
          metaKey: Boolean(event.metaKey),
          ctrlKey: Boolean(event.ctrlKey),
          shiftKey: Boolean(event.shiftKey),
          altKey: false,
        }),
      ).toBe(action);
    }
  });
});
