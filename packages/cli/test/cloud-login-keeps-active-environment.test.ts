// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `os cloud login` keeps the active environment (#30871 item 2).
 *
 * `cloud.json`'s `activeEnvironmentId` is the install target `os package
 * publish --install` and `os deploy` read back. A login used to rewrite the
 * file whole, so the id was gone after every login and the next install had
 * to be told again. The login now merges — and keeps the id ONLY where it can
 * still resolve: the same control plane, the same account. Each case below is
 * one side of that gate, run through the real command against the real file
 * under a redirected `$HOME`; only the network login itself is stubbed.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, mkdir, rm, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

vi.mock('../src/utils/auth-flows.js', () => ({
  loginWithPassword: vi.fn(async (_url: string, email: string) => ({
    token: 'fresh_tok',
    user: { id: email === 'other@acme.test' ? 'usr_other' : 'usr_1', email },
  })),
  loginWithBrowser: vi.fn(),
}));

const { default: CloudLogin } = await import('../src/commands/cloud/login.js');

const CLOUD_PLANE = 'http://cloud.test';

describe('os cloud login keeps the active environment', () => {
  let home = '';
  const previous: Record<string, string | undefined> = {};
  const cloudJson = () => join(home, '.objectstack', 'cloud.json');
  const readCloud = async () => JSON.parse(await readFile(cloudJson(), 'utf8'));

  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), 'os-30871-login-'));
    await mkdir(join(home, '.objectstack'), { recursive: true });
    for (const key of ['HOME', 'USERPROFILE', 'OS_CLOUD_URL']) previous[key] = process.env[key];
    process.env.HOME = home;
    process.env.USERPROFILE = home;
    delete process.env.OS_CLOUD_URL;
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await rm(home, { recursive: true, force: true });
  });

  async function seed(config: Record<string, unknown>) {
    await writeFile(cloudJson(), JSON.stringify(config, null, 2));
  }

  it('keeps activeEnvironmentId across a re-login to the same control plane and account', async () => {
    await seed({ url: CLOUD_PLANE, token: 'old_tok', userId: 'usr_1', activeEnvironmentId: 'env_kept', createdAt: 'then' });

    await CloudLogin.run(['--url', CLOUD_PLANE, '--email', 'me@acme.test', '--password', 'pw', '--force']);

    const stored = await readCloud();
    expect(stored.token, 'the fixture never reached the write — the assertion below would mean nothing').toBe('fresh_tok');
    expect(stored.activeEnvironmentId).toBe('env_kept');
  });

  it('keeps it when the url differs only by a trailing slash', async () => {
    await seed({ url: `${CLOUD_PLANE}/`, token: 'old_tok', userId: 'usr_1', activeEnvironmentId: 'env_kept', createdAt: 'then' });

    await CloudLogin.run(['--url', CLOUD_PLANE, '--email', 'me@acme.test', '--password', 'pw', '--force']);

    expect((await readCloud()).activeEnvironmentId).toBe('env_kept');
  });

  it('drops it when the login is to a different control plane', async () => {
    await seed({ url: 'http://elsewhere.test', token: 'old_tok', userId: 'usr_1', activeEnvironmentId: 'env_elsewhere', createdAt: 'then' });

    await CloudLogin.run(['--url', CLOUD_PLANE, '--email', 'me@acme.test', '--password', 'pw', '--force']);

    const stored = await readCloud();
    expect(stored.token).toBe('fresh_tok');
    expect(stored.activeEnvironmentId).toBeUndefined();
  });

  it('drops it when a different account logs in to the same control plane', async () => {
    await seed({ url: CLOUD_PLANE, token: 'old_tok', userId: 'usr_1', activeEnvironmentId: 'env_of_usr_1', createdAt: 'then' });

    await CloudLogin.run(['--url', CLOUD_PLANE, '--email', 'other@acme.test', '--password', 'pw', '--force']);

    const stored = await readCloud();
    expect(stored.userId).toBe('usr_other');
    expect(stored.activeEnvironmentId).toBeUndefined();
  });
});
