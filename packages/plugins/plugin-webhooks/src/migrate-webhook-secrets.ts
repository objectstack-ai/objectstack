// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#7799] One-shot boot sweep that moves already-persisted cleartext signing
 * secrets out of `sys_webhook.definition_json` and into the encrypted
 * `signing_secret` column.
 *
 * ## Why a sweep and not just the seeder
 * `bootstrapDeclaredWebhooks` re-seeds package-declared rows on every boot, so
 * those heal themselves the moment the new mapping lands. The rows that do NOT
 * heal are exactly the ones most likely to hold a real production key:
 *
 *  - `managed_by: 'admin'` — authored in Setup, never touched by the seeder;
 *  - `customized: true` — a package row an admin edited, deliberately frozen
 *    against re-seeding (seed-not-clobber, #3461 / #2909).
 *
 * Leaving those behind would make this a half-migration: the code path that
 * created the exposure would be fixed while the exposed values stayed in the
 * table. So the sweep is keyed off the DATA (does this blob contain a secret?),
 * not off provenance.
 *
 * ## What it is careful about
 *  - **System context.** The provenance hook exempts `isSystem` writes, so
 *    migrating a package row does not stamp `customized: true` and freeze it
 *    against future seeding.
 *  - **Idempotent.** A row whose blob no longer carries a `secret` is skipped,
 *    so the sweep is free on every boot after the first.
 *  - **Fail-closed, per row.** With no CryptoProvider the encrypted write throws
 *    and the row is LEFT AS IT WAS — still exposed, but intact and still
 *    signing. It is reported with an ADR-0112 `code`/`status` pair so an
 *    operator can see exactly which rows are still cleartext and why, rather
 *    than the sweep quietly reporting success.
 *  - **Never widens the blast radius.** The cleartext is only removed from
 *    `definition_json` in the SAME update that stores the encrypted copy; a
 *    failure cannot land the strip without the store.
 */

import type { IDataEngine } from '@objectstack/spec/contracts';
import type { EngineQueryOptions } from '@objectstack/spec/data';
import {
  WEBHOOK_OBJECT,
  WEBHOOK_SECRET_FIELD,
  WEBHOOK_SECRET_REFUSAL_CODE,
  WEBHOOK_SECRET_REFUSAL_STATUS,
  isSecretProtectionFailure,
  readLegacySecret,
  stripSecretFromDefinition,
} from './webhook-secret.js';

/** System write context — a boot reconciler is not an admin authoring action. */
const SYSTEM_CTX = { isSystem: true, positions: [], permissions: [] } as const;

/** The read side of the same context, typed so `tsc` still checks the keys. */
const SYSTEM_QUERY: EngineQueryOptions = {
  context: { isSystem: true, positions: [], permissions: [] },
};

interface Logger {
  info?: (msg: string, meta?: unknown) => void;
  warn?: (msg: string, meta?: unknown) => void;
}

export interface MigrateWebhookSecretsResult {
  /** Rows whose blob carried a cleartext secret. */
  found: number;
  /** Rows now holding an encrypted secret and a secret-free blob. */
  migrated: number;
  /** Rows still holding cleartext because the encrypted write was refused. */
  failed: number;
}

/**
 * Move every cleartext `definition_json.secret` into the encrypted column.
 * Safe to run on every boot; returns counts for the caller to log.
 */
export async function migrateLegacyWebhookSecrets(
  engine: IDataEngine,
  logger?: Logger,
  subscriptionsObject: string = WEBHOOK_OBJECT,
): Promise<MigrateWebhookSecretsResult> {
  const out: MigrateWebhookSecretsResult = { found: 0, migrated: 0, failed: 0 };

  let rows: any[];
  try {
    const found = await engine.find(subscriptionsObject, SYSTEM_QUERY);
    rows = Array.isArray(found) ? found : ((found as any)?.data ?? []);
  } catch (err: any) {
    logger?.warn?.('[webhook] legacy secret sweep skipped — could not read subscriptions', {
      object: subscriptionsObject,
      error: err?.message ?? String(err),
    });
    return out;
  }

  for (const row of rows) {
    const legacy = readLegacySecret(row?.definition_json);
    if (!legacy || !row?.id) continue;
    out.found += 1;

    try {
      await engine.update(
        subscriptionsObject,
        {
          id: row.id,
          [WEBHOOK_SECRET_FIELD]: legacy,
          definition_json: stripSecretFromDefinition(row.definition_json as string),
        },
        { context: SYSTEM_CTX } as any,
      );
      out.migrated += 1;
    } catch (err: any) {
      out.failed += 1;
      const protection = isSecretProtectionFailure(err);
      logger?.warn?.(
        protection
          ? '[webhook] signing secret STILL CLEARTEXT in definition_json — no CryptoProvider to encrypt it (#7799)'
          : '[webhook] signing secret migration failed — row left unchanged (#7799)',
        {
          name: row.name ?? row.id,
          id: row.id,
          code: WEBHOOK_SECRET_REFUSAL_CODE,
          status: WEBHOOK_SECRET_REFUSAL_STATUS,
          error: err?.message ?? String(err),
        },
      );
    }
  }

  if (out.found > 0) {
    logger?.info?.('[webhook] legacy cleartext signing secrets swept into sys_secret', { ...out });
  }
  return out;
}
