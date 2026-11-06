// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#30126 row 13, ruling A] `os package install` names its server and its
 * credential the way `os package export` and the other server-talking
 * commands do: `-u/--url` and `-t/--token`.
 *
 * Pinned:
 *  - `--url` (and `-u`) is the server the install POST goes to, trailing
 *    slashes dropped;
 *  - `-r` / `--runtime` are gone with NO alias: either is refused as an
 *    unknown flag before any request;
 *  - `--token` (and `-t`, and OS_RUNTIME_TOKEN) is sent as
 *    `Authorization: Bearer …` on the install POST, with no sign-in request;
 *  - a token together with `--email`/`--password` is refused before any
 *    request — the command never has to guess which one the caller meant.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import PackageInstall from '../src/commands/package/install.js';

interface Sent { url: string; method?: string; headers: Record<string, string>; body?: string }

const ANSWER = {
  manifestId: 'com.acme.crm', version: '1.0.0', versionId: 'ver_1', installedAt: '2026-11-06T00:00:00.000Z',
  hotLoaded: true, storageDir: '/srv/runtime/.objectstack/installed-packages',
};

/** Stub every request the command sends; answer the install POST with success. */
function stubRuntime(): { sent: Sent[] } {
  const sent: Sent[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) => {
    sent.push({ url: String(url), method: init?.method, headers: { ...(init?.headers ?? {}) }, body: init?.body });
    return {
      ok: true,
      status: 200,
      statusText: 'OK',
      headers: { get: () => null },
      json: async () => ({ success: true, data: ANSWER }),
    } as any;
  }));
  return { sent };
}

async function runInstall(args: string[]): Promise<{ out: string; exit: number | undefined }> {
  const lines: string[] = [];
  const capture = (...a: unknown[]) => { lines.push(a.map(String).join(' ')); };
  vi.spyOn(console, 'log').mockImplementation(capture);
  vi.spyOn(console, 'error').mockImplementation(capture);
  vi.spyOn(process.stderr, 'write').mockImplementation(((chunk: unknown) => { lines.push(String(chunk)); return true; }) as any);
  let exit: number | undefined;
  try {
    await PackageInstall.run(['com.acme.crm', ...args]);
  } catch (err: any) {
    lines.push(String(err?.message ?? err));
    exit = err?.oclif?.exit ?? err?.code ?? 1;
  }
  return { out: lines.join('\n'), exit };
}

describe('os package install -u/--url and -t/--token (#30126 row 13)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('posts the install to the server --url names, trailing slash dropped', async () => {
    const { sent } = stubRuntime();
    const { exit } = await runInstall(['--url', 'http://runtime.test/']);
    expect(exit).toBeUndefined();
    expect(sent).toHaveLength(1);
    expect(sent[0].url).toBe('http://runtime.test/api/v1/marketplace/install-local');
  });

  it('takes -u as the short spelling of --url', async () => {
    const { sent } = stubRuntime();
    await runInstall(['-u', 'http://short.test']);
    expect(sent[0].url).toBe('http://short.test/api/v1/marketplace/install-local');
  });

  it.each([['--runtime'], ['-r']])('refuses the retired %s as an unknown flag before any request (no alias)', async (flag) => {
    const { sent } = stubRuntime();
    const { out, exit } = await runInstall([flag, 'http://runtime.test']);
    expect(exit).not.toBeUndefined();
    expect(out).toMatch(/Nonexistent flag|Unexpected argument/);
    expect(sent).toHaveLength(0);
  });

  it('sends --token as a bearer token on the install POST, and no sign-in request', async () => {
    const { sent } = stubRuntime();
    const { exit } = await runInstall(['--url', 'http://runtime.test', '--token', 'osk_test']);
    expect(exit).toBeUndefined();
    expect(sent).toHaveLength(1);
    expect(sent[0].url).toMatch(/\/api\/v1\/marketplace\/install-local$/);
    expect(sent[0].headers.Authorization).toBe('Bearer osk_test');
  });

  it('takes -t and OS_RUNTIME_TOKEN as the same credential', async () => {
    const { sent } = stubRuntime();
    await runInstall(['--url', 'http://runtime.test', '-t', 'osk_short']);
    expect(sent[0].headers.Authorization).toBe('Bearer osk_short');

    vi.restoreAllMocks();
    const second = stubRuntime();
    vi.stubEnv('OS_RUNTIME_TOKEN', 'osk_env');
    await runInstall(['--url', 'http://runtime.test']);
    expect(second.sent[0].headers.Authorization).toBe('Bearer osk_env');
  });

  it('sends no Authorization header without a token', async () => {
    const { sent } = stubRuntime();
    await runInstall(['--url', 'http://runtime.test']);
    expect(sent[0].headers).not.toHaveProperty('Authorization');
  });

  it('refuses a token together with --email/--password before any request', async () => {
    const { sent } = stubRuntime();
    const { out, exit } = await runInstall([
      '--url', 'http://runtime.test', '--token', 'osk_test', '--email', 'a@b.test', '--password', 'pw',
    ]);
    expect(exit).toBe(1);
    expect(out).toContain('Pass either --token or --email/--password, not both');
    expect(sent).toHaveLength(0);
  });
});
