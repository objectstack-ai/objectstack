// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#31241] A `json` setting persists a JSON object or array (ADR-0007:
 * `json` | code editor | object), at both doors.
 *
 * The console's `json` field sent the textarea's TEXT, and the save door
 * stored it: `PUT /api/settings/lifecycle` with `{ quotas: "{ … }" }` answered
 * 200 and `sys_platform_setting.value` held a string, so the lifecycle sweep
 * read every quota as absent. Pinned here over the real `ObjectQL` engine, the
 * real platform setting objects and the real route. Since #30208 moved the
 * three lifecycle maps to the `map` type (judged in
 * `settings-map-shape-30208.test.ts`), no shipped manifest declares a `json`
 * key, so a raw-config manifest stands in for the next one that does:
 *
 *  - the save door refuses a string — and any other non-object — for a `json`
 *    key with one `invalid_type` `FieldError`, and stores nothing;
 *  - an object, an array and a clear (`null`) are accepted;
 *  - a string already stored under one `json` key does not block a save that
 *    does not touch it (the door judges only what it is handed);
 *  - the env door (`OS_LIFECYCLE_*`) rejects text that does not parse to an
 *    object or array, with one `error` line, and the key resolves from the next
 *    layer; JSON text of an object is in force.
 */

import { describe, it, expect } from 'vitest';
import type { SettingsManifest } from '@objectstack/spec/system';
import { SettingsService } from './settings-service.js';
import { bootSettingsDoor } from './__tests__/settings-door.testkit.js';

/** A raw-config namespace: three `json` keys and a number, global scope. */
const RAW_MANIFEST = {
  namespace: 'raw_config',
  label: 'Raw config',
  scope: 'global',
  readPermission: 'manage_platform_settings',
  writePermission: 'manage_platform_settings',
  specifiers: [
    { type: 'json', key: 'routes', label: 'Routes', default: {} },
    { type: 'json', key: 'payload', label: 'Payload', default: {} },
    { type: 'json', key: 'extra', label: 'Extra', default: {} },
    { type: 'number', key: 'count', label: 'Count', default: 0 },
  ],
} as unknown as SettingsManifest;

const boot = () => bootSettingsDoor(RAW_MANIFEST);

describe('[#31241] the save door: a `json` key takes a JSON object or array', () => {
  it('refuses the JSON text the old console sent: 400, one invalid_type FieldError per key, nothing stored', async () => {
    const { save, stored } = await boot();

    const st = await save({
      payload: '{\n  "sys_audit_log": 1000\n}',
      extra: '{\n  "telemetry": 500\n}',
    });

    expect(st.status).toBe(400);
    expect(st.body.error.code).toBe('SETTINGS_VALIDATION');
    const fields = st.body.error.details.fields as Array<Record<string, unknown>>;
    expect(fields.map((f) => [f.field, f.code])).toEqual([
      ['payload', 'invalid_type'],
      ['extra', 'invalid_type'],
    ]);
    expect(fields[0].constraint).toEqual({ type: 'json' });
    expect(fields[0].message).toBe(
      'Payload must be a JSON object or array, not a string of 27 characters. Send the parsed value, not its JSON text.',
    );
    // The message names what to send, never the value.
    expect(JSON.stringify(fields)).not.toContain('sys_audit_log');
    expect(stored('payload')).toBeUndefined();
    expect(stored('extra')).toBeUndefined();
  });

  it('refuses every other non-object: a number, a boolean, a blank string', async () => {
    const { save, stored } = await boot();

    const st = await save({ payload: 5, extra: true, routes: '' });

    expect(st.status).toBe(400);
    const fields = st.body.error.details.fields as Array<Record<string, unknown>>;
    expect(fields.map((f) => [f.field, f.code])).toEqual([
      ['routes', 'invalid_type'],
      ['payload', 'invalid_type'],
      ['extra', 'invalid_type'],
    ]);
    expect(stored('payload')).toBeUndefined();
  });

  it('CONTROL: stores an object and an array as themselves', async () => {
    const { svc, save, stored } = await boot();

    const st = await save({ payload: { sys_audit_log: 1000 }, extra: [] });

    expect(st.status).toBe(200);
    expect(stored('payload')?.value).toEqual({ sys_audit_log: 1000 });
    expect(stored('extra')?.value).toEqual([]);
    const got = await svc.get('raw_config', 'payload');
    expect(got.value).toEqual({ sys_audit_log: 1000 });
    expect(got.source).toBe('global');
  });

  it('accepts a clear (null): the key falls back to its default', async () => {
    const { svc, save } = await boot();
    await save({ payload: { sys_audit_log: 1000 } });

    const st = await save({ payload: null });

    expect(st.status).toBe(200);
    expect((await svc.get('raw_config', 'payload')).value).toEqual({});
  });

  it('a string already stored under one json key does not block a save that does not touch it', async () => {
    const { svc, save, seed } = await boot();
    seed({ id: 'legacy', namespace: 'raw_config', key: 'extra', value: '{"telemetry": 500}' });

    const st = await save({ count: 10 });

    expect(st.status).toBe(200);
    expect((await svc.get('raw_config', 'count')).value).toBe(10);
  });
});

describe('[#31241] the env door judges a `json` key the same way', () => {
  const envService = (value: string) => {
    const errors: string[] = [];
    const svc = new SettingsService({
      env: { OS_RAW_CONFIG_PAYLOAD: value },
      logger: { error: (m: string) => void errors.push(m), warn: () => {} } as any,
    });
    svc.registerManifest(RAW_MANIFEST);
    return { svc, errors };
  };

  it('CONTROL: JSON text of an object is in force, as the object', async () => {
    const { svc, errors } = envService('{"sys_audit_log": 1000}');

    const got = await svc.get('raw_config', 'payload');

    expect(got.value).toEqual({ sys_audit_log: 1000 });
    expect(got.source).toBe('env');
    expect(errors).toEqual([]);
  });

  it('text that does not parse is not in force: the key resolves from the next layer, with one error line', async () => {
    const { svc, errors } = envService('{"sys_audit_log": 1000');

    const got = await svc.get('raw_config', 'payload');
    await svc.get('raw_config', 'payload');

    expect(got.value).toEqual({});
    expect(got.source).not.toBe('env');
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('OS_RAW_CONFIG_PAYLOAD');
    expect(errors[0]).toContain("is not a JSON object or array, which its type 'json' declares");
    expect(errors[0]).toContain('a string of 22 characters');
    expect(errors[0]).not.toContain('sys_audit_log');
  });

  it('text that parses to a scalar is not in force either', async () => {
    const { svc, errors } = envService('5');

    const got = await svc.get('raw_config', 'payload');

    expect(got.value).toEqual({});
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('a number');
  });
});
