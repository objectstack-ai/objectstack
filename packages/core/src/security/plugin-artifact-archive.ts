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
 * Neither the inflate's input nor the files it answers are copied, so what a
 * reader holds is the compressed bytes plus the one inflated tar.
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

/** The ustar typeflags of a regular file (`'0'`, and `'\0'` from pre-POSIX writers). */
const REGULAR_FILE = new Set(['0', '\0']);
/** A directory entry: implied by the paths under it, so skipped. */
const DIRECTORY = '5';

function field(b: Buffer, start: number, length: number, encoding: 'utf8' | 'ascii'): string {
  return b.toString(encoding, start, start + length).replace(/\0.*$/s, '');
}

/**
 * Parse a ustar buffer into its files. Reads regular-file entries, joining a
 * POSIX `prefix` onto the name; skips directory entries; throws, naming the
 * entry, on any other kind (a link, a device, a pax or GNU extension header)
 * and on an entry the buffer cuts short. Stops at the end-of-archive zero
 * block. Each file's `data` is a view into `buf`, not a copy.
 */
export function readTar(buf: Uint8Array): ArchiveFile[] {
  const b = Buffer.from(buf.buffer, buf.byteOffset, buf.byteLength);
  const files: ArchiveFile[] = [];
  let off = 0;
  while (off + BLOCK <= b.length) {
    const header = b.subarray(off, off + BLOCK);
    if (header.every((byte) => byte === 0)) break; // zero block → end of archive
    const name = field(b, off, 100, 'utf8');
    // POSIX ustar (magic `ustar\0`) keeps the leading part of a long path in
    // `prefix`; the GNU format (`ustar `) uses those bytes for other fields.
    const prefix = b.toString('ascii', off + 257, off + 263) === 'ustar\0' ? field(b, off + 345, 155, 'utf8') : '';
    const path = prefix ? `${prefix}/${name}` : name;
    if (!name) throw new Error(`the archive entry at byte ${off} has no name`);
    const sizeField = field(b, off + 124, 12, 'ascii').trim();
    if (!/^[0-7]+$/.test(sizeField)) throw new Error(`the archive entry ${JSON.stringify(path)} has no readable size`);
    const size = parseInt(sizeField, 8);
    const typeflag = b.toString('ascii', off + 156, off + 157);
    if (off + BLOCK + size > b.length) {
      throw new Error(`the archive entry ${JSON.stringify(path)} is cut short: it declares ${size} bytes, and ${b.length - off - BLOCK} follow`);
    }
    if (REGULAR_FILE.has(typeflag)) {
      files.push({ path, data: new Uint8Array(b.buffer, b.byteOffset + off + BLOCK, size) });
    } else if (typeflag !== DIRECTORY) {
      throw new Error(`the archive entry ${JSON.stringify(path)} is not a regular file or directory (typeflag ${JSON.stringify(typeflag)})`);
    }
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
    tar = gunzipSync(Buffer.from(blob.buffer, blob.byteOffset, blob.byteLength), { maxOutputLength: max });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ERR_BUFFER_TOO_LARGE') {
      throw new Error(`the artifact inflates past ${max} bytes, the most an .osplugin may unpack to`);
    }
    throw error;
  }
  return readTar(tar);
}
