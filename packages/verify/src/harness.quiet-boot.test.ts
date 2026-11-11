// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#32154] A passing `bootStack` run reads as a passing run; a failing one
// still reads as a failure.
//
// `bootStack` is what a project's `pnpm test` and `os verify` boot. On the
// blank starter a PASSING run printed hundreds of INFO records, 263
// `[Registry] …` lines (`os verify`) and, outside a test runner, two
// better-auth warnings per boot about the harness's own fixed secret. What
// this file pins:
//
//   1. at the default level (`OS_LOG_LEVEL` unset, `OS_REGISTRY_LOG` unset) a
//      passing boot writes no `[Registry]` line and no INFO record of the
//      kernel's;
//   2. the control: the same boot at `OS_LOG_LEVEL=debug` writes that chatter,
//      so (1) is a reading, not a capture that sees nothing;
//   3. a FAILING boot at the default level still prints its failure: the
//      kernel's ERROR record naming the plugin, and the error reaches the
//      caller;
//   4. the auth secret the boot hands `AuthPlugin` is 32 random bytes, held by
//      the process, of a length and spread better-auth does not warn about,
//      and it seals and opens: a session cookie it signed is accepted by the
//      same boot and by a restart over the same database file, and refused by
//      a boot holding another secret.
//
// better-auth skips its secret check under a test runner (`TEST` is set), so
// (4) pins the secret's shape, that the boot uses it, and that it works; the
// warnings' absence was read on `os verify` itself (PR body). The kernel
// logger writes to `process.stdout` / `process.stderr`, the registry and the
// drivers to `console`, so the capture holds both. Every boot runs in a hook:
// a case measures behaviour, never loading.

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
// The two packages `bootStack` imports dynamically, loaded at module top so the
// first boot pays their transform during collection, not inside its hook.
import '@objectstack/service-automation';
import '@objectstack/service-datasource';
// `.js` extension deliberate: this package resolves NodeNext.
import { bootStack, harnessAuthSecret, type BootOptions, type VerifyStack } from './harness.js';

const BOOT_TIMEOUT = 180_000;
const OBJECT = 'quietboot_memo';

/** A fresh configuration per boot: a live boot holds references into its definitions. */
const app = () => ({
  manifest: {
    id: 'com.example.quiet-boot',
    namespace: 'quietboot',
    version: '0.0.1',
    type: 'app',
    name: 'Quiet Boot Fixture',
  },
  objects: [
    {
      name: OBJECT,
      label: 'Memo',
      fields: { title: { name: 'title', label: 'Title', type: 'text', required: true } },
    },
  ],
});

/** Every line the boot and the case write, through `console` or the process streams. */
interface Captured {
  lines: string[];
}

// eslint-disable-next-line no-control-regex
const ANSI = /\u001b\[[0-9;]*m/g;

/** Capture `console.*` and `process.stdout/stderr.write` for the life of `fn`, printing nothing. */
async function captureOutput<T>(fn: () => Promise<T>): Promise<{ value: T } & Captured> {
  const lines: string[] = [];
  const push = (text: string) => {
    for (const line of text.replace(ANSI, '').split('\n')) if (line.trim() !== '') lines.push(line);
  };
  const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((channel) =>
    vi.spyOn(console, channel).mockImplementation((...args: unknown[]) => {
      push(args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' '));
    }),
  );
  const streams = [process.stdout, process.stderr].map((stream) => {
    const original = stream.write;
    (stream as any).write = (chunk: unknown) => {
      push(typeof chunk === 'string' ? chunk : Buffer.from(chunk as Uint8Array).toString('utf8'));
      return true;
    };
    return () => {
      (stream as any).write = original;
    };
  });
  try {
    return { value: await fn(), lines };
  } finally {
    for (const restore of streams) restore();
    for (const spy of spies) spy.mockRestore();
  }
}

