// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { isServiceNotRegisteredError } from '@objectstack/core';
import type { KeyMaterialMigrationOptions } from '@objectstack/plugin-audit';
import { AUDIT_CHECKPOINT_SIGNER_SERVICE, AUDIT_CHECKPOINT_SINK_SERVICE } from '@objectstack/spec/contracts';
import { oneShotCrypto, type OneShotCrypto } from './one-shot-settings.js';

/**
 * [ADR-0154 D7] What an `os migrate audit-*` ledger-copy rewrite composes so a
 * sealed row is amended before it is rewritten: the crypto provider `os serve`
 * seals with ({@link oneShotCrypto}), which opens each checkpoint's seed and
 * the signing key, and the host's checkpoint signer and sink when its boot
 * registers them.
 *
 * Composing it never stops a run. When the crypto composition refuses (two
 * declared providers, a host config that cannot be read) or no data key
 * exists, the run goes on with no crypto provider: a row no checkpoint seals
 * is rewritten as before, and a sealed row is refused — left as it is and
 * counted, the run exiting non-zero ({@link RedactionSealRun.refusedLine}).
 * ⛔ Never a key of this run's own: a run that cannot open the deployment's
 * seals writes no amendment.
 */

/** The `seal` option the three rewrites take. */
export type RedactionSeal = NonNullable<KeyMaterialMigrationOptions['seal']>;

/** The boot's kernel, as far as {@link RedactionSealRun.seal} reads it. */
export interface RedactionSealKernel {
  getService(name: string): unknown;
  getServiceAsync?(name: string): Promise<unknown>;
}

export interface RedactionSealRun {
  /** Composed into the boot beside the data-migration plugins. */
  readonly plugins: readonly unknown[];
  /**
   * The rewrite's `seal`, once the boot is up. Rejects when the host registers
   * a checkpoint signer or sink that cannot be resolved (#34519): only an
   * ABSENT signer leaves the run to the local key.
   */
  seal(kernel: RedactionSealKernel, engine: unknown): Promise<RedactionSeal>;
  /** The line a run that refused `refused` sealed rows ends with: why, and the fix. */
  refusedLine(refused: number): string;
}

export async function composeRedactionSeal(): Promise<RedactionSealRun> {
  let crypto: OneShotCrypto | null = null;
  let unavailable: string | null = null;
  try {
    crypto = await oneShotCrypto();
  } catch (error) {
    unavailable = error instanceof Error ? error.message : String(error);
  }
  return {
    plugins: crypto?.plugins ?? [],
    async seal(kernel, engine) {
      let provider: RedactionSeal['crypto'];
      if (crypto) {
        try {
          // The provider the boot chose, confirmed as `os serve` confirms it.
          crypto.provider.confirm();
          if (crypto.key?.unavailable) unavailable = crypto.key.unavailable;
          else provider = crypto.provider;
        } catch (error) {
          unavailable = error instanceof Error ? error.message : String(error);
        }
      }
      return {
        engine: engine as RedactionSeal['engine'],
        ...(provider ? { crypto: provider } : {}),
        signer: await hostSeam<RedactionSeal['signer']>(kernel, AUDIT_CHECKPOINT_SIGNER_SERVICE, 'sign with the local key'),
        sink: await hostSeam<RedactionSeal['sink']>(kernel, AUDIT_CHECKPOINT_SINK_SERVICE, 'amend without the off-host export'),
      };
    },
    refusedLine(refused) {
      return (
        `${refused} sealed row(s) were NOT rewritten: a checkpoint seals each, and its redaction amendment could not be ` +
        'written (ADR-0154 D7), so each is left as it is' +
        (unavailable ? ` — this run has no crypto provider: ${unavailable}` : '') +
        '. Re-run where the crypto provider `os serve` seals with is available; a row that no longer matches its ' +
        'checkpoint is reported by `os audit verify`.'
      );
    },
  };
}

/**
 * #34519: a host seam the redaction seal reads (`audit.checkpointSigner`,
 * `audit.checkpointSink`), in three states — the rule the sealer follows
 * (#34280). Never registered ⇒ `undefined`, and the run keeps its stand-in
 * (the local signer, no export). Registered and resolved ⇒ the service.
 * Registered and NOT resolvable — a factory that throws, a KMS client that
 * cannot start — ⇒ the run stops with an error naming the slot, instead of
 * amending sealed rows under the local key where the host chose its own.
 *
 * The kernel's async accessor tells the first and third apart with the
 * branded "never registered" rejection (`isServiceNotRegisteredError`), ⛔ not
 * message text, and builds a factory-registered seam the sync accessor
 * refuses. A kernel with no async accessor has no factories, so "not
 * registered" is the only fault its sync accessor reports.
 */
async function hostSeam<T>(kernel: RedactionSealKernel, slot: string, fallback: string): Promise<T | undefined> {
  if (typeof kernel.getServiceAsync === 'function') {
    try {
      return ((await kernel.getServiceAsync(slot)) as T | undefined) ?? undefined;
    } catch (error) {
      if (isServiceNotRegisteredError(error)) return undefined;
      const fault = error instanceof Error ? error.message : String(error);
      throw new Error(
        `Audit redaction seal: the '${slot}' service is registered but could not be resolved (${fault}) — no sealed row is amended or ` +
          `rewritten; the run does not ${fallback} in place of a service the host registered. Fix the registration of ` +
          'the service named here, then run again.',
        { cause: error },
      );
    }
  }
  try {
    return (kernel.getService(slot) as T | undefined) ?? undefined;
  } catch {
    return undefined;
  }
}
