// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #29934 — the ONE data-key file `os dev` and `os start` hand their `serve`
 * child. Each case drives `applyCryptoKeyFileChannel` with the inputs the
 * command passes it (see `commands/dev.ts` and `commands/start.ts`), then
 * builds the provider the child builds over the child env, so the assertion is
 * about the key the child ends up with, not about a path string alone.
 *
 * The public-door reproduction (a real `os dev` boot, then a real `os start`
 * boot, one settings secret) is `test/dev-start-shared-data-key.integration.test.ts`.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { LocalCryptoProvider } from '@objectstack/service-settings';
import { applyCryptoKeyFileChannel } from './internal-crypto-key-file-channel.js';

const CHANNEL = 'OS_INTERNAL_CRYPTO_KEY_FILE';
const ctx = { scope: 'settings', namespace: 'ai', key: 'openai_api_key' } as const;

let home: string;
let project: string;
/** The operator's environment: no key of any spelling, `HOME` is this test's. */
let operatorEnv: NodeJS.ProcessEnv;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'os-29934-home-'));
  project = mkdtempSync(join(tmpdir(), 'os-29934-project-'));
  writeFileSync(join(project, 'objectstack.config.ts'), 'export default {};\n');
  operatorEnv = { HOME: home };
});
afterEach(() => {
  rmSync(home, { recursive: true, force: true });
  rmSync(project, { recursive: true, force: true });
});

const canonicalFile = () => join(home, '.objectstack', 'dev-crypto-key');
const legacyFile = () => join(project, '.objectstack', 'dev-crypto-key');

function writeKey(file: string): Buffer {
  const key = randomBytes(32);
  mkdirSync(join(file, '..'), { recursive: true });
  writeFileSync(file, key.toString('base64'), { mode: 0o600 });
  return key;
}

/** `os dev`'s child: the operator env, development posture. */
async function devChild(env = operatorEnv) {
  const child: NodeJS.ProcessEnv = { ...env, NODE_ENV: 'development' };
  const notice = await applyCryptoKeyFileChannel(child, { env, cwd: project, hasProjectConfig: true });
  return { child, notice };
}

/** `os start`'s child: its own home as `OS_HOME`, production posture, the auto-key opt-in. */
async function startChild(env = operatorEnv, homeFlag?: string) {
  const child: NodeJS.ProcessEnv = {
    ...env,
    OS_HOME: homeFlag ?? join(project, '.objectstack'),
    NODE_ENV: 'production',
    OS_CRYPTO_AUTOKEY: '1',
  };
  const notice = await applyCryptoKeyFileChannel(child, { env, cwd: project, hasProjectConfig: true, homeFlag });
  return { child, notice };
}

describe('#29934 — one key file for `os dev` and `os start`', () => {
  it('a secret sealed under `os dev` opens under `os start` over the same project', async () => {
    const dev = await devChild();
    const sealed = await new LocalCryptoProvider({ env: dev.child }).encrypt('sk-test', ctx);

    const start = await startChild();
    expect(start.child[CHANNEL]).toBe(canonicalFile());
    expect(await new LocalCryptoProvider({ env: start.child }).decrypt(sealed, ctx)).toBe('sk-test');
    expect(existsSync(legacyFile())).toBe(false);
    expect([dev.notice, start.notice]).toEqual([undefined, undefined]);
  });

  it('`--home` is start\'s spelling of `OS_HOME`: the key stays in that home', async () => {
    const pinned = join(home, 'pinned-home');
    const start = await startChild(operatorEnv, pinned);
    expect(start.child[CHANNEL]).toBe(join(pinned, 'dev-crypto-key'));
    expect(start.notice).toBeUndefined();
  });
});

describe('#29934 — the key file an earlier `os start` kept in the project', () => {
  it('only the legacy file holds a key: both commands read it, and say which file', async () => {
    const legacy = writeKey(legacyFile());
    const sealed = await new LocalCryptoProvider({ key: legacy }).encrypt('sk-legacy', ctx);

    for (const { child, notice } of [await startChild(), await devChild()]) {
      expect(child[CHANNEL]).toBe(legacyFile());
      expect(notice).toContain(legacyFile());
      expect(notice).toContain(canonicalFile());
      expect(await new LocalCryptoProvider({ env: child }).decrypt(sealed, ctx)).toBe('sk-legacy');
    }
    // Read, never copied or re-minted: the canonical file is still absent.
    expect(existsSync(canonicalFile())).toBe(false);
  });

  it('both files hold different keys: the canonical one is used, and the warning names both', async () => {
    writeKey(legacyFile());
    const canonical = writeKey(canonicalFile());
    const sealed = await new LocalCryptoProvider({ key: canonical }).encrypt('sk-canonical', ctx);

    for (const { child, notice } of [await startChild(), await devChild()]) {
      expect(child[CHANNEL]).toBe(canonicalFile());
      expect(notice).toContain(`${canonicalFile()} (used)`);
      expect(notice).toContain(`${legacyFile()} (NOT used)`);
      expect(await new LocalCryptoProvider({ env: child }).decrypt(sealed, ctx)).toBe('sk-canonical');
    }
  });

  it('both files hold the same key: no warning', async () => {
    const key = writeKey(canonicalFile());
    mkdirSync(join(project, '.objectstack'), { recursive: true });
    writeFileSync(legacyFile(), key.toString('hex'), { mode: 0o600 });
    const start = await startChild();
    expect(start.child[CHANNEL]).toBe(canonicalFile());
    expect(start.notice).toBeUndefined();
  });
});

describe('#29934 — an explicit env key keeps winning, unchanged', () => {
  it.each([
    ['OS_SECRET_KEY', randomBytes(32).toString('hex')],
    ['OS_DEV_CRYPTO_KEY', randomBytes(32).toString('base64')],
  ])('%s set: no file is named and an inherited channel is removed', async (name, value) => {
    writeKey(legacyFile());
    const env = { ...operatorEnv, [name]: value, [CHANNEL]: '/inherited/elsewhere' };
    for (const { child, notice } of [await startChild(env), await devChild(env)]) {
      expect(child[CHANNEL]).toBeUndefined();
      expect(notice).toBeUndefined();
    }
  });
});
