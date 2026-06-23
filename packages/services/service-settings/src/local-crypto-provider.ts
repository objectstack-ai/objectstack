// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import type {
  CryptoContext,
  CryptoHandle,
  ICryptoProvider,
} from '@objectstack/spec/contracts';
import { createHash, randomBytes, createCipheriv, createDecipheriv } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

/**
 * LocalCryptoProvider — the default, KMS-free `ICryptoProvider`. It is an
 * AES-256-GCM provider keyed off a single 32-byte data key, suitable for
 * single-operator / self-host deployments where a managed KMS or Vault is
 * overkill. KMS / Vault providers (per-tenant keys, automatic rotation,
 * managed custody) plug in behind the same `ICryptoProvider` seam.
 *
 * Key resolution (first match wins):
 *
 *   1. `opts.key`                     — explicit Buffer (tests / embedders).
 *   2. `OS_SECRET_KEY`                — canonical production master key
 *                                       (32-byte hex or base64).
 *   3. `OS_DEV_CRYPTO_KEY`            — dev convenience key (legacy
 *      (legacy `OBJECTSTACK_DEV_CRYPTO_KEY`)  `OBJECTSTACK_DEV_CRYPTO_KEY`
 *                                       still honoured).
 *   4. Persisted file                 — `~/.objectstack/dev-crypto-key`
 *                                       (mode 0600). In development it is
 *                                       auto-created; in production it is
 *                                       only *read* unless `OS_CRYPTO_AUTOKEY`
 *                                       opts the single-node self-host case
 *                                       into minting + persisting it too.
 *   5. Ephemeral random key           — development/test only.
 *
 * ## Fail-loud guarantee (the reason this class exists)
 *
 * The original provider would *silently* fall back to a fresh per-process
 * `randomBytes(32)` key whenever no env key and no readable file were
 * available — or auto-mint a new on-disk key on every boot. In an
 * ephemeral-FS container or a multi-node cluster that means each
 * restart / each node encrypts under a different key, and **every**
 * previously-written `sys_secret` value (encrypted settings, `secret`
 * fields, datasource credentials) becomes undecryptable. The failure was
 * invisible at encrypt and boot time and only surfaced later as
 * "all my saved passwords/API keys/DB creds fail to decrypt".
 *
 * To turn that silent data-loss into a config error at boot, the provider
 * REFUSES to mint a key in production: when `mode === 'production'` and no
 * stable key source (env var or pre-existing key file) is available, the
 * constructor throws an actionable error instead of generating one. The one
 * exception is the `OS_CRYPTO_AUTOKEY` opt-in: a single-node self-host
 * (`os start` on a durable filesystem) may mint + *persist* a key so the
 * zero-config quickstart boots — but even then the ephemeral fallback stays
 * forbidden, so a non-writable / ephemeral FS still fails loud rather than
 * running under a key that won't survive a restart. Development and test keep
 * the ergonomic fallback so local loops and unit tests stay frictionless.
 *
 * `mode` is auto-detected from `NODE_ENV` (`production` → strict;
 * `test`/`VITEST` → ephemeral, no disk; otherwise `development`) and can be
 * overridden via `opts.mode` for embedders that manage their own lifecycle.
 *
 * ## Handle format
 *   id        — `sec_` + 32 hex chars (122 bits of entropy)
 *   kmsKeyId  — `local:v<version>`
 *   alg       — `aes-256-gcm`
 *   version   — bumps on rotateKey()
 *   ciphertext— base64(iv (12) || authTag (16) || cipher)
 *
 * ## AAD binding
 * The CryptoContext (namespace + key) is folded into AES-GCM AAD so a
 * ciphertext rewrapped from a different (ns, key) tuple fails decryption —
 * guards against operators accidentally copying rows between namespaces.
 *
 * ## WebContainer (StackBlitz) note
 * `node:crypto.createCipheriv('aes-256-gcm', …)` is not implemented in
 * WebContainer. When we detect that runtime, we swap to a pure-JS AES-GCM
 * from `@noble/ciphers/aes.js`, producing the same `iv || tag || ciphertext`
 * byte layout so the handle shape is unchanged. The swap is best-effort: if
 * the dependency is missing, we fall back to the Node implementation and let
 * it throw, surfacing the configuration problem clearly.
 */
