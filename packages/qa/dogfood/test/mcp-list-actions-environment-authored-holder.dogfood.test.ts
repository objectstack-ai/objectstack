// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#33029] An action an administrator authors in the environment (no
// `?package=`) bound to an object a package ships is the ENVIRONMENT's action:
// MCP `list_actions` lists it once, with no namespace, and `run_action` runs
// it by the face that row carries.
//
// ## What was measured (stock showcase, admin session, live MCP transport)
//
// The registry serves the stored action INSIDE `showcase_task.actions`
// (`attachBoundActions`, #28356) — by reference, unstamped, carrying the
// tenant provenance `_provenance: 'org'` — and the standalone listing serves it
// once more with no package. The action collector filed the embedded copy
// under the OBJECT's package (`com.example.showcase`), so the ADR-0150 D4
// dedupe, keyed on the holder, kept both: two rows (one under `showcase`), the
// face `showcase_task-qa_env_authored_action` refused as derived for two
// actions, and a run by that face answered 404. Naming `showcase` — a package
// that never shipped the action — ran it, on MCP and on the addressed REST
// door; it is now refused there, the narrowing this change declares.
//
// ## The controls
//
//   - A package-shipped action on the same object (`showcase_mark_done`, made
//     AI-exposed in a derived configuration) arrives embedded AND standalone
//     stamped with its package: listed once, under `showcase`.
//   - An action authored with `?package=` (a Studio-created package that
//     depends on the showcase; the showcase itself is read-only) arrives
//     stamped with that package: listed once, under its namespace.
//   - An environment-authored FLOW action whose `target` names a flow the
//     showcase ships, by bare name, runs on both doors: a name ONE package
//     holds resolves the same for every caller.
//
// ## The third narrowed place (contract review 6847350544, M1)
//
// The environment's action has no package (ADR-0150 D3), so the flow its
// `target` names is read by the no-package rule. Where TWO packages hold that
// flow name — the showcase (a derived configuration ships `qa_shared_flow`)
// and a second code package in its own namespace (`qatwin`) — the call is
// refused 409 naming both, on the face, the bare name and `_env`. Before, the
// action was the object's package's, and ran that package's flow. The fix for
// a caller: bind the action with `?package=` to a writable package whose own
// flow, or whose one dependency's flow, is meant (a code package is read-only,
// 422), or target a flow name one package holds.
//
// The file is ISOLATED: it writes `/meta` and creates a package.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { type VerifyStack } from '@objectstack/verify';
import { MCPServerPlugin } from '@objectstack/mcp';
import { AppPlugin } from '@objectstack/runtime';
import { defineStack } from '@objectstack/spec';
import showcaseStack from '@objectstack/example-showcase';
import { bootShowcase } from './showcase-boot.js';

const OBJECT = 'showcase_task';
const ENV_ACTION = 'qa_env_authored_action';
const ENV_FLOW_ACTION = 'qa_env_authored_flow_action';
const SHIPPED_FLOW = 'showcase_recalc_task_estimate';
const PKG_ACTION = 'qa_package_authored_action';
const SHARED_FLOW = 'qa_shared_flow';
const ENV_SHARED_FLOW_ACTION = 'qa_env_shared_flow_action';
const SHIPPED = 'showcase_mark_done';
const QA_PACKAGE = 'com.example.qaholder';
const QA_NAMESPACE = 'qaholder';
/** A second code package, in its own namespace, shipping a flow of the name the derived showcase ships. */
const TWIN_PACKAGE = 'com.example.qatwin';

/** The showcase with its shipped `showcase_mark_done` exposed to AI, in both places a stack carries it. */
const SHIPPED_AI = { exposed: true, description: 'Mark the task done and its progress complete, for the listing pins.' };
const exposeShipped = (a: any) => (a?.name === SHIPPED ? { ...a, ai: SHIPPED_AI } : a);
const sharedFlow = (holder: string) => ({
  name: SHARED_FLOW, label: `${holder} shared flow`, type: 'autolaunched', status: 'active',
  nodes: [{ id: 'start', type: 'start', label: `${holder} start` }, { id: 'end', type: 'end', label: 'End' }],
  edges: [{ id: 'e1', source: 'start', target: 'end' }],
});
const twinStack = defineStack({
  manifest: { id: TWIN_PACKAGE, namespace: 'qatwin', name: 'qa_twin', version: '1.0.0', type: 'app' },
  flows: [sharedFlow('qatwin')],
} as never);
const base: any = showcaseStack;
const derived = {
  ...base,
  flows: [...(base.flows ?? []), sharedFlow('showcase')],
  actions: (base.actions ?? []).map(exposeShipped),
  objects: (base.objects ?? []).map((o: any) => (o?.name === OBJECT ? { ...o, actions: (o.actions ?? []).map(exposeShipped) } : o)),
};

