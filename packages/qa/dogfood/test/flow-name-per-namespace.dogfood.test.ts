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
//    `/meta/flow`; a package-less save of it is refused by the managed seal
//    (403 NOT_OVERRIDABLE, ADR-0131 D6), never a 500, storing nothing;
//  - the package's own flow action and its own flow endpoint run that
//    package's flow, never the other namespace's (D3: the caller package's
//    own item first; seat ruling 6810580480 item 2);
//  - install-local of a third namespace's package shipping the name installs,
//    and its flow is armed in its own slot; a co-owner of a holder's namespace
//    is still refused;
//  - the epic's Q4 (6760226691): a flow the deployment switched off while one
//    package held its name stays off after a second namespace's package
//    installs a flow of that name, and the newcomer's flow arms;
//  - alpha's screen flow of a name beta also ships, started by alpha's flow
//    action, pauses, and is finished at the bare run door the Console resumes
//    at and through MCP `resume_run`: each acts on the run's own slot.

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { bootStack, type VerifyStack } from '@objectstack/verify';
import { AppPlugin } from '@objectstack/runtime';
import { MetadataPlugin } from '@objectstack/metadata';
import { MarketplaceInstallLocalPlugin } from '@objectstack/cloud-connection';
import { MCPServerPlugin } from '@objectstack/mcp';
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
/** The screen flow `alpha` and `beta` both ship, and alpha's AI-exposed flow action that starts it. */
const SCREEN = 'qa_ns_screen';
const SCREEN_ACTION = 'alpha_run_screen';
/** [R3] A screen flow alpha ships alone at boot, its AI-exposed action, and the namespace that installs the name later. */
const LATE = 'qa_ns_screen_late';
const LATE_ACTION = 'alpha_run_screen_late';
const IOTA = 'com.qa.ns.iota';
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

/** A screen flow of the shared name `SCREEN`: one screen asking for a required `note`, then the end. */
const screenFlow = (p: string, name = SCREEN) => ({
  name, label: `${p} screen flow`, type: 'screen', status: 'active', runAs: 'user',
  nodes: [
    { id: 'start', type: 'start', label: 'Start' },
    { id: 'ask', type: 'screen', label: 'Ask', config: { title: `${p} asks`, fields: [{ name: 'note', label: 'Note', type: 'text', required: true }] } },
    { id: 'end', type: 'end', label: 'End' },
  ],
  edges: [{ id: 'e1', source: 'start', target: 'ask' }, { id: 'e2', source: 'ask', target: 'end' }],
});

