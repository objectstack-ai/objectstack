// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.
//
// Unit tests for the #3585 Ed25519 probe / ES256 fallback decision and the
// host-usable JWKS filter.
//
// A real WebContainer is not needed (and would not be reproducible in CI): the
// only thing that makes a host "without Ed25519" is `crypto.subtle.generateKey`
// rejecting `{ name: 'Ed25519' }`, so that is what these tests simulate.

import { describe, it, expect, vi } from 'vitest';
import {
  ED25519_KEY_PAIR_CONFIG,
  ES256_KEY_PAIR_CONFIG,
  createHostUsableJwksReader,
  isEd25519Jwk,
  probeEd25519Support,
  protectGetSessionJwtHook,
  resolveJwtSigningAlgorithm,
  selectHostUsableJwks,
} from './jwt-key-algorithm';

/** The exact DOMException WebContainer throws out of `cfrgGenerateKey`. */
const webContainerOperationError = () =>
  Object.assign(new Error('The operation failed for an operation-specific reason'), {
    name: 'OperationError',
  });

describe('probeEd25519Support', () => {
  it('asks WebCrypto for the SAME descriptor jose uses for EdDSA', async () => {
    const generateKey = vi.fn().mockResolvedValue({});

    await probeEd25519Support({ generateKey } as any);

    // jose resolves `EdDSA` to `{ name: 'Ed25519' }` (lib/jws_algorithms.js).
    // A probe that asked for anything else could pass while signing fails.
    expect(generateKey).toHaveBeenCalledWith({ name: 'Ed25519' }, true, ['sign', 'verify']);
  });

  it('true when the host can generate an Ed25519 key pair', async () => {
    await expect(probeEd25519Support({ generateKey: async () => ({}) } as any)).resolves.toBe(true);
  });

  it('false — never throws — when generateKey REJECTS (the WebContainer case)', async () => {
    const generateKey = vi.fn().mockRejectedValue(webContainerOperationError());
    await expect(probeEd25519Support({ generateKey } as any)).resolves.toBe(false);
  });

  it('false when generateKey throws SYNCHRONOUSLY', async () => {
    const generateKey = vi.fn(() => {
      throw new Error('NotSupportedError');
    });
    await expect(probeEd25519Support({ generateKey } as any)).resolves.toBe(false);
  });

  it('false when the host has no usable crypto.subtle at all', async () => {
    // This is the shape `globalThis.crypto?.subtle` degrades to on a host
    // without WebCrypto — the probe must answer, not throw on `undefined?.`.
    await expect(probeEd25519Support(null)).resolves.toBe(false);
    await expect(probeEd25519Support({} as any)).resolves.toBe(false);
    await expect(probeEd25519Support({ generateKey: 'nope' } as any)).resolves.toBe(false);
  });

  it('the real host running these tests is probed truthfully', async () => {
    // Node 22 has Ed25519; this pins that the probe works against real
    // WebCrypto and is not accidentally always-false.
    await expect(probeEd25519Support()).resolves.toBe(true);
  });
});

describe('resolveJwtSigningAlgorithm', () => {
  it('keeps better-auth\'s EdDSA default when the host supports it', async () => {
    const decision = await resolveJwtSigningAlgorithm(async () => true);

    expect(decision.ed25519Supported).toBe(true);
    expect(decision.keyPairConfig).toEqual({ alg: 'EdDSA', crv: 'Ed25519' });
    expect(decision.keyPairConfig).toBe(ED25519_KEY_PAIR_CONFIG);
  });

  it('falls back to ES256 on a host without Ed25519', async () => {
    const decision = await resolveJwtSigningAlgorithm(async () => false);

    expect(decision.ed25519Supported).toBe(false);
    expect(decision.keyPairConfig).toEqual({ alg: 'ES256' });
    expect(decision.keyPairConfig).toBe(ES256_KEY_PAIR_CONFIG);
  });

  it('pins the EdDSA config explicitly rather than leaving it to better-auth', async () => {
    // better-auth's `generateExportedKeyPair` defaults to
    // `{ alg: 'EdDSA', crv: 'Ed25519' }` when keyPairConfig is absent. We pass
    // it explicitly so the deployment's algorithm is visible at the call site
    // and cannot change under us on a dependency bump.
    const { keyPairConfig } = await resolveJwtSigningAlgorithm(async () => true);
    expect(keyPairConfig.alg).toBe('EdDSA');
    expect((keyPairConfig as { crv?: string }).crv).toBe('Ed25519');
  });
});

