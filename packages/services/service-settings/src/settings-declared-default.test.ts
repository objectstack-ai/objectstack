// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * A deployment's declared default (`registerDeclaredDefault`, ADR-0007
 * §Resolution rung 4 as amended): what a key takes in the running system while
 * nothing is stored answers the bottom rung of the cascade in place of the
 * manifest `default`, still `source: 'default'`.
 *
 * Pinned: the read (`get`, `getNamespace`, the cascade chain); a stored value
 * and an `OS_*` override still win; a clear returns to it; a write predicate
 * sees it as the value in force (so a save of the manifest default is a
 * change); `undefined` and a throwing provider leave the manifest default
 * (the latter said once); a namespace with no provider is unchanged (CONTROL);
 * registration refuses an unknown namespace or key.
 */

import { describe, expect, it, vi } from 'vitest';
import type { SettingsManifest } from '@objectstack/spec/system';
import { SettingsService } from './settings-service.js';
import { UnknownKeyError, UnknownNamespaceError } from './settings-service.types.js';

const manifest = (namespace: string): SettingsManifest => ({
  namespace,
  label: namespace,
  scope: 'global',
  specifiers: [
    { type: 'toggle', key: 'feature_on', label: 'Feature', default: true },
    { type: 'number', key: 'limit', label: 'Limit', default: 5 },
    // No manifest default: its OS_* type comes from the declaration alone.
    { type: 'toggle', key: 'bare', label: 'Bare' },
    { type: 'text', key: 'extra', label: 'Extra', required: true, visible: '${data.feature_on !== false}' },
  ],
} as unknown as SettingsManifest);

function rig(env: Record<string, string> = {}) {
  const logger = { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() };
  const svc = new SettingsService({ env, logger } as any);
  svc.registerManifest(manifest('demo'));
  svc.registerManifest(manifest('plain'));
  return { svc, logger };
}

describe('SettingsService declared default', () => {
  it('answers the bottom rung while nothing is stored, as source default', async () => {
    const { svc } = rig();
    let declared: unknown = false;
    svc.registerDeclaredDefault('demo', 'feature_on', () => declared);
    expect(await svc.get('demo', 'feature_on')).toMatchObject({ value: false, source: 'default', locked: false });
    const page = await svc.getNamespace('demo');
    expect(page.values.feature_on).toMatchObject({ value: false, source: 'default' });
    expect(page.values.feature_on.cascadeChain).toEqual([{ scope: 'default', value: false, effective: true }]);
    // Asked on each read, never recorded.
    declared = true;
    expect(await svc.get('demo', 'feature_on')).toMatchObject({ value: true, source: 'default' });
  });

  it('CONTROL: a key or namespace with no provider reads the manifest default', async () => {
    const { svc } = rig();
    svc.registerDeclaredDefault('demo', 'feature_on', () => false);
    expect(await svc.get('demo', 'limit')).toMatchObject({ value: 5, source: 'default' });
    expect(await svc.get('plain', 'feature_on')).toMatchObject({ value: true, source: 'default' });
  });

  it('a stored value still wins, and a clear returns to the declaration', async () => {
    const { svc } = rig();
    svc.registerDeclaredDefault('demo', 'feature_on', () => false);
    await svc.setMany('demo', { feature_on: true });
    expect(await svc.get('demo', 'feature_on')).toMatchObject({ value: true, source: 'global' });
    await svc.setMany('demo', { feature_on: null });
    expect(await svc.get('demo', 'feature_on')).toMatchObject({ value: false, source: 'default' });
  });

  it('an OS_* override still wins', async () => {
    const { svc } = rig({ OS_DEMO_FEATURE_ON: 'true' });
    svc.registerDeclaredDefault('demo', 'feature_on', () => false);
    expect(await svc.get('demo', 'feature_on')).toMatchObject({ value: true, source: 'env', locked: true });
  });

  it('a write predicate sees the declaration as the value in force', async () => {
    const { svc } = rig();
    svc.registerDeclaredDefault('demo', 'feature_on', () => false);
    const predicate = vi.fn(() => undefined);
    svc.registerWritePredicate('demo', 'feature_on', predicate);
    // The manifest default is a change from the declaration: the predicate is asked.
    await svc.setMany('demo', { feature_on: true });
    expect(predicate).toHaveBeenCalledTimes(1);
    expect((predicate.mock.calls[0] as unknown[])[0]).toMatchObject({ current: false, next: true });

    // Re-saving the declaration is no change.
    const { svc: other } = rig();
    other.registerDeclaredDefault('demo', 'feature_on', () => false);
    const quiet = vi.fn(() => undefined);
    other.registerWritePredicate('demo', 'feature_on', quiet);
    await other.setMany('demo', { feature_on: false });
    expect(quiet).not.toHaveBeenCalled();
  });

  it('undefined leaves the manifest default; a throwing provider does too, said once', async () => {
    const { svc, logger } = rig();
    svc.registerDeclaredDefault('demo', 'limit', () => undefined);
    expect(await svc.get('demo', 'limit')).toMatchObject({ value: 5, source: 'default' });

    svc.registerDeclaredDefault('demo', 'feature_on', () => {
      throw new Error('manager gone');
    });
    expect(await svc.get('demo', 'feature_on')).toMatchObject({ value: true, source: 'default' });
    await svc.get('demo', 'feature_on');
    const said = logger.warn.mock.calls.map((c) => String(c[0])).filter((m) => m.includes("'demo.feature_on'"));
    expect(said).toHaveLength(1);
    expect(said[0]).toContain('manager gone');
  });

  it('a provider that answers a promise is a fault: the manifest default answers, said once', async () => {
    const { svc, logger } = rig();
    svc.registerDeclaredDefault('demo', 'feature_on', () => Promise.resolve(false));
    expect(await svc.get('demo', 'feature_on')).toMatchObject({ value: true, source: 'default' });
    expect(logger.warn.mock.calls.map((c) => String(c[0])).filter((m) => m.includes('promise'))).toHaveLength(1);
  });

  it('a clear in a patch takes the declaration for the patch\'s visibility map', async () => {
    // Declared off: clearing feature_on hides `extra`, so its `required` is not judged.
    const { svc } = rig();
    svc.registerDeclaredDefault('demo', 'feature_on', () => false);
    await svc.setMany('demo', { feature_on: true, extra: 'x' });
    await expect(svc.setMany('demo', { feature_on: null, extra: '' })).resolves.toBeDefined();
    // CONTROL: no provider, the clear falls back to the manifest default (on), so `extra` is required.
    const { svc: plain } = rig();
    await plain.setMany('demo', { feature_on: false });
    await expect(plain.setMany('demo', { feature_on: null, extra: '' })).rejects.toMatchObject({
      code: 'SETTINGS_VALIDATION',
      fields: [expect.objectContaining({ field: 'extra', code: 'required' })],
    });
  });

  it('an OS_* value is read as the type of the declaration where the manifest declares no default', async () => {
    const { svc } = rig({ OS_DEMO_BARE: 'yes' });
    expect(await svc.get('demo', 'bare')).toMatchObject({ value: 'yes', source: 'env' });
    svc.registerDeclaredDefault('demo', 'bare', () => false);
    expect(await svc.get('demo', 'bare')).toMatchObject({ value: true, source: 'env' });
  });

  it('registration refuses an unknown namespace or key', () => {
    const { svc } = rig();
    expect(() => svc.registerDeclaredDefault('nope', 'feature_on', () => false)).toThrow(UnknownNamespaceError);
    expect(() => svc.registerDeclaredDefault('demo', 'nope', () => false)).toThrow(UnknownKeyError);
  });
});
