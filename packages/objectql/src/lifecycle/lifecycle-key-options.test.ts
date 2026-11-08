// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#30208 row 5, ruling A] The key columns of the three lifecycle `map`
 * settings are served from the running system, never listed in the manifest:
 *
 *  - `retention_overrides` and `quotas` admit the objects the sweep walks
 *    (a lifecycle class other than `record`), read at the moment of asking;
 *  - `quota_defaults` admits the lifecycle classes the sweep reads a default
 *    for (`LifecycleClassSchema` without `record`);
 *  - `ObjectQLPlugin` registers the three sources with the settings service
 *    BEFORE the manifest, booted through a real `ObjectKernel`.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { ObjectKernel, type PluginContext } from '@objectstack/core';
import { ObjectQLPlugin } from '../plugin.js';
import type { ObjectQL } from '../engine.js';
import {
  lifecycleClassKeySource,
  lifecycleObjectKeySource,
  type LifecycleKeyRegistryLike,
  type LifecycleKeySource,
} from './lifecycle-key-options.js';

describe('lifecycleObjectKeySource', () => {
  const objects: ReturnType<LifecycleKeyRegistryLike['getAllObjects']> = [
    { name: 'sys_job_run', label: 'Job run', lifecycle: { class: 'telemetry' } },
    { name: 'sys_audit_log', lifecycle: { class: 'audit' } },
    { name: 'account', label: 'Account', lifecycle: { class: 'record' } },
    { name: 'contact', label: 'Contact' },
  ];

  it('admits exactly the objects the sweep walks, sorted, named by their label', () => {
    const answer = lifecycleObjectKeySource(() => ({ getAllObjects: () => objects }))()!;
    expect(answer.options).toEqual([
      { value: 'sys_audit_log', label: 'sys_audit_log' },
      { value: 'sys_job_run', label: 'Job run' },
    ]);
    expect(answer.admits('sys_job_run')).toBe(true);
    expect(answer.admits('account')).toBe(false);
    expect(answer.admits('contact')).toBe(false);
    expect(answer.admits('sys_job_runs')).toBe(false);
  });

  it('reads the storage objects when the registry has them, as the sweep does', () => {
    const answer = lifecycleObjectKeySource(() => ({
      getAllObjects: () => [],
      getAllStorageObjects: () => [{ name: 'sys_session', lifecycle: { class: 'transient' } }],
    }))()!;
    expect(answer.options.map((o) => o.value)).toEqual(['sys_session']);
  });

  it('is asked at the moment of use: an object registered later is admitted from then on', () => {
    const live = [...objects];
    const source = lifecycleObjectKeySource(() => ({ getAllObjects: () => live }));
    expect(source()!.admits('sys_webhook_delivery')).toBe(false);
    live.push({ name: 'sys_webhook_delivery', lifecycle: { class: 'event' } });
    expect(source()!.admits('sys_webhook_delivery')).toBe(true);
  });

  it('answers nothing while no registry is reachable (the declared table, none, then stands)', () => {
    expect(lifecycleObjectKeySource(() => undefined)()).toBeUndefined();
  });
});

describe('lifecycleClassKeySource', () => {
  it('admits the lifecycle classes a quota default is read for — every class but `record`', () => {
    const answer = lifecycleClassKeySource()()!;
    expect(answer.options.map((o) => o.value)).toEqual(['audit', 'telemetry', 'transient', 'event']);
    expect(answer.admits('record')).toBe(false);
    expect(answer.admits('telemtry')).toBe(false);
  });
});

describe('ObjectQLPlugin registers the three key sources before the lifecycle manifest', () => {
  const kernels: ObjectKernel[] = [];
  afterEach(async () => {
    while (kernels.length) {
      const kernel = kernels.pop()!;
      try { if (kernel.getState() === 'running') await kernel.shutdown(); } catch { /* noop */ }
    }
  });

  it('at kernel:ready, against the engine registry', async () => {
    const calls: string[] = [];
    const sources = new Map<string, LifecycleKeySource>();
    const settings = {
      registerOptionSource(namespace: string, key: string, source: LifecycleKeySource) {
        calls.push(`source ${namespace}.${key}`);
        sources.set(key, source);
      },
      registerManifest(manifest: { namespace: string }) { calls.push(`manifest ${manifest.namespace}`); },
    };
    const kernel = new ObjectKernel({ logger: { level: 'silent' }, gracefulShutdown: false });
    kernels.push(kernel);
    await kernel.use(new ObjectQLPlugin());
    await kernel.use({
      name: 'test.settings-and-objects',
      dependencies: ['com.objectstack.engine.objectql'],
      init: async (ctx: PluginContext) => {
        ctx.registerService('settings', settings);
        const ql = ctx.getService<ObjectQL>('objectql');
        ql.registerDriver({
          name: 'primary', version: '0.0.0', supports: {},
          async connect() {}, async disconnect() {}, async checkHealth() { return true; },
          async find() { return []; }, async findOne() { return null; }, async count() { return 0; },
        } as any, true);
        await ctx.getService<{ register(a: unknown): Promise<void> | void }>('manifest').register({
          id: 'com.test.lifecycle-keys',
          name: 'com.test.lifecycle-keys',
          version: '1.0.0',
          objects: [{
            name: 'test_ping',
            fields: { note: { name: 'note', type: 'text' } },
            lifecycle: { class: 'telemetry', retention: { maxAge: '30d' } },
          }],
        });
      },
    } as any);
    await kernel.bootstrap();

    expect(calls).toEqual([
      'source lifecycle.retention_overrides',
      'source lifecycle.quotas',
      'source lifecycle.quota_defaults',
      'manifest lifecycle',
    ]);
    expect(sources.get('quotas')!()!.admits('test_ping')).toBe(true);
    expect(sources.get('retention_overrides')!()!.admits('test_ping')).toBe(true);
    expect(sources.get('quota_defaults')!()!.admits('telemetry')).toBe(true);
  });
});
