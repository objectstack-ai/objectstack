// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The local flow run (`runFlowProof`, `os verify --flow`): one flow, run once
 * against the booted ephemeral stack the way production starts it, reported
 * node by node.
 *
 * The pins, each read off what only the real engine produces:
 *
 *  - CONTROL: a healthy record-change flow, started by a real write of its
 *    triggering record, reports each node's status and the row it wrote, and
 *    the row is there.
 *  - a node whose type no executor runs is reported with that node named;
 *  - a trigger that never binds is reported with the trigger named, and
 *    nothing runs;
 *  - a write to an object bound to another datasource is refused before that
 *    datasource's driver is called: the recording driver below sees no write;
 *  - an outbound node is not executed: the run stops there with the node
 *    named, and the local server below receives no request;
 *  - a schedule the deployment's scheduled-work switch keeps unarmed is not a
 *    defect: it is reported as not armed and still run with no caller;
 *  - an API-triggered flow gets its body as `record` as well as `params`, and
 *    a time-relative flow gets the given row as `record`, as their triggers
 *    hand them in;
 *  - the update and delete legs of a record-change flow fire it.
 *
 * ⚠️ This suite resolves `@objectstack/runtime` and
 * `@objectstack/service-automation` through their BUILT `dist/`. Rebuild both
 * before trusting a run of this file.
 */

import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';

import { defineStack } from '@objectstack/spec';
import { ObjectSchema, Field } from '@objectstack/spec/data';
import type { Flow } from '@objectstack/spec/automation';
import type { Plugin, PluginContext } from '@objectstack/core';
import type { IDataDriver } from '@objectstack/spec/contracts';

import { bootStack, type VerifyStack } from './harness.js';
import { runFlowProof, formatFlowRunReport } from './flow-run.js';
import { warmUpBoot } from './boot-warm-up.testkit.js';

// Paid at collection: the harness's boot loads these lazily (check:test-source-alias).
import '@objectstack/service-datasource';
import '@objectstack/service-automation';

// The local server an `http` node below would reach. The egress guard opens
// loopback only when the allowlist names it, so a request that left the run
// would land here and be counted.
const outboundHits: string[] = [];
const outboundServer = createServer((req, res) => {
  outboundHits.push(req.url ?? '');
  res.setHeader('content-type', 'application/json');
  res.end('{}');
});
await new Promise<void>((resolve) => outboundServer.listen(0, '127.0.0.1', resolve));
const OUTBOUND_URL = `http://127.0.0.1:${(outboundServer.address() as AddressInfo).port}/ping`;
vi.stubEnv('OS_EGRESS_ALLOWED_TARGETS', '127.0.0.1');
// The default deployment: package-authored scheduled work switched off.
vi.stubEnv('OS_AUTOMATION_SCHEDULED_WORK_ENABLED', 'false');
vi.stubEnv('FR_HOOK_SECRET', 'flow-run-fixture-hook-secret');
afterAll(async () => {
  vi.unstubAllEnvs();
  await new Promise<void>((resolve) => outboundServer.close(() => resolve()));
});

await warmUpBoot({ automation: true }, { requires: ['automation', 'triggers'] });

// Booting the full in-process stack runs well past vitest's 5s default.
const BOOT_TIMEOUT = 120_000;

const WATCH = 'fr_watch';
const LEDGER = 'fr_ledger';
const REMOTE = 'fr_remote';
const REMOTE_DS = 'fr_remote_ds';

const Watch = ObjectSchema.create({
  name: WATCH,
  sharingModel: 'public_read_write',
  label: 'Watch',
  pluralLabel: 'Watches',
  fields: { name: Field.text({ label: 'Name', required: true }) },
});

const Ledger = ObjectSchema.create({
  name: LEDGER,
  sharingModel: 'public_read_write',
  label: 'Ledger',
  pluralLabel: 'Ledgers',
  fields: { name: Field.text({ label: 'Name', required: true }) },
});

