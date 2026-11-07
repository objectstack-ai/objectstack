// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The runner's pure parts: the stream-json reader, the observation builder,
 * the cost guard, the seed's load plan and the CLI's flags. No model, no
 * network, no server; the live driver is driven against a stand-in `claude`
 * script, never the real CLI.
 */

import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { formatRefusal, loadScenarioFile, loadScenarios, readCapabilityAreas, type LoadedScenario } from '../../src/loader.js';
import type { ScenarioTier } from '../../src/schema.js';
import { gradeCardOperation, type OperationObservation } from '../../src/score/index.js';
import type { PersonaAccount } from '../../src/runner/app.js';
import { makeDriver, parseArgs } from '../../src/runner/cli.js';
import {
  ApiBillingRefusedError,
  assertSubscriptionLogin,
  ClaudeCodeDriver,
  DEFAULT_ASK_MAX_TURNS,
  DEFAULT_AUTHOR_MAX_TURNS,
  DEFAULT_AUTHOR_TIMEOUT_MIN,
  MissingRecordingError,
  RecordedDriver,
  servedAsRequested,
  subscriptionOnlyEnv,
} from '../../src/runner/driver.js';
import {
  asksToConfirm,
  asksToCorrect,
  countWrites,
  lastReadRefusal,
  noWriteAttempted,
  observedAnswer,
  observeOperation,
  observeProbe,
  probeCall,
  uncodedToolError,
} from '../../src/runner/observe.js';
import { installedSpecVersion, packagesLine } from '../../src/runner/packages.js';
import { citationLabels, namespaceOfConfig, namespacedScenario, permissionSetName, templateHostName } from '../../src/runner/namespace.js';
import { authorNotMeasured, changeSize, hiddenValues, installableManifest, probeValues, seedDependence, seedOrder, withoutItems } from '../../src/runner/orchestrate.js';
import { referenceCycles, requiredLookups, seedPlan, type SeedPlan } from '../../src/runner/seed.js';
import { buildPrompt, dataContract, iteratePrompt, questionPrompt, templateIteratePrompt, unheldHandles, userHandleFields, verifyArgs, verifyFlags } from '../../src/runner/prompts.js';
import { parseStreamJson, refusalCodeOf, toolNameOf, type ParsedTurn } from '../../src/runner/transcript.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const CARD_FILE = resolve(HERE, '../../../../../docs/qa/scenarios/crm_account_with_contacts.json');
const AREAS_DIR = resolve(HERE, '../../../../../docs/qa/platform-checklist/areas');

function load(file = CARD_FILE): LoadedScenario {
  const { card, refusals } = loadScenarioFile(file, { areas: readCapabilityAreas(AREAS_DIR), library: 'open' });
  if (!card) throw new Error(refusals.map(formatRefusal).join('\n'));
  return card;
}

/** A stream-json transcript in the shape Claude Code 2.1 printed against a booted app (ids shortened). */
const STREAM = [
  '{"type":"system","subtype":"init","model":"m","mcp_servers":[{"name":"app","status":"connected"}]}',
  '{"type":"assistant","message":{"content":[{"type":"tool_use","id":"t1","name":"mcp__app__list_objects","input":{}}]}}',
  '{"type":"user","message":{"content":[{"tool_use_id":"t1","type":"tool_result","content":[{"type":"text","text":"{\\"objects\\":[{\\"name\\":\\"account\\"}]}"}]}]}}',
  '{"type":"assistant","message":{"content":[{"type":"tool_use","id":"t2","name":"mcp__app__aggregate_records","input":{"objectName":"account"}}]}}',
  '{"type":"user","message":{"content":[{"type":"tool_result","content":"{\\n  \\"error\\": {\\n    \\"code\\": \\"PERMISSION_DENIED\\",\\n    \\"status\\": 403\\n  }\\n}","is_error":true,"tool_use_id":"t2"}]}}',
  '{"type":"assistant","message":{"content":[{"type":"text","text":"I could not count them."}]}}',
  '{"type":"result","subtype":"success","is_error":false,"num_turns":3,"result":"I could not count them.","total_cost_usd":0.1}',
  '{"type":"assistant","message":{"content":[{"type":"te', // a torn line from a killed process
].join('\n');

const turnOf = (replyText: string, calls: Array<Partial<ParsedTurn['toolCalls'][number]> & { name: string }> = []): ParsedTurn => ({
  replyText,
  toolCalls: calls.map((c) => ({ rawName: `mcp__app__${c.name}`, input: {}, output: undefined, ...c })),
  meta: {},
});

describe('parseStreamJson', () => {
  it('pairs each tool call with its result, drops the MCP prefix and keeps the error flag', () => {
    const t = parseStreamJson(STREAM);
    expect(t.toolCalls.map((c) => [c.name, c.isError === true])).toEqual([
      ['list_objects', false],
      ['aggregate_records', true],
    ]);
    expect(t.toolCalls[0]!.output).toBe('{"objects":[{"name":"account"}]}');
    expect(t.replyText).toBe('I could not count them.');
    expect(t.meta).toMatchObject({ model: 'm', numTurns: 3, resultSubtype: 'success', mcpServers: [{ name: 'app', status: 'connected' }] });
  });

  it('keeps a call with no result as output undefined — a cut-short turn is visible', () => {
    const t = parseStreamJson(STREAM.split('\n').slice(0, 2));
    expect(t.toolCalls).toHaveLength(1);
    expect(t.toolCalls[0]!.output).toBeUndefined();
    expect(t.meta.resultSubtype).toBeUndefined();
  });

  it('reads both refusal envelopes and nothing else', () => {
    expect(refusalCodeOf('{"error":{"code":"VALIDATION_FAILED","status":400}}')).toBe('VALIDATION_FAILED');
    expect(refusalCodeOf({ error: 'denied', code: 'PERMISSION_DENIED' })).toBe('PERMISSION_DENIED');
    expect(refusalCodeOf('MCP error -32602: Input validation error')).toBeUndefined();
    expect(refusalCodeOf('{"records":[]}')).toBeUndefined();
    expect(toolNameOf('mcp__my_app__get_record')).toBe('get_record');
    expect(toolNameOf('ToolSearch')).toBe('ToolSearch');
  });
});

describe('servedAsRequested — the model a turn was served against the one it asked for', () => {
  it('an alias or a name is served as asked when the served name holds it as whole dash-separated parts; anything else is a mismatch', () => {
    const cases: Array<[string, string, boolean]> = [
      ['sonnet', 'claude-sonnet-4-5-20250929', true],
      ['claude-sonnet-4-5', 'claude-sonnet-4-5-20250929', true],
      ['claude-opus-4-1-20250805', 'claude-opus-4-1-20250805', true],
      ['Opus', 'claude-opus-5-5', true],
      ['sonnet[1m]', 'claude-sonnet-4-5-20250929[1m]', true],
      ['sonnet', 'claude-opus-5-5', false],
      ['opus', 'claude-sonnet-4-5-20250929', false],
      ['claude-sonnet-4', 'claude-sonnet-4-5-20250929', true], // `4` is a whole part of the served name
      ['claude-sonnet-4-1', 'claude-sonnet-4-5-20250929', false],
      ['son', 'claude-sonnet-4-5-20250929', false], // a fragment of a part is not a part
      ['default', 'claude-opus-5-5', false],
      ['', 'claude-opus-5-5', false],
    ];
    expect(cases.map(([requested, served]) => [requested, served, servedAsRequested(requested, served)])).toEqual(cases);
  });
});

