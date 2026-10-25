// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#11054 — the start node's inbound-hook trigger, table half.
 *
 * The Trigger select's 「Webhook / API」 option used to write
 * `triggerType: 'webhook'`, a token the spec's `resolveFlowTriggerKind` answers
 * NO kind for: the engine bound nothing and the flow never received a post.
 * The option now writes `api`, the token that resolver routes, so these pins
 * ask the resolver itself rather than restating its grammar.
 *
 * The start node also gains the inbound hook's per-flow secret, gated on the
 * FLOW's trigger kind (`flowKind`) — `type: 'api'` at the flow level reaches
 * the same kind as `triggerType: 'api'` on the start node, and the engine
 * refuses either without the secret.
 *
 * What the author SEES — the write-only control, the notice, the round trip —
 * is pinned in `FlowNodeInspector.apiTriggerSecret-11054.test.tsx`.
 */

import { describe, it, expect } from 'vitest';
import { resolveFlowTriggerKind } from '@objectstack/spec/automation';
import {
  fieldsForNodeType,
  isFieldVisible,
  inactiveRetainedKind,
  unsetNoticeApplies,
  localizeFlowFields,
  type FlowConfigField,
} from './flow-node-config';

const fields = fieldsForNodeType('start');
const byId = (id: string): FlowConfigField => {
  const f = fields.find((x) => x.id === id);
  expect(f, `start field ${id} exists`).toBeDefined();
  return f as FlowConfigField;
};

/** A one-node flow whose start node carries `config`, plus any flow-level keys. */
function flowWith(config: Record<string, unknown>, top: Record<string, unknown> = {}) {
  return { name: 'f', type: 'autolaunched', ...top, nodes: [{ id: 'start', type: 'start', config }], edges: [] };
}

describe('the 「Webhook / API」 trigger writes the token the engine routes (objectui#11054)', () => {
  const trigger = byId('triggerType');
  const webhookApi = (trigger.options ?? []).find((o) => o.label === 'Webhook / API');

  it('the option exists and carries a value the spec resolver answers `api` for', () => {
    expect(webhookApi).toBeDefined();
    expect(resolveFlowTriggerKind(flowWith({ triggerType: webhookApi!.value }))).toBe('api');
  });

  it('the retired `webhook` token is unrouted, and no option writes it', () => {
    // The control: the retired token really is unrouted, so the assertion above
    // is not satisfied by a resolver that answers `api` for anything.
    expect(resolveFlowTriggerKind(flowWith({ triggerType: 'webhook' }))).toBeUndefined();
    expect((trigger.options ?? []).map((o) => o.value)).not.toContain('webhook');
  });

  it('the new token shows the Entry condition, and neither token shows Object (objectui#12780)', () => {
    // The engine evaluates the start condition on every run, so it carries no
    // gate; the API binding never reads `config.objectName`.
    expect(byId('condition').showWhen).toBeUndefined();
    const objectName = byId('objectName');
    expect(objectName.showWhen?.equals).not.toContain('api');
    expect(objectName.showWhen?.equals).not.toContain('webhook');
  });

  it('the zh overlay labels the new option value, not the retired one', () => {
    const zh = localizeFlowFields('start', fields, 'zh-CN').find((f) => f.id === 'triggerType')!;
    const opt = (zh.options ?? []).find((o) => o.value === 'api');
    expect(opt?.label).toBeTruthy();
    // Control: an option the overlay does not cover keeps its English label, so
    // a missing `api` entry would show up as the English text here.
    expect(opt?.label).toBe('Webhook / API');
  });
});

describe('the start node offers the inbound hook secret when the flow kind is api (objectui#11054)', () => {
  const secret = byId('secret');

  it('is a write-only `secret` field on `config.secret`, gated on the flow kind', () => {
    expect(secret.kind).toBe('secret');
    expect(secret.path).toEqual(['config', 'secret']);
    expect(secret.flowKind).toEqual(['api']);
    expect(secret.unsetNotice).toBeTruthy();
  });

  it('is shown for the api kind — whichever of the two spellings reached it', () => {
    const viaSelect = flowWith({ triggerType: 'api' });
    const viaFlowType = flowWith({}, { type: 'api' });
    for (const flow of [viaSelect, viaFlowType]) {
      const kind = resolveFlowTriggerKind(flow);
      expect(kind).toBe('api');
      expect(isFieldVisible(secret, flow.nodes[0], fields, kind)).toBe(true);
    }
  });

  it('is hidden for every other kind, and for a flow with no trigger kind', () => {
    const cases = [
      flowWith({ triggerType: 'record-after-create', objectName: 'task' }),
      flowWith({ triggerType: 'schedule', schedule: { expression: '0 7 * * *' } }),
      flowWith({ triggerType: 'manual' }),
      // The engine's precedence: a schedule descriptor outranks `triggerType: 'api'`,
      // so this flow binds the schedule trigger and needs no secret.
      flowWith({ triggerType: 'api', schedule: { expression: '0 7 * * *' } }),
    ];
    for (const flow of cases) {
      const kind = resolveFlowTriggerKind(flow);
      expect(kind).not.toBe('api');
      expect(isFieldVisible(secret, flow.nodes[0], fields, kind), JSON.stringify(flow.nodes[0].config)).toBe(false);
    }
  });

  it('is never admitted by the gate when the host supplies no kind', () => {
    const node = flowWith({ triggerType: 'api' }).nodes[0];
    expect(isFieldVisible(secret, node, fields)).toBe(false);
    // Control: the same call WITH the kind admits it.
    expect(isFieldVisible(secret, node, fields, 'api')).toBe(true);
  });

  it('a value held on a non-api start node stays on screen, flagged as retained', () => {
    const flow = flowWith({ triggerType: 'manual', secret: 'held-on-the-node' });
    const kind = resolveFlowTriggerKind(flow);
    expect(isFieldVisible(secret, flow.nodes[0], fields, kind)).toBe(true);
    expect(inactiveRetainedKind(secret, flow.nodes[0], fields, kind)).toBe('controller-off');
    // …and is not flagged once the flow is api-kind again.
    const live = flowWith({ triggerType: 'api', secret: 'held-on-the-node' });
    expect(inactiveRetainedKind(secret, live.nodes[0], fields, 'api')).toBeNull();
  });
});

describe('the missing-secret notice stands exactly where the engine refuses (objectui#11054)', () => {
  const secret = byId('secret');

  it('stands for an absent, empty or whitespace-only value', () => {
    for (const v of [undefined, null, '', '   ']) {
      expect(unsetNoticeApplies(secret, v), JSON.stringify(v)).toBe(true);
    }
  });

  it('does not stand for a non-blank value', () => {
    expect(unsetNoticeApplies(secret, 'any-non-blank-value')).toBe(false);
  });

  it('is declared on no other start field — a field without `unsetNotice` never raises it', () => {
    for (const f of fields.filter((x) => x.id !== 'secret')) {
      expect(unsetNoticeApplies(f, undefined), f.id).toBe(false);
    }
  });

  it('the zh overlay localizes the field and its notice', () => {
    const zh = localizeFlowFields('start', fields, 'zh-CN').find((f) => f.id === 'secret')!;
    expect(zh.label).not.toBe(secret.label);
    expect(zh.help).not.toBe(secret.help);
    expect(zh.unsetNotice).toBeTruthy();
    expect(zh.unsetNotice).not.toBe(secret.unsetNotice);
  });
});
