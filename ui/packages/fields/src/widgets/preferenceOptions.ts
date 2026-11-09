/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The list the `notification-topic` / `notification-channel` faces offer: the
 * messaging service's preference options door,
 * `GET /api/v1/messaging/preference-options` (service-messaging
 * `preference-options-routes.ts`). It answers `{ topics, channels }`, each a
 * list of `{ value, wildcard, … }` with the `'*'` entry first; a channel also
 * says whether the deployment can send on it (`configured`).
 *
 * The read rides the host's AUTHENTICATED fetch, `SchemaRendererContext.apiFetch`,
 * and only that: a surface whose host supplies none offers no list, and the
 * face is the plain text box. One request per fetch function for the page
 * session, shared by every field that draws from it (a preference form holds a
 * topic and a channel); a failed read is not kept, so the next field that
 * mounts asks again.
 *
 * The list is a SUGGESTION, never a closed set: the server stores any value an
 * administrator types. So an answer that cannot be read as the door's shape is
 * a failure like any other, and the face falls back to the plain text box.
 */

import type { ApiFetch } from '@object-ui/react';
import type { RegistryItemHeader } from './registryCatalog.js';

/** The door the list is read from. */
export const PREFERENCE_OPTIONS_URL = '/api/v1/messaging/preference-options';

/** Which of the door's two lists a field offers. */
export type PreferenceList = 'topics' | 'channels';

/** One listed value: the value stored, and what the door says about it. */
export interface PreferenceOptionItem extends RegistryItemHeader {
  /** `true` on the `'*'` entry alone. */
  wildcard: boolean;
  /** `false` on a channel the deployment cannot send on right now; `true` otherwise. */
  configured: boolean;
}

export type PreferenceOptions = Record<PreferenceList, PreferenceOptionItem[]>;

function listOf(raw: unknown, list: PreferenceList): PreferenceOptionItem[] {
  if (!Array.isArray(raw)) throw new Error(`GET ${PREFERENCE_OPTIONS_URL} answered no ${list} list.`);
  const items: PreferenceOptionItem[] = [];
  for (const entry of raw) {
    const value = (entry as { value?: unknown } | null)?.value;
    if (typeof value !== 'string' || value === '') continue;
    const { wildcard, configured } = entry as { wildcard?: unknown; configured?: unknown };
    items.push({ name: value, wildcard: wildcard === true, configured: configured !== false });
  }
  return items;
}

async function readPreferenceOptions(doFetch: ApiFetch): Promise<PreferenceOptions> {
  const res = await doFetch(PREFERENCE_OPTIONS_URL, {
    headers: { accept: 'application/json' },
    credentials: 'include',
  });
  if (!res.ok) throw new Error(`GET ${PREFERENCE_OPTIONS_URL} answered ${res.status}.`);
  const body = (await res.json()) as { data?: { topics?: unknown; channels?: unknown } } | null;
  return { topics: listOf(body?.data?.topics, 'topics'), channels: listOf(body?.data?.channels, 'channels') };
}

const answers = new WeakMap<ApiFetch, Promise<PreferenceOptions>>();

/** Read the door's lists through `doFetch`, sharing the request with every other caller. */
export function loadPreferenceOptions(doFetch: ApiFetch): Promise<PreferenceOptions> {
  const existing = answers.get(doFetch);
  if (existing) return existing;
  const request = readPreferenceOptions(doFetch).catch((err: unknown) => {
    if (answers.get(doFetch) === request) answers.delete(doFetch);
    throw err;
  });
  answers.set(doFetch, request);
  return request;
}
