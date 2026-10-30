// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#27123 slice 2] The boot-time loader for installed plugins (ADR-0025 §3.5
 * M1) and its tier dispatch point (§3.6), on a real temporary `OS_HOME`.
 *
 * Every install below is laid out the way `os plugin install` lays one out —
 * the unpacked files, the original artifact and its detached signature kept
 * beside them, and the record — and then one thing about it is changed.
 * Pinned: the untouched install loads, with its verified signature and the
 * host verdict the kernel's loader reads; each change is refused by its own
 * name and nothing of that plugin is imported; a disabled install is skipped;
 * an uninstall removes the directory unless another project still records it;
 * and only `runtime: 'node'` is ever imported. A throw on one installation
 * refuses that one by name, whatever was thrown. In a real Node process, a
 * bare `@objectstack/*` import resolves to the host's package, also through a
 * symbolic link, and a specifier that climbs out of `@objectstack/` does not.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, truncateSync, writeFileSync } from 'node:fs';
import { createPublicKey } from 'node:crypto';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { gzipSync } from 'node:zlib';

import { MAX_UNPACKED_ARTIFACT_BYTES, generateEd25519KeyPair, pluginArtifactVerdict, sha256Hex, signPayload } from '@objectstack/core';

import { dispatchPluginRuntime, loadInstalledPlugins, verifyInstalledPlugins } from './installed-plugin-loader.js';
import {
  INSTALLED_ARTIFACT_FILE,
  INSTALLED_SIGNATURE_FILE,
  installationsLockTestHooks,
  loadPluginInstallations,
  markPluginUninstall,
  pluginInstallDir,
  pluginInstallationsFile,
  recordPluginInstallation,
  setInstalledPluginDisabled,
  type PluginInstallationRecord,
} from './plugin-installation-store.js';
import { packageStateFileName } from './package-state-store.js';
import { publicKeyFingerprint, type TrustedKeyResolution } from './plugin-trusted-keys.js';

/**
 * A file-system call the test makes throw, by its operation and path; every
 * other call is the real one.
 */
const fsFaults = vi.hoisted(() => ({ fail: null as ((op: string, path: string) => string | null) | null }));
vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  const faulty = <F extends (...args: never[]) => unknown>(op: string, real: F): F =>
    ((...args: Parameters<F>) => {
      const code = fsFaults.fail?.(op, String(args[0]));
      if (code) throw Object.assign(new Error(`${code}: ${op} refused by the test, '${String(args[0])}'`), { code });
      return real(...args);
    }) as F;
  return {
    ...actual,
    readdirSync: faulty('readdir', actual.readdirSync),
    readFileSync: faulty('readFile', actual.readFileSync),
    rmSync: faulty('rm', actual.rmSync),
  };
});

const ENV = 'env_local';

let home: string;
const saved = { OS_HOME: process.env.OS_HOME };

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'os-installed-plugins-'));
  process.env.OS_HOME = home;
});

afterEach(() => {
  fsFaults.fail = null;
  delete installationsLockTestHooks.waitMs;
  if (saved.OS_HOME === undefined) delete process.env.OS_HOME;
  else process.env.OS_HOME = saved.OS_HOME;
  rmSync(home, { recursive: true, force: true });
});

// ── An artifact, as `os plugin build` writes one ──────────────────────────────

interface File {
  path: string;
  data: Uint8Array;
}

/** A minimal ustar writer: regular files, sorted, two zero blocks at the end. */
function tarGz(files: readonly File[]): Uint8Array {
  const octal = (h: Buffer, value: number, offset: number, len: number) =>
    h.write(value.toString(8).padStart(len - 1, '0') + '\0', offset, len, 'ascii');
  const chunks: Buffer[] = [];
  for (const f of [...files].sort((a, b) => (a.path < b.path ? -1 : 1))) {
    const h = Buffer.alloc(512, 0);
    h.write(f.path, 0, 100, 'utf8');
    octal(h, 0o644, 100, 8);
    octal(h, 0, 108, 8);
    octal(h, 0, 116, 8);
    octal(h, f.data.byteLength, 124, 12);
    octal(h, 0, 136, 12);
    h.write('        ', 148, 8, 'ascii');
    h.write('0', 156, 1, 'ascii');
    h.write('ustar\0', 257, 6, 'ascii');
    h.write('00', 263, 2, 'ascii');
    let sum = 0;
    for (let i = 0; i < 512; i++) sum += h[i];
    h.write(sum.toString(8).padStart(6, '0') + '\0 ', 148, 8, 'ascii');
    chunks.push(h, Buffer.from(f.data));
    const pad = (512 - (f.data.byteLength % 512)) % 512;
    if (pad) chunks.push(Buffer.alloc(pad, 0));
  }
  chunks.push(Buffer.alloc(1024, 0));
  return new Uint8Array(gzipSync(Buffer.concat(chunks)));
}

