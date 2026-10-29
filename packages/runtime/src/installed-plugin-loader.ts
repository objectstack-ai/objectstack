// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The boot-time loader for plugins `os plugin install` installed
 * (ADR-0025 §3.5 M1, the second slice of the local install loop).
 *
 * At boot, before the kernel bootstraps, the host reads this project's
 * installation records ({@link loadPluginInstallations}) and hands each one
 * through {@link verifyInstalledPlugins}. A plugin is imported only when every
 * check below passes, in this order; the first that fails refuses that plugin
 * by name and nothing of it is imported. A check that throws (a file it cannot
 * read, one that vanished mid-walk, an unreadable disable-state file) refuses
 * that plugin by name too: one installation never fails the whole boot.
 *
 *  0. **The record names its own directory.** `dir` must be the one the
 *     store derives for the record's environment, id and version
 *     (`pluginInstallDir`), or nothing is read from it or removed under it.
 *  1. **Disabled** (`os plugin disable`, kept in the package disable-state
 *     store under the plugin environment id) — skipped, not refused.
 *  2. **The kept artifact is the recorded one.** `artifact.osplugin` in the
 *     install directory hashes to the record's `sha256`. Two projects sharing
 *     one `OS_HOME` and environment share the directory, so this is what tells
 *     a project that the tree is no longer the one it installed.
 *  3. **The signature, over the raw kept bytes, before anything is inflated.**
 *     The detached `artifact.osplugin.sig` names a key id; it must be the
 *     record's, the key must be `active` in `sys_trusted_key` with the
 *     fingerprint the record kept, and `verifyPluginArtifact` must verify it
 *     over the bytes. The signature covers the bytes only; what ties them to
 *     the record's id and version is check 4's manifest comparison. So a key
 *     revoked since install refuses the plugin at its next boot. An
 *     install admitted unsigned under `--trust-unsigned` loads with a warning
 *     on every boot.
 *  4. **The tree is the artifact.** The artifact is read back (bounded,
 *     `readTarGz`) and every file in the install directory must be byte-equal
 *     to its entry, with no file the artifact does not hold beside the two the
 *     install keeps. Its manifest's `id` and `version` are the record's.
 *  5. **The tier dispatch point** ({@link dispatchPluginRuntime}). M1 wires
 *     `runtime: 'node'` only: the entry module is imported in process.
 *     `sandbox` and `worker` are refused by name until M3 routes them, and a
 *     manifest that declares no tier is refused too — trust is default-deny
 *     (ADR-0025 §3.6), and nothing loads in process without saying `node`.
 *
 * {@link loadInstalledPlugins} runs the same checks, finishes uninstalls
 * (`os plugin uninstall` marks a record; the directory goes here, at the next
 * boot, under the installations lock and only while the record is still the
 * marked one, unless another project's record still names it), and imports
 * what passed. Registering the plugins is the caller's: it `kernel.use`s each,
 * so dependency ordering and health checks are the kernel's `PluginLoader`'s.
 *
 * The refusals that come AFTER the import (`import_failed`, `not_a_plugin`,
 * `signature_conflict`, and the host's `plugin_name_taken` / `kernel_refused`)
 * are made once the entry module's top-level code has run: the plugin is not
 * registered, but its module was evaluated.
 *
 * ## What the import resolves
 *
 * `os plugin build` leaves `@objectstack/*` external: the host provides them.
 * The install directory sits under `OS_HOME`, where no `node_modules` holds
 * them, so a host passes `resolveHostPackagesFrom` (a file URL of its own) and
 * a bare `@objectstack/*` specifier imported from inside a verified install
 * directory resolves as if that host file imported it: the same module
 * instances the host's kernel runs on. A directory is matched by its real
 * path too, which is the one Node names an importing module by, so an
 * `OS_HOME` reached through a symbolic link (the macOS temp dir is one) is
 * matched. Only a specifier that names a package under `@objectstack/` is
 * redirected: one with an empty, `.` or `..` segment, a `%` or a backslash
 * (which could climb out of `@objectstack/` to any file the host can resolve)
 * is not. Any other bare specifier resolves as Node resolves it from the
 * install directory. The verified tree is what the import reads first; a file
 * the plugin imports later, lazily, is read from disk when it is imported,
 * after this check.
 */
import { existsSync, lstatSync, readdirSync, readFileSync, realpathSync, rmdirSync, rmSync, statSync } from 'node:fs';
import { register } from 'node:module';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  MAX_UNPACKED_ARTIFACT_BYTES,
  materializeStackPlugin,
  parseSignature,
  readTarGz,
  recordPluginArtifactVerdict,
  sha256Hex,
  verifyPluginArtifact,
  type ArchiveFile,
} from '@objectstack/core';

import {
  INSTALLED_ARTIFACT_FILE,
  INSTALLED_SIGNATURE_FILE,
  dropPluginInstallation,
  installedPluginDisabledIds,
  loadPluginInstallations,
  otherProjectsInstallationDirs,
  pluginInstallDir,
  withPluginInstallationsLock,
  type PluginInstallationRecord,
} from './plugin-installation-store.js';
import type { TrustedKeyResolution } from './plugin-trusted-keys.js';

/** The manifest an artifact carries at its root. */
const MANIFEST_FILE = 'objectstack.plugin.json';
/** The entry `os plugin build` compiles to, when a manifest names none. */
const DEFAULT_ENTRY = 'dist/index.mjs';

/** Why an installed plugin did not load. */
export type InstalledPluginRefusalCode =
  | 'records_unreadable'
  | 'disabled_state_unreadable'
  | 'install_unreadable'
  | 'uninstall_failed'
  | 'record_changed'
  | 'install_dir_unexpected'
  | 'install_dir_missing'
  | 'artifact_changed'
  | 'signature_missing'
  | 'signature_malformed'
  | 'signature_key_mismatch'
  | 'signature_key_untrusted'
  | 'signature_key_revoked'
  | 'trusted_keys_unreadable'
  | 'trusted_key_invalid'
  | 'trusted_key_changed'
  | 'signature_invalid'
  | 'unsigned_without_override'
  | 'artifact_unreadable'
  | 'manifest_mismatch'
  | 'tree_changed'
  | 'runtime_undeclared'
  | 'runtime_not_dispatched'
  | 'entry_missing'
  | 'import_failed'
  | 'not_a_plugin'
  | 'signature_conflict'
  // Raised by the host that registers what loaded (`os serve`):
  | 'plugin_name_taken'
  | 'kernel_refused'
  | 'loader_failed';

export interface InstalledPluginRefusal {
  id: string;
  version: string;
  error: InstalledPluginRefusalCode;
  message: string;
}

/** An installed plugin every check passed: what loading it would import. */
export interface VerifiedInstalledPlugin {
  record: PluginInstallationRecord;
  /** The entry module, absolute. */
  entry: string;
  /** The detached signature the artifact verified under, or `null` for an unsigned install. */
  signature: string | null;
}

export interface InstalledPluginsVerdict {
  verified: VerifiedInstalledPlugin[];
  refused: InstalledPluginRefusal[];
  /** Installed but disabled (`os plugin disable`): not loaded, not refused. */
  disabled: PluginInstallationRecord[];
  /** Marked by `os plugin uninstall`, waiting for the next boot to remove them. */
  uninstallPending: PluginInstallationRecord[];
}

export interface VerifyInstalledPluginsInput {
  environmentId?: string;
  /**
   * Resolve the key ids the signed installs name, in one read of the
   * environment's `sys_trusted_key`. Not called when no install is signed.
   */
  resolveKeys(keyIds: readonly string[]): Promise<ReadonlyMap<string, TrustedKeyResolution>>;
}

/**
 * The tier dispatch point (ADR-0025 §3.6). M1 dispatches `node` (T0, in
 * process) and refuses every other tier by name until M3 routes `sandbox` to
 * the QuickJS runner and decides `worker`; there is no in-process fallback.
 */
export function dispatchPluginRuntime(
  runtime: unknown,
): { ok: true; tier: 'node' } | { ok: false; error: 'runtime_undeclared' | 'runtime_not_dispatched'; message: string } {
  if (runtime === 'node') return { ok: true, tier: 'node' };
  if (runtime === undefined || runtime === null || runtime === '') {
    return {
      ok: false,
      error: 'runtime_undeclared',
      message:
        'its manifest declares no `runtime` tier. Trust is default-deny (ADR-0025 §3.6): nothing loads in process '
        + "without declaring `runtime: 'node'`.",
    };
  }
  return {
    ok: false,
    error: 'runtime_not_dispatched',
    message:
      `its manifest declares \`runtime: ${JSON.stringify(runtime)}\`, and only \`node\` is dispatched today. `
      + "`sandbox` and `worker` are refused until they are routed (ADR-0025 M3); the plugin is not loaded in process instead.",
  };
}

/** A relative POSIX path that stays inside the install directory. */
function safeEntryPath(path: string): boolean {
  if (!path || path.startsWith('/') || /[\\\u0000]/.test(path) || /^[A-Za-z]:/.test(path)) return false;
  return path.split('/').every((s) => s !== '' && s !== '.' && s !== '..');
}

/** Every regular file under `dir`, relative and POSIX; a symbolic link or other non-file is named in `odd`. */
function walkTree(dir: string, prefix = ''): { files: string[]; odd: string[] } {
  const files: string[] = [];
  const odd: string[] = [];
  for (const entry of readdirSync(join(dir, prefix), { withFileTypes: true })) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      const inner = walkTree(dir, rel);
      files.push(...inner.files);
      odd.push(...inner.odd);
    } else if (entry.isFile()) files.push(rel);
    else odd.push(rel);
  }
  return { files, odd };
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  return a.byteLength === b.byteLength && Buffer.from(a).equals(Buffer.from(b));
}

