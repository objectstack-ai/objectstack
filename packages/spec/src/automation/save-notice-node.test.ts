// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#28251] The `save_notice` node contract and where the node may stand.
 *
 * A `save_notice` node hands its rendered message to the write that started
 * the run, answered as the create / update `notice`. Its config is one `{{ }}`
 * text slot, and the flow parse refuses the node in any flow a create or
 * update record trigger does not start, at any region depth — no write waits
 * on such a run, so the notice would reach nobody.
 */
import { describe, it, expect } from 'vitest';
import { SaveNoticeConfigSchema } from './builtin-node-config.zod';
import { FlowSchema, FlowNodeAction } from './flow.zod';
import { flowNodeConfigRefusals } from './flow-node-config-refusals';
import { flowNoticeMessageKey } from '../system/i18n-resolver';
import { TranslationDataSchema } from '../system/translation.zod';

const NOTICE = 'Sent {{ record.name }} to your manager for approval';

/** start → save_notice → end, the start node's trigger under test. */
const flowWith = (triggerType: string | undefined, config: Record<string, unknown> = { message: NOTICE }) => ({
  name: 'deal_submit',
  label: 'Deal submit',
  type: triggerType ? 'record_change' : 'autolaunched',
  nodes: [
    {
      id: 'start', type: 'start', label: 'Start',
      ...(triggerType ? { config: { objectName: 'deal', triggerType } } : {}),
    },
    { id: 'tell', type: 'save_notice', label: 'Tell the saver', config },
    { id: 'end', type: 'end', label: 'End' },
  ],
  edges: [
    { id: 'e1', source: 'start', target: 'tell' },
    { id: 'e2', source: 'tell', target: 'end' },
  ],
});

const placementIssues = (result: ReturnType<typeof FlowSchema.safeParse>) =>
  (result.success ? [] : result.error.issues).filter((i) => i.message.includes('A `save_notice` node tells'));

describe('SaveNoticeConfigSchema — one `{{ }}` message', () => {
  it('is a builtin node type', () => {
    expect(FlowNodeAction.options).toContain('save_notice');
  });

  it('accepts a message and keeps the template verbatim', () => {
    expect(SaveNoticeConfigSchema.parse({ message: NOTICE })).toEqual({ message: NOTICE });
  });

  it('requires the message', () => {
    expect(SaveNoticeConfigSchema.safeParse({}).success).toBe(false);
    expect(SaveNoticeConfigSchema.safeParse({ message: '' }).success).toBe(false);
  });

  it('refuses a single-brace token, naming the `{{ }}` spelling', () => {
    const result = SaveNoticeConfigSchema.safeParse({ message: 'Sent {record.name} for approval' });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0].path).toEqual(['message']);
    expect(result.error?.issues[0].message).toContain('{{ record.name }}');
  });

  it('refuses an undeclared key at the build doors, renaming `notice` onto `message`', () => {
    const refusals = flowNodeConfigRefusals('save_notice', { notice: NOTICE });
    expect(refusals.map((r) => [r.code, r.path])).toContainEqual(['node-config-refused-by-contract', 'notice']);
    expect(refusals.find((r) => r.path === 'notice')?.message).toContain('message');
  });
});

