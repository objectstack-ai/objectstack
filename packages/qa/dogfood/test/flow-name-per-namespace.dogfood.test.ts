// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [ADR-0150 D3/D4/D9, epic #31527 child B (flow), #31696] A flow name is held
// once per NAMESPACE, on a real boot.
//
// The flow's one-holder rule narrowed from the deployment to the namespace
// (D9). Two packages of two namespaces may each ship a flow of one name; the
// engine holds each in its own slot (D4); a door that knows which package it
// means reaches that package's flow, and a door that does not is refused,
// naming both (D3). The unit suites pin each layer in-process (objectql's
// family pins, the runtime's address and caller-package pins, the engine's
// slot pins). What only a boot measures is the doors a deployment reaches,
// with the real registry, the real artifact load of a declared endpoint, the
// real install door and the real activation ledger:
//
//  - the cold boot of two namespaces' packages shipping one flow name boots
//    with no bare-name warning for it; each flow is armed in its own slot;
//  - each namespace's `/automation` address reads and runs its own package's
//    flow; the bare name is refused 409 naming both, at `/automation` and at
//    `/meta/flow`, and a package-less save of it is refused the same way
//    (409, never a 500), storing nothing;
//  - the package's own flow action and its own flow endpoint run that
//    package's flow, never the other namespace's (D3: the caller package's
//    own item first; seat ruling 6810580480 item 2);
//  - install-local of a third namespace's package shipping the name installs,
//    and its flow is armed in its own slot; a package of no namespace and a
//    co-owner of a holder's namespace are still refused;
//  - the epic's Q4 (6760226691): a flow the deployment switched off while one
//    package held its name stays off after a second namespace's package
//    installs a flow of that name, and the newcomer's flow arms.

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { bootStack, type VerifyStack } from '@objectstack/verify';
import { AppPlugin } from '@objectstack/runtime';
import { MetadataPlugin } from '@objectstack/metadata';
import { MarketplaceInstallLocalPlugin } from '@objectstack/cloud-connection';
import { defineStack } from '@objectstack/spec';
import { PROTOCOL_MAJOR } from '@objectstack/spec/kernel';

const BOOT_TIMEOUT = 300_000;
const LEDGER = 'sys_metadata_activation';
/** Infrastructure rows, not tenant data: read the way the store reads them. */
const SYSTEM_CTX = { isSystem: true, positions: [], permissions: [] };

const ALPHA = 'com.qa.ns.alpha';
const BETA = 'com.qa.ns.beta';
const GAMMA = 'com.qa.ns.gamma';
const THETA = 'com.qa.ns.theta';
/** The name `alpha` and `beta` both ship. */
const FLOW = 'qa_ns_flow';
/** The name `alpha` ships alone at boot, and `theta` installs later (Q4). */
const Q4 = 'qa_ns_q4';
const ACTION = 'alpha_run_shared';
const ENDPOINT_PATH = '/apps/alpha/run-shared';

const item = (p: string) => ({
  name: `${p}_item`, label: `${p} item`, sharingModel: 'public_read_write',
  fields: { name: { type: 'text', label: 'Name' } },
});
const flow = (p: string, name = FLOW) => ({
  name, label: `${p} flow`, type: 'autolaunched', status: 'active',
  nodes: [{ id: 'start', type: 'start', label: `${p} start` }, { id: 'end', type: 'end', label: 'End' }],
  edges: [{ id: 'e1', source: 'start', target: 'end' }],
});

/** `alpha`: the shared flow, the Q4 flow, and one flow action and one flow endpoint naming the shared flow. */
const alphaStack = defineStack({
  manifest: { id: ALPHA, namespace: 'alpha', name: 'qa_ns_alpha', version: '1.0.0', type: 'app' },
  requires: ['automation'],
  objects: [item('alpha')],
  flows: [flow('alpha'), flow('alpha', Q4)],
  actions: [{ name: ACTION, label: 'Run the shared flow', objectName: 'alpha_item', type: 'flow', target: FLOW }],
  apis: [{
    name: 'alpha_run_shared_api', path: `/api/v1${ENDPOINT_PATH}`, method: 'POST',
    summary: 'Run the shared flow', description: 'Runs alpha\'s flow of the shared name.',
    type: 'flow', target: FLOW, authRequired: true,
  }],
} as never);

