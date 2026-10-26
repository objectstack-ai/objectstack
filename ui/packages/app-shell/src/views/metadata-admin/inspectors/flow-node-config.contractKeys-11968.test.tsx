// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#11968 — every key the FALLBACK flow-node form writes is declared by
 * its node's contract, read from the installed `@objectstack/spec` at test
 * time.
 *
 * `FlowNodeInspector` renders the hand-written `FLOW_NODE_CONFIG` groups
 * whenever the engine has published no `configSchema` for the node's type:
 * while `GET /automation/actions` is loading, and when it answers non-ok or
 * throws. Two of those groups wrote keys their contract does not declare. The
 * `http_request` group offered `config.outputVariable`: the `http` executor
 * never reads it, its strict contract refuses it by name, and the engine's
 * registration refuses a flow carrying it, so an author on the fallback form
 * saved a flow that never registered. The `notify` group wrote `config.url`,
 * the converted spelling of `actionUrl`. objectui#9335 removed the same shape
 * from the `end` group one node at a time; this file closes the class.
 *
 * ## What is judged, and against what
 *
 * Every key a group can INTRODUCE onto a node: each field's `path`, and for an
 * `objectList` field each column under the list's element. A `config`-rooted
 * key is judged against the config contract of every spec node type the
 * inspector resolves to that group (`fieldsForNodeType` is alias-aware; the
 * `http` group is keyed by its spec node type since objectui#12742). Any other
 * root is a `FlowNodeSchema` member, a spec-structured sibling block or the
 * node-level `timeoutMs`, and is judged against `FlowNodeSchema`'s own shape.
 * A key the contract keeps only as a `[REMOVED]` tombstone counts as
 * undeclared: the loader refuses it with the upgrade prescription.
 *
 * The contracts come from the spec's own tables: `getBuiltinNodeConfigContracts()`
 * (the schema each builtin executor parses its config against),
 * `SCHEMALESS_NODE_CONFIG_SCHEMAS` and `LEDGER_DECLARED_NODE_CONFIG_SCHEMAS`.
 * Two associations are made here because the spec does not export them as a
 * table: `end` to `EndConfigSchema` (the one type-scoped arm `FlowNodeSchema`
 * applies to an open `config`) and the approval node type to
 * `ApprovalNodeConfigSchema` (the spec's declared-plugin-contract map is not
 * exported). Only the association is local; every key set is read from the
 * installed spec, never restated.
 *
 * ## What is not judged, each re-measured so an exemption cannot outlive it
 *
 *  - A field gated behind the never-matching `__legacy__` controller. It is
 *    never offered: it renders only while the node already stores the key, so
 *    it cannot introduce one.
 *  - A virtual column (`VIRTUAL_COLUMNS`): projected from the out-edges and
 *    stripped before the branch is stored.
 *  - A group no published contract judges (`NO_CONTRACT`). Each row must
 *    still write a config key, and no spec node type rendering the group may
 *    have a contract, so the day the spec publishes one the row reddens.
 *
 * The second half of this file is the rendered reading for a flow that
 * already carries one of the removed keys.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';

// Same doubles as the sibling flow-node suites: the engine config-schema hook
// publishes nothing, so the FALLBACK table is what renders, which is the
// subject of this file; object fields resolve empty.
vi.mock('../previews/useFlowNodePalette', () => ({
  useActionConfigSchemas: () => ({}),
  useFlowNodePalette: () => [],
}));
vi.mock('../previews/useObjectFields', () => ({
  useObjectFields: () => ({ fields: [], loading: false, error: null }),
}));

// ⛔ The `/automation` subpath is load bearing: these read `undefined` off the
// package root.
import * as Automation from '@objectstack/spec/automation';
// The Zod wrapper-key vocabulary the sibling spec walks read (objectui#6923).
import { ZOD_WRAPPER_KEYS } from '@object-ui/test-support';
import { FlowNodeInspector } from './FlowNodeInspector';
import {
  fieldsForNodeType,
  FLOW_NODE_CONFIG_TYPES,
  localizeFlowFields,
  type FlowConfigColumn,
  type FlowConfigField,
} from './flow-node-config';
import { flowFieldZh } from '../i18n';
import type { MetadataSelection } from '../preview-registry';

/* ── The contract walk ────────────────────────────────────────────────────── */

type ZodDef = Record<string, unknown>;

function defOf(schema: unknown): ZodDef | undefined {
  const s = schema as { _def?: ZodDef; def?: ZodDef } | undefined;
  return s?._def ?? s?.def;
}

/** The object shape behind a schema that may be wrapped (optional, default, pipe, refinement). */
function objectShape(schema: unknown, depth = 0): Record<string, unknown> | null {
  const s = schema as { shape?: unknown } | undefined;
  if (!s || depth > 10) return null;
  if (s.shape && typeof s.shape === 'object') return s.shape as Record<string, unknown>;
  const def = defOf(s);
  if (!def) return null;
  if (def.shape && typeof def.shape === 'object') return def.shape as Record<string, unknown>;
  for (const key of ZOD_WRAPPER_KEYS) {
    const found = def[key] ? objectShape(def[key], depth + 1) : null;
    if (found) return found;
  }
  return null;
}

/** The element schema behind an array schema that may be wrapped. */
function arrayElement(schema: unknown, depth = 0): unknown {
  const def = defOf(schema);
  if (!def || depth > 10) return undefined;
  if (def.element) return def.element;
  for (const key of ZOD_WRAPPER_KEYS) {
    const found = def[key] ? arrayElement(def[key], depth + 1) : undefined;
    if (found) return found;
  }
  return undefined;
}

/** A `retiredKey()` tombstone: kept in the shape only so its refusal carries the prescription. */
function isTombstone(schema: unknown): boolean {
  const description = (schema as { description?: unknown } | undefined)?.description;
  return typeof description === 'string' && description.startsWith('[REMOVED]');
}

/** The array-element step in a written path. */
const EACH = '[]';

const fmt = (path: readonly string[]) => path.join('.').split(`.${EACH}`).join(EACH);

/**
 * Why `path` is not declared under `schema`, or `null` when it is. One object
 * level per segment; {@link EACH} steps into an array's element. A shape the
 * walk cannot resolve is a finding, not a pass: a walk that stopped resolving
 * must not read as a contract that declares everything.
 */
function undeclaredAt(schema: unknown, path: readonly string[]): string | null {
  let cur = schema;
  const walked: string[] = [];
  for (const seg of path) {
    if (seg === EACH) {
      const element = arrayElement(cur);
      if (!element) return `the contract has no array at ${fmt(walked)}`;
      cur = element;
      walked.push(seg);
      continue;
    }
    const shape = objectShape(cur);
    if (!shape) return `the contract exposes no object shape at ${fmt(walked) || 'its root'}`;
    if (!(seg in shape)) return `'${seg}' is not declared`;
    if (isTombstone(shape[seg])) return `'${seg}' is a retired tombstone`;
    cur = shape[seg];
    walked.push(seg);
  }
  return null;
}

/* ── The node types and their contracts, read from the spec ───────────────── */

const LEDGER = Automation.LEDGER_DECLARED_NODE_CONFIG_SCHEMAS as Record<string, unknown>;
const SCHEMALESS = Automation.SCHEMALESS_NODE_CONFIG_SCHEMAS as Record<string, unknown>;

/** The two associations the spec does not export as a table (see the header). */
const LOCAL_ASSOCIATIONS: Record<string, () => unknown> = {
  end: () => Automation.EndConfigSchema,
  [Automation.APPROVAL_NODE_TYPE]: () => Automation.ApprovalNodeConfigSchema,
};

/** The schema a node of `nodeType` has its `config` judged against, if the spec publishes one. */
function configContractOf(nodeType: string): unknown {
  return (
    Automation.getBuiltinNodeConfigContracts().get(nodeType)?.schema ??
    SCHEMALESS[nodeType] ??
    LEDGER[nodeType] ??
    LOCAL_ASSOCIATIONS[nodeType]?.()
  );
}

/** Every node type the installed spec names, from its own lists. */
const SPEC_NODE_TYPES: readonly string[] = [
  ...new Set<string>([
    ...Automation.FLOW_BUILTIN_NODE_TYPES,
    ...Automation.getBuiltinNodeConfigContracts().keys(),
    ...Object.keys(SCHEMALESS),
    ...Object.keys(LEDGER),
    Automation.APPROVAL_NODE_TYPE,
    Automation.PARALLEL_NODE_TYPE,
    Automation.TRY_CATCH_NODE_TYPE,
    Automation.LOOP_NODE_TYPE,
  ]),
];

/**
 * The spec node types the inspector renders `group` for. `fieldsForNodeType`
 * answers the table's own array for every type it resolves (aliases
 * included), so the same array is the same group.
 */
function renderingTypes(group: string): string[] {
  const fields = fieldsForNodeType(group);
  return SPEC_NODE_TYPES.filter((t) => fieldsForNodeType(t) === fields);
}

/* ── What a group writes ──────────────────────────────────────────────────── */

const isLegacyGated = (f: FlowConfigField) => f.showWhen?.field === '__legacy__';

/**
 * Columns projected from somewhere else and stripped before the value is
 * stored, so they introduce no key. Each row is re-measured below.
 */
const VIRTUAL_COLUMNS: ReadonlyArray<{ group: string; list: string; column: string; reason: string }> = [
  {
    group: 'decision',
    list: 'conditions',
    column: 'target',
    reason:
      'derived from the out-edges and stripped from the stored branch by `applyDecisionBranches` ' +
      "(flow-decision-edges.test.ts: 'strips the virtual target column from the stored conditions')",
  },
];

/**
 * Groups that write config keys no published contract judges. Each row is
 * re-measured below: it must still write a config key, and no spec node type
 * rendering it may have a contract.
 */
const NO_CONTRACT: Readonly<Record<string, string>> = {
  start:
    "The start node's config carries the flow's TRIGGER parameters. `FlowNodeSchema` leaves `config` open " +
    'and the spec publishes no contract for a start node, so there is nothing to read its keys from.',
  legacy_action:
    'Rendered only for the pre-spec `action` / `task` node types, which no spec node type names and no ' +
    'executor runs.',
};

interface Write {
  readonly path: readonly string[];
  readonly field: string;
}

function columnWrites(group: string, field: string, base: readonly string[], columns: readonly FlowConfigColumn[]): Write[] {
  const out: Write[] = [];
  for (const column of columns) {
    const path = [...base, column.key];
    const virtual = VIRTUAL_COLUMNS.some(
      (v) => v.group === group && fmt(path) === fmt(['config', v.list, EACH, v.column]),
    );
    if (virtual) continue;
    out.push({ path, field });
    if (column.kind === 'objectList') out.push(...columnWrites(group, field, [...path, EACH], column.columns ?? []));
  }
  return out;
}

/** Every key `fields` can introduce onto a node of `group`. */
function writesOf(group: string, fields: readonly FlowConfigField[]): Write[] {
  const out: Write[] = [];
  for (const f of fields) {
    if (isLegacyGated(f)) continue;
    out.push({ path: f.path, field: f.id });
    if (f.kind === 'objectList') out.push(...columnWrites(group, f.id, [...f.path, EACH], f.columns ?? []));
  }
  return out;
}

/** One line per written key its contract does not declare, naming the group, the node type and the key. */
function violationsOf(group: string, fields: readonly FlowConfigField[]): string[] {
  const types = renderingTypes(group);
  const out: string[] = [];
  for (const write of writesOf(group, fields)) {
    if (write.path[0] === 'config') {
      for (const type of types) {
        const contract = configContractOf(type);
        if (!contract) continue;
        const why = undeclaredAt(contract, write.path.slice(1));
        if (why) out.push(`${group} (node type '${type}') writes ${fmt(write.path)}: ${why} in its config contract`);
      }
    } else {
      const why = undeclaredAt(Automation.FlowNodeSchema, write.path);
      if (why) out.push(`${group} writes ${fmt(write.path)}: ${why} in FlowNodeSchema`);
    }
  }
  return out;
}

const field = (path: string[]): FlowConfigField => ({ id: path.join('.'), path, label: path.join('.'), kind: 'text' });

/* ── 1. The instrument fires ──────────────────────────────────────────────── */

describe('the contract walk can fail, at every depth it judges (objectui#11968)', () => {
  it('resolves the groups the inspector renders for spec node types', () => {
    // The lit control for `renderingTypes`: without it, a group no type
    // resolved to would be judged against nothing and read as clean.
    expect(renderingTypes('http'), 'the http group is the form for an `http` node').toEqual(['http']);
    expect(renderingTypes('notify')).toEqual(['notify']);
    expect(renderingTypes('legacy_action'), 'and no spec node type renders the legacy group').toEqual([]);
  });

  it('flags an undeclared config key, naming the group, the node type and the key', () => {
    const stray = [...fieldsForNodeType('http'), field(['config', 'outputVariable'])];
    expect(violationsOf('http', stray)).toEqual([
      "http (node type 'http') writes config.outputVariable: 'outputVariable' is not declared in its config contract",
    ]);
  });

  it('flags one inside a nested block, an array element and a sibling block, and a tombstone', () => {
    expect(violationsOf('approval', [field(['config', 'escalation', 'bogusKey'])])).toEqual([
      "approval (node type 'approval') writes config.escalation.bogusKey: 'bogusKey' is not declared in its config contract",
    ]);
    expect(violationsOf('screen', [field(['config', 'fields', EACH, 'bogusKey'])])).toEqual([
      "screen (node type 'screen') writes config.fields[].bogusKey: 'bogusKey' is not declared in its config contract",
    ]);
    expect(violationsOf('wait', [field(['waitEventConfig', 'bogusKey'])])).toEqual([
      "wait writes waitEventConfig.bogusKey: 'bogusKey' is not declared in FlowNodeSchema",
    ]);
    // `script.template` survives in the shape only as a `[REMOVED]` tombstone.
    expect(violationsOf('script', [field(['config', 'template'])])).toEqual([
      "script (node type 'script') writes config.template: 'template' is a retired tombstone in its config contract",
    ]);
  });

  it('and passes a declared key at each of those depths', () => {
    expect(
      violationsOf('approval', [
        field(['config', 'escalation', 'timeoutHours']),
        field(['config', 'approvers', EACH, 'resolveAs']),
      ]),
    ).toEqual([]);
    expect(violationsOf('screen', [field(['config', 'fields', EACH, 'visibleWhen'])])).toEqual([]);
    expect(violationsOf('wait', [field(['waitEventConfig', 'timerDuration'])])).toEqual([]);
    expect(violationsOf('http', [field(['timeoutMs']), field(['config', 'url'])])).toEqual([]);
  });
});

/* ── 2. The pin ───────────────────────────────────────────────────────────── */

describe('every key a fallback group writes is declared by its node contract (objectui#11968)', () => {
  it('no fallback group writes a key its contract does not declare', () => {
    const violations = FLOW_NODE_CONFIG_TYPES.flatMap((group) => violationsOf(group, fieldsForNodeType(group)));
    expect(violations, 'each line names the group, the node type and the key').toEqual([]);
  });

  it('the judgement is not vacuous: it reaches every depth on the real table', () => {
    // Keys at every depth the walk judges, read off the REAL groups, so a walk
    // that stopped collecting them cannot report a clean nothing.
    const judged = FLOW_NODE_CONFIG_TYPES.flatMap((group) =>
      writesOf(group, fieldsForNodeType(group)).map((w) => `${group}:${fmt(w.path)}`),
    );
    expect(judged).toEqual(
      expect.arrayContaining([
        'http:config.url',
        'http:timeoutMs',
        'notify:config.actionUrl',
        'approval:config.escalation.enabled',
        'approval:config.approvers[].resolveAs',
        'screen:config.fields[].visibleWhen',
        'decision:config.conditions[].expression',
        'wait:waitEventConfig.eventType',
        'connector_action:connectorConfig.actionId',
      ]),
    );
    expect(judged, 'the virtual column is not among the keys judged').not.toContain('decision:config.conditions[].target');
  });

  it('every group is judged, writes no config key, or is a registered no-contract group', () => {
    const unaccounted: string[] = [];
    for (const group of FLOW_NODE_CONFIG_TYPES) {
      const writesConfig = writesOf(group, fieldsForNodeType(group)).some((w) => w.path[0] === 'config');
      const judgedBy = renderingTypes(group).filter((t) => configContractOf(t) !== undefined);
      if (group in NO_CONTRACT) {
        expect(writesConfig, `${group}: writes no config key, so its NO_CONTRACT row is not needed`).toBe(true);
        expect(judgedBy, `${group}: a contract now judges it; delete its NO_CONTRACT row`).toEqual([]);
        continue;
      }
      if (writesConfig && judgedBy.length === 0) unaccounted.push(group);
    }
    expect(unaccounted, 'groups writing config keys that no contract judges and no row explains').toEqual([]);
  });

  it.each(VIRTUAL_COLUMNS)('$group: the virtual $column column still exists and is still undeclared', ({ group, list, column }) => {
    const owner = fieldsForNodeType(group).find((f) => f.path[0] === 'config' && f.path[1] === list);
    expect(owner?.columns?.some((c) => c.key === column), `${group}: the ${column} column is still offered`).toBe(true);
    const types = renderingTypes(group);
    expect(types.length, `${group}: a spec node type renders the group`).toBeGreaterThan(0);
    for (const type of types) {
      expect(
        undeclaredAt(configContractOf(type), [list, EACH, column]),
        `${type}: the contract now declares ${list}[].${column}; the row is no longer an exemption`,
      ).not.toBeNull();
    }
  });
});

/* ── 3. A flow that already carries a removed key ─────────────────────────── */

const META_PREFIX = '/api/v1/meta/';
let metaCalls: string[] = [];
const routeOf = (url: string) => url.split('?')[0];

beforeEach(() => {
  metaCalls = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: unknown) => {
      const url = String(
        input && typeof input === 'object' && 'url' in input ? (input as { url: unknown }).url : input,
      );
      metaCalls.push(url);
      const route = routeOf(url);
      if (!route.startsWith(META_PREFIX)) {
        return { ok: false, status: 404, headers: new Headers(), json: async () => ({}) };
      }
      return {
        ok: true,
        status: 200,
        headers: new Headers(),
        json: async () => ({ type: route.slice(META_PREFIX.length), items: [] }),
      };
    }),
  );
});

