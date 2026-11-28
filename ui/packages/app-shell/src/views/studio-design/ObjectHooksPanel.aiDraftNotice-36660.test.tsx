// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#36660 — the object designer's Hooks tab buffers a hook's pending
 * draft and the top bar's Save publishes it at once. When the AI assistant
 * (copilot or MCP) wrote that draft, the open hook carries the designers' line
 * (`StudioAiDraftNotice`): Save makes the AI's change live too, and 「放弃 AI
 * 的改动」 drops that one hook's draft at its package, asking first only when
 * the hook holds unsaved edits. A person's own draft, or one whose read
 * recorded no provenance, gets no such line.
 */

import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { t } from '../metadata-admin/i18n';

const PKG = 'com.example.showcase';
const guard = { name: 'guard_hook', label: 'Guard', object: 'invoice', events: ['beforeInsert'], handler: 'guard_fn' };

interface DraftRow {
  body: Record<string, unknown>;
  version: string;
  draftChanges?: Array<{ path: string[]; by: string; actor?: string; at: string }>;
}

const door = {
  drafts: new Map<string, DraftRow>(),
  resets: [] as Array<{ type: string; name: string; options: unknown }>,
};

const mockClient = {
  list: vi.fn(async () => [guard]),
  listDrafts: vi.fn(async () => [...door.drafts.keys()].map((name) => ({ type: 'hook', name }))),
  getDraft: vi.fn(async (_type: string, name: string) => {
    const row = door.drafts.get(name);
    if (!row) return null;
    return {
      type: 'hook',
      name,
      item: JSON.parse(JSON.stringify(row.body)),
      version: row.version,
      ...(row.draftChanges ? { draftChanges: row.draftChanges } : {}),
    };
  }),
  get: vi.fn(async () => null),
  withPreviewDrafts() {
    return this;
  },
  save: vi.fn(async (_type: string, name: string, body: Record<string, unknown>) => {
    door.drafts.set(name, { body: JSON.parse(JSON.stringify(body)), version: 'hmac-sha256:receipt' });
    return { success: true, version: 'hmac-sha256:receipt', state: 'draft' };
  }),
  publish: vi.fn(async (_type: string, name: string) => {
    door.drafts.delete(name);
    return { success: true };
  }),
  reset: vi.fn(async (type: string, name: string, options?: unknown) => {
    door.resets.push({ type, name, options });
    door.drafts.delete(name);
    return { success: true };
  }),
};

vi.mock('../metadata-admin/useMetadata', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../metadata-admin/useMetadata')>();
  return { ...mod, useMetadataClient: () => mockClient };
});

import { HooksPanelHost } from './__tests__/hooksPanelHost';
import { pressStudioSave } from './__tests__/studioSaveHarness';
import { registerBuiltinInspectors } from '../metadata-admin/inspectors';
// The source reaches a dynamic `import('@objectstack/lint')`: its first load is paid at collection (`check:test-source-alias`).
import '@objectstack/lint';
import { __setCelFormulaLoader } from '../metadata-admin/celAuthoring';

registerBuiltinInspectors();

const AI_GUARD = { ...guard, label: 'Guard (AI)', condition: "record.status == 'held'" };
const aiDraft = (by: 'copilot' | 'mcp' = 'copilot'): DraftRow => ({
  body: AI_GUARD,
  version: 'hmac-sha256:ai',
  draftChanges: [{ path: ['condition'], by, actor: 'u1', at: '2026-11-27T10:00:00.000Z' }],
});

const confirmSpy = vi.fn((_message?: string) => true);

