// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#22283] The `storage` settings namespace's "Limits" group, honoured.
 *
 * `service-settings`' storage manifest declares three keys an administrator
 * edits in Setup — `presigned_ttl`, `session_ttl` and `max_upload_mb` — and
 * until this module nothing read them: the form saved, the cascade answered,
 * and every upload door kept its constructor TTLs and no size limit at all.
 * This module is the one place the three keys are READ (`readStorageLimits`,
 * from a `getNamespace('storage')` payload) and the one place they are
 * RESOLVED against the host's own options (`resolveStorageLimits`), so the
 * plugin's mount and a host's `mountStorageRoutes` mount cannot answer the
 * same question two ways.
 *
 * ## Precedence — measured from this plugin's adapter keys, and followed
 *
 * Per key, highest first:
 *
 *  1. an AUTHORED value — an admin save or an env override (any `source`
 *     other than `'default'`);
 *  2. the HOST's option (`presignedTtl` / `sessionTtl` on the plugin's
 *     constructor, or on `mountStorageRoutes`);
 *  3. the cascade's DEFAULT (the manifest default, `source: 'default'`);
 *  4. the built-in default below — what a mount with no settings namespace
 *     bound (a bare kernel, `bindToSettings: false`) has always used.
 *
 * That is exactly how the adapter keys already behave: an authored save
 * rebuilds the adapter over the constructor's (`buildAdapterFromValues`), while
 * a manifest default never moves the constructor's store (#5536). A default
 * nobody chose does not override a host decision; a decision an admin made
 * does.
 *
 * `max_upload_mb` has no host option, so its layers are 1, 3 and 4 — and layer
 * 4 is NO limit. A mount bound to the settings namespace therefore enforces the
 * declared default (100 MB) when nothing is saved; a mount with no namespace
 * bound keeps accepting any size, as it always did.
 *
 * ## Read when used, never frozen
 *
 * Both are evaluated per request by the upload doors (`storage-routes.ts`), so
 * a save reaches the very next upload, presigned URL and upload session.
 * Sessions and URLs already issued keep the lifetime they were issued with —
 * their deadline is stamped at issue (`expires_at`, the token's `exp`, the S3
 * signature), never re-derived.
 */

/** One limit key as the `storage` settings cascade answered it. */
export interface StorageLimitReading {
  /** The effective value, in the key's own unit: seconds for the TTLs, MB (MiB) for the size. */
  value: number;
  /**
   * `true` when an admin save or an env override set it; `false` when the
   * cascade fell through to the manifest default (`source: 'default'`, or no
   * `source` at all — the conservative side, as for the adapter keys).
   */
  authored: boolean;
}

/**
 * The Limits group of the `storage` settings namespace, as last read. A key the
 * read did not yield (no settings namespace bound, or a value that is not a
 * positive number) is absent, and resolution falls through to the next layer.
 */
export interface StorageLimitsSnapshot {
  /** `storage.presigned_ttl` — seconds. */
  presignedTtl?: StorageLimitReading;
  /** `storage.session_ttl` — seconds. */
  sessionTtl?: StorageLimitReading;
  /** `storage.max_upload_mb` — MB, counted as MiB (1 MB = 1,048,576 bytes). */
  maxUploadMb?: StorageLimitReading;
}

/** The limits one request is served under. */
export interface ResolvedStorageLimits {
  /** Presigned upload URL lifetime, and the non-gated download URL's, in seconds. */
  presignedTtl: number;
  /** Chunked upload session lifetime, in seconds. */
  sessionTtl: number;
  /** Largest upload accepted, in bytes; `undefined` ⇒ no limit (no settings namespace bound). */
  maxUploadBytes: number | undefined;
}

/** The host-side layer: the options a mount was composed with. */
export interface StorageLimitHostOptions {
  presignedTtl?: number;
  sessionTtl?: number;
}

/** Built-in presigned URL TTL (seconds) — the manifest default carries the same number. */
export const DEFAULT_PRESIGNED_TTL = 3600;
/** Built-in upload session TTL (seconds) — the manifest default carries the same number. */
export const DEFAULT_SESSION_TTL = 86400;

/** Bytes in one MB of `max_upload_mb`. */
export const BYTES_PER_UPLOAD_MB = 1024 * 1024;

