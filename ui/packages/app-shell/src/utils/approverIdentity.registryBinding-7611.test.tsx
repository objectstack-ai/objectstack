/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#7611 Q3b (ruled objectstack#22865 Q3b → B) — the record page's
 * approval panel and the override dialog NAME a position approver when the
 * bundled spec binds `position` to the registry, `{ source: 'registry', type }`
 * (objectstack#22710).
 *
 * The console objectstack ships is bundled with objectstack's own spec
 * injected, so its `APPROVER_VALUE_SOURCES.position` is that registry member.
 * `approverIdentity` derived its bindings from the `data` member only, so
 * `position` dropped out of every arm: `formatIdentity('position:manager')`
 * fell through to the 14-character truncation and read `positi…ager`, and
 * `useApproverDirectory` asked nothing about it. This file mocks the spec into
 * the injected shape — the projection is the bundled spec's own object, so this
 * is what the shipped bundle evaluates.
 *
 * Pinned, per arm:
 *   - registry: the machine name is prettified, never truncated; the ref is
 *     handed to the directory; its label comes from the registry item read
 *     through the console's metadata store (`ensureType('position')`), with no
 *     read of the `sys_position` mirror; staffing still comes from the junction;
 *   - record: a `team:` ref still resolves against `sys_team` through the
 *     adapter, and an opaque id still truncates.
 */

import * as React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor, cleanup } from '@testing-library/react';

vi.mock('@objectstack/spec/automation', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  const sources = actual.APPROVER_VALUE_SOURCES as Record<string, unknown>;
  return {
    ...actual,
    // objectstack#22710's projection of `position` — the injected spec's shape.
    APPROVER_VALUE_SOURCES: { ...sources, position: { source: 'registry', type: 'position' } },
  };
});

import { AdapterCtx, MetadataCtx } from '@object-ui/react';
import {
  APPROVER_DIRECTORY_BINDINGS,
  APPROVER_REGISTRY_TYPES,
  DEFAULT_APPROVER_COPY,
  approverDisplay,
  formatIdentity,
  unresolvedApproverRefs,
} from './approverIdentity';
import { useApproverDirectory, resetApproverDirectoryCache } from '../hooks/useApproverDirectory';

/** 32 hex characters — an opaque row id, as a `team:` approver carries. */
const TEAM_ID = '0123456789abcdef0123456789abcdef';

beforeEach(() => {
  resetApproverDirectoryCache();
});

afterEach(() => {
  cleanup();
});

describe('approverIdentity under a registry-binding spec (objectui#7611 Q3b)', () => {
  it('reads position as registry-bound and keeps it off the record arm', () => {
    expect(APPROVER_REGISTRY_TYPES).toEqual({ position: 'position' });
    expect(APPROVER_DIRECTORY_BINDINGS.position).toBeUndefined();
    expect(APPROVER_DIRECTORY_BINDINGS.team).toMatchObject({ object: 'sys_team', valueField: 'id' });
  });

  it('prettifies a position approver instead of truncating it', () => {
    expect(formatIdentity('position:manager')).toBe('Manager');
    expect(formatIdentity('position:sales_manager')).toBe('Sales Manager');
  });

  it('still truncates an opaque id on the record arm', () => {
    expect(formatIdentity(`team:${TEAM_ID}`)).toBe('team:0…cdef');
  });

  it('hands a server-unresolved position approver to the directory', () => {
    const record = {
      pending_approvers: ['position:manager', `team:${TEAM_ID}`, 'u_1'],
      pending_approver_names: { u_1: 'Ada' },
    };
    expect(unresolvedApproverRefs(record)).toEqual(['position:manager', `team:${TEAM_ID}`]);
  });

  it('composes the registry label first, the prettified name second', () => {
    expect(
      approverDisplay('position:manager', { resolved: { label: 'Line Manager' }, copy: DEFAULT_APPROVER_COPY }).label,
    ).toBe('Line Manager');
    expect(approverDisplay('position:manager', { copy: DEFAULT_APPROVER_COPY }).label).toBe('Manager');
  });
});

describe('useApproverDirectory under a registry-binding spec (objectui#7611 Q3b)', () => {
  function harness() {
    const adapter = {
      find: vi.fn(async (object: string) => {
        if (object === 'sys_user_position') return { data: [{ position: 'manager', user_id: 'u_1' }] };
        if (object === 'sys_user') return { data: [{ id: 'u_1', full_name: 'Ada Holder' }] };
        if (object === 'sys_team') return { data: [{ id: TEAM_ID, label: 'Platform Team' }] };
        return { data: [] };
      }),
    };
    const ensureType = vi.fn(async (type: string) =>
      type === 'position'
        ? [
            { name: 'manager', label: 'Line Manager' },
            { name: 'exec', label: 'Executive' },
          ]
        : [],
    );
    const store = { ensureType } as unknown as React.ContextType<typeof MetadataCtx>;
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <MetadataCtx.Provider value={store}>
        <AdapterCtx.Provider value={adapter as never}>{children}</AdapterCtx.Provider>
      </MetadataCtx.Provider>
    );
    return { adapter, ensureType, wrapper };
  }

  it('labels a position from the registry item, never from the sys_position mirror', async () => {
    const { adapter, ensureType, wrapper } = harness();
    const { result } = renderHook(() => useApproverDirectory(['position:manager']), { wrapper });
    await waitFor(() => expect(result.current['position:manager']).toBeDefined());

    expect(result.current['position:manager']).toEqual({ label: 'Line Manager', holders: ['Ada Holder'] });
    expect(ensureType).toHaveBeenCalledWith('position');
    const objects = adapter.find.mock.calls.map(([object]) => object);
    expect(objects).not.toContain('sys_position');
    // Staffing still reads the junction, which stores the position's name.
    expect(objects).toContain('sys_user_position');
  });

  it('keeps the record arm on the adapter', async () => {
    const { adapter, ensureType, wrapper } = harness();
    const ref = `team:${TEAM_ID}`;
    const { result } = renderHook(() => useApproverDirectory([ref]), { wrapper });
    await waitFor(() => expect(result.current[ref]).toBeDefined());

    expect(result.current[ref]).toEqual({ label: 'Platform Team' });
    expect(adapter.find.mock.calls.map(([object]) => object)).toEqual(['sys_team']);
    expect(ensureType).not.toHaveBeenCalled();
  });
});