beforeEach(() => {
  door.drafts.clear();
  door.resets.length = 0;
  for (const fn of [mockClient.list, mockClient.listDrafts, mockClient.getDraft, mockClient.save, mockClient.publish, mockClient.reset]) {
    fn.mockClear();
  }
  confirmSpy.mockReset();
  confirmSpy.mockReturnValue(true);
  vi.stubGlobal('confirm', confirmSpy);
  __setCelFormulaLoader(() =>
    Promise.resolve({
      validateExpression: () => ({ ok: true, errors: [], warnings: [] }),
      introspectScope: () => ({ fields: ['status'], roots: ['record'], functions: ['has'] }),
      inferExpressionType: () => 'boolean' as const,
    }),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  __setCelFormulaLoader(undefined);
});

async function openHook(label: string) {
  render(<HooksPanelHost objectName="invoice" packageId={PKG} />);
  fireEvent.click(await screen.findByText(label, undefined, { timeout: 8000 }));
}

async function editCondition(value: string) {
  fireEvent.click(await screen.findByText('Expression'));
  const box = screen.getAllByRole('combobox').find((el) => el.tagName === 'TEXTAREA') as HTMLTextAreaElement;
  fireEvent.change(box, { target: { value } });
}

describe('ObjectHooksPanel — the AI assistant\'s pending draft of a hook (objectstack#36660)', () => {
  it('the open hook shows the AI version with the notice, and a person\'s Save makes it live', async () => {
    door.drafts.set('guard_hook', aiDraft());
    await openHook('Guard (AI)');
    expect(await screen.findByTestId('studio-ai-draft-notice')).toHaveTextContent(
      t('engine.studio.aiDraft.notice', 'en-US'),
    );
    await editCondition("record.status == 'closed'");
    await pressStudioSave();
    await waitFor(() => expect(mockClient.publish).toHaveBeenCalledTimes(1), { timeout: 8000 });
    await waitFor(() => expect(screen.queryByTestId('studio-ai-draft-notice')).toBeNull());
  });

  it('an MCP-written draft is the AI\'s too', async () => {
    door.drafts.set('guard_hook', aiDraft('mcp'));
    await openHook('Guard (AI)');
    expect(await screen.findByTestId('studio-ai-draft-notice')).toBeInTheDocument();
  });

  it('a person\'s own pending draft gets no AI line', async () => {
    door.drafts.set('guard_hook', {
      ...aiDraft(),
      draftChanges: [{ path: ['condition'], by: 'studio', actor: 'u1', at: '2026-11-20T10:00:00.000Z' }],
    });
    await openHook('Guard (AI)');
    await screen.findByText('Expression');
    expect(screen.queryByTestId('studio-ai-draft-notice')).toBeNull();
  });

  it('a draft whose read recorded no provenance is a person\'s too', async () => {
    const { draftChanges: _omitted, ...bare } = aiDraft();
    door.drafts.set('guard_hook', bare);
    await openHook('Guard (AI)');
    await screen.findByText('Expression');
    expect(screen.queryByTestId('studio-ai-draft-notice')).toBeNull();
  });

  it('discard with nothing unsaved asks nothing, drops that one hook\'s draft at its package, and the live hook is back', async () => {
    door.drafts.set('guard_hook', aiDraft());
    await openHook('Guard (AI)');
    fireEvent.click(await screen.findByTestId('studio-ai-draft-discard'));
    await waitFor(() => expect(door.resets).toHaveLength(1), { timeout: 8000 });
    expect(confirmSpy).not.toHaveBeenCalled();
    expect(door.resets[0]).toEqual({ type: 'hook', name: 'guard_hook', options: { state: 'draft', packageId: PKG } });
    expect(mockClient.publish).not.toHaveBeenCalled();
    // The published row is what the list and the open hook hold now.
    expect(await screen.findAllByText('Guard', undefined, { timeout: 8000 })).not.toHaveLength(0);
    await waitFor(() => expect(screen.queryByTestId('studio-ai-draft-notice')).toBeNull());
    expect(screen.queryByText('Guard (AI)')).toBeNull();
  });

  it('discard over an unsaved edit asks first; declined, the draft and the edit stay', async () => {
    door.drafts.set('guard_hook', aiDraft());
    confirmSpy.mockReturnValue(false);
    await openHook('Guard (AI)');
    await editCondition("record.status == 'unsaved'");
    fireEvent.click(screen.getByTestId('studio-ai-draft-discard'));
    expect(confirmSpy).toHaveBeenCalledWith(t('engine.studio.aiDraft.discardConfirmUnsaved', 'en-US'));
    expect(mockClient.reset).not.toHaveBeenCalled();
    expect(door.drafts.has('guard_hook')).toBe(true);
    expect(screen.getByTestId('studio-ai-draft-notice')).toBeInTheDocument();
  });

  it('discard over an unsaved edit, confirmed: the draft and the edit go', async () => {
    door.drafts.set('guard_hook', aiDraft());
    await openHook('Guard (AI)');
    await editCondition("record.status == 'unsaved'");
    fireEvent.click(screen.getByTestId('studio-ai-draft-discard'));
    expect(confirmSpy).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(door.drafts.has('guard_hook')).toBe(false), { timeout: 8000 });
    expect(door.resets[0]).toEqual({ type: 'hook', name: 'guard_hook', options: { state: 'draft', packageId: PKG } });
    // The list re-read installs the published hook.
    await waitFor(() => expect(screen.queryAllByText('Guard (AI)')).toHaveLength(0), { timeout: 8000 });
    expect(screen.queryByTestId('studio-ai-draft-notice')).toBeNull();
  });
});
