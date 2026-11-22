// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// FLOW CONDITION SCOPE KEYS — the scope a flow's conditions and value
// envelopes read is built so that no variable key can write outside the run's
// own scope object. Driven through a REAL boot: a plain member's requests on
// the public doors that hand a run its variable keys, then a process-wide read
// that must find nothing.
//
// The doors, each with its own probe name:
//   • the record that starts a record-triggered flow (`POST` / `PATCH /data`);
//   • a flow trigger's `params` bag (`POST /automation/:name/trigger`);
//   • a screen resume's `inputs` and `output` (`POST …/runs/:runId/resume`).
//
// Control: an ordinary dotted key (`<node>.<key>`, a resumed screen's output)
// still nests, and a condition after the screen still reads it.
//
// Fixtures are synthetic.

import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { bootStack, type VerifyStack } from '@objectstack/verify';
import { defineStack } from '@objectstack/spec';
import { ObjectSchema, Field } from '@objectstack/spec/data';
import type { Flow } from '@objectstack/spec/automation';
import { RecordChangeTriggerPlugin } from '@objectstack/trigger-record-change';
import { PermissionSetSchema } from '@objectstack/spec/security';
import { SecurityPlugin, securityDefaultPermissionSets } from '@objectstack/plugin-security';

const OBJ = 'fcsk_item';
const MARK = 'fcsk_mark';
const RECORD_FLOW = 'fcsk_on_item';
const PARAMS_FLOW = 'fcsk_params';
const SCREEN_FLOW = 'fcsk_screen';
const SYS = { context: { isSystem: true } } as const;

const PROBES = ['fcsk_rec_post', 'fcsk_rec_patch', 'fcsk_params', 'fcsk_resume_inputs', 'fcsk_resume_output'] as const;
type Probe = (typeof PROBES)[number];

/** What `({}).<probe>` reads, i.e. what every object in the process inherits. */
const inherited = (probe: Probe): unknown => ({} as Record<string, unknown>)[probe];

const Item = ObjectSchema.create({
  name: OBJ,
  label: 'FCSK Item',
  pluralLabel: 'FCSK Items',
  sharingModel: 'public_read_write',
  fields: { name: Field.text({ label: 'Name', required: true }) },
});

/** One row per run that got past its condition, so "the condition read it" is a stored fact. */
const Mark = ObjectSchema.create({
  name: MARK,
  label: 'FCSK Mark',
  pluralLabel: 'FCSK Marks',
  sharingModel: 'public_read_write',
  fields: { name: Field.text({ label: 'Name', required: true }) },
});

const cel = (source: string) => ({ dialect: 'cel', source });

const recordFlow: Flow = {
  name: RECORD_FLOW,
  label: 'FCSK On Item',
  type: 'autolaunched',
  status: 'active',
  nodes: [
    {
      id: 'start',
      type: 'start',
      label: 'On item written',
      config: { objectName: OBJ, triggerType: 'record-after-write', condition: "record.name != ''" },
    },
    { id: 'mark', type: 'create_record', label: 'Mark', config: { objectName: MARK, fields: { name: cel('record.name') } } },
    { id: 'end', type: 'end', label: 'End' },
  ],
  edges: [
    { id: 'e1', source: 'start', target: 'mark' },
    { id: 'e2', source: 'mark', target: 'end' },
  ],
} as Flow;

const paramsFlow: Flow = {
  name: PARAMS_FLOW,
  label: 'FCSK Params',
  type: 'autolaunched',
  status: 'active',
  variables: [{ name: 'label', type: 'text', isInput: true }],
  nodes: [
    { id: 'start', type: 'start', label: 'Start', config: { condition: "label != ''" } },
    { id: 'mark', type: 'create_record', label: 'Mark', config: { objectName: MARK, fields: { name: cel('label') } } },
    { id: 'end', type: 'end', label: 'End' },
  ],
  edges: [
    { id: 'e1', source: 'start', target: 'mark' },
    { id: 'e2', source: 'mark', target: 'end' },
  ],
} as Flow;

const screenFlow: Flow = {
  name: SCREEN_FLOW,
  label: 'FCSK Screen',
  type: 'screen',
  status: 'active',
  nodes: [
    { id: 'start', type: 'start', label: 'Start' },
    {
      id: 'ask',
      type: 'screen',
      label: 'Ask',
      config: {
        title: 'Ask',
        fields: [
          { name: 'note', label: 'Note', type: 'text', required: true },
          { name: 'detail', label: 'Detail', type: 'text', required: true, visibleWhen: "note == 'more'" },
        ],
      },
    },
    { id: 'check', type: 'decision', label: 'Check' },
    { id: 'mark', type: 'create_record', label: 'Mark', config: { objectName: MARK, fields: { name: cel('note') } } },
    { id: 'end', type: 'end', label: 'End' },
  ],
  edges: [
    { id: 'e1', source: 'start', target: 'ask' },
    { id: 'e2', source: 'ask', target: 'check' },
    { id: 'e3', source: 'check', target: 'mark', type: 'conditional', condition: "ask.tag == 'go'" },
    { id: 'e4', source: 'check', target: 'end', isDefault: true },
    { id: 'e5', source: 'mark', target: 'end' },
  ],
} as Flow;

