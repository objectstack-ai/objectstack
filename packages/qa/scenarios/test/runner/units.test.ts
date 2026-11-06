// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The runner's pure parts: the stream-json reader, the observation builder,
 * and the cost guard. No model, no network, no server.
 */

import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { formatRefusal, loadScenarioFile, readCapabilityAreas, type LoadedScenario } from '../../src/loader.js';
import { gradeCardOperation } from '../../src/score/index.js';
import {
  ApiBillingRefusedError,
  assertSubscriptionLogin,
  MissingRecordingError,
  RecordedDriver,
  subscriptionOnlyEnv,
} from '../../src/runner/driver.js';
import { asksToConfirm, countWrites, noWriteAttempted, observedAnswer, observeOperation, uncodedToolError } from '../../src/runner/observe.js';
import { citationLabels, namespaceOfConfig, namespacedScenario } from '../../src/runner/namespace.js';
import { changeSize, hiddenValues, installableManifest, seedOrder } from '../../src/runner/orchestrate.js';
import { buildPrompt, dataContract, questionPrompt, verifyFlags } from '../../src/runner/prompts.js';
import { parseStreamJson, refusalCodeOf, toolNameOf, type ParsedTurn } from '../../src/runner/transcript.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const CARD_FILE = resolve(HERE, '../../../../../docs/qa/scenarios/crm_account_with_contacts.json');
const AREAS_DIR = resolve(HERE, '../../../../../docs/qa/platform-checklist/areas');

function load(): LoadedScenario {
  const { card, refusals } = loadScenarioFile(CARD_FILE, { areas: readCapabilityAreas(AREAS_DIR) });
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
  it('a failed write call with no code ⇒ uncodedToolError, and a call on another object is not this write', () => {
    expect(observedAnswer(turnOf('', [{ name: 'create_record', input: { objectName: obj }, output: 'MCP error -32602', isError: true }]), obj, 0)).toEqual({ kind: 'refused', code: uncodedToolError });
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
    const after = [...seedContacts, { id: 'new1', full_name: 'Fay Wu', email: 'fay@bitworks.test', account: 'ac3' }];
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
    });
    expect(gradeCardOperation(crm, 'contact_bad_email', refused).pass).toBe(true);

    const moved = seedContacts.map((r) => (r.id === 'ct4' ? { ...r, account: 'ac1' } : r));
    const base = { op: op('attach_dee'), turn: turnOf('Done.'), before: seedContacts, after: moved, rowsByObject: { contact: moved } };
    expect(gradeCardOperation(crm, 'attach_dee', observeOperation(base)).pass).toBe(false); // audit not read ⇒ not observed
    expect(gradeCardOperation(crm, 'attach_dee', observeOperation({ ...base, auditActor: 'sdr' })).pass).toBe(true);
    expect(gradeCardOperation(crm, 'attach_dee', observeOperation({ ...base, auditActor: 'admin' })).pass).toBe(false);
  });

  it('a delete the agent carried out instead of asking fails the pending-confirmation outcome', () => {
    const after = seedContacts.filter((r) => r.id !== 'ct3');
    const obs = observeOperation({ op: op('remove_chen'), turn: turnOf('Deleted.'), before: seedContacts, after, rowsByObject: { contact: after } });
    expect(obs.answer.kind).toBe('applied');
    expect(gradeCardOperation(crm, 'remove_chen', obs).pass).toBe(false);
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
    await ok.author({ card: 'c', mode: 'scratch', phase: 'build', step: 'author', cwd: dir, prompt: '' });
    expect(readFileSync(join(dir, 'src/a.ts'), 'utf8')).toBe('x');
    const bad = new RecordedDriver({ driver: { driver: 'x', apiBilled: false }, turns: { 'c/scratch/build/author/-': turn }, files: { 'c/scratch/build/author/-': { '../escape.ts': 'x' } } });
    await expect(bad.author({ card: 'c', mode: 'scratch', phase: 'build', step: 'author', cwd: dir, prompt: '' })).rejects.toThrow(/escapes/);
    expect(existsSync(join(dir, '..', 'escape.ts'))).toBe(false);
  });
});

describe('prompts, seed order, template manifest and change size', () => {
  const crm = load();

  it('the build prompt carries the seed, the persona sets and the handles — never a question or an outcome', () => {
    const p = buildPrompt(crm.card);
    expect(p).toContain('"full_name": "Ana Ruiz"');
    expect(p).toContain('`sdr` (Sales development representative): must not read the field `contact.email`');
    expect(dataContract(crm.card)).toContain('`u_sam` = `sdr`');
    for (const q of crm.card.run.questions) expect(p).not.toContain(q.ask.en!);
    expect(p).not.toContain('VALIDATION_FAILED');
    expect(questionPrompt(crm, 'tech_accounts')).toMatch(/^How many accounts are in tech\?/);
  });

  it('chooses verify proofs from the tags, and seeds a lookup target before its referrer', () => {
    expect(verifyFlags(crm.card)).toEqual(['--reference-shapes']);
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

  it('prefixes every object reference and nothing else; identity without a namespace', () => {
    const n = namespacedScenario(crm, 'ns').card;
    expect(n.expect.objects).toEqual(['ns_account', 'ns_contact']);
    expect(n.expect.lookups).toEqual([{ object: 'ns_contact', field: 'account', to: 'ns_account' }]);
    expect(Object.keys(n.run.seed)).toEqual(['ns_account', 'ns_contact']);
    expect(n.run.seed.ns_contact![0]!.account).toBe('ac1'); // row ids untouched
    expect(n.run.personas.find((p) => p.id === 'sdr')!.hidden.fields).toEqual([{ object: 'ns_contact', field: 'email' }]);
    expect(n.run.personas.find((p) => p.id === 'sdr')!.scope![1]).toEqual({ object: 'ns_contact', field: 'account.owner', value: 'u_sam' });
    expect(n.run.operations.find((o) => o.id === 'add_contact')!.outcome).toMatchObject({ state: [{ object: 'ns_contact' }] });
    expect(n.iterate.expectDelta.lookups).toEqual([{ object: 'ns_opportunity', field: 'account', to: 'ns_account' }]);
    expect(namespacedScenario(crm, 'ns').truths).toBe(crm.truths);
    expect(namespacedScenario(crm, undefined)).toBe(crm);
    expect(citationLabels(crm, 'ns')).toEqual({ ns_account: ['account'], ns_contact: ['contact'], ns_opportunity: ['opportunity'] });
  });
});
