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

import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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

  // [#30797] A user who exported OS_RUNTIME_EMAIL/OS_RUNTIME_PASSWORD once is
  // refused with only --token on the line: the sentence says why.
  it('refuses --token with OS_RUNTIME_EMAIL/OS_RUNTIME_PASSWORD exported, and names both env families', async () => {
    const { sent } = stubRuntime();
    vi.stubEnv('OS_RUNTIME_EMAIL', 'a@b.test');
    vi.stubEnv('OS_RUNTIME_PASSWORD', 'pw');
    const { out, exit } = await runInstall(['--url', 'http://runtime.test', '--token', 'osk_test']);
    expect(exit).toBe(1);
    expect(out).toContain(
      'Pass either --token or --email/--password, not both '
      + '(OS_RUNTIME_TOKEN counts as --token; OS_RUNTIME_EMAIL/OS_RUNTIME_PASSWORD count as --email/--password).',
    );
    expect(sent).toHaveLength(0);
  });
});

describe('os package install falls back to the runtime `os environments use-runtime` remembered (#30888)', () => {
  const REMEMBERED = 'http://remembered.test:8080';
  let home = '';
  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), 'os-30888-install-home-'));
    await mkdir(join(home, '.objectstack'), { recursive: true });
    vi.stubEnv('HOME', home);
    vi.stubEnv('USERPROFILE', home);
    for (const key of ['OS_RUNTIME_URL', 'OS_RUNTIME_TOKEN', 'OS_RUNTIME_EMAIL', 'OS_RUNTIME_PASSWORD']) vi.stubEnv(key, undefined);
    // Remembered but NOT the active deploy target: install reads it either way.
    await writeFile(join(home, '.objectstack', 'cloud.json'), JSON.stringify({
      runtimeTarget: { url: REMEMBERED, token: 'osk_remembered', recordedAt: 'then' }, deployTarget: 'cloud',
    }));
  });
  afterEach(async () => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    await rm(home, { recursive: true, force: true });
  });

  it('without -u/-t: installs into the remembered runtime with its key, and says where it came from', async () => {
    const { sent } = stubRuntime();
    const { out, exit } = await runInstall([]);
    expect(exit, out).toBeUndefined();
    expect(sent.map((s) => s.url)).toEqual([`${REMEMBERED}/api/v1/marketplace/install-local`]);
    expect(sent[0].headers.Authorization).toBe('Bearer osk_remembered');
    expect(out).toContain('remembered by `os environments use-runtime`');
  });

  it('-u naming the remembered runtime still takes its key', async () => {
    const { sent } = stubRuntime();
    await runInstall(['-u', `${REMEMBERED}/`]);
    expect(sent[0].headers.Authorization).toBe('Bearer osk_remembered');
  });

  it('-u naming another server never receives the remembered key', async () => {
    const { sent } = stubRuntime();
    await runInstall(['-u', 'http://other.test']);
    expect(sent[0].url).toBe('http://other.test/api/v1/marketplace/install-local');
    expect(sent[0].headers).not.toHaveProperty('Authorization');
  });

  it('an explicit -t wins over the remembered key; --email/--password never mixes the two', async () => {
    let { sent } = stubRuntime();
    await runInstall(['-t', 'osk_explicit']);
    expect(sent[0].headers.Authorization).toBe('Bearer osk_explicit');

    vi.unstubAllGlobals();
    ({ sent } = stubRuntime());
    await runInstall(['--email', 'a@b.test', '--password', 'pw']);
    expect(sent.every((s) => !('Authorization' in s.headers))).toBe(true);
  });

  it('nothing remembered: http://localhost:3000, as before', async () => {
    await rm(join(home, '.objectstack', 'cloud.json'));
    const { sent } = stubRuntime();
    await runInstall([]);
    expect(sent[0].url).toBe('http://localhost:3000/api/v1/marketplace/install-local');
    expect(sent[0].headers).not.toHaveProperty('Authorization');
  });
});
