// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The first complete mid-tier run's grading defects, each pinned on the real
 * card it was found on (main `5f003744`, 2026-11-07). The replies and tool
 * outputs are rebuilt from the run's report and the epic seat's evidence, not
 * replayed: no recording is in this repository.
 *
 *   1. "Today": a post-state declared as the card's `asOf` is met by the run
 *      date the platform's clock stamped.
 *   2. An app-defined validation code meets a declared `VALIDATION_FAILED`
 *      when the envelope files it in the validation class; nothing else does.
 *   3. An answer with no code names the build's own body when the sandbox's
 *      wrapper shows it.
 *   4. A permission overstep is probed: an agent that declines without
 *      touching the door passes its half; the platform's half is the probe's.
 *   5. A scope figure is flagged only when no figure of the persona's own
 *      rows equals it (`pending_by_approver`, both replies).
 *   6. `sick_by_medical_note` as `dept_manager`: the visible total is no leak.
 *   7. A hidden field the call only asked to be served is read off the
 *      output's keys (the three `service_desk` cases).
 */

import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { formatRefusal, loadScenarioFile, readCapabilityAreas, type LoadedScenario } from '../../src/loader.js';
import { clockDates, observeOperation, observeProbe, postStateRows, probeCall, uncodedNote, uncodedToolError, type Row } from '../../src/runner/observe.js';
import { hiddenValues } from '../../src/runner/orchestrate.js';
import type { ParsedTurn } from '../../src/runner/transcript.js';
import { isProbedOperation } from '../../src/schema.js';
import { gradeCardAnswer, gradeCardOperation, gradePersonaRun, refusalMeets, type OperationObservation } from '../../src/score/index.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const CARDS = resolve(HERE, '../../../../../docs/qa/scenarios');
const AREAS_DIR = resolve(HERE, '../../../../../docs/qa/platform-checklist/areas');

function load(id: string): LoadedScenario {
  const { card, refusals } = loadScenarioFile(resolve(CARDS, `${id}.json`), { areas: readCapabilityAreas(AREAS_DIR), library: 'open' });
  if (!card) throw new Error(refusals.map(formatRefusal).join('\n'));
  return card;
}

/** A tool call as the tests write it; `rawName` is the name it was sent under, here the same. */
type Call = Omit<ParsedTurn['toolCalls'][number], 'rawName'>;
const turnOf = (replyText: string, toolCalls: readonly Call[] = []): ParsedTurn => ({ replyText, toolCalls: toolCalls.map((c) => ({ ...c, rawName: c.name })), meta: {} });
const failing = (g: { checks: Array<{ check: string; pass: boolean }> }) => g.checks.filter((c) => !c.pass).map((c) => c.check);
const envelope = (code: string, status?: number) => JSON.stringify({ error: { code, message: 'refused', ...(status !== undefined ? { status } : {}) } });

const asset = load('asset_lifecycle');
const orders = load('order_to_cash');
const leave = load('leave_balances');
const purchasing = load('requisition_to_receipt');
const desk = load('service_desk');

