// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { existsSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, posix } from 'node:path';
import { sha256Hex, type ArchiveFile } from './osplugin.js';
import { makeDirectorySync } from './make-directory.js';

/**
 * The parts of `os plugin install` (ADR-0025 §3.5 M1) that touch no database:
 * which archive entries may be written to disk, and how a verified artifact is
 * materialized into its install directory.
 */

/**
 * The names the install directory keeps the ORIGINAL artifact and its detached
 * signature under, beside the unpacked files, so a loader can re-verify the
 * signed bytes rather than the unpacked copy. No archive entry may take either
 * name.
 */
export const INSTALLED_ARTIFACT_FILE = 'artifact.osplugin';
export const INSTALLED_SIGNATURE_FILE = 'artifact.osplugin.sig';

/**
 * Every reason the archive's entries cannot be unpacked as they stand, one
 * line each, or `[]`. An entry must be a relative POSIX path that stays inside
 * the install directory: no absolute path, no `.` or `..` segment, no empty
 * segment, no backslash or NUL. Two entries may not share a path, even one
 * differing only in letter case (a case-insensitive file system would write one
 * over the other), and no entry may be both a file and the directory of
 * another. None may take one of the two names the install directory reserves,
 * in any letter case.
 */
export function archiveEntryProblems(files: readonly ArchiveFile[]): string[] {
  const problems: string[] = [];
  /** Case-folded path → the first spelling seen. */
  const seen = new Map<string, string>();
  for (const { path } of files) {
    const shown = JSON.stringify(path);
    if (path.length === 0 || path.startsWith('/') || /[\\\u0000]/.test(path) || /^[A-Za-z]:/.test(path)) {
      problems.push(`${shown}: not a relative POSIX path`);
      continue;
    }
    const segments = path.split('/');
    if (segments.some((s) => s === '' || s === '.' || s === '..')) {
      problems.push(`${shown}: has an empty, '.' or '..' segment, so it could land outside the install directory`);
      continue;
    }
    if (posix.normalize(path) !== path) {
      problems.push(`${shown}: not in normal form`);
      continue;
    }
    const folded = path.toLowerCase();
    if (folded === INSTALLED_ARTIFACT_FILE || folded === INSTALLED_SIGNATURE_FILE) {
      problems.push(`${shown}: the install directory reserves this name for the original artifact and its signature`);
      continue;
    }
    const first = seen.get(folded);
    if (first !== undefined) {
      problems.push(
        first === path ? `${shown}: appears more than once` : `${shown}: differs from ${JSON.stringify(first)} only in letter case`,
      );
      continue;
    }
    seen.set(folded, path);
  }
  // A file whose path is a directory of another entry: one of the two cannot be written.
  for (const [folded, path] of seen) {
    const segments = folded.split('/');
    for (let i = 1; i < segments.length; i++) {
      const file = seen.get(segments.slice(0, i).join('/'));
      if (file !== undefined) {
        problems.push(`${JSON.stringify(path)}: sits under ${JSON.stringify(file)}, which is a file in the same archive`);
        break;
      }
    }
  }
  return problems;
}

/**
 * The sha256 (hex) of the original artifact an earlier install left in `dir`;
 * `null` when `dir` exists but holds no readable artifact, and `undefined` when
 * `dir` does not exist.
 */
export function installedArtifactSha(dir: string): string | null | undefined {
  if (!existsSync(dir)) return undefined;
  try {
    return sha256Hex(new Uint8Array(readFileSync(join(dir, INSTALLED_ARTIFACT_FILE))));
  } catch {
    return null;
  }
}

/**
 * Write `files`, the original artifact bytes and (when signed) the signature
 * into `dir`, replacing whatever an earlier install of the same version left
 * there. The new tree is written in full beside `dir` first and swapped in by
 * rename, so a failed write never leaves a half-written install in `dir`, and
 * a failed swap puts the earlier install back and removes the new tree.
 *
 * The caller has already refused every entry {@link archiveEntryProblems}
 * names.
 */
export function materializePlugin(input: {
  dir: string;
  files: readonly ArchiveFile[];
  artifact: Uint8Array;
  signature: string | null;
}): { replaced: boolean } {
  const { dir } = input;
  makeDirectorySync(dirname(dir));
  const staging = `${dir}.installing-${process.pid}`;
  const previous = `${dir}.replaced-${process.pid}`;
  rmSync(staging, { recursive: true, force: true });
  try {
    makeDirectorySync(staging);
    for (const file of input.files) {
      const target = join(staging, ...file.path.split('/'));
      makeDirectorySync(dirname(target));
      writeFileSync(target, file.data);
    }
    writeFileSync(join(staging, INSTALLED_ARTIFACT_FILE), input.artifact);
    if (input.signature !== null) writeFileSync(join(staging, INSTALLED_SIGNATURE_FILE), `${input.signature}\n`, 'utf-8');
  } catch (error) {
    rmSync(staging, { recursive: true, force: true });
    throw error;
  }
  const replaced = existsSync(dir);
  try {
    if (replaced) {
      rmSync(previous, { recursive: true, force: true });
      renameSync(dir, previous);
    }
    try {
      renameSync(staging, dir);
    } catch (error) {
      if (replaced) renameSync(previous, dir);
      throw error;
    }
  } catch (error) {
    rmSync(staging, { recursive: true, force: true });
    throw error;
  }
  if (replaced) rmSync(previous, { recursive: true, force: true });
  return { replaced };
}
