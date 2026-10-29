// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { existsSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, posix } from 'node:path';
import {
  DEFAULT_PLUGIN_ENVIRONMENT_ID,
  INSTALLED_ARTIFACT_FILE,
  INSTALLED_SIGNATURE_FILE,
  loadPluginInstallations,
  type PluginInstallationRecord,
} from '@objectstack/runtime';
import { sha256Hex, type ArchiveFile } from './osplugin.js';
import { makeDirectorySync } from './make-directory.js';

/**
 * The parts of `os plugin install` (ADR-0025 §3.5 M1) that touch no database:
 * which archive entries may be written to disk, and how a verified artifact is
 * materialized into its install directory.
 */

/**
 * The names the install directory keeps the ORIGINAL artifact and its detached
 * signature under, beside the unpacked files, so the boot-time loader
 * re-verifies the signed bytes rather than the unpacked copy. No archive entry
 * may take either name. Declared beside the installation store in
 * `@objectstack/runtime`, whose loader reads them.
 */
export { INSTALLED_ARTIFACT_FILE, INSTALLED_SIGNATURE_FILE };

/**
 * The environment id local plugin installations are keyed by: `OS_ENVIRONMENT_ID`,
 * else `env_local`, the id `os serve` stamps. `os plugin install | disable |
 * enable | uninstall` write under it and `os serve`'s boot-time loader reads
 * under it, so all of them name one set of installations.
 */
export function pluginEnvironmentId(): string {
  return process.env.OS_ENVIRONMENT_ID?.trim() || DEFAULT_PLUGIN_ENVIRONMENT_ID;
}

/**
 * This project's installation of `id` in `environmentId`, or the refusal
 * `os plugin disable | enable | uninstall` print: the installations file
 * cannot be read, no installation of `id` is recorded, or (unless
 * `pendingIsInstalled`) it is already marked for removal at the next boot.
 */
export function findPluginInstallation(
  environmentId: string,
  id: string,
  opts: { pendingIsInstalled?: boolean } = {},
):
  | { ok: true; record: PluginInstallationRecord }
  | { ok: false; error: 'record_unreadable' | 'plugin_not_installed' | 'plugin_uninstall_pending'; message: string } {
  let records: PluginInstallationRecord[];
  try {
    records = loadPluginInstallations(environmentId);
  } catch (error) {
    return { ok: false, error: 'record_unreadable', message: (error as Error).message };
  }
  const record = records.find((r) => r.id === id);
  if (!record) {
    const installed = records.map((r) => r.id);
    return {
      ok: false,
      error: 'plugin_not_installed',
      message:
        `No installation of '${id}' is recorded for this project in environment '${environmentId}'`
        + (installed.length > 0 ? ` (installed: ${installed.join(', ')}).` : ' (nothing is installed).'),
    };
  }
  if (record.status === 'uninstall-pending' && !opts.pendingIsInstalled) {
    return {
      ok: false,
      error: 'plugin_uninstall_pending',
      message: `'${id}' is marked for removal at the next boot (\`os plugin uninstall\`). Install it again to keep it.`,
    };
  }
  return { ok: true, record };
}

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
