// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#11067 — the start node's trigger select stops offering
 * 「Platform event」, table half.
 *
 * The option wrote `triggerType: 'event'`, a token the spec's
 * `resolveFlowTriggerKind` answers NO kind for: no engine trigger binds it, so
 * a flow authored with it never fired and nothing said so. Triage's direction
 * was to remove the option, not to invent a route for it. These pins ask the
 * resolver itself whether the token is routed, rather than restating its
 * grammar, the way `flow-node-config.apiTrigger-11054.test.ts` does for `api`.
 *
 * What the author SEES on a node that already stores `event` — the select's
 * flagged unknown value, and a save that keeps the token — is pinned in
 * `FlowNodeInspector.platformEvent-11067.test.tsx`.
 */

import { describe, it, expect } from 'vitest';
import { resolveFlowTriggerKind } from '@objectstack/spec/automation';
import { flowFieldZh } from '../i18n';
import {
  fieldsForNodeType,
  isFieldVisible,
  inactiveRetainedKind,
  type FlowConfigField,
} from './flow-node-config';

const fields = fieldsForNodeType('start');
const byId = (id: string): FlowConfigField => {
  const f = fields.find((x) => x.id === id);
  expect(f, `start field ${id} exists`).toBeDefined();
  return f as FlowConfigField;
};
const trigger = byId('triggerType');
const offered = (trigger.options ?? []).map((o) => o.value);

/** A one-node flow whose start node carries `config`. */
function flowWith(config: Record<string, unknown>) {
  return { name: 'f', type: 'autolaunched', nodes: [{ id: 'start', type: 'start', config }], edges: [] };
}

describe('the retired `event` token is one no engine routes (objectui#11067)', () => {
  it('the spec resolver answers no kind for it, with or without an object', () => {
    expect(resolveFlowTriggerKind(flowWith({ triggerType: 'event' }))).toBeUndefined();
    expect(resolveFlowTriggerKind(flowWith({ triggerType: 'event', objectName: 'task' }))).toBeUndefined();
    // The control: the same probe answers a kind for a routed token, so the
    // two lines above are not a resolver that answers nothing for anything.
    expect(resolveFlowTriggerKind(flowWith({ triggerType: 'api' }))).toBe('api');
  });
});

describe('the start node trigger select stops offering it (objectui#11067)', () => {
  it('no option writes `event`, and none is labelled 「Platform event」', () => {
    expect(offered).not.toContain('event');
    expect((trigger.options ?? []).map((o) => o.label)).not.toContain('Platform event');
    // Control: the list is the real roster, not an empty one.
    expect(offered).toContain('api');
  });

  it('no start field is gated on `event` any more', () => {
    const objectName = byId('objectName');
    expect(objectName.showWhen?.field).toBe('triggerType');
    expect(objectName.showWhen?.equals).not.toContain('event');
    // objectui#12780 — the Entry condition carries no gate at all.
    expect(byId('condition').showWhen).toBeUndefined();
  });

  it('every value a start field is gated on is one the select offers', () => {
    // A gate naming a token the select does not offer shows fields for a
    // trigger the author can no longer choose. That is how `event` stayed in
    // both lists, so this states the rule rather than the one token.
    const gated = fields.filter((f) => f.showWhen?.field === 'triggerType');
    expect(gated.length).toBeGreaterThan(0);
    for (const f of gated) {
      for (const v of f.showWhen!.equals) expect(offered, `${f.id} gated on ${v}`).toContain(v);
    }
  });

  it('the zh overlay labels only options the select offers', () => {
    const opts = flowFieldZh('start', 'triggerType')?.opts ?? {};
    // Control: the overlay is really read here (it labels `api`).
    expect(Object.keys(opts)).toContain('api');
    for (const key of Object.keys(opts)) expect(offered, `zh option ${key}`).toContain(key);
  });
});

describe('a start node that already stores `event` (objectui#11067)', () => {
  it('no longer shows the object field for it on the token alone', () => {
    // The Entry condition shows under every token (objectui#12780): the engine
    // evaluates it on every run, whatever the trigger.
    const node = flowWith({ triggerType: 'event' }).nodes[0];
    expect(isFieldVisible(byId('objectName'), node, fields)).toBe(false);
  });

  it('keeps a value it already stores on screen, flagged as retained', () => {
    const node = flowWith({ triggerType: 'event', objectName: 'task' }).nodes[0];
    const objectName = byId('objectName');
    expect(isFieldVisible(objectName, node, fields)).toBe(true);
    expect(inactiveRetainedKind(objectName, node, fields)).toBe('controller-off');
    // Control: on a routed record trigger the same value is live, not retained.
    const live = flowWith({ triggerType: 'record-after-create', objectName: 'task' }).nodes[0];
    expect(inactiveRetainedKind(objectName, live, fields)).toBeNull();
  });
});