const text = (s: string) => new Uint8Array(Buffer.from(s, 'utf8'));

const PUBLISHER = generateEd25519KeyPair();
const STRANGER = generateEd25519KeyPair();
const KEY_ID = 'acme-2026';
const FINGERPRINT = publicKeyFingerprint(createPublicKey(PUBLISHER.publicKeyPem));

function activeKeys(over: Partial<Record<string, TrustedKeyResolution>> = {}) {
  const calls: string[][] = [];
  const resolveKeys = async (keyIds: readonly string[]) => {
    calls.push([...keyIds]);
    const out = new Map<string, TrustedKeyResolution>();
    for (const id of keyIds) {
      out.set(
        id,
        over[id] ?? (id === KEY_ID
          ? {
            verdict: 'active',
            row: { key_id: id, public_key: PUBLISHER.publicKeyPem, fingerprint: FINGERPRINT, source: 'local', status: 'active', added_by: null, added_at: 'then' },
            publicKey: createPublicKey(PUBLISHER.publicKeyPem),
          }
          : { verdict: 'unknown' }),
      );
    }
    return out;
  };
  return { resolveKeys, calls };
}

interface InstallOptions {
  id?: string;
  version?: string;
  manifest?: Record<string, unknown>;
  entry?: string;
  extraFiles?: File[];
  /** `false`: an unsigned install under `--trust-unsigned`. */
  signed?: boolean;
  keyId?: string;
  privateKeyPem?: string;
}

/** Lay an install out on disk and record it, exactly as `os plugin install` does. */
function install(o: InstallOptions = {}): PluginInstallationRecord & { artifactBytes: Uint8Array } {
  const id = o.id ?? 'com.acme.hello';
  const version = o.version ?? '1.0.0';
  const manifest = { id, version, name: 'Hello', type: 'plugin', runtime: 'node', ...o.manifest };
  const entry = o.entry ?? `export default { name: ${JSON.stringify(id)}, version: '1.0.0', init() { globalThis.__initCount = (globalThis.__initCount ?? 0) + 1; } };\n`;
  const files: File[] = [
    { path: 'objectstack.plugin.json', data: text(JSON.stringify(manifest)) },
    { path: 'dist/index.mjs', data: text(entry) },
    ...(o.extraFiles ?? []),
  ];
  const artifact = tarGz(files);
  const signed = o.signed ?? true;
  const signature = signed ? signPayload(artifact, o.privateKeyPem ?? PUBLISHER.privateKeyPem, o.keyId ?? KEY_ID) : null;
  const dir = pluginInstallDir(ENV, id, version);
  mkdirSync(dir, { recursive: true });
  for (const f of files) {
    mkdirSync(dirname(join(dir, f.path)), { recursive: true });
    writeFileSync(join(dir, f.path), f.data);
  }
  writeFileSync(join(dir, INSTALLED_ARTIFACT_FILE), artifact);
  if (signature !== null) writeFileSync(join(dir, INSTALLED_SIGNATURE_FILE), `${signature}\n`);
  const record: PluginInstallationRecord = {
    id,
    version,
    versionId: `${id}@${version}`,
    runtime: typeof manifest.runtime === 'string' ? manifest.runtime : null,
    status: 'installed',
    grantedPermissions: null,
    dir,
    artifact: { file: INSTALLED_ARTIFACT_FILE, sha256: sha256Hex(artifact) },
    signatureFile: signature === null ? null : INSTALLED_SIGNATURE_FILE,
    signature: signature === null ? null : { keyId: o.keyId ?? KEY_ID, fingerprint: FINGERPRINT },
    trustUnsigned: signature === null,
    installedAt: '2026-10-29T00:00:00.000Z',
  };
  recordPluginInstallation(ENV, record);
  return { ...record, artifactBytes: artifact };
}

/** Load, with the module import counted, so a refusal can be shown to import nothing. */
async function load(resolveKeys = activeKeys().resolveKeys) {
  const imported: string[] = [];
  const result = await loadInstalledPlugins({
    environmentId: ENV,
    resolveKeys,
    wrapBundle: (bundle) => ({ name: 'wrapped', init() {}, bundle }),
    importModule: async (url) => {
      imported.push(url);
      return import(/* @vite-ignore */ url);
    },
  });
  return { ...result, imported };
}

