// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, expect, it } from 'vitest';
import { AuditPlugin } from '@objectstack/plugin-audit';
import { handHostCryptoToAppAuditPlugin } from './app-audit-plugin-host-crypto.js';

/**
 * [ADR-0154 D2, D6; seat ruling 6884540128 item 3] `os serve` hands its one
 * crypto provider to an AuditPlugin the app put in its stack `plugins`: only
 * to an instance of the real class, only when the app composed it with none.
 */
describe('os serve hands its crypto provider to an app-supplied AuditPlugin', () => {
  const host = () => ({ label: 'host' }) as never;

  it('hands it to a real AuditPlugin composed with no provider', () => {
    const plugin = new AuditPlugin({ readAudit: { objects: [] } });
    expect(handHostCryptoToAppAuditPlugin(plugin, AuditPlugin, host, true)).toBe(true);
    expect((plugin as unknown as { hostCryptoProvider: unknown }).hostCryptoProvider).toBe(host);
  });

  it('never overrides a provider the app composed it with', () => {
    const own = { label: 'own' } as never;
    const plugin = new AuditPlugin({ cryptoProvider: own });
    expect(handHostCryptoToAppAuditPlugin(plugin, AuditPlugin, host, true)).toBe(false);
    expect((plugin as unknown as { hostCryptoProvider: unknown }).hostCryptoProvider).toBeUndefined();
  });

  it('never feeds a same-named lookalike, whatever it answers to', () => {
    const calls: unknown[] = [];
    const lookalike = { name: 'com.objectstack.audit', adoptHostCryptoProvider: (...args: unknown[]) => (calls.push(args), true) };
    expect(handHostCryptoToAppAuditPlugin(lookalike, AuditPlugin, host, true)).toBe(false);
    expect(calls).toEqual([]);
  });

  it('feeds nothing when the class could not be loaded, and never throws', () => {
    expect(handHostCryptoToAppAuditPlugin(new AuditPlugin(), undefined, host, true)).toBe(false);
    expect(handHostCryptoToAppAuditPlugin(undefined, AuditPlugin, host, true)).toBe(false);
  });

  it("keeps the sealer off on a one-shot boot (`armSealer: false`)", () => {
    const plugin = new AuditPlugin();
    expect(handHostCryptoToAppAuditPlugin(plugin, AuditPlugin, host, false)).toBe(true);
    expect((plugin as unknown as { hostDisarmsSealer: boolean }).hostDisarmsSealer).toBe(true);
  });
});
