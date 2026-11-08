// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#30208 row 5, ruling A] The three lifecycle maps are `map` specifiers, and
 * both settings doors judge their values by one shared judgement
 * (`map-shape.ts`).
 *
 * As `json` keys they passed both doors unchecked: a misspelt object, `"1e6"`
 * or `30 days` was stored, answered "saved", and the sweep silently ignored it.
 * Pinned here over the real `ObjectQL` engine, the real platform setting
 * objects and the real route, with the shipped `lifecycleSettingsManifest` and
 * the key sources `ObjectQLPlugin` registers (`lifecycleObjectKeySource` over a
 * registry of lifecycle-declared objects, `lifecycleClassKeySource`):
 *
 *  - the save door stores the shapes the sweep reads, unchanged;
 *  - it refuses a key the running system does not have, a cell that is not its
 *    column's form, a property no column declares, and JSON text, each with one
 *    `FieldError` that names the entry and the form expected;
 *  - the env door (`OS_LIFECYCLE_*`) judges an override the same way: one
 *    `error` line, and the key resolves from the next layer.
 */

import { describe, it, expect } from 'vitest';
import {
  lifecycleClassKeySource,
  lifecycleObjectKeySource,
  lifecycleSettingsManifest,
  type LifecycleKeyRegistryLike,
} from '@objectstack/objectql';
import { SettingsService } from './settings-service.js';
import { bootSettingsDoor } from './__tests__/settings-door.testkit.js';

/** The objects the sweep would walk, and one it would not (`record`). */
const REGISTRY: LifecycleKeyRegistryLike = {
  getAllObjects: () => [
    { name: 'sys_audit_log', label: 'Audit log', lifecycle: { class: 'audit' } },
    { name: 'sys_job_run', label: 'Job run', lifecycle: { class: 'telemetry' } },
    { name: 'account', label: 'Account', lifecycle: { class: 'record' } },
    { name: 'contact', label: 'Contact' },
  ],
};

/** As `ObjectQLPlugin` registers them: before the manifest. */
function registerKeySources(svc: SettingsService) {
  const objects = lifecycleObjectKeySource(() => REGISTRY);
  svc.registerOptionSource('lifecycle', 'retention_overrides', objects);
  svc.registerOptionSource('lifecycle', 'quotas', objects);
  svc.registerOptionSource('lifecycle', 'quota_defaults', lifecycleClassKeySource());
}

const boot = () => bootSettingsDoor(lifecycleSettingsManifest, { before: registerKeySources });

type Fields = Array<Record<string, unknown>>;

describe('[#30208] the shipped lifecycle maps', () => {
  it('declare the `map` type, with no list of keys in the manifest', () => {
    const maps = lifecycleSettingsManifest.specifiers.filter((s) => s.type === 'map');
    expect(maps.map((s) => s.key)).toEqual(['retention_overrides', 'quotas', 'quota_defaults']);
    for (const spec of maps) expect(spec.options).toBeUndefined();
  });

  it('serve their keys from the running system as the map options (the key picker list)', async () => {
    const { svc } = await boot();
    const page = await svc.getNamespace('lifecycle', { enforced: true, permissions: ['manage_platform_settings'] } as any);
    const optionsOf = (key: string) =>
      (page.manifest.specifiers.find((s) => s.key === key)?.options ?? []).map((o) => o.value);
    expect(optionsOf('quotas')).toEqual(['sys_audit_log', 'sys_job_run']);
    expect(optionsOf('retention_overrides')).toEqual(['sys_audit_log', 'sys_job_run']);
    expect(optionsOf('quota_defaults')).toEqual(['audit', 'telemetry', 'transient', 'event']);
  });
});

