// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack-ai/objectstack#27176 — the pending-changes sheet names the AI
 * tools that drafted part of an item: the AI copilot, and an agent building
 * through the MCP build door by the OAuth client the person consented to.
 *
 * The drill-in already sends the strict draft read (`?state=draft`), which
 * serves the draft's per-key provenance (`draftChanges`) beside `item`; the
 * line reads it from there.
 *
 * Pinned:
 *  - an `mcp` entry with a named client reads "drafted by the MCP client
 *    “Claude”"; the copilot reads its own line; each source once;
 *  - an `mcp` client with no registered name is unnamed, never its id;
 *  - CONTROL: `studio` / `api` entries, and a read with no `draftChanges`,
 *    add no line.
 */

import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';

vi.mock('@object-ui/i18n', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useObjectTranslation: () => ({
    t: (_k: string, o?: Record<string, unknown> & { defaultValue?: string }) =>
      (o?.defaultValue ?? _k).replace(/\{\{(\w+)\}\}/g, (_m, name: string) => String(o?.[name] ?? '')),
    language: 'en',
  }),
}));

import { DraftChangesPanel, draftAgentSources } from '../DraftChangesPanel';

const PKG = 'com.x';
const AT = '2026-10-28T10:00:00.000Z';
const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body });

let draftChanges: unknown = undefined;

const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
  const url = String(input);
  if (url.includes('/_drafts')) return ok({ drafts: [{ type: 'object', name: 'st_ticket', packageId: PKG, label: 'Ticket' }] });
  if (/\/meta\/object(\?|$)/.test(url)) return ok([{ name: 'st_ticket' }]);
  if (url.includes('state=draft')) {
    return ok({
      type: 'object',
      name: 'st_ticket',
      item: { name: 'st_ticket', label: 'Ticket', fields: { a: { type: 'text' } } },
      ...(draftChanges !== undefined ? { draftChanges } : {}),
    });
  }
  return ok({ type: 'object', name: 'st_ticket', item: { name: 'st_ticket', label: 'Ticket', fields: {} } });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  fetchMock.mockClear();
  draftChanges = undefined;
});

async function renderConfirm() {
  vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);
  render(<DraftChangesPanel open onOpenChange={() => {}} packageId={PKG} onPublish={() => {}} posture="confirm" />);
  await waitFor(() => expect(screen.getByTestId('draft-entry-detail')).toBeInTheDocument());
}

const agentLines = () => screen.queryAllByTestId('draft-entry-agent').map((el) => el.textContent);

describe('objectstack#27176 — the drill-in names the AI tools that drafted the item', () => {
  it('an MCP client by its registered name, and the copilot, each once', async () => {
    draftChanges = [
      { path: ['fields', 'a'], by: 'mcp', actor: 'u_1', at: AT, client: { id: 'cli_1', name: 'Claude' } },
      { path: ['label'], by: 'copilot', actor: 'u_1', at: AT },
      { path: ['fields', 'b'], by: 'mcp', actor: 'u_1', at: AT, client: { id: 'cli_1', name: 'Claude' } },
    ];
    await renderConfirm();
    expect(agentLines()).toEqual([
      'Includes changes drafted by the MCP client “Claude”',
      'Includes changes drafted by the AI copilot',
    ]);
  });

  it('a client with no registered name is unnamed, never its id', async () => {
    draftChanges = [{ path: ['fields', 'a'], by: 'mcp', actor: 'u_1', at: AT, client: { id: 'cli_opaque' } }];
    await renderConfirm();
    expect(agentLines()).toEqual(['Includes changes drafted by an MCP client']);
    expect(screen.queryByText(/cli_opaque/)).toBeNull();
  });

  it('CONTROL: studio and api writes, or no recorded provenance, add no line', async () => {
    draftChanges = [{ path: ['fields', 'a'], by: 'studio', actor: 'u_1', at: AT }];
    await renderConfirm();
    expect(agentLines()).toEqual([]);
    cleanup();
    draftChanges = undefined;
    await renderConfirm();
    expect(agentLines()).toEqual([]);
  });
});

describe('draftAgentSources', () => {
  it('folds an unnamed client and an mcp write with none into one unnamed source; two named clients stay two', () => {
    expect(
      draftAgentSources([
        { path: ['a'], by: 'mcp', actor: null, at: AT, client: { id: 'cli_1' } },
        { path: ['b'], by: 'mcp', actor: null, at: AT },
        { path: ['c'], by: 'mcp', actor: null, at: AT, client: { id: 'cli_2', name: 'Cursor' } },
        { path: ['d'], by: 'mcp', actor: null, at: AT, client: { id: 'cli_3', name: 'Claude' } },
        { path: ['e'], by: 'api', actor: null, at: AT },
      ]),
    ).toEqual([{ by: 'mcp' }, { by: 'mcp', client: 'Cursor' }, { by: 'mcp', client: 'Claude' }]);
    expect(draftAgentSources(null)).toEqual([]);
  });
});
