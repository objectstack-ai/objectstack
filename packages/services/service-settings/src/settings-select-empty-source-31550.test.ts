// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#31550] A select / radio / multiselect key whose registered option source
 * ANSWERED an empty list admits no value, at both doors: the save
 * (`validatePatch`) and the `OS_*` override (`effectiveEnvOverride`). The map
 * family has judged its keys this way since #31422; the select family kept its
 * own `allowed.length > 0` gate, so an empty answer admitted any value.
 *
 * Unchanged, and pinned as controls: a key with no source (or whose source
 * answered nothing, `undefined`) is judged against its declared `options`; a
 * key that declares none has nothing to enforce. During the boot hold
 * (`holdOptionSourceVerdicts`) a sourced verdict is taken in force and judged
 * again at the seal, so an empty list the boot is still filling refuses
 * nothing early.
 *
 * Riding along: an env override's refusal is said once per value, and the
 * value is keyed by a stable serialisation, so two DIFFERENT bad maps under one
 * `OS_*` variable are each said once (keyed by `String(value)`, every map was
 * `[object Object]`, and the second was silenced).
 */

import { describe, it, expect, vi } from 'vitest';
import type { SettingsManifest } from '@objectstack/spec/system';
import {
  lifecycleObjectKeySource,
  lifecycleSettingsManifest,
  type LifecycleKeyRegistryLike,
} from '@objectstack/objectql';
import { SettingsService } from './settings-service.js';

/** Synthetic: a sourced select, a multiselect, and an unsourced select with declared options. */
const pickLabManifest = {
  namespace: 'pick_lab',
  version: 1,
  label: 'Pick Lab',
  scope: 'global',
  readPermission: 'setup.access',
  writePermission: 'setup.write',
  specifiers: [
    { type: 'select', key: 'channel', label: 'Channel', required: false, default: 'none',
      options: [{ value: 'none', label: 'None' }, { value: 'email', label: 'Email' }] },
    { type: 'multiselect', key: 'regions', label: 'Regions', required: false,
      options: [{ value: 'eu', label: 'EU' }] },
    { type: 'select', key: 'tier', label: 'Tier', required: false, default: 'basic',
      options: [{ value: 'basic', label: 'Basic' }, { value: 'pro', label: 'Pro' }] },
  ],
} as unknown as SettingsManifest;

/** A source whose list the case sets; `undefined` = it could not answer. */
function listSource(state: { values: string[] | undefined }) {
  return () => {
    if (state.values === undefined) return undefined;
    const values = state.values;
    return { options: values.map((value) => ({ value, label: value })), admits: (v: string) => values.includes(v) };
  };
}

function service(env: Record<string, string>, state: { values: string[] | undefined }, opts: { hold?: boolean } = {}) {
  const error = vi.fn();
  const svc = new SettingsService({ env, logger: { warn: vi.fn(), error } as never });
  if (opts.hold) svc.holdOptionSourceVerdicts();
  svc.registerOptionSource('pick_lab', 'channel', listSource(state));
  svc.registerOptionSource('pick_lab', 'regions', listSource(state));
  svc.registerManifest(pickLabManifest);
  return { svc, error };
}

/** The `FieldError`s a refused save carries. */
async function refusal(p: Promise<unknown>): Promise<Array<Record<string, unknown>>> {
  const err: any = await p.then(() => undefined, (e) => e);
  expect(err, 'the save was accepted').toBeDefined();
  expect(err.code).toBe('SETTINGS_VALIDATION');
  return (err.errors ?? err.fields ?? err.details?.fields) as Array<Record<string, unknown>>;
}

describe('[#31550] a source that answered an empty list admits no value — the save door', () => {
  it('refuses a select value: invalid_option, nothing stored', async () => {
    const { svc } = service({}, { values: [] });

    const fields = await refusal(svc.setMany('pick_lab', { channel: 'email' }));

    expect(fields).toHaveLength(1);
    expect(fields[0]).toMatchObject({ field: 'channel', code: 'invalid_option' });
    expect(fields[0].message).toBe("Channel offers no value to choose from right now. Received 'email'.");
    expect((await svc.get('pick_lab', 'channel')).value).toBe('none');
  });

  it('refuses a multiselect value the same way', async () => {
    const { svc } = service({}, { values: [] });

    const fields = await refusal(svc.setMany('pick_lab', { regions: ['eu'] }));

    expect(fields[0]).toMatchObject({ field: 'regions', code: 'invalid_option' });
  });

  it('CONTROL: once the source answers the value, it saves', async () => {
    const state = { values: [] as string[] | undefined };
    const { svc } = service({}, state);
    state.values = ['none', 'email'];

    await svc.setMany('pick_lab', { channel: 'email' });

    expect((await svc.get('pick_lab', 'channel')).value).toBe('email');
  });

  it('CONTROL: a source that could not answer leaves the declared options, judged as ever', async () => {
    const { svc } = service({}, { values: undefined });

    await svc.setMany('pick_lab', { channel: 'email' });
    const fields = await refusal(svc.setMany('pick_lab', { channel: 'sms' }));

    expect((await svc.get('pick_lab', 'channel')).value).toBe('email');
    expect(fields[0]).toMatchObject({ field: 'channel', code: 'invalid_option', message: "Channel must be one of: none, email. Received 'sms'." });
  });

  it('CONTROL: an unsourced key is judged against its declared options', async () => {
    const { svc } = service({}, { values: [] });

    await svc.setMany('pick_lab', { tier: 'pro' });
    const fields = await refusal(svc.setMany('pick_lab', { tier: 'gold' }));

    expect(fields[0]).toMatchObject({ field: 'tier', code: 'invalid_option' });
  });
});