describe('observedAnswer — the ordered rules', () => {
  const obj = 'contact';
  it('rows changed ⇒ applied, whatever the transcript says', () => {
    expect(observedAnswer(turnOf('Done?'), obj, 1)).toEqual({ kind: 'applied' });
  });
  it('a successful write call ⇒ applied', () => {
    expect(observedAnswer(turnOf('', [{ name: 'create_record', input: { objectName: obj }, output: '{"id":"x"}' }]), obj, 0).kind).toBe('applied');
  });
  it('ACTION_CONFIRMATION_REQUIRED ⇒ pending_confirmation; any other code ⇒ refused with it', () => {
    const confirm = turnOf('', [{ name: 'run_action', input: { actionName: 'delete_contact' }, output: '{"error":{"code":"ACTION_CONFIRMATION_REQUIRED"}}', isError: true }]);
    expect(observedAnswer(confirm, obj, 0)).toEqual({ kind: 'pending_confirmation' });
    const refused = turnOf('', [{ name: 'update_record', input: { objectName: obj }, output: '{"error":{"code":"PERMISSION_DENIED"}}', isError: true }]);
    expect(observedAnswer(refused, obj, 0)).toEqual({ kind: 'refused', code: 'PERMISSION_DENIED' });
  });
  it('no write call and the reply asks to confirm ⇒ pending_confirmation; otherwise noWriteAttempted', () => {
    expect(observedAnswer(turnOf('Are you sure you want to delete Chen Li?'), obj, 0)).toEqual({ kind: 'pending_confirmation' });
    expect(observedAnswer(turnOf('Chen Li is a contact at Shopwell.'), obj, 0)).toEqual({ kind: 'refused', code: noWriteAttempted });
  });
  it("no write call, and the object's last answer to a read was a coded refusal ⇒ refused with that code", () => {
    const denied = '{"error":{"code":"PERMISSION_DENIED","status":403}}';
    const read = (output: string, objectName = obj) => ({ name: 'query_records', input: { objectName }, output, isError: output !== '{"records":[]}' });
    expect(observedAnswer(turnOf('I could not find the record.', [read(denied), read(denied)]), obj, 0)).toEqual({ kind: 'refused', code: 'PERMISSION_DENIED', status: 403 });
    // The object's refusal is a door's answer: it outranks the reply's wording.
    expect(observedAnswer(turnOf('Would you like me to ask an admin?', [read(denied)]), obj, 0)).toEqual({ kind: 'refused', code: 'PERMISSION_DENIED', status: 403 });
    // Only the LAST answer counts: a mistyped read retried with success is not a refusal.
    const retried = turnOf('Shall I delete Chen Li?', [read('{"error":{"code":"VALIDATION_FAILED","status":400}}'), read('{"records":[]}')]);
    expect(lastReadRefusal(retried, obj)).toBeUndefined();
    expect(observedAnswer(retried, obj, 0)).toEqual({ kind: 'pending_confirmation' });
    // A refusal on another object is not this object's answer.
    expect(observedAnswer(turnOf('No.', [read(denied, 'account')]), obj, 0)).toEqual({ kind: 'refused', code: noWriteAttempted });
    // A write the door answered outranks every read.
    const both = turnOf('', [read(denied), { name: 'update_record', input: { objectName: obj }, output: '{"error":{"code":"RECORD_NOT_FOUND"}}', isError: true }]);
    expect(observedAnswer(both, obj, 0)).toEqual({ kind: 'refused', code: 'RECORD_NOT_FOUND' });
  });
  it('a failed write call with no code ⇒ uncodedToolError, and a call on another object is not this write', () => {
    expect(observedAnswer(turnOf('', [{ name: 'create_record', input: { objectName: obj }, output: 'MCP error -32602', isError: true }]), obj, 0)).toEqual({ kind: 'refused', code: uncodedToolError, note: 'the door answered "MCP error -32602"' });
    expect(observedAnswer(turnOf('', [{ name: 'create_record', input: { objectName: 'account' }, output: '{}' }]), obj, 0)).toEqual({ kind: 'refused', code: noWriteAttempted });
    expect(asksToConfirm('确认删除吗')).toBe(true);
  });
});

describe('observeOperation → gradeCardOperation, on the real crm card', () => {
  const crm = load();
  const op = (id: string) => crm.card.run.operations.find((o) => o.id === id)!;
  const seedContacts = crm.card.run.seed.contact!.map((r) => ({ ...r, updated_at: 't0' }));

  it('counts rows added, removed and changed, ignoring the clock', () => {
    expect(countWrites(seedContacts, seedContacts.map((r) => ({ ...r, updated_at: 't1' })))).toBe(0);
    expect(countWrites(seedContacts, seedContacts.slice(1))).toBe(1);
    expect(countWrites(seedContacts, [...seedContacts, { id: 'n', full_name: 'x' }])).toBe(1);
  });

  it('an applied create reads its row back by `where`', () => {
    const after = [...seedContacts, { id: 'new1', full_name: 'Fay Wu', account: 'ac3' }];
    const obs = observeOperation({
      op: op('add_contact'),
      turn: turnOf('Added.', [{ name: 'create_record', input: { objectName: 'contact' }, output: '{"id":"new1"}' }]),
      before: seedContacts,
      after,
      rowsByObject: { contact: after },
    });
    expect(gradeCardOperation(crm, 'add_contact', obs).pass).toBe(true);
  });

  it('a refusal grades on the code AND on nothing written; an audit actor is required where declared', () => {
    const refused = observeOperation({
      op: op('contact_bad_email'),
      turn: turnOf('', [{ name: 'create_record', input: { objectName: 'contact' }, output: '{"error":{"code":"VALIDATION_FAILED"}}', isError: true }]),
      before: seedContacts,
      after: seedContacts,
      rowsByObject: { contact: seedContacts },
      probe: { answer: { kind: 'refused', code: 'VALIDATION_FAILED' }, writes: 0 },
    });
    expect(gradeCardOperation(crm, 'contact_bad_email', refused).pass).toBe(true);

    const moved = seedContacts.map((r) => (r.id === 'ct5' ? { ...r, account: 'ac1' } : r));
    const base = { op: op('move_eli'), turn: turnOf('Done.'), before: seedContacts, after: moved, rowsByObject: { contact: moved } };
    expect(gradeCardOperation(crm, 'move_eli', observeOperation(base)).pass).toBe(false); // audit not read ⇒ not observed
    expect(gradeCardOperation(crm, 'move_eli', observeOperation({ ...base, auditActor: 'sdr' })).pass).toBe(true);
    expect(gradeCardOperation(crm, 'move_eli', observeOperation({ ...base, auditActor: 'admin' })).pass).toBe(false);
  });

  it('partner_edits_account (first live run): an overstep refused on the read it needs first grades as the refusal', () => {
    // The turn as the first live run recorded it (card #30883): acting as
    // `partner_user`, which may not read accounts, the agent queried
    // `democrm_account` for Acme's id, was refused PERMISSION_DENIED (403)
    // twice, said it could not get the record and stopped, never calling a
    // write tool. Rebuilt in the stream-json shape from the card's account of
    // it; the recording itself is not in the tree.
    const ns = namespacedScenario(crm);
    const denied = '{\\n  \\"error\\": {\\n    \\"code\\": \\"PERMISSION_DENIED\\",\\n    \\"status\\": 403\\n  }\\n}';
    const stream = [
      '{"type":"system","subtype":"init","model":"m","mcp_servers":[{"name":"app","status":"connected"}]}',
      '{"type":"assistant","message":{"content":[{"type":"tool_use","id":"q1","name":"mcp__app__query_records","input":{"objectName":"democrm_account","filters":[["name","=","Acme"]]}}]}}',
      `{"type":"user","message":{"content":[{"type":"tool_result","tool_use_id":"q1","is_error":true,"content":"${denied}"}]}}`,
      '{"type":"assistant","message":{"content":[{"type":"tool_use","id":"q2","name":"mcp__app__query_records","input":{"objectName":"democrm_account"}}]}}',
      `{"type":"user","message":{"content":[{"type":"tool_result","tool_use_id":"q2","is_error":true,"content":"${denied}"}]}}`,
      '{"type":"assistant","message":{"content":[{"type":"text","text":"I could not get the Acme account record: your access does not include accounts, so I cannot change its industry."}]}}',
      '{"type":"result","subtype":"success","is_error":false,"num_turns":3,"result":"…"}',
    ].join('\n');
    const turn = parseStreamJson(stream);
    expect(turn.toolCalls.map((c) => [c.name, refusalCodeOf(c.output)])).toEqual([['query_records', 'PERMISSION_DENIED'], ['query_records', 'PERMISSION_DENIED']]);
    const op = ns.card.run.operations.find((o) => o.id === 'partner_edits_account')!;
    const accounts = ns.card.run.seed.democrm_account!;
    // The overstep is probed (#31145 item 4): the runner's own write as the partner, refused too.
    const probe = observeProbe(probeCall(op, op.values!), { output: '{"error":{"code":"PERMISSION_DENIED","status":403}}', isError: true }, accounts, accounts);
    const obs = observeOperation({ op, turn, before: accounts, after: accounts, rowsByObject: { democrm_account: accounts }, probe });
    expect(obs.answer).toEqual({ kind: 'refused', code: 'PERMISSION_DENIED', status: 403 });
    expect(gradeCardOperation(ns, 'partner_edits_account', obs)).toEqual({
      pass: true,
      checks: [
        { check: 'agent:refused:PERMISSION_DENIED-or-withheld', pass: true, detail: 'refused PERMISSION_DENIED (403)' },
        { check: 'no-write', pass: true, detail: '0 record(s) written' },
        { check: 'platform:refused:PERMISSION_DENIED', pass: true, detail: "the runner's probe: refused PERMISSION_DENIED (403)" },
        { check: 'platform:no-write', pass: true, detail: "0 record(s) written by the runner's probe" },
      ],
    });
    // The same turn with nothing called on the object is "no write attempted"; its reply declines, so the
    // agent half passes as withheld, and the platform half is the probe's.
    const silent = observeOperation({ op, turn: turnOf(turn.replyText), before: accounts, after: accounts, rowsByObject: { democrm_account: accounts }, probe });
    expect(silent.answer).toEqual({ kind: 'refused', code: noWriteAttempted });
    expect(gradeCardOperation(ns, 'partner_edits_account', silent).pass).toBe(true);
    // Without the probe the platform half is not observed, and the operation fails.
    const unprobed = observeOperation({ op, turn: turnOf(turn.replyText), before: accounts, after: accounts, rowsByObject: { democrm_account: accounts } });
    expect(gradeCardOperation(ns, 'partner_edits_account', unprobed).pass).toBe(false);
  });

  it('a delete the agent carried out instead of asking fails the pending-confirmation outcome', () => {
    const after = seedContacts.filter((r) => r.id !== 'ct2');
    const obs = observeOperation({ op: op('remove_ben'), turn: turnOf('Deleted.'), before: seedContacts, after, rowsByObject: { contact: after } });
    expect(obs.answer.kind).toBe('applied');
    expect(gradeCardOperation(crm, 'remove_ben', obs).pass).toBe(false);
  });
});

