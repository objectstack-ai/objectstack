// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import {
  defineWorkspacePreference,
  versionedPreferenceCodec,
} from '../../utils/workspacePreference.js';

/**
 * The AI clients Connect an Agent has steps for, in the order its picker
 * offers them: international clients first, then the Chinese ones.
 */
export const CONNECT_CLIENT_IDS = [
  'claude',
  'codex',
  'cursor',
  'workbuddy',
  'doubao',
  'qwenwork',
] as const;

export type ConnectClientId = (typeof CONNECT_CLIENT_IDS)[number];

/** What a reader who never chose sees: the first client the picker offers. */
export const DEFAULT_CONNECT_CLIENT: ConnectClientId = 'claude';

export function isConnectClientId(value: unknown): value is ConnectClientId {
  return typeof value === 'string' && (CONNECT_CLIENT_IDS as readonly string[]).includes(value);
}

/**
 * Which client the reader connects with — the reader's own choice on this
 * browser, never metadata. One value across the console (`user` scope),
 * stored as `{"client":"CLIENT_ID","v":1}` under `os:pref:connect.client`.
 * A stored client the page no longer offers, or a record of another
 * version, is no choice and reads as {@link DEFAULT_CONNECT_CLIENT}.
 */
export const CONNECT_CLIENT_PREFERENCE = defineWorkspacePreference<ConnectClientId>({
  name: 'connect.client',
  codec: versionedPreferenceCodec<ConnectClientId>({
    version: 1,
    toRecord: (client) => ({ client }),
    fromRecord: (record) => (isConnectClientId(record.client) ? record.client : undefined),
  }),
});
