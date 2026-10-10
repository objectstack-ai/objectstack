// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * **The pin that closes the "user-read flow text with no translation key"
 * family (#22507).**
 *
 * The family was closed one string at a time — the screen field's help text,
 * the launcher's flow label, the refused `end` node's message, then a screen
 * field's option labels and the terminal toasts — and each time the hole was
 * found the same way: a fully translated app showed an English string to a
 * user, and no bundle the author could write reached it. This file moves that
 * discovery from a locale to the test run.
 *
 * It walks the flow schemas MECHANICALLY and lists every text-bearing slot (a
 * leaf that accepts a string), then holds each one against a recorded
 * disposition:
 *
 *  - `keyed`      — the slot's key in `TranslationDataSchema.flows`, which must
 *                   exist in the face (parsed and kept, not stripped);
 *  - `noReader`   — no person running the flow reads it as text (a machine
 *                   name, a predicate, a value the run binds, design-time copy
 *                   only Studio draws), with the reason;
 *  - `elsewhere`  — a person reads it, and it is localized through another
 *                   declared route, which must exist;
 *  - `owed`       — a person reads it and nothing translates it yet. The set is
 *                   pinned EXACTLY, so it can only shrink by a deliberate edit,
 *                   and each row names the decision it waits on.
 *
 * So a slot added to these schemas without a key fails here as UNCLASSIFIED;
 * a `keyed` row whose face key is dropped fails here; and a face key no slot
 * points at (a key nothing could ever fill) fails here too.
 *
 * Two tiers, by what the screen-flow runner draws:
 *
 *  1. **Every** text-bearing leaf of the schemas whose copy the runner shows —
 *     `FlowSchema` (its `nodes` judged per node below), `FlowNodeSchema` (its
 *     `config` judged per type), the `screen` node's `ScreenConfigSchema` and
 *     the `end` node's `EndConfigSchema`.
 *  2. For every OTHER node contract the spec declares (the builtin executor
 *     contracts and the `approval` plugin contract), every text-bearing leaf
 *     whose NAME is a copy word (`label`, `title`, `message`, …), plus every
 *     server-rendered text slot of any node type (`FLOW_NODE_TEXT_SLOTS`).
 *     Region slots (`loop.body`, `parallel.branches`, `try_catch.try|catch`)
 *     hold `FlowNode`s and are judged by tier 1.
 */

import { describe, expect, it } from 'vitest';
import { FlowSchema, FlowNodeSchema } from '../automation/flow.zod';
import { EndConfigSchema, ScreenConfigSchema } from '../automation/builtin-node-config.zod';
import { NotifyConfigSchema } from '../automation/io-node-config.zod';
import { ApprovalNodeConfigSchema, APPROVAL_NODE_TYPE } from '../automation/approval.zod';
import { getBuiltinNodeConfigContracts } from '../automation/flow-node-config-refusals';
import { FLOW_REGION_SLOTS_BY_TYPE } from '../automation/region-slots';
import { FLOW_NODE_TEXT_SLOTS } from '../automation/flow-text-slot-template';
import { TranslationDataSchema } from './translation.zod';

// ── The dispositions ────────────────────────────────────────────────────────

/**
 * A face path under `flows.<flow_name>`, with the three record positions
 * spelled `NODE` (a node id), `FIELD` (a screen field name) and `VALUE` (an
 * option value read as text).
 */
type FacePath = string;

type Disposition =
  | { readonly keyed: FacePath; readonly note?: string }
  | { readonly noReader: string }
  | { readonly elsewhere: string }
  | { readonly owed: string };

const keyed = (path: FacePath, note?: string): Disposition => ({ keyed: path, ...(note ? { note } : {}) });
const noReader = (reason: string): Disposition => ({ noReader: reason });

const FRAMEWORK_FIELD =
  'framework provenance or lock metadata (ADR-0010), written by the platform or a package author for whoever edits '
  + 'the flow in Studio, never drawn for a person running it';

/**
 * Tier 1 — every text-bearing leaf of the schemas the screen-flow runner
 * draws from. A row covers its own path and everything under it, so a whole
 * machine sub-tree (`edges[].condition`, `connectorConfig`) is one row; a
 * `keyed` row must name exactly one leaf.
 */
const RUNNER_SLOTS: Readonly<Record<string, Disposition>> = {
  // FlowSchema
  'flow.name': noReader("the flow's machine name — the address of its `flows.<flow_name>` group, never drawn as text"),
  'flow.label': keyed('label', 'the runner header and the completion toast name the flow by it'),
  'flow.description': noReader(
    "design-time copy: Studio's metadata viewer draws it as the flow's subtitle for whoever maintains the flow; "
    + 'the runner, its launchers and the toasts never show it',
  ),
  'flow.successMessage': keyed('successMessage', 'the completion toast'),
  'flow.errorMessage': keyed('errorMessage', 'the failure toast'),
  'flow.variables[].name': noReader('a variable name — the binding a screen field or node writes to'),
  'flow.variables[].type': noReader('a data-type token'),
  'flow.variables[].defaultValue': noReader('a value the run binds, not text it shows'),
  'flow.edges[].id': noReader('an edge id'),
  'flow.edges[].source': noReader('a node id the edge leaves'),
  'flow.edges[].target': noReader('a node id the edge enters'),
  'flow.edges[].condition': noReader('a CEL predicate the engine evaluates (its `meta` is authoring provenance)'),
  'flow.edges[].label': noReader('designer-canvas text on the connector; no runner draws an edge'),
  'flow.protection': noReader(FRAMEWORK_FIELD),
  'flow._lockReason': noReader(FRAMEWORK_FIELD),
  'flow._packageId': noReader(FRAMEWORK_FIELD),
  'flow._packageVersion': noReader(FRAMEWORK_FIELD),
  'flow._lockDocsUrl': noReader(FRAMEWORK_FIELD),

  // FlowNodeSchema (its `config` is judged per type below)
  'node.id': noReader('the node id — the address of `screens.<node_id>` and `refusals.<node_id>`'),
  'node.type': noReader('a node-type token'),
  'node.label': keyed(
    'screens.NODE.title',
    "a screen's fallback heading (`config.title ?? node.label`), which the one `title` key covers; on any other node "
      + 'it is designer-canvas text',
  ),
  'node.connectorConfig': noReader('connector and action ids, and input values the engine resolves'),
  'node.inputSchema': noReader("design-time parameter declarations for the designer's input mapping"),
  'node.waitEventConfig': noReader('timer and signal tokens'),
  'node.boundaryConfig': noReader('a boundary event binding — node ids, error codes, timer and signal tokens'),

  // ScreenConfigSchema (a `screen` node's config)
  'screen.title': keyed('screens.NODE.title', 'the heading above the screen'),
  'screen.description': {
    owed:
      'the body text under the heading. The server renders it per run as a `{{ }}` template (`renderTextSlot` in '
      + 'the screen executor), so a translation must be picked BEFORE that render, as the refusal message is — an '
      + 'overlay on the served string would draw a translated hole literally. Which reader picks it (the engine in '
      + "the run's locale, or the runner over a static description only) is the decision this row waits on.",
  },
  'screen.fields[].name': noReader('the field name — the address of `fields.<field_name>`, and the variable the value binds'),
  'screen.fields[].label': keyed('screens.NODE.fields.FIELD.label'),
  'screen.fields[].type': noReader('a widget token'),
  'screen.fields[].options[].value': noReader('the stored value — and the option\'s address as text, `options.<value>`'),
  'screen.fields[].options[].label': keyed('screens.NODE.fields.FIELD.options.VALUE', 'the select item'),
  'screen.fields[].defaultValue': noReader(
    'a prefilled VALUE the user may submit unchanged — translating it would change the data the flow receives',
  ),
  'screen.fields[].placeholder': keyed('screens.NODE.fields.FIELD.placeholder'),
  'screen.fields[].visibleWhen': noReader('a CEL predicate the client evaluates'),
  'screen.fields[].inlineHelpText': keyed('screens.NODE.fields.FIELD.inlineHelpText', 'the help line under the input'),
  'screen.fields[].reference': noReader('an object name — the lookup target'),
  'screen.objectName': noReader(
    "an object name — an object-form screen draws that object's own form, translated under `objects.<object>`",
  ),
  'screen.idVariable': noReader('a variable name'),
  'screen.recordId': noReader('a record id the object form edits'),
  'screen.defaults': noReader("prefilled values for the object form's fields"),

  // EndConfigSchema (an `end` node's config)
  'end.message': keyed('refusals.NODE.message', "a refused run's notice, picked by the engine in the run's locale"),
};

/**
 * Tier 2 — the copy-named text leaves of every OTHER node contract the spec
 * declares, and every server-rendered text slot of a non-runner node type.
 */
const OTHER_NODE_SLOTS: Readonly<Record<string, Disposition>> = {
  'notify.title': {
    elsewhere:
      "the notify node's localizable path is `template` — a `sys_email_template` row picked by `(name, locale)` per "
      + 'recipient at delivery; the inline `title` / `message` pair is declared not localizable',
  },
  'notify.message': {
    elsewhere:
      "the notify node's localizable path is `template` (see `notify.title`); the inline body is declared not "
      + 'localizable',
  },
  'http.body': noReader('the request body sent to the endpoint'),
  [`${APPROVAL_NODE_TYPE}.decisionOutputs[].label`]: {
    owed:
      "the approver reads it as an input label in the approval decision dialog. No translation face addresses an "
      + "approval node's copy — a surface of its own, outside the screen-flow runner's `flows` face, and a decision "
      + 'for that surface.',
  },
};

/** The `owed` rows, pinned EXACTLY: a row leaves only by gaining a key or a route. */
const OWED = ['screen.description', `${APPROVAL_NODE_TYPE}.decisionOutputs[].label`];

// ── The walk ────────────────────────────────────────────────────────────────

const defOf = (s: any): any => s && (s._zod?.def ?? s._def);

function unwrap(s: any, depth = 0): any {
  const def = defOf(s);
  if (!def || depth > 24) return s;
  if (def.type === 'lazy') return unwrap(def.getter(), depth + 1);
  if (['optional', 'default', 'nullable', 'readonly', 'catch', 'nonoptional', 'prefault'].includes(def.type)) {
    return unwrap(def.innerType, depth + 1);
  }
  if (def.type === 'pipe') {
    // `z.preprocess` / `.transform` compile to a pipe whose authorable side is
    // the one that is not the transform.
    const inDef = defOf(unwrap(def.in, depth + 1));
    return unwrap(inDef?.type === 'transform' ? def.out : def.in, depth + 1);
  }
  return s;
}

/** The leaf kinds that can carry text an author wrote. */
const TEXT_KINDS = new Set(['string', 'unknown', 'any', 'template_literal']);

/**
 * Every text-bearing leaf under `schema`, as a path (`fields[].options[].label`,
 * `defaults.*`). `stop` prunes a sub-tree judged elsewhere.
 */
function textLeaves(schema: unknown, stop: (path: string) => boolean = () => false): Set<string> {
  const out = new Set<string>();
  const seen = new Set<unknown>();
  const walk = (s: unknown, path: string): void => {
    if (path && stop(path)) return;
    const u = unwrap(s);
    const def = defOf(u);
    if (!def) return;
    switch (def.type) {
      case 'object': {
        if (seen.has(u)) return;
        seen.add(u);
        for (const [key, child] of Object.entries(def.shape ?? (u as any).shape ?? {})) {
          walk(child, path ? `${path}.${key}` : key);
        }
        seen.delete(u);
        return;
      }
      case 'array':
        walk(def.element, `${path}[]`);
        return;
      case 'record':
        walk(def.valueType, path ? `${path}.*` : '*');
        return;
      case 'union':
        for (const option of def.options) walk(option, path);
        return;
      default:
        if (TEXT_KINDS.has(def.type)) out.add(path);
    }
  };
  walk(schema, '');
  return out;
}

const prefixed = (scope: string, leaves: Iterable<string>) => [...leaves].map((leaf) => `${scope}.${leaf}`);

/** Tier 1's population. */
function runnerLeaves(): string[] {
  return [
    ...prefixed('flow', textLeaves(FlowSchema, (p) => p === 'nodes')),
    ...prefixed('node', textLeaves(FlowNodeSchema, (p) => p === 'config')),
    ...prefixed('screen', textLeaves(ScreenConfigSchema)),
    ...prefixed('end', textLeaves(EndConfigSchema)),
  ];
}

/** A copy word, as the last segment of a leaf path. */
const COPY_WORD =
  /(^|\.)(label|title|description|message|placeholder|helpText|inlineHelpText|caption|subtitle|heading|hint|tooltip|text|subject|body|prompt|instructions|reason)$/i;

/** Tier 2's population: copy-named text leaves of every other declared node contract. */
function otherNodeLeaves(): string[] {
  const contracts = new Map<string, unknown>(
    [...getBuiltinNodeConfigContracts()].map(([type, contract]) => [type, contract.schema]),
  );
  contracts.set(APPROVAL_NODE_TYPE, ApprovalNodeConfigSchema);
  const out: string[] = [];
  for (const [type, schema] of contracts) {
    if (type === 'screen') continue; // tier 1
    const regions = new Set((FLOW_REGION_SLOTS_BY_TYPE.get(type) ?? []).map((slot) => slot.key));
    for (const leaf of textLeaves(schema, (p) => regions.has(p.split(/[.[]/)[0]!))) {
      if (COPY_WORD.test(leaf.replace(/\[\]/g, '').replace(/\.\*/g, ''))) out.push(`${type}.${leaf}`);
    }
  }
  return out;
}

/** The row that classifies `leaf`: its exact row, else the nearest ancestor row. */
function rowFor(ledger: Readonly<Record<string, Disposition>>, leaf: string): string | undefined {
  if (leaf in ledger) return leaf;
  const ancestors = Object.keys(ledger).filter((row) => leaf.startsWith(`${row}.`) || leaf.startsWith(`${row}[]`));
  return ancestors.sort((a, b) => b.length - a.length)[0];
}

/** The face path with its record positions as `*` — the shape the face walk reports. */
const facePattern = (path: FacePath) => path.replace(/\b(NODE|FIELD|VALUE)\b/g, '*');

/** A `flows.<flow>` entry carrying `'x'` at `path` (record positions filled). */
function sampleEntry(path: FacePath): Record<string, unknown> {
  const segments = path.split('.').map((s) => ({ NODE: 'n1', FIELD: 'f1', VALUE: 'v1' } as Record<string, string>)[s] ?? s);
  const root: Record<string, unknown> = {};
  let at = root;
  segments.forEach((segment, i) => {
    if (i === segments.length - 1) at[segment] = 'x';
    else at = (at[segment] = {}) as Record<string, unknown>;
  });
  return root;
}

function readAt(value: unknown, path: FacePath): unknown {
  return path.split('.').reduce<unknown>((at, segment) => {
    const key = ({ NODE: 'n1', FIELD: 'f1', VALUE: 'v1' } as Record<string, string>)[segment] ?? segment;
    return at && typeof at === 'object' ? (at as Record<string, unknown>)[key] : undefined;
  }, value);
}

const flowsFaceSchema = () => (unwrap(TranslationDataSchema) as any)._zod.def.shape.flows;

// ── The pins ────────────────────────────────────────────────────────────────

describe('the flows translation face covers every user-read flow slot (#22507)', () => {
  it('classifies every text-bearing slot of the runner\'s schemas — a new slot without a row fails here', () => {
    const leaves = runnerLeaves();
    // The walk is real: it sees the slots this family closed one at a time.
    for (const known of ['flow.successMessage', 'screen.fields[].options[].label', 'screen.fields[].inlineHelpText', 'end.message']) {
      expect(leaves, known).toContain(known);
    }
    const unclassified = leaves.filter((leaf) => rowFor(RUNNER_SLOTS, leaf) === undefined);
    expect(unclassified, 'text-bearing flow slots with no disposition — key them in the `flows` face or record why').toEqual([]);
  });

  it('classifies every copy-named slot of the other node contracts, and every rendered text slot', () => {
    const leaves = otherNodeLeaves();
    expect(leaves).toContain('notify.title');
    const unclassified = leaves.filter((leaf) => rowFor(OTHER_NODE_SLOTS, leaf) === undefined);
    expect(unclassified, 'copy-named node-config slots with no disposition').toEqual([]);

    // Every slot the engine renders as text, on any node type, is classified.
    const all = { ...RUNNER_SLOTS, ...OTHER_NODE_SLOTS };
    for (const slot of FLOW_NODE_TEXT_SLOTS) {
      expect(rowFor(all, `${slot.nodeType}.${slot.key}`), `${slot.label} has no disposition`).toBeDefined();
    }
  });

  it('keeps no stale row — every row classifies a slot the schemas still declare', () => {
    const runner = runnerLeaves();
    const other = otherNodeLeaves();
    const covers = (row: string, leaves: string[]) => leaves.some((leaf) => leaf === row || rowFor({ [row]: noReader('') }, leaf) === row);
    expect(Object.keys(RUNNER_SLOTS).filter((row) => !covers(row, runner))).toEqual([]);
    expect(Object.keys(OTHER_NODE_SLOTS).filter((row) => !covers(row, other))).toEqual([]);
  });

  it('every `keyed` row names one slot exactly, and its key exists in the face — parsed and kept', () => {
    const runner = new Set(runnerLeaves());
    for (const [row, disposition] of Object.entries(RUNNER_SLOTS)) {
      if (!('keyed' in disposition)) continue;
      expect(runner.has(row), `keyed row ${row} must name a leaf exactly, not a sub-tree`).toBe(true);
      const entry = sampleEntry(disposition.keyed);
      const result = TranslationDataSchema.safeParse({ flows: { f: entry } });
      expect(result.success, `${row} → flows.<flow>.${disposition.keyed}: ${JSON.stringify(result.error?.issues)}`).toBe(true);
      expect(readAt((result as { data: any }).data.flows.f, disposition.keyed), `${row}: the key was stripped`).toBe('x');
    }
  });

  it('every face key is filled from some slot — no key nothing could ever translate', () => {
    const faceLeaves = textLeaves(flowsFaceSchema());
    // The face walk is a record over flow names; its leaves start `*.`.
    const keys = [...faceLeaves].map((leaf) => leaf.replace(/^\*\./, ''));
    const filled = new Set(
      Object.values(RUNNER_SLOTS).flatMap((d) => ('keyed' in d ? [facePattern(d.keyed)] : [])),
    );
    expect(keys.sort()).toEqual([...filled].sort());
  });

  it('pins the owed rows exactly — each a user-read slot nothing translates yet, with its decision named', () => {
    const all = { ...RUNNER_SLOTS, ...OTHER_NODE_SLOTS };
    const owed = Object.entries(all).filter(([, d]) => 'owed' in d).map(([row]) => row);
    expect(owed.sort()).toEqual([...OWED].sort());
    for (const [row, disposition] of Object.entries(all)) {
      const reason = 'noReader' in disposition ? disposition.noReader
        : 'elsewhere' in disposition ? disposition.elsewhere
          : 'owed' in disposition ? disposition.owed : disposition.keyed;
      expect(reason.trim().length, `${row} records no reason`).toBeGreaterThan(0);
    }
  });

  it('an `elsewhere` route exists: the notify contract declares its localizable `template` path', () => {
    const shape = (unwrap(NotifyConfigSchema) as any)._zod.def.shape;
    expect(Object.keys(shape)).toContain('template');
  });
});