function rewriteRecord(id: string, change: (r: PluginInstallationRecord) => PluginInstallationRecord) {
  const file = pluginInstallationsFile(ENV);
  const installs = loadPluginInstallations(ENV).map((r) => (r.id === id ? change(r) : r));
  writeFileSync(file, JSON.stringify({ installations: installs }));
}

// ── The cases ────────────────────────────────────────────────────────────────

describe('dispatchPluginRuntime — the tier dispatch point (ADR-0025 §3.6)', () => {
  it('dispatches node, and refuses every other tier and an undeclared one by name', () => {
    expect(dispatchPluginRuntime('node')).toEqual({ ok: true, tier: 'node' });
    for (const tier of ['sandbox', 'worker', 'isolated']) {
      expect(dispatchPluginRuntime(tier)).toMatchObject({ ok: false, error: 'runtime_not_dispatched' });
    }
    for (const unset of [undefined, null, '']) {
      expect(dispatchPluginRuntime(unset)).toMatchObject({ ok: false, error: 'runtime_undeclared' });
    }
    expect((dispatchPluginRuntime('sandbox') as { message: string }).message).toMatch(/M3/);
  });
});

describe('an untouched install loads', () => {
  it('imports the signed node plugin once, carrying its verified signature and the host verdict', async () => {
    const r = install();
    const keys = activeKeys();
    const out = await load(keys.resolveKeys);
    expect(out.refused).toEqual([]);
    expect(out.loaded).toHaveLength(1);
    const plugin = out.loaded[0].plugin as { name: string; init: unknown; signature: string };
    expect(plugin.name).toBe('com.acme.hello');
    expect(typeof plugin.init).toBe('function');
    const sig = readFileSync(join(r.dir, INSTALLED_SIGNATURE_FILE), 'utf8').trim();
    expect(plugin.signature).toBe(sig);
    expect(pluginArtifactVerdict(plugin)).toEqual({
      signature: sig,
      keyId: KEY_ID,
      fingerprint: FINGERPRINT,
      artifactSha256: sha256Hex(r.artifactBytes),
    });
    // One trust read for every signed install.
    expect(keys.calls).toEqual([[KEY_ID]]);
  });

  it('loads an unsigned --trust-unsigned install without reading the trusted keys', async () => {
    install({ signed: false });
    const keys = activeKeys();
    const out = await load(keys.resolveKeys);
    expect(out.refused).toEqual([]);
    expect(out.loaded).toHaveLength(1);
    expect(out.loaded[0].record.trustUnsigned).toBe(true);
    expect(pluginArtifactVerdict(out.loaded[0].plugin as object)).toMatchObject({ signature: null, keyId: null });
    expect(keys.calls).toEqual([]);
  });

  it('wraps a plain bundle default export, the rule a stack `plugins` entry takes', async () => {
    install({ entry: "export default { objects: [] };\n" });
    const out = await load();
    expect(out.refused).toEqual([]);
    expect((out.loaded[0].plugin as { name: string }).name).toBe('wrapped');
  });

  it('reads no installations file into existence when there is none', async () => {
    const out = await load();
    expect(out).toMatchObject({ loaded: [], refused: [], disabled: [], removed: [] });
    expect(existsSync(pluginInstallationsFile(ENV))).toBe(false);
  });
});

