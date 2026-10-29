// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Reading a `.osplugin` artifact (ADR-0025 §3.1): a gzipped ustar of the
 * compiled manifest, the bundled code and its assets.
 *
 * Two readers need the same bytes read the same way: `os plugin install`,
 * which unpacks a verified artifact into its install directory, and the
 * runtime's boot-time loader, which re-reads the artifact an install kept to
 * prove the unpacked tree is still the one that was signed (ADR-0025 §3.5 M1).
 * The writer stays with `os plugin build` in the CLI.
 *
 * ## The inflate is bounded
 *
 * A signature covers the COMPRESSED bytes, so both readers verify it before
 * they inflate anything; what is inflated is then bytes a trusted key signed.
 * The bound still holds the line for the one artifact that reaches the inflate
 * unverified — an unsigned install under `--trust-unsigned` — and for a key
 * whose holder ships a bomb: past {@link MAX_UNPACKED_ARTIFACT_BYTES} the
 * inflate stops and throws, naming the bound, instead of growing without end.
 *
 * Pure apart from `node:zlib` / `node:crypto`; no file system.
 */

import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';

/** A single file of an artifact. `path` is POSIX, archive-relative. */
export interface ArchiveFile {
  path: string;
  data: Uint8Array;
}

/** The most an artifact may inflate to: 256 MiB of tar. */
export const MAX_UNPACKED_ARTIFACT_BYTES = 256 * 1024 * 1024;

const BLOCK = 512;

/** Plain hex sha256 of `bytes` (the whole-artifact checksum an install records). */
export function sha256Hex(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

/**
 * Parse a ustar buffer into its files. Reads regular-file entries only; stops
 * at the end-of-archive zero block.
 */
export function readTar(buf: Uint8Array): ArchiveFile[] {
  const b = Buffer.from(buf);
  const files: ArchiveFile[] = [];
  let off = 0;
  while (off + BLOCK <= b.length) {
    const name = b.toString('utf8', off, off + 100).replace(/\0.*$/s, '');
    if (!name) break; // zero block → end of archive
    const size = parseInt(b.toString('ascii', off + 124, off + 136).replace(/\0.*$/s, '').trim(), 8) || 0;
    files.push({ path: name, data: new Uint8Array(b.subarray(off + BLOCK, off + BLOCK + size)) });
    off += BLOCK + Math.ceil(size / BLOCK) * BLOCK;
  }
  return files;
}

/**
 * gunzip + untar an `.osplugin` blob into its files. Throws when the blob is
 * not gzip, or when it inflates past `maxUnpackedBytes`
 * (default {@link MAX_UNPACKED_ARTIFACT_BYTES}), naming the bound.
 */
export function readTarGz(blob: Uint8Array, options: { maxUnpackedBytes?: number } = {}): ArchiveFile[] {
  const max = options.maxUnpackedBytes ?? MAX_UNPACKED_ARTIFACT_BYTES;
  let tar: Buffer;
  try {
    tar = gunzipSync(Buffer.from(blob), { maxOutputLength: max });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ERR_BUFFER_TOO_LARGE') {
      throw new Error(`the artifact inflates past ${max} bytes, the most an .osplugin may unpack to`);
    }
    throw error;
  }
  return readTar(tar);
}
