// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#25224 cut 11] The WebContainer password hasher of `AuthManager` — the
 * pure-JS scrypt hasher handed to better-auth when the runtime is StackBlitz's
 * WebContainer, whose `node:crypto.scrypt` polyfill fails sign-up — moved out
 * of `auth-manager.ts` whole.
 *
 * A MOVE, not a redesign. The function below is the body of the
 * `AuthManager` method of the same name as it stood, re-indented one level
 * and otherwise unedited: the same runtime test, the same scrypt parameters
 * and `{saltHex}:{keyHex}` storage format, the same lazy load of
 * `@noble/hashes` (only inside WebContainer), and the same warning and
 * fallback when that load fails.
 *
 * ## How the moved body reaches the class
 *
 * The shape #23050 set for `rest-server.ts` (its `data-action-routes.ts`
 * header carries the full reasoning), which the ten `auth-manager-*.ts`
 * modules split out before this one follow. The class keeps the method — the
 * published `dist/*.d.ts` lists it — and its body is a plain call: it reads
 * no member of the class, so it is handed none, and there is no host type.
 * It is no longer `async`: it returns the moved function's own promise, so a
 * caller awaits the same promise the body settles, with no extra wrapper.
 *
 * `isWebContainerRuntime` stays: the request-state polyfill in
 * `auth-manager.ts`, which the constructor installs, reads it too. So that
 * file exports it and this module imports it by VALUE, for one read inside
 * `resolvePasswordHasher`, when the better-auth instance is built.
 * `index.ts` lists `auth-manager.ts`'s published names one by one, so that
 * export is not published. The two modules import each other, and that is
 * safe because nothing reads the binding while they are first evaluated: this
 * module's top level is one import and one function declaration.
 *
 * Nothing re-exports this module, so the published surface does not move.
 */

import { isWebContainerRuntime } from './auth-manager.js';

/** The body of `AuthManager#resolvePasswordHasher`; the method's docblock there is its contract. */
export async function resolvePasswordHasher(): Promise<
  { hash: (password: string) => Promise<string>; verify: (args: { hash: string; password: string }) => Promise<boolean> } | undefined
> {
  if (!isWebContainerRuntime()) return undefined;
  try {
    const { scryptAsync } = await import('@noble/hashes/scrypt.js');
    const PARAMS = { N: 16384, r: 16, p: 1, dkLen: 64, maxmem: 128 * 16384 * 16 * 2 } as const;
    const toHex = (b: Uint8Array): string => {
      let s = '';
      for (let i = 0; i < b.length; i++) s += b[i]!.toString(16).padStart(2, '0');
      return s;
    };
    const generateKey = (password: string, saltHex: string): Promise<Uint8Array> =>
      scryptAsync(password.normalize('NFKC'), saltHex, PARAMS);
    return {
      hash: async (password: string) => {
        const saltBytes = (globalThis as any).crypto.getRandomValues(new Uint8Array(16));
        const saltHex = toHex(saltBytes);
        const key = await generateKey(password, saltHex);
        return `${saltHex}:${toHex(key)}`;
      },
      verify: async ({ hash, password }) => {
        const [saltHex, keyHex] = hash.split(':');
        if (!saltHex || !keyHex) throw new Error('Invalid password hash');
        const target = await generateKey(password, saltHex);
        return toHex(target) === keyHex;
      },
    };
  } catch (err: any) {
    console.warn(
      `[AuthManager] WebContainer detected but pure-JS scrypt unavailable: ${err?.message ?? err}. Falling back to default.`,
    );
    return undefined;
  }
}