describe('isEd25519Jwk', () => {
  it('detects the modern row shape via alg', () => {
    expect(isEd25519Jwk({ alg: 'EdDSA', crv: 'Ed25519' })).toBe(true);
  });

  it('detects via crv alone', () => {
    expect(isEd25519Jwk({ crv: 'Ed25519' })).toBe(true);
  });

  it('LEGACY row (alg/crv null) is classified from the stored key material', () => {
    // Rows minted before better-auth 1.7 have no alg/crv columns populated.
    // `getLatestKeyByAlg` treats `alg == null` as "the configured default", so
    // after the ES256 fallback such a row would be selected AS IF it were
    // ES256 and then blow up in importJWK. Reading kty/crv off the JWK is what
    // makes this correct rather than merely well-typed.
    const legacyEdDSA = {
      alg: null,
      crv: null,
      publicKey: JSON.stringify({ kty: 'OKP', crv: 'Ed25519', x: 'abc' }),
    };
    expect(isEd25519Jwk(legacyEdDSA)).toBe(true);
  });

  it('legacy EC row is NOT mistaken for Ed25519', () => {
    const legacyEc = {
      alg: null,
      crv: null,
      publicKey: JSON.stringify({ kty: 'EC', crv: 'P-256', x: 'a', y: 'b' }),
    };
    expect(isEd25519Jwk(legacyEc)).toBe(false);
  });

  it('ES256 rows are never hidden', () => {
    expect(isEd25519Jwk({ alg: 'ES256', crv: 'P-256' })).toBe(false);
    expect(isEd25519Jwk({ alg: 'RS256' })).toBe(false);
  });

  it('unparseable key material is left VISIBLE — better a loud better-auth error than a silently hidden key', () => {
    expect(isEd25519Jwk({ alg: null, crv: null, publicKey: 'not-json' })).toBe(false);
  });

  it('tolerates null/undefined rows', () => {
    expect(isEd25519Jwk(null)).toBe(false);
    expect(isEd25519Jwk(undefined)).toBe(false);
  });
});

describe('selectHostUsableJwks', () => {
  const eddsa = { id: 'k_eddsa', alg: 'EdDSA', crv: 'Ed25519' };
  const es256 = { id: 'k_es256', alg: 'ES256' };

  it('is IDENTITY on a host with Ed25519 — the filter must be inert in production', () => {
    expect(selectHostUsableJwks([eddsa, es256], true)).toEqual([eddsa, es256]);
  });

  it('hides Ed25519 keys on a host without Ed25519', () => {
    expect(selectHostUsableJwks([eddsa, es256], false)).toEqual([es256]);
  });

  it('an all-EdDSA keyring becomes empty, which is what makes better-auth mint a fresh usable key', () => {
    // resolveSigningKey: `getLatestKeyByAlg(ES256) ?? getLatestKey()` — with
    // both empty it falls through to createJwk(), minting ES256. That is the
    // convergence this filter exists to enable.
    expect(selectHostUsableJwks([eddsa], false)).toEqual([]);
  });
});

describe('createHostUsableJwksReader', () => {
  const ctxWith = (rows: unknown[]) => ({
    context: { adapter: { findMany: vi.fn().mockResolvedValue(rows) } },
  });

  it('reads the jwks model and filters unusable keys', async () => {
    const ctx = ctxWith([
      { id: 'a', alg: 'EdDSA', crv: 'Ed25519' },
      { id: 'b', alg: 'ES256' },
    ]);

    const keys = await createHostUsableJwksReader()(ctx);

    expect(ctx.context.adapter.findMany).toHaveBeenCalledWith({ model: 'jwks' });
    expect(keys.map((k) => k.id)).toEqual(['b']);
  });

  it('reports how many keys it hid, so the caller can log once', async () => {
    const onHidden = vi.fn();
    await createHostUsableJwksReader(onHidden)(
      ctxWith([
        { id: 'a', alg: 'EdDSA' },
        { id: 'b', alg: 'EdDSA' },
        { id: 'c', alg: 'ES256' },
      ]),
    );
    expect(onHidden).toHaveBeenCalledWith(2);
  });

  it('does not report when nothing was hidden', async () => {
    const onHidden = vi.fn();
    await createHostUsableJwksReader(onHidden)(ctxWith([{ id: 'c', alg: 'ES256' }]));
    expect(onHidden).not.toHaveBeenCalled();
  });

  it('an empty / missing table reads as an empty keyring, not a crash', async () => {
    await expect(createHostUsableJwksReader()(ctxWith([]))).resolves.toEqual([]);
    await expect(
      createHostUsableJwksReader()({ context: { adapter: { findMany: async () => null } } }),
    ).resolves.toEqual([]);
  });
});

