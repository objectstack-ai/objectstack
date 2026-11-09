// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `os environments use-runtime` (#30888): a self-hosted runtime remembered as
 * the deploy target — its url and key in `~/.objectstack/cloud.json` (0600),
 * the file the cloud token lives in, as their own record that the cloud
 * session's writes carry across (`utils/cloud-config.ts`'s header).
 *
 * Run for real under a redirected `$HOME`; `fetch` is the runtime.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import EnvironmentsUseRuntime from '../src/commands/environments/use-runtime.js';
import {
  deleteCloudConfig, readCloudConfig, resolveCloudCredential, tryReadCloudConfig, writeCloudConfig, DEFAULT_CLOUD_URL,
} from '../src/utils/cloud-config.js';
import { activateCloudDeployTarget, activeRuntimeTarget, storedRuntimeTarget } from '../src/utils/runtime-target.js';

describe('os environments use-runtime', () => {
  let home = '';
  let output: string[] = [];
  const cloudFile = () => join(home, '.objectstack', 'cloud.json');
  const stored = async () => JSON.parse(await readFile(cloudFile(), 'utf-8'));

  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), 'os-30888-use-runtime-'));
    await mkdir(join(home, '.objectstack'), { recursive: true });
    vi.stubEnv('HOME', home);
    vi.stubEnv('USERPROFILE', home);
    vi.stubEnv('OS_RUNTIME_TOKEN', undefined);
    vi.stubEnv('OS_TOKEN', undefined);
    vi.stubEnv('OS_CLOUD_URL', undefined);
    output = [];
    const record = (...args: unknown[]) => { output.push(args.map(String).join(' ')); };
    vi.spyOn(console, 'log').mockImplementation(record);
    vi.spyOn(console, 'error').mockImplementation(record);
  });
  afterEach(async () => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    await rm(home, { recursive: true, force: true });
  });

  function stubProbe(status: number): Array<{ url: string; auth: string | undefined }> {
    const seen: Array<{ url: string; auth: string | undefined }> = [];
    vi.stubGlobal('fetch', vi.fn(async (input: string, init: any = {}) => {
      seen.push({ url: String(input), auth: init.headers?.Authorization });
      return { ok: status < 300, status, statusText: String(status), json: async () => ({}) } as any;
    }));
    return seen;
  }

  async function run(argv: string[]): Promise<number | undefined> {
    try {
      await EnvironmentsUseRuntime.run(argv);
      return undefined;
    } catch (err: any) {
      const exit = err?.oclif?.exit ?? err?.exitCode;
      if (exit === undefined) throw err;
      return exit;
    }
  }
  const text = () => output.join('\n');

  it('tries the key on the install-local door, then records url + key as the active target in cloud.json (0600)', async () => {
    const seen = stubProbe(200);

    expect(await run(['http://localhost:8080/', '--token', 'osk_1']), text()).toBeUndefined();

    expect(seen).toEqual([{ url: 'http://localhost:8080/api/v1/marketplace/install-local', auth: 'Bearer osk_1' }]);
    const file = await stored();
    expect(file.runtimeTarget).toMatchObject({ url: 'http://localhost:8080', token: 'osk_1' });
    expect(file.deployTarget).toBe('runtime');
    if (process.platform !== 'win32') expect((await stat(cloudFile())).mode & 0o777).toBe(0o600);
    expect(await activeRuntimeTarget()).toMatchObject({ url: 'http://localhost:8080', token: 'osk_1' });
    // Recorded without a cloud login: still not logged in to the cloud.
    expect(await tryReadCloudConfig()).toBeUndefined();
    await expect(readCloudConfig()).rejects.toThrow('Not logged in to ObjectOS Cloud');
  });

  it('keeps the cloud session it finds, and the cloud reads never see the runtime key', async () => {
    await writeFile(cloudFile(), JSON.stringify({ url: 'http://cloud.test', token: 'cloud_tok', createdAt: 'now', activeEnvironmentId: 'env_1' }));
    stubProbe(200);

    expect(await run(['http://localhost:8080', '--token', 'osk_1'])).toBeUndefined();

    const file = await stored();
    expect(file).toMatchObject({ url: 'http://cloud.test', token: 'cloud_tok', activeEnvironmentId: 'env_1' });
    expect(await resolveCloudCredential({ server: DEFAULT_CLOUD_URL })).toEqual({ token: 'cloud_tok', baseUrl: 'http://cloud.test' });
  });

  it.each([
    [401, 'rejected the key'],
    [404, 'does not serve install-local'],
  ])('a probe answered %i is refused, naming why, and records nothing', async (status, words) => {
    stubProbe(status);
    expect(await run(['http://localhost:8080', '--token', 'osk_1'])).toBe(1);
    expect(text()).toContain(words);
    expect(text()).toContain('Nothing was recorded');
    expect(existsSync(cloudFile())).toBe(false);
  });

  it('--no-verify records without asking the runtime; no key is refused', async () => {
    const seen = stubProbe(500);
    expect(await run(['http://localhost:8080'])).toBe(1);
    expect(text()).toContain('needs an API key it issued');

    expect(await run(['http://localhost:8080', '--token', 'osk_1', '--no-verify'])).toBeUndefined();
    expect(seen).toHaveLength(0);
    expect((await stored()).runtimeTarget.url).toBe('http://localhost:8080');
  });

  it('refuses a url that is not an http(s) base url', async () => {
    stubProbe(200);
    expect(await run(['localhost:8080', '--token', 'osk_1'])).toBe(1);
    expect(await run(['http://localhost:8080/?x=1', '--token', 'osk_1'])).toBe(1);
    expect(existsSync(cloudFile())).toBe(false);
  });

  it('--forget drops the record; the cloud is the target again, and the cloud session stays', async () => {
    await writeFile(cloudFile(), JSON.stringify({
      url: 'http://cloud.test', token: 'cloud_tok', createdAt: 'now',
      runtimeTarget: { url: 'http://localhost:8080', token: 'osk_1', recordedAt: 'then' }, deployTarget: 'runtime',
    }));
    expect(await run(['--forget'])).toBeUndefined();
    const file = await stored();
    expect(file.runtimeTarget).toBeUndefined();
    expect(file.deployTarget).toBeUndefined();
    expect(file.token).toBe('cloud_tok');
    expect(text()).toContain('Forgot the self-hosted runtime http://localhost:8080');
  });
});

