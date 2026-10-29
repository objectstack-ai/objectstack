// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Local plugin-installation records (ADR-0025 §3.5 steps 5–6, M1).
 *
 * `os plugin install ./x.osplugin` materializes a verified artifact under
 *
 *   <OS_HOME>/plugins/<environmentId>/<id>/<version>/
 *
 * and records the installation here, so the install survives a restart and
 * the boot-time loader (`installed-plugin-loader.ts`) can find what was
 * installed and how it was trusted:
 *
 *   <OS_HOME>/plugin-installations/<environmentId>.<project>.json
 *     → { "installations": [ PluginInstallationRecord, … ] }
 *
 * The record is the local stand-in for the control plane's
 * `sys_package_installation` row (ADR-0025 v2 §3.8: `env_id`, `version_id`,
 * `granted_permissions`, `status`): the environment is the file's name,
 * `versionId` is `id@version` because a local install has no
 * `sys_package_version` row, and `grantedPermissions` is the declared set —
 * there is no partial grant (§3.5 v2). It also keeps what the install was
 * trusted on: the signature's key id and the key's fingerprint, or the
 * `--trust-unsigned` override.
 *
 * ## Why the file is keyed by project as well as environment
 *
 * The same rule as the sibling `package-state-store.ts`, and its file name is
 * made by the same function ({@link packageStateFileName}): a boot reads its
 * installations, so a record shared between two projects that share one home
 * and one environment id would load a plugin into a project that never
 * installed it. The materialized bytes are keyed by environment, id and
 * version alone (the path ADR-0025 §3.5 names); the boot-time loader checks
 * them against the record's `sha256` before it trusts them.
 *
 * ## A record this store cannot read is never overwritten
 *
 * Unlike the disable-state file, a corrupt installations file is refused, not
 * read as empty: rewriting it from an empty start would drop every other
 * plugin's record while the write reported success.
 *
 * ## Every read-modify-write holds a lock
 *
 * Two `os plugin` commands for one project and environment at once would each
 * read the file and the second rename would drop the first's change. So every
 * write (install, the uninstall mark, the boot's removal of an uninstalled
 * record) runs under `<file>.lock`, created exclusively (`wx`) and holding the
 * writer's pid and start time. A writer that finds the lock waits for it, up
 * to {@link INSTALLATIONS_LOCK_WAIT_MS}, and then refuses, naming the holder.
 *
 * A lock a crashed process left behind is cleared by the next writer, never by
 * hand in the ordinary case: the lock is stale, and is removed, when its pid
 * is no longer a live process on this host, or when it is older than
 * {@link INSTALLATIONS_LOCK_STALE_MS} (a write takes milliseconds, so an older
 * lock is a pid the operating system reused), or when it names this process's
 * own pid while this process does not hold it (a dead process that had the pid
 * before), or when it cannot be parsed and is older than a second (a writer
 * that died between creating it and writing its pid). Only when none of these
 * holds does the refusal ask the operator to remove the lock file, by its
 * path.
 *
 * Exported from the package index for the CLI, which writes it; the runtime's
 * boot-time loader is its reader.
 */