describe('FlowSchema — a save_notice node stands only in a flow a record create or update starts', () => {
  it.each(['record-after-update', 'record-before-create', 'record-after-insert', 'record-after-write', 'record-before-update'])(
    'parses under `%s`',
    (trigger) => {
      const result = FlowSchema.safeParse(flowWith(trigger));
      expect(placementIssues(result)).toEqual([]);
      expect(result.success).toBe(true);
    },
  );

  it.each([
    ['no trigger at all', undefined],
    ['a delete trigger', 'record-after-delete'],
    ['a schedule', 'schedule'],
    ['an api hook', 'api'],
  ])('is refused under %s, at the node\'s `type`', (_label, trigger) => {
    const issues = placementIssues(FlowSchema.safeParse(flowWith(trigger)));
    expect(issues.map((i) => i.path)).toEqual([['nodes', 1, 'type']]);
    expect(issues[0].message).toContain('no write waits on the run');
  });

  it('names the ARRAY triggerType form and asks for one trigger type (#28786)', () => {
    const flow = flowWith(undefined);
    (flow.nodes[0] as any).config = { objectName: 'deal', triggerType: ['record-after-create', 'record-after-update'] };
    const issues = placementIssues(FlowSchema.safeParse(flow));
    expect(issues.map((i) => [i.code, i.path])).toEqual([['custom', ['nodes', 1, 'type']]]);
    expect(issues[0].message).toContain(
      "This flow's start writes `triggerType` as an array (`['record-after-create', 'record-after-update']`). "
        + 'That form is not supported and never binds, so no write waits on the run and the notice would reach '
        + "nobody. Give the start node ONE trigger type: `'record-after-write'` fires on both a create and an "
        + 'update.',
    );
    expect(issues[0].message).not.toContain('no record trigger');
  });

  it('is refused inside a region body too, at that node', () => {
    const flow = {
      name: 'deal_loop', label: 'Deal loop', type: 'autolaunched',
      nodes: [
        { id: 'start', type: 'start', label: 'Start' },
        {
          id: 'each', type: 'loop', label: 'Each',
          config: {
            collection: [1, 2],
            iteratorVariable: 'item',
            body: {
              nodes: [{ id: 'tell', type: 'save_notice', label: 'Tell', config: { message: NOTICE } }],
              edges: [],
            },
          },
        },
        { id: 'end', type: 'end', label: 'End' },
      ],
      edges: [
        { id: 'e1', source: 'start', target: 'each' },
        { id: 'e2', source: 'each', target: 'end' },
      ],
    };
    const issues = placementIssues(FlowSchema.safeParse(flow));
    expect(issues.map((i) => i.path)).toEqual([['nodes', 1, 'config', 'body', 'nodes', 0, 'type']]);
  });
});

/**
 * [#28806] A `save_notice` reachable from a node that suspends the run. On that
 * path the write has already answered, so the node is refused by name at run
 * time and, after an approval, the decision strands its run. The parse refuses
 * it: a path start → … → suspending node → … → `save_notice` exists (loops
 * included), whichever other paths also reach it.
 */
