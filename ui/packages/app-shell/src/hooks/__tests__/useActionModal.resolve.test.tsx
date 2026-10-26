/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * A `type: 'modal'` action's `target` names a PAGE, and only a page
 * (maintainer ruling on objectstack#6739, 2026-08-09).
 *
 * Origin (framework#3530 — "Console: modal-typed actions resolve `target` as an
 * object"): the console read the target as an OBJECT name and opened a create
 * form for it. That issued `GET /meta/object/<page>`, which 400s, so the modal
 * body was replaced with ModalForm's "Error loading form — Bad Request" and the
 * action never completed. The first fix made resolution page-FIRST, keeping an
 * object fallback behind it.
 *
 * That fallback is now RETIRED. The spec TSDoc, the published docs and
 * `defineStack`'s cross-reference walk all say a modal target is a page, and the
 * walk rejects a registered modal action targeting a non-page — so resolving one
 * anyway made the runtime serve what the build gate refuses. Opening an object's
 * form from an action is `type: 'form'`, validated end-to-end.
 *
 * These pin the resolution CONTRACT: a page resolves, anything else is REFUSED
 * with a diagnostic naming the target and pointing at `type: 'form'`. The pure
 * normalization step is covered separately in `useActionModal.test.ts`.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import React from 'react';
import { MetadataCtx } from '@object-ui/react';
import { useActionModal } from '../useActionModal';

const LOG_CALL_PAGE = { name: 'log_call', type: 'utility', label: 'Log a Call' };
const CONTACT_OBJECT = { name: 'contact', label: 'Contact', fields: {} };

/**
 * Stand-in metadata context. `getItem(type, name)` is the ONLY lookup the
 * resolver may use — reading the whole `pages` list would eagerly load a lazy
 * metadata type at the console root, which is what `getItem` exists to avoid.
 */
function makeWrapper(items: Record<string, any[]>) {
  const getItem = vi.fn(async (type: string, name: string) =>
    (items[type] ?? []).find((i) => i.name === name) ?? null);
  const value: any = {
    apps: [], objects: items.object ?? [], dashboards: [], reports: [], pages: [],
    loading: false, error: null,
    refresh: async () => {}, invalidate: () => {}, ensureType: async () => [],
    getItem,
    getItemsByType: () => [],
    getTypeStatus: () => 'ready',
  };
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <MetadataCtx.Provider value={value}>{children}</MetadataCtx.Provider>
  );
  return { wrapper, getItem };
}

beforeEach(() => vi.clearAllMocks());

describe('useActionModal — a modal target names a page, only (objectstack#6739)', () => {
  it('resolves a string target to the PAGE of that name, never GET /meta/object', async () => {
    const { wrapper, getItem } = makeWrapper({ page: [LOG_CALL_PAGE] });
    const { result } = renderHook(() => useActionModal(), { wrapper });

    let d: any;
    await act(async () => { d = await result.current.resolveModalTarget('log_call'); });

    // Rendered as page CONTENT (same shape PageView feeds SchemaRenderer),
    // not as an object form.
    expect(d.content).toMatchObject({ name: 'log_call', type: 'utility' });
    expect(d.objectName).toBeUndefined();
    expect(d.title).toBe('Log a Call');

    // The object lookup that produced the 400 must never happen.
    expect(getItem).toHaveBeenCalledWith('page', 'log_call');
    expect(getItem).not.toHaveBeenCalledWith('object', 'log_call');
  });

  it('REFUSES a target that names an existing object but no page', async () => {
    // Replaces the old "falls back to an object create form" case, which pinned
    // exactly the limb being deleted. The object is deliberately PRESENT in the
    // metadata: a refusal against an empty object list would pass vacuously,
    // proving only that nothing was found rather than that nothing was looked
    // for. `contact` is a real object here and is still refused.
    const { wrapper, getItem } = makeWrapper({ page: [], object: [CONTACT_OBJECT] });
    const { result } = renderHook(() => useActionModal(), { wrapper });

    let d: any;
    await act(async () => { d = await result.current.resolveModalTarget('contact'); });

    expect(d).toBeNull();
    expect(getItem).toHaveBeenCalledWith('page', 'contact');
    expect(getItem).not.toHaveBeenCalledWith('object', 'contact');
  });

  it('resolves a page whose name happens to carry a create_ prefix', async () => {
    // A prefixed name is an ordinary page name. Asserting the object is never
    // consulted is what keeps this non-vacuous now that the fallback is gone:
    // without it, "the page won" would be true by default.
    const { wrapper, getItem } = makeWrapper({
      page: [{ name: 'create_opportunity', type: 'utility', label: 'New Opportunity' }],
      object: [{ name: 'opportunity' }],
    });
    const { result } = renderHook(() => useActionModal(), { wrapper });

    let d: any;
    await act(async () => { d = await result.current.resolveModalTarget('create_opportunity'); });

    expect(d.content).toMatchObject({ name: 'create_opportunity' });
    expect(d.objectName).toBeUndefined();
    expect(getItem).not.toHaveBeenCalledWith('object', 'opportunity');
    expect(getItem).not.toHaveBeenCalledWith('object', 'create_opportunity');
  });

  it('REFUSES a create_ prefixed target with no page — the prefix is not special', async () => {
    // Replaces "still honors the create_ prefix when no page owns the name".
    // The ruling declined the middle shape (keep the prefix, reject bare object
    // names), so this must be judged EXACTLY like the bare-object-name case
    // above: same refusal, and the `opportunity` object it would have been
    // parsed into is never asked for even though it exists.
    const { wrapper, getItem } = makeWrapper({ page: [], object: [{ name: 'opportunity' }] });
    const { result } = renderHook(() => useActionModal(), { wrapper });

    let d: any;
    await act(async () => { d = await result.current.resolveModalTarget('create_opportunity'); });

    expect(d).toBeNull();
    expect(getItem).not.toHaveBeenCalledWith('object', 'opportunity');
  });

  it('returns null when the target names no page at all', async () => {
    const { wrapper } = makeWrapper({ page: [], object: [] });
    const { result } = renderHook(() => useActionModal(), { wrapper });

    let d: any;
    await act(async () => { d = await result.current.resolveModalTarget('schedule_followup'); });
    expect(d).toBeNull();
  });

  it('passes an explicit { objectName, mode } descriptor through without lookups', async () => {
    // The lookup field's inline "create the referenced record" path
    // (`@object-ui/fields`' LookupField). UNAFFECTED by the retirement: the
    // object identity comes from the field's `referenceTo` in a fully-formed
    // descriptor, not from parsing an action's string target.
    const { wrapper, getItem } = makeWrapper({ page: [], object: [] });
    const { result } = renderHook(() => useActionModal(), { wrapper });

    let d: any;
    await act(async () => {
      d = await result.current.resolveModalTarget({ objectName: 'customers', mode: 'create' });
    });

    expect(d).toMatchObject({ objectName: 'customers', mode: 'create' });
    expect(getItem).not.toHaveBeenCalled();
  });

  it('modalHandler names the refused target and points at type: form', async () => {
    const { wrapper } = makeWrapper({ page: [], object: [CONTACT_OBJECT] });
    const { result } = renderHook(() => useActionModal(), { wrapper });

    // Assert the REFUSAL before invoking `modalHandler`. If the object fallback
    // ever comes back, `contact` resolves, `modalHandler` opens the dialog and
    // returns a promise that settles only when the dialog CLOSES — so this test
    // would hang to the suite timeout instead of failing, and the hung state
    // leaks into the next test in this file. Verified against the restored
    // fallback: the timeout cascaded a spurious failure onto the neighbour.
    // This line makes the regression fail fast, loudly, and locally.
    let d: any;
    await act(async () => { d = await result.current.resolveModalTarget('contact'); });
    expect(d).toBeNull();

    let r: any;
    await act(async () => { r = await result.current.modalHandler('contact'); });

    expect(r.success).toBe(false);
    // The diagnostic has to be actionable on its own: which target was refused,
    // and what to author instead.
    expect(r.error).toContain('contact');
    expect(r.error).toContain("type: 'form'");
  });

  it('modalHandler reports a missing target distinctly from a refused one', async () => {
    const { wrapper } = makeWrapper({ page: [], object: [] });
    const { result } = renderHook(() => useActionModal(), { wrapper });

    let r: any;
    await act(async () => { r = await result.current.modalHandler(''); });

    expect(r.success).toBe(false);
    expect(r.error).toBe('Modal action has no target to open.');
  });
});
