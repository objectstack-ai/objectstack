// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// A paused flow's run state carries its trigger record on the generic read
// path's terms (ADR-0100), on a real boot: the record-change trigger builds the
// flow's `record` and `previous` already masked, so a credential-class field
// reads as the mask (or `null` when unset) and an `internal: true` field is
// absent — in the persisted `sys_automation_run` row (`variables_json`,
// `context_json`), in the run read door (`GET /automation/:name/runs/:runId`),
// and in the nodes that run after the resume, in the same process and in a
// second process booted over the same database file.
//
// ## The composition
//
// `bootStack` with automation on and a FILE-backed database: the real engine,
// crypto provider, SQL driver, suspended-run store, REST layer and record-change
// trigger. One synthetic object holds an ordinary field, one `password` field,
// one `secret` field and one `internal: true` field. One flow fires on its
// update, pauses at a `screen` node, and after the resume copies what it reads
// off `record` into a second object, so what a post-pause node SEES is a stored
// fact.
//
// ## Arming
//
// The scene is real before anything is believed: a privileged engine read shows
// the plaintext password, a `secret:` handle ref and the internal value at rest,
// and the privileged `resolveSecretField` path still returns the secret's
// plaintext after the flow ran. Without that every "absent" below could be true
// because nothing was ever stored. Falsifiability: every assertion of a mask
// sits beside an ordinary field's real value read off the same root.
//
// Fixtures are synthetic.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { bootStack, type VerifyStack } from '@objectstack/verify';
import { defineStack } from '@objectstack/spec';
import { ObjectSchema, Field, SECRET_MASK } from '@objectstack/spec/data';
import type { Flow } from '@objectstack/spec/automation';
import { RecordChangeTriggerPlugin } from '@objectstack/trigger-record-change';

const OBJ = 'ftrm_vault';
const ECHO = 'ftrm_echo';
const FLOW = 'ftrm_vault_paused';
const PW = 'ftrm_password';
const TOKEN = 'ftrm_token';
const HIDDEN = 'ftrm_hidden';
const PW_VALUE = 'ftrm-plain-credential-41';
const PW_VALUE_OLD = 'ftrm-plain-credential-40';
const TOKEN_VALUE = 'ftrm-token-credential-42';
const HIDDEN_VALUE = 'ftrm-internal-value-43';
const SYS = { context: { isSystem: true } } as const;

const Vault = ObjectSchema.create({
  name: OBJ,
  label: 'FTRM Vault',
  pluralLabel: 'FTRM Vaults',
  sharingModel: 'public_read_write',
  fields: {
    name: Field.text({ label: 'Name', required: true }),
    [PW]: Field.password({ label: 'Password', ackPlaintextMasking: true }),
    [TOKEN]: Field.secret({ label: 'Token' }),
    [HIDDEN]: Field.text({ label: 'Hidden', internal: true }),
  },
});

/** What a node after the pause read off `record`, stored so it can be read back. */
const Echo = ObjectSchema.create({
  name: ECHO,
  label: 'FTRM Echo',
  pluralLabel: 'FTRM Echoes',
  sharingModel: 'public_read_write',
  fields: {
    name: Field.text({ label: 'Name', required: true }),
    seen_name: Field.text({ label: 'Seen name' }),
    seen_password: Field.text({ label: 'Seen password' }),
    seen_token: Field.text({ label: 'Seen token' }),
    seen_previous_password: Field.text({ label: 'Seen previous password' }),
  },
});

const flow: Flow = {
  name: FLOW,
  label: 'FTRM Vault Paused',
  type: 'autolaunched',
  status: 'active',
  nodes: [
    {
      id: 'start',
      type: 'start',
      label: 'On vault updated',
      config: { objectName: OBJ, triggerType: 'record-after-update' },
    },
    {
      id: 'ask',
      type: 'screen',
      label: 'Confirm',
      config: {
        title: 'Confirm',
        fields: [{ name: 'note', label: 'Note', type: 'text', required: true }],
      },
    },
    {
      id: 'echo',
      type: 'create_record',
      label: 'Echo what the record reads',
      config: {
        objectName: ECHO,
        fields: {
          name: '{note}',
          seen_name: '{record.name}',
          seen_password: `{record.${PW}}`,
          seen_token: `{record.${TOKEN}}`,
          seen_previous_password: `{previous.${PW}}`,
        },
      },
    },
    { id: 'end', type: 'end', label: 'End' },
  ],
  edges: [
    { id: 'e1', source: 'start', target: 'ask' },
    { id: 'e2', source: 'ask', target: 'echo' },
    { id: 'e3', source: 'echo', target: 'end' },
  ],
};

