// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Local plugin-installation records (ADR-0025 §3.5 steps 5–6, M1).
 *
 * `os plugin install ./x.osplugin` materializes a verified artifact under
 *
 *   <OS_HOME>/plugins/<environmentId>/<id>/<version>/
 *
 * and records the installation here, so the install survives a restart and a
 * boot-time loader can find what was installed and how it was trusted:
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
 * version alone (the path ADR-0025 §3.5 names); a reader checks them against
 * the record's `sha256` before it trusts them.
 *
 * ## A record this store cannot read is never overwritten
 *
 * Unlike the disable-state file, a corrupt installations file is refused, not
 * read as empty: rewriting it from an empty start would drop every other
 * plugin's record while the write reported success.
 *
 * Exported from the package index for the CLI, which writes it; the runtime's
 * boot-time loader is its reader.
 */
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { makeDirectorySync } from './make-directory.js';
import { packageStateFileName } from './package-state-store.js';
import { resolveObjectStackHome } from './standalone-stack.js';

/** The environment id `os serve` stamps when `OS_ENVIRONMENT_ID` is unset. */
export const DEFAULT_PLUGIN_ENVIRONMENT_ID = 'env_local';

/** One installed plugin version, as `os plugin install` recorded it. */
export interface PluginInstallationRecord {
  /** The manifest `id` (reverse-domain). */
  id: string;
  version: string;
  /** `id@version` — the local stand-in for a `sys_package_version` id. */
  versionId: string;
  /** The manifest's declared `runtime` tier, or `null` when it declares none. */
  runtime: string | null;
  status: 'installed';
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

/** The installations file for this environment and project (the working directory). */
export function pluginInstallationsFile(environmentId?: string): string {
  return join(
    resolveObjectStackHome(),
    'plugin-installations',
    packageStateFileName(environmentSegment(environmentId), process.cwd()),
  );
}

/**
 * Every installation recorded for this environment and project, in the order
 * they were first installed. An absent file is no installations; a file that
 * is not an installations file throws, naming it.
 */
export function loadPluginInstallations(environmentId?: string): PluginInstallationRecord[] {
  const file = pluginInstallationsFile(environmentId);
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
 * Record `record` as the installed version of its plugin id, replacing any
 * earlier record for the same id (an update swaps the installation pointer,
 * ADR-0025 §3.8). The write lands through a temporary file and a rename, so a
 * reader never sees half a file.
 */
export function recordPluginInstallation(environmentId: string | undefined, record: PluginInstallationRecord): void {
  const current = loadPluginInstallations(environmentId);
  const next = current.some((r) => r.id === record.id)
    ? current.map((r) => (r.id === record.id ? record : r))
    : [...current, record];
  const file = pluginInstallationsFile(environmentId);
  makeDirectorySync(dirname(file));
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify({ installations: next } satisfies InstallationsFile, null, 2)}\n`, 'utf8');
  renameSync(tmp, file);
}
