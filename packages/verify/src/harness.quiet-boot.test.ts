// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#32154] A passing `bootStack` run reads as a passing run.
//
// `bootStack` is what a project's `pnpm test` and `os verify` boot. On the
// blank starter a PASSING run printed hundreds of INFO records, 263
// `[Registry] …` lines (`os verify`), a `DATABASE_ERROR … no such table:
// _objectstack_sequences`, a WARN with a stack trace for the refusal the
// starter's own test asserts, and, outside a test runner, two better-auth
// warnings per boot about the harness's own secret. What this file pins:
//
//   1. at the default level (`OS_LOG_LEVEL` unset, `OS_REGISTRY_LOG` unset) a
//      boot writes no INFO record, no `[Registry]` line and no
//      `DATABASE_ERROR`, and an expected refusal writes no WARN;
//   2. the control: the same boot at `OS_LOG_LEVEL=debug` writes all of the
//      chatter (so (1) is a reading, not a capture that sees nothing), and the
//      refusal's line is still there, at DEBUG;
//   3. the auth secret the boot hands `AuthPlugin` is 32 random bytes, held by
//      the process, of a length and spread better-auth does not warn about.
//
// better-auth skips its secret check under a test runner (`TEST` is set), so
// (3) pins the secret's shape and that the boot uses it; the warnings' absence
// was read on `os verify` itself (PR body). The kernel logger writes to
// `process.stdout` / `process.stderr`, the registry and the drivers to
// `console`, so the capture holds both. Every boot runs in a hook: a case
// measures behaviour, never loading.

import { describe, it, expect, beforeAll, vi } from 'vitest';
// The two packages `bootStack` imports dynamically, loaded at module top so the
// first boot pays their transform during collection, not inside its hook.
import '@objectstack/service-automation';
import '@objectstack/service-datasource';
// `.js` extension deliberate: this package resolves NodeNext.
import { bootStack, harnessAuthSecret, type VerifyStack } from './harness.js';

const BOOT_TIMEOUT = 120_000;
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

/** Run `fn` with the two level variables set as given (undefined = unset), then put them back. */
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
const isInfoRecord = (line: string) => KERNEL_RECORD('INFO').test(line);
const isRegistryLine = (line: string) => line.startsWith('[Registry]');
const isDatabaseError = (line: string) => line.includes('DATABASE_ERROR');
const isRefusalLine = (line: string) => line.includes('Insert operation failed');

/** Insert a memo with no title: the refusal the starter's own test asserts. */
async function refuseMissingTitle(stack: VerifyStack, token: string): Promise<{ code?: string }> {
  try {
    await stack.hooks.run(OBJECT, 'insert', {}, { as: token });
  } catch (e) {
    return e as { code?: string };
  }
  throw new Error('the insert without a title was not refused');
}

describe('[#32154] a passing bootStack run reads as a passing run', () => {
  // Boot A: the default level, the default secret.
  let quietBoot: Captured;
  let quietRefusal: Captured & { value: { code?: string } };
  let authPluginSecret: unknown;

  // Boot B: the same app at `OS_LOG_LEVEL=debug` — the control.
  let debugBoot: Captured;
  let debugRefusal: Captured & { value: { code?: string } };

  beforeAll(async () => {
    await withLevelEnv({}, async () => {
      const booted = await captureOutput(() => bootStack(app()));
      quietBoot = booted;
      const stack = booted.value;
      try {
        // The `AuthPlugin` instance this boot mounted, read for the secret it
        // was constructed with (a private field: there is no public reader).
        authPluginSecret = (stack.kernel as any).plugins?.get('com.objectstack.auth')?.options?.secret;
        const token = await stack.signIn();
        quietRefusal = await captureOutput(() => refuseMissingTitle(stack, token));
      } finally {
        await captureOutput(() => stack.stop());
      }
    });

    await withLevelEnv({ OS_LOG_LEVEL: 'debug' }, async () => {
      const booted = await captureOutput(() => bootStack(app()));
      debugBoot = booted;
      const stack = booted.value;
      try {
        const token = await stack.signIn();
        debugRefusal = await captureOutput(() => refuseMissingTitle(stack, token));
      } finally {
        await captureOutput(() => stack.stop());
      }
    });
  }, BOOT_TIMEOUT);

  describe('at the default level', () => {
    it('writes no INFO record and no [Registry] line', () => {
      expect(quietBoot.lines.filter(isInfoRecord)).toEqual([]);
      expect(quietBoot.lines.filter(isRegistryLine)).toEqual([]);
    });

    it('writes no DATABASE_ERROR for a sequences table that is simply not there yet', () => {
      expect(quietBoot.lines.filter(isDatabaseError)).toEqual([]);
    });

    it('logs no WARN for an expected refusal, and the caller is still told', () => {
      expect(quietRefusal.value.code).toBe('VALIDATION_FAILED');
      expect(quietRefusal.lines.filter(isRefusalLine)).toEqual([]);
    });
  });

  describe('the control: the same boot at OS_LOG_LEVEL=debug', () => {
    it('writes the INFO records and the [Registry] lines the default boot leaves out', () => {
      expect(debugBoot.lines.filter(isInfoRecord).length).toBeGreaterThan(0);
      expect(debugBoot.lines.filter(isRegistryLine).length).toBeGreaterThan(0);
    });

    it('still writes no DATABASE_ERROR: the probe asks the catalog, at any level', () => {
      expect(debugBoot.lines.filter(isDatabaseError)).toEqual([]);
    });

    it("keeps the refusal's line, at DEBUG and not at WARN", () => {
      expect(debugRefusal.value.code).toBe('VALIDATION_FAILED');
      const lines = debugRefusal.lines.filter(isRefusalLine);
      expect(lines.length).toBeGreaterThan(0);
      expect(lines.every((line) => KERNEL_RECORD('DEBUG').test(line))).toBe(true);
    });
  });

  describe('the auth secret', () => {
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
  });
});