const CONTRACT = 'fr_contract';

const Contract = ObjectSchema.create({
  name: CONTRACT,
  sharingModel: 'public_read_write',
  label: 'Contract',
  pluralLabel: 'Contracts',
  fields: { name: Field.text({ label: 'Name', required: true }), end_date: Field.date({ label: 'End date' }) },
});

// ── A datasource that is not the ephemeral stack: a driver that records every call ──

type Call = { method: string; object?: string };
const remoteCalls: Call[] = [];
const refuse = (what: string) => async (): Promise<never> => {
  throw new Error(`flow-run remote: ${what} is not part of this fixture`);
};

/** A remote store this suite owns. Reads are refused; a write that reached it would be recorded. */
const remoteDriver = {
  name: REMOTE_DS,
  version: '0.0.1',
  supports: { transactionsUnsupported: true },
  async connect() {},
  async disconnect() {},
  async checkHealth() {
    return true;
  },
  execute: refuse('execute'),
  find: refuse('find'),
  findOne: refuse('findOne'),
  count: refuse('count'),
  async create(object: string) {
    remoteCalls.push({ method: 'create', object });
    return { id: `remote_${remoteCalls.length}` };
  },
  async update(object: string) {
    remoteCalls.push({ method: 'update', object });
    return null;
  },
  async delete(object: string) {
    remoteCalls.push({ method: 'delete', object });
    return false;
  },
  upsert: refuse('upsert'),
  bulkCreate: refuse('bulkCreate'),
  bulkUpdate: refuse('bulkUpdate'),
  bulkDelete: refuse('bulkDelete'),
  beginTransaction: refuse('beginTransaction'),
  commit: refuse('commit'),
  rollback: refuse('rollback'),
  async syncSchema() {},
  dropTable: refuse('dropTable'),
} as unknown as IDataDriver;

const remoteDriverPlugin: Plugin = {
  name: 'com.objectstack.verify.flow-run-remote-driver',
  version: '1.0.0',
  init: async (ctx: PluginContext) => {
    ctx.registerService(`driver.${REMOTE_DS}`, remoteDriver);
  },
};

// ── The flows ──

const HEALTHY = 'fr_healthy';
const NO_EXECUTOR = 'fr_no_executor';
const CONFINED = 'fr_confined';
const UNBOUND = 'fr_unbound';
const MISSING_TYPE = 'fr_missing_node';

/** On a new Watch record: create a Ledger row named after it. */
const healthy: Flow = {
  name: HEALTHY,
  label: HEALTHY,
  type: 'record_change',
  status: 'active',
  runAs: 'system',
  nodes: [
    { id: 'start', type: 'start', label: 'Start', config: { objectName: WATCH, triggerType: 'record-after-create' } },
    {
      id: 'write_ledger',
      type: 'create_record',
      label: 'Write ledger',
      config: { objectName: LEDGER, fields: { name: { dialect: 'cel', source: "'ledger of ' + record.name" } } },
    },
    { id: 'end', type: 'end', label: 'End' },
  ],
  edges: [
    { id: 'e1', source: 'start', target: 'write_ledger' },
    { id: 'e2', source: 'write_ledger', target: 'end' },
  ],
} as Flow;

/** start → a node of a type no installed plugin runs → end. */
const noExecutor: Flow = {
  name: NO_EXECUTOR,
  label: NO_EXECUTOR,
  type: 'autolaunched',
  status: 'active',
  runAs: 'system',
  nodes: [
    { id: 'start', type: 'start', label: 'Start' },
    { id: 'mystery', type: MISSING_TYPE, label: 'Mystery' },
    { id: 'end', type: 'end', label: 'End' },
  ],
  edges: [
    { id: 'e1', source: 'start', target: 'mystery' },
    { id: 'e2', source: 'mystery', target: 'end' },
  ],
} as Flow;