describe('every change to an install refuses that plugin by name and imports nothing of it', () => {
  type Case = [label: string, error: string, arrange: () => { resolveKeys?: ReturnType<typeof activeKeys>['resolveKeys'] } | void];
  const cases: Case[] = [
    ['the record names another directory', 'install_dir_unexpected', () => {
      install();
      rewriteRecord('com.acme.hello', (r) => ({ ...r, dir: join(home, 'elsewhere') }));
    }],
    ['the install directory is gone', 'install_dir_missing', () => {
      rmSync(install().dir, { recursive: true });
    }],
    ['the kept artifact was replaced', 'artifact_changed', () => {
      const r = install();
      writeFileSync(join(r.dir, INSTALLED_ARTIFACT_FILE), 'other bytes');
    }],
    ['the kept signature is gone', 'signature_missing', () => {
      rmSync(join(install().dir, INSTALLED_SIGNATURE_FILE));
    }],
    ['the kept signature is malformed', 'signature_malformed', () => {
      writeFileSync(join(install().dir, INSTALLED_SIGNATURE_FILE), 'not a signature');
    }],
    ['the kept signature names another key id', 'signature_key_mismatch', () => {
      const r = install();
      writeFileSync(join(r.dir, INSTALLED_SIGNATURE_FILE), signPayload(r.artifactBytes, PUBLISHER.privateKeyPem, 'other-key'));
    }],
    ['the key is no longer trusted', 'signature_key_untrusted', () => {
      install();
      return { resolveKeys: activeKeys({ [KEY_ID]: { verdict: 'unknown' } }).resolveKeys };
    }],
    ['the key was revoked since install', 'signature_key_revoked', () => {
      install();
      return {
        resolveKeys: activeKeys({
          [KEY_ID]: { verdict: 'revoked', row: { key_id: KEY_ID, public_key: '', fingerprint: FINGERPRINT, source: 'local', status: 'revoked', added_by: null, added_at: 'then' } },
        }).resolveKeys,
      };
    }],
    ['the trusted key row cannot verify', 'trusted_key_invalid', () => {
      install();
      return {
        resolveKeys: activeKeys({
          [KEY_ID]: { verdict: 'invalid', message: 'bad', row: { key_id: KEY_ID, public_key: '', fingerprint: FINGERPRINT, source: 'local', status: 'active', added_by: null, added_at: 'then' } },
        }).resolveKeys,
      };
    }],
    ['the key id now names another key', 'trusted_key_changed', () => {
      install();
      return {
        resolveKeys: activeKeys({
          [KEY_ID]: {
            verdict: 'active',
            row: { key_id: KEY_ID, public_key: STRANGER.publicKeyPem, fingerprint: publicKeyFingerprint(createPublicKey(STRANGER.publicKeyPem)), source: 'local', status: 'active', added_by: null, added_at: 'then' },
            publicKey: createPublicKey(STRANGER.publicKeyPem),
          },
        }).resolveKeys,
      };
    }],
    ['the signature was made by another key under the same id', 'signature_invalid', () => {
      const r = install();
      writeFileSync(join(r.dir, INSTALLED_SIGNATURE_FILE), signPayload(r.artifactBytes, STRANGER.privateKeyPem, KEY_ID));
    }],
    ['the trusted keys cannot be read', 'trusted_keys_unreadable', () => {
      install();
      return { resolveKeys: async () => { throw new Error('database is down'); } };
    }],
    ['the record is unsigned without the override', 'unsigned_without_override', () => {
      install({ signed: false });
      rewriteRecord('com.acme.hello', (r) => ({ ...r, trustUnsigned: false }));
    }],
    ['an unpacked file was edited', 'tree_changed', () => {
      writeFileSync(join(install().dir, 'dist', 'index.mjs'), 'export default { name: "evil", init() {} };\n');
    }],
    ['a file was added beside the unpacked tree', 'tree_changed', () => {
      writeFileSync(join(install().dir, 'dist', 'extra.mjs'), 'export {};\n');
    }],
    ['an unpacked file was removed', 'tree_changed', () => {
      install({ extraFiles: [{ path: 'assets/a.txt', data: text('a') }] });
      rmSync(join(pluginInstallDir(ENV, 'com.acme.hello', '1.0.0'), 'assets', 'a.txt'));
    }],
    ['a symbolic link sits in the tree', 'tree_changed', () => {
      symlinkSync('/etc/hostname', join(install().dir, 'link'));
    }],
    ['the kept artifact is another version than the record', 'manifest_mismatch', () => {
      install({ manifest: { version: '2.0.0' } });
    }],
    ['the manifest carries the retired packaging: manifest-deps', 'manifest_invalid', () => {
      install({ manifest: { packaging: 'manifest-deps' } });
    }],
    ['the manifest is not a ManifestSchema manifest (no type)', 'manifest_invalid', () => {
      install({ manifest: { type: undefined } });
    }],
    ['the kept artifact is not an archive', 'artifact_unreadable', () => {
      const r = install({ signed: false });
      writeFileSync(join(r.dir, INSTALLED_ARTIFACT_FILE), 'not gzip');
      rewriteRecord('com.acme.hello', (x) => ({ ...x, artifact: { ...x.artifact, sha256: sha256Hex(text('not gzip')) } }));
    }],
    ['the manifest declares runtime: sandbox', 'runtime_not_dispatched', () => {
      install({ manifest: { runtime: 'sandbox' } });
    }],
    ['the manifest declares runtime: worker', 'runtime_not_dispatched', () => {
      install({ manifest: { runtime: 'worker' } });
    }],
    ['the manifest declares no runtime', 'runtime_undeclared', () => {
      install({ manifest: { runtime: undefined } });
    }],
    ['the entry module is not in the artifact', 'entry_missing', () => {
      install({ manifest: { main: 'dist/missing.mjs' } });
    }],
    ['the entry module escapes the install directory', 'entry_missing', () => {
      install({ manifest: { main: '../../outside.mjs' } });
    }],
  ];

  it.each(cases)('%s → %s', async (_label, error, arrange) => {
    (globalThis as { __initCount?: number }).__initCount = 0;
    const over = arrange() ?? {};
    const out = await load(over.resolveKeys);
    expect(out.loaded).toEqual([]);
    expect(out.imported).toEqual([]);
    expect(out.refused).toHaveLength(1);
    expect(out.refused[0]).toMatchObject({ id: 'com.acme.hello', version: '1.0.0', error });
    expect(out.refused[0].message.length).toBeGreaterThan(10);
  });

  it('refuses every plugin, by one named refusal, when the installations file cannot be read', async () => {
    install();
    writeFileSync(pluginInstallationsFile(ENV), '{ not json');
    const out = await load();
    expect(out.loaded).toEqual([]);
    expect(out.refused).toEqual([expect.objectContaining({ id: '*', error: 'records_unreadable' })]);
  });

  it("a pre-retirement artifact (packaging: 'manifest-deps') is refused with the schema's prescription, never imported; the next plugin still loads", async () => {
    install({ id: 'com.acme.retired', manifest: { packaging: 'manifest-deps' } });
    install({ id: 'com.acme.fine' });
    const out = await load();
    expect(out.refused).toEqual([expect.objectContaining({ id: 'com.acme.retired', error: 'manifest_invalid' })]);
    // The schema's own words: the retired value, and the remedy it prescribes.
    expect(out.refused[0].message).toMatch(/packaging: `packaging: 'manifest-deps'` was removed/);
    expect(out.refused[0].message).toMatch(/Delete the key/);
    // Only the valid plugin's entry module was imported.
    expect(out.imported).toHaveLength(1);
    expect(out.imported[0]).toContain('com.acme.fine');
    expect(out.loaded.map((l) => l.record.id)).toEqual(['com.acme.fine']);
  });

  it('refuses one plugin and still loads the next', async () => {
    install({ id: 'com.acme.sandboxed', manifest: { runtime: 'sandbox' } });
    install({ id: 'com.acme.fine' });
    const out = await load();
    expect(out.refused.map((r) => [r.id, r.error])).toEqual([['com.acme.sandboxed', 'runtime_not_dispatched']]);
    expect(out.loaded.map((l) => l.record.id)).toEqual(['com.acme.fine']);
  });
});

