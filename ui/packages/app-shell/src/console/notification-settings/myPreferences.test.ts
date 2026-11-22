// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The Notification Settings page's read and writes (objectstack#34728): the
 * door's answer is read strictly, and each change becomes exactly one write of
 * the person's own row — an update of the row the door named, or a create in
 * their name — and a mandatory topic writes nothing.
 */

import { describe, expect, it, vi } from 'vitest';
import {
  cellWrite,
  digestChoices,
  quietHoursSaveable,
  quietHoursStored,
  QUIET_HOURS_OFF,
  generalWrite,
  loadMyPreferences,
  MY_PREFERENCES_URL,
  MyPreferencesReadError,
  parseMyPreferences,
  PREFERENCE_OBJECT,
  sendPreferenceWrite,
  type GeneralPreferences,
  type PreferenceTopic,
} from './myPreferences';

const ANSWER = {
  data: {
    topics: [
      { topic: '*', wildcard: true, mandatory: false, channels: [{ channel: 'email', enabled: true, source: 'builtin' }] },
      { topic: 'security.login', wildcard: false, mandatory: true, channels: [{ channel: 'email', enabled: true, source: 'mandatory' }] },
      {
        topic: 'task.assigned',
        wildcard: false,
        mandatory: false,
        channels: [{ channel: 'email', enabled: false, source: 'own', ownRowId: 'row-1' }],
      },
    ],
    channels: [{ channel: 'email', configured: true }, { channel: 'slack', configured: false }],
    general: {
      enabled: { value: true, source: 'builtin' },
      digest: { value: 'daily', source: 'default' },
      quietHours: { value: { tz: 'Asia/Shanghai', start: '22:00', end: '07:00' }, source: 'default' },
    },
  },
};

describe('parseMyPreferences', () => {
  it('reads the door answer as is', () => {
    const prefs = parseMyPreferences(ANSWER);
    expect(prefs.topics.map((t) => t.topic)).toEqual(['*', 'security.login', 'task.assigned']);
    expect(prefs.topics[2].channels[0]).toEqual({ channel: 'email', enabled: false, source: 'own', ownRowId: 'row-1' });
    expect(prefs.channels).toEqual([{ channel: 'email', configured: true }, { channel: 'slack', configured: false }]);
    expect(prefs.general.digest).toEqual({ value: 'daily', source: 'default' });
    expect(prefs.general.quietHours.value).toEqual({ tz: 'Asia/Shanghai', start: '22:00', end: '07:00' });
    expect(prefs.general.ownRowId).toBeUndefined();
  });

  it.each([
    ['no data', {}],
    ['a cell with an unknown source', { data: { ...ANSWER.data, topics: [{ topic: 'x', channels: [{ channel: 'email', enabled: true, source: 'guess' }] }] } }],
    ['a digest outside the set', { data: { ...ANSWER.data, general: { ...ANSWER.data.general, digest: { value: 'hourly', source: 'own' } } } }],
    ['a general setting marked mandatory', { data: { ...ANSWER.data, general: { ...ANSWER.data.general, enabled: { value: true, source: 'mandatory' } } } }],
  ])('refuses %s', (_what, body) => {
    expect(() => parseMyPreferences(body)).toThrow(MyPreferencesReadError);
  });
});

describe('loadMyPreferences', () => {
  it('reads the caller-scoped door through the given fetch', async () => {
    const doFetch = vi.fn(async () => new Response(JSON.stringify(ANSWER), { status: 200 }));
    await loadMyPreferences(doFetch);
    expect(doFetch).toHaveBeenCalledWith(MY_PREFERENCES_URL, expect.objectContaining({ credentials: 'include' }));
  });

  it('a refused read carries its status', async () => {
    const doFetch = vi.fn(async () => new Response('{}', { status: 401 }));
    await expect(loadMyPreferences(doFetch)).rejects.toMatchObject({ name: 'MyPreferencesReadError', status: 401 });
  });
});