describe('cloud.json — the cloud session and the deploy target outlive each other', () => {
  let home = '';
  const cloudFile = () => join(home, '.objectstack', 'cloud.json');
  const RUNTIME_HALF = { runtimeTarget: { url: 'http://localhost:8080', token: 'osk_1', recordedAt: 'then' }, deployTarget: 'runtime' };

  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), 'os-30888-cloud-json-'));
    await mkdir(join(home, '.objectstack'), { recursive: true });
    vi.stubEnv('HOME', home);
    vi.stubEnv('USERPROFILE', home);
  });
  afterEach(async () => {
    vi.unstubAllEnvs();
    await rm(home, { recursive: true, force: true });
  });

  it('a cloud write (a fresh login) keeps the runtime target', async () => {
    await writeFile(cloudFile(), JSON.stringify({ url: 'http://old.test', token: 'old', createdAt: 'x', ...RUNTIME_HALF }));
    await writeCloudConfig({ url: 'http://new.test', token: 'new', createdAt: 'y' });
    const file = JSON.parse(await readFile(cloudFile(), 'utf-8'));
    expect(file).toMatchObject({ url: 'http://new.test', token: 'new', ...RUNTIME_HALF });
  });

  it('a cloud logout clears the session and keeps the runtime target; with none, the file goes', async () => {
    await writeFile(cloudFile(), JSON.stringify({ url: 'http://cloud.test', token: 'tok', createdAt: 'x', ...RUNTIME_HALF }));
    await deleteCloudConfig();
    expect(JSON.parse(await readFile(cloudFile(), 'utf-8'))).toEqual(RUNTIME_HALF);
    expect(await storedRuntimeTarget()).toMatchObject({ url: 'http://localhost:8080' });

    await writeFile(cloudFile(), JSON.stringify({ url: 'http://cloud.test', token: 'tok', createdAt: 'x' }));
    await deleteCloudConfig();
    expect(existsSync(cloudFile())).toBe(false);
  });

  it('`os environments switch` (activateCloudDeployTarget) makes the cloud the target and keeps the runtime', async () => {
    await writeFile(cloudFile(), JSON.stringify({ url: 'http://cloud.test', token: 'tok', createdAt: 'x', ...RUNTIME_HALF }));
    expect(await activateCloudDeployTarget()).toBe('http://localhost:8080');
    expect(await activeRuntimeTarget()).toBeUndefined();
    expect(await storedRuntimeTarget()).toMatchObject({ url: 'http://localhost:8080', token: 'osk_1' });
    // Already the cloud: nothing to say, nothing written.
    expect(await activateCloudDeployTarget()).toBeUndefined();
  });
});