const fixtureStack = defineStack({
  manifest: {
    id: 'com.dogfood.flow-trigger-record-credential-mask',
    namespace: 'ftrm',
    version: '0.0.0',
    type: 'app',
    name: 'Flow Trigger Record Credential Mask Fixture',
    description: 'One credential-holding object and one record-change flow that pauses.',
  },
  // ADR-0097: the flow's record-change start node needs both capabilities.
  requires: ['automation', 'triggers'],
  objects: [Vault, Echo],
  flows: [flow],
});

type Row = Record<string, any>;

/** Every stored credential spelling no run-state surface may carry. */
const leaksIn = (body: unknown): string[] => {
  const wire = typeof body === 'string' ? body : JSON.stringify(body ?? null);
  return [PW_VALUE, PW_VALUE_OLD, TOKEN_VALUE, HIDDEN_VALUE, 'secret:'].filter((v) => wire.includes(v));
};

const boot = (dbFile: string) =>
  bootStack(fixtureStack as unknown as Parameters<typeof bootStack>[0], {
    automation: true,
    databaseFile: dbFile,
    extraPlugins: [new RecordChangeTriggerPlugin()],
  });

/** Create a vault row through the engine, then update it through REST so the flow fires and pauses. */
async function pauseOne(
  stack: VerifyStack,
  token: string,
  name: string,
): Promise<{ id: string; runId: string; stored: Row }> {
  const ql: any = await stack.kernel.getServiceAsync('objectql');
  const row: Row = await ql.insert(OBJ, { name, [PW]: PW_VALUE_OLD, [TOKEN]: TOKEN_VALUE, [HIDDEN]: HIDDEN_VALUE }, SYS);
  const id = String(row.id);
  const res = await stack.apiAs(token, 'PATCH', `/data/${OBJ}/${id}`, { name: `${name}-2`, [PW]: PW_VALUE });
  expect(res.status, await res.clone().text()).toBe(200);
  const runs: Row[] = await ql.find('sys_automation_run', {
    where: { flow_name: FLOW, status: 'paused', trigger_record_id: id },
    ...SYS,
  });
  expect(runs, 'the record-change flow did not pause into sys_automation_run').toHaveLength(1);
  // The engine's insert result keeps the stored row whole by design — the
  // arming read for the scene.
  return { id, runId: String(runs[0].id), stored: row };
}

function expectMaskedRoot(root: Row, ordinaryName: string) {
  expect(root.name).toBe(ordinaryName);
  expect(root[PW]).toBe(SECRET_MASK);
  expect(root[TOKEN]).toBe(SECRET_MASK);
  expect(HIDDEN in root).toBe(false);
}

