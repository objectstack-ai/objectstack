// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `inactiveRetainedKind` — the "inactive values retained" predicate
 * (objectui#6499, maintainer ruling 2026-08-27, Option C).
 *
 * The defect: `showWhen` gates RENDERING only, and `isFieldVisible` additionally
 * re-shows any field that already holds a stored value ("so existing config is
 * never hidden"). So after an author fills a dependent field and switches its
 * controller back off, the field keeps rendering — as an ordinary, live-looking
 * control. The stored config says one thing, the switch beside it says another,
 * and nothing on screen tells the author which.
 *
 * The ruling KEEPS the value (pruning on save was rejected outright: it deletes
 * config an author entered, and inverts the very rule that stops config from
 * vanishing unseen). What changes is that the state is now NAMED. This file
 * pins the predicate that names it, plus the half that must not move: the
 * re-show rule itself.
 */

import { describe, it, expect } from 'vitest';
import {
  fieldsForNodeType,
  isFieldVisible,
  inactiveRetainedKind,
  FLOW_NODE_CONFIG_TYPES,
  type FlowConfigField,
} from './flow-node-config.js';
import { jsonSchemaToFlowFields } from './json-schema-to-fields.js';
import { connectorInputFields } from './connector-input-fields.js';

const approval = () => fieldsForNodeType('approval');
const field = (fields: FlowConfigField[], id: string) => fields.find((f) => f.id === id)!;

describe('inactiveRetainedKind — the escalation instance the card measured', () => {
  const fields = approval();
  const timeout = () => field(fields, 'escalation.timeoutHours');

  it('flags a dependent value whose controller was switched back off', () => {
    // Exactly the chain on the card: enable, fill, toggle off, save.
    const node = { id: 'a', type: 'approval', config: { escalation: { enabled: false, timeoutHours: 24 } } };
    expect(isFieldVisible(timeout(), node, fields)).toBe(true); // still rendered — the re-show rule
    expect(inactiveRetainedKind(timeout(), node, fields)).toBe('controller-off');
  });

  it('does NOT flag the same value while the controller is on', () => {
    const node = { id: 'a', type: 'approval', config: { escalation: { enabled: true, timeoutHours: 24 } } };
    expect(isFieldVisible(timeout(), node, fields)).toBe(true);
    expect(inactiveRetainedKind(timeout(), node, fields)).toBeNull();
  });

  it('does NOT flag a gated field that holds nothing — it is hidden, not retained', () => {
    const node = { id: 'a', type: 'approval', config: { escalation: { enabled: false } } };
    expect(isFieldVisible(timeout(), node, fields)).toBe(false);
    expect(inactiveRetainedKind(timeout(), node, fields)).toBeNull();
  });

  it('does NOT flag an UNGATED field, however it is filled', () => {
    const ungated = fields.filter((f) => !f.showWhen);
    expect(ungated.length).toBeGreaterThan(0); // control: the node type really has some
    const node = { id: 'a', type: 'approval', config: { escalation: { enabled: false, timeoutHours: 24 } } };
    for (const f of ungated) expect(inactiveRetainedKind(f, node, fields)).toBeNull();
  });

  it('an absent controller value resolves through the spec defaultValue — now ON, so the dependent is LIVE', () => {
    // `escalation.enabled` declares defaultValue 'true', mirroring the installed
    // spec's `.default(true)`: an omitted key means ENABLED, so a stored dependent
    // under it is live config, not retained-but-inert.
    //
    // This assertion flipped from `'controller-off'` to `toBeNull()` when
    // objectui#6620 made the table follow the spec — exactly the flip the previous
    // revision of this comment predicted, and the intended signal rather than a
    // break. (Measured on the spec installed then: 17.2.0 / `.default(false)`.)
    //
    // ⚠️ It still reads only the TABLE, so it cannot see a spec bump on its own.
    // The declaration ↔ installed-spec comparison that CAN detect the next
    // divergence lives in `flow-node-config.spec-reconciliation.test.ts`; #6620's
    // root cause was that no such comparison existed for this key.
    const node = { id: 'a', type: 'approval', config: { escalation: { timeoutHours: 24 } } };
    expect(inactiveRetainedKind(timeout(), node, fields)).toBeNull();
    // Lit control on the same node shape — the ONLY difference is the stored gate.
    // A predicate that had simply stopped flagging anything fails here, so the
    // `toBeNull()` above is a measurement rather than an absence.
    const gateOff = { id: 'a', type: 'approval', config: { escalation: { enabled: false, timeoutHours: 24 } } };
    expect(inactiveRetainedKind(timeout(), gateOff, fields)).toBe('controller-off');
  });

  it('flags every dependent in the group, not just the first', () => {
    const node = {
      id: 'a',
      type: 'approval',
      config: { escalation: { enabled: false, timeoutHours: 24, action: 'reassign', escalateTo: 'sre-lead', notifySubmitter: true } },
    };
    for (const id of ['escalation.timeoutHours', 'escalation.action', 'escalation.escalateTo', 'escalation.notifySubmitter']) {
      expect(inactiveRetainedKind(field(fields, id), node, fields), id).toBe('controller-off');
    }
  });
});

describe('inactiveRetainedKind — the `__legacy__` sentinel is a group too', () => {
  it('reports no-controller for a render-only legacy key holding a value', () => {
    const fields = fieldsForNodeType('decision');
    const condition = field(fields, 'condition');
    expect(condition.showWhen).toEqual({ field: '__legacy__', equals: [] });
    const node = { id: 'd', type: 'decision', config: { condition: 'amount > 10000' } };
    expect(isFieldVisible(condition, node, fields)).toBe(true);
    // NOT 'controller-off': there is no toggle to switch back on, and telling
    // the author to go find one would be a fresh lie on this very screen.
    expect(inactiveRetainedKind(condition, node, fields)).toBe('no-controller');
  });

  it('reports nothing for the same legacy key when it is empty', () => {
    const fields = fieldsForNodeType('decision');
    const condition = field(fields, 'condition');
    const node = { id: 'd', type: 'decision', config: {} };
    expect(isFieldVisible(condition, node, fields)).toBe(false);
    expect(inactiveRetainedKind(condition, node, fields)).toBeNull();
  });
});

/**
 * Coverage is "all `showWhen` groups in the metadata-admin inspectors" (the
 * ruling). This walks the descriptor tables mechanically rather than trusting a
 * hand-written list, so a group added later is covered — or turns this red.
 */
describe('inactiveRetainedKind — mechanical coverage of every showWhen group', () => {
  const TYPE_ALIASES = ['task', 'user_task', 'service_task', 'script_task', 'notification', 'signal', 'for_each'];
  const CANONICAL = [
    'start', 'end', 'decision', 'assignment', 'loop', 'map', 'create_record', 'update_record',
    'delete_record', 'get_record', 'http', 'script', 'screen', 'approval', 'wait',
    'subflow', 'notify', 'connector_action', 'parallel', 'try_catch', 'parallel_gateway',
    'join_gateway', 'boundary_event', 'legacy_action',
  ];
  const TYPES = [...new Set([...CANONICAL, ...FLOW_NODE_CONFIG_TYPES, ...TYPE_ALIASES])];

  /** Write `value` at `field.path` on a fresh node object. */
  function nodeWith(type: string, entries: Array<[string[], unknown]>) {
    const node: Record<string, unknown> = { id: 'n', type };
    for (const [path, value] of entries) {
      let cur = node;
      for (const seg of path.slice(0, -1)) {
        if (typeof cur[seg] !== 'object' || cur[seg] === null) cur[seg] = {};
        cur = cur[seg] as Record<string, unknown>;
      }
      cur[path[path.length - 1]] = value;
    }
    return node;
  }

  const gatedByType = new Map<string, FlowConfigField[]>();
  for (const type of TYPES) {
    const gated = fieldsForNodeType(type).filter((f) => f.showWhen);
    if (gated.length) gatedByType.set(type, gated);
  }

  it('finds the groups the census measured — and does not tag everything', () => {
    // If this drifts, the census in the PR body is stale; re-measure before
    // trusting the coverage claim below.
    // ⚑ RE-MEASURED at landing, not carried over: objectui#9336 gave the `end`
    // node its first `showWhen` field (`config.message`, gated on
    // `outcome === 'refused'`), so `end` became a NEW bucket. 8 -> 9 buckets,
    // 33 -> 34 gated fields, 24 -> 23 ungated types. Triage's standing ruling
    // for the counts objectui#9277/#9278 share applies here too: re-measure at
    // landing time rather than copying a number out of the card.
    // ⚑ RE-MEASURED for objectui#12780: the start node's Entry condition lost
    // its `showWhen` (the engine evaluates it on every run), 34 -> 33.
    // objectui#12742: 23 -> 22 ungated types — `webhook` left the alias list
    // (spec 18 reserves it as a node type), and `http_request` became `http`,
    // a key `FLOW_NODE_CONFIG_TYPES` already contributes.
    expect(gatedByType.size).toBe(9); // 9 (name, ...) buckets — 8 canonical + the `script_task` alias
    const totalGated = [...gatedByType.values()].reduce((n, fs) => n + fs.length, 0);
    expect(totalGated).toBe(33);
    // The discriminating control: most node types have NO showWhen at all, so a
    // predicate that simply said "yes" everywhere would fail here.
    const ungatedTypes = TYPES.filter((t) => !gatedByType.has(t));
    expect(ungatedTypes.length).toBe(22);
    expect(ungatedTypes).toContain('create_record');
    expect(ungatedTypes).toContain('connector_action');
  });

  it('every gated field in every group flags when stored + controller unmet, and not when empty', () => {
    let checked = 0;
    for (const [type, gated] of gatedByType) {
      const fields = fieldsForNodeType(type);
      for (const f of gated) {
        const controller = fields.find((c) => c.id === f.showWhen!.field);
        // Drive the controller to a value its `equals` does NOT contain. For the
        // `__legacy__` sentinel there is no controller and `equals` is empty, so
        // nothing needs driving — it never admits.
        const entries: Array<[string[], unknown]> = [];
        if (controller) {
          const off = controller.kind === 'boolean' ? false : '__not_a_declared_option__';
          entries.push([controller.path, off]);
        }
        // 1. empty dependent → not retained (and, for a real controller, hidden)
        const emptyNode = nodeWith(type, entries);
        expect(inactiveRetainedKind(f, emptyNode, fields), `${type}/${f.id} empty`).toBeNull();

        // 2. stored dependent → visible AND flagged
        const storedNode = nodeWith(type, [...entries, [f.path, f.kind === 'boolean' ? true : 'stored-value']]);
        expect(isFieldVisible(f, storedNode, fields), `${type}/${f.id} visible`).toBe(true);
        expect(inactiveRetainedKind(f, storedNode, fields), `${type}/${f.id} flagged`).toBe(
          controller ? 'controller-off' : 'no-controller',
        );

        // 3. stored dependent + controller ADMITS → visible and NOT flagged
        if (controller && f.showWhen!.equals.length > 0) {
          const on = f.showWhen!.equals[0];
          const onValue = controller.kind === 'boolean' ? on === 'true' : on;
          const liveNode = nodeWith(type, [[controller.path, onValue], [f.path, f.kind === 'boolean' ? true : 'stored-value']]);
          expect(isFieldVisible(f, liveNode, fields), `${type}/${f.id} live visible`).toBe(true);
          expect(inactiveRetainedKind(f, liveNode, fields), `${type}/${f.id} live not flagged`).toBeNull();
        }
        checked += 1;
      }
    }
    expect(checked).toBe(33); // objectui#9336 added `end.message`, objectui#12780 ungated `start.condition` — see the note above.
  });
});

describe('inactiveRetainedKind — the two DERIVED producers, not just the static table', () => {
  // An engine-published configSchema and a connector descriptor both mint
  // `showWhen` groups at runtime, and both funnel through the same filter in
  // FlowNodeInspector — so the affordance covers groups that do not exist in
  // any source file.
  it('covers a group derived from an engine configSchema', () => {
    const fields = jsonSchemaToFlowFields({
      type: 'object',
      properties: {
        retry: { type: 'object', properties: { enabled: { type: 'boolean' }, attempts: { type: 'integer' } } },
      },
    })!;
    const attempts = field(fields, 'retry.attempts');
    expect(attempts.showWhen).toEqual({ field: 'retry.enabled', equals: ['true'] });
    expect(inactiveRetainedKind(attempts, { id: 'n', type: 'x', config: { retry: { enabled: false, attempts: 3 } } }, fields)).toBe('controller-off');
    expect(inactiveRetainedKind(attempts, { id: 'n', type: 'x', config: { retry: { enabled: true, attempts: 3 } } }, fields)).toBeNull();
  });

  it('covers a group derived from a connector input schema', () => {
    const form = connectorInputFields({
      type: 'object',
      properties: { tls: { type: 'object', properties: { enabled: { type: 'boolean' }, caCert: { type: 'string' } } } },
    })!;
    const caCert = field(form.fields, 'connectorConfig.input.tls.caCert');
    const node = { id: 'n', type: 'connector_action', connectorConfig: { input: { tls: { enabled: false, caCert: 'PEM' } } } };
    expect(inactiveRetainedKind(caCert, node, form.fields)).toBe('controller-off');
    const on = { id: 'n', type: 'connector_action', connectorConfig: { input: { tls: { enabled: true, caCert: 'PEM' } } } };
    expect(inactiveRetainedKind(caCert, on, form.fields)).toBeNull();
  });
});

/**
 * The half that must NOT move. `isFieldVisible` keeps re-showing stored values;
 * the ruling forbids touching that rule, and forbids any prune. These assert
 * the non-change directly, so a later "cleanup" that quietly turns the
 * affordance into a deletion fails here rather than in production.
 */
describe('the stored-value re-show rule is unchanged', () => {
  const fields = approval();

  it('still shows a hidden-but-stored field (the rule the prune option would have inverted)', () => {
    const node = { id: 'a', type: 'approval', config: { escalation: { enabled: false, timeoutHours: 24 } } };
    expect(isFieldVisible(field(fields, 'escalation.timeoutHours'), node, fields)).toBe(true);
  });

  it('reading the affordance does not mutate the node', () => {
    const node = { id: 'a', type: 'approval', config: { escalation: { enabled: false, timeoutHours: 24 } } };
    const before = JSON.stringify(node);
    inactiveRetainedKind(field(fields, 'escalation.timeoutHours'), node, fields);
    isFieldVisible(field(fields, 'escalation.timeoutHours'), node, fields);
    expect(JSON.stringify(node)).toBe(before);
  });
});
