// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#21839] On WebContainer the share-link password is hashed by the pure-JS
 * scrypt (`@noble/hashes`), because that host's `node:crypto.scrypt` is
 * incomplete; everywhere else by `node:crypto`. The two must be one hash.
 *
 * Pinned:
 *  - with a WebContainer signal set, `node:crypto.scrypt` is never called —
 *    the pure-JS path really ran;
 *  - without one, it is — the native path really ran;
 *  - a hash minted on either path verifies on the other, and a wrong password
 *    is refused on both;
 *  - the two paths derive byte-identical keys for the same password and salt
 *    (compared directly against `node:crypto`).
 */

import { describe, it, expect, vi, afterEach, beforeAll } from 'vitest';
import * as nodeCrypto from 'node:crypto';
import { hashShareLinkPassword, verifyShareLinkPassword } from './share-link-password.js';

/**
 * [#23184] Each implementation derives a given input once per file.
 *
 * Every derivation here is at the production parameters, the pure-JS one at
 * about twice the native cost, and the file sat at 7-10.5 s of wall in the
 * hourly full battery. So each scrypt answers an input IT has already derived
 * in this file with the bytes it produced, and runs for any other input; the
 * key is every input (password, salt and cost parameters). scrypt is a pure
 * function, so each answer is the one a fresh call would give.
 *
 * ⛔ The two memos are SEPARATE, and must stay so. What this file pins is that
 * two implementations agree, so neither may ever be answered from the other's
 * work: a native verification of a pure-JS hash is a native derivation, and
 * the reverse. Only a repeat on the SAME path is answered from memory, such as
 * the second spelling of the NFKC case, whose normalised input is the one the
 * first spelling already derived (a path that skipped NFKC would miss).
 */
vi.mock('node:crypto', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:crypto')>();
  const derived = new Map<string, Buffer>();
  function scrypt(password: unknown, salt: unknown, keylen: number, options: unknown, callback?: unknown): void {
    const [opts, done] = typeof options === 'function' ? [{}, options] : [options ?? {}, callback];
    const reply = done as (err: Error | null, key: Buffer) => void;
    const key = JSON.stringify([password, salt, keylen, opts]);
    const hit = derived.get(key);
    if (hit) {
      process.nextTick(reply, null, Buffer.from(hit));
      return;
    }
    actual.scrypt(
      password as import('node:crypto').BinaryLike,
      salt as import('node:crypto').BinaryLike,
      keylen,
      opts as import('node:crypto').ScryptOptions,
      (err, out) => {
        if (!err) derived.set(key, Buffer.from(out));
        reply(err, out);
      },
    );
  }
  // The spy wraps the memo, so it still records every call the module makes.
  return { ...actual, scrypt: vi.fn(scrypt) };
});

vi.mock('@noble/hashes/scrypt.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@noble/hashes/scrypt.js')>();
  const derived = new Map<string, Uint8Array>();
  const scryptAsync: typeof actual.scryptAsync = async (password, salt, opts) => {
    const key = JSON.stringify([password, salt, opts]);
    const hit = derived.get(key);
    if (hit) return new Uint8Array(hit);
    const out = await actual.scryptAsync(password, salt, opts);
    derived.set(key, new Uint8Array(out));
    return out;
  };
  return { ...actual, scryptAsync };
});

const PASSWORD = 'Ünïcödé pass 21839';
const nodeScrypt = vi.mocked(nodeCrypto.scrypt);

/**
 * [#22418] Explicit budgets, sized to the measured work. Every case here
 * derives scrypt keys at the production parameters (N=16384, r=16) on purpose,
 * the pure-JS path at several times the native cost, so a case's wall time is
 * its derivation count times what one derivation costs on the shard that runs
 * it. vitest's 5000 ms default is a number nobody chose for that work.
 *
 * The rule: a case whose slowest `Test Core` reading is over half the default
 * gets 3x that reading, rounded up to the next second. 3x clears the largest
 * spread one case showed between two CI runs (1.88x) with room for a heavier
 * shard. The two cases with one derivation per path (slowest reading 1435 ms)
 * keep the default, which already leaves them 3.4x. When a case's derivation
 * count changes, re-size it from a fresh reading, never by lowering the
 * parameters.
 *
 * [#23184] Both counts below fell (the shared hashes and the memos above). No
 * `Test Core` reading of the new shapes exists yet, so each budget stands as
 * sized for its larger count until one re-sizes it.
 */
/**
 * Was 3 pure-JS + 3 native derivations, CI readings 4136 and 3688 ms; now
 * 2 + 2, the two mints moved to the shared hashes.
 */