type Check = { ok: true; value: VerifiedInstalledPlugin } | { ok: false; error: InstalledPluginRefusalCode; message: string };

function refuse(error: InstalledPluginRefusalCode, message: string): Check {
  return { ok: false, error, message };
}

/**
 * Whether `record.dir` is the directory the store derives for its id and
 * version. Nothing is read from, or removed under, a directory a record names
 * otherwise: the record is a file under `OS_HOME`, and a path it carries is
 * not trusted for itself.
 */
function expectedDir(environmentId: string | undefined, record: PluginInstallationRecord): string | null {
  try {
    const dir = pluginInstallDir(environmentId, record.id, record.version);
    return record.dir === dir ? dir : null;
  } catch {
    return null;
  }
}

function unexpectedDir(environmentId: string | undefined, record: PluginInstallationRecord): string {
  let derived: string;
  try {
    derived = pluginInstallDir(environmentId, record.id, record.version);
  } catch (error) {
    derived = `none (${thrownMessage(error)})`;
  }
  return `its record names the directory ${JSON.stringify(record.dir)}, and the install directory for ${record.id}@${record.version} is ${derived}. Nothing was read from or removed under it. Install it again.`;
}

/** Checks 2 and 3 up to the key lookup: the kept bytes, and the signature's key id. */
function readKept(record: PluginInstallationRecord):
  | { ok: true; artifact: Uint8Array; signature: string | null; keyId: string | null }
  | { ok: false; error: InstalledPluginRefusalCode; message: string } {
  const dir = record.dir;
  if (typeof dir !== 'string' || !existsSync(dir) || !lstatSync(dir).isDirectory()) {
    return { ok: false, error: 'install_dir_missing', message: `its install directory ${dir} is not there. Install it again.` };
  }
  let artifact: Uint8Array;
  try {
    const size = statSync(join(dir, INSTALLED_ARTIFACT_FILE)).size;
    if (size > MAX_UNPACKED_ARTIFACT_BYTES) {
      return {
        ok: false,
        error: 'artifact_changed',
        message: `${join(dir, INSTALLED_ARTIFACT_FILE)} is ${size} bytes, more than any artifact an install accepts (${MAX_UNPACKED_ARTIFACT_BYTES}); it was not read.`,
      };
    }
    artifact = new Uint8Array(readFileSync(join(dir, INSTALLED_ARTIFACT_FILE)));
  } catch (error) {
    return { ok: false, error: 'artifact_changed', message: `${join(dir, INSTALLED_ARTIFACT_FILE)} cannot be read (${thrownMessage(error)}).` };
  }
  const sha = sha256Hex(artifact);
  if (sha !== record.artifact?.sha256) {
    return {
      ok: false,
      error: 'artifact_changed',
      message:
        `${join(dir, INSTALLED_ARTIFACT_FILE)} is not the artifact this project installed (sha256 ${sha}, recorded `
        + `${record.artifact?.sha256 ?? 'none'}): another project sharing this OS_HOME and environment replaced it, or it was edited. Install it again.`,
    };
  }
  const sigPath = join(dir, INSTALLED_SIGNATURE_FILE);
  if (record.signature === null || record.signature === undefined) {
    if (!record.trustUnsigned) {
      return { ok: false, error: 'unsigned_without_override', message: 'its record names no signature and no --trust-unsigned override.' };
    }
    return { ok: true, artifact, signature: null, keyId: null };
  }
  let signature: string;
  try {
    signature = readFileSync(sigPath, 'utf8').trim();
  } catch {
    return { ok: false, error: 'signature_missing', message: `it was installed signed, and ${sigPath} is not there now.` };
  }
  const parsed = parseSignature(signature);
  if (!parsed) return { ok: false, error: 'signature_malformed', message: `${sigPath} is not an \`ed25519:KEYID:SIG\` signature.` };
  if (parsed.keyId !== record.signature.keyId) {
    return {
      ok: false,
      error: 'signature_key_mismatch',
      message: `${sigPath} names key id '${parsed.keyId}', and the install verified key id '${record.signature.keyId}'.`,
    };
  }
  return { ok: true, artifact, signature, keyId: parsed.keyId };
}

