// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// check:test-source-alias: the util's reach names `@objectstack/service-settings` (through the mocked
// `one-shot-settings.js`); its load is paid here, at collection, never inside a clocked case.
import '@objectstack/service-settings';
import { ObjectKernel } from '@objectstack/core';
import { AUDIT_CHECKPOINT_SIGNER_SERVICE, AUDIT_CHECKPOINT_SINK_SERVICE } from '@objectstack/spec/contracts';
import { describe, expect, it, vi } from 'vitest';

// The crypto composition is not what this file judges: it is stubbed to "no
// crypto provider", which a run survives (the module doc of the util under test).
vi.mock('./one-shot-settings.js', () => ({
  oneShotCrypto: async () => {
    throw new Error('no host config in this test');
  },
}));

const { composeRedactionSeal } = await import('./audit-redaction-seal.js');

/**
 * #34519 — the `os migrate audit-*` redaction seal reads the host's
 * `audit.checkpointSigner` and `audit.checkpointSink` in three states, the
 * rule #34280 set for the sealer. Only an ABSENT signer leaves the run to the
 * local key (the amendment writer's default); one that is registered and
 * resolves is handed over, a factory included; one that is registered and
 * cannot be resolved rejects `seal()`, naming the slot. Each of the four
 * commands awaits `seal()` inside the try whose catch prints the error and
 * exits 1 (`audit-redaction-seal.contract.test.ts` pins the await), so that
 * rejection fails the command before any row is amended or rewritten.
 */

/**
 * A real kernel's service registry, with no plugins booted: what `seal()`
 * reads off the boot is the registry alone (`getServiceAsync`, `getService`).
 */
function kernelWith(register: (kernel: ObjectKernel) => void = () => {}): ObjectKernel {
  const kernel = new ObjectKernel({ logger: { level: 'silent' } });
  register(kernel);
  return kernel;
}

const hostSigner = {
  async sign() {
    return { keyId: 'host-key', signature: 'c2ln' };
  },
  async trustedPublicKey() {
    return null;
  },
};

describe('the redaction seal resolves the host signer and sink in three states (#34519)', () => {
  it('no host signer or sink registered: neither is handed over, so the run amends under the local key', async () => {
    const seal = await (await composeRedactionSeal()).seal(kernelWith(), {});
    expect(seal.signer).toBeUndefined();
    expect(seal.sink).toBeUndefined();
  });

  it('a registered host signer whose resolution throws: seal() rejects, naming the slot and the fallback it refuses', async () => {
    const kernel = kernelWith((k) =>
      k.registerServiceFactory(AUDIT_CHECKPOINT_SIGNER_SERVICE, () => {
        throw new Error('KMS client cannot start: credential missing');
      }),
    );
    const run = await composeRedactionSeal();
    await expect(run.seal(kernel, {})).rejects.toThrow(
      `Audit redaction seal: the '${AUDIT_CHECKPOINT_SIGNER_SERVICE}' service is registered but could not be resolved ` +
        '(KMS client cannot start: credential missing)',
    );
    await expect(run.seal(kernel, {})).rejects.toThrow('the run does not sign with the local key');
  });

  it('a registered sink whose resolution throws: seal() rejects, naming the slot', async () => {
    const kernel = kernelWith((k) =>
      k.registerServiceFactory(AUDIT_CHECKPOINT_SINK_SERVICE, () => {
        throw new Error('SIEM client cannot start');
      }),
    );
    await expect((await composeRedactionSeal()).seal(kernel, {})).rejects.toThrow(
      `the '${AUDIT_CHECKPOINT_SINK_SERVICE}' service is registered but could not be resolved (SIEM client cannot start)`,
    );
  });

  it('a registered host signer that resolves is handed over — as an instance, and as a factory', async () => {
    for (const how of ['instance', 'factory'] as const) {
      const kernel = kernelWith((k) => {
        if (how === 'instance') k.registerService(AUDIT_CHECKPOINT_SIGNER_SERVICE, hostSigner);
        else k.registerServiceFactory(AUDIT_CHECKPOINT_SIGNER_SERVICE, () => hostSigner);
      });
      const seal = await (await composeRedactionSeal()).seal(kernel, {});
      expect(seal.signer, how).toBe(hostSigner);
    }
  });
});
