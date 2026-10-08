// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#21850] The build doors judge an `approval` node's `config` against the
 * contract the spec declares for it, `ApprovalNodeConfigSchema`, WHOLE — the
 * declared contract map in `flow-node-config-refusals.ts`, beside the builtin
 * executor contracts and read by the same judge, `flowNodeConfigRefusals`.
 *
 * The approval executor (`plugin-approvals`) parses `node.config ?? {}`
 * against that contract before it does anything else and fails the node on
 * ANY issue, so every contract finding is one the run would refuse: a key the
 * contract requires left out, a key it does not declare, a value it refuses.
 * `FlowSchema` used to accept all three, so `objectstack validate` and
 * `objectstack compile` exited 0 on them and compile copied the shape into the
 * artifact; the author learned otherwise at the first run.
 *
 * Every door that parses a flow meets the judge: `FlowSchema` itself,
 * `defineStack`, the stack parse `objectstack validate` and `compile` run, the
 * registered `flow` type schema the metadata save door validates against, and
 * an artifact's parse — pinned here. `registerFlow` parses first, and
 * `validateStackExpressions` calls the same judge.
 *
 * No plugin is loaded for any of it: the contract is the spec's own. The
 * builtin arm judges no key membership — a control below holds it there; its
 * value half has its own pins (`flow-builtin-node-config-values.test.ts`).
 */

import { describe, expect, it } from 'vitest';

import { getMetadataTypeSchema } from '../kernel/metadata-type-schemas';
import { MIGRATIONS_BY_MAJOR, RETIRED_KEYS_BY_MAJOR } from '../migrations/registry';
import { ArtifactStagePackageBodySchema, ObjectStackDefinitionSchema, defineStack } from '../stack.zod';
import { ApprovalEscalationSchema, ApprovalNodeConfigSchema } from './approval.zod';
import { flowNodeConfigRefusals, getBuiltinNodeConfigContracts } from './flow-node-config-refusals';
import { FlowSchema } from './flow.zod';

const ENTRY_ID = 'flow-approval-node-config-contract-refused';

type Config = Record<string, unknown>;

const APPROVERS = [{ type: 'position', value: 'finance_reviewer' }];

/** A whole approval config the contract accepts — the accept control, and the base every probe edits. */
const VALID: Config = {
  approvers: APPROVERS,
  behavior: 'first_response',
  lockRecord: true,
  escalation: { enabled: true, timeoutHours: 4, action: 'notify', notifySubmitter: true },
};

const withEscalation = (escalation: Config): Config => ({ ...VALID, escalation });

