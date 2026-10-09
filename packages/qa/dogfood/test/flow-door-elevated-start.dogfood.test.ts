// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// The two other doors that start a flow by name × a flow declared
// `runAs: 'system'`, per flow type, on a real boot: an action of
// `type: 'flow'` (REST `POST /api/v1/actions/:object/:action`, and the MCP
// `run_action` tool that reaches the same dispatch) and a declared endpoint of
// `type: 'flow'` (`authRequired: true`).
//
// The defect class: the trigger door refuses a non-system caller a
// `runAs: 'system'` flow whose type is self-triggered (`autolaunched`,
// `record_change`, `schedule`), but these two doors asked nothing of the kind,
// so the same signed-in member who is refused at the trigger door started the
// same elevated flow here, and its elevated write landed.
//
// Why dogfood and not `@objectstack/verify`: the verify harness composes no
// `MetadataPlugin`, and `matchEndpoint` (the declared endpoint's only door)
// is `NodeMetadataManager`'s member, so a declared endpoint cannot be reached
// there; nor does verify depend on `@objectstack/mcp`, which serves
// `run_action`. This package depends on both. The action door's system
// principal row, which needs the runtime's in-process dispatcher, is pinned
// in `@objectstack/verify`'s `action-flow-elevated-door.test.ts`.
//
// The fixture is neutral and throwaway: one object no fresh member is granted
// (a member's direct create on it is refused, which the first case pins as the
// control that makes every elevated write below meaningful), and one writer
// flow per type, each creating a ledger row named after itself. A row
// appearing is the elevated run's side effect; the run log is the other
// witness.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { bootStack, type VerifyStack } from '@objectstack/verify';
import { MetadataPlugin } from '@objectstack/metadata';
import { MCPServerPlugin } from '@objectstack/mcp';
import { defineStack } from '@objectstack/spec';
import { ObjectSchema, Field } from '@objectstack/spec/data';
import type { ApiEndpoint } from '@objectstack/spec/api';
import type { Flow } from '@objectstack/spec/automation';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const BOOT_TIMEOUT = 120_000;

const LEDGER = 'fdp_ledger';
const WATCH = 'fdp_watch';

/** Granted to nobody but the platform admin: a member's direct create is refused. */
const Ledger = ObjectSchema.create({
  name: LEDGER,
  sharingModel: 'public_read_write',
  label: 'Ledger',
  pluralLabel: 'Ledgers',
  fields: { name: Field.text({ label: 'Name', required: true }) },
});

/** The object the flow actions hang on, and the one the record-change writer watches. Nothing writes it. */
const Watch = ObjectSchema.create({
  name: WATCH,
  sharingModel: 'public_read_write',
  label: 'Watch',
  pluralLabel: 'Watches',
  fields: { name: Field.text({ label: 'Name', required: true }) },
});

/** start → create_record(fdp_ledger, { name: <flow name> }) → end. */
function writer(
  name: string,
  type: Flow['type'],
  runAs: 'system' | 'user',
  startConfig?: Record<string, unknown>,
): Flow {
  return {
    name,
    label: name,
    type,
    status: 'active',
    runAs,
    nodes: [
      { id: 'start', type: 'start', label: 'Start', ...(startConfig ? { config: startConfig } : {}) },
      { id: 'write', type: 'create_record', label: 'Write', config: { objectName: LEDGER, fields: { name } } },
      { id: 'end', type: 'end', label: 'End' },
    ],
    edges: [
      { id: 'e1', source: 'start', target: 'write' },
      { id: 'e2', source: 'write', target: 'end' },
    ],
  } as Flow;
}

const AUTO_SYS = 'fdp_auto_sys';
const CHANGE_SYS = 'fdp_change_sys';
const SCHED_SYS = 'fdp_sched_sys';
const SCREEN_SYS = 'fdp_screen_sys';
const API_SYS = 'fdp_api_sys';
const AUTO_USER = 'fdp_auto_user';
const PARENT_SCREEN = 'fdp_parent_screen';

const FLOWS: Flow[] = [
  writer(AUTO_SYS, 'autolaunched', 'system'),
  // A watched object nobody writes and a cadence nobody reaches during a run:
  // each of these two runs only when a door starts it.
  writer(CHANGE_SYS, 'record_change', 'system', { objectName: WATCH, triggerType: 'record-after-update' }),
  writer(SCHED_SYS, 'schedule', 'system', { schedule: { cron: '0 3 1 1 *' } }),
  writer(SCREEN_SYS, 'screen', 'system'),
  // ADR-0041: an `api` flow registers only with its per-flow secret.
  writer(API_SYS, 'api', 'system', { secret: 'fdp-fixture-secret' }),
  writer(AUTO_USER, 'autolaunched', 'user'),
  // The route the ruling names for an author who wants members to start
  // elevated logic: a declared entry (`screen`) that is not elevated itself,
  // whose `subflow` node calls the elevated self-triggered child.
  {
    name: PARENT_SCREEN,
    label: PARENT_SCREEN,
    type: 'screen',
    status: 'active',
    runAs: 'user',
    nodes: [
      { id: 'start', type: 'start', label: 'Start' },
      { id: 'sub', type: 'subflow', label: 'Elevated child', config: { flowName: AUTO_SYS } },
      { id: 'end', type: 'end', label: 'End' },
    ],
    edges: [
      { id: 'e1', source: 'start', target: 'sub' },
      { id: 'e2', source: 'sub', target: 'end' },
    ],
  } as Flow,
];

