// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * AgentPreview must not render retired `AgentSchema` keys (objectui#3275).
 *
 * `agent.tools` (objectstack#3894) and `agent.knowledge` (objectstack#3896)
 * are `retiredKey()` tombstones in `@objectstack/spec` 17 — `AgentSchema`
 * rejects each BY NAME, so no draft carrying them can be saved. The preview
 * nevertheless read both off the raw draft and painted a TOOLS chip strip and
 * a `KNOWLEDGE (RAG)` block.
 *
 * That inverted the preview's whole purpose. The two shapes an author can
 * write are (a) spec-valid, which rendered NOTHING in those blocks, and
 * (b) retired, which rendered a full, healthy-looking summary right up until
 * publish refused it. The designer was rewarding the unsaveable draft — the
 * tolerant-consumer failure AGENTS.md #0.1 names, and the reason objectui#3266
 * saw the gallery render LESS after its samples were corrected.
 *
 * These tests pin both directions: a VALID draft renders its capabilities, and
 * a STALE draft renders nothing from the retired keys. The second half matters
 * because the names survive in the spec's tombstone guidance, so a future
 * reader has a plausible-looking reason to "restore" them.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { agentRouteName } from '@object-ui/plugin-chatbot/core';
import { AgentPreview } from './AgentPreview';

afterEach(cleanup);

/** Parses clean against `ObjectStackSchema` — mirrors the gallery's sample. */
const VALID_DRAFT = {
  name: 'sales_copilot',
  label: 'Sales Copilot',
  role: 'Assistant for sales reps',
  active: true,
  model: { provider: 'openai', model: 'gpt-4o', temperature: 0.4, maxTokens: 2048 },
  instructions: 'You are a helpful sales assistant.',
  skills: ['summarize_account', 'draft_email'],
} satisfies Record<string, unknown>;

/** A draft as an author wrote it *before* the removals — both retired keys present. */
const STALE_DRAFT = {
  ...VALID_DRAFT,
  tools: [
    { type: 'objectql', name: 'query_orders' },
    { type: 'http', name: 'lookup_company' },
  ],
  knowledge: { sources: [{ id: 'sales_playbook', type: 'vector' }] },
} satisfies Record<string, unknown>;

function renderPreview(draft: Record<string, unknown>) {
  return render(
    <AgentPreview type="agent" name="sales_copilot" draft={draft} />,
  );
}

describe('AgentPreview renders what a spec-valid agent declares', () => {
  it('renders the skills chips — the whole of an agent capability surface', () => {
    renderPreview(VALID_DRAFT);
    expect(screen.getByText('Capabilities')).toBeTruthy();
    expect(screen.getByText('Skills')).toBeTruthy();
    expect(screen.getByText('summarize_account')).toBeTruthy();
    expect(screen.getByText('draft_email')).toBeTruthy();
  });

  it('keeps persona, model pills and instructions', () => {
    renderPreview(VALID_DRAFT);
    expect(screen.getByText('Sales Copilot')).toBeTruthy();
    expect(screen.getByText('sales_copilot')).toBeTruthy();
    expect(screen.getByText('Assistant for sales reps')).toBeTruthy();
    expect(screen.getByText('openai · gpt-4o')).toBeTruthy();
    expect(screen.getByText('You are a helpful sales assistant.')).toBeTruthy();
  });

  it('says where tools come from, so the missing TOOLS block is not read as a gap', () => {
    renderPreview(VALID_DRAFT);
    expect(screen.getByText(/tools come from the attached skills/i)).toBeTruthy();
  });

  it('an agent with no skills gets an explicit empty state, not a blank', () => {
    renderPreview({ ...VALID_DRAFT, skills: [] });
    expect(screen.getByText(/no skills attached/i)).toBeTruthy();
  });
});

describe('AgentPreview renders nothing from retired AgentSchema keys', () => {
  it('paints no TOOLS block for a stale draft carrying `tools`', () => {
    renderPreview(STALE_DRAFT);
    // The chip-list heading is gone with the read...
    expect(screen.queryByText('Tools')).toBeNull();
    // ...and so is every tool name it used to advertise.
    expect(screen.queryByText('query_orders')).toBeNull();
    expect(screen.queryByText('lookup_company')).toBeNull();
  });

  it('paints no KNOWLEDGE (RAG) block for a stale draft carrying `knowledge`', () => {
    renderPreview(STALE_DRAFT);
    expect(screen.queryByText(/knowledge/i)).toBeNull();
    expect(screen.queryByText('sales_playbook')).toBeNull();
  });

  it('renders the stale draft exactly as if the retired keys were absent', () => {
    const { container: stale } = renderPreview(STALE_DRAFT);
    const staleHtml = stale.innerHTML;
    cleanup();
    const { container: valid } = renderPreview(VALID_DRAFT);
    // The strongest form of "the key is not read": the two drafts differ only
    // by `tools`/`knowledge`, so identical output proves neither reaches the DOM.
    expect(staleHtml).toBe(valid.innerHTML);
  });
});

/**
 * "Try in chat" (objectui#10640).
 *
 * The link was the plain anchor `/console/ai/agents/NAME/chat`. The console
 * declares no path beginning with `/console`, so its root catch-all sent the
 * author home. It now points at the chat route the console declares,
 * `/ai/:agent`, asking for a new chat. That the URL reaches the chat page
 * through the console's REAL root route table is pinned in `apps/console`
 * (`App.agentChatLink-10640.test.tsx`); these pins hold the link.
 *
 * The preview runs inside a real `MemoryRouter`, under the same
 * `/apps/:appName/*` shape the console mounts `ResourceEditPage` at.
 */
describe('AgentPreview "Try in chat" link (objectui#10640)', () => {
  function renderAt(
    url: string,
    { basename, name = 'sales_copilot' }: { basename?: string; name?: string } = {},
  ) {
    const preview = <AgentPreview type="agent" name={name} draft={{ ...VALID_DRAFT, name }} />;
    return render(
      <MemoryRouter basename={basename} initialEntries={[url]}>
        <Routes>
          <Route path="/apps/:appName/*" element={preview} />
          <Route path="*" element={preview} />
        </Routes>
      </MemoryRouter>,
    );
  }

  const link = () => screen.getByRole('link', { name: /try in chat/i });
  const target = () => new URL(link().getAttribute('href') ?? '', 'http://console.test');

  it("points at the agent's chat route, /ai/:agent", () => {
    renderAt('/apps/studio/metadata/agent/sales_copilot');
    expect(target().pathname).toBe('/ai/sales_copilot');
  });

  it('asks the chat page for a new conversation, as its title promises', () => {
    renderAt('/apps/studio/metadata/agent/sales_copilot');
    expect(target().searchParams.get('new')).toBe('1');
    expect(link().getAttribute('title')).toMatch(/in a new chat/i);
  });

  it('routes a built-in agent by the friendly segment `agentRouteName` builds', () => {
    renderAt('/apps/studio/metadata/agent/metadata_assistant', { name: 'metadata_assistant' });
    expect(target().pathname).toBe(`/ai/${agentRouteName('metadata_assistant')}`);
    expect(target().pathname).toBe('/ai/build');
  });

  it('carries no app segment: the chat route is app-less, whichever app the author is in', () => {
    renderAt('/apps/com.acme.crm/metadata/agent/sales_copilot');
    expect(target().pathname).toBe('/ai/sales_copilot');
  });

  it('is still drawn on a route that names no app (Studio design surface)', () => {
    renderAt('/studio/com.acme.crm/automations');
    expect(target().pathname).toBe('/ai/sales_copilot');
  });

  it('escapes an agent name that needs it, so it stays one path segment', () => {
    renderAt('/apps/studio/metadata/agent/x', { name: 'odd name/x?y#z' });
    expect(target().pathname).toBe(`/ai/${encodeURIComponent('odd name/x?y#z')}`);
    expect(target().searchParams.get('new')).toBe('1');
    expect(target().hash).toBe('');
  });

  it("applies the router's basename, so a console mounted under /_console stays inside it", () => {
    renderAt('/_console/apps/studio/metadata/agent/sales_copilot', { basename: '/_console' });
    expect(target().pathname).toBe('/_console/ai/sales_copilot');
  });

  it('still opens in a new tab', () => {
    renderAt('/apps/studio/metadata/agent/sales_copilot');
    expect(link().getAttribute('target')).toBe('_blank');
    expect(link().getAttribute('rel')).toBe('noreferrer');
  });

  it('draws no link, and does not throw, with no router above it (the designer gallery)', () => {
    renderPreview(VALID_DRAFT);
    expect(screen.getByText('Sales Copilot')).toBeTruthy();
    expect(screen.queryByRole('link', { name: /try in chat/i })).toBeNull();
  });
});
