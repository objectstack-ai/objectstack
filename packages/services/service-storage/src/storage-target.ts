// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// ---------------------------------------------------------------------------
// What a resolved storage configuration points at (#4096).
//
// `StorageServicePlugin` binds to the `storage` settings namespace so an admin
// can change adapters without a restart. On every boot it reads that namespace
// and, if ANY value is persisted, rebuilt the adapter and swapped it in
// unconditionally — and the swap callback warns that "existing files were NOT
// migrated and may be unreachable". Once the settings service has persisted its
// defaults, that is every clean boot, so a healthy dev server printed
//
//   WARN StorageServicePlugin: storage adapter swapped
//        (LocalStorageAdapter → LocalStorageAdapter). Existing files were NOT
//        migrated and may be unreachable through the new adapter.
//
// every time, about a swap from an adapter to an identically-configured one. The
// warning is worth keeping — Local → S3 really does strand every existing file —
// but crying wolf on every boot is how an operator learns to skim past it, and
// since #4012 it lands in the boot-diagnostics block where the real warnings are.
//
// So the decision needs two distinct questions, which the plugin can only answer
// by comparing the CONFIGURATIONS it resolved (both adapters keep their identity
// in private fields):
//
//   1. Is a swap needed at all?  — did anything the adapter is built from change?
//   2. Should it warn?           — did the BACKING STORE change, i.e. would
//                                  existing bytes stop being reachable?
//
// A credential rotation answers yes/no: swap so the new key takes effect, but the
// bucket still holds the same objects, so nothing is stranded.
// ---------------------------------------------------------------------------

import { normalize } from 'node:path';

/** A resolved storage configuration, reduced to what swap decisions need. */
export interface StorageTarget {
  kind: 'local' | 's3';
  /**
   * Where the bytes live. A change here strands whatever the old target held —
   * this is what the migration warning is actually about. Safe to log.
   */
  location: string;
  /**
   * Everything the adapter is constructed from, including credentials, so an
   * unchanged configuration can be recognised and skipped.
   *
   * NEVER log this: it embeds the S3 secret. It exists only to be compared.
   */
  fingerprint: string;
}

/** The fields a storage target is derived from, normalised across both sources. */
export interface StorageTargetInput {
  kind?: string;
  /** Local adapter root directory (constructor `local.rootDir` / setting `local_root`). */
  rootDir?: string;
  /** URL prefix the adapter signs against — not a storage location. */
  basePath?: string;
  bucket?: string;
  region?: string;
  endpoint?: string;
  forcePathStyle?: boolean;
  accessKeyId?: string;
  secretAccessKey?: string;
}

/** `LocalStorageAdapter`'s default root, mirrored so both sources normalise alike. */
export const DEFAULT_LOCAL_ROOT = './storage';

/** `StorageServicePlugin`'s default URL prefix. */
export const DEFAULT_BASE_PATH = '/api/v1/storage';

/**
 * Reduce a resolved storage configuration to its {@link StorageTarget}.
 *
 * Unset values are normalised to the same defaults the adapters apply, so a
 * configuration that merely spells out a default does not read as a change —
 * which is exactly the #4096 shape: the settings namespace persists
 * `local_root: './storage'` and the constructor left it implicit.
 */
export function resolveStorageTarget(input: StorageTargetInput): StorageTarget {
  const kind = String(input.kind ?? 'local') === 's3' ? 's3' : 'local';

  if (kind === 's3') {
    // Bucket identity is host + region + bucket. `endpoint` distinguishes an
    // S3-compatible service (MinIO, R2) from AWS itself, and two different
    // endpoints are two different stores even for the same bucket name.
    const location = `s3://${input.endpoint || 'aws'}/${input.region ?? ''}/${input.bucket ?? ''}`;
    return {
      kind,
      location,
      fingerprint: [
        location,
        `forcePathStyle=${input.forcePathStyle ? '1' : '0'}`,
        `accessKeyId=${input.accessKeyId ?? ''}`,
        `secretAccessKey=${input.secretAccessKey ?? ''}`,
      ].join('|'),
    };
  }

  // `./x` and `x` are the same directory, and the platform spells this default
  // both ways: the settings manifest stores `./.objectstack/data/uploads` while
  // the CLI computes `.objectstack/data/uploads`. Comparing the raw strings
  // reported a migration between a directory and itself.
  const rootDir = normalize(input.rootDir || DEFAULT_LOCAL_ROOT);
  const location = `local://${rootDir}`;
  return {
    kind,
    // `basePath` is deliberately NOT part of the location: it changes the URLs
    // the adapter signs, not where the bytes sit, so changing it strands nothing.
    location,
    fingerprint: [location, `basePath=${input.basePath || DEFAULT_BASE_PATH}`].join('|'),
  };
}

/** Whether a swap is needed: anything the adapter is built from differs. */
export function needsStorageSwap(current: StorageTarget | undefined, next: StorageTarget): boolean {
  return !current || current.fingerprint !== next.fingerprint;
}

/**
 * Whether a swap strands existing files — the backing store moved, so what the
 * old adapter held is not reachable through the new one.
 */
export function movesStorageLocation(
  current: StorageTarget | undefined,
  next: StorageTarget,
): boolean {
  // An unknown starting point is treated as a move: this is the warning that
  // exists to be impossible to miss, so absence of information must not silence
  // it (a `swap()` from a caller that resolved no target lands here).
  if (!current) return true;
  return current.kind !== next.kind || current.location !== next.location;
}