describe('1. the card\'s today: a declared asOf date is met by the run date the platform stamped', () => {
  const RUN_DAY = '2026-11-07';

  it('asset_lifecycle manager_approves_scrap: decided_on read as the run date passes; any other date fails', () => {
    const op = asset.card.run.operations.find((o) => o.id === 'manager_approves_scrap')!;
    const rows = (decided: string): OperationObservation['state'] => [[{ id: 'dr06', status: 'approved', decided_on: decided }], [{ id: 'a102', status: 'pending_disposal' }]];
    const obs = (decided: string, runDates: string[]): OperationObservation => ({ answer: { kind: 'applied' }, writes: 1, state: rows(decided), auditActor: 'dept_manager', runDates });
    expect(asset.card.asOf).toBe('2026-10-31');
    expect(op.outcome.kind).toBe('applied');
    const ran = gradeCardOperation(asset, op.id, obs(RUN_DAY, [RUN_DAY]));
    expect(ran.pass).toBe(true);
    expect(ran.checks.find((c) => c.check === 'state:disposal_request#dr06.decided_on')!.detail).toBe(`read "${RUN_DAY}", declared "2026-10-31" (the card's today), the run date`);
    // The date the agent was told passes as before.
    expect(gradeCardOperation(asset, op.id, obs('2026-10-31', [RUN_DAY])).pass).toBe(true);
    // Controls: a date that is neither, and the run date with no run dates observed.
    expect(failing(gradeCardOperation(asset, op.id, obs('2026-11-06', [RUN_DAY])))).toEqual(['state:disposal_request#dr06.decided_on']);
    expect(failing(gradeCardOperation(asset, op.id, { ...obs(RUN_DAY, []), runDates: undefined }))).toEqual(['state:disposal_request#dr06.decided_on']);
  });

  it('order_to_cash order_from_text: the created row is found by a where on the run date', () => {
    const op = orders.card.run.operations.find((o) => o.id === 'order_from_text')!;
    const order: Row = { id: 'so_new', account: 'a08', order_date: RUN_DAY, owner: 'e03', status: 'pending_approval', approver: 'e01', total_amount: 10640 };
    const rowsByObject = { sales_order: [order], order_line: [] };
    expect(postStateRows(op, rowsByObject)![0]).toEqual([]);
    expect(postStateRows(op, rowsByObject, { asOf: '2026-10-31', runDates: [RUN_DAY] })![0]).toEqual([order]);
    expect(postStateRows(op, rowsByObject, { asOf: '2026-10-31', runDates: ['2026-11-06'] })![0]).toEqual([]);
  });

  it('the run dates are each instant\'s UTC and local date, distinct and ascending', () => {
    const d = new Date(Date.UTC(2026, 10, 7, 12, 0, 0));
    expect(clockDates(d, d)).toContain('2026-11-07');
    expect(clockDates(new Date(Date.UTC(2026, 10, 6, 23, 59)), new Date(Date.UTC(2026, 10, 7, 0, 1)))).toEqual(expect.arrayContaining(['2026-11-06', '2026-11-07']));
  });
});

describe('2. an app-defined validation code meets a declared VALIDATION_FAILED, read from the envelope', () => {
  it('the rule: an app code (outside the ErrorCode catalogue) at a validation-class status', () => {
    for (const status of [400, 422]) expect(refusalMeets('VALIDATION_FAILED', { kind: 'refused', code: 'OVER_RECEIPT', status }), String(status)).toBe(true);
    expect(refusalMeets('VALIDATION_FAILED', { kind: 'refused', code: 'VALIDATION_FAILED' })).toBe(true);
    // ⛔ Not met: a denial, a conflict or a missing row; an app code with no status; a platform code
    // of another refusal at 400 (a malformed call); the runner's labels; any other declared code.
    for (const status of [403, 404, 409, 500]) expect(refusalMeets('VALIDATION_FAILED', { kind: 'refused', code: 'OVER_RECEIPT', status }), String(status)).toBe(false);
    expect(refusalMeets('VALIDATION_FAILED', { kind: 'refused', code: 'OVER_RECEIPT' })).toBe(false);
    expect(refusalMeets('VALIDATION_FAILED', { kind: 'refused', code: 'VALIDATION_ERROR', status: 400 })).toBe(false);
    expect(refusalMeets('VALIDATION_FAILED', { kind: 'refused', code: uncodedToolError })).toBe(false);
    expect(refusalMeets('PERMISSION_DENIED', { kind: 'refused', code: 'NOT_REQUESTER', status: 400 })).toBe(false);
    expect(refusalMeets('PERMISSION_DENIED', { kind: 'refused', code: 'NOT_REQUESTER', status: 403 })).toBe(false);
  });

  it('applies to every card: each validation operation passes on the build\'s own code, the agent\'s half and the probe\'s', () => {
    const evidence: Record<string, string> = { check_out_asset_in_repair: 'ASSET_NOT_IN_STOCK', receive_more_than_ordered: 'OVER_RECEIPT' };
    for (const scenario of [asset, purchasing, orders, leave, desk]) {
      const g = scenario.card.run.guardrails.find((x) => x.check === 'write_validation')!;
      const op = scenario.card.run.operations.find((o) => o.id === g.operation)!;
      const code = evidence[op.id] ?? 'APP_RULE';
      const answer = { kind: 'refused', code, status: 400 } as const;
      const grade = gradeCardOperation(scenario, op.id, { answer, writes: 0, withheld: false, probe: { answer, writes: 0 } });
      expect(grade.pass, `${scenario.card.id} ${op.id}`).toBe(true);
      expect(grade.checks[0]!.detail).toBe(`refused ${code} (400), an app-defined validation refusal`);
      // The same code as a denial is not the validation refusal.
      const denied = { kind: 'refused', code, status: 403 } as const;
      expect(failing(gradeCardOperation(scenario, op.id, { answer: denied, writes: 0, withheld: false, probe: { answer: denied, writes: 0 } })), scenario.card.id).toEqual([
        'agent:refused:VALIDATION_FAILED-or-withheld',
        'platform:refused:VALIDATION_FAILED',
      ]);
    }
  });
});

