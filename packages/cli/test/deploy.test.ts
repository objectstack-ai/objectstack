// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `os deploy` — the dev loop's defaults, against a stubbed control plane
 * (#30871, scope amendment item 1).
 *
 * The command is run for real: its own credential and environment resolution,
 * `os package publish` in-process for the publish, the real `cloud.json` under
 * a redirected `$HOME`. Two seams are replaced: the build step
 * (`compileForDeploy`, which would spawn a CLI) writes a fixed artifact, and
 * `fetch` is the control plane.
 *
 * The wait reads `data.served` on `GET …/environments/{id}/packages/{manifestId}`,
 * the contract objectstack-ai/cloud#3651 declares in objectstack-ai/cloud#3662
 * (`utils/served-version.ts` states it). The `served` fixtures below are that
 * shape.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

const compileForDeploy = vi.fn<(artifactPath: string) => number>();
vi.mock('../src/utils/deploy-build.js', () => ({ compileForDeploy: (p: string) => compileForDeploy(p) }));

const { default: Deploy, reportVerdict } = await import('../src/commands/deploy.js');
const { waitUntilServed, interpretServedReport } = await import('../src/utils/served-version.js');
const { devVersion } = await import('../src/utils/dev-version.js');

const CLOUD_PLANE = 'http://cloud.test';
const MANAGED_ENV = ['OS_CLOUD_URL', 'OS_CLOUD_API_KEY', 'OS_TOKEN', 'OS_ENVIRONMENT_ID', 'OS_ORG_ID', 'OS_PACKAGE_MANIFEST_ID', 'OS_CLOUD_TIMEOUT_MS'] as const;

type Call = { url: string; method: string; body: any };

interface PlaneOptions {
  environments?: Array<Record<string, unknown>>;
  /** `data.served` on the package read, given the version the publish created; absent ⇒ an older control plane. */
  served?: (published: { versionId: string; version: string }) => Record<string, unknown>;
  /** The environment's hostname on its detail read (default `acme.example.test`; `null` ⇒ none). */
  hostname?: string | null;
}

const ENV_ORIGIN = 'https://acme.example.test';

/** The control plane: list, detail, package upsert, version publish (+install), package read — and the environment itself. */
function stubPlane(options: PlaneOptions = {}): Call[] {
  const calls: Call[] = [];
  let published = { versionId: '', version: '' };
  let versionCount = 0;
  vi.stubGlobal('fetch', vi.fn(async (input: string, init: any = {}) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    const body = init?.body && typeof init.body === 'string' ? JSON.parse(init.body) : undefined;
    calls.push({ url, method, body });
    const answer = (data: unknown) => ({ ok: true, status: 200, statusText: 'OK', json: async () => ({ success: true, data }) }) as any;
    if (url.startsWith(ENV_ORIGIN)) {
      // The environment itself: building, so a request-driven 503.
      return { ok: false, status: 503, statusText: 'Service Unavailable', json: async () => ({ error: { code: 'kernel_warming' } }) } as any;
    }
    if (method === 'GET' && url.endsWith('/api/v1/cloud/environments')) {
      const environments = options.environments ?? [{ id: 'env_acme', display_name: 'Acme', status: 'active' }];
      return answer({ environments, total: environments.length });
    }
    if (method === 'POST' && url.endsWith('/api/v1/cloud/packages')) {
      return answer({ id: 'pkg_1', created: false, visibility: 'org' });
    }
    if (method === 'POST' && url.endsWith('/api/v1/cloud/packages/pkg_1/versions')) {
      versionCount += 1;
      published = { versionId: `ver_${versionCount}`, version: body.version };
      return answer({
        id: published.versionId,
        version: body.version,
        listing_status: 'draft',
        installation: body.install_env_id ? { environment_id: body.install_env_id, installation_id: 'inst_1' } : null,
      });
    }
    if (method === 'GET' && /\/api\/v1\/cloud\/environments\/[^/]+\/packages\/[^/]+$/.test(url)) {
      return answer({
        package: { manifest_id: 'com.acme.crm', status: 'installed' },
        installed: true,
        installationId: 'inst_1',
        version: published.version,
        ...(options.served ? { served: options.served(published) } : {}),
      });
    }
    if (method === 'GET' && /\/api\/v1\/cloud\/environments\/[^/]+$/.test(url)) {
      const hostname = options.hostname === undefined ? 'acme.example.test' : options.hostname;
      return answer({ environment: { id: url.split('/').pop(), ...(hostname ? { hostname } : {}) } });
    }
    return { ok: false, status: 404, statusText: 'Not Found', json: async () => ({ success: false, error: { message: `unexpected ${method} ${url}` } }) } as any;
  }));
  return calls;
}