describe('the writes', () => {
  const prefs = parseMyPreferences(ANSWER);
  const [wildcard, mandatory, own] = prefs.topics as [PreferenceTopic, PreferenceTopic, PreferenceTopic];

  it('a cell with the person’s own row updates that row only', () => {
    expect(cellWrite('alice', own, own.channels[0], true)).toEqual({ kind: 'update', id: 'row-1', data: { enabled: true } });
  });

  it('a cell without one creates the person’s own row for exactly (topic, channel)', () => {
    expect(cellWrite('alice', wildcard, wildcard.channels[0], false)).toEqual({
      kind: 'create',
      data: { user_id: 'alice', topic: '*', channel: 'email', enabled: false },
    });
  });

  it('a mandatory topic writes nothing', () => {
    expect(cellWrite('alice', mandatory, mandatory.channels[0], false)).toBeNull();
  });

  it('a general change without an own (*, *) row creates one that keeps the on/off in force', () => {
    const general: GeneralPreferences = { ...prefs.general, enabled: { value: false, source: 'default' } };
    expect(generalWrite('alice', general, { digest: 'weekly' })).toEqual({
      kind: 'create',
      data: { user_id: 'alice', topic: '*', channel: '*', enabled: false, digest: 'weekly' },
    });
  });

  it('a general change with an own (*, *) row updates only what was asked', () => {
    expect(generalWrite('alice', { ...prefs.general, ownRowId: 'row-g' }, { quiet_hours: { start: '23:00', end: '06:00' } })).toEqual({
      kind: 'update',
      id: 'row-g',
      data: { quiet_hours: { start: '23:00', end: '06:00' } },
    });
  });

  it('writes go to the preference object through the data door', async () => {
    const writer = { create: vi.fn(async () => ({})), update: vi.fn(async () => ({})) };
    await sendPreferenceWrite(writer, { kind: 'update', id: 'row-1', data: { enabled: true } });
    await sendPreferenceWrite(writer, { kind: 'create', data: { user_id: 'alice' } });
    expect(writer.update).toHaveBeenCalledWith(PREFERENCE_OBJECT, 'row-1', { enabled: true });
    expect(writer.create).toHaveBeenCalledWith(PREFERENCE_OBJECT, { user_id: 'alice' });
  });
});

// [objectstack ruling 7073270426 on #35123] Each of digest and quiet hours is
// three states; a value the person wrote decides, including the explicit off,
// and the field they do not change stays unset (preference-resolver.ts
// parseDigest / parseQuietHours). So every choice is offered and takes effect.
describe('every choice takes effect, the explicit off included', () => {
  const prefs = parseMyPreferences(ANSWER);

  it('"No digest" is offered while an organization digest is in force', () => {
    expect(prefs.general.digest).toEqual({ value: 'daily', source: 'default' });
    expect(digestChoices()).toEqual(['none', 'daily', 'weekly']);
  });

  it('choosing "No digest" writes the explicit none, and the new row leaves quiet hours unset', () => {
    expect(generalWrite('alice', prefs.general, { digest: 'none' })).toEqual({
      kind: 'create',
      data: { user_id: 'alice', topic: '*', channel: '*', enabled: prefs.general.enabled.value, digest: 'none' },
    });
  });

  it('a quiet-hours window is saveable when complete or cleared, never half-filled', () => {
    expect(quietHoursSaveable({ start: '22:00', end: '07:00' })).toBe(true);
    expect(quietHoursSaveable({ tz: 'UTC', start: '22:00', end: '07:00' })).toBe(true);
    expect(quietHoursSaveable(null)).toBe(true);
    expect(quietHoursSaveable(undefined)).toBe(false);
    expect(quietHoursSaveable({ start: '', end: '07:00' })).toBe(false);
  });

  it('a cleared window is stored as the explicit off { off: true }, never empty; a window as itself', () => {
    expect(QUIET_HOURS_OFF).toEqual({ off: true });
    expect(quietHoursStored(null)).toEqual({ off: true });
    expect(quietHoursStored({ start: '22:00', end: '07:00' })).toEqual({ start: '22:00', end: '07:00' });
    expect(generalWrite('alice', { ...prefs.general, ownRowId: 'row-g' }, { quiet_hours: quietHoursStored(null) })).toEqual({
      kind: 'update',
      id: 'row-g',
      data: { quiet_hours: { off: true } },
    });
  });
});
