// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The refusal codes this file's three refusal producers — `predicateSlotRefusal`,
 * `structuralConditionRefusal` and (#20316) `flowNodeConfigRefusals` — carry
 * beside their English message.
 *
 * A localized designer keys its own catalogue row to the `code` and fills it
 * from the `params`; API callers, `registerFlow` and `objectstack validate`
 * keep reading the English `message`. Two kinds of pin:
 *
 *  - **One test per code** — the code, its params exactly, and the message
 *    exactly. The message pins are the control for adding the code: it rides
 *    beside the sentence every door already shows, and must not change a byte
 *    of it.
 *  - **The closed set** — every code has a pin and nothing else does; every
 *    refusal a sweep of slot values provokes, from either producer, carries a
 *    code from that producer's share of the set; and at the type level a
 *    refusal without a code does not compile.
 */

import { describe, expect, it } from 'vitest';

import {
  FLOW_SLOT_REFUSAL_CODES,
  PREDICATE_SLOT_STRING_REFUSAL,
  STRUCTURAL_CONDITION_SHAPE_REFUSAL,
  predicateSlotRefusal,
  structuralConditionRefusal,
  type FlowNodeConfigRefusal,
  type FlowNodeConfigRefusalCode,
  type FlowSlotRefusalCode,
  type FlowSlotRefusalParams,
  type PredicateSlotRefusal,
  type PredicateSlotRefusalCode,
  type StructuralConditionRefusal,
  type StructuralConditionRefusalCode,
} from './flow-node-expression-paths.js';
import * as automation from './index.js';
import { flowNodeConfigRefusals } from './flow-node-config-refusals.js';
import { NotifyConfigSchema } from './io-node-config.zod.js';
import { ApprovalNodeConfigSchema } from './approval.zod.js';
import { STORED_METADATA_BODY_PRESCRIPTION } from '../kernel/stored-metadata-body-objects.js';

/** What one refusal says, whichever producer said it. */
interface Said {
  readonly code: string;
  readonly params: unknown;
  readonly message: string;
  readonly source: string;
}

interface Pin<C extends FlowSlotRefusalCode> {
  readonly produce: () => Said | undefined;
  readonly params: FlowSlotRefusalParams[C];
  readonly message: string;
  readonly source: string;
}

const slot = (value: unknown) => (): Said | undefined => predicateSlotRefusal(value);
const structural = (value: unknown) => (): Said | undefined => structuralConditionRefusal(value);
/** The ONE refusal a node config provokes — two would make the pin ambiguous. */
const nodeConfig = (nodeType: string, config: unknown) => (): Said | undefined => {
  const refusals = flowNodeConfigRefusals(nodeType, config);
  expect(refusals).toHaveLength(1);
  return refusals[0];
};

const CONDITIONS_NOT_ARRAY = (found: string): string =>
  `A decision's \`conditions\` is its ordered branch list — an array of \`{ label, expression }\` — and this one is ${found}. `
  + 'The decision executor iterates it, so a run that reaches the node fails there (a string is iterated character '
  + 'by character, each character a branch with no `expression`). Write the branches as an array, or delete '
  + '`conditions` and route by the out-edges\' own `condition`s.';

const BRANCH_NOT_OBJECT = (path: string, found: string): string =>
  `A decision branch is an object — \`{ label, expression }\` — and \`${path}\` is ${found}. The decision executor `
  + 'reads `label` and `expression` off every branch it reaches, so this one has neither and a run that reaches it '
  + 'fails at the node. Write it as `{ label: \'approved\', expression: \'record.amount > 1000\' }` — the label of '
  + 'the out-edge it routes to, and a bare CEL predicate; a predicate written as a bare string belongs under '
  + '`expression`.';

const LABEL_MISSING = (path: string, found: string): string =>
  'A decision branch routes by its `label`: the first branch whose `expression` holds is taken, and the run continues '
  + `down the out-edge carrying that label. \`${path}\` holds ${found}, and that names no out-edge — so when this `
  + 'branch matches, the node reports no branch it can route, and traversal considers EVERY out-edge instead, as if '
  + 'the decision declared no branches: an unconditional labelled out-edge and the default out-edge both run. Write '
  + 'the label of the out-edge this branch should take (`label: \'approved\'` for the out-edge labelled `approved`). '
  + 'To branch on the out-edges instead, delete `conditions` and put each predicate on its edge\'s `condition`.';

const KEY_MISSING = (nodeType: string, key: string): string =>
  `This \`${nodeType}\` node's config leaves out \`${key}\`, which the ${nodeType} contract requires. Its executor `
  + 'parses the config against that contract before it does anything else and refuses the node without it — so the '
  + 'flow used to register, and then every run that reached this node failed there; the config is metadata, and '
  + `re-running changes nothing. Write \`${key}\` on the node's \`config\`.`;

/** [#21654] A write node aimed at a stored-metadata table — the verb is the run-time refusal's. */
const FAMILY_WRITE = (nodeType: string, verb: string, objectName: string): string =>
  `This \`${nodeType}\` node's \`objectName\` is '${objectName}', so it would ${verb} a table that holds stored `
  + 'metadata, and a flow may not write it directly: every run that reaches the node refuses it before anything is '
  + `written, and re-running changes nothing. ${STORED_METADATA_BODY_PRESCRIPTION}`;

/**
 * [#21850] A key the approval node's declared contract does not declare, or a
 * value it refuses — the contract's own sentence inside the refusal's, with
 * the closing instruction only for a plain value finding.
 */
const REFUSED_BY_CONTRACT = (nodeType: string, key: string, sentence: string, prescribe: boolean): string =>
  `This \`${nodeType}\` node's config is refused at \`${key}\` by the ${nodeType} contract: `
  + `${/[.!?]$/.test(sentence) ? sentence : `${sentence}.`} Its executor parses the config against that contract `
  + 'before it does anything else and refuses the node on any finding, so every run that reached this node would '
  + 'fail there; the config is metadata, and re-running changes nothing.'
  + (prescribe ? ` Write a value the ${nodeType} contract accepts at \`${key}\`.` : '');

/** An approval approver slate the contract accepts — every approval pin carries it. */
const APPROVERS = [{ type: 'user', value: 'u1' }];

/** The approval contract's own words for one config at one issue path — read, never re-spelled. */
const approvalSentence = (config: unknown, path: string): string => {
  const own = ApprovalNodeConfigSchema.safeParse(config);
  return own.success ? '' : own.error.issues.find((i) => i.path.join('.') === path)?.message ?? '';
};

/** The notify contract's own words for a node with no content source — read, never re-spelled. */
const NOTIFY_TITLE_RULE = (() => {
  const own = NotifyConfigSchema.safeParse({ recipients: ['u1'] });
  return own.success ? '' : own.error.issues.find((i) => i.path.join('.') === 'title')?.message ?? '';
})();

const MISSING_TAIL =
  ' where the slot is required: a decision branch is `{ label, expression }` and its `expression` is not optional, '
  + 'so a branch without one states no rule. Write the predicate the branch was meant to test (e.g. '
  + '`record.rating >= 4`); a predicate written under another key — `condition` is the edge\'s spelling — belongs '
  + 'in `expression`. There is no run to keep: the executor evaluates every branch it reaches, and a branch with no '
  + '`expression` failed the run there. To keep the branch and its label but never take it, write '
  + '`expression: \'false\'`. Not by dropping a decision\'s only branch: the node then routes by its out-edges '
  + 'alone, and the out-edge that branch labelled is no longer held back.';

const BLANK_MESSAGE =
  `${PREDICATE_SLOT_STRING_REFUSAL} Found a string that is blank after trimming, which states no rule. Write the `
  + 'predicate the branch or field was meant to test (e.g. `record.rating >= 4`), or keep what the blank did: on a '
  + 'screen field, drop the `visibleWhen` key; on a decision branch, write `expression: \'false\'`, the value the '
  + 'blank evaluated to. Not by dropping a decision\'s only branch: the node then routes by its out-edges alone, and '
  + 'the out-edge that branch labelled is no longer held back.';

const notText = (found: string): string =>
  `${PREDICATE_SLOT_STRING_REFUSAL} Found ${found}. Write the predicate as bare CEL text (e.g. `
  + '`record.rating >= 4`); the `{ dialect, source }` envelope is the `value`-role spelling (the `assignment` '
  + 'node\'s `assignments` map, a `create_record` / `update_record` node\'s `fields` map), and in a predicate slot '
  + 'it is read by the evaluator but by neither validator.';

/** The structural refusal, spelled out in full: its lead sentence is part of what is pinned. */
const STRUCTURAL_LEAD =
  'A structural condition (`config.condition` on a node, `edge.condition`) holds either BARE CEL TEXT or an '
  + 'expression envelope carrying a string `source`. No other shape is authorable there: the engine evaluates '
  + '`source`, so an envelope carrying only an `ast` is not evaluable.';

const shape = (found: string): string =>
  `${STRUCTURAL_LEAD} Found ${found}. Write the condition as bare CEL text (e.g. \`record.rating >= 4\`), or as an `
  + 'expression envelope (`{ dialect: \'cel\', source: \'…\' }`). A value that is neither is read by the evaluator '
  + 'as an EMPTY condition, which answers `false` without saying anything — and on a start node that is the '
  + 'trigger gate.';

/**
 * Every code, its primary case first. The mapped type makes a code without a
 * pin a type error in this file; the first closed-set test makes it a red run.
 */
const PINS: { readonly [C in FlowSlotRefusalCode]: readonly [Pin<C>, ...Pin<C>[]] } = {
  'predicate-slot-missing': [
    {
      produce: slot(undefined),
      params: { found: 'absent' },
      message: `${PREDICATE_SLOT_STRING_REFUSAL} Found nothing — the key is absent${MISSING_TAIL}`,
      source: '',
    },
    {
      produce: slot(null),
      params: { found: 'null' },
      message: `${PREDICATE_SLOT_STRING_REFUSAL} Found \`null\`${MISSING_TAIL}`,
      source: '',
    },
  ],
  'predicate-slot-blank': [
    { produce: slot(''), params: {}, message: BLANK_MESSAGE, source: '' },
    { produce: slot('  \t\n'), params: {}, message: BLANK_MESSAGE, source: '  \t\n' },
  ],
  'predicate-slot-not-text': [
    {
      produce: slot({ dialect: 'cel', source: 'record.x > 1' }),
      params: { found: 'envelope' },
      message: notText('an expression envelope (an object naming a `dialect`)'),
      source: 'record.x > 1',
    },
    {
      produce: slot({ dialect: 'cel' }),
      params: { found: 'envelope' },
      message: notText('an expression envelope (an object naming a `dialect`)'),
      source: '',
    },
    { produce: slot(['a']), params: { found: 'array' }, message: notText('an array'), source: '' },
    { produce: slot({ a: 1 }), params: { found: 'object' }, message: notText('an object'), source: '' },
    { produce: slot(42), params: { found: 'number' }, message: notText('a number'), source: '' },
    { produce: slot(true), params: { found: 'boolean' }, message: notText('a boolean'), source: '' },
    { produce: slot(10n), params: { found: 'bigint' }, message: notText('a bigint'), source: '' },
    { produce: slot(Symbol('s')), params: { found: 'symbol' }, message: notText('a symbol'), source: '' },
    { produce: slot(() => 1), params: { found: 'function' }, message: notText('a function'), source: '' },
  ],
  'structural-condition-shape': [
    {
      produce: structural({ dialect: 'cel', ast: { kind: 'const', value: true } }),
      params: { found: 'ast-without-source' },
      message: shape('an object carrying an `ast` but no string `source` — the engine evaluates `source`, never `ast`'),
      source: '',
    },
    {
      produce: structural({ ast: { kind: 'const' }, source: 2 }),
      params: { found: 'ast-without-source' },
      message: shape('an object carrying an `ast` but no string `source` — the engine evaluates `source`, never `ast`'),
      source: '',
    },
    {
      produce: structural({ dialect: 'cel', source: 1 }),
      params: { found: 'object-without-source' },
      message: shape('an object carrying no string `source`'),
      source: '',
    },
    { produce: structural({}), params: { found: 'object-without-source' }, message: shape('an object carrying no string `source`'), source: '' },
    { produce: structural(['a']), params: { found: 'array' }, message: shape('an array'), source: '' },
    { produce: structural(42), params: { found: 'number' }, message: shape('a number'), source: '' },
    { produce: structural(false), params: { found: 'boolean' }, message: shape('a boolean'), source: '' },
    { produce: structural(10n), params: { found: 'bigint' }, message: shape('a bigint'), source: '' },
    { produce: structural(Symbol('s')), params: { found: 'symbol' }, message: shape('a symbol'), source: '' },
    { produce: structural(() => 1), params: { found: 'function' }, message: shape('a function'), source: '' },
  ],
  'decision-conditions-not-array': [
    { produce: nodeConfig('decision', { conditions: {} }), params: { found: 'object' }, message: CONDITIONS_NOT_ARRAY('an object'), source: '' },
    { produce: nodeConfig('decision', { conditions: 'true' }), params: { found: 'string' }, message: CONDITIONS_NOT_ARRAY('a string'), source: '' },
    { produce: nodeConfig('decision', { conditions: 5 }), params: { found: 'number' }, message: CONDITIONS_NOT_ARRAY('a number'), source: '' },
  ],
  'decision-branch-not-object': [
    {
      produce: nodeConfig('decision', { conditions: ['true'] }),
      params: { index: 0, found: 'string' },
      message: BRANCH_NOT_OBJECT('conditions[0]', 'a string'),
      source: '',
    },
    {
      produce: nodeConfig('decision', { conditions: [{ label: 'a', expression: 'x' }, null] }),
      params: { index: 1, found: 'null' },
      message: BRANCH_NOT_OBJECT('conditions[1]', '`null`'),
      source: '',
    },
    {
      produce: nodeConfig('decision', { conditions: [['true']] }),
      params: { index: 0, found: 'array' },
      message: BRANCH_NOT_OBJECT('conditions[0]', 'an array'),
      source: '',
    },
    {
      produce: nodeConfig('decision', { conditions: [42] }),
      params: { index: 0, found: 'number' },
      message: BRANCH_NOT_OBJECT('conditions[0]', 'a number'),
      source: '',
    },
  ],
  'decision-branch-label-missing': [
    {
      produce: nodeConfig('decision', { conditions: [{ expression: 'true' }] }),
      params: { index: 0, found: 'absent' },
      message: LABEL_MISSING('conditions[0].label', 'nothing — the key is absent'),
      source: '',
    },
    {
      produce: nodeConfig('decision', { conditions: [{ label: null, expression: 'true' }] }),
      params: { index: 0, found: 'null' },
      message: LABEL_MISSING('conditions[0].label', '`null`'),
      source: '',
    },
    {
      produce: nodeConfig('decision', { conditions: [{ label: 'a', expression: 'x' }, { label: ' \t', expression: 'true' }] }),
      params: { index: 1, found: 'blank' },
      message: LABEL_MISSING('conditions[1].label', 'a string that is blank after trimming'),
      source: '',
    },
    {
      produce: nodeConfig('decision', { conditions: [{ label: 42, expression: 'true' }] }),
      params: { index: 0, found: 'number' },
      message: LABEL_MISSING('conditions[0].label', 'a number'),
      source: '',
    },
    {
      produce: nodeConfig('decision', { conditions: [{ label: { text: 'yes' }, expression: 'true' }] }),
      params: { index: 0, found: 'object' },
      message: LABEL_MISSING('conditions[0].label', 'an object'),
      source: '',
    },
  ],
  'node-config-key-missing': [
    {
      produce: nodeConfig('loop', { iteratorVariable: 'row', body: { nodes: [{ id: 'b', type: 'assignment', label: 'B' }], edges: [] } }),
      params: { nodeType: 'loop', key: 'collection' },
      message: KEY_MISSING('loop', 'collection'),
      source: '',
    },
    {
      produce: nodeConfig('map', { flowName: 'child' }),
      params: { nodeType: 'map', key: 'collection' },
      message: KEY_MISSING('map', 'collection'),
      source: '',
    },
    {
      produce: nodeConfig('screen', { fields: [{ label: 'Tier' }] }),
      params: { nodeType: 'screen', key: 'fields[0].name' },
      message: KEY_MISSING('screen', 'fields[0].name'),
      source: '',
    },
  ],
  'node-config-key-required-by-rule': [
    {
      produce: nodeConfig('notify', { recipients: ['u1'] }),
      params: { nodeType: 'notify', key: 'title' },
      message: NOTIFY_TITLE_RULE,
      source: '',
    },
  ],
  'write-node-stored-metadata-target': [
    {
      produce: nodeConfig('create_record', { objectName: 'sys_metadata', fields: { name: 'x' } }),
      params: { nodeType: 'create_record', objectName: 'sys_metadata' },
      message: FAMILY_WRITE('create_record', 'create a record in', 'sys_metadata'),
      source: '',
    },
    {
      produce: nodeConfig('update_record', { objectName: 'sys_metadata_history', filter: { id: '1' } }),
      params: { nodeType: 'update_record', objectName: 'sys_metadata_history' },
      message: FAMILY_WRITE('update_record', 'update', 'sys_metadata_history'),
      source: '',
    },
    {
      produce: nodeConfig('delete_record', { objectName: 'sys_metadata', filter: { id: '1' } }),
      params: { nodeType: 'delete_record', objectName: 'sys_metadata' },
      message: FAMILY_WRITE('delete_record', 'delete from', 'sys_metadata'),
      source: '',
    },
  ],
  'node-config-refused-by-contract': [
    {
      produce: nodeConfig('approval', { approvers: APPROVERS, escalation: { timeoutHours: 2, bogusKey: 1 } }),
      params: { nodeType: 'approval', key: 'escalation.bogusKey' },
      message: REFUSED_BY_CONTRACT(
        'approval',
        'escalation.bogusKey',
        approvalSentence({ approvers: APPROVERS, escalation: { timeoutHours: 2, bogusKey: 1 } }, 'escalation'),
        false,
      ),
      source: '',
    },
    {
      produce: nodeConfig('approval', { approvers: APPROVERS, escalation: { timeoutHours: 0.5 } }),
      params: { nodeType: 'approval', key: 'escalation.timeoutHours' },
      message: REFUSED_BY_CONTRACT(
        'approval',
        'escalation.timeoutHours',
        approvalSentence({ approvers: APPROVERS, escalation: { timeoutHours: 0.5 } }, 'escalation.timeoutHours'),
        true,
      ),
      source: '',
    },
    {
      produce: nodeConfig('approval', { approvers: APPROVERS, onEmptyApprovers: 'fail', fallbackApprovers: APPROVERS }),
      params: { nodeType: 'approval', key: 'onEmptyApprovers' },
      message: REFUSED_BY_CONTRACT(
        'approval',
        'onEmptyApprovers',
        approvalSentence({ approvers: APPROVERS, onEmptyApprovers: 'fail', fallbackApprovers: APPROVERS }, 'onEmptyApprovers'),
        false,
      ),
      source: '',
    },
  ],
};

describe('flow slot refusal codes — one pin per code (code, params, unchanged message)', () => {
  for (const code of FLOW_SLOT_REFUSAL_CODES) {
    it(code, () => {
      const cases = PINS[code] as readonly Pin<typeof code>[];
      for (const pin of cases) {
        const refusal = pin.produce();
        expect(refusal).toBeDefined();
        expect(refusal!.code).toBe(code);
        expect(refusal!.params).toEqual(pin.params);
        expect(refusal!.message).toBe(pin.message);
        expect(refusal!.source).toBe(pin.source);
      }
    });
  }

  it('the rule-required pin reads a real sentence off the notify contract, not an empty one', () => {
    expect(NOTIFY_TITLE_RULE.length).toBeGreaterThan(40);
  });

  it('the refused-by-contract pins read real sentences off the approval contract, not empty ones', () => {
    expect(approvalSentence({ approvers: APPROVERS, escalation: { timeoutHours: 2, bogusKey: 1 } }, 'escalation')).toContain('`bogusKey`');
    expect(approvalSentence({ approvers: APPROVERS, escalation: { timeoutHours: 0.5 } }, 'escalation.timeoutHours').length).toBeGreaterThan(10);
    expect(
      approvalSentence({ approvers: APPROVERS, onEmptyApprovers: 'fail', fallbackApprovers: APPROVERS }, 'onEmptyApprovers'),
    ).toContain('fallbackApprovers');
  });

  it('the structural lead sentence is the published constant, byte for byte', () => {
    expect(STRUCTURAL_CONDITION_SHAPE_REFUSAL).toBe(STRUCTURAL_LEAD);
  });
});

/** Slot values of every shape — the sweep judges whatever each one provokes. */
const SWEEP: readonly unknown[] = [
  undefined,
  null,
  '',
  ' ',
  '\t\n',
  'record.rating >= 4',
  'x',
  { dialect: 'cel', source: 'x' },
  { dialect: 'cel' },
  { dialect: 'cel', source: 1 },
  { source: 'x' },
  { ast: { kind: 'const' } },
  { dialect: 'cel', ast: { kind: 'const' }, source: 'x' },
  {},
  [],
  ['x'],
  0,
  42,
  Number.NaN,
  true,
  false,
  10n,
  Symbol('s'),
  () => 1,
  new Date(0),
];

const PREDICATE_SLOT_CODES: ReadonlySet<PredicateSlotRefusalCode> = new Set<PredicateSlotRefusalCode>([
  'predicate-slot-missing',
  'predicate-slot-blank',
  'predicate-slot-not-text',
]);
const STRUCTURAL_CODES: ReadonlySet<StructuralConditionRefusalCode> = new Set<StructuralConditionRefusalCode>([
  'structural-condition-shape',
]);
const NODE_CONFIG_CODES: ReadonlySet<FlowNodeConfigRefusalCode> = new Set<FlowNodeConfigRefusalCode>([
  'decision-conditions-not-array',
  'decision-branch-not-object',
  'decision-branch-label-missing',
  'node-config-key-missing',
  'node-config-key-required-by-rule',
  'write-node-stored-metadata-target',
  'node-config-refused-by-contract',
]);

/** Node configs of every shape, per node type — the sweep judges whatever each one provokes. */
const CONFIG_SWEEP: ReadonlyArray<readonly [string, unknown]> = [
  ...SWEEP.map((value) => ['decision', { conditions: value }] as const),
  ...SWEEP.map((value) => ['decision', { conditions: [value] }] as const),
  ...SWEEP.map((value) => ['decision', { conditions: [{ label: value, expression: 'true' }] }] as const),
  ['decision', undefined],
  ['decision', {}],
  ['get_record', {}],
  ['get_record', undefined],
  ['get_record', { objectName: 'account' }],
  ['notify', { recipients: ['u1'] }],
  ['notify', {}],
  ['loop', {}],
  ['loop', { body: { nodes: [{ id: 'b', type: 'assignment', label: 'B' }], edges: [] } }],
  ['screen', { fields: [{ label: 'x', options: [{}] }] }],
  ['assignment', {}],
  ...SWEEP.map((value) => ['create_record', { objectName: value }] as const),
  ['update_record', { objectName: 'sys_metadata_history' }],
  ['delete_record', { objectName: 'sys_metadata' }],
  ['approval', undefined],
  ['approval', {}],
  ['approval', { approvers: APPROVERS, notAKey: 1 }],
  ...SWEEP.map((value) => ['approval', { approvers: APPROVERS, escalation: value }] as const),
  ...SWEEP.map((value) => ['approval', { approvers: APPROVERS, escalation: { timeoutHours: value } }] as const),
];

describe('flow slot refusal codes — the closed set', () => {
  it('has a pin for every code, and no pin for a code outside the set', () => {
    expect(Object.keys(PINS).sort()).toEqual([...FLOW_SLOT_REFUSAL_CODES].sort());
    expect(new Set(FLOW_SLOT_REFUSAL_CODES).size).toBe(FLOW_SLOT_REFUSAL_CODES.length);
    for (const code of FLOW_SLOT_REFUSAL_CODES) expect(code).toMatch(/^[a-z]+(?:-[a-z]+)+$/);
  });

  it('splits between the three producers with nothing left over', () => {
    expect([...PREDICATE_SLOT_CODES, ...STRUCTURAL_CODES, ...NODE_CONFIG_CODES].sort()).toEqual([...FLOW_SLOT_REFUSAL_CODES].sort());
  });

  it('every flowNodeConfigRefusals on the sweep carries a node-config code and a path, and every code is reached', () => {
    const provoked = new Set<string>();
    let refused = 0;
    for (const [nodeType, config] of CONFIG_SWEEP) {
      for (const refusal of flowNodeConfigRefusals(nodeType, config)) {
        refused++;
        expect(NODE_CONFIG_CODES.has(refusal.code)).toBe(true);
        expect(typeof refusal.params).toBe('object');
        expect(refusal.path.length).toBeGreaterThan(0);
        expect(refusal.source).toBe('');
        provoked.add(refusal.code);
      }
    }
    expect(refused).toBeGreaterThan(40);
    expect([...provoked].sort()).toEqual([...NODE_CONFIG_CODES].sort());
  });

  it('is published from the automation entry, frozen', () => {
    expect(automation.FLOW_SLOT_REFUSAL_CODES).toBe(FLOW_SLOT_REFUSAL_CODES);
    expect(Object.isFrozen(FLOW_SLOT_REFUSAL_CODES)).toBe(true);
  });

  it('every predicateSlotRefusal on the sweep carries a predicate-slot code, and every one is reached', () => {
    const provoked = new Set<string>();
    for (const value of SWEEP) {
      const refusal = predicateSlotRefusal(value);
      if (refusal === undefined) {
        // Only a non-blank string is admitted; its CEL is another validator's business.
        expect(typeof value === 'string' && value.trim() !== '').toBe(true);
        continue;
      }
      expect(PREDICATE_SLOT_CODES.has(refusal.code as PredicateSlotRefusalCode)).toBe(true);
      expect(typeof refusal.params).toBe('object');
      expect(refusal.message.startsWith(PREDICATE_SLOT_STRING_REFUSAL)).toBe(true);
      provoked.add(refusal.code);
    }
    expect([...provoked].sort()).toEqual([...PREDICATE_SLOT_CODES].sort());
  });

  it('every structuralConditionRefusal on the sweep carries a structural code, and every one is reached', () => {
    const provoked = new Set<string>();
    let refused = 0;
    for (const value of SWEEP) {
      const refusal = structuralConditionRefusal(value);
      if (refusal === undefined) {
        // Admitted: absent, any string, or an object carrying a string `source`.
        const admitted =
          value == null
          || typeof value === 'string'
          || (typeof value === 'object' && !Array.isArray(value) && typeof (value as { source?: unknown }).source === 'string');
        expect(admitted).toBe(true);
        continue;
      }
      refused++;
      expect(STRUCTURAL_CODES.has(refusal.code as StructuralConditionRefusalCode)).toBe(true);
      expect(typeof refusal.params).toBe('object');
      expect(refusal.message.startsWith(STRUCTURAL_CONDITION_SHAPE_REFUSAL)).toBe(true);
      provoked.add(refusal.code);
    }
    expect(refused).toBeGreaterThan(10);
    expect([...provoked].sort()).toEqual([...STRUCTURAL_CODES].sort());
  });

  it('a refusal without a code does not type-check, on either producer', () => {
    // @ts-expect-error — `code` and `params` are required on every predicate slot refusal.
    const noCode: PredicateSlotRefusal = { message: 'm', source: '' };
    // @ts-expect-error — a code's params are its own: `predicate-slot-blank` carries no `found`.
    const wrongParams: PredicateSlotRefusal = { message: 'm', source: '', code: 'predicate-slot-blank', params: { found: 'null' } };
    // @ts-expect-error — `code` and `params` are required on every structural condition refusal.
    const noStructuralCode: StructuralConditionRefusal = { message: 'm', source: '' };
    // @ts-expect-error — each producer emits only its own codes: a structural refusal is never a predicate-slot code.
    const foreignCode: StructuralConditionRefusal = { message: 'm', source: '', code: 'predicate-slot-blank', params: {} };
    // @ts-expect-error — a node config refusal carries its `path` inside the config.
    const noPath: FlowNodeConfigRefusal = { message: 'm', source: '', code: 'node-config-key-missing', params: { nodeType: 'loop', key: 'collection' } };
    // @ts-expect-error — `node-config-key-missing` names the node type and the key, never a `found`.
    const wrongNodeParams: FlowNodeConfigRefusal = { message: 'm', source: '', path: 'x', code: 'node-config-key-missing', params: { found: 'absent' } };
    expect([noCode, wrongParams, noStructuralCode, foreignCode, noPath, wrongNodeParams]).toHaveLength(6);
  });
});
