// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// A flow whose node config breaks the node's contract is refused where it
// registers — through both registration doors an operator has: the package a
// stack ships (package load) and the admin write door (`POST /automation`) —
// and a flow refused at load is not left registered.
//
// ## What was broken
//
// Registration checked only the config's key NAMES (against the node type's
// descriptor `configSchema`); the values were parsed for the first time when a
// run reached the node. An approval node with `escalation.timeoutHours: 0.5`
// (the contract says `>= 1`) therefore registered and loaded `active`, every
// record the trigger matched was created, and every run then failed at the
// approval node: no approval request opened, so the record existed without
// the gate it was meant to pass, and the user who saved it saw nothing. The
// flow parse (`FlowSchema`, which `registerFlow` runs first) now judges an
// approval node's config against its declared contract, whole.
//
// And at package load, a refusal could fail to hold. The boot pull registers a
// package's flows before a plugin that contributes a node type has registered
// its executor, so it cannot check that node's config keys; the `kernel:ready`
// bind re-registers every flow once the executor exists, and when it refused
// one it only warned — the boot pull's registration stayed `active`.
//
// ## What each case pins
//
//   - package load: an approval node's out-of-range escalation and its
//     undeclared escalation key are refused (not registered), and the boot names
//     the flow and the located config path;
//   - package load, the control: a valid escalation registers and RUNS — a
//     record of the trigger's object opens a pending approval request;
//   - package load, a plugin node type whose executor registers after the boot
//     pull: an undeclared config key is refused by the `kernel:ready` bind, and
//     the flow is not left registered; its valid sibling is;
//   - the admin door: both approval refusals answer `400 VALIDATION_FAILED`
//     located at the config path, and nothing is registered under either name;
//   - the admin door, the control: a valid escalation registers.
//
// The fixture is built with `strict: false`, on purpose: the build door judges
// the same flows on its own, and this file pins the two runtime doors behind
// it, so the invalid bodies have to reach them. Everything else about the stack
// is an ordinary authored package.

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { bootStack, type VerifyStack } from '@objectstack/verify';
import { defineStack } from '@objectstack/spec';
import { defineActionDescriptor } from '@objectstack/spec/automation';
import { ObjectSchema, Field } from '@objectstack/spec/data';
import { ApprovalsServicePlugin } from '@objectstack/plugin-approvals';
import { RecordChangeTriggerPlugin } from '@objectstack/trigger-record-change';

const OBJECT = 'esc_value_request';
/** A position nothing in this fixture staffs: the request opens and waits. */
const UNSTAFFED = 'esc_value_unstaffed';

const PACKAGED_SUB_HOUR = 'esc_value_packaged_sub_hour';
const PACKAGED_UNKNOWN_KEY = 'esc_value_packaged_unknown_key';
const PACKAGED_VALID = 'esc_value_packaged_valid';
const PACKAGED_PLUGIN_TYPO = 'esc_value_packaged_plugin_typo';
const PACKAGED_PLUGIN_VALID = 'esc_value_packaged_plugin_valid';
const DOOR_SUB_HOUR = 'esc_value_door_sub_hour';
const DOOR_UNKNOWN_KEY = 'esc_value_door_unknown_key';
const DOOR_VALID = 'esc_value_door_valid';

/** The config path the flow parse locates, on the approval node (`nodes[1]`). */
const SUB_HOUR_PATH = 'nodes.1.config.escalation.timeoutHours';
const UNKNOWN_KEY_PATH = 'nodes.1.config.escalation.bogusKey';

/** An active, record-triggered flow whose one approval node carries `escalation`. */
function gatedFlow(name: string, escalation: Record<string, unknown>) {
  return {
    name,
    label: `Escalation gate ${name}`,
    type: 'autolaunched',
    status: 'active',
    nodes: [
      {
        id: 'start',
        type: 'start',
        label: 'On Create',
        config: { objectName: OBJECT, triggerType: 'record-after-create' },
      },
      {
        id: 'gate',
        type: 'approval',
        label: 'Gate',
        config: {
          approvers: [{ type: 'position', value: UNSTAFFED }],
          behavior: 'first_response',
          escalation,
        },
      },
      { id: 'approved', type: 'end', label: 'Approved' },
      { id: 'rejected', type: 'end', label: 'Rejected' },
    ],
    edges: [
      { id: 'e1', source: 'start', target: 'gate' },
      { id: 'e2', source: 'gate', target: 'approved', label: 'approve' },
      { id: 'e3', source: 'gate', target: 'rejected', label: 'reject' },
    ],
  };
}

