// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// The principal an anonymous request executes as at an `authRequired: false`
// declared endpoint, on a real boot (#22147, ruling C).
//
// The ruling: an unauthenticated request at an endpoint an application declared
// `authRequired: false` executes as the GUEST principal the runtime face's
// explicit guest entry (`assembleExecutionContextOrGuest`) builds —
// `principalKind: 'guest'`, `positions: ['guest']`, `isSystem: false` —
// threaded into the `object_operation` data calls and the `flow` executor
// alike. Never principal-less, never the system principal. With no grant bound
// to the guest (no channel exists yet), its object operations are DENIED, and
// `authRequired: true` keeps answering 401.
//
// Why a status code alone cannot hold this: a principal-less context and a
// guest both end in `403 PERMISSION_DENIED` now that the engine-level deny that
// replaced the principal-less hand-off has landed (ADR-0096 D5), so
// `declarative-endpoint-policy`'s 403 no longer tells the two apart. What this
// file pins is the context the ENGINE is
// handed (an engine spy), whether the DRIVER is reached (a middleware
// registered after boot runs last, right before the driver), and what the
// caller is told (status, envelope, and that no byte of the row comes back).
//
// The fixture is inline and throwaway on purpose, like the policy fixture: it
// exists only to be probed. Every anonymous endpoint carries the armed rate
// limit ADR-0121 D6 makes its publish obligation, so booting at all is a
// positive assertion that the declarations are the accepted form.

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { bootStack, type VerifyStack } from '@objectstack/verify';
import { MetadataPlugin } from '@objectstack/metadata';
import { defineStack } from '@objectstack/spec';
import { ObjectSchema, Field } from '@objectstack/spec/data';
import type { ApiEndpoint } from '@objectstack/spec/api';
import type { Flow } from '@objectstack/spec/automation';
import type { IObjectQLEngine } from '@objectstack/spec/contracts';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const OBJECT = 'anonguest_note';
const SEEDED_NAME = 'anonguest-seeded-row-marker';

const Note = ObjectSchema.create({
  name: OBJECT,
  // [ADR-0090 D1] grandfather stamp: the gate under test is the principal the
  // endpoint door hands the engine, not record sharing.
  sharingModel: 'public_read_write',
  label: 'Anon Guest Note',
  pluralLabel: 'Anon Guest Notes',
  fields: { name: Field.text({ label: 'Name', required: true }) },
});

/** start → get_record (by id) → end, under the default `runAs: 'user'`. */
const ReadFlow: Flow = {
  name: 'anonguest_read',
  label: 'Read a note',
  type: 'autolaunched',
  runAs: 'user',
  variables: [
    { name: 'noteId', type: 'text', isInput: true },
    { name: 'found', type: 'text', isOutput: true },
  ],
  nodes: [
    { id: 'start', type: 'start', label: 'Start' },
    {
      id: 'get',
      type: 'get_record',
      label: 'Get note',
      config: { objectName: OBJECT, filter: { id: '{noteId}' }, outputVariable: 'found' },
    },
    { id: 'end', type: 'end', label: 'End' },
  ],
  edges: [
    { id: 'e1', source: 'start', target: 'get' },
    { id: 'e2', source: 'get', target: 'end' },
  ],
};

const ARMED = { enabled: true, windowMs: 60_000, maxRequests: 1_000 };
const base = '/api/v1/apps/anonguest';

const endpoints: ApiEndpoint[] = [
  {
    name: 'anonguest_find', path: `${base}/notes`, method: 'GET', summary: 'find', description: 'anonymous find',
    type: 'object_operation', objectParams: { object: OBJECT, operation: 'find' },
    authRequired: false, rateLimit: ARMED,
  },
  {
    name: 'anonguest_get', path: `${base}/note`, method: 'GET', summary: 'get', description: 'anonymous get by id',
    type: 'object_operation', objectParams: { object: OBJECT, operation: 'get' },
    authRequired: false, rateLimit: ARMED,
  },
  {
    name: 'anonguest_create', path: `${base}/notes`, method: 'POST', summary: 'create', description: 'anonymous create',
    type: 'object_operation', objectParams: { object: OBJECT, operation: 'create' },
    authRequired: false, rateLimit: ARMED,
  },
  {
    // The control: the same operation, session-gated.
    name: 'anonguest_find_gated', path: `${base}/gated-notes`, method: 'GET', summary: 'gated', description: 'gated find',
    type: 'object_operation', objectParams: { object: OBJECT, operation: 'find' },
    authRequired: true,
  },
  {
    name: 'anonguest_read_flow', path: `${base}/read`, method: 'POST', summary: 'flow', description: 'anonymous flow',
    type: 'flow', target: ReadFlow.name,
    authRequired: false, rateLimit: ARMED,
  },
];

