// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// A flow node's config VALUES are judged where the flow registers, by the
// schema its executor parses at run time — through both registration doors
// an operator has: the package a stack ships (package load) and the admin
// write door (`POST /automation`).
//
// ## What was broken
//
// Registration checked only the config's key NAMES (against the node type's
// descriptor `configSchema`); the values were parsed for the first time when a
// run reached the node. An approval node with `escalation.timeoutHours: 0.5`
// (the contract says `>= 1`) therefore registered and loaded `active`, every
// record the trigger matched was created, and every run then failed at the
// approval node: no approval request opened, so the record existed without
// the gate it was meant to pass, and the user who saved it saw nothing.
//
// ## What each case pins
//
//   - package load: the sub-hour flow is refused (not registered), and the boot
//     says why with a located error (the flow, the node, the config path);
//   - package load, the control: a valid escalation registers and RUNS — a
//     record of the trigger's object opens a pending approval request;
//   - the admin door: the sub-hour flow is refused `400 VALIDATION_FAILED` with
//     the located error, and nothing is registered under its name;
//   - the admin door, the control: a valid escalation registers.
//
// The fixture is built with `strict: false`, on purpose: the build door judges
// the same flow on its own, and this file pins the two runtime doors behind it,
// so the invalid body has to reach them. Everything else about the stack is an
// ordinary authored package.

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { bootStack, type VerifyStack } from '@objectstack/verify';
import { defineStack } from '@objectstack/spec';
import { ObjectSchema, Field } from '@objectstack/spec/data';
import { ApprovalsServicePlugin } from '@objectstack/plugin-approvals';
import { RecordChangeTriggerPlugin } from '@objectstack/trigger-record-change';

const OBJECT = 'esc_value_request';
/** A position nothing in this fixture staffs: the request opens and waits. */
const UNSTAFFED = 'esc_value_unstaffed';

const PACKAGED_SUB_HOUR = 'esc_value_packaged_sub_hour';
const PACKAGED_VALID = 'esc_value_packaged_valid';
const DOOR_SUB_HOUR = 'esc_value_door_sub_hour';
const DOOR_VALID = 'esc_value_door_valid';

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
const VALID = { enabled: true, timeoutHours: 4, action: 'notify' };

const fixtureStack = defineStack(
  {
    manifest: {
      id: 'com.dogfood.escalation-values',
      namespace: 'esc_value',
      version: '0.0.0',
      type: 'app',
      name: 'Escalation Values Fixture',
      description: 'One object and two approval flows, one with an escalation value its contract refuses.',
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
    flows: [gatedFlow(PACKAGED_SUB_HOUR, SUB_HOUR), gatedFlow(PACKAGED_VALID, VALID)] as never,
  },
  { strict: false },
);

interface DispatcherEnvelope {
  success?: boolean;
  data?: Record<string, unknown>;
  error?: { code?: string; message?: string };
}

describe('a flow node config value its executor refuses is refused at registration', () => {
  let stack: VerifyStack;
  let token: string;
  /** Everything the platform logger wrote while the stack booted. */
  let bootOutput = '';

  const call = async (method: string, path: string, body?: unknown) => {
    const res = await stack.apiAs(token, method, path, body);
    const json = (await res.json().catch(() => ({}))) as DispatcherEnvelope;
    return { status: res.status, json };
  };

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
        extraPlugins: [new RecordChangeTriggerPlugin(), new ApprovalsServicePlugin()],
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

  it('package load: the sub-hour flow is not registered', async () => {
    const read = await call('GET', `/automation/${PACKAGED_SUB_HOUR}`);
    expect(read.status, JSON.stringify(read.json)).toBe(404);
  });

  it('package load: the boot names the flow, the node and the config path it refused', () => {
    const refusal = bootOutput
      .split('\n')
      .filter((line) => line.includes(PACKAGED_SUB_HOUR) && line.includes('escalation.timeoutHours'));
    expect(refusal.length, 'no boot line locates the refused value').toBeGreaterThan(0);
    expect(refusal.some((line) => line.includes("node 'gate'"))).toBe(true);
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

  it('the admin door: the sub-hour flow is refused with a located error, and nothing registers', async () => {
    const refused = await call('POST', '/automation', gatedFlow(DOOR_SUB_HOUR, SUB_HOUR));
    expect(refused.status, JSON.stringify(refused.json)).toBe(400);
    expect(refused.json.error?.code).toBe('VALIDATION_FAILED');
    const message = String(refused.json.error?.message ?? '');
    expect(message).toContain(DOOR_SUB_HOUR);
    expect(message).toContain("node 'gate'");
    expect(message).toContain('escalation.timeoutHours');

    const read = await call('GET', `/automation/${DOOR_SUB_HOUR}`);
    expect(read.status, JSON.stringify(read.json)).toBe(404);
  });

  it('the admin door, the control: a valid escalation registers', async () => {
    const created = await call('POST', '/automation', gatedFlow(DOOR_VALID, VALID));
    expect(created.status, JSON.stringify(created.json)).toBe(200);
    const read = await call('GET', `/automation/${DOOR_VALID}`);
    expect(read.status, JSON.stringify(read.json)).toBe(200);
  });
});