const SUB_HOUR = { enabled: true, timeoutHours: 0.5, action: 'notify' };
const UNKNOWN_KEY = { enabled: true, timeoutHours: 4, action: 'notify', bogusKey: 1 };
const VALID = { enabled: true, timeoutHours: 4, action: 'notify' };

/**
 * A plugin node type the spec knows nothing about, contributed the way a
 * plugin contributes one: its executor (and the descriptor whose
 * `configSchema` declares `count`) registers from the plugin's own `start()`,
 * after the automation plugin's boot pull.
 */
const STAMP = 'esc_value_stamp';

function stampPlugin() {
  return {
    name: 'com.dogfood.esc-value-stamp',
    version: '0.0.0',
    async init() {},
    async start(ctx: { getService<T>(name: string): T }) {
      ctx.getService<{ registerNodeExecutor(executor: unknown): void }>('automation').registerNodeExecutor({
        type: STAMP,
        descriptor: defineActionDescriptor({
          type: STAMP,
          version: '0.0.0',
          name: 'Stamp',
          category: 'custom',
          paradigms: ['flow'],
          source: 'plugin',
          configSchema: { type: 'object', properties: { count: { type: 'number' } } },
        }),
        async execute() {
          return { success: true };
        },
      });
    },
  };
}

/** A flow run by hand whose one node is the plugin node type, carrying `config`. */
function stampFlow(name: string, config: Record<string, unknown>) {
  return {
    name,
    label: `Stamp ${name}`,
    type: 'autolaunched',
    status: 'active',
    nodes: [
      { id: 'start', type: 'start', label: 'Start', config: {} },
      { id: 'stamp', type: STAMP, label: 'Stamp', config },
      { id: 'end', type: 'end', label: 'End' },
    ],
    edges: [
      { id: 'e1', source: 'start', target: 'stamp' },
      { id: 'e2', source: 'stamp', target: 'end' },
    ],
  };
}

const fixtureStack = defineStack(
  {
    manifest: {
      id: 'com.dogfood.escalation-values',
      namespace: 'esc_value',
      version: '0.0.0',
      type: 'app',
      name: 'Escalation Values Fixture',
      description: 'One object, approval flows with escalation values their contract refuses, and plugin-node flows.',
    },
    // ADR-0097: a record-change trigger registers only when the app declares it.
    requires: ['automation', 'triggers'],
    objects: [
      ObjectSchema.create({
        name: OBJECT,
        label: 'Escalation Value Request',
        pluralLabel: 'Escalation Value Requests',
        sharingModel: 'public_read_write',
        fields: { name: Field.text({ label: 'Name', required: true }) },
      }),
    ],
    flows: [
      gatedFlow(PACKAGED_SUB_HOUR, SUB_HOUR),
      gatedFlow(PACKAGED_UNKNOWN_KEY, UNKNOWN_KEY),
      gatedFlow(PACKAGED_VALID, VALID),
      // `cuont` is a key the plugin node type's descriptor does not declare.
      stampFlow(PACKAGED_PLUGIN_TYPO, { cuont: 2 }),
      stampFlow(PACKAGED_PLUGIN_VALID, { count: 2 }),
    ] as never,
  },
  { strict: false },
);

interface DispatcherEnvelope {
  success?: boolean;
  data?: Record<string, unknown>;
  error?: {
    code?: string;
    message?: string;
    details?: { fields?: Array<{ field?: string; code?: string; message?: string }> };
  };
}

