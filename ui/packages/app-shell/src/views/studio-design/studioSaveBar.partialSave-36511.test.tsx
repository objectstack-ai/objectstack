// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#36511 — the top bar's one Save over every buffer on the page.
 *
 * - The pair is drawn only while a registered buffer is dirty.
 * - Save sends the dirty buffers in `order`, every one of them: a refused one
 *   does not stop the rest, and the toast names each refused item with its
 *   reason and lists the items that were saved.
 * - A held buffer refuses the whole Save before anything is sent.
 * - Cancel drops every dirty buffer, and only those.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn(), message: vi.fn(), dismiss: vi.fn() },
  Toaster: () => null,
}));

import { toast } from 'sonner';
import { useStudioSaveEntry, type StudioSaveEntry } from './studioSaveBar';
import { StudioSaveHarness, pressStudioCancel, pressStudioSave } from './__tests__/studioSaveHarness';
import { tFormat } from '../metadata-admin/i18n';

afterEach(() => {
  cleanup();
  vi.mocked(toast.success).mockClear();
  vi.mocked(toast.error).mockClear();
});

function Buffer(props: Partial<StudioSaveEntry> & { label: string }) {
  useStudioSaveEntry({
    order: 0,
    dirty: true,
    held: null,
    save: async () => ({ kind: 'saved' }),
    cancel: () => {},
    ...props,
  });
  return null;
}

describe('the top bar Save over every buffer of the page (objectstack#36511)', () => {
  it('is drawn only while a buffer is dirty', async () => {
    const { rerender } = render(
      <StudioSaveHarness>
        <Buffer label="Task" dirty={false} />
      </StudioSaveHarness>,
    );
    expect(screen.queryByTestId('studio-save')).toBeNull();
    expect(screen.queryByTestId('studio-cancel')).toBeNull();
    rerender(
      <StudioSaveHarness>
        <Buffer label="Task" dirty />
      </StudioSaveHarness>,
    );
    expect(await screen.findByTestId('studio-save')).toBeInTheDocument();
    expect(screen.getByTestId('studio-cancel')).toBeInTheDocument();
  });

  it('sends every dirty buffer in order; a refusal names its item and reason and lists what was saved', async () => {
    const sent: string[] = [];
    const clean = vi.fn(async () => ({ kind: 'saved' as const }));
    render(
      <StudioSaveHarness>
        <Buffer
          label="Customer fields"
          order={1}
          save={async () => {
            sent.push('fields');
            return { kind: 'refused', reason: 'Field “Due” is not valid.' };
          }}
        />
        <Buffer
          label="Customer"
          order={0}
          save={async () => {
            sent.push('object');
            return { kind: 'saved' };
          }}
        />
        <Buffer label="Hooks" order={2} save={async () => (sent.push('hooks'), { kind: 'saved' })} />
        <Buffer label="Untouched" order={3} dirty={false} save={clean} />
      </StudioSaveHarness>,
    );
    await pressStudioSave();
    await waitFor(() => expect(toast.error).toHaveBeenCalledTimes(1));
    expect(sent).toEqual(['object', 'fields', 'hooks']);
    expect(clean).not.toHaveBeenCalled();
    const [title, opts] = vi.mocked(toast.error).mock.calls[0];
    expect(title).toBe(tFormat('engine.studio.save.refused', 'en', { items: 'Customer fields' }));
    expect((opts as { description: string }).description.split('\n')).toEqual([
      tFormat('engine.studio.save.refusedLine', 'en', { item: 'Customer fields', reason: 'Field “Due” is not valid.' }),
      tFormat('engine.studio.save.savedLine', 'en', { items: 'Customer, Hooks' }),
    ]);
    expect(toast.success).not.toHaveBeenCalled();
  });

  it('a held buffer refuses the whole Save before anything is sent', async () => {
    const save = vi.fn(async () => ({ kind: 'saved' as const }));
    render(
      <StudioSaveHarness>
        <Buffer label="Customer" save={save} />
        <Buffer label="Stage" order={1} held="the field “Stage” needs at least one option" save={save} />
      </StudioSaveHarness>,
    );
    await pressStudioSave();
    expect(save).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith(
      tFormat('engine.studio.save.held', 'en', { clause: 'the field “Stage” needs at least one option' }),
    );
  });

  it('Cancel drops every dirty buffer, and only those', async () => {
    const dropped: string[] = [];
    render(
      <StudioSaveHarness>
        <Buffer label="Customer" cancel={() => dropped.push('object')} />
        <Buffer label="Extension" order={1} cancel={() => dropped.push('extension')} />
        <Buffer label="Clean" order={2} dirty={false} cancel={() => dropped.push('clean')} />
      </StudioSaveHarness>,
    );
    await pressStudioCancel();
    expect(dropped).toEqual(['object', 'extension']);
  });
});
