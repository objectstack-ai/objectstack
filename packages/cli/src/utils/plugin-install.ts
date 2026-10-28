// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { existsSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, posix } from 'node:path';
import type { ArchiveFile } from './osplugin.js';
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
 * segment, no backslash or NUL. Two entries may not share a path, and none may
 * take one of the two names the install directory reserves.
 */
export function archiveEntryProblems(files: readonly ArchiveFile[]): string[] {
  const problems: string[] = [];
  const seen = new Set<string>();
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
    if (path === INSTALLED_ARTIFACT_FILE || path === INSTALLED_SIGNATURE_FILE) {
      problems.push(`${shown}: the install directory reserves this name for the original artifact and its signature`);
      continue;
    }
    if (seen.has(path)) {
      problems.push(`${shown}: appears more than once`);
      continue;
    }
    seen.add(path);
  }
  return problems;
}

/**
 * Write `files`, the original artifact bytes and (when signed) the signature
 * into `dir`, replacing whatever an earlier install of the same version left
 * there. The new tree is written in full beside `dir` first and swapped in by
 * rename, so a failed write never leaves a half-written install in `dir`.
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
  if (replaced) renameSync(dir, previous);
  renameSync(staging, dir);
  if (replaced) rmSync(previous, { recursive: true, force: true });
  return { replaced };
}