/** The three keys, their snapshot field, and the unit a warning names. */
const LIMIT_KEYS = [
  { key: 'presigned_ttl', field: 'presignedTtl', unit: 'seconds', whole: true },
  { key: 'session_ttl', field: 'sessionTtl', unit: 'seconds', whole: true },
  { key: 'max_upload_mb', field: 'maxUploadMb', unit: 'MB', whole: false },
] as const;

/**
 * A positive number from a settings value, or `undefined`.
 *
 * A numeric STRING is admitted because the settings service admits it: a
 * `number` specifier legitimately reads back as `'42'` after a form post, and
 * `service-settings` judges its declared bounds against that same reading
 * (`numericValue` in `settings-service.ts`). Nothing else is coerced.
 */
function positiveNumber(raw: unknown): number | undefined {
  let n: number;
  if (typeof raw === 'number') n = raw;
  else if (typeof raw === 'string' && raw.trim() !== '') n = Number(raw);
  else return undefined;
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

/**
 * Read the Limits group out of a `getNamespace('storage')` payload, already
 * split into `values` and `sources` the way `applySettings` splits it.
 *
 * A key whose value is absent (`undefined` / `null`) is simply not read. A key
 * whose value is present but is not a positive number is NOT honoured, and
 * `warn` says so once per read, naming the key, the value and the layer that
 * applies instead — it is never silently treated as "no value".
 */
export function readStorageLimits(
  values: Record<string, unknown>,
  sources: Record<string, string>,
  warn: (message: string) => void,
): StorageLimitsSnapshot {
  const snapshot: StorageLimitsSnapshot = {};
  for (const { key, field, unit, whole } of LIMIT_KEYS) {
    const raw = values[key];
    if (raw === undefined || raw === null) continue;
    const parsed = positiveNumber(raw);
    // A TTL is whole seconds: an S3 signature's `X-Amz-Expires` and the local
    // token's `exp` are both integers.
    const value = parsed !== undefined && whole ? Math.floor(parsed) || undefined : parsed;
    if (value === undefined) {
      warn(
        `StorageServicePlugin: the storage setting '${key}' holds ${JSON.stringify(raw)}, which is not a ` +
          `positive number of ${unit}, so it is NOT applied — the host's option, or else the built-in ` +
          `default, stands until a valid value is saved in the File Storage settings.`,
      );
      continue;
    }
    snapshot[field] = { value, authored: (sources[key] ?? 'default') !== 'default' };
  }
  return snapshot;
}

function pickTtl(reading: StorageLimitReading | undefined, host: number | undefined, builtIn: number): number {
  if (reading?.authored) return reading.value;
  if (host !== undefined) return host;
  if (reading) return reading.value;
  return builtIn;
}

/** Resolve the limits a request is served under — see the module header for the precedence. */
export function resolveStorageLimits(
  snapshot: StorageLimitsSnapshot | undefined,
  host: StorageLimitHostOptions = {},
): ResolvedStorageLimits {
  const maxMb = snapshot?.maxUploadMb?.value;
  return {
    presignedTtl: pickTtl(snapshot?.presignedTtl, host.presignedTtl, DEFAULT_PRESIGNED_TTL),
    sessionTtl: pickTtl(snapshot?.sessionTtl, host.sessionTtl, DEFAULT_SESSION_TTL),
    maxUploadBytes: maxMb === undefined ? undefined : Math.floor(maxMb * BYTES_PER_UPLOAD_MB),
  };
}

/** Whether two snapshots say the same thing — so a re-read that changed nothing logs nothing. */
export function sameStorageLimits(a: StorageLimitsSnapshot | undefined, b: StorageLimitsSnapshot | undefined): boolean {
  for (const { field } of LIMIT_KEYS) {
    const x = a?.[field];
    const y = b?.[field];
    if (x?.value !== y?.value || x?.authored !== y?.authored) return false;
  }
  return true;
}

/** One line naming what the snapshot says, for the plugin's boot / save log. */
export function describeStorageLimits(snapshot: StorageLimitsSnapshot): string {
  const part = (key: string, reading: StorageLimitReading | undefined, unit: string): string =>
    reading ? `${key}=${reading.value}${unit} (${reading.authored ? 'saved' : 'default'})` : `${key}=unset`;
  return [
    part('max_upload_mb', snapshot.maxUploadMb, 'MB'),
    part('presigned_ttl', snapshot.presignedTtl, 's'),
    part('session_ttl', snapshot.sessionTtl, 's'),
  ].join(', ');
}