/** Run `fn` with the level variables set as given (undefined = unset), then put them back. */
async function withLevelEnv<T>(env: { OS_LOG_LEVEL?: string }, fn: () => Promise<T>): Promise<T> {
  const keys = ['OS_LOG_LEVEL', 'LOG_LEVEL', 'OS_REGISTRY_LOG'] as const;
  const saved = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  for (const k of keys) delete process.env[k];
  if (env.OS_LOG_LEVEL !== undefined) process.env.OS_LOG_LEVEL = env.OS_LOG_LEVEL;
  try {
    return await fn();
  } finally {
    for (const k of keys) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  }
}

const KERNEL_RECORD = (level: string) => new RegExp(`^\\S+Z ${level} `);
const isRegistryLine = (line: string) => line.startsWith('[Registry]');
/**
 * An INFO record of the kernel's logger. `MetadataManager` builds its own
 * logger at a fixed `info` before any host can hand it a level, so its
 * `Registered metadata loader: …` line still prints at the default level; that
 * logger is outside this change (reported on #32154), so the line is left out
 * here by its exact text, and this case stays true once it is fixed.
 */
const isKernelInfoRecord = (line: string) =>
  KERNEL_RECORD('INFO').test(line) && !/^\S+Z INFO Registered metadata loader: /.test(line);

const FAILING_PLUGIN = 'com.example.quietboot.failing';
const FAILING_MESSAGE = 'quiet-boot pin: this plugin refuses to start';

/** A plugin whose `start()` throws: the boot fails, and must say so at the default level. */
const failingPlugin = () => ({
  name: FAILING_PLUGIN,
  version: '0.0.1',
  async init() {},
  async start() {
    throw new Error(FAILING_MESSAGE);
  },
});

/** The `name=value` pairs a response set, as a request `cookie` header. */
const cookieFrom = (response: Response): string =>
  (response.headers.getSetCookie?.() ?? [response.headers.get('set-cookie') ?? ''])
    .map((c) => c.split(';')[0])
    .filter(Boolean)
    .join('; ');

/** Sign the dev admin in by the browser path and hand back the session cookie the secret signed. */
async function signInCookie(stack: VerifyStack): Promise<string> {
  const res = await stack.api('/auth/sign-in/email', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'admin@objectos.ai', password: 'admin123' }),
  });
  expect(res.status).toBe(200);
  const cookie = cookieFrom(res);
  expect(cookie).toContain('session_token=');
  return cookie;
}

/**
 * Does this boot open the cookie? `/get-session` answers a live session `200`
 * with `{ user }` and anything else `401`; the body is read, not only the
 * status, so an open is proven by the user it names.
 */
async function opens(stack: VerifyStack, cookie: string): Promise<{ status: number; email?: string }> {
  const res = await stack.api('/auth/get-session', { headers: { cookie } });
  const body = (await res.json().catch(() => null)) as { user?: { email?: string } } | null;
  return { status: res.status, email: body?.user?.email };
}

/** Boot, run `fn` against the stack, stop; all of it captured so nothing prints. */
async function withBoot<T>(opts: BootOptions, fn: (stack: VerifyStack) => Promise<T>): Promise<T> {
  const booted = await captureOutput(() => bootStack(app(), opts));
  try {
    return (await captureOutput(() => fn(booted.value))).value;
  } finally {
    await captureOutput(() => booted.value.stop());
  }
}

