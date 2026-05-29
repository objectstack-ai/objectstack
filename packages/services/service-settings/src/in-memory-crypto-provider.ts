// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import type {
  CryptoContext,
  CryptoHandle,
  ICryptoProvider,
} from '@objectstack/spec/contracts';
import { readEnvWithDeprecation } from '@objectstack/types';
import { createHash, randomBytes, createCipheriv, createDecipheriv } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

/**
 * InMemoryCryptoProvider — default ICryptoProvider used by the
 * SettingsService when the host application does not wire a real KMS.
 *
 * Encryption: AES-256-GCM with a per-process random data key. The data
 * key lives only in memory; restarting the process loses the ability
 * to decrypt previously-written rows. This is intentional — operators
 * MUST replace this with a KMS-backed provider before relying on
 * `sys_secret` for production secrets. The provider's purpose is to:
 *
 *  - exercise the round-trip in unit tests and dev kernels;
 *  - provide a "real-looking" handle format so consumers don't depend
 *    on accidental implementation details of a no-op adapter;
 *  - serve as a reference for what AwsKmsCryptoProvider /
 *    GcpKmsCryptoProvider implementations need to satisfy.
 *
 * Handle format:
 *   id        — `sec_` + 32 hex chars (122 bits of entropy)
 *   kmsKeyId  — `local:in-memory:v<version>`
 *   alg       — `aes-256-gcm`
 *   version   — bumps on rotateKey()
 *   ciphertext— base64(iv (12) || authTag (16) || cipher)
 *
 * AAD binding: the CryptoContext (namespace + key + tenantId) is
 * folded into AES-GCM AAD so a ciphertext rewrapped from a different
 * (ns, key) tuple fails decryption — guards against operators
 * accidentally copying rows between namespaces.
 *
 * WebContainer (StackBlitz) note: `node:crypto.createCipheriv('aes-256-gcm', …)`
 * is not implemented in WebContainer. When we detect that runtime, we
 * swap to a pure-JS AES-GCM from `@noble/ciphers/aes.js`, producing the
 * same `iv || tag || ciphertext` byte layout so the handle shape is
 * unchanged. The swap is best-effort: if the dependency is missing,
 * we fall back to the Node implementation and let it throw, surfacing
 * the configuration problem clearly.
 *
 * Dev key persistence: in long-running dev sessions, a per-process
 * random key means previously-encrypted rows (e.g. an AI provider API
 * key the operator typed yesterday) become undecryptable on the next
 * `pnpm dev` — Node throws "Unsupported state or unable to authenticate
 * data". To make the dev loop ergonomic without changing the production
 * contract (still KMS-only), the provider honours `OS_DEV_CRYPTO_KEY`
 * (legacy `OBJECTSTACK_DEV_CRYPTO_KEY` still honoured with a deprecation
 * warning) (base64 or hex, 32 bytes after decode) as a stable data key.
 * When the env var is unset we generate an ephemeral key AND log the
 * base64 once so operators can paste it back into their `.env` to
 * survive restarts.
 */
const DEV_KEY_ENV = 'OS_DEV_CRYPTO_KEY';
const DEV_KEY_LEGACY_ENV = 'OBJECTSTACK_DEV_CRYPTO_KEY';

/**
 * Per-user persistent fallback location. When `OS_DEV_CRYPTO_KEY`
 * is unset, we lazily create + cache a key here so dev sessions survive
 * process restarts without operator action. Honours `OS_HOME`
 * (legacy `OBJECTSTACK_HOME` still honoured with a deprecation warning)
 * for projects that pin a non-default config dir.
 */
const devKeyFallbackPath = (): string => {
  const proc = (globalThis as any)?.process;
  const home =
    readEnvWithDeprecation('OS_HOME', 'OBJECTSTACK_HOME') ||
    (proc?.env?.HOME ? join(proc.env.HOME, '.objectstack') : undefined) ||
    join(homedir(), '.objectstack');
  return join(home, 'dev-crypto-key');
};

/**
 * Load (or generate-then-persist) the dev key from the per-user fallback
 * file. Returns `undefined` on any I/O error so the caller can degrade
 * to an ephemeral key without breaking boot.
 */
const loadOrCreateDevKey = (): { key: Buffer; path: string; generated: boolean } | undefined => {
  try {
    const path = devKeyFallbackPath();
    if (existsSync(path)) {
      const raw = readFileSync(path, 'utf8').trim();
      const parsed = parseDevKey(raw);
      if (parsed) return { key: parsed, path, generated: false };
    }
    const key = randomBytes(32);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, key.toString('base64'), { mode: 0o600 });
    return { key, path, generated: true };
  } catch {
    return undefined;
  }
};

/**
 * Parse an `OS_DEV_CRYPTO_KEY` value (hex or base64) into a
 * 32-byte Buffer. Returns `undefined` (with a console warning) when the
 * value is present but unusable — the caller falls back to an ephemeral
 * key so the process still boots.
 */
const parseDevKey = (raw: string | undefined): Buffer | undefined => {
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
  console.warn(
    `[InMemoryCryptoProvider] ${DEV_KEY_ENV} is set but is not 32 bytes (hex or base64). Ignoring and generating an ephemeral key.`,
  );
  return undefined;
};
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
        console.warn(
          `[InMemoryCryptoProvider] WebContainer detected but @noble/ciphers not installed: ${err?.message ?? err}. Falling back to node:crypto (will throw).`,
        );
        return undefined;
      }
    })();
  }
  return nobleGcmPromise;
};

export class InMemoryCryptoProvider implements ICryptoProvider {
  private readonly key: Buffer;
  private readonly useNoble: boolean;

  constructor(opts: { key?: Buffer } = {}) {
    if (opts.key) {
      this.key = opts.key;
    } else {
      const fromEnv = parseDevKey(
        readEnvWithDeprecation(DEV_KEY_ENV, DEV_KEY_LEGACY_ENV),
      );
      if (fromEnv) {
        this.key = fromEnv;
      } else {
        const isTest = Boolean(
          (globalThis as any)?.process?.env?.VITEST ||
            (globalThis as any)?.process?.env?.NODE_ENV === 'test',
        );
        const persisted = isTest ? undefined : loadOrCreateDevKey();
        if (persisted) {
          this.key = persisted.key;
          if (persisted.generated) {
            console.warn(
              `[InMemoryCryptoProvider] No ${DEV_KEY_ENV} set — generated a new AES-256-GCM key and persisted it to ${persisted.path} (mode 0600). Future restarts will reuse it automatically. For shared/CI environments, set ${DEV_KEY_ENV} explicitly in your environment.`,
            );
          }
        } else {
          this.key = randomBytes(32);
          // Last-resort ephemeral key. Surface the base64 once so dev
          // operators can pin it across restarts via the env var.
          if (!isTest) {
            console.warn(
              `[InMemoryCryptoProvider] No ${DEV_KEY_ENV} set and could not persist a fallback key — generated an ephemeral AES-256-GCM key. Existing encrypted settings (e.g. AI API keys) will fail to decrypt on next restart. To make the key survive restarts, add this to your .env:\n  ${DEV_KEY_ENV}=${this.key.toString('base64')}`,
            );
          }
        }
      }
    }
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
      kmsKeyId: 'local:in-memory:v1',
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
      kmsKeyId: `local:in-memory:v${handle.version + 1}`,
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