/** start → create a row of the object bound to the other datasource → end. */
const confined: Flow = {
  name: CONFINED,
  label: CONFINED,
  type: 'autolaunched',
  status: 'active',
  runAs: 'system',
  nodes: [
    { id: 'start', type: 'start', label: 'Start' },
    { id: 'write_remote', type: 'create_record', label: 'Write remote', config: { objectName: REMOTE, fields: { name: 'outside' } } },
    { id: 'end', type: 'end', label: 'End' },
  ],
  edges: [
    { id: 'e1', source: 'start', target: 'write_remote' },
    { id: 'e2', source: 'write_remote', target: 'end' },
  ],
} as Flow;

/** One node that writes a Ledger row named by a CEL expression. */
const ledgerNode = (id: string, source: string) => ({
  id,
  type: 'create_record',
  label: id,
  config: { objectName: LEDGER, fields: { name: { dialect: 'cel', source } } },
});

/** start → an `http` call → a Ledger write that must not run → end. */
const OUTBOUND = 'fr_outbound';
const outbound: Flow = {
  name: OUTBOUND,
  label: OUTBOUND,
  type: 'autolaunched',
  status: 'active',
  runAs: 'system',
  nodes: [
    { id: 'start', type: 'start', label: 'Start' },
    { id: 'call', type: 'http', label: 'Call out', config: { url: OUTBOUND_URL, method: 'GET' } },
    ledgerNode('after_call', "'after the call'"),
    { id: 'end', type: 'end', label: 'End' },
  ],
  edges: [
    { id: 'e1', source: 'start', target: 'call' },
    { id: 'e2', source: 'call', target: 'after_call' },
    { id: 'e3', source: 'after_call', target: 'end' },
  ],
} as Flow;

/** A nightly schedule that writes one Ledger row. */
const NIGHTLY = 'fr_nightly';
const nightly: Flow = {
  name: NIGHTLY,
  label: NIGHTLY,
  type: 'schedule',
  status: 'active',
  runAs: 'system',
  nodes: [
    { id: 'start', type: 'start', label: 'Start', config: { schedule: '0 3 * * *' } },
    ledgerNode('write_nightly', "'nightly'"),
    { id: 'end', type: 'end', label: 'End' },
  ],
  edges: [
    { id: 'e1', source: 'start', target: 'write_nightly' },
    { id: 'e2', source: 'write_nightly', target: 'end' },
  ],
} as Flow;

/** An inbound hook whose Ledger row is named from `record`, the request body. */
const HOOK = 'fr_hook';
const hook: Flow = {
  name: HOOK,
  label: HOOK,
  type: 'api',
  status: 'active',
  runAs: 'system',
  nodes: [
    // The hook secret is named, not carried: the deployment fills it (stubbed above).
    { id: 'start', type: 'start', label: 'Start', config: { triggerType: 'api', secretRef: 'FR_HOOK_SECRET' } },
    ledgerNode('write_hook', "'hook for ' + record.name"),
    { id: 'end', type: 'end', label: 'End' },
  ],
  edges: [
    { id: 'e1', source: 'start', target: 'write_hook' },
    { id: 'e2', source: 'write_hook', target: 'end' },
  ],
} as Flow;

/** A renewal sweep over contracts whose Ledger row is named from `record`, the swept row. */
const RENEWAL = 'fr_renewal';
const renewal: Flow = {
  name: RENEWAL,
  label: RENEWAL,
  type: 'autolaunched',
  status: 'active',
  runAs: 'system',
  nodes: [
    { id: 'start', type: 'start', label: 'Start', config: { timeRelative: { object: CONTRACT, dateField: 'end_date', withinDays: 30 } } },
    ledgerNode('write_renewal', "'renewal of ' + record.name + ' ' + record.id"),
    { id: 'end', type: 'end', label: 'End' },
  ],
  edges: [
    { id: 'e1', source: 'start', target: 'write_renewal' },
    { id: 'e2', source: 'write_renewal', target: 'end' },
  ],
} as Flow;

