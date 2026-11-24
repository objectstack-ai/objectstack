// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#32984 — the AI chat's change card names objects and fields by
 * label even while they are only DRAFTED. Before the first publish the
 * published registry does not hold them, so the card read 「b6bl_quote_item ·
 * line_total」; the names are now read by name from the draft overlay
 * (`?preview=draft`) when the published registry does not know them.
 */
import { describe, it, expect, vi } from 'vitest';
import type { ReactNode } from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { createI18n, I18nProvider } from '@object-ui/i18n';
import { useChangeCardLabels } from '../changeCardLabels';

type Obj = { name: string; label?: string; fields?: Record<string, { label?: string }> };

/** A published registry already loaded with `objects` (no names-only scope). */
function published(objects: Obj[]) {
  return { objects, getTypeStatus: () => 'ready' as const } as never;
}

/** A metadata client whose draft-overlay read answers `drafts` by name (the list may grow later). */
function client(drafts: Obj[]) {
  const overlayGet = vi.fn(async (type: string, name: string) =>
    type === 'object' ? (structuredClone(drafts.find((d) => d.name === name)) ?? null) : null,
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
    const { result } = renderHook(() => useChangeCardLabels(published([]), c.api, 0));

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
    const { result } = renderHook(() => useChangeCardLabels(published([QUOTE_ITEM]), c.api, 0));

    result.current.resolveFieldLabel('b6bl_quote_item', 'discount');
    await waitFor(() => expect(result.current.resolveFieldLabel('b6bl_quote_item', 'discount')).toBe('Discount'));
  });

  it('control: a published object and field answer from the registry while the overlay has not answered', () => {
    const c = client([]);
    const { result } = renderHook(() => useChangeCardLabels(published([QUOTE_ITEM]), c.api, 0));

    // objectstack#34629: a published name also asks the overlay (once), but its
    // published label answers at once, before that read settles.
    expect(result.current.resolveObjectLabel('b6bl_quote_item')).toBe('Quote line');
    expect(result.current.resolveFieldLabel('b6bl_quote_item', 'line_total')).toBe('Subtotal');
    expect(c.overlayGet).toHaveBeenCalledTimes(1);
  });

  it('control: a name neither world knows keeps answering undefined, and is asked once', async () => {
    const c = client([]);
    const { result } = renderHook(() => useChangeCardLabels(published([]), c.api, 0));

    expect(result.current.resolveObjectLabel('b6bl_new_thing')).toBeUndefined();
    await waitFor(() => expect(c.overlayGet).toHaveBeenCalledTimes(1));
    await new Promise((r) => setTimeout(r, 0));
    expect(result.current.resolveObjectLabel('b6bl_new_thing')).toBeUndefined();
    expect(result.current.resolveFieldLabel('b6bl_new_thing', 'x')).toBeUndefined();
    expect(c.overlayGet).toHaveBeenCalledTimes(1);
  });
});