describe('[#31550] a source that answered an empty list admits no value — the env door', () => {
  it('an OS_* select override is not in force: one error line, the next layer reads', async () => {
    const { svc, error } = service({ OS_PICK_LAB_CHANNEL: 'email' }, { values: [] });

    const got = await svc.get('pick_lab', 'channel');
    await svc.get('pick_lab', 'channel');

    expect(got).toMatchObject({ value: 'none', source: 'default' });
    expect(error).toHaveBeenCalledTimes(1);
    expect(String(error.mock.calls[0][0])).toContain('OS_PICK_LAB_CHANNEL');
    expect(String(error.mock.calls[0][0])).toContain('IGNORED');
    expect(String(error.mock.calls[0][0])).toContain('Allowed values: none (the running system offers no value right now).');
  });

  it('CONTROL: while the boot holds the verdicts the override is in force; at the seal it is judged against the list as it then stands', async () => {
    const state = { values: [] as string[] | undefined };
    const held = service({ OS_PICK_LAB_CHANNEL: 'email' }, state, { hold: true });

    expect(await held.svc.get('pick_lab', 'channel')).toMatchObject({ value: 'email', source: 'env' });
    expect(held.error).not.toHaveBeenCalled();
    // The list fills before the seal: the override stays in force, nothing is said.
    state.values = ['none', 'email'];
    held.svc.sealOptionSources();
    expect(await held.svc.get('pick_lab', 'channel')).toMatchObject({ value: 'email', source: 'env' });
    expect(held.error).not.toHaveBeenCalled();

    // A list still empty at the seal: judged then, said once.
    const stillEmpty = service({ OS_PICK_LAB_CHANNEL: 'email' }, { values: [] }, { hold: true });
    expect((await stillEmpty.svc.get('pick_lab', 'channel')).source).toBe('env');
    stillEmpty.svc.sealOptionSources();
    expect((await stillEmpty.svc.get('pick_lab', 'channel')).source).toBe('default');
    expect(stillEmpty.error).toHaveBeenCalledTimes(1);
  });

  it('CONTROL: a source that could not answer leaves the declared options at the env door too', async () => {
    const { svc, error } = service({ OS_PICK_LAB_CHANNEL: 'email' }, { values: undefined });

    expect(await svc.get('pick_lab', 'channel')).toMatchObject({ value: 'email', source: 'env' });
    expect(error).not.toHaveBeenCalled();
  });
});

describe('[#31550] an env override refusal is said once per value, two different maps included', () => {
  const REGISTRY: LifecycleKeyRegistryLike = {
    getAllObjects: () => [{ name: 'sys_audit_log', label: 'Audit log', lifecycle: { class: 'audit' } }],
  };

  it('two different bad maps under one OS_* variable are each said once', async () => {
    const env: Record<string, string> = { OS_LIFECYCLE_QUOTAS: '{"sys_audit_logs": 1000}' };
    const error = vi.fn();
    const svc = new SettingsService({ env, logger: { warn: vi.fn(), error } as never });
    svc.registerOptionSource('lifecycle', 'quotas', lifecycleObjectKeySource(() => REGISTRY));
    svc.registerManifest(lifecycleSettingsManifest);

    await svc.get('lifecycle', 'quotas');
    await svc.get('lifecycle', 'quotas');
    expect(error).toHaveBeenCalledTimes(1);

    env.OS_LIFECYCLE_QUOTAS = '{"sys_job_runs": 1000}';
    await svc.get('lifecycle', 'quotas');
    await svc.get('lifecycle', 'quotas');
    expect(error).toHaveBeenCalledTimes(2);
    expect(String(error.mock.calls[1][0])).toContain("'sys_job_runs' is not a key this setting admits.");

    // The same map, its keys in another order, is the same value: not said again.
    env.OS_LIFECYCLE_QUOTAS = '{"sys_audit_logs": 1000, "sys_job_runs": 5}';
    await svc.get('lifecycle', 'quotas');
    env.OS_LIFECYCLE_QUOTAS = '{"sys_job_runs": 5, "sys_audit_logs": 1000}';
    await svc.get('lifecycle', 'quotas');
    expect(error).toHaveBeenCalledTimes(3);
  });
});