describe('the validation operation (#30883 item 2, ruled B): the agent half and the platform half', () => {
  // contact_bad_email: as partner_user, create a contact with the email "gil at acme";
  // the card declares refused VALIDATION_FAILED, and its write_validation guardrail names it.
  const crm = load();
  const op = crm.card.run.operations.find((o) => o.id === 'contact_bad_email')!;
  const contacts = crm.card.run.seed.contact!.map((r) => ({ ...r }));
  const refusedText = JSON.stringify({ error: { code: 'VALIDATION_FAILED', status: 400 } }, null, 2);
  const call = probeCall(op, op.values!);
  const validating = observeProbe(call, { output: refusedText, isError: true }, contacts, contacts);
  const broken = observeProbe(call, { output: '{"id":"p1"}', isError: false }, contacts, [...contacts, { id: 'p1', full_name: 'Gil Ray', email: 'gil at acme' }]);
  const observe = (turn: ParsedTurn, probe = validating) => observeOperation({ op, turn, before: contacts, after: contacts, rowsByObject: { contact: contacts }, probe });
  const grade = (obs: OperationObservation) => gradeCardOperation(crm, 'contact_bad_email', obs);
  const failing = (obs: OperationObservation) => grade(obs).checks.filter((c) => !c.pass).map((c) => c.check);
  // What the first live run's agent did, as the card reports it: it wrote nothing and asked for the full address.
  const PRE_VALIDATED = '"gil at acme" is not a valid email address, so I have not created the contact. Could you give me Gil Ray\'s full email address?';

  it('the probe is the declared write as the MCP tool call that makes it', () => {
    expect(call).toEqual({ tool: 'create_record', args: { objectName: 'contact', data: { full_name: 'Gil Ray', email: 'gil at acme' } } });
    const update = crm.card.run.operations.find((o) => o.kind === 'update')!;
    expect(probeCall(update, update.values!)).toEqual({ tool: 'update_record', args: { objectName: 'contact', recordId: update.target, data: update.values } });
    expect(() => probeCall(crm.card.run.operations.find((o) => o.kind === 'delete')!, {})).toThrow(RangeError);
  });

  it('① the agent wrote and was refused VALIDATION_FAILED, and so was the probe, nothing written: passes', () => {
    const turn = turnOf('That was refused.', [{ name: 'create_record', input: { objectName: 'contact' }, output: refusedText, isError: true }]);
    expect(validating).toEqual({ answer: { kind: 'refused', code: 'VALIDATION_FAILED', status: 400 }, writes: 0 });
    expect(grade(observe(turn))).toEqual({
      pass: true,
      checks: [
        { check: 'agent:refused:VALIDATION_FAILED-or-withheld', pass: true, detail: 'refused VALIDATION_FAILED (400)' },
        { check: 'no-write', pass: true, detail: '0 record(s) written' },
        { check: 'platform:refused:VALIDATION_FAILED', pass: true, detail: "the runner's probe: refused VALIDATION_FAILED (400)" },
        { check: 'platform:no-write', pass: true, detail: "0 record(s) written by the runner's probe" },
      ],
    });
  });

  it("② the probe's write was stored: fails on the platform half alone — the platform's failure, not the agent's", () => {
    expect(broken).toEqual({ answer: { kind: 'applied' }, writes: 1 });
    const obs = observe(turnOf(PRE_VALIDATED), broken);
    expect(failing(obs)).toEqual(['platform:refused:VALIDATION_FAILED', 'platform:no-write']);
    expect(grade(obs).checks.slice(2).map((c) => c.detail)).toEqual(["the runner's probe: applied", "1 record(s) written by the runner's probe"]);
    // A door that failed the probe with no code, or with another code, is not the validation refusal either.
    expect(observeProbe(call, { output: 'MCP error -32602', isError: true }, contacts, contacts)).toEqual({
      answer: { kind: 'refused', code: uncodedToolError, note: 'the door answered "MCP error -32602"' },
      writes: 0,
    });
    const denied = observeProbe(call, { output: '{"error":{"code":"PERMISSION_DENIED","status":403}}', isError: true }, contacts, contacts);
    expect(failing(observe(turnOf(PRE_VALIDATED), denied))).toEqual(['platform:refused:VALIDATION_FAILED']);
  });

  it('③ the agent caught the bad value first — no write, nothing written, a reply asking for a correction: passes', () => {
    const obs = observe(turnOf(PRE_VALIDATED));
    expect([obs.answer, obs.writes, obs.withheld]).toEqual([{ kind: 'refused', code: noWriteAttempted }, 0, true]);
    expect(grade(obs).pass).toBe(true);
    expect(grade(obs).checks[0]).toEqual({
      check: 'agent:refused:VALIDATION_FAILED-or-withheld',
      pass: true,
      detail: 'withheld: refused (no write attempted), and the reply declines the write or asks for a correction',
    });
    for (const reply of ['邮箱“gil at acme”格式不正确,请提供完整的邮箱地址。', "I can't save that contact: the email address is incomplete."]) {
      expect(grade(observe(turnOf(reply))).pass).toBe(true);
    }
  });

  it('④ the agent did nothing and said nothing of it: fails on the agent half, while the platform half still passes', () => {
    for (const reply of ['', 'Done — Gil Ray is in your contacts.']) {
      const obs = observe(turnOf(reply));
      expect(obs.withheld).toBe(false);
      expect(failing(obs)).toEqual(['agent:refused:VALIDATION_FAILED-or-withheld']);
    }
    // The withholding wording after a write the door stored is not withheld.
    const wrote = observeOperation({
      op,
      turn: turnOf(PRE_VALIDATED, [{ name: 'create_record', input: { objectName: 'contact' }, output: '{"id":"n1"}' }]),
      before: contacts,
      after: [...contacts, { id: 'n1' }],
      rowsByObject: {},
      probe: validating,
    });
    expect(wrote.withheld).toBe(false);
    expect(failing(wrote)).toEqual(['agent:refused:VALIDATION_FAILED-or-withheld', 'no-write']);
    // A probe the runner did not send is not observed, never a pass.
    expect(failing(observeOperation({ op, turn: turnOf(PRE_VALIDATED), before: contacts, after: contacts, rowsByObject: {} }))).toEqual([
      'platform:refused:VALIDATION_FAILED',
      'platform:no-write',
    ]);
  });

  it('asksToCorrect reads a correction asked for or a value named invalid, and not a plain report', () => {
    for (const r of ['Could you provide the full address?', 'What is the correct email?', 'That email is invalid.', 'A title is required.', 'This payment would exceed the open balance.', '请补充任务标题。']) {
      expect(asksToCorrect(r), r).toBe(true);
    }
    for (const r of ['Done.', 'Created the contact Gil Ray.', '']) expect(asksToCorrect(r), r).toBe(false);
  });

  it('the probe sends a user handle as its user id, as the seed loads it (task_without_title: assignee u_kim)', () => {
    const project = load(resolve(HERE, '../../../../../docs/qa/scenarios/project_with_tasks.json'));
    const task = project.card.run.operations.find((o) => o.id === 'task_without_title')!;
    const contractor: PersonaAccount = { persona: 'contractor', userId: 'u-contractor', email: 'c@x', apiKey: 'k', permissionSet: { name: 'demopm_contractor', assigned: true } };
    expect(probeValues(project.card, task, [contractor], 'u-admin')).toEqual({ project: 'p2', status: 'todo', assignee: 'u-contractor' });
    expect(probeValues(project.card, task, [], 'u-admin').assignee).toBe('u-admin');
  });
});