import { closeSync, existsSync, openSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync, writeSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { makeDirectorySync } from './make-directory.js';
import { loadDisabledPackageIds, packageStateFileName, setPackageDisabled } from './package-state-store.js';
import { resolveObjectStackHome } from './standalone-stack.js';

/** The environment id `os serve` stamps when `OS_ENVIRONMENT_ID` is unset. */
export const DEFAULT_PLUGIN_ENVIRONMENT_ID = 'env_local';

/**
 * The names the install directory keeps the ORIGINAL artifact and its detached
 * signature under, beside the unpacked files, so the boot-time loader
 * re-verifies the signed bytes rather than the unpacked copy. No archive entry
 * may take either name.
 */
export const INSTALLED_ARTIFACT_FILE = 'artifact.osplugin';
export const INSTALLED_SIGNATURE_FILE = 'artifact.osplugin.sig';

/** How long a writer waits for another writer's lock before it refuses. */
export const INSTALLATIONS_LOCK_WAIT_MS = 10_000;
/** A lock older than this is stale whatever its pid answers. */
export const INSTALLATIONS_LOCK_STALE_MS = 5 * 60_000;

/** One installed plugin version, as `os plugin install` recorded it. */
export interface PluginInstallationRecord {
  /** The manifest `id` (reverse-domain). */
  id: string;
  version: string;
  /** `id@version` — the local stand-in for a `sys_package_version` id. */
  versionId: string;
  /** The manifest's declared `runtime` tier, or `null` when it declares none. */
  runtime: string | null;
  /**
   * `installed`, or `uninstall-pending` once `os plugin uninstall` marked it:
   * the next boot removes the directory and drops the record.
   */
  status: 'installed' | 'uninstall-pending';
  /** The manifest's declared `permissions` — the granted set equals it. `null` when it declares none. */
  grantedPermissions: Record<string, unknown> | null;
  /** The materialized directory, absolute. */
  dir: string;
  /** The original artifact kept in {@link dir}, and its whole-artifact sha256 (hex). */
  artifact: { file: string; sha256: string };
  /** The detached signature kept in {@link dir}, or `null` for an unsigned install. */
  signatureFile: string | null;
  /** The trusted key the signature verified against, or `null` for an unsigned install. */
  signature: { keyId: string; fingerprint: string } | null;
  /** `true` when the install was admitted unsigned under `--trust-unsigned`. */
  trustUnsigned: boolean;
  /** ISO-8601 time of the install. */
  installedAt: string;
}

interface InstallationsFile {
  installations: PluginInstallationRecord[];
}

/**
 * A path segment this store will build a directory from: it starts with a
 * letter or digit and holds only letters, digits and `.`, `_`, `+`, `-`. So it
 * is never empty, `.` or `..`, and never carries a separator.
 */
const SAFE_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._+-]*$/;

function requireSafeSegment(what: string, value: string): string {
  if (typeof value !== 'string' || !SAFE_SEGMENT.test(value) || value.length > 214) {
    throw new Error(
      `plugin ${what} ${JSON.stringify(value)} cannot name an install directory: it must start with a letter or digit `
        + 'and hold only letters, digits and . _ + - (no path separator).',
    );
  }
  return value;
}

function environmentSegment(environmentId: string | undefined): string {
  const raw = (environmentId ?? DEFAULT_PLUGIN_ENVIRONMENT_ID).trim();
  const safe = raw.replace(/[^a-zA-Z0-9._-]/g, '_');
  return safe.length > 0 && SAFE_SEGMENT.test(safe) ? safe : DEFAULT_PLUGIN_ENVIRONMENT_ID;
}

/** `<OS_HOME>/plugins/<environmentId>` — the root of one environment's materialized plugins. */
export function pluginsHome(environmentId?: string): string {
  return join(resolveObjectStackHome(), 'plugins', environmentSegment(environmentId));
}

/**
 * `<OS_HOME>/plugins/<environmentId>/<id>/<version>` — where one plugin version
 * is materialized. Throws when `id` or `version` could not be a single safe
 * path segment.
 */
export function pluginInstallDir(environmentId: string | undefined, id: string, version: string): string {
  return join(pluginsHome(environmentId), requireSafeSegment('id', id), requireSafeSegment('version', version));
}

function installationsDir(): string {
  return join(resolveObjectStackHome(), 'plugin-installations');
}

/** The installations file for this environment and project (the working directory). */
export function pluginInstallationsFile(environmentId?: string): string {
  return join(installationsDir(), packageStateFileName(environmentSegment(environmentId), process.cwd()));
}