describe('os deploy — the dev loop with no flags', () => {
  let home = '';
  let work = '';
  const previous: Record<string, string | undefined> = {};
  const prevCwd = process.cwd();
  let output: string[] = [];

  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), 'os-30871-deploy-home-'));
    work = await mkdtemp(join(tmpdir(), 'os-30871-deploy-work-'));
    await mkdir(join(home, '.objectstack'), { recursive: true });
    for (const key of ['HOME', 'USERPROFILE', ...MANAGED_ENV]) previous[key] = process.env[key];
    process.env.HOME = home;
    process.env.USERPROFILE = home;
    for (const key of MANAGED_ENV) delete process.env[key];
    await writeFile(join(home, '.objectstack', 'cloud.json'), JSON.stringify({ url: CLOUD_PLANE, token: 'cloud_tok', createdAt: 'now' }));
    process.chdir(work);

    compileForDeploy.mockReset();
    compileForDeploy.mockImplementation((artifactPath: string) => {
      // A synchronous write, as the real child's exit is: the artifact exists when the step returns.
      mkdirSync(dirname(artifactPath), { recursive: true });
      writeFileSync(artifactPath, JSON.stringify({ manifest: { id: 'com.acme.crm', name: 'Acme CRM', version: '1.2.0' }, objects: [] }));
      return 0;
    });

    output = [];
    const record = (...args: unknown[]) => { output.push(args.map(String).join(' ')); };
    vi.spyOn(console, 'log').mockImplementation(record);
    vi.spyOn(console, 'error').mockImplementation(record);
  });

  afterEach(async () => {
    process.chdir(prevCwd);
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await rm(home, { recursive: true, force: true });
    await rm(work, { recursive: true, force: true });
  });

  async function deploy(argv: string[] = []): Promise<number | undefined> {
    try {
      await Deploy.run(argv);
      return undefined;
    } catch (err: any) {
      const exit = err?.oclif?.exit ?? err?.exitCode;
      if (exit === undefined) throw err;
      return exit;
    }
  }

  const text = () => output.join('\n');
  const versionPost = (calls: Call[]) => calls.find((c) => c.method === 'POST' && c.url.endsWith('/versions'));
  const writes = (calls: Call[]) => calls.filter((c) => c.method !== 'GET');
  const live = (p: { versionId: string; version: string }) => ({
    state: 'live', desiredVersionId: p.versionId, versionId: p.versionId, version: p.version,
    observedStatus: 'installed', observedAt: new Date().toISOString(), error: null,
  });
  const packageReads = (calls: Call[]) => calls.filter((c) => c.method === 'GET' && /\/packages\/com\.acme\.crm$/.test(c.url));

  it('builds, publishes <manifest.version>-dev.<UTC timestamp>, installs into the only environment, and reports it live', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-06T08:30:05Z'));
    const calls = stubPlane({ served: live });

    const exit = await deploy();

    expect(exit, text()).toBeUndefined();
    expect(compileForDeploy).toHaveBeenCalledWith(join(work, 'dist', 'objectstack.json'));
    const body = versionPost(calls)!.body;
    expect(body.version).toBe('1.2.0-dev.20261106083005');
    expect(body.is_pre_release).toBe(true);
    expect(body.install_env_id).toBe('env_acme');
    expect(text()).toContain("Deploying to Acme (env_acme), your organization's only environment");
    expect(text()).toContain('Live: Acme (env_acme) now serves com.acme.crm 1.2.0-dev.20261106083005.');
    // The wait read `served` for THIS package in THIS environment — never the installed-state probe —
    // and woke the environment itself, whose builds are request-driven.
    expect(packageReads(calls).map((c) => c.url)).toContain(`${CLOUD_PLANE}/api/v1/cloud/environments/env_acme/packages/com.acme.crm`);
    expect(calls.some((c) => c.url.includes('/installations/'))).toBe(false);
    expect(calls.some((c) => c.url === `${ENV_ORIGIN}/api/v1/discovery`)).toBe(true);
  });

  it('deploys twice in a row from a fixed manifest.version, each time a new version, with no flag', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const calls = stubPlane({ served: live });

    vi.setSystemTime(new Date('2026-11-06T08:30:05Z'));
    expect(await deploy()).toBeUndefined();
    vi.setSystemTime(new Date('2026-11-06T08:31:40Z'));
    expect(await deploy()).toBeUndefined();

    const versions = calls.filter((c) => c.method === 'POST' && c.url.endsWith('/versions')).map((c) => c.body.version);
    expect(versions).toEqual(['1.2.0-dev.20261106083005', '1.2.0-dev.20261106083140']);
  });

  it("prints the environment's build-failure reason and exits 1", async () => {
    const calls = stubPlane({
      served: (p) => ({
        state: 'failed', desiredVersionId: p.versionId, versionId: 'ver_previous', version: '1.2.0-dev.20261106080000',
        observedStatus: 'failed', observedAt: new Date().toISOString(), error: 'Object crm_deal: field stage references unknown picklist',
      }),
    });

    const exit = await deploy();

    expect(exit).toBe(1);
    expect(versionPost(calls)).toBeDefined();
    expect(text()).toContain('could not build com.acme.crm 1.2.0-dev.');
    expect(text()).toContain('Object crm_deal: field stage references unknown picklist');
  });

  it('a failed local build prints that and exits 1 having written nothing', async () => {
    compileForDeploy.mockReset();
    compileForDeploy.mockReturnValue(1);
    const calls = stubPlane({ served: live });

    const exit = await deploy();

    expect(exit).toBe(1);
    expect(writes(calls)).toEqual([]);
    expect(text()).toContain('The build failed');
  });

  it('refuses several environments before building, naming --env, with exit 1', async () => {
    const calls = stubPlane({
      environments: [{ id: 'env_a', display_name: 'Alpha', status: 'active' }, { id: 'env_b', display_name: 'Beta', status: 'active' }],
    });

    const exit = await deploy();

    expect(exit).toBe(1);
    expect(compileForDeploy).not.toHaveBeenCalled();
    expect(writes(calls)).toEqual([]);
    expect(text()).toContain('Alpha (env_a)');
    expect(text()).toContain('--env <id>');
  });

  it('--env picks among several environments', async () => {
    const calls = stubPlane({
      environments: [{ id: 'env_a', status: 'active' }, { id: 'env_b', status: 'active' }],
      served: live,
    });

    expect(await deploy(['--env', 'env_b'])).toBeUndefined();
    expect(versionPost(calls)!.body.install_env_id).toBe('env_b');
    expect(calls.some((c) => c.url.endsWith('/api/v1/cloud/environments'))).toBe(false);
  });

  it('refuses when not logged in, before building, with exit 1', async () => {
    await rm(join(home, '.objectstack', 'cloud.json'));
    const calls = stubPlane();

    const exit = await deploy();

    expect(exit).toBe(1);
    expect(compileForDeploy).not.toHaveBeenCalled();
    expect(calls).toEqual([]);
    expect(text()).toContain('os cloud login');
  });

  it('says plainly when the control plane does not report a served version, and claims nothing live', async () => {
    // A control plane from before the `served` contract: the package read carries no `served`.
    stubPlane();

    const exit = await deploy();

    expect(exit).toBeUndefined();
    expect(text()).toContain('does not report which version an environment serves yet');
    expect(text()).not.toContain('Live:');
  });

  it('--no-wait returns once the install is recorded, without reading the installation', async () => {
    const calls = stubPlane({ served: live });

    expect(await deploy(['--no-wait'])).toBeUndefined();
    expect(packageReads(calls)).toEqual([]);
    expect(text()).toContain('(not waiting)');
  });

  it('says it cannot nudge the rebuild when the environment has no URL, and still waits', async () => {
    const calls = stubPlane({ served: live, hostname: null });

    expect(await deploy()).toBeUndefined();
    expect(calls.some((c) => c.url.startsWith(ENV_ORIGIN))).toBe(false);
    expect(text()).toContain("cannot nudge its rebuild");
    expect(text()).toContain('Live:');
  });

  it('reports a deploy another install replaced, with exit 1, instead of calling it live', async () => {
    stubPlane({ served: (p) => ({ ...live(p), desiredVersionId: 'ver_someone_else', versionId: 'ver_someone_else' }) });

    expect(await deploy()).toBe(1);
    expect(text()).toContain('another install replaced it');
    expect(text()).not.toContain('Live:');
  });
});