async function checkRecord(
  record: PluginInstallationRecord,
  kept: { artifact: Uint8Array; signature: string | null; keyId: string | null },
  keys: ReadonlyMap<string, TrustedKeyResolution>,
): Promise<Check> {
  const { artifact, signature, keyId } = kept;
  // 3. The signature, over the raw kept bytes.
  if (signature !== null && keyId !== null) {
    const resolved = keys.get(keyId) ?? { verdict: 'unknown' as const };
    if (resolved.verdict === 'unknown') {
      return refuse('signature_key_untrusted', `it is signed with key id '${keyId}', which this environment no longer trusts.`);
    }
    if (resolved.verdict === 'revoked') {
      return refuse('signature_key_revoked', `it is signed with key id '${keyId}', which was revoked in this environment (${resolved.row.fingerprint}).`);
    }
    if (resolved.verdict === 'invalid') {
      return refuse('trusted_key_invalid', `the trusted key '${keyId}' cannot verify anything: ${resolved.message}.`);
    }
    if (resolved.row.fingerprint !== record.signature?.fingerprint) {
      return refuse(
        'trusted_key_changed',
        `key id '${keyId}' now names the key ${resolved.row.fingerprint}, and the install verified ${record.signature?.fingerprint}.`,
      );
    }
    const publicKey = resolved.publicKey;
    const verdict = await verifyPluginArtifact(
      { artifact, version: { package_id: record.id, version: record.version, signature } },
      { getPublisherPublicKey: (id) => (id === keyId ? publicKey : null), requirePlatform: false },
    );
    if (!verdict.ok || !verdict.publisherVerified) {
      return refuse('signature_invalid', `its signature does not verify against the trusted key '${keyId}' (${verdict.reason ?? 'not verified'}).`);
    }
  }

  // 4. The tree is the artifact.
  let files: ArchiveFile[];
  try {
    files = readTarGz(artifact);
  } catch (error) {
    return refuse('artifact_unreadable', `its kept artifact cannot be read: ${thrownMessage(error)}.`);
  }
  const unsafe = files.find((f) => !safeEntryPath(f.path));
  if (unsafe) return refuse('artifact_unreadable', `its kept artifact holds the entry ${JSON.stringify(unsafe.path)}, which cannot sit in an install directory.`);
  let manifest: Record<string, unknown>;
  try {
    const entry = files.find((f) => f.path === MANIFEST_FILE);
    if (!entry) throw new Error(`${MANIFEST_FILE} not found`);
    const parsed = JSON.parse(Buffer.from(entry.data).toString('utf8')) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error(`${MANIFEST_FILE} is not a JSON object`);
    manifest = parsed as Record<string, unknown>;
  } catch (error) {
    return refuse('artifact_unreadable', `its kept artifact's manifest cannot be read: ${thrownMessage(error)}.`);
  }
  if (manifest.id !== record.id || manifest.version !== record.version) {
    return refuse(
      'manifest_mismatch',
      `its kept artifact is ${String(manifest.id)}@${String(manifest.version)}, and the record is ${record.id}@${record.version}.`,
    );
  }
  const expected = new Map(files.map((f) => [f.path, f.data] as const));
  const keptFiles = new Set([INSTALLED_ARTIFACT_FILE, ...(signature === null ? [] : [INSTALLED_SIGNATURE_FILE])]);
  const tree = walkTree(record.dir);
  const problems: string[] = tree.odd.map((p) => `${p}: not a regular file`);
  for (const path of tree.files) {
    if (keptFiles.has(path)) continue;
    const data = expected.get(path);
    if (data === undefined) problems.push(`${path}: not in the artifact`);
    else if (!sameBytes(new Uint8Array(readFileSync(join(record.dir, ...path.split('/')))), data)) problems.push(`${path}: differs from the artifact`);
  }
  const present = new Set(tree.files);
  for (const path of expected.keys()) if (!present.has(path)) problems.push(`${path}: missing`);
  if (problems.length > 0) {
    return refuse('tree_changed', `its install directory is not the signed artifact any more: ${problems.slice(0, 5).join('; ')}${problems.length > 5 ? `; and ${problems.length - 5} more` : ''}.`);
  }

  // 5. The tier dispatch point.
  const tier = dispatchPluginRuntime(manifest.runtime);
  if (!tier.ok) return refuse(tier.error, tier.message);

  const main = typeof manifest.main === 'string' && manifest.main.trim() ? manifest.main.trim() : DEFAULT_ENTRY;
  if (!safeEntryPath(main) || !expected.has(main)) {
    return refuse('entry_missing', `its entry module ${JSON.stringify(main)} is not a file of the artifact.`);
  }
  return { ok: true, value: { record, entry: join(record.dir, ...main.split('/')), signature } };
}

