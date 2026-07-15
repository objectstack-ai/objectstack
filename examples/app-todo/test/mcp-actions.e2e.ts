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
// Run via: `pnpm --filter @objectstack/example-todo test:mcp`

import { ObjectKernel, DriverPlugin, AppPlugin } from '@objectstack/runtime';
import { HttpDispatcher } from '@objectstack/runtime';
import { SqliteWasmDriver } from '@objectstack/driver-sqlite-wasm';
import { ObjectQLPlugin } from '@objectstack/objectql';
import { MCPServerRuntime } from '@objectstack/mcp';
import TodoApp from '../objectstack.config';
import { registerTaskActionHandlers } from '../src/actions/register-handlers';

let failures = 0;
function check(cond: boolean, msg: string): void {
  if (cond) {
    console.log(`   ✓ ${msg}`);
  } else {
    failures++;
    console.error(`   ✗ ${msg}`);
  }
}

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

(async () => {
  console.log('🔌 ObjectStack MCP Action E2E — list + execute business actions (CE, no service-ai)');
  console.log('────────────────────────────────────────────────────────────────────────────────');

  process.env.OS_MULTI_ORG_ENABLED = 'false';

  // ── Boot the real open-framework runtime ──────────────────────────
  const kernel = new ObjectKernel();
  await kernel.use(new ObjectQLPlugin());
  await kernel.use(new DriverPlugin(new SqliteWasmDriver({ filename: ':memory:' })));
  await kernel.use(new AppPlugin(TodoApp));
  await kernel.bootstrap();

  // app-todo wires handlers via a named `onEnable` export that the default
  // AppPlugin import misses — register them directly against the engine.
  const engine: any = await (kernel as any).getServiceAsync('data');
  if (!engine) throw new Error('data engine not available');
  registerTaskActionHandlers(engine);

  // defineStack() merges actions[] into their object by `objectName`; this is
  // exactly what a real metadata service returns. Surface it to the dispatcher.
  const mergedObjects: any[] = (TodoApp.objects ?? []) as any[];
  const todo = mergedObjects.find((o) => o.name === 'todo_task');
  check(Array.isArray(todo?.actions) && todo.actions.length > 0, `todo_task has ${todo?.actions?.length ?? 0} declarative actions`);

  // A metadata service backed by the app's own merged stack. In a full
  // deployment MetadataPlugin returns these same objects; the action mechanism
  // under test (resolve → gate → executeAction → handler → driver) is 100% real.
  const makeMetadata = (objects: any[]) => ({
    listObjects: async () => objects,
    getObject: async (n: string) => objects.find((o) => o.name === n),
  });

  // Build a principal-bound MCP action bridge for a given user + metadata view.
  const bridgeFor = (executionContext: any, objects: any[] = mergedObjects) => {
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

  const runtime = new MCPServerRuntime({ name: 'objectstack', version: '1.0.0' });
  const callMcp = async (bridge: any, body: unknown) => {
    const res = await runtime.handleHttpRequest(mcpRequest(body), { bridge, parsedBody: body });
    return res.json();
  };
  const toolsCall = (id: number, name: string, args: Record<string, unknown>) => ({
    jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args },
  });

  // The acting user — an authenticated, non-system principal.
  const user = { userId: 'user_1', positions: [], permissions: [], systemPermissions: [] };
  const bridge = bridgeFor(user);

  // ── Step 1 — the MCP server advertises the action tools ───────────
  console.log('\n📋 Step 1 — tools/list advertises list_actions + run_action');
  const list = await callMcp(bridge, { jsonrpc: '2.0', id: 1, method: 'tools/list' });
  const toolNames: string[] = list.result.tools.map((t: any) => t.name);
  check(toolNames.includes('list_actions'), 'list_actions tool is exposed');
  check(toolNames.includes('run_action'), 'run_action tool is exposed');
  check(toolNames.includes('query_records'), 'object tools remain exposed (query_records)');

  // ── Step 2 — list_actions enumerates the app's business actions ───
  console.log('\n📋 Step 2 — list_actions enumerates invokable business actions');
  const listed = await callMcp(bridge, toolsCall(2, 'list_actions', {}));
  const actions = JSON.parse(listed.result.content[0].text).actions as any[];
  const actionNames = actions.map((a) => a.name);
  console.log(`   → ${actionNames.length} actions: ${actionNames.join(', ')}`);
  check(actionNames.includes('complete_task'), 'complete_task (script) is listed');
  check(!actionNames.includes('defer_task'), 'defer_task (modal/UI-only) is NOT listed');
  const complete = actions.find((a) => a.name === 'complete_task');
  check(complete?.requiresRecord === true, 'complete_task is flagged requiresRecord');
  const del = actions.find((a) => a.name === 'delete_completed');
  check(del?.requiresConfirmation === true, 'delete_completed (danger) flagged requiresConfirmation');

  // ── Step 3 — run_action EXECUTES real business logic ──────────────
  console.log('\n⚡ Step 3 — run_action executes complete_task against a real record');
  const seeded: any = await engine.insert('todo_task', { subject: 'Ship MCP actions', status: 'not_started', priority: 'high' });
  const taskId = seeded?.id ?? seeded?.record?.id;
  check(Boolean(taskId), `seeded a task (${taskId})`);
  const ran = await callMcp(bridge, toolsCall(3, 'run_action', { actionName: 'complete_task', recordId: taskId }));
  check(ran.result?.isError !== true, 'run_action returned success (no tool error)');
  const payload = ran.result?.isError ? {} : JSON.parse(ran.result.content[0].text);
  check(payload.ok === true, 'run_action payload reports ok:true');
  const after: any[] = await engine.find('todo_task', { where: { id: taskId } });
  check(after?.[0]?.status === 'completed', `the task status is now '${after?.[0]?.status}' (handler ran)`);

  // ── Step 4 — fail-closed on system-object actions ─────────────────
  console.log('\n🔒 Step 4 — system-object actions are blocked fail-closed');
  const sysRun = await callMcp(bridge, toolsCall(4, 'run_action', { actionName: 'rotate', objectName: 'sys_api_key' }));
  check(sysRun.result?.isError === true, 'run_action on a sys_* object is a tool error');
  check(/system object/i.test(sysRun.result?.content?.[0]?.text ?? ''), 'error names the system-object guard');

  // ── Step 5 — capability gate (ADR-0066 D4) end-to-end ─────────────
  console.log('\n🔒 Step 5 — requiredPermissions gate denies, then allows');
  // Same app, but clone_task now declares a capability requirement.
  const gatedObjects = mergedObjects.map((o) =>
    o.name !== 'todo_task'
      ? o
      : { ...o, actions: o.actions.map((a: any) => (a.name === 'clone_task' ? { ...a, requiredPermissions: ['todo_admin'] } : a)) },
  );
  const denyBridge = bridgeFor({ userId: 'user_2', positions: [], permissions: [], systemPermissions: [] }, gatedObjects);
  const denied = await callMcp(denyBridge, toolsCall(5, 'run_action', { actionName: 'clone_task', recordId: taskId }));
  check(denied.result?.isError === true, 'run_action denied when the caller lacks the capability');
  check(/requires capability/i.test(denied.result?.content?.[0]?.text ?? ''), 'denial cites the missing capability');
  // …and list_actions hides what the caller may not run.
  const denyList = JSON.parse((await callMcp(denyBridge, toolsCall(6, 'list_actions', {}))).result.content[0].text).actions as any[];
  check(!denyList.some((a) => a.name === 'clone_task'), 'list_actions hides the gated action from a non-holder');

  const allowBridge = bridgeFor({ userId: 'admin_1', positions: [], permissions: [], systemPermissions: ['todo_admin'] }, gatedObjects);
  const allowed = await callMcp(allowBridge, toolsCall(7, 'run_action', { actionName: 'clone_task', recordId: taskId }));
  check(allowed.result?.isError !== true, 'run_action allowed for a holder of the capability');
  const allowList = JSON.parse((await callMcp(allowBridge, toolsCall(8, 'list_actions', {}))).result.content[0].text).actions as any[];
  check(allowList.some((a) => a.name === 'clone_task'), 'list_actions reveals the gated action to a holder');

  // ── Step 6 — AI-exposure gate (#2849) end-to-end ───────────────────
  console.log('\n🔒 Step 6 — an action without ai.exposed is hidden and uninvokable');
  // Same app, but clone_task no longer opts into the AI surface.
  const unexposedObjects = mergedObjects.map((o) =>
    o.name !== 'todo_task'
      ? o
      : { ...o, actions: o.actions.map((a: any) => (a.name === 'clone_task' ? (({ ai: _ai, ...rest }: any) => rest)(a) : a)) },
  );
  const unexposedBridge = bridgeFor({ userId: 'user_3', positions: [], permissions: [], systemPermissions: ['todo_admin'] }, unexposedObjects);
  const unexposedList = JSON.parse((await callMcp(unexposedBridge, toolsCall(9, 'list_actions', {}))).result.content[0].text).actions as any[];
  check(!unexposedList.some((a) => a.name === 'clone_task'), 'list_actions hides an action the author did not expose to AI');
  const unexposedRun = await callMcp(unexposedBridge, toolsCall(10, 'run_action', { actionName: 'clone_task', recordId: taskId }));
  check(unexposedRun.result?.isError === true, 'run_action refuses the unexposed action (fail-closed)');
  check(/not exposed to AI/i.test(unexposedRun.result?.content?.[0]?.text ?? ''), 'refusal names the AI-exposure gate');

  console.log('\n────────────────────────────────────────────────────────────────────────────────');
  if (failures > 0) {
    console.error(`❌ MCP action E2E FAILED — ${failures} check(s) failed`);
    process.exit(1);
  }
  console.log('✅ MCP action E2E PASSED — CE runtime lists + executes business actions, permission-enforced');
  process.exit(0);
})().catch((err) => {
  console.error('❌ MCP action E2E threw:', err);
  process.exit(1);
});
