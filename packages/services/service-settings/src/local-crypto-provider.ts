// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import {
  CRYPTO_CONTEXT_SCOPES,
  type CryptoContext,
  type CryptoContextScope,
  type CryptoHandle,
  type ICryptoProvider,
} from '@objectstack/spec/contracts';
import { createHash, createHmac, randomBytes, createCipheriv, createDecipheriv } from 'node:crypto';
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
 * `mode` is auto-detected from `NODE_ENV` alone (`production` → strict;
 * `test` → ephemeral, no disk; otherwise `development`) and can be
 * overridden via `opts.mode` for embedders that manage their own lifecycle.
 * Which variables may and may not decide that is spelled out at `detectMode`
 * below — it is a security question, not a formatting one.
 *
 * ## Handle format
 *   id        — `sec_` + 32 hex chars (122 bits of entropy)
 *   kmsKeyId  — `local:v<version>`
 *   alg       — `aes-256-gcm`
 *   version   — bumps on rotateKey() (a rotation counter, not the AAD
 *               derivation — that is the ciphertext's marker below)
 *   ciphertext— `v2:` + base64(iv (12) || authTag (16) || cipher) for every
 *               new seal; a handle sealed before derivations were versioned
 *               is bare base64(iv || authTag || cipher) — version 1.
 *
 * ## AAD binding (ADR-0128 D1–D3)
 * The ciphertext's marker records which AAD derivation sealed it, and
 * `decrypt` dispatches on that record — it never tries a second derivation
 * after the first fails, and it never guesses a producer (D3).
 *
 * **Version 2 — every new seal.** The AAD is
 *
 *   0xFF || "objectstack/crypto-context-aad/v2" || lp(scope) || lp(namespace) || lp(key)
 *
 * where `lp(x)` is the 4-byte big-endian length of UTF-8(x) followed by those
 * bytes. Three properties, each load-bearing:
 *
 *  - **Producer-discriminated (D1).** `scope` names the producer vocabulary
 *    (`CRYPTO_CONTEXT_SCOPES`), so a ciphertext sealed by one producer does
 *    not authenticate under another producer's context, however the two
 *    `(namespace, key)` pairs are spelled. A scope outside the closed set is
 *    refused with {@link CryptoContextScopeError} before any key is used.
 *  - **Delimiter-safe (D2).** Every component is length-prefixed, so distinct
 *    triples always produce distinct bytes — no separator character exists
 *    for a component to smuggle. `aadForVersion2` is exported only so that
 *    property is pinned by a byte vector and by a collision vector.
 *  - **Disjoint from version 1.** The lead byte 0xFF never occurs in UTF-8,
 *    and a version-1 AAD is the UTF-8 of a string, so no version-1 AAD equals
 *    any version-2 AAD: a ciphertext presented under the other version's
 *    marker never authenticates. The label names the derivation, so a future
 *    version 3 takes a new label and is disjoint from this one too.
 *
 * **Version 1 — read only.** AAD = UTF-8(namespace + `|` + key), the
 * derivation every pre-versioning ciphertext carries. It opens such a handle
 * so existing ciphertext stays readable until it is re-wrapped
 * (`rotateKey` opens with the recorded derivation and seals with version 2);
 * ⛔ it never seals. It carries the older, weaker guarantee described on
 * `CryptoContext` until then.
 *
 * **Why every pre-versioning handle reads as version 1 without reading a
 * row.** Both seal paths (node:crypto and the WebContainer one) emitted
 * `Buffer#toString('base64')`, whose alphabet is `A–Z a–z 0–9 + / =`, so no
 * such ciphertext contains `:`. A ciphertext without `:` is version 1; `v2:`
 * is version 2; any other marker is refused with
 * {@link UnknownCiphertextVersionError} (fail closed).
 *
 * Tenant binding is intentionally omitted from both derivations: the handle
 * is dereferenced from a row its producer has already scoped to its tenant,
 * and adding the tenant here would force every decrypt path to re-read that
 * scope.
 *
 * ## Keyed digest
 * `keyedDigest(plain)` is `hmac-sha256:` + hex(HMAC-SHA-256(macKey, plain)),
 * where `macKey` is DERIVED from the same 32-byte data key the AES path uses —
 * whichever source resolved it above — so it needs no secret of its own:
 *
 *   macKey = HMAC-SHA-256(dataKey, KEYED_DIGEST_KDF_INFO || 0x01)
 *
 * That is RFC 5869 HKDF-Expand for one 32-byte block, with the data key as the
 * pseudorandom key (§3.3 lets a uniformly random key skip the Extract step).
 * The data key is never used as the MAC key directly: one key, one purpose. The
 * AES-GCM key stays a pure encryption key, the MAC key is a separate value
 * nobody can turn back into it, and the versioned label makes a future change
 * of construction a deliberate, visible one rather than a silent drift. The
 * derivation is deterministic, so every process and node that resolves the
 * same data key computes the same digest.
 *
 * Only `createHmac` is used (no `hkdfSync`), so the WebContainer runtime that
 * cannot run AES-GCM through `node:crypto` is not handed a second primitive it
 * may lack.
 *
 * A provider whose data key is not 32 bytes — reachable only through an
 * explicit `opts.key`, because every env and file source is length-checked —
 * holds no usable key material. `keyedDigest` rejects with
 * {@link KeyedDigestKeyUnavailableError} there; ⛔ it never falls back to an
 * unkeyed hash, nor to an HMAC under an empty key, which anyone can compute.
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

/** The data key's only legal length: AES-256 needs exactly 32 bytes. */
const DATA_KEY_BYTES = 32;

/**
 * HKDF-Expand `info` label for the keyed-digest MAC key. Versioned: changing
 * it changes every keyed digest this provider has ever handed out, so a new
 * construction takes a new label, never an edit of this one.
 */
const KEYED_DIGEST_KDF_INFO = 'objectstack/crypto-provider/keyed-digest/v1';

/** HKDF-Expand's first-block input: `info || 0x01` (RFC 5869 §2.3, T(1)). */
const KEYED_DIGEST_KDF_INPUT = Buffer.concat([Buffer.from(KEYED_DIGEST_KDF_INFO, 'utf8'), Buffer.from([0x01])]);

/** Output prefix the `ICryptoProvider.keyedDigest` contract fixes. */
const KEYED_DIGEST_PREFIX = 'hmac-sha256:';

/**
 * Rejection of {@link LocalCryptoProvider.keyedDigest} when the provider holds
 * no usable key material. The refusal is the guarantee: a keyed digest
 * computed without a key would be an unkeyed digest wearing a keyed name.
 */
export class KeyedDigestKeyUnavailableError extends Error {
  constructor(readonly keyLength: number) {
    super(
      `[LocalCryptoProvider] Refusing to compute a keyed digest: the provider holds no usable key ` +
        `material (a ${keyLength}-byte data key; exactly ${DATA_KEY_BYTES} bytes are required). ` +
        `A digest computed without a key can be recomputed by anyone holding the input. ` +
        `Fix: construct the provider with a ${DATA_KEY_BYTES}-byte key, or let it resolve ` +
        `${SECRET_KEY_ENV} from the environment.`,
    );
    this.name = 'KeyedDigestKeyUnavailableError';
  }
}

/** The AAD derivations this provider knows (see "AAD binding" above). */
type AadDerivation = 1 | 2;

/** The derivation every seal uses — the one a re-wrap leaves a ciphertext under. */
const SEALING_DERIVATION: AadDerivation = 2;

/** Separates a ciphertext's derivation marker from its base64 body. */
const CIPHERTEXT_MARKER_SEPARATOR = ':';

/** Marker of a version-2 seal — the only derivation this provider seals with. */
const CIPHERTEXT_V2_MARKER = 'v2';

/**
 * Lead byte of every version-2 AAD. 0xFF never occurs in UTF-8, which is what
 * keeps version 2 disjoint from every version-1 AAD (the UTF-8 of a string).
 */
const AAD_V2_LEAD = Buffer.from([0xff]);

/**
 * Names the version-2 derivation inside the AAD itself. Versioned: a new
 * derivation takes a new label (and a new marker), never an edit of this one —
 * editing it would orphan every version-2 ciphertext ever sealed.
 */
const AAD_V2_LABEL = Buffer.from('objectstack/crypto-context-aad/v2', 'utf8');

/**
 * Refusal of a {@link CryptoContext} whose `scope` is not a member of the
 * closed producer set. The type already requires it; this is the same rule for
 * a caller the compiler never saw (plain JavaScript, a cast, a stale build). A
 * missing scope is never defaulted: defaulting would put the caller's
 * ciphertext into another producer's AAD space.
 */
export class CryptoContextScopeError extends Error {
  constructor(readonly received: unknown) {
    super(
      `[LocalCryptoProvider] Refusing to use a CryptoContext without a valid scope ` +
        `(received ${describeScope(received)}). The scope names which producer's vocabulary ` +
        `(namespace, key) is drawn from, and it is bound into the ciphertext, so it is never ` +
        `defaulted. Fix: pass the calling producer's own member of CRYPTO_CONTEXT_SCOPES ` +
        `(${CRYPTO_CONTEXT_SCOPES.join(', ')}) on encrypt, decrypt and rotateKey alike.`,
    );
    this.name = 'CryptoContextScopeError';
  }
}

/**
 * Refusal to open a ciphertext whose marker records an AAD derivation this
 * provider does not know. Fail closed: the recorded derivation is the only one
 * ever tried, so an unknown one is a refusal, never a cue to guess.
 */
export class UnknownCiphertextVersionError extends Error {
  constructor(readonly marker: string) {
    super(
      `[LocalCryptoProvider] Refusing to decrypt: the ciphertext records AAD derivation ` +
        `${describeMarker(marker)}, which this provider does not know. A ciphertext is opened only ` +
        `with the derivation it records, never by trying another. Fix: open it with the release ` +
        `that sealed it, or set the value again so it is sealed under a derivation this release knows.`,
    );
    this.name = 'UnknownCiphertextVersionError';
  }
}

/** A refusal message names a received scope only when it is short and printable. */
function describeScope(received: unknown): string {
  if (received === undefined) return 'no scope';
  if (typeof received === 'string' && /^[a-z0-9_]{1,40}$/.test(received)) return `'${received}'`;
  return `a ${typeof received} that is not a member`;
}

/** A refusal message echoes a marker only when it is short and printable. */
function describeMarker(marker: string): string {
  return /^[A-Za-z0-9_-]{1,16}$/.test(marker) ? `'${marker}'` : 'an unrecognised marker';
}

/** The scope, proven a member of the closed set — or a refusal. */
function requireScope(ctx: CryptoContext): CryptoContextScope {
  const scope = (ctx as { scope?: unknown } | undefined)?.scope;
  if (typeof scope === 'string' && (CRYPTO_CONTEXT_SCOPES as readonly string[]).includes(scope)) {
    return scope as CryptoContextScope;
  }
  throw new CryptoContextScopeError(scope);
}

/** `lp(x)`: the 4-byte big-endian length of UTF-8(x), then those bytes. */
function lengthPrefixed(value: string): Buffer {
  const bytes = Buffer.from(value, 'utf8');
  const length = Buffer.alloc(4);
  length.writeUInt32BE(bytes.length, 0);
  return Buffer.concat([length, bytes]);
}

/**
 * The version-2 AAD of `ctx` (see "AAD binding" above): producer-discriminated
 * and length-prefixed. Exported for its pins only; callers never build AAD.
 */
export function aadForVersion2(ctx: CryptoContext): Buffer {
  return Buffer.concat([
    AAD_V2_LEAD,
    AAD_V2_LABEL,
    lengthPrefixed(requireScope(ctx)),
    lengthPrefixed(ctx.namespace),
    lengthPrefixed(ctx.key),
  ]);
}

/**
 * The version-1 AAD: the derivation every pre-versioning ciphertext was sealed
 * with. Read-only — it opens such a ciphertext and is never used to seal.
 */
function aadForVersion1(ctx: CryptoContext): Buffer {
  return Buffer.from([ctx.namespace, ctx.key].join('|'), 'utf8');
}

/**
 * Split a stored ciphertext into the derivation it records and its base64 body.
 * No `:` ⇒ version 1 (standard base64 has none); `v2:` ⇒ version 2; anything
 * else is refused.
 */
function readCiphertext(ciphertext: string): { derivation: AadDerivation; body: string } {
  const at = ciphertext.indexOf(CIPHERTEXT_MARKER_SEPARATOR);
  if (at === -1) return { derivation: 1, body: ciphertext };
  const marker = ciphertext.slice(0, at);
  if (marker === CIPHERTEXT_V2_MARKER) return { derivation: 2, body: ciphertext.slice(at + 1) };
  throw new UnknownCiphertextVersionError(marker);
}

/**
 * What a stored ciphertext records about the AAD derivation that sealed it,
 * relative to the one this provider seals with. See
 * {@link ciphertextDerivationStatus}.
 *
 *  - `'current'` — sealed under the derivation every new seal uses (version
 *    2). A re-wrap has nothing to do.
 *  - `'superseded'` — sealed under a derivation this provider still opens but
 *    no longer seals with (version 1, no marker).
 *    {@link LocalCryptoProvider.rotateKey} re-seals it under the current one.
 *  - `'unknown'` — a marker this provider does not know, or a value that is not
 *    a ciphertext string at all. `decrypt` and `rotateKey` refuse it.
 */
export type CiphertextDerivationStatus = 'current' | 'superseded' | 'unknown';

/**
 * Read a stored ciphertext's derivation off its marker, WITHOUT opening it: no
 * key and no context are involved, so nothing is decrypted.
 *
 * It is the same reading `decrypt` and `rotateKey` dispatch on
 * (`readCiphertext`), published so that the at-rest re-wrap (ADR-0128 §4.2)
 * classifies stored rows with this provider's own grammar. ⛔ A consumer that
 * restated the marker grammar would drift from that dispatch, and the drift
 * shows up as a row skipped as done that was never re-wrapped.
 *
 * `'superseded'` is a statement about the marker only. Whether the ciphertext
 * really opens is known only by opening it under its producer's context.
 */
export function ciphertextDerivationStatus(ciphertext: unknown): CiphertextDerivationStatus {
  if (typeof ciphertext !== 'string') return 'unknown';
  let derivation: AadDerivation;
  try {
    derivation = readCiphertext(ciphertext).derivation;
  } catch (error) {
    if (error instanceof UnknownCiphertextVersionError) return 'unknown';
    throw error;
  }
  return derivation === SEALING_DERIVATION ? 'current' : 'superseded';
}

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

/**
 * Deployment posture — read from `NODE_ENV` and from NOTHING ELSE.
 *
 * ## ⛔ Never widen this to a test-RUNNER variable
 *
 * This function decides whether the fail-loud guarantee documented above is
 * ARMED. `'test'` is not a softer flavour of `'production'`: it is the branch
 * that takes an ephemeral key, never touches disk, and — the part that matters
 * — never refuses to boot. **The refusal is the gate.** So a variable that can
 * reach this function decides whether a security gate runs, and the only
 * variables allowed to do that are the ones that describe the DEPLOYMENT.
 *
 * This line used to read:
 *
 *   if (env.VITEST || env.NODE_ENV === 'test') return 'test';
 *
 * `VITEST` describes the RUNNER, not the deployment, and a runner variable is
 * INHERITED by every process the runner spawns. Measured on this repo: a real
 * `os serve` spawned from a vitest worker with `{ ...process.env }` carried
 * `VITEST=true` into the child, so that boot's crypto layer sat in `test` mode
 * — ephemeral key, no disk, no refusal — while the rest of the boot was in
 * production posture. `packages/cli/test/serve-node-env-production-default`
 * `.e2e.test.ts`, a pin whose entire subject is *"unset `NODE_ENV` means
 * production"*, ran that way for its whole life: production for auth, test for
 * crypto. Nothing said a word, because a gate that does not run prints nothing.
 *
 * ## Why deleting it does not move in-process unit tests
 *
 * Reading `VITEST` was intentional: in-process unit tests must get `test`
 * posture so they neither mint a key file in `$HOME` nor fail on a machine
 * without one. That intent is preserved here rather than dropped, because
 * vitest sets BOTH variables on the same worker — measured in vitest 4.1.10's
 * own source, `prepareVitest()`:
 *
 *   process.env.TEST = "true";
 *   process.env.VITEST = "true";
 *   process.env.NODE_ENV ??= "test";
 *
 * and it repeats `NODE_ENV: process.env.NODE_ENV || "test"` in the env it hands
 * each worker. So an in-process test already satisfies `NODE_ENV === 'test'`
 * and lands on this function's first line without `VITEST` participating at
 * all. The two spellings are indistinguishable IN-PROCESS and differ only for
 * an INHERITING child — which is precisely the defect. `local-crypto-provider`
 * `.test.ts` pins both halves: the in-process posture (a real worker, real
 * `process.env`, no injected map) and the refusal under a leaked runner
 * variable.
 *
 * `pnpm check:runner-env-posture` keeps the whole class shut, so the next
 * author who reaches for a runner variable in product code is told here rather
 * than by an operator whose secrets stopped decrypting.
 */
const detectMode = (env: EnvMap): CryptoMode => {
  if (env.NODE_ENV === 'test') return 'test';
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
  /**
   * The keyed-digest MAC key, derived from {@link key} (see "Keyed digest"
   * above). `undefined` exactly when the data key is not usable key material,
   * which is what makes `keyedDigest` refuse.
   */
  private readonly macKey: Buffer | undefined;
  private readonly useNoble: boolean;
  /** Where the active data key came from. Exposed for diagnostics/tests. */
  readonly keySource: KeySource;

  constructor(opts: LocalCryptoProviderOptions = {}) {
    const resolved = resolveDataKey(opts);
    this.key = resolved.key;
    this.keySource = resolved.source;
    this.macKey =
      resolved.key.length === DATA_KEY_BYTES
        ? createHmac('sha256', resolved.key).update(KEYED_DIGEST_KDF_INPUT).digest()
        : undefined;
    this.useNoble = isWebContainerRuntime();
  }

  async encrypt(plain: string, ctx: CryptoContext): Promise<CryptoHandle> {
    // Every seal is version 2 — the only derivation this provider seals with.
    const aad = aadForVersion2(ctx);
    const iv = randomBytes(12);
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
      ciphertext: CIPHERTEXT_V2_MARKER + CIPHERTEXT_MARKER_SEPARATOR + blob,
    };
  }

  async decrypt(handle: CryptoHandle, ctx: CryptoContext): Promise<string> {
    // The scope is required on every call, including a version-1 open that
    // does not bind it: the contract does not loosen by derivation.
    requireScope(ctx);
    // Dispatch on the derivation the ciphertext RECORDS — exactly one is tried.
    const { derivation, body } = readCiphertext(handle.ciphertext);
    const aad = derivation === 2 ? aadForVersion2(ctx) : aadForVersion1(ctx);
    const buf = Buffer.from(body, 'base64');
    const iv = buf.subarray(0, 12);
    const tag = buf.subarray(12, 28);
    const data = buf.subarray(28);

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

  /**
   * Opens `handle` with the derivation it records and seals the plaintext
   * again with version 2 — so a version-1 handle comes back version 2. This is
   * the seam the at-rest re-wrap of pre-versioning ciphertext uses.
   */
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

  async keyedDigest(plain: string): Promise<string> {
    if (!this.macKey) throw new KeyedDigestKeyUnavailableError(this.key.length);
    return KEYED_DIGEST_PREFIX + createHmac('sha256', this.macKey).update(plain, 'utf8').digest('hex');
  }

  private encryptNode(plainBytes: Buffer, iv: Buffer, aad: Buffer): string {
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    cipher.setAAD(aad);
    const enc = Buffer.concat([cipher.update(plainBytes), cipher.final()]);
    const tag = cipher.getAuthTag();
    return Buffer.concat([iv, tag, enc]).toString('base64');
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
