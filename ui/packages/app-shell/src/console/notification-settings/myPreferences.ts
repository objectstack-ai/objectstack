// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The Notification Settings page's two halves, kept apart from the page so
 * each is testable alone (objectstack rulings 6968686390 and 6969143776):
 *
 *  - the READ: the messaging service's caller-scoped door,
 *    `GET /api/v1/messaging/me/preferences`, which answers the signed-in
 *    person's EFFECTIVE preferences — computed on the server by the same
 *    resolver `emit` filters with — so the page draws, and never recomputes,
 *    what is actually sent;
 *  - the WRITES: the person's own `sys_notification_preference` rows, through
 *    the data door, as them. A change to a cell writes the row for exactly that
 *    `(user_id = self, topic, channel)`: an update when the door named the
 *    person's own row (`ownRowId`), a create otherwise. The server's own-row
 *    policy refuses anything else.
 *
 * There is no "reset to the organization's default": that needs a delete,
 * which the member grant does not carry (ruled out of this page).
 */

/** The door the page reads. */
export const MY_PREFERENCES_URL = '/api/v1/messaging/me/preferences';

/** The object the page writes, through the data door. */
export const PREFERENCE_OBJECT = 'sys_notification_preference';

/** The wildcard both `topic` and `channel` store for "all". */
export const PREFERENCE_WILDCARD = '*';

/** Where an effective answer comes from. */
export type PreferenceSource = 'own' | 'default' | 'builtin' | 'mandatory';

export interface PreferenceCell {
  channel: string;
  enabled: boolean;
  source: PreferenceSource;
  /** The person's own row for exactly this (topic, channel). */
  ownRowId?: string;
}

export interface PreferenceTopic {
  topic: string;
  wildcard: boolean;
  mandatory: boolean;
  channels: PreferenceCell[];
}

export interface PreferenceChannel {
  channel: string;
  configured: boolean;
}

export interface QuietHoursWindow {
  tz?: string;
  start: string;
  end: string;
}

export type DigestCadence = 'none' | 'daily' | 'weekly';

export interface Setting<T> {
  value: T;
  source: Exclude<PreferenceSource, 'mandatory'>;
}

export interface GeneralPreferences {
  /** The person's own `(*, *)` row, where digest and quiet hours are written. */
  ownRowId?: string;
  enabled: Setting<boolean>;
  digest: Setting<DigestCadence>;
  quietHours: Setting<QuietHoursWindow | null>;
}

export interface MyPreferences {
  topics: PreferenceTopic[];
  channels: PreferenceChannel[];
  general: GeneralPreferences;
}

/** A failed read or an answer that is not the door's shape. */
export class MyPreferencesReadError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = 'MyPreferencesReadError';
  }
}

type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

const SOURCES: readonly PreferenceSource[] = ['own', 'default', 'builtin', 'mandatory'];
const isSource = (v: unknown): v is PreferenceSource => typeof v === 'string' && (SOURCES as readonly string[]).includes(v);
const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

function shapeError(what: string): MyPreferencesReadError {
  return new MyPreferencesReadError(`GET ${MY_PREFERENCES_URL} answered no readable ${what}.`);
}

function readCell(raw: unknown): PreferenceCell {
  if (!isObject(raw) || typeof raw.channel !== 'string' || typeof raw.enabled !== 'boolean' || !isSource(raw.source)) {
    throw shapeError('cell');
  }
  return {
    channel: raw.channel,
    enabled: raw.enabled,
    source: raw.source,
    ...(typeof raw.ownRowId === 'string' ? { ownRowId: raw.ownRowId } : {}),
  };
}

function readSetting<T>(raw: unknown, read: (v: unknown) => T | undefined, what: string): Setting<T> {
  if (!isObject(raw) || !isSource(raw.source) || raw.source === 'mandatory') throw shapeError(what);
  const value = read(raw.value);
  if (value === undefined) throw shapeError(what);
  return { value, source: raw.source };
}

const readDigest = (v: unknown): DigestCadence | undefined => (v === 'none' || v === 'daily' || v === 'weekly' ? v : undefined);
const readQuietHours = (v: unknown): QuietHoursWindow | null | undefined => {
  if (v === null) return null;
  if (!isObject(v) || typeof v.start !== 'string' || typeof v.end !== 'string') return undefined;
  return typeof v.tz === 'string' ? { tz: v.tz, start: v.start, end: v.end } : { start: v.start, end: v.end };
};

/** Read the shape the door answers, refusing anything else. */
export function parseMyPreferences(body: unknown): MyPreferences {
  const data = isObject(body) ? body.data : undefined;
  if (!isObject(data) || !Array.isArray(data.topics) || !Array.isArray(data.channels) || !isObject(data.general)) {
    throw shapeError('preferences');
  }
  const channels = data.channels.map((raw): PreferenceChannel => {
    if (!isObject(raw) || typeof raw.channel !== 'string') throw shapeError('channel');
    return { channel: raw.channel, configured: raw.configured === true };
  });
  const topics = data.topics.map((raw): PreferenceTopic => {
    if (!isObject(raw) || typeof raw.topic !== 'string' || !Array.isArray(raw.channels)) throw shapeError('topic');
    return {
      topic: raw.topic,
      wildcard: raw.wildcard === true,
      mandatory: raw.mandatory === true,
      channels: raw.channels.map(readCell),
    };
  });
  const g = data.general;
  return {
    topics,
    channels,
    general: {
      ...(typeof g.ownRowId === 'string' ? { ownRowId: g.ownRowId } : {}),
      enabled: readSetting(g.enabled, (v) => (typeof v === 'boolean' ? v : undefined), 'general on/off'),
      digest: readSetting(g.digest, readDigest, 'digest'),
      quietHours: readSetting(g.quietHours, readQuietHours, 'quiet hours'),
    },
  };
}