describe('a flow node config its contract refuses is refused at registration, and not left registered at load', () => {
  let stack: VerifyStack;
  let token: string;
  /** Everything the platform logger wrote while the stack booted. */
  let bootOutput = '';

  const call = async (method: string, path: string, body?: unknown) => {
    const res = await stack.apiAs(token, method, path, body);
    const json = (await res.json().catch(() => ({}))) as DispatcherEnvelope;
    return { status: res.status, json };
  };

  /** The boot lines that name `flow` and carry `fragment`. */
  const bootLines = (flow: string, fragment: string) =>
    bootOutput.split('\n').filter((line) => line.includes(flow) && line.includes(fragment));

  beforeAll(async () => {
    // The core logger writes through the process streams, not `console.*`.
    const lines: string[] = [];
    const sink = (chunk: unknown): boolean => {
      lines.push(String(chunk));
      return true;
    };
    const outSpy = vi.spyOn(process.stdout, 'write').mockImplementation(sink as never);
    const errSpy = vi.spyOn(process.stderr, 'write').mockImplementation(sink as never);
    try {
      stack = await bootStack(fixtureStack as unknown as Parameters<typeof bootStack>[0], {
        automation: true,
        extraPlugins: [new RecordChangeTriggerPlugin(), new ApprovalsServicePlugin(), stampPlugin()],
      });
    } finally {
      outSpy.mockRestore();
      errSpy.mockRestore();
      bootOutput = lines.join('');
    }
    token = await stack.signIn();
  }, 120_000);

  afterAll(async () => {
    await stack?.stop();
  });

  it('package load: the sub-hour and the undeclared-key approval flows are not registered', async () => {
    for (const name of [PACKAGED_SUB_HOUR, PACKAGED_UNKNOWN_KEY]) {
      const read = await call('GET', `/automation/${name}`);
      expect(read.status, `${name}: ${JSON.stringify(read.json)}`).toBe(404);
    }
  });

  it('package load: the boot names each refused flow and the config path it refused', () => {
    expect(bootLines(PACKAGED_SUB_HOUR, 'nodes[1].config.escalation.timeoutHours').length, bootOutput.slice(-4000))
      .toBeGreaterThan(0);
    expect(bootLines(PACKAGED_UNKNOWN_KEY, 'nodes[1].config.escalation.bogusKey').length, bootOutput.slice(-4000))
      .toBeGreaterThan(0);
  });

  it('package load, the control: a valid escalation registers active and runs', async () => {
    const read = await call('GET', `/automation/${PACKAGED_VALID}`);
    expect(read.status, JSON.stringify(read.json)).toBe(200);
    expect(read.json.data?.status).toBe('active');

    const created = await stack.apiAs(token, 'POST', `/data/${OBJECT}`, { name: 'gated' });
    expect(created.status, await created.clone().text()).toBe(201);
    const createdJson = (await created.json()) as { id?: string; record?: { id?: string } };
    const recordId = String(createdJson.id ?? createdJson.record?.id);

    // The run reached the approval node and the node opened its request:
    // only an escalation its executor accepts gets that far.
    const pending = await stack.apiAs(token, 'GET', '/approvals/requests?status=pending');
    expect(pending.status).toBe(200);
    const rows = ((await pending.json()) as { data: Array<Record<string, unknown>> }).data;
    const opened = rows.filter((row) => String(row.record_id) === recordId);
    expect(opened.length, JSON.stringify(rows)).toBe(1);
    expect(opened[0].pending_approvers).toEqual([`position:${UNSTAFFED}`]);
  });

  it('package load: a flow the kernel:ready bind refuses is not left registered from the boot pull', async () => {
    const read = await call('GET', `/automation/${PACKAGED_PLUGIN_TYPO}`);
    expect(read.status, JSON.stringify(read.json)).toBe(404);
    expect(bootLines(PACKAGED_PLUGIN_TYPO, 'config.cuont').length, bootOutput.slice(-4000)).toBeGreaterThan(0);

    // Only that flow: its valid sibling of the same node type is registered.
    const sibling = await call('GET', `/automation/${PACKAGED_PLUGIN_VALID}`);
    expect(sibling.status, JSON.stringify(sibling.json)).toBe(200);
  });

  it('the admin door: both approval refusals answer 400 VALIDATION_FAILED at the config path, and nothing registers', async () => {
    for (const [name, escalation, path] of [
      [DOOR_SUB_HOUR, SUB_HOUR, SUB_HOUR_PATH],
      [DOOR_UNKNOWN_KEY, UNKNOWN_KEY, UNKNOWN_KEY_PATH],
    ] as const) {
      const refused = await call('POST', '/automation', gatedFlow(name, escalation));
      expect(refused.status, JSON.stringify(refused.json)).toBe(400);
      expect(refused.json.error?.code).toBe('VALIDATION_FAILED');
      const fields = refused.json.error?.details?.fields ?? [];
      expect(fields.map((f) => f.field), JSON.stringify(refused.json)).toContain(path);

      const read = await call('GET', `/automation/${name}`);
      expect(read.status, JSON.stringify(read.json)).toBe(404);
    }
  });

  it('the admin door, the control: a valid escalation registers', async () => {
    const created = await call('POST', '/automation', gatedFlow(DOOR_VALID, VALID));
    expect(created.status, JSON.stringify(created.json)).toBe(200);
    const read = await call('GET', `/automation/${DOOR_VALID}`);
    expect(read.status, JSON.stringify(read.json)).toBe(200);
  });
});
