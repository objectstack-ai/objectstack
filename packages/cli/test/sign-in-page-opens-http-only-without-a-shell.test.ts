// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The device flow's sign-in page opens only for an http or https address,
 * and every opener — and `os mcp connect`'s client launch — runs from an argv
 * array without a shell, on every platform branch.
 *
 * Driven through both device flows the CLI has: `loginWithBrowser` in
 * `utils/auth-flows.ts` (what `os cloud login` runs) and `os login`'s own
 * `loginWithBrowser`, with `fetch` standing in for the server and
 * `node:child_process` mocked, so nothing is started for real.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const cp = vi.hoisted(() => ({
  exec: vi.fn(),
  execSync: vi.fn(),
  execFile: vi.fn(),
  spawn: vi.fn(),
  spawnSync: vi.fn(),
}));

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  return { ...actual, ...cp, default: { ...actual, ...cp } };
});

const fsMock = vi.hoisted(() => ({ files: new Set<string>() }));
vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  const statSync = ((target: string, options?: unknown) =>
    fsMock.files.has(String(target))
      ? ({ isFile: () => true } as unknown as import('node:fs').Stats)
      : actual.statSync(target, options as never)) as typeof actual.statSync;
  return { ...actual, statSync, default: { ...actual, statSync } };
});

import { loginWithBrowser } from '../src/utils/auth-flows.js';
import AuthLogin from '../src/commands/login.js';
import { mcpClientRunner, resolveClientExecutable } from '../src/commands/mcp/connect.js';

const PLAIN = 'https://sign-in.example.test/device?user_code=ABCD-EFGH';
/** An https address whose query and fragment hold punctuation. */
const PUNCTUATED = 'https://sign-in.example.test/device?user_code=AB&x=a|b;c$(d)`e`^f%g!h"i\'j<k>#l m';

const realPlatform = process.platform;
function onPlatform(platform: NodeJS.Platform): void {
  Object.defineProperty(process, 'platform', { value: platform, configurable: true });
}

/** A server answering the device-code request with `address`, then `poll` on every poll. */
function stubServer(address: string, poll: { status: number; body: unknown }): void {
  vi.stubGlobal('fetch', vi.fn(async (input: string) => {
    if (String(input).endsWith('/device/code')) {
      return new Response(JSON.stringify({
        device_code: 'dev-code',
        user_code: 'ABCD-EFGH',
        verification_uri: 'https://sign-in.example.test/device',
        verification_uri_complete: address,
        expires_in: 5,
        interval: 0.001,
      }), { status: 200 });
    }
    if (String(input).endsWith('/device/token')) return new Response(JSON.stringify(poll.body), { status: poll.status });
    return new Response('{}', { status: 404 });
  }));
}

const FLOWS = {
  'os cloud login (utils/auth-flows)': async (address: string) => {
    stubServer(address, { status: 200, body: { access_token: 'token' } });
    await loginWithBrowser('https://server.example.test');
  },
  'os login': async (address: string) => {
    stubServer(address, { status: 400, body: { error: 'access_denied' } });
    const flow = (AuthLogin.prototype as unknown as {
      loginWithBrowser(client: unknown, url: string, noBrowser: boolean, json?: boolean): Promise<void>;
    }).loginWithBrowser;
    await expect(flow.call({}, undefined, 'https://server.example.test', false, false)).rejects.toThrow('Login denied by user.');
  },
} as const;

const OPENERS: Record<'darwin' | 'linux' | 'win32', (href: string) => [string, string[]]> = {
  darwin: (href) => ['open', [href]],
  linux: (href) => ['xdg-open', [href]],
  win32: (href) => ['C:\\Windows\\System32\\rundll32.exe', ['url.dll,FileProtocolHandler', href]],
};

let logged: string[];

beforeEach(() => {
  for (const fn of Object.values(cp)) fn.mockReset();
  cp.spawn.mockImplementation(() => ({ on: vi.fn(), unref: vi.fn() }));
  logged = [];
  vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => { logged.push(args.join(' ')); });
  vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  vi.stubEnv('SystemRoot', '');
  vi.stubEnv('SYSTEMROOT', '');
  vi.stubEnv('windir', '');
});

