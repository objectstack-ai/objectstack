// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.
//
// ADR-0087 P0 — the protocol handshake at the install seam. `installPackage`
// refuses a package whose declared `engines.protocol` excludes this runtime's
// protocol major BEFORE writing it to the registry, with a structured
// diagnostic — instead of letting the mismatch surface later as a deep crash.

import { describe, it, expect, vi } from 'vitest';
import { ProtocolIncompatibleError } from '@objectstack/metadata-core';
import { PROTOCOL_MAJOR } from '@objectstack/spec/kernel';
import { ObjectStackProtocolImplementation } from './index.js';

function makeImpl() {
  const registryCalls: Array<{ manifest: any }> = [];
  const engine = {
    registry: {
      installPackage: (manifest: any) => {
        registryCalls.push({ manifest });
        return { manifest, status: 'installed', enabled: true };
      },
    },
    find: async () => [],
  };
  const publish = vi.fn(async () => ({ success: true }));
  const services = new Map<string, any>([['package', { publish }]]);
  const impl = new ObjectStackProtocolImplementation(engine as any, () => services);
  return { impl, registryCalls, publish };
}

const OLD = `^${PROTOCOL_MAJOR - 1}`; // a major this runtime no longer accepts
const CURRENT = `^${PROTOCOL_MAJOR}`;

describe('installPackage — protocol handshake (ADR-0087 P0)', () => {
  it('rejects an incompatible package before it reaches the registry', async () => {
    const { impl, registryCalls, publish } = makeImpl();
    await expect(
      (impl as any).installPackage({
        manifest: { id: 'com.acme.crm', version: '1.0.0', engines: { protocol: OLD } },
      }),
    ).rejects.toBeInstanceOf(ProtocolIncompatibleError);
    // The refusal happens BEFORE any registry write or durable persist.
    expect(registryCalls).toHaveLength(0);
    expect(publish).not.toHaveBeenCalled();
  });

  it('the thrown diagnostic is structured and names the migrate command', async () => {
    const { impl } = makeImpl();
    try {
      await (impl as any).installPackage({
        manifest: { id: 'com.acme.crm', version: '1.0.0', engines: { protocol: OLD } },
      });
      throw new Error('expected installPackage to throw');
    } catch (e) {
      expect(e).toBeInstanceOf(ProtocolIncompatibleError);
      const d = (e as ProtocolIncompatibleError).diagnostic;
      expect(d.code).toBe('OS_PROTOCOL_INCOMPATIBLE');
      expect(d.packageId).toBe('com.acme.crm');
      expect(d.migrateCommand).toBe(`objectstack migrate meta --from ${PROTOCOL_MAJOR - 1}`);
      expect(d.runtimeMajor).toBe(PROTOCOL_MAJOR);
    }
  });

  it('installs a package that declares a compatible range', async () => {
    const { impl, registryCalls } = makeImpl();
    const res: any = await (impl as any).installPackage({
      manifest: { id: 'com.acme.ok', version: '1.0.0', engines: { protocol: CURRENT } },
    });
    expect(registryCalls).toHaveLength(1);
    expect(res.package.status).toBe('installed');
  });

  it('grandfathers a package with no declared range (warns, does not reject)', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const { impl, registryCalls } = makeImpl();
      const res: any = await (impl as any).installPackage({
        manifest: { id: 'com.acme.legacy', version: '1.0.0' },
      });
      expect(registryCalls).toHaveLength(1);
      expect(res.package.status).toBe('installed');
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('no engines.protocol range'));
    } finally {
      warn.mockRestore();
    }
  });
});