/** Every flow above, each reachable by one action and one declared endpoint. */
const TARGETS = [AUTO_SYS, CHANGE_SYS, SCHED_SYS, SCREEN_SYS, API_SYS, AUTO_USER, PARENT_SCREEN] as const;
type Target = (typeof TARGETS)[number];

const actionOf = (flow: Target) => `run_${flow}`;
const endpointPathOf = (flow: Target) => `/apps/fdp/${flow.replace(/_/g, '-')}`;

const ACTIONS = TARGETS.map((flow) => ({
  name: actionOf(flow),
  label: `Run ${flow}`,
  objectName: WATCH,
  type: 'flow' as const,
  target: flow,
  ai: { exposed: true, description: `Starts the ${flow} fixture flow, which writes one ledger row named after itself.` },
}));

const ENDPOINTS: ApiEndpoint[] = TARGETS.map((flow) => ({
  name: `${flow}_api`,
  path: `/api/v1${endpointPathOf(flow)}`,
  method: 'POST',
  summary: `Start ${flow}`,
  description: `Starts ${flow} over HTTP.`,
  type: 'flow',
  target: flow,
  authRequired: true,
}));

const fixtureStack = defineStack({
  manifest: {
    id: 'com.dogfood.flow-door-elevated-start',
    namespace: 'fdp',
    version: '0.0.0',
    type: 'app',
    name: 'Flow Door Elevated Start Fixture',
    description: 'One ungranted object, one elevated writer flow per flow type, and an action and an endpoint naming each.',
  },
  // ADR-0097: the record-change start node needs both capabilities.
  requires: ['automation', 'triggers'],
  objects: [Ledger, Watch],
  flows: FLOWS,
  actions: ACTIONS,
  apis: ENDPOINTS,
} as never);

let stack: VerifyStack;
let tempDir: string;
let admin: string;
let member: string;

beforeAll(async () => {
  tempDir = mkdtempSync(join(tmpdir(), 'os-fdp-'));
  const artifactPath = join(tempDir, 'objectstack.json');
  writeFileSync(artifactPath, JSON.stringify(fixtureStack));
  stack = await bootStack(fixtureStack as never, {
    automation: true,
    extraPlugins: [
      // A declared endpoint is served only through `matchEndpoint`, which the
      // metadata manager owns: the same artifact boot a deployment runs.
      new MetadataPlugin({
        rootDir: tempDir,
        watch: false,
        artifactWatch: false,
        registerSystemObjects: false,
        artifactSource: { mode: 'local-file', path: artifactPath },
      }),
      // The `'mcp'` service the `/mcp` route serves `run_action` through.
      new MCPServerPlugin(),
    ],
  });
  admin = await stack.signIn();
  // The first user is the seeded dev admin, so this sign-up is a plain member:
  // no permission set of the app's, only the platform's fallback baseline.
  member = await stack.signUp('fdp-member@dogfood.test');
}, BOOT_TIMEOUT);

afterAll(async () => {
  await stack?.stop().catch(() => undefined);
  if (tempDir) rmSync(tempDir, { recursive: true, force: true });
});

/** Ledger rows a writer flow named `flow` has created so far. */
async function ledgerRows(flow: string): Promise<number> {
  return (await stack.rows(LEDGER, { name: flow })).length;
}

/** Run-log entries the engine holds for `flow`. */
async function runCount(flow: string): Promise<number> {
  const automation = stack.kernel.getService('automation') as { listRuns(name: string): Promise<unknown[]> };
  return (await automation.listRuns(flow)).length;
}

type Door = 'action' | 'run_action' | 'endpoint';
type Caller = 'member' | 'admin';

interface Outcome {
  /** The door's answer: the HTTP status, or for `run_action` the tool error's status (200 when it ran). */
  answer: number;
  /** The ADR-0112 `error.code` on a refusal. */
  code?: string;
  /** Ledger rows the request caused (the writer's side effect). */
  rows: number;
  /** Run-log entries the request caused for the flow it named. */
  runs: number;
}

/** A JSON-RPC MCP request over Streamable-HTTP (JSON response mode). */
function mcpBody(method: string, params?: unknown, id = 1) {
  return { jsonrpc: '2.0', id, method, ...(params !== undefined ? { params } : {}) };
}