/** Read the signed-in person's effective preferences through `doFetch` (the host's authenticated fetch). */
export async function loadMyPreferences(doFetch: Fetch): Promise<MyPreferences> {
  const res = await doFetch(MY_PREFERENCES_URL, { headers: { accept: 'application/json' }, credentials: 'include' });
  if (!res.ok) throw new MyPreferencesReadError(`GET ${MY_PREFERENCES_URL} answered ${res.status}.`, res.status);
  return parseMyPreferences(await res.json());
}

/** One write the page sends through the data door. */
export type PreferenceWrite =
  | { kind: 'update'; id: string; data: Record<string, unknown> }
  | { kind: 'create'; data: Record<string, unknown> };

/**
 * The write that turns one cell on or off: the person's own row for exactly
 * `(topic, channel)` — updated when they have one, created in their name
 * otherwise. A mandatory topic writes nothing: no row changes it.
 */
export function cellWrite(userId: string, topic: PreferenceTopic, cell: PreferenceCell, enabled: boolean): PreferenceWrite | null {
  if (topic.mandatory) return null;
  if (cell.ownRowId) return { kind: 'update', id: cell.ownRowId, data: { enabled } };
  return { kind: 'create', data: { user_id: userId, topic: topic.topic, channel: cell.channel, enabled } };
}

/**
 * What a stored value on the person's own row does, measured against the
 * resolver (`preference-resolver.ts`, `parseDigest` / `parseQuietHours`):
 *
 *  - `digest` takes effect only as `'daily'` or `'weekly'`. A stored `'none'`
 *    (the field's default), an empty value or any other value is read as "no
 *    opinion", and the lookup falls through to the next row — the
 *    organization's default when there is one.
 *  - `quiet_hours` takes effect only as a window with both a `start` and an
 *    `end`. An empty value falls through the same way.
 *
 * So saving `'none'` or an empty window never turns off a digest or quiet
 * hours that is in force: it only lets the next row decide, and the door
 * cannot say what that row holds. The page therefore offers only the values
 * that override — the two cadences and a complete window — and the writes
 * below accept nothing else.
 */
export type OverridingDigest = Exclude<DigestCadence, 'none'>;

/** The digest choices that take effect when saved: the two cadences, plus `none` only while nothing is in force (it is then the current value, and saving it changes nothing). */
export function digestChoices(general: GeneralPreferences): DigestCadence[] {
  return general.digest.value === 'none' ? ['none', 'daily', 'weekly'] : ['daily', 'weekly'];
}

/** True when `draft` is a quiet-hours window that takes effect when saved: a complete window, never an empty one. */
export function quietHoursSaveable(draft: QuietHoursWindow | null | undefined): draft is QuietHoursWindow {
  return !!draft && typeof draft.start === 'string' && draft.start !== '' && typeof draft.end === 'string' && draft.end !== '';
}

/**
 * The write that changes the person's digest or quiet hours: their own
 * `(*, *)` row. Created when they have none, with `enabled` set to what is in
 * force at that level now, so the new row changes only what was asked. Only
 * values that override are accepted (see {@link OverridingDigest}).
 *
 * ⚠️ A person's `(*, *)` row comes before the organization's rows in the
 * lookup, so once it exists it decides every cell neither a more specific row
 * of theirs nor a mandatory topic decides. The page says so beside the
 * control, and re-reads the door after each write, so what it draws is
 * what is in force.
 */
export function generalWrite(
  userId: string,
  general: GeneralPreferences,
  patch: { digest?: OverridingDigest; quiet_hours?: QuietHoursWindow },
): PreferenceWrite {
  if (general.ownRowId) return { kind: 'update', id: general.ownRowId, data: { ...patch } };
  return {
    kind: 'create',
    data: { user_id: userId, topic: PREFERENCE_WILDCARD, channel: PREFERENCE_WILDCARD, enabled: general.enabled.value, ...patch },
  };
}

/** The data door the writes go through (the console's adapter). */
export interface PreferenceWriter {
  create(resource: string, data: Record<string, unknown>): Promise<unknown>;
  update(resource: string, id: string, data: Record<string, unknown>): Promise<unknown>;
}

/** Send one write through the data door. */
export async function sendPreferenceWrite(writer: PreferenceWriter, write: PreferenceWrite): Promise<void> {
  if (write.kind === 'update') await writer.update(PREFERENCE_OBJECT, write.id, write.data);
  else await writer.create(PREFERENCE_OBJECT, write.data);
}