describe('[#32154] a passing bootStack run reads as a passing run', () => {
  // Boot A: the default level, the default secret.
  let quietBoot: Captured;
  let authPluginSecret: unknown;

  // Boot B: the same app at `OS_LOG_LEVEL=debug` — the control.
  let debugBoot: Captured;

  // Boot F: the default level, a plugin that refuses to start.
  let failedBoot: Captured & { value: unknown };

  beforeAll(async () => {
    await withLevelEnv({}, async () => {
      const booted = await captureOutput(() => bootStack(app()));
      quietBoot = booted;
      const stack = booted.value;
      // The `AuthPlugin` instance this boot mounted, read for the secret it
      // was constructed with (a private field: there is no public reader).
      authPluginSecret = (stack.kernel as any).plugins?.get('com.objectstack.auth')?.options?.secret;
      await captureOutput(() => stack.stop());

      failedBoot = await captureOutput(() =>
        bootStack(app(), { extraPlugins: [failingPlugin()] }).then(
          async (unexpected) => {
            await unexpected.stop();
            return undefined;
          },
          (error: unknown) => error,
        ),
      );
    });

    await withLevelEnv({ OS_LOG_LEVEL: 'debug' }, async () => {
      const booted = await captureOutput(() => bootStack(app()));
      debugBoot = booted;
      await captureOutput(() => booted.value.stop());
    });
  }, BOOT_TIMEOUT);

  describe('at the default level', () => {
    it("writes no [Registry] line and no INFO record of the kernel's", () => {
      expect(quietBoot.lines.filter(isRegistryLine)).toEqual([]);
      expect(quietBoot.lines.filter(isKernelInfoRecord)).toEqual([]);
    });
  });

  describe('the control: the same boot at OS_LOG_LEVEL=debug', () => {
    it('writes the INFO records and the [Registry] lines the default boot leaves out', () => {
      expect(debugBoot.lines.filter(isKernelInfoRecord).length).toBeGreaterThan(0);
      expect(debugBoot.lines.filter(isRegistryLine).length).toBeGreaterThan(0);
    });
  });

  describe('a failing boot at the default level', () => {
    it('reaches the caller as the error the plugin threw', () => {
      expect(failedBoot.value).toBeInstanceOf(Error);
      expect(String((failedBoot.value as Error).message)).toContain(FAILING_MESSAGE);
    });

    it("prints the kernel's ERROR record naming the plugin", () => {
      const errorRecords = failedBoot.lines.filter((line) => KERNEL_RECORD('ERROR').test(line));
      expect(errorRecords.some((line) => line.includes(`Plugin startup failed: ${FAILING_PLUGIN}`))).toBe(true);
    });
  });

  describe('the auth secret', () => {
    let dir: string;
    let sameBoot: { status: number; email?: string };
    let restartBoot: { status: number; email?: string };
    let otherSecretBoot: { status: number; email?: string };

    beforeAll(async () => {
      dir = mkdtempSync(join(tmpdir(), 'verify-quiet-boot-secret-'));
      const databaseFile = join(dir, 'stack.db');
      await withLevelEnv({}, async () => {
        // Sealed and opened by one boot.
        const cookie = await withBoot({ databaseFile }, async (stack) => {
          const sealed = await signInCookie(stack);
          sameBoot = await opens(stack, sealed);
          return sealed;
        });
        // Opened by the harness's restart: a second boot in this process over
        // the same database file holds the same secret.
        restartBoot = await withBoot({ databaseFile }, (stack) => opens(stack, cookie));
        // The control: the same database and session row, another secret. If
        // the cookie opened here, the secret would not be what opens it.
        otherSecretBoot = await withBoot(
          { databaseFile, authSecret: randomBytes(32).toString('base64url') },
          (stack) => opens(stack, cookie),
        );
      });
    }, BOOT_TIMEOUT);

    afterAll(() => {
      if (dir) rmSync(dir, { recursive: true, force: true });
    });

    it('is 32 random bytes, at least 32 characters, held by the process', () => {
      const secret = harnessAuthSecret();
      expect(Buffer.from(secret, 'base64url')).toHaveLength(32);
      expect(secret.length).toBeGreaterThanOrEqual(32);
      // better-auth's own estimate (`estimateEntropy`, create-context): bits =
      // length x log2(distinct characters); it warns below 120.
      expect(secret.length * Math.log2(new Set(secret).size)).toBeGreaterThanOrEqual(120);
      expect(harnessAuthSecret()).toBe(secret);
    });

    it('is the secret the boot handed AuthPlugin', () => {
      expect(authPluginSecret).toBe(harnessAuthSecret());
    });

    it('opens the session cookie it sealed, in the same boot and after a restart', () => {
      expect(sameBoot).toEqual({ status: 200, email: 'admin@objectos.ai' });
      expect(restartBoot).toEqual({ status: 200, email: 'admin@objectos.ai' });
    });

    it('is what opens it: a boot holding another secret refuses the same cookie', () => {
      expect(otherSecretBoot.status).toBe(401);
      expect(otherSecretBoot.email).toBeUndefined();
    });
  });
});