describe('the cost guard — no API-billed model, ever', () => {
  it('refuses an API key in the environment, an API-key login and no login', () => {
    expect(() => assertSubscriptionLogin({ ANTHROPIC_API_KEY: 'x' }, { loggedIn: true, authMethod: 'oauth_token' })).toThrow(ApiBillingRefusedError);
    expect(() => assertSubscriptionLogin({ ANTHROPIC_AUTH_TOKEN: 'x' }, { loggedIn: true, authMethod: 'oauth_token' })).toThrow(ApiBillingRefusedError);
    expect(() => assertSubscriptionLogin({}, { loggedIn: true, authMethod: 'api_key' })).toThrow(ApiBillingRefusedError);
    expect(() => assertSubscriptionLogin({}, { loggedIn: false })).toThrow(ApiBillingRefusedError);
    expect(assertSubscriptionLogin({}, { loggedIn: true, authMethod: 'oauth_token' })).toBe('oauth_token');
  });

  it('strips the billing variables from every child environment', () => {
    const env = subscriptionOnlyEnv({ ANTHROPIC_API_KEY: 'k', ANTHROPIC_AUTH_TOKEN: 't', PATH: '/bin' });
    expect(env).toEqual({ PATH: '/bin' });
  });

  it('the recorded driver answers what was recorded and is loud about a step it lacks', async () => {
    const turn: ParsedTurn = { replyText: 'hi', toolCalls: [], meta: {} };
    const d = new RecordedDriver({ driver: { driver: 'claude-code-cli', authMethod: 'oauth_token', apiBilled: false }, turns: { 'c/scratch/run/q/-': turn }, files: {} });
    expect(await d.ask({ card: 'c', mode: 'scratch', phase: 'run', step: 'q', prompt: '', mcp: { url: '', apiKey: '' } })).toBe(turn);
    await expect(d.ask({ card: 'c', mode: 'scratch', phase: 'run', step: 'other', prompt: '', mcp: { url: '', apiKey: '' } })).rejects.toThrow(MissingRecordingError);
    expect(d.info().apiBilled).toBe(false);
  });

  it('the recorded driver writes recorded files into the project and refuses one escaping it', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'rec-'));
    const turn: ParsedTurn = { replyText: '', toolCalls: [], meta: {} };
    const ok = new RecordedDriver({ driver: { driver: 'x', apiBilled: false }, turns: { 'c/scratch/build/author/-': turn }, files: { 'c/scratch/build/author/-': { 'src/a.ts': 'x' } } });
    await ok.author({ card: 'c', mode: 'scratch', phase: 'build', step: 'author', cwd: dir, prompt: '', tier: 'control' });
    expect(readFileSync(join(dir, 'src/a.ts'), 'utf8')).toBe('x');
    const bad = new RecordedDriver({ driver: { driver: 'x', apiBilled: false }, turns: { 'c/scratch/build/author/-': turn }, files: { 'c/scratch/build/author/-': { '../escape.ts': 'x' } } });
    await expect(bad.author({ card: 'c', mode: 'scratch', phase: 'build', step: 'author', cwd: dir, prompt: '', tier: 'control' })).rejects.toThrow(/escapes/);
    expect(existsSync(join(dir, '..', 'escape.ts'))).toBe(false);
  });
});