/** A check that threw on the install directory (unreadable, or changing while it was read). */
function unreadableInstall(record: PluginInstallationRecord, error: unknown): string {
  return `reading its install directory ${record.dir} failed (${thrownMessage(error)}), so it could not be verified and is not loaded.`;
}

/**
 * Every check of this module's header, for every installation this project
 * recorded in `environmentId`; imports nothing and changes nothing. An
 * installations file that cannot be read refuses every plugin (one refusal,
 * `records_unreadable`) rather than loading any.
 */
export async function verifyInstalledPlugins(input: VerifyInstalledPluginsInput): Promise<InstalledPluginsVerdict> {
  const out: InstalledPluginsVerdict = { verified: [], refused: [], disabled: [], uninstallPending: [] };
  let records: PluginInstallationRecord[];
  try {
    records = loadPluginInstallations(input.environmentId);
  } catch (error) {
    out.refused.push({ id: '*', version: '*', error: 'records_unreadable', message: thrownMessage(error) });
    return out;
  }
  if (records.length === 0) return out;
  // An unreadable disable-state file leaves "is it disabled?" unanswered, so
  // nothing that could be disabled is loaded: each is refused by name.
  let disabled = new Set<string>();
  let disabledUnreadable: string | null = null;
  try {
    disabled = installedPluginDisabledIds(input.environmentId);
  } catch (error) {
    disabledUnreadable = thrownMessage(error);
  }
  const pending: Array<{ record: PluginInstallationRecord; kept: { artifact: Uint8Array; signature: string | null; keyId: string | null } }> = [];
  for (const record of records) {
    if (!record || typeof record !== 'object') {
      out.refused.push({ id: '?', version: '?', error: 'records_unreadable', message: `an entry of this project's installations file is not a record (${JSON.stringify(record)}).` });
      continue;
    }
    if (expectedDir(input.environmentId, record) === null) {
      out.refused.push({
        id: String(record.id),
        version: String(record.version),
        error: 'install_dir_unexpected',
        message: unexpectedDir(input.environmentId, record),
      });
      continue;
    }
    if (record.status === 'uninstall-pending') {
      out.uninstallPending.push(record);
      continue;
    }
    if (disabledUnreadable !== null) {
      out.refused.push({
        id: record.id,
        version: record.version,
        error: 'disabled_state_unreadable',
        message: `this environment's disable-state file cannot be read (${disabledUnreadable}), so whether it is disabled is not known, and it is not loaded.`,
      });
      continue;
    }
    if (disabled.has(record.id)) {
      out.disabled.push(record);
      continue;
    }
    let kept: ReturnType<typeof readKept>;
    try {
      kept = readKept(record);
    } catch (error) {
      out.refused.push({ id: record.id, version: record.version, error: 'install_unreadable', message: unreadableInstall(record, error) });
      continue;
    }
    if (!kept.ok) {
      out.refused.push({ id: record.id, version: record.version, error: kept.error, message: kept.message });
      continue;
    }
    pending.push({ record, kept });
  }
  const keyIds = [...new Set(pending.map((p) => p.kept.keyId).filter((k): k is string => k !== null))];
  let keys: ReadonlyMap<string, TrustedKeyResolution> = new Map();
  let toCheck = pending;
  if (keyIds.length > 0) {
    try {
      keys = await input.resolveKeys(keyIds);
    } catch (error) {
      // No key could be read, so no signed install is verified: each is
      // refused by name, and an unsigned one is still checked below.
      const message = `this environment's trusted keys cannot be read: ${thrownMessage(error)}`;
      for (const { record, kept } of pending) {
        if (kept.keyId !== null) out.refused.push({ id: record.id, version: record.version, error: 'trusted_keys_unreadable', message });
      }
      toCheck = pending.filter((p) => p.kept.keyId === null);
    }
  }
  for (const { record, kept } of toCheck) {
    let checked: Check;
    try {
      checked = await checkRecord(record, kept, keys);
    } catch (error) {
      out.refused.push({ id: record.id, version: record.version, error: 'install_unreadable', message: unreadableInstall(record, error) });
      continue;
    }
    if (checked.ok) out.verified.push(checked.value);
    else out.refused.push({ id: record.id, version: record.version, error: checked.error, message: checked.message });
  }
  return out;
}