describe('protectGetSessionJwtHook', () => {
  const makePlugin = (handler: any) => ({
    hooks: {
      after: [
        {
          matcher: (context: { path?: string }) => context.path === '/get-session',
          handler,
        },
      ],
    },
  });

  it('a throwing handler degrades to "no header" instead of propagating', async () => {
    const boom = new Error('The operation failed for an operation-specific reason');
    const plugin = makePlugin(async () => {
      throw boom;
    });
    const onFailure = vi.fn();

    expect(protectGetSessionJwtHook(plugin, onFailure)).toBe(true);

    await expect(plugin.hooks.after[0]!.handler!({} as any)).resolves.toBeUndefined();
    expect(onFailure).toHaveBeenCalledWith(boom);
  });

  it('returns the {headers,response} shape runAfterHooks reads, not a bare undefined', async () => {
    // better-auth's runAfterHooks does an UNGUARDED `result.headers` read on
    // every hook result (api/dispatch.mjs). Swallowing the error and returning
    // nothing just moves the 500 one frame up — this exact bug cost a debug
    // cycle while building the fix, so it is pinned.
    const plugin = makePlugin(async () => {
      throw new Error('signing exploded');
    });
    protectGetSessionJwtHook(plugin, vi.fn());

    const result: any = await plugin.hooks.after[0]!.handler!({ returnHeaders: true } as any);

    expect(result).toEqual({ headers: undefined, response: undefined });
    // `response: undefined` is what leaves the real session payload in place:
    // runAfterHooks only overwrites `context.returned` when response !== undefined.
    expect(result.response).toBeUndefined();
    // `headers: undefined` is safe — mergeResponseHeaders early-returns on falsy.
    expect('headers' in result).toBe(true);
  });

  it('a healthy handler is passed through untouched — return value and ctx', async () => {
    const inner = vi.fn().mockResolvedValue('ok');
    const plugin = makePlugin(inner);
    const onFailure = vi.fn();
    protectGetSessionJwtHook(plugin, onFailure);

    const ctx = { marker: 1 };
    await expect(plugin.hooks.after[0]!.handler!(ctx as any)).resolves.toBe('ok');
    expect(inner).toHaveBeenCalledWith(ctx);
    expect(onFailure).not.toHaveBeenCalled();
  });

  it('preserves the better-call `options` property the router reads', async () => {
    const inner = Object.assign(async () => undefined, { options: { use: ['x'] } });
    const plugin = makePlugin(inner);
    protectGetSessionJwtHook(plugin, vi.fn());

    expect((plugin.hooks.after[0]!.handler as any).options).toEqual({ use: ['x'] });
  });

  it('returns FALSE when the hook shape is not what we expect — absence must be loud', () => {
    expect(protectGetSessionJwtHook({} as any, vi.fn())).toBe(false);
    expect(protectGetSessionJwtHook({ hooks: {} } as any, vi.fn())).toBe(false);
    expect(protectGetSessionJwtHook({ hooks: { after: [] } } as any, vi.fn())).toBe(false);
    expect(
      protectGetSessionJwtHook({ hooks: { after: [{ handler: undefined }] } } as any, vi.fn()),
    ).toBe(false);
  });

  it('skips hooks whose matcher does not claim /get-session', () => {
    const plugin = {
      hooks: { after: [{ matcher: () => false, handler: async () => 'untouched' }] },
    };
    const original = plugin.hooks.after[0]!.handler;

    expect(protectGetSessionJwtHook(plugin as any, vi.fn())).toBe(false);
    expect(plugin.hooks.after[0]!.handler).toBe(original);
  });
});