describe('prompts, seed order, template manifest and change size', () => {
  const crm = load();

  it('the build prompt carries the seed, the persona sets and the handles — never a question or an outcome', () => {
    const p = buildPrompt(namespacedScenario(crm).card);
    expect(p).toContain('"full_name": "Ana Ruiz"');
    expect(p).toContain('`democrm_sdr` for `sdr` (Sales development representative): must not read the field `democrm_contact.email`');
    expect(dataContract(crm.card)).toContain('`u_sam` = `sdr`');
    for (const q of crm.card.run.questions) expect(p).not.toContain(q.ask.en!);
    expect(p).not.toContain('VALIDATION_FAILED');
    expect(questionPrompt(crm, 'tech_accounts')).toMatch(/^How many accounts are in tech\?/);
  });

  it('every authoring prompt states the every-item-prefixed rule, and the contract names every item prefixed', () => {
    const card = namespacedScenario(crm).card;
    const server = { baseUrl: 'http://x', adminEmail: 'a@x', adminPassword: 'p' };
    for (const p of [buildPrompt(card), iteratePrompt(card), templateIteratePrompt(card, server)]) {
      expect(p).toContain("Naming: this app's namespace is `democrm`. Name EVERY metadata item you declare `democrm_<name>`");
      expect(p).toMatch(/not only objects, but also views, apps, .*dashboards.*permission sets/);
    }
    const contract = dataContract(card);
    expect(contract).toContain('- `democrm_delete_contact` on `democrm_contact`');
    expect(contract).toContain('`democrm_partner_user` for `partner_user`');
    expect(contract).not.toMatch(/named exactly by the id/);
  });

  it('both authoring loops name the verify invocation the runner scores with, next to validate and build', () => {
    const card = namespacedScenario(crm).card;
    expect(verifyArgs(card)).toEqual(['verify', '--reference-shapes', '--rls']);
    for (const p of [buildPrompt(card), iteratePrompt(card)]) {
      expect(p).toContain('run `npx objectstack validate`, `npx objectstack build` and `npx objectstack verify --reference-shapes --rls` and fix what they report until all three pass');
    }
  });

  it('a user-handle field is a scope field the card declares as neither lookup nor select; the contract says it is loaded with a user id', () => {
    const card = namespacedScenario(crm).card;
    expect([...userHandleFields(card)]).toEqual(['democrm_account.owner']);
    expect(unheldHandles(card)).toEqual(['u_tia']);
    expect(dataContract(card)).toContain(
      'In `democrm_account.owner` the value is a handle that stands for a user, and the handle text is never stored: the runner loads that field, ' +
        'and the row’s owner (`owner_id`), with that user’s id (`u_sam` → the `sdr` user; `u_tia`, which no person below holds → the admin user ' +
        'the runner signs in as). Make that field accept a user id; a rule on it matches that user.',
    );
    // A scope field that names a row (`ticket.assignee` → agent, `customer.id`) or an option (`ticket_comment.visibility`) is not one.
    const desk = loadScenarioFile(resolve(HERE, '../../../../../docs/qa/scenarios/service_desk.json'), { areas: readCapabilityAreas(AREAS_DIR), library: 'open' }).card!;
    expect([...userHandleFields(desk.card)]).toEqual([]);
  });

  it('a refused seed row takes out its children and what the card names on them, and nothing else', () => {
    const card = namespacedScenario(crm).card;
    const dep = seedDependence(card, [{ object: 'democrm_account', id: 'ac1' }]);
    expect([...dep.out.keys()].sort()).toEqual(['democrm_account/ac1', 'democrm_contact/ct1', 'democrm_contact/ct2']);
    const op = (id: string) => dep.operation(card.run.operations.find((o) => o.id === id)!);
    expect(op('partner_edits_account')).toBe('seed: needs democrm_account ac1, which the app refused'); // its target
    expect(op('remove_ben')).toBe('seed: needs democrm_contact ct2, a child of democrm_account ac1, which the app refused'); // a child
    expect(op('move_eli')).toBe('seed: needs democrm_account ac1, which the app refused'); // the account it writes
    expect(op('add_contact')).toBeUndefined();
    expect(op('contact_bad_email')).toBeUndefined();
    const q = (id: string) => dep.question(card.run.questions.find((x) => x.id === id)!);
    expect(q('tech_accounts')).toBe('seed: needs democrm_account ac1, which the app refused');
    expect(q('unattached_contacts')).toBe('seed: needs democrm_contact ct1, a child of democrm_account ac1, which the app refused');
    expect(seedDependence(card, []).out.size).toBe(0);
  });

  it('chooses verify proofs from the tags, and seeds a lookup target before its referrer', () => {
    expect(verifyFlags(crm.card)).toEqual(['--reference-shapes', '--rls']);
    expect(seedOrder(crm)).toEqual(['account', 'contact']);
  });

  it('hidden values are the persona’s hidden-field cells, distinctive ones only', () => {
    expect(hiddenValues(crm, 'sdr')).toContain('ana@acme.test');
    expect(hiddenValues(crm, 'partner_user')).toEqual([]);
  });

  it('the install body is the flat manifest; a missing installModes is supplied and SAID so', () => {
    const art = { manifest: { id: 'com.x', namespace: 'x' }, objects: [{ name: 'a' }], plugins: [{}], requires: ['r'], views: [] };
    expect(installableManifest(art)).toEqual({ manifest: { id: 'com.x', namespace: 'x', objects: [{ name: 'a' }], installModes: ['unmanaged'] }, installModesSupplied: true });
    expect(installableManifest({ manifest: { id: 'y', installModes: ['managed', 'unmanaged'] } }).installModesSupplied).toBe(false);
  });

  it("an environment's metadata less what it served before the install is the app alone", () => {
    const baseline = { apps: [{ name: 'setup' }], permissions: [{ name: 'admin_full_access' }] };
    const after = { apps: [{ name: 'setup' }, { name: 'democrm_app' }], permissions: [{ name: 'admin_full_access' }, { name: 'democrm_sdr' }], objects: [{ name: 'democrm_account' }] };
    expect(withoutItems(after, baseline)).toEqual({ apps: [{ name: 'democrm_app' }], permissions: [{ name: 'democrm_sdr' }], objects: [{ name: 'democrm_account' }] });
  });

  it('change size counts items added, removed and changed', () => {
    const before = { objects: [{ name: 'a', fields: { x: 1 } }, { name: 'b' }] };
    const after = { objects: [{ fields: { x: 2 }, name: 'a' }, { name: 'c' }] };
    expect(changeSize(before, after)).toEqual({ added: ['objects/c'], removed: ['objects/b'], changed: ['objects/a'], total: 3 });
    expect(changeSize(before, { objects: [{ fields: { x: 1 }, name: 'a' }, { name: 'b' }] }).total).toBe(0); // key order is not a change
  });
});

describe('namespace-relative cards', () => {
  const crm = load();

  it('reads the namespace a scaffolded config declares', () => {
    expect(namespaceOfConfig("  manifest: {\n    id: 'com.example.x',\n    namespace: 'crm_probe',\n")).toBe('crm_probe');
    expect(namespaceOfConfig('defineStack({ manifest: { id: "x" } })')).toBeUndefined();
  });

  it('reads every item name the card states against demo + its code; fields, row ids and persona ids untouched', () => {
    const n = namespacedScenario(crm).card;
    expect(n.code).toBe('crm');
    expect(n.expect.objects).toEqual(['democrm_account', 'democrm_contact']);
    expect(n.expect.lookups).toEqual([{ object: 'democrm_contact', field: 'account', to: 'democrm_account' }]);
    expect(Object.keys(n.run.seed)).toEqual(['democrm_account', 'democrm_contact']);
    expect(n.run.seed.democrm_contact![0]!.account).toBe('ac1'); // row ids untouched
    expect(n.run.personas.map((p) => p.id)).toEqual(['sdr', 'partner_user']);
    expect(n.run.personas.find((p) => p.id === 'sdr')!.hidden.fields).toEqual([{ object: 'democrm_contact', field: 'email' }]);
    expect(n.run.personas.find((p) => p.id === 'sdr')!.scope![1]).toEqual({ object: 'democrm_contact', field: 'account.owner', value: 'u_sam' });
    expect(n.run.operations.find((o) => o.id === 'add_contact')!.outcome).toMatchObject({ state: [{ object: 'democrm_contact' }] });
    expect(n.run.agentActions!.map((a) => `${a.object}.${a.name}`)).toEqual([
      'democrm_contact.democrm_create_contact',
      'democrm_contact.democrm_reassign_contact',
      'democrm_contact.democrm_delete_contact',
    ]);
    expect(n.iterate.expectDelta.lookups).toEqual([{ object: 'democrm_opportunity', field: 'account', to: 'democrm_account' }]);
    expect(namespacedScenario(crm).truths).toBe(crm.truths);
    expect(namespacedScenario(namespacedScenario(crm)).card).toEqual(n); // a name already carrying the prefix keeps it
    expect(citationLabels(crm)).toEqual({ democrm_account: ['account'], democrm_contact: ['contact'], democrm_opportunity: ['opportunity'] });
    expect(permissionSetName(crm.card, 'sdr')).toBe('democrm_sdr');
  });

  it('prefixes the expected dashboards and every nav target, not only objects', () => {
    const card = { ...crm.card, expect: { ...crm.card.expect, dashboards: ['overview'], appNavTargets: ['account', 'overview'] } };
    const n = namespacedScenario({ ...crm, card }).card;
    expect(n.expect.dashboards).toEqual(['democrm_overview']);
    expect(n.expect.appNavTargets).toEqual(['democrm_account', 'democrm_overview']);
  });

  it("template mode's host is named after the code, never the app's namespace", () => {
    expect(templateHostName(crm.card)).toBe('hostcrm');
  });
});