describe('what the import answers', () => {
  it.each([
    ['the import throws', 'import_failed', 'throw new Error("broken at import");\n'],
    ['the module exports no plugin', 'not_a_plugin', 'export default 42;\n'],
    ['the plugin declares another signature', 'signature_conflict', 'export default { name: "x", init() {}, signature: "ed25519:other:AAAA" };\n'],
    ['the plugin object is frozen', 'signature_conflict', 'export default Object.freeze({ name: "x", init() {} });\n'],
    ['reading the export throws', 'not_a_plugin', 'export default { name: "x", init() {}, get signature() { throw new Error("getter"); } };\n'],
    ['the import throws undefined', 'import_failed', 'throw undefined;\n'],
    ['reading the export throws null', 'not_a_plugin', 'export default { name: "x", init() {}, get signature() { throw null; } };\n'],
    // A template literal throws on a Symbol, so the message is converted too.
    ['the import throws an Error whose message is a Symbol', 'import_failed', 'throw Object.assign(new Error(), { message: Symbol("odd") });\n'],
  ])('%s → %s', async (_label, error, entry) => {
    install({ entry });
    const out = await load();
    expect(out.loaded).toEqual([]);
    expect(out.refused).toEqual([expect.objectContaining({ id: 'com.acme.hello', error })]);
  });

  it('an unsigned install whose plugin declares a signature → signature_conflict', async () => {
    install({ signed: false, entry: 'export default { name: "x", init() {}, signature: "ed25519:acme:AAAA" };\n' });
    const out = await load();
    expect(out.refused).toEqual([expect.objectContaining({ error: 'signature_conflict' })]);
  });
});

