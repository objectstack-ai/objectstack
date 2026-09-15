// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `#18265` guards — the active environment `os package publish --install`
 * uses comes from the CLOUD credential store, and only from the control plane
 * it belongs to.
 *
 * ## Two guards, because two fixes look alike and only one is correct
 *
 * The symptom is one line: `os environments switch <id>` says "✓ Active
 * environment", and the very next `os package publish --install` answers
 * "`--install` requires `--env <id>`". The tempting repair is to let publish
 * read `credentials.json`, where `switch` used to write the id — and a test
 * that only pinned "a fallback exists" would go GREEN on that repair.
 *
 * It must not. The two credential files carry **different servers**:
 * `credentials.json`'s url falls back to `http://localhost:3000`, `cloud.json`'s
 * default is `https://cloud.objectos.ai`, and the publish POSTs to the latter.
 * An `activeEnvironmentId` read out of the runtime store therefore names an
 * environment on a possibly different control plane, and the server resolves an
 * install target by bare id with no name or short-id rescue. So the guards come
 * in pairs, and each was ablated:
 *
 *   1. delete the fallback  ⇒ `it('installs into the active cloud environment')` reds
 *   2. point the fallback at `credentials.json` ⇒ `it('reads the CLOUD store, not
 *      the runtime store')` reds — the two stores are seeded with DIFFERENT ids
 *      under the SAME url, so only the source of the value can tell them apart.
 *   3. make `os environments create --activate` skip the cloud write ⇒ the
 *      `create --activate` case reds. There are TWO writers of an active
 *      environment id, and fixing only `switch` leaves the most natural path
 *      — create your own dev environment, publish into it — still refusing.
 *
 * ## Why `$HOME` is redirected rather than the modules mocked
 *
 * Both stores build every path from `os.homedir()`, which reads `$HOME` on
 * POSIX and `%USERPROFILE%` on Windows. Redirecting both puts the real
 * `readAuthConfig` / `tryReadCloudConfig` / `writeCloudConfig` on the real
 * `node:fs` under test — including the one-time migration, which is a WRITE
 * whose absence a mocked module would hide.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, mkdir, rm, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import PackagePublish from '../src/commands/package/publish.js';
import EnvironmentsSwitch from '../src/commands/environments/switch.js';
import EnvironmentsCreate from '../src/commands/environments/create.js';

const CLOUD_PLANE = 'http://cloud.test';
const OTHER_PLANE = 'http://self-hosted.test:3000';

/** Env vars that feed an oclif flag on either command — cleared for every case. */
const MANAGED_ENV = [
  'OS_CLOUD_URL',
  'OS_CLOUD_API_KEY',
  'OS_TOKEN',
  'OS_ENVIRONMENT_ID',
  'OS_ORG_ID',
  'OS_PACKAGE_MANIFEST_ID',
  'OS_CLOUD_TIMEOUT_MS',
] as const;

type Call = { url: string; method: string; body: any };

/** Stub `fetch` so both publish POSTs succeed, and record what was sent. */
function stubCloud(): Call[] {
  const calls: Call[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: any = {}) => {
      const body = init?.body ? JSON.parse(init.body) : undefined;
      calls.push({ url: String(url), method: init?.method ?? 'GET', body });
      const data = String(url).endsWith('/versions')
        ? { id: 'ver_1', version: '1.2.0', listing_status: 'draft' }
        : { id: 'pkg_1', created: true, visibility: 'org' };
      return {
        ok: true,
        status: 200,
        statusText: 'OK',
        json: async () => ({ success: true, data }),
      } as any;
    }),
  );
  return calls;
}

/** Stub `fetch` for `os environments switch` — lookup then activate. */
function stubEnvironments(environment: { id: string; display_name?: string }): Call[] {
  const calls: Call[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: any = {}) => {
      calls.push({ url: String(url), method: init?.method ?? 'GET', body: undefined });
      return {
        ok: true,
        status: 200,
        statusText: 'OK',
        json: async () => ({ success: true, data: { environment } }),
      } as any;
    }),
  );
  return calls;
}