const fixtureStack = defineStack({
  manifest: {
    id: 'com.dogfood.anonymous-endpoint-guest',
    namespace: 'anonguest',
    version: '0.0.0',
    type: 'app',
    name: 'Anonymous Endpoint Guest Fixture',
    description: 'Declared endpoints probed for the principal an anonymous request executes as.',
  },
  objects: [Note],
  flows: [ReadFlow],
  apis: endpoints,
});

type Ctx = Record<string, unknown> | undefined;

let stack: VerifyStack;
let tempDir: string;
let adminToken: string;
let seededId: string;
/** The context each engine call on the fixture object was handed, in order. */
const engineCalls: Array<{ method: string; context: Ctx }> = [];
/** Operations on the fixture object that passed every middleware (reached the driver). */
const driverReached: string[] = [];
/** Every context the automation service was asked to run a flow with. */
const flowContexts: Array<Record<string, unknown>> = [];

beforeAll(async () => {
  tempDir = mkdtempSync(join(tmpdir(), 'os-anon-guest-'));
  const artifactPath = join(tempDir, 'objectstack.json');
  writeFileSync(artifactPath, JSON.stringify(fixtureStack));
  stack = await bootStack(fixtureStack, {
    automation: true,
    extraPlugins: [
      new MetadataPlugin({
        rootDir: tempDir,
        watch: false,
        artifactWatch: false,
        registerSystemObjects: false,
        artifactSource: { mode: 'local-file', path: artifactPath },
      }),
    ],
  });
  adminToken = await stack.signIn();

  const seed = await stack.apiAs(adminToken, 'POST', `/data/${OBJECT}`, { name: SEEDED_NAME });
  expect(seed.status, await seed.clone().text()).toBe(201);
  seededId = ((await seed.json()) as { id: string }).id;
  expect(seededId).toBeTruthy();

  const ql = stack.kernel.getService<IObjectQLEngine>('objectql');
  // Entry: what the engine API is handed. `find` / `findOne` take the options
  // second, `insert` third.
  for (const [method, at] of [['find', 1], ['findOne', 1], ['insert', 2]] as const) {
    const original = (ql as any)[method].bind(ql);
    vi.spyOn(ql as any, method).mockImplementation(async (...args: any[]) => {
      if (args[0] === OBJECT) engineCalls.push({ method, context: args[at]?.context });
      return original(...args);
    });
  }
  // Exit: registered after every plugin's middleware, so it runs LAST — only an
  // operation every security middleware let through reaches it, and the driver
  // call follows it directly.
  ql.registerMiddleware(async (op: any, next: () => Promise<void>) => {
    if (op.object === OBJECT) driverReached.push(op.operation);
    await next();
  });

  const automation = stack.kernel.getService('automation') as { execute(n: string, c: unknown): Promise<unknown> };
  const execute = automation.execute.bind(automation);
  vi.spyOn(automation, 'execute').mockImplementation(async (name: string, context: any) => {
    flowContexts.push(context);
    return execute(name, context);
  });
}, 120_000);

afterAll(async () => {
  vi.restoreAllMocks();
  await stack?.stop();
  if (tempDir) rmSync(tempDir, { recursive: true, force: true });
});

function resetProbes() {
  engineCalls.length = 0;
  driverReached.length = 0;
  flowContexts.length = 0;
}

/** The guest envelope's identity facts, and the absence of everything else. */
function expectGuest(context: Ctx) {
  expect(context, 'the anonymous call reached the engine with NO execution context: principal-less').toBeDefined();
  expect(context).toMatchObject({ principalKind: 'guest', positions: ['guest'], isSystem: false });
  expect(context).not.toHaveProperty('userId');
}

