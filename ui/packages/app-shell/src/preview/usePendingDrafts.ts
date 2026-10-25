/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#5801 — the ONE pending-drafts data source.
 *
 * "Has unpublished changes" used to be answered by five surfaces with five
 * hand-rolled copies of the same `GET /api/v1/meta/_drafts` fetch (home
 * banner, Studio topbar, chat bar, chat draft-card resolver, preview
 * watermark), each with its own refresh trigger and none of them telling the
 * others when a publish happened — measured live: the home banner reported
 * 1 pending change while the Studio topbar reported none, and a publish from
 * the Studio dock never updated the Studio topbar count.
 *
 * This module is the single copy:
 *  - {@link fetchPendingDrafts} is the fetch + response-shape tolerance
 *    (`[...]`, `{drafts}`, `{data:{drafts}}` — every shape a deployed server
 *    has answered with).
 *  - {@link usePendingDrafts} keeps a live count/entry list for a scope and
 *    subscribes to the assistant bus's metadata-refresh pulse, so ANY
 *    publish/install that announces itself converges every surface at once.
 *
 * Publishing deliberately stays with each surface (their failure handling and
 * toasts differ on purpose); the contract is that every successful publish
 * path calls `emitMetadataRefresh()` — that pulse, plus this hook, is the
 * whole unification mechanism.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { I18nLabel } from '@objectstack/spec/ui';
import { subscribeMetadataRefresh } from '../assistant/assistantBus.js';

export interface PendingDraftEntry {
  /** Raw stored type — callers that build `/meta` URLs must fold it themselves. */
  type: string;
  name: string;
  packageId: string | null;
  /**
   * The bundle member this draft is (objectstack#23073, `ListDraftsResponseSchema`
   * `drafts[].member`): present on every draft of a type whose identity is a
   * pair (today only `email_template`, `(name, locale)`), absent for a type
   * identified by its name alone. Two members of one name are two entries; a
   * caller addressing this draft through a by-name `/meta` door passes it back
   * as `?member=`. Copied as served, never derived from the name or the body.
   */
  member?: string;
  /**
   * The draft body's own label, as `_drafts` served it
   * (objectstack-ai/objectstack#22200, `ListDraftsResponseSchema`
   * `drafts[].label`): a plain string, or on the UI types an inline locale map
   * the reader resolves (`resolveI18nLabel`). Absent when the row's label is
   * `null` — the producer's answer for a body that declares none — so a caller
   * shows the name only where there is truly no label (objectui#11862). Copied
   * as served; never a fallback to the name.
   */
  label?: I18nLabel;
}

/**
 * A `_drafts` row's `label`, as served: a non-blank string or a locale map,
 * else `undefined` (`null` and anything else).
 */
function servedLabel(raw: unknown): I18nLabel | undefined {
  if (typeof raw === 'string') return raw.trim() ? raw : undefined;
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) return raw as I18nLabel;
  return undefined;
}

/**
 * The `_drafts` requests currently on the wire, per `fetch` and URL
 * (objectui#11797).
 *
 * Opening a package asked the same ledger several times at once: this hook
 * reads on mount, and the surfaces that mount it (the Studio topbar, the chat
 * bar) also call `refresh()` from a mount effect of their own. A caller that
 * arrives while a request for the same URL is pending now waits for that
 * request instead of sending another.
 *
 * ⛔ Not a response cache, deliberately:
 *  - the entry goes the moment the request settles, so a call made after an
 *    answer always reaches the network. There is no reuse window because the
 *    ledger changes on writes this module never sees (a draft save, an
 *    agent's server-side staging), and a window would answer the read after
 *    such a write with the count from before it;
 *  - a failure reaches the callers already waiting and is then forgotten;
 *  - the publish pulse (`emitMetadataRefresh`, the contract every publish path
 *    keeps — see the module doc) drops the pending requests before the hooks
 *    it wakes read again, so their read is never answered by a request sent
 *    before the publish;
 *  - a draft save does the same for the read it asks for
 *    (`refresh({ afterSave: true })`, objectui#11787): a request sent before
 *    the save landed cannot count the draft it wrote.
 *
 * Keyed by the `fetch` the request went through: a request only answers
 * callers of the same transport. Each caller parses the shared payload itself,
 * so every caller still gets its own entry list.
 */
const pendingDraftReads = new WeakMap<typeof fetch, Map<string, Promise<unknown>>>();
let publishPulseObserved = false;

function draftsUrl(packageId?: string | null): string {
  return `/api/v1/meta/_drafts${packageId ? `?packageId=${encodeURIComponent(packageId)}` : ''}`;
}