/** One plugin {@link loadInstalledPlugins} imported, ready for `kernel.use`. */
export interface LoadedInstalledPlugin {
  record: PluginInstallationRecord;
  plugin: unknown;
}

export interface InstalledPluginsLoad {
  loaded: LoadedInstalledPlugin[];
  refused: InstalledPluginRefusal[];
  disabled: PluginInstallationRecord[];
  /** Uninstalls finished this boot; `kept` when another project's record still names the directory. */
  removed: Array<{ record: PluginInstallationRecord; kept: boolean }>;
}

export interface LoadInstalledPluginsInput extends VerifyInstalledPluginsInput {
  /** Wrap a plain bundle default export into the plugin that registers it (the `plugins` entry rule). */
  wrapBundle(bundle: Record<string, unknown>): unknown | Promise<unknown>;
  /** The dynamic import, injectable for tests. */
  importModule?: (url: string) => Promise<unknown>;
  /**
   * A file URL of the host's own: a bare `@objectstack/*` specifier imported
   * from inside a verified install directory resolves as if this file imported
   * it (see the module header). Unset, the import resolves as Node resolves it
   * from the install directory.
   */
  resolveHostPackagesFrom?: string;
}

/**
 * The resolve hook behind `resolveHostPackagesFrom`, registered with
 * `module.register` as a `data:` module, so it needs no file of its own on disk.
 */