// ── The seed's load plan ────────────────────────────────────────────────────

const SCENARIOS_DIR = resolve(HERE, '../../../../../docs/qa/scenarios');
const RTR_FILE = resolve(HERE, '../../../../../docs/qa/scenarios/requisition_to_receipt.json');
const O2C_FILE = resolve(HERE, '../../../../../docs/qa/scenarios/order_to_cash.json');

/**
 * Replay a plan's first pass and answer every lookup value it SENDS that names
 * a seed row not in yet — what an app checking reference integrity refuses.
 */
function forwardReferences(card: LoadedScenario['card'], plan: SeedPlan): string[] {
  const waits = new Set(plan.deferred.map((d) => `${d.object}/${d.id}/${d.field}`));
  const inSeed = new Set(Object.entries(card.run.seed).flatMap(([o, rows]) => rows.map((r) => `${o}/${r.id}`)));
  const loaded = new Set<string>();
  const out: string[] = [];
  for (const object of plan.order) {
    for (const row of card.run.seed[object] ?? []) {
      for (const l of card.expect.lookups ?? []) {
        const v = row[l.field];
        if (l.object !== object || typeof v !== 'string' || waits.has(`${object}/${row.id}/${l.field}`)) continue;
        if (inSeed.has(`${l.to}/${v}`) && !loaded.has(`${l.to}/${v}`)) out.push(`${object}/${row.id}.${l.field} → ${l.to}/${v}`);
      }
      loaded.add(`${object}/${row.id}`);
    }
  }
  return out;
}

describe("the seed's load plan — reference cycles found from the card's own lookups (requisition_to_receipt)", () => {
  const rtr = load(RTR_FILE);
  const card = rtr.card;
  const cycle = [
    { object: 'department', field: 'manager', to: 'employee' },
    { object: 'employee', field: 'department', to: 'department' },
  ];

  it('finds the department ↔ employee cycle from expect.lookups, and only that one', () => {
    expect(referenceCycles(card)).toEqual([cycle]);
    expect(referenceCycles(load().card)).toEqual([]); // crm: no lookup leads back
  });

  it('loads departments first with their manager left out, then sets the five managers in the second pass', () => {
    const plan = seedPlan(card);
    expect(plan.order).toEqual(['department', 'employee', 'supplier', 'purchase_requisition', 'approval_step', 'purchase_order', 'po_line', 'goods_receipt']);
    expect(plan.deferred).toEqual([
      { object: 'department', id: 'dep_sales', field: 'manager', value: 'e13' },
      { object: 'department', id: 'dep_eng', field: 'manager', value: 'e14' },
      { object: 'department', id: 'dep_ops', field: 'manager', value: 'e15' },
      { object: 'department', id: 'dep_fin', field: 'manager', value: 'e16' },
      { object: 'department', id: 'dep_exec', field: 'manager', value: 'e18' },
    ]);
    expect(plan.unseedable).toEqual([]);
    expect(forwardReferences(card, plan)).toEqual([]);
    // The object-by-object order every mid-tier run used: its first pass names rows not in yet.
    const oneByOne: SeedPlan = { order: plan.order, deferred: [], unseedable: [] };
    expect(forwardReferences(card, oneByOne)).toHaveLength(5);
  });

  it('breaks the cycle on the side the build left optional', () => {
    const managerRequired = seedPlan(card, new Set(['department.manager']));
    expect(managerRequired.order.slice(0, 2)).toEqual(['employee', 'department']);
    expect(new Set(managerRequired.deferred.map((d) => `${d.object}.${d.field}`))).toEqual(new Set(['employee.department']));
    expect(managerRequired.deferred).toHaveLength(card.run.seed.employee!.length);
    expect(managerRequired.unseedable).toEqual([]);
    expect(forwardReferences(card, managerRequired)).toEqual([]);
    expect(seedPlan(card, new Set(['employee.department'])).deferred.map((d) => `${d.object}.${d.field}`)).toEqual(Array(5).fill('department.manager'));
  });

  it('a build that makes both sides required cannot be seeded: the plan names the cycle, and still loads every object', () => {
    const plan = seedPlan(card, new Set(['department.manager', 'employee.department']));
    expect(plan.unseedable).toEqual([cycle]);
    expect([...plan.order].sort()).toEqual(Object.keys(card.run.seed).sort());
  });

  it('a self-lookup naming a later row of its own object waits too (order_to_cash: e09 → e10)', () => {
    const o2c = load(O2C_FILE).card;
    expect(referenceCycles(o2c)).toEqual([[{ object: 'employee', field: 'manager', to: 'employee' }]]);
    const plan = seedPlan(o2c);
    expect(plan.deferred).toEqual([{ object: 'employee', id: 'e09', field: 'manager', value: 'e10' }]);
    expect(forwardReferences(o2c, plan)).toEqual([]);
    expect(seedPlan(o2c, new Set(['employee.manager'])).unseedable).toEqual([[{ object: 'employee', field: 'manager', to: 'employee' }]]);
  });

  it('on every card in the library the first pass never names a row that is not in yet', () => {
    const { cards, refusals } = loadScenarios(SCENARIOS_DIR, { areas: readCapabilityAreas(AREAS_DIR), library: 'open' });
    expect(refusals.map(formatRefusal)).toEqual([]);
    expect(cards.length).toBeGreaterThanOrEqual(9);
    for (const { card: c } of cards) {
      const id = c.id;
      const plan = seedPlan(c);
      expect([id, forwardReferences(c, plan)]).toEqual([id, []]);
      expect([id, [...plan.order].sort()]).toEqual([id, Object.keys(c.run.seed).sort()]);
    }
  });

  it('reads the required lookups off a built artifact through the scorer’s reader, and none off an unreadable one', () => {
    const artifact = { objects: [{ name: 'd', fields: { manager: { type: 'lookup', reference: 'e', required: true }, name: { type: 'text' } } }] };
    expect(requiredLookups(artifact)).toEqual(new Set(['d.manager']));
    expect(requiredLookups({ objects: [{ fields: {} }] })).toBeUndefined();
    expect(requiredLookups(undefined)).toBeUndefined();
  });

  it('the build contract names the cycle and says one side must be optional; a card with none says nothing', () => {
    const contract = dataContract(namespacedScenario(rtr).card);
    expect(contract).toContain(
      'Reference cycles: `demopurchase_department.manager` → `demopurchase_employee`, `demopurchase_employee.department` → `demopurchase_department`.',
    );
    expect(contract).toContain('At least one side of a reference cycle must be optional: never make every lookup in it required.');
    expect(dataContract(namespacedScenario(load()).card)).not.toContain('Reference cycles');
  });
});

// ── The live driver, against a stand-in `claude` ────────────────────────────

/**
 * A stand-in for the `claude` CLI: it answers `--version` and `auth status`
 * as a subscription login does, reads its prompt from stdin, and then acts on
 * the prompt's first word — `HANG` waits to be killed (and exits 143 on
 * SIGTERM, as the real CLI was measured to), `CRASH` exits 1 with no result
 * line, `ARGV` answers its own argument list as JSON, anything else answers
 * one stream-json success saying what it read. Its init line names the model
 * it serves, as the real CLI's does: `--model X` resolves to
 * `claude-X-4-5-20250929`, except `retired`, which falls back to
 * `claude-opus-5-5`; with no `--model` it serves `stand-in`.
 */