afterEach(() => {
  onPlatform(realPlatform);
  fsMock.files.clear();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe.each(Object.entries(FLOWS))('%s: the sign-in page opens from an argv array, without a shell', (_name, run) => {
  for (const platform of ['darwin', 'linux', 'win32'] as const) {
    for (const [label, address] of [['a plain https address', PLAIN], ['an https address with punctuation', PUNCTUATED]] as const) {
      it(`${platform}: ${label} is one argument of the opener, and no shell is involved`, async () => {
        onPlatform(platform);
        await run(address);

        expect(cp.exec).not.toHaveBeenCalled();
        expect(cp.execSync).not.toHaveBeenCalled();
        expect(cp.spawn).toHaveBeenCalledTimes(1);
        const [command, args, options] = cp.spawn.mock.calls[0] as [string, string[], { shell?: unknown }];
        const [expectedCommand, expectedArgs] = OPENERS[platform](new URL(address).href);
        expect(command).toBe(expectedCommand);
        expect(args).toEqual(expectedArgs);
        expect(options.shell).toBe(false);
        expect(logged.some((line) => line.includes('Browser opened automatically'))).toBe(true);
      });
    }
  }

  for (const address of ['file:///etc/hosts', 'javascript:void(0)', 'ms-settings:privacy', 'sign-in.example.test/device', 'not a url']) {
    it(`an address that is not http or https is never launched, and is printed instead: ${JSON.stringify(address)}`, async () => {
      onPlatform('linux');
      await run(address);

      for (const fn of Object.values(cp)) expect(fn).not.toHaveBeenCalled();
      expect(logged.some((line) => line.includes(address))).toBe(true);
      expect(logged.some((line) => line.includes('Browser opened automatically'))).toBe(false);
      expect(logged.some((line) => line.includes('not an http or https address'))).toBe(true);
    });
  }
});

describe('os mcp connect starts the client from an argv array, without a shell', () => {
  const ARGS = ['mcp', 'add', '--transport', 'http', 'acme', 'https://acme.example.test/api/v1/mcp'];

  it('win32: runs the `claude.exe` found on PATH by its absolute path, with no shell', () => {
    onPlatform('win32');
    vi.stubEnv('PATH', 'relative\\bin;C:\\Users\\me\\.local\\bin;C:\\npm');
    fsMock.files.add('C:\\Users\\me\\.local\\bin\\claude.exe');
    fsMock.files.add('C:\\npm\\claude.cmd');
    cp.spawnSync.mockReturnValue({ status: 0 });

    mcpClientRunner.run('claude', ARGS);

    expect(cp.spawnSync).toHaveBeenCalledTimes(1);
    const [command, args, options] = cp.spawnSync.mock.calls[0] as [string, string[], { shell?: unknown }];
    expect(command).toBe('C:\\Users\\me\\.local\\bin\\claude.exe');
    expect(args).toEqual(ARGS);
    expect(options.shell).toBe(false);
  });

  it('win32: a batch-file shim alone is not run, and the answer says why', () => {
    onPlatform('win32');
    vi.stubEnv('PATH', 'C:\\npm');
    fsMock.files.add('C:\\npm\\claude.cmd');

    const ran = mcpClientRunner.run('claude', ARGS);

    expect(cp.spawnSync).not.toHaveBeenCalled();
    expect((ran.error as NodeJS.ErrnoException).code).toBe('EBATCHSHIM');
    expect(ran.error?.message).toBe('C:\\npm\\claude.cmd');
  });

  it('win32: nothing on PATH is ENOENT, and the current directory is not searched', () => {
    onPlatform('win32');
    vi.stubEnv('PATH', '.;bin');
    fsMock.files.add('.\\claude.exe');

    const ran = mcpClientRunner.run('claude', ARGS);

    expect(cp.spawnSync).not.toHaveBeenCalled();
    expect((ran.error as NodeJS.ErrnoException).code).toBe('ENOENT');
  });

  it.each(['darwin', 'linux'] as const)('%s: runs `claude` by name, with no shell', (platform) => {
    onPlatform(platform);
    cp.spawnSync.mockReturnValue({ status: 0 });

    mcpClientRunner.run('claude', ARGS);

    const [command, args, options] = cp.spawnSync.mock.calls[0] as [string, string[], { shell?: unknown }];
    expect(command).toBe('claude');
    expect(args).toEqual(ARGS);
    expect(options.shell).toBe(false);
  });

  it('the Windows lookup takes, per PATH entry, the file `cmd.exe` would run for the name', () => {
    const lookup = (files: string[], PATH: string) =>
      resolveClientExecutable('claude', { platform: 'win32', env: { Path: PATH }, isFile: (f) => files.includes(f) });
    expect(lookup(['C:\\a\\claude.cmd', 'C:\\b\\claude.exe'], 'C:\\a;C:\\b')).toEqual({ kind: 'batch-shim', path: 'C:\\a\\claude.cmd' });
    expect(lookup(['C:\\a\\claude.cmd', 'C:\\a\\claude.exe'], '"C:\\a"')).toEqual({ kind: 'found', path: 'C:\\a\\claude.exe' });
    expect(lookup([], 'C:\\a')).toEqual({ kind: 'missing' });
  });
});