const HOST_PACKAGE_HOOKS = `
let roots = [];
let host = '';
export async function initialize(data) { roots = data.roots; host = data.host; }
function namesHostPackage(specifier) {
  if (!specifier.startsWith('@objectstack/') || /[%\\\\]/.test(specifier)) return false;
  return specifier.slice('@objectstack/'.length).split('/').every((s) => s !== '' && s !== '.' && s !== '..');
}
export async function resolve(specifier, context, next) {
  if (namesHostPackage(specifier) && typeof context.parentURL === 'string'
    && roots.some((root) => context.parentURL.startsWith(root))) {
    return next(specifier, { ...context, parentURL: host });
  }
  return next(specifier, context);
}
`;

/**
 * What a throw says, whatever was thrown: a plugin's top-level code or getter
 * can throw anything, `undefined` and `null` included, and reading `.message`
 * off that would throw in the catch meant to name it.
 */
function thrownMessage(error: unknown): string {
  try {
    return String(error instanceof Error ? error.message : error);
  } catch {
    return 'a value that cannot be printed';
  }
}

/** `dir`'s real path, or `dir` itself when it has none to read. */
function realPathOr(dir: string): string {
  try {
    return realpathSync(dir);
  } catch {
    return dir;
  }
}

/** The (host, install directory) pairs this process already registered the hook for. */
const HOST_RESOLUTION_REGISTERED = new Set<string>();