const CROSS_VERIFY_BUDGET_MS = 13_000;
/**
 * Was 4 pure-JS + 4 native, CI timed out at 5030 and 5039 ms, so the reading
 * was projected: 4/3 of the 3 + 3 case's 4136 ms in the same run, 5515 ms.
 * Now 3 + 3: each path's memo answers the second spelling.
 */
const NFKC_BUDGET_MS = 17_000;

function onWebContainer(on: boolean) {
  vi.stubEnv('STACKBLITZ', on ? '1' : '');
  vi.stubEnv('SHELL', on ? '/bin/jsh' : '/bin/bash');
}

/**
 * [#23184] PASSWORD's hash minted on each path, once per file: case 2
 * cross-verifies both, and case 4 compares the pure-JS one against
 * `node:crypto`. Only the native mint may reach `node:crypto.scrypt`, so a
 * pure-JS hash that was not really pure-JS cannot reach either case.
 */
let pureJsHash: string;
let nativeHash: string;
beforeAll(async () => {
  onWebContainer(true);
  pureJsHash = await hashShareLinkPassword(PASSWORD);
  onWebContainer(false);
  nativeHash = await hashShareLinkPassword(PASSWORD);
  expect(nodeScrypt).toHaveBeenCalledTimes(1);
  vi.unstubAllEnvs();
  nodeScrypt.mockClear();
});

afterEach(() => {
  vi.unstubAllEnvs();
  nodeScrypt.mockClear();
});

describe('[#21839] share-link password: node:crypto and pure-JS scrypt are interchangeable', () => {
  it('the WebContainer path does not touch node:crypto.scrypt; the native path does', async () => {
    onWebContainer(true);
    await hashShareLinkPassword(PASSWORD);
    expect(nodeScrypt).not.toHaveBeenCalled();

    onWebContainer(false);
    await hashShareLinkPassword(PASSWORD);
    expect(nodeScrypt).toHaveBeenCalledTimes(1);
  });

  it('a hash minted on WebContainer verifies natively, and the reverse', async () => {
    expect(pureJsHash).toMatch(/^scrypt\$[0-9a-f]{32}\$[0-9a-f]{128}$/);
    expect(nativeHash).toMatch(/^scrypt\$[0-9a-f]{32}\$[0-9a-f]{128}$/);

    onWebContainer(false);
    expect(await verifyShareLinkPassword(PASSWORD, pureJsHash)).toBe(true);
    expect(await verifyShareLinkPassword('wrong 21839', pureJsHash)).toBe(false);
    expect(nodeScrypt).toHaveBeenCalled();

    onWebContainer(true);
    nodeScrypt.mockClear();
    expect(await verifyShareLinkPassword(PASSWORD, nativeHash)).toBe(true);
    expect(await verifyShareLinkPassword('wrong 21839', nativeHash)).toBe(false);
    expect(nodeScrypt).not.toHaveBeenCalled();
  }, CROSS_VERIFY_BUDGET_MS);

  it('a password whose NFKC form differs from its input is one password on both paths', async () => {
    // A decomposed e + combining acute, and a fullwidth A: NFKC rewrites both.
    const raw = 'cafe\u0301 \uFF21 21839';
    const normalised = 'caf\u00e9 A 21839';
    expect(raw).not.toBe(normalised);
    expect(raw.normalize('NFKC')).toBe(normalised);

    // pure-JS mints, native verifies — either spelling of the same password.
    onWebContainer(true);
    const pureJsHash = await hashShareLinkPassword(raw);
    onWebContainer(false);
    expect(await verifyShareLinkPassword(raw, pureJsHash)).toBe(true);
    expect(await verifyShareLinkPassword(normalised, pureJsHash)).toBe(true);
    expect(await verifyShareLinkPassword('cafe A 21839', pureJsHash)).toBe(false);

    // native mints, pure-JS verifies — either spelling of the same password.
    onWebContainer(false);
    const nativeHash = await hashShareLinkPassword(raw);
    onWebContainer(true);
    nodeScrypt.mockClear();
    expect(await verifyShareLinkPassword(raw, nativeHash)).toBe(true);
    expect(await verifyShareLinkPassword(normalised, nativeHash)).toBe(true);
    expect(await verifyShareLinkPassword('cafe A 21839', nativeHash)).toBe(false);
    expect(nodeScrypt).not.toHaveBeenCalled();
  }, NFKC_BUDGET_MS);

  it('the pure-JS key is byte-identical to node:crypto for the same password and salt', async () => {
    const [, saltHex, keyHex] = pureJsHash.split('$');
    const expected = nodeCrypto
      .scryptSync(PASSWORD.normalize('NFKC'), saltHex!, 64, { N: 16384, r: 16, p: 1, maxmem: 128 * 16384 * 16 * 2 })
      .toString('hex');
    expect(keyHex).toBe(expected);
  });
});