/** `alpha`: the shared flows, the Q4 flow, a flow action naming each shared flow, and one flow endpoint. */
const alphaStack = defineStack({
  manifest: { id: ALPHA, namespace: 'alpha', name: 'qa_ns_alpha', version: '1.0.0', type: 'app' },
  requires: ['automation'],
  objects: [item('alpha')],
  flows: [flow('alpha'), flow('alpha', Q4), screenFlow('alpha'), screenFlow('alpha', LATE)],
  actions: [
    { name: ACTION, label: 'Run the shared flow', objectName: 'alpha_item', type: 'flow', target: FLOW },
    {
      name: SCREEN_ACTION, label: 'Run the shared screen flow', objectName: 'alpha_item', type: 'flow', target: SCREEN,
      ai: { exposed: true, description: 'Run alpha\'s screen flow: it asks for a note, then ends.' },
    },
    {
      name: LATE_ACTION, label: 'Run the late screen flow', objectName: 'alpha_item', type: 'flow', target: LATE,
      ai: { exposed: true, description: 'Run alpha\'s late screen flow: it asks for a note, then ends.' },
    },
  ],
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
  flows: [flow('beta'), screenFlow('beta')],
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
        new MCPServerPlugin(),
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

  it('a package-less save of the shared name is refused by the managed seal (never a 500), and stores nothing', async () => {
    const put = await call('PUT', `/meta/flow/${FLOW}`, flow('env'));
    // Either holder's flow is a managed package's, sealed against an in-place
    // edit (ADR-0131 D6): refused before anything is stored or registered.
    expect([put.status, put.code], JSON.stringify(put.body)).toEqual([403, 'NOT_OVERRIDABLE']);
    const ql = (await stack.kernel.getServiceAsync('objectql')) as any;
    expect(await ql.find('sys_metadata', { where: { type: 'flow', name: FLOW }, context: SYSTEM_CTX })).toEqual([]);
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
    // A co-owner reaches this door by depending on alpha (ADR-0141 D5), so the
    // ADR-0146 D2 override write gate refuses its same-named flow before the
    // bare-name rule is asked: 403 NOT_OVERRIDABLE, never an install.
    const answer = await call('POST', '/marketplace/install-local', coOwner);
    expect([answer.status, answer.code], JSON.stringify(answer.body)).toEqual([403, 'NOT_OVERRIDABLE']);
    expect(answer.message).toContain(`flow/${FLOW}`);
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

  it('alpha\'s screen flow, started by alpha\'s flow action with beta\'s of the name installed, pauses and is finished at the bare run door and through MCP resume_run; [R3] so is a run paused while alpha alone held its name, once a second namespace installs it', async () => {
    /** One `tools/call` over the live MCP transport, as the signed-in admin. */
    const tool = async (name: string, args: Record<string, unknown>) => {
      const res = await stack.api('/mcp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', Authorization: `Bearer ${admin}` },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
      });
      expect(res.status).toBe(200);
      const rpc: any = await res.json();
      expect(rpc.error, JSON.stringify(rpc.error)).toBeUndefined();
      const text = String(rpc.result?.content?.[0]?.text ?? '');
      let payload: any;
      try { payload = JSON.parse(text); } catch { payload = { message: text }; }
      return { isError: rpc.result?.isError === true, payload, text };
    };
    /** Start alpha's screen flow `name` through alpha's own flow action: the run pauses on alpha's screen, in alpha's slot. */
    const startPaused = async (action = SCREEN_ACTION, name = SCREEN): Promise<string> => {
      const started = await call('POST', `/actions/alpha_item/${action}`, { params: {} });
      expect(started.status, JSON.stringify(started.body)).toBe(200);
      const result = started.body?.data?.result ?? started.body?.data ?? started.body?.result ?? started.body;
      expect([result?.status, result?.screen?.title], JSON.stringify(started.body)).toEqual(['paused', 'alpha asks']);
      expect((await automation().getRun(result.runId))?.flowName).toBe(automation().flowSlotKey(ALPHA, name));
      return String(result.runId);
    };
    expect([slotLabel(ALPHA, SCREEN), slotLabel(BETA, SCREEN)]).toEqual(['alpha screen flow', 'beta screen flow']);

    // The Console resumes at the bare door; the run id names alpha's run, so it acts on alpha's slot.
    const consoleRun = await startPaused();
    const screen = await call('GET', `/automation/${SCREEN}/runs/${consoleRun}/screen`);
    expect([screen.status, screen.body?.data?.screen?.title], JSON.stringify(screen.body)).toEqual([200, 'alpha asks']);
    const resumed = await call('POST', `/automation/${SCREEN}/runs/${consoleRun}/resume`, { inputs: { note: 'done' } });
    expect(resumed.status, JSON.stringify(resumed.body)).toBe(200);
    expect((await automation().getRun(consoleRun))?.status).toBe('completed');
    // The bare list still names no run: refused naming both.
    expectRefusedNamingBoth(await call('GET', `/automation/${SCREEN}/runs`));

    // MCP resume_run admits alpha's own flow action for alpha's run.
    const agentRun = await startPaused();
    const viaMcp = await tool('resume_run', { runId: agentRun, values: { note: 'done' } });
    expect(viaMcp.isError, viaMcp.text).toBe(false);
    expect(viaMcp.payload?.action).toBe(SCREEN_ACTION);
    expect((await automation().getRun(agentRun))?.status).toBe('completed');

    // [R3] Two runs paused while alpha alone holds LATE (its bare key), then iota installs the name.
    const [lateRun, lateAgentRun] = [await startPaused(LATE_ACTION, LATE), await startPaused(LATE_ACTION, LATE)];
    expect((await automation().getRun(lateRun))?.flowName).toBe(LATE);
    const installed = await call('POST', '/marketplace/install-local', inline('iota', { flows: [screenFlow('iota', LATE)] }));
    expect(installed.status, JSON.stringify(installed.body)).toBeLessThan(300);
    expect([slotLabel(ALPHA, LATE), slotLabel(IOTA, LATE)]).toEqual(['alpha screen flow', 'iota screen flow']);
    expect((await automation().getRun(lateRun))?.flowName).toBe(automation().flowSlotKey(ALPHA, LATE));
    // iota's address answers alpha's run as a run nobody holds; alpha's address and the bare door read alpha's screen.
    const nobody = await call('GET', `/automation/iota/${LATE}/runs/run_nobody/screen`);
    const underIota = await call('GET', `/automation/iota/${LATE}/runs/${lateRun}/screen`);
    expect([underIota.status, underIota.code, nobody.status >= 400]).toEqual([nobody.status, nobody.code, true]);
    for (const prefix of [`/automation/alpha/${LATE}`, `/automation/${LATE}`]) {
      const read = await call('GET', `${prefix}/runs/${lateRun}/screen`);
      expect([read.status, read.body?.data?.screen?.title], JSON.stringify(read.body)).toEqual([200, 'alpha asks']);
    }
    const lateResumed = await call('POST', `/automation/${LATE}/runs/${lateRun}/resume`, { inputs: { note: 'done' } });
    expect(lateResumed.status, JSON.stringify(lateResumed.body)).toBe(200);
    // MCP resume_run admits alpha's own flow action for alpha's run.
    const lateViaMcp = await tool('resume_run', { runId: lateAgentRun, values: { note: 'done' } });
    expect([lateViaMcp.isError, lateViaMcp.payload?.action], lateViaMcp.text).toEqual([false, LATE_ACTION]);
    expect([(await automation().getRun(lateRun))?.status, (await automation().getRun(lateAgentRun))?.status]).toEqual(['completed', 'completed']);
  });
});