function resolveHostPackagesFor(dirs: readonly string[], host: string): void {
  const roots = [...new Set(dirs.flatMap((dir) => [dir, realPathOr(dir)]))]
    .map((dir) => `${pathToFileURL(dir).href}/`)
    .filter((root) => !HOST_RESOLUTION_REGISTERED.has(`${host} ${root}`));
  if (roots.length === 0) return;
  register(`data:text/javascript,${encodeURIComponent(HOST_PACKAGE_HOOKS)}`, { data: { roots, host } });
  for (const root of roots) HOST_RESOLUTION_REGISTERED.add(`${host} ${root}`);
}

/**
 * Finish the uninstall of `snapshot` under the installations lock, and only
 * while the record is still that marked one: an id installed again since this
 * boot read the records keeps its fresh directory and record. Answers `null`
 * when the record changed.
 */
function finishUninstall(environmentId: string | undefined, snapshot: PluginInstallationRecord): { kept: boolean } | null {
  return withPluginInstallationsLock(environmentId, () => {
    const current = loadPluginInstallations(environmentId).find((r) => r.id === snapshot.id);
    if (
      !current
      || current.status !== 'uninstall-pending'
      || current.dir !== snapshot.dir
      || current.artifact?.sha256 !== snapshot.artifact?.sha256
    ) {
      return null;
    }
    const sharedDirs = otherProjectsInstallationDirs(environmentId);
    const kept = sharedDirs === null || sharedDirs.has(current.dir);
    if (!kept) {
      rmSync(current.dir, { recursive: true, force: true });
      // The `<id>` directory goes with its last version.
      try {
        rmdirSync(dirname(current.dir));
      } catch {
        // not empty, or already gone
      }
    }
    dropPluginInstallation(environmentId, current.id);
    return { kept };
  });
}

/**
 * The checks on what an entry module exported, and the verdict recorded for
 * the kernel's loader; answers the refusal, or `null` when the plugin is ready.
 */