const SECRET_KEY_ENV = 'OS_SECRET_KEY';
const DEV_KEY_ENV = 'OS_DEV_CRYPTO_KEY';
const DEV_KEY_LEGACY_ENV = 'OBJECTSTACK_DEV_CRYPTO_KEY';
/**
 * Opt-in that lets the strict production path mint + PERSIST a key (but never
 * fall back to an ephemeral one). Set by `os start` for the single-node
 * self-host quickstart so the documented zero-config boot works out of the
 * box, while a real cluster deploy (which must provision `OS_SECRET_KEY`)
 * leaves it unset and keeps the fail-loud guarantee. See `commands/start.ts`.
 */
const AUTOKEY_ENV = 'OS_CRYPTO_AUTOKEY';

type EnvMap = Record<string, string | undefined>;

/** Where the provider resolved its data key from (for diagnostics). */
export type KeySource =
  | 'explicit'
  | 'env:OS_SECRET_KEY'
  | 'env:OS_DEV_CRYPTO_KEY'
  | 'file'
  | 'generated-file'
  | 'ephemeral';

export type CryptoMode = 'production' | 'development' | 'test';

export interface LocalCryptoProviderOptions {
  /** Explicit 32-byte data key. Overrides all env / file resolution. */
  key?: Buffer;
  /**
   * Env source. Defaults to `process.env`. Injectable so embedders and
   * tests can drive key resolution deterministically.
   */
  env?: EnvMap;
  /**
   * Deployment mode. Controls whether an ephemeral / auto-generated key is
   * tolerated. Defaults to auto-detection from `NODE_ENV`:
   *  - `production`  → a stable key (env var or pre-existing file) is
   *    REQUIRED; construction throws otherwise (fail loud).
   *  - `development` → persists an auto-generated key to disk so restarts
   *    reuse it; falls back to an ephemeral key (loud warning) if disk is
   *    unwritable.
   *  - `test`        → never touches disk; uses an ephemeral key silently.
   */
  mode?: CryptoMode;
}

const processEnv = (): EnvMap =>
  ((globalThis as { process?: { env?: EnvMap } }).process?.env ?? {}) as EnvMap;

const detectMode = (env: EnvMap): CryptoMode => {
  if (env.VITEST || env.NODE_ENV === 'test') return 'test';
  if (env.NODE_ENV === 'production') return 'production';
  return 'development';
};

/**
 * Per-user persistent key location. Honours `OS_HOME`
 * (legacy `OBJECTSTACK_HOME`) for projects that pin a non-default config dir.
 */
const keyFilePath = (env: EnvMap): string => {
  const home =
    env.OS_HOME ||
    env.OBJECTSTACK_HOME ||
    (env.HOME ? join(env.HOME, '.objectstack') : undefined) ||
    join(homedir(), '.objectstack');
  return join(home, 'dev-crypto-key');
};

/**
 * Parse an env key value (hex or base64) into a 32-byte Buffer. Returns
 * `undefined` when the value is unusable so the caller can decide whether to
 * fall through (dev) or throw (production / explicit master key).
 */
const parseKey = (raw: string | undefined): Buffer | undefined => {
  if (!raw) return undefined;
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  // hex: 64 chars of [0-9a-f]
  if (/^[0-9a-fA-F]{64}$/.test(trimmed)) return Buffer.from(trimmed, 'hex');
  // base64 (standard or url-safe): decode and check length
  try {
    const normalised = trimmed.replace(/-/g, '+').replace(/_/g, '/');
    const buf = Buffer.from(normalised, 'base64');
    if (buf.length === 32) return buf;
  } catch {
    /* fall through */
  }
  return undefined;
};

/** Truthy env flag: `1` / `true` / `yes` (case-insensitive). */
const parseBool = (raw: string | undefined): boolean => {
  const v = raw?.trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes';
};

/** Read an existing key file (no creation). Returns `undefined` on miss / IO error. */
const loadExistingKey = (path: string): Buffer | undefined => {
  try {
    if (!existsSync(path)) return undefined;
    return parseKey(readFileSync(path, 'utf8').trim());
  } catch {
    return undefined;
  }
};

