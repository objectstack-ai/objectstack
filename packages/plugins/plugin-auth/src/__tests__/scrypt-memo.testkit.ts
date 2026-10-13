// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Test scaffolding [#23184]: one production-parameter scrypt derivation per
 * distinct input, per test file.
 *
 * better-auth hashes and verifies every password with `node:crypto.scrypt` at
 * its production parameters (N=16384, r=16, p=1, a 64-byte key, through
 * `@better-auth/utils/password.node`): about 0.1 s per derivation on a dev
 * container and several times that on a loaded `Test Core` shard. A suite that
 * signs a user up and then signs the same user in derives the same password
 * against the same salt twice, and the suites in this package do that in
 * nearly every case.
 *
 * So, while installed, `node:crypto.scrypt` answers an input this file has
 * already derived with the bytes the real call produced, and runs the real
 * call for any other. The key is EVERY input: password, salt, key length and
 * the options object (cost parameters and `maxmem`). scrypt is a pure
 * function, so a hit is exactly what a fresh call would return, and an input
 * not seen before (the fresh salt of a sign-up, a wrong password, another
 * normalisation, other parameters) is judged by a real derivation, as before.
 * An input already being derived for a concurrent case is waited for, not
 * derived twice. Nothing above `node:crypto` is replaced: better-auth salts,
 * stores, compares and refuses exactly as it does in production.
 *
 * How it reaches better-auth: vitest loads the vendor natively from
 * `node_modules` rather than transforming it, so a `vi.mock('node:crypto')`
 * never reaches the vendor's own import. The replacement is made on the
 * builtin's exports object and published to every ES-module importer with
 * `syncBuiltinESMExports()`, the Node API for exactly this; `restore()` puts
 * the original back the same way.
 *
 * Use it once per test file. A second install in the same module graph (a
 * test file importing another test file that installs it) shares the first
 * one; the original comes back when the last install is restored.
 *
 * ```ts
 * const scrypt = memoizeScrypt();
 * afterAll(scrypt.restore);
 * ```
 */

import nodeCrypto from 'node:crypto';
import { syncBuiltinESMExports } from 'node:module';

type ScryptReply = (err: Error | null, derivedKey: Buffer) => void;

/** The handle one install returns. */
export interface ScryptMemo {
  /** Real derivations run, and calls answered from the memo, since the first install. */
  counts(): { derived: number; answered: number };
  /** Undo this install; the original `scrypt` returns with the last one. Idempotent. */
  restore(): void;
}

interface Installed {
  original: typeof nodeCrypto.scrypt;
  installs: number;
  derived: number;
  answered: number;
}

let installed: Installed | undefined;

/**
 * The builtin's CommonJS exports object, through which the ES-module named
 * exports are re-published. Typed mutable here: the declared module type is
 * read-only, the object itself is not.
 */
const cryptoExports = nodeCrypto as unknown as { scrypt: typeof nodeCrypto.scrypt };

/** A memo key part, or `undefined` for an input shape this memo does not key (it then runs the real call). */
function keyPart(value: unknown): readonly [string, string] | undefined {
  if (typeof value === 'string') return ['string', value];
  if (ArrayBuffer.isView(value)) {
    return ['bytes', Buffer.from(value.buffer, value.byteOffset, value.byteLength).toString('hex')];
  }
  if (value instanceof ArrayBuffer) return ['bytes', Buffer.from(value).toString('hex')];
  return undefined;
}

function createMemoizedScrypt(state: Installed): typeof nodeCrypto.scrypt {
  const original = state.original;
  const done = new Map<string, Buffer>();
  const inFlight = new Map<string, ScryptReply[]>();

  function scrypt(password: unknown, salt: unknown, keylen: number, options: unknown, callback?: unknown): void {
    const [opts, reply] = (typeof options === 'function' ? [{}, options] : [options ?? {}, callback]) as [
      nodeCrypto.ScryptOptions,
      ScryptReply,
    ];
    const passwordPart = keyPart(password);
    const saltPart = keyPart(salt);
    if (!passwordPart || !saltPart) {
      original(password as nodeCrypto.BinaryLike, salt as nodeCrypto.BinaryLike, keylen, opts, reply);
      return;
    }
    const key = JSON.stringify([passwordPart, saltPart, keylen, opts]);

    const hit = done.get(key);
    if (hit) {
      state.answered += 1;
      // Asynchronous like the real call, and a copy: no caller can alter the memo.
      process.nextTick(reply, null, Buffer.from(hit));
      return;
    }
    const waiting = inFlight.get(key);
    if (waiting) {
      state.answered += 1;
      waiting.push(reply);
      return;
    }

    state.derived += 1;
    inFlight.set(key, [reply]);
    try {
      original(password as nodeCrypto.BinaryLike, salt as nodeCrypto.BinaryLike, keylen, opts, (err, out) => {
        const replies = inFlight.get(key) ?? [];
        inFlight.delete(key);
        if (!err) done.set(key, Buffer.from(out));
        for (const r of replies) r(err, err ? out : Buffer.from(out));
      });
    } catch (err) {
      // A synchronous refusal (bad arguments) reaches only this caller, as it would unmemoized.
      inFlight.delete(key);
      throw err;
    }
  }

  return scrypt as unknown as typeof nodeCrypto.scrypt;
}

/** Install the memo for this test file; pair it with `afterAll(memo.restore)`. */
export function memoizeScrypt(): ScryptMemo {
  if (!installed) {
    const state: Installed = { original: cryptoExports.scrypt, installs: 0, derived: 0, answered: 0 };
    cryptoExports.scrypt = createMemoizedScrypt(state);
    syncBuiltinESMExports();
    installed = state;
  }
  const state = installed;
  state.installs += 1;
  let restored = false;
  return {
    counts: () => ({ derived: state.derived, answered: state.answered }),
    restore() {
      if (restored) return;
      restored = true;
      state.installs -= 1;
      if (state.installs === 0 && installed === state) {
        cryptoExports.scrypt = state.original;
        syncBuiltinESMExports();
        installed = undefined;
      }
    },
  };
}
