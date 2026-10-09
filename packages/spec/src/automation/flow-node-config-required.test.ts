// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #20316 — what a node's executor needs its `config` to carry is refused at
 * `FlowSchema.parse`, the first of the three doors.
 *
 * A node's `config` is an open `z.record`, so two kinds of authored config
 * passed `FlowSchema.parse`, `AutomationEngine.registerFlow` and
 * `objectstack validate` and only met the run:
 *
 *  - a key the node's EXECUTOR CONTRACT requires, left out — the executor's
 *    `parseNodeConfig` call refuses the node on every run that reaches it
 *    (measured for every contract-parsing builtin; the census is the table
 *    below, and `loop` with a `body` but no `collection` was the first one
 *    found);
 *  - a `decision` branch list the executor cannot read — a branch with no
 *    `label` never failed a run at all: the matched branch reported no label,
 *    and traversal took EVERY out-edge. A non-object branch, or a
 *    `conditions` that is not an array, failed the run at the node.
 *
 * Every refused row asserts the issue `code`, the `path` and the full message,
 * read off the spec's own `flowNodeConfigRefusals` — never re-spelled — so the
 * three doors are held to ONE judge. The other two doors run the same census
 * in their own packages (`service-automation`'s
 * `node-config-required-keys.test.ts`, `lint`'s `validate-expressions.test.ts`).
 */

import { describe, expect, it } from 'vitest';

import { NotifyConfigSchema } from './io-node-config.zod';
import { ScreenConfigSchema } from './builtin-node-config.zod';
import { flowNodeConfigRefusals } from './flow-node-config-refusals';
import { FlowSchema } from './flow.zod';

type Node = Record<string, unknown>;
type Config = Record<string, unknown>;

/** start → <middle nodes> → end, chained by unconditional edges. */
function flowWith(...middle: Node[]) {
  const nodes: Node[] = [{ id: 'start', type: 'start', label: 'Start' }, ...middle, { id: 'end', type: 'end', label: 'End' }];
  const edges = nodes.slice(1).map((n, i) => ({ id: `e${i}`, source: String(nodes[i].id), target: String(n.id) }));
  return { name: 'config_probe', label: 'Config probe', type: 'autolaunched', nodes, edges };
}

const node = (type: string, config?: Config): Node => ({
  id: 'probe', type, label: 'Probe', ...(config === undefined ? {} : { config }),
});

/** A one-node region whose node id is unique to `tag`. */
const region = (tag: string) => ({ nodes: [{ id: `inner_${tag}`, type: 'assignment', label: tag }], edges: [] });

function issuesOf(flow: unknown) {
  const result = FlowSchema.safeParse(flow);
  return result.success ? [] : result.error.issues;
}

/** `fields[0].options[0].value` → `['fields', 0, 'options', 0, 'value']`. */
function segmentsOf(path: string): (string | number)[] {
  return path.split('.').flatMap((part) => {
    const bracket = part.indexOf('[');
    if (bracket === -1) return [part];
    return [part.slice(0, bracket), ...[...part.slice(bracket).matchAll(/\[(\d+)\]/g)].map((m) => Number(m[1]))];
  });
}

/** A deep copy of `config` without the key at `path`. */
function without(config: Config, path: string): Config {
  const copy = JSON.parse(JSON.stringify(config)) as Config;
  const segments = segmentsOf(path);
  let parent: any = copy;
  for (const segment of segments.slice(0, -1)) parent = parent[segment];
  delete parent[segments[segments.length - 1]];
  return copy;
}

const SCREEN: Config = {
  fields: [{ name: 'tier', label: 'Tier', type: 'select', options: [{ label: 'Gold', value: 'gold' }] }],
};

/**
 * The census: every key a contract-parsing builtin's executor contract
 * requires. `config` is a whole, valid config — the accept control — and
 * `key` the one left out.
 */
const CENSUS: Array<{ type: string; config: Config; key: string }> = [
  { type: 'get_record', config: { objectName: 'account', outputVariable: 'rows' }, key: 'objectName' },
  { type: 'create_record', config: { objectName: 'account', fields: { name: 'Acme' } }, key: 'objectName' },
  { type: 'update_record', config: { objectName: 'account', filter: { id: '{record.id}' }, fields: { name: 'Acme' } }, key: 'objectName' },
  { type: 'delete_record', config: { objectName: 'account', filter: { id: '{record.id}' } }, key: 'objectName' },
  { type: 'notify', config: { recipients: ['{record.owner}'], title: 'Hi' }, key: 'recipients' },
  { type: 'http', config: { url: 'https://example.com/hook' }, key: 'url' },
  { type: 'screen', config: SCREEN, key: 'fields[0].name' },
  { type: 'screen', config: SCREEN, key: 'fields[0].options[0].value' },
  { type: 'screen', config: SCREEN, key: 'fields[0].options[0].label' },
  { type: 'script', config: { function: 'recalc_totals' }, key: 'function' },
  { type: 'subflow', config: { flowName: 'child_flow' }, key: 'flowName' },
  { type: 'map', config: { collection: '{rows}', flowName: 'child_flow' }, key: 'collection' },
  { type: 'map', config: { collection: '{rows}', flowName: 'child_flow' }, key: 'flowName' },
  { type: 'loop', config: { collection: '{rows}', body: region('loop') }, key: 'collection' },
  { type: 'parallel', config: { branches: [region('p1'), region('p2')] }, key: 'branches' },
  { type: 'try_catch', config: { try: region('try'), catch: region('catch') }, key: 'try' },
];

describe('FlowSchema.parse refuses a key the node\'s executor contract requires, left out', () => {
  it.each(CENSUS)('$type: the whole config parses — the accept control for `$key`', ({ type, config }) => {
    expect(issuesOf(flowWith(node(type, config)))).toEqual([]);
  });

  it.each(CENSUS)('$type without `$key` is refused, anchored at the key', ({ type, config, key }) => {
    const authored = without(config, key);
    const issues = issuesOf(flowWith(node(type, authored)));
    const judged = flowNodeConfigRefusals(type, authored);
    expect(judged.map((r) => [r.code, r.path, r.params])).toEqual([['node-config-key-missing', key, { nodeType: type, key }]]);
    expect(issues.map((i) => [i.code, i.path, i.message])).toEqual([
      ['custom', ['nodes', 1, 'config', ...segmentsOf(key)], judged[0].message],
    ]);
    expect(issues[0].message).toContain(`This \`${type}\` node's config leaves out \`${key}\``);
  });

  it('a node with no `config` at all is judged as the executor reads it — `{}`', () => {
    const issues = issuesOf(flowWith(node('http')));
    expect(issues.map((i) => [i.code, i.path])).toEqual([['custom', ['nodes', 1, 'config', 'url']]]);
  });

  describe('a key a RULE of the contract requires here — the contract\'s own message', () => {
    it('a `notify` with neither `title` nor `template` is refused at `title`, in the notify contract\'s words', () => {
      const authored = { recipients: ['{record.owner}'] };
      const own = NotifyConfigSchema.safeParse(authored);
      expect(own.success).toBe(false);
      const issues = issuesOf(flowWith(node('notify', authored)));
      expect(issues.map((i) => [i.code, i.path, i.message])).toEqual([
        ['custom', ['nodes', 1, 'config', 'title'], own.error!.issues.find((i) => i.path.join('.') === 'title')!.message],
      ]);
      expect(flowNodeConfigRefusals('notify', authored).map((r) => r.code)).toEqual(['node-config-key-required-by-rule']);
    });

    it('a `lookup` screen field with no `reference` is refused at the field\'s `reference`, in the screen contract\'s words', () => {
      const authored = { fields: [{ name: 'account', label: 'Account', type: 'lookup' }] };
      const own = ScreenConfigSchema.safeParse(authored);
      expect(own.success).toBe(false);
      const issues = issuesOf(flowWith(node('screen', authored)));
      expect(issues.map((i) => [i.code, i.path, i.message])).toEqual([
        ['custom', ['nodes', 1, 'config', 'fields', 0, 'reference'], own.error!.issues[0].message],
      ]);
      expect(flowNodeConfigRefusals('screen', authored).map((r) => r.code)).toEqual(['node-config-key-required-by-rule']);
    });
  });

  it('reaches a node inside an ADR-0031 region body, anchored at the inner node — never re-reported against the container', () => {
    const inner = { id: 'fetch', type: 'get_record', label: 'Fetch', config: { outputVariable: 'rows' } };
    const issues = issuesOf(flowWith(node('loop', { collection: '{rows}', body: { nodes: [inner], edges: [] } })));
    expect(issues.map((i) => [i.code, i.path])).toEqual([
      ['custom', ['nodes', 1, 'config', 'body', 'nodes', 0, 'config', 'objectName']],
    ]);
  });

  describe('CONTROLS — what this rule must NOT reach', () => {
    it('a legacy flat-graph `loop` (no `body`) needs no `collection` — its executor does not parse it', () => {
      expect(issuesOf(flowWith(node('loop', {})))).toEqual([]);
      expect(issuesOf(flowWith(node('loop')))).toEqual([]);
    });

    it('a PRESENT value of the wrong type is not this rule\'s finding — the value arm refuses it under its own code', () => {
      // #21898: present values are judged since, by `node-config-refused-by-contract`
      // (`flow-builtin-node-config-values.test.ts`); this rule still reports absence only.
      expect(flowNodeConfigRefusals('get_record', { objectName: 42 }).map(({ code, path }) => ({ code, path }))).toEqual([
        { code: 'node-config-refused-by-contract', path: 'objectName' },
      ]);
      expect(flowNodeConfigRefusals('script', { function: '' }).map(({ code, path }) => ({ code, path }))).toEqual([
        { code: 'node-config-refused-by-contract', path: 'function' },
      ]);
    });

    it('a key missing INSIDE an authored value is not a config key left out — the value-envelope pass owns it', () => {
      // `fields.*` is a ledger `value` slot: `{ dialect: 'cel' }` with no
      // `source` is a malformed envelope, refused at `registerFlow` and
      // `objectstack validate` by that pass, with its own message.
      expect(flowNodeConfigRefusals('create_record', { objectName: 'task', fields: { total: { dialect: 'cel' } } })).toEqual([]);
      expect(flowNodeConfigRefusals('update_record', { objectName: 'task', filter: { id: '1' }, fields: { total: { dialect: 'cel' } } })).toEqual([]);
    });

    it('an undeclared key is not this rule\'s finding — no key-set closure', () => {
      // [#21982] An undeclared key is the KEY arm's: its one refusal, at the key —
      // never a `node-config-key-missing` or rule finding from this rule.
      const undeclared = { url: 'https://example.com', zzz_undeclared: 1 };
      expect(issuesOf(flowWith(node('http', undeclared))).map((i) => ({ code: i.code, path: i.path.join('.') })))
        .toEqual([{ code: 'custom', path: 'nodes.1.config.zzz_undeclared' }]);
      expect(flowNodeConfigRefusals('http', undeclared).map(({ code, path }) => ({ code, path })))
        .toEqual([{ code: 'node-config-refused-by-contract', path: 'zzz_undeclared' }]);
    });

    it('a node type with no executor contract is untouched — `assignment`, a plugin type', () => {
      expect(issuesOf(flowWith(node('assignment', {})))).toEqual([]);
      expect(issuesOf(flowWith(node('acme_custom_step', {})))).toEqual([]);
    });
  });
});

/** A decision whose `config` is written exactly as given. */
const decision = (config: Config): Node => ({ id: 'check', type: 'decision', label: 'Check', config });

describe('FlowSchema.parse refuses a decision branch list the executor cannot read', () => {
  const AT = (...rest: (string | number)[]) => ['nodes', 1, 'config', ...rest];

  it.each([
    ['nothing — the key is absent', { expression: 'true' }, 'absent'],
    ['`null`', { label: null, expression: 'true' }, 'null'],
    ['an empty string', { label: '', expression: 'true' }, 'blank'],
    ['a string blank after trimming', { label: '  ', expression: 'true' }, 'blank'],
    ['a number', { label: 42, expression: 'true' }, 'number'],
    ['a boolean', { label: false, expression: 'true' }, 'boolean'],
  ])('a branch whose `label` holds %s is refused at the label', (_name, branch, found) => {
    const config = { conditions: [{ label: 'first', expression: 'false' }, branch] };
    const issues = issuesOf(flowWith(decision(config)));
    const judged = flowNodeConfigRefusals('decision', config);
    expect(judged.map((r) => [r.code, r.params])).toEqual([['decision-branch-label-missing', { index: 1, found }]]);
    expect(issues.map((i) => [i.code, i.path, i.message])).toEqual([['custom', AT('conditions', 1, 'label'), judged[0].message]]);
  });

  it.each([
    ['a string — the bare predicate', 'true', 'string'],
    ['`null`', null, 'null'],
    ['a number', 42, 'number'],
    ['an array', ['true'], 'array'],
  ])('a branch that is %s is refused as a branch, once', (_name, branch, found) => {
    const config = { conditions: [branch] };
    const issues = issuesOf(flowWith(decision(config)));
    const judged = flowNodeConfigRefusals('decision', config);
    expect(judged.map((r) => [r.code, r.params])).toEqual([['decision-branch-not-object', { index: 0, found }]]);
    // ONE issue: an array element is not read as an object missing its
    // `expression` too — the expression walk does not reach it.
    expect(issues.map((i) => [i.code, i.path, i.message])).toEqual([['custom', AT('conditions', 0), judged[0].message]]);
  });

  it.each([
    ['an object', {}, 'object'],
    ['a string', 'true', 'string'],
    ['a number', 5, 'number'],
  ])('`conditions` holding %s is refused at `conditions`', (_name, conditions, found) => {
    const config = { conditions };
    const issues = issuesOf(flowWith(decision(config)));
    const judged = flowNodeConfigRefusals('decision', config);
    expect(judged.map((r) => [r.code, r.params])).toEqual([['decision-conditions-not-array', { found }]]);
    expect(issues.map((i) => [i.code, i.path, i.message])).toEqual([['custom', AT('conditions'), judged[0].message]]);
  });

  it('an empty branch is refused twice, once per key — the label here, the expression by its own slot rule', () => {
    const issues = issuesOf(flowWith(decision({ conditions: [{}] })));
    expect(issues.map((i) => i.path)).toEqual([AT('conditions', 0, 'expression'), AT('conditions', 0, 'label')]);
  });

  it('reaches a decision inside a region body, anchored where the author wrote it', () => {
    const issues = issuesOf(flowWith(node('loop', {
      collection: '{rows}',
      body: { nodes: [{ id: 'inner', type: 'decision', label: 'Inner', config: { conditions: [{ expression: 'true' }] } }], edges: [] },
    })));
    expect(issues.map((i) => [i.code, i.path])).toEqual([
      ['custom', ['nodes', 1, 'config', 'body', 'nodes', 0, 'config', 'conditions', 0, 'label']],
    ]);
  });

  describe('CONTROLS', () => {
    it('a labelled branch parses', () => {
      expect(issuesOf(flowWith(decision({ conditions: [{ label: 'yes', expression: 'true' }] })))).toEqual([]);
    });

    it('a decision that declares no branch still parses — absent, `null`, or empty — it routes by its out-edges', () => {
      expect(issuesOf(flowWith(decision({})))).toEqual([]);
      expect(issuesOf(flowWith(decision({ conditions: null })))).toEqual([]);
      expect(issuesOf(flowWith(decision({ conditions: [] })))).toEqual([]);
      expect(issuesOf(flowWith({ id: 'check', type: 'decision', label: 'Check' }))).toEqual([]);
    });
  });
});