/**
 * Load (or generate-then-persist) the key file. Returns `undefined` on any
 * I/O error so the caller can degrade to an ephemeral key without breaking
 * boot. Only used in development.
 */
const loadOrCreateKey = (path: string): { key: Buffer; generated: boolean } | undefined => {
  try {
    const existing = loadExistingKey(path);
    if (existing) return { key: existing, generated: false };
    const key = randomBytes(32);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, key.toString('base64'), { mode: 0o600 });
    return { key, generated: true };
  } catch {
    return undefined;
  }
};

const INVALID_KEY_MSG = (name: string): string =>
  `[LocalCryptoProvider] ${name} is set but is not a 32-byte key (expected 64 hex chars or base64 of 32 bytes). ` +
  `Generate one with \`openssl rand -hex 32\`.`;

const MISSING_PROD_KEY_MSG = (path: string): string =>
  `[LocalCryptoProvider] Refusing to start in production without a stable encryption key.\n` +
  `  No ${SECRET_KEY_ENV} (or ${DEV_KEY_ENV}) is set and no persisted key file was found at:\n` +
  `    ${path}\n` +
  `  Minting a key here would make every sys_secret value (encrypted settings, secret\n` +
  `  fields, datasource credentials) undecryptable after the next restart or on another node.\n` +
  `  Fix: generate a 32-byte key and set it in the environment (identical across every\n` +
  `  restart and every node), e.g.\n` +
  `    ${SECRET_KEY_ENV}=$(openssl rand -hex 32)`;

interface ResolvedKey {
  key: Buffer;
  source: KeySource;
}

const warn = (msg: string): void => {
  try {
    (globalThis as { console?: { warn?: (m: string) => void } }).console?.warn?.(msg);
  } catch {
    /* exotic runtime without console — ignore */
  }
};

const legacyDeprecationWarned = { value: false };