/** Knock on `door` once as `token` for `flow`, and read the answer. */
async function knock(door: Door, token: string, flow: Target): Promise<{ answer: number; code?: string }> {
  if (door === 'action') {
    const res = await stack.apiAs(token, 'POST', `/actions/${WATCH}/${actionOf(flow)}`, { params: {} });
    const body = (await res.json().catch(() => ({}))) as { error?: { code?: string } };
    return { answer: res.status, ...(res.status >= 400 && body.error?.code ? { code: body.error.code } : {}) };
  }
  if (door === 'endpoint') {
    const res = await stack.apiAs(token, 'POST', endpointPathOf(flow), {});
    const body = (await res.json().catch(() => ({}))) as { error?: { code?: string } };
    return { answer: res.status, ...(res.status >= 400 && body.error?.code ? { code: body.error.code } : {}) };
  }
  const res = await stack.api('/mcp', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(
      mcpBody('tools/call', { name: 'run_action', arguments: { actionName: actionOf(flow), objectName: WATCH } }),
    ),
  });
  expect(res.status, `the MCP transport itself answered ${res.status}: ${await res.clone().text()}`).toBe(200);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rpc: any = await res.json();
  expect(rpc.error, `run_action JSON-RPC error: ${JSON.stringify(rpc.error)}`).toBeUndefined();
  if (rpc.result?.isError !== true) return { answer: 200 };
  const text = String(rpc.result?.content?.[0]?.text ?? '');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let parsed: any;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = undefined;
  }
  return {
    answer: typeof parsed?.error?.status === 'number' ? parsed.error.status : 0,
    ...(typeof parsed?.error?.code === 'string' ? { code: parsed.error.code } : {}),
  };
}

/** Start `flow` through `door` as `caller` and measure what happened. */
async function startAs(door: Door, caller: Caller, flow: Target, rowsOf: string = flow): Promise<Outcome> {
  const rowsBefore = await ledgerRows(rowsOf);
  const runsBefore = await runCount(flow);
  const answer = await knock(door, caller === 'admin' ? admin : member, flow);
  return {
    ...answer,
    rows: (await ledgerRows(rowsOf)) - rowsBefore,
    runs: (await runCount(flow)) - runsBefore,
  };
}

describe('control: the member cannot write the ledger directly', () => {
  it('a direct create is refused PERMISSION_DENIED / 403', async () => {
    let err: unknown;
    try {
      await stack.hooks.run(LEDGER, 'insert', { name: 'direct' }, { as: member });
    } catch (e) {
      err = e;
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const refusal = err as any;
    expect(refusal?.code).toBe('PERMISSION_DENIED');
    expect(refusal?.statusCode ?? refusal?.status).toBe(403);
    expect(await ledgerRows('direct')).toBe(0);
  });

  it('the declared endpoint still refuses an anonymous caller 401 before anything runs', async () => {
    const runsBefore = await runCount(AUTO_SYS);
    const res = await stack.api(endpointPathOf(AUTO_SYS), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });
    expect(res.status).toBe(401);
    expect(await runCount(AUTO_SYS)).toBe(runsBefore);
  });
});

const RAN = { answer: 200, rows: 1, runs: 1 } as const;
/** A non-elevated writer: the member's own identity is refused the write, so the run fails. */
const USER_FLOW_FAILED = { answer: 400, code: 'FLOW_FAILED', rows: 0, runs: 1 } as const;

/**
 * Door × caller × flow → what the door answers and what the request caused.
 * MEASURED BEFORE the doors asked anything of the caller (this branch's first
 * commit carries these readings as the assertions).
 */
const TABLE: Array<{ door: Door; caller: Caller; flow: Target; rowsOf?: string; outcome: Outcome }> = [];
for (const door of ['action', 'run_action', 'endpoint'] as const) {
  TABLE.push(
    { door, caller: 'member', flow: AUTO_SYS, outcome: RAN },
    { door, caller: 'member', flow: CHANGE_SYS, outcome: RAN },
    { door, caller: 'member', flow: SCHED_SYS, outcome: RAN },
    { door, caller: 'admin', flow: AUTO_SYS, outcome: RAN },
    { door, caller: 'member', flow: SCREEN_SYS, outcome: RAN },
    { door, caller: 'member', flow: API_SYS, outcome: RAN },
    { door, caller: 'member', flow: AUTO_USER, outcome: USER_FLOW_FAILED },
    { door, caller: 'member', flow: PARENT_SCREEN, rowsOf: AUTO_SYS, outcome: RAN },
  );
}

describe('the action door, run_action and the declared endpoint × runAs: system, per type and caller', () => {
  for (const row of TABLE) {
    it(`${row.door}: ${row.caller} starts ${row.flow} → ${row.outcome.answer}`, async () => {
      expect(await startAs(row.door, row.caller, row.flow, row.rowsOf)).toEqual(row.outcome);
    });
  }
});