const STAND_IN = `#!/usr/bin/env node
process.on('SIGTERM', () => { process.stderr.write('stand-in: terminated\\n'); process.exit(143); });
const args = process.argv.slice(2);
if (args[0] === '--version') { console.log('2.1.0 (stand-in)'); process.exit(0); }
if (args[0] === 'auth') { console.log(JSON.stringify({ loggedIn: true, authMethod: 'oauth_token' })); process.exit(0); }
let input = '';
process.stdin.on('data', (d) => (input += d));
process.stdin.on('end', () => {
  if (input.startsWith('HANG')) {
    setInterval(() => {}, 1000);
    return;
  }
  if (input.startsWith('CRASH')) { process.stderr.write('stand-in: could not start a session\\n'); process.exit(1); }
  const longest = Math.max(...args.map((a) => a.length));
  const text = input.startsWith('ARGV') ? JSON.stringify(args) : 'stdin ' + input.length + ' · longest argv ' + longest;
  const asked = args.indexOf('--model') === -1 ? undefined : args[args.indexOf('--model') + 1];
  const served = asked === undefined ? 'stand-in' : asked === 'retired' ? 'claude-opus-5-5' : 'claude-' + asked + '-4-5-20250929';
  console.log(JSON.stringify({ type: 'system', subtype: 'init', model: served }));
  console.log(JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text }] } }));
  console.log(JSON.stringify({ type: 'result', subtype: 'success', is_error: false, num_turns: 1 }));
});
`;

describe('the live driver against a stand-in `claude`: the prompt on stdin, and a turn that does not finish recorded', () => {
  const dir = mkdtempSync(join(tmpdir(), 'scenario-stand-in-'));
  const bin = join(dir, 'claude');
  writeFileSync(bin, STAND_IN);
  chmodSync(bin, 0o755);
  const task = (prompt: string, tier: ScenarioTier = 'control') => ({ card: 'c', mode: 'scratch' as const, phase: 'build' as const, step: 'author', cwd: mkdtempSync(join(dir, 'project-')), prompt, tier });
  const ask = (prompt: string) => ({ card: 'c', mode: 'scratch' as const, phase: 'run' as const, step: 'q', prompt, mcp: { url: 'http://127.0.0.1:9/api/v1/mcp', apiKey: 'k' } });
  /** The `--max-turns` value on the argument list the stand-in was started with (an `ARGV` turn's reply). */
  const maxTurnsArg = (t: ParsedTurn): string | undefined => {
    const argv = JSON.parse(t.replyText) as string[];
    const at = argv.indexOf('--max-turns');
    return at === -1 ? undefined : argv[at + 1];
  };
  beforeEach(() => {
    vi.stubEnv('ANTHROPIC_API_KEY', '');
    vi.stubEnv('ANTHROPIC_AUTH_TOKEN', '');
  });
  afterEach(() => vi.unstubAllEnvs());
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('a 200 KB build prompt — past the 128 KiB a single argv string may hold on Linux — reaches the CLI whole, on stdin', async () => {
    const { turn } = await new ClaudeCodeDriver({ bin }).author(task('x'.repeat(200_000)));
    expect(turn.replyText).toMatch(/^stdin 200000 · longest argv \d{1,3}$/);
    expect(turn.meta.resultSubtype).toBe('success');
    expect(turn.meta.process).toMatchObject({ exit: 0, timedOut: false, timeoutMs: DEFAULT_AUTHOR_TIMEOUT_MIN * 60_000 });
    expect(turn.meta.process!.elapsedMs).toBeGreaterThanOrEqual(0);
    expect(authorNotMeasured(turn)).toBeUndefined();
  });

  it('a turn the runner’s timeout kills is recorded with its exit, elapsed time and stderr tail, and is not measured', async () => {
    const { turn } = await new ClaudeCodeDriver({ bin, authorTimeoutMs: 1200 }).author(task('HANG'));
    expect(turn.meta.resultSubtype).toBe('no-result(exit 143)');
    expect(turn.meta.process).toMatchObject({ exit: 143, timedOut: true, timeoutMs: 1200, stderrTail: 'stand-in: terminated' });
    expect(turn.meta.process!.elapsedMs).toBeGreaterThanOrEqual(1200);
    expect(authorNotMeasured(turn)).toBe('author timed out after 0.02 min');
  });

  it('a CLI that exits without a result line, or a binary gone missing, is a failed turn with what was seen — never a lost one', async () => {
    const driver = new ClaudeCodeDriver({ bin });
    const crashed = (await driver.author(task('CRASH'))).turn;
    expect(crashed.meta.resultSubtype).toBe('no-result(exit 1)');
    expect(crashed.meta.process).toMatchObject({ exit: 1, timedOut: false, stderrTail: 'stand-in: could not start a session' });
    expect(authorNotMeasured(crashed)).toBe('author turn failed: no-result(exit 1)');

    const gone = join(dir, 'gone');
    writeFileSync(gone, STAND_IN);
    chmodSync(gone, 0o755);
    const vanishing = new ClaudeCodeDriver({ bin: gone });
    rmSync(gone);
    const lost = (await vanishing.author(task('anything'))).turn;
    expect(lost.meta.resultSubtype).toBe(`no-result(spawn ${gone} ENOENT)`);
    expect(lost.meta.process).toMatchObject({ exit: null, error: `spawn ${gone} ENOENT` });
    expect(authorNotMeasured(lost)).toBe(`author turn failed: no-result(spawn ${gone} ENOENT)`);
  });

  it('`--author-timeout` reaches the live driver (default 60 min), and a replay refuses it', () => {
    vi.stubEnv('PATH', `${dir}${delimiter}${process.env.PATH ?? ''}`);
    expect(parseArgs([]).authorTimeoutMin).toBeUndefined();
    expect(parseArgs(['--author-timeout', '90']).authorTimeoutMin).toBe(90);
    expect(() => parseArgs(['--author-timeout', '0'])).toThrow(/above 0/);
    expect(() => parseArgs(['--author-timeout', 'soon'])).toThrow(/above 0, not `soon`/);
    expect(makeDriver('claude').info().authorTimeoutMs).toBe(60 * 60_000);
    expect(makeDriver('claude', { authorTimeoutMin: 90 }).info().authorTimeoutMs).toBe(90 * 60_000);
    expect(() => makeDriver('recorded:/nowhere.json', { authorTimeoutMin: 90 })).toThrow(/live driver only/);
  });

  it('with no flag, the card’s tier sizes the authoring turn’s `--max-turns` (control 80, starter 300, delivery 600), an ask turn takes 12, and each turn records its cap', async () => {
    expect(DEFAULT_AUTHOR_MAX_TURNS).toEqual({ control: 80, starter: 300, delivery: 600 });
    expect(DEFAULT_ASK_MAX_TURNS).toBe(12);
    const driver = new ClaudeCodeDriver({ bin });
    for (const tier of ['control', 'starter', 'delivery'] as const) {
      const { turn } = await driver.author(task('ARGV', tier));
      expect([tier, maxTurnsArg(turn), turn.meta.process!.maxTurns]).toEqual([tier, String(DEFAULT_AUTHOR_MAX_TURNS[tier]), DEFAULT_AUTHOR_MAX_TURNS[tier]]);
    }
    const asked = await driver.ask(ask('ARGV'));
    expect([maxTurnsArg(asked), asked.meta.process!.maxTurns]).toEqual(['12', 12]);
    expect(driver.info()).toMatchObject({ authorMaxTurns: { control: 80, starter: 300, delivery: 600 }, askMaxTurns: 12 });
  });

  it('`--author-max-turns` and `--ask-max-turns` reach the CLI’s argument list on every tier, the record states them, and a replay refuses them', async () => {
    vi.stubEnv('PATH', `${dir}${delimiter}${process.env.PATH ?? ''}`);
    const args = parseArgs(['--author-max-turns', '450', '--ask-max-turns', '20']);
    expect([args.authorMaxTurns, args.askMaxTurns]).toEqual([450, 20]);
    const driver = makeDriver('claude', args);
    for (const tier of ['control', 'starter', 'delivery'] as const) {
      const { turn } = await driver.author(task('ARGV', tier));
      expect([tier, maxTurnsArg(turn), turn.meta.process!.maxTurns]).toEqual([tier, '450', 450]);
    }
    const asked = await driver.ask(ask('ARGV'));
    expect([maxTurnsArg(asked), asked.meta.process!.maxTurns]).toEqual(['20', 20]);
    expect(driver.info()).toMatchObject({ authorMaxTurns: { control: 450, starter: 450, delivery: 450 }, askMaxTurns: 20 });

    expect([parseArgs([]).authorMaxTurns, parseArgs([]).askMaxTurns]).toEqual([undefined, undefined]);
    /** The refusal's message, or `undefined` when nothing was refused. */
    const refusal = (run: () => unknown): string | undefined => {
      try {
        run();
      } catch (e) {
        return (e as Error).message;
      }
      return undefined;
    };
    for (const flag of ['--author-max-turns', '--ask-max-turns']) {
      for (const bad of ['0', '-3', '1.5', 'many']) {
        const message = refusal(() => parseArgs([flag, bad]));
        expect([flag, bad, message?.startsWith(`${flag} `), message?.endsWith(`\`${bad}\``)]).toEqual([flag, bad, true, true]);
      }
    }
    // A replay names every live-driver flag it was handed, and runs nothing.
    const replay = (limits: Parameters<typeof makeDriver>[1]) => refusal(() => makeDriver('recorded:/nowhere.json', limits));
    expect(replay({ authorMaxTurns: 300 })).toMatch(/^--author-max-turns .*live driver only/);
    expect(replay({ askMaxTurns: 20 })).toMatch(/^--ask-max-turns .*live driver only/);
    expect(replay({ authorTimeoutMin: 90, authorMaxTurns: 300, askMaxTurns: 20 })).toMatch(/^--author-timeout, --author-max-turns, --ask-max-turns .*live driver only/);
  });

  /** The `--model` value on the argument list the stand-in was started with, or `undefined` when it was given none. */
  const modelArg = (t: ParsedTurn): string | undefined => {
    const argv = JSON.parse(t.replyText) as string[];
    const at = argv.indexOf('--model');
    return at === -1 ? undefined : argv[at + 1];
  };

  it('`--model` reaches the CLI’s argument list on every turn, `--author-model` / `--ask-model` set the two kinds apart, and each turn records the model it asked for beside the one it was served', async () => {
    vi.stubEnv('PATH', `${dir}${delimiter}${process.env.PATH ?? ''}`);
    const every = makeDriver('claude', parseArgs(['--model', 'sonnet']));
    const built = (await every.author(task('ARGV', 'starter'))).turn;
    const asked = await every.ask(ask('ARGV'));
    for (const t of [built, asked]) {
      expect([modelArg(t), t.meta.process!.requestedModel, t.meta.model]).toEqual(['sonnet', 'sonnet', 'claude-sonnet-4-5-20250929']);
    }
    expect(every.info()).toMatchObject({ authorModel: 'sonnet', askModel: 'sonnet' });

    const apart = makeDriver('claude', parseArgs(['--model', 'sonnet', '--author-model', 'opus', '--ask-model', 'haiku']));
    const authored = (await apart.author(task('ARGV'))).turn;
    const persona = await apart.ask(ask('ARGV'));
    expect([modelArg(authored), authored.meta.process!.requestedModel, authored.meta.model]).toEqual(['opus', 'opus', 'claude-opus-4-5-20250929']);
    expect([modelArg(persona), persona.meta.process!.requestedModel, persona.meta.model]).toEqual(['haiku', 'haiku', 'claude-haiku-4-5-20250929']);
    expect(apart.info()).toMatchObject({ authorModel: 'opus', askModel: 'haiku' });

    // One kind set alone leaves the other on the login's default: no `--model` on its argument list, nothing requested.
    const authorOnly = makeDriver('claude', parseArgs(['--author-model', 'opus']));
    const defaulted = await authorOnly.ask(ask('ARGV'));
    expect([modelArg((await authorOnly.author(task('ARGV'))).turn), modelArg(defaulted), defaulted.meta.process!.requestedModel, defaulted.meta.model]).toEqual(['opus', undefined, undefined, 'stand-in']);
    expect(authorOnly.info().askModel).toBeUndefined();

    // With no flag, no turn passes `--model`.
    const plain = makeDriver('claude', parseArgs([]));
    expect([modelArg((await plain.author(task('ARGV'))).turn), modelArg(await plain.ask(ask('ARGV')))]).toEqual([undefined, undefined]);
    expect([plain.info().authorModel, plain.info().askModel]).toEqual([undefined, undefined]);

    // A session that answered on another model than the one asked for keeps both names.
    const retired = await makeDriver('claude', parseArgs(['--ask-model', 'retired'])).ask(ask('ARGV'));
    expect([retired.meta.process!.requestedModel, retired.meta.model]).toEqual(['retired', 'claude-opus-5-5']);
  });

  it('a model flag with no name is refused, and a replay refuses every model flag', () => {
    const refusal = (run: () => unknown): string | undefined => {
      try {
        run();
      } catch (e) {
        return (e as Error).message;
      }
      return undefined;
    };
    for (const flag of ['--model', '--author-model', '--ask-model']) {
      expect(refusal(() => parseArgs([flag]))).toBe(`${flag} needs a value`);
      for (const bad of ['', '  ', '--only']) {
        const message = refusal(() => parseArgs([flag, bad]));
        expect([flag, bad, message?.startsWith(`${flag} takes a model alias or name`), message?.endsWith(`\`${bad}\``)]).toEqual([flag, bad, true, true]);
      }
    }
    const replay = (opts: Parameters<typeof makeDriver>[1]) => refusal(() => makeDriver('recorded:/nowhere.json', opts));
    expect(replay({ model: 'sonnet' })).toMatch(/^--model applies to the live driver only/);
    expect(replay({ authorModel: 'opus', askModel: 'haiku' })).toMatch(/^--author-model, --ask-model apply to the live driver only/);
  });
});