function resolveDataKey(opts: LocalCryptoProviderOptions): ResolvedKey {
  if (opts.key) return { key: opts.key, source: 'explicit' };

  const env = opts.env ?? processEnv();
  const mode = opts.mode ?? detectMode(env);

  // 1) Canonical production master key.
  if (env[SECRET_KEY_ENV] !== undefined) {
    const parsed = parseKey(env[SECRET_KEY_ENV]);
    if (parsed) return { key: parsed, source: 'env:OS_SECRET_KEY' };
    // Present-but-invalid is an explicit operator error — never silently
    // fall through to a different key (that would be silent data divergence).
    throw new Error(INVALID_KEY_MSG(SECRET_KEY_ENV));
  }

  // 2) Dev convenience key (legacy alias honoured with a deprecation note).
  let devRaw = env[DEV_KEY_ENV];
  if (devRaw === undefined && env[DEV_KEY_LEGACY_ENV] !== undefined) {
    devRaw = env[DEV_KEY_LEGACY_ENV];
    if (!legacyDeprecationWarned.value) {
      legacyDeprecationWarned.value = true;
      warn(
        `[ObjectStack] Env var \`${DEV_KEY_LEGACY_ENV}\` is deprecated; rename it to \`${DEV_KEY_ENV}\`.`,
      );
    }
  }
  if (devRaw !== undefined) {
    const parsed = parseKey(devRaw);
    if (parsed) return { key: parsed, source: 'env:OS_DEV_CRYPTO_KEY' };
    if (mode === 'production') throw new Error(INVALID_KEY_MSG(DEV_KEY_ENV));
    warn(`${INVALID_KEY_MSG(DEV_KEY_ENV)} Ignoring and generating a local key.`);
  }

  // 3) No usable env key — behaviour depends on mode.
  if (mode === 'test') {
    // Tests never touch disk; an ephemeral key round-trips within the process.
    return { key: randomBytes(32), source: 'ephemeral' };
  }

  const path = keyFilePath(env);

  if (mode === 'production') {
    // Honour a pre-existing, operator-provisioned key file first.
    const existing = loadExistingKey(path);
    if (existing) {
      warn(
        `[LocalCryptoProvider] No ${SECRET_KEY_ENV} set — using the persisted key at ${path}. ` +
          `For containers / multi-node, prefer setting ${SECRET_KEY_ENV} so every node shares one key.`,
      );
      return { key: existing, source: 'file' };
    }

    // Single-node self-host opt-in (`os start` on a durable filesystem): mint
    // a key AND persist it so the zero-config quickstart boots. We still
    // REFUSE the ephemeral fallback below — if the key cannot be written
    // (read-only / ephemeral FS), running anyway would silently lose every
    // sys_secret on the next restart, the exact footgun this guard prevents.
    // Multi-node deploys must NOT opt in (each node would mint a divergent
    // key); `os start` only sets the flag when no cluster driver is set.
    if (parseBool(env[AUTOKEY_ENV])) {
      const persisted = loadOrCreateKey(path);
      if (persisted) {
        if (persisted.generated) {
          warn(
            `[LocalCryptoProvider] No ${SECRET_KEY_ENV} set — minted a new AES-256-GCM key and ` +
              `persisted it to ${path} (mode 0600). Restarts on this host reuse it automatically. ` +
              `For containers, CI, or multi-node, set ${SECRET_KEY_ENV} so every node shares one key.`,
          );
        }
        return { key: persisted.key, source: persisted.generated ? 'generated-file' : 'file' };
      }
      // Persist failed → fall through to the hard error. Never run ephemeral
      // in production, even with the opt-in.
    }

    throw new Error(MISSING_PROD_KEY_MSG(path));
  }

  // development: persist an auto-generated key so restarts reuse it.
  const persisted = loadOrCreateKey(path);
  if (persisted) {
    if (persisted.generated) {
      warn(
        `[LocalCryptoProvider] No ${SECRET_KEY_ENV}/${DEV_KEY_ENV} set — generated a new AES-256-GCM key ` +
          `and persisted it to ${path} (mode 0600). Restarts on this host reuse it automatically. ` +
          `For containers, CI, or multi-node, set ${SECRET_KEY_ENV} explicitly so the key survives.`,
      );
    }
    return { key: persisted.key, source: persisted.generated ? 'generated-file' : 'file' };
  }

  // Last-resort ephemeral key (e.g. $HOME unwritable). Loud warning: this is
  // the dangerous tier — secrets will NOT survive a restart.
  const key = randomBytes(32);
  warn(
    `[LocalCryptoProvider] No ${SECRET_KEY_ENV} set and could not persist a fallback key at ${path} — ` +
      `generated an EPHEMERAL key. Existing encrypted settings/secrets will fail to decrypt after restart. ` +
      `Set ${SECRET_KEY_ENV} to a stable 32-byte key:\n  ${SECRET_KEY_ENV}=${key.toString('base64')}`,
  );
  return { key, source: 'ephemeral' };
}

const isWebContainerRuntime = (): boolean => {
  const g = globalThis as any;
  return (
    typeof g !== 'undefined' &&
    (Boolean(g.process?.versions?.webcontainer) ||
      Boolean(g.process?.env?.SHELL?.includes?.('jsh')) ||
      Boolean(g.process?.env?.STACKBLITZ))
  );
};

type GcmFactory = (key: Uint8Array, nonce: Uint8Array, aad?: Uint8Array) => {
  encrypt: (plain: Uint8Array) => Uint8Array;
  decrypt: (cipher: Uint8Array) => Uint8Array;
};

let nobleGcmPromise: Promise<GcmFactory | undefined> | undefined;
const loadNobleGcm = (): Promise<GcmFactory | undefined> => {
  if (!nobleGcmPromise) {
    nobleGcmPromise = (async () => {
      try {
        const mod = await import('@noble/ciphers/aes.js');
        return mod.gcm as unknown as GcmFactory;
      } catch (err: any) {
        warn(
          `[LocalCryptoProvider] WebContainer detected but @noble/ciphers not installed: ${err?.message ?? err}. Falling back to node:crypto (will throw).`,
        );
        return undefined;
      }
    })();
  }
  return nobleGcmPromise;
};