/** 403 PERMISSION_DENIED (ADR-0112: code + status), and no byte of the row. */
async function expectDeniedWithoutDisclosure(res: Response) {
  const text = await res.text();
  expect(res.status, text).toBe(403);
  const body = JSON.parse(text) as { success?: boolean; data?: unknown; error?: { code?: string } };
  expect(body.success).toBe(false);
  expect(body.error?.code).toBe('PERMISSION_DENIED');
  expect(body).not.toHaveProperty('data');
  expect(text).not.toContain(SEEDED_NAME);
  expect(text).not.toContain(seededId);
}

describe('[#22147] object_operation at authRequired:false — the anonymous request executes as the guest', () => {
  it('find: the engine is handed the guest, the driver is never reached, and the caller is denied with nothing disclosed', async () => {
    resetProbes();
    const res = await stack.api('/apps/anonguest/notes', { method: 'GET' });
    await expectDeniedWithoutDisclosure(res);
    expect(engineCalls.map((c) => c.method)).toEqual(['find']);
    expectGuest(engineCalls[0]!.context);
    expect(driverReached).toEqual([]);
  });

  it('get by id: the same guest, the same refusal, and the addressed row is not echoed', async () => {
    resetProbes();
    const res = await stack.api(`/apps/anonguest/note?id=${encodeURIComponent(seededId)}`, { method: 'GET' });
    await expectDeniedWithoutDisclosure(res);
    expect(engineCalls.map((c) => c.method)).toEqual(['findOne']);
    expectGuest(engineCalls[0]!.context);
    expect(driverReached).toEqual([]);
  });

  it('create: the guest is refused before the driver, so no row is written', async () => {
    resetProbes();
    const res = await stack.api('/apps/anonguest/notes', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'anonguest-anonymous-write' }),
    });
    await expectDeniedWithoutDisclosure(res);
    expect(engineCalls.map((c) => c.method)).toEqual(['insert']);
    expectGuest(engineCalls[0]!.context);
    expect(driverReached).toEqual([]);

    // Read back as the admin: the seeded row is there (the read works), the
    // anonymous one is not (the write never landed).
    const after = await stack.apiAs(adminToken, 'GET', `/data/${OBJECT}`);
    const listed = await after.text();
    expect(after.status, listed).toBe(200);
    expect(listed).toContain(SEEDED_NAME);
    expect(listed).not.toContain('anonguest-anonymous-write');
  });

  it('the same operation declared authRequired:true keeps answering 401, and the engine is never asked', async () => {
    resetProbes();
    const res = await stack.api('/apps/anonguest/gated-notes', { method: 'GET' });
    expect(res.status).toBe(401);
    expect(((await res.json()) as { error?: { code?: string } }).error?.code).toBe('UNAUTHENTICATED');
    expect(engineCalls).toEqual([]);
  });

  it('an AUTHENTICATED request at the authRequired:false endpoint still runs as that user, never as the guest', async () => {
    resetProbes();
    const res = await stack.apiAs(adminToken, 'GET', '/apps/anonguest/notes');
    const text = await res.text();
    expect(res.status, text).toBe(200);
    expect(text).toContain(SEEDED_NAME);
    expect(engineCalls).toHaveLength(1);
    const context = engineCalls[0]!.context;
    expect(context).toMatchObject({ principalKind: 'human', isSystem: false });
    expect(typeof context?.userId).toBe('string');
    expect(context?.positions).not.toContain('guest');
    expect(driverReached).toEqual(['find']);
  });
});

describe('[#22147] flow at authRequired:false — the flow executor is handed the guest', () => {
  it('carries the guest position with no user and no elevation, and the run\'s data call never reaches the engine principal-less', async () => {
    resetProbes();
    const res = await stack.api('/apps/anonguest/read', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ params: { noteId: seededId } }),
    });
    const text = await res.text();

    expect(flowContexts).toHaveLength(1);
    const handed = flowContexts[0]!;
    expect(handed.positions).toEqual(['guest']);
    expect(handed).not.toHaveProperty('userId');
    expect(handed).not.toHaveProperty('isSystem');
    expect(handed).not.toHaveProperty('runAs');

    // A `runAs: 'user'` run with no user is refused fail-closed by the
    // automation service before its data node touches the engine, and the
    // door reports the failed run (the shared flow-dispatch table).
    expect(res.status, text).toBe(400);
    expect(((JSON.parse(text)) as { error?: { code?: string } }).error?.code).toBe('FLOW_FAILED');
    expect(text).not.toContain(SEEDED_NAME);
    expect(engineCalls).toEqual([]);
    expect(driverReached).toEqual([]);
  });
});