/** `beta`: a flow of the shared name, in its own namespace. */
const betaStack = defineStack({
  manifest: { id: BETA, namespace: 'beta', name: 'qa_ns_beta', version: '1.0.0', type: 'app' },
  objects: [item('beta')],
  flows: [flow('beta')],
} as never);

/** An inline install-local manifest. */
const inline = (p: string, collections: Record<string, unknown[]>, extra: Record<string, unknown> = {}) => ({
  manifest: {
    id: `com.qa.ns.${p}`, namespace: p, name: `qa_ns_${p}`, version: '1.0.0', type: 'app', scope: 'project',
    engines: { protocol: `^${PROTOCOL_MAJOR}` },
    objects: [item(p)],
    ...collections,
    ...extra,
  },
});

/** Every line the process writes while `run` is in flight (the flow-family dogfood's instrument). */
async function captureOutput<T>(run: () => Promise<T>): Promise<{ value: T; lines: string[] }> {
  const chunks: string[] = [];
  const stdout = process.stdout.write.bind(process.stdout);
  const stderr = process.stderr.write.bind(process.stderr);
  const warn = console.warn;
  (process.stdout as any).write = (chunk: unknown, ...rest: any[]) => { chunks.push(String(chunk)); return stdout(chunk as any, ...rest); };
  (process.stderr as any).write = (chunk: unknown, ...rest: any[]) => { chunks.push(String(chunk)); return stderr(chunk as any, ...rest); };
  console.warn = (...args: unknown[]) => { chunks.push(`WARN ${args.map(String).join(' ')}\n`); warn(...args); };
  try {
    const value = await run();
    return { value, lines: chunks.join('').split('\n') };
  } finally {
    (process.stdout as any).write = stdout;
    (process.stderr as any).write = stderr;
    console.warn = warn;
  }
}

const errorOf = (body: any) => ({
  code: (body?.error && typeof body.error === 'object' ? body.error.code : undefined) ?? body?.code ?? null,
  message: String((body?.error && typeof body.error === 'object' ? body.error.message : body?.error) ?? body?.message ?? ''),
});

