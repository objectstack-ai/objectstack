// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#34608 (ui ADR-0057 as amended) — an old full-page chat address
 * (a bookmark, a share link, Studio's maximize) opens the chat drawer on the
 * conversation it named instead of a page (acceptance 4 of the card).
 *
 * The real `AiAddressRedirect` under a real router; the landing it replaces the
 * visit with reports its address, its navigation state and the per-tab keys
 * the drawer host reads when it mounts. Only the app list is a stand-in.
 */
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';

const meta = vi.hoisted(() => ({ apps: [] as Array<Record<string, unknown>> }));
vi.mock('../../../providers/MetadataProvider', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useMetadata: () => ({ apps: meta.apps }),
}));

import { AiAddressRedirect } from '../AiAddressRedirect';
import { DOCK_EXPANDED_STORAGE_KEY } from '../../../layout/chatDockState';
import { readStoredDockFullWindow, readStoredDockTarget, DOCK_HANDOFF_STATE_KEY } from '../../../layout/chatDockTarget';

function Landing() {
  const location = useLocation();
  return (
    <output data-testid="landing" data-state={JSON.stringify(location.state ?? null)}>
      {`${location.pathname}${location.search}`}
    </output>
  );
}

function visit(entry: string | { pathname: string; search?: string; state?: unknown }) {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <Routes>
        <Route path="/ai" element={<AiAddressRedirect />} />
        <Route path="/ai/:agent" element={<AiAddressRedirect />} />
        <Route path="/ai/:agent/:conversationId" element={<AiAddressRedirect />} />
        <Route path="*" element={<Landing />} />
      </Routes>
    </MemoryRouter>,
  );
}

afterEach(() => {
  cleanup();
  meta.apps = [];
  window.sessionStorage.clear();
});

describe('an old /ai address opens the drawer on what it named (objectstack#34608)', () => {
  it('/ai/build/ID lands home with the drawer armed open, filling the window, on that conversation', async () => {
    visit('/ai/build/c-42');
    expect(await screen.findByTestId('landing')).toHaveTextContent(/^\/home$/);
    expect(readStoredDockTarget()).toEqual({ agent: 'build', conversationId: 'c-42' });
    expect(window.sessionStorage.getItem(DOCK_EXPANDED_STORAGE_KEY)).toBe('1');
    expect(readStoredDockFullWindow()).toBe(true);
    expect(screen.getByTestId('landing')).toHaveAttribute('data-state', 'null');
  });

  it('the "Edit with AI" address keeps its package and fresh start', async () => {
    visit('/ai/build?package=app.crm&new=1');
    await screen.findByTestId('landing');
    expect(readStoredDockTarget()).toEqual({ agent: 'build', packageId: 'app.crm', fresh: true });
  });

  it('bare /ai opens the ambient thread, replacing a target left from before', async () => {
    window.sessionStorage.setItem('ai-chat-dock-target', JSON.stringify({ agent: 'ask', conversationId: 'old' }));
    visit('/ai');
    await screen.findByTestId('landing');
    expect(readStoredDockTarget()).toBeUndefined();
  });

  it('lands on the declared home when the deployment declares one', async () => {
    meta.apps = [{ name: 'crm', isDefault: true, active: true }];
    visit('/ai/ask');
    const landing = await screen.findByTestId('landing');
    expect(landing).toHaveTextContent(/^\/apps\/crm$/);
  });

  it('a Builder handoff rides navigation state to the landing, never storage (objectui#12493)', async () => {
    visit({ pathname: '/ai/build', state: { handoffPrompt: 'Build a CRM', parentConversationId: 'ask-1' } });
    const landing = await screen.findByTestId('landing');
    expect(JSON.parse(landing.getAttribute('data-state') ?? 'null')).toEqual({
      [DOCK_HANDOFF_STATE_KEY]: { handoffPrompt: 'Build a CRM', parentConversationId: 'ask-1' },
    });
    for (let i = 0; i < window.sessionStorage.length; i += 1) {
      const key = window.sessionStorage.key(i)!;
      expect(window.sessionStorage.getItem(key)).not.toContain('Build a CRM');
    }
  });
});