afterEach(() => {
  expect(metaCalls.filter((url) => !routeOf(url).startsWith(META_PREFIX))).toEqual([]);
  // Unmount BEFORE restoring the real `fetch` (objectui#7439).
  cleanup();
  vi.unstubAllGlobals();
});

function renderNode(type: string, config: Record<string, unknown>) {
  const onPatch = vi.fn();
  render(
    <FlowNodeInspector
      type="flow"
      name="renewal"
      draft={{ nodes: [{ id: 'n1', type, label: 'N', config }], edges: [] }}
      selection={{ kind: 'node', id: 'n1' } as MetadataSelection}
      onPatch={onPatch}
      onClearSelection={vi.fn()}
      readOnly={false}
      locale="en-US"
    />,
  );
  return { onPatch };
}

const lastConfig = (onPatch: ReturnType<typeof vi.fn>) => {
  const written = onPatch.mock.calls.at(-1)?.[0] as { nodes?: Array<Record<string, unknown>> } | undefined;
  return (written?.nodes?.[0]?.config ?? {}) as Record<string, unknown>;
};

/** The Advanced (JSON) editor, found by the placeholder `FlowNodeInspector` gives it. */
const advancedEditor = () => screen.queryByPlaceholderText('{ }') as HTMLTextAreaElement | null;