describe('disable and uninstall', () => {
  it('skips a disabled install before reading anything of it', async () => {
    const r = install();
    rmSync(join(r.dir, INSTALLED_ARTIFACT_FILE));
    setInstalledPluginDisabled(ENV, r.id, true);
    const keys = activeKeys();
    const out = await load(keys.resolveKeys);
    expect(out.loaded).toEqual([]);
    expect(out.refused).toEqual([]);
    expect(out.disabled.map((d) => d.id)).toEqual([r.id]);
    expect(keys.calls).toEqual([]);
  });

  it('finishes an uninstall: removes the directory and its empty parent, drops the record, imports nothing', async () => {
    const r = install();
    markPluginUninstall(ENV, r.id);
    setInstalledPluginDisabled(ENV, r.id, true);
    const out = await load();
    expect(out.removed).toEqual([expect.objectContaining({ kept: false })]);
    expect(out.loaded).toEqual([]);
    expect(out.imported).toEqual([]);
    expect(existsSync(r.dir)).toBe(false);
    expect(existsSync(dirname(r.dir))).toBe(false);
    expect(loadPluginInstallations(ENV)).toEqual([]);
    // The drop forgets the disable, so a later install starts enabled.
    const again = install();
    expect((await load()).loaded.map((l) => l.record.id)).toEqual([again.id]);
  });

  it('keeps a directory another project in this environment still records', async () => {
    const r = install();
    const other = join(dirname(pluginInstallationsFile(ENV)), packageStateFileName(ENV, join(home, 'other-project')));
    writeFileSync(other, JSON.stringify({ installations: [{ ...r, artifactBytes: undefined }] }));
    markPluginUninstall(ENV, r.id);
    const out = await load();
    expect(out.removed).toEqual([expect.objectContaining({ kept: true })]);
    expect(existsSync(join(r.dir, INSTALLED_ARTIFACT_FILE))).toBe(true);
    expect(loadPluginInstallations(ENV)).toEqual([]);
  });

  it('removes nothing under a directory the record does not own', async () => {
    const r = install();
    const victim = join(home, 'victim');
    mkdirSync(victim);
    writeFileSync(join(victim, 'keep.txt'), 'keep');
    markPluginUninstall(ENV, r.id);
    rewriteRecord(r.id, (x) => ({ ...x, dir: victim }));
    const out = await load();
    expect(out.removed).toEqual([]);
    expect(out.refused).toEqual([expect.objectContaining({ error: 'install_dir_unexpected' })]);
    expect(readFileSync(join(victim, 'keep.txt'), 'utf8')).toBe('keep');
  });
});

describe('verifyInstalledPlugins changes nothing', () => {
  it('answers the verdict without importing, removing or dropping', async () => {
    const r = install();
    install({ id: 'com.acme.gone' });
    markPluginUninstall(ENV, 'com.acme.gone');
    const verdict = await verifyInstalledPlugins({ environmentId: ENV, resolveKeys: activeKeys().resolveKeys });
    expect(verdict.verified.map((v) => v.record.id)).toEqual([r.id]);
    expect(verdict.verified[0].entry).toBe(join(r.dir, 'dist', 'index.mjs'));
    expect(verdict.uninstallPending.map((u) => u.id)).toEqual(['com.acme.gone']);
    expect(existsSync(pluginInstallDir(ENV, 'com.acme.gone', '1.0.0'))).toBe(true);
    expect(loadPluginInstallations(ENV)).toHaveLength(2);
  });
});