describe('#18265: the active environment publish installs into', () => {
  let home = '';
  let work = '';
  let artifactPath = '';
  const previous: Record<string, string | undefined> = {};
  const prevCwd = process.cwd();

  const cloudJson = () => join(home, '.objectstack', 'cloud.json');
  const credentialsJson = () => join(home, '.objectstack', 'credentials.json');

  async function writeCloud(config: Record<string, unknown>): Promise<void> {
    await writeFile(cloudJson(), JSON.stringify(config, null, 2));
  }

  async function writeCredentials(config: Record<string, unknown>): Promise<void> {
    await writeFile(credentialsJson(), JSON.stringify(config, null, 2));
  }

  async function readCloud(): Promise<any> {
    return JSON.parse(await readFile(cloudJson(), 'utf8'));
  }

  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), 'os-18265-home-'));
    work = await mkdtemp(join(tmpdir(), 'os-18265-work-'));
    await mkdir(join(home, '.objectstack'), { recursive: true });

    previous.HOME = process.env.HOME;
    previous.USERPROFILE = process.env.USERPROFILE;
    process.env.HOME = home;
    process.env.USERPROFILE = home;
    for (const key of MANAGED_ENV) {
      previous[key] = process.env[key];
      delete process.env[key];
    }

    artifactPath = join(work, 'objectstack.json');
    await writeFile(
      artifactPath,
      JSON.stringify({
        manifest: { id: 'com.acme.crm', name: 'Acme CRM', version: '1.2.0' },
        objects: [],
      }),
    );
  });

  afterEach(async () => {
    process.chdir(prevCwd);
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    for (const key of ['HOME', 'USERPROFILE', ...MANAGED_ENV]) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
    if (home) await rm(home, { recursive: true, force: true });
    if (work) await rm(work, { recursive: true, force: true });
  });

  /** The body of the `POST .../versions` call, which carries `install_env_id`. */
  function versionBody(calls: Call[]): any {
    const call = calls.find((c) => c.url.endsWith('/versions'));
    expect(
      call,
      'the publish never reached POST /versions -- the fixture broke before the behaviour '
      + 'under test could run, so a passing assertion below would mean nothing',
    ).toBeDefined();
    return call!.body;
  }

  it('redirects both credential stores into the temp home (self-validating fixture)', async () => {
    await writeCloud({ url: CLOUD_PLANE, token: 'cloud_tok', createdAt: 'now' });
    const { tryReadCloudConfig } = await import('../src/utils/cloud-config.js');
    const stored = await tryReadCloudConfig();
    expect(stored?.token).toBe('cloud_tok');
  });

  // ── Guard 1: the fallback exists ────────────────────────────────────────
  it('installs into the active cloud environment when --install carries no --env', async () => {
    await writeCloud({
      url: CLOUD_PLANE,
      token: 'cloud_tok',
      activeEnvironmentId: 'env_cloud_active',
      createdAt: 'now',
    });
    const calls = stubCloud();

    await PackagePublish.run([artifactPath, '--install']);

    expect(versionBody(calls).install_env_id).toBe('env_cloud_active');
    // The publish really went to the plane the id belongs to.
    expect(calls.every((c) => c.url.startsWith(CLOUD_PLANE))).toBe(true);
  });

  // ── Guard 2: it is the CLOUD store, not the runtime store ───────────────
  it('reads the CLOUD store, not the runtime store, even when both name this same server', async () => {
    // Same url on both files, so nothing but the SOURCE of the value can
    // distinguish a correct fallback from a `credentials.json` one.
    await writeCloud({
      url: CLOUD_PLANE,
      token: 'cloud_tok',
      activeEnvironmentId: 'env_from_cloud_json',
      createdAt: 'now',
    });
    await writeCredentials({
      url: CLOUD_PLANE,
      token: 'runtime_tok',
      activeEnvironmentId: 'env_from_credentials_json',
      createdAt: 'now',
    });
    const calls = stubCloud();

    await PackagePublish.run([artifactPath, '--install']);

    const body = versionBody(calls);
    expect(body.install_env_id).toBe('env_from_cloud_json');
    expect(
      body.install_env_id,
      'publish resolved its install target out of the RUNTIME credential store. That file '
      + 'records an environment on whatever server `os login` pointed at -- localhost:3000 by '
      + 'default -- so the id can belong to a different control plane than the one this publish '
      + 'is POSTing to, which the server resolves by bare id with no name rescue.',
    ).not.toBe('env_from_credentials_json');
  });

  it('refuses to install across control planes: an active environment recorded elsewhere is not used', async () => {
    await writeCloud({
      url: CLOUD_PLANE,
      token: 'cloud_tok',
      createdAt: 'now',
    });
    // The runtime store knows an active environment, but on another server.
    await writeCredentials({
      url: OTHER_PLANE,
      token: 'runtime_tok',
      activeEnvironmentId: 'env_on_other_plane',
      createdAt: 'now',
    });
    const calls = stubCloud();

    await PackagePublish.run([artifactPath, '--install']);

    expect(versionBody(calls).install_env_id).toBeUndefined();
    // …and the cross-plane id was not laundered into cloud.json either.
    expect((await readCloud()).activeEnvironmentId).toBeUndefined();
  });

  it('keeps --env authoritative over the active environment', async () => {
    await writeCloud({
      url: CLOUD_PLANE,
      token: 'cloud_tok',
      activeEnvironmentId: 'env_cloud_active',
      createdAt: 'now',
    });
    const calls = stubCloud();

    await PackagePublish.run([artifactPath, '--install', '--env', 'env_explicit']);

    expect(versionBody(calls).install_env_id).toBe('env_explicit');
  });

  it('migrates a pre-existing runtime value into cloud.json once, only when the urls agree', async () => {
    await writeCloud({ url: CLOUD_PLANE, token: 'cloud_tok', createdAt: 'now' });
    await writeCredentials({
      url: CLOUD_PLANE,
      token: 'runtime_tok',
      activeEnvironmentId: 'env_switched_before_upgrade',
      createdAt: 'now',
    });
    const calls = stubCloud();

    await PackagePublish.run([artifactPath, '--install']);

    expect(versionBody(calls).install_env_id).toBe('env_switched_before_upgrade');
    // Copied across, so the runtime store is never consulted again.
    expect((await readCloud()).activeEnvironmentId).toBe('env_switched_before_upgrade');
  });

  it('does not install when neither store has an active environment', async () => {
    await writeCloud({ url: CLOUD_PLANE, token: 'cloud_tok', createdAt: 'now' });
    const calls = stubCloud();

    await PackagePublish.run([artifactPath, '--install']);

    expect(versionBody(calls).install_env_id).toBeUndefined();
  });

  // ── The writing half: `os environments switch` ──────────────────────────
  describe('os environments switch records the id for the cloud plane too', () => {
    it('writes cloud.json when the control plane it talked to is cloud.json’s own', async () => {
      await writeCloud({ url: CLOUD_PLANE, token: 'cloud_tok', createdAt: 'now' });
      await writeCredentials({ url: CLOUD_PLANE, token: 'runtime_tok', createdAt: 'now' });
      stubEnvironments({ id: 'env_switched', display_name: 'Dev' });

      await EnvironmentsSwitch.run(['env_switched']);

      expect((await readCloud()).activeEnvironmentId).toBe('env_switched');
      // The runtime store keeps its copy: `createApiClient` reads THAT one for
      // the data / meta / environments families.
      const runtime = JSON.parse(await readFile(credentialsJson(), 'utf8'));
      expect(runtime.activeEnvironmentId).toBe('env_switched');
    });

    it('leaves cloud.json alone when the switch talked to a different control plane', async () => {
      await writeCloud({ url: CLOUD_PLANE, token: 'cloud_tok', createdAt: 'now' });
      await writeCredentials({ url: OTHER_PLANE, token: 'runtime_tok', createdAt: 'now' });
      stubEnvironments({ id: 'env_self_hosted', display_name: 'Local' });

      await EnvironmentsSwitch.run(['env_self_hosted']);

      expect((await readCloud()).activeEnvironmentId).toBeUndefined();
      const runtime = JSON.parse(await readFile(credentialsJson(), 'utf8'));
      expect(runtime.activeEnvironmentId).toBe('env_self_hosted');
    });
  });

  // ── The other writer: `os environments create --activate` ────────────────
  //
  // `switch` is not the only command that names an active environment, and it
  // is not the one the card's own scenario starts with. "I created my own cloud
  // dev environment, now publish to it" is `create --activate` followed by
  // `publish --install`, with no `switch` anywhere — so a fix that reaches only
  // `switch` still refuses on the most natural path while reading like a fix.
  describe('os environments create --activate records the id for the cloud plane too', () => {
    it('a freshly created environment is immediately a publish target, with no switch in between', async () => {
      await writeCloud({ url: CLOUD_PLANE, token: 'cloud_tok', createdAt: 'now' });
      await writeCredentials({ url: CLOUD_PLANE, token: 'runtime_tok', createdAt: 'now' });
      stubEnvironments({ id: 'env_created', display_name: 'Dev' });

      await EnvironmentsCreate.run(['--org', 'org_1', '--name', 'Dev']);

      expect(
        (await readCloud()).activeEnvironmentId,
        'create --activate recorded the new environment in the runtime store only, so the very '
        + 'next `os package publish --install` cannot see it. That is the same defect as the one '
        + 'this file guards on `switch`, one command over.',
      ).toBe('env_created');

      // The runtime store keeps its copy too — `createApiClient` reads THAT one.
      const runtime = JSON.parse(await readFile(credentialsJson(), 'utf8'));
      expect(runtime.activeEnvironmentId).toBe('env_created');

      // …and the publish half really resolves it, end to end.
      const calls = stubCloud();
      await PackagePublish.run([artifactPath, '--install']);
      expect(versionBody(calls).install_env_id).toBe('env_created');
    });

    it('leaves cloud.json alone when the create talked to a different control plane', async () => {
      await writeCloud({ url: CLOUD_PLANE, token: 'cloud_tok', createdAt: 'now' });
      await writeCredentials({ url: OTHER_PLANE, token: 'runtime_tok', createdAt: 'now' });
      stubEnvironments({ id: 'env_self_hosted_new', display_name: 'Local' });

      await EnvironmentsCreate.run(['--org', 'org_1', '--name', 'Local']);

      expect((await readCloud()).activeEnvironmentId).toBeUndefined();
      const runtime = JSON.parse(await readFile(credentialsJson(), 'utf8'));
      expect(runtime.activeEnvironmentId).toBe('env_self_hosted_new');
    });
  });
});