describe('an http node that already stores `outputVariable` (objectui#11968)', () => {
  const STORED = { method: 'POST', url: 'https://api.example.com/v1/charge', outputVariable: 'charge' };

  it('the contract refuses the stored key by name, with the same config minus the key accepted', () => {
    const { outputVariable: _stray, ...rest } = STORED;
    expect(Automation.HttpConfigSchema.safeParse(rest).success, 'the lit control: the rest is accepted').toBe(true);
    const parsed = Automation.HttpConfigSchema.safeParse(STORED);
    expect(parsed.success).toBe(false);
    expect(parsed.error?.issues.map((i) => i.code)).toEqual(['unrecognized_keys']);
  });

  it('renders without a typed control for it, and shows it in Advanced (JSON) rather than hiding it', () => {
    renderNode('http', STORED);
    expect(screen.queryByText('Output variable'), 'no Output variable row on the http fallback form').toBeNull();
    expect(screen.getByDisplayValue(STORED.url), 'the lit control: this render drew the http form').toBeTruthy();
    expect(JSON.parse(advancedEditor()!.value), 'the stored key is on screen, verbatim').toEqual({ outputVariable: 'charge' });
    cleanup();

    // The same query, one render away, on a node whose contract declares the key.
    renderNode('get_record', { objectName: 'account', outputVariable: 'records' });
    expect(screen.queryByText('Output variable'), 'and it still finds the row where the key is declared').not.toBeNull();
  });

  it('an unrelated edit keeps the stored key and every other key: nothing is dropped silently', () => {
    // The measurement H4 asked for: the inspector writes the edited path only,
    // so the stray key rides through the edit unchanged and stays in front of
    // the author in Advanced (JSON); it is not stripped behind their back.
    const { onPatch } = renderNode('http', STORED);
    const url = screen.getByDisplayValue(STORED.url);
    fireEvent.change(url, { target: { value: 'https://api.example.com/v2/charge' } });
    fireEvent.blur(url);
    expect(lastConfig(onPatch)).toEqual({ ...STORED, url: 'https://api.example.com/v2/charge' });
  });

  it('clearing it in Advanced (JSON) leaves a config the contract accepts', () => {
    const { onPatch } = renderNode('http', STORED);
    const advanced = advancedEditor()!;
    fireEvent.change(advanced, { target: { value: '{}' } });
    fireEvent.blur(advanced);
    const config = lastConfig(onPatch);
    expect('outputVariable' in config, 'the clear removes the key').toBe(false);
    expect(config, 'and the form-owned keys survive the Advanced commit').toEqual({ method: 'POST', url: STORED.url });
    expect(Automation.HttpConfigSchema.safeParse(config).success).toBe(true);
  });
});