function inspectImported(record: PluginInstallationRecord, item: VerifiedInstalledPlugin, plugin: unknown): InstalledPluginRefusal | null {
  const refusal = (error: InstalledPluginRefusalCode, message: string): InstalledPluginRefusal => ({ id: record.id, version: record.version, error, message });
  if (!plugin || typeof plugin !== 'object' || typeof (plugin as { init?: unknown }).init !== 'function') {
    return refusal('not_a_plugin', `${item.entry} does not export a plugin (an object with \`init\`).`);
  }
  // The signature the artifact verified under rides on the plugin, and the
  // verdict that verified it is recorded for the kernel's loader, which
  // refuses a plugin that carries a signature nothing verified.
  const carried = (plugin as { signature?: unknown }).signature;
  if (item.signature === null && carried !== undefined) {
    return refusal('signature_conflict', 'the plugin declares a signature, and its artifact was installed unsigned (--trust-unsigned).');
  }
  if (item.signature !== null) {
    if (carried !== undefined && carried !== item.signature) {
      return refusal('signature_conflict', 'the plugin declares a signature other than the one its artifact verified under.');
    }
    try {
      (plugin as { signature?: string }).signature = item.signature;
    } catch {
      return refusal('signature_conflict', 'the plugin object cannot carry its verified signature (it is frozen).');
    }
  }
  recordPluginArtifactVerdict(plugin as object, {
    signature: item.signature,
    keyId: record.signature?.keyId ?? null,
    fingerprint: record.signature?.fingerprint ?? null,
    artifactSha256: record.artifact.sha256,
  });
  return null;
}

/**
 * Finish pending uninstalls, verify every other installation, and import each
 * one that passed through the rule a stack's `plugins` entry takes
 * (`materializeStackPlugin`). The host registers the answers with
 * `kernel.use`; a refused plugin is in `refused`, by name, and was not imported.
 */
export async function loadInstalledPlugins(input: LoadInstalledPluginsInput): Promise<InstalledPluginsLoad> {
  const verdict = await verifyInstalledPlugins(input);
  const out: InstalledPluginsLoad = { loaded: [], refused: [...verdict.refused], disabled: verdict.disabled, removed: [] };

  for (const record of verdict.uninstallPending) {
    let finished: { kept: boolean } | null;
    try {
      finished = finishUninstall(input.environmentId, record);
    } catch (error) {
      out.refused.push({
        id: record.id,
        version: record.version,
        error: 'uninstall_failed',
        message: `finishing its uninstall failed (${thrownMessage(error)}). Nothing of it was loaded; if its record is still marked, the next boot tries again.`,
      });
      continue;
    }
    if (finished === null) {
      out.refused.push({
        id: record.id,
        version: record.version,
        error: 'record_changed',
        message: 'its record changed while this boot read it (installed again, or its uninstall finished elsewhere). Nothing was removed or loaded; the next boot reads it again.',
      });
      continue;
    }
    out.removed.push({ record, kept: finished.kept });
  }

  const importModule = input.importModule ?? ((url: string) => import(/* webpackIgnore: true */ url));
  if (input.resolveHostPackagesFrom && verdict.verified.length > 0) {
    try {
      resolveHostPackagesFor(verdict.verified.map((v) => v.record.dir), input.resolveHostPackagesFrom);
    } catch {
      // No resolve hook (a runtime without `module.register`): a plugin that
      // imports `@objectstack/*` then fails its import, by name, below.
    }
  }
  for (const item of verdict.verified) {
    const { record } = item;
    let plugin: unknown;
    try {
      plugin = await materializeStackPlugin(pathToFileURL(item.entry).href, {
        importSpecifier: importModule,
        wrapBundle: input.wrapBundle,
      });
    } catch (error) {
      out.refused.push({ id: record.id, version: record.version, error: 'import_failed', message: `importing ${item.entry} failed: ${thrownMessage(error)}` });
      continue;
    }
    // The module's top-level code has run from here on. Reading what it
    // exported can still throw (a getter), which refuses it like a bad export.
    let refusal: InstalledPluginRefusal | null;
    try {
      refusal = inspectImported(record, item, plugin);
    } catch (error) {
      refusal = { id: record.id, version: record.version, error: 'not_a_plugin', message: `reading what ${item.entry} exports threw: ${thrownMessage(error)}` };
    }
    if (refusal) {
      out.refused.push(refusal);
      continue;
    }
    out.loaded.push({ record, plugin });
  }
  return out;
}