function readInstallationsFile(file: string): PluginInstallationRecord[] {
  if (!existsSync(file)) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(file, 'utf8'));
  } catch (error) {
    throw new Error(
      `The plugin installations file ${file} is not valid JSON (${(error as Error).message}). `
        + 'Restore it from a backup or remove it and re-install the plugins it listed.',
    );
  }
  const list = (parsed as Partial<InstallationsFile> | null)?.installations;
  if (!Array.isArray(list)) {
    throw new Error(
      `The plugin installations file ${file} has no "installations" array. `
        + 'Restore it from a backup or remove it and re-install the plugins it listed.',
    );
  }
  return list as PluginInstallationRecord[];
}

/**
 * Every installation recorded for this environment and project, in the order
 * they were first installed. An absent file is no installations; a file that
 * is not an installations file throws, naming it.
 */
export function loadPluginInstallations(environmentId?: string): PluginInstallationRecord[] {
  return readInstallationsFile(pluginInstallationsFile(environmentId));
}

/** Block the thread for `ms` (the lock wait runs in synchronous commands). */
function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/** Whether the process `pid` is alive on this host. */
function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM: it exists, and belongs to someone else.
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/** The holder a lock file names, and whether the lock is stale (see the module header). */
function readLock(lock: string): { stale: boolean; holder: string } {
  let ageMs: number;
  try {
    ageMs = Date.now() - statSync(lock).mtimeMs;
  } catch {
    return { stale: false, holder: 'a writer that has just released it' };
  }
  let held: { pid?: unknown; at?: unknown } | null = null;
  try {
    held = JSON.parse(readFileSync(lock, 'utf8')) as { pid?: unknown; at?: unknown };
  } catch {
    held = null;
  }
  if (!held || typeof held.pid !== 'number') return { stale: ageMs > 1_000, holder: 'a writer that has not yet written its pid' };
  const holder = `process ${held.pid} (since ${String(held.at)})`;
  // This process does not hold it (that is answered before a lock file is
  // read), so a lock naming this pid was left by a dead process that had it.
  if (held.pid === process.pid) return { stale: true, holder };
  return { stale: !processAlive(held.pid) || ageMs > INSTALLATIONS_LOCK_STALE_MS, holder };
}

/** Lock files this process holds, and how deep: the lock is re-entrant within a process. */
const HELD = new Map<string, number>();

/**
 * Run `fn` holding this project's installations lock for `environmentId`, and
 * release the lock whatever `fn` does. Throws, naming the holder and the lock
 * file, when another live writer holds it past {@link INSTALLATIONS_LOCK_WAIT_MS}.
 *
 * Re-entrant within a process, so a caller can hold it across its own checks
 * and the write that follows them (`os plugin install` does) while the write
 * takes it again.
 */
export function withPluginInstallationsLock<T>(
  environmentId: string | undefined,
  fn: () => T,
  options: { waitMs?: number } = {},
): T {
  const file = pluginInstallationsFile(environmentId);
  const lock = `${file}.lock`;
  const depth = HELD.get(lock) ?? 0;
  if (depth > 0) {
    HELD.set(lock, depth + 1);
    try {
      return fn();
    } finally {
      HELD.set(lock, depth);
    }
  }
  makeDirectorySync(dirname(file));
  const waitMs = options.waitMs ?? INSTALLATIONS_LOCK_WAIT_MS;
  const deadline = Date.now() + waitMs;
  for (;;) {
    let fd: number | undefined;
    try {
      fd = openSync(lock, 'wx');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    }
    if (fd !== undefined) {
      try {
        writeSync(fd, JSON.stringify({ pid: process.pid, at: new Date().toISOString() }));
      } finally {
        closeSync(fd);
      }
      break;
    }
    const { stale, holder } = readLock(lock);
    if (stale) {
      rmSync(lock, { force: true });
      continue;
    }
    if (Date.now() >= deadline) {
      throw new Error(
        `The plugin installations file ${file} is locked by ${holder}, still running after `
          + `${waitMs / 1000}s. Let that command finish; if no \`os plugin\` command is running, remove ${lock}.`,
      );
    }
    sleepSync(50);
  }
  HELD.set(lock, 1);
  try {
    return fn();
  } finally {
    HELD.delete(lock);
    rmSync(lock, { force: true });
  }
}

