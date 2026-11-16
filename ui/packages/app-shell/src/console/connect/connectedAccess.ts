// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * "Has this person connected anything, and what" — the one read behind the
 * Connected line on Connect an AI Assistant. Anything else that needs to know
 * whether the signed-in person has connected an AI assistant reads it here.
 *
 * It reads the two records the "What can act as you" list reads, scoped to the
 * session's own person, and nothing else:
 *
 *  - the AI assistants they authorized: `oauth.authorizedClients.list()`
 *    (`GET /auth/authorized-clients`). `lastUsedAt` is the START of the hour
 *    the assistant last called in, so it says "in the hour from …", never a
 *    moment (`lastUsedPrecision: 'hour'`);
 *  - their API keys: `sys_api_key` rows filtered to `user_id` = the person
 *    (a platform administrator reads every person's keys, so the filter is
 *    what keeps this "mine"). Only a key that still authenticates counts: a
 *    revoked key or one past its `expires_at` is not a connection. Its
 *    `last_used_at` is a moment.
 *
 * Connected = at least one of either. The entries come most recent call first
 * (an entry with no call recorded after every one with a call, then newest
 * grant or key first).
 *
 * When a read fails the answer is `unknown` unless the other read already
 * found a connection: a failed read is never reported as "nothing connected".
 * `unknown` also covers a render without an adapter or a signed-in person.
 *
 * Its readers: the Connected line on Connect an AI Assistant, the Home card
 * that offers connecting one (hidden once connected), and the administrator's
 * first-run checklist row (done once connected).
 *
 * It reads again when either record changes on this page: the adapter's
 * mutation event (or the mint's `notifyDataChanged`) for `sys_api_key`, and the
 * assistants list's withdraw, which announces `sys_oauth_consent`.
 */

import { useSyncExternalStore } from 'react';
import { useAuth } from '@object-ui/auth';
import { dataChangeMatches, subscribeDataChanges, useAdapter } from '@object-ui/react';
import {
  API_KEY_LIST_FIELDS,
  isExpired,
  type ApiKeyRow,
  type AuthorizedClient,
} from './accessRecords.js';

export interface ConnectedEntry {
  kind: 'assistant' | 'apiKey';
  id: string;
  /** The assistant's display name, or the key's name; `null` when it has none. */
  name: string | null;
  /** When it last made a call; `null` when no call is recorded. */
  lastUsedAt: string | null;
  /** `hour`: `lastUsedAt` is the start of the hour the call fell in (assistants). */
  lastUsedPrecision: 'hour' | 'moment';
  /** When the person authorized the assistant, or created the key. */
  since: string | null;
}

export type ConnectedAccess =
  | { state: 'loading' }
  | { state: 'unknown' }
  | { state: 'ready'; connected: boolean; entries: ConnectedEntry[] };

export type Read<T> = { state: 'loading' } | { state: 'failed' } | { state: 'ready'; value: T };

function time(at: string | null): number {
  if (!at) return Number.NEGATIVE_INFINITY;
  const ms = Date.parse(at);
  return Number.isFinite(ms) ? ms : Number.NEGATIVE_INFINITY;
}

/** Most recent call first; no call recorded after every call, then newest first. */
export function byMostRecentCall(a: ConnectedEntry, b: ConnectedEntry): number {
  return time(b.lastUsedAt) - time(a.lastUsedAt) || time(b.since) - time(a.since);
}

function assistantEntry(c: AuthorizedClient): ConnectedEntry {
  return {
    kind: 'assistant',
    id: c.id,
    name: c.name ?? null,
    lastUsedAt: c.lastUsedAt ?? null,
    lastUsedPrecision: 'hour',
    since: c.authorizedAt ?? null,
  };
}

function keyEntry(k: ApiKeyRow): ConnectedEntry {
  return {
    kind: 'apiKey',
    id: k.id,
    name: k.name || null,
    lastUsedAt: k.last_used_at ?? null,
    lastUsedPrecision: 'moment',
    since: k.created_at ?? null,
  };
}

/** Combine the two reads into the answer; pure, so the rule is testable on its own. */
export function combineConnectedReads(
  assistants: Read<ConnectedEntry[]>,
  keys: Read<ConnectedEntry[]>,
): ConnectedAccess {
  const found = [assistants, keys].flatMap((r) => (r.state === 'ready' ? r.value : []));
  if (assistants.state === 'ready' && keys.state === 'ready') {
    return { state: 'ready', connected: found.length > 0, entries: found.sort(byMostRecentCall) };
  }
  if (found.length > 0) {
    // One read is still out or failed, but the other already found a connection.
    return { state: 'ready', connected: true, entries: found.sort(byMostRecentCall) };
  }
  if (assistants.state === 'failed' || keys.state === 'failed') return { state: 'unknown' };
  return { state: 'loading' };
}

/** The two reads one answer is built from. */
interface ConnectedReads {
  assistants: Read<ConnectedEntry[]>;
  keys: Read<ConnectedEntry[]>;
}

const NOT_READ: ConnectedReads = { assistants: { state: 'loading' }, keys: { state: 'loading' } };

/**
 * One person's two reads, shared by every consumer mounted at the same time.
 *
 * Several surfaces ask this question on one page (Home draws the Connect an AI
 * Assistant card and the administrator's checklist together), and each
 * consumer owning its own effect sent the same two requests once per consumer.
 * The entry lives while at least one consumer is subscribed: a consumer that
 * mounts while it lives joins its answer (or its reads in flight) instead of
 * asking again, and the entry is dropped with its last consumer, so a page
 * mounted later reads afresh. A change to either record re-reads it for every
 * consumer at once.
 */
interface SharedReads {
  reads: ConnectedReads;
  listeners: Set<() => void>;
  /** Bumped per read started; an answer for an older read is dropped. */
  assistantsRun: number;
  keysRun: number;
  stopListening: (() => void) | null;
}

/** Keyed by the adapter, then the person: two adapters never share a read. */
const sharedByAdapter = new WeakMap<object, Map<string, SharedReads>>();

type AccessAdapter = NonNullable<ReturnType<typeof useAdapter>>;

function publish(entry: SharedReads, next: Partial<ConnectedReads>): void {
  entry.reads = { ...entry.reads, ...next };
  for (const listener of Array.from(entry.listeners)) listener();
}

function readAssistants(adapter: AccessAdapter, entry: SharedReads): void {
  const run = ++entry.assistantsRun;
  // Through a promise, so an adapter without the auth client is a failed
  // read rather than a throw.
  Promise.resolve()
    .then(() => adapter.getClient().oauth.authorizedClients.list())
    .then(
      (value) => {
        if (run === entry.assistantsRun) {
          publish(entry, { assistants: { state: 'ready', value: value.clients.map(assistantEntry) } });
        }
      },
      () => {
        if (run === entry.assistantsRun) publish(entry, { assistants: { state: 'failed' } });
      },
    );
}

function readKeys(adapter: AccessAdapter, entry: SharedReads, userId: string): void {
  const run = ++entry.keysRun;
  Promise.resolve()
    .then(() =>
      adapter.find('sys_api_key', {
        $filter: { user_id: userId },
        $select: [...API_KEY_LIST_FIELDS],
      }),
    )
    .then(
      (res) => {
        if (run !== entry.keysRun) return;
        const readAt = Date.now();
        const rows = (res?.data ?? []) as ApiKeyRow[];
        publish(entry, {
          keys: {
            state: 'ready',
            value: rows.filter((k) => !k.revoked && !isExpired(k, readAt)).map(keyEntry),
          },
        });
      },
      () => {
        if (run === entry.keysRun) publish(entry, { keys: { state: 'failed' } });
      },
    );
}

function subscribeShared(adapter: AccessAdapter, userId: string, listener: () => void): () => void {
  let byUser = sharedByAdapter.get(adapter as object);
  if (!byUser) {
    byUser = new Map();
    sharedByAdapter.set(adapter as object, byUser);
  }
  let entry = byUser.get(userId);
  if (!entry) {
    entry = { reads: NOT_READ, listeners: new Set(), assistantsRun: 0, keysRun: 0, stopListening: null };
    byUser.set(userId, entry);
  }
  const shared = entry;
  shared.listeners.add(listener);
  if (!shared.stopListening) {
    // The first consumer: read both records, and re-read whichever changes.
    shared.stopListening = subscribeDataChanges((change) => {
      if (dataChangeMatches(change, 'sys_oauth_consent')) readAssistants(adapter, shared);
      if (dataChangeMatches(change, 'sys_api_key')) readKeys(adapter, shared, userId);
    });
    readAssistants(adapter, shared);
    readKeys(adapter, shared, userId);
  }
  return () => {
    shared.listeners.delete(listener);
    if (shared.listeners.size > 0) return;
    shared.stopListening?.();
    shared.stopListening = null;
    if (byUser?.get(userId) === shared) byUser.delete(userId);
  };
}

function sharedSnapshot(adapter: AccessAdapter, userId: string): ConnectedReads {
  return sharedByAdapter.get(adapter as object)?.get(userId)?.reads ?? NOT_READ;
}

/** What `useSyncExternalStore` is handed for one adapter and person. */
interface StoreDoor {
  subscribe: (listener: () => void) => () => void;
  getSnapshot: () => ConnectedReads;
}

const NO_STORE: StoreDoor = { subscribe: () => () => {}, getSnapshot: () => NOT_READ };

/**
 * One door per adapter and person, held outside React: `useSyncExternalStore`
 * re-subscribes whenever the `subscribe` it is handed changes identity, and a
 * re-subscribe that empties the entry would read again, so the identity is
 * keyed on the inputs themselves rather than on a memoised callback.
 */
const doorsByAdapter = new WeakMap<object, Map<string, StoreDoor>>();

function storeDoor(adapter: AccessAdapter | null | undefined, userId: string | null): StoreDoor {
  if (!adapter || !userId) return NO_STORE;
  let byUser = doorsByAdapter.get(adapter as object);
  if (!byUser) {
    byUser = new Map();
    doorsByAdapter.set(adapter as object, byUser);
  }
  let door = byUser.get(userId);
  if (!door) {
    door = {
      subscribe: (listener) => subscribeShared(adapter, userId, listener),
      getSnapshot: () => sharedSnapshot(adapter, userId),
    };
    byUser.set(userId, door);
  }
  return door;
}

/**
 * `enabled: false` reads nothing and answers `unknown`: a caller that may not
 * need the answer (a dismissed Home card, a member's Home with no checklist)
 * costs no request. Hooks cannot be called conditionally, so this is how a
 * caller skips the read.
 *
 * Every consumer of one adapter and person mounted at the same time shares
 * one pair of reads (see {@link SharedReads}).
 */
export function useConnectedAccess({ enabled = true }: { enabled?: boolean } = {}): ConnectedAccess {
  const adapter = useAdapter();
  const { user } = useAuth();
  const userId = enabled ? user?.id ?? null : null;

  const door = storeDoor(adapter, userId);
  const { assistants, keys } = useSyncExternalStore(door.subscribe, door.getSnapshot, door.getSnapshot);

  if (!adapter || !userId) return { state: 'unknown' };
  return combineConnectedReads(assistants, keys);
}
