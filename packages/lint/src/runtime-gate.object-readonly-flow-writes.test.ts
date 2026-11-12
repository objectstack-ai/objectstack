/**
 * [#32666] An OBJECT write is judged against the written package's live flows
 * for `flow-update-readonly-field` (and `-when`).
 *
 * The flow write already refuses a flow that writes a readonly field. The
 * order it cannot see is the reverse one: the flow goes live while `status` is
 * writable, then the object makes `status` readonly. The flow is untouched, so
 * nothing re-judged it, and a button it backs ran, reported success and
 * changed nothing. The host now carries the package's live flows on an object
 * write (`RuntimeStackContext.flows`) and the `validateReadonlyFlowWrites`
 * member declares `object`; the gate's differential charges the object write
 * only with the findings it ADDS.
 *
 * Door pins (publish-drafts and the live save) live in
 * `@objectstack/metadata-protocol`'s `protocol-publish-drafts-closure.test.ts`.
 */

import { describe, expect, it } from 'vitest';

import { runRuntimeAuthoringRules } from './runtime-gate.js';

type AnyRec = Record<string, unknown>;

/** The object as stored: `status` writable. */
const leaveRequest = (status: AnyRec = {}): AnyRec => ({
  name: 'el5z_leave_req',
  label: 'Leave Request',
  fields: {
    name: { type: 'text', label: 'Name' },
    status: {
      type: 'select',
      label: 'Status',
      options: [{ label: 'Draft', value: 'draft' }, { label: 'Pending', value: 'pending' }],
      ...status,
    },
  },
});

/** The card's flow: autolaunched, no `runAs`, one `update_record` writing `status`. */
const submitFlow = (overrides: AnyRec = {}): AnyRec => ({
  name: 'el5z_leave_submit',
  label: 'Submit for approval',
  type: 'autolaunched',
  nodes: [
    { id: 'start', type: 'start', label: 'Start' },
    {
      id: 'mark',
      type: 'update_record',
      label: 'Mark pending',
      config: { objectName: 'el5z_leave_req', filter: { id: '{recordId}' }, fields: { status: 'pending' } },
    },
    { id: 'end', type: 'end', label: 'End' },
  ],
  edges: [
    { id: 'e1', source: 'start', target: 'mark' },
    { id: 'e2', source: 'mark', target: 'end' },
  ],
  ...overrides,
});

const objectWrite = (item: AnyRec, context: { objects: AnyRec[]; flows?: AnyRec[] }) =>
  runRuntimeAuthoringRules({ type: 'object', item, context });

const readonlyFindings = <F extends { rule: string }>(fs: readonly F[]): F[] =>
  fs.filter((f) => f.rule.startsWith('flow-update-readonly'));

describe('[#32666] an object write re-judges the package\'s live flows for readonly writes', () => {
  it('REFUSES making a field readonly while a live runAs:\'user\' flow writes it', () => {
    const result = objectWrite(leaveRequest({ readonly: true }), {
      objects: [leaveRequest()],
      flows: [submitFlow()],
    });

    expect(result.rulesRun).toContain('validateReferenceIntegrity');
    const errors = readonlyFindings(result.errors);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({
      severity: 'error',
      rule: 'flow-update-readonly-field',
      // Keyed by the flow's NAME: the index is the gate's private snapshot slot.
      path: 'flows.el5z_leave_submit.nodes[1].config.fields.status',
    });
    expect(readonlyFindings(result.advisories)).toEqual([]);
  });

  it('a readonlyWhen field gives the `-when` advisory, never a refusal', () => {
    const result = objectWrite(leaveRequest({ readonlyWhen: "record.status == 'pending'" }), {
      objects: [leaveRequest()],
      flows: [submitFlow()],
    });

    expect(readonlyFindings(result.errors)).toEqual([]);
    const advisories = readonlyFindings(result.advisories);
    expect(advisories).toHaveLength(1);
    expect(advisories[0]).toMatchObject({
      severity: 'warning',
      rule: 'flow-update-readonly-when-field',
      path: 'flows.el5z_leave_submit.nodes[1].config.fields.status',
    });
  });

  it('the way out: a flow already elevated to runAs:\'system\' lets the field go readonly', () => {
    // The ruling's condition 3 — A is not a lock-in. The elevated flow was
    // published first (the flow write's own verdict); the object then
    // publishes clean.
    const result = objectWrite(leaveRequest({ readonly: true }), {
      objects: [leaveRequest()],
      flows: [submitFlow({ runAs: 'system' })],
    });

    expect(readonlyFindings([...result.errors, ...result.advisories])).toEqual([]);
  });

  it('a conflict already on the tenant is not charged to an unrelated object write', () => {
    // The stored object is already readonly and the live flow already writes
    // it — a tenant already broken, out of the ruling's scope. A label edit of
    // the object adds nothing, so it is not refused for the flow.
    const stored = leaveRequest({ readonly: true });
    const result = objectWrite({ ...stored, label: 'Leave Request (renamed)' }, {
      objects: [stored],
      flows: [submitFlow()],
    });

    expect(readonlyFindings([...result.errors, ...result.advisories])).toEqual([]);
  });

  it('an object write handed no flows judges none — the flow-write floor is unchanged', () => {
    const result = objectWrite(leaveRequest({ readonly: true }), { objects: [leaveRequest()] });

    expect(readonlyFindings([...result.errors, ...result.advisories])).toEqual([]);
  });

  it('a flow write ignores a passed `flows` context and keeps its positional path', () => {
    // The flow write's own verdict: refused against the readonly object, at
    // `flows[0]`, with the stale live copy of the same flow dropped rather
    // than judged beside it.
    const result = runRuntimeAuthoringRules({
      type: 'flow',
      item: submitFlow(),
      context: { objects: [leaveRequest({ readonly: true })], flows: [submitFlow(), submitFlow({ name: 'other' })] },
    });

    const errors = readonlyFindings(result.errors);
    expect(errors.map((f) => f.path)).toEqual(['flows[0].nodes[1].config.fields.status']);
  });
});