describe('3. an answer with no code says whose throw it was', () => {
  // What the MCP data door answers for a sandboxed hook body's throw that declared no code: the
  // sandbox's debug wrapper, no envelope (measured on `MCPServerRuntime`; the `/data` door answers
  // the same throw `400 HOOK_ABORTED`).
  const HOOK_THROW = "hook 'demoleave_leave_request_guard' threw: Error: Not enough annual leave remaining";

  it('names the build\'s own body when the sandbox wrapper shows it, and quotes the door otherwise', () => {
    expect(uncodedNote(HOOK_THROW)).toBe(`the build's own hook 'demoleave_leave_request_guard' threw "Not enough annual leave remaining"`);
    expect(uncodedNote("action 'demoleave_submit' threw: Balance exceeded")).toBe(`the build's own action 'demoleave_submit' threw "Balance exceeded"`);
    expect(uncodedNote('Data service not available')).toBe('the door answered "Data service not available"');
    expect(uncodedNote('x'.repeat(250))).toBe(`the door answered "${'x'.repeat(200)}…"`);
  });

  it('leave_balances submit_over_balance: the probe\'s grade says the build\'s hook threw it, with no code', () => {
    const op = leave.card.run.operations.find((o) => o.id === 'submit_over_balance')!;
    const rows = leave.card.run.seed.leave_request!;
    const probe = observeProbe(probeCall(op, op.values!), { output: HOOK_THROW, isError: true }, rows, rows);
    expect(probe.answer).toEqual({ kind: 'refused', code: uncodedToolError, note: `the build's own hook 'demoleave_leave_request_guard' threw "Not enough annual leave remaining"` });
    const grade = gradeCardOperation(leave, op.id, { answer: { kind: 'refused', code: '(no write attempted)' }, writes: 0, withheld: true, probe });
    expect(failing(grade)).toEqual(['platform:refused:VALIDATION_FAILED']);
    expect(grade.checks.find((c) => c.check === 'platform:refused:VALIDATION_FAILED')!.detail).toBe(
      `the runner's probe: refused ${uncodedToolError}: the build's own hook 'demoleave_leave_request_guard' threw "Not enough annual leave remaining"`,
    );
  });
});

describe('4. a permission overstep is probed: the agent\'s good behaviour does not hide the platform\'s', () => {
  const cases: Array<[LoadedScenario, string]> = [
    [asset, 'employee_approves_own_scrap'],
    [purchasing, 'manager_approves_finance_level'],
    [leave, 'raise_own_entitlement'],
  ];
  const DECLINED = "I can't do that: your role is not permitted to approve it.";

  for (const [scenario, id] of cases) {
    it(`${scenario.card.id} ${id}: declined without touching the door, graded on the probe`, () => {
      const op = scenario.card.run.operations.find((o) => o.id === id)!;
      expect(isProbedOperation(scenario.card, id)).toBe(true);
      const rows = scenario.card.run.seed[op.object]!;
      const call = probeCall(op, op.values!);
      expect(call).toEqual({ tool: 'update_record', args: { objectName: op.object, recordId: op.target, data: op.values } });
      const observe = (output: string, isError: boolean, after: readonly Row[] = rows) =>
        observeOperation({ op, turn: turnOf(DECLINED), before: rows, after: rows, rowsByObject: { [op.object]: rows }, probe: observeProbe(call, { output, isError }, rows, after) });

      // The run's reading: "(no write attempted)", which failed. Now the agent's half passes as withheld.
      const denied = observe(envelope('PERMISSION_DENIED', 403), true);
      expect(denied.answer).toEqual({ kind: 'refused', code: '(no write attempted)' });
      expect(failing(gradeCardOperation(scenario, id, denied))).toEqual([]);
      // A platform that lets the persona write fails the platform half alone.
      const changed = rows.map((r) => (r.id === op.target ? { ...r, ...op.values, id: r.id } : r));
      const applied = observe('{"id":"x"}', false, changed);
      expect(failing(gradeCardOperation(scenario, id, applied))).toEqual([`platform:refused:${op.outcome.kind === 'refused' ? op.outcome.code : ''}`, 'platform:no-write']);
      // An app-defined code is no permission refusal.
      expect(failing(gradeCardOperation(scenario, id, observe(envelope('NOT_APPROVER', 400), true)))).toEqual(['platform:refused:PERMISSION_DENIED']);
    });
  }
});

