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
      // The environment itself, mid-build: the framework's retryable 503. Cloud's
      // KernelManager throws a warming error whose own lowercase code is only its
      // declared code; the transport's ADR-0112 envelope answers SERVICE_UNAVAILABLE
      // (packages/rest/src/rest-resolve-environment-single-window.test.ts pins the pair).
      return {
        ok: false,
        status: 503,
        statusText: 'Service Unavailable',
        json: async () => ({
          success: false,
          error: { code: 'SERVICE_UNAVAILABLE', message: 'The environment is starting up (kernel build in progress). Retry in ~15s.' },
        }),
      } as any;
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

describe('os deploy — a self-hosted runtime as the active target (os environments use-runtime)', () => {
  const RUNTIME = 'http://runtime.test:8080';
  const KEY = 'osk_runtime_key';
  let home = '';
  let work = '';
  const previous: Record<string, string | undefined> = {};
  const prevCwd = process.cwd();
  let output: string[] = [];
  const RUNTIME_ENV = [...MANAGED_ENV, 'OS_RUNTIME_URL', 'OS_RUNTIME_TOKEN', 'OS_RUNTIME_EMAIL', 'OS_RUNTIME_PASSWORD'] as const;

  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), 'os-30888-deploy-home-'));
    work = await mkdtemp(join(tmpdir(), 'os-30888-deploy-work-'));
    await mkdir(join(home, '.objectstack'), { recursive: true });
    for (const key of ['HOME', 'USERPROFILE', ...RUNTIME_ENV]) previous[key] = process.env[key];
    process.env.HOME = home;
    process.env.USERPROFILE = home;
    for (const key of RUNTIME_ENV) delete process.env[key];
    // A cloud login AND a remembered runtime that is the active target: the runtime wins.
    await writeFile(join(home, '.objectstack', 'cloud.json'), JSON.stringify({
      url: CLOUD_PLANE, token: 'cloud_tok', createdAt: 'now',
      runtimeTarget: { url: RUNTIME, token: KEY, recordedAt: 'then' }, deployTarget: 'runtime',
    }));
    process.chdir(work);
    compileForDeploy.mockReset();
    compileForDeploy.mockImplementation((artifactPath: string) => {
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
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await rm(home, { recursive: true, force: true });
    await rm(work, { recursive: true, force: true });
  });

  type Sent = { url: string; method: string; headers: Record<string, string>; body: any };
  type Answer = { status: number; body: unknown };
  const PLAN = {
    dryRun: true, manifestId: 'com.acme.crm', version: '1.2.0', installedVersion: '1.1.0',
    plan: { declaredRenames: [{ object: 'lead', from: 'phone', to: 'mobile' }] },
    environment: { columns: [{ object: 'lead', field: 'phone', rows: 3 }] },
  };
  const INSTALLED = { manifestId: 'com.acme.crm', version: '1.2.0', hotLoaded: true, installedAt: '2026-11-07T00:00:00.000Z' };
  const ok = (data: unknown): Answer => ({ status: 200, body: { success: true, data } });
  const refused = (status: number, code: string, message: string, details?: unknown): Answer =>
    ({ status, body: { success: false, error: { code, message, ...(details ? { details } : {}) } } });

  /** The runtime: the dry-run answer, then the install answer. Anything else is unexpected. */
  function stubRuntime(answers: { dryRun?: Answer; install?: Answer }): Sent[] {
    const sent: Sent[] = [];
    vi.stubGlobal('fetch', vi.fn(async (input: string, init: any = {}) => {
      const url = String(input);
      const body = typeof init.body === 'string' ? JSON.parse(init.body) : undefined;
      sent.push({ url, method: init.method ?? 'GET', headers: { ...(init.headers ?? {}) }, body });
      const answer = url === `${RUNTIME}/api/v1/marketplace/install-local` && init.method === 'POST'
        ? (body?.dryRun ? answers.dryRun ?? ok(PLAN) : answers.install ?? ok(INSTALLED))
        : { status: 599, body: { success: false, error: { message: `unexpected ${init.method} ${url}` } } };
      return {
        ok: answer.status >= 200 && answer.status < 300,
        status: answer.status,
        statusText: String(answer.status),
        headers: { get: () => null },
        json: async () => answer.body,
      } as any;
    }));
    return sent;
  }

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

  it('with no flags: builds, asks the dry run (plan printed), installs the build inline, and reports it live', async () => {
    const sent = stubRuntime({});

    const exit = await deploy();

    expect(exit, text()).toBeUndefined();
    expect(compileForDeploy).toHaveBeenCalledWith(join(work, 'dist', 'objectstack.json'));
    // Two calls, both to the remembered runtime with its key: the dry run, then the install. No cloud call.
    expect(sent.map((s) => [s.method, s.url, s.body?.dryRun === true])).toEqual([
      ['POST', `${RUNTIME}/api/v1/marketplace/install-local`, true],
      ['POST', `${RUNTIME}/api/v1/marketplace/install-local`, false],
    ]);
    for (const s of sent) expect(s.headers.Authorization).toBe(`Bearer ${KEY}`);
    // Inline artifact, the manifest's own version: no catalog, no -dev suffix.
    expect(sent[1].body.manifest.id).toBe('com.acme.crm');
    expect(sent[1].body.manifest.version).toBe('1.2.0');
    expect(sent[1].body.packageId).toBeUndefined();
    // The plan is printed, declared rename included, before the install.
    expect(text()).toContain('Renames declared by renamedFrom');
    expect(text()).toContain('lead.phone → mobile — 3 row(s) hold a value');
    expect(text()).toContain(`Live: ${RUNTIME} now serves com.acme.crm 1.2.0.`);
  });

  it('a refusal from the dry run stops the deploy before any install', async () => {
    const sent = stubRuntime({ dryRun: refused(422, 'VALIDATION_ERROR', "Package 'com.acme.crm' declares a job with no body.") });

    const exit = await deploy();

    expect(exit).toBe(1);
    expect(sent).toHaveLength(1);
    expect(sent[0].body.dryRun).toBe(true);
    expect(text()).toContain('Install failed (422 VALIDATION_ERROR)');
  });

  it('a runtime that declines install-local (404, e.g. booted from a composed artifact) is named, exit 1', async () => {
    const sent = stubRuntime({ dryRun: { status: 404, body: { success: false, error: { message: 'Not Found' } } } });

    const exit = await deploy();

    expect(exit).toBe(1);
    expect(sent).toHaveLength(1);
    expect(text()).toContain(`${RUNTIME} does not serve install-local`);
    expect(text()).toContain('A runtime booted from a composed artifact takes no package installs');
  });

  it('a runtime that predates the dry run is said so, exit 1, naming what to do', async () => {
    // It ignored `dryRun` and installed: the answer carries no `dryRun`.
    const sent = stubRuntime({ dryRun: ok(INSTALLED) });

    const exit = await deploy();

    expect(exit).toBe(1);
    expect(sent).toHaveLength(1);
    expect(text()).toContain('does not support a dry run');
    expect(text()).toContain('Upgrade the runtime to preview an upgrade before it is installed, then run `os deploy` again.');
  });

  it("the install's refusal stops the deploy, and its retry names os deploy; the confirmation passes through", async () => {
    const accessRefusal = refused(409, 'ACCESS_UPGRADE_CONFIRMATION_REQUIRED', 'confirm', {
      findings: [{ describe: "permission set 'sales' would re-enable lead.delete" }], findingSet: 'fs_123',
    });
    let sent = stubRuntime({ install: accessRefusal });
    expect(await deploy()).toBe(1);
    expect(sent).toHaveLength(2);
    expect(text()).toContain('os deploy --confirm-access-upgrade fs_123');

    vi.unstubAllGlobals();
    sent = stubRuntime({});
    expect(await deploy(['--confirm-access-upgrade', 'fs_123']), text()).toBeUndefined();
    expect(sent[0].body.confirmAccessUpgrade).toBeUndefined();
    expect(sent[1].body.confirmAccessUpgrade).toBe('fs_123');
  });

  it("the schema upgrade refusal's retry names os deploy --confirm-upgrade, and the token passes through", async () => {
    const schemaRefusal = refused(409, 'SCHEMA_UPGRADE_CONFIRMATION_REQUIRED', 'confirm', {
      findings: [{ describe: 'acme_lead.company (text) is removed while acme_lead.account_name (text) is added' }],
      findingSet: 'schema-upgrade:abc',
    });
    let sent = stubRuntime({ install: schemaRefusal });
    expect(await deploy()).toBe(1);
    expect(sent).toHaveLength(2);
    expect(text()).toContain('os deploy --confirm-upgrade schema-upgrade:abc');

    vi.unstubAllGlobals();
    sent = stubRuntime({});
    expect(await deploy(['--confirm-upgrade', 'schema-upgrade:abc']), text()).toBeUndefined();
    expect(sent[0].body.confirmSchemaUpgrade).toBeUndefined();
    expect(sent[1].body.confirmSchemaUpgrade).toBe('schema-upgrade:abc');
  });

  it('a package the running kernel could not load is not called live: exit 1', async () => {
    stubRuntime({ install: ok({ ...INSTALLED, hotLoaded: false, hotLoadError: 'boom' }) });

    expect(await deploy()).toBe(1);
    expect(text()).toContain('it is not live: it loads when the runtime restarts');
    expect(text()).not.toContain('Live:');
  });

  it('a failed build installs nothing', async () => {
    const sent = stubRuntime({});
    compileForDeploy.mockImplementation(() => 1);

    expect(await deploy()).toBe(1);
    expect(sent).toHaveLength(0);
    expect(text()).toContain('Nothing was installed.');
  });

  it('--confirm-access-upgrade is refused when the target is ObjectOS Cloud, before anything is sent', async () => {
    await writeFile(join(home, '.objectstack', 'cloud.json'), JSON.stringify({ url: CLOUD_PLANE, token: 'cloud_tok', createdAt: 'now' }));
    const sent = stubRuntime({});

    expect(await deploy(['--confirm-access-upgrade', 'fs_123'])).toBe(1);
    expect(sent).toHaveLength(0);
    expect(compileForDeploy).not.toHaveBeenCalled();
  });

  it('--confirm-upgrade is refused when the target is ObjectOS Cloud, before anything is sent', async () => {
    await writeFile(join(home, '.objectstack', 'cloud.json'), JSON.stringify({ url: CLOUD_PLANE, token: 'cloud_tok', createdAt: 'now' }));
    const sent = stubRuntime({});

    expect(await deploy(['--confirm-upgrade', 'schema-upgrade:abc'])).toBe(1);
    expect(sent).toHaveLength(0);
    expect(compileForDeploy).not.toHaveBeenCalled();
  });
});
