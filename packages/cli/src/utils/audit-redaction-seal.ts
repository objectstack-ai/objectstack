// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

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

export interface RedactionSealRun {
  /** Composed into the boot beside the data-migration plugins. */
  readonly plugins: readonly unknown[];
  /** The rewrite's `seal`, once the boot is up. */
  seal(kernel: { getService(name: string): unknown }, engine: unknown): RedactionSeal;
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
    seal(kernel, engine) {
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
      const service = <T>(name: string): T | undefined => {
        try {
          return (kernel.getService(name) as T | undefined) ?? undefined;
        } catch {
          return undefined;
        }
      };
      return {
        engine: engine as RedactionSeal['engine'],
        ...(provider ? { crypto: provider } : {}),
        signer: service<RedactionSeal['signer']>(AUDIT_CHECKPOINT_SIGNER_SERVICE),
        sink: service<RedactionSeal['sink']>(AUDIT_CHECKPOINT_SINK_SERVICE),
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