describe('FlowSchema — a save_notice reachable from a suspending node is refused (#28806)', () => {
  const START = { id: 'start', type: 'start', label: 'Start', config: { objectName: 'deal', triggerType: 'record-after-create' } };
  const TELL = { id: 'tell', type: 'save_notice', label: 'Tell the saver', config: { message: NOTICE } };
  const ASK = { id: 'ask', type: 'approval', label: 'Manager', config: { approvers: [{ type: 'user', value: 'u_mgr' }] } };
  const END = { id: 'end', type: 'end', label: 'End' };
  const flow = (nodes: Array<Record<string, unknown>>, edges: Array<[string, string, string?]>) => ({
    name: 'deal_submit',
    label: 'Deal submit',
    type: 'record_change',
    nodes,
    edges: edges.map(([source, target, label], i) => ({ id: `e${i + 1}`, source, target, ...(label ? { label } : {}) })),
  });
  const sentence = (type: string, id: string) =>
    `This one is reached after \`${type}\` node '${id}' suspends the run. A suspended run resumes after the write `
    + 'has already answered, so on that path the node is refused by name at run time, and after an approval the '
    + `decision cannot finish its run. Move the \`save_notice\` ahead of '${id}', or tell the person after it with a `
    + '`notify` node.';

  it('is refused after an approval, at the node\'s `type`, naming the approval', () => {
    const issues = placementIssues(FlowSchema.safeParse(flow(
      [START, ASK, TELL, END],
      [['start', 'ask'], ['ask', 'tell', 'approve'], ['ask', 'end', 'reject'], ['tell', 'end']],
    )));
    expect(issues.map((i) => [i.code, i.path])).toEqual([['custom', ['nodes', 2, 'type']]]);
    expect(issues[0].message).toContain(sentence('approval', 'ask'));
  });

  it.each([
    ['wait', { id: 'pause', type: 'wait', label: 'Pause', waitEventConfig: { eventType: 'timer', timerDuration: 'PT1H' } }],
    ['screen', { id: 'pause', type: 'screen', label: 'Pause', config: {} }],
    ['approval_revise', { id: 'pause', type: 'approval_revise', label: 'Pause', config: {} }],
  ])('is refused after a `%s` node', (type, pause) => {
    const issues = placementIssues(FlowSchema.safeParse(flow(
      [START, pause, TELL, END],
      [['start', 'pause'], ['pause', 'tell'], ['tell', 'end']],
    )));
    expect(issues.map((i) => i.path)).toEqual([['nodes', 2, 'type']]);
    expect(issues[0].message).toContain(sentence(type, 'pause'));
  });

  it('is refused several hops after the suspension', () => {
    const issues = placementIssues(FlowSchema.safeParse(flow(
      [START, ASK, { id: 'set', type: 'assignment', label: 'Set', config: {} }, TELL, END],
      [['start', 'ask'], ['ask', 'set', 'approve'], ['set', 'tell'], ['tell', 'end'], ['ask', 'end', 'reject']],
    )));
    expect(issues.map((i) => i.path)).toEqual([['nodes', 3, 'type']]);
    expect(issues[0].message).toContain(sentence('approval', 'ask'));
  });

  it('is refused when only ONE path reaches it through the suspension (a mixed graph)', () => {
    const issues = placementIssues(FlowSchema.safeParse(flow(
      [START, { id: 'big', type: 'decision', label: 'Big deal?' }, ASK, TELL, END],
      [['start', 'big'], ['big', 'ask', 'true'], ['big', 'tell', 'false'], ['ask', 'tell', 'approve'], ['ask', 'end', 'reject'], ['tell', 'end']],
    )));
    expect(issues.map((i) => i.path)).toEqual([['nodes', 3, 'type']]);
    expect(issues[0].message).toContain(sentence('approval', 'ask'));
  });

  it('is refused when an edge after the approval loops back to before the notice', () => {
    const issues = placementIssues(FlowSchema.safeParse(flow(
      [START, { id: 'set', type: 'assignment', label: 'Set', config: {} }, TELL, ASK, END],
      [['start', 'set'], ['set', 'tell'], ['tell', 'ask'], ['ask', 'end', 'approve'], ['ask', 'set', 'reject']],
    )));
    expect(issues.map((i) => i.path)).toEqual([['nodes', 2, 'type']]);
    expect(issues[0].message).toContain(sentence('approval', 'ask'));
  });

  it('is refused inside a region body whose container stands after the approval', () => {
    const loop = {
      id: 'each', type: 'loop', label: 'Each',
      config: {
        collection: [1, 2],
        iteratorVariable: 'item',
        body: { nodes: [{ ...TELL }], edges: [] },
      },
    };
    const issues = placementIssues(FlowSchema.safeParse(flow(
      [START, ASK, loop, END],
      [['start', 'ask'], ['ask', 'each', 'approve'], ['ask', 'end', 'reject'], ['each', 'end']],
    )));
    expect(issues.map((i) => i.path)).toEqual([['nodes', 2, 'config', 'body', 'nodes', 0, 'type']]);
    expect(issues[0].message).toContain(sentence('approval', 'ask'));
  });

  it('CONTROL — a save_notice before the approval still parses', () => {
    const result = FlowSchema.safeParse(flow(
      [START, TELL, ASK, END],
      [['start', 'tell'], ['tell', 'ask'], ['ask', 'end', 'approve'], ['ask', 'end', 'reject']],
    ));
    expect(placementIssues(result)).toEqual([]);
    expect(result.success).toBe(true);
  });

  it('CONTROL — a save_notice on a branch the approval never reaches still parses', () => {
    const result = FlowSchema.safeParse(flow(
      [START, { id: 'big', type: 'decision', label: 'Big deal?' }, ASK, TELL, END],
      [['start', 'big'], ['big', 'ask', 'true'], ['big', 'tell', 'false'], ['ask', 'end', 'approve'], ['ask', 'end', 'reject'], ['tell', 'end']],
    ));
    expect(placementIssues(result)).toEqual([]);
    expect(result.success).toBe(true);
  });

  it('CONTROL — a subflow ahead of the notice is not a suspending node (it pauses only when its child does)', () => {
    const result = FlowSchema.safeParse(flow(
      [START, { id: 'child', type: 'subflow', label: 'Child', config: { flowName: 'deal_child' } }, TELL, END],
      [['start', 'child'], ['child', 'tell'], ['tell', 'end']],
    ));
    expect(placementIssues(result)).toEqual([]);
  });
});

describe('flows.<flow>.notices.<node_id>.message — the translation address', () => {
  it('is spelled by flowNoticeMessageKey', () => {
    expect(flowNoticeMessageKey('deal_submit', 'tell')).toBe('flows.deal_submit.notices.tell.message');
  });

  it('accepts a `{{ }}` translation and refuses a single-brace one', () => {
    const ok = TranslationDataSchema.safeParse({
      flows: { deal_submit: { notices: { tell: { message: '已将 {{ record.name }} 提交给经理审批' } } } },
    });
    expect(ok.success).toBe(true);
    const bad = TranslationDataSchema.safeParse({
      flows: { deal_submit: { notices: { tell: { message: '已将 {record.name} 提交审批' } } } },
    });
    expect(bad.success).toBe(false);
    expect(bad.error?.issues[0].path).toEqual(['flows', 'deal_submit', 'notices', 'tell', 'message']);
  });
});