describe('a paused record-change run carries its trigger record masked (ADR-0100)', () => {
  let dir: string;
  let stack: VerifyStack;
  let token: string;
  let ql: any;
  let id: string;
  let runId: string;
  let stored: Row;

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'os-ftrm-'));
    stack = await boot(join(dir, 'verify.sqlite'));
    token = await stack.signIn();
    ql = await stack.kernel.getServiceAsync('objectql');
    ({ id, runId, stored } = await pauseOne(stack, token, 'ftrm-a'));
  }, 120_000);

  afterAll(async () => {
    await stack?.stop?.().catch(() => {});
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it('the scene is armed: the stored row holds the plaintext password, a secret ref and the internal value', () => {
    expect(stored[PW]).toBe(PW_VALUE_OLD);
    expect(String(stored[TOKEN])).toMatch(/^secret:/);
    expect(stored[HIDDEN]).toBe(HIDDEN_VALUE);
  });

  it('the persisted variables_json and context_json carry the mask and omit the internal field', async () => {
    const [row]: Row[] = await ql.find('sys_automation_run', { where: { id: runId }, ...SYS });
    expect(row.status).toBe('paused');
    expect(leaksIn(row.variables_json)).toEqual([]);
    expect(leaksIn(row.context_json)).toEqual([]);

    const vars = JSON.parse(String(row.variables_json));
    expectMaskedRoot(vars.record, 'ftrm-a-2');
    expectMaskedRoot(vars.$record, 'ftrm-a-2');
    expectMaskedRoot(vars.previous, 'ftrm-a');

    const context = JSON.parse(String(row.context_json));
    expectMaskedRoot(context.record, 'ftrm-a-2');
    expectMaskedRoot(context.previous, 'ftrm-a');
  });

  it('the data door over sys_automation_run serves the same masked columns', async () => {
    const res = await stack.apiAs(token, 'GET', `/data/sys_automation_run/${runId}`);
    expect(res.status).toBe(200);
    const rec: Row = ((await res.json()) as any).record;
    expect(leaksIn(rec)).toEqual([]);
    expectMaskedRoot(JSON.parse(String(rec.variables_json)).record, 'ftrm-a-2');
  });

  it('GET /automation/:name/runs/:runId shows the same', async () => {
    const res = await stack.apiAs(token, 'GET', `/automation/${FLOW}/runs/${runId}`);
    expect(res.status, await res.clone().text()).toBe(200);
    const body: any = await res.json();
    expect(leaksIn(body)).toEqual([]);
    const run = body.data ?? body;
    expectMaskedRoot(run.variables.record, 'ftrm-a-2');
    expectMaskedRoot(run.variables.previous, 'ftrm-a');
  });

  it('a node after the pause reads the mask off record and previous, and an ordinary field reads its value', async () => {
    const resumed = await stack.apiAs(token, 'POST', `/automation/${FLOW}/runs/${runId}/resume`, {
      inputs: { note: 'ftrm-echo-hot' },
    });
    expect(resumed.status, await resumed.clone().text()).toBeLessThan(300);
    const [echo]: Row[] = await ql.find(ECHO, { where: { name: 'ftrm-echo-hot' }, ...SYS });
    expect(echo, 'the post-pause node never ran').toBeDefined();
    expect(echo.seen_name).toBe('ftrm-a-2');
    expect(echo.seen_password).toBe(SECRET_MASK);
    expect(echo.seen_token).toBe(SECRET_MASK);
    expect(echo.seen_previous_password).toBe(SECRET_MASK);
  });

  it('the privileged resolveSecretField path is unchanged — it still returns the plaintext', async () => {
    await expect(ql.resolveSecretField(OBJ, id, TOKEN)).resolves.toBe(TOKEN_VALUE);
  });
});

describe('a resumed record-change run reads the mask after a cold boot too', () => {
  let dir: string;
  let dbFile: string;
  let hot: VerifyStack | undefined;
  let cold: VerifyStack | undefined;
  let runId: string;

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'os-ftrm-cold-'));
    dbFile = join(dir, 'verify.sqlite');
    hot = await boot(dbFile);
    const hotToken = await hot.signIn();
    ({ runId } = await pauseOne(hot, hotToken, 'ftrm-b'));
    await hot.stop();
    hot = undefined;
    cold = await boot(dbFile);
  }, 180_000);

  afterAll(async () => {
    await hot?.stop().catch(() => {});
    await cold?.stop().catch(() => {});
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it('the rehydrated run resumes with the masked record — the post-pause node sees the mask', async () => {
    const token = await cold!.signIn();
    const resumed = await cold!.apiAs(token, 'POST', `/automation/${FLOW}/runs/${runId}/resume`, {
      inputs: { note: 'ftrm-echo-cold' },
    });
    expect(resumed.status, await resumed.clone().text()).toBeLessThan(300);
    const ql: any = await cold!.kernel.getServiceAsync('objectql');
    const [echo]: Row[] = await ql.find(ECHO, { where: { name: 'ftrm-echo-cold' }, ...SYS });
    expect(echo, 'the post-pause node never ran after the cold boot').toBeDefined();
    expect(echo.seen_name).toBe('ftrm-b-2');
    expect(echo.seen_password).toBe(SECRET_MASK);
    expect(echo.seen_token).toBe(SECRET_MASK);
    expect(echo.seen_previous_password).toBe(SECRET_MASK);
  });
});