/** start → the approval node → approve / reject ends. */
function flowWith(config: unknown, name = 'approval_probe') {
  return {
    name,
    label: 'Approval probe',
    type: 'autolaunched',
    nodes: [
      { id: 'start', type: 'start', label: 'Start' },
      { id: 'gate', type: 'approval', label: 'Gate', ...(config === undefined ? {} : { config }) },
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

interface IssueSig { code: string; path: string; message: string }

function issuesOf(flow: unknown): IssueSig[] {
  const r = FlowSchema.safeParse(flow);
  return r.success ? [] : r.error.issues.map((i) => ({ code: i.code, path: i.path.join('.'), message: i.message }));
}

/** The approval contract's own sentence at one issue path — read, never re-spelled. */
function contractSentence(schema: { safeParse(v: unknown): { success: boolean; error?: { issues: Array<{ path: PropertyKey[]; message: string }> } } }, value: unknown, path: string): string {
  const own = schema.safeParse(value);
  return own.success ? '' : own.error?.issues.find((i) => i.path.join('.') === path)?.message ?? '';
}

describe('FlowSchema judges an approval node config against its declared contract, whole', () => {
  it('an undeclared escalation key is refused at nodes.1.config.escalation.bogusKey', () => {
    const config = withEscalation({ timeoutHours: 2, action: 'notify', bogusKey: 1 });
    const issues = issuesOf(flowWith(config));
    expect(issues.map(({ code, path }) => ({ code, path }))).toEqual([
      { code: 'custom', path: 'nodes.1.config.escalation.bogusKey' },
    ]);
    // The judge's own words, never re-spelled, carrying the contract's own sentence.
    expect(issues[0]!.message).toBe(flowNodeConfigRefusals('approval', config)[0]!.message);
    expect(issues[0]!.message).toContain(contractSentence(ApprovalEscalationSchema, config.escalation, ''));
  });

  it('a timeoutHours under the contract minimum is refused at nodes.1.config.escalation.timeoutHours', () => {
    const issues = issuesOf(flowWith(withEscalation({ timeoutHours: 0.5, action: 'notify' })));
    expect(issues.map(({ code, path }) => ({ code, path }))).toEqual([
      { code: 'custom', path: 'nodes.1.config.escalation.timeoutHours' },
    ]);
  });

  it('the judge answers both with its code, params and path', () => {
    const bogus = flowNodeConfigRefusals('approval', withEscalation({ timeoutHours: 2, bogusKey: 1 }));
    const halfHour = flowNodeConfigRefusals('approval', withEscalation({ timeoutHours: 0.5 }));
    expect([...bogus, ...halfHour].map(({ code, params, path, source }) => ({ code, params, path, source }))).toEqual([
      { code: 'node-config-refused-by-contract', params: { nodeType: 'approval', key: 'escalation.bogusKey' }, path: 'escalation.bogusKey', source: '' },
      { code: 'node-config-refused-by-contract', params: { nodeType: 'approval', key: 'escalation.timeoutHours' }, path: 'escalation.timeoutHours', source: '' },
    ]);
  });

  it('an alias keeps the contract\'s own did-you-mean, beside the key it leaves out', () => {
    const config = withEscalation({ timeout: 2 });
    const issues = issuesOf(flowWith(config));
    expect(issues.map(({ path }) => path).sort()).toEqual([
      'nodes.1.config.escalation.timeout',
      'nodes.1.config.escalation.timeoutHours',
    ]);
    const aliasSentence = contractSentence(ApprovalEscalationSchema, config.escalation, '');
    expect(aliasSentence).toContain('`timeoutHours`');
    expect(issues.find((i) => i.path.endsWith('.timeout'))!.message).toContain(aliasSentence);
  });

  it('an undeclared top-level key is refused at the key, one refusal per key', () => {
    const issues = issuesOf(flowWith({ ...VALID, steps: [], quorum: 2 }));
    expect(issues.map(({ path }) => path)).toEqual(['nodes.1.config.steps', 'nodes.1.config.quorum']);
  });

  it('a key the contract requires, left out, is refused with the builtin arm\'s code', () => {
    for (const config of [undefined, {}]) {
      expect(issuesOf(flowWith(config)).map(({ path }) => path), JSON.stringify(config)).toEqual(['nodes.1.config.approvers']);
      expect(flowNodeConfigRefusals('approval', config).map(({ code }) => code)).toEqual(['node-config-key-missing']);
    }
  });

  it('a value a rule of the contract refuses is refused in the rule\'s own words', () => {
    const config = { ...VALID, onEmptyApprovers: 'fail', fallbackApprovers: APPROVERS };
    const [refusal] = flowNodeConfigRefusals('approval', config);
    expect(refusal!.path).toBe('onEmptyApprovers');
    expect(refusal!.message).toContain(contractSentence(ApprovalNodeConfigSchema, config, 'onEmptyApprovers'));
  });

  it('the judge refuses exactly what the contract refuses, over a sweep of configs', () => {
    const sweep: unknown[] = [
      undefined, {}, VALID,
      { approvers: [] },
      { approvers: 'u1' },
      { approvers: [{ type: 'user', value: 'u1' }] },
      { ...VALID, behavior: 'weighted' },
      { ...VALID, minApprovals: 0 },
      { ...VALID, maxRevisions: 1.5 },
      { ...VALID, decisionOutputs: ['note', { key: 'picked', type: 'user', multiple: true }] },
      withEscalation({ timeoutHours: 1 }),
      withEscalation({ enabled: false }),
      withEscalation({ timeoutHours: 2, action: 'escalate' }),
      withEscalation({ timeoutHours: '2' }),
    ];
    for (const config of sweep) {
      const refused = flowNodeConfigRefusals('approval', config).length > 0;
      expect(refused, JSON.stringify(config)).toBe(!ApprovalNodeConfigSchema.safeParse(config ?? {}).success);
    }
  });
});

describe('what stays accepted (lit controls)', () => {
  it('CONTROL: a valid approval node parses', () => {
    expect(issuesOf(flowWith(VALID))).toEqual([]);
    expect(flowNodeConfigRefusals('approval', VALID)).toEqual([]);
  });

  it('CONTROL: an escalation at the contract minimum, and a node with no escalation block, parse', () => {
    expect(issuesOf(flowWith(withEscalation({ timeoutHours: 1 })))).toEqual([]);
    expect(issuesOf(flowWith({ approvers: APPROVERS }))).toEqual([]);
  });

  it('CONTROL: the approval contract judges no builtin node — a builtin\'s undeclared key is the builtin key arm\'s', () => {
    // [#21982] A builtin's undeclared key is refused now too, but by the builtin
    // arm, in the builtin contract's words — never by the approval contract.
    const config = { url: 'https://example.test', bogusKey: 1 };
    const flow = {
      ...flowWith(VALID),
      nodes: [
        { id: 'start', type: 'start', label: 'Start' },
        { id: 'call', type: 'http', label: 'Call', config },
        { id: 'done', type: 'end', label: 'Done' },
      ],
      edges: [{ id: 'e1', source: 'start', target: 'call' }, { id: 'e2', source: 'call', target: 'done' }],
    };
    const [builtinRefusal] = flowNodeConfigRefusals('http', config);
    expect(builtinRefusal!.params).toEqual({ nodeType: 'http', key: 'bogusKey' });
    expect(issuesOf(flow)).toEqual([{ code: 'custom', path: 'nodes.1.config.bogusKey', message: builtinRefusal!.message }]);
    // …and the builtin map, the executor-reconciled one, did not gain the plugin type.
    expect(getBuiltinNodeConfigContracts().has('approval')).toBe(false);
  });

  it('CONTROL: approval_revise carries no config contract and is not judged', () => {
    expect(flowNodeConfigRefusals('approval_revise', { anything: 1 })).toEqual([]);
  });
});

describe('every door that parses a flow refuses it', () => {
  const stackWith = (flows: unknown[]) => ({
    manifest: { id: 'com.example.approvals', name: 'approvals', version: '1.0.0', type: 'app', namespace: 'apv' },
    objects: [{ name: 'apv_request', label: 'Request', fields: { title: { type: 'text', label: 'Title' } } }],
    flows,
  });
  const refused = flowWith(withEscalation({ timeoutHours: 2, bogusKey: 1 }), 'apv_refused');
  const accepted = flowWith(VALID, 'apv_ok');

  it('defineStack wraps the refusal in its ADR-0112 envelope, at flows.N.nodes.1.config.escalation.bogusKey', () => {
    let refusal: { code?: unknown; status?: unknown; issues?: Array<{ path: unknown[]; code: string }> } | undefined;
    try {
      defineStack(stackWith([accepted, refused]) as never);
    } catch (e) {
      refusal = e as typeof refusal;
    }
    expect(refusal, 'defineStack must refuse the approval flow').toBeDefined();
    expect({ code: refusal!.code, status: refusal!.status }).toEqual({ code: 'STACK_SCHEMA_INVALID', status: 422 });
    expect(refusal!.issues!.map((i) => ({ path: i.path.join('.'), code: i.code }))).toEqual([
      { path: 'flows.1.nodes.1.config.escalation.bogusKey', code: 'custom' },
    ]);
  });

  it('CONTROL: defineStack accepts the valid approval flow alone', () => {
    expect(() => defineStack(stackWith([accepted]) as never)).not.toThrow();
  });

  it('ObjectStackDefinitionSchema — the stack parse validate and compile run — refuses it at the same path', () => {
    const r = ObjectStackDefinitionSchema.safeParse(stackWith([flowWith(withEscalation({ timeoutHours: 0.5 }), 'apv_half')]));
    expect(r.success).toBe(false);
    expect(r.success ? [] : r.error.issues.map((i) => i.path.join('.'))).toEqual(['flows.0.nodes.1.config.escalation.timeoutHours']);
    expect(ObjectStackDefinitionSchema.safeParse(stackWith([accepted])).success).toBe(true);
  });

  it('the registered `flow` type schema — what the metadata save door validates against — refuses it too', () => {
    const schema = getMetadataTypeSchema('flow') as unknown as typeof FlowSchema;
    expect(schema).toBeDefined();
    const r = schema.safeParse(refused);
    expect(r.success).toBe(false);
    expect(r.success ? [] : r.error.issues.map((i) => i.path.join('.'))).toEqual(['nodes.1.config.escalation.bogusKey']);
    expect(schema.safeParse(accepted).success).toBe(true);
  });

  it('an artifact\'s parse refuses it', () => {
    const body = { id: 'com.example.approvals', name: 'approvals', version: '1.0.0', type: 'app' };
    const r = ArtifactStagePackageBodySchema.safeParse({ ...body, flows: [refused] });
    expect(r.success).toBe(false);
    expect(r.success ? [] : r.error.issues.map((i) => i.path.join('.'))).toEqual(['flows.0.nodes.1.config.escalation.bogusKey']);
    const ok = ArtifactStagePackageBodySchema.safeParse({ ...body, flows: [accepted] });
    expect(ok.success, JSON.stringify(ok.error?.issues ?? [])).toBe(true);
  });
});

describe('the ADR-0087 ledger', () => {
  it('registers one D3 entry at protocol 18, with no D2 conversion', () => {
    const entries = MIGRATIONS_BY_MAJOR[18]!.semantic.filter((e) => e.id === ENTRY_ID);
    expect(entries, 'the narrowing needs its own D3 entry').toHaveLength(1);
    const [entry] = entries;
    expect(entry!.conversionIds ?? []).toEqual([]);
    expect(entry!.acceptanceCriteria.length).toBeGreaterThan(0);
  });

  it('registers no tombstone: no approval config key is removed', () => {
    const all = Object.values(RETIRED_KEYS_BY_MAJOR).flat();
    expect(all.filter((k) => /Approval(NodeConfig|Escalation)[^:]*:/.test(k))).toEqual([]);
    // CONTROL: the flattened table is the real one — it carries a known step-18 tombstone.
    expect(all).toContain('api/RestApiEndpoint:timeout');
  });
});