describe('[#30208] the save door judges a lifecycle map', () => {
  it('CONTROL: stores the shapes the sweep reads, unchanged', async () => {
    const { svc, save, stored } = await boot();

    const st = await save({
      retention_overrides: { sys_job_run: { maxAge: '1y', expireAfter: '30d' }, sys_audit_log: { maxAge: '7y' } },
      quotas: { sys_audit_log: 1_000_000 },
      quota_defaults: { telemetry: 500_000, event: 100_000 },
    });

    expect(st.status).toBe(200);
    // `retention_overrides` is tenant-scoped: read back through the resolver.
    expect((await svc.get('lifecycle', 'retention_overrides')).value).toEqual({
      sys_job_run: { maxAge: '1y', expireAfter: '30d' },
      sys_audit_log: { maxAge: '7y' },
    });
    expect(stored('quotas')?.value).toEqual({ sys_audit_log: 1_000_000 });
    expect(stored('quota_defaults')?.value).toEqual({ telemetry: 500_000, event: 100_000 });
  });

  it('refuses a misspelt object: invalid_option, naming the entry and the keys it admits; nothing stored', async () => {
    const { save, stored } = await boot();

    const st = await save({ quotas: { sys_audit_logs: 1000 } });

    expect(st.status).toBe(400);
    const fields = st.body.error.details.fields as Fields;
    expect(fields).toHaveLength(1);
    expect(fields[0]).toMatchObject({
      field: 'quotas',
      code: 'invalid_option',
      constraint: { type: 'map', entry: 'sys_audit_logs', allowed: 'sys_audit_log, sys_job_run' },
    });
    expect(fields[0].message).toBe(
      "Row quotas: 'sys_audit_logs' is not a key this setting admits. Allowed: sys_audit_log, sys_job_run.",
    );
    expect(stored('quotas')).toBeUndefined();
  });

  it('refuses an object the sweep never reads (a `record` object, an object with no lifecycle)', async () => {
    const { save } = await boot();

    const st = await save({ retention_overrides: { account: { maxAge: '1y' } }, quotas: { contact: 10 } });

    const fields = st.body.error.details.fields as Fields;
    expect(fields.map((f) => [f.field, f.code, (f.constraint as any).entry])).toEqual([
      ['retention_overrides', 'invalid_option', 'account'],
      ['quotas', 'invalid_option', 'contact'],
    ]);
  });

  it('refuses a lifecycle class that has no quota to default (`record`) and a misspelt one', async () => {
    const { save } = await boot();

    const recordClass = await save({ quota_defaults: { record: 10 } });
    const misspelt = await save({ quota_defaults: { telemtry: 10 } });

    // adr0112-ok: D6 — a field-addressed FieldErrorCode in a settings validation answer
    expect((recordClass.body.error.details.fields as Fields)[0]).toMatchObject({ code: 'invalid_option', constraint: { entry: 'record' } });
    expect((misspelt.body.error.details.fields as Fields)[0].message).toBe(
      "Per-class quota defaults: 'telemtry' is not a key this setting admits. Allowed: audit, telemetry, transient, event.",
    );
  });

  it('refuses a duration that is not h/d/w/y: invalid_shape, naming the entry, the column and the form', async () => {
    const { save, stored } = await boot();

    const st = await save({ retention_overrides: { sys_job_run: { maxAge: '30 days' } } });

    const fields = st.body.error.details.fields as Fields;
    expect(fields[0]).toMatchObject({
      field: 'retention_overrides',
      code: 'invalid_shape',
      constraint: { type: 'map', entry: 'sys_job_run', column: 'maxAge', kind: 'duration' },
    });
    expect(fields[0].message).toBe(
      "Retention overrides: 'sys_job_run'.maxAge must be a duration such as 7y " +
        '(a whole number followed by h, d, w or y), not a string of 7 characters.',
    );
    expect(stored('retention_overrides')).toBeUndefined();
  });

  it('refuses a quota that is not a whole number above 0: "1e6" as text, 0, a fraction', async () => {
    const { save } = await boot();

    const text = await save({ quotas: { sys_audit_log: '1e6' } });
    const zero = await save({ quotas: { sys_audit_log: 0 } });
    const fraction = await save({ quota_defaults: { audit: 2.5 } });

    expect((text.body.error.details.fields as Fields)[0].message).toBe(
      "Row quotas: 'sys_audit_log' must be a whole number greater than 0, such as 1000000, not a string of 3 characters.",
    );
    // adr0112-ok: D6 — a field-addressed FieldErrorCode in a settings validation answer
    expect((zero.body.error.details.fields as Fields)[0]).toMatchObject({ code: 'invalid_shape', constraint: { kind: 'positive_integer' } });
    expect((fraction.body.error.details.fields as Fields)[0].code).toBe('invalid_shape');
  });

  it('refuses a property no column declares (unknown_field), and an entry that names no column', async () => {
    const { save } = await boot();

    const typo = await save({ retention_overrides: { sys_job_run: { max_age: '1y' } } });
    const empty = await save({ retention_overrides: { sys_job_run: {} } });

    expect((typo.body.error.details.fields as Fields)[0]).toMatchObject({
      // adr0112-ok: D6 — a field-addressed FieldErrorCode in a settings validation answer
      code: 'unknown_field',
      constraint: { entry: 'sys_job_run', column: 'max_age' },
      message: "Retention overrides: 'sys_job_run' has a property 'max_age' this setting does not declare. Allowed: maxAge, expireAfter.",
    });
    // adr0112-ok: D6 — a field-addressed FieldErrorCode in a settings validation answer
    expect((empty.body.error.details.fields as Fields)[0]).toMatchObject({ code: 'invalid_shape', constraint: { entry: 'sys_job_run' } });
  });

  it('refuses JSON text of the map (the json-era console body): invalid_type', async () => {
    const { save } = await boot();

    const st = await save({ quotas: '{"sys_audit_log": 1000}' });

    expect((st.body.error.details.fields as Fields)[0]).toMatchObject({
      code: 'invalid_type',
      constraint: { type: 'map' },
      message: 'Row quotas must be an object of keyed rows, such as { "sys_audit_log": 1000000 }, ' +
        'not a string of 23 characters. Send the parsed value, not its JSON text.',
    });
  });

  it('accepts a clear (null): the key falls back to its default', async () => {
    const { svc, save } = await boot();
    await save({ quotas: { sys_audit_log: 1000 } });

    const st = await save({ quotas: null });

    expect(st.status).toBe(200);
    expect((await svc.get('lifecycle', 'quotas')).value).toEqual({});
  });

  it('a malformed value already stored does not block a save that does not touch it', async () => {
    const { svc, save, seed } = await boot();
    seed({ id: 'legacy', namespace: 'lifecycle', key: 'quotas', value: { sys_audit_logs: '1e6' } });

    const st = await save({ growth_alert_rows: 10 });

    expect(st.status).toBe(200);
    expect((await svc.get('lifecycle', 'growth_alert_rows')).value).toBe(10);
  });
});

