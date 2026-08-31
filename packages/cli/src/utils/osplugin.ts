// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `.osplugin` packaging primitives (ADR-0025 §3.1 / §3.2, framework F2).
 *
 * A `.osplugin` is a gzipped tar (ustar) of:
 *
 *   objectstack.plugin.json   ← compiled manifest (with `integrity`)
 *   dist/**                   ← bundled, @objectstack/*-externalized code
 *   assets/**                 ← optional static assets
 *   package.json              ← only for `packaging: manifest-deps`
 *   pnpm-lock.yaml            ← only for `packaging: manifest-deps`
 *   SIGNATURE                 ← detached publisher signature (placeholder
 *                               until `os plugin sign`; ADR §3.4)
 *
 * The control plane (cloud) stores this blob opaquely. The per-file
 * `integrity` map is computed here at build time and self-checked by the
 * `os plugin publish` preflight; re-verification at install/load-time
 * unpack (ADR §3.5 step 5) is the cloud control plane's obligation and is
 * not implemented in this repo (#11331). This module owns the two
 * contracts the runtime and cloud must agree on byte-for-byte:
 *
 *   1. The integrity digest STRING FORMAT — Subresource-Integrity style
 *      `sha256-<base64>` (matches ADR-0025 §3.2's example). See
 *      {@link sriDigest}.
 *   2. The archive being a standards-compliant ustar+gzip so any tar
 *      reader (node-tar, GNU tar) can unpack it. See {@link createTarGz}.
 *
 * Everything here is pure (no oclif / filesystem) so it can be unit-tested
 * and reused by `os plugin sign` / `publish`.
 */

import { createHash } from 'node:crypto';
import { gzipSync, gunzipSync } from 'node:zlib';

/** A single file destined for the archive. `path` is POSIX, archive-relative. */
export interface ArchiveFile {
  path: string;
  data: Uint8Array;
}

/**
 * Subresource-Integrity-style digest of `bytes`: `sha256-<base64>`.
 * This is the canonical per-file integrity string written into the
 * compiled manifest's `integrity` map and checked back at the
 * `os plugin publish` preflight (unpack-time re-verification is the
 * cloud control plane's obligation, #11331).
 */
export function sriDigest(bytes: Uint8Array): string {
  return 'sha256-' + createHash('sha256').update(bytes).digest('base64');
}

/** Plain hex sha256 of bytes (used for the whole-artifact checksum). */
export function sha256Hex(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

/**
 * Build the per-file `integrity` map (archive-relative POSIX path →
 * `sha256-<base64>`) for the given files. The compiled manifest itself
 * (`objectstack.plugin.json`) and the `SIGNATURE` are excluded — the
 * manifest can't hash itself (it embeds the map) and the signature signs
 * the manifest.
 */
export function computeIntegrity(files: ArchiveFile[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of files) {
    if (f.path === MANIFEST_FILENAME || f.path === SIGNATURE_FILENAME) continue;
    out[f.path] = sriDigest(f.data);
  }
  // Deterministic key order for reproducible manifests.
  return Object.fromEntries(Object.entries(out).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
}

export const MANIFEST_FILENAME = 'objectstack.plugin.json';
export const SIGNATURE_FILENAME = 'SIGNATURE';
export const OSPLUGIN_EXT = '.osplugin';

// ─────────────────────────────────────────────────────────────────────
// ustar writer (POSIX tar). Files only — directory entries are implicit
// from path prefixes (node-tar / GNU tar create them on extract). mtime is
// pinned to 0 so identical inputs produce byte-identical archives.
// ─────────────────────────────────────────────────────────────────────

const BLOCK = 512;

function writeOctal(buf: Buffer, value: number, offset: number, len: number): void {
  // `len - 1` octal digits, zero-padded, then a NUL terminator.
  const s = value.toString(8).padStart(len - 1, '0') + '\0';
  buf.write(s, offset, len, 'ascii');
}

function tarHeader(file: ArchiveFile): Buffer {
  if (Buffer.byteLength(file.path, 'utf8') > 100) {
    throw new Error(`osplugin: archive path too long for ustar (>100 bytes): ${file.path}`);
  }
  const h = Buffer.alloc(BLOCK, 0);
  h.write(file.path, 0, 100, 'utf8'); // name
  writeOctal(h, 0o644, 100, 8); // mode
  writeOctal(h, 0, 108, 8); // uid
  writeOctal(h, 0, 116, 8); // gid
  writeOctal(h, file.data.byteLength, 124, 12); // size
  writeOctal(h, 0, 136, 12); // mtime (pinned → reproducible)
  h.write('        ', 148, 8, 'ascii'); // chksum field = spaces while summing
  h.write('0', 156, 1, 'ascii'); // typeflag: regular file
  h.write('ustar\0', 257, 6, 'ascii'); // magic
  h.write('00', 263, 2, 'ascii'); // version

  // Header checksum: unsigned sum of all 512 bytes (chksum field as spaces),
  // written as 6 octal digits + NUL + space.
  let sum = 0;
  for (let i = 0; i < BLOCK; i++) sum += h[i];
  h.write(sum.toString(8).padStart(6, '0') + '\0 ', 148, 8, 'ascii');
  return h;
}

/**
 * Serialize `files` into an uncompressed ustar buffer. Entries are emitted
 * in sorted path order for reproducibility, terminated by two zero blocks.
 */
export function createTar(files: ArchiveFile[]): Buffer {
  const sorted = [...files].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  const chunks: Buffer[] = [];
  for (const f of sorted) {
    chunks.push(tarHeader(f));
    const data = Buffer.from(f.data);
    chunks.push(data);
    const pad = (BLOCK - (data.byteLength % BLOCK)) % BLOCK;
    if (pad) chunks.push(Buffer.alloc(pad, 0));
  }
  chunks.push(Buffer.alloc(BLOCK * 2, 0)); // end-of-archive
  return Buffer.concat(chunks);
}

/** ustar + gzip → the `.osplugin` blob bytes. */
export function createTarGz(files: ArchiveFile[]): Buffer {
  return gzipSync(createTar(files), { level: 9 });
}

/**
 * Parse a ustar buffer back into its files — the inverse of {@link createTar}.
 * Reads regular-file entries only; stops at the end-of-archive zero block.
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

/** gunzip + untar an `.osplugin` blob into its files. */
export function readTarGz(blob: Uint8Array): ArchiveFile[] {
  return readTar(gunzipSync(Buffer.from(blob)));
}

/**
 * Extract + parse the compiled `objectstack.plugin.json` from an `.osplugin`
 * blob. Throws if the manifest is absent or not valid JSON.
 */
export function readOspluginManifest(blob: Uint8Array): Record<string, unknown> {
  const entry = readTarGz(blob).find((f) => f.path === MANIFEST_FILENAME);
  if (!entry) throw new Error(`${MANIFEST_FILENAME} not found in artifact`);
  return JSON.parse(Buffer.from(entry.data).toString('utf8')) as Record<string, unknown>;
}