/** A record-change flow on a Watch save or delete. */
const legFlow = (name: string, triggerType: string, label: string): Flow =>
  ({
    name,
    label: name,
    type: 'record_change',
    status: 'active',
    runAs: 'system',
    nodes: [
      { id: 'start', type: 'start', label: 'Start', config: { objectName: WATCH, triggerType } },
      ledgerNode('write_leg', `'${label}'`),
      { id: 'end', type: 'end', label: 'End' },
    ],
    edges: [
      { id: 'e1', source: 'start', target: 'write_leg' },
      { id: 'e2', source: 'write_leg', target: 'end' },
    ],
  }) as Flow;
const ON_UPDATE = 'fr_on_update';
const ON_DELETE = 'fr_on_delete';

const fixtureStack = defineStack({
  manifest: {
    id: 'com.objectstack.verify.flow-run',
    namespace: 'fr',
    version: '0.0.0',
    type: 'app',
    name: 'Flow Run Fixture',
    description: 'Flows the local flow run reports on: healthy, a missing executor, a write outside the ephemeral stack.',
  },
  requires: ['automation', 'triggers'],
  datasources: [
    {
      name: REMOTE_DS,
      label: 'Flow run remote (plugin driver)',
      driver: REMOTE_DS,
      schemaMode: 'external',
      config: {},
      external: { allowWrites: true, validation: { onMismatch: 'fail', checkOnBoot: false } },
    },
  ],
  objects: [
    Watch,
    Ledger,
    Contract,
    {
      name: REMOTE,
      label: 'Remote',
      pluralLabel: 'Remotes',
      datasource: REMOTE_DS,
      external: { remoteName: REMOTE, writable: true },
      sharingModel: 'public_read_write',
      fields: { name: { type: 'text', label: 'Name' } },
    },
  ],
  flows: [
    healthy,
    noExecutor,
    confined,
    outbound,
    nightly,
    hook,
    renewal,
    legFlow(ON_UPDATE, 'record-after-update', 'a watch was saved'),
    legFlow(ON_DELETE, 'record-after-delete', 'a watch was deleted'),
  ],
  plugins: [remoteDriverPlugin],
} as never);

/**
 * The same record-change flow on a composition that mounts the automation
 * service but no trigger. `defineStack` refuses this shape at authoring (the
 * flow would never auto-launch), so it is handed to the boot unparsed: the
 * runtime verdict is what is under test, the one a stack loaded past the
 * authoring gate (an artifact, a stored flow) meets.
 */
const unboundStack = {
  manifest: {
    id: 'com.objectstack.verify.flow-run-unbound',
    namespace: 'fru',
    version: '0.0.0',
    type: 'app',
    name: 'Flow Run Unbound Fixture',
  },
  requires: ['automation'],
  objects: [Watch, Ledger],
  flows: [{ ...healthy, name: UNBOUND, label: UNBOUND }],
};

