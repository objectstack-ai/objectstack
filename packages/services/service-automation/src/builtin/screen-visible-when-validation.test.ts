// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `screen.fields[].visibleWhen` is validated at registration (#4027).
 *
 * The reproduction is #3528's, verbatim. HotCRM authored the predicate in the
 * `{var}` template dialect its sibling config keys use correctly:
 *
 * ```ts
 * { name: 'opportunityName', required: true, visibleWhen: '{createOpportunity} == true' }
 * ```
 *
 * A screen field's `visibleWhen` is **bare CEL**, so that never resolved. The
 * consequence was not a cosmetic one: `required` *is* enforced, so a field the
 * author had made conditional rendered unconditionally and blocked Submit on an
 * input the user was never meant to see. The flow paused forever, no resume was
 * ever issued, and no layer complained — `tsc`, `objectstack validate` and
 * `registerFlow` all passed it, because no validator traversed the key.
 *
 * It is now a loud registration error, located and quoted.
 */

import { describe, it, expect } from 'vitest';
import { AutomationEngine } from '../engine.js';
import { installBuiltinNodes } from './index.js';

function silentLogger() {
  return { info() {}, warn() {}, error() {}, debug() {}, child() { return silentLogger(); } } as any;
}
function ctx() {
  return { logger: silentLogger(), getService() { throw new Error('none'); } } as any;
}

function engineWithBuiltins() {
  const engine = new AutomationEngine(silentLogger());
  installBuiltinNodes(engine, ctx());
  return engine;
}

/** A single-screen flow whose conditional field carries `visibleWhen`. */
function flowWithVisibleWhen(visibleWhen: string) {
  return {
    name: 'lead_conversion',
    label: 'Lead Conversion',
    type: 'screen',
    status: 'active',
    version: 1,
    nodes: [
      { id: 'start', type: 'start', label: 'Start', config: { objectName: 'crm_lead' } },
      {
        id: 'screen_1', type: 'screen', label: 'Conversion Details',
        config: {
          fields: [
            { name: 'createOpportunity', label: 'Create Opportunity?', type: 'boolean', required: true, defaultValue: false },
            { name: 'opportunityName', label: 'Opportunity Name', type: 'text', required: true, visibleWhen },
          ],
        },
      },
      { id: 'end', type: 'end', label: 'End' },
    ],
    edges: [
      { id: 'e1', source: 'start', target: 'screen_1', type: 'default' },
      { id: 'e2', source: 'screen_1', target: 'end', type: 'default' },
    ],
  };
}

describe('screen field visibleWhen validation (#4027, reproducing #3528)', () => {
  it('rejects the `{var}` template dialect in a visibleWhen predicate', () => {
    const engine = engineWithBuiltins();
    // The exact predicate HotCRM shipped.
    expect(() => engine.registerFlow('lead_conversion', flowWithVisibleWhen('{createOpportunity} == true')))
      .toThrow(/template braces|bare CEL/);
  });

  it('locates the offending field, so an author knows which one to fix', () => {
    const engine = engineWithBuiltins();
    let message = '';
    try {
      engine.registerFlow('lead_conversion', flowWithVisibleWhen('{createOpportunity} == true'));
    } catch (e) {
      message = (e as Error).message;
    }
    // Node id, the human label, and the indexed path into the repeater.
    expect(message).toContain("node 'screen_1'");
    expect(message).toContain('screen field visibleWhen');
    expect(message).toContain('config.fields[1].visibleWhen');
    // And the source itself, quoted back.
    expect(message).toContain('{createOpportunity} == true');
  });

  it('accepts the corrected bare-CEL predicate', () => {
    const engine = engineWithBuiltins();
    expect(() => engine.registerFlow('lead_conversion', flowWithVisibleWhen('createOpportunity == true')))
      .not.toThrow();
  });

  it('accepts a screen with no visibleWhen at all', () => {
    const engine = engineWithBuiltins();
    const flow = flowWithVisibleWhen('createOpportunity == true') as any;
    delete flow.nodes[1].config.fields[1].visibleWhen;
    expect(() => engine.registerFlow('lead_conversion', flow)).not.toThrow();
  });

  it('reports every malformed field, not just the first', () => {
    const engine = engineWithBuiltins();
    const flow = flowWithVisibleWhen('{createOpportunity} == true') as any;
    flow.nodes[1].config.fields.push({
      name: 'opportunityAmount', label: 'Amount', type: 'currency',
      visibleWhen: '{createOpportunity} == true',
    });
    let message = '';
    try {
      engine.registerFlow('lead_conversion', flow);
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message).toContain('config.fields[1].visibleWhen');
    expect(message).toContain('config.fields[2].visibleWhen');
    expect(message).toMatch(/2 invalid expressions/);
  });

  it('still accepts a `{var}` template where a template is what is declared', () => {
    // The dialects are opposite, and the ledger records which is which: braces
    // are the brace-trap in `visibleWhen` and the CORRECT spelling in
    // `loop.collection`. A dialect-blind check would break this flow.
    const engine = engineWithBuiltins();
    expect(() => engine.registerFlow('loop_flow', {
      name: 'loop_flow', label: 'Loop', type: 'screen', status: 'active', version: 1,
      nodes: [
        { id: 'start', type: 'start', label: 'Start', config: {} },
        { id: 'loop_1', type: 'loop', label: 'Loop', config: { collection: '{tasks}', iteratorVariable: 'task' } },
        { id: 'end', type: 'end', label: 'End' },
      ],
      edges: [
        { id: 'e1', source: 'start', target: 'loop_1', type: 'default' },
        { id: 'e2', source: 'loop_1', target: 'end', type: 'default' },
      ],
    })).not.toThrow();
  });
});