describe('objectstack#32984 — a change applied later in the same conversation is named by label', () => {
  /** Settle the overlay reads in flight. */
  const settle = () => new Promise((r) => setTimeout(r, 0));

  it('a field added after the first read is named on a later card', async () => {
    const drafts: Obj[] = [{ name: 'b6bl_quote_item', label: 'Quote line', fields: { line_total: { label: 'Subtotal' } } }];
    const c = client(drafts);
    const { result, rerender } = renderHook(({ rev }) => useChangeCardLabels(published([]), c.api, rev), {
      initialProps: { rev: 0 },
    });

    // The card that proposes the field: the overlay does not hold it yet.
    result.current.resolveFieldLabel('b6bl_quote_item', 'discount');
    await waitFor(() => expect(result.current.resolveObjectLabel('b6bl_quote_item')).toBe('Quote line'));
    expect(result.current.resolveFieldLabel('b6bl_quote_item', 'discount')).toBeUndefined();

    // The change applies (the field is drafted), the conversation moves on, and
    // a later card names the field.
    drafts[0]!.fields!.discount = { label: 'Discount' };
    rerender({ rev: 1 });
    result.current.resolveFieldLabel('b6bl_quote_item', 'discount');
    await waitFor(() => expect(result.current.resolveFieldLabel('b6bl_quote_item', 'discount')).toBe('Discount'));
  });

  it('an object created after the first read is named on a later card', async () => {
    const drafts: Obj[] = [];
    const c = client(drafts);
    const { result, rerender } = renderHook(({ rev }) => useChangeCardLabels(published([]), c.api, rev), {
      initialProps: { rev: 0 },
    });

    result.current.resolveObjectLabel('b6bl_supplier');
    await waitFor(() => expect(c.overlayGet).toHaveBeenCalledTimes(1));
    await settle();
    expect(result.current.resolveObjectLabel('b6bl_supplier')).toBeUndefined();

    drafts.push({ name: 'b6bl_supplier', label: 'Supplier', fields: { rating: { label: 'Rating' } } });
    rerender({ rev: 1 });
    result.current.resolveObjectLabel('b6bl_supplier');
    await waitFor(() => expect(result.current.resolveObjectLabel('b6bl_supplier')).toBe('Supplier'));
    expect(result.current.resolveFieldLabel('b6bl_supplier', 'rating')).toBe('Rating');
  });

  it('control: a miss is re-asked at most once per conversation revision, never per render', async () => {
    const c = client([]);
    const { result, rerender } = renderHook(({ rev }) => useChangeCardLabels(published([]), c.api, rev), {
      initialProps: { rev: 0 },
    });

    for (let i = 0; i < 5; i += 1) {
      result.current.resolveObjectLabel('b6bl_never');
      result.current.resolveFieldLabel('b6bl_never', 'x');
      await settle();
      rerender({ rev: 0 });
    }
    expect(c.overlayGet).toHaveBeenCalledTimes(1);

    rerender({ rev: 1 });
    for (let i = 0; i < 5; i += 1) {
      result.current.resolveObjectLabel('b6bl_never');
      await settle();
      rerender({ rev: 1 });
    }
    expect(c.overlayGet).toHaveBeenCalledTimes(2);
  });

  it('control: a kept answer that holds the asked field is not re-asked when the revision moves', async () => {
    const c = client([QUOTE_ITEM]);
    const { result, rerender } = renderHook(({ rev }) => useChangeCardLabels(published([]), c.api, rev), {
      initialProps: { rev: 0 },
    });
    result.current.resolveFieldLabel('b6bl_quote_item', 'line_total');
    await waitFor(() => expect(result.current.resolveFieldLabel('b6bl_quote_item', 'line_total')).toBe('Subtotal'));
    rerender({ rev: 1 });
    expect(result.current.resolveFieldLabel('b6bl_quote_item', 'line_total')).toBe('Subtotal');
    expect(result.current.resolveObjectLabel('b6bl_quote_item')).toBe('Quote line');
    await settle();
    expect(c.overlayGet).toHaveBeenCalledTimes(1);
  });
});