describe('runFlowProof — the local flow run', () => {
  let stack: VerifyStack;

  beforeAll(async () => {
    stack = await bootStack(fixtureStack as never, { automation: true });
  }, BOOT_TIMEOUT);

  afterAll(async () => {
    await stack?.stop().catch(() => undefined);
  });

  it('CONTROL: a healthy record-change flow, fired by a real write, reports each node and the row it wrote', async () => {
    const report = await runFlowProof(stack, fixtureStack, { flow: HEALTHY, record: { name: 'alpha' } });
    expect(report.verdict, formatFlowRunReport(report)).toBe('completed');
    expect(report.start).toBe('record_write');
    expect(report.trigger).toMatchObject({ type: 'record_change', object: WATCH, bound: true });
    expect(report.record).toMatchObject({ object: WATCH, operation: 'insert' });
    expect(report.firstFailure).toBeUndefined();
    const write = report.steps.find((s) => s.nodeId === 'write_ledger');
    expect(write).toMatchObject({ nodeType: 'create_record', status: 'success' });
    expect(report.steps.every((s) => s.status === 'success')).toBe(true);

    const ledgerWrites = report.writes.filter((w) => w.object === LEDGER);
    expect(ledgerWrites).toHaveLength(1);
    expect(ledgerWrites[0]).toMatchObject({ operation: 'insert', outcome: 'written', datasource: report.confinement.datasource });
    // The triggering write is the record's, not the flow's: it is not reported as the flow's write.
    expect(report.writes.filter((w) => w.object === WATCH)).toEqual([]);
    const rows = await stack.rows(LEDGER, { name: 'ledger of alpha' });
    expect(rows.map((r) => String(r.id))).toEqual(ledgerWrites[0].ids);
    expect(report.summary.hardFailures).toBe(0);
  });

  it('a node whose type no executor runs is reported with that node named', async () => {
    const report = await runFlowProof(stack, fixtureStack, { flow: NO_EXECUTOR });
    expect(report.missingExecutors).toEqual([{ nodeId: 'mystery', nodeType: MISSING_TYPE }]);
    expect(report.verdict, formatFlowRunReport(report)).toBe('failed');
    expect(report.firstFailure).toMatchObject({ kind: 'no_executor', nodeId: 'mystery', nodeType: MISSING_TYPE });
    expect(report.steps.find((s) => s.nodeId === 'mystery')?.status).toBe('failure');
    expect(report.summary.hardFailures).toBe(1);
    expect(formatFlowRunReport(report)).toContain(`mystery <${MISSING_TYPE}>`);
  });

  it('a write to an object on another datasource is refused before that datasource is called', async () => {
    const mark = remoteCalls.length;
    const report = await runFlowProof(stack, fixtureStack, { flow: CONFINED });
    expect(report.verdict, formatFlowRunReport(report)).toBe('failed');
    expect(report.firstFailure).toMatchObject({ kind: 'confined_write', nodeId: 'write_remote', nodeType: 'create_record' });
    expect(report.firstFailure?.message).toContain(`'${REMOTE}' routes to datasource '${REMOTE_DS}'`);
    expect(report.confinement.refused).toBe(1);
    expect(report.writes.filter((w) => w.object === REMOTE)).toEqual([
      { object: REMOTE, operation: 'insert', ids: [], outcome: 'refused', code: 'PERMISSION_DENIED', datasource: REMOTE_DS, confined: true },
    ]);
    // The recording driver saw nothing: the refusal came before the driver call.
    expect(remoteCalls.slice(mark)).toEqual([]);
    expect(report.summary.hardFailures).toBe(1);
  });

  it('an outbound node is not executed: the run stops there, the node is named, and no request leaves', async () => {
    const mark = outboundHits.length;
    const report = await runFlowProof(stack, fixtureStack, { flow: OUTBOUND });
    expect(report.confinement.outbound).toContain('http');
    expect(report.verdict, formatFlowRunReport(report)).toBe('stopped');
    expect(report.firstFailure).toMatchObject({ kind: 'outbound_not_run', nodeId: 'call', nodeType: 'http' });
    // The run log is the engine's own: the start ran, the call is the failing step, nothing after it ran.
    expect(report.steps.map((s) => [s.nodeId, s.status])).toEqual([
      ['start', 'success'],
      ['call', 'failure'],
    ]);
    expect(outboundHits.slice(mark)).toEqual([]);
    expect(await stack.rows(LEDGER, { name: 'after the call' })).toEqual([]);
    // Not a defect of the flow: it does not fail `os verify`.
    expect(report.summary.hardFailures).toBe(0);
  });

  it('a schedule the scheduled-work switch keeps unarmed is reported as not armed, and still run with no caller', async () => {
    const report = await runFlowProof(stack, fixtureStack, { flow: NIGHTLY });
    expect(report.trigger).toMatchObject({ type: 'schedule', bound: false, cause: 'deployment_policy' });
    expect(report.firstFailure, formatFlowRunReport(report)).toBeUndefined();
    expect(report.start).toBe('system');
    expect(report.verdict).toBe('completed');
    expect(report.notes.some((n) => n.includes("'schedule'") && n.includes('not a defect'))).toBe(true);
    expect(report.writes.filter((w) => w.object === LEDGER)).toHaveLength(1);
    expect(await stack.rows(LEDGER, { name: 'nightly' })).toHaveLength(1);
    expect(report.summary.hardFailures).toBe(0);
  });

  it('an API-triggered flow is handed its body as the record, as the inbound hook hands it', async () => {
    const report = await runFlowProof(stack, fixtureStack, { flow: HOOK, input: { name: 'zeta' } });
    expect(report.trigger?.type).toBe('api');
    expect(report.start).toBe('system');
    expect(report.verdict, formatFlowRunReport(report)).toBe('completed');
    expect(await stack.rows(LEDGER, { name: 'hook for zeta' })).toHaveLength(1);
  });

  it('a time-relative flow is handed the given row, seeded, as the record the sweep hands it', async () => {
    const report = await runFlowProof(stack, fixtureStack, { flow: RENEWAL, record: { name: 'acme', end_date: '2030-01-01' } });
    expect(report.trigger).toMatchObject({ type: 'time_relative', object: CONTRACT });
    expect(report.verdict, formatFlowRunReport(report)).toBe('completed');
    expect(report.record).toMatchObject({ object: CONTRACT, operation: 'insert' });
    const id = report.record?.id;
    expect(id).toBeTruthy();
    expect(await stack.rows(LEDGER, { name: `renewal of acme ${id}` })).toHaveLength(1);
    // The seed is the fixture, not the flow's write.
    expect(report.writes.filter((w) => w.object === CONTRACT)).toEqual([]);
  });

  it('the update leg seeds the record and saves it, and the save fires the flow', async () => {
    const report = await runFlowProof(stack, fixtureStack, { flow: ON_UPDATE, record: { name: 'gamma' } });
    expect(report.record).toMatchObject({ object: WATCH, operation: 'update' });
    expect(report.verdict, formatFlowRunReport(report)).toBe('completed');
    expect(await stack.rows(LEDGER, { name: 'a watch was saved' })).toHaveLength(1);
  });

  it('the delete leg seeds the record and deletes it, and the delete fires the flow', async () => {
    const report = await runFlowProof(stack, fixtureStack, { flow: ON_DELETE, record: { name: 'delta' } });
    expect(report.record).toMatchObject({ object: WATCH, operation: 'delete' });
    expect(report.verdict, formatFlowRunReport(report)).toBe('completed');
    expect(await stack.rows(LEDGER, { name: 'a watch was deleted' })).toHaveLength(1);
    expect(await stack.rows(WATCH, { name: 'delta' })).toEqual([]);
  });
});

describe('runFlowProof — a trigger that never binds', () => {
  let stack: VerifyStack;

  beforeAll(async () => {
    stack = await bootStack(unboundStack as never, { automation: true });
  }, BOOT_TIMEOUT);

  afterAll(async () => {
    await stack?.stop().catch(() => undefined);
  });

  it('is reported with the trigger named, and nothing runs or is written', async () => {
    const report = await runFlowProof(stack, unboundStack, { flow: UNBOUND, record: { name: 'beta' } });
    expect(report.verdict, formatFlowRunReport(report)).toBe('not_run');
    expect(report.trigger).toMatchObject({ type: 'record_change', object: WATCH, bound: false, cause: 'missing_trigger' });
    expect(report.firstFailure).toMatchObject({ kind: 'trigger_unbound', trigger: `'record_change' on '${WATCH}'` });
    expect(report.steps).toEqual([]);
    expect(report.writes).toEqual([]);
    expect(await stack.rows(LEDGER, {})).toEqual([]);
    expect(report.summary.hardFailures).toBe(1);
  });
});