describe('a throw on one installation refuses it by name, and the boot goes on', () => {
  it('an install directory that cannot be listed → install_unreadable; the next plugin still loads', async () => {
    const locked = install({ id: 'com.acme.locked' });
    install({ id: 'com.acme.fine' });
    fsFaults.fail = (op, path) => (op === 'readdir' && path === locked.dir ? 'EACCES' : null);
    const out = await load();
    expect(out.refused).toEqual([expect.objectContaining({ id: 'com.acme.locked', error: 'install_unreadable' })]);
    expect(out.refused[0].message).toContain('EACCES');
    expect(out.loaded.map((l) => l.record.id)).toEqual(['com.acme.fine']);
    expect(out.imported).toHaveLength(1);
  });

  it('a file that vanishes between the walk and its read → install_unreadable, nothing imported', async () => {
    const r = install();
    fsFaults.fail = (op, path) => (op === 'readFile' && path === join(r.dir, 'dist', 'index.mjs') ? 'ENOENT' : null);
    const out = await load();
    expect(out.refused).toEqual([expect.objectContaining({ id: r.id, error: 'install_unreadable' })]);
    expect(out.imported).toEqual([]);
  });

  it('a disable-state file that cannot be parsed → disabled_state_unreadable for each plugin, none loaded', async () => {
    const a = install({ id: 'com.acme.a' });
    const b = install({ id: 'com.acme.b' });
    setInstalledPluginDisabled(ENV, a.id, true);
    const stateDir = join(home, 'package-state');
    const [stateFile] = readdirSync(stateDir);
    writeFileSync(join(stateDir, stateFile), '{ not json');
    const out = await load();
    expect(out.refused.map((r) => [r.id, r.error])).toEqual([[a.id, 'disabled_state_unreadable'], [b.id, 'disabled_state_unreadable']]);
    expect(out.imported).toEqual([]);
    // And a disable or enable writes nothing over the file it could not read.
    expect(() => setInstalledPluginDisabled(ENV, b.id, true)).toThrow(/cannot be read/);
    expect(readFileSync(join(stateDir, stateFile), 'utf8')).toBe('{ not json');
  });

  it('an uninstall whose directory cannot be removed → uninstall_failed; the record stays marked and the next boot finishes it', async () => {
    const r = install();
    markPluginUninstall(ENV, r.id);
    fsFaults.fail = (op, path) => (op === 'rm' && path === r.dir ? 'EBUSY' : null);
    const out = await load();
    expect(out.removed).toEqual([]);
    expect(out.refused).toEqual([expect.objectContaining({ id: r.id, error: 'uninstall_failed' })]);
    expect(loadPluginInstallations(ENV)).toEqual([expect.objectContaining({ id: r.id, status: 'uninstall-pending' })]);
    fsFaults.fail = null;
    const again = await load();
    expect(again.removed).toEqual([expect.objectContaining({ kept: false })]);
    expect(existsSync(r.dir)).toBe(false);
  });

  it('an uninstall the installations lock is held over past the wait → uninstall_failed, nothing removed', async () => {
    const r = install();
    markPluginUninstall(ENV, r.id);
    const lock = `${pluginInstallationsFile(ENV)}.lock`;
    writeFileSync(lock, JSON.stringify({ pid: process.ppid, thread: 0, token: 'another-writer', at: new Date().toISOString() }));
    installationsLockTestHooks.waitMs = 200;
    const out = await load();
    expect(out.refused).toEqual([expect.objectContaining({ id: r.id, error: 'uninstall_failed' })]);
    expect(out.refused[0].message).toMatch(/locked by process/);
    expect(existsSync(r.dir)).toBe(true);
    expect(readFileSync(lock, 'utf8')).toContain('another-writer');
    rmSync(lock);
  });

  it('an id installed again after this boot read the records keeps its fresh install → record_changed', async () => {
    const gone = install({ id: 'com.acme.gone' });
    markPluginUninstall(ENV, gone.id);
    install({ id: 'com.acme.signed' });
    const keys = activeKeys();
    // The trusted-key read happens after the records were read and before
    // any uninstall is finished: the window an install can land in.
    const out = await load(async (ids) => {
      install({ id: 'com.acme.gone' });
      return keys.resolveKeys(ids);
    });
    expect(out.removed).toEqual([]);
    expect(out.refused).toEqual([expect.objectContaining({ id: gone.id, error: 'record_changed' })]);
    expect(existsSync(join(gone.dir, INSTALLED_ARTIFACT_FILE))).toBe(true);
    expect(loadPluginInstallations(ENV).find((r) => r.id === gone.id)?.status).toBe('installed');
    // The next boot reads the fresh install and loads it.
    expect((await load()).loaded.map((l) => l.record.id).sort()).toEqual(['com.acme.gone', 'com.acme.signed']);
  });

  it('a module whose top level throws undefined is refused by name, and the next plugin still loads', async () => {
    install({ id: 'com.acme.throws', entry: 'throw undefined;\n' });
    install({ id: 'com.acme.fine' });
    const out = await load();
    expect(out.refused).toEqual([expect.objectContaining({ id: 'com.acme.throws', error: 'import_failed' })]);
    expect(out.refused[0].message).toMatch(/failed: undefined$/);
    expect(out.loaded.map((l) => l.record.id)).toEqual(['com.acme.fine']);
  });

  it('an uninstall whose installations lock cannot be read → uninstall_failed naming it, at once; the next plugin still loads', async () => {
    const r = install({ id: 'com.acme.gone' });
    markPluginUninstall(ENV, r.id);
    install({ id: 'com.acme.fine' });
    const lock = `${pluginInstallationsFile(ENV)}.lock`;
    writeFileSync(lock, JSON.stringify({ pid: process.ppid, thread: 0, token: 'unreadable', at: new Date().toISOString() }));
    fsFaults.fail = (op, path) => (op === 'readFile' && path === lock ? 'EACCES' : null);
    const t0 = Date.now();
    const out = await load();
    expect(Date.now() - t0).toBeLessThan(5_000);
    expect(out.refused).toEqual([expect.objectContaining({ id: r.id, error: 'uninstall_failed' })]);
    expect(out.refused[0].message).toMatch(/installations lock .* cannot be read \(EACCES/);
    expect(out.loaded.map((l) => l.record.id)).toEqual(['com.acme.fine']);
    expect(existsSync(r.dir)).toBe(true);
  });

  it('a kept artifact larger than any artifact an install accepts → artifact_changed, and it is never read', async () => {
    const r = install();
    const kept = join(r.dir, INSTALLED_ARTIFACT_FILE);
    truncateSync(kept, MAX_UNPACKED_ARTIFACT_BYTES + 1); // sparse: no bytes are written
    let reads = 0;
    fsFaults.fail = (op, path) => {
      if (op === 'readFile' && path === kept) reads += 1;
      return null;
    };
    const out = await load();
    expect(out.refused).toEqual([expect.objectContaining({ id: r.id, error: 'artifact_changed' })]);
    expect(out.refused[0].message).toContain('more than any artifact an install accepts');
    expect(reads).toBe(0);
    expect(out.imported).toEqual([]);
  });
});

describe('what an installed plugin imports resolves to, in a real Node process', () => {
  // `module.register`'s resolve hook acts on Node's own loader, which this test
  // runner's module graph does not go through: a child process boots instead.
  const subject = pathToFileURL(join(dirname(fileURLToPath(import.meta.url)), 'installed-plugin-loader.ts')).href;
  // The host file: `@objectstack/core` and `zod` both resolve from this package.
  const host = subject;
  const script = [
    'const [subject, home, host] = process.argv.slice(1);',
    'process.env.OS_HOME = home;',
    'const { loadInstalledPlugins } = await import(subject);',
    'const out = await loadInstalledPlugins({ environmentId: "env_local", resolveKeys: async () => new Map(),',
    '  wrapBundle: (bundle) => bundle, resolveHostPackagesFrom: host });',
    'console.log(JSON.stringify({ loaded: out.loaded.map((l) => [l.record.id, l.plugin.seen]),',
    '  refused: out.refused.map((r) => [r.id, r.error, r.message]) }));',
  ].join('\n');

  function bootInChild(osHome: string): { loaded: [string, unknown][]; refused: [string, string, string][] } {
    const child = spawnSync(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', script, subject, osHome, host], {
      cwd: process.cwd(),
      encoding: 'utf8',
      env: { PATH: process.env.PATH ?? '', HOME: osHome, ...(process.env.TMPDIR ? { TMPDIR: process.env.TMPDIR } : {}) },
      timeout: 90_000,
    });
    expect(child.status, child.stderr).toBe(0);
    return JSON.parse(child.stdout.trim().split('\n').pop() as string);
  }

  it('a bare @objectstack/* import resolves to the host\'s package, also when OS_HOME is reached through a symbolic link', () => {
    // Node names an importing module by its real path; the hook's roots must
    // match it, not only the path the install directory was reached by.
    const link = `${home}-link`;
    symlinkSync(home, link);
    try {
      process.env.OS_HOME = link;
      install({
        id: 'com.acme.core-user',
        signed: false,
        entry: 'import { sha256Hex } from "@objectstack/core";\nexport default { name: "core-user", init() {}, seen: sha256Hex(new Uint8Array([1])).length };\n',
      });
      expect(bootInChild(link)).toEqual({ loaded: [['com.acme.core-user', 64]], refused: [] });
    } finally {
      process.env.OS_HOME = home;
      rmSync(link);
    }
  }, 120_000);

  it('a specifier that climbs out of @objectstack/ is not redirected to the host', () => {
    // From the host, `@objectstack/../zod/package.json` is this package's
    // `node_modules/zod/package.json`: redirected, it would load.
    install({
      id: 'com.acme.climber',
      signed: false,
      entry: 'import pkg from "@objectstack/../zod/package.json" with { type: "json" };\nexport default { name: "climber", init() {}, seen: pkg.name };\n',
    });
    const out = bootInChild(home);
    expect(out.loaded).toEqual([]);
    expect(out.refused).toEqual([['com.acme.climber', 'import_failed', expect.stringContaining('@objectstack/..')]]);
  }, 120_000);
});