describe('objectstack#34629 — a published object or field the draft relabelled is named by its draft label', () => {
  /** Settle the overlay reads in flight. */
  const settle = () => new Promise((r) => setTimeout(r, 0));
  /** The overlay answers the published definition with the draft's changes merged in. */
  const RELABELLED: Obj = { name: 'b6bl_quote_item', label: 'Order line', fields: { line_total: { label: 'Line amount' } } };

  it('a published object renamed in the draft shows the draft label', async () => {
    const c = client([RELABELLED]);
    const { result } = renderHook(() => useChangeCardLabels(published([QUOTE_ITEM]), c.api, 0));

    result.current.resolveObjectLabel('b6bl_quote_item');
    await waitFor(() => expect(result.current.resolveObjectLabel('b6bl_quote_item')).toBe('Order line'));
    expect(c.withPreviewDrafts).toHaveBeenCalledWith(true);
    expect(c.overlayGet).toHaveBeenCalledWith('object', 'b6bl_quote_item');
  });

  it('a published field relabelled in the draft shows the draft label', async () => {
    const c = client([{ ...QUOTE_ITEM, fields: { line_total: { label: 'Line amount' } } }]);
    const { result } = renderHook(() => useChangeCardLabels(published([QUOTE_ITEM]), c.api, 0));

    result.current.resolveFieldLabel('b6bl_quote_item', 'line_total');
    await waitFor(() => expect(result.current.resolveFieldLabel('b6bl_quote_item', 'line_total')).toBe('Line amount'));
    // The object the draft did not rename keeps its published label.
    expect(result.current.resolveObjectLabel('b6bl_quote_item')).toBe('Quote line');
  });

  it('control: a published name with no draft change shows its published label after the overlay answers', async () => {
    const c = client([QUOTE_ITEM]);
    const { result } = renderHook(() => useChangeCardLabels(published([QUOTE_ITEM]), c.api, 0));

    result.current.resolveObjectLabel('b6bl_quote_item');
    await waitFor(() => expect(c.overlayGet).toHaveBeenCalledTimes(1));
    await settle();
    expect(result.current.resolveObjectLabel('b6bl_quote_item')).toBe('Quote line');
    expect(result.current.resolveFieldLabel('b6bl_quote_item', 'line_total')).toBe('Subtotal');
  });

  it('control: a failed overlay read keeps the published label', async () => {
    const c = client([]);
    c.overlayGet.mockRejectedValueOnce(new Error('offline'));
    const { result } = renderHook(() => useChangeCardLabels(published([QUOTE_ITEM]), c.api, 0));

    result.current.resolveObjectLabel('b6bl_quote_item');
    await waitFor(() => expect(c.overlayGet).toHaveBeenCalledTimes(1));
    await settle();
    expect(result.current.resolveObjectLabel('b6bl_quote_item')).toBe('Quote line');
  });

  it('a relabel drafted later in the same conversation is named on a later card', async () => {
    const drafts: Obj[] = [structuredClone(QUOTE_ITEM)];
    const c = client(drafts);
    const { result, rerender } = renderHook(({ rev }) => useChangeCardLabels(published([QUOTE_ITEM]), c.api, rev), {
      initialProps: { rev: 0 },
    });

    // An earlier card names the object before the draft renames it.
    result.current.resolveObjectLabel('b6bl_quote_item');
    await waitFor(() => expect(c.overlayGet).toHaveBeenCalledTimes(1));
    await settle();
    expect(result.current.resolveObjectLabel('b6bl_quote_item')).toBe('Quote line');

    // A later change renames it; the conversation moves on and a later card names it.
    drafts[0] = structuredClone(RELABELLED);
    rerender({ rev: 1 });
    result.current.resolveObjectLabel('b6bl_quote_item');
    await waitFor(() => expect(result.current.resolveObjectLabel('b6bl_quote_item')).toBe('Order line'));
    expect(c.overlayGet).toHaveBeenCalledTimes(2);
  });

  it('the bound: one overlay read per published object per revision, none while one is in flight', async () => {
    let release: () => void = () => {};
    const c = client([RELABELLED]);
    const gate = new Promise<void>((r) => {
      release = r;
    });
    c.overlayGet.mockImplementation(async (_type: string, name: string) => {
      await gate;
      return name === RELABELLED.name ? structuredClone(RELABELLED) : null;
    });
    const { result, rerender } = renderHook(({ rev }) => useChangeCardLabels(published([QUOTE_ITEM]), c.api, rev), {
      initialProps: { rev: 0 },
    });

    // In flight: object and field asks across renders and a revision move add no read.
    for (let i = 0; i < 5; i += 1) {
      result.current.resolveObjectLabel('b6bl_quote_item');
      result.current.resolveFieldLabel('b6bl_quote_item', 'line_total');
      rerender({ rev: i < 3 ? 0 : 1 });
    }
    expect(c.overlayGet).toHaveBeenCalledTimes(1);

    release();
    await waitFor(() => expect(result.current.resolveObjectLabel('b6bl_quote_item')).toBe('Order line'));
    // Settled at revision 0 was asked; revision 1 is now current and was never asked: one more read, then none.
    for (let i = 0; i < 5; i += 1) {
      result.current.resolveObjectLabel('b6bl_quote_item');
      result.current.resolveFieldLabel('b6bl_quote_item', 'line_total');
      await settle();
      rerender({ rev: 1 });
    }
    expect(c.overlayGet).toHaveBeenCalledTimes(2);
  });

  describe('with a convention translation for the object and field', () => {
    function withTranslation({ children }: { children: ReactNode }) {
      const instance = createI18n({ defaultLanguage: 'en', detectBrowserLanguage: false });
      instance.addResourceBundle(
        'en',
        'translation',
        {
          b6bl: {
            objects: { b6bl_quote_item: { label: 'Quote line (translated)' } },
            fields: { b6bl_quote_item: { line_total: 'Subtotal (translated)' } },
          },
        },
        true,
        true,
      );
      return (
        <I18nProvider instance={instance} persistLanguage={false}>
          {children}
        </I18nProvider>
      );
    }

    it('a draft relabel wins over the translation written for the published label', async () => {
      const c = client([RELABELLED]);
      const { result } = renderHook(() => useChangeCardLabels(published([QUOTE_ITEM]), c.api, 0), {
        wrapper: withTranslation,
      });

      result.current.resolveObjectLabel('b6bl_quote_item');
      await waitFor(() => expect(result.current.resolveObjectLabel('b6bl_quote_item')).toBe('Order line'));
      expect(result.current.resolveFieldLabel('b6bl_quote_item', 'line_total')).toBe('Line amount');
    });

    it('control: a label the draft did not change still goes through the translation', async () => {
      const c = client([QUOTE_ITEM]);
      const { result } = renderHook(() => useChangeCardLabels(published([QUOTE_ITEM]), c.api, 0), {
        wrapper: withTranslation,
      });

      result.current.resolveObjectLabel('b6bl_quote_item');
      await waitFor(() => expect(c.overlayGet).toHaveBeenCalledTimes(1));
      await settle();
      expect(result.current.resolveObjectLabel('b6bl_quote_item')).toBe('Quote line (translated)');
      expect(result.current.resolveFieldLabel('b6bl_quote_item', 'line_total')).toBe('Subtotal (translated)');
    });
  });
});