function readDraftsPayload(url: string): Promise<unknown> {
  // Registered on first use rather than at import, and so before the hook's
  // own pulse subscription (the hook reads first, then subscribes): the drop
  // runs before the refresh that pulse triggers.
  if (!publishPulseObserved) {
    publishPulseObserved = true;
    subscribeMetadataRefresh(() => pendingDraftReads.get(globalThis.fetch)?.clear());
  }
  const transport = globalThis.fetch;
  let reads = pendingDraftReads.get(transport);
  if (!reads) {
    reads = new Map();
    pendingDraftReads.set(transport, reads);
  }
  const pending = reads.get(url);
  if (pending) return pending;
  const read = (async () => {
    const res = await fetch(url, {
      credentials: 'include',
      headers: { Accept: 'application/json' },
      cache: 'no-store',
    });
    if (!res.ok) throw new Error(`_drafts HTTP ${res.status}`);
    return res.json() as Promise<unknown>;
  })();
  reads.set(url, read);
  const owner = reads;
  const settle = () => {
    if (owner.get(url) === read) owner.delete(url);
  };
  read.then(settle, settle);
  return read;
}

export async function fetchPendingDrafts(
  packageId?: string | null,
): Promise<PendingDraftEntry[]> {
  const data = (await readDraftsPayload(draftsUrl(packageId))) as
    | Array<Record<string, unknown>>
    | { drafts?: Array<Record<string, unknown>>; data?: { drafts?: Array<Record<string, unknown>> } };
  const list = Array.isArray(data) ? data : (data?.drafts ?? data?.data?.drafts ?? []);
  return (Array.isArray(list) ? list : [])
    .filter((d) => typeof d?.type === 'string' && typeof d?.name === 'string')
    .map((d) => {
      // objectui#11862 — the label, read off the row it arrived on.
      const label = servedLabel(d.label);
      return {
        type: d.type as string,
        name: d.name as string,
        packageId: typeof d.packageId === 'string' && d.packageId ? (d.packageId as string) : null,
        // Only when served: an entry without `member` stays without one, so no
        // caller ever sends an empty `?member=` (a blank selector is a 400).
        ...(typeof d.member === 'string' && d.member ? { member: d.member as string } : {}),
        ...(label !== undefined ? { label } : {}),
      };
    });
}

export interface UsePendingDraftsOptions {
  /** Scope: a packageId for per-app surfaces, undefined/null for env-wide. */
  packageId?: string | null;
  /** False = hold fetching (e.g. no bound package yet). Default true. */
  enabled?: boolean;
}

export interface UsePendingDraftsResult {
  /** null until the first successful read (lets callers hold rendering). */
  count: number | null;
  entries: PendingDraftEntry[];
  /**
   * Manual refetch — for surface-local triggers (draft saved, turn idle).
   *
   * objectui#11787 — `afterSave`: a draft save in this scope has just landed.
   * The read is then sent fresh rather than joining one already on the wire,
   * which was sent before the save and cannot count its draft, and
   * {@link UsePendingDraftsResult.behindSave} holds until a read sent after it
   * answers.
   */
  refresh: (opts?: { afterSave?: boolean }) => Promise<void>;
  /**
   * objectui#11787 — a draft save reported through `refresh({ afterSave: true })`
   * has landed, and no read sent after it has answered yet. The draft it wrote
   * exists, so a surface showing the count knows it is at least one: a header
   * that said "nothing to publish" beside an item's "unpublished draft" chip
   * was showing a count from before the save. Stays true when that read fails,
   * since the save itself is not in doubt; a later answer clears it.
   */
  behindSave: boolean;
}

export function usePendingDrafts(opts: UsePendingDraftsOptions = {}): UsePendingDraftsResult {
  const { packageId, enabled = true } = opts;
  const [entries, setEntries] = useState<PendingDraftEntry[]>([]);
  const [count, setCount] = useState<number | null>(null);
  // A single in-flight guard + generation counter: a refresh started before a
  // scope change must not land its stale answer on the new scope.
  const genRef = useRef(0);
  // objectui#11787 — draft saves reported (`savesRef`, mirrored in `saves`
  // for render), and how many of them the installed answer was sent after.
  const savesRef = useRef(0);
  const [saves, setSaves] = useState(0);
  const [counted, setCounted] = useState(0);

  const refresh = useCallback(async (opts?: { afterSave?: boolean }) => {
    if (!enabled) return;
    if (opts?.afterSave) {
      savesRef.current += 1;
      setSaves(savesRef.current);
      // Never joined to a request sent before the save (objectui#11787).
      pendingDraftReads.get(globalThis.fetch)?.delete(draftsUrl(packageId));
    }
    const sentAfter = savesRef.current;
    const gen = ++genRef.current;
    try {
      const list = await fetchPendingDrafts(packageId);
      if (genRef.current !== gen) return;
      setEntries(list);
      setCount(list.length);
      setCounted(sentAfter);
    } catch {
      // An errored read means UNKNOWN, not zero: count stays null so surfaces
      // that must fail SAFE on unknown (the preview bar keeps its Publish
      // visible) can tell the difference from a known-empty ledger; count-only
      // banners hide on null exactly as they hide on 0.
      if (genRef.current !== gen) return;
      setEntries([]);
      setCount(null);
    }
  }, [packageId, enabled]);

  useEffect(() => {
    if (!enabled) {
      genRef.current++;
      setEntries([]);
      setCount(null);
      return;
    }
    void refresh();
    return subscribeMetadataRefresh(() => {
      void refresh();
    });
  }, [refresh, enabled]);

  return { count, entries, refresh, behindSave: counted < saves };
}