describe('a flow name held once per namespace, on a real boot (ADR-0150 D9, #31696)', () => {
  let stack: VerifyStack;
  let admin: string;
  let tempDir: string;
  let bootLines: string[] = [];

  const automation = () => (stack.kernel as any).getService('automation');
  const slotLabel = (pkg: string, name = FLOW): string | undefined => automation().getFlowSlot(pkg, name)?.label;
  /** Runs the engine holds for package `pkg`'s flow `name`, read by that slot's key. */
  const runsOf = async (pkg: string, name = FLOW): Promise<number> => {
    const key = automation().flowSlotKey(pkg, name);
    return key === undefined ? 0 : (await automation().listRuns(key)).length;
  };
  const call = async (method: string, path: string, body?: unknown) => {
    const res = await stack.apiAs(admin, method, path, body);
    const json = (await res.json().catch(() => ({}))) as any;
    return { status: res.status, body: json, ...errorOf(json) };
  };
  const packageIds = async (): Promise<string[]> => {
    const r = await call('GET', '/packages');
    expect(r.status).toBe(200);
    const rows = (r.body?.data?.packages ?? r.body?.packages ?? r.body?.data ?? r.body ?? []) as any[];
    return rows.map((p: any) => p?.manifest?.id ?? p?.id ?? p?.packageId).filter(Boolean).sort();
  };
  const ledgerRows = async (name: string) => {
    const ql = (await stack.kernel.getServiceAsync('objectql')) as any;
    const rows = (await ql.find(LEDGER, { where: { metadata_type: 'flow', name }, context: SYSTEM_CTX })) as Array<Record<string, unknown>>;
    return rows.map((r) => ({ package_id: r.package_id ?? null, active: Boolean(r.active) }));
  };
  const expectRefusedNamingBoth = (answer: { status: number; code: unknown; message: string; body: unknown }, ...holders: string[]) => {
    expect([answer.status, answer.code], JSON.stringify(answer.body)).toEqual([409, 'RESOURCE_CONFLICT']);
    for (const holder of holders.length ? holders : [ALPHA, BETA]) expect(answer.message).toContain(holder);
  };

  beforeAll(async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'dogfood-flow-ns-'));
    const artifactPath = join(tempDir, 'objectstack.json');
    writeFileSync(artifactPath, JSON.stringify(alphaStack));
    const booted = await captureOutput(() => bootStack(alphaStack as never, {
      automation: true,
      extraPlugins: [
        // A declared endpoint is served only through `matchEndpoint`, which the
        // metadata manager owns: the artifact boot a deployment runs.
        new MetadataPlugin({
          rootDir: tempDir, watch: false, artifactWatch: false, registerSystemObjects: false,
          artifactSource: { mode: 'local-file', path: artifactPath },
        }),
        new AppPlugin(betaStack as never),
        new MarketplaceInstallLocalPlugin({ controlPlaneUrl: 'off', storageDir: join(tempDir, 'installs') }),
      ],
    }));
    stack = booted.value;
    bootLines = booted.lines;
    admin = await stack.signIn();
  }, BOOT_TIMEOUT);

  afterAll(async () => {
    await stack?.stop().catch(() => undefined);
    if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  });

  it('the cold boot of two namespaces shipping one flow name boots with no bare-name warning for it; each flow is armed in its own slot', async () => {
    const warned = bootLines.filter((l) => l.includes('Bare-name conflict at boot') && l.includes(`"${FLOW}"`));
    expect(warned, 'no bare-name warning names the shared flow').toEqual([]);
    expect(bootLines.some((l) => l.includes('failed to register flow') && l.includes(`"${FLOW}"`))).toBe(false);
    expect(await packageIds()).toEqual(expect.arrayContaining([ALPHA, BETA]));
    expect([slotLabel(ALPHA), slotLabel(BETA)]).toEqual(['alpha flow', 'beta flow']);
  });

  it('each namespace\'s /automation address reads and runs its own package\'s flow; the bare name is refused 409 naming both', async () => {
    const alpha = await call('GET', `/automation/alpha/${FLOW}`);
    expect([alpha.status, alpha.body?.data?.label], JSON.stringify(alpha.body)).toEqual([200, 'alpha flow']);
    expect((await call('GET', `/automation/beta/${FLOW}`)).body?.data?.label).toBe('beta flow');

    const [alphaRuns, betaRuns] = [await runsOf(ALPHA), await runsOf(BETA)];
    const run = await call('POST', `/automation/beta/${FLOW}/trigger`, { params: {} });
    expect(run.status, JSON.stringify(run.body)).toBe(200);
    expect([await runsOf(ALPHA), await runsOf(BETA)]).toEqual([alphaRuns, betaRuns + 1]);

    expectRefusedNamingBoth(await call('POST', `/automation/${FLOW}/trigger`, { params: {} }));
    expectRefusedNamingBoth(await call('GET', `/automation/${FLOW}`));
    expect([await runsOf(ALPHA), await runsOf(BETA)], 'the refused bare trigger ran nothing').toEqual([alphaRuns, betaRuns + 1]);
  });

  it('the bare /meta/flow read of the shared name is refused 409 naming both — never the first registered', async () => {
    expectRefusedNamingBoth(await call('GET', `/meta/flow/${FLOW}`));
  });

  it('a package-less save of the shared name is refused 409 naming both (never a 500), and stores nothing', async () => {
    const put = await call('PUT', `/meta/flow/${FLOW}`, flow('env'));
    expectRefusedNamingBoth(put);
    expect([slotLabel(ALPHA), slotLabel(BETA)]).toEqual(['alpha flow', 'beta flow']);
  });

  it('alpha\'s flow action runs alpha\'s flow, with beta\'s flow of the name installed (D3: its own package\'s item first)', async () => {
    const [alphaRuns, betaRuns] = [await runsOf(ALPHA), await runsOf(BETA)];
    const answer = await call('POST', `/actions/alpha_item/${ACTION}`, { params: {} });
    expect(answer.status, JSON.stringify(answer.body)).toBe(200);
    expect([await runsOf(ALPHA), await runsOf(BETA)]).toEqual([alphaRuns + 1, betaRuns]);
  });

  it('alpha\'s flow endpoint runs alpha\'s flow, with beta\'s flow of the name installed', async () => {
    const [alphaRuns, betaRuns] = [await runsOf(ALPHA), await runsOf(BETA)];
    const answer = await call('POST', ENDPOINT_PATH, {});
    expect(answer.status, JSON.stringify(answer.body)).toBe(200);
    expect([await runsOf(ALPHA), await runsOf(BETA)]).toEqual([alphaRuns + 1, betaRuns]);
  });

  it('install-local of a third namespace\'s package shipping the shared name installs; its flow is armed in its own slot and its address runs it', async () => {
    const { status, body } = await call('POST', '/marketplace/install-local', inline('gamma', { flows: [flow('gamma')] }));
    expect(status, JSON.stringify(body)).toBeLessThan(300);
    expect(await packageIds()).toContain(GAMMA);
    expect([slotLabel(ALPHA), slotLabel(BETA), slotLabel(GAMMA)]).toEqual(['alpha flow', 'beta flow', 'gamma flow']);
    const before = await runsOf(GAMMA);
    expect((await call('POST', `/automation/gamma/${FLOW}/trigger`, { params: {} })).status).toBe(200);
    expect(await runsOf(GAMMA)).toBe(before + 1);
    expectRefusedNamingBoth(await call('POST', `/automation/${FLOW}/trigger`, { params: {} }), ALPHA, BETA, GAMMA);
  });

  it('install-local of a co-owner of alpha\'s namespace shipping the shared name is refused, naming alpha; nothing is installed', async () => {
    const before = await packageIds();
    const coOwner = inline('alphamod', { flows: [flow('alphamod')] }, {
      id: 'com.qa.ns.alphamod', namespace: 'alpha', dependencies: { [ALPHA]: '^1.0.0' }, objects: [item('alpha_alphamod')],
    });
    const answer = await call('POST', '/marketplace/install-local', coOwner);
    expect(answer.status, JSON.stringify(answer.body)).toBeGreaterThanOrEqual(400);
    expect(answer.status).toBeLessThan(500);
    expect(answer.message).toContain(ALPHA);
    expect(answer.message).not.toContain(BETA);
    expect(await packageIds()).toEqual(before);
    expect(slotLabel('com.qa.ns.alphamod')).toBeUndefined();
  });

  it('Q4 — a flow switched off while one package held its name stays off after a second namespace installs it; the newcomer\'s flow arms', async () => {
    // One holder: the bare address is the deployment's switch of alpha's flow.
    const off = await call('POST', `/automation/${Q4}/toggle`, { enabled: false });
    expect(off.status, JSON.stringify(off.body)).toBe(200);
    expect(await ledgerRows(Q4)).toEqual([{ package_id: ALPHA, active: false }]);

    const { status, body } = await call('POST', '/marketplace/install-local', inline('theta', { flows: [flow('theta', Q4)] }));
    expect(status, JSON.stringify(body)).toBeLessThan(300);
    await automation().flowActivationBinds?.();
    expect([slotLabel(ALPHA, Q4), slotLabel(THETA, Q4)]).toEqual(['alpha flow', 'theta flow']);

    // alpha's flow stays off: its address answers the disabled-flow refusal, and nothing runs.
    const alphaRuns = await runsOf(ALPHA, Q4);
    const alpha = await call('POST', `/automation/alpha/${Q4}/trigger`, { params: {} });
    expect([alpha.status, alpha.code], JSON.stringify(alpha.body)).toEqual([409, 'FLOW_DISABLED']);
    expect(await runsOf(ALPHA, Q4)).toBe(alphaRuns);
    // theta's flow arms and runs.
    const theta = await call('POST', `/automation/theta/${Q4}/trigger`, { params: {} });
    expect(theta.status, JSON.stringify(theta.body)).toBe(200);
    expect(await runsOf(THETA, Q4)).toBe(1);
    // The row is still alpha's own, and only alpha's.
    expect(await ledgerRows(Q4)).toEqual([{ package_id: ALPHA, active: false }]);
  });
});
