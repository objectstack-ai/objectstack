// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `.osplugin` packaging primitives (ADR-0025 §3.1 / §3.2, framework F2).
 *
 * A `.osplugin` is a gzipped tar (ustar) of:
 *
 *   objectstack.plugin.json   ← compiled manifest (with `integrity`)
 *   dist/**                   ← bundled, @objectstack/*-externalized code
 *                               (every other dependency inlined: `bundled`
 *                               is the one packaging strategy, ADR §3.3)
 *   assets/**                 ← optional static assets (never a `.node`
 *                               addon: `os plugin build` refuses one)
 *   SIGNATURE                 ← detached publisher signature (placeholder
 *                               until `os plugin sign`; ADR §3.4)
 *
 * The control plane (cloud) stores this blob opaquely. The per-file
 * `integrity` map is computed here at build time, self-checked by the
 * `os plugin publish` preflight, and re-verified at unpack by
 * `os plugin install` (ADR-0025 §3.5 M1). This module owns the two
 * contracts the runtime and cloud must agree on byte-for-byte:
 *
 *   1. The integrity digest STRING FORMAT — Subresource-Integrity style
 *      `sha256-<base64>` (matches ADR-0025 §3.2's example). See
 *      {@link sriDigest}.
 *   2. The archive being a standards-compliant ustar+gzip so any tar
 *      reader (node-tar, GNU tar) can unpack it. See {@link createTarGz}.
 *
 * Everything here is pure (no oclif / filesystem) so it can be unit-tested
 * and reused by `os plugin sign` / `publish` / `install`.
 *
 * The READER (`readTar`, `readTarGz` with its bounded gunzip, `sha256Hex`)
 * lives in `@objectstack/core` since the runtime's boot-time loader re-reads
 * the artifact an install kept (ADR-0025 §3.5 M1); it is re-exported here so
 * every CLI caller keeps its import.
 */

import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { readTarGz, type ArchiveFile } from '@objectstack/core';
import type { ObjectStackManifestParsed } from '@objectstack/spec/kernel';

export { readTar, readTarGz, sha256Hex, MAX_UNPACKED_ARTIFACT_BYTES, type ArchiveFile } from '@objectstack/core';

/**
 * Subresource-Integrity-style digest of `bytes`: `sha256-<base64>`.
 * This is the canonical per-file integrity string written into the
 * compiled manifest's `integrity` map, checked back at the
 * `os plugin publish` preflight and again at unpack by `os plugin install`
 * (ADR-0025 §3.5 M1).
 */
export function sriDigest(bytes: Uint8Array): string {
  return 'sha256-' + createHash('sha256').update(bytes).digest('base64');
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
 * Extract the compiled `objectstack.plugin.json` from an `.osplugin` blob and
 * parse it through `ManifestSchema` — `readCompiledPluginManifest`, the one
 * read `os plugin install` and the boot-time loader make too. Throws with the
 * helper's message when the manifest is absent, not a JSON object, or refused
 * by the schema (a retired value such as `packaging: 'manifest-deps'` carries
 * its prescription in that message).
 *
 * The helper is imported on call, not at the top: every `os plugin` command
 * loads this module, and `@objectstack/runtime`'s root entry would add about
 * a second to `os plugin build` and `os plugin sign`, which never read a
 * compiled manifest back.
 */
export async function readOspluginManifest(blob: Uint8Array): Promise<ObjectStackManifestParsed> {
  const { readCompiledPluginManifest } = await import('@objectstack/runtime');
  const read = readCompiledPluginManifest(readTarGz(blob));
  if (!read.ok) throw new Error(read.message);
  return read.manifest;
}
