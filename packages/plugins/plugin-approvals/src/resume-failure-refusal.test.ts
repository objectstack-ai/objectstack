// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #34638 — the success-answer channel (`resumeFailure`) tells the hook refusal
 * that stranded the run, the same pair the thrown `RESUME_FAILED` envelope
 * carries since #34579.
 *
 * ## The gap
 *
 * #34579 put `innerRefusal` / `userMessage` on the ERROR envelope of the
 * decision doors (`StrandedDecisionDetails`). Two doors tell a stranded run on
 * a SUCCESS answer instead, through `resumeFailure` (`ResumeFailureReport`):
 *
 *  - the recall door, whose own resume strands (recall never throws — #4420,
 *    upheld by the #16472 ruling);
 *  - the subflow-parent strand: the run this door resumed advanced, and the
 *    subflow PARENT it bubbled into then stranded (#15556) — reached through
 *    `decide` and through `recall` alike.
 *
 * Both told the strand with `code` / `runId` / `status` / `repairable` and no
 * refusal, so an approver whose recall or subflow ran into a refusing record
 * hook still read a stranded run with no reason.
 *
 * ## What is pinned
 *
 *  1. Recall into a refusing hook → `resumeFailure` carries `innerRefusal`
 *     (the engine's own `{ code, message }`) and the hook's marked
 *     `userMessage`, verbatim, in two locales.
 *  2. A subflow parent that resumes into a refusing hook → the same, through
 *     the decision door and through the recall door.
 *  3. CONTROL: a strand that met no refusal (a fault — a throw that declares
 *     no HTTP answer) carries NEITHER member: absent, not empty, never
 *     synthesised from the prose.
 *  4. The pair is READ the way the thrown `RESUME_FAILED` reads it
 *     (`strandedDecisionDetails`): the engine relays whatever a node executor
 *     returns, and node types are open to plugins, so a plugin node's blank
 *     `userMessage`, or an `innerRefusal` whose `code` is unregistered or
 *     whose `message` is no string, reaches the recall answer WITHOUT that
 *     member — on the recall's own strand and on a subflow parent's — while a
 *     well-formed pair still rides (CONTROL).
 *
 * The locale half: which sentence a declared refusal catalogue answers is the
 * runtime's choice (`resolveHookRefusal`, held by its own tests). This file
 * pins the carrier — whatever sentence the hook marked reaches the caller
 * byte for byte, in either locale, and nothing on the way rewrites it.
 */

import { describe, it, expect } from 'vitest';
import { AutomationEngine, InMemorySuspendedRunStore, installBuiltinNodes } from '@objectstack/service-automation';
import { assertEngineDeleteDispatch, assertEngineUpdateDispatch } from '@objectstack/objectql';
import { ApprovalService } from './approval-service.js';
import { registerApprovalNode } from './approval-node.js';

const SYSTEM_CTX = { isSystem: true, positions: [], permissions: [] } as any;
const noopLogger: any = { info() {}, warn() {}, error() {}, debug() {} };
noopLogger.child = () => noopLogger;

/** The hook's declared sentence, as the runtime answers it per caller locale. */
const LOCALES = [
  { locale: 'zh-CN', userText: '产能已被其他订单占用，该方案无法按当前产能通过。' },
  { locale: 'en', userText: 'Capacity is already taken by other orders; this plan cannot be adopted at current capacity.' },
] as const;

const HOOK_DIAGNOSTIC = "hook 'alloc_plan_capacity_recheck' threw: Error: over_capacity";

/** A declared hook refusal as the runtime answers one: code + status ride the error, the sentence is marked. */
const hookRefusal = (userText: string) => () => Object.assign(
  new Error(HOOK_DIAGNOSTIC),
  { name: 'SandboxError', innerMessage: userText, code: 'VALIDATION_FAILED', status: 400, userMessage: userText },
);

/** A fault: a throw that declares no HTTP answer, so no refusal is met. */
const fault = () => new Error('ECONNREFUSED: could not reach the store');

/** In-memory ObjectQL stand-in: approvals tables plus the plan the flows write; `alloc_plan` updates are refused. */
function makeFakeEngine(refusal: () => unknown) {
  const tables = new Map<string, any[]>();
  const rows = (o: string) => (tables.get(o) ?? (tables.set(o, []), tables.get(o)!));
  const matches = (row: any, where: any) => Object.entries(where ?? {}).every(([k, v]) => {
    if (k.startsWith('$')) throw new Error(`fake engine: unsupported filter operator ${k}`);
    if (v && typeof v === 'object' && '$in' in (v as any)) return (v as any).$in.includes(row[k]);
    if (v && typeof v === 'object' && '$ne' in (v as any)) return row[k] !== (v as any).$ne;
    return row[k] === v;
  });
  return {
    tables,
    async find(object: string, opts: any = {}) {
      const where = opts.where ?? opts.filter ?? {};
      const out = rows(object).filter(r => matches(r, where));
      const start = opts.offset ?? 0;
      const page = typeof opts.limit === 'number' ? out.slice(start, start + opts.limit) : out.slice(start);
      return page.map(r => ({ ...r }));
    },
    async insert(object: string, data: any) { rows(object).push({ ...data }); return { ...data }; },
    async update(object: string, data: any, options?: any) {
      const dispatch = assertEngineUpdateDispatch(data, options);
      // The record hook: accepts the call the way ObjectQL does, then refuses.
      if (object === 'alloc_plan') throw refusal();
      const table = rows(object);
      if (dispatch.kind === 'multi') {
        let n = 0;
        for (let i = 0; i < table.length; i++) {
          if (matches(table[i], options?.where)) { table[i] = { ...table[i], ...data }; n++; }
        }
        return { updated: n };
      }
      const i = table.findIndex(r => r.id === dispatch.id);
      if (i >= 0) table[i] = { ...table[i], ...data };
      return i >= 0 ? { ...table[i] } : null;
    },
    async delete(object: string, options?: any) {
      const dispatch = assertEngineDeleteDispatch(options);
      const table = rows(object);
      const i = table.findIndex(r => r.id === (dispatch as any).id);
      if (i >= 0) table.splice(i, 1);
      return { id: (dispatch as any).id };
    },
  };
}

const writePlan = (id: string, status: string) => ({
  id, type: 'update_record', label: id,
  config: { objectName: 'alloc_plan', filter: { id: 'p1' }, fields: { status } },
});

/** start → approval → (approve) end; (reject = recall) release the plan → end. */
const DIRECT = {
  name: 'plan_direct',
  label: 'Plan Direct',
  type: 'autolaunched',
  nodes: [
    { id: 'start', type: 'start', label: 'Start' },
    { id: 'director', type: 'approval', label: 'Director', config: { approvers: [{ type: 'user', value: 'director' }] } },
    writePlan('release_plan', 'draft'),
    { id: 'end', type: 'end', label: 'End' },
  ],
  edges: [
    { id: 'e1', source: 'start', target: 'director' },
    { id: 'e2', source: 'director', target: 'end', label: 'approve' },
    { id: 'e3', source: 'director', target: 'release_plan', label: 'reject' },
    { id: 'e4', source: 'release_plan', target: 'end' },
  ],
};

/** The CHILD hosts the approval and writes nothing — it always completes. */
const CHILD = {
  name: 'plan_child',
  label: 'Plan Child',
  type: 'autolaunched',
  nodes: [
    { id: 'cstart', type: 'start', label: 'Start' },
    { id: 'director', type: 'approval', label: 'Director', config: { approvers: [{ type: 'user', value: 'director' }] } },
    { id: 'cend', type: 'end', label: 'End' },
  ],
  edges: [
    { id: 'c1', source: 'cstart', target: 'director' },
    { id: 'c2', source: 'director', target: 'cend', label: 'approve' },
    { id: 'c3', source: 'director', target: 'cend', label: 'reject' },
  ],
};

/** The PARENT parks at its subflow node, then writes the plan — the write the hook refuses. */
const PARENT = {
  name: 'plan_parent',
  label: 'Plan Parent',
  type: 'autolaunched',
  nodes: [
    { id: 'pstart', type: 'start', label: 'Start' },
    { id: 'sub', type: 'subflow', label: 'Approval subflow', config: { flowName: 'plan_child' } },
    writePlan('adopt_plan', 'settled'),
    { id: 'pend', type: 'end', label: 'End' },
  ],
  edges: [
    { id: 'p1', source: 'pstart', target: 'sub' },
    { id: 'p2', source: 'sub', target: 'adopt_plan' },
    { id: 'p3', source: 'adopt_plan', target: 'pend' },
  ],
};

/**
 * A plugin's node type: it fails with whatever pair it is configured to return
 * — the shape a node executor hands the engine, which relays it unchecked.
 */
const PLUGIN_STEP = 'plugin_step';
const pluginStep = (id: string) => ({ id, type: PLUGIN_STEP, label: id });

/** As {@link DIRECT}, with the plugin step on the reject (recall) branch. */
const DIRECT_PLUGIN = {
  ...DIRECT,
  name: 'plan_direct_plugin',
  nodes: DIRECT.nodes.map(n => (n.id === 'release_plan' ? pluginStep('release_plan') : n)),
};

/** As {@link PARENT}, with the plugin step after the subflow. */
const PARENT_PLUGIN = {
  ...PARENT,
  name: 'plan_parent_plugin',
  nodes: PARENT.nodes.map(n => (n.id === 'adopt_plan' ? pluginStep('adopt_plan') : n)),
};

/** One live process: real engine, real builtin + approval nodes, real approvals service. */
function boot(refusal: () => unknown, pluginCarried: Record<string, unknown> = {}) {
  const data = makeFakeEngine(refusal);
  data.tables.set('alloc_plan', [{ id: 'p1', status: 'submitted' }]);
  const service = new ApprovalService({ engine: data as any, logger: noopLogger });
  const automation = new AutomationEngine(noopLogger, new InMemorySuspendedRunStore());
  installBuiltinNodes(automation, { logger: noopLogger, getService: (n: string) => (n === 'data' ? data : undefined) } as any);
  registerApprovalNode(automation, service, noopLogger);
  automation.registerNodeExecutor({
    type: PLUGIN_STEP,
    async execute() { return { success: false, error: 'plugin step refused', ...pluginCarried }; },
  } as never);
  for (const flow of [DIRECT, CHILD, PARENT, DIRECT_PLUGIN, PARENT_PLUGIN]) automation.registerFlow(flow.name, flow as never);
  service.attachAutomation(automation);
  return { data, service, automation };
}

/** Start `flow`, and hand back the pending request plus the started run's id. */
async function park(env: ReturnType<typeof boot>, flow: string) {
  const started = await env.automation.execute(flow, {
    object: 'alloc_plan', record: { id: 'p1', status: 'submitted' }, userId: 'rep',
  } as never);
  expect((started as any).status, 'the run parks').toBe('paused');
  const req = (await env.data.find('sys_approval_request', { where: { status: 'pending' } }))[0];
  expect(req?.flow_run_id, 'the request names the run it gates').toBeTruthy();
  return { req, startedRunId: (started as any).runId as string };
}

describe('#34638 — resumeFailure tells the hook refusal that stranded the run', () => {
  describe.each(LOCALES)('recall into a refusing hook ($locale)', ({ userText }) => {
    it('the recall answer\'s resumeFailure carries innerRefusal and the marked userMessage', async () => {
      const env = boot(hookRefusal(userText));
      const { req } = await park(env, 'plan_direct');
      const runId = req.flow_run_id as string;

      // Recall never throws (#4420): the withdrawal stands and the strand is told.
      const answer = await env.service.recall(req.id, { actorId: 'rep' }, SYSTEM_CTX);
      expect(answer.request.status).toBe('recalled');
      expect(answer.resumed, "this door's own resume stranded").toBe(false);
      expect((await env.data.find('alloc_plan', { where: { id: 'p1' } }))[0].status).toBe('submitted');

      expect(answer.resumeFailure).toEqual({
        code: 'RESUME_FAILED',
        runId,
        status: 'stranded',
        repairable: true,
        innerRefusal: { code: 'VALIDATION_FAILED', message: HOOK_DIAGNOSTIC },
        userMessage: userText,
      });
    });
  });

  describe.each(LOCALES)('subflow parent resumes into a refusing hook ($locale)', ({ userText }) => {
    it('through the decision door: resumeFailure names the PARENT and carries the refusal', async () => {
      const env = boot(hookRefusal(userText));
      const { req, startedRunId: parentRunId } = await park(env, 'plan_parent');
      expect(req.flow_run_id, 'the request names the CHILD').not.toBe(parentRunId);

      const answer = await env.service.decide(req.id, { decision: 'approve', actorId: 'director' }, SYSTEM_CTX);
      expect(answer.resumed, 'the child really did resume').toBe(true);
      expect((await env.automation.getRun(parentRunId))?.status).toBe('failed');

      expect(answer.resumeFailure).toEqual({
        code: 'RESUME_FAILED',
        runId: parentRunId,
        status: 'stranded',
        repairable: true,
        innerRefusal: { code: 'VALIDATION_FAILED', message: HOOK_DIAGNOSTIC },
        userMessage: userText,
      });
    });

    it('through the recall door: the same report, the PARENT\'s id on it', async () => {
      const env = boot(hookRefusal(userText));
      const { req, startedRunId: parentRunId } = await park(env, 'plan_parent');

      const answer = await env.service.recall(req.id, { actorId: 'rep' }, SYSTEM_CTX);
      expect(answer.resumed, 'the child really did resume').toBe(true);
      expect(answer.request.status).toBe('recalled');

      expect(answer.resumeFailure).toEqual({
        code: 'RESUME_FAILED',
        runId: parentRunId,
        status: 'stranded',
        repairable: true,
        innerRefusal: { code: 'VALIDATION_FAILED', message: HOOK_DIAGNOSTIC },
        userMessage: userText,
      });
    });
  });

  describe('CONTROL — a strand that met no refusal carries neither member', () => {
    const neitherMember = (answer: { resumeFailure?: unknown; resumeError?: string }) => {
      const report = answer.resumeFailure;
      expect(report, 'the strand is still told').toBeDefined();
      expect(answer.resumeError, 'and it is the fault, not some other failure').toContain('ECONNREFUSED');
      expect(Object.keys(report as object).sort(), 'absent, not empty').toEqual(['code', 'repairable', 'runId', 'status']);
    };

    it('recall whose own run strands on a fault', async () => {
      const env = boot(fault);
      const { req } = await park(env, 'plan_direct');
      const answer = await env.service.recall(req.id, { actorId: 'rep' }, SYSTEM_CTX);
      expect(answer.resumeFailure).toMatchObject({ code: 'RESUME_FAILED', runId: req.flow_run_id, status: 'stranded', repairable: true });
      neitherMember(answer);
    });

    it('a subflow parent that strands on a fault, through the decision door', async () => {
      const env = boot(fault);
      const { req, startedRunId: parentRunId } = await park(env, 'plan_parent');
      const answer = await env.service.decide(req.id, { decision: 'approve', actorId: 'director' }, SYSTEM_CTX);
      expect(answer.resumeFailure).toMatchObject({ code: 'RESUME_FAILED', runId: parentRunId, status: 'stranded', repairable: true });
      neitherMember(answer);
    });

    it('a subflow parent that strands on a fault, through the recall door', async () => {
      const env = boot(fault);
      const { req, startedRunId: parentRunId } = await park(env, 'plan_parent');
      const answer = await env.service.recall(req.id, { actorId: 'rep' }, SYSTEM_CTX);
      expect(answer.resumeFailure).toMatchObject({ code: 'RESUME_FAILED', runId: parentRunId, status: 'stranded', repairable: true });
      neitherMember(answer);
    });
  });
  describe('the pair is read the way the thrown RESUME_FAILED reads it — a plugin node\'s malformed member is dropped', () => {
    const WELL_FORMED = { code: 'VALIDATION_FAILED', message: 'over capacity' };
    const MARKED = 'Capacity is already taken.';
    const CASES = [
      {
        name: 'a blank userMessage is no marking: dropped, the well-formed innerRefusal rides',
        carried: { innerRefusal: WELL_FORMED, userMessage: '   ' },
        told: { innerRefusal: WELL_FORMED },
      },
      {
        name: 'an innerRefusal whose code is unregistered is dropped, the marked userMessage rides',
        carried: { innerRefusal: { code: 'PLUGIN_OVER_CAPACITY', message: 'over capacity' }, userMessage: MARKED },
        told: { userMessage: MARKED },
      },
      {
        name: 'an innerRefusal whose message is no string, and a non-string userMessage, are both dropped',
        carried: { innerRefusal: { code: 'VALIDATION_FAILED', message: 42 }, userMessage: 7 },
        told: {},
      },
      {
        name: 'CONTROL: a well-formed pair rides whole',
        carried: { innerRefusal: WELL_FORMED, userMessage: MARKED },
        told: { innerRefusal: WELL_FORMED, userMessage: MARKED },
      },
    ];

    describe.each(CASES)('$name', ({ carried, told }) => {
      it('on the recall\'s own strand', async () => {
        const env = boot(fault, carried);
        const { req } = await park(env, 'plan_direct_plugin');
        const answer = await env.service.recall(req.id, { actorId: 'rep' }, SYSTEM_CTX);
        expect(answer.resumed, "this door's own resume stranded").toBe(false);
        expect(answer.resumeError, 'the strand is the plugin step').toContain('plugin step refused');
        expect(answer.resumeFailure).toEqual({
          code: 'RESUME_FAILED', runId: req.flow_run_id, status: 'stranded', repairable: true, ...told,
        });
      });

      it('on a subflow parent\'s strand, through the recall door', async () => {
        const env = boot(fault, carried);
        const { req, startedRunId: parentRunId } = await park(env, 'plan_parent_plugin');
        const answer = await env.service.recall(req.id, { actorId: 'rep' }, SYSTEM_CTX);
        expect(answer.resumed, 'the child really did resume').toBe(true);
        expect(answer.resumeError, 'the strand is the plugin step').toContain('plugin step refused');
        expect(answer.resumeFailure).toEqual({
          code: 'RESUME_FAILED', runId: parentRunId, status: 'stranded', repairable: true, ...told,
        });
      });
    });
  });
});