/** A plain member's object grants: create and edit on both objects, nothing more. */
const memberSet = PermissionSetSchema.parse({
  name: 'fcsk_member',
  label: 'FCSK member',
  objects: Object.fromEntries([OBJ, MARK].map((o) => [o, { allowRead: true, allowCreate: true, allowEdit: true, allowDelete: false }])),
});

const fixtureStack = defineStack({
  manifest: {
    id: 'com.dogfood.flow-condition-scope-keys',
    namespace: 'fcsk',
    version: '0.0.0',
    type: 'app',
    name: 'Flow Condition Scope Keys Fixture',
    description: 'One record-triggered flow, one flow with an input, one screen flow.',
  },
  requires: ['automation', 'triggers'],
  objects: [Item, Mark],
  flows: [recordFlow, paramsFlow, screenFlow],
});

describe('a flow condition scope: no variable key writes outside the run scope object', () => {
  let stack: VerifyStack;
  let ql: any;
  let member: string;

  const marks = async (name: string): Promise<number> =>
    ((await ql.find(MARK, { where: { name }, ...SYS })) as unknown[]).length;

  beforeAll(async () => {
    stack = await bootStack(fixtureStack as unknown as Parameters<typeof bootStack>[0], {
      automation: true,
      security: new SecurityPlugin({
        defaultPermissionSets: [...securityDefaultPermissionSets, memberSet],
        fallbackPermissionSet: memberSet.name,
      }),
      extraPlugins: [new RecordChangeTriggerPlugin()],
    });
    member = await stack.signUp('fcsk-member@example.test');
    ql = await stack.kernel.getServiceAsync('objectql');
  }, 120_000);

  afterAll(async () => {
    await stack?.stop?.().catch(() => {});
  });

  afterEach(() => {
    for (const probe of PROBES) delete (Object.prototype as Record<string, unknown>)[probe];
  });

  it('the record that starts a record-triggered flow, created through the data door', async () => {
    const res = await stack.apiAs(member, 'POST', `/data/${OBJ}`, { name: 'fcsk-post', '__proto__.fcsk_rec_post': true });
    // Measured: the data door refuses a key that is not a field of the object.
    expect(res.status, await res.clone().text()).toBe(400);
    expect(inherited('fcsk_rec_post')).toBeUndefined();
  });

  it('the record that starts a record-triggered flow, updated through the data door', async () => {
    const row: any = await ql.insert(OBJ, { name: 'fcsk-patch-0' }, SYS);
    const res = await stack.apiAs(member, 'PATCH', `/data/${OBJ}/${row.id}`, { name: 'fcsk-patch', '__proto__.fcsk_rec_patch': true });
    expect(res.status, await res.clone().text()).toBe(400);
    expect(inherited('fcsk_rec_patch')).toBeUndefined();
  });

  it("a flow trigger's params bag", async () => {
    const res = await stack.apiAs(member, 'POST', `/automation/${PARAMS_FLOW}/trigger`, {
      params: { label: 'fcsk-params', '__proto__.fcsk_params': true },
    });
    // Measured: the run seeds only the declared input, and its condition reads it.
    expect(res.status, await res.clone().text()).toBeLessThan(300);
    expect(await marks('fcsk-params')).toBe(1);
    expect(inherited('fcsk_params')).toBeUndefined();
  });

  describe('a screen resume', () => {
    async function pause(): Promise<string> {
      const res = await stack.apiAs(member, 'POST', `/automation/${SCREEN_FLOW}/trigger`, { params: {} });
      expect(res.status, await res.clone().text()).toBeLessThan(300);
      const body = (await res.json()) as any;
      const result = body.result ?? body.data ?? body;
      expect(result.status).toBe('paused');
      return String(result.runId);
    }
    const resume = (runId: string, body: Record<string, unknown>) =>
      stack.apiAs(member, 'POST', `/automation/${SCREEN_FLOW}/runs/${runId}/resume`, body);

    it('its inputs bag, judged by a field predicate before the bag is refused', async () => {
      const runId = await pause();
      const res = await resume(runId, { inputs: { note: 'fcsk-in', '__proto__.fcsk_resume_inputs': true } });
      expect(res.status, await res.clone().text()).toBe(400);
      expect(((await res.json()) as any).error?.code).toBe('INVALID_SCREEN_INPUT');
      expect(inherited('fcsk_resume_inputs')).toBeUndefined();
    });

    it('its output bag', async () => {
      const runId = await pause();
      const res = await resume(runId, { inputs: { note: 'fcsk-out' }, output: { tag: 'go', '__proto__.fcsk_resume_output': true } });
      expect(inherited('fcsk_resume_output')).toBeUndefined();
      // The rest of the bag still nests: the condition after the screen read `ask.tag`.
      expect(res.status, await res.clone().text()).toBeLessThan(300);
      expect(await marks('fcsk-out')).toBe(1);
    });

    it('control: an ordinary dotted output key still nests, and the condition after the screen reads it', async () => {
      const runId = await pause();
      const res = await resume(runId, { inputs: { note: 'fcsk-control' }, output: { tag: 'go' } });
      expect(res.status, await res.clone().text()).toBeLessThan(300);
      expect(await marks('fcsk-control')).toBe(1);
    });
  });
});