describe('[#30208] the env door judges a lifecycle map the same way', () => {
  const envService = (env: Record<string, string>) => {
    const errors: string[] = [];
    const svc = new SettingsService({
      env,
      logger: { error: (m: string) => void errors.push(m), warn: () => {} } as any,
    });
    registerKeySources(svc);
    svc.registerManifest(lifecycleSettingsManifest);
    return { svc, errors };
  };

  it('CONTROL: JSON text of an admitted map is in force, as the object', async () => {
    const { svc, errors } = envService({
      OS_LIFECYCLE_RETENTION_OVERRIDES: '{"sys_job_run": {"maxAge": "90d"}}',
      OS_LIFECYCLE_QUOTA_DEFAULTS: '{"telemetry": 500000}',
    });

    const overrides = await svc.get('lifecycle', 'retention_overrides');
    const defaults = await svc.get('lifecycle', 'quota_defaults');

    expect(overrides.value).toEqual({ sys_job_run: { maxAge: '90d' } });
    expect(overrides.source).toBe('env');
    expect(defaults.value).toEqual({ telemetry: 500000 });
    expect(errors).toEqual([]);
  });

  it('a misspelt object is not in force: one error line naming the variable, the entry and the keys', async () => {
    const { svc, errors } = envService({ OS_LIFECYCLE_QUOTAS: '{"sys_audit_logs": 1000}' });

    const got = await svc.get('lifecycle', 'quotas');
    await svc.get('lifecycle', 'quotas');

    expect(got.value).toEqual({});
    expect(got.source).not.toBe('env');
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('OS_LIFECYCLE_QUOTAS');
    expect(errors[0]).toContain("is not the map of keyed rows its type 'map' declares");
    expect(errors[0]).toContain("'sys_audit_logs' is not a key this setting admits. Allowed: sys_audit_log, sys_job_run.");
    expect(errors[0]).toContain('The rejected value is an object of 1 entry; it is not printed.');
  });

  it('a bad duration is not in force, judged by the save door\'s sentence', async () => {
    const { svc, errors } = envService({ OS_LIFECYCLE_RETENTION_OVERRIDES: '{"sys_job_run": {"maxAge": "30 days"}}' });

    const got = await svc.get('lifecycle', 'retention_overrides');

    expect(got.source).not.toBe('env');
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("'sys_job_run'.maxAge must be a duration such as 7y");
  });

  it('text that does not parse is not in force', async () => {
    const { svc, errors } = envService({ OS_LIFECYCLE_QUOTAS: '{"sys_audit_log": 1000' });

    const got = await svc.get('lifecycle', 'quotas');

    expect(got.source).not.toBe('env');
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('must be an object of keyed rows');
  });
});