const ai = (what: string) => ({ exposed: true, description: `${what}, for the listing pins of the environment-authored action card.` });
const authored = (name: string, progress: number) => ({
  name, label: name, objectName: OBJECT, operation: 'update', patch: { progress }, execution: 'perRecord',
  ai: ai(`Set the task progress to ${progress} percent`),
});

describe('[#33029] list_actions files an environment-authored action on a packaged object under the environment', () => {
  let stack: VerifyStack;
  let admin: string;
  let recordId: string;
  let rows: any[];
  let refusedFaces: Array<{ face: string }>;

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
  const rowsNamed = (name: string) => rows.filter((a) => a.objectName === OBJECT && a.name === name);

  beforeAll(async () => {
    stack = await bootShowcase({ extraPlugins: [new AppPlugin(twinStack as never), new MCPServerPlugin()] }, derived);
    admin = await stack.signIn();
    const ql: any = await stack.kernel.getServiceAsync('objectql');
    const found: any = await ql.find(OBJECT, { limit: 1 }, { context: { isSystem: true } });
    recordId = (Array.isArray(found) ? found : found?.records ?? [])[0]?.id;
    expect(recordId, 'the showcase seeds a task').toBeTruthy();

    const env = await stack.apiAs(admin, 'PUT', `/meta/action/${ENV_ACTION}`, authored(ENV_ACTION, 50));
    expect(env.status, await env.clone().text()).toBe(200);
    const flow = await stack.apiAs(admin, 'PUT', `/meta/action/${ENV_FLOW_ACTION}`, {
      name: ENV_FLOW_ACTION, label: ENV_FLOW_ACTION, objectName: OBJECT, type: 'flow', target: SHIPPED_FLOW,
      ai: ai('Recalculate the task estimate through the showcase flow'),
    });
    expect(flow.status, await flow.clone().text()).toBe(200);
    const created = await stack.apiAs(admin, 'POST', '/packages', {
      manifest: {
        id: QA_PACKAGE, name: 'QA holder', version: '0.1.0', type: 'app', namespace: QA_NAMESPACE,
        dependencies: { 'com.example.showcase': '*' },
      },
    });
    expect(created.status, await created.clone().text()).toBe(201);
    const pkg = await stack.apiAs(admin, 'PUT', `/meta/action/${PKG_ACTION}?package=${QA_PACKAGE}`, authored(PKG_ACTION, 40));
    expect(pkg.status, await pkg.clone().text()).toBe(200);
    const shared = await stack.apiAs(admin, 'PUT', `/meta/action/${ENV_SHARED_FLOW_ACTION}`, {
      name: ENV_SHARED_FLOW_ACTION, label: ENV_SHARED_FLOW_ACTION, objectName: OBJECT, type: 'flow', target: SHARED_FLOW,
      ai: ai('Run the flow of the shared name'),
    });
    expect(shared.status, await shared.clone().text()).toBe(200);

    const listed = await tool('list_actions', {});
    expect(listed.isError, listed.text).toBe(false);
    rows = listed.payload.actions ?? [];
    refusedFaces = listed.payload.refusedFaces ?? [];
  }, 120_000);

  afterAll(async () => { await stack?.stop(); });

  it('lists the environment-authored action ONCE, with no namespace, under its face (BASE: a second row under `showcase` and the face refused)', () => {
    const own = rowsNamed(ENV_ACTION);
    expect(own.map((a) => [a.namespace, a.face]), JSON.stringify(own)).toEqual([[undefined, `${OBJECT}-${ENV_ACTION}`]]);
    expect(refusedFaces.map((r) => r.face)).not.toContain(`${OBJECT}-${ENV_ACTION}`);
  });

  it('run_action runs it by its listed face (BASE: 404 "names no one action")', async () => {
    const ran = await tool('run_action', { actionName: `${OBJECT}-${ENV_ACTION}`, recordId });
    expect(ran.isError, ran.text).toBe(false);
    expect([ran.payload.ok, ran.payload.action, ran.payload.objectName]).toEqual([true, ENV_ACTION, OBJECT]);
  });

  it('naming `showcase`, a package that never shipped it, no longer reaches it: MCP and the addressed REST door answer 404 (BASE: both ran it)', async () => {
    const mcp = await tool('run_action', { actionName: ENV_ACTION, objectName: OBJECT, namespace: 'showcase', recordId });
    expect([mcp.isError, mcp.payload.error?.code, mcp.payload.error?.status], mcp.text).toEqual([true, 'RESOURCE_NOT_FOUND', 404]);
    const rest = await stack.apiAs(admin, 'POST', `/actions/showcase/${OBJECT}/${ENV_ACTION}`, { recordId });
    const body: any = await rest.json();
    expect([rest.status, body?.error?.code], JSON.stringify(body)).toEqual([404, 'RESOURCE_NOT_FOUND']);
  });

  it('CONTROL: it still runs as the environment\'s, by its bare name and at `/actions/_env/...`', async () => {
    const bare = await tool('run_action', { actionName: ENV_ACTION, objectName: OBJECT, recordId });
    expect(bare.isError, bare.text).toBe(false);
    const env = await stack.apiAs(admin, 'POST', `/actions/_env/${OBJECT}/${ENV_ACTION}`, { recordId });
    expect(env.status, await env.clone().text()).toBe(200);
  });

  it('CONTROL: an environment-authored flow action targeting a showcase-shipped flow by bare name runs on REST and MCP, as before, and lists once under its face', async () => {
    // The flow is read by the no-package rule now, not inside the showcase's
    // package (BASE: the same two runs answered the same).
    const rest = await stack.apiAs(admin, 'POST', `/actions/${OBJECT}/${ENV_FLOW_ACTION}`, { recordId });
    const restText = await rest.text();
    expect(rest.status, restText).toBe(200);
    const bare = await tool('run_action', { actionName: ENV_FLOW_ACTION, objectName: OBJECT, recordId });
    expect([bare.isError, bare.payload.action], bare.text).toEqual([false, ENV_FLOW_ACTION]);
    const own = rowsNamed(ENV_FLOW_ACTION);
    expect(own.map((a) => [a.namespace, a.face]), JSON.stringify(own)).toEqual([[undefined, `${OBJECT}-${ENV_FLOW_ACTION}`]]);
    const faced = await tool('run_action', { actionName: `${OBJECT}-${ENV_FLOW_ACTION}`, recordId });
    expect([faced.isError, faced.payload.action], faced.text).toEqual([false, ENV_FLOW_ACTION]);
  });

  it('an environment-authored flow action whose target flow name two packages hold is refused 409 naming both, on the bare REST route, the face and `_env` (BASE: it ran the object\'s package\'s flow)', async () => {
    const expectRefusedNamingBoth = (status: number, body: any) => {
      const code = body?.error?.code ?? body?.code;
      const message = String(body?.error?.message ?? body?.message ?? '');
      expect([status, code], JSON.stringify(body)).toEqual([409, 'RESOURCE_CONFLICT']);
      for (const holder of ['com.example.showcase', TWIN_PACKAGE]) expect(message, JSON.stringify(body)).toContain(holder);
    };
    const rest = await stack.apiAs(admin, 'POST', `/actions/${OBJECT}/${ENV_SHARED_FLOW_ACTION}`, { recordId });
    expectRefusedNamingBoth(rest.status, await rest.json());
    const env = await stack.apiAs(admin, 'POST', `/actions/_env/${OBJECT}/${ENV_SHARED_FLOW_ACTION}`, { recordId });
    expectRefusedNamingBoth(env.status, await env.json());
    const faced = await tool('run_action', { actionName: `${OBJECT}-${ENV_SHARED_FLOW_ACTION}`, recordId });
    expect(faced.isError, faced.text).toBe(true);
    expectRefusedNamingBoth(faced.payload.error?.status, faced.payload);
  });

  it('CONTROL: a package-shipped action on the same object lists once, under its namespace, and runs by its face', async () => {
    const shipped = rowsNamed(SHIPPED);
    expect(shipped.map((a) => [a.namespace, a.face]), JSON.stringify(shipped)).toEqual([['showcase', `${OBJECT}-${SHIPPED}`]]);
    const ran = await tool('run_action', { actionName: `${OBJECT}-${SHIPPED}`, recordId });
    expect([ran.isError, ran.payload.action], ran.text).toEqual([false, SHIPPED]);
  });

  it('CONTROL: an action authored with `?package=` lists once, under that package\'s namespace, and runs by it', async () => {
    const own = rowsNamed(PKG_ACTION);
    expect(own.map((a) => [a.namespace, a.face]), JSON.stringify(own)).toEqual([[QA_NAMESPACE, `${OBJECT}-${PKG_ACTION}`]]);
    const ran = await tool('run_action', { actionName: PKG_ACTION, objectName: OBJECT, namespace: QA_NAMESPACE, recordId });
    expect([ran.isError, ran.payload.action], ran.text).toEqual([false, PKG_ACTION]);
  });
});