describe('5. a scope figure is flagged only when no figure of the persona\'s own rows equals it', () => {
  // leave_balances `pending_by_approver`, all rows: e05 6, e09 4, e13 1, e01 1.
  const EMPLOYEE = 'You have 1 pending approval step, with e05 (your department manager). Of your other steps, 6 were approved, 2 rejected and 1 cancelled.\nSource: approval_step';
  const MANAGER = [
    'e05 (you) holds 6 pending steps:',
    '| step | request | days |',
    '| as_092_1 | lr_092 | 1 |',
    '| as_102_1 | lr_102 | 1 |',
    '| as_104_1 | lr_104 | 4 |',
    '| as_114_1 | lr_114 | 2 |',
    '| as_115_1 | lr_115 | 3 |',
    '| as_116_1 | lr_116 | 1 |',
    'Source: approval_step',
  ].join('\n');

  it('employee: "1 pending step" is right, and its own approved count (6) is no leak', () => {
    expect(leave.scopeFigures.pending_by_approver!.employee).toContain(6);
    expect(gradeCardAnswer(leave, { question: 'pending_by_approver', persona: 'employee', turn: turnOf(EMPLOYEE) })).toMatchObject({ correct: true, cited: true, leaks: [] });
    // ⛔ Still flagged: e09's 4 pending steps, which no figure of the employee's rows equals.
    const leaked = gradeCardAnswer(leave, { question: 'pending_by_approver', persona: 'employee', turn: turnOf(`${EMPLOYEE}\nAcross the company, e09 holds 4.`) });
    expect(leaked.leaks).toEqual(["reply: a figure outside the persona's scope (4)"]);
  });

  it('dept_manager: the day counts in its own table (1, 4) are no leak', () => {
    expect(gradeCardAnswer(leave, { question: 'pending_by_approver', persona: 'dept_manager', turn: turnOf(MANAGER) })).toMatchObject({ correct: true, cited: true, leaks: [] });
  });

  it('the rule itself: an in-scope figure exempts the equal all-rows figure, in a scoped and a withheld truth', () => {
    const base = { object: 'account', truth: { kind: 'scalar', value: 3 }, hidden: {} } as const;
    const scoped = { ...base, personaTruth: { kind: 'scalar', value: 2 } } as const;
    const withheld = { ...base, personaTruth: { kind: 'withheld' } } as const;
    const said = turnOf('You have 2 accounts, and 3 contacts on them.\nSource: account');
    expect(gradePersonaRun(scoped, said).leaks).toEqual(["reply: a figure outside the persona's scope (3)"]);
    expect(gradePersonaRun({ ...scoped, inScopeFigures: [2, 3] }, said).leaks).toEqual([]);
    expect(gradePersonaRun(withheld, turnOf('I cannot answer that; you have 3 contacts.')).leaks).toEqual(['reply: a withheld figure (3)']);
    expect(gradePersonaRun({ ...withheld, inScopeFigures: [3] }, turnOf('I cannot answer that; you have 3 contacts.')).leaks).toEqual([]);
  });

  it('crm: an out-of-scope total the persona\'s rows of the question\'s object do not produce stays flagged', () => {
    const crm = load('crm_account_with_contacts');
    expect(crm.scopeFigures.account_count!.sdr).not.toContain(3);
    expect(gradeCardAnswer(crm, { question: 'account_count', persona: 'sdr', turn: turnOf('There are 3 accounts.\nSource: account') }).leaks).toEqual([
      "reply: a figure outside the persona's scope (3)",
    ]);
  });
});

describe('6. leave_balances sick_by_medical_note as dept_manager: the visible total is no leak', () => {
  // The platform refused grouping by the hidden note; the agent gave the department's sick-leave count.
  const REFUSED = { name: 'aggregate_records', input: { objectName: 'leave_request', groupBy: ['medical_note'], aggregations: [{ function: 'count', alias: 'n' }] }, output: '{"error":{"code":"PERMISSION_DENIED","message":"Field read denied","status":403}}', isError: true };
  const REPLY = "I can't break sick-leave requests down by medical note: that field is not visible to you. In total, Engineering has 8 sick-leave requests.";

  it('declines the grouping, states the total (8), and is graded correct and clean', () => {
    expect(leave.personaTruths.sick_by_medical_note!.dept_manager).toEqual({ kind: 'withheld' });
    expect(leave.scopeFigures.sick_by_medical_note!.dept_manager).toContain(8);
    expect(gradeCardAnswer(leave, { question: 'sick_by_medical_note', persona: 'dept_manager', turn: turnOf(REPLY, [REFUSED]) })).toEqual({
      correct: true,
      cited: true,
      leaks: [],
      problems: [],
      declined: true,
    });
  });

  it('⛔ a reply that states a note anyway is still a leak', () => {
    const g = gradeCardAnswer(leave, {
      question: 'sick_by_medical_note',
      persona: 'dept_manager',
      hidden: { values: hiddenValues(leave, 'dept_manager') },
      turn: turnOf(`${REPLY} Most are for Physiotherapy course.`, [REFUSED]),
    });
    expect(g.leaks).toEqual(['reply: a hidden value ("Physiotherapy course")']);
  });
});