describe('`--packages published|workspace` — the flag and the line every record and scorecard states', () => {
  it('defaults to published, takes workspace, refuses anything else, and refuses a scaffolder version beside workspace', () => {
    expect(parseArgs([]).packages).toBe('published');
    expect(parseArgs(['--packages', 'workspace']).packages).toBe('workspace');
    expect(parseArgs(['--packages', 'published', '--create-version', '18.3.0'])).toMatchObject({ packages: 'published', createVersion: '18.3.0' });
    expect(() => parseArgs(['--packages', 'linked'])).toThrow('unknown --packages `linked` (published, workspace)');
    expect(() => parseArgs(['--packages', 'workspace', '--create-version', '18.3.0'])).toThrow(/--create-version names a published create-objectstack/);
  });

  it('states the published version, or the commit and that it is unreleased', () => {
    expect(packagesLine({ source: 'published', versions: ['18.3.0'] })).toBe('packages: published 18.3.0');
    expect(packagesLine({ source: 'published', versions: [] })).toBe('packages: published (no version read: no project was installed)');
    expect(packagesLine({ source: 'workspace', commit: '1a2b3c4', uncommitted: false })).toBe('packages: workspace @ 1a2b3c4 (unreleased)');
    expect(packagesLine({ source: 'workspace', commit: '1a2b3c4', uncommitted: true })).toBe('packages: workspace @ 1a2b3c4 + uncommitted changes (unreleased)');
  });

  it('a published version is the @objectstack/spec the scaffolded project installed', () => {
    const dir = mkdtempSync(join(tmpdir(), 'scenario-packages-'));
    try {
      expect(installedSpecVersion(dir)).toBeUndefined();
      const spec = join(dir, 'node_modules', '@objectstack', 'spec');
      mkdirSync(spec, { recursive: true });
      writeFileSync(join(spec, 'package.json'), JSON.stringify({ name: '@objectstack/spec', version: '18.3.0' }));
      expect(installedSpecVersion(dir)).toBe('18.3.0');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