function writeInstallations(environmentId: string | undefined, next: PluginInstallationRecord[]): void {
  const file = pluginInstallationsFile(environmentId);
  makeDirectorySync(dirname(file));
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify({ installations: next } satisfies InstallationsFile, null, 2)}\n`, 'utf8');
  renameSync(tmp, file);
}

/**
 * Record `record` as the installed version of its plugin id, replacing any
 * earlier record for the same id (an update swaps the installation pointer,
 * ADR-0025 §3.8). Runs under the installations lock; the write lands through
 * a temporary file and a rename, so a reader never sees half a file.
 */
export function recordPluginInstallation(environmentId: string | undefined, record: PluginInstallationRecord): void {
  withPluginInstallationsLock(environmentId, () => {
    const current = loadPluginInstallations(environmentId);
    const next = current.some((r) => r.id === record.id)
      ? current.map((r) => (r.id === record.id ? record : r))
      : [...current, record];
    writeInstallations(environmentId, next);
  });
}

/**
 * Mark the installation of `id` for removal at the next boot
 * (`os plugin uninstall`). Answers the marked record, or `undefined` when this
 * project has no installation of `id`. Runs under the installations lock.
 */
export function markPluginUninstall(environmentId: string | undefined, id: string): PluginInstallationRecord | undefined {
  return withPluginInstallationsLock(environmentId, () => {
    const current = loadPluginInstallations(environmentId);
    const found = current.find((r) => r.id === id);
    if (!found) return undefined;
    const marked: PluginInstallationRecord = { ...found, status: 'uninstall-pending' };
    writeInstallations(environmentId, current.map((r) => (r.id === id ? marked : r)));
    return marked;
  });
}

/**
 * Drop the record of `id` once its uninstall is finished, and forget its
 * disable, so a later install of the same id starts enabled. Runs under the
 * installations lock.
 */
export function dropPluginInstallation(environmentId: string | undefined, id: string): void {
  withPluginInstallationsLock(environmentId, () => {
    const current = loadPluginInstallations(environmentId);
    writeInstallations(environmentId, current.filter((r) => r.id !== id));
  });
  if (installedPluginDisabledIds(environmentId).has(id)) setInstalledPluginDisabled(environmentId, id, false);
}

/**
 * Every install directory another project's records name in this environment,
 * so an uninstall never removes a directory a second project still loads; or
 * `null` when one of those files cannot be read, which keeps every directory.
 */
export function otherProjectsInstallationDirs(environmentId?: string): Set<string> | null {
  const dir = installationsDir();
  const own = pluginInstallationsFile(environmentId);
  const segment = environmentSegment(environmentId);
  const dirs = new Set<string>();
  if (!existsSync(dir)) return dirs;
  for (const name of readdirSync(dir)) {
    if (!name.endsWith('.json')) continue;
    // `<environmentId>.<project>.json`; the project key carries no `.`.
    const stem = name.slice(0, -'.json'.length);
    if (stem.slice(0, stem.lastIndexOf('.')) !== segment) continue;
    const file = join(dir, name);
    if (file === own) continue;
    try {
      for (const record of readInstallationsFile(file)) if (typeof record?.dir === 'string') dirs.add(record.dir);
    } catch {
      return null;
    }
  }
  return dirs;
}

/**
 * The installed plugin ids disabled in this environment and project
 * (`os plugin disable`). Kept in the package disable-state store, keyed by the
 * plugin environment id ({@link DEFAULT_PLUGIN_ENVIRONMENT_ID} when unset).
 */
export function installedPluginDisabledIds(environmentId?: string): Set<string> {
  return loadDisabledPackageIds(environmentSegment(environmentId));
}

/** Disable or enable the installed plugin `id`; it takes effect at the next boot. */
export function setInstalledPluginDisabled(environmentId: string | undefined, id: string, disabled: boolean): void {
  setPackageDisabled(environmentSegment(environmentId), id, disabled);
}