describe('the notify Click-through URL row writes `actionUrl` (objectui#11968)', () => {
  const BASE = { title: 'Approved', recipients: ['usr_1'] };

  it('the contract declares `actionUrl` and refuses `url` by name', () => {
    expect(Automation.NotifyConfigSchema.safeParse({ ...BASE, actionUrl: 'https://x.test/a' }).success).toBe(true);
    const parsed = Automation.NotifyConfigSchema.safeParse({ ...BASE, url: 'https://x.test/a' });
    expect(parsed.success).toBe(false);
    expect(parsed.error?.issues.map((i) => i.code)).toEqual(['unrecognized_keys']);
  });

  it('the row reads and writes `config.actionUrl`', () => {
    const { onPatch } = renderNode('notify', { ...BASE, actionUrl: 'https://x.test/old' });
    expect(advancedEditor(), 'a stored actionUrl is owned by the row, not left to Advanced').toBeNull();
    const control = screen.getByDisplayValue('https://x.test/old');
    fireEvent.change(control, { target: { value: 'https://x.test/new' } });
    fireEvent.blur(control);
    const config = lastConfig(onPatch);
    expect(config.actionUrl).toBe('https://x.test/new');
    expect('url' in config, 'and writes no alias beside it').toBe(false);
    expect(Automation.NotifyConfigSchema.safeParse(config).success).toBe(true);
  });

  it('a stored `url` is not hidden: it shows in Advanced (JSON)', () => {
    renderNode('notify', { ...BASE, url: 'https://x.test/legacy' });
    expect(JSON.parse(advancedEditor()!.value)).toEqual({ url: 'https://x.test/legacy' });
  });

  it('the zh overlay follows the key, so the renamed row keeps its translation', () => {
    // The overlay is keyed by field id; a row renamed without it would fall
    // back to English in zh-CN on both forms.
    const en = fieldsForNodeType('notify');
    const zh = localizeFlowFields('notify', en, 'zh-CN');
    const label = (fields: FlowConfigField[], id: string) => fields.find((f) => f.id === id)?.label;
    expect(label(zh, 'title'), 'the lit control: a sibling row is translated').not.toBe(label(en, 'title'));
    expect(label(zh, 'actionUrl')).toBe(flowFieldZh('notify', 'actionUrl')?.label);
    expect(label(zh, 'actionUrl'), 'and the translation differs from the English label').not.toBe(label(en, 'actionUrl'));
  });
});
