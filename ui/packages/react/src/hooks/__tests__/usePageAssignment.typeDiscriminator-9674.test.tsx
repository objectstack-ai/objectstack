/**
 * ObjectUI — usePageAssignment: `type` is the ONE record-page discriminator
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * objectui#9674. The record filter used to read the page kind as
 *
 *     p.pageType ?? (p.type === 'record' ? 'record' : undefined)
 *
 * `PageSchema` is a `strictObject` and refuses `pageType` by name: it is one of
 * the schema's declared ALIASES of `type`, so a page carrying it is a hard parse
 * error that names `type` as the key to write. The first operand therefore read
 * a spelling no parsing page can carry, and taught it onward as a live
 * discriminator. ⛔ No consumer-side alias for a refused key (AGENTS.md #0.1).
 *
 * These pins assert WHICH PAGE is returned. The `pageType`-only row is the
 * refused alias: it must NOT be picked. The last block pins the CONTRACT the
 * removal rests on, so that if `pageType` is ever declared upstream this file
 * reds and points back here.
 */

import React from 'react';
import { describe, it, expect } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { PageSchema } from '@objectstack/spec/ui';
import { MetadataCtx, type MetadataContextValue } from '../../context/AppShellContext';
import { usePageAssignment } from '../usePageAssignment';

/** A page as the metadata cache holds it: the body as served, unparsed. */
type Page = Record<string, unknown>;

/** A metadata context carrying exactly the `pages` list under test. */
function wrapperFor(pages: Page[]) {
  const ctx: MetadataContextValue = {
    apps: [],
    objects: [],
    dashboards: [],
    reports: [],
    pages,
    loading: false,
    error: null,
    refresh: async () => {},
    invalidate: () => {},
    ensureType: async () => pages,
    getItem: async () => null,
    getItemsByType: () => [],
    getTypeStatus: () => 'ready' as const,
  };
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return <MetadataCtx.Provider value={ctx}>{children}</MetadataCtx.Provider>;
  };
}

async function assign(pages: Page[], objectName: string) {
  const { result } = renderHook(() => usePageAssignment(objectName), {
    wrapper: wrapperFor(pages),
  });
  await waitFor(() => expect(result.current.loading).toBe(false));
  return result;
}

const OBJECT = 'account';

describe('usePageAssignment — `type` is the one record-page discriminator (objectui#9674)', () => {
  it('picks a page with `type: \'record\'`', async () => {
    const result = await assign(
      [{ name: 'account_record', label: 'Account', type: 'record', object: OBJECT }],
      OBJECT,
    );
    expect(result.current.page?.name).toBe('account_record');
  });

  it('does not pick a page whose `type` is anything other than `record`', async () => {
    for (const type of ['list', 'home', 'app', 'utility']) {
      const result = await assign(
        [{ name: `account_${type}`, label: 'Account', type, object: OBJECT }],
        OBJECT,
      );
      expect(result.current.page).toBeNull();
      expect(result.current.slots).toBeNull();
    }
  });

  it('does NOT pick a page carrying only `pageType: \'record\'` — the refused alias', async () => {
    const result = await assign(
      [{ name: 'account_alias_only', label: 'Account', pageType: 'record', object: OBJECT }],
      OBJECT,
    );
    expect(result.current.page).toBeNull();
    expect(result.current.slots).toBeNull();
  });

  it('a `pageType` value never overrides `type` — the alias is not consulted in either direction', async () => {
    const result = await assign(
      [
        { name: 'alias_says_record', label: 'Account', type: 'list', pageType: 'record', object: OBJECT },
        { name: 'type_says_record', label: 'Account', type: 'record', pageType: 'record_detail', object: OBJECT },
      ],
      OBJECT,
    );
    // Declaration order would pick `alias_says_record` if `pageType` decided;
    // `type` decides, so the second page is the only candidate.
    expect(result.current.page?.name).toBe('type_says_record');
  });
});

describe('PageSchema refuses `pageType` — the contract the removal rests on', () => {
  const base = { name: 'account_record', label: 'Account', type: 'record', object: OBJECT };

  it('accepts the canonical spelling (positive control)', () => {
    // Without this leg the refusal below would also be produced by a schema
    // that rejects everything, and would say nothing about `pageType`.
    expect(PageSchema.safeParse(base).success).toBe(true);
  });

  it('is strict: a nonsense key is refused (negative control)', () => {
    const r = PageSchema.safeParse({ ...base, zzzNotAKey: 1 });
    expect(r.success).toBe(false);
    expect(r.error!.issues.some(i => i.code === 'unrecognized_keys')).toBe(true);
  });

  it('refuses `pageType` as an unrecognized key — beside `type`, and in place of it', () => {
    const { type: _omitted, ...withoutType } = base;
    for (const page of [{ ...base, pageType: 'record' }, { ...withoutType, pageType: 'record' }]) {
      const r = PageSchema.safeParse(page);
      expect(r.success).toBe(false);
      const unrecognized = r.error!.issues.filter(i => i.code === 'unrecognized_keys');
      expect(unrecognized).toHaveLength(1);
      expect((unrecognized[0] as { keys?: string[] }).keys).toEqual(['pageType']);
    }
  });
});
