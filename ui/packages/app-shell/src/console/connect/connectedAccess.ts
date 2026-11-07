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
 * It reads again when either record changes on this page: the adapter's
 * mutation event (or the mint's `notifyDataChanged`) for `sys_api_key`, and the
 * assistants list's withdraw, which announces `sys_oauth_consent`.
 */

import { useEffect, useState } from 'react';
import { useAuth } from '@object-ui/auth';
import { useAdapter, useDataInvalidation } from '@object-ui/react';
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

export function useConnectedAccess(): ConnectedAccess {
  const adapter = useAdapter();
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const consentsNonce = useDataInvalidation('sys_oauth_consent');
  const keysNonce = useDataInvalidation('sys_api_key');

  const [assistants, setAssistants] = useState<Read<ConnectedEntry[]>>({ state: 'loading' });
  const [keys, setKeys] = useState<Read<ConnectedEntry[]>>({ state: 'loading' });

  useEffect(() => {
    if (!adapter || !userId) return;
    let live = true;
    adapter
      .getClient()
      .oauth.authorizedClients.list()
      .then(
        (value) => live && setAssistants({ state: 'ready', value: value.clients.map(assistantEntry) }),
        () => live && setAssistants({ state: 'failed' }),
      );
    return () => {
      live = false;
    };
  }, [adapter, userId, consentsNonce]);

  useEffect(() => {
    if (!adapter || !userId) return;
    let live = true;
    adapter
      .find('sys_api_key', {
        $filter: { user_id: userId },
        $select: [...API_KEY_LIST_FIELDS],
      })
      .then(
        (res) => {
          if (!live) return;
          const readAt = Date.now();
          const rows = (res?.data ?? []) as ApiKeyRow[];
          setKeys({
            state: 'ready',
            value: rows.filter((k) => !k.revoked && !isExpired(k, readAt)).map(keyEntry),
          });
        },
        () => live && setKeys({ state: 'failed' }),
      );
    return () => {
      live = false;
    };
  }, [adapter, userId, keysNonce]);

  if (!adapter || !userId) return { state: 'unknown' };
  return combineConnectedReads(assistants, keys);
}