export class LocalCryptoProvider implements ICryptoProvider {
  private readonly key: Buffer;
  private readonly useNoble: boolean;
  /** Where the active data key came from. Exposed for diagnostics/tests. */
  readonly keySource: KeySource;

  constructor(opts: LocalCryptoProviderOptions = {}) {
    const resolved = resolveDataKey(opts);
    this.key = resolved.key;
    this.keySource = resolved.source;
    this.useNoble = isWebContainerRuntime();
  }

  async encrypt(plain: string, ctx: CryptoContext): Promise<CryptoHandle> {
    const iv = randomBytes(12);
    const aad = Buffer.from(this.aadOf(ctx), 'utf8');
    const plainBytes = Buffer.from(plain, 'utf8');

    let blob: string;
    if (this.useNoble) {
      const gcm = await loadNobleGcm();
      if (gcm) {
        const cipher = gcm(this.key, iv, aad);
        const ctWithTag = cipher.encrypt(plainBytes); // ciphertext || tag(16)
        const ct = ctWithTag.subarray(0, ctWithTag.length - 16);
        const tag = ctWithTag.subarray(ctWithTag.length - 16);
        blob = Buffer.concat([iv, Buffer.from(tag), Buffer.from(ct)]).toString('base64');
      } else {
        blob = this.encryptNode(plainBytes, iv, aad);
      }
    } else {
      blob = this.encryptNode(plainBytes, iv, aad);
    }

    return {
      id: 'sec_' + randomBytes(16).toString('hex'),
      kmsKeyId: 'local:v1',
      alg: 'aes-256-gcm',
      version: 1,
      ciphertext: blob,
    };
  }

  async decrypt(handle: CryptoHandle, ctx: CryptoContext): Promise<string> {
    const buf = Buffer.from(handle.ciphertext, 'base64');
    const iv = buf.subarray(0, 12);
    const tag = buf.subarray(12, 28);
    const data = buf.subarray(28);
    const aad = Buffer.from(this.aadOf(ctx), 'utf8');

    if (this.useNoble) {
      const gcm = await loadNobleGcm();
      if (gcm) {
        const cipher = gcm(this.key, iv, aad);
        const ctWithTag = Buffer.concat([data, tag]); // noble expects ciphertext || tag
        const out = cipher.decrypt(ctWithTag);
        return Buffer.from(out).toString('utf8');
      }
    }
    const decipher = createDecipheriv('aes-256-gcm', this.key, iv);
    decipher.setAAD(aad);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
  }

  async rotateKey(handle: CryptoHandle, ctx: CryptoContext): Promise<CryptoHandle> {
    const plain = await this.decrypt(handle, ctx);
    const next = await this.encrypt(plain, ctx);
    return {
      ...next,
      id: handle.id,
      kmsKeyId: `local:v${handle.version + 1}`,
      version: handle.version + 1,
    };
  }

  digest(plain: string): string {
    return 'sha256:' + createHash('sha256').update(plain, 'utf8').digest('hex');
  }

  private encryptNode(plainBytes: Buffer, iv: Buffer, aad: Buffer): string {
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    cipher.setAAD(aad);
    const enc = Buffer.concat([cipher.update(plainBytes), cipher.final()]);
    const tag = cipher.getAuthTag();
    return Buffer.concat([iv, tag, enc]).toString('base64');
  }

  private aadOf(ctx: CryptoContext): string {
    // Bind ciphertext to (namespace,key) so a row cannot be moved across
    // specifiers. Tenant binding is intentionally omitted because the
    // handle is dereferenced from a `sys_setting` row already scoped to
    // its tenant — adding tenant here would force the decrypt path to
    // re-read that scope.
    return [ctx.namespace, ctx.key].join('|');
  }
}

/**
 * @deprecated Renamed to {@link LocalCryptoProvider}. The old name implied an
 * "in-memory / ephemeral" key when the provider in fact persists its key
 * (env var or on-disk file). Kept as an alias for backward compatibility.
 */
export const InMemoryCryptoProvider = LocalCryptoProvider;
/** @deprecated Use {@link LocalCryptoProviderOptions}. */
export type InMemoryCryptoProviderOptions = LocalCryptoProviderOptions;
