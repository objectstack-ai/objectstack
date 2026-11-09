// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#30237, ADR-0148 D3] The recycle bin's retention, in days.
 *
 * Three sources, read in order, the first that answers wins:
 *
 *   1. the host's retention resolver ({@link RecycleBinRetentionSettings}),
 *      called with the token the host handed over at boot;
 *   2. `OS_RECYCLE_BIN_RETENTION_DAYS`;
 *   3. `RECYCLE_BIN_DEFAULT_RETENTION_DAYS` (30).
 *
 * The engine asks once per delete operation and stamps the answer on the entry
 * as its purge deadline, so a later change of the answer never shortens a
 * window a person was already shown. The sweep reads only the stamped deadline
 * and asks no resolver.
 *
 * A value that is not a positive whole number of days is a configuration
 * defect, refused with the spec's own sentence (`recycleBinRetentionRefusal`):
 * never read as "purge now" or "keep forever", and never replaced by the
 * default. The refusal reaches the caller of the delete, before the delete
 * writes anything, so a misconfigured host loses no snapshot quietly.
 */

import {
  RECYCLE_BIN_DEFAULT_RETENTION_DAYS,
  RECYCLE_BIN_RETENTION_DAYS_ENV,
  RecycleBinRetentionDaysEnvSchema,
  RecycleBinRetentionDaysSchema,
  recycleBinRetentionRefusal,
  type RecycleBinRetentionResolver,
} from '@objectstack/spec/data';

/**
 * What the host hands the engine at boot (`ObjectQLPluginOptions.recycleBinRetention`).
 *
 * One kernel serves one environment, so the token is fixed for the engine's
 * life: it is the same opaque token the host's `resolveFeatures` receives, and
 * the engine never interprets it. No token is `undefined`, which ADR-0148 D3
 * allows.
 */
export interface RecycleBinRetentionSettings {
  /** The host retention resolver (ADR-0148 D3). Absent: the variable, else the default. */
  readonly resolve?: RecycleBinRetentionResolver;
  /** The opaque token the resolver is called with. */
  readonly token?: string;
}

/** The environment the variable is read from; `process.env` unless a test hands its own. */
export type RecycleBinRetentionEnv = Readonly<Record<string, string | undefined>>;

function processEnv(): RecycleBinRetentionEnv {
  return typeof process !== 'undefined' && process.env ? process.env : {};
}

/**
 * `OS_RECYCLE_BIN_RETENTION_DAYS`, read: `undefined` when it is unset or empty
 * (the default holds), the number of days when it holds a positive whole
 * number, and a thrown `Error` carrying the refusal text otherwise.
 *
 * The plugin calls this once at boot, so an operator who set the variable
 * wrong learns it when the kernel starts rather than on the first delete.
 */
export function readRecycleBinRetentionEnv(env: RecycleBinRetentionEnv = processEnv()): number | undefined {
  const raw = env[RECYCLE_BIN_RETENTION_DAYS_ENV];
  if (raw === undefined || raw === '') return undefined;
  const parsed = RecycleBinRetentionDaysEnvSchema.safeParse(raw);
  if (!parsed.success) throw new Error(recycleBinRetentionRefusal('env', raw));
  return Number(parsed.data);
}

/**
 * The retention in days for one delete operation: the resolver's answer, else
 * the variable, else the default. Throws on a defect in either source.
 */
export function resolveRecycleBinRetentionDays(
  settings: RecycleBinRetentionSettings | undefined,
  env: RecycleBinRetentionEnv = processEnv(),
): number {
  const resolve = settings?.resolve;
  if (typeof resolve === 'function') {
    const answer: unknown = resolve(settings?.token);
    if (answer !== undefined) {
      const parsed = RecycleBinRetentionDaysSchema.safeParse(answer);
      if (!parsed.success) throw new Error(recycleBinRetentionRefusal('resolver', answer));
      return parsed.data;
    }
  }
  return readRecycleBinRetentionEnv(env) ?? RECYCLE_BIN_DEFAULT_RETENTION_DAYS;
}

/** One day, in milliseconds: retention is whole days, the deadline is exact. */
const DAY_MS = 86_400_000;

/** `deleted_at` plus `days`, as the ISO 8601 deadline the entry stores in `purge_after`. */
export function recycleBinPurgeAfter(deletedAt: Date, days: number): string {
  return new Date(deletedAt.getTime() + days * DAY_MS).toISOString();
}
