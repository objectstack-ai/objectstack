// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.
//
// MCP business-action E2E — Community-Edition path.
//
// Proves that a self-host runtime composing ONLY the open framework
// (@objectstack/runtime + objectql + a driver + the seeded app) and
// @objectstack/mcp — NO @objectstack/service-ai, NO cloud studio — exposes MCP
// tools that LIST and EXECUTE the app's business actions, permission-enforced.
//
// We boot the real ObjectQL engine, register app-todo's real action handlers,
// then drive the real MCPServerRuntime over JSON-RPC (the same code path an
// external MCP client hits) through the runtime's principal-bound action
// bridge. `run_action` flows through engine.executeAction → the registered
// handler → the real driver, exactly as in production.
//
// ## The organization the boot holds (ADR-0131 D3 / D9)
//
// Every `todo_task` row carries a NOT NULL organization. A real `single`
// install creates its Default Organization at boot, before the app's seed
// loads, and every organization-less system write is stamped with it. That is
// the job of the plugin that registers the organization object: `AuthPlugin`
// on a server, `createIdentityObjectsPlugin()` on a reduced kernel like this
// one — plugin-auth's identity objects and the same boot invariant, with no
// authentication mounted. A kernel with neither registers no organization
// object, so the seed and every system insert here were refused with
// "Organization is required". The suite boots the way the platform documents a
// reduced kernel, and pins that the app's own seed landed.
//
// It runs in this example's own `pnpm test`, so CI sees it.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ObjectKernel, DriverPlugin, AppPlugin } from '@objectstack/runtime';
import { HttpDispatcher } from '@objectstack/runtime';
import { SqliteWasmDriver } from '@objectstack/driver-sqlite-wasm';
import { ObjectQLPlugin } from '@objectstack/objectql';
import { MCPServerRuntime } from '@objectstack/mcp';
import { createIdentityObjectsPlugin } from '@objectstack/plugin-auth';
import TodoApp from '../objectstack.config.js';
import { registerTaskActionHandlers } from '../src/actions/register-handlers.js';

const BOOT_TIMEOUT = 60_000;

/** Build a JSON-RPC request the MCP Streamable-HTTP transport accepts. */
function mcpRequest(body: unknown): Request {
  return new Request('http://localhost/api/v1/mcp', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
    },
    body: JSON.stringify(body),
  });
}

const toolsCall = (id: number, name: string, args: Record<string, unknown>) => ({
  jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args },
});

/** The app's merged stack with one action of `todo_task` rewritten. */
function withTaskAction(objects: any[], actionName: string, rewrite: (action: any) => any): any[] {
  return objects.map((o) =>
    o.name !== 'todo_task'
      ? o
      : { ...o, actions: o.actions.map((a: any) => (a.name === actionName ? rewrite(a) : a)) },
  );
}