describe('waitUntilServed — the one client function the wait goes through', () => {
  const target = {
    baseUrl: CLOUD_PLANE, token: 't', environmentId: 'env_acme',
    manifestId: 'com.acme.crm', version: '1.2.0-dev.20261106083005', versionId: 'ver_2',
  };
  const served = (fields: Record<string, unknown>) => ({ ok: true as const, data: { served: { desiredVersionId: 'ver_2', ...fields } } });

  it('polls through pending, waking the environment before every poll, until it is live', async () => {
    const reports = [
      served({ state: 'pending', versionId: 'ver_1', version: '1.2.0-dev.20261106080000', observedStatus: 'installed' }),
      served({ state: 'pending', versionId: 'ver_1', version: '1.2.0-dev.20261106080000', observedStatus: 'pending' }),
      served({ state: 'live', versionId: 'ver_2', version: target.version, observedStatus: 'installed' }),
    ];
    const order: string[] = [];
    let clock = 0;
    const verdict = await waitUntilServed(target, {
      timeoutMs: 60_000,
      intervalMs: 3_000,
      wake: async () => { order.push('wake'); },
      fetchReport: async () => { order.push('read'); return reports.shift()!; },
      now: () => clock,
      sleep: async (ms) => { clock += ms; },
    });
    expect(verdict).toEqual({ kind: 'served', version: target.version, incomplete: false });
    expect(order).toEqual(['wake', 'read', 'wake', 'read', 'wake', 'read']);
    expect(clock).toBe(6_000);
  });

  it('a failed build carries the environment\'s error', async () => {
    const verdict = await waitUntilServed(target, {
      timeoutMs: 60_000,
      intervalMs: 3_000,
      fetchReport: async () => served({ state: 'failed', versionId: 'ver_1', observedStatus: 'failed', error: 'picklist stage missing' }),
      now: () => 0,
      sleep: async () => {},
    });
    expect(verdict).toEqual({ kind: 'failed', reason: 'picklist stage missing' });
  });

  it('times out naming what it last saw, and reportVerdict names what it waited for and why failures read late', async () => {
    let clock = 0;
    const verdict = await waitUntilServed(target, {
      timeoutMs: 9_000,
      intervalMs: 3_000,
      fetchReport: async () => served({ state: 'pending', versionId: 'ver_1', version: '1.1.0', observedStatus: 'installed' }),
      now: () => clock,
      sleep: async (ms) => { clock += ms; },
    });
    expect(verdict).toEqual({ kind: 'timeout', waitedMs: 9_000, lastObserved: 'installed, serving 1.1.0' });

    const lines: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((...a: unknown[]) => { lines.push(a.map(String).join(' ')); });
    const code = reportVerdict(verdict, { where: 'Acme (env_acme)', manifestId: target.manifestId, version: target.version, baseUrl: CLOUD_PLANE });
    vi.restoreAllMocks();
    expect(code).toBe(1);
    const said = lines.join('\n');
    expect(said).toContain('Timed out after 9s waiting for Acme (env_acme) to serve com.acme.crm 1.2.0-dev.20261106083005');
    expect(said).toContain('last report: installed, serving 1.1.0');
    expect(said).toContain('three failed rounds in a row');
  });

  it('reads `live` for another version as superseded, never as this deploy going live', () => {
    expect(interpretServedReport({ served: { state: 'live', desiredVersionId: 'ver_9', versionId: 'ver_9' } }, target))
      .toEqual({ kind: 'superseded', desiredVersionId: 'ver_9' });
  });

  it('an answer with no `served` is a control plane from before the contract', () => {
    expect(interpretServedReport({ installed: true, version: '1.2.0' }, target)).toEqual({ kind: 'unsupported' });
  });

  it('stops at once on an answer that asking again will not change', async () => {
    let polls = 0;
    const verdict = await waitUntilServed(target, {
      timeoutMs: 60_000,
      intervalMs: 3_000,
      fetchReport: async () => { polls += 1; return { ok: false, status: 403, error: 'forbidden', retryable: false }; },
      now: () => 0,
      sleep: async () => {},
    });
    expect(verdict).toEqual({ kind: 'unreadable', status: 403, error: 'forbidden' });
    expect(polls).toBe(1);
  });
});

describe('devVersion — a semver pre-release of the version the author wrote', () => {
  const at = new Date('2026-11-06T08:30:05Z');

  it('appends -dev.<YYYYMMDDHHMMSS> (UTC) to a release version', () => {
    expect(devVersion('1.2.0', at)).toEqual({ ok: true, version: '1.2.0-dev.20261106083005' });
  });
  it('keeps an existing pre-release and drops build metadata', () => {
    expect(devVersion('1.2.0-beta.1+sha.abc', at)).toEqual({ ok: true, version: '1.2.0-beta.1.dev.20261106083005' });
  });
  it('falls back to 0.0.0 for a versionless artifact', () => {
    expect(devVersion(undefined, at)).toEqual({ ok: true, version: '0.0.0-dev.20261106083005' });
  });
  it('refuses a version that is not semver rather than repairing it', () => {
    const result = devVersion('v1.2', at);
    expect(result.ok).toBe(false);
  });
});
