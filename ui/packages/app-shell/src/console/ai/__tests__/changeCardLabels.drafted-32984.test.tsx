// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#32984 — the AI chat's change card names objects and fields by
 * label even while they are only DRAFTED. Before the first publish the
 * published registry does not hold them, so the card read 「b6bl_quote_item ·
 * line_total」; the names are now read by name from the draft overlay
 * (`?preview=draft`) when the published registry does not know them.
 */
import { describe, it, expect, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useChangeCardLabels } from '../changeCardLabels';

type Obj = { name: string; label?: string; fields?: Record<string, { label?: string }> };

/** A published registry already loaded with `objects` (no names-only scope). */
function published(objects: Obj[]) {
  return { objects, getTypeStatus: () => 'ready' as const } as never;
}

/** A metadata client whose draft-overlay read answers `drafts` by name. */
function client(drafts: Obj[]) {
  const overlayGet = vi.fn(async (type: string, name: string) =>
    type === 'object' ? (drafts.find((d) => d.name === name) ?? null) : null,
  );
  const plainGet = vi.fn(async () => null);
  const withPreviewDrafts = vi.fn((on: boolean) => (on ? { get: overlayGet } : { get: plainGet }));
  return { api: { withPreviewDrafts, get: plainGet } as never, overlayGet, plainGet, withPreviewDrafts };
}

const QUOTE_ITEM: Obj = {
  name: 'b6bl_quote_item',
  label: 'Quote line',
  fields: { line_total: { label: 'Subtotal' } },
};

describe('objectstack#32984 — change card labels for drafted objects and fields', () => {
  it('names an object and field that exist only as drafts by their draft labels', async () => {
    const c = client([QUOTE_ITEM]);
    const { result } = renderHook(() => useChangeCardLabels(published([]), c.api));

    // First ask: the published registry does not know it; the overlay is asked.
    result.current.resolveObjectLabel('b6bl_quote_item');
    await waitFor(() => expect(result.current.resolveObjectLabel('b6bl_quote_item')).toBe('Quote line'));
    expect(result.current.resolveFieldLabel('b6bl_quote_item', 'line_total')).toBe('Subtotal');
    // Read through the draft overlay, by name, once.
    expect(c.withPreviewDrafts).toHaveBeenCalledWith(true);
    expect(c.overlayGet).toHaveBeenCalledTimes(1);
    expect(c.overlayGet).toHaveBeenCalledWith('object', 'b6bl_quote_item');
  });

  it('names a field drafted onto a published object by its draft label', async () => {
    const c = client([{ ...QUOTE_ITEM, fields: { ...QUOTE_ITEM.fields, discount: { label: 'Discount' } } }]);
    const { result } = renderHook(() => useChangeCardLabels(published([QUOTE_ITEM]), c.api));

    result.current.resolveFieldLabel('b6bl_quote_item', 'discount');
    await waitFor(() => expect(result.current.resolveFieldLabel('b6bl_quote_item', 'discount')).toBe('Discount'));
  });

  it('control: a published object and field answer from the registry, without a draft read', () => {
    const c = client([]);
    const { result } = renderHook(() => useChangeCardLabels(published([QUOTE_ITEM]), c.api));

    expect(result.current.resolveObjectLabel('b6bl_quote_item')).toBe('Quote line');
    expect(result.current.resolveFieldLabel('b6bl_quote_item', 'line_total')).toBe('Subtotal');
    expect(c.overlayGet).not.toHaveBeenCalled();
  });

  it('control: a name neither world knows keeps answering undefined, and is asked once', async () => {
    const c = client([]);
    const { result } = renderHook(() => useChangeCardLabels(published([]), c.api));

    expect(result.current.resolveObjectLabel('b6bl_new_thing')).toBeUndefined();
    await waitFor(() => expect(c.overlayGet).toHaveBeenCalledTimes(1));
    await new Promise((r) => setTimeout(r, 0));
    expect(result.current.resolveObjectLabel('b6bl_new_thing')).toBeUndefined();
    expect(result.current.resolveFieldLabel('b6bl_new_thing', 'x')).toBeUndefined();
    expect(c.overlayGet).toHaveBeenCalledTimes(1);
  });
});
