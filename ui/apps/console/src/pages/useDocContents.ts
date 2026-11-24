/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { useEffect, useRef, useState } from 'react';
import { useAdapter } from '@object-ui/app-shell';
import type { SearchableDoc } from './docs-index';

export interface DocContents {
  state: 'idle' | 'loading' | 'ready' | 'error';
  docs: SearchableDoc[];
  error?: string;
}

const IDLE: DocContents = { state: 'idle', docs: [] };

function unwrapList(result: unknown): unknown[] {
  if (Array.isArray(result)) return result;
  const r = result as { items?: unknown; value?: unknown } | null;
  if (Array.isArray(r?.items)) return r.items;
  if (Array.isArray(r?.value)) return r.value;
  return [];
}

function toSearchable(it: unknown): SearchableDoc | null {
  const d = it as Record<string, unknown> | null;
  if (!d || typeof d.name !== 'string' || !d.name) return null;
  const text = (v: unknown) => (typeof v === 'string' ? v : undefined);
  return {
    name: d.name,
    label: text(d.label),
    description: text(d.description),
    content: text(d.content),
    packageId: text(d._packageId) ?? text(d.packageId),
  };
}

/**
 * Every doc WITH its body, for the "All documentation" page's full-text search
 * (objectstack#35424): one `GET /meta/doc?include=content`, asked the first time
 * `wanted` turns true (the reader types a query) and kept for the page's life.
 * The server answers it through the same audience gate as the slim list
 * (ADR-0046 §6.7) and collapses each doc to the session language.
 */
export function useDocContents(wanted: boolean): DocContents {
  const adapter = useAdapter();
  const [data, setData] = useState<DocContents>(IDLE);
  // Once wanted, wanted for good: clearing the query keeps the answer held.
  const [sticky, setSticky] = useState(wanted);
  if (wanted && !sticky) setSticky(true);
  // Asked once per adapter: a later query reads the answer already held.
  const askedFor = useRef<unknown>(null);

  useEffect(() => {
    if (!sticky || !adapter || askedFor.current === adapter) return;
    askedFor.current = adapter;
    let cancelled = false;
    setData({ state: 'loading', docs: [] });
    (async () => {
      try {
        const client = adapter.getClient() as {
          meta: { getItems: (type: string, options?: { include?: 'content' }) => Promise<unknown> };
        };
        const raw = await client.meta.getItems('doc', { include: 'content' });
        if (cancelled) return;
        const docs = unwrapList(raw).map(toSearchable).filter((d): d is SearchableDoc => d !== null);
        setData({ state: 'ready', docs });
      } catch (err) {
        if (cancelled) return;
        setData({ state: 'error', docs: [], error: err instanceof Error ? err.message : String(err) });
      }
    })();
    return () => {
      cancelled = true;
      // Unmounted or re-pointed before the answer: the next mount asks again.
      askedFor.current = null;
    };
  }, [sticky, adapter]);

  return data;
}