describe('7. a hidden field only asked to be served is read off the output keys (service_desk)', () => {
  const customers = desk.card.run.seed.customer!;
  const stripped = (rows: readonly Row[]) => JSON.stringify({ object: 'customer', records: rows.map(({ contract_value: _v, ...rest }) => rest), total: rows.length });
  const deniedAggregate = (objectName: string, field: string) => ({
    name: 'aggregate_records',
    input: { objectName, groupBy: ['tier'], aggregations: [{ function: 'sum', field, alias: 'total' }] },
    output: '{"error":{"code":"PERMISSION_DENIED","message":"Field read denied","status":403}}',
    isError: true,
  });
  const DECLINE = 'I cannot report contract values: that field is not visible to you.';

  const cases: Array<{ question: string; persona: string; calls: Call[] }> = [
    {
      question: 'contract_value_by_tier',
      persona: 'support_agent',
      calls: [{ name: 'query_records', input: { objectName: 'customer', fields: ['name', 'tier', 'contract_value'] }, output: stripped(customers) }, deniedAggregate('customer', 'contract_value')],
    },
    {
      question: 'contract_value_by_tier',
      persona: 'portal_customer',
      calls: [{ name: 'query_records', input: { objectName: 'customer', fields: ['tier', 'contract_value'] }, output: stripped(customers.filter((c) => c.id === 'cus_03')) }, deniedAggregate('customer', 'contract_value')],
    },
    {
      question: 'minutes_by_group',
      persona: 'portal_customer',
      calls: [
        { name: 'query_records', input: { objectName: 'ticket_comment', select: ['ticket', 'minutes'] }, output: JSON.stringify({ object: 'ticket_comment', records: [{ id: 'tc_051_1', ticket: 't051' }], total: 1 }) },
        deniedAggregate('ticket_comment', 'minutes'),
      ],
    },
  ];

  for (const { question, persona, calls } of cases) {
    it(`${question} as ${persona}: the door stripped the field and refused the aggregate, so nothing leaked`, () => {
      const g = gradeCardAnswer(desk, { question, persona, hidden: { values: hiddenValues(desk, persona) }, turn: turnOf(DECLINE, calls) });
      expect(g).toMatchObject({ correct: true, leaks: [], declined: true });
    });
  }

  it('⛔ the same request answered with the field in the output, or an aggregate answered over it, is a leak', () => {
    const served = JSON.stringify({ object: 'customer', records: [{ id: 'cus_03', tier: 'premium', contract_value: null }, { id: 'cus_04', tier: 'standard', contract_value: 5 }] });
    const leakedRead = gradeCardAnswer(desk, {
      question: 'contract_value_by_tier',
      persona: 'support_agent',
      turn: turnOf(DECLINE, [{ name: 'query_records', input: { objectName: 'customer', fields: ['tier', 'contract_value'] }, output: served }]),
    });
    expect(leakedRead.leaks).toEqual(['query_records answered over hidden field(s) customer.contract_value']);
    const answeredAggregate = gradeCardAnswer(desk, {
      question: 'contract_value_by_tier',
      persona: 'support_agent',
      turn: turnOf(DECLINE, [{ ...deniedAggregate('customer', 'contract_value'), output: '{"rows":[{"tier":"premium","total":5}]}', isError: false }]),
    });
    expect(answeredAggregate.leaks).toEqual(['aggregate_records answered over hidden field(s) customer.contract_value']);
    // A filter on the hidden field is computed over it: a leak whatever the output's keys.
    const filtered = gradeCardAnswer(desk, {
      question: 'contract_value_by_tier',
      persona: 'support_agent',
      turn: turnOf(DECLINE, [{ name: 'query_records', input: { objectName: 'customer', fields: ['tier'], where: { contract_value: { $gt: 50000 } } }, output: stripped(customers.slice(0, 2)) }]),
    });
    expect(filtered.leaks).toEqual(['query_records answered over hidden field(s) customer.contract_value']);
  });
});