describe('app-todo business actions over MCP (CE runtime, no service-ai)', () => {
  let kernel: ObjectKernel;
  let engine: any;
  let mergedObjects: any[];
  let bridgeFor: (executionContext: any, objects?: any[]) => any;
  const runtime = new MCPServerRuntime({ name: 'objectstack', version: '1.0.0' });

  const callMcp = async (bridge: any, body: unknown): Promise<any> => {
    const res = await runtime.handleHttpRequest(mcpRequest(body), { bridge, parsedBody: body });
    return res.json();
  };
  const listActions = async (bridge: any, id: number): Promise<any[]> =>
    JSON.parse((await callMcp(bridge, toolsCall(id, 'list_actions', {}))).result.content[0].text).actions;
  const seedTask = async (subject: string): Promise<string> => {
    const seeded: any = await engine.insert('todo_task', { subject, status: 'not_started', priority: 'high' });
    const id = seeded?.id ?? seeded?.record?.id;
    expect(id, `seeded '${subject}'`).toBeTruthy();
    return id;
  };
  const statusOf = async (id: string): Promise<unknown> =>
    (await engine.find('todo_task', { where: { id } }))?.[0]?.status;

  // The acting user — an authenticated, non-system principal.
  const user = { userId: 'user_1', positions: [], permissions: [], systemPermissions: [] };

  beforeAll(async () => {
    // ── Boot the real open-framework runtime ──────────────────────────
    kernel = new ObjectKernel({ logger: { level: 'silent' } } as any);
    await kernel.use(new ObjectQLPlugin());
    await kernel.use(new DriverPlugin(new SqliteWasmDriver({ filename: ':memory:' })));
    // The organization object and the Default Organization; see the header.
    await kernel.use(createIdentityObjectsPlugin());
    await kernel.use(new AppPlugin(TodoApp));
    await kernel.bootstrap();

    // app-todo wires handlers via a named `onEnable` export that the default
    // AppPlugin import misses — register them directly against the engine.
    engine = await (kernel as any).getServiceAsync('data');
    if (!engine) throw new Error('data engine not available');
    registerTaskActionHandlers(engine);

    // defineStack() merges actions[] into their object by `objectName`; this is
    // exactly what a real metadata service returns. Surface it to the dispatcher.
    mergedObjects = (TodoApp.objects ?? []) as any[];

    // A metadata service backed by the app's own merged stack. In a full
    // deployment MetadataPlugin returns these same objects; the action mechanism
    // under test (resolve → gate → executeAction → handler → driver) is 100% real.
    const makeMetadata = (objects: any[]) => ({
      listObjects: async () => objects,
      getObject: async (n: string) => objects.find((o) => o.name === n),
    });

    // Build a principal-bound MCP action bridge for a given user + metadata view.
    bridgeFor = (executionContext: any, objects: any[] = mergedObjects) => {
      const metadata = makeMetadata(objects);
      const fakeKernel: any = {
        context: {
          getService: (n: string) =>
            n === 'objectql' || n === 'data' ? engine : n === 'metadata' ? metadata : null,
        },
      };
      const dispatcher = new HttpDispatcher(fakeKernel);
      return (dispatcher as any).buildMcpBridge({ executionContext, environmentId: undefined });
    };
  }, BOOT_TIMEOUT);

  afterAll(async () => {
    await kernel?.shutdown();
  });

  it('boots with its Default Organization, so the app seed landed', async () => {
    const organizations: any[] = await engine.find('sys_organization', {}, { context: { isSystem: true } });
    expect(organizations.length).toBe(1);
    const subjects = ((await engine.find('todo_task', {})) as any[]).map((t) => t.subject);
    expect(subjects).toEqual(expect.arrayContaining(['Learn ObjectStack', 'Build a cool app']));
  });

  it('declares its actions on todo_task', () => {
    const todo = mergedObjects.find((o) => o.name === 'todo_task');
    expect(Array.isArray(todo?.actions) && todo.actions.length > 0).toBe(true);
  });

  // ── Step 1 — the MCP server advertises the action tools ───────────
  it('step 1: tools/list advertises list_actions + run_action', async () => {
    const list = await callMcp(bridgeFor(user), { jsonrpc: '2.0', id: 1, method: 'tools/list' });
    const toolNames: string[] = list.result.tools.map((t: any) => t.name);
    expect(toolNames).toContain('list_actions');
    expect(toolNames).toContain('run_action');
    // Object tools remain exposed alongside them.
    expect(toolNames).toContain('query_records');
  });

  // ── Step 2 — list_actions enumerates the app's business actions ───
  it('step 2: list_actions enumerates invokable business actions', async () => {
    const actions = await listActions(bridgeFor(user), 2);
    const actionNames = actions.map((a) => a.name);
    expect(actionNames).toContain('todo_complete_task');
    // A modal/UI-only action is not invokable, so not listed.
    expect(actionNames).not.toContain('todo_defer_task');
    expect(actions.find((a) => a.name === 'todo_complete_task')?.requiresRecord).toBe(true);
    // `variant: 'danger'` is reported as requiresConfirmation in the listing.
    expect(actions.find((a) => a.name === 'todo_delete_completed')?.requiresConfirmation).toBe(true);
  });

  // ── Step 3 — run_action EXECUTES real business logic ──────────────
  it('step 3: run_action executes todo_complete_task against a real record', async () => {
    const taskId = await seedTask('Ship MCP actions');
    const ran = await callMcp(bridgeFor(user), toolsCall(3, 'run_action', { actionName: 'todo_complete_task', recordId: taskId }));
    expect(ran.result?.isError, ran.result?.content?.[0]?.text).not.toBe(true);
    expect(JSON.parse(ran.result.content[0].text).ok).toBe(true);
    // The handler ran.
    expect(await statusOf(taskId)).toBe('completed');
  });

  // ── Step 4 — fail-closed on system-object actions ─────────────────
  it('step 4: system-object actions are blocked fail-closed', async () => {
    const sysRun = await callMcp(bridgeFor(user), toolsCall(4, 'run_action', { actionName: 'rotate', objectName: 'sys_api_key' }));
    expect(sysRun.result?.isError).toBe(true);
    expect(sysRun.result?.content?.[0]?.text ?? '').toMatch(/system object/i);
  });

  // ── Step 5 — capability gate (ADR-0066 D4) end-to-end ─────────────
  it('step 5: the requiredPermissions gate denies, then allows', async () => {
    const taskId = await seedTask('Clone me');
    // Same app, but todo_clone_task now declares a capability requirement.
    const gatedObjects = withTaskAction(mergedObjects, 'todo_clone_task', (a) => ({ ...a, requiredPermissions: ['todo_admin'] }));

    const denyBridge = bridgeFor({ userId: 'user_2', positions: [], permissions: [], systemPermissions: [] }, gatedObjects);
    const denied = await callMcp(denyBridge, toolsCall(5, 'run_action', { actionName: 'todo_clone_task', recordId: taskId }));
    expect(denied.result?.isError).toBe(true);
    expect(denied.result?.content?.[0]?.text ?? '').toMatch(/requires capability/i);
    // …and list_actions hides what the caller may not run.
    expect((await listActions(denyBridge, 6)).some((a) => a.name === 'todo_clone_task')).toBe(false);

    const allowBridge = bridgeFor({ userId: 'admin_1', positions: [], permissions: [], systemPermissions: ['todo_admin'] }, gatedObjects);
    const allowed = await callMcp(allowBridge, toolsCall(7, 'run_action', { actionName: 'todo_clone_task', recordId: taskId }));
    expect(allowed.result?.isError, allowed.result?.content?.[0]?.text).not.toBe(true);
    expect((await listActions(allowBridge, 8)).some((a) => a.name === 'todo_clone_task')).toBe(true);
  });

  // ── Step 6 — AI-exposure gate (#2849) end-to-end ───────────────────
  it('step 6: an action without ai.exposed is hidden and uninvokable', async () => {
    const taskId = await seedTask('Not for AI');
    // Same app, but todo_clone_task no longer opts into the AI surface.
    const unexposedObjects = withTaskAction(mergedObjects, 'todo_clone_task', ({ ai: _ai, ...rest }: any) => rest);
    const unexposedBridge = bridgeFor({ userId: 'user_3', positions: [], permissions: [], systemPermissions: ['todo_admin'] }, unexposedObjects);
    expect((await listActions(unexposedBridge, 9)).some((a) => a.name === 'todo_clone_task')).toBe(false);
    const unexposedRun = await callMcp(unexposedBridge, toolsCall(10, 'run_action', { actionName: 'todo_clone_task', recordId: taskId }));
    expect(unexposedRun.result?.isError).toBe(true);
    expect(unexposedRun.result?.content?.[0]?.text ?? '').toMatch(/not exposed to AI/i);
  });

  // ── Step 7 — the confirmation gate (#15942), BOTH directions ───────
  //
  // The one drive that spans the whole path. A unit test on either side is
  // blind to the other: `invokeBusinessAction` called directly never sees the
  // MCP door strip the member (the SDK's shape wrap drops unknown keys, and
  // the handler forwards a rebuilt object), and a door test with a stubbed
  // bridge never sees the runtime gate. Here the member travels from a real
  // JSON-RPC `tools/call`, through both of those layers, into the real gate —
  // and the record afterwards says whether anything ran.
  it('step 7: ai.requiresConfirmation is ENFORCED, and satisfiable', async () => {
    // Same app, but todo_complete_task now declares the author's gate.
    const gatedConfirmObjects = withTaskAction(mergedObjects, 'todo_complete_task', (a) => ({
      ...a,
      ai: { ...(a.ai ?? {}), requiresConfirmation: true },
    }));
    const confirmBridge = bridgeFor(user, gatedConfirmObjects);

    // The listing tells a client the gate is there (unchanged behaviour).
    const gatedList = await listActions(confirmBridge, 11);
    expect(gatedList.find((a) => a.name === 'todo_complete_task')?.requiresConfirmation).toBe(true);

    const gatedId = await seedTask('Needs a human');

    // 7a — WITHOUT the member: refused, with the declared code, and NOTHING ran.
    const refused = await callMcp(confirmBridge, toolsCall(12, 'run_action', { actionName: 'todo_complete_task', recordId: gatedId }));
    expect(refused.result?.isError).toBe(true);
    const refusedEnvelope = JSON.parse(refused.result?.content?.[0]?.text ?? '{}');
    expect(refusedEnvelope?.error?.code).toBe('ACTION_CONFIRMATION_REQUIRED');
    expect(refusedEnvelope?.error?.status).toBe(428);
    expect(refusedEnvelope?.error?.details?.actionName).toBe('todo_complete_task');
    expect(refusedEnvelope?.error?.details?.confirmationMember).toBe('confirm');
    expect(await statusOf(gatedId)).toBe('not_started');

    // 7b — WITH the member: the identical call succeeds and the handler runs.
    // This is the leg that proves the member is not stripped: before the door
    // grew it, this call was refused exactly like 7a and the action was
    // permanently un-invokable.
    const confirmed = await callMcp(confirmBridge, toolsCall(13, 'run_action', { actionName: 'todo_complete_task', recordId: gatedId, confirm: true }));
    expect(confirmed.result?.isError, confirmed.result?.content?.[0]?.text).not.toBe(true);
    expect(await statusOf(gatedId)).toBe('completed');

    // 7c — the heuristic must NOT gate: todo_delete_completed is `variant:'danger'`
    // and the listing calls it requiresConfirmation, but its author declared
    // nothing, so it stays invokable with no member (this change narrows a
    // published accept set; refusing here would be the regression).
    const undeclared = await callMcp(confirmBridge, toolsCall(14, 'run_action', { actionName: 'todo_delete_completed' }));
    expect(undeclared.result?.isError, undeclared.result?.content?.[0]?.text).not.toBe(true);
  });
});
