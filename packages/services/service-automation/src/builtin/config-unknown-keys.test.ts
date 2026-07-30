// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Unknown flow-node `config` keys are reported at registration (#4045).
 *
 * `FlowNodeSchema.config` is `z.record(z.unknown())`, so before this a misspelled
 * or invented config key was accepted in **total silence**: `visibleIf` instead of
 * `visibleWhen` registered cleanly, was never read, and the only symptom was a
 * feature that quietly did not happen. That is the diagnostic vacuum that made
 * #3528 take three passes and two wrong diagnoses.
 *
 * Warn, never reject — see `validateNodeConfigKeys` for why. These tests pin both
 * halves of that: the warning fires with an actionable suggestion, AND
 * registration still succeeds.
 */

import { describe, it, expect } from 'vitest';
import { AutomationEngine } from '../engine.js';
import { installBuiltinNodes } from './index.js';

function recordingLogger() {
  const warnings: string[] = [];
  const logger: any = {
    info() {}, error() {}, debug() {},
    warn(msg: string) { warnings.push(msg); },
    child() { return logger; },
  };
  return { logger, warnings };
}

function engineWith(logger: any) {
  const engine = new AutomationEngine(logger);
  installBuiltinNodes(engine, { logger, getService() { throw new Error('none'); } } as any);
  return engine;
}

/** A one-node flow carrying `config` verbatim on a node of `type`. */
function flowWith(type: string, config: Record<string, unknown>) {
  return {
    name: 'f', label: 'F', type: 'screen', status: 'active', version: 1,
    nodes: [
      { id: 'start', type: 'start', label: 'S', config: {} },
      { id: 'n1', type, label: 'N', config },
      { id: 'end', type: 'end', label: 'E' },
    ],
    edges: [
      { id: 'e1', source: 'start', target: 'n1', type: 'default' },
      { id: 'e2', source: 'n1', target: 'end', type: 'default' },
    ],
  };
}

describe('unknown node config keys (#4045)', () => {
  it('flags a misspelled key with a did-you-mean suggestion', () => {
    const { logger, warnings } = recordingLogger();
    const engine = engineWith(logger);

    // The typo lives INSIDE the field repeater — where the real #3528 one did.
    engine.registerFlow('f', flowWith('screen', {
      fields: [{ name: 'opportunityName', required: true, visibleIf: 'createOpportunity == true' }],
    }));

    const hit = warnings.find((w) => w.includes('visibleIf'));
    expect(hit, 'the typo should be reported').toBeDefined();
    expect(hit).toContain("node 'n1'");
    expect(hit).toContain('(screen)');
    // Located to the exact element, so the author knows WHICH field.
    expect(hit).toContain('config.fields[0].visibleIf');
    // The load-bearing half for an agent author: the correct key is named. Note
    // it comes from the DECLARED SET, not the suggestion — `visibleIf` →
    // `visibleWhen` is edit-distance 4 against `nearestName`'s threshold of 3, so
    // this exact typo gets no did-you-mean. Printing the declared set is what
    // makes the diagnostic actionable regardless.
    expect(hit).toContain('Declared here: name, label, type, required, visibleWhen.');
  });

  it('adds a did-you-mean when the typo IS within edit distance', () => {
    const { logger, warnings } = recordingLogger();
    const engine = engineWith(logger);

    engine.registerFlow('f', flowWith('screen', { titl: 'Details' }));

    const hit = warnings.find((w) => w.includes('titl'));
    expect(hit).toContain('did you mean `title`?');
    // …and still lists the declared set alongside it.
    expect(hit).toContain('Declared here:');
  });

  it('still registers the flow — warn, never reject', () => {
    const { logger } = recordingLogger();
    const engine = engineWith(logger);
    expect(() => engine.registerFlow('f', flowWith('screen', { visibleIf: 'a == true' }))).not.toThrow();
    // And it is really registered, not swallowed.
    expect(engine.getFlow('f')).toBeDefined();
  });

  it('lists the declared keys when nothing is close enough to suggest', () => {
    const { logger, warnings } = recordingLogger();
    const engine = engineWith(logger);

    engine.registerFlow('f', flowWith('screen', { totallyMadeUp: 42 }));

    const hit = warnings.find((w) => w.includes('totallyMadeUp'));
    expect(hit).toBeDefined();
    expect(hit).not.toContain('did you mean');
    // The declared set is always present, so there is always somewhere to go.
    expect(hit).toContain('Declared here:');
    expect(hit).toContain('fields');
  });

  it('reports every undeclared key, not just the first', () => {
    const { logger, warnings } = recordingLogger();
    const engine = engineWith(logger);

    engine.registerFlow('f', flowWith('screen', { hideWhen: 'x', submitLabel: 'Go' }));

    expect(warnings.some((w) => w.includes('hideWhen'))).toBe(true);
    expect(warnings.some((w) => w.includes('submitLabel'))).toBe(true);
  });

  it('stays quiet on a fully declared config', () => {
    const { logger, warnings } = recordingLogger();
    const engine = engineWith(logger);

    engine.registerFlow('f', flowWith('screen', {
      title: 'Details',
      fields: [{ name: 'a', type: 'boolean', required: true, visibleWhen: 'b == true' }],
      waitForInput: true,
      defaults: { x: 1 },
    }));

    expect(warnings.filter((w) => w.includes('unknown config key'))).toEqual([]);
  });

  it('stays quiet for a node type that publishes no configSchema', () => {
    // `decision` / `script` are deliberately schemaless (config-schemas.test.ts):
    // nothing is declared, so nothing can be undeclared.
    const { logger, warnings } = recordingLogger();
    const engine = engineWith(logger);

    engine.registerFlow('f', flowWith('decision', { condition: 'a == b', whateverElse: 1 }));

    expect(warnings.filter((w) => w.includes('unknown config key'))).toEqual([]);
  });

  it('does not flag the keys of a keyValue map — those are author data', () => {
    // The walk descends where the schema declares structure and STOPS at a
    // free-form map: `filter: { status: 'stale' }` keys are data, not config keys.
    const { logger, warnings } = recordingLogger();
    const engine = engineWith(logger);

    engine.registerFlow('f', flowWith('get_record', {
      objectName: 'crm_lead',
      filter: { status: 'stale', anythingAtAll: true },
    }));

    expect(warnings.filter((w) => w.includes('unknown config key'))).toEqual([]);
  });
});
