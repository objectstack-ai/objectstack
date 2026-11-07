// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The two records that say what can act as the signed-in person, as the
 * Connect an AI Assistant page reads them: the AI assistants they authorized
 * (`oauth.authorizedClients`) and their API keys (`sys_api_key`). Shared by the
 * "What can act as you" list and `useConnectedAccess`, so both read the same
 * columns and judge a key's expiry the same way.
 */

import type { useAdapter } from '@object-ui/react';

/** The `sys_api_key` columns the list reads; the key's secret is never among them. */
export const API_KEY_LIST_FIELDS = [
  'id',
  'name',
  'prefix',
  'created_at',
  'last_used_at',
  'expires_at',
  'revoked',
] as const;

export interface ApiKeyRow {
  id: string;
  name?: string | null;
  prefix?: string | null;
  created_at?: string | null;
  last_used_at?: string | null;
  expires_at?: string | null;
  revoked?: boolean | null;
}

type ShellClient = ReturnType<NonNullable<ReturnType<typeof useAdapter>>['getClient']>;
/** What `oauth.authorizedClients.list()` answers, read off the adapter's own client. */
export type AuthorizedClientsList = Awaited<ReturnType<ShellClient['oauth']['authorizedClients']['list']>>;
export type AuthorizedClient = AuthorizedClientsList['clients'][number];

/** A key past its `expires_at` no longer authenticates, revoked or not. */
export function isExpired(row: ApiKeyRow, now: number): boolean {
  if (!row.expires_at) return false;
  const at = Date.parse(row.expires_at);
  return Number.isFinite(at) && at <= now;
}
